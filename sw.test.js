const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createWorker(failingAssets = [], fetchImplementation = async () => {
  throw new Error('offline');
}) {
  const handlers = {};
  const workerLocation = 'https://example.test/app/sw.js';
  const workerUrl = new URL(workerLocation);
  const createCache = (entries) => ({
    add: async (asset) => {
      if (failingAssets.includes(asset)) {
        throw new Error(`Unable to cache ${asset}`);
      }

      const request = new Request(new URL(asset, workerLocation));
      entries.set(request.url, new Response('asset'));
    },
    match: async (request) => {
      const url = typeof request === 'string'
        ? new URL(request, workerLocation).href
        : request.url;
      return entries.get(url);
    },
    put: async (request, response) => entries.set(request.url, response)
  });
  const caches = new Map();
  const cacheEntries = new Map();
  const workerState = { skipWaitingCalls: 0 };
  const context = {
    Request,
    Response,
    URL,
    Promise,
    Set,
    console,
    self: {
      location: {
        origin: workerUrl.origin,
        toString: () => workerLocation
      },
      skipWaiting: async () => { workerState.skipWaitingCalls += 1; },
      addEventListener: (type, handler) => { handlers[type] = handler; },
      clients: {
        claim: async () => {},
        matchAll: async () => []
      }
    },
    caches: {
      open: async (name) => {
        if (!caches.has(name)) {
          const entries = new Map();
          cacheEntries.set(name, entries);
          caches.set(name, createCache(entries));
        }
        return caches.get(name);
      },
      delete: async (name) => {
        cacheEntries.delete(name);
        return caches.delete(name);
      },
      match: async (request) => {
        for (const cache of caches.values()) {
          const response = await cache.match(request);
          if (response) {
            return response;
          }
        }
        return undefined;
      },
      keys: async () => [...caches.keys()]
    },
    fetch: fetchImplementation
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), context);
  return { handlers, context, workerState };
}

test('precache status can be requested by a later page', async () => {
  const { handlers } = createWorker();
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  let postedStatus;
  let messagePromise;
  handlers.message({
    data: { type: 'GET_PRECACHE_STATUS' },
    source: { postMessage: (status) => { postedStatus = status; } },
    waitUntil: (promise) => { messagePromise = promise; }
  });
  await messagePromise;

  assert.deepEqual(postedStatus, { type: 'PRECACHE_STATUS', ok: true });
});

test('required precache failures reject installation and preserve the active cache', async () => {
  const { handlers, context, workerState } = createWorker(['style.css']);
  const activeCache = await context.caches.open('enterprise-v9');
  const previousDashboard = new Request('https://example.test/app/dashboard.html');
  await activeCache.put(previousDashboard, new Response('previous dashboard'));
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await assert.rejects(installPromise, /recurso obligatorio/);

  assert.equal(workerState.skipWaitingCalls, 0);
  assert.deepEqual(await context.caches.keys(), ['enterprise-v9']);
  assert.equal(await (await activeCache.match(previousDashboard)).text(), 'previous dashboard');
});

test('optional icon failures do not mark precache unhealthy', async () => {
  const { handlers } = createWorker(['icons/icon-192.png']);
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  let postedStatus;
  let messagePromise;
  handlers.message({
    data: { type: 'GET_PRECACHE_STATUS' },
    source: { postMessage: (status) => { postedStatus = status; } },
    waitUntil: (promise) => { messagePromise = promise; }
  });
  await messagePromise;

  assert.deepEqual(postedStatus, { type: 'PRECACHE_STATUS', ok: true });
});

test('cached assets return before network revalidation completes', async () => {
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
  const { handlers } = createWorker([], () => fetchPromise);
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  let responsePromise;
  let refreshPromise;
  handlers.fetch({
    request: new Request('https://example.test/app/dashboard.html'),
    respondWith: (promise) => { responsePromise = promise; },
    waitUntil: (promise) => { refreshPromise = promise; }
  });

  let timeoutId;
  const cachedResponse = await Promise.race([
    responsePromise,
    new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Cached response waited for the network')), 100);
    })
  ]).finally(() => clearTimeout(timeoutId));
  assert.equal(await cachedResponse.text(), 'asset');

  resolveFetch(new Response('updated dashboard'));
  await refreshPromise;
});

test('offline query-string requests use the canonical cache key', async () => {
  const { handlers } = createWorker();
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  let responsePromise;
  let refreshPromise;
  handlers.fetch({
    request: new Request('https://example.test/app/dashboard.html?version=2'),
    respondWith: (promise) => { responsePromise = promise; },
    waitUntil: (promise) => { refreshPromise = promise; }
  });

  assert.equal(await (await responsePromise).text(), 'asset');
  await refreshPromise;
});

test('page integrations bound status requests with a timeout', () => {
  const loginHtml = fs.readFileSync('login.html', 'utf8');
  const dashboardCode = fs.readFileSync('dashboard.js', 'utf8');

  assert.match(loginHtml, /requestPrecacheStatus\(navigator\.serviceWorker\)/);
  assert.match(dashboardCode, /requestPrecacheStatus\(navigator\.serviceWorker\)/);
});

test('page status handling reveals a precache error', () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  const context = { Promise, setTimeout };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  const message = { hidden: true };
  context.handlePrecacheStatus(
    { data: { type: 'PRECACHE_STATUS', ok: false } },
    { getElementById: () => message }
  );

  assert.equal(message.hidden, false);
});

test('theme toggle follows system preference and persists the selected theme', () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  const listeners = {};
  const storage = new Map();
  const buttonListeners = {};
  const toggle = {
    addEventListener: (event, handler) => { buttonListeners[event] = handler; },
    setAttribute: (name, value) => { toggle[name] = value; }
  };
  const themeColor = {};
  const context = {
    Promise,
    TextEncoder,
    TextDecoder,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    matchMedia: () => ({ matches: true }),
    document: {
      documentElement: { dataset: {} },
      addEventListener: (event, handler) => { listeners[event] = handler; },
      querySelector: (selector) => selector === '[data-theme-toggle]' ? toggle : themeColor
    }
  };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  listeners.DOMContentLoaded();
  assert.equal(toggle.textContent, '\u2600 Modo claro');
  buttonListeners.click();

  assert.equal(context.document.documentElement.dataset.theme, 'light');
  assert.equal(toggle.textContent, '\u263e Modo oscuro');
  assert.equal(storage.get('bitacora_theme'), 'light');
  assert.equal(toggle['aria-label'], 'Activar modo oscuro');
  assert.equal(themeColor.content, '#f4f6f9');
});

test('saving an entry returns the updated history', () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  const storage = new Map();
  const context = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    }
  };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  const entry = { submissionId: 'entry-1', novedad: 'Prueba' };
  const savedEntries = context.saveEntry(entry);
  assert.equal(savedEntries.length, 1);
  assert.equal(savedEntries[0].submissionId, entry.submissionId);
  assert.equal(JSON.parse(storage.get('bitacora_entries')).length, 1);
});

test('local file pages do not show a service worker error', () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  const context = { Promise, location: { protocol: 'file:' } };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  const message = { hidden: true };
  context.showServiceWorkerError(new Error('Service workers are unavailable'), {
    getElementById: () => message
  });

  assert.equal(message.hidden, true);
});

test('unsupported browsers receive a message and disabled controls', () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  let readyHandler;
  const message = { hidden: true };
  const context = {
    document: {
      addEventListener: (event, handler) => {
        if (event === 'DOMContentLoaded') readyHandler = handler;
      },
      getElementById: () => message
    }
  };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  readyHandler();
  const controls = [{ disabled: false }, { disabled: false }];
  context.disableUnsupportedControls({
    getElementById: () => message,
    querySelectorAll: () => controls
  });

  assert.equal(message.hidden, false);
  assert.deepEqual(controls.map((control) => control.disabled), [true, true]);
});

test('status requests resolve when the worker never becomes ready', async () => {
  const sessionCode = fs.readFileSync('session.js', 'utf8');
  const context = { Promise, setTimeout };
  vm.createContext(context);
  vm.runInContext(sessionCode, context);

  const serviceWorker = { ready: new Promise(() => {}) };
  const result = await context.requestPrecacheStatus(serviceWorker, 1);
  assert.equal(result, undefined);
});

test('uncached offline navigation serves offline.html', async () => {
  const { handlers, context } = createWorker();
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  const response = await vm.runInContext(
    "getOfflineFallback({ request: { mode: 'navigate' } }, new Request('https://example.test/app/missing.html'))",
    context
  );
  assert.equal(await response.text(), 'asset');
});
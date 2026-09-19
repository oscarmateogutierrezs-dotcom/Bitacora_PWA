const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function createWorker(failingAssets = []) {
  const handlers = {};
  const workerLocation = 'https://example.test/app/sw.js';
  const assetEntries = new Map();
  const metaEntries = new Map();
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
  const assetCache = createCache(assetEntries);
  const metaCache = createCache(metaEntries);
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
      skipWaiting: async () => {},
      addEventListener: (type, handler) => { handlers[type] = handler; },
      clients: {
        claim: async () => {},
        matchAll: async () => []
      }
    },
    caches: {
      open: async (name) => {
        if (!caches.has(name)) {
          caches.set(name, name.endsWith('-meta') ? metaCache : assetCache);
        }
        return caches.get(name);
      },
      match: (request) => assetCache.match(request),
      keys: async () => [...caches.keys()]
    },
    fetch: async () => {
      throw new Error('offline');
    }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), context);
  return { handlers, assetEntries, metaEntries, context };
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

test('required precache failures are reported as unhealthy', async () => {
  const { handlers } = createWorker(['style.css']);
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

  assert.deepEqual(postedStatus, { type: 'PRECACHE_STATUS', ok: false });
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

test('offline query-string requests use the canonical cache key', async () => {
  const { handlers } = createWorker();
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  let responsePromise;
  handlers.fetch({
    request: new Request('https://example.test/app/dashboard.html?version=2'),
    respondWith: (promise) => { responsePromise = promise; }
  });

  assert.equal(await (await responsePromise).text(), 'asset');
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
  const { handlers, context } = createWorker(['dashboard.html']);
  let installPromise;
  handlers.install({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;

  const response = await vm.runInContext(
    "getOfflineFallback({ request: { mode: 'navigate' } }, new Request('https://example.test/app/dashboard.html'))",
    context
  );
  assert.equal(await response.text(), 'asset');
});
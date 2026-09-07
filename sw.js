const CACHE_NAME = 'enterprise-v3';
const META_CACHE_NAME = `${CACHE_NAME}-meta`;
const ASSETS = [
  'login.html',
  'dashboard.html',
  'offline.html',
  'session.js',
  'areasMaquinas.json',
  'style.css',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];
const CACHEABLE_PATHS = new Set(
  ASSETS.map((asset) => new URL(asset, self.location).pathname)
);
const REQUIRED_ASSETS = ASSETS.filter((asset) => !asset.startsWith('icons/'));

// Install lifecycle event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Pre-catching archivos esenciales de la bitacora')
      return Promise.allSettled(ASSETS.map((asset) => cache.add(asset))).then((results) => {
        const failedAssets = results
          .map((result, index) => ({ result, asset: ASSETS[index] }))
          .filter(({ result }) => result.status === 'rejected');

        failedAssets.forEach(({ result, asset }) => {
          console.error('No se pudo precachear un archivo:', asset, result.reason);
        });

        const failedRequiredAsset = failedAssets.find(({ asset }) =>
          REQUIRED_ASSETS.includes(asset)
        );
        const status = new Response(JSON.stringify({
          type: 'PRECACHE_STATUS',
          ok: !failedRequiredAsset
        }), { headers: { 'Content-Type': 'application/json' } });
        return caches.open(META_CACHE_NAME).then((metaCache) =>
          metaCache.put(new Request(new URL('precache-status', self.location)), status)
        );
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'GET_PRECACHE_STATUS' || !event.source) {
    return;
  }

  event.waitUntil(
    caches.open(META_CACHE_NAME).then((metaCache) =>
      metaCache.match(new Request(new URL('precache-status', self.location)))
    ).then((response) =>
      response ? response.json() : { type: 'PRECACHE_STATUS', ok: true }
    ).then((status) => event.source.postMessage(status))
  );
});

// Evento de activación: limpia cachés antiguas si actualizas la versión de la app
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME && cache !== META_CACHE_NAME) {
              console.log('Borrando caché antigua:', cache);
              return caches.delete(cache);
            }
          })
        );
      })
    ])
  );
});

// Evento fetch: intercepta las peticiones y sirve los archivos desde la caché si está offline
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' ||
      requestUrl.origin !== self.location.origin ||
      !CACHEABLE_PATHS.has(requestUrl.pathname)) {
    return;
  }

  const cacheKey = new Request(requestUrl.origin + requestUrl.pathname);

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (!networkResponse.ok) {
          return networkResponse;
        }

        const responseCopy = networkResponse.clone();
        event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, responseCopy))
        );
        return networkResponse;
      })
      .catch(() => getOfflineFallback(event, cacheKey))
  );
});

function getOfflineFallback(event, cacheKey) {
  return caches.match(cacheKey).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        if (event.request.mode === 'navigate') {
          return caches.match(new URL('offline.html', self.location).pathname);
        }

        return new Response('Recurso no disponible sin conexión.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
  });
}

const RUNTIME_CACHE_NAME = 'learner-runtime-cache-v1';
const RUNTIME_PREFIX = '/offline-runtime/';

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || !requestUrl.pathname.startsWith(RUNTIME_PREFIX)) {
    return;
  }

  event.respondWith(
    caches.open(RUNTIME_CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      return new Response('Offline runtime asset not found.', {
        status: 404,
        statusText: 'Not Found',
      });
    }),
  );
});

importScripts('./ngsw-worker.js');

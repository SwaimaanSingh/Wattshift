/**
 * WattShift service worker — offline app shell.
 *
 * Built to `/sw.js` by the `sw` rollup input in vite.config.js, so it is
 * served from the origin root and takes the whole site as its scope.
 *
 * Deliberately hand-rolled rather than generated: the app is fully
 * client-side, has no API to speak of, and the only two things it truly needs
 * offline are the shell and the irradiance table. A precache manifest would
 * add a build dependency for very little.
 *
 * Caching rules:
 *  - navigations       network-first, falling back to the cached shell, so a
 *                      deployed update is picked up on the next visit but a
 *                      cold offline load still renders
 *  - same-origin GETs  stale-while-revalidate; Vite's assets are content
 *                      hashed, so a cached hit is always the right file
 *  - everything else   straight to the network (fonts, and any non-GET)
 */

const VERSION = 'v1';
const CACHE = `wattshift-${VERSION}`;

/**
 * The shell, plus the irradiance table — without that lookup the app can load
 * offline but cannot produce an estimate, which is the whole point of it.
 */
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/data/solarIrradiance.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 can't fail the whole install.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('wattshift-') && key !== CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/** Fresh HTML when we can reach the network, the cached shell when we can't. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match('/index.html')) ??
      (await cache.match('/')) ??
      Response.error()
    );
  }
}

/** Serve from cache immediately, refresh the entry in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  const response = cached ?? (await network);
  return response ?? Response.error();
}

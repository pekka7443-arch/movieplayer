// CineDeck service worker — offline shell + static asset cache.
// Strategy:
//  - app shell (navigation requests): network-first with cache fallback, so
//    fresh HTML wins when online and the last shell still opens offline;
//  - icons: cache-first (truly immutable files);
//  - /_next/static: NETWORK-FIRST with cache fallback.
//    WHY NOT cache-first: the immutable-URL assumption only holds for
//    production builds (content-hashed filenames). The dev/preview server
//    (Turbopack) reuses STABLE chunk URLs with DIFFERENT content across
//    edits, so cache-first pinned stale JavaScript in visitors' browsers —
//    after every deploy the app hydrated against old chunks (hydration
//    mismatches, broken modules, blank players) and never recovered.
//    Network-first keeps deployments fresh and still serves the cache offline.
//  - API traffic is never cached (auth + live data).
// v3: purge strategy fix — every existing client drops its old cache on
// activate and refetches current chunks (recovers poisoned v1/v2 states).
const CACHE = 'cinedeck-v3';
const SHELL = '/';
const PRECACHE = [
  '/',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API

  // Icons never change → cache-first.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Framework/static chunks → network-first, cache fallback (see header note).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Navigations → network-first, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    );
  }
});

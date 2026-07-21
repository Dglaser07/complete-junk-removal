// =====================================================================
// Complete Junk Removal — Service Worker
// ---------------------------------------------------------------------
// IMPORTANT: bump APP_VERSION here AND in index.html (window.APP_VERSION)
// every time you deploy a change. That is what makes updates roll out
// safely — a new version string produces a new cache name, old caches
// get cleaned up, and users get prompted to refresh into the new one.
//
// This service worker ONLY caches static app-shell files (HTML, CSS/JS
// that's inline in index.html, the manifest, and icons). It never
// touches IndexedDB (where all customer/job/photo data lives), never
// intercepts file downloads/exports, and never intercepts the backup
// import file picker — those all happen through browser APIs the
// service worker doesn't sit in front of.
// =====================================================================

const APP_VERSION = '1.1.0';
const CACHE_NAME = `jrcc-cache-${APP_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll would fail entirely if ONE file 404s (e.g. Google Fonts
      // blocked by network policy on some devices) - so cache what we
      // can, individually, and never let a single failure block install.
      await Promise.all(
        APP_SHELL_FILES.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.ok) await cache.put(url, res);
          } catch (e) { /* ignore - offline install will just have fewer cached files */ }
        })
      );
      // Take over immediately. This is safe here because the HTML
      // itself is always served network-first when online (see the
      // fetch handler below) - the service worker's job is really just
      // the OFFLINE fallback and static-asset cache, not gatekeeping
      // which version of the code the user sees. Nothing about
      // skipWaiting touches IndexedDB or interrupts in-progress work;
      // it only affects which cache future fetches use.
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('jrcc-cache-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle simple same-origin GET requests for the app shell.
  // Everything else (POST, range requests, cross-origin, etc.) is left
  // completely alone and goes straight to the network as normal.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin (e.g. Google Fonts). Try network, don't cache,
    // don't block on failure - fonts just fall back to system fonts.
    return;
  }

  event.respondWith(
    (async () => {
      // Network-first for the HTML shell so a user online always gets
      // the latest version if available; falls back to cache when
      // offline. Cache-first for everything else (icons, manifest).
      const isHTML = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

      if (isHTML) {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch (e) {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
          throw e;
        }
      }

      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        throw e;
      }
    })()
  );
});

const CACHE_NAME = 'doujin-manager-v19';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=19',
  './js/app.js?v=19',
  './js/db.js?v=19',
  './js/ui.js?v=19',
  './js/ocr.js?v=19',
  './js/bulk.js?v=19',
  './js/library.js?v=19',
  './js/wishlist.js?v=19',
  './js/events.js?v=19',
  './js/floormap.js?v=19',
  './js/exporter.js?v=19',
  './js/gmail.js?v=19',
  './js/stats.js?v=19',
  './js/settings.js?v=19'
];

// Hosts that should never be served from cache
const BYPASS_HOSTS = [
  'googleapis.com', 'google.com', 'gstatic.com',
  'cdn.jsdelivr.net', 'tessdata.projectnaptha.com',
  'fonts.googleapis.com', 'fonts.gstatic.com'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (BYPASS_HOSTS.some((h) => url.hostname.includes(h))) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => { try { c.put(e.request, copy); } catch (_) {} });
        return res;
      }).catch(() => cached);
    })
  );
});

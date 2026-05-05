const CACHE_NAME = 'doujin-manager-v25';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=25',
  './js/app.js?v=25',
  './js/db.js?v=25',
  './js/ui.js?v=25',
  './js/ocr.js?v=25',
  './js/bulk.js?v=25',
  './js/library.js?v=25',
  './js/wishlist.js?v=25',
  './js/events.js?v=25',
  './js/floormap.js?v=25',
  './js/exporter.js?v=25',
  './js/gmail.js?v=25',
  './js/stats.js?v=25',
  './js/settings.js?v=25'
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

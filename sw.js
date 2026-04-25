const CACHE_NAME = 'doujin-manager-v6';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/ocr.js',
  './js/library.js',
  './js/events.js',
  './js/floormap.js',
  './js/gmail.js',
  './js/stats.js',
  './js/settings.js'
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

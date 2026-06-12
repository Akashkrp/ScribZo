// SCRIBZO service worker — cache the app shell, never touch socket traffic
const CACHE = 'scribzo-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/game.css',
  '/js/main.js',
  '/js/game.js',
  '/js/canvas.js',
  '/js/video.js',
  '/icons/icon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never intercept realtime / API traffic
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;
  if (e.request.method !== 'GET') return;

  // network-first, cache fallback (so updates land immediately when online)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match('/')))
  );
});

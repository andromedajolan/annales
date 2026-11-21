// Annales service worker. Keep VERSION in sync with APP_VERSION in js/main.js (and suite-app.json).
// Touches only caches named "annales-cache-*"; never another app's caches.
const VERSION = '0.5.1';
const CACHE = 'annales-cache-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/ui.js',
  'js/store.js',
  'js/db.js',
  'js/model.js',
  'js/io.js',
  'js/stilus.js',
  'js/kit.js',
  'js/checklist.js',
  'js/posts.js',
  'js/metrics.js',
  'js/chart.js',
  'js/lyrics.js',
  'js/tracking.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('annales-cache-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const SCOPE_PATH = new URL('./', self.location).pathname;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  // Launcher metadata: prefer fresh, fall back to the last copy.
  if (url.pathname.endsWith('/suite-app.json')) {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.open(CACHE).then(c => c.match(req)))
    );
    return;
  }

  // Page loads always get the app shell (routing is hash based).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(c => c.match('index.html')).then(hit => hit || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(c => c.match(req)).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});

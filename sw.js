// Service Worker: App offline verfügbar machen.
// Bei Änderungen an App-Dateien VERSION erhöhen, damit iPhones die neue Version laden.
const VERSION = 'mf-v8';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/nutrition.js',
  './js/planner.js',
  './js/prices.js',
  './js/shopping.js',
  './js/feedback.js',
  './js/settings.js',
  './js/storage.js',
  './js/timers.js',
  './js/ai.js',
  './js/sounds.js',
  './data/ingredients.json',
  './data/recipes.json',
  './data/offers.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/nav/woche.png',
  './icons/nav/einkauf.png',
  './icons/nav/rueckblick.png',
  './icons/nav/einstellungen.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den Browser-Cache, damit nie alte und neue Dateien gemischt werden
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netz zuerst (immer die aktuelle Version), bei Funkloch nach 4 s der Offline-Zwischenspeicher
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    new Promise((resolve) => {
      let done = false;
      const fromCache = () =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      const timer = setTimeout(() => {
        fromCache().then((hit) => {
          if (hit && !done) {
            done = true;
            resolve(hit);
          }
        });
      }, 4000);
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(res);
          }
        })
        .catch(() =>
          fromCache().then((hit) => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(hit || Response.error());
            }
          })
        );
    })
  );
});

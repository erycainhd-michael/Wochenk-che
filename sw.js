// Service Worker: App offline verfügbar machen + Push-Nachrichten anzeigen.
// Bei Änderungen an App-Dateien VERSION erhöhen, damit iPhones die neue Version laden.
const VERSION = 'mf-v5';
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
  './js/push.js',
  './js/ai.js',
  './data/ingredients.json',
  './data/recipes.json',
  './data/offers.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isData = new URL(req.url).pathname.includes('/data/');
  if (isData) {
    // Daten: erst Netz (aktuelle Angebote), sonst Cache
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }
  // App-Dateien: Cache zuerst, im Hintergrund aktualisieren
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dein Wochenplan ist da 🍽️', {
      body: data.body || 'Öffne Mise – der Plan für diese Woche wird jetzt erstellt.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: data.url || './#/woche' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.navigate?.(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

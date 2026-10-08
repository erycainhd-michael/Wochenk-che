// Service Worker: App offline verfügbar machen.
// Bei Änderungen an App-Dateien VERSION erhöhen, damit iPhones die neue Version laden.
const VERSION = 'mf-v34';
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
  './js/sport.js',
  './js/navicons.js',
  './js/backup.js',
  './js/haptics.js',
  './js/tools.js',
  './js/foodlookup.js',
  './data/foods.json',
  './data/ingredients.json',
  './data/recipes.json',
  './data/offers.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/splash/lunchbox.webp',
  './icons/splash/onions.webp',
  './icons/splash/beans.webp',
  './icons/splash/garlic.webp',
  './icons/splash/soy.webp',
  './icons/splash/lemon.webp',
  './icons/splash/herbs.webp',
  './icons/splash/pepper.webp',
  './icons/splash/salt.webp',
  './icons/splash/broth.webp',
  './icons/splash/wedge.webp',
  './icons/splash/clove1.webp',
  './icons/splash/clove2.webp',
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
      // nur eigene alte Versionen löschen (die klassische Version unter /klassisch/ hat eigene Caches)
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mf-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Offline zuerst: Antwort sofort aus dem Zwischenspeicher (auch im Supermarkt ohne Netz),
// im Hintergrund wird die Datei aktualisiert – neue Rezepte/Angebote sind beim nächsten Öffnen da.
// Nur wenn noch nichts gespeichert ist, wird auf das Netz gewartet.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      const update = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      if (hit) {
        event.waitUntil(update);
        return hit;
      }
      return (await update) || Response.error();
    })
  );
});

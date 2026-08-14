// Lebensspuren – Service Worker
// Cached die App-Shell, damit die App auch offline startet.
// Keine Push-Benachrichtigungen (ausdrücklich nicht gewünscht).

const VERSION = 'lebensspuren-v19';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './questions.js',
  './firebase.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Fremde Hosts (z. B. Firebase/gstatic) nicht anfassen – direkt ins Netz.
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: App-Shell aus dem Cache, Netz als Reserve.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request))
    );
    return;
  }

  // Übrige eigene Dateien: erst Cache, dann Netz (und Antwort nachcachen).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

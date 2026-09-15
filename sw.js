const CACHE_NAME = 'offline-v1';
// Add the exact name of your HTML file here
const ASSETS = [
  'index.html',
  'manifest.json',
  'icon-192.png'
];

// Install stage: Save files to local device storage
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Fetch stage: Serve files from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

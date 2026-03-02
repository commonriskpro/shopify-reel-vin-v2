// Service Worker for caching Reels API responses
const CACHE_NAME = 'reels-cache-v1';
const API_CACHE_NAME = 'reels-api-cache-v1';

// URLs to cache
const urlsToCache = [
  '/assets/shoppable-reels.css',
  '/assets/shoppable-reels.js',
  '/assets/section-image-banner.css'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Check if this is a reels API request
  const isReelsApiRequest = url.pathname.includes('/api/reels') || 
                           url.searchParams.has('homepage');
  
  if (isReelsApiRequest) {
    // Cache API responses with network-first strategy
    event.respondWith(
      caches.open(API_CACHE_NAME).then(cache => {
        return fetch(event.request)
          .then(response => {
            // Cache the response
            if (response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => {
            // If network fails, try to serve from cache
            return cache.match(event.request);
          });
      })
    );
  } else if (urlsToCache.some(cacheUrl => event.request.url.includes(cacheUrl))) {
    // Cache-first strategy for static assets
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
  // For other requests, use network (no caching)
});

// Background sync for reels data
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reels') {
    event.waitUntil(syncReelsData());
  }
});

async function syncReelsData() {
  // This would be called when the device comes back online
  // to refresh reels data in the background
  const cache = await caches.open(API_CACHE_NAME);
  const requests = await cache.keys();
  
  for (const request of requests) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response);
      }
    } catch (error) {
      console.log('Background sync failed for:', request.url);
    }
  }
}
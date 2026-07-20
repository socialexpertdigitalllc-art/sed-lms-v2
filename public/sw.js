/*
 * Service worker for the /verify mini-app.
 *
 * It exists for ONE reason: Chrome will not offer "Install" for a PWA unless the
 * registered service worker has a `fetch` handler. That is the whole job.
 *
 * IT MUST NEVER CACHE ANYTHING. This app sits behind an authenticated session
 * and its responses (verification results, lead data, any dashboard route that
 * happens to fall inside the scope) are per-user. A Cache Storage entry outlives
 * sign-out and is shared by every profile on the device, so caching here would
 * leak one user's data to the next person who opens the window. The handler is a
 * pure passthrough — same request, straight to the network, nothing stored.
 */

self.addEventListener("install", () => {
  // Take over immediately; there is no old cache to drain because we never write one.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Network passthrough. No caches.open(), no cache.put(), no cache.match().
  event.respondWith(fetch(event.request));
});

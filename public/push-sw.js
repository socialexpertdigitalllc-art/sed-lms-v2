/*
 * SED LMS push service worker — desktop and phone notifications.
 *
 * It does exactly three things: show a notification when the server pushes
 * one, open the right page when it is clicked, and re-register if the browser
 * rotates the subscription. There is NO fetch handler, so it never sees or
 * caches a single page or API response (this app is per-user and
 * authenticated — see public/sw.js for why caching would leak data).
 *
 * Payload (lib/push/payload.ts): { id, title, body, url, tag, urgent, ts }.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SED LMS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      // A replaced notification (same tag) still makes a sound / buzz.
      renotify: Boolean(data.tag),
      // Urgent ones stay on screen until the person deals with them.
      requireInteraction: Boolean(data.urgent),
      timestamp: typeof data.ts === "number" ? data.ts : Date.now(),
      data: { url: typeof data.url === "string" ? data.url : "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/notifications";
  const target = new URL(raw, self.location.origin);
  // Only ever open pages of this site.
  const url = target.origin === self.location.origin ? target.href : new URL("/notifications", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open LMS tab rather than piling up new ones.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(url);
            return;
          }
        } catch {
          /* fall through to a new window */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Browsers occasionally replace a subscription (key rotation, expiry). Re-subscribe
// with the same server key and tell the LMS, so pushes keep arriving.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
    })().catch(() => {}),
  );
});

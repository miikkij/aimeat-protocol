/**
 * @file public/sw.js
 * @description AIMEAT push-notification service worker. Displays incoming Web Push messages and
 *   routes clicks to the right SPA view, preferring an already-open window on the same path.
 *
 * @structure
 *   - install/activate: skipWaiting + clients.claim so click-routing fixes take effect immediately
 *   - push: parses the JSON payload into a notification (title/body/icon/badge/tag/data.url)
 *   - notificationclick: focuses a matching same-path window (postMessage 'aimeat-notification-click')
 *     for in-place tab switching, else opens a new window that cold-loads via ?tab= / #hash
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

// Take over immediately so click-routing fixes apply without waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || 'AIMEAT';
    const options = {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/badge-96.png',
      tag: data.tag || 'aimeat-notification',
      data: data.data || data,
    };
    if (data.url) options.data.url = data.url;
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    const text = event.data.text();
    event.waitUntil(self.registration.showNotification('AIMEAT', { body: text }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/v1/profile';
  const target = new URL(url, self.location.origin);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        let clientUrl;
        try { clientUrl = new URL(client.url); } catch { continue; }
        if (clientUrl.origin !== target.origin || clientUrl.pathname !== target.pathname) continue;
        client.postMessage({ type: 'aimeat-notification-click', url: target.pathname + target.search + target.hash });
        return 'focus' in client ? client.focus() : undefined;
      }
      return clients.openWindow(target.href);
    })
  );
});

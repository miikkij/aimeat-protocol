/**
 * @file public/sw.js
 * @description AIMEAT push-notification service worker. Displays incoming Web Push messages and
 *   routes clicks to the right SPA view, preferring an already-open window on the same path.
 *
 * @structure
 *   - install/activate: skipWaiting + clients.claim so click-routing fixes take effect immediately
 *   - push: parses the JSON payload into a notification (title/body/icon/badge/tag/data.url), and
 *     renders up to two OS-level action buttons from payload.actions ([{action,title}])
 *   - notificationclick: focuses a matching same-path window (postMessage 'aimeat-notification-click')
 *     for in-place tab switching, else opens a new window that cold-loads via ?tab= / #hash. When an
 *     action button was clicked, it also posts 'aimeat-notification-action' with the action id so the
 *     focused SPA can run it with the owner's session (a lock screen can't hold the JWT).
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-18 — Render notification action buttons + route action clicks to the SPA.
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
    // OS-level action buttons (most platforms show ≤2). The full action descriptors ride along in
    // options.data.actions so a click can be routed back to the SPA to execute with the owner's JWT.
    if (Array.isArray(data.actions) && data.actions.length) {
      options.actions = data.actions.slice(0, 2).map((a) => ({ action: a.action, title: a.title }));
    }
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    const text = event.data.text();
    event.waitUntil(self.registration.showNotification('AIMEAT', { body: text }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Which action button (if any) was pressed → its full descriptor from the payload.
  const descriptor = event.action && Array.isArray(data.actions)
    ? data.actions.find((a) => a.id === event.action) : null;
  const url = data.url || '/v1/profile';
  const target = new URL(url, self.location.origin);
  const actionMsg = descriptor
    ? { type: 'aimeat-notification-action', action: descriptor, notifId: data.notifId, url: target.pathname + target.search + target.hash }
    : null;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        let clientUrl;
        try { clientUrl = new URL(client.url); } catch { continue; }
        if (clientUrl.origin !== target.origin || clientUrl.pathname !== target.pathname) continue;
        // A focused SPA runs the action with the owner's session; a plain click just switches view.
        client.postMessage(actionMsg || { type: 'aimeat-notification-click', url: target.pathname + target.search + target.hash });
        return 'focus' in client ? client.focus() : undefined;
      }
      // No matching window: cold-open the deep link. (Inline action execution needs the SPA loaded;
      // the owner lands on the target view and can complete it there.)
      return clients.openWindow(target.href);
    })
  );
});

/* AIMEAT Push Notification Service Worker
 *
 * Click routing: a notification payload carries `url` (or `data.url`) — a same-origin path such
 * as '/v1/profile?tab=messages#inbox/<conversationId>' or '/v1/apps/<owner>/<file>?mode=inline'.
 * On click we prefer an already-open window on the SAME path (focus + postMessage so the SPA can
 * switch tabs in place — see the 'aimeat-notification-click' listener in spa.html); otherwise a
 * new window opens the URL, and the SPA's cold-load deep-linking (?tab= / #hash) lands the view.
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

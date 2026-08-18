/**
 * @file public/sw.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT push-notification service worker. Displays incoming Web Push messages and
 *   routes clicks to the right SPA view, preferring an already-open window on the same path.
 *
 * @structure
 *   - install/activate: skipWaiting + clients.claim so click-routing fixes take effect immediately;
 *     install pre-caches the offline page, activate drops every cache but the current one
 *   - fetch: TWO narrow jobs and nothing else — a share-sheet POST (/share-target) is stored in the
 *     intake queue and redirected into the chat, and a failed NAVIGATION falls back to the offline
 *     page. No API response, no asset and no document is ever cached here: freshness is worth more
 *     on this node than pretend-offline, which is why the Phase 3.1 caching worker was removed.
 *   - push: parses the JSON payload into a notification (title/body/icon/badge/tag/data.url), and
 *     renders up to two OS-level action buttons from payload.actions ([{action,title}]); sets the
 *     app-icon badge dot where the Badging API exists (the SPA later sets the exact count)
 *   - notificationclick: focuses a matching same-path window (postMessage 'aimeat-notification-click')
 *     for in-place tab switching, else opens a new window that cold-loads via ?tab= / #hash. When an
 *     action button was clicked, it also posts 'aimeat-notification-action' with the action id so the
 *     focused SPA can run it with the owner's session (a lock screen can't hold the JWT).
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-18 — Render notification action buttons + route action clicks to the SPA.
 *   v1.2.0 — 2026-08-16 — Classic-worker compatible again: every register('/sw.js') call runs this
 *     as a CLASSIC worker, where a static `import` is a syntax error, so the import of
 *     /js/swallowed.js added on 2026-07-26 made registration reject on every browser. A local
 *     recorder keeps the suppressed-failure ring readable (self.AIMEAT_SWALLOWED() in the worker
 *     console) without the module dependency.
 *   v1.3.0 — 2026-08-16 — Installed-app duties: share-target intake, offline-page fallback for
 *     navigations, push badge dot. BUMP OFFLINE_CACHE when /offline.html changes — the page is
 *     re-cached only when this file's bytes change and trigger a worker update.
 */

// Local stand-in for /js/swallowed.js: this file must stay importable as a CLASSIC worker
// (see v1.2.0 above), so it cannot use ESM. Same contract — record quietly, readable on demand.
const SWALLOWED_MAX = 200;
const swallowedRing = [];
function swallowed(where, err) {
  swallowedRing.push({
    at: new Date().toISOString(),
    where,
    error: err instanceof Error ? (err.message || err.name) : String(err),
  });
  if (swallowedRing.length > SWALLOWED_MAX) swallowedRing.shift();
}
self.AIMEAT_SWALLOWED = () => swallowedRing.slice();

// The one thing cached on this node: the page shown when a NAVIGATION fails offline.
// Everything else stays live — see the file comment.
const OFFLINE_CACHE = 'aimeat-offline-v1';
const OFFLINE_URL = '/offline.html';
// The page and its script — the node CSP refuses inline script, so the page cannot be one file.
const OFFLINE_ASSETS = [OFFLINE_URL, '/offline.js'];

// The intake queue's writer half. The contract (db/store/item shape) is documented once, in
// /js/intake.js; this copy exists because a classic worker cannot import an ES module.
function intakeAdd(item) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('aimeat-intake', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('items')) {
        open.result.createObjectStore('items', { autoIncrement: true });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('items', 'readwrite');
      tx.objectStore('items').add(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
  });
}

// Take over immediately so click-routing fixes apply without waiting for every tab to close.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      // cache:'reload' bypasses the HTTP cache so the copies stored are what the server has now.
      .then((cache) => cache.addAll(OFFLINE_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .catch((err) => swallowed('sw: offline pre-cache', err))
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    // Drop every cache but the current one — including the Phase 3.1 worker's shell/API caches
    // still sitting in browsers that ran it, holding stale API responses.
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)),
    )),
  ]));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // The OS share sheet posts here (manifest.json share_target). The POST carries no JWT — a share
  // is a browser form submission — so nothing is sent to the node: the payload goes into the
  // intake queue and the person lands in the chat, which drains the queue into the composer
  // under their own session and lets them decide what to send.
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const files = [];
        for (const f of form.getAll('files')) {
          if (f && typeof f === 'object' && 'arrayBuffer' in f) {
            files.push({ name: f.name || 'shared', type: f.type || 'application/octet-stream', blob: f });
          }
        }
        await intakeAdd({
          at: new Date().toISOString(),
          source: 'share',
          title: String(form.get('title') || ''),
          text: String(form.get('text') || ''),
          url: String(form.get('url') || ''),
          files,
        });
      } catch (err) {
        // The share is lost but the person is standing in the chat, where its absence is visible;
        // failing the POST instead would strand them on a browser error page with nothing to do.
        swallowed('sw: share-target', err);
      }
      return Response.redirect('/v1/chat', 303);
    })());
    return;
  }

  // The offline page's own two files: network first (a deploy's fresh copy wins), cache when the
  // network is gone. Without this branch the fallback page would render and its script would not.
  if (OFFLINE_ASSETS.includes(url.pathname) && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(async () =>
        (await caches.match(url.pathname))
        || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
    return;
  }

  // Navigations only. When the network is gone the person gets the offline page — which says this
  // is an online application and holds the note box that feeds the same intake queue — instead of
  // the browser's error screen. Every non-navigation request passes through untouched.
  if (event.request.mode === 'navigate' && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(async () =>
        (await caches.match(OFFLINE_URL))
        || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
  }
});

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
    // The dot on the installed app's icon: the quiet end of the same chain as the notification.
    // The SPA replaces it with the exact unread count the next time it loads the bell.
    if ('setAppBadge' in self.navigator) {
      event.waitUntil(self.navigator.setAppBadge().catch((err) => swallowed('sw: badge', err)));
    }
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    swallowed('sw', err);
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
        try { clientUrl = new URL(client.url); } catch { continue; }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
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

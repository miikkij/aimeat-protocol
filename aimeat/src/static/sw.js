// AIMEAT Service Worker — Phase 3.1 PWA
// Cache-first for static, network-first for API, stale-while-revalidate for portal

const SHELL_CACHE = 'aimeat-shell-v1';
const API_CACHE = 'aimeat-api-v1';
const OUTBOX_STORE = 'aimeat-outbox';

const SHELL_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  const KEEP = [SHELL_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategies ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin and non-GET for caching
  if (url.origin !== self.location.origin) return;

  // Background sync for offline mutations (POST/PUT/DELETE)
  if (['POST', 'PUT', 'DELETE'].includes(event.request.method)) {
    event.respondWith(
      fetch(event.request.clone()).catch(() => {
        // Queue for background sync
        return saveToOutbox(event.request.clone()).then(
          () => new Response(JSON.stringify({ queued: true, message: 'Request queued for sync' }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      })
    );
    return;
  }

  // Cache-first: static assets (icons, manifest, etc.)
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/offline.html' ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Network-first: API calls (/v1/ except portal)
  if (url.pathname.startsWith('/v1/') && !url.pathname.startsWith('/v1/portal')) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  // Stale-while-revalidate: portal HTML
  if (url.pathname.startsWith('/v1/portal')) {
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE));
    return;
  }

  // Default: network with offline fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match('/offline.html'))
  );
});

// ── Push event: show notification ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'AIMEAT', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-96.png',
    tag: payload.tag || 'aimeat-notification',
    data: {
      url: payload.url || '/v1/profile',
      ...payload.data,
    },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'AIMEAT', options)
  );
});

// ── Notification click: focus a matching open window (and let the SPA deep-link in place via
// the 'aimeat-notification-click' message — see spa.html), else open a new one ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/v1/profile';
  const target = new URL(targetUrl, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        let clientUrl;
        try { clientUrl = new URL(client.url); } catch { continue; }
        if (clientUrl.origin !== target.origin || clientUrl.pathname !== target.pathname) continue;
        client.postMessage({ type: 'aimeat-notification-click', url: target.pathname + target.search + target.hash });
        return 'focus' in client ? client.focus() : undefined;
      }
      return self.clients.openWindow(target.href);
    })
  );
});

// ── Background Sync ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'aimeat-outbox') {
    event.waitUntil(replayOutbox());
  }
});

// ── Cache strategies ──

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match('/offline.html');
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

// ── Outbox helpers (IndexedDB) ──

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_STORE, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('requests', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToOutbox(request) {
  try {
    const body = await request.text();
    const db = await openOutboxDB();
    const tx = db.transaction('requests', 'readwrite');
    tx.objectStore('requests').add({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    // Register for background sync
    if (self.registration.sync) {
      await self.registration.sync.register('aimeat-outbox');
    }
  } catch (err) {
    console.warn('[SW] Failed to save to outbox', err);
  }
}

async function replayOutbox() {
  try {
    const db = await openOutboxDB();
    const tx = db.transaction('requests', 'readwrite');
    const store = tx.objectStore('requests');

    const allRequests = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const saved of allRequests) {
      try {
        await fetch(saved.url, {
          method: saved.method,
          headers: saved.headers,
          body: saved.method !== 'GET' ? saved.body : undefined,
        });
      } catch {
        // If still offline, sync will be retried later
        return;
      }
    }

    // Clear outbox after successful replay
    const clearTx = db.transaction('requests', 'readwrite');
    clearTx.objectStore('requests').clear();
  } catch (err) {
    console.warn('[SW] Failed to replay outbox', err);
  }
}

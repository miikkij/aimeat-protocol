/**
 * @file src/static/app-sw.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The service worker a PUBLISHED APP runs on its own origin, served as /sw.js there.
 *   An installed app is its own origin, so a notification that arrives here wears the app's name and
 *   icon rather than the node's, which on iOS is the only way it ever does.
 *
 *   IT IS NOT public/sw.js, AND MUST NOT BECOME IT. The apex worker carries the SPA's share-target
 *   intake, the offline page and cache management. None of those belong to an app: an app has no
 *   share target, no offline page of ours and no cache we own. This worker shows a notification and
 *   routes a click, and the absence of a fetch handler is the feature — every request an app makes
 *   goes to the network untouched, so nothing this file does can ever serve an app stale bytes.
 *
 *   IT IS A CLASSIC WORKER. Every register('/sw.js') call in the aimeat-push library runs this as a
 *   classic script, where a static import is a SYNTAX ERROR and registration rejects before the
 *   first line runs. public/sw.js v1.2.0 records the day that happened on every browser at once.
 *   No import, no export, no module syntax, ever.
 * @structure
 *   - install/activate: skipWaiting + clients.claim, so a fix to this file takes effect without the
 *     person closing the installed app. No pre-cache: there is nothing here to cache.
 *   - push: the JSON payload becomes a notification (title, body, icon, badge, tag, data) with up to
 *     two OS-level action buttons from payload.actions. A payload that will not parse still shows
 *     something, because a silent push is a permission the browser takes away.
 *   - notificationclick: close, then focus an already-open window on THIS origin and postMessage it
 *     (naming the action id when an action button was pressed), else open data.url or '/'.
 * @usage Served at /sw.js on a published app's own origin. The browser side that registers it is
 *   /v1/libs/aimeat-push.js; the app calls AIMEAT.push.enable(session).
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial: push and notificationclick for an app origin, and nothing else.
 */

/* The app's own face, served by subdomain-origin-docs.ts from the app manifest's emoji. A sender
 * that knows better passes its own icon in the payload; this is what an app with nothing set gets. */
const DEFAULT_ICON = '/icon.svg';
const DEFAULT_TAG = 'aimeat-app-notification';
/* What the page hears when the person comes back through a notification. One type, two shapes: the
 * action id is a string when a button was pressed and null when the body was tapped. */
const CLICK_MESSAGE = 'aimeat-app-notification-click';

self.addEventListener('install', () => {
  // Take over immediately. An installed app is opened and left open for days, so waiting for every
  // window to close means a fix to this file lands next month.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * The payload as an object. A push that will not parse is still a push the browser expects a
 * notification for: Chrome and Firefox both revoke the permission after a few silent ones, so the
 * text of the body, or a bare title, is the answer rather than a return.
 */
function readPayload(data) {
  if (!data) return {};
  try {
    const parsed = data.json();
    return parsed && typeof parsed === 'object' ? parsed : { body: String(parsed) };
  } catch (err) {
    try {
      return { body: data.text() };
    } catch (innerErr) {
      return {};
    }
  }
}

/** The notification options one payload asks for. Only same-origin image paths are ever used. */
function optionsFrom(payload) {
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: typeof payload.icon === 'string' && payload.icon ? payload.icon : DEFAULT_ICON,
    badge: typeof payload.badge === 'string' && payload.badge ? payload.badge : DEFAULT_ICON,
    tag: typeof payload.tag === 'string' && payload.tag ? payload.tag : DEFAULT_TAG,
    data: payload.data && typeof payload.data === 'object' ? payload.data : {},
  };
  // A url at the top level is the common shape and rides into data, where the click handler reads it.
  if (typeof payload.url === 'string' && payload.url) options.data.url = payload.url;
  // OS-level buttons. Most platforms show two and silently drop the rest, so two is what is sent.
  if (Array.isArray(payload.actions) && payload.actions.length) {
    const buttons = [];
    for (const a of payload.actions.slice(0, 2)) {
      if (!a || typeof a.action !== 'string' || typeof a.title !== 'string') continue;
      buttons.push({ action: a.action, title: a.title });
    }
    if (buttons.length) options.actions = buttons;
  }
  return options;
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event.data);
  const title = typeof payload.title === 'string' && payload.title ? payload.title : self.location.host;
  event.waitUntil(self.registration.showNotification(title, optionsFrom(payload)));
});

/**
 * Where a click goes. The payload names a PATH on this origin; anything that resolves elsewhere is
 * refused down to '/', because a notification must not be a door out of the app it came from.
 */
function targetUrl(raw) {
  if (typeof raw !== 'string' || !raw) return self.location.origin + '/';
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch (err) {
    return self.location.origin + '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data && typeof event.notification.data === 'object'
    ? event.notification.data : {};
  // '' when the body was tapped rather than a button; null reads better in the message.
  const action = event.action || null;
  const href = targetUrl(data.url);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      let origin;
      try {
        origin = new URL(client.url).origin;
      } catch (err) {
        continue;   // A client whose URL will not parse is not one we can hand this to.
      }
      if (origin !== self.location.origin) continue;
      // The open page acts, not the worker: the action may need the owner's session, and a lock
      // screen cannot hold a JWT. The page decides what the action id means.
      client.postMessage({ type: CLICK_MESSAGE, action: action, url: href, data: data });
      if ('focus' in client) return client.focus();
      return undefined;
    }
    return self.clients.openWindow(href);
  })());
});

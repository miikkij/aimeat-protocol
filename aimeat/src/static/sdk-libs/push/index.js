/**
 * @file push/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.push: an installed app asks to receive notifications on ITS OWN origin, under
 *   its own name and icon. Served as /v1/libs/aimeat-push.js.
 *
 *   THE APP MUST HOLD push:receive. Declare it with the rest of the app's scopes —
 *   <meta name="aimeat-scopes" content="memory:read memory:write push:receive"> — and the owner
 *   approves it when they approve the app. Without the word the node answers 403 and every call
 *   here comes back with ok:false and a reason saying exactly that. The word opens two doors and
 *   no others: register this device, and take this device back. Listing every device the person
 *   has, or switching their notifications off everywhere, stays behind push:manage, where an app
 *   has no business.
 *
 *   NOTHING HERE THROWS. A refusal is a VALUE the app renders: permission denied, no push support
 *   in this browser, the node has push switched off, the app was not granted the word. Every
 *   answer carries ok, and a refused one carries reason (a sentence for a person) and code (a
 *   string for your own branching). There is no bare false anywhere in this file, because a bare
 *   false is the answer that makes an app tell someone "that did not work" and stop.
 *
 *   THE SESSION ANSWERS WITH AN ENVELOPE, NOT A RESPONSE. session.fetch resolves to the PARSED
 *   envelope, so res.ok is the node's own ok flag and there is no .json() to call on it. Calling
 *   one throws "res.json is not a function" from inside the library, which reads as a library bug
 *   and is not one.
 * @structure
 *   - enable(session)  — register /sw.js at scope '/', ask permission, read the VAPID key,
 *     subscribe, and hand the subscription to POST /v1/push/subscribe
 *   - disable(session) — DELETE /v1/push/subscribe naming this browser's endpoint, then unsubscribe
 *   - state(session)   — is THIS browser subscribed, read locally: no prompt, no registration
 *   - urlBase64ToUint8Array — the base64url VAPID key as the applicationServerKey bytes
 *   - unsupported / unusable / nodeRefusal / refuse — the four ways an answer comes back refused
 * @usage
 *   <meta name="aimeat-scopes" content="memory:read memory:write push:receive">
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-push.js"></script>
 *   const session = AIMEAT.auth.getSession();
 *   const on = await AIMEAT.push.enable(session);
 *   if (!on.ok) showNotice(on.reason);
 *   const now = await AIMEAT.push.state(session);   // { ok: true, enabled: true, ... }
 *   await AIMEAT.push.disable(session);
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial: the browser half of push on a published app's own origin.
 */
import { attach } from '../_core/namespace.js';

/** The worker this library registers. The node serves it on the app origin; see src/static/app-sw.js. */
const SW_PATH = '/sw.js';
/** One registration per app origin, at the root, so a notification click can reach any page. */
const SW_SCOPE = '/';
/** The app-grant word this whole library needs. Named in every refusal that comes back 403. */
const GRANT_SCOPE = 'push:receive';

/**
 * One refused answer.
 * @param {string} code    A stable string to branch on.
 * @param {string} reason  A sentence to show a person.
 * @returns {{ok: false, code: string, reason: string}}
 */
function refuse(code, reason) {
  return { ok: false, code: code, reason: reason };
}

/** The readable half of whatever the browser threw. */
function say(err) {
  if (!err) return 'no reason given';
  return err.message || err.name || String(err);
}

/**
 * Whether this browser can do any of it at all, as a refusal or null.
 *
 * Checked before anything else in all three calls: an iOS Safari tab that has not been added to the
 * home screen has no PushManager, and telling someone "notifications are off" when the browser
 * cannot have them is the wrong sentence.
 * @returns {{ok: false, code: string, reason: string}|null}
 */
function unsupported() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return refuse('NO_PUSH_SUPPORT', 'This browser cannot receive notifications: it has no service workers.');
  }
  if (typeof window === 'undefined' || !('PushManager' in window)) {
    return refuse('NO_PUSH_SUPPORT', 'This browser cannot receive notifications. On an iPhone, add this app to the home screen first and open it from there.');
  }
  if (typeof Notification === 'undefined') {
    return refuse('NO_PUSH_SUPPORT', 'This browser cannot show notifications.');
  }
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    return refuse('INSECURE_CONTEXT', 'Notifications need a secure connection. Open this app over https.');
  }
  return null;
}

/** A session that can talk to the node, as a refusal or null. */
function unusable(session) {
  if (!session || typeof session.fetch !== 'function') {
    return refuse('NO_SESSION', 'Sign in before turning notifications on. AIMEAT.auth.getSession() returned nothing.');
  }
  return null;
}

/**
 * Turn one node refusal envelope into one of ours. res.error.code is the node's own vocabulary; the
 * two that a person can act on get a sentence of their own, and everything else keeps the node's.
 * @param {any} res        The parsed envelope (ok:false), or null when nothing came back.
 * @param {string} fallback  What to say when the envelope carries no message.
 */
function nodeRefusal(res, fallback) {
  const err = res && res.error ? res.error : null;
  const code = err && err.code ? err.code : 'NODE_REFUSED';
  if (code === 'SCOPE_DENIED') {
    return refuse('NOT_GRANTED',
      'This app was not granted "' + GRANT_SCOPE + '", which is the permission to show its own notifications. '
      + 'Declare it in <meta name="aimeat-scopes"> and the owner approves it the next time they sign in.');
  }
  if (code === 'FEATURE_DISABLED') {
    return refuse('PUSH_DISABLED', 'This node has push notifications switched off. Its operator has to configure the VAPID keys.');
  }
  return refuse(code, (err && err.message) || fallback);
}

/**
 * The base64url VAPID public key as the bytes pushManager.subscribe wants. It will not take the
 * string: applicationServerKey is a BufferSource, and a base64url string handed over unconverted
 * subscribes against the wrong key, which fails silently at delivery time rather than here.
 * @param {string} base64  The node's VAPID public key, base64url.
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const plain = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(plain);
  // The buffer is allocated explicitly rather than by length: subscribe() takes a BufferSource over
  // a plain ArrayBuffer, and the length form is typed as one that may be shared.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Whether an existing subscription was made against the key the node hands out now. A node that
 * rotated its VAPID pair leaves every browser holding a subscription it can no longer send to, and
 * subscribe() refuses to replace one with a different key rather than doing it for you.
 */
function sameKey(sub, bytes) {
  const held = sub && sub.options ? sub.options.applicationServerKey : null;
  if (!held) return true;   // A browser that will not say cannot be contradicted; keep what it has.
  const mine = new Uint8Array(held);
  if (mine.length !== bytes.length) return false;
  for (let i = 0; i < mine.length; i++) if (mine[i] !== bytes[i]) return false;
  return true;
}

/** Drop a local subscription we created but could not register. Failure here changes nothing. */
async function rollBack(sub) {
  try {
    await sub.unsubscribe();
  } catch {
    // The browser kept a subscription the node never accepted. It receives nothing, because the
    // node has no row for it, so there is nothing to report and nothing to retry.
  }
}

/**
 * This browser's push subscription for this origin, or null. It never throws and it registers
 * nothing: a browser that refuses to answer holds nothing we can use, which is the same position as
 * a browser with no subscription, and all three calls treat them alike.
 * @param {ServiceWorkerRegistration} [known]  A registration already in hand (enable has one).
 * @returns {Promise<PushSubscription|null>}
 */
async function currentSubscription(known) {
  let registration = known || null;
  if (!registration) {
    try {
      registration = (await navigator.serviceWorker.getRegistration(SW_SCOPE)) || null;
    } catch {
      return null;
    }
  }
  if (!registration) return null;
  try {
    return (await registration.pushManager.getSubscription()) || null;
  } catch {
    return null;
  }
}

/** Ask for the permission, once, and answer with whatever the browser settled on. */
async function askPermission() {
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const asked = await Notification.requestPermission();
    return asked || Notification.permission;
  } catch {
    return Notification.permission;   // A prompt refused outright is the same answer as a dismissal.
  }
}

/**
 * Turn notifications on for THIS browser, for THIS app.
 *
 * The order is the order a person experiences: the worker goes on first (it is silent), then the
 * browser asks them, then the node is asked for its key, then the device is registered. Each step
 * answers with a refusal rather than an exception, so one call site can render every outcome.
 *
 * @param {{fetch: (path: string, opts?: RequestInit) => Promise<any>}} session  The app's session.
 * @returns {Promise<{ok: true, enabled: true, endpoint: string, app: string|null}
 *   |{ok: false, code: string, reason: string}>}
 */
async function enable(session) {
  const blocked = unsupported();
  if (blocked) return blocked;
  const sessionless = unusable(session);
  if (sessionless) return sessionless;

  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
  } catch (err) {
    return refuse('WORKER_FAILED',
      'This app could not start its notification worker. Its node must serve /sw.js on this origin: ' + say(err));
  }
  // subscribe() needs an ACTIVE worker, and register() resolves while it is still installing. `ready`
  // is the registration whose worker has activated for this scope, which is the one we just made.
  const registration = await navigator.serviceWorker.ready;

  const permission = await askPermission();
  if (permission !== 'granted') {
    return permission === 'denied'
      ? refuse('PERMISSION_DENIED', 'Notifications are blocked for this app. Allow them in the browser site settings, then try again.')
      : refuse('PERMISSION_DISMISSED', 'The notification permission was not given. Ask again when the person is ready.');
  }

  // The node's VAPID public key. Read inline rather than through a helper: a helper returning
  // "the key or a refusal" is a union this file's non-strict type-check cannot narrow, and widening
  // it to any would take the checking off the part that matters.
  let keyRes;
  try {
    keyRes = await session.fetch('/v1/push/vapid-key');
  } catch (err) {
    return refuse('NODE_UNREACHABLE', 'Could not reach the node to read its notification key: ' + say(err));
  }
  if (!keyRes || keyRes.ok !== true) return nodeRefusal(keyRes, 'The node would not hand out its notification key.');
  const vapidKey = keyRes.data ? keyRes.data.vapidPublicKey : null;
  if (typeof vapidKey !== 'string' || !vapidKey) {
    return refuse('PUSH_DISABLED', 'This node has push notifications switched off. Its operator has to configure the VAPID keys.');
  }
  const bytes = urlBase64ToUint8Array(vapidKey);

  let sub = await currentSubscription(registration);
  if (sub && !sameKey(sub, bytes)) {
    await rollBack(sub);   // Made against a key this node no longer sends with.
    sub = null;
  }
  let created = false;
  if (!sub) {
    try {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      created = true;
    } catch (err) {
      return refuse('SUBSCRIBE_FAILED', 'The browser would not register this device for notifications: ' + say(err));
    }
  }

  const shape = sub.toJSON();
  const keys = shape && shape.keys ? shape.keys : {};
  if (!keys.p256dh || !keys.auth) {
    if (created) await rollBack(sub);
    return refuse('SUBSCRIBE_FAILED', 'The browser gave a subscription with no encryption keys, so the node cannot send to it.');
  }

  let res;
  try {
    res = await session.fetch('/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }),
    });
  } catch (err) {
    if (created) await rollBack(sub);
    return refuse('NODE_UNREACHABLE', 'Could not reach the node to register this device: ' + say(err));
  }
  if (!res || res.ok !== true) {
    // A subscription the node refused is one nothing will ever send to, so it does not stay behind
    // pretending to be on. One this browser already had is left alone: it was not ours to remove.
    if (created) await rollBack(sub);
    return nodeRefusal(res, 'The node would not register this device for notifications.');
  }

  const registered = res.data ? res.data.subscription : null;
  return { ok: true, enabled: true, endpoint: sub.endpoint, app: registered ? (registered.app || null) : null };
}

/**
 * Turn notifications off for THIS browser, for THIS app. It names its own endpoint, so it takes back
 * the one device and never the person's others.
 *
 * Idempotent: a browser that was not subscribed answers ok with enabled false. The node is asked
 * first and the local subscription goes second, so a refusal leaves something to retry; a node that
 * has already forgotten the device (NOT_FOUND) is not a refusal, it is agreement.
 *
 * @param {{fetch: (path: string, opts?: RequestInit) => Promise<any>}} session  The app's session.
 * @returns {Promise<{ok: true, enabled: false, endpoint: string|null}
 *   |{ok: false, code: string, reason: string}>}
 */
async function disable(session) {
  const blocked = unsupported();
  if (blocked) return blocked;
  const sessionless = unusable(session);
  if (sessionless) return sessionless;

  const sub = await currentSubscription();
  if (!sub) return { ok: true, enabled: false, endpoint: null };

  let res;
  try {
    res = await session.fetch('/v1/push/subscribe?endpoint=' + encodeURIComponent(sub.endpoint), { method: 'DELETE' });
  } catch (err) {
    return refuse('NODE_UNREACHABLE', 'Could not reach the node to remove this device: ' + say(err));
  }
  const code = res && res.error ? res.error.code : null;
  if (!(res && res.ok === true) && code !== 'NOT_FOUND') {
    return nodeRefusal(res, 'The node would not remove this device.');
  }

  try {
    await sub.unsubscribe();
  } catch (err) {
    return refuse('UNSUBSCRIBE_FAILED',
      'The node has stopped sending to this device, but the browser would not release its subscription: ' + say(err));
  }
  return { ok: true, enabled: false, endpoint: sub.endpoint };
}

/**
 * Whether THIS browser is subscribed right now.
 *
 * Reads only what the browser already holds: no permission prompt, no worker registration, no call
 * to the node. Safe to run on every page load, which is what a settings toggle needs.
 *
 * The answer is local on purpose. The node's own list of the person's devices is behind
 * push:manage, which an app does not hold and should not, so "is this browser on" is answered by
 * this browser. The session is accepted for the same call shape as the other two and is reported
 * back as signedIn; its absence is not a refusal here.
 *
 * @param {{fetch: (path: string, opts?: RequestInit) => Promise<any>}} [session]  The app's session.
 * @returns {Promise<{ok: true, enabled: boolean, endpoint: string|null, permission: string, signedIn: boolean}
 *   |{ok: false, code: string, reason: string}>}
 */
async function state(session) {
  const blocked = unsupported();
  if (blocked) return blocked;

  const sub = await currentSubscription();
  return {
    ok: true,
    enabled: !!sub,
    endpoint: sub ? sub.endpoint : null,
    permission: Notification.permission,
    signedIn: !!(session && typeof session.fetch === 'function'),
  };
}

attach('push', { enable, disable, state, urlBase64ToUint8Array });

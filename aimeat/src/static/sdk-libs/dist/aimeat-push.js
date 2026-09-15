// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/push/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-push.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/push/index.js
  var SW_PATH = "/sw.js";
  var SW_SCOPE = "/";
  var GRANT_SCOPE = "push:receive";
  function refuse(code, reason) {
    return { ok: false, code, reason };
  }
  function say(err) {
    if (!err) return "no reason given";
    return err.message || err.name || String(err);
  }
  function unsupported() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return refuse("NO_PUSH_SUPPORT", "This browser cannot receive notifications: it has no service workers.");
    }
    if (typeof window === "undefined" || !("PushManager" in window)) {
      return refuse("NO_PUSH_SUPPORT", "This browser cannot receive notifications. On an iPhone, add this app to the home screen first and open it from there.");
    }
    if (typeof Notification === "undefined") {
      return refuse("NO_PUSH_SUPPORT", "This browser cannot show notifications.");
    }
    if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
      return refuse("INSECURE_CONTEXT", "Notifications need a secure connection. Open this app over https.");
    }
    return null;
  }
  function unusable(session) {
    if (!session || typeof session.fetch !== "function") {
      return refuse("NO_SESSION", "Sign in before turning notifications on. AIMEAT.auth.getSession() returned nothing.");
    }
    return null;
  }
  function nodeRefusal(res, fallback) {
    const err = res && res.error ? res.error : null;
    const code = err && err.code ? err.code : "NODE_REFUSED";
    if (code === "SCOPE_DENIED") {
      return refuse(
        "NOT_GRANTED",
        'This app was not granted "' + GRANT_SCOPE + '", which is the permission to show its own notifications. Declare it in <meta name="aimeat-scopes"> and the owner approves it the next time they sign in.'
      );
    }
    if (code === "FEATURE_DISABLED") {
      return refuse("PUSH_DISABLED", "This node has push notifications switched off. Its operator has to configure the VAPID keys.");
    }
    return refuse(code, err && err.message || fallback);
  }
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - base64.length % 4) % 4);
    const plain = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(plain);
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function sameKey(sub, bytes) {
    const held = sub && sub.options ? sub.options.applicationServerKey : null;
    if (!held) return true;
    const mine = new Uint8Array(held);
    if (mine.length !== bytes.length) return false;
    for (let i = 0; i < mine.length; i++) if (mine[i] !== bytes[i]) return false;
    return true;
  }
  async function rollBack(sub) {
    try {
      await sub.unsubscribe();
    } catch {
    }
  }
  async function currentSubscription(known) {
    let registration = known || null;
    if (!registration) {
      try {
        registration = await navigator.serviceWorker.getRegistration(SW_SCOPE) || null;
      } catch {
        return null;
      }
    }
    if (!registration) return null;
    try {
      return await registration.pushManager.getSubscription() || null;
    } catch {
      return null;
    }
  }
  async function askPermission() {
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      const asked = await Notification.requestPermission();
      return asked || Notification.permission;
    } catch {
      return Notification.permission;
    }
  }
  async function enable(session) {
    const blocked = unsupported();
    if (blocked) return blocked;
    const sessionless = unusable(session);
    if (sessionless) return sessionless;
    try {
      await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
    } catch (err) {
      return refuse(
        "WORKER_FAILED",
        "This app could not start its notification worker. Its node must serve /sw.js on this origin: " + say(err)
      );
    }
    const registration = await navigator.serviceWorker.ready;
    const permission = await askPermission();
    if (permission !== "granted") {
      return permission === "denied" ? refuse("PERMISSION_DENIED", "Notifications are blocked for this app. Allow them in the browser site settings, then try again.") : refuse("PERMISSION_DISMISSED", "The notification permission was not given. Ask again when the person is ready.");
    }
    let keyRes;
    try {
      keyRes = await session.fetch("/v1/push/vapid-key");
    } catch (err) {
      return refuse("NODE_UNREACHABLE", "Could not reach the node to read its notification key: " + say(err));
    }
    if (!keyRes || keyRes.ok !== true) return nodeRefusal(keyRes, "The node would not hand out its notification key.");
    const vapidKey = keyRes.data ? keyRes.data.vapidPublicKey : null;
    if (typeof vapidKey !== "string" || !vapidKey) {
      return refuse("PUSH_DISABLED", "This node has push notifications switched off. Its operator has to configure the VAPID keys.");
    }
    const bytes = urlBase64ToUint8Array(vapidKey);
    let sub = await currentSubscription(registration);
    if (sub && !sameKey(sub, bytes)) {
      await rollBack(sub);
      sub = null;
    }
    let created = false;
    if (!sub) {
      try {
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        created = true;
      } catch (err) {
        return refuse("SUBSCRIBE_FAILED", "The browser would not register this device for notifications: " + say(err));
      }
    }
    const shape = sub.toJSON();
    const keys = shape && shape.keys ? shape.keys : {};
    if (!keys.p256dh || !keys.auth) {
      if (created) await rollBack(sub);
      return refuse("SUBSCRIBE_FAILED", "The browser gave a subscription with no encryption keys, so the node cannot send to it.");
    }
    let res;
    try {
      res = await session.fetch("/v1/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
      });
    } catch (err) {
      if (created) await rollBack(sub);
      return refuse("NODE_UNREACHABLE", "Could not reach the node to register this device: " + say(err));
    }
    if (!res || res.ok !== true) {
      if (created) await rollBack(sub);
      return nodeRefusal(res, "The node would not register this device for notifications.");
    }
    const registered = res.data ? res.data.subscription : null;
    return { ok: true, enabled: true, endpoint: sub.endpoint, app: registered ? registered.app || null : null };
  }
  async function disable(session) {
    const blocked = unsupported();
    if (blocked) return blocked;
    const sessionless = unusable(session);
    if (sessionless) return sessionless;
    const sub = await currentSubscription();
    if (!sub) return { ok: true, enabled: false, endpoint: null };
    let res;
    try {
      res = await session.fetch("/v1/push/subscribe?endpoint=" + encodeURIComponent(sub.endpoint), { method: "DELETE" });
    } catch (err) {
      return refuse("NODE_UNREACHABLE", "Could not reach the node to remove this device: " + say(err));
    }
    const code = res && res.error ? res.error.code : null;
    if (!(res && res.ok === true) && code !== "NOT_FOUND") {
      return nodeRefusal(res, "The node would not remove this device.");
    }
    try {
      await sub.unsubscribe();
    } catch (err) {
      return refuse(
        "UNSUBSCRIBE_FAILED",
        "The node has stopped sending to this device, but the browser would not release its subscription: " + say(err)
      );
    }
    return { ok: true, enabled: false, endpoint: sub.endpoint };
  }
  async function state(session) {
    const blocked = unsupported();
    if (blocked) return blocked;
    const sub = await currentSubscription();
    return {
      ok: true,
      enabled: !!sub,
      endpoint: sub ? sub.endpoint : null,
      permission: Notification.permission,
      signedIn: !!(session && typeof session.fetch === "function")
    };
  }
  attach("push", { enable, disable, state, urlBase64ToUint8Array });
})();

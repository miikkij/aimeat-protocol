/**
 * @file notifications.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT Notifications Service: the owner's inbox (/v1/notifications), what they
 *   decided about it (/settings), who may notify them (/senders), their push devices
 *   (/v1/push/subscriptions) and the browser side of push (subscribe, unsubscribe, test). Also
 *   the words: a notification's title and body in the reader's language when the record carries
 *   an i18n key, and the sender's name and kind.
 * @usage import * as notif from '/js/services/notifications.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

/** The inbox: { notifications, unread, total }. opts: { limit (≤200), unread }. */
export async function list(opts = {}) {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.unread) p.set('unread', '1');
  const qs = p.toString();
  const r = await apiGet(`/v1/notifications${qs ? `?${qs}` : ''}`);
  return r?.data ?? { notifications: [], unread: 0, total: 0 };
}
export const markRead = (ids) => apiPost('/v1/notifications/read', ids ? { ids } : { all: true });
export const clear = (ids) => apiDelete('/v1/notifications', ids ? { ids } : {});

/** What the owner decided. */
export async function getSettings() { const r = await apiGet('/v1/notifications/settings'); return r?.data?.settings ?? null; }
export async function putSettings(settings) { const r = await apiPut('/v1/notifications/settings', { settings }); return r?.data?.settings ?? null; }
/** Who may notify the owner: { groups, senders, settings }. */
export async function senders() { const r = await apiGet('/v1/notifications/senders'); return r?.data ?? { groups: [], senders: [], settings: null }; }

/** The owner's push devices: { subscriptions: [{ endpoint, family, created_at, last_used_at }], total }. */
export async function devices() { const r = await apiGet('/v1/push/subscriptions'); return r?.data ?? { subscriptions: [], total: 0 }; }
export const removeDevice = (endpoint) => apiDelete(`/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`);
export const testPush = () => apiPost('/v1/push/test', {});
export async function vapidKey() { const r = await apiGet('/v1/push/vapid-key'); return r?.data?.vapidPublicKey ?? null; }
export const revokeAppGrant = (grantId) => apiDelete(`/v1/app-grants/${encodeURIComponent(grantId)}`);

/** The push subscription this browser holds, if any (and re-registers it so the node keeps it). */
export async function thisBrowserSubscription({ register = true } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub && register) {
      const j = sub.toJSON();
      await apiPost('/v1/push/subscribe', { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
    }
    return sub;
  } catch (err) { swallowed('notifications: subscription', err); return null; }
}

/** Ask the browser for push and register the device. Throws with a `code` the page can word. */
export async function subscribeThisBrowser() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw Object.assign(new Error('no support'), { code: 'NO_SUPPORT' });
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') throw Object.assign(new Error('denied'), { code: 'DENIED' });
  const key = await vapidKey();
  if (!key) throw Object.assign(new Error('not configured'), { code: 'NOT_CONFIGURED' });
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const j = sub.toJSON();
  const r = await apiPost('/v1/push/subscribe', { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
  if (r?.ok === false) throw Object.assign(new Error(r.error?.message || 'subscribe failed'), { code: 'FAILED' });
  return sub;
}

export async function unsubscribeThisBrowser() {
  let endpoint = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) { endpoint = sub.endpoint; await sub.unsubscribe(); }
  } catch (err) { swallowed('notifications: unsubscribe', err); }
  return endpoint ? removeDevice(endpoint) : apiDelete('/v1/push/subscribe');
}

/* ── The words ─────────────────────────────────────────────────────────────────────────────── */
const said = (key, vars) => { const s = t(key, vars); return s && s !== key ? s : null; };
/** The title in the reader's language when the record says how; else what the sender wrote. */
export function titleOf(n) { return (n?.i18n?.key && said(`notiftext.${n.i18n.key}.title`, n.i18n.vars || {})) || n?.title || ''; }
export function bodyOf(n) { return (n?.i18n?.key && said(`notiftext.${n.i18n.key}.body`, n.i18n.vars || {})) || n?.body || ''; }
/** The sender as a person reads it: the node's own name, or the app's, extension's, agent's name. */
export function sourceName(n) { const s = n?.source; if (!s || s.kind === 'aimeat') return 'AIMEAT'; if (s.kind === 'owner') return t('notifpage.kind.owner'); return s.name || s.id || ''; }
export function kindWord(kind) { return t('notifpage.kind.' + (kind || 'aimeat')); }
export function groupWord(group) { return t('notifpage.group.' + (group || 'other')); }

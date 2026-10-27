/**
 * @file notifications.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT Notifications Service: the owner's inbox (/v1/notifications), what they
 *   decided about it (/settings), who may notify them (/senders), their push devices
 *   (/v1/push/subscriptions) and the browser side of push (subscribe, unsubscribe, test). Also
 *   the words: a notification's title and body in the reader's language when the record carries
 *   an i18n key, and the sender's name and kind. And the one rule for which notification button
 *   the page may run with the owner's session (isRunnableActionEndpoint).
 * @usage import * as notif from '/js/services/notifications.js';
 * @version-history
 *   v1.4.0 — 2026-10-27 — helpTermOf: a notice whose kind has an explanation gets a question mark that
 *     opens it, on the bell and the page alike (Jouni, 2026-10-27).
 *   v1.3.0 — 2026-10-25 — A decided notice: markAnswered after a button ran, answerTextOf (who decided
 *     what and when) and answerChangeOf (where to change it), read by the bell and the page alike
 *     (secaudit2026oct22; the developer's review of the sandbox).
 *   v1.2.0 — 2026-09-26 — actionTextOf: a button that carries a locale key and variables is said in
 *     the reader's language, the way a title is.
 *   v1.1.0 — 2026-09-25 — isRunnableActionEndpoint: the bell, the Notifications page and a push
 *     click run an `api` button only when it calls a door of this node's own API.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';

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

/* ── The buttons ───────────────────────────────────────────────────────────────────────────── */
/**
 * May the page run this `api` button with the owner's session? Only when its endpoint is a door of
 * this node's own API: a path of this node (one leading slash, no backslash, no control character),
 * at most 500 characters, under /v1/, and still on this origin and under /v1/ once the browser has
 * resolved it ('/v1/../spa.html' is a page, not the API). The node applies the same rule before it
 * stores or serves a button (src/services/notify.ts isSafeNotifActionEndpoint); this is the page's
 * half, asked by the bell, the Notifications page and a push click before each one runs.
 * @param {unknown} endpoint
 * @returns {boolean}
 */
export function isRunnableActionEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 500 || !endpoint.startsWith('/v1/')) return false;
  for (let i = 0; i < endpoint.length; i++) {
    const c = endpoint.charCodeAt(i);
    // 0x5C is the backslash; below 0x20, and 0x7F, are the control characters.
    if (c === 0x5c || c < 0x20 || c === 0x7f) return false;
  }
  const url = new URL(endpoint, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith('/v1/');
}

/* ── A question that was answered ──────────────────────────────────────────────────────────── */
/**
 * After a button's own call answered, tell the node, so the notice shows the answer and offers no
 * button again, in the bell and on the Notifications page alike (POST /v1/notifications/:id/answered).
 * `already`: the call said the question was decided before. Best-effort: the list reloads either way.
 */
export async function markAnswered(n, a, already = false) {
  try { await apiPost(`/v1/notifications/${encodeURIComponent(n.id)}/answered`, { action: a.id, ...(already ? { already: true } : {}) }); }
  catch (err) { swallowed('notifications: answered', err); }
}
/** Did a button's call answer that its question was decided already (409 ALREADY_DECIDED, 404 APPROVAL_NOT_FOUND, 410 EXPIRED)? */
export const alreadyDecided = (r) => ['ALREADY_DECIDED', 'APPROVAL_NOT_FOUND', 'EXPIRED', 'OUTDATED'].includes(r?.error?.code);
/** Who answered, as a person reads it: an agent by its name, an account by its name. */
function answererName(by) {
  if (!by) return '';
  const s = String(by);
  if (s.includes('#')) return s.slice(0, s.indexOf('#'));
  return s.includes('@') ? s.slice(0, s.lastIndexOf('@')) : s;
}
/**
 * The answer of a decided notice in one plain sentence in the reader's language: what was decided,
 * by whom and when ("You allowed this on 25.10. at 18.31."). Null while the question still waits.
 */
export function answerTextOf(n) {
  const a = n?.answered;
  if (!a || !a.outcome) return null;
  const vars = { who: answererName(a.by), date: fmtDate(a.at), time: fmtTime(a.at, { hour: '2-digit', minute: '2-digit' }) };
  const timed = ['allowed', 'declined', 'done'].includes(a.outcome);
  const key = timed ? `notiftext.answered.${a.outcome}_${a.by_you ? 'you' : 'other'}` : `notiftext.answered.${a.outcome}`;
  return said(key, vars) || said('notiftext.answered.done_you', vars);
}
/** Where the person changes it later, when the notice names a place: { link, label }, or null. */
export function answerChangeOf(n) {
  const c = n?.answered?.change;
  if (!c || typeof c.link !== 'string' || !c.link.startsWith('/v1/')) return null;
  return { link: c.link, label: said(`notiftext.${c.key}`, {}) || said('notiftext.approval_change.default', {}) || c.link };
}

/* ── The words ─────────────────────────────────────────────────────────────────────────────── */
const said = (key, vars) => { const s = t(key, vars); return s && s !== key ? s : null; };
/** The title in the reader's language when the record says how; else what the sender wrote. */
export function titleOf(n) { return (n?.i18n?.key && said(`notiftext.${n.i18n.key}.title`, n.i18n.vars || {})) || n?.title || ''; }
export function bodyOf(n) { return (n?.i18n?.key && said(`notiftext.${n.i18n.key}.body`, n.i18n.vars || {})) || n?.body || ''; }
/** A button's words in the reader's language when the button says how (a key under `notiftext.`); else null. */
export function actionTextOf(a) { return (a?.i18n?.key && said(`notiftext.${a.i18n.key}`, a.i18n.vars || {})) || null; }

/** Notices that share one explanation with another key. */
const HELP_ALIAS = { agent_mode_set_by_agent: 'agent_mode_self_set', approval_refinery_definition_text: 'approval_refinery_definition' };
/**
 * The explanation term of a notice (`explain.notice.<key>.*`, components/ExplainDialog.js), or null
 * when its kind has none. The bell and the Notifications page draw a question mark for it.
 */
export function helpTermOf(n) {
  const key = n?.i18n?.key;
  if (!key) return null;
  const term = `notice.${HELP_ALIAS[key] || key}`;
  const probe = `explain.${term}.what`;
  return t(probe) !== probe ? term : null;
}
/** The sender as a person reads it: the node's own name, or the app's, extension's, agent's name. */
export function sourceName(n) { const s = n?.source; if (!s || s.kind === 'aimeat') return 'AIMEAT'; if (s.kind === 'owner') return t('notifpage.kind.owner'); return s.name || s.id || ''; }
export function kindWord(kind) { return t('notifpage.kind.' + (kind || 'aimeat')); }
export function groupWord(group) { return t('notifpage.group.' + (group || 'other')); }

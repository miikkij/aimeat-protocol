/**
 * @file notifications-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Notifications: what happened, who may notify you, where notifications
 *   arrive. Loads the inbox, the senders with the owner's decisions, the devices and the settings;
 *   holds the handlers the cover calls (mark read, clear, an inline action, a sender's push or mute,
 *   revoking an app's grant, this browser's push, removing a device, the email digest, quiet hours);
 *   renders the poster face (notifications/cover.js).
 * @structure NotificationsTab (default) — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'notifications'.
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 *     The page shows the notifications themselves with their senders, says who may notify the
 *     owner and lets them decide per sender, lists every device, and replaces three email choices
 *     nothing read with a digest of what stayed unread.
 *   v1.1.0 — 2026-07-02 — Distinguish a browser-level permission denial from generic subscribe failures.
 *   v1.0.0 — 2026-03-17 — Push toggle and email preferences.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { useConfirm } from '/components/Modal.js';
import { openNotificationLink } from '/components/NotificationBell.js';
import { apiGet, api } from '/js/api.js';
import { getNodeId } from '/js/services/auth.js';
import * as notif from '/js/services/notifications.js';
import { swallowed } from '/js/swallowed.js';
import { c, actionWord } from './notifications/frame.js';
import { renderCover } from './notifications/cover.js';

const openTabEvent = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
const senderKeyOf = (r) => (r.kind === 'aimeat' ? null : r.key);

export default function NotificationsTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [senders, setSenders] = useState([]);
  const [settings, setSettings] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pushSupport, setPushSupport] = useState(null);
  const [vapid, setVapid] = useState(null);
  const [emailVerified, setEmailVerified] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [results, setResults] = useState({});
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [folds, setFolds] = useState({ quiet: false, how: false });
  const [quietForm, setQuietForm] = useState({ enabled: false, start: '22:00', end: '07:00', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), breakthrough: ['organisms', 'messages'], throttleMinutes: 10 });

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  const load = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [inbox, who, dev, mine] = await Promise.all([
        notif.list({ limit: 200 }),
        notif.senders().catch(err => { swallowed('notifications-tab: senders', err); return { groups: [], senders: [], settings: null }; }),
        notif.devices().catch(err => { swallowed('notifications-tab: devices', err); return { subscriptions: [] }; }),
        notif.thisBrowserSubscription(),
      ]);
      setItems(inbox.notifications || []);
      setGroups(who.groups || []);
      setSenders(who.senders || []);
      if (who.settings) {
        setSettings(who.settings);
        const q = who.settings.quiet;
        setQuietForm(f => ({ ...f, enabled: !!q, ...(q ? { start: q.start, end: q.end, tz: q.tz, breakthrough: q.breakthrough } : {}), throttleMinutes: who.settings.throttleMinutes }));
      }
      const mineEndpoint = mine?.endpoint || null;
      setDevices((dev.subscriptions || []).map(d => ({ ...d, thisBrowser: d.endpoint === mineEndpoint })));
    } catch (err) { swallowed('notifications-tab', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    setPushSupport('serviceWorker' in navigator && 'PushManager' in window);
    notif.vapidKey().then(k => setVapid(!!k)).catch(err => { swallowed('notifications-tab: vapid', err); setVapid(false); });
    (async () => {
      try {
        const ghii = session?.ghii || `${session?.owner}@${getNodeId()}`;
        const r = await apiGet(`/v1/ghii/${encodeURIComponent(ghii)}`);
        setEmailVerified((r?.data?.verification_level ?? 0) >= 1);
      } catch (err) { swallowed('notifications-tab: email', err); setEmailVerified(false); }
    })();
  }, [load, session]);
  const liveRef = useRef(null);
  liveRef.current = () => load({ showSpinner: false });
  useEffect(() => onLiveUpdate(['notifications', 'push', 'agent-messages', 'workspace-access'], () => liveRef.current()), []);

  const setFold = (k, open) => setFolds(f => ({ ...f, [k]: open }));
  const openTab = (tabId) => openTabEvent(tabId);

  /* ── the inbox ── */
  const open = async (n) => {
    if (!n.read) { setItems(its => its.map(x => (x.id === n.id ? { ...x, read: true } : x))); notif.markRead([n.id]).catch(err => swallowed('notifications-tab: read', err)); }
    openNotificationLink(n.link, (path) => { window.location.assign(path); });
  };
  async function markAllRead() {
    setBusy(true);
    try { const r = await notif.markRead(); if (r?.ok === false) throw r; setItems(its => its.map(x => ({ ...x, read: true }))); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  function clearAll() {
    confirm(c('clearConfirm'), async () => {
      setBusy(true);
      try { const r = await notif.clear(); if (r?.ok === false) throw r; setItems([]); showToast?.(c('cleared')); }
      catch (e) { fail(e); } finally { setBusy(false); }
    }, { danger: true });
  }
  async function runAction(n, a) {
    if (a.confirm && !window.confirm(c('action.confirm'))) return;
    setBusyId(n.id);
    try {
      const r = await api(a.endpoint, { method: a.method || 'POST', body: a.body ? JSON.stringify(a.body) : undefined });
      const ok = !!(r && r.ok);
      setResults(s => ({ ...s, [n.id]: { ok, msg: ok ? actionWord(a) : (r?.error?.message || c('action.failed')) } }));
      await load({ showSpinner: false });
    } catch (e) { setResults(s => ({ ...s, [n.id]: { ok: false, msg: e?.message || c('action.failed') } })); }
    finally { setBusyId(null); }
  }

  /* ── settings ── */
  async function saveSettings(next) {
    setBusy(true);
    try {
      const saved = await notif.putSettings(next);
      if (!saved) throw new Error(c('saveFailed'));
      setSettings(saved);
      showToast?.(c('saved'));
      await load({ showSpinner: false });
    } catch (e) { fail(e, c('saveFailed')); }
    finally { setBusy(false); }
  }
  const setPref = (r, patch) => {
    const s = settings || { groups: {}, senders: {}, quiet: null, throttleMinutes: 10, emailDigest: { enabled: false, afterHours: 8 } };
    if (r.kind === 'aimeat' && r.group) return saveSettings({ ...s, groups: { ...(s.groups || {}), [r.group]: { ...((s.groups || {})[r.group] || {}), ...patch } } });
    const key = senderKeyOf(r);
    if (!key) return null;
    return saveSettings({ ...s, senders: { ...(s.senders || {}), [key]: { ...((s.senders || {})[key] || {}), ...patch } } });
  };
  function revokeApp(r) {
    confirm(c('revokeConfirm', { name: r.name }), async () => {
      setBusy(true);
      try { const res = await notif.revokeAppGrant(r.grant_id); if (res?.ok === false) throw res; showToast?.(c('revoked', { name: r.name })); await load({ showSpinner: false }); }
      catch (e) { fail(e); } finally { setBusy(false); }
    }, { danger: true });
  }

  /* ── devices ── */
  async function subscribe() {
    setBusy(true);
    try { await notif.subscribeThisBrowser(); showToast?.(c('pushTurnedOn')); await load({ showSpinner: false }); }
    catch (e) { fail(e, c(e?.code === 'DENIED' ? 'permissionDenied' : e?.code === 'NO_SUPPORT' ? 'noBrowserSupport' : e?.code === 'NOT_CONFIGURED' ? 'notConfigured' : 'subscribeFailed')); }
    finally { setBusy(false); }
  }
  async function unsubscribe() {
    setBusy(true);
    try { await notif.unsubscribeThisBrowser(); showToast?.(c('pushTurnedOff')); await load({ showSpinner: false }); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  function removeDevice(d) {
    confirm(c('removeDeviceConfirm', { name: c('family.' + d.family) }), async () => {
      setBusy(true);
      try { const r = await notif.removeDevice(d.endpoint); if (r?.ok === false) throw r; await load({ showSpinner: false }); }
      catch (e) { fail(e); } finally { setBusy(false); }
    }, { danger: true });
  }
  async function testPush() {
    setBusy(true);
    try { const r = await notif.testPush(); if (r?.ok === false) throw r; showToast?.(c('testSent')); }
    catch (e) { fail(e, c('testFailed')); } finally { setBusy(false); }
  }

  const ctx = {
    items, loading, groups, senders, settings, devices, pushSupport, vapid, emailVerified, busy, busyId, results, filter, showAll, groupsOpen, folds, quietForm, ConfirmUI,
    setFilter, setShowAll, setGroupsOpen, setFold, setQuietForm, openTab,
    open, markAllRead, clearAll, runAction, saveSettings, setPref, revokeApp, subscribe, unsubscribe, removeDevice, testPush,
  };
  return renderCover(ctx);
}

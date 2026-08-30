/**
 * @file email-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Email: your address and what it is used for, the mailboxes you connected
 *   and who may use them, what left through the node, what the node mails you. Loads the owner's
 *   record, the mail providers and connections (with each one's delegations and send-as
 *   aliases), the outbound log, the mail log and the settings; holds the handlers the cover calls
 *   (change and verify the address, connect and remove a mailbox, stop a delegation, the letters'
 *   switches, the prompt); renders the poster face (email/cover.js).
 * @structure EmailTab (default) — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'email'.
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Sähköpostin sivu", direction A).
 *     The page says what the address is for, brings the mail connections here from the Access
 *     page, shows what left through the node and what the node sent, and makes the node's own
 *     emails switches.
 *   v1.1.0 — 2026-03-17 — CSS classes; GlassCard.
 *   v1.0.0 — 2026-03-16 — Initial email verification tab.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { copyToClipboard } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import * as email from '/js/services/email.js';
import * as notif from '/js/services/notifications.js';
import * as contactsService from '/js/services/contacts.js';
import { swallowed } from '/js/swallowed.js';
import { c, providerWord } from './email/frame.js';
import { renderCover } from './email/cover.js';

const openTabEvent = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));

export default function EmailTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [me, setMe] = useState(null);
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [delegations, setDelegations] = useState({});
  const [aliases, setAliases] = useState({});
  const [outbound, setOutbound] = useState([]);
  const [outboundTotal, setOutboundTotal] = useState(0);
  const [mailLog, setMailLog] = useState([]);
  const [settings, setSettings] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState('');
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState({ email: '', code: '', codeSent: false });
  const [sentFilter, setSentFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [folds, setFolds] = useState({ letters: false, chat: false });

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  const load = useCallback(async () => {
    try {
      const [profile, provs, out, log, set, cts] = await Promise.all([
        email.me(),
        email.mailProviders().catch(err => { swallowed('email-tab: providers', err); return []; }),
        email.outboundLog(200).catch(err => { swallowed('email-tab: outbound', err); return { messages: [], total: 0 }; }),
        email.mailLog().catch(err => { swallowed('email-tab: mail log', err); return { entries: [] }; }),
        notif.getSettings().catch(err => { swallowed('email-tab: settings', err); return null; }),
        contactsService.listContacts().catch(err => { swallowed('email-tab: contacts', err); return []; }),
      ]);
      setMe(profile);
      setProviders(provs);
      setOutbound(out.messages || []);
      setOutboundTotal(out.total || 0);
      setMailLog(log.entries || []);
      setSettings(set);
      setContacts(cts);
      const conns = await email.mailConnections(provs).catch(err => { swallowed('email-tab: connections', err); return []; });
      setConnections(conns);
      const dels = {}, als = {};
      await Promise.all(conns.map(async (conn) => {
        dels[conn.id] = await email.delegations(conn.id).catch(err => { swallowed('email-tab: delegations', err); return []; });
        const p = provs.find(x => x.id === conn.provider);
        if (p && (p.capabilities || []).includes('read-mail') && conn.status === 'active') als[conn.id] = await email.sendAsAliases(conn.id);
      }));
      setDelegations(dels);
      setAliases(als);
    } catch (err) { swallowed('email-tab', err); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(null);
  liveRef.current = () => load();
  useEffect(() => onLiveUpdate(['connections', 'notifications', 'outbound'], () => liveRef.current()), []);

  const setFold = (k, open) => setFolds(f => ({ ...f, [k]: open }));
  const providerOf = (id) => providers.find(p => p.id === id) || null;
  const contactName = (id) => { const r = contacts.find(x => x.contact_id === id); return r ? (r.display_name || r.saved_name || r.email || id) : (id || ''); };
  const openContact = () => openTabEvent('contacts');

  /* ── the address ── */
  const startChange = () => { setChanging(true); setForm({ email: me?.notification_email || '', code: '', codeSent: false }); };
  const cancelChange = () => { setChanging(false); setForm({ email: '', code: '', codeSent: false }); };
  async function sendCode() {
    const addr = form.email.trim();
    if (!addr) return;
    const proceed = async () => {
      setBusy(true);
      try {
        const r = await email.startVerify(addr);
        if (r?.ok === false) throw r;
        setForm(f => ({ ...f, codeSent: true, code: '', verificationId: r?.data?.verification_id || null }));
        showToast?.(c('codeSentToast'));
      } catch (e) { fail(e, t('profile.email.sendFailed')); }
      finally { setBusy(false); }
    };
    if (me?.email_verified_at && me?.notification_email && addr !== me.notification_email) confirm(c('changeConfirm', { old: me.notification_email, next: addr }), proceed);
    else await proceed();
  }
  async function confirmCode() {
    setBusy(true);
    try {
      const r = await email.confirmVerify(form.code.trim(), form.verificationId);
      if (r?.ok === false) throw r;
      showToast?.(c('verifiedToast'));
      cancelChange();
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await load();
    } catch (e) { fail(e, t('profile.email.verifyFailed')); }
    finally { setBusy(false); }
  }

  /* ── mailboxes ── */
  async function connect(p) {
    setConnecting(p.id);
    try {
      const url = await email.startConnection(p.id);
      if (!url) throw new Error(c('connectFailed'));
      const before = connections.length;
      const win = window.open(url, 'aimeat-connect', 'width=620,height=760');
      if (!win) throw new Error(c('popupBlocked'));
      const ok = await email.waitForConnection(before, () => email.mailConnections(providers));
      if (ok) showToast?.(c('connected', { name: providerWord(p) }));
      await load();
    } catch (e) { fail(e, c('connectFailed')); }
    finally { setConnecting(''); }
  }
  function remove(conn, p) {
    confirm(c('removeConfirm', { name: providerWord(p), account: conn.accountLabel || '' }), async () => {
      setBusy(true);
      try { const r = await email.removeConnection(conn.id); if (r?.ok === false) throw r; showToast?.(c('removed', { name: providerWord(p) })); await load(); }
      catch (e) { fail(e); } finally { setBusy(false); }
    }, { danger: true });
  }
  async function stopDelegation(conn, d) {
    setBusy(true);
    try { const r = await email.setDelegation(d.id, false); if (r?.ok === false) throw r; await load(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }

  /* ── the letters ── */
  async function saveSettings(next) {
    setBusy(true);
    try {
      const saved = await notif.putSettings(next);
      if (!saved) throw new Error(c('saveFailed'));
      setSettings(saved);
      showToast?.(c('saved'));
    } catch (e) { fail(e, c('saveFailed')); }
    finally { setBusy(false); }
  }

  /* ── the prompt ── */
  async function copyPrompt() {
    try {
      const text = await email.getPrompt();
      if (!text) throw new Error(c('promptUnavailable'));
      copyToClipboard(text);
      showToast?.(c('promptCopied'));
    } catch (e) { fail(e, c('promptUnavailable')); }
  }

  const ctx = {
    me, providers, connections, delegations, aliases, outbound, outboundTotal, mailLog, settings, busy, connecting, changing, form, sentFilter, showAll, folds, ConfirmUI,
    providerOf, contactName, openContact, setForm, setSentFilter, setShowAll, setFold,
    startChange, cancelChange, sendCode, confirmCode, connect, remove, stopDelegation, saveSettings, copyPrompt,
  };
  return renderCover(ctx);
}

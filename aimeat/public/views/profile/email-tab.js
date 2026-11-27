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
 *   v2.4.0 -- 2026-11-27 -- connect(p, renew): "Connect again" on a mailbox that needs a new sign-in runs the
 *     provider's connect round; the wait (js/connection-wait.js) listens for the `connections` live domain
 *     instead of polling and notices the row made active again, not only a new row. Every refusal is said
 *     in the page's language by its code (js/refusal-words.js, emailpage.refusal.*).
 *   v2.3.0 -- 2026-11-27 -- The fold state covers the address, which the cover draws as a row once it is
 *     confirmed (usability pass of the Settings pages); `chat` is gone, its fold was removed on 2026-11-08.
 *   v2.2.0 — 2026-10-18 — saveLanguage: the letters' language choice sets the account language
 *     (PUT /v1/ghii locale), which decides the language of every email the node sends the owner.
 *   v2.1.0 — 2026-09-13 — The letters' switches save nothing while the notification settings are not
 *     loaded: the save is the whole record, and one built from defaults erased the owner's muted
 *     senders and quiet hours (docs/pitfalls.md §84).
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
import { updateProfile } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { refusalText } from '/js/refusal-words.js';
import { waitForConnection, snapshot } from '/js/connection-wait.js';
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
  const [folds, setFolds] = useState({ address: false, letters: false });

  // A refusal in the page's words by its code (js/refusal-words.js), the action's own words first,
  // with the action's own sentence when the code has none; the server's sentence is English for an AI.
  /** @type {(e: any, fallbackKey: string, vars?: Record<string, string|number>, prefix?: string|string[]) => void} */
  const fail = (e, fallbackKey, vars, prefix = 'emailpage.refusal.') => showToast?.(refusalText(e, prefix, fallbackKey, vars), true);

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
      } catch (e) { fail(e, 'profile.email.sendFailed', undefined, ['emailpage.refusal.verify.', 'emailpage.refusal.']); }
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
    } catch (e) { fail(e, 'profile.email.verifyFailed', undefined, ['emailpage.refusal.confirm.', 'emailpage.refusal.']); }
    finally { setBusy(false); }
  }

  /* ── mailboxes ── */
  // Connect a mailbox, or sign in to one again (`renew`, the row that needs a new sign-in): the same
  // round at the provider. A new sign-in with the same account repairs that row in place, so the wait
  // compares the rows' states as well as their ids (email.waitForConnection).
  async function connect(p, renew) {
    setConnecting(p.id);
    try {
      const url = await email.startConnection(p.id);
      if (!url) { showToast?.(c('connectFailed'), true); return; }
      const before = snapshot(connections);
      const win = window.open(url, 'aimeat-connect', 'width=620,height=760');
      if (!win) { showToast?.(c('popupBlocked'), true); return; }
      const ok = await waitForConnection(before, () => email.mailConnections(providers));
      if (ok) showToast?.(c(renew ? 'reconnected' : 'connected', { name: providerWord(p) }));
      await load();
    } catch (e) { fail(e, 'emailpage.connectFailed'); }
    finally { setConnecting(''); }
  }
  function remove(conn, p) {
    confirm(c('removeConfirm', { name: providerWord(p), account: conn.accountLabel || '' }), async () => {
      setBusy(true);
      try { const r = await email.removeConnection(conn.id); if (r?.ok === false) throw r; showToast?.(c('removed', { name: providerWord(p) })); await load(); }
      catch (e) { fail(e, 'emailpage.refusal.removeFailed', { name: providerWord(p) }); } finally { setBusy(false); }
    }, { danger: true });
  }
  async function stopDelegation(conn, d) {
    setBusy(true);
    try { const r = await email.setDelegation(d.id, false); if (r?.ok === false) throw r; await load(); }
    catch (e) { fail(e, 'emailpage.refusal.stopFailed', undefined, ['emailpage.refusal.delegation.', 'emailpage.refusal.']); } finally { setBusy(false); }
  }

  /* ── the letters ── */
  async function saveSettings(next) {
    // The same whole notification-settings record the Notifications page saves: without the owner's
    // record loaded, `next` was built from defaults and would erase their muted senders and quiet hours.
    if (!settings) { showToast?.(t('notifpage.settingsUnavailable'), true); return; }
    setBusy(true);
    try {
      const saved = await notif.putSettings(next);
      if (!saved) { showToast?.(c('saveFailed'), true); return; }
      setSettings(saved);
      showToast?.(c('saved'));
    } catch (e) { fail(e, 'emailpage.saveFailed'); }
    finally { setBusy(false); }
  }

  /** The account language, which every email the node sends the owner is written in. */
  async function saveLanguage(locale) {
    setBusy(true);
    try {
      const r = await updateProfile({ locale });
      // The session's own fetch answers a refusal as the envelope; its code is said like any other.
      if (!r?.data) { fail(r, 'emailpage.saveFailed'); return; }
      setMe(m => ({ ...m, locale: r.data.locale }));
      showToast?.(c('saved'));
    } catch (e) { fail(e, 'emailpage.saveFailed'); }
    finally { setBusy(false); }
  }

  /* ── the prompt ── */
  async function copyPrompt() {
    try {
      const text = await email.getPrompt();
      if (!text) { showToast?.(c('promptUnavailable'), true); return; }
      copyToClipboard(text);
      showToast?.(c('promptCopied'));
    } catch (e) { fail(e, 'emailpage.promptUnavailable'); }
  }

  const ctx = {
    me, providers, connections, delegations, aliases, outbound, outboundTotal, mailLog, settings, busy, connecting, changing, form, sentFilter, showAll, folds, ConfirmUI,
    providerOf, contactName, openContact, setForm, setSentFilter, setShowAll, setFold,
    startChange, cancelChange, sendCode, confirmCode, connect, remove, stopDelegation, saveSettings, saveLanguage, copyPrompt,
  };
  return renderCover(ctx);
}

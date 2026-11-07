/**
 * @file public/views/profile/receivers-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: Receivers (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht,
 *   design canvas "Vastaanottimet"). A receiver is an address and a key through which an outside
 *   program (a Lambda, a home sensor, a CRM export) writes into exactly one place of the owner's data
 *   over plain REST. This file is the state and the handlers over the /v1/receivers routes: the
 *   list, one receiver with its deliveries, the new-receiver form with its organism, workspace, row
 *   space and CSM pickers, the decision on a proposal, pause and resume, a new key, a new end date
 *   and delete. The render is receivers/cover.js, receivers/detail.js and receivers/dialogs.js.
 *
 *   ADDRESSES THE TAB ANSWERS: `?approve=<name>` opens the decision on a receiver an agent proposed
 *   (the approve_url the propose call answers); `?receiver=<name>` opens one receiver's page;
 *   `?new=key&key=<memory key>&name=<suggested name>` opens the form with "one memory key" chosen and
 *   both filled in, each only when it passes the server's own check (the living documents' inward
 *   gear links here). The words are taken off the address once read, so a reload does not reopen them.
 *
 *   LIVE: the node announces every management change as the `receivers` domain on the SSE stream;
 *   deliveries are read when the receiver's page opens and on its Refresh action, never on a timer.
 * @structure ReceiversTab() — state + handlers → renderReceiversView(ctx)
 * @usage registered in profile.js TABS as id 'receivers'.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { getSession, getNodeId } from '/js/services/auth.js';
import { getOrganismsTab, listWorkspaces, getWorkspace } from '/js/services/organisms.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { renderReceiversView } from './receivers/cover.js';
import { x, api, LIMITS, validName, validKey, slugOf, dryRun, refusalWords } from './receivers/frame.js';
import { formErrors, bodyOf } from './receivers/dialogs.js';

const SAMPLE = '{"temperature": 21.4, "at": "2026-11-07T10:40:00Z"}';

/** A refusal in the page's words when it has them, else the server's sentence. */
function errWords(e) {
  const code = e?.code || e?.response?.error?.code;
  const own = code ? t('receivers.err.' + code) : '';
  if (own && own !== 'receivers.err.' + code) return own;
  return refusalWords(code) || e?.message || x('failed');
}

const emptyForm = () => ({
  display: '', name: '', nameTouched: false, kind: 'key', key: '', prefix: '', maxKeys: String(LIMITS.maxKeys.dflt),
  org: '', ws: '', space: '', shape: 'csm', csm: '', verbs: { merge: false, read: false, delete: false },
  perMinute: String(LIMITS.perMinute.dflt), maxKb: String(LIMITS.maxKb.dflt), days: String(LIMITS.expiresDays.dflt), touched: {},
});

/** The address words this tab reads once, taken off the address after reading. */
function takeAddressWords() {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const got = { approve: p.get('approve'), receiver: p.get('receiver'), newKind: p.get('new'), key: p.get('key'), name: p.get('name') };
  let changed = false;
  for (const k of ['approve', 'receiver', 'new', 'key', 'name']) if (p.has(k)) { p.delete(k); changed = true; }
  if (changed) history.replaceState(null, '', url);
  return got;
}

export default function ReceiversTab({ session, showToast }) {
  const sess = session || getSession();
  const owner = sess?.owner || (sess?.ghii ? String(sess.ghii).split('@')[0] : '');
  const ownerGhii = sess?.ghii || (owner ? `${owner}@${getNodeId()}` : '');
  const { confirm, ConfirmUI } = useConfirm();
  const toast = (msg, isError) => showToast?.(msg, isError);

  const [asked] = useState(takeAddressWords);
  const [list, setList] = useState(null);
  const [mode, setMode] = useState('self');
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState(() => (asked.receiver && validName(asked.receiver) ? { kind: 'detail', name: asked.receiver } : { kind: 'cover' }));
  const [detail, setDetail] = useState(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [deliveries, setDeliveries] = useState(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csms, setCsms] = useState(null);
  const [pickers, setPickers] = useState({ orgs: null, workspaces: null, spaces: null });

  const load = useCallback(async () => {
    try {
      const d = await api.list();
      setList(d.receivers || []);
      setMode(d.mode || 'self');
      setFailed(false);
    } catch (e) { swallowed('receivers-tab: list', e); setFailed(true); }
  }, []);

  const loadDetail = useCallback(async (name) => {
    setLoadingDeliveries(true);
    try {
      const [one, del] = await Promise.all([api.get(name), api.deliveries(name)]);
      setDetail(one ? { name, ...one } : null);
      setDeliveries(del);
      setDetailFailed(false);
    } catch (e) { swallowed('receivers-tab: detail', e); setDetailFailed(true); }
    finally { setLoadingDeliveries(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (view.kind === 'detail') loadDetail(view.name); }, [view, loadDetail]);
  const liveRef = useRef(null);
  liveRef.current = () => { load(); if (view.kind === 'detail') loadDetail(view.name); };
  useEffect(() => onLiveUpdate(['receivers'], () => liveRef.current()), []);

  const scrollTop = () => {
    const box = document.querySelector('.page-content') || document.querySelector('.settings-frame-content');
    if (box) box.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 });
  };
  const openCover = () => { setView({ kind: 'cover' }); setDetail(null); setDeliveries(null); scrollTop(); };
  const openDetail = (name) => { setDetail(null); setDeliveries(null); setFilter('all'); setView({ kind: 'detail', name }); scrollTop(); };

  /* ── The form ─────────────────────────────────────────────────────────────────────────────── */
  const loadCsms = useCallback(async () => {
    let found = [];
    try { found = await api.csms(); } catch (e) { swallowed('receivers-tab: csms', e); }
    setCsms(found);
    // With no CSM to pick, the form starts on "Take it as it is"; the person still sees both choices.
    if (!found.length) setDialog((d) => (d && d.kind === 'create' ? { ...d, form: { ...d.form, shape: 'any' } } : d));
  }, []);
  const loadOrgs = useCallback(async () => {
    const tab = await getOrganismsTab();
    setPickers({ orgs: (tab?.mine || []).map((o) => ({ id: o.id, name: o.name })), workspaces: null, spaces: null });
  }, []);
  const openCreate = (prefill = {}) => {
    setDialog({ kind: 'create', form: { ...emptyForm(), ...prefill }, tried: false, error: '' });
    if (csms === null) loadCsms();
  };
  const setForm = (patch) => {
    if (patch.kind === 'space' && pickers.orgs === null) loadOrgs();
    setDialog((d) => {
      if (!d || d.kind !== 'create') return d;
      const f = { ...d.form, ...patch };
      // The name follows the display name until the person writes a name of their own.
      if ('display' in patch && !f.nameTouched) f.name = slugOf(patch.display);
      return { ...d, form: f, error: '' };
    });
  };
  const touch = (k) => setDialog((d) => (d && d.kind === 'create' ? { ...d, form: { ...d.form, touched: { ...d.form.touched, [k]: true } } } : d));
  const pickOrg = async (org) => {
    setForm({ org, ws: '', space: '' });
    setPickers((p) => ({ ...p, workspaces: null, spaces: null }));
    if (!org) return;
    const ws = await listWorkspaces(org);
    setPickers((p) => ({ ...p, workspaces: (ws || []).map((w) => ({ id: w.id, name: w.name })) }));
  };
  const pickWs = async (ws) => {
    setForm({ ws, space: '' });
    setPickers((p) => ({ ...p, spaces: null }));
    if (!ws) return;
    const org = dialog?.form?.org;
    try {
      const w = await getWorkspace(org, ws);
      const spaces = (w?.manifest?.objectTypes || []).filter((ot) => ot && ot.backing === 'rows')
        .map((ot) => ({ id: ot.name || ot.namespace, label: ot.label || ot.title || ot.name || ot.namespace }));
      setPickers((p) => ({ ...p, spaces }));
    } catch (e) { swallowed('receivers-tab: row spaces', e); setPickers((p) => ({ ...p, spaces: [] })); }
  };
  const submitCreate = async () => {
    const f = dialog?.form;
    if (!f) return;
    if (Object.keys(formErrors(f)).length) { setDialog((d) => ({ ...d, tried: true })); return; }
    setBusy(true);
    try {
      const out = await api.create(bodyOf(f));
      showKey(out, false);
      toast(x('created', { name: out.receiver.display_name || out.receiver.name }));
      load();
    } catch (e) { setDialog((d) => ({ ...d, error: errWords(e) })); }
    finally { setBusy(false); }
  };

  /** The key-once dialog for an answer that carries a key. */
  const showKey = (out, rotated) => setDialog({ kind: 'key', receiver: out.receiver, key: out.key, say: out.say || '', rotated, testBody: SAMPLE, test: null, testing: false });
  const setTestBody = (v) => setDialog((d) => (d && d.kind === 'key' ? { ...d, testBody: v } : d));
  const runDryRun = async () => {
    const d = dialog;
    if (!d || d.kind !== 'key') return;
    setDialog({ ...d, testing: true, test: null });
    const res = await dryRun(d.receiver, d.key, d.testBody);
    const words = res.ok ? '' : (refusalWords(res.code) || res.message || res.code);
    setDialog((cur) => (cur && cur.kind === 'key' ? { ...cur, testing: false, test: { ...res, words } } : cur));
  };

  /* ── A proposal ───────────────────────────────────────────────────────────────────────────── */
  const openDecide = async (name) => {
    setDialog({ kind: 'decide', receiver: null });
    try {
      const one = await api.get(name);
      const r = one?.receiver;
      if (!r) throw new Error(x('notFound', { name }));
      if (r.state !== 'proposed') { setDialog(null); toast(x('notWaiting', { name: r.display_name || r.name })); return; }
      setDialog({ kind: 'decide', receiver: r });
    } catch (e) { setDialog(null); toast(errWords(e), true); }
  };
  const decide = async (r, decision) => {
    setBusy(true);
    try {
      const out = await api.decide(r.name, decision);
      if (decision === 'approve' && out?.key) { showKey(out, false); toast(x('approved', { name: r.display_name || r.name })); }
      else { setDialog(null); toast(x('refused', { name: r.display_name || r.name })); if (view.kind === 'detail') openCover(); }
      load();
    } catch (e) { toast(errWords(e), true); }
    finally { setBusy(false); }
  };

  /* ── One receiver's actions ───────────────────────────────────────────────────────────────── */
  const act = async (fn, said) => {
    setBusy(true);
    try { const out = await fn(); if (said) toast(said); await load(); if (view.kind === 'detail') await loadDetail(view.name); return out; }
    catch (e) { toast(errWords(e), true); return null; }
    finally { setBusy(false); }
  };
  const nameOf = (r) => r.display_name || r.name;
  const pause = (r) => act(() => api.pause(r.name), x('paused', { name: nameOf(r) }));
  const resume = (r) => act(() => api.resume(r.name), x('resumed', { name: nameOf(r) }));
  const rotate = (r) => confirm(x('rotateConfirm', { name: nameOf(r), minutes: 15 }), async () => {
    const out = await act(() => api.rotate(r.name));
    if (out?.key) showKey(out, true);
  }, { title: x('rotate'), confirmLabel: x('rotate') });
  // The page leaves the receiver's own page before the list is read again, so nothing asks for the
  // receiver that is gone.
  const remove = (r) => confirm(x('deleteConfirm', { name: nameOf(r) }), async () => {
    setBusy(true);
    try { await api.remove(r.name); openCover(); toast(x('deleted', { name: nameOf(r) })); await load(); }
    catch (e) { toast(errWords(e), true); }
    finally { setBusy(false); }
  }, { danger: true, title: x('delete'), confirmLabel: x('delete') });
  const openExtend = (r) => setDialog({ kind: 'extend', receiver: r, days: String(LIMITS.expiresDays.dflt) });
  const submitExtend = async () => {
    const d = dialog;
    if (!d || d.kind !== 'extend') return;
    const out = await act(() => api.patch(d.receiver.name, { expires_days: Number(d.days) }), x('extended', { name: nameOf(d.receiver) }));
    if (out) setDialog(null);
  };

  // The address words, once: a proposal to decide, or a form with one memory key filled in.
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (asked.approve && validName(asked.approve)) { openDecide(asked.approve); return; }
    if (asked.newKind === 'key') {
      const key = validKey(asked.key || '') ? asked.key : '';
      const name = validName(asked.name || '') ? asked.name : '';
      openCreate({ kind: 'key', key, name, display: name, nameTouched: !!name, shape: 'csm' });
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- runs once, on the address the tab opened with

  const ctx = {
    owner, ownerGhii, list, mode, failed, reload: load, view, detail, detailFailed, deliveries, loadingDeliveries, filter, setFilter,
    dialog, setDialog, closeDialog: () => setDialog(null), busy, csms, pickers, ConfirmUI,
    openCover, openDetail, openCreate: () => openCreate(), setForm, touch, pickOrg, pickWs, submitCreate,
    setTestBody, runDryRun, openDecide, decide, pause, resume, rotate, remove, openExtend, submitExtend,
    reloadDetail: () => (view.kind === 'detail' ? loadDetail(view.name) : null),
  };
  return renderReceiversView(ctx);
}

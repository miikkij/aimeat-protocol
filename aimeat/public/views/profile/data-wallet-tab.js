/**
 * @file data-wallet-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the Data Wallet in the poster face. What you own (memory keys and
 *   files), who reaches it and by which permission (grouped by what the permission opens: an
 *   organism with its workspaces, or a key area), what was refused (the trail grouped by who tried
 *   what), a grant form as a fold, everything you own as one file, and how your AI uses the wallet.
 *   This file holds the reads and the handlers: the composite mount (consents, the grouped trail,
 *   the summary, the names), the trail's window, the rows of one group page by page, a grant (a
 *   workspace role through the workspace door, anything else through the consent door), a revoke,
 *   the export. The render is data-wallet/page.js and data-wallet/rows.js.
 * @structure DataWalletTab() — state + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'dataWallet'
 * @version-history
 *   v2.0.0 — 2026-09-04 — The poster face (design canvas "AIMEAT Tietolompakko-sivu", direction A):
 *     permissions grouped by target and said in words with names, the trail grouped and the grants
 *     and revocations read off the permissions' own timestamps, the form as a fold whose target is
 *     picked from your organisms, the export with its contents, every word through the locales.
 *   v1.7.0 — 2026-08-18 — Permission rows say what they are, the trail says what it shows.
 *   v1.4.0 — 2026-07-16 — Mount folds the three reads into GET /v1/data-wallet.
 *   v1.0.0 — 2026-03-06 — Initial Data Wallet tab.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { t, getLocale } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPost } from '/js/api.js';
import * as consentService from '/js/services/consent.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { renderPage } from './data-wallet/page.js';
import { x, targetRows, targetOf, targetWords, whoOf, roleOf, consentEvents, openTab } from './data-wallet/frame.js';
import { groupId } from './data-wallet/rows.js';

const ENTRY_LIMIT = 20;
const ROWS_PAGE = 50;
const FIRST_TRAIL = 12;
const EMPTY_FORM = { open: false, whoKind: 'contact', who: '', what: 'ws', orgId: '', wsId: '', key: '', may: 'read', why: '', scope: 'private', untilKind: 'never', until: '' };
const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 7000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');

export default function DataWalletTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [ov, setOv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [days, setDaysState] = useState(30);
  const [reloading, setReloading] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [filter, setFilterState] = useState('all');
  const [trailFilter, setTrailFilter] = useState('all');
  const [personFocus, setPersonFocus] = useState('');
  const [openTarget, setOpenTarget] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);
  const [groupRows, setGroupRows] = useState({});
  const [shownTrail, setShownTrail] = useState(FIRST_TRAIL);
  const [form, setFormState] = useState(EMPTY_FORM);
  const [orgs, setOrgs] = useState([]);
  const [formMsg, setFormMsg] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const federated = !!session?.federated;

  /* ── Reads ─────────────────────────────────────────────────────────────────────────────────── */

  const load = useCallback(async (d = days) => {
    if (federated) return;
    setReloading(true);
    const o = await consentService.getDataWalletOverview(d, ENTRY_LIMIT);
    setReloading(false);
    if (!o) { setFailed(true); return; }
    setFailed(false);
    setOv(o);
  }, [federated, days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (federated) return;
    apiGet('/v1/ghii/me').then((r) => { const g = r?.data?.ghii || ''; const at = g.indexOf('@'); if (at > 0) setNodeId(g.slice(at + 1)); else if (r?.node) setNodeId(r.node); }).catch((e) => swallowed('data-wallet: me', e));
  }, [federated]);
  const loadRef = useRef(null);
  loadRef.current = () => load();
  useEffect(() => onLiveUpdate(['consent', 'memory', 'files'], () => loadRef.current()), []);

  /** The owner's organisms with their workspaces, for the form; read once when the form first opens. */
  const loadOrgs = useCallback(async () => {
    if (orgs.length) return;
    const tab = await getOrganismsTab();
    const mine = (tab?.mine || []).map((o) => ({ id: o.id, name: o.name || o.id, workspaces: null }));
    setOrgs(mine);
  }, [orgs.length]);

  const loadWorkspaces = useCallback(async (orgId) => {
    if (!orgId) return;
    const have = orgs.find((o) => o.id === orgId);
    if (!have || have.workspaces) return;
    const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces`).catch((e) => { swallowed('data-wallet: workspaces', e); return null; });
    const list = (r?.data?.workspaces || []).filter((w) => !w.archived).map((w) => ({ id: w.id, name: w.name || w.id, access: w.access }));
    setOrgs((cur) => cur.map((o) => (o.id === orgId ? { ...o, workspaces: list } : o)));
  }, [orgs]);
  useEffect(() => { if (form.open && form.orgId) loadWorkspaces(form.orgId); }, [form.open, form.orgId, loadWorkspaces]);

  /* ── What the page reads off the state ─────────────────────────────────────────────────────── */

  // The words inside the rows are in the reader's language, so the names bag carries the locale and a
  // language switch recomputes everything derived from it.
  const locale = getLocale();
  const names = useMemo(() => ({ organisms: ov?.names?.organisms || {}, workspaces: ov?.names?.workspaces || {}, locale }), [ov, locale]);
  const consents = useMemo(() => ov?.consents?.consents || [], [ov]);
  const active = useMemo(() => consents.filter((c) => c.status === 'active'), [consents]);
  const revokedList = useMemo(() => consents.filter((c) => c.status !== 'active').sort((a, b) => ((a.revoked_at || a.granted_at) < (b.revoked_at || b.granted_at) ? 1 : -1)), [consents]);
  /** The targets somebody reaches now; a target whose every grant is withdrawn lives under the "withdrawn" filter. */
  const targets = useMemo(() => targetRows(consents, names).filter((r) => r.grants.length), [consents, names]);
  const people = useMemo(() => {
    const by = new Map();
    for (const c of active) {
      const w = whoOf(c.recipient, names);
      const slot = by.get(c.recipient) || { id: `p|${c.recipient}`, name: w.name, kind: w.kind, grants: [], since: null };
      slot.grants.push(c);
      if (!slot.since || c.granted_at < slot.since) slot.since = c.granted_at;
      by.set(c.recipient, slot);
    }
    return [...by.values()].map((p) => {
      const tw = p.grants.map((c) => targetWords(c.data_pattern, names));
      const seen = [];
      for (const w of tw) { const s = `${w.title} · ${w.sub}`; if (!seen.includes(s)) seen.push(s); }
      return { ...p, words: seen.slice(0, 3).join('; ') + (seen.length > 3 ? ` +${seen.length - 3}` : '') };
    }).sort((a, b) => b.grants.length - a.grants.length);
  }, [active, names]);
  const kinds = useMemo(() => { const k = {}; for (const c of active) { const w = whoOf(c.recipient, names).kind; k[w] = (k[w] || 0) + 1; } return k; }, [active, names]);
  const groups = useMemo(() => ov?.audit?.groups || [], [ov]);
  const deniedGroupsList = useMemo(() => groups.filter((g) => !g.allowed), [groups]);
  const deniedCount = useMemo(() => deniedGroupsList.reduce((s, g) => s + g.count, 0), [deniedGroupsList]);
  const manifestDenied = useMemo(() => deniedGroupsList.filter((g) => g.target?.rest === 'meta.manifest').reduce((s, g) => s + g.count, 0), [deniedGroupsList]);
  const events = useMemo(() => consentEvents(consents, days, names), [consents, days, names]);
  /** Groups and events in one list, newest first by their last moment; the mutation rows the server keeps (grant/revoke) are dropped, the events say the same from the permissions. */
  const trail = useMemo(() => {
    const items = groups.filter((g) => g.action !== 'grant' && g.action !== 'revoke').map((g) => ({ kind: 'group', at: g.last, group: g }));
    const evs = events.map((e) => ({ kind: 'event', at: e.at, event: e }));
    const all = trailFilter === 'events' ? evs : [...items, ...evs];
    return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [groups, events, trailFilter]);
  const swapped = useMemo(() => {
    // A revoke followed within a minute by a grant to the same recipient on the same target is a role swap.
    let k = 0;
    for (const r of revokedList) {
      if (!r.revoked_at) continue;
      const rv = new Date(r.revoked_at).getTime();
      if (consents.some((c) => c.id !== r.id && c.recipient === r.recipient && c.data_pattern === r.data_pattern && Math.abs(new Date(c.granted_at).getTime() - rv) < 60000)) k++;
    }
    return k;
  }, [revokedList, consents]);
  const expiring = useMemo(() => active.filter((c) => c.expires).length, [active]);
  const quota = ov?.permSummary?.consent_quota || 100;
  const exportName = `aimeat-${session?.owner || 'me'}-${new Date().toISOString().slice(0, 10)}.json`;

  /* ── Handlers ──────────────────────────────────────────────────────────────────────────────── */

  const setDays = (d) => { setDaysState(d); setOpenGroup(null); setGroupRows({}); setShownTrail(FIRST_TRAIL); };
  const setFilter = (f) => { setFilterState(f); setOpenTarget(null); if (f !== 'people') setPersonFocus(''); };
  const toggleTarget = (id) => setOpenTarget((cur) => (cur === id ? null : id));
  const toggleGroup = (id) => setOpenGroup((cur) => (cur === id ? null : id));
  const showMoreTrail = () => setShownTrail((k) => k + 20);
  const showPerson = (name) => { setFilterState('people'); setPersonFocus(name); const p = people.find((q) => q.name === name); setOpenTarget(p ? p.id : null); window.setTimeout(() => document.getElementById('dw-targets')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };

  /** The rows of one group, a page at a time: the accessor and the key prefix the family shares. */
  const loadGroupRows = async (g, id, more) => {
    const tg = g.target || {};
    const keyPrefix = tg.kind === 'key' ? tg.key : tg.kind === 'ws' ? `organism.${tg.organism_id}.w.` : `organism.${tg.organism_id}.${tg.rest || ''}`;
    const cur = groupRows[id] || { entries: [], total: 0, offset: 0 };
    setGroupRows((s) => ({ ...s, [id]: { ...cur, loading: true } }));
    try {
      const r = await consentService.listAuditRows({ days, accessor: g.accessor_gaii, keyPrefix, limit: ROWS_PAGE, offset: more ? cur.offset : 0 });
      const fits = (e) => tg.kind !== 'ws' || targetOf(e.memory_key).rest === tg.rest;
      const rows = r.entries.filter((e) => fits(e) && e.allowed === g.allowed && e.action === g.action);
      setGroupRows((s) => ({ ...s, [id]: { entries: more ? [...cur.entries, ...rows] : rows, total: tg.kind === 'ws' ? g.count : r.total, offset: (more ? cur.offset : 0) + r.entries.length, loading: false } }));
    } catch (e) { swallowed('data-wallet: rows', e); setGroupRows((s) => ({ ...s, [id]: { ...cur, loading: false } })); }
  };

  const setForm = (patch) => setFormState((f) => ({ ...f, ...patch }));
  const toggleForm = (open) => {
    const next = typeof open === 'boolean' ? open : !form.open;
    setForm({ open: next });
    setFormMsg(null);
    if (next) { loadOrgs(); window.setTimeout(() => document.getElementById('dw-grant')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }
  };
  /** Open the form with a person, an organism, a workspace or a key already chosen. */
  const prefillGrant = ({ who = '', orgId = '', wsId = '', key = '' } = {}) => {
    const person = who && !who.startsWith('shared#') && who !== 'anonymous' ? who.replace(/^ghii:/, '') : '';
    setFormState((f) => ({ ...f, open: true, whoKind: 'contact', who: person, what: key ? 'key' : wsId ? 'ws' : orgId ? 'org' : f.what, orgId: orgId || f.orgId, wsId: wsId || '', key: key || '', may: 'read' }));
    setFormMsg(null);
    loadOrgs();
    if (orgId) setOrgs((cur) => (cur.some((o) => o.id === orgId) ? cur : [...cur, { id: orgId, name: names.organisms?.[orgId] || orgId, workspaces: null }]));
    window.setTimeout(() => document.getElementById('dw-grant')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const submitGrant = async () => {
    const f = form;
    const flash = flashFor(setFormMsg);
    const who = f.who.trim();
    let recipient;
    if (f.whoKind === 'all') recipient = '*';
    else if (f.whoKind === 'nodeUsers') recipient = `node:${nodeId}`;
    else if (f.whoKind === 'orgMembers') recipient = f.orgId ? `organism.${f.orgId}` : '';
    else recipient = who.includes('#') ? who : `ghii:${who.includes('@') ? who : `${who}@${nodeId}`}`;
    if (!recipient) { flash(x('form.needWho'), true); return; }
    const pattern = f.what === 'key' ? f.key.trim() : f.what === 'ws' ? `organism.${f.orgId}.w.${f.wsId}.**` : `organism.${f.orgId}.**`;
    const expires = f.untilKind === 'date' && f.until ? new Date(f.until + 'T23:59:59').toISOString() : null;
    setBusy('grant');
    try {
      if (f.what === 'ws' && f.whoKind === 'contact' && !expires && f.scope === 'private') {
        // A person on a workspace is a workspace role: the same door the Organisms page uses, so the
        // member list there and the permission here are one record.
        const grantee = who.includes('#') ? who : who.includes('@') ? who : `${who}@${nodeId}`;
        const r = await apiPost(`/v1/organisms/${encodeURIComponent(f.orgId)}/workspace-access/grant`, { ws: f.wsId, grantee, role: f.may === 'write' ? 'contributor' : 'viewer' });
        if (r?.ok === false) throw r;
      } else {
        const r = await consentService.grantConsent({ data_pattern: pattern, recipient, purpose: f.why.trim() || 'general', scope: f.scope, expires });
        if (r?.ok === false) throw r;
      }
      const said = x('granted', { who: whoOf(recipient, names).name });
      flash(said);
      toast(said);
      setFormState({ ...EMPTY_FORM, open: false });
      await load();
    } catch (e) { flash(errText(e, x('grantFailed')), true); }
    setBusy(false);
  };

  const revoke = (c) => {
    const who = whoOf(c.recipient, names).name;
    const tw = targetWords(c.data_pattern, names);
    confirm(x('confirmRevoke', { who, target: `${tw.title} · ${tw.sub}`, role: x('role.' + roleOf(c)) }), async () => {
      setBusy(c.id);
      try {
        const r = await consentService.revokeConsent(c.id);
        if (r?.ok === false) throw r;
        toast(x('revoked', { who }));
        await load();
      } catch (e) { toast(errText(e, x('revokeFailed')), true); }
      setBusy(false);
    }, { danger: true });
  };

  const exportAll = async () => {
    setExporting(true);
    const flash = flashFor(setExportMsg);
    try {
      const data = await consentService.exportGdpr(session.owner);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flash(x('exported', { mb: Math.max(1, Math.round(blob.size / 100000) / 10) }));
    } catch (e) { swallowed('data-wallet: export', e); flash(x('exportFailed'), true); toast(x('exportFailed'), true); }
    setExporting(false);
  };

  const ctx = {
    session, federated, ov, failed, names, consents, active, revokedList, targets, people, kinds, groups, events, trail, shownTrail,
    days, reloading, deniedCount, deniedGroups: deniedGroupsList.length, manifestDenied, manifestShare: deniedCount ? manifestDenied / deniedCount : 0,
    swapped, expiring, quota, filter, trailFilter, personFocus, openTarget, openGroup, groupRows, form, orgs, formMsg, exportMsg, exporting, exportName, busy, ConfirmUI,
    setDays, setFilter, setTrailFilter, toggleTarget, toggleGroup, showMoreTrail, showPerson, loadGroupRows, setForm, toggleForm, prefillGrant, submitGrant, revoke, exportAll,
    openOrganisms: () => openTab('organisms'),
    openAgents: () => openTab('agents'),
    groupId,
  };
  return renderPage(ctx);
}

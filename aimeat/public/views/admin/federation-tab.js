/**
 * @file federation-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Federation page in the poster face (design canvas "AIMEAT Admin Federation"):
 *   where this node stands with the other AIMEAT nodes it talks to, and what is waiting on a person.
 *
 *   ADDING A PEER CONNECTS NOTHING. The direct door writes `pending`, approving a peering request
 *   writes `approved`, and Activate takes either — so the commonest state on this page is a peer
 *   somebody added and never switched on. The page counted active, degraded, offline and pending
 *   REQUESTS, so both roads into a peer ended with the number the operator was watching going to
 *   zero while nothing else moved. Section 01 is the list of things waiting, not a row of counters.
 *
 *   ELEVEN SECTIONS AND TWENTY EXPLAINERS became six sections and three reference doors. Half the
 *   old page was documentation wedged between the controls: six topics under "How federation works",
 *   nine under the bus, five one per section, and twenty-five endpoint lines. Same text, at the foot.
 *
 *   THE TIER LADDER AND THE PER-PEER SWITCHES ARE UNTOUCHED. That control was written on 2026-08-23
 *   and corrected on 2026-09-03, it explains its own clamp, and rebuilding it would have thrown away
 *   two rounds of work to gain nothing. → federation-peer-policy.js
 * @structure
 *   - AskAi (07) — the federation tool, and the paste
 *   - FederationTab (default) — one read, six sections, and the actions
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face. One read (GET /v1/admin/federation/overview) that carries
 *     the standing, what waits on a person, the sign-in reach, what this node offers and the book's
 *     age, in place of five calls and arithmetic in the browser.
 *   v1.6.0 — 2026-09-05 — The emoji on headings and buttons go, and the heavy check and cross marks become ✓ and ✗: no emoji anywhere in the interface.
 *   v1.5.0 — 2026-09-01 — A peer with no verification key cannot be switched on, so the operator
 *     needs to see whether they have any: a "Without a key" tile and a line naming them, both shown
 *     only when the count is above zero.
 *   v1.4.0 — 2026-06-19 — Federation book: a Version column + "behind" badge in the live-peers
 *     table, and a Federation Book section (operators + resources + version + settings per node,
 *     with Rebuild on the primary / Mirror-from-genesis on leaves).
 *   v1.3.0 — 2026-06-19 — Phase B: Promote button is eligibility-aware (uses promotion_eligible /
 *     promotion_failing from the API; forced override prompts when not yet eligible).
 *   v1.2.0 — 2026-06-19 — Visiting-node tier: Tier + Availability badges in the live-peers
 *     table, an "open join" toggle, and a Promote (vouch) button for visiting peers.
 *   v1.1.0 — 2026-06-02 — Admin design unification: inline button color style
 *     on the approve action → adm-btn-success.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, useToast, Toast, Row } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getNodeUrl } from '/js/services/auth.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import * as api from '/js/services/admin.js';
import { WhereWeStand, WhoMaySignIn } from './federation-tab.stands.js';
import { PeerTable, AskingToJoin } from './federation-tab.peers.js';
import { TheBook, WhatIsOffered, Reference, AddPeerForm, TestNodeForm } from './federation-tab.book.js';
import { buildFederationPrompt } from './federation-tab.prompt.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** Section 07: the tool, and the paste. */
function AskAi({ overview }) {
  const paste = buildFederationPrompt({
    url: getNodeUrl(), peers: overview.peers.total, standing: overview.standing,
  });
  return html`
    <section class="og-sec" id="adm-fed-07">
      <div class="og-sec-h">
        <h2>${S('ai.title')}<small>07</small></h2>
        <div class="og-doors">
          <${CopyButton} text=${paste} label=${S('ai.copy')} className="og-door og-door--quiet" />
        </div>
      </div>
      <div class="adm-two">
        <div class="adm-half">
          <p class="adm-fed-lead">${S('ai.lead')}</p>
          ${Row({ title: S('ai.tool'), why: S('ai.toolWhy'), chip: null, value: 'aimeat_admin_federation', last: true })}
        </div>
        <div class="og-box">
          <span class="og-box-label">${S('ai.label')}</span>
          <div class="adm-fed-paste">${paste}</div>
        </div>
      </div>
    </section>`;
}

export default function FederationTab({ data, reload }) {
  useViewCSS('/css/views/admin-federation.css');
  const livePeers = data.livePeers || [];
  const requests = data.federation || [];

  const [overview, setOverview] = useState(null);
  const [failed, setFailed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  // ── The one read ──
  const load = useCallback(async () => {
    try {
      const r = await api.getFederationOverview();
      if (r?.data) { setOverview(r.data); setFailed(null); }
    } catch (e) {
      swallowed('federation-tab', e);
      setFailed(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['federation'], () => load()), [load]);

  const refresh = useCallback(() => { load(); reload(); }, [load, reload]);

  // ── The network directory, which is its own search and its own call ──
  const [dirEntries, setDirEntries] = useState([]);
  const [dirQ, setDirQ] = useState('');
  const [dirLoading, setDirLoading] = useState(false);
  const dirTimer = useRef(null);

  const loadDirectory = useCallback(async (keyword) => {
    setDirLoading(true);
    try {
      const r = await api.getNetworkDirectory(keyword || '');
      setDirEntries(r.data?.entries || []);
    } catch (e) { swallowed('federation-tab', e); setDirEntries([]); }
    finally { setDirLoading(false); }
  }, []);
  useEffect(() => { loadDirectory(''); }, [loadDirectory]);
  useEffect(() => {
    if (dirTimer.current) clearTimeout(dirTimer.current);
    dirTimer.current = setTimeout(() => loadDirectory(dirQ), dirQ ? 400 : 0);
    return () => clearTimeout(dirTimer.current);
  }, [dirQ, loadDirectory]);

  // ── The writes ──
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) showOk(okMsg); refresh(); }
    catch (e) { swallowed('federation-tab', e); showErr(e.message); }
    finally { setBusy(false); }
  }, [refresh, showErr, showOk]);

  const savePolicy = useCallback(async (policy, scopes) => {
    setSaving(true);
    try {
      await api.saveConfig([
        { path: 'federation.auth_policy', value: policy },
        { path: 'federation.default_scopes', value: scopes.join(',') },
      ]);
      showOk(S('signin.saved'));
      load();
    } catch (e) { swallowed('federation-tab', e); showErr(e.message); }
    finally { setSaving(false); }
  }, [load, showErr, showOk]);

  const onScope = useCallback((scope) => {
    if (!overview) return;
    const has = overview.signin.scopes.includes(scope);
    savePolicy(overview.signin.policy, has
      ? overview.signin.scopes.filter(s => s !== scope)
      : [...overview.signin.scopes, scope]);
  }, [overview, savePolicy]);

  const onOpenJoin = useCallback(async (v) => {
    setSaving(true);
    try {
      await api.saveConfig([{ path: 'federation.open_join', value: v }]);
      showOk(S('signin.saved'));
      load();
    } catch (e) { swallowed('federation-tab', e); showErr(e.message); }
    finally { setSaving(false); }
  }, [load, showErr, showOk]);

  const onActivate = useCallback((nodeId) => {
    confirm(S('confirm.switchOn', { node: nodeId }), () =>
      run(() => api.activatePeer(nodeId), S('done.switchedOn')));
  }, [confirm, run]);

  const onPromote = useCallback((p) => {
    // `run` reports its own failure and resolves, so there is nothing to catch here.
    const go = (force) => run(() => api.promotePeer(p.node_id, force ? { force: true } : {}), S('done.promoted'));
    if (p.promotion_eligible) confirm(S('confirm.promote', { node: p.node_id }), () => go(false));
    else confirm(S('confirm.promoteAnyway', { why: (p.promotion_failing || []).join(', ') }), () => go(true));
  }, [confirm, run]);

  const onRemove = useCallback((nodeId) => {
    confirm(S('confirm.depeer', { node: nodeId }), () =>
      run(() => api.removePeer(nodeId), S('done.depeered')), { danger: true });
  }, [confirm, run]);

  const onEmergency = useCallback((nodeId) => {
    confirm(S('confirm.cutOff', { node: nodeId }), () =>
      run(() => api.removePeerEmergency(nodeId), S('done.cutOff')), { danger: true });
  }, [confirm, run]);

  const onPolicyCell = useCallback((nodeId, field, value) =>
    run(() => api.updatePeerPolicy(nodeId, { [field]: value }), S('done.policySaved')), [run]);

  const onApprove = useCallback((id) => {
    confirm(S('confirm.approve'), () => run(() => api.approvePeeringRequest(id), S('done.approved')));
  }, [confirm, run]);

  const onReject = useCallback((id) => {
    confirm(S('confirm.refuse'), () => run(() => api.rejectPeeringRequest(id), S('done.refused')), { danger: true });
  }, [confirm, run]);

  const onDeleteRequest = useCallback((id) => {
    confirm(S('confirm.forget'), () => run(() => api.deletePeeringRequest(id), S('done.forgotten')), { danger: true });
  }, [confirm, run]);

  const onAdd = useCallback((nodeId, url, key) => {
    try { new URL(url); } catch { showErr(S('add.badUrl')); return; }
    run(() => api.addPeerDirect(nodeId, url, key), S('done.added')).then(() => setAdding(false));
  }, [run, showErr]);

  const onTest = useCallback(async (url) => {
    setBusy(true); setTestResult(null);
    try { const r = await api.testFederationNode(url); setTestResult(r.data || r); }
    catch (e) { setTestResult({ error: e.message }); }
    finally { setBusy(false); }
  }, []);

  const onRebuildBook = useCallback(() =>
    run(() => api.rebuildFederationBook(), S('done.bookRebuilt')), [run]);
  const onMirrorBook = useCallback(() =>
    run(() => api.pullFederationBook(), S('done.bookMirrored')), [run]);

  const goTo = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (failed && !overview) return html`<${ErrorBox} message=${failed} />`;
  if (!overview) return html`<${Spinner} text=${S('loading')} />`;

  // The roster carries the version delta; the peer rows carry the switches and the actions. Joined
  // by node id rather than merged on the server, because the switches are the policy cell's own
  // contract and this page is not the place to restate it.
  const byId = new Map(overview.roster.map(r => [r.node_id, r]));
  const peers = livePeers.map(p => ({ ...p, versions_behind: byId.get(p.node_id)?.versions_behind ?? null }));
  const history = requests.filter(r => r.status !== 'pending');

  return html`<div class="adm-fed">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${WhereWeStand} data=${overview}
      onGoPeers=${goTo('adm-fed-03')} onGoRequests=${goTo('adm-fed-05')} />

    <${WhoMaySignIn} data=${overview} saving=${saving}
      onPolicy=${(p) => savePolicy(p, overview.signin.scopes)}
      onScope=${onScope} onOpenJoin=${onOpenJoin} />

    <${PeerTable} peers=${peers} overview=${overview}
      onActivate=${onActivate} onPromote=${onPromote} onRemove=${onRemove}
      onEmergency=${onEmergency} onPolicy=${onPolicyCell}
      onAdd=${() => { setAdding(a => !a); setTesting(false); }}
      onTest=${() => { setTesting(x => !x); setAdding(false); }} />
    ${adding && html`<${AddPeerForm} busy=${busy} onAdd=${onAdd} onClose=${() => setAdding(false)} />`}
    ${testing && html`<${TestNodeForm} busy=${busy} result=${testResult}
      onTest=${onTest} onClose=${() => { setTesting(false); setTestResult(null); }} />`}

    <${TheBook} overview=${overview} onRebuild=${onRebuildBook} onMirror=${onMirrorBook} />

    <${AskingToJoin} overview=${overview} history=${history}
      historyOpen=${historyOpen} onToggleHistory=${() => setHistoryOpen(o => !o)}
      onApprove=${onApprove} onReject=${onReject} onDelete=${onDeleteRequest} />

    <${WhatIsOffered} entries=${dirEntries} loading=${dirLoading} q=${dirQ} onQ=${setDirQ} />

    <${AskAi} overview=${overview} />
    <${Reference} />
    <${ConfirmUI} />
  </div>`;
}

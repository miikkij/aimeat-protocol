/**
 * @file mcp-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › MCP: the AIs a person has connected here, listed agent by agent with what
 *   each may do and when it last spoke; how to connect a new one and prove the connection; the
 *   instructions every conversation starts with; and whether the AI may suggest things. Holds the
 *   state, the loads and the handlers; renders the poster face (mcp/page.js, mcp/connect.js,
 *   mcp/instructions.js). Live: re-fetches on the aimeat-live-update event for agents and chat.
 * @structure McpTab — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'mcp'.
 * @version-history
 *   v2.0.0 — 2026-09-02 — The poster face (design canvas "AIMEAT MCP-sivu", direction A). The list
 *     is per agent from the MCP door's own mark (`mcp_last_seen`), the older per-tool rows stay
 *     until their agent connects again, "Disconnect" deletes the agent (which revokes its keys)
 *     instead of hiding a row, and the setup guide, the proof, the instruction block, the organism
 *     prompt and the suggestions switch are sections of one page rather than a walkthrough in
 *     front of a list. The developer-portal hint is gone: the guide is on this page.
 *   v1.2.0 — 2026-08-22 — The proactive-guidance switch lives here, because this is the page about
 *     the AIs connected to this account and the setting is about how they behave. It reads and
 *     writes /v1/settings/proactive; an AI asked to stop offering things writes the same setting
 *     itself, so this switch shows who changed it last.
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; fix fallback strings
 *   v1.0.0 — 2026-03-16 — Initial MCP tab
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { useConfirm } from '/components/Modal.js';
import { listChatInstances, deleteChatInstance, listAgents, deleteAgent } from '/js/services/agents.js';
import { checkHelloMcp, fetchHelloMcpPrompt, fetchOrganismSetupPrompt } from '/js/services/hello-mcp.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { useAiTools } from '/views/profile/ai-tool-setup.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { m, buildRows, goTab } from './mcp/frame.js';
import { renderPage } from './mcp/page.js';

export default function McpTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const tools = useAiTools();
  const [agents, setAgents] = useState(null);
  const [instances, setInstances] = useState([]);
  const [proactive, setProactive] = useState(null);
  const [savingProactive, setSavingProactive] = useState(false);
  const [proof, setProof] = useState(null);        // { passed, at, tool } once read
  const [proofState, setProofState] = useState('idle'); // idle | fail | pass
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(null);           // the row being disconnected
  const [folds, setFolds] = useState({ proof: false, org: false, guide: false });
  const [organisms, setOrganisms] = useState(null);
  const [orgId, setOrgId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [orgPrompt, setOrgPrompt] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);
  const [found, setFound] = useState(null);         // what the last explicit refresh found

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), 'error');

  /* ── loads ── */

  const load = useCallback(async () => {
    // The list and the setting are read apart: an AI can flip the setting between two visits, and
    // a failure on one read must not blank the other.
    try {
      const [ag, ci] = await Promise.all([
        listAgents(session?.owner),
        listChatInstances().catch((err) => { swallowed('mcp-tab: instances', err); return []; }),
      ]);
      setAgents(ag);
      setInstances(ci);
      onStats?.({ mcpConnections: buildRows(ag, ci).length });
    } catch (err) { swallowed('mcp-tab', err); setAgents([]); }
    try {
      const res = await apiGet('/v1/settings/proactive');
      setProactive(res.data ?? null);
    } catch (err) { swallowed('mcp-tab: proactive setting', err); }
  }, [session, onStats]);

  useEffect(() => { if (session) load(); }, [session, load]);
  const liveRef = useRef(null);
  liveRef.current = () => load();
  useEffect(() => onLiveUpdate(['agents', 'chat'], () => liveRef.current()), []);

  useEffect(() => {
    fetchHelloMcpPrompt().then(setPrompt).catch((err) => swallowed('mcp-tab: prompt', err));
    // The initial read decides which half of the connect section renders: a person who already
    // proved the connection is never shown the proof step open again.
    checkHelloMcp()
      .then((r) => { setProof(r); setProofState(r.passed ? 'pass' : 'idle'); })
      .catch((err) => swallowed('mcp-tab: initial check', err));
  }, []);

  // getOrganismsTab().mine, not listOrganisms({member:'me'}): the member filter returns nothing for
  // the owner's own organisms. The refresh button ALWAYS reports what it found (a silent refetch
  // read as a dead button for a person who already had organisms).
  const loadOrgs = useCallback((announce) => {
    if (announce) { setOrgBusy(true); setFound(null); }
    return getOrganismsTab()
      .then((tab) => {
        const arr = (tab && tab.mine) || [];
        setOrganisms((prev) => {
          if (announce) {
            const before = new Set((prev || []).map((o) => o.id));
            const fresh = arr.find((o) => !before.has(o.id));
            if (fresh) { setOrgId(fresh.id); setFound({ ok: true, name: fresh.name || fresh.id }); }
            else setFound({ ok: false, count: arr.length });
          }
          return arr;
        });
        setOrgId((prev) => prev || (arr[0] ? arr[0].id : ''));
      })
      .catch((err) => { swallowed('mcp-tab: organisms', err); setOrganisms([]); if (announce) setFound({ ok: false, failed: true }); })
      .finally(() => { if (announce) setOrgBusy(false); });
  }, []);
  useEffect(() => { loadOrgs(false); }, [loadOrgs]);
  useEffect(() => {
    fetchOrganismSetupPrompt(purpose).then(setOrgPrompt).catch((err) => swallowed('mcp-tab: organism prompt', err));
  }, [purpose]);

  /* ── the proof ── */

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await checkHelloMcp();
      setProof(r);
      setProofState(r.passed ? 'pass' : 'fail');
      if (r.passed) { showToast?.(m('proofPassedToast')); setFolds((f) => ({ ...f, proof: false })); load(); }
    } catch (err) { swallowed('mcp-tab: check', err); setProofState('fail'); }
    finally { setChecking(false); }
  }, [showToast, load]);

  /* ── the rows ── */

  const rows = buildRows(agents || [], instances);

  const openAgent = (row) => {
    if (!row.agent) return;
    try { sessionStorage.setItem('aimeat.agents.open', row.agent.name); } catch (err) { swallowed('mcp-tab: open agent', err); }
    goTab('agents');
  };

  function disconnect(row) {
    // Ending the agent is the only cut that holds: its sessions are revoked before the record goes,
    // and the connection row goes with it. A tool row whose agent is already gone has nothing left
    // to revoke, so that one is simply removed.
    const message = row.gone ? m('removeRowConfirm', { tool: row.tool }) : m('disconnectConfirm', { name: row.name, tool: row.tool });
    confirm(message, async () => {
      setBusy(row.id);
      try {
        if (row.gone || !row.agent) await deleteChatInstance(row.id);
        else await deleteAgent(row.agent.name);
        showToast?.(row.gone ? m('removedRowToast') : m('disconnectedToast', { name: row.name }));
        await load();
      } catch (e) { fail(e); }
      finally { setBusy(null); }
    }, { danger: true });
  }

  /* ── the suggestions switch ── */

  const setProactiveEnabled = useCallback(async (enabled) => {
    // The switch has no disabled state, so the guard is here: a second flip while the first is in
    // flight would race two writes and show whichever answered last.
    if (savingProactive) return;
    setSavingProactive(true);
    try {
      const res = await apiPut('/v1/settings/proactive', { enabled });
      setProactive(res.data ?? null);
      showToast?.(enabled ? t('profile.mcp.proactiveOn') : t('profile.mcp.proactiveOff'));
    } catch (err) { swallowed('mcp-tab: proactive save', err); showToast?.(t('profile.mcp.proactiveError'), 'error'); }
    finally { setSavingProactive(false); }
  }, [showToast, savingProactive]);

  const setFold = (k, open) => setFolds((f) => ({ ...f, [k]: open }));

  const ctx = {
    session, tools, agents, instances, rows, proactive, proof, proofState, checking, prompt, busy, folds,
    organisms, orgId, purpose, orgPrompt, orgBusy, found, ConfirmUI,
    check, openAgent, disconnect, setProactiveEnabled, setFold,
    setOrgId, setPurpose, refreshOrgs: () => loadOrgs(true), showToast,
  };
  return renderPage(ctx);
}

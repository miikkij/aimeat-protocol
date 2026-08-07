/**
 * @file agents-tab.js
 * @description Profile tab for managing AI agents -- Shared Agent Board,
 *   expandable agent cards with Two-Zone Header + 8-tab interface,
 *   device auth flow, scope management modal.
 * @version-history
 *   v3.3.0 -- 2026-07-14 -- Task-runner section: add a "View the crewaimeat fleet on GitHub"
 *     link (github.com/miikkij/crewaimeat) with the GitHub Octocat mark.
 *   v3.2.0 -- 2026-07-13 -- Split (max-file-lines): moved scope constants/labels, connect
 *     prompts + platform instructions, per-browser tab helpers, the filter bar / active-tasks
 *     panel / grouped renderer, and the scope modal into ./agents/ sibling modules
 *     (scope-config, connect-prompts, tab-helpers, groups-render, scopes-modal). No behaviour change.
 *   v3.1.0 -- 2026-06-21 -- Perf: loadData() now makes ONE request (GET /v1/agents?include=stats)
 *     instead of 1 + N×5 per-agent fan-out; change badges become has-unseen dots derived from
 *     latest-activity timestamps; device-auth + fleet refresh are push-only (domain-filtered
 *     live updates, no setInterval polling).
 *   v1.0.0 -- 2026-03-17 -- Refactor: replace all inline styles with CSS utility classes
 *   v1.1.0 -- 2026-03-18 -- Rewrite agent prompt to use device-auth flow; remove connectivity key UI
 *   v1.2.0 -- 2026-03-19 -- Replace profile-initiated device auth with inline pending request approval
 *   v1.3.0 -- 2026-05-21 -- Shorten agent prompt to delegate to tier1; add Download/Copy Instructions buttons
 *   v1.x — 2026-06-10 — External deep-link entry: sessionStorage `aimeat.agents.open` (set by the
 *     home dashboard's Agents card) expands that agent's card on mount and scrolls it into view.
 *   v1.4.0 -- 2026-05-21 -- Add sub-tab navigation (Tasks, Directives) in expanded agent detail view
 *   v1.5.0 -- 2026-05-22 -- Add Capabilities sub-tab with technical/domain skill display
 *   v1.6.0 -- 2026-06-02 -- Component unification (#2): scope modal uses the canonical
 *     <Modal> component (className="scope-modal" preserves width; adds Escape/✕ close)
 *   v1.6.0 -- 2026-05-22 -- Add Activity sub-tab with stats, chart, scheduled jobs, event log
 *   v1.7.0 -- 2026-05-22 -- Add Services and Messages sub-tabs
 *   v2.1.0 -- 2026-05-24 -- Fix: scroll-to on board click, agent count badge in header
 *   v2.0.0 -- 2026-05-24 -- Plan 4: Shared Agent Board + expandable cards with Two-Zone Header + 8-tab bar
 *   v2.2.0 -- 2026-05-24 -- Fix M2: compact Connect Agent, C1: load task stats for production cards
 *   v3.0.0 -- 2026-05-27 -- Rewrite: safe connection prompt, CLI-first UI, remove injection-flagged language
 *   v3.0.1 -- 2026-05-28 -- Show the connect command as a single copyable line
 *   v3.0.2 -- 2026-05-28 -- Add paste-ready agent onboarding instruction and clarify agent/runtime wording
 *   v3.0.3 -- 2026-05-28 -- Track copy state per connection button
 *   v3.0.4 -- 2026-05-28 -- Align copied MCP onboarding prompt with Hello Integration auto-start flow
 *   v3.0.5 -- 2026-05-28 -- Include task TODO completion in the MCP onboarding prompt
 *   v3.0.6 -- 2026-05-28 -- Clarify MCP tool names are not terminal commands
 *   v3.0.7 -- 2026-05-28 -- Include required telemetry reporting in the MCP onboarding prompt
 *   v3.0.8 -- 2026-05-28 -- State that Hello Integration is required first-run onboarding
 *   v3.0.9 -- 2026-05-28 -- Explain connector benefits and shared tag memory in agent prompts
 *   v3.1.0 -- 2026-05-28 -- Explain connector and fallback connection options before commands
 *   v3.2.0 -- 2026-05-29 -- Tag filter bar + group-by toggle (none / tag / mode)
 *   v3.3.0 -- 2026-05-29 -- Add "Connect a task-runner" collapsible with CrewAI-shaped paste prompt
 *   v3.4.0 -- 2026-05-31 -- Drag-to-reorder agent bars (per-browser localStorage order, ungrouped/unfiltered list only) + pop-out button opening an agent in its own window (/v1/profile?solo=)
 *   v3.5.0 -- 2026-06-02 -- Component unification: replace 4 bespoke copy-prompt buttons
 *     (connect command, MCP onboarding, manual agent prompt, task-runner prompt) with the
 *     canonical <CopyButton> (className="copy-prompt-btn" preserves appearance); removed the
 *     now-dead copiedAction state + markCopied helper.
 *   v3.8.0 -- 2026-06-10 -- "Group by: Tag" becomes the default once any agent carries tags
 *     (never overrides a user-picked grouping); unseen-change tracking drops memory churn and
 *     adds a failed-tasks query so the badge can go red ONLY for unseen failures (tasksFailed);
 *     marking the Tasks tab seen also acknowledges failures. External deep-link entry
 *     (aimeat.agents.open) from the home dashboard retained from earlier same-day round.
 *   v3.7.0 -- 2026-06-09 -- Custom agent groups: new "Custom groups" group-by mode with
 *     user-created, drag-to-assign sections (definitions in AIMEAT memory via
 *     getAgentGroups/saveAgentGroups) and per-browser collapse/expand state
 *     (localStorage). Group-by selector now always shown (was hidden when no tags).
 *   v3.6.0 -- 2026-06-03 -- Fleet "running now" panel between the agent board and
 *     the list: every agent's currently-active tasks in one list (reuses the
 *     active tasks already fetched in loadData, so no extra requests); clicking a
 *     row deep-links into that agent's Tasks tab and auto-opens the task
 *     (expandedAgent + deepLink → AgentCard preSelectedTab/openTaskId).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Spinner } from './shared.js';
import { apiGet, apiPost, apiPatch } from '/js/api.js';
import { listAgents, updateAgentScopes, deleteAgent, getAgentGroups, saveAgentGroups } from '/js/services/agents.js';
import { getNodeUrl } from '/js/services/auth.js';
import { useConfirm } from '/components/Modal.js';
import SharedBoard from './agents/shared-board.js';
import { AgentConsent } from '/components/AgentConsent.js';
import { buildAgentPrompt, buildTaskRunnerPrompt, buildMcpOnboardingPrompt, PLATFORMS, PLATFORM_KEYS, PLATFORM_LABELS } from './agents/connect-prompts.js';
import { loadAgentOrder, saveAgentOrder, UNGROUPED_ID, loadCollapsedGroups, saveCollapsedGroups, loadSeen, saveSeen, markTabSeen, effectiveOrderedNames, popOutAgent } from './agents/tab-helpers.js';
import { renderFilterBar, ActiveTasksPanel, renderAgentGroups } from './agents/groups-render.js';
import ScopesModal from './agents/scopes-modal.js';
import { swallowed } from '/js/swallowed.js';

// The familiar GitHub "Octocat" mark. fill=currentColor so it inherits the link's themed color.
const GhMark = html`<svg class="gh-mark" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;

export default function AgentsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [agents, setAgents] = useState(null);
  const [onboardings, setOnboardings] = useState({});
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [scopesModal, setScopesModal] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [connectExpanded, setConnectExpanded] = useState(false);
  const [pasteExpanded, setPasteExpanded] = useState(false);
  const [taskRunnerExpanded, setTaskRunnerExpanded] = useState(false);
  const [taskRunnerName, setTaskRunnerName] = useState('');
  const [taskStatsMap, setTaskStatsMap] = useState({});
  // Currently-active tasks per agent { name: Task[] } — powers the fleet
  // "running now" panel. Reuses the active list already fetched in loadData().
  const [activeTasksMap, setActiveTasksMap] = useState({});
  // Deep-link request from the running-now panel: { agent, taskId, nonce }.
  // The nonce makes a repeat click re-fire the open even for the same task.
  const [deepLink, setDeepLink] = useState(null);
  const deepLinkNonce = useRef(0);
  // Per-agent unseen-change counts { name: { tasks, messages, memory } } driving
  // the collapsed mini-badge + per-tab number badges. Computed in loadData()
  // from the localStorage "last seen per tab" baseline (see loadSeen + loadData badge logic).
  const [changesMap, setChangesMap] = useState({});
  const [tagFilter, setTagFilter] = useState(new Set());
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'tag' | 'mode' | 'custom'
  // "Group by: Tag" becomes the default once the user actually uses tags — but never
  // override a grouping the user picked themselves (or re-apply after they change it).
  const userPickedGroupBy = useRef(false);
  const groupByDefaultApplied = useRef(false);
  const pickGroupBy = (v) => { userPickedGroupBy.current = true; setGroupBy(v); };
  // Per-browser drag-to-reorder of the agent bars (localStorage-backed).
  const [agentOrder, setAgentOrder] = useState(() => loadAgentOrder(session?.owner));
  const [draggingName, setDraggingName] = useState(null);
  const draggedName = useRef(null);
  // Custom groups: definitions are server-side (AIMEAT memory), the collapse
  // toggle is per-browser. editingGroup holds the id of the group being renamed.
  const [agentGroups, setAgentGroups] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(() => loadCollapsedGroups(session?.owner));
  const [editingGroup, setEditingGroup] = useState(null);
  const draggedAgent = useRef(null);
  const [draggingAgentName, setDraggingAgentName] = useState(null);

  // Load the owner's saved group definitions once per session. Mutations below
  // update state optimistically and persist, so no need to re-fetch on the poll.
  useEffect(() => {
    if (!session) { setAgentGroups([]); return; }
    setCollapsedGroups(loadCollapsedGroups(session.owner));
    getAgentGroups().then(g => setAgentGroups(Array.isArray(g) ? g : [])).catch(() => setAgentGroups([]));
  }, [session]);

  function persistGroups(next) {
    setAgentGroups(next);
    saveAgentGroups(next).catch(e => showToast((e && e.message) || t('profile.agents.groups.saveError'), true));
  }
  function addGroup() {
    const id = 'grp-' + Date.now().toString(36);
    persistGroups([...agentGroups, { id, name: '', agents: [] }]);
    setEditingGroup(id); // open the new group in rename mode immediately
  }
  function renameGroup(id, name) {
    persistGroups(agentGroups.map(g => g.id === id ? { ...g, name } : g));
  }
  function removeGroup(id) {
    const grp = agentGroups.find(g => g.id === id);
    confirm(
      t('profile.agents.groups.confirmRemove').replace('{name}', grp?.name || '…'),
      () => persistGroups(agentGroups.filter(g => g.id !== id)),
    );
  }
  // Move an agent into targetId (a group id, or UNGROUPED_ID to remove it from
  // every group). An agent belongs to at most one group.
  function moveAgentToGroup(agentName, targetId) {
    if (!agentName) return;
    const cleaned = agentGroups.map(g => ({ ...g, agents: (g.agents || []).filter(n => n !== agentName) }));
    const next = targetId === UNGROUPED_ID
      ? cleaned
      : cleaned.map(g => g.id === targetId ? { ...g, agents: [...g.agents, agentName] } : g);
    persistGroups(next);
  }
  function toggleGroupCollapsed(id) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveCollapsedGroups(session?.owner, next);
      return next;
    });
  }

  // Drag-to-assign for custom-group mode: drag an agent bar (grip handle) onto a
  // group header to file it there. Mirrors the document-space section pattern.
  const groupDnd = {
    draggingAgentName,
    onDragStart: (name, e) => {
      draggedAgent.current = name;
      setDraggingAgentName(name);
      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', name); } catch (err) { swallowed('agents-tab: onDragStart', err); }
      }
    },
    onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; },
    onDropToGroup: (targetId) => { moveAgentToGroup(draggedAgent.current, targetId); draggedAgent.current = null; setDraggingAgentName(null); },
    onDragEnd: () => { draggedAgent.current = null; setDraggingAgentName(null); },
  };

  function reorderAgents(fromName, toName) {
    if (!fromName || !toName || fromName === toName || !session || !agents) return;
    const names = effectiveOrderedNames(agents, agentOrder);
    const arr = names.filter(n => n !== fromName);
    const insertAt = arr.indexOf(toName);
    if (insertAt < 0) return;
    arr.splice(insertAt, 0, fromName); // drop BEFORE the target row
    saveAgentOrder(session.owner, arr);
    setAgentOrder(arr);
  }

  // Reordering only makes sense in the flat, unfiltered list.
  const dnd = {
    reorderable: groupBy === 'none' && tagFilter.size === 0,
    draggingName,
    onDragStart: (name, e) => {
      draggedName.current = name;
      setDraggingName(name);
      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', name); } catch (err) { swallowed('agents-tab: onDragStart', err); }
      }
    },
    onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; },
    onDrop: (targetName) => { reorderAgents(draggedName.current, targetName); draggedName.current = null; setDraggingName(null); },
    onDragEnd: () => { draggedName.current = null; setDraggingName(null); },
  };

  // Owner opened a tab on an agent → stamp it seen and clear that badge now.
  // The next loadData() recomputes from the same baseline, keeping it at 0
  // until a new change actually arrives.
  const handleTabSeen = (agentName, tab) => {
    if (!session) return;
    markTabSeen(session.owner, agentName, tab);
    setChangesMap(prev => {
      const cur = prev[agentName];
      if (!cur || !cur[tab]) return prev;
      const next = { ...cur, [tab]: 0 };
      if (tab === 'tasks') next.tasksFailed = 0;   // seen = acknowledged, incl. failures
      return { ...prev, [agentName]: next };
    });
  };

  useEffect(() => {
    if (session) { loadData(); loadPending(); }
    // Fetch the fleet once the session is available. loadData/loadPending close over
    // session and stable setters/refs; keyed on session intentionally (the live-update
    // listener below handles subsequent refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Pending device-auth requests — fetched once on mount and refreshed via the live-update
  // handler below (device-authorize / approve / deny all emit on the 'agents' domain), so no
  // steady-state polling. Loaded together with the live listener effect.
  async function loadPending() {
    try {
      const resp = await apiGet('/v1/agents/device-authorize/pending');
      if (resp?.data?.requests) setPendingRequests(resp.data.requests);
    } catch (err) { swallowed('agents-tab: loadPending', err); }
  }

  async function loadData() {
    try {
      // ONE request for the whole fleet: agents + per-agent stats (task/message counts, latest
      // activity timestamps, active-task list, onboarding) via ?include=stats. Replaces the old
      // 1 + N×5 per-agent fan-out (~185 requests for 46 agents).
      const list = await listAgents(session.owner, { include: 'stats' });
      setAgents(list);
      onStats?.({ agents: list.length });
      if (!groupByDefaultApplied.current && !userPickedGroupBy.current && list.some(a => (a.tags ?? []).length > 0)) {
        groupByDefaultApplied.current = true;
        setGroupBy('tag');
      }

      const obMap = {};
      const tsMap = {};
      const atsMap = {};
      const chMap = {};
      const seen = loadSeen(session.owner);
      let seenSeeded = false;
      const nowIso = new Date().toISOString();

      for (const a of list) {
        const st = a.stats || {};
        const tasks = st.tasks || {};
        obMap[a.name] = st.onboarding || null;
        tsMap[a.name] = {
          done: tasks.doneToday || 0,    // completed today (live state-count)
          active: tasks.active || 0,
          failed: tasks.failed || 0,
          queued: tasks.queued || 0,
        };
        atsMap[a.name] = st.active_tasks || [];

        // Has-unseen badge (a dot, not an exact count): compare the agent's latest activity
        // timestamp against the per-tab `seen` baseline. First observation seeds the baseline to
        // "now" so an agent's whole history is never dumped as "new". Red = unseen FAILED task.
        const agentSeen = seen[a.name] || (seen[a.name] = {});
        const lastTaskAt = tasks.lastTaskUpdateAt || null;
        const lastMsgAt = (st.messages && st.messages.lastMessageAt) || null;
        const lastFailedAt = tasks.lastFailedAt || null;
        const ch = {};
        for (const [tab, latest] of [['tasks', lastTaskAt], ['messages', lastMsgAt]]) {
          if (agentSeen[tab] === undefined) { agentSeen[tab] = nowIso; seenSeeded = true; ch[tab] = 0; }
          else ch[tab] = (latest && latest > agentSeen[tab]) ? 1 : 0;
        }
        ch.tasksFailed = (agentSeen.tasks !== nowIso && lastFailedAt && lastFailedAt > agentSeen.tasks) ? 1 : 0;
        chMap[a.name] = ch;
      }

      setOnboardings(obMap);
      setTaskStatsMap(tsMap);
      setActiveTasksMap(atsMap);
      // Persist any freshly-seeded baselines. Merge against the latest storage so a tab the user
      // opened mid-fetch (markTabSeen) is not overwritten.
      if (seenSeeded) {
        const fresh = loadSeen(session.owner);
        for (const name of Object.keys(seen)) {
          const merged = fresh[name] || (fresh[name] = {});
          for (const tab of Object.keys(seen[name])) {
            if (merged[tab] === undefined) merged[tab] = seen[name][tab];
          }
        }
        saveSeen(session.owner, fresh);
      }
      setChangesMap(chMap);
    } catch (err) { swallowed('agents-tab', err); setAgents([]); }
  }

  // Live updates (push-only, no steady-state polling): refetch the fleet only when a relevant
  // domain actually changed. Hidden tabs are already gated upstream (live-updates.js), so a
  // background tab does nothing here.
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  const pendingRef = useRef(loadPending);
  pendingRef.current = loadPending;
  useEffect(() => {
    const FLEET_DOMAINS = ['agents', 'agent-tasks', 'agent-messages', 'agent-onboarding'];
    const handler = (e) => {
      const d = e.detail?.domains;           // Set<string> | null (null = everything changed)
      if (d && !FLEET_DOMAINS.some(x => d.has(x))) return;
      loadRef.current();
      if (!d || d.has('agents')) pendingRef.current();   // device-auth requests ride the 'agents' domain
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  function toggleAgent(name) {
    setExpandedAgent(prev => prev === name ? null : name);
  }

  // External deep-link: the home dashboard's Agents card primes `aimeat.agents.open` with an
  // agent name before opening this tab — expand that agent and scroll its card into view.
  useEffect(() => {
    try {
      const name = sessionStorage.getItem('aimeat.agents.open');
      if (!name) return;
      sessionStorage.removeItem('aimeat.agents.open');
      setExpandedAgent(name);
      setTimeout(() => {
        document.querySelector(`[data-agent-name="${name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
  }, []);

  // Running-now panel → open a specific agent's Tasks tab on a specific task.
  // Expand the agent, record the deep-link (nonce bump re-fires repeat clicks),
  // and scroll the agent's card into view.
  function openAgentTask(name, taskId) {
    setExpandedAgent(name);
    deepLinkNonce.current += 1;
    setDeepLink({ agent: name, taskId, nonce: deepLinkNonce.current });
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-agent-name="${name}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handleSaveScopes(agentName, newScopes) {
    try {
      const resp = await updateAgentScopes(agentName, newScopes);
      if (resp.ok !== false) {
        showToast(t('profile.agents.scopeUi.saved'));
        setScopesModal(null);
        loadData();
      } else {
        showToast(resp?.error?.message || t('profile.agents.scopeUi.saveError'), true);
      }
    } catch (err) {
      swallowed('agents-tab: handleSaveScopes', err);
      showToast(t('profile.agents.scopeUi.saveError'), true);
    }
  }

  // Scopes come from the shared consent panel, which owns the preset choice — this stays the
  // approve action so the tab keeps its own toast, list update and reload.
  async function handleApprove(userCode, scopes) {
    try {
      const resp = await apiPost('/v1/agents/verify', {
        user_code: userCode,
        action: 'approve',
        scopes,
        owner_token: session.jwt,
      });
      if (resp?.ok !== false) {
        showToast(t('profile.agents.pendingRequests.approved'));
        setPendingRequests(prev => prev.filter(r => r.user_code !== userCode));
        loadData();
      } else {
        showToast(resp?.error?.message || t('profile.agents.pendingRequests.approveError'), true);
      }
    } catch (err) {
      swallowed('agents-tab: handleApprove', err);
      showToast(t('profile.agents.pendingRequests.approveError'), true);
    }
  }

  function handleDeleteAgent(name) {
    confirm(t('profile.agents.deleteConfirm') + ': ' + name + '?', async () => {
      try {
        await deleteAgent(name);
        showToast(t('profile.agents.deleted'));
        loadData();
      } catch (err) { swallowed('agents-tab', err); showToast(t('profile.unknownError'), true); }
    });
  }

  async function handleDeny(userCode) {
    try {
      await apiPost('/v1/agents/verify', {
        user_code: userCode,
        action: 'deny',
        owner_token: session.jwt,
      });
      showToast(t('profile.agents.pendingRequests.denied'));
      setPendingRequests(prev => prev.filter(r => r.user_code !== userCode));
      loadData();
    } catch (e) {
      showToast(e.message || 'Deny failed', true);
    }
  }

  async function toggleFederate(agent) {
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/federate`, { federate: !agent.federate });
      loadData();
    } catch (e) { showToast(e.message || t('profile.unknownError'), true); }
  }

  if (!agents) return html`<${Spinner} text=${t('profile.agents.loadingAgents')} />`;

  return html`
    <div class="pf-agd-header-row">
      <div class="section-title">${t('profile.agents.title')}${agents.length > 0 ? html` <span class="pf-agd-count-badge">(${agents.length})</span>` : ''}</div>
      <button class="${connectExpanded ? 'btn-outline' : 'btn-primary'} btn-sm" onClick=${() => setConnectExpanded(!connectExpanded)}>
        ${connectExpanded ? t('profile.agents.detail.zone2.cancel') : `+ ${t('profile.agents.connect')}`}
      </button>
    </div>
    <div class="section-desc">${t('profile.agents.desc')}</div>

    ${/* The approval panel is a SHARED component (components/AgentConsent.js): the remake's home
          shows the same panel for the person's FIRST agent, and a copy here would drift from it.
          Behaviour is unchanged — same requests, same scope presets, same verify calls. */''}
    <${AgentConsent} requests=${pendingRequests} onApprove=${handleApprove} onDeny=${handleDeny} />

    ${connectExpanded && html`
      <div class="pf-agd-connect-content">
        <p class="mb-half text-bold">${t('profile.agents.connectOptionsTitle')}</p>
        <p class="text-caption mb-half"><strong>${t('profile.agents.connectOptionConnectorTitle')}</strong> ${t('profile.agents.connectOptionConnectorDesc')}</p>
        <p class="text-caption mb-1"><strong>${t('profile.agents.connectOptionFallbackTitle')}</strong> ${t('profile.agents.connectOptionFallbackDesc')}</p>

        <p class="mb-half text-bold">${t('profile.agents.cliInstall')}</p>
        <div class="agent-prompt-box"><code>npx aimeat connect --url ${getNodeUrl()} --owner ${session.owner}</code></div>
        <${CopyButton}
          text=${`npx aimeat connect --url ${getNodeUrl()} --owner ${session.owner}`}
          className="copy-prompt-btn"
          label=${t('profile.agents.copyCommand')}
          copiedLabel=${'\u2705 ' + t('profile.agents.copied')} />

        <p class="mt-1 mb-half text-bold">${t('profile.agents.cliServe')}</p>
        <div class="agent-prompt-box"><code>npx aimeat connect serve</code></div>

      <p class="mt-1 text-caption">${t('profile.agents.cliDesc')}</p>

        <p class="mt-1 mb-half text-bold">${t('profile.agents.agentInstructionTitle')}</p>
        <p class="text-caption mb-half">${t('profile.agents.agentInstructionDesc')}</p>
        <div class="agent-prompt-box">${buildMcpOnboardingPrompt()}</div>
        <${CopyButton}
          text=${buildMcpOnboardingPrompt()}
          className="copy-prompt-btn"
          label=${t('profile.agents.copyAgentInstruction')}
          copiedLabel=${'\u2705 ' + t('profile.agents.copied')} />

        <div class="pf-agent-divider mt-1">
          <button class="expand-btn" onClick=${() => setPlatExpand(!platExpand)}>
            <span>${t('profile.agents.noNodejs')}</span>
            <span class="pf-chevron ${platExpand ? 'pf-chevron-open' : ''}">\u25BC</span>
          </button>
          ${platExpand && html`
            <div class="platform-instructions expanded">
              <div class="platform-tabs">
                ${PLATFORM_KEYS.map(k => html`
                  <button class="platform-tab ${k === activePlat ? 'active' : ''}" onClick=${() => setActivePlat(k)}>${t(PLATFORM_LABELS[k])}</button>
                `)}
              </div>
              ${/* SAFE: PLATFORMS is hardcoded developer constant, not user input */''}
              <div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
            </div>
          `}
        </div>

        <div class="pf-agent-divider mt-1">
          <button class="expand-btn" onClick=${() => setPasteExpanded(!pasteExpanded)}>
            <span>${t('profile.agents.pasteAlt')}</span>
            <span class="pf-chevron ${pasteExpanded ? 'pf-chevron-open' : ''}">\u25BC</span>
          </button>
          ${pasteExpanded && html`
            <div class="mt-half">
              <p class="text-caption mb-half">${t('profile.agents.pasteDesc')}</p>
              <div class="agent-prompt-box">${buildAgentPrompt(session)}</div>
              <${CopyButton}
                text=${buildAgentPrompt(session)}
                className="copy-prompt-btn"
                label=${t('profile.agents.copyPrompt')}
                copiedLabel=${'\u2705 ' + t('profile.agents.copied')} />
            </div>
          `}
        </div>

        <div class="pf-agent-divider mt-1">
          <button class="expand-btn" onClick=${() => setTaskRunnerExpanded(!taskRunnerExpanded)}>
            <span>${t('profile.agents.taskRunner.title')}</span>
            <span class="pf-chevron ${taskRunnerExpanded ? 'pf-chevron-open' : ''}">\u25BC</span>
          </button>
          ${taskRunnerExpanded && html`
            <div class="mt-half">
              <p class="text-caption mb-half">${t('profile.agents.taskRunner.whatIs')}</p>
              <p class="text-caption mb-half">${t('profile.agents.taskRunner.whenToUse')}</p>
              <p class="mb-half">
                <a class="pf-gh-link" href="https://github.com/miikkij/crewaimeat" target="_blank" rel="noopener">
                  ${GhMark}${t('profile.agents.taskRunner.repoLink')}
                </a>
              </p>
              <p class="text-caption mb-half"><strong>${t('profile.agents.taskRunner.exampleLabel')}</strong> ${t('profile.agents.taskRunner.exampleDesc')}</p>
              <div class="mb-half mt-1">
                <label class="text-caption mb-half" for="pf-task-runner-name">${t('profile.agents.taskRunner.nameLabel')}</label>
                <input id="pf-task-runner-name" type="text"
                       class="pf-task-runner-input"
                       placeholder="marketing-crew"
                       value=${taskRunnerName}
                       onInput=${(e) => setTaskRunnerName(e.target.value)} />
              </div>
              <div class="agent-prompt-box">${buildTaskRunnerPrompt(session, taskRunnerName)}</div>
              <${CopyButton}
                text=${buildTaskRunnerPrompt(session, taskRunnerName)}
                className="copy-prompt-btn"
                label=${t('profile.agents.taskRunner.copyButton')}
                copiedLabel=${'\u2705 ' + t('profile.agents.copied')} />
            </div>
          `}
        </div>
      </div>
    `}

    ${agents.length === 0
      ? html`<div class="empty">${t('profile.agents.empty')}</div>`
      : html`
        <${SharedBoard}
          agents=${agents}
          onboardings=${onboardings}
          onAgentClick=${(name) => {
            setExpandedAgent(name);
            requestAnimationFrame(() => {
              const el = document.querySelector(`[data-agent-name="${name}"]`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          }}
        />
        <${ActiveTasksPanel}
          activeTasksMap=${activeTasksMap}
          agents=${agents}
          onOpen=${openAgentTask}
        />
        ${renderFilterBar(agents, tagFilter, setTagFilter, groupBy, pickGroupBy)}
        ${renderAgentGroups({
          agents,
          tagFilter,
          groupBy,
          onboardings,
          taskStatsMap,
          changesMap,
          onTabSeen: handleTabSeen,
          expandedAgent,
          toggleAgent,
          session,
          showToast,
          setScopesModal,
          handleDeleteAgent,
          toggleFederate,
          onPopOut: popOutAgent,
          dnd,
          agentOrder,
          deepLink,
          agentGroups,
          collapsedGroups,
          editingGroup,
          setEditingGroup,
          addGroup,
          renameGroup,
          removeGroup,
          toggleGroupCollapsed,
          groupDnd,
        })}
      `
    }

    ${scopesModal && html`<${ScopesModal}
      agent=${scopesModal}
      session=${session}
      onSave=${handleSaveScopes}
      onCancel=${() => setScopesModal(null)} />`}
    <${ConfirmUI} />
  `;
}

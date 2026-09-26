/**
 * @file agents-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings & Controls > Agents, in the poster face: the masthead with its strip of
 *   figures, four numbered sections (the two basic agents, an agent of your own, the connect guide,
 *   the agents as a table that opens into a card), the ink rail, the device-auth approvals, the
 *   scope modal.
 * @version-history
 *   v4.15.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the frame is
 *     SettingsPage (crumb, head with its tags, the strip, the rail with the four sections and the
 *     three pages), the sections are Section (the connect guide's three developer roads fold again as
 *     on main), the commands are Code blocks with the Loud copy, the platform steps are HowTo under a
 *     Tabs bar, the task runner's name is the TextField. Main's dim tags (og-chip--dim: nothing
 *     waiting, federated, your own tools) are back as the tag's dim tone. The connect guide is
 *     McpSetupGuide with its own classic look (Jouni's decision "MCP guide"): the page's overrides of
 *     its parts go.
 *   v4.14.0 -- 2026-09-26 -- The commands and prompts in Connect are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v4.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v4.12.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v4.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v4.10.0 -- 2026-09-25 -- The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v4.9.0 -- 2026-09-25 -- Every quiet way on is the action link (.poster-action, its quiet tone where it sits among controls), and the one loud action is the dark block (.poster-slab, its control cut), a unification: Jouni's decisions Action link and Loud action.
 *   v4.8.0 -- 2026-09-25 -- The one line a folded section shows is its lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v4.7.0 -- 2026-09-25 -- The connect guide's fields are the Facts (css/components/facts.css; the guide takes `facts`), a unification: the look most tabs use.
 *   v4.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v4.5.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v4.4.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v4.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v4.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v4.1.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v4.0.3 -- 2026-09-18 -- The connect prompt's model names come from the node
 *     (GET /v1/ai-tools, model_recommendation); without them it names no model.
 *   v4.0.2 -- 2026-09-18 -- The Hello Integration instruction is fetched from the node
 *     (GET /v1/prompts/hello-integration) instead of built from a hand copy that had drifted.
 *   v4.0.1 -- 2026-09-14 -- The tag filter folds (FilterBar).
 *   v4.0.0 -- 2026-09-14 -- The poster face (design canvas "Your Agents"): crumb, masthead, chips, a
 *     strip of figures, slab-headed sections that fold and stay folded per browser, the agents as a
 *     table (the tile board is gone: it counted what the table already lists), the ink rail. The
 *     tab's own connect panel became section 03 with its three developer roads as folds.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   v3.13.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v3.12.0 -- 2026-09-08 -- The new-agent panel below the basic-agents one: an agent of the
 *     person's own, the proposals their agents have made, and the attach control for any agent that
 *     has no key. The proposal routes had shipped six days earlier with no surface at all.
 *   v3.11.0 -- 2026-09-06 -- A search field above the board, matching an agent's name, display
 *     name or GAII, narrowing the board and the list together. Seventy-one agents on one account
 *     and the only way to reach one was to scroll past the other seventy.
 *   v3.4.0 -- 2026-08-17 -- The connect panel leads with the connector guide (McpSetupGuide, the
 *     same component the MCP tab renders), open and first, and the npx CLI road folds into a
 *     "For developers" expander. ai-tool-setup.ts has ranked claude.ai first on purpose since it
 *     was written; this panel led every visitor to a terminal instead.
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
 *     canonical <CopyButton> (className="btn-primary" preserves appearance); removed the
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
 *   v3.10.0 -- 2026-08-13 -- `?tab=agents&agent=<name>` expands that agent, so an agent has an
 *     address a chat can hand to the person who asked for it. The parameter is consumed on arrival
 *     (replaceState) — it is a way in, not part of the URL you keep.
 *   v3.9.0 -- 2026-08-08 -- Copy control unified: the bespoke .copy-prompt-btn is the shared .btn-primary, whose
 *       .copied state now lives in theme.css. Copy labels come from the shared common.* keys.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPatch } from '/js/api.js';
import { listAgents, updateAgentScopes, deleteAgent, getAgentGroups, saveAgentGroups } from '/js/services/agents.js';
import { getNodeUrl } from '/js/services/auth.js';
import { timeAgo } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { AgentConsent } from '/components/AgentConsent.js';
import { McpSetupGuide } from './ai-setup-guide.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { scrollToSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { Stack, Split } from '/components/Layout.js';
import { HowTo } from '/components/HowTo.js';
import { buildAgentPrompt, buildTaskRunnerPrompt, PLATFORMS, PLATFORM_KEYS, PLATFORM_LABELS } from './agents/connect-prompts.js';
import { loadAgentOrder, saveAgentOrder, UNGROUPED_ID, loadCollapsedGroups, saveCollapsedGroups, loadSeen, saveSeen, markTabSeen, effectiveOrderedNames, matchesAgentQuery, popOutAgent, loadFold, saveFold } from './agents/tab-helpers.js';
import { AgentSearch, FilterBar, ActiveTasksPanel, renderAgentGroups } from './agents/groups-render.js';
import { agentState } from './agents/state-detector.js';
import ScopesModal from './agents/scopes-modal.js';
import BasicAgentsPanel from './agents/basic-agents-panel.js';
import NewAgentPanel from './agents/new-agent-panel.js';
import { swallowed } from '/js/swallowed.js';

const p = (key, vars) => t('profile.agents.page.' + key, vars);

// The familiar GitHub "Octocat" mark. fill=currentColor so it inherits the link's themed color.
const GhMark = html`<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;

/** The other pages the rail points at, opened the way the sidebar opens them (Rail's `tab` item). */
const RAIL_PAGES = [['scheduler', 'profile.tabs.scheduler'], ['access', 'profile.tabs.access'], ['offers', 'profile.tabs.offers']];

export default function AgentsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [agents, setAgents] = useState(null);
  const [onboardings, setOnboardings] = useState({});
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [scopesModal, setScopesModal] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  // Section 03 stands open or closed the way this browser last left it; a new account sees it
  // open, because connecting an AI is the first thing to do here.
  const [connectOpen, setConnectOpen] = useState(() => loadFold(session?.owner, 'connect', true));
  const [newOpen, setNewOpen] = useState(false);
  const [waitingCount, setWaitingCount] = useState(0);
  const [cliExpanded, setCliExpanded] = useState(false);
  const [pasteExpanded, setPasteExpanded] = useState(false);
  const [taskRunnerExpanded, setTaskRunnerExpanded] = useState(false);
  const [taskRunnerName, setTaskRunnerName] = useState('');
  // The Hello Integration instruction, from the node. It is the text `aimeat connect` prints, served
  // by GET /v1/prompts/hello-integration, so this page and the CLI cannot say different things. A
  // hand copy stood here until 2026-09-18 and had fallen two versions behind the CLI's.
  const [helloPrompt, setHelloPrompt] = useState('');
  const [helloFailed, setHelloFailed] = useState(false);
  const [modelRec, setModelRec] = useState(null);
  const [taskStatsMap, setTaskStatsMap] = useState({});
  // Currently-active tasks per agent { name: Task[] } — powers the fleet
  // "running now" panel. Reuses the active list already fetched in loadData().
  const [activeTasksMap, setActiveTasksMap] = useState({});
  // Deep-link request from the running-now panel: { agent, taskId, nonce }.
  // The nonce makes a repeat click re-fire the open even for the same task.
  // Read during the first RENDER, not in an effect: the profile shell replaces the URL with a bare
  // `/v1/profile?tab=<id>` on its own first-mount effect, so anything still living in the query
  // string by then is gone. Captured here, consumed by the deep-link effect below.
  const [urlAgent] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('agent'); }
    // eslint-disable-next-line aimeat/no-silent-catch -- no query string, no deep link
    catch { return null; }
  });
  const [deepLink, setDeepLink] = useState(null);
  const deepLinkNonce = useRef(0);
  // Per-agent unseen-change counts { name: { tasks, messages, memory } } driving
  // the collapsed mini-badge + per-tab number badges. Computed in loadData()
  // from the localStorage "last seen per tab" baseline (see loadSeen + loadData badge logic).
  const [changesMap, setChangesMap] = useState({});
  const [tagFilter, setTagFilter] = useState(new Set());
  // The fleet search. One string, matched against name, display name and GAII, narrowing the list
  // (see matchesAgentQuery). Deliberately not persisted: a filter that is still on when you come
  // back tomorrow is a fleet that looks like it lost agents.
  const [query, setQuery] = useState('');
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
    // A failure is shown as one: an empty box that says "Loading" for ever would read as a
    // page that is still working.
    fetch('/v1/prompts/hello-integration?format=txt')
      .then(r => { if (!r.ok) throw new Error(`hello-integration answered ${r.status}`); return r.text(); })
      .then(setHelloPrompt)
      .catch((err) => { console.warn('Hello Integration instruction not loaded', err); setHelloFailed(true); });
    // Which model the connect prompt names. Without it the prompt asks for "your strongest
    // reasoning model" and names none, which is a complete sentence, so a failure needs no notice.
    fetch('/v1/ai-tools')
      .then(r => { if (!r.ok) throw new Error(`ai-tools answered ${r.status}`); return r.json(); })
      .then(body => setModelRec(body?.data?.model_recommendation || null))
      .catch((err) => { console.warn('Model recommendation not loaded; the connect prompt names no model', err); });
  }, []);

  useEffect(() => {
    if (!session) { setAgentGroups([]); return; }
    setCollapsedGroups(loadCollapsedGroups(session.owner));
    setConnectOpen(loadFold(session.owner, 'connect', true));
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

  // Reordering only makes sense in the flat, unfiltered list — a drop between two rows that a
  // search happens to have put next to each other would save an order nobody meant.
  const dnd = {
    reorderable: groupBy === 'none' && tagFilter.size === 0 && query.trim() === '',
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

  // External deep-link, two ways in:
  //   • ?tab=agents&agent=<name> — an ADDRESS, so a chat that just created an agent can hand the
  //     person a link straight to it. The parameter is stripped once used, so Back does not
  //     re-expand and the URL the person keeps is the plain tab.
  //   • sessionStorage `aimeat.agents.open` — the home dashboard's Agents card, which primes a name
  //     before switching tab (in-app, no URL to write).
  useEffect(() => {
    try {
      if (urlAgent) {
        const url = new URL(window.location.href);
        url.searchParams.delete('agent');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
      const name = urlAgent || sessionStorage.getItem('aimeat.agents.open');
      if (!name) return;
      sessionStorage.removeItem('aimeat.agents.open');
      setExpandedAgent(name);
      setTimeout(() => {
        document.querySelector(`[data-agent-name="${name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
    // urlAgent is captured once at first render and never changes; the empty-deps intent is
    // "on mount", and re-running this would re-expand an agent the person had since collapsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!agents) return html`<${Note} kind="loading">${t('profile.agents.loadingAgents')}<//>`;

  // The figures. Ready and never-connected read the server's health verdict, the same one the
  // rows show, so the strip and the table cannot disagree.
  const ready = agents.filter(a => ['production', 'idle'].includes(agentState(a))).length;
  const never = agents.filter(a => !a.last_seen).length;
  const problems = agents.filter(a => agentState(a) === 'problem');
  const federated = agents.filter(a => a.federate).length;
  const tools = agents.filter(a => a.mode === 'workstation').length;
  const waiting = pendingRequests.length + waitingCount;
  const latest = agents.reduce((best, a) => (a.last_seen && (!best || a.last_seen > best.last_seen)) ? a : best, null);
  const running = Object.values(activeTasksMap).reduce((n, list) => n + (list?.length || 0), 0);

  const openNew = () => { setNewOpen(true); requestAnimationFrame(() => scrollToSection('agp-new')); };
  const openConnect = () => { setConnectOpen(true); saveFold(session?.owner, 'connect', true); requestAnimationFrame(() => scrollToSection('agp-connect')); };
  const toggleConnect = () => { const next = !connectOpen; setConnectOpen(next); saveFold(session?.owner, 'connect', next); };
  const connectDoor = html`<${Action} small soft onClick=${toggleConnect}>${connectOpen ? p('close') : p('open')}<//>`;

  // A tag that counts nothing yet is dim, as main drew it (og-chip--dim).
  const marks = [
    { label: p('chipAgents', { n: agents.length }) },
    { label: p('chipReady', { n: ready }) },
    { label: p('chipWaiting', { n: waiting }), tone: waiting ? 'coral' : 'dim' },
    problems.length > 0 ? { label: p('chipProblems', { n: problems.length }), tone: 'coral' } : null,
    federated > 0 ? { label: p('chipFederated', { n: federated }), tone: 'dim' } : null,
    tools > 0 ? { label: p('chipTools', { n: tools }), tone: 'dim' } : null,
  ];
  const strip = [
    { key: 'agents', n: agents.length, label: p('stripAgents'), sub: p('stripAgentsSub', { ready, never }) },
    { key: 'waiting', n: waiting, label: p('stripWaiting'), sub: p('stripWaitingSub') },
    latest
      ? { key: 'seen', n: timeAgo(latest.last_seen), tone: 'coral', label: p('stripSeen'), sub: `${latest.display_name || latest.name} · ${t('profile.agents.mode.' + (latest.mode || 'interactive'))}` }
      : { key: 'seen', n: '·', label: p('stripSeen'), sub: p('stripSeenNone') },
    { key: 'problems', n: problems.length, label: p('stripProblems'), sub: problems.length ? problems.slice(0, 3).map(a => a.display_name || a.name).join(' · ') : p('stripProblemsSub') },
  ];
  const sections = [
    { id: 'agp-basic', num: '01', label: t('profile.agents.basic.title'), count: null },
    { id: 'agp-new', num: '02', label: t('profile.agents.new.title'), count: waitingCount || null },
    { id: 'agp-connect', num: '03', label: p('secConnect'), count: null },
    { id: 'agp-list', num: '04', label: p('secAgents'), count: agents.length },
  ];

  return html`
    <${SettingsPage} name="agp"
      crumb=${[t('nav.profile'), t('profile.tabs.agents')]}
      title=${t('profile.agents.title')} sub=${agents.length}
      marks=${marks}
      desc=${p('lede')}
      actions=${html`
        <${Loud} onClick=${openNew}>${t('profile.agents.new.button')}<//>
        <${Actions}><${Action} small onClick=${openConnect}>${p('connectDoor')}<//><//>`}
      strip=${html`
        ${/* The approval panel is a SHARED component (components/AgentConsent.js): the remake's home
              shows the same panel for the person's FIRST agent, and a copy here would drift from it.
              Behaviour is unchanged — same requests, same scope presets, same verify calls. */''}
        <${AgentConsent} requests=${pendingRequests} onApprove=${handleApprove} onDeny=${handleDeny} />
        <${FigureStrip} items=${strip} />`}
      railTitle=${p('railTitle')}
      sections=${sections}
      pagesLabel=${p('pages')}
      pages=${RAIL_PAGES.map(([id, key]) => ({ tab: id, label: t(key), key: id }))}
      after=${html`
        ${scopesModal && html`<${ScopesModal}
          agent=${scopesModal}
          session=${session}
          onSave=${handleSaveScopes}
          onCancel=${() => setScopesModal(null)} />`}
        <${ConfirmUI} />`}>
          ${/* The one-press road in. Above the connect guide on purpose: for somebody whose connector
                is already running, this is the whole job, and the guide below is the long way round. */''}
          <${BasicAgentsPanel} session=${session} showToast=${showToast} onCreated=${loadData} first=${true} />

          ${/* An agent of the person's own, and what their agents have proposed. Below the two fixed
                names on purpose: those are what a new account should take first, and this is the door
                for the job they do not cover. */''}
          <${NewAgentPanel} session=${session} showToast=${showToast} onCreated=${loadData} agents=${agents}
            open=${newOpen} setOpen=${setNewOpen} onWaiting=${setWaitingCount} />

          <${Section} id="agp-connect" num="03" title=${p('secConnect')} count=${p('secConnectSub')} doors=${connectDoor}>
            ${!connectOpen ? html`<${Note} kind="lead">${p('connectLede')}<//>` : html`
              <${Note} kind="lead">${p('connectLede')}<//>
              ${/* The recommended road comes first and OPEN: the tool the person already pays for,
                    connected through their own app's connector settings. ai-tool-setup.ts has ranked
                    claude.ai first for months while this panel led with a terminal command; the panel
                    now agrees with its own data. */''}
              <${McpSetupGuide} poster facts stepRows />

              <${Split} heavy above="section" pad="none">
                <${Section} fold inner id="agp-connect-cli" num="" title=${t('profile.agents.connectDeveloperTitle')} open=${cliExpanded} onToggle=${() => setCliExpanded(v => !v)}>
                  <${Stack} gap="small">
                    <${Note}><strong>${t('profile.agents.connectOptionConnectorTitle')}</strong> ${t('profile.agents.connectOptionConnectorDesc')}<//>
                    <${Note}><strong>${t('profile.agents.connectOptionFallbackTitle')}</strong> ${t('profile.agents.connectOptionFallbackDesc')}<//>

                    <${SubHeading}>${t('profile.agents.cliInstall')}<//>
                    <${Code} block>npx aimeat connect --url ${getNodeUrl()} --owner ${session.owner}<//>
                    <${Actions}><${Loud} copy=${`npx aimeat connect --url ${getNodeUrl()} --owner ${session.owner}`}>${t('profile.agents.copyCommand')}<//><//>

                    <${SubHeading}>${t('profile.agents.cliServe')}<//>
                    <${Code} block>npx aimeat connect serve<//>

                    <${Note}>${t('profile.agents.cliDesc')}<//>

                    <${SubHeading}>${t('profile.agents.agentInstructionTitle')}<//>
                    <${Note}>${t('profile.agents.agentInstructionDesc')}<//>
                    <${Code} block>${helloPrompt || (helloFailed ? t('profile.agents.agentInstructionLoadFailed') : t('common.loading'))}<//>
                    <${Actions}><${Loud} copy=${helloPrompt}>${t('profile.agents.copyAgentInstruction')}<//><//>
                  <//>

                  <${Split} above="large" pad="large">
                    <${Action} small expanded=${platExpand} onClick=${() => setPlatExpand(!platExpand)}>
                      ${t('profile.agents.noNodejs')} ${platExpand ? '▲' : '▼'}
                    <//>
                    ${platExpand && html`
                      <${Tabs} bar kind="view" label=${t('profile.agents.noNodejs')} value=${activePlat} onSelect=${setActivePlat}
                        items=${PLATFORM_KEYS.map(k => ({ value: k, key: k, label: t(PLATFORM_LABELS[k]) }))} />
                      ${/* SAFE: PLATFORMS is hardcoded developer constant, not user input */''}
                      <${HowTo} html=${PLATFORMS[activePlat]} />
                    `}
                  <//>
                <//>

                <${Section} fold inner id="agp-connect-paste" num="" title=${t('profile.agents.pasteAlt')} open=${pasteExpanded} onToggle=${() => setPasteExpanded(v => !v)}>
                  <${Stack} gap="small">
                    <${Note}>${t('profile.agents.pasteDesc')}<//>
                    <${Code} block>${buildAgentPrompt(session, modelRec)}<//>
                    <${Actions}><${Loud} copy=${buildAgentPrompt(session, modelRec)}>${t('common.copyPrompt')}<//><//>
                  <//>
                <//>

                <${Section} fold inner id="agp-connect-crew" num="" title=${t('profile.agents.taskRunner.title')} open=${taskRunnerExpanded} onToggle=${() => setTaskRunnerExpanded(v => !v)}>
                  <${Stack} gap="small">
                    <${Note}>${t('profile.agents.taskRunner.whatIs')}<//>
                    <${Note}>${t('profile.agents.taskRunner.whenToUse')}<//>
                    <${Actions}>
                      <${Action} small href="https://github.com/miikkij/crewaimeat" newTab>
                        ${GhMark}${t('profile.agents.taskRunner.repoLink')}
                      <//>
                    <//>
                    <${Note}><strong>${t('profile.agents.taskRunner.exampleLabel')}</strong> ${t('profile.agents.taskRunner.exampleDesc')}<//>
                    <${TextField} id="pf-task-runner-name" label=${t('profile.agents.taskRunner.nameLabel')}
                      size="medium" placeholder="marketing-crew" value=${taskRunnerName} onInput=${setTaskRunnerName} />
                    <${Code} block>${buildTaskRunnerPrompt(session, taskRunnerName)}<//>
                    <${Actions}><${Loud} copy=${buildTaskRunnerPrompt(session, taskRunnerName)}>${t('profile.agents.taskRunner.copyButton')}<//><//>
                  <//>
                <//>
              <//>
            `}
          <//>

          <${Section} id="agp-list" num="04" title=${p('secAgents')} count=${agents.length}>
            ${agents.length === 0
              ? html`<${Note} kind="lead">${t('profile.agents.empty')}<//>`
              : html`
                <${AgentSearch}
                  query=${query}
                  setQuery=${setQuery}
                  shown=${agents.filter(a => matchesAgentQuery(a, query)).length}
                  total=${agents.length}
                />
                <${FilterBar} agents=${agents} tagFilter=${tagFilter} setTagFilter=${setTagFilter} groupBy=${groupBy} setGroupBy=${pickGroupBy} />
                ${running > 0 ? html`<${ActiveTasksPanel}
                  activeTasksMap=${activeTasksMap}
                  agents=${agents}
                  onOpen=${openAgentTask}
                />` : null}
                ${renderAgentGroups({
                  agents,
                  tagFilter,
                  query,
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
              `}
          <//>
    <//>
  `;
}

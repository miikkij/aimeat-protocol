/**
 * @file agent-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent card component with collapsed/expanded states,
 *   Two-Zone Header (identity + state-dependent status), and tab bar.
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set (components/poster-parts.js): the closed
 *     card is a list row (name, GAII, last seen, Open), the open card a section whose facts are
 *     chips, the access level a sun box, the status banner an aside with a meter and the steps as chips,
 *     the tab groups the shared tab action, the tab body the shared panel. No class or style of its
 *     own, so agents-poster.css and agents-detail.css no longer draw it. The caret glyph is gone:
 *     the name itself closes the card.
 *   v2.1.0 -- 2026-09-14 -- The name is a full-width slab and the access sticker sits under it on the
 *     right; the open card ends in a 2px ink rule so the next row starts on its own.
 *   v2.0.0 -- 2026-09-14 -- The poster face (design canvas "Your Agents", header B). Closed, the card
 *     is one row of the agents table. Open, the name is a headline, the chips sit under the GAII,
 *     the access level stands on the right as a sun sticker with "Manage access rights" on it (the
 *     old MANAGE at the foot of the card went unfound), how it runs is one sentence with the switch
 *     behind a door, and the tabs stand in three groups: Work, Knowledge, Set-up. No footer.
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.26.0 -- 2026-09-06 -- The GAII stands on the row itself, closed and open, and copies itself
 *     when pressed (GaiiChip). It was the one thing about an agent that gets typed somewhere else,
 *     and it was reachable only by hovering a board tile. Split (max-file-lines): the delivery
 *     indicator and the platform / model / readiness badges moved unchanged to
 *     ./agent-card-badges.js, which is where their history continues.
 *   v1.25.0 -- 2026-09-06 -- The delivery word reads the server's channel, so an agent reached down
 *     a held connection says so instead of claiming a poll it never makes. One helper now, used by
 *     both the collapsed row and the open card, which had the same two-branch copy each.
 *   v1.24.0 -- 2026-08-31 -- Run-mode badge beside the mode badge: spawn (data on the node until
 *     work arrives) or resident (the runtime keeps it up). Shown only when the field is set, because
 *     an agent nobody has decided about must not be displayed as though somebody had.
 *   v1.23.0 -- 2026-08-28 -- Crew tab (tab-crew.js): a JSON crew definition for the agent, validated
 *     and tried by the agent's own runtime over the tunnel, published to crews.registry.<agent>.
 *   v1.22.0 -- 2026-08-13 -- Footer link through to wherever the agent actually runs, when its host
 *     has reported the address (agent.console_url). An agent created from a chat lives in a runtime
 *     this node has never heard of, so the card described something the owner could not reach. The
 *     button names the host from the URL rather than a translated word for "host".
 *   v1.21.0 -- 2026-08-09 -- Renders the server's health verdict instead of deriving one. Removed
 *     the dead reads: agent.webhookFailCount (never in the response), agent.mcpEnabled (not a
 *     field on any record) and onboarding.previousReadinessLevel (likewise), plus the second
 *     READINESS_RANKS copy. The problem panel finally names what is wrong -- its sentence was
 *     empty in every real case -- and Test webhook is offered only when one is configured.
 *   2026-07-19 — AppDev tab (KB UI): learned-pitfall + template management surface, start-prompt copy, model badge
 *   v1.20.0 -- 2026-07-17 -- Style unification: collapsed-bar summary separators use a
 *     middle dot (·) instead of a pipe, matching the rest of the profile meta rows.
 *   v1.19.0 -- 2026-07-03 -- Add Contracts sub-tab (tab-contracts.js) — agent-side contract-engagement view.
 *   v1.18.0 -- 2026-06-30 -- Onboarding step labels use tOr() so a missing agentOnboarding.steps.*
 *     key falls back to the server-provided step.title instead of rendering the raw key.
 *   v1.17.0 -- 2026-06-24 -- Secretary P5 (S-A): render a "Specialist · <role>" badge for agents tagged
 *     system:specialist, so the new specialist agent type is recognizable in the Agents tab.
 *   v1.16.0 -- 2026-06-21 -- Unseen-change badges are now has-unseen DOTS (no count) — the
 *     bulk overview supplies latest-activity timestamps, not exact since-seen counts; the
 *     dot still clears on tab-open and goes red for unseen failed tasks.
 *   v1.15.0 -- 2026-06-10 -- Glance round: collapsed bar drops the repeated mode/platform/
 *     readiness badges (detail-only now); capabilities collapse to a "N tools · N skills"
 *     summary (CapabilitiesSummary); tab badges only on Tasks/Messages, neutral gray with
 *     red reserved for unseen failed tasks; footer Delete removed (Agent Config danger zone
 *     owns it, onDeleteClick threaded there); federation button shows its state
 *     ("Federation: on/off"); readiness badge gets an explanatory tooltip.
 *   v1.14.0 -- 2026-06-09 -- Tag strip in the expanded header is now editable
 *     (inline add via "+ tag" input + per-chip remove ×), writing through
 *     PATCH /v1/agents/:name/tags. Lets the owner manage the tags that drive the
 *     list filter / "Group by: Tag" without opening the Data Access (Muisti) tab.
 *     renderTagStrip() replaced by the <TagStrip> component; always rendered so
 *     an untagged agent still shows the add affordance.
 *   v1.13.0 -- 2026-06-03 -- Deep-link props: preSelectedTab forces a tab (and
 *     locks it past the async README default), openTaskId + openTaskNonce are
 *     threaded to the Tasks sub-tab so the fleet "running now" panel can open a
 *     specific task directly.
 *   v1.12.0 -- 2026-06-02 -- Active tracked tab never shows its own badge and is
 *     kept marked-seen as new items arrive (so a message landing while you're on
 *     the Messages tab doesn't raise a (1) you're already looking at).
 *   v1.11.0 -- 2026-06-02 -- Unseen-change badges: collapsed-card mini-badge
 *     (total new across Tasks/Messages/Memory) + per-tab number badges on the
 *     Tasks/Messages/Memory tab buttons; opening a tracked tab clears its badge
 *     (via onTabSeen). Counts come from the `changes` prop (localStorage
 *     last-seen baseline computed in agents-tab.js).
 *   v1.10.0 -- 2026-06-01 -- Reorder TABS to owner-requested order: Integration,
 *     Tasks, Messages, Data Access, Quality, Activity, then Directives /
 *     Agent Config / Services (README stays prepended/first).
 *   v1.9.0 -- 2026-06-01 -- Reorder TABS by owner usage frequency (Integration,
 *     Tasks, Data Access, Quality, Activity, ... setup tabs last) so the
 *     now-wrapping tab bar keeps the most-used tabs on the top row.
 *   v1.8.0 -- 2026-05-31 -- Add Quality tab (per-context reviews + performance + custom stats)
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix C6: remove GAII from Zone 1, M1: add Next prefix, C1: production stats, C2: problem action buttons
 *   v1.3.0 -- 2026-05-24 -- Audit fix: use proper down arrow glyph for collapse icon
 *   v1.2.0 -- 2026-05-24 -- Add idle state handling, tokens today display, combined delivery label
 *   v1.4.0 -- 2026-05-29 -- Add agent mode badge + dedicated tag chip strip
 *   v1.5.0 -- 2026-05-31 -- Add README tab, rendered from the agents.<name>.readme
 *     owner-namespaced memory entry. Shown first + selected by default when a
 *     non-empty README exists; hidden otherwise.
 *   v1.6.0 -- 2026-05-31 -- Add `onPopOut` prop (pop-out ⤢ button on collapsed
 *     bar + expanded footer that opens the agent in its own window) and
 *     `soloMode` prop (used by the standalone /v1/profile?solo= view: forces
 *     expanded, disables collapse, hides the pop-out button).
 *   v1.7.0 -- 2026-05-31 -- Collapsed bar split into two rows (identity+badges on
 *     top, delivery/status/last-seen on a faint-divider-separated second line)
 *     so the status text stops overflowing the card.
 */

import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { timeAgo } from '/js/utils.js';
import { agentState, getDefaultTab } from './state-detector.js';
import { GaiiChip } from './gaii-chip.js';
import { deliveryLabel, renderPlatformBadge, renderModelBadge, renderReadinessBadge } from './agent-card-badges.js';
import { RunModeSwitch } from './agent-card-run-mode.js';
import { templateLabel } from './scope-config.js';
import { detectTemplate } from './scope-model.js';
import { agentGaii } from './tab-helpers.js';
import { testWebhook, updateWebhook } from '/js/services/agent-integration.js';
import TabReadme from './tab-readme.js';
import TabIntegration from './tab-integration.js';
import TabTasks from './tab-tasks.js';
import TabMessages from './tab-messages.js';
import TabDataAccess from './tab-data-access.js';
import TabContracts from './tab-contracts.js';
import TabDirectives from './tab-directives.js';
import TabAgentConfig from './tab-agent-config.js';
import TabActivity from './tab-activity.js';
import TabUsage from './tab-usage.js';
import TabSchedules from './tab-schedules.js';
import TabQuality from './tab-quality.js';
import TabServices from './tab-services.js';
import TabCrew from './tab-crew.js';
import { swallowed } from '/js/swallowed.js';
import { num } from '/js/format.js';
import { Section, Stack, Columns, ListRow, Chip, Action, Text, Surface, Field, Meter } from '/components/poster-parts.js';

const html = htm.bind(h);

// The has-unseen mark: a small square, drawn rather than typed (an icon here is inline SVG). Its
// colour comes from the Text tone around it.
const DOT = html`<svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><rect width="8" height="8" fill="currentColor" /></svg>`;

// README is opt-in and prepended only when the agent has published one, so it
// is NOT in this base list. See readmeTab below.
//
// The registry of tabs: id and label. The order on screen comes from TAB_GROUPS below, which sorts
// them into Work, Knowledge and Set-up; README is prepended separately when present.
const TABS = [
  { id: 'integration', key: 'profile.agents.detail.tabs.integration' },
  { id: 'tasks', key: 'profile.agents.detail.tabs.tasks' },
  { id: 'messages', key: 'profile.agents.detail.tabs.messages' },
  { id: 'data-access', key: 'profile.agents.detail.tabs.data_access' },
  { id: 'contracts', key: 'profile.agents.detail.tabs.contracts' },
  { id: 'quality', key: 'profile.agents.detail.tabs.quality' },
  { id: 'activity', key: 'profile.agents.detail.tabs.activity' },
  { id: 'usage', key: 'profile.agents.detail.tabs.usage' },
  { id: 'schedules', key: 'profile.agents.detail.tabs.schedules' },
  { id: 'directives', key: 'profile.agents.detail.tabs.directives' },
  { id: 'crew', key: 'profile.agents.detail.tabs.crew' },
  { id: 'agent-config', key: 'profile.agents.detail.tabs.agent_config' },
  { id: 'services', key: 'profile.agents.detail.tabs.services' },
];

const readmeTab = { id: 'readme', key: 'profile.agents.detail.tabs.readme' };

// The three groups the tabs are sorted into on the open card: what the agent does, what it knows
// and has done, and how it is set up. Order inside a group is the order on screen.
const TAB_GROUPS = [
  { id: 'work', key: 'profile.agents.page.tabGroups.work', tabs: ['tasks', 'messages', 'schedules', 'directives'] },
  { id: 'knowledge', key: 'profile.agents.page.tabGroups.knowledge', tabs: ['readme', 'data-access', 'quality', 'usage', 'activity'] },
  { id: 'setup', key: 'profile.agents.page.tabGroups.setup', tabs: ['integration', 'crew', 'agent-config', 'services', 'contracts'] },
];

// Read the agent's owner-namespaced README markdown (agents.<name>.readme).
// Uses the owner-session list endpoint (?agent=<gaii>) — the same path
// tab-data-access uses — which returns owner-visibility values to the owner.
// (The public /v1/memory/:gaii/:key route only serves `public` entries unless
// consent is enabled, so it is not suitable for an `owner`-visibility README.)
// Returns the string, or '' if absent/blank.
async function fetchReadme(agent) {
  const gaii = agent?.gaii || agent?.name;
  const key = `agents.${agent.name}.readme`;
  try {
    const resp = await apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(key)}&per_page=5`);
    const items = resp?.data?.items || resp?.data || [];
    const found = Array.isArray(items) ? items.find(it => it.key === key) : null;
    const value = found?.value;
    return typeof value === 'string' ? value : '';
  } catch (err) { swallowed('agent-card', err); return ''; }
}

// Maps a tab id to its change-count key in the `changes` prop. Badges live ONLY on
// Tasks and Messages — they are the action-bearing tabs. (Memory churn is not a
// to-do; its badge taught users to ignore badges.)
const TAB_CHANGE_KEY = { tasks: 'tasks', messages: 'messages' };

// Total unseen changes across the tracked tabs (collapsed mini-badge).
function totalChanges(changes) {
  if (!changes) return 0;
  return (changes.tasks || 0) + (changes.messages || 0);
}

export default function AgentCard({ agent, onboarding, expanded, onToggle, session, showToast, allAgents, changes, onTabSeen, onScopesClick, onDeleteClick, onFederateToggle, onPopOut, dragHandle = null, soloMode = false, preSelectedTab = null, openTaskId = null, openTaskNonce = 0 }) {
  const state = agentState(agent);
  const [activeTab, setActiveTab] = useState(null);
  // The run-mode switch stands behind the sentence that says the current state; open on request.
  const [runsOpen, setRunsOpen] = useState(false);
  // README markdown: undefined = not loaded, '' = none published, string = show tab.
  const [readme, setReadme] = useState(undefined);
  // True once the user clicks a tab, so the async README default never yanks
  // them off a tab they chose.
  const userPickedTab = useRef(false);
  // Last deep-link nonce we acted on, so a fresh panel click re-forces the tab
  // but a plain re-expand (same nonce) does not override the README default.
  const lastDeepLinkNonce = useRef(0);

  // Load the README once the card is expanded (lazy — collapsed cards skip it).
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    fetchReadme(agent).then(md => { if (!cancelled) setReadme(md); });
    return () => { cancelled = true; };
    // README is keyed to agent identity (name); refetching on every agent-object reference change
    // (parent reloads the list on live-update) would spam the memory endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, agent.name]);

  const hasReadme = typeof readme === 'string' && readme.trim().length > 0;
  // When a README exists it is the first tab; otherwise the bar is unchanged.
  const tabs = hasReadme ? [readmeTab, ...TABS] : TABS;

  useEffect(() => {
    if (!expanded || userPickedTab.current) return;
    // README loads async after expand. Wait for it to resolve (readme !==
    // undefined) before locking in a default, so an existing README wins the
    // first-tab/default slot instead of being beaten by the state default.
    if (readme === undefined) return;
    setActiveTab(hasReadme ? 'readme' : getDefaultTab(state));
    // Lock the default tab once, on expand + README-resolve. hasReadme derives from readme (already
    // a dep); adding `state` would re-run and override the resolved default when the detected state
    // shifts under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, readme]);

  // Deep-link: when the fleet "running now" panel requests this agent's Tasks
  // tab (preSelectedTab), force that tab and lock it (userPickedTab) so the
  // async README default can't yank it away. Gated on a NEW openTaskNonce so a
  // fresh panel click re-forces it, but a plain manual re-expand (same nonce)
  // leaves the README default / the user's own tab choice alone.
  useEffect(() => {
    if (!expanded || !preSelectedTab || !openTaskNonce) return;
    if (openTaskNonce === lastDeepLinkNonce.current) return;
    lastDeepLinkNonce.current = openTaskNonce;
    userPickedTab.current = true;
    setActiveTab(preSelectedTab);
  }, [expanded, preSelectedTab, openTaskNonce]);

  // While the owner is actively viewing a tracked tab (Tasks/Messages/Memory),
  // keep it marked-seen as new items arrive. Without this, a message landing
  // while you're on the Messages tab would raise its (1) badge even though you
  // are looking right at it. Non-active tabs still accumulate their badge.
  useEffect(() => {
    if (!expanded) return;
    const key = TAB_CHANGE_KEY[activeTab];
    if (key && onTabSeen && changes?.[key]) onTabSeen(agent.name, key);
    // Mark the active tracked tab seen as changes arrive; keyed to changes/activeTab, not the
    // onTabSeen prop identity (the parent may recreate it each render → would re-fire needlessly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, activeTab, changes, agent.name]);

  const handleCollapse = useCallback(() => {
    // In solo mode the card is the whole window — clicking the header must not
    // collapse it (there is nothing to collapse back into).
    if (soloMode) return;
    onToggle(agent.name);
    if (expanded) { setActiveTab(null); userPickedTab.current = false; }
  }, [expanded, agent.name, onToggle, soloMode]);

  // What the agent may reach, as the word the scope dialog uses for the same set. The list
  // projection carries default_scopes; a missing list is the legacy everything (detectTemplate).
  const accessLabel = templateLabel(detectTemplate(agent.default_scopes ?? ['*']));
  const platform = onboarding?.platformName || onboarding?.detectedPlatform || null;
  const runsWord = agent.run_mode ? t(`profile.agents.runMode.${agent.run_mode}`) : t('profile.agents.runMode.unset');

  if (!expanded) {
    // ONE ROW OF THE TABLE. The columns are the same six the head names (groups-render.js) and the
    // GAII rides under the name, because it is what a person carries away from this row: the name
    // is for the eye, the GAII is what a chat, a config file or another agent is given.
    // The marker is the row's state at a glance: a problem in the danger colour, a working agent in
    // the success colour, anything else quiet.
    const marker = state === 'problem' ? 'danger' : (state === 'production' || state === 'idle') ? 'success' : 'muted';
    const open = () => onToggle(agent.name);
    return html`
      <${ListRow} marker=${marker} onOpen=${open} density="compact"
        name=${html`${agent.display_name || agent.name}`}
        detail=${agentGaii(agent)}
        value=${agent.last_seen ? timeAgo(agent.last_seen) : t('profile.agents.page.neverSeen')}
        actions=${html`${dragHandle}<${Action} kind="text" onClick=${open}>${t('profile.agents.page.openRow')}<//>`}>
        <${Stack} direction="wrap" align="center" density="compact">
          ${renderChangeBadge(changes)}
          <${Chip} title=${t('profile.agents.page.colRuns')}>${runsWord}<//>
          <${Chip} title=${t('profile.agents.page.colAccess')}>${accessLabel}<//>
          ${agent.mode && agent.mode !== 'interactive' ? html`<${Chip} tone="muted">${t(`profile.agents.mode.${agent.mode}`) || agent.mode}<//>` : null}
          ${platform ? html`<${Chip} tone="muted">${platform}<//>` : null}
          ${agent.federate && html`<${Chip} tone="muted">${t('profile.federated')}<//>`}
        <//>
      <//>
    `;
  }

  // The tabs in three groups (design canvas "Your Agents", header B): a person looks in one group
  // of five instead of scanning fourteen. README joins Knowledge only when the agent has one.
  const tabIds = new Set(tabs.map(x => x.id));
  const tabButton = (tab) => {
    const label = t(tab.key);
    const changeKey = TAB_CHANGE_KEY[tab.id];
    // The tab you're currently viewing never shows a badge — you're
    // looking at it (and the effect above keeps it marked-seen).
    const count = (changeKey && activeTab !== tab.id) ? (changes?.[changeKey] || 0) : 0;
    // Neutral dot; coral ONLY when there are unseen FAILED tasks.
    const failed = tab.id === 'tasks' && (changes?.tasksFailed || 0) > 0;
    return html`
      <${Action} kind="tab" key=${tab.id} selected=${activeTab === tab.id}
        onClick=${() => {
          userPickedTab.current = true;
          setActiveTab(tab.id);
          // Opening a tracked tab clears its unseen badge.
          if (changeKey && onTabSeen) onTabSeen(agent.name, changeKey);
        }}>
        ${label !== tab.key ? label : tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}
        ${count > 0 ? html`<${Text} kind="caption" tone=${failed ? 'danger' : 'muted'}>${DOT}<//>` : ''}
      <//>
    `;
  };

  // The name is the card's slab, the full width, the way a section starts; pressing it closes the
  // card (in the solo window there is nothing to close into, and handleCollapse says so).
  const title = soloMode ? (agent.display_name || agent.name)
    : html`<${Action} kind="text" expanded=${true} onClick=${handleCollapse}>${agent.display_name || agent.name}<//>`;

  return html`
    <${Section} size="small" density="compact" title=${title}>
      <${Stack}>
        <${Columns} layout="leading" collapse="640">
          <${Stack} density="compact">
            <${GaiiChip} agent=${agent} />
            <${Stack} direction="wrap" align="center" density="compact">
              ${renderModeBadge(agent)}
              ${renderPlatformBadge(onboarding)}
              ${renderModelBadge(agent)}
              ${renderReadinessBadge(state, onboarding)}
              ${agent.last_seen ? html`<${Chip} tone=${(state === 'production' || state === 'idle') ? 'sun' : 'muted'}>${agent?.health?.delivery ? deliveryLabel(agent.health.delivery) : t('profile.agents.detail.lastSeen')} · ${timeAgo(agent.last_seen)}<//>` : null}
              <${CapabilitiesSummary} agent=${agent} />
              ${onFederateToggle
                ? html`<${Action} kind="text"
                    title=${agent.federate ? (t('profile.agents.detail.federationOnHint') || 'Click to make local only') : (t('profile.agents.detail.federationOffHint') || 'Click to share via federation')}
                    onClick=${() => onFederateToggle(agent)}>
                    <${Chip} tone="muted">${t('profile.agents.detail.federationLabel')} ${agent.federate ? t('profile.agents.detail.federationOn') : t('profile.agents.detail.federationOff')}<//>
                  <//>`
                : agent.federate ? html`<${Chip} tone="muted">${t('profile.federated')}<//>` : null}
              <${TagStrip} agent=${agent} showToast=${showToast} />
            <//>
          <//>
          <${Stack} density="compact" align="end">
            <${Surface} kind="box" tone="sun" density="compact">
              <${Stack} density="compact" align="end">
                <${Text} kind="number" size="small">${accessLabel}<//>
                ${onScopesClick && html`<${Action} onClick=${() => onScopesClick(agent)}>${t('profile.agents.page.manageAccess')} →<//>`}
              <//>
            <//>
            ${renderPopOut(onPopOut, agent)}
            ${renderHostConsole(agent)}
          <//>
        <//>

        ${/* How this agent is meant to be RUN: one sentence, and the switch behind one door. The
              node stores and shows this and never enforces it; the sentence says what is true. */''}
        <${Stack} density="compact">
          <${Stack} direction="wrap" align="center" density="compact">
            <${Text} kind="label">${t('profile.agents.runMode.label')}<//>
            <${Text}>${t(`profile.agents.page.runs.${agent.run_mode || 'unset'}`)}<//>
            <${Action} kind="text" expanded=${runsOpen} onClick=${() => setRunsOpen(v => !v)}>
              ${runsOpen ? t('profile.agents.page.close') : (agent.run_mode ? t('profile.agents.page.runsChange') : t('profile.agents.page.runsDecide'))} →
            <//>
          <//>
          ${runsOpen && html`<${RunModeSwitch} agent=${agent} showToast=${showToast} />`}
        <//>

        ${/* The status banner while the agent is new, onboarding or in trouble. */''}
        ${renderZone2(state, agent, onboarding, setActiveTab, showToast)}

        <${Stack} direction="wrap" density="roomy">
          ${TAB_GROUPS.map(g => {
            const members = g.tabs.filter(id => tabIds.has(id)).map(id => tabs.find(x => x.id === id));
            if (members.length === 0) return null;
            return html`
              <${Stack} density="compact" key=${g.id}>
                <${Text} kind="label">${t(g.key)}<//>
                <${Stack} direction="wrap" density="normal">${members.map(tabButton)}<//>
              <//>`;
          })}
        <//>

        <${Surface} kind="panel">
          ${renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme, openTaskId, openTaskNonce, onDeleteClick)}
        <//>
      <//>
    <//>
  `;
}

// Capabilities summary — "14 tools · 5 skills · 2 languages" on one line, expanding to the
// full pill list on click. Headers should identify, not enumerate.
function CapabilitiesSummary({ agent }) {
  const [open, setOpen] = useState(false);
  const tools = agent.technical_capabilities || [];
  const skills = (agent.domain_capabilities || []).filter(c => !String(c).startsWith('Language: '));
  const langs = agent.languages || [];
  if (tools.length === 0 && skills.length === 0 && langs.length === 0) return null;
  const parts = [];
  if (tools.length) parts.push(`${tools.length} ${t('profile.agents.detail.capTools') || 'tools'}`);
  if (skills.length) parts.push(`${skills.length} ${t('profile.agents.detail.capSkills') || 'skills'}`);
  if (langs.length) parts.push(`${langs.length} ${t('profile.agents.detail.capLangs') || 'languages'}`);
  // A chip in the masthead's row; the full list opens under the row (agp-caps takes the row's
  // whole width) so a wall of pills never sits between the name and the tabs uninvited.
  // Closed it reads →, open it reads ↩ (the interface's own glyphs; ↓ and ↑ are not among them).
  return html`
    <${Action} kind="text" expanded=${open} onClick=${() => setOpen(o => !o)}>
      <${Chip} tone="muted">${parts.join(' · ')} ${open ? '↩' : '→'}<//>
    <//>
    ${open && html`
      <${Stack} direction="wrap" density="compact">
        ${tools.map(c => html`<${Chip} key=${c.name || c}>${c.name || c}<//>`)}
        ${skills.map(c => html`<${Chip} key=${c} tone="muted">${c}<//>`)}
        ${langs.map(l => html`<${Chip} key=${'lang-' + l} tone="muted">${'Language: ' + l}<//>`)}
      <//>
    `}
  `;
}

// The way to this agent's own window (one window per agent, so re-clicking focuses the existing
// one). Only rendered when the parent supplies onPopOut — the standalone solo view omits it.
function renderPopOut(onPopOut, agent) {
  if (!onPopOut) return null;
  return html`<${Action} kind="text" title=${t('profile.agents.detail.popOut')}
    onClick=${() => onPopOut(agent)}>${t('profile.agents.detail.popOut')} →<//>`;
}

// The way through to wherever this agent actually runs, when its host has said where that is
// (PATCH /v1/agents/:name/console-url). An agent created from a chat lives in a fleet runtime this
// node has never heard of, and until this link existed the owner had a card describing something
// they could not get to. The host name is read off the URL rather than translated: the person
// recognises "fleet.example.com" and would learn nothing from the word "host".
// rel=noopener because the target is an address a principal supplied.
function renderHostConsole(agent) {
  const url = agent.console_url;
  if (!url) return null;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable address is simply not offered
    return null;
  }
  return html`<${Action} kind="text" href=${url} target="_blank" title=${url}>${t('profile.agents.detail.openInHost', { host })} →<//>`;
}

// Collapsed-card mini-badge: total unseen changes across Tasks/Messages/Memory,
// so the owner can spot at a glance which agent has something new. Hidden when
// nothing changed; naturally absent from the expanded view (which does not
// render the collapsed bar). The title spells out the per-tab breakdown.
function renderChangeBadge(changes) {
  const total = totalChanges(changes);
  if (total <= 0) return null;
  const parts = [];
  if (changes.tasks) parts.push(t('profile.agents.detail.tabs.tasks'));
  if (changes.messages) parts.push(t('profile.agents.detail.tabs.messages'));
  const title = `${t('profile.agents.detail.changes.title')} — ${parts.join(', ')}`;
  // Has-unseen indicator (a dot, not an exact count). Neutral gray; red ONLY for unseen FAILED tasks.
  const failed = (changes.tasksFailed || 0) > 0;
  return html`<span title=${title}><${Text} kind="caption" tone=${failed ? 'danger' : 'muted'}>${DOT}<//></span>`;
}

function renderZone2(state, agent, onboarding, setActiveTab, showToast) {
  switch (state) {
    case 'system':
      // Internal (auto-provisioned) agents skip the Hello Integration banner.
      return null;
    case 'new':
      return html`
        <${Surface} kind="aside">
          <${Stack} density="compact">
            <${Text} kind="label">${t('profile.agents.detail.zone2.newTitle')}<//>
            <${Text}>${t('profile.agents.detail.zone2.newDesc')}<//>
            <${Stack} direction="wrap">
              <${Action} kind="primary" onClick=${() => setActiveTab('integration')}>
                ${t('profile.agents.detail.zone2.goToIntegration')}
              <//>
            <//>
          <//>
        <//>
      `;
    case 'onboarding': {
      const steps = onboarding?.steps || [];
      const passed = steps.filter(s => s.status === 'passed').length;
      const total = steps.length || 11;
      const nextStep = steps.find(s => s.status === 'pending');
      return html`
        <${Surface} kind="aside">
          <${Stack} density="compact">
            <${Stack} direction="wrap" align="center" density="compact">
              <${Text} kind="label">${t('profile.agents.detail.zone2.onboardingTitle')}: ${passed} / ${total}<//>
              ${nextStep ? html`<${Text} tone="muted">${t('profile.agents.detail.state.next')}: ${tOr('agentOnboarding.steps.' + nextStep.id, nextStep.title || nextStep.id)}<//>` : ''}
            <//>
            <${Meter} value=${passed} max=${total} label=${t('profile.agents.detail.zone2.onboardingTitle')} />
            <${Stack} direction="wrap" density="compact">
              ${/* Chips, not checklist rows: sixteen steps stay a few dense lines, as the pills were. */''}
              ${steps.map(s => html`
                <${Chip} key=${s.id} tone=${s.status === 'passed' ? 'sun' : 'muted'}>${s.status === 'passed' ? '✓ ' : ''}${tOr('agentOnboarding.steps.' + s.id, s.title || s.id)}<//>
              `)}
            <//>
          <//>
        <//>
      `;
    }
    case 'problem':
      return html`<${ProblemZone2} agent=${agent} setActiveTab=${setActiveTab} showToast=${showToast} />`;

    case 'idle':
    case 'production':
    default: {
      // Same source as the header indicator — see renderDeliveryIndicator for why the MCP branch
      // is gone rather than rewired.
      const zoneDelivery = agent?.health?.delivery
        ? deliveryLabel(agent.health.delivery)
        : t('profile.agents.detail.deliveryPolling');
      const stats = agent.taskStats;
      return html`
        <${Stack} direction="wrap" density="normal">
          <${Text} kind="mono" tone="muted">${zoneDelivery}<//>
          ${agent.last_seen ? html`<${Text} kind="mono" tone="muted">${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}<//>` : ''}
          ${stats && (stats.done || stats.active) ? html`<${Text} kind="mono" tone="muted">${t('profile.agents.detail.today')}: ${stats.done || 0} ${t('profile.agents.detail.done')}${stats.active ? `, ${stats.active} ${t('profile.agents.detail.active')}` : ''}<//>` : ''}
          ${agent.tokensUsedToday != null ? html`<${Text} kind="mono" tone="muted">${t('profile.agents.detail.tokensToday')}: ${num(agent.tokensUsedToday)}<//>` : ''}
        <//>
      `;
    }
  }
}

function renderModeBadge(agent) {
  const mode = agent.mode || 'interactive';
  const label = t(`profile.agents.mode.${mode}`) || mode;
  return html`<${Chip} tone="muted" title=${t('profile.agents.mode.tooltip') || ''}>${label}<//>`;
}

// Editable tag strip shown in the expanded card header. The same owner-managed
// tags drive the list's tag filter and "Group by: Tag" (and double as the shared
// memory namespace agents.tag.<tag>.*), so editing here is the convenient inline
// path — no need to dig into the Data Access (Muisti) sub-tab. Writes go through
// the same PATCH /v1/agents/:name/tags route; the server emits an `agents`
// change so the live-update refresh keeps the list's filter/grouping in sync.
function TagStrip({ agent, showToast }) {
  const [tags, setTags] = useState(agent.tags ?? []);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  // Re-sync when the parent reloads the agent (e.g. after a live-update).
  useEffect(() => { setTags(agent.tags ?? []); }, [agent.tags]);

  const agentName = agent.name;

  async function addTag() {
    const tag = newTag.trim().toLowerCase();
    if (!tag || tags.includes(tag)) { setNewTag(''); setAdding(false); return; }
    try {
      const updated = [...tags, tag];
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      setNewTag(''); setAdding(false);
      showToast?.(t('profile.agents.detail.data_access.tagAdded'));
    } catch (err) {
      showToast?.(err.message || t('profile.agents.detail.data_access.addTagError'), true);
    }
  }

  async function removeTag(tag) {
    try {
      const updated = tags.filter(x => x !== tag);
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      showToast?.(t('profile.agents.detail.data_access.tagRemoved'));
    } catch (err) {
      showToast?.(err.message || t('profile.agents.detail.data_access.removeTagError'), true);
    }
  }

  // The new tag's field takes the focus when it opens (the old input's autofocus), so a person can
  // type at once.
  const inputRef = useRef(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  return html`
    <${Stack} direction="wrap" align="center" density="compact">
      ${tags.map(tag => html`
        <${Chip} key=${tag}>
          ${tag}${' '}
          <${Action} kind="text" title=${t('profile.agents.detail.data_access.tagRemoved')}
            label=${t('profile.agents.detail.data_access.tagRemoved')} onClick=${() => removeTag(tag)}>✗<//>
        <//>
      `)}
      ${adding
        ? html`<span onFocusOut=${() => { if (newTag.trim()) addTag(); else setAdding(false); }}>
            <${Field} inputRef=${inputRef} value=${newTag}
                 placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
                 onInput=${(e) => setNewTag(e.target.value)}
                 onKeyDown=${(e) => {
                   if (e.key === 'Enter') addTag();
                   else if (e.key === 'Escape') { setAdding(false); setNewTag(''); }
                 }} />
          </span>`
        : html`<${Action} kind="text" onClick=${() => setAdding(true)}><${Chip} tone="muted">+ ${t('profile.agents.detail.data_access.addTag')}<//><//>`}
    <//>
  `;
}

function ProblemZone2({ agent, setActiveTab, showToast }) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState(agent.webhook_url || agent.webhookUrl || '');
  const [testing, setTesting] = useState(false);

  async function handleTestWebhook(e) {
    e.stopPropagation();
    setTesting(true);
    try {
      const resp = await testWebhook(agent.name);
      if (resp?.ok !== false) {
        showToast(t('profile.agents.detail.zone2.testWebhookSuccess'));
      } else {
        showToast(t('profile.agents.detail.zone2.testWebhookFailed'), true);
      }
    } catch (err) {
      swallowed('agent-card: handleTestWebhook', err);
      showToast(t('profile.agents.detail.zone2.testWebhookFailed'), true);
    }
    setTesting(false);
  }

  async function handleSaveUrl(e) {
    e.stopPropagation();
    try {
      const resp = await updateWebhook(agent.name, { url: urlValue });
      if (resp?.ok !== false) {
        showToast(t('profile.agents.detail.zone2.urlUpdated'));
        setEditingUrl(false);
      } else {
        showToast(t('profile.agents.detail.zone2.urlUpdateFailed'), true);
      }
    } catch (err) {
      swallowed('agent-card: handleSaveUrl', err);
      showToast(t('profile.agents.detail.zone2.urlUpdateFailed'), true);
    }
  }

  function handleOverrideReadiness(e) {
    e.stopPropagation();
    setActiveTab('integration');
  }

  // What is actually wrong, named by the server. This panel's sentence used to be empty in every
  // real case: it tested a fail count the response did not carry, and `!agent.last_seen`, which is
  // false for the ordinary problem — an agent that HAS been seen, 25 hours ago.
  const delivery = agent?.health?.delivery;
  const reasons = agent?.health?.reasons ?? [];
  const reasonText = {
    'webhook-down': () => t('profile.agents.detail.zone2.webhookFailed', { count: delivery?.fail_count ?? 0 }),
    'never-seen': () => t('profile.agents.detail.zone2.noTelemetry'),
    'stale-24h': () => t('profile.agents.detail.zone2.noTelemetry'),
    'onboarding-failed': () => t('profile.agents.detail.zone2.onboardingFailed'),
  };

  return html`
    <${Surface} kind="aside" tone="danger">
      <${Stack} density="compact">
        <${Text} kind="label">${t('profile.agents.detail.zone2.problemTitle')}<//>
        ${reasons.map(r => html`<${Text}>${(reasonText[r] ?? (() => r))()}<//>`)}
        <${Stack} direction="wrap" align="center">
          ${delivery?.webhook_configured && html`
          <${Action} onClick=${handleTestWebhook} disabled=${testing}>
            ${t('profile.agents.detail.zone2.testWebhook')}
          <//>`}
          <${Action} expanded=${editingUrl} onClick=${() => setEditingUrl(!editingUrl)}>
            ${t('profile.agents.detail.zone2.updateUrl')}
          <//>
          <${Action} onClick=${handleOverrideReadiness}>
            ${t('profile.agents.detail.zone2.overrideReadiness')}
          <//>
        <//>
        ${editingUrl && html`
          <${Stack} direction="wrap" align="end">
            <${Field} type="url" value=${urlValue}
                   onInput=${(e) => setUrlValue(e.target.value)}
                   placeholder="https://..." />
            <${Action} kind="primary" onClick=${handleSaveUrl}>
              ${t('profile.agents.detail.zone2.save')}
            <//>
            <${Action} onClick=${() => setEditingUrl(false)}>
              ${t('profile.agents.detail.zone2.cancel')}
            <//>
          <//>
        `}
      <//>
    <//>
  `;
}

function renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme, openTaskId, openTaskNonce, onDeleteClick) {
  const props = { agent, onboarding, session, showToast, agentName: agent.name, allAgents };
  switch (activeTab) {
    case 'readme': return html`<${TabReadme} readme=${readme} />`;
    case 'integration': return html`<${TabIntegration} ...${props} />`;
    case 'tasks': return html`<${TabTasks} ...${props} openTaskId=${openTaskId} openTaskNonce=${openTaskNonce} />`;
    case 'messages': return html`<${TabMessages} ...${props} />`;
    case 'data-access': return html`<${TabDataAccess} ...${props} />`;
    case 'contracts': return html`<${TabContracts} ...${props} />`;
    case 'directives': return html`<${TabDirectives} ...${props} />`;
    case 'agent-config': return html`<${TabAgentConfig} ...${props} onDeleteClick=${onDeleteClick} />`;
    case 'activity': return html`<${TabActivity} ...${props} />`;
    case 'usage': return html`<${TabUsage} ...${props} />`;
    case 'schedules': return html`<${TabSchedules} ...${props} />`;
    case 'quality': return html`<${TabQuality} ...${props} />`;
    case 'services': return html`<${TabServices} ...${props} />`;
    case 'crew': return html`<${TabCrew} ...${props} />`;
    default: return null;
  }
}

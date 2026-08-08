/**
 * @file agent-card.js
 * @description Agent card component with collapsed/expanded states,
 *   Two-Zone Header (identity + state-dependent status), and tab bar.
 * @version-history
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
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

// README is opt-in and prepended only when the agent has published one, so it
// is NOT in this base list. See readmeTab below.
//
// Explicit owner-requested order (not auto-grouping). The tab bar wraps to a
// second row (flex-wrap, see .pf-agd-tabs CSS) instead of scrolling, so the
// first-listed tabs naturally land on the top row. README is prepended
// separately when present, so the effective order is:
//   README · Integration · Tasks · Messages · Data Access · Quality · Activity
//   · Directives · Agent Config · Services
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
  { id: 'agent-config', key: 'profile.agents.detail.tabs.agent_config' },
  { id: 'services', key: 'profile.agents.detail.tabs.services' },
];

const readmeTab = { id: 'readme', key: 'profile.agents.detail.tabs.readme' };

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

export default function AgentCard({ agent, onboarding, expanded, onToggle, session, showToast, allAgents, changes, onTabSeen, onScopesClick, onDeleteClick, onFederateToggle, onPopOut, soloMode = false, preSelectedTab = null, openTaskId = null, openTaskNonce = 0 }) {
  const state = agentState(agent);
  const [activeTab, setActiveTab] = useState(null);
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

  if (!expanded) {
    return html`
      <div class="pf-agd-card">
        <div class="pf-agd-collapsed ${state === 'problem' ? 'pf-agd-collapsed--problem' : ''}"
             onClick=${() => onToggle(agent.name)}>
          <div class="pf-agd-collapsed-main">
            <span class="pf-agd-expand-icon">▶</span>
            <span class="pf-agd-collapsed-icon">🤖</span>
            <span class="pf-agd-collapsed-name">${agent.display_name || agent.name}</span>
            ${renderChangeBadge(changes)}
            <!-- Mode/platform/readiness badges live in the expanded detail only — repeated
                 identically on every row they were noise, not information. -->
            <div class="pf-agd-collapsed-badges">
              ${agent.federate && html`<span class="pf-agd-badge pf-agd-badge--federation">${t('profile.federated')}</span>`}
            </div>
            ${renderPopOut(onPopOut, agent)}
          </div>
          <!-- Second line: faint-divider-separated meta (delivery + status + last seen)
               so the long status text gets its own row instead of overflowing. -->
          <div class="pf-agd-collapsed-meta">
            ${renderDeliveryIndicator(agent)}
            ${renderCollapsedStats(state, agent, onboarding)}
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="pf-agd-card">
      <div class="pf-agd-expanded">
        <!-- Zone 1: Identity -->
        <div class="pf-agd-zone1" onClick=${handleCollapse}>
          <span class="pf-agd-expand-icon pf-agd-expand-icon--open">▼</span>
          <div class="pf-agd-zone1-identity">
            <span class="pf-agd-zone1-name">${agent.display_name || agent.name}</span>
          </div>
          <div class="pf-agd-zone1-badges">
            ${renderModeBadge(agent)}
            ${renderPlatformBadge(onboarding)}
            ${renderModelBadge(agent)}
            ${renderReadinessBadge(state, onboarding)}
            ${agent.federate && html`<span class="pf-agd-badge pf-agd-badge--federation">${t('profile.federated')}</span>`}
          </div>
          <span class="pf-agd-zone1-right">
            ${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}
          </span>
        </div>

        <!-- Tags (editable) -->
        <${TagStrip} agent=${agent} showToast=${showToast} />

        <!-- Capabilities — collapsed to a one-line summary ("14 tools · 5 skills"); the full
             pill wall took a third of the screen before the tabs. Click to expand. -->
        <${CapabilitiesSummary} agent=${agent} />

        <!-- Zone 2: Status -->
        ${renderZone2(state, agent, onboarding, setActiveTab, showToast)}

        <!-- Tab Bar -->
        <div class="pf-agd-tabs">
          ${tabs.map(tab => {
            const label = t(tab.key);
            const changeKey = TAB_CHANGE_KEY[tab.id];
            // The tab you're currently viewing never shows a badge — you're
            // looking at it (and the effect above keeps it marked-seen).
            const count = (changeKey && activeTab !== tab.id) ? (changes?.[changeKey] || 0) : 0;
            // Neutral gray badge; red ONLY when there are unseen FAILED tasks.
            const failed = tab.id === 'tasks' && (changes?.tasksFailed || 0) > 0;
            return html`
              <button key=${tab.id}
                      class="pf-agd-tab ${activeTab === tab.id ? 'pf-agd-tab--active' : ''}"
                      onClick=${(e) => {
                        e.stopPropagation();
                        userPickedTab.current = true;
                        setActiveTab(tab.id);
                        // Opening a tracked tab clears its unseen badge.
                        if (changeKey && onTabSeen) onTabSeen(agent.name, changeKey);
                      }}>
                ${label !== tab.key ? label : tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}
                ${count > 0 ? html`<span class="pf-agd-tab-badge pf-agd-tab-badge--dot ${failed ? 'pf-agd-tab-badge--failed' : ''}"></span>` : ''}
              </button>
            `;
          })}
        </div>

        <!-- Tab Content -->
        <div class="pf-agd-tab-content" onClick=${(e) => e.stopPropagation()}>
          ${renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme, openTaskId, openTaskNonce, onDeleteClick)}
        </div>

        <!-- Card Footer: Scopes + federation toggle. Delete lives in the Agent Config tab's
             danger zone (typed-name confirm) — not on every tab's footer. -->
        <div class="pf-agd-card-footer">
          <div class="pf-agd-card-actions">
            ${renderPopOut(onPopOut, agent)}
            ${onScopesClick && html`
              <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); onScopesClick(agent); }}>
                ${t('profile.agents.scopeUi.manage')}
              </button>
            `}
            ${onFederateToggle && html`
              <button class="btn-ghost btn-sm"
                title=${agent.federate ? (t('profile.agents.detail.federationOnHint') || 'Click to make local only') : (t('profile.agents.detail.federationOffHint') || 'Click to share via federation')}
                onClick=${(e) => { e.stopPropagation(); onFederateToggle(agent); }}>
                ${(t('profile.agents.detail.federationLabel') || 'Federation')}: ${agent.federate ? (t('profile.agents.detail.federationOn') || 'on') : (t('profile.agents.detail.federationOff') || 'off')}
              </button>
            `}
          </div>
        </div>
      </div>
    </div>
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
  return html`
    <div class="pf-agd-capwrap">
      <button class="pf-agd-cap-summary" onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>
        ${parts.join(' · ')} <span class="pf-chevron ${open ? 'pf-chevron-open' : ''}">▼</span>
      </button>
      ${open && html`
        <div class="pf-agd-capabilities">
          ${tools.map(c => html`
            <span key=${c.name || c} class="pf-agd-cap-badge pf-agd-cap-badge--tech">${c.name || c}</span>
          `)}
          ${skills.map(c => html`
            <span key=${c} class="pf-agd-cap-badge pf-agd-cap-badge--domain">${c}</span>
          `)}
          ${langs.map(l => html`
            <span key=${'lang-' + l} class="pf-agd-cap-badge pf-agd-cap-badge--domain">${'Language: ' + l}</span>
          `)}
        </div>
      `}
    </div>
  `;
}

// Pop-out button: opens this agent in its own window (one window per agent,
// so re-clicking focuses the existing one). Only rendered when the parent
// supplies onPopOut — the standalone solo view omits it.
function renderPopOut(onPopOut, agent) {
  if (!onPopOut) return null;
  return html`<button class="pf-agd-popout-btn" title=${t('profile.agents.detail.popOut')}
    onClick=${(e) => { e.stopPropagation(); onPopOut(agent); }}>⤢</button>`;
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
  return html`<span class="pf-agd-change-badge pf-agd-change-badge--dot ${failed ? 'pf-agd-change-badge--failed' : ''}" title=${title}></span>`;
}

/**
 * How this agent is reached, from the server's verdict.
 *
 * Was computed here from `agent.webhookUrl` (not in the response), `agent.mcpEnabled` (not a field
 * on any record) and a fail threshold of 5 that disagreed with the server's 10. So the warning icon
 * could never appear, and the MCP labels could never be chosen. The MCP branch is gone rather than
 * rewired: there is nothing to rewire it to.
 */
function renderDeliveryIndicator(agent) {
  const delivery = agent?.health?.delivery;
  if (!delivery) return null;
  const label = delivery.webhook_configured
    ? t('profile.agents.detail.deliveryWh')
    : t('profile.agents.detail.deliveryPolling');
  const icon = delivery.webhook_configured ? (delivery.channel === 'webhook-failing' ? '⚠' : '✓') : '';

  return html`<span class="pf-agd-delivery-indicator">${label}${icon ? ` ${icon}` : ''} · </span>`;
}

function renderPlatformBadge(onboarding) {
  const platform = onboarding?.platformName || onboarding?.detectedPlatform;
  if (!platform) return null;
  const version = onboarding?.platformVersion;
  return html`<span class="pf-agd-badge pf-agd-badge--platform">${platform}${version ? ` v${version}` : ''}</span>`;
}

// Self-reported primary LLM (indicative — coding platforms delegate to subagents on other
// models mid-session). Comes from the owner agent list projection (agent.model).
function renderModelBadge(agent) {
  if (!agent?.model) return null;
  return html`<span class="pf-agd-badge pf-agd-badge--model" title=${t('profile.agents.modelBadgeTitle')}>${agent.model}</span>`;
}

function renderReadinessBadge(state, onboarding) {
  if (state === 'system') {
    // Internal (auto-provisioned) agent — no device-auth onboarding / readiness.
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">${t('profile.agents.detail.state.internal')}</span>`;
  }
  if (state === 'new') {
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  }
  if (state === 'onboarding') {
    const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
    const total = onboarding?.steps?.length ?? 11;
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-onboarding">${t('profile.agents.detail.state.onboarding')}: ${passed}/${total}</span>`;
  }
  if (state === 'problem') {
    const level = onboarding?.readinessLevel || 'none';
    const score = onboarding?.readinessScore;
    if (!score && score !== 0) return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
    const label = t(`agentOnboarding.readiness.${level}`);
    // No "degraded ↓" marker: it was driven by onboarding.previousReadinessLevel, which is not a
    // field on the record, has no column in either backend and is written nowhere — so the arrow
    // could never appear. Reintroducing it needs a stored previous level first, not a rank table.
    return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level}">${label} (${score})</span>`;
  }
  // idle and production both show level + score
  const level = onboarding?.readinessLevel || 'none';
  const score = onboarding?.readinessScore;
  if (!score && score !== 0) return html`<span class="pf-agd-badge pf-agd-badge--readiness-none">--</span>`;
  const label = t(`agentOnboarding.readiness.${level}`);
  return html`<span class="pf-agd-badge pf-agd-badge--readiness-${level}"
    title=${t('profile.agents.detail.readinessTooltip') || 'Readiness score 0–100 from onboarding checks. Levels: none → basic → standard → advanced → full.'}>${label} (${score})</span>`;
}

function renderCollapsedStats(state, agent, onboarding) {
  switch (state) {
    case 'new':
      return html`${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)} · ` : ''}${t('profile.agents.detail.state.newSummary')}`;
    case 'onboarding': {
      const nextStep = onboarding?.steps?.find(s => s.status === 'pending');
      return html`${agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}${nextStep ? ` · ${t('profile.agents.detail.state.next')}: ${tOr('agentOnboarding.steps.' + nextStep.id, nextStep.title || nextStep.id)}` : ''}`;
    }
    case 'problem':
      return html`${t('profile.agents.detail.state.problemSummary')}${agent.last_seen ? ` · ${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : ''}`;
    case 'idle':
    case 'production':
    default: {
      const parts = [];
      if (agent.last_seen) parts.push(`${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}`);
      if (agent.taskStats) {
        const { done, active: act } = agent.taskStats;
        if (done || act) parts.push(`${t('profile.agents.detail.today')}: ${done || 0} ${t('profile.agents.detail.done')}${act ? `, ${act} ${t('profile.agents.detail.active')}` : ''}`);
      }
      if (agent.tokensUsedToday != null) parts.push(`${t('profile.agents.detail.tokensToday')}: ${agent.tokensUsedToday.toLocaleString()}`);
      return html`${parts.join(' · ')}`;
    }
  }
}

function renderZone2(state, agent, onboarding, setActiveTab, showToast) {
  switch (state) {
    case 'system':
      // Internal (auto-provisioned) agents skip the Hello Integration banner.
      return null;
    case 'new':
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--new">
          <div class="pf-agd-zone2-title">${t('profile.agents.detail.zone2.newTitle')}</div>
          <div class="pf-agd-zone2-desc">${t('profile.agents.detail.zone2.newDesc')}</div>
          <div class="pf-agd-zone2-actions">
            <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); setActiveTab('integration'); }}>
              ${t('profile.agents.detail.zone2.goToIntegration')}
            </button>
          </div>
        </div>
      `;
    case 'onboarding': {
      const steps = onboarding?.steps || [];
      const passed = steps.filter(s => s.status === 'passed').length;
      const total = steps.length || 11;
      const pct = Math.round((passed / total) * 100);
      const nextStep = steps.find(s => s.status === 'pending');
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--onboarding">
          <div class="pf-agd-zone2-title">
            ${t('profile.agents.detail.zone2.onboardingTitle')}: ${passed} / ${total}
            ${nextStep ? html`<span class="pf-agd-zone2-desc"> ${t('profile.agents.detail.state.next')}: ${tOr('agentOnboarding.steps.' + nextStep.id, nextStep.title || nextStep.id)}</span>` : ''}
          </div>
          <div class="pf-agd-progress-bar">
            <div class="pf-agd-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="pf-agd-step-pills">
            ${steps.map(s => html`
              <span key=${s.id} class="pf-agd-step-pill pf-agd-step-pill--${s.status}">
                ${s.status === 'passed' ? '✓' : '○'} ${tOr('agentOnboarding.steps.' + s.id, s.title || s.id)}
              </span>
            `)}
          </div>
        </div>
      `;
    }
    case 'problem':
      return html`<${ProblemZone2} agent=${agent} setActiveTab=${setActiveTab} showToast=${showToast} />`;

    case 'idle':
    case 'production':
    default: {
      // Same source as the header indicator — see renderDeliveryIndicator for why the MCP branch
      // is gone rather than rewired.
      const deliveryLabel = agent?.health?.delivery?.webhook_configured
        ? t('profile.agents.detail.deliveryWh')
        : t('profile.agents.detail.deliveryPolling');
      const stats = agent.taskStats;
      return html`
        <div class="pf-agd-zone2 pf-agd-zone2--production">
          <div class="pf-agd-zone2-stats">
            <span>${deliveryLabel}</span>
            ${agent.last_seen ? html`<span>${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}</span>` : ''}
            ${stats && (stats.done || stats.active) ? html`<span>${t('profile.agents.detail.today')}: ${stats.done || 0} ${t('profile.agents.detail.done')}${stats.active ? `, ${stats.active} ${t('profile.agents.detail.active')}` : ''}</span>` : ''}
            ${agent.tokensUsedToday != null ? html`<span>${t('profile.agents.detail.tokensToday')}: ${agent.tokensUsedToday.toLocaleString()}</span>` : ''}
          </div>
        </div>
      `;
    }
  }
}

function renderModeBadge(agent) {
  const mode = agent.mode || 'interactive';
  const label = t(`profile.agents.mode.${mode}`) || mode;
  return html`<span class="pf-agd-badge pf-agd-badge--mode pf-agd-badge--mode-${mode}" title=${t('profile.agents.mode.tooltip') || ''}>${label}</span>`;
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

  return html`
    <div class="pf-agd-tag-strip pf-agd-tag-strip--editable">
      ${tags.map(tag => html`
        <span key=${tag} class="pf-agd-tag-chip pf-agd-tag-chip--editable">
          ${tag}
          <button class="pf-agd-tag-chip-remove" title=${t('profile.agents.detail.data_access.tagRemoved')}
                  onClick=${(e) => { e.stopPropagation(); removeTag(tag); }}>×</button>
        </span>
      `)}
      ${adding
        ? html`<input class="pf-agd-tag-add-input" autofocus value=${newTag}
                 placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
                 onInput=${(e) => setNewTag(e.target.value)}
                 onKeyDown=${(e) => {
                   if (e.key === 'Enter') addTag();
                   else if (e.key === 'Escape') { setAdding(false); setNewTag(''); }
                 }}
                 onBlur=${() => { if (newTag.trim()) addTag(); else setAdding(false); }} />`
        : html`<button class="pf-agd-tag-add-btn" onClick=${() => setAdding(true)}>+ ${t('profile.agents.detail.data_access.addTag')}</button>`}
    </div>
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
    <div class="pf-agd-zone2 pf-agd-zone2--problem">
      <div class="pf-agd-zone2-title">${t('profile.agents.detail.zone2.problemTitle')}</div>
      <div class="pf-agd-zone2-desc">
        ${reasons.map(r => html`<div>${(reasonText[r] ?? (() => r))()}</div>`)}
      </div>
      <div class="pf-agd-zone2-actions">
        ${delivery?.webhook_configured && html`
        <button class="btn-outline btn-sm" onClick=${handleTestWebhook} disabled=${testing}>
          ${t('profile.agents.detail.zone2.testWebhook')}
        </button>`}
        <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingUrl(!editingUrl); }}>
          ${t('profile.agents.detail.zone2.updateUrl')}
        </button>
        <button class="btn-outline btn-sm" onClick=${handleOverrideReadiness}>
          ${t('profile.agents.detail.zone2.overrideReadiness')}
        </button>
      </div>
      ${editingUrl && html`
        <div class="pf-agd-zone2-url-form">
          <input type="text" value=${urlValue}
                 onInput=${(e) => setUrlValue(e.target.value)}
                 onClick=${(e) => e.stopPropagation()}
                 placeholder="https://..." />
          <button class="btn-primary btn-sm" onClick=${handleSaveUrl}>
            ${t('profile.agents.detail.zone2.save')}
          </button>
          <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setEditingUrl(false); }}>
            ${t('profile.agents.detail.zone2.cancel')}
          </button>
        </div>
      `}
    </div>
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
    default: return null;
  }
}

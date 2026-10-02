/**
 * @file agent-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent card component with collapsed/expanded states,
 *   Two-Zone Header (identity + state-dependent status), and tab bar.
 * @version-history
 *   v2.27.0 -- 2026-10-02 -- The question mark that explains the run mode: agent.run_mode on its CardLine label (components/HelpTip.js).
 *   v2.26.0 -- 2026-10-02 -- The opened card names the last task, who ordered it and when (LastTaskLine).
 *   v2.25.0 -- 2026-10-02 -- WildcardLine under the start switch for an agent holding `*`.
 *   v2.24.0 -- 2026-10-02 -- The opened card sets the agent's daily purchase limit in money (PurchaseLimitLine).
 *   v2.23.0 -- 2026-10-01 -- The opened card says where the agent runs, what it thinks with, who pays,
 *     what it did this week, and has the "Starts work by itself" switch (agent-card-autonomy.js,
 *     guided journey P4).
 *   v2.22.0 -- 2026-09-30 -- What your AIMEAT refused the agent for a missing permission, and what it asked
 *     for beside what it got (agent-card-access.js): the note on the open card, the line under how it
 *     runs, and a danger mark with the attention name on the closed row.
 *   v2.21.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the closed
 *     row is the List row (components/List.js, drag and its grip in the gutter included); the open card
 *     is the OpenCard (components/OpenCard.js: the headline that closes, the words and the side, the
 *     run-mode line, the tabs in their groups, the panel); the marks are Mark, the access sticker is
 *     Sticker, the onboarding bar is Meter, the tags are the TagInput, the notices are the Note's
 *     aside. Main's dim tags (og-chip--dim: the mode, the platform, federated, the capabilities) come
 *     back as Mark tone="dim"; the working agent's line of figures shows, as on main, only in the
 *     agent's own window (the agents page hid it).
 *   v2.20.0 -- 2026-09-26 -- A tag's ✗ is the Tag's remove mark (.poster-chip-x, poster.css), the look it already had (a unification: Jouni's decision "Remove mark").
 *   v2.19.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v2.18.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.17.0 -- 2026-09-26 -- A comment that pointed at the removed renderDeliveryIndicator now carries its reason itself.
 *   v2.16.0 -- 2026-09-26 -- How it runs is the row (.poster-row, its two hairlines); its own size and weight go (a unification).
 *   v2.15.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside) in its own words; a working agent's line of figures is the Hint, a unification: Jouni's decision Attention note.
 *   v2.14.0 -- 2026-09-25 -- How far an agent got through Hello Integration is the meter (poster.css .poster-box--meter), a unification: the look most tabs use.
 *   v2.13.0 -- 2026-09-25 -- A dot that says a state (active, inactive, running, something unseen) is the status dot (css/components/status-dot.css), a unification: the look most tabs use.
 *   v2.12.0 -- 2026-09-25 -- A setting that is on or off (the agent's federation) is the Switch (components/Switch.js), a unification: the look most tabs use.
 *   v2.11.0 -- 2026-09-25 -- Every quiet way on is the action link (.poster-action, its quiet tone where it sits among controls), and the one loud action is the dark block (.poster-slab, its control cut), a unification: Jouni's decisions Action link and Loud action.
 *   v2.10.0 -- 2026-09-25 -- The closed row is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v2.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.8.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v2.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v2.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
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
import { deliveryLabel, renderPlatformBadge, renderModelBadge, renderReadinessBadge, stepTone } from './agent-card-badges.js';
import { RunModeSwitch } from './agent-card-run-mode.js';
import { FactsLine, LastTaskLine, PurchaseLimitLine, AutonomyLine, WildcardLine } from './agent-card-autonomy.js';
import { RefusalNote, AccessLine, hasRefusals } from './agent-card-access.js';
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
import { Switch } from '/components/Switch.js';
import { List, Row, Name, Who, When, Doors } from '/components/List.js';
import { OpenCard, CardLine, TabGroups, CardPanel } from '/components/OpenCard.js';
import { Action, Actions } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Sticker, Meter } from '/components/Figure.js';
import { SubHeading } from '/components/SubHeading.js';
import { HelpLabel } from '/components/HelpTip.js';
import { TagInput } from '/components/TagInput.js';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);

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

/**
 * `drag`: the closed row can be dragged ({ grip, dragging, onDragStart, onDragOver, onDrop, onDragEnd },
 * from groups-render.js); the open card never is, so its inner controls stay usable.
 */
export default function AgentCard({ agent, onboarding, expanded, onToggle, session, showToast, allAgents, changes, onTabSeen, onScopesClick, onDeleteClick, onFederateToggle, onPopOut, soloMode = false, preSelectedTab = null, openTaskId = null, openTaskNonce = 0, drag = null }) {
  const state = agentState(agent);
  const [activeTab, setActiveTab] = useState(null);
  // The run-mode switch stands behind the sentence that says the current state; open on request.
  const [runsOpen, setRunsOpen] = useState(false);
  // The capabilities tag opens the full list under the marks.
  const [capsOpen, setCapsOpen] = useState(false);
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
    // The List (components/List.js) with one row: the wrapper around each row (groups-render.js)
    // sits between the rows, so each row carries its own grid of the same cut. A press anywhere on
    // the row opens the agent; its name turns coral under the pointer or when the agent is in trouble.
    const change = changeMark(changes);
    return html`
      <${List} cols="name-runs-access-last-doors" keepCols>
        <${Row} onToggle=${() => onToggle(agent.name)}
          draggable=${!!drag} grip=${drag?.grip} dragging=${drag?.dragging}
          onDragStart=${drag?.onDragStart} onDragOver=${drag?.onDragOver} onDrop=${drag?.onDrop} onDragEnd=${drag?.onDragEnd}>
          <${Name} attention=${state === 'problem' || hasRefusals(agent)} dot=${change?.dot} dotTitle=${change?.title} meta=${agentGaii(agent)}
            tag=${[
              hasRefusals(agent) ? html`<${Mark} kind="status" tone="danger">${t('profile.agents.refusals.mark')}<//>` : null,
              agent.mode && agent.mode !== 'interactive' ? html`<${Mark} tone="dim">${t(`profile.agents.mode.${agent.mode}`) || agent.mode}<//>` : null,
              platform ? html`<${Mark} tone="dim">${platform}<//>` : null,
              agent.federate ? html`<${Mark} tone="dim">${t('profile.federated')}<//>` : null,
            ]}>${agent.display_name || agent.name}<//>
          <${Who}>${runsWord}<//>
          <${Who}>${accessLabel}<//>
          <${When}>${agent.last_seen ? timeAgo(agent.last_seen) : t('profile.agents.page.neverSeen')}<//>
          <${Doors}><${Action} small row>${t('profile.agents.page.openRow')}<//><//>
        <//>
      <//>
    `;
  }

  // The tabs in three groups (design canvas "Your Agents", header B): a person looks in one group
  // of five instead of scanning fourteen. README joins Knowledge only when the agent has one.
  const tabIds = new Set(tabs.map(x => x.id));
  const tabItem = (tab) => {
    const label = t(tab.key);
    const changeKey = TAB_CHANGE_KEY[tab.id];
    // The tab you're currently viewing never shows a badge — you're
    // looking at it (and the effect above keeps it marked-seen).
    const count = (changeKey && activeTab !== tab.id) ? (changes?.[changeKey] || 0) : 0;
    // Neutral dot; coral ONLY when there are unseen FAILED tasks.
    const failed = tab.id === 'tasks' && (changes?.tasksFailed || 0) > 0;
    return {
      value: tab.id,
      label: label !== tab.key ? label : tab.id.charAt(0).toUpperCase() + tab.id.slice(1),
      dot: count > 0 ? (failed ? 'failed' : 'new') : undefined,
    };
  };
  const groups = TAB_GROUPS.map(g => ({
    key: g.id,
    label: t(g.key),
    items: g.tabs.filter(id => tabIds.has(id)).map(id => tabItem(tabs.find(x => x.id === id))),
  }));
  const pickTab = (id) => {
    userPickedTab.current = true;
    setActiveTab(id);
    // Opening a tracked tab clears its unseen badge.
    const changeKey = TAB_CHANGE_KEY[id];
    if (changeKey && onTabSeen) onTabSeen(agent.name, changeKey);
  };
  const caps = capabilitiesOf(agent);
  const seenTone = state === 'problem' ? 'danger' : (state === 'production' || state === 'idle') ? 'fine' : 'off';

  // The name is the card's slab, the full width, the way a section starts; the facts and the
  // access sticker sit in the row under it, so nothing competes with the name for the line.
  return html`
    <${OpenCard} title=${agent.display_name || agent.name} onClose=${handleCollapse}
      id=${html`<${GaiiChip} agent=${agent} />`}
      marks=${html`
        ${renderModeBadge(agent)}
        ${renderPlatformBadge(onboarding)}
        ${renderModelBadge(agent)}
        ${renderReadinessBadge(state, onboarding)}
        ${agent.last_seen ? html`<${Mark} kind="status" tone=${seenTone}>${agent?.health?.delivery ? deliveryLabel(agent.health.delivery) : t('profile.agents.detail.lastSeen')} · ${timeAgo(agent.last_seen)}<//>` : null}
        ${caps.summary ? html`<${Mark} tone="dim" expanded=${capsOpen} onClick=${() => setCapsOpen(o => !o)}>${caps.summary} ${capsOpen ? '↑' : '↓'}<//>` : null}
        ${onFederateToggle
          ? html`<span title=${agent.federate ? (t('profile.agents.detail.federationOnHint') || 'Click to make local only') : (t('profile.agents.detail.federationOffHint') || 'Click to share via federation')}>
              <${Switch} on=${!!agent.federate} onToggle=${() => onFederateToggle(agent)}
                label=${`${t('profile.agents.detail.federationLabel')} ${agent.federate ? t('profile.agents.detail.federationOn') : t('profile.agents.detail.federationOff')}`} />
            </span>`
          : agent.federate ? html`<${Mark} tone="dim">${t('profile.federated')}<//>` : null}
        <${TagStrip} agent=${agent} showToast=${showToast} />`}
      more=${capsOpen && caps.summary ? caps.all.map(c => html`<${Mark} key=${c.key} tone=${c.dim ? 'dim' : undefined}>${c.label}<//>`) : null}
      side=${html`
        <${Sticker} figure=${accessLabel}>
          ${onScopesClick && html`<${Action} small onClick=${() => onScopesClick(agent)}>${t('profile.agents.page.manageAccess')} →<//>`}
        <//>
        ${renderPopOut(onPopOut, agent)}
        ${renderHostConsole(agent)}`}>

      ${/* How this agent is meant to be RUN: one sentence, and the switch behind one door. The
            node stores and shows this and never enforces it; the sentence says what is true. */''}
      <${CardLine} label=${html`<${HelpLabel} term="agent.run_mode" label=${t('profile.agents.runMode.label')}>${t('profile.agents.runMode.label')}<//>`} below=${runsOpen && html`<${RunModeSwitch} agent=${agent} showToast=${showToast} />`}>
        <span>${t(`profile.agents.page.runs.${agent.run_mode || 'unset'}`)}</span>
        <${Action} small soft onClick=${() => setRunsOpen(v => !v)}>
          ${runsOpen ? t('profile.agents.page.close') : (agent.run_mode ? t('profile.agents.page.runsChange') : t('profile.agents.page.runsDecide'))} →
        <//>
      <//>
      ${/* Where it runs, what it thinks with, who pays, and whether it starts work by itself. */''}
      <${FactsLine} agent=${agent} />
      <${LastTaskLine} agent=${agent} />
      <${PurchaseLimitLine} agent=${agent} showToast=${showToast} />
      <${AutonomyLine} agent=${agent} showToast=${showToast} />
      <${WildcardLine} agent=${agent} showToast=${showToast} />
      <${AccessLine} agent=${agent} />

      ${/* What your AIMEAT refused this agent for a missing permission, with the way to grant it. */''}
      <${RefusalNote} agent=${agent} onScopesClick=${onScopesClick} showToast=${showToast} />

      ${/* The status banner while the agent is new, onboarding or in trouble. */''}
      ${renderZone2(state, agent, onboarding, setActiveTab, showToast, soloMode)}

      <${TabGroups} groups=${groups} value=${activeTab} onSelect=${pickTab} />

      <${CardPanel}>
        ${renderTabContent(activeTab, agent, onboarding, session, showToast, allAgents, readme, openTaskId, openTaskNonce, onDeleteClick)}
      <//>
    <//>
  `;
}

// Capabilities summary — "14 tools · 5 skills · 2 languages" on one line, expanding to the
// full pill list on click. Headers should identify, not enumerate. The tag stands in the masthead's
// row; the full list opens under the row (the card's `more` takes the words' whole width) so a wall
// of pills never sits between the name and the tabs uninvited.
function capabilitiesOf(agent) {
  const tools = agent.technical_capabilities || [];
  const skills = (agent.domain_capabilities || []).filter(c => !String(c).startsWith('Language: '));
  const langs = agent.languages || [];
  if (tools.length === 0 && skills.length === 0 && langs.length === 0) return { summary: null, all: [] };
  const parts = [];
  if (tools.length) parts.push(`${tools.length} ${t('profile.agents.detail.capTools') || 'tools'}`);
  if (skills.length) parts.push(`${skills.length} ${t('profile.agents.detail.capSkills') || 'skills'}`);
  if (langs.length) parts.push(`${langs.length} ${t('profile.agents.detail.capLangs') || 'languages'}`);
  // A tool is a plain tag; a skill and a language are dim, as main drew them (og-chip--dim).
  const all = [
    ...tools.map(c => ({ key: c.name || c, label: c.name || c })),
    ...skills.map(c => ({ key: c, label: c, dim: true })),
    ...langs.map(l => ({ key: 'lang-' + l, label: 'Language: ' + l, dim: true })),
  ];
  return { summary: parts.join(' · '), all };
}

// The way to this agent's own window (one window per agent, so re-clicking focuses the existing
// one). Only rendered when the parent supplies onPopOut — the standalone solo view omits it.
function renderPopOut(onPopOut, agent) {
  if (!onPopOut) return null;
  return html`<${Action} small soft title=${t('profile.agents.detail.popOut')}
    onClick=${(e) => { e.stopPropagation(); onPopOut(agent); }}>${t('profile.agents.detail.popOut')} ↗<//>`;
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
  return html`<${Action} small soft href=${url} newTab noReferrer
    title=${url} onClick=${(e) => e.stopPropagation()}>${t('profile.agents.detail.openInHost', { host })} ↗<//>`;
}

// Collapsed-card mini-badge: total unseen changes across Tasks/Messages/Memory,
// so the owner can spot at a glance which agent has something new. Hidden when
// nothing changed; naturally absent from the expanded view (which does not
// render the collapsed bar). The title spells out the per-tab breakdown.
// It is the name's status dot (List Name `dot`): neutral, or red ONLY for unseen FAILED tasks.
function changeMark(changes) {
  const total = totalChanges(changes);
  if (total <= 0) return null;
  const parts = [];
  if (changes.tasks) parts.push(t('profile.agents.detail.tabs.tasks'));
  if (changes.messages) parts.push(t('profile.agents.detail.tabs.messages'));
  const title = `${t('profile.agents.detail.changes.title')} — ${parts.join(', ')}`;
  const failed = (changes.tasksFailed || 0) > 0;
  return { dot: failed ? 'error' : 'new', title };
}

/** The first line of a notice: its title, and after it what comes next. */
const zoneTitle = (words, next) => html`<${SubHeading}>${words}${next ? html` <${Note} kind="meta" inline>${next}<//>` : null}<//>`;

// The notice under the mast while the agent is new, onboarding or in trouble. A working agent's line
// of figures (idle, production) was hidden on the agents page on main (the rows and the marks say
// the same); it shows in the agent's own window, as it did.
function renderZone2(state, agent, onboarding, setActiveTab, showToast, soloMode) {
  switch (state) {
    case 'system':
      // Internal (auto-provisioned) agents skip the Hello Integration banner.
      return null;
    case 'new':
      return html`
        <${Note} kind="aside" size="small">
          ${zoneTitle(t('profile.agents.detail.zone2.newTitle'))}
          <div>${t('profile.agents.detail.zone2.newDesc')}</div>
          <${Actions}>
            <${Action} small onClick=${(e) => { e.stopPropagation(); setActiveTab('integration'); }}>
              ${t('profile.agents.detail.zone2.goToIntegration')}
            <//>
          <//>
        <//>
      `;
    case 'onboarding': {
      const steps = onboarding?.steps || [];
      const passed = steps.filter(s => s.status === 'passed').length;
      const total = steps.length || 11;
      const pct = Math.round((passed / total) * 100);
      const nextStep = steps.find(s => s.status === 'pending');
      return html`
        <${Note} kind="aside" size="small" tone="waiting">
          ${zoneTitle(`${t('profile.agents.detail.zone2.onboardingTitle')}: ${passed} / ${total}`,
            nextStep ? `${t('profile.agents.detail.state.next')}: ${tOr('agentOnboarding.steps.' + nextStep.id, nextStep.title || nextStep.id)}` : null)}
          <${Meter} thin pct=${pct} />
          <${Marks}>
            ${steps.map(s => html`
              <${Mark} key=${s.id} kind="status" tone=${stepTone(s.status)}>
                ${s.status === 'passed' ? '✓' : '○'} ${tOr('agentOnboarding.steps.' + s.id, s.title || s.id)}
              <//>
            `)}
          <//>
        <//>
      `;
    }
    case 'problem':
      return html`<${ProblemZone2} agent=${agent} setActiveTab=${setActiveTab} showToast=${showToast} />`;

    case 'idle':
    case 'production':
    default: {
      if (!soloMode) return null;
      // The server's channel verdict (services/agent-health.ts), as the header's status reads it. An
      // MCP branch used to be computed here from fields no record carries, so it could never be
      // chosen; it is gone rather than rewired, because there is nothing to rewire it to.
      const zoneDelivery = agent?.health?.delivery
        ? deliveryLabel(agent.health.delivery)
        : t('profile.agents.detail.deliveryPolling');
      const stats = agent.taskStats;
      const parts = [
        zoneDelivery,
        agent.last_seen ? `${t('profile.agents.detail.lastSeen')}: ${timeAgo(agent.last_seen)}` : null,
        stats && (stats.done || stats.active) ? `${t('profile.agents.detail.today')}: ${stats.done || 0} ${t('profile.agents.detail.done')}${stats.active ? `, ${stats.active} ${t('profile.agents.detail.active')}` : ''}` : null,
        agent.tokensUsedToday != null ? `${t('profile.agents.detail.tokensToday')}: ${num(agent.tokensUsedToday)}` : null,
      ].filter(Boolean);
      return html`<${Note}>${parts.join(' · ')}<//>`;
    }
  }
}

function renderModeBadge(agent) {
  const mode = agent.mode || 'interactive';
  const label = t(`profile.agents.mode.${mode}`) || mode;
  return html`<${Mark} tone="dim" title=${t('profile.agents.mode.tooltip') || ''}>${label}<//>`;
}

// Editable tag strip shown in the expanded card header. The same owner-managed
// tags drive the list's tag filter and "Group by: Tag" (and double as the shared
// memory namespace agents.tag.<tag>.*), so editing here is the convenient inline
// path — no need to dig into the Data Access (Muisti) sub-tab. Writes go through
// the same PATCH /v1/agents/:name/tags route; the server emits an `agents`
// change so the live-update refresh keeps the list's filter/grouping in sync.
// The TagInput (components/TagInput.js) owns the keys: Enter or a comma adds, Escape closes the field,
// leaving it adds what was typed; each add and each remove is its own save.
function TagStrip({ agent, showToast }) {
  const [tags, setTags] = useState(agent.tags ?? []);
  // Re-sync when the parent reloads the agent (e.g. after a live-update).
  useEffect(() => { setTags(agent.tags ?? []); }, [agent.tags]);

  const agentName = agent.name;

  async function addTag(typed) {
    const tag = String(typed || '').trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    try {
      const updated = [...tags, tag];
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
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
    <${TagInput} tags=${tags} lowercase onAdd=${addTag} onRemove=${removeTag}
      addLabel=${t('profile.agents.detail.data_access.addTag')}
      removeLabel=${t('profile.agents.detail.data_access.tagRemoved')}
      placeholder=${t('profile.agents.detail.data_access.tagPlaceholder')}
      ariaLabel=${t('profile.agents.detail.data_access.addTag')} />
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
    <${Note} kind="aside" size="small">
      ${zoneTitle(t('profile.agents.detail.zone2.problemTitle'))}
      <div>
        ${reasons.map(r => html`<div key=${r}>${(reasonText[r] ?? (() => r))()}</div>`)}
      </div>
      <${Actions}>
        ${delivery?.webhook_configured && html`
        <${Action} small onClick=${handleTestWebhook} disabled=${testing}>
          ${t('profile.agents.detail.zone2.testWebhook')}
        <//>`}
        <${Action} small onClick=${(e) => { e.stopPropagation(); setEditingUrl(!editingUrl); }}>
          ${t('profile.agents.detail.zone2.updateUrl')}
        <//>
        <${Action} small onClick=${handleOverrideReadiness}>
          ${t('profile.agents.detail.zone2.overrideReadiness')}
        <//>
      <//>
      ${editingUrl && html`
        <${TextField} type="text" value=${urlValue} onInput=${setUrlValue}
          onClick=${(e) => e.stopPropagation()} placeholder="https://..."
          actions=${html`
            <${Action} small onClick=${handleSaveUrl}>${t('profile.agents.detail.zone2.save')}<//>
            <${Action} small onClick=${(e) => { e.stopPropagation(); setEditingUrl(false); }}>${t('profile.agents.detail.zone2.cancel')}<//>`} />
      `}
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

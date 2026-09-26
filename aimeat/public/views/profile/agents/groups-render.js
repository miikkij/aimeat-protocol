/**
 * @file public/views/profile/agents/groups-render.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agents-tab list rendering: tag filter bar, fleet "running now" panel, and the
 *   grouped agent-card renderer (none / custom groups / mode / tag). Extracted from
 *   ../agents-tab.js to satisfy max-file-lines.
 * @version-history
 *   v2.18.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the search
 *     is the List's SearchLine, the tag filters are Filters with Filter, the group-by is the Select,
 *     the table head is the List's head, the headings over a group of agents are the List's Group (its
 *     fold arrow, its tally, its ✗, and the drop onto it), the rename field is the TextField, and a
 *     draggable agent passes its drag to its row (the grip in the gutter, the dragged row dimmed).
 *   v2.17.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.16.0 -- 2026-09-26 -- Running now is the Group heading over the Listing (cut mark-name-desc-doors), a unification: Jouni's decision Group heading and the look most tabs use for a list.
 *   v2.15.0 -- 2026-09-25 -- Every heading over a group of agents is the Group heading (.poster-day-title); its row keeps only its layout, a unification: Jouni's decision Group heading.
 *   v2.14.0 -- 2026-09-25 -- A dot that says a state (active, inactive, running, something unseen) is the status dot (css/components/status-dot.css), a unification: the look most tabs use.
 *   v2.13.0 -- 2026-09-25 -- A line that says there is nothing (none, and the more under the running tasks) is the quiet sentence (.poster-quiet); a place keeps only its margin (a unification: Jouni's decision Empty line).
 *   v2.12.0 -- 2026-09-25 -- The agents table's head row is the Listing's head row (css/components/listing.css), a unification: the look most tabs use.
 *   v2.11.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.10.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.8.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v2.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 -- 2026-09-25 -- A button that is a mark, not a word (a delete or close mark, a menu's
 *     dots, an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's
 *     decision "Icon button").
 *   v2.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v2.1.0 -- 2026-09-14 -- FilterBar is a component: the tags fold past twelve, and open on a door.
 *   v2.0.0 -- 2026-09-14 -- The poster face (design canvas "Your Agents"): the search as an underlined
 *     field, the filter line as chips and a select, the list as a table with a head row in the
 *     plain view, group heads as a 3px rule with the count in mono.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.3.0 -- 2026-09-13 -- Compose top rules from poster.css; move board colours into CSS.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.2.0 — 2026-09-06 — AgentSearch: one field above the board that narrows the board and the
 *     list together, on the agent's name or its GAII. Seventy-one agents on one account is past
 *     the point where scrolling finds anything, and the person looking already knows which one
 *     they want.
 *   v1.1.0 — 2026-08-31 — In the DEFAULT view the owner's own tool connections (mode `workstation`)
 *     fall under a standing heading at the end instead of being mixed into the list. Grouping by
 *     mode already existed, but behind a dropdown nobody opens, and mixing them is what made an MCP
 *     connection read as an agent that runs on its own.
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import AgentCard from './agent-card.js';
import { effectiveOrderedNames, matchesAgentQuery, UNGROUPED_ID } from './tab-helpers.js';
import { List, Row, Name, Desc, Doors, Group, Filters, Filter, SearchLine } from '/components/List.js';
import { Action, Icon } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Row as Line, Space } from '/components/Layout.js';

const AGENT_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'];

/**
 * The fleet search, above the board rather than above the list: it narrows both, so the status
 * pills never count agents the list below is not showing. Name or GAII, because those are the two
 * strings a person arrives with — one from the screen, the other from wherever they pasted it.
 * @param {{ query: string, setQuery: (v: string) => void, shown: number, total: number }} props
 */
export function AgentSearch({ query, setQuery, shown, total }) {
  const active = query.trim() !== '';
  return html`
    <${SearchLine} value=${query}
      placeholder=${t('profile.agents.search.placeholder')}
      label=${t('profile.agents.search.placeholder')}
      onInput=${(e) => setQuery(e.target.value)}
      note=${active ? html`${t('profile.agents.search.count', { shown, total })} · <${Action} small soft onClick=${() => setQuery('')}>${t('profile.agents.filter.clear')}<//>` : null} />
  `;
}

/** The head of the agents table: the six columns every closed row (agent-card.js) fills. */
function tableHead() {
  const p = (k) => t('profile.agents.page.' + k);
  return html`<${List} key="agp-head" cols="name-runs-access-last-doors" keepCols
    head=${[p('colAgent'), p('colRuns'), p('colAccess'), p('colSeen'), '']} />`;
}

function collectTags(agents) {
  const set = new Set();
  for (const a of agents) {
    for (const tag of (a.tags ?? [])) set.add(tag);
  }
  return [...set].sort();
}

/** How many tags the filter line shows before it folds; the rest open on request. */
const TAGS_SHOWN = 12;

/**
 * The filter line: the tags as chips (folded past TAGS_SHOWN, because 140 chips on one account
 * hid the list under a wall), and the group-by select. A selected tag always shows, folded or not.
 */
export function FilterBar({ agents, tagFilter, setTagFilter, groupBy, setGroupBy }) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const tags = collectTags(agents);
  const folded = !tagsOpen && tags.length > TAGS_SHOWN;
  const shown = folded ? tags.filter((tag, i) => i < TAGS_SHOWN || tagFilter.has(tag)) : tags;

  function toggleTag(tag) {
    const next = new Set(tagFilter);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setTagFilter(next);
  }

  // The tags on the left and the group-by at the right end of the same line, wrapping on a phone.
  return html`
    <${Line} wrap justify="between" gap="large" below="large">
      ${tags.length > 0 ? html`
        <${Filters} label=${t('profile.agents.filter.byTag')}>
          <${Label}>${t('profile.agents.filter.byTag')}<//>
          ${shown.map(tag => html`
            <${Filter} key=${tag} on=${tagFilter.has(tag)} onClick=${() => toggleTag(tag)}>${tag}<//>
          `)}
          ${tags.length > TAGS_SHOWN && html`
            <${Action} small soft onClick=${() => setTagsOpen(v => !v)}>
              ${folded ? t('profile.agents.page.allTags', { n: tags.length }) : t('profile.agents.page.fewerTags')}
            <//>
          `}
          ${tagFilter.size > 0 && html`
            <${Action} small soft onClick=${() => setTagFilter(new Set())}>
              ${t('profile.agents.filter.clear')}
            <//>
          `}
        <//>` : html`<span></span>`}
      <${Line} gap="small">
        <${Label}>${t('profile.agents.filter.groupBy')}<//>
        <${Select} fit ariaLabel=${t('profile.agents.filter.groupBy')} value=${groupBy} onChange=${setGroupBy}
          options=${[
            ['none', t('profile.agents.filter.groupByNone')],
            ['custom', t('profile.agents.filter.groupByCustom')],
            ['tag', t('profile.agents.filter.groupByTag')],
            ['mode', t('profile.agents.filter.groupByMode')],
          ]} />
      <//>
    <//>
  `;
}

// Fleet-wide "running now" panel shown between the agent board and the list.
// Flattens every agent's currently-active tasks into one newest-first list.
// Clicking a row asks the parent (onOpen) to expand that agent and open the
// task. Reuses the active tasks already fetched in loadData() — no extra calls.
export function ActiveTasksPanel({ activeTasksMap, agents, onOpen }) {
  const nameToDisplay = new Map((agents || []).map(a => [a.name, a.display_name || a.name]));
  const rows = [];
  for (const [name, tasks] of Object.entries(activeTasksMap || {})) {
    for (const task of (tasks || [])) {
      rows.push({ agentName: name, agentDisplay: nameToDisplay.get(name) || name, task });
    }
  }
  rows.sort((a, b) =>
    String(b.task.updatedAt || b.task.createdAt || '').localeCompare(
      String(a.task.updatedAt || a.task.createdAt || '')));

  // Cap the rendered rows so a very busy fleet can't produce an enormous list;
  // the overflow is surfaced explicitly (never silently dropped).
  const CAP = 50;
  const shown = rows.slice(0, CAP);
  const overflow = rows.length - shown.length;

  // A press anywhere on a row opens that agent on that task.
  const hint = t('profile.agents.active.openHint');
  return html`
    <${Space} below="section">
      <${Group} title=${t('profile.agents.active.title')} count=${rows.length > 0 ? rows.length : null}>
        <${List} cols="name-desc-doors" keepCols empty=${t('profile.agents.active.empty')}>
          ${shown.map(r => html`
            <${Row} key=${r.task.id} onToggle=${() => onOpen(r.agentName, r.task.id)}>
              <${Name} dot="active" title=${hint}>${r.agentDisplay}<//>
              <${Desc} title=${hint}>${r.task.title || t('profile.agents.active.untitled')}<//>
              <${Doors} title=${hint}><${Mark} kind="time">${timeAgo(r.task.updatedAt || r.task.createdAt)}<//><//>
            <//>
          `)}
        <//>
        ${overflow > 0 && html`<${Note} kind="quiet">+ ${overflow} ${t('profile.agents.active.more')}<//>`}
      <//>
    <//>
  `;
}

export function renderAgentGroups({ agents, tagFilter, query, groupBy, onboardings, taskStatsMap, changesMap, onTabSeen, expandedAgent, toggleAgent, session, showToast, setScopesModal, handleDeleteAgent, toggleFederate, onPopOut, dnd, agentOrder, deepLink, agentGroups, collapsedGroups, editingGroup, setEditingGroup, addGroup, renameGroup, removeGroup, toggleGroupCollapsed, groupDnd }) {
  // Search narrows first, then the tag filter: agent must have ALL selected tags (intersection).
  // `agents` itself stays whole — it is handed to every open card as `allAgents`, which is what the
  // schedules picker and the tag-peer list read, and neither of those is about what is on screen.
  const filtered = agents.filter(a => {
    if (!matchesAgentQuery(a, query)) return false;
    const at = new Set(a.tags ?? []);
    for (const want of tagFilter) if (!at.has(want)) return false;
    return true;
  });

  if (filtered.length === 0) {
    return html`<${Note} kind="quiet">${t('profile.agents.filter.noMatches')}<//>`;
  }

  const card = (a, drag = null) => html`
    <${AgentCard}
      agent=${{ ...a, taskStats: taskStatsMap[a.name] || null }}
      onboarding=${onboardings[a.name]}
      expanded=${expandedAgent === a.name}
      onToggle=${toggleAgent}
      session=${session}
      showToast=${showToast}
      allAgents=${agents}
      changes=${changesMap?.[a.name] || null}
      onTabSeen=${onTabSeen}
      onScopesClick=${(agent) => setScopesModal(agent)}
      onDeleteClick=${handleDeleteAgent}
      onFederateToggle=${toggleFederate}
      onPopOut=${onPopOut}
      preSelectedTab=${deepLink?.agent === a.name ? 'tasks' : null}
      openTaskId=${deepLink?.agent === a.name ? deepLink.taskId : null}
      openTaskNonce=${deepLink?.agent === a.name ? deepLink.nonce : 0}
      drag=${drag}
    />
  `;

  // The wrapper carries the agent's name, which the deep links scroll to.
  const renderCard = (a, drag = null) => html`
    <div data-agent-name=${a.name} key=${a.name}>${card(a, drag)}</div>
  `;

  if (groupBy === 'none') {
    // Apply the per-browser saved order, then (when reorderable) the closed row is draggable, by
    // its grip in the gutter or anywhere on it; an open card is not, so its controls stay usable.
    const orderedNames = effectiveOrderedNames(agents, agentOrder || []);
    const idx = new Map(orderedNames.map((n, i) => [n, i]));
    const ordered = [...filtered].sort((a, b) => (idx.get(a.name) ?? 1e9) - (idx.get(b.name) ?? 1e9));
    const row = (a) => renderCard(a, !dnd?.reorderable || expandedAgent === a.name ? null : {
      grip: t('profile.agents.reorderHint'),
      dragging: dnd.draggingName === a.name,
      onDragStart: (e) => dnd.onDragStart(a.name, e),
      onDragOver: dnd.onDragOver,
      onDrop: (e) => { e.preventDefault(); dnd.onDrop(a.name); },
      onDragEnd: dnd.onDragEnd,
    });

    // The connections the owner opens themselves sit under their own heading at the end, rather
    // than mixed into a list of things that run on their own. This is the default view, so it is
    // not behind the group-by control: mixing them there is what made them read as agents.
    //
    // Keyed on `mode`, which is what the health state is derived from — the two cannot disagree.
    // The Chat Sessions tab casts a wider net (it also honours the legacy `session-` naming), and
    // that is deliberate: this grouping has to line up with the teal dot beside each card.
    const tools = ordered.filter(a => a.mode === 'workstation');
    if (tools.length === 0) return [tableHead(), ...ordered.map(row)];
    const rest = ordered.filter(a => a.mode !== 'workstation');
    return [
      tableHead(),
      ...rest.map(row),
      html`<${Group} key="ws-header" title=${t('profile.agents.startedByYou')} count=${tools.length} />`,
      ...tools.map(row),
    ];
  }

  if (groupBy === 'custom') {
    const filteredNames = new Set(filtered.map(a => a.name));
    const byName = new Map(filtered.map(a => [a.name, a]));
    const assigned = new Set();
    const groups = agentGroups || [];

    // A draggable agent bar — drag by the grip handle onto a group header to
    // file it there (mirrors the document-space section pattern). The card is
    // not draggable while expanded so its inner controls stay usable.
    const draggableCard = (a) => renderCard(a, expandedAgent === a.name ? null : {
      grip: t('profile.agents.groups.dragHint'),
      dragging: groupDnd.draggingAgentName === a.name,
      onDragStart: (e) => groupDnd.onDragStart(a.name, e),
      onDragEnd: groupDnd.onDragEnd,
    });
    const dropOn = (id) => (e) => { e.preventDefault(); groupDnd.onDropToGroup(id); };
    const foldLabel = t('profile.agents.groups.toggle');

    const groupSection = (g) => {
      (g.agents || []).forEach(n => assigned.add(n));
      const members = (g.agents || []).filter(n => filteredNames.has(n)).map(n => byName.get(n));
      const collapsed = collapsedGroups?.has(g.id);
      const name = editingGroup === g.id
        ? html`<${TextField} autoFocus size="medium" ariaLabel=${t('profile.agents.groups.namePlaceholder')}
            placeholder=${t('profile.agents.groups.namePlaceholder')} value=${g.name}
            onInput=${(v) => renameGroup(g.id, v)} onBlur=${() => setEditingGroup(null)} onEnter=${() => setEditingGroup(null)} />`
        : html`<${Action} small soft onClick=${() => setEditingGroup(g.id)} title=${t('profile.agents.groups.rename')}>${g.name || t('profile.agents.groups.unnamed')}<//>`;
      return html`
        <div key=${'cg-' + g.id}>
          <${Group} title=${name} count=${members.length}
            onFold=${() => toggleGroupCollapsed(g.id)} folded=${collapsed} foldLabel=${foldLabel}
            doors=${html`<${Icon} small label=${t('profile.agents.groups.remove')} onClick=${() => removeGroup(g.id)}>✗<//>`}
            onDragOver=${groupDnd.onDragOver} onDrop=${dropOn(g.id)}>
            ${members.length === 0
              ? html`<${Note} kind="quiet">${t('profile.agents.groups.emptyDrop')}<//>`
              : members.map(draggableCard)}
          <//>
        </div>
      `;
    };

    // Render groups first (populates `assigned`), then everything not in any
    // group falls into Ungrouped (also a drop target — drop here to unfile).
    const groupSections = groups.map(groupSection);
    const ungrouped = filtered.filter(a => !assigned.has(a.name));
    const ungCollapsed = collapsedGroups?.has(UNGROUPED_ID);

    return html`
      <${Line} wrap gap="large" below="small">
        <${Action} small onClick=${addGroup}>+ ${t('profile.agents.groups.addGroup')}<//>
        <${Note} inline>${t('profile.agents.groups.hint')}<//>
      <//>
      ${groupSections}
      <div key="cg-ungrouped">
        <${Group} title=${t('profile.agents.groups.ungrouped')} count=${ungrouped.length}
          onFold=${() => toggleGroupCollapsed(UNGROUPED_ID)} folded=${ungCollapsed} foldLabel=${foldLabel}
          onDragOver=${groupDnd.onDragOver} onDrop=${dropOn(UNGROUPED_ID)}>
          ${ungrouped.map(draggableCard)}
        <//>
      </div>
    `;
  }

  if (groupBy === 'mode') {
    const byMode = new Map();
    for (const a of filtered) {
      const m = a.mode || 'interactive';
      if (!byMode.has(m)) byMode.set(m, []);
      byMode.get(m).push(a);
    }
    const order = AGENT_MODES.filter(m => byMode.has(m));
    return order.map(mode => html`
      <div key=${'mode-' + mode}>
        <${Group} title=${t('profile.agents.mode.' + mode) || mode} count=${byMode.get(mode).length}>
          ${byMode.get(mode).map(a => renderCard(a))}
        <//>
      </div>
    `);
  }

  // groupBy === 'tag' -- an agent appears under every tag it carries; untagged agents grouped at end
  const byTag = new Map();
  const untagged = [];
  for (const a of filtered) {
    const ts = a.tags ?? [];
    if (ts.length === 0) {
      untagged.push(a);
    } else {
      for (const tag of ts) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push(a);
      }
    }
  }
  const sortedTags = [...byTag.keys()].sort();
  const sections = sortedTags.map(tag => html`
    <div key=${'tag-' + tag}>
      <${Group} title=${html`<${Mark}>${tag}<//>`} count=${byTag.get(tag).length}>
        ${byTag.get(tag).map(a => renderCard(a))}
      <//>
    </div>
  `);
  if (untagged.length > 0) {
    sections.push(html`
      <div key="tag-untagged">
        <${Group} title=${t('profile.agents.filter.untagged')} count=${untagged.length}>
          ${untagged.map(a => renderCard(a))}
        <//>
      </div>
    `);
  }
  return sections;
}

/**
 * @file public/views/profile/agents/groups-render.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agents-tab list rendering: tag filter bar, fleet "running now" panel, and the
 *   grouped agent-card renderer (none / custom groups / mode / tag). Extracted from
 *   ../agents-tab.js to satisfy max-file-lines.
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set (components/poster-parts.js): the search and
 *     the group-by choice are Fields, the tags chips inside text actions, the running-now panel a
 *     small section of timeline rows, each group a small section with its count and actions. The
 *     table head row is gone with the table (each row now carries its run and access words as chips,
 *     the column names as their tooltips). The grip glyph is an inline SVG. No class of its own.
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
import { useState, useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import AgentCard from './agent-card.js';
import { effectiveOrderedNames, matchesAgentQuery, UNGROUPED_ID } from './tab-helpers.js';
import { Section, Stack, ListRow, Field, Chip, Action, Text } from '/components/poster-parts.js';

const AGENT_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'];

// The grip a closed row is dragged by: six dots, drawn (an icon here is inline SVG, not a glyph).
const GRIP = html`<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" fill="currentColor">
  <circle cx="2.5" cy="3" r="1.4" /><circle cx="7.5" cy="3" r="1.4" /><circle cx="2.5" cy="8" r="1.4" />
  <circle cx="7.5" cy="8" r="1.4" /><circle cx="2.5" cy="13" r="1.4" /><circle cx="7.5" cy="13" r="1.4" /></svg>`;
const grip = (title) => html`<span title=${title}><${Text} kind="caption" tone="muted">${GRIP}<//></span>`;

/**
 * The fleet search, above the board rather than above the list: it narrows both, so the status
 * pills never count agents the list below is not showing. Name or GAII, because those are the two
 * strings a person arrives with — one from the screen, the other from wherever they pasted it.
 * @param {{ query: string, setQuery: (v: string) => void, shown: number, total: number }} props
 */
export function AgentSearch({ query, setQuery, shown, total }) {
  const active = query.trim() !== '';
  // The placeholder names the field (no visible label: the section's title already says what the
  // list is); the count and Clear stand under it while a search is on.
  return html`
    <${Stack} density="compact">
      <${Field} type="search" value=${query}
             placeholder=${t('profile.agents.search.placeholder')}
             onInput=${(e) => setQuery(e.target.value)} />
      ${active && html`
        <${Stack} direction="horizontal" align="center" density="compact">
          <${Text} kind="mono">${t('profile.agents.search.count', { shown, total })} ·<//>
          <${Action} kind="text" onClick=${() => setQuery('')}>${t('profile.agents.filter.clear')}<//>
        <//>
      `}
    <//>
  `;
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

  return html`
    <${Stack} direction="wrap" align="end">
      ${tags.length > 0 && html`
        <${Stack} direction="wrap" align="center" density="compact">
          <${Text} kind="label">${t('profile.agents.filter.byTag')}<//>
          ${shown.map(tag => html`
            <${Action} kind="text" key=${tag} selected=${tagFilter.has(tag)} onClick=${() => toggleTag(tag)}>
              <${Chip} tone=${tagFilter.has(tag) ? 'sun' : 'plain'}>${tag}<//>
            <//>
          `)}
          ${tags.length > TAGS_SHOWN && html`
            <${Action} kind="text" expanded=${!folded} onClick=${() => setTagsOpen(v => !v)}>
              ${folded ? t('profile.agents.page.allTags', { n: tags.length }) : t('profile.agents.page.fewerTags')}
            <//>
          `}
          ${tagFilter.size > 0 && html`
            <${Action} kind="text" onClick=${() => setTagFilter(new Set())}>
              ${t('profile.agents.filter.clear')}
            <//>
          `}
        <//>
      `}
      <${Field} type="select" label=${t('profile.agents.filter.groupBy')} value=${groupBy}
        onChange=${(e) => setGroupBy(e.target.value)}
        options=${[
          { value: 'none', label: t('profile.agents.filter.groupByNone') },
          { value: 'custom', label: t('profile.agents.filter.groupByCustom') },
          { value: 'tag', label: t('profile.agents.filter.groupByTag') },
          { value: 'mode', label: t('profile.agents.filter.groupByMode') },
        ]} />
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

  // Each row opens its agent on that task; the row's own action carries the "open this task" hint.
  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.active.title')} count=${rows.length > 0 ? `(${rows.length})` : null}>
      ${rows.length === 0
        ? html`<${Text} tone="muted">${t('profile.agents.active.empty')}<//>`
        : html`
            ${shown.map(r => html`
              <${ListRow} key=${r.task.id} density="compact" marker="success" live=${true}
                name=${r.agentDisplay} onOpen=${() => onOpen(r.agentName, r.task.id)}
                detail=${r.task.title || t('profile.agents.active.untitled')} detailKind="text"
                value=${timeAgo(r.task.updatedAt || r.task.createdAt)}
                actions=${html`<${Action} kind="text" title=${t('profile.agents.active.openHint')} label=${t('profile.agents.active.openHint')}
                  onClick=${() => onOpen(r.agentName, r.task.id)}>→<//>`} />
            `)}
            ${overflow > 0 && html`<${Text} tone="muted">+ ${overflow} ${t('profile.agents.active.more')}<//>`}
          `}
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
    return html`<${Text} tone="muted">${t('profile.agents.filter.noMatches')}<//>`;
  }

  // `handle` is the grip a closed row shows when it can be dragged (the card puts it with its row's
  // actions); an open card is not draggable, so it gets none.
  const card = (a, handle = null) => html`
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
      dragHandle=${expandedAgent !== a.name ? handle : null}
      preSelectedTab=${deepLink?.agent === a.name ? 'tasks' : null}
      openTaskId=${deepLink?.agent === a.name ? deepLink.taskId : null}
      openTaskNonce=${deepLink?.agent === a.name ? deepLink.nonce : 0}
    />
  `;

  const renderCard = (a) => html`
    <div data-agent-name=${a.name} key=${a.name}>${card(a)}</div>
  `;

  /** A group of rows under a small section head: its title, its count, and its actions. */
  const group = (key, title, count, actions, body, drop) => html`
    <div key=${key} onDragOver=${drop ? groupDnd.onDragOver : undefined}
         onDrop=${drop ? (e) => { e.preventDefault(); drop(); } : undefined}>
      <${Section} size="small" density="compact" title=${title} count=${count} actions=${actions}>${body}<//>
    </div>
  `;

  if (groupBy === 'none') {
    // Apply the per-browser saved order, then (when reorderable) wrap each row
    // in a draggable container with a grip handle.
    const orderedNames = effectiveOrderedNames(agents, agentOrder || []);
    const idx = new Map(orderedNames.map((n, i) => [n, i]));
    const ordered = [...filtered].sort((a, b) => (idx.get(a.name) ?? 1e9) - (idx.get(b.name) ?? 1e9));
    const row = (a) => (!dnd?.reorderable ? renderCard(a) : html`
      <div data-agent-name=${a.name} key=${a.name}
           draggable=${expandedAgent !== a.name}
           onDragStart=${(e) => dnd.onDragStart(a.name, e)}
           onDragOver=${dnd.onDragOver}
           onDrop=${(e) => { e.preventDefault(); dnd.onDrop(a.name); }}
           onDragEnd=${dnd.onDragEnd}>
        ${card(a, grip(t('profile.agents.reorderHint')))}
      </div>
    `);

    // The connections the owner opens themselves sit under their own heading at the end, rather
    // than mixed into a list of things that run on their own. This is the default view, so it is
    // not behind the group-by control: mixing them there is what made them read as agents.
    //
    // Keyed on `mode`, which is what the health state is derived from — the two cannot disagree.
    // The Chat Sessions tab casts a wider net (it also honours the legacy `session-` naming), and
    // that is deliberate: this grouping has to line up with the teal dot beside each card.
    const tools = ordered.filter(a => a.mode === 'workstation');
    if (tools.length === 0) return ordered.map(row);
    const rest = ordered.filter(a => a.mode !== 'workstation');
    return [
      ...rest.map(row),
      group('ws-header', t('profile.agents.startedByYou'), tools.length, null, tools.map(row)),
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
    const draggableCard = (a) => html`
      <div data-agent-name=${a.name} key=${a.name}
           draggable=${expandedAgent !== a.name}
           onDragStart=${(e) => groupDnd.onDragStart(a.name, e)}
           onDragEnd=${groupDnd.onDragEnd}>
        ${card(a, grip(t('profile.agents.groups.dragHint')))}
      </div>
    `;

    const toggle = (id, collapsed) => html`<${Action} kind="text" expanded=${!collapsed} title=${t('profile.agents.groups.toggle')}
      label=${t('profile.agents.groups.toggle')} onClick=${() => toggleGroupCollapsed(id)}>${collapsed ? '→' : '↩'}<//>`;

    const groupSection = (g) => {
      (g.agents || []).forEach(n => assigned.add(n));
      const members = (g.agents || []).filter(n => filteredNames.has(n)).map(n => byName.get(n));
      const collapsed = collapsedGroups?.has(g.id);
      // The group's name is its title and renames it when pressed; while renaming, the field stands
      // at the top of the group.
      const title = html`<${Action} kind="text" title=${t('profile.agents.groups.rename')} onClick=${() => setEditingGroup(g.id)}>${g.name || t('profile.agents.groups.unnamed')}<//>`;
      const actions = html`${toggle(g.id, collapsed)}
        <${Action} kind="text" title=${t('profile.agents.groups.remove')} label=${t('profile.agents.groups.remove')} onClick=${() => removeGroup(g.id)}>✗<//>`;
      const body = html`
        ${editingGroup === g.id && html`<${GroupNameField} value=${g.name}
            onInput=${(v) => renameGroup(g.id, v)} onDone=${() => setEditingGroup(null)} />`}
        ${!collapsed && (members.length === 0
          ? html`<${Text} tone="muted">${t('profile.agents.groups.emptyDrop')}<//>`
          : members.map(draggableCard))}`;
      return group('cg-' + g.id, title, members.length, actions, body, () => groupDnd.onDropToGroup(g.id));
    };

    // Render groups first (populates `assigned`), then everything not in any
    // group falls into Ungrouped (also a drop target — drop here to unfile).
    const groupSections = groups.map(groupSection);
    const ungrouped = filtered.filter(a => !assigned.has(a.name));
    const ungCollapsed = collapsedGroups?.has(UNGROUPED_ID);

    return html`
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${addGroup}>+ ${t('profile.agents.groups.addGroup')}<//>
        <${Text} kind="caption" tone="muted">${t('profile.agents.groups.hint')}<//>
      <//>
      ${groupSections}
      ${group('cg-ungrouped', t('profile.agents.groups.ungrouped'), ungrouped.length, toggle(UNGROUPED_ID, ungCollapsed),
        !ungCollapsed && ungrouped.map(draggableCard), () => groupDnd.onDropToGroup(UNGROUPED_ID))}
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
    return order.map(mode => group('mode-' + mode, t('profile.agents.mode.' + mode) || mode,
      byMode.get(mode).length, null, byMode.get(mode).map(renderCard)));
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
  const sections = sortedTags.map(tag => group('tag-' + tag, tag, byTag.get(tag).length, null, byTag.get(tag).map(renderCard)));
  if (untagged.length > 0) {
    sections.push(group('tag-untagged', t('profile.agents.filter.untagged'), untagged.length, null, untagged.map(renderCard)));
  }
  return sections;
}

/**
 * The field a custom group is renamed in: it takes the focus when it opens (the old input's
 * autofocus), writes every keystroke, and closes on Enter or when the focus leaves it.
 */
function GroupNameField({ value, onInput, onDone }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return html`<span onFocusOut=${onDone}>
    <${Field} inputRef=${ref} value=${value} placeholder=${t('profile.agents.groups.namePlaceholder')}
      onInput=${(e) => onInput(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter') onDone(); }} />
  </span>`;
}

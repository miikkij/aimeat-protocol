/**
 * @file public/views/profile/agents/groups-render.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agents-tab list rendering: tag filter bar, fleet "running now" panel, and the
 *   grouped agent-card renderer (none / custom groups / mode / tag). Extracted from
 *   ../agents-tab.js to satisfy max-file-lines.
 * @version-history
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
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import AgentCard from './agent-card.js';
import { effectiveOrderedNames, matchesAgentQuery, UNGROUPED_ID } from './tab-helpers.js';

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
    <div class="pf-agd-fleet-search">
      <input class="input-field pf-agd-fleet-search-input" type="search"
             value=${query}
             placeholder=${t('profile.agents.search.placeholder')}
             aria-label=${t('profile.agents.search.placeholder')}
             onInput=${(e) => setQuery(e.target.value)} />
      ${active && html`
        <span class="pf-agd-fleet-search-count">${t('profile.agents.search.count', { shown, total })}</span>
        <button class="pf-agd-filter-clear" onClick=${() => setQuery('')}>${t('profile.agents.filter.clear')}</button>
      `}
    </div>
  `;
}

function collectTags(agents) {
  const set = new Set();
  for (const a of agents) {
    for (const tag of (a.tags ?? [])) set.add(tag);
  }
  return [...set].sort();
}

export function renderFilterBar(agents, tagFilter, setTagFilter, groupBy, setGroupBy) {
  const tags = collectTags(agents);

  function toggleTag(tag) {
    const next = new Set(tagFilter);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setTagFilter(next);
  }

  return html`
    <div class="pf-agd-filter-bar">
      ${tags.length > 0 && html`
        <div class="pf-agd-filter-tags">
          <span class="pf-agd-filter-label">${t('profile.agents.filter.byTag')}</span>
          ${tags.map(tag => html`
            <button key=${tag}
                    class="pf-agd-tag-chip ${tagFilter.has(tag) ? 'pf-agd-tag-chip--active' : ''}"
                    onClick=${() => toggleTag(tag)}>
              ${tag}
            </button>
          `)}
          ${tagFilter.size > 0 && html`
            <button class="pf-agd-filter-clear" onClick=${() => setTagFilter(new Set())}>
              ${t('profile.agents.filter.clear')}
            </button>
          `}
        </div>
      `}
      <div class="pf-agd-filter-groupby">
        <span class="pf-agd-filter-label">${t('profile.agents.filter.groupBy')}</span>
        <select class="pf-agd-filter-select" value=${groupBy} onChange=${(e) => setGroupBy(e.target.value)}>
          <option value="none">${t('profile.agents.filter.groupByNone')}</option>
          <option value="custom">${t('profile.agents.filter.groupByCustom')}</option>
          <option value="tag">${t('profile.agents.filter.groupByTag')}</option>
          <option value="mode">${t('profile.agents.filter.groupByMode')}</option>
        </select>
      </div>
    </div>
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

  return html`
    <div class="pf-agd-active">
      <div class="pf-agd-active-head">
        <span class="section-title">${t('profile.agents.active.title')}${rows.length > 0 ? html` <span class="pf-agd-count-badge">(${rows.length})</span>` : ''}</span>
      </div>
      ${rows.length === 0
        ? html`<div class="pf-agd-active-empty">${t('profile.agents.active.empty')}</div>`
        : html`<div class="pf-agd-active-list">
            ${shown.map(r => html`
              <button class="pf-agd-active-row" key=${r.task.id}
                      onClick=${() => onOpen(r.agentName, r.task.id)}
                      title=${t('profile.agents.active.openHint')}>
                <span class="pf-agd-active-dot" aria-hidden="true"></span>
                <span class="pf-agd-active-agent">${r.agentDisplay}</span>
                <span class="pf-agd-active-title">${r.task.title || t('profile.agents.active.untitled')}</span>
                <span class="pf-agd-active-time">${timeAgo(r.task.updatedAt || r.task.createdAt)}</span>
              </button>
            `)}
            ${overflow > 0 && html`<div class="pf-agd-active-empty">+ ${overflow} ${t('profile.agents.active.more')}</div>`}
          </div>`}
    </div>
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
    return html`<div class="empty">${t('profile.agents.filter.noMatches')}</div>`;
  }

  const card = (a) => html`
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
    />
  `;

  const renderCard = (a) => html`
    <div data-agent-name=${a.name} key=${a.name}>${card(a)}</div>
  `;

  if (groupBy === 'none') {
    // Apply the per-browser saved order, then (when reorderable) wrap each row
    // in a draggable container with a grip handle.
    const orderedNames = effectiveOrderedNames(agents, agentOrder || []);
    const idx = new Map(orderedNames.map((n, i) => [n, i]));
    const ordered = [...filtered].sort((a, b) => (idx.get(a.name) ?? 1e9) - (idx.get(b.name) ?? 1e9));
    const row = (a) => (!dnd?.reorderable ? renderCard(a) : html`
      <div data-agent-name=${a.name} key=${a.name}
           class="pf-agd-dnd-row ${dnd.draggingName === a.name ? 'pf-agd-dnd-dragging' : ''}"
           draggable=${expandedAgent !== a.name}
           onDragStart=${(e) => dnd.onDragStart(a.name, e)}
           onDragOver=${dnd.onDragOver}
           onDrop=${(e) => { e.preventDefault(); dnd.onDrop(a.name); }}
           onDragEnd=${dnd.onDragEnd}>
        ${expandedAgent !== a.name ? html`<span class="pf-agd-dnd-grip" title=${t('profile.agents.reorderHint')}>⠿</span>` : ''}
        ${card(a)}
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
      html`
        <div class="pf-agd-group-header" key="ws-header">
          <span class="pf-agd-badge pf-agd-badge--mode pf-agd-badge--mode-workstation">${t('profile.agents.startedByYou')}</span>
          <span class="pf-agd-group-count">${tools.length}</span>
        </div>
      `,
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
    const draggableCard = (a) => html`
      <div data-agent-name=${a.name} key=${a.name}
           class="pf-agd-dnd-row ${groupDnd.draggingAgentName === a.name ? 'pf-agd-dnd-dragging' : ''}"
           draggable=${expandedAgent !== a.name}
           onDragStart=${(e) => groupDnd.onDragStart(a.name, e)}
           onDragEnd=${groupDnd.onDragEnd}>
        ${expandedAgent !== a.name ? html`<span class="pf-agd-dnd-grip" title=${t('profile.agents.groups.dragHint')}>⠿</span>` : ''}
        ${card(a)}
      </div>
    `;

    const groupSection = (g) => {
      (g.agents || []).forEach(n => assigned.add(n));
      const members = (g.agents || []).filter(n => filteredNames.has(n)).map(n => byName.get(n));
      const collapsed = collapsedGroups?.has(g.id);
      return html`
        <div class="pf-agd-group" key=${'cg-' + g.id}>
          <div class="pf-agd-group-header pf-agd-cgroup-header"
               onDragOver=${groupDnd.onDragOver}
               onDrop=${(e) => { e.preventDefault(); groupDnd.onDropToGroup(g.id); }}>
            <button class="pf-agd-cgroup-toggle" onClick=${() => toggleGroupCollapsed(g.id)} title=${t('profile.agents.groups.toggle')}>
              <span class="pf-chevron ${collapsed ? '' : 'pf-chevron-open'}">▼</span>
            </button>
            ${editingGroup === g.id
              ? html`<input class="input-field input-xs pf-agd-cgroup-name-input" autofocus
                       placeholder=${t('profile.agents.groups.namePlaceholder')}
                       value=${g.name}
                       onInput=${(e) => renameGroup(g.id, e.target.value)}
                       onBlur=${() => setEditingGroup(null)}
                       onKeyDown=${(e) => { if (e.key === 'Enter') setEditingGroup(null); }} />`
              : html`<button class="pf-agd-cgroup-name" onClick=${() => setEditingGroup(g.id)} title=${t('profile.agents.groups.rename')}>${g.name || t('profile.agents.groups.unnamed')}</button>`}
            <span class="pf-agd-group-count">${members.length}</span>
            <button class="pj-icon-btn" title=${t('profile.agents.groups.remove')} onClick=${() => removeGroup(g.id)}>✕</button>
          </div>
          ${!collapsed && (members.length === 0
            ? html`<div class="pf-agd-cgroup-empty">${t('profile.agents.groups.emptyDrop')}</div>`
            : members.map(draggableCard))}
        </div>
      `;
    };

    // Render groups first (populates `assigned`), then everything not in any
    // group falls into Ungrouped (also a drop target — drop here to unfile).
    const groupSections = groups.map(groupSection);
    const ungrouped = filtered.filter(a => !assigned.has(a.name));
    const ungCollapsed = collapsedGroups?.has(UNGROUPED_ID);

    return html`
      <div class="pf-agd-cgroup-bar">
        <button class="btn-outline btn-sm" onClick=${addGroup}>+ ${t('profile.agents.groups.addGroup')}</button>
        <span class="text-caption pf-agd-cgroup-hint">${t('profile.agents.groups.hint')}</span>
      </div>
      ${groupSections}
      <div class="pf-agd-group" key="cg-ungrouped">
        <div class="pf-agd-group-header pf-agd-cgroup-header"
             onDragOver=${groupDnd.onDragOver}
             onDrop=${(e) => { e.preventDefault(); groupDnd.onDropToGroup(UNGROUPED_ID); }}>
          <button class="pf-agd-cgroup-toggle" onClick=${() => toggleGroupCollapsed(UNGROUPED_ID)} title=${t('profile.agents.groups.toggle')}>
            <span class="pf-chevron ${ungCollapsed ? '' : 'pf-chevron-open'}">▼</span>
          </button>
          <span class="pf-agd-cgroup-name pf-agd-group-untagged">${t('profile.agents.groups.ungrouped')}</span>
          <span class="pf-agd-group-count">${ungrouped.length}</span>
        </div>
        ${!ungCollapsed && ungrouped.map(draggableCard)}
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
      <div class="pf-agd-group" key=${'mode-' + mode}>
        <div class="pf-agd-group-header">
          <span class="pf-agd-badge pf-agd-badge--mode pf-agd-badge--mode-${mode}">${t('profile.agents.mode.' + mode) || mode}</span>
          <span class="pf-agd-group-count">${byMode.get(mode).length}</span>
        </div>
        ${byMode.get(mode).map(renderCard)}
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
    <div class="pf-agd-group" key=${'tag-' + tag}>
      <div class="pf-agd-group-header">
        <span class="pf-agd-tag-chip">${tag}</span>
        <span class="pf-agd-group-count">${byTag.get(tag).length}</span>
      </div>
      ${byTag.get(tag).map(renderCard)}
    </div>
  `);
  if (untagged.length > 0) {
    sections.push(html`
      <div class="pf-agd-group" key="tag-untagged">
        <div class="pf-agd-group-header">
          <span class="pf-agd-group-untagged">${t('profile.agents.filter.untagged')}</span>
          <span class="pf-agd-group-count">${untagged.length}</span>
        </div>
        ${untagged.map(renderCard)}
      </div>
    `);
  }
  return sections;
}

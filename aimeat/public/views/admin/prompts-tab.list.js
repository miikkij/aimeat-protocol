/**
 * @file public/views/admin/prompts-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The left pane of the System Prompts page: the search, the four filters, the group
 *   headings that carry the everyday button, and the rows (design canvas "AIMEAT Admin System
 *   Prompts", direction A).
 *
 *   THE LIST KEEPS ITS PLACE. Eighty-eight prompts in eleven groups is a page you search rather
 *   than scroll, and the reason for two panes at all is that opening one prompt must not throw away
 *   where you were in the other eighty-seven (`Panes framed`, components/ConversationPane.js).
 *
 *   A ROW SAYS WHAT AN UPDATE WILL DO TO IT. `source_kind` comes from the node (the same rule the
 *   seeder follows), so a prompt in a synced group is marked before an operator spends an hour on
 *   a text the next deploy overwrites.
 * @structure GROUP_NAMES · groupLabel · promptChips · PromptListHead · PromptList
 * @usage html`<${Panes} head=${html`<${PromptListHead} …/>`} list=${html`<${PromptList} …/>`}>…<//>`
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the head is SearchLine and the filter Tabs
 *     (PromptListHead, which stays in place over the rows), the rows a List under Group headings,
 *     each row opened by a press anywhere on it; no class written.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, Badge } from './shared.js';
import { List, Row, Name, Group, SearchLine } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.prompts.' + key, params);

/**
 * Every group the seeds declare needs a row here, or its heading renders as the raw key
 * ("dashboard.workflows (3)" on the admin page, 2026-09-09). check:prompt-groups holds the two
 * lists against each other. `generator` stays although no seed declares one any more: nodes seeded
 * by an older version still carry the group, and those prompts need a heading to sit under.
 */
export const GROUP_NAMES = {
  tiers: 'promptsGroupTiers',
  builders: 'promptsGroupBuilders',
  portal: 'promptsGroupPortal',
  knowledge: 'promptsGroupKnowledge',
  platform: 'promptsGroupPlatform',
  generator: 'promptsGroupGenerator',
  playbooks: 'promptsGroupPlaybooks',
  workflows: 'promptsGroupWorkflows',
  proactive: 'promptsGroupProactive',
  contacts: 'promptsGroupContacts',
  email: 'promptsGroupEmail',
};

export function groupLabel(g) {
  const key = 'dashboard.' + (GROUP_NAMES[g] || g);
  const words = t(key);
  return words !== key ? words : g;
}

/** What this row is, in chips: whose text it is, what an update does to it, and whether it is served. */
export function promptChips(p) {
  const chips = [];
  if (p.differs_from_default) {
    chips.push(html`<${Badge} key="ch" type="watch" label=${P('chip.changed', { v: num(p.version) })} />`);
  }
  if (p.source_kind === 'code') {
    chips.push(html`<${Badge} key="k" type="critical" label=${P('chip.code')} />`);
  } else if (p.source_kind === 'orphan') {
    chips.push(html`<${Badge} key="k" type="critical" label=${P('chip.orphan')} />`);
  }
  if (p.locales && Object.values(p.locales).some(v => typeof v === 'string' && v.length > 0)) {
    chips.push(html`<${Badge} key="l" type="info" label=${P('chip.translated')} />`);
  }
  if (!p.active) chips.push(html`<${Badge} key="a" type="critical" label=${P('chip.off')} />`);
  return chips;
}

/** What stands over the rows and stays in place: the search and the four filters. */
export function PromptListHead({ counts, query, filter, onQuery, onFilter }) {
  return html`
    <${SearchLine} find text value=${query} placeholder=${P('searchPh', { n: num(counts.all) })}
      onInput=${(e) => onQuery(e.target.value)} />
    <${Tabs} tone="filter" value=${filter} onSelect=${onFilter}
      items=${['all', 'changed', 'off', 'orphan'].map(key => ({ value: key, label: P('filter.' + key, { n: num(counts[key]) }) }))} />`;
}

/** The rows under their group headings; a press anywhere on a row opens its prompt. */
export function PromptList({ prompts, openId, onOpen, onResetGroup }) {
  const groups = [];
  for (const p of prompts) {
    const last = groups[groups.length - 1];
    if (last && last.id === p.group) last.items.push(p);
    else groups.push({ id: p.group, items: [p] });
  }

  return html`
    <${List} cols="name" empty=${P('noMatch')}>
      ${groups.map(g => html`
        <${Group} key=${g.id}
          title=${html`${groupLabel(g.id)}${' '}<${Note} kind="meta" inline mono>${P('ghead', { n: num(g.items.length), changed: num(g.items.filter(p => p.differs_from_default).length) })}<//>`}
          doors=${g.items.some(p => p.source_kind !== 'orphan')
    ? html`<${Action} small soft onClick=${() => onResetGroup(g.id, g.items.length)}>${P('takeGroup', { n: num(g.items.length) })}<//>`
    : null}>
          ${g.items.map(p => html`
            <${Row} key=${p.id} selected=${openId === p.id} faded=${!p.active} onToggle=${() => onOpen(p.id)}>
              <${Name} clip meta=${(p.usedIn && p.usedIn[0]) || p.id} marks=${promptChips(p)}>${p.name}<//>
            <//>`)}
        <//>`)}
    <//>`;
}

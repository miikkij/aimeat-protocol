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
 *   where you were in the other eighty-seven.
 *
 *   A ROW SAYS WHAT AN UPDATE WILL DO TO IT. `source_kind` comes from the node (the same rule the
 *   seeder follows), so a prompt in a synced group is marked before an operator spends an hour on
 *   a text the next deploy overwrites.
 * @structure GROUP_NAMES · groupLabel · promptChips · PromptList
 * @usage html`<${PromptList} prompts=${prompts} openId=${id} onOpen=${fn} ... />`
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared component set: the search and the four
 *     filters as the shared toolbar, the groups in a scrolling box, each prompt a shared list row
 *     that sits on the sun while it is open; no sheet of its own.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, Badge } from './shared.js';
import { Stack, Text, Action, ListRow, Toolbar, Surface } from '/components/poster-parts.js';

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

/** The left pane: search, filters, and the prompts under their group headings. */
export function PromptList({ prompts, counts, query, filter, openId, onQuery, onFilter, onOpen, onResetGroup }) {
  const groups = [];
  for (const p of prompts) {
    const last = groups[groups.length - 1];
    if (last && last.id === p.group) last.items.push(p);
    else groups.push({ id: p.group, items: [p] });
  }

  const filterOf = (key, n) => ({ id: key, label: P('filter.' + key, { n: num(n) }), selected: filter === key, onClick: () => onFilter(key) });

  return html`
    <${Stack}>
      <${Toolbar} label=${P('find.title')}
        search=${{ ariaLabel: P('searchPh', { n: num(counts.all) }), placeholder: P('searchPh', { n: num(counts.all) }), value: query, onInput: (e) => onQuery(e.target.value) }}
        filters=${[filterOf('all', counts.all), filterOf('changed', counts.changed), filterOf('off', counts.off), filterOf('orphan', counts.orphan)]} />
      <${Surface} kind="box" density="compact" height="scroll">
        ${groups.map(g => html`
          <div key=${g.id}>
            <${Stack} direction="wrap" align="between">
              <${Stack} direction="horizontal" align="center" density="compact">
                <${Text} kind="label">${groupLabel(g.id)}<//>
                <${Text} kind="mono" tone="muted">${P('ghead', { n: num(g.items.length), changed: num(g.items.filter(p => p.differs_from_default).length) })}<//>
              <//>
              ${g.items.some(p => p.source_kind !== 'orphan') && html`
                <${Action} kind="text" onClick=${() => onResetGroup(g.id, g.items.length)}>${P('takeGroup', { n: num(g.items.length) })}<//>`}
            <//>
            ${g.items.map(p => {
              const chips = promptChips(p);
              return html`<${ListRow} key=${p.id} density="compact" selected=${openId === p.id} muted=${!p.active}
                name=${p.name} onOpen=${() => onOpen(p.id)} open=${openId === p.id}
                detail=${(p.usedIn && p.usedIn[0]) || p.id}>
                ${chips.length > 0 ? html`<${Stack} direction="wrap" density="compact">${chips}<//>` : null}
              <//>`;
            })}
          </div>`)}
        ${prompts.length === 0 && html`<${Text} tone="muted">${P('noMatch')}<//>`}
      <//>
    <//>`;
}

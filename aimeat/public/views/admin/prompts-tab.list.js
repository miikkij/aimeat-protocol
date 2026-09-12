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
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, Badge } from './shared.js';

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

  const filterButton = (key, n) => html`
    <button type="button" class=${'adm-pr-filter' + (filter === key ? ' on' : '')}
      onClick=${() => onFilter(key)}>${P('filter.' + key, { n: num(n) })}</button>`;

  return html`
    <div class="adm-pr-list">
      <div class="adm-pr-find">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="text" value=${query} placeholder=${P('searchPh', { n: num(counts.all) })}
          onInput=${(e) => onQuery(e.target.value)} />
      </div>
      <div class="adm-pr-filters">
        ${filterButton('all', counts.all)}
        ${filterButton('changed', counts.changed)}
        ${filterButton('off', counts.off)}
        ${filterButton('orphan', counts.orphan)}
      </div>
      <div class="adm-pr-rows">
        ${groups.map(g => html`
          <div key=${g.id}>
            <div class="adm-pr-ghead">
              <span>
                <b>${groupLabel(g.id)}</b>${' '}
                <small>${P('ghead', { n: num(g.items.length), changed: num(g.items.filter(p => p.differs_from_default).length) })}</small>
              </span>
              ${g.items.some(p => p.source_kind !== 'orphan') && html`
                <button type="button" class="og-door og-door--quiet"
                  onClick=${() => onResetGroup(g.id, g.items.length)}>${P('takeGroup', { n: num(g.items.length) })}</button>`}
            </div>
            ${g.items.map(p => html`
              <button type="button" key=${p.id}
                class=${'adm-pr-row' + (openId === p.id ? ' on' : '') + (p.active ? '' : ' off')}
                onClick=${() => onOpen(p.id)}>
                <span class="adm-pr-name">${p.name}</span>
                <span class="adm-pr-addr">${(p.usedIn && p.usedIn[0]) || p.id}</span>
                <span class="adm-pr-chips">${promptChips(p)}</span>
              </button>`)}
          </div>`)}
        ${prompts.length === 0 && html`<p class="adm-pr-none">${P('noMatch')}</p>`}
      </div>
    </div>`;
}

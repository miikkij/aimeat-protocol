/**
 * @file public/views/admin/actions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab that lists registered catalogue actions —
 *   id, name/description, provider, category, base morsel cost, and tags.
 *
 * @structure
 *   - ActionsTab({ data }): renders data.actions.actions as a List; shows Empty state when none registered
 *
 * @version-history
 *   v1.1.0 — 2026-09-27 — On the library components (page group G5): the table is the List with its
 *     heading row, the id and the provider in the typewriter cell, the description the Name's line,
 *     the tags Marks. The file writes no class and no style.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty } from './shared.js';
import { List, Row, Name, Cell, Num } from '/components/List.js';
import { Mark } from '/components/Mark.js';

export default function ActionsTab({ data }) {
  const acts = data.actions?.actions || [];
  if (!acts.length) return html`<${Empty} text=${t('dashboard.noActionsRegistered')} />`;

  const head = ['ID', t('dashboard.name'), t('dashboard.provider'), t('dashboard.category'),
    { label: t('dashboard.baseCost'), num: true }, t('dashboard.tags')];
  return html`
    <${List} cols="id-name-who-state-n-tags" head=${head} labels>
      ${acts.map(a => html`
        <${Row} key=${a.id}>
          <${Cell} meta>${escHtml(a.id)}<//>
          <${Name} desc=${a.description ? escHtml(a.description) : null}>${escHtml(a.name)}<//>
          <${Cell} meta>${escHtml(a.provider)}<//>
          <${Cell}><${Badge} type=${a.category || 'info'} /><//>
          <${Num}>${num(a.base_cost)} ⬥<//>
          <${Cell} line>${(a.tags || []).map(tag => html`<${Mark} key=${tag}>${escHtml(tag)}<//>`)}<//>
        <//>`)}
    <//>
  `;
}

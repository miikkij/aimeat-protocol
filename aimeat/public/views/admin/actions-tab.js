/**
 * @file public/views/admin/actions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab that lists registered catalogue actions in a table —
 *   id, name/description, provider, category, base morsel cost, and tags.
 *
 * @structure
 *   - ActionsTab({ data }): renders data.actions.actions; shows Empty state when none registered
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: the table is the shared Table (it stacks
 *     on a phone), the tags are chips, and the inline styles and the diamond glyph after the cost go.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty, DataTable } from './shared.js';
import { Stack, Text, Chip } from '/components/poster-parts.js';

export default function ActionsTab({ data }) {
  const acts = data.actions?.actions || [];
  if (!acts.length) return html`<${Empty} text=${t('dashboard.noActionsRegistered')} />`;

  const headers = ['ID', t('dashboard.name'), t('dashboard.provider'), t('dashboard.category'), t('dashboard.baseCost'), t('dashboard.tags')];
  const rows = acts.map(a => [
    { text: escHtml(a.id), mono: true },
    html`<${Stack} density="compact"><strong>${escHtml(a.name)}</strong>
      ${a.description ? html`<${Text} kind="caption" tone="muted">${escHtml(a.description)}<//>` : null}<//>`,
    { text: escHtml(a.provider), mono: true },
    html`<${Badge} type=${a.category || 'info'} />`,
    { text: num(a.base_cost), align: 'end' },
    (a.tags || []).length
      ? html`<${Stack} direction="wrap" density="compact">${a.tags.map(tag => html`<${Chip} tone="muted">${escHtml(tag)}<//>`)}<//>`
      : '',
  ]);

  return html`<${DataTable} headers=${headers} rows=${rows} />`;
}

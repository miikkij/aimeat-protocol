/**
 * @file public/views/admin/actions-tab.js
 * @description Admin dashboard tab that lists registered catalogue actions in a table —
 *   id, name/description, provider, category, base morsel cost, and tags.
 *
 * @structure
 *   - ActionsTab({ data }): renders data.actions.actions; shows Empty state when none registered
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, Badge, Empty } from './shared.js';

export default function ActionsTab({ data }) {
  const acts = data.actions?.actions || [];
  if (!acts.length) return html`<${Empty} text=${t('dashboard.noActionsRegistered')} />`;

  return html`
    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>ID</th>
            <th>${t('dashboard.name')}</th>
            <th>${t('dashboard.provider')}</th>
            <th>${t('dashboard.category')}</th>
            <th>${t('dashboard.baseCost')}</th>
            <th>${t('dashboard.tags')}</th>
          </tr></thead>
          <tbody>
            ${acts.map(a => html`<tr>
              <td class="mono">${escHtml(a.id)}</td>
              <td>
                <strong>${escHtml(a.name)}</strong>
                ${a.description ? html`<div style="font-size:.75rem;color:var(--text-dim);max-width:260px">${escHtml(a.description)}</div>` : ''}
              </td>
              <td class="mono" style="font-size:.8rem">${escHtml(a.provider)}</td>
              <td><${Badge} type=${a.category || 'info'} /></td>
              <td>${num(a.base_cost)} \u2B25</td>
              <td>${(a.tags || []).map(tag => html`<span class="tag">${escHtml(tag)}</span> `)}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

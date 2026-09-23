/**
 * @file public/views/admin/apps-tab.row.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app as a table row (design canvas "AIMEAT Admin Applications", direction A):
 *   what it is, who owns it, how big, how often it has been opened, how many people forked it, when
 *   it was published, and what an operator can do to it.
 *
 *   DELETING LIVES IN THE ROW MENU. It removes an app, its versions and its screenshot for good and
 *   the owner is not asked, and it used to be a red button on every one of seventy-six rows, beside
 *   Hide and the same size. Taking an app down does everything a mistake needs and is undone in one
 *   press, so that stays on the row and the irreversible one moved behind the three dots.
 *
 *   OPEN IS FIRST because an operator was choosing by filename: the page never offered a way to
 *   look at the app it was about to take off the wall.
 * @structure appChips · AppRow
 * @usage html`<${AppRow} app=${a} onHide=${fn} onRestore=${fn} onDelete=${fn} ... />`
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, fmtBytes, num, Badge } from './shared.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

const DOTS = html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>`;

/** What is true about this app, in chips. The quiet state (on the wall, nothing set) shows none. */
export function appChips(app) {
  const chips = [];
  if (app.operator_hidden) chips.push(html`<${Badge} key="d" type="critical" label=${A('chip.down')} />`);
  if (app.parked) chips.push(html`<${Badge} key="p" type="muted" label=${A('chip.parked')} />`);
  if (app.protected) chips.push(html`<${Badge} key="c" type="info" label=${A('chip.code')} />`);
  if (app.operator_seo_blocked) chips.push(html`<${Badge} key="s" type="watch" label=${A('chip.seoBlocked')} />`);
  if (!app.operator_hidden && !app.parked && (app.downloads || 0) === 0) {
    chips.push(html`<${Badge} key="n" type="muted" label=${A('chip.neverOpened')} />`);
  }
  return chips;
}

export function AppRow({ app, onHide, onRestore, onDelete, onSeo, busy }) {
  const [menu, setMenu] = useState(false);
  const name = app.manifest?.name || app.filename;
  const close = () => setMenu(false);

  return html`
    <tr class=${app.operator_hidden ? 'adm-ap-row--down' : ''}>
      <td>
        <span class="adm-ap-name">${escHtml(name)}</span>
        <span class="adm-ap-file">${escHtml(app.filename)}${app.version_number ? ` · v${num(app.version_number)}` : ''}</span>
        <span class="adm-ap-chips">${appChips(app)}</span>
        ${app.operator_hidden && html`
          <span class="adm-ap-reason">
            ${app.operator_hide_reason ? `"${escHtml(app.operator_hide_reason)}" ` : ''}
            ${app.operator_hidden_by
              ? A('takenBy', { by: escHtml(app.operator_hidden_by), at: dt(app.operator_hidden_at) })
              : ''}
          </span>`}
      </td>
      <td class="adm-ap-owner" data-label=${A('col.owner')}>${escHtml(app.owner)}</td>
      <td class="r" data-label=${A('col.size')}>${fmtBytes(app.size || 0)}</td>
      <td class="r" data-label=${A('col.opened')}>${num(app.downloads || 0)}</td>
      <td class="r" data-label=${A('col.forks')}>${num(app.forks || 0)}</td>
      <td class="r" data-label=${A('col.published')}>${dt(app.created_at)}</td>
      <td class="r">
        <span class="adm-ap-acts">
          <a class="og-door og-door--quiet" href=${app.download_url} target="_blank" rel="noopener">${A('open')}</a>
          ${app.operator_hidden
            ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => onRestore(app)}>${A('putBack')}</button>`
            : html`<button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => onHide(app)}>${A('takeDown')}</button>`}
          <span class="adm-ap-menuwrap">
            <button type="button" class="adm-ap-kebab" aria-label=${A('more')} aria-expanded=${menu}
              onClick=${() => setMenu(m => !m)} onBlur=${() => window.setTimeout(close, 150)}>${DOTS}</button>
            ${menu && html`
              <span class="adm-ap-menu">
                <button type="button" onClick=${() => { close(); window.open(app.download_url, '_blank', 'noopener'); }}>${A('menu.open')}</button>
                <button type="button" onClick=${() => { close(); onSeo(app); }}>
                  ${app.operator_seo_blocked ? A('menu.seoAllow') : A('menu.seoBlock')}
                </button>
                <span class="adm-ap-menu-sep"></span>
                ${!app.operator_hidden && html`
                  <button type="button" onClick=${() => { close(); onHide(app); }}>${A('menu.takeDown')}</button>`}
                <button type="button" class="adm-ap-danger" onClick=${() => { close(); onDelete(app); }}>${A('menu.delete')}</button>
              </span>`}
          </span>
        </span>
      </td>
    </tr>`;
}

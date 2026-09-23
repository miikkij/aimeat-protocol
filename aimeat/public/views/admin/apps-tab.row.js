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
 * @structure appChips · appRowCells
 * @usage rows=${apps.map(a => appRowCells(a, { onHide, onRestore, onDelete, onSeo, busy }))}
 * @version-history
 *   v2.0.0 — 2026-09-22 — The row is the cells of the shared table (appRowCells) instead of a hand-made
 *     <tr>, and its three-dot menu is the shared Menu, which closes on a choice, Escape or a click
 *     elsewhere as the old one did on blur. What the row says and does is unchanged.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, fmtBytes, num, Badge } from './shared.js';
import { Stack, Action, Menu, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const A = (key, params) => t('admin.apps.' + key, params);

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

/**
 * The seven cells of one app's row in the shared table: the app (name, file, chips, the take-down
 * reason), owner, size, opened, forks, published, and the actions with the row menu.
 */
export function appRowCells(app, { onHide, onRestore, onDelete, onSeo, busy }) {
  const name = app.manifest?.name || app.filename;
  const chips = appChips(app);
  return [
    html`<${Stack} density="compact">
      <strong>${escHtml(name)}</strong>
      <${Text} kind="mono" tone="muted">${escHtml(app.filename)}${app.version_number ? ` · v${num(app.version_number)}` : ''}<//>
      ${chips.length > 0 && html`<${Stack} direction="wrap" density="compact">${chips}<//>`}
      ${app.operator_hidden && html`
        <${Text} kind="caption" tone="muted">
          ${app.operator_hide_reason ? `"${escHtml(app.operator_hide_reason)}" ` : ''}
          ${app.operator_hidden_by
            ? A('takenBy', { by: escHtml(app.operator_hidden_by), at: dt(app.operator_hidden_at) })
            : ''}
        <//>`}
    <//>`,
    html`<${Text} kind="mono" tone="muted">${escHtml(app.owner)}<//>`,
    { text: fmtBytes(app.size || 0), align: 'end' },
    { text: num(app.downloads || 0), align: 'end' },
    { text: num(app.forks || 0), align: 'end' },
    { text: dt(app.created_at), align: 'end' },
    html`<${Stack} direction="horizontal" align="end">
      <${Action} href=${app.download_url} target="_blank">${A('open')}<//>
      ${app.operator_hidden
        ? html`<${Action} disabled=${busy} onClick=${() => onRestore(app)}>${A('putBack')}<//>`
        : html`<${Action} disabled=${busy} onClick=${() => onHide(app)}>${A('takeDown')}<//>`}
      <${Menu} label=${A('more')} items=${[
        { label: A('menu.open'), onClick: () => window.open(app.download_url, '_blank', 'noopener') },
        { label: app.operator_seo_blocked ? A('menu.seoAllow') : A('menu.seoBlock'), onClick: () => onSeo(app) },
        { divider: true, label: '' },
        !app.operator_hidden && { label: A('menu.takeDown'), onClick: () => onHide(app) },
        { label: A('menu.delete'), danger: true, onClick: () => onDelete(app) },
      ]} />
    <//>`,
  ];
}

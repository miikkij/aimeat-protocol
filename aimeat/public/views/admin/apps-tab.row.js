/**
 * @file public/views/admin/apps-tab.row.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app as a row of the list (design canvas "AIMEAT Admin Applications", direction
 *   A): what it is, who owns it, how big, how often it has been opened, how many people forked it,
 *   when it was published, and what an operator can do to it.
 *
 *   DELETING LIVES IN THE ROW MENU. It removes an app, its versions and its screenshot for good and
 *   the owner is not asked, and it used to be a red button on every one of seventy-six rows, beside
 *   Hide and the same size. Taking an app down does everything a mistake needs and is undone in one
 *   press, so that stays on the row and the irreversible one moved behind the three dots.
 *
 *   OPEN IS FIRST because an operator was choosing by filename: the page never offered a way to
 *   look at the app it was about to take off the wall.
 * @structure appChips · AppRow
 * @usage html`<${AppRow} app=${a} onHide=${fn} onRestore=${fn} onDelete=${fn} ... />` inside the page's List
 * @version-history
 *   v1.1.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so an app name, filename, owner or take-down reason with a quote or an ampersand
 *     showed as &quot; / &amp;.
 *   v1.1.0 — 2026-09-27 — On the library components (page group G5): the row is a List Row (an app
 *     taken down is faded), its chips the Name's marks, the reason its line, the figures Num cells,
 *     the doors action links and the ⋯ menu of the Doors (CardMenu: the arrow keys, Escape, a line
 *     between the groups, the delete in the danger tone). The file writes no class and no style.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dt, fmtBytes, num, Badge } from './shared.js';
import { Row, Name, Cell, Num, When, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';

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

export function AppRow({ app, onHide, onRestore, onDelete, onSeo, busy }) {
  const name = app.manifest?.name || app.filename;
  const reason = app.operator_hidden
    ? `${app.operator_hide_reason ? `"${app.operator_hide_reason}" ` : ''}${app.operator_hidden_by
      ? A('takenBy', { by: app.operator_hidden_by, at: dt(app.operator_hidden_at) })
      : ''}`
    : null;
  // The one irreversible action lives in the menu, not on the row.
  const menu = [
    { label: A('menu.open'), onClick: () => window.open(app.download_url, '_blank', 'noopener') },
    { label: app.operator_seo_blocked ? A('menu.seoAllow') : A('menu.seoBlock'), onClick: () => onSeo(app) },
    { divider: true },
    !app.operator_hidden && { label: A('menu.takeDown'), onClick: () => onHide(app) },
    { label: A('menu.delete'), onClick: () => onDelete(app), danger: true },
  ];

  return html`
    <${Row} faded=${!!app.operator_hidden}>
      <${Name} meta=${`${app.filename ?? ''}${app.version_number ? ` · v${num(app.version_number)}` : ''}`}
        marks=${appChips(app)} desc=${reason || null}>${name}<//>
      <${Cell} meta>${app.owner}<//>
      <${Num} quiet>${fmtBytes(app.size || 0)}<//>
      <${Num} quiet>${num(app.downloads || 0)}<//>
      <${Num} quiet>${num(app.forks || 0)}<//>
      <${When}>${dt(app.created_at)}<//>
      <${Doors} menu=${menu} menuLabel=${A('more')}>
        <${Action} small soft href=${app.download_url} newTab>${A('open')}<//>
        ${app.operator_hidden
          ? html`<${Action} small soft disabled=${busy} onClick=${() => onRestore(app)}>${A('putBack')}<//>`
          : html`<${Action} small soft disabled=${busy} onClick=${() => onHide(app)}>${A('takeDown')}<//>`}
      <//>
    <//>`;
}

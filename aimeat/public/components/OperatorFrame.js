/**
 * @file public/components/OperatorFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frame of the admin pages, as one component: the operator menu on the left, and
 *   the page on the right under a bar that stays in sight (the page's title in the poster face, the
 *   refresh as an action link, the clock of the last read as a machine reading). While the operator
 *   is not signed in, or is not an operator, the frame holds one centred card that says so. A page
 *   passes data, never a class. The look is css/components/operator-frame.css (main's .adm,
 *   .adm-main, .adm-topbar, .adm-login in views/admin.css).
 *
 *   OperatorFrame({ menu, title, onRefresh, refreshing, refreshLabel, busyLabel, time, shut, children })
 *   - menu: the OperatorMenu. title: the page's title.
 *   - onRefresh: reads everything again; refreshing: it is reading (the action is off and says
 *     busyLabel); refreshLabel: the action's word. time: when it was last read (a timestamp or a
 *     Date), drawn as the reader's clock.
 *   - shut: { title, text, note } draws the centred card in place of the menu and the page.
 *   - The bar prints with a page that prints as a document (data-print-keep, see PrintPage.js).
 *   - children: the page. The frame gives it the library's page kit (the .og tokens) with the
 *     operator's own sizes: the page title 2.1rem, a section title 1.5rem, a section's number in
 *     mono coral.
 * @structure OperatorFrame(props)
 * @usage html`<${OperatorFrame} menu=${html`<${OperatorMenu} …/>`} title=${t(pageKey)} onRefresh=${loadAll}
 *          refreshing=${loading} refreshLabel=${t('dashboard.refresh')} busyLabel=${t('dashboard.loading')}
 *          time=${lastUpdate}>…the page…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: moved out of views/admin.js and views/admin.css (.adm, .adm-main,
 *     .adm-topbar, .adm-page-title, .adm-refresh, .adm-time, .adm-login, .adm-card) under the
 *     component's own names. The refresh takes the action link of the library (it had its own copy of
 *     the same underlined word) and the clock takes the time mark.
 */
import { h } from 'preact';
import htm from 'htm';
import { time as fmtTime } from '/js/format.js';
import { Action } from '/components/Action.js';

const html = htm.bind(h);

/**
 * @param {{ menu?: any, title?: any, onRefresh?: () => void, refreshing?: boolean, refreshLabel?: any, busyLabel?: any, time?: number|Date|null, shut?: { title: any, text?: any, note?: any }, children?: any }} props
 */
export function OperatorFrame({ menu, title, onRefresh, refreshing, refreshLabel, busyLabel, time, shut, children }) {
  if (shut) {
    return html`
      <div class="operator-frame">
        <div class="operator-frame-shut">
          <div class="operator-frame-shut-card">
            <h2>${shut.title}</h2>
            ${shut.text ? html`<p>${shut.text}</p>` : null}
            ${shut.note ? html`<p class="operator-frame-shut-note">${shut.note}</p>` : null}
          </div>
        </div>
      </div>`;
  }
  return html`
    <div class="operator-frame">
      ${menu}
      <div class="operator-frame-main">
        <div class="operator-frame-bar" data-print-keep>
          <div class="operator-frame-title poster-page-title">${title}</div>
          <div class="operator-frame-tools">
            ${onRefresh ? html`<${Action} small onClick=${() => onRefresh()} disabled=${!!refreshing}>${refreshing ? busyLabel : refreshLabel}<//>` : null}
            ${time ? html`<span class="operator-frame-time">${fmtTime(time)}</span>` : null}
          </div>
        </div>
        <div class="og operator-frame-page">${children}</div>
      </div>
    </div>`;
}

export default OperatorFrame;

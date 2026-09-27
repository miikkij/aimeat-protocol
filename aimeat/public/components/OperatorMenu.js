/**
 * @file public/components/OperatorMenu.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side menu of the admin pages, as one component: the dark ground that
 *   tells at once that this is the operator's side, a heading that says so ("Operator menu"), the
 *   node id, the groups under a small capital word in the sun colour, the items with their counts on
 *   the right, and the chosen item on the sun. A page passes data, never a class. The look is
 *   css/components/operator-menu.css (main's .adm-sidebar in views/admin.css, unchanged), whose
 *   ground, ink and grey are theme hooks: --operator-menu-ground, --operator-menu-ink,
 *   --operator-menu-dim and --operator-menu-hover (the poster's fixed ink and
 *   paper by default, the same in both modes, so a theme may set them and nothing else flips them).
 *
 *   OperatorMenu({ title, nodeId, groups, active, onPick, label })
 *   - title: the heading at the top (t('dashboard.operatorMenu')). nodeId: the node's id under it.
 *   - groups: [{ key, title, items: [{ id, label, count }] }]; `count` shows on the right when it is a
 *     number (0 included, as main showed it).
 *   - active: the chosen item's id. onPick(id): an item was chosen.
 *   - label: the navigation's name for a screen reader (defaults to the title).
 * @structure OperatorMenu(props)
 * @usage html`<${OperatorMenu} title=${t('dashboard.operatorMenu')} nodeId=${nodeId} groups=${groups}
 *          active=${activePage} onPick=${switchPage} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: moved out of views/admin.js (.adm-sidebar, .adm-nav-group,
 *     .adm-nav-item, .cnt, .node-id) with its look unchanged, plus the heading Jouni asked for: "minusta
 *     olisi hyvä mainita vielä siinä että tämä on operator menu, eli operaattorin valikko".
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ title?: any, nodeId?: string, groups: Array<{ key?: string, title: any, items: Array<{ id: string, label: any, count?: number|null }> }>, active?: string, onPick: (id: string) => void, label?: string }} props
 */
export function OperatorMenu({ title, nodeId, groups = [], active, onPick, label }) {
  return html`
    <nav class="operator-menu" aria-label=${label || (typeof title === 'string' ? title : undefined)}>
      ${title ? html`<div class="operator-menu-title">${title}</div>` : null}
      <div class="operator-menu-node">${nodeId || ''}</div>
      ${groups.map((group) => html`
        <div class="operator-menu-group" key=${group.key || String(group.title)}>${group.title}</div>
        ${group.items.map((item) => html`
          <button type="button" key=${item.id}
            class=${`operator-menu-item${active === item.id ? ' operator-menu-item--active' : ''}`}
            aria-current=${active === item.id ? 'page' : undefined}
            onClick=${() => onPick(item.id)}>
            <span class="operator-menu-label">${item.label}</span>
            ${typeof item.count === 'number' ? html`<span class="operator-menu-count">${item.count}</span>` : null}
          </button>`)}
      `)}
    </nav>`;
}

export default OperatorMenu;

/**
 * @file public/components/SideMenu.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The side menu of Settings & Controls, read as a table of contents: the way back to
 *   the home, the items (the open one on the sun, a coral count when something waits, a pin that
 *   shows on hover), the groups under a coral capital word that fold, and the one "show all tools"
 *   toggle. Its look is css/components/side-menu.css; the catalogue entry is `side-menu`.
 * @structure SideMenuHome({ href, children }) · SideMenuItem({ active, onClick, count, pin, children }) ·
 *   SideMenuGroup({ title, collapsed, onToggle, children }) · SideMenuMore({ onClick, children })
 * @usage html`<${SideMenuGroup} title="Information" collapsed=${false} onToggle=${…}>
 *   <${SideMenuItem} active=${true} count=${3} onClick=${…}>Messages<//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/landing-page.js and landing-page.cards.js with its
 *     markup unchanged apart from the class names (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** The way back to the home, an anchor that lines up with the items under it. */
export function SideMenuHome({ href, children }) {
  return html`
    <a class="side-menu-item side-menu-home" href=${href}>
      <span class="side-menu-label">${children}</span>
    </a>`;
}

/**
 * One item. `count` shows a coral count when it is a number above 0; `pin` ({ on, title, onToggle })
 * adds the pin that keeps the item under Pinned.
 * @param {{ active?: boolean, onClick: () => void, count?: number|null, pin?: { on: boolean, title: string, onToggle: () => void }, children?: any }} props
 */
export function SideMenuItem({ active, onClick, count, pin, children }) {
  return html`
    <button class=${`side-menu-item${active ? ' side-menu-item--active' : ''}`} onClick=${onClick}>
      <span class="side-menu-label">${children}</span>
      ${typeof count === 'number' && count > 0 ? html`<span class="poster-count poster-count--waiting">${count}</span>` : null}
      ${pin ? html`<span class=${`side-menu-pin${pin.on ? ' side-menu-pin--on' : ''}`}
        role="button" tabindex="-1" title=${pin.title}
        onClick=${(e) => { e.stopPropagation(); pin.onToggle(); }}>📌</span>` : null}
    </button>`;
}

/**
 * A group of items. With `onToggle` its title is a button that folds the group; without it the
 * title is a plain word (Pinned).
 * @param {{ title: any, collapsed?: boolean, onToggle?: () => void, children?: any }} props
 */
export function SideMenuGroup({ title, collapsed, onToggle, children }) {
  return html`
    <div class="side-menu-group">
      ${onToggle ? html`
        <button class="side-menu-group-title side-menu-group-toggle" onClick=${onToggle}>
          <span class=${`side-menu-chevron ${collapsed ? '' : 'side-menu-chevron--open'}`}>▼</span> ${title}
        </button>` : html`<div class="side-menu-group-title">${title}</div>`}
      ${!collapsed && children}
    </div>`;
}

/** The toggle between the basic menu and every tool, an underlined mono action. */
export function SideMenuMore({ onClick, children }) {
  return html`
    <button class="side-menu-item side-menu-more" onClick=${onClick}>
      <span class="side-menu-label">${children}</span>
    </button>`;
}

export default SideMenuItem;

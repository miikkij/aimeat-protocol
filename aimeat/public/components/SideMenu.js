/**
 * @file public/components/SideMenu.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The side menu of Settings & Controls, read as a table of contents: the way back to
 *   the home, the items (the open one on the sun, a coral count when something waits, a pin that
 *   shows on hover), the groups under a coral capital word that fold, and the one "show all tools"
 *   toggle. Its look is css/components/side-menu.css; the catalogue entry is `side-menu`.
 *
 *   A page's own index (added for appcat): SideMenu({ label, index }) holds the parts; `index` draws
 *   them as the app catalogue's rail: the way home under a heavy rule, the menu's name beside its
 *   framed mark (SideMenuTitle), bold rows, every count in small grey typewriter letters (an item's
 *   `tally`), the open row's count on a coral chip, the smaller grey rows of a long list (`small`),
 *   and under 900px every group a sideways strip of underlined capital words, the title and the
 *   group words hidden. An item that switches the page's view says so (`tab`: role tab, selected);
 *   a group may have no title, and a `role` and `label` (the view switch is a tab list).
 * @structure SideMenu({ label, index, children }) · SideMenuTitle({ mark, children }) ·
 *   SideMenuHome({ href, children }) · SideMenuItem({ active, onClick, count, tally, small, tab, pin, children }) ·
 *   SideMenuGroup({ title, collapsed, onToggle, role, label, children }) · SideMenuLabel({ children }) ·
 *   SideMenuMore({ onClick, children })
 * @usage html`<${SideMenuGroup} title="Information" collapsed=${false} onToggle=${…}>
 *   <${SideMenuItem} active=${true} count=${3} onClick=${…}>Messages<//><//>`
 *        html`<${SideMenu} index label=${x('rail')}><${SideMenuHome} href="/v1/home">← Home<//>
 *          <${SideMenuTitle} mark="📚">My Apps<//>
 *          <${SideMenuGroup} role="tablist"><${SideMenuItem} tab tally active count=${12} onClick=${…}>Your apps<//><//><//>`
 * @version-history
 *   v1.3.0 — 2026-09-27 — SideMenuLabel: a second word inside a group, whose rows stay in the
 *     group's strip on a phone (the catalogue's "Something missing" in the state group). Additive
 *     (appcat parity).
 *   v1.2.0 — 2026-09-27 — SideMenu (the root, `index`: a page's own index, the app catalogue's rail),
 *     SideMenuTitle, an item's `tally`, `small` and `tab`, a group without a title and its `role`
 *     and `label`. Additive: the Settings menu draws what it drew (appcat).
 *   v1.1.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/landing-page.js and landing-page.cards.js with its
 *     markup unchanged apart from the class names (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * The menu itself (added for appcat): a nav that holds the parts. `index`: the page's own index, the
 * app catalogue's rail (see the file's description); `label` names it for a screen reader.
 * @param {{ label?: string, index?: boolean, children?: any }} props
 */
export function SideMenu({ label, index, children }) {
  return html`<nav class=${`side-menu${index ? ' side-menu--index' : ''}`} aria-label=${label}>${children}</nav>`;
}

/**
 * The menu's own name beside its mark in a framed square (added for appcat: the catalogue's 📚 and
 * "My Apps"). Hidden on a phone in the index.
 * @param {{ mark?: any, children?: any }} props
 */
export function SideMenuTitle({ mark, children }) {
  return html`<div class="side-menu-title">${mark ? html`<span class="side-menu-title-mark" aria-hidden="true">${mark}</span>` : null}<span class="side-menu-title-words">${children}</span></div>`;
}

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
 * `tally` (added for appcat): the count is only how many, said whatever it is (0 too; '' says
 * nothing yet) in small grey typewriter letters, on a coral chip while the item is open. `small`: a
 * row of a long list (a tag), smaller and grey. `tab`: the item switches the page's view (role tab,
 * aria-selected = active).
 * @param {{ active?: boolean, onClick: () => void, count?: number|string|null, tally?: boolean, small?: boolean, tab?: boolean,
 *   pin?: { on: boolean, title: string, onToggle: () => void }, children?: any }} props
 */
export function SideMenuItem({ active, onClick, count, tally, small, tab, pin, children }) {
  const cls = `side-menu-item${active ? ' side-menu-item--active' : ''}${small ? ' side-menu-item--small' : ''}`;
  return html`
    <button type=${tab || tally || small ? 'button' : undefined} class=${cls} onClick=${onClick}
      role=${tab ? 'tab' : undefined} aria-selected=${tab ? String(!!active) : undefined}
      aria-current=${!tab && tally && active ? 'true' : undefined}>
      <span class="side-menu-label">${children}</span>
      ${tally
        ? (count !== null && count !== undefined ? html`<span class="side-menu-tally">${count}</span>` : null)
        : (typeof count === 'number' && count > 0 ? html`<span class="poster-count poster-count--waiting">${count}</span>` : null)}
      ${pin ? html`<span class=${`side-menu-pin${pin.on ? ' side-menu-pin--on' : ''}`}
        role="button" tabindex="-1" title=${pin.title}
        onClick=${(e) => { e.stopPropagation(); pin.onToggle(); }}>📌</span>` : null}
    </button>`;
}

/**
 * A group of items. With `onToggle` its title is a button that folds the group; without it the
 * title is a plain word (Pinned).
 * A group with no title draws none (added for appcat: the view switch at the top of the index);
 * `role` and `label` say what the group is to a screen reader (role="tablist" for a view switch).
 * @param {{ title?: any, collapsed?: boolean, onToggle?: () => void, role?: string, label?: string, children?: any }} props
 */
export function SideMenuGroup({ title, collapsed, onToggle, role, label, children }) {
  const titled = title !== undefined && title !== null && title !== '';
  return html`
    <div class="side-menu-group" role=${role} aria-label=${label}>
      ${onToggle ? html`
        <button class="side-menu-group-title side-menu-group-toggle" onClick=${onToggle}>
          <span class=${`side-menu-chevron ${collapsed ? '' : 'side-menu-chevron--open'}`}>▼</span> ${title}
        </button>` : titled ? html`<div class="side-menu-group-title">${title}</div>` : null}
      ${!collapsed && children}
    </div>`;
}

/**
 * A second word inside a group (added for appcat parity): the rows after it belong to the same
 * group and, on a phone, to the same sideways strip (the old catalogue's "Something missing" in the
 * state group). It looks as the group's own title and hides where the titles hide.
 * @param {{ children?: any }} props
 */
export function SideMenuLabel({ children }) {
  return html`<div class="side-menu-group-title">${children}</div>`;
}

/** The toggle between the basic menu and every tool, an underlined mono action. */
export function SideMenuMore({ onClick, children }) {
  return html`
    <button class="side-menu-item side-menu-more" onClick=${onClick}>
      <span class="side-menu-label">${children}</span>
    </button>`;
}

export default SideMenuItem;

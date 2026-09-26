/**
 * @file public/components/SettingsFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frame of Settings & Controls: the side column that holds the menu, the content
 *   column beside it, and on a phone the menu as a drawer behind the loud-action "Menu" button with a
 *   scrim that closes it. SettingsFrameHead is the content's head line (the crumb); SettingsFrameBody
 *   holds an open tab. Its look is css/components/settings-frame.css; the catalogue entry is
 *   `settings-frame`. The menu itself is SideMenu.
 * @structure SettingsFrame({ open, onToggle, onClose, menuLabel, menu, overview, dialogs, children }) ·
 *   SettingsFrameHead({ children }) · SettingsFrameBody({ children })
 * @usage html`<${SettingsFrame} open=${o} onToggle=${…} onClose=${…} menuLabel=${t('…')} menu=${html`<${SideMenu}>…<//>`}>
 *   <${SettingsFrameHead}><span class="poster-crumb">Apps</span><//><${SettingsFrameBody}>…<//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-26 — The phone's Menu button wears .poster-slab, the loud action (Jouni's decision "Phone menu button").
 *   v1.0.0 — 2026-09-25 — Moved out of views/profile/landing-page.js with its markup unchanged apart
 *     from the class names (UI consolidation phase 5, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * `dialogs` are drawn first inside the frame, before the menu button (the page's open dialogs).
 * @param {{ open?: boolean, onToggle: () => void, onClose: () => void, menuLabel: any, menu: any,
 *   overview?: boolean, dialogs?: any, children?: any }} props
 */
export function SettingsFrame({ open, onToggle, onClose, menuLabel, menu, overview, dialogs, children }) {
  return html`
    <div class="settings-frame${open ? ' settings-frame--open' : ''}">
      ${dialogs}
      <button class="settings-frame-toggle poster-slab" onClick=${onToggle}>☰ ${menuLabel}</button>
      <div class="settings-frame-scrim" onClick=${onClose}></div>
      <aside class="settings-frame-menu">${menu}</aside>
      <main class=${`settings-frame-content ${overview ? 'settings-frame-content--overview' : ''}`}>
        ${children}
      </main>
    </div>`;
}

/** The content's head line: the crumb of the open tab. @param {{ children?: any }} props */
export function SettingsFrameHead({ children }) {
  return html`<div class="settings-frame-head">${children}</div>`;
}

/** The open tab. @param {{ children?: any }} props */
export function SettingsFrameBody({ children }) {
  return html`<div class="settings-frame-body">${children}</div>`;
}

export default SettingsFrame;

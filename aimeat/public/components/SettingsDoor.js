/**
 * @file public/components/SettingsDoor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A way out of a dialog to the full settings: a row that is the thing, under the 3px
 *   ink rule (poster.css .poster-row--thing), with its title in capitals and a hint under it. Its
 *   look is css/components/settings-door.css; the catalogue entry is `settings-door`.
 * @structure SettingsDoor({ href, title, hint })
 * @usage html`<${SettingsDoor} href="/v1/profile" title=${t('…') + ' →'} hint=${t('…')} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/settings-dialog.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ href: string, title: any, hint: any }} props */
export function SettingsDoor({ href, title, hint }) {
  return html`
    <a class="poster-settings-door poster-row--thing" href=${href}>
      <span class="poster-settings-door-title">${title}</span>
      <span class="poster-settings-door-hint">
        ${hint}
      </span>
    </a>`;
}

export default SettingsDoor;

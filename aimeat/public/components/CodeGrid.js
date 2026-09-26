/**
 * @file public/components/CodeGrid.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A set of short codes a person writes down or copies (the two-step sign-in's backup
 *   codes): each one in the code face, in a grid on the copy ground, so ten of them stay countable
 *   at a glance instead of running as one line. Its look is css/components/code-grid.css and the
 *   copy box of css/poster.css (.poster-box--copy). A page passes the codes; it never writes a class.
 * @structure CodeGrid({ codes })
 * @usage html`<${CodeGrid} codes=${setup.backup_codes} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the backup codes of two-step sign-in (formerly
 *     views/profile/security-tab/two-factor.js div.pf-2fa-codes.poster-box.poster-box--copy,
 *     profile.css .pf-2fa-codes), a component that takes data (G3 page migration).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ codes: string[] }} props */
export function CodeGrid({ codes = [] }) {
  return html`<div class="poster-box poster-box--copy code-grid">
    ${codes.map((c) => html`<code class="code-inline" key=${c}>${c}</code>`)}
  </div>`;
}

export default CodeGrid;

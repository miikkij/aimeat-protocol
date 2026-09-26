/**
 * @file public/components/Masthead.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The top of a person's page: the avatar in its ink frame, the name as a headline,
 *   the identity line with its meaning in the tooltip, and the doors on the right (children),
 *   stacked on a desktop and in one row on a phone. Its look is css/components/masthead.css; the
 *   catalogue entry is `masthead`. MastheadButton is a door that does something here (it wears the
 *   underlined action shape); MastheadCog is the drawn cog such a door can carry.
 * @structure Masthead({ avatarSvg, name, identity, identityTitle, plate, onAvatar, avatarTitle, children }) ·
 *   MastheadButton({ onClick, children }) · MastheadCog
 * @usage
 *   html`<${Masthead} avatarSvg=${svg} name=${name} identity=${ghii} identityTitle=${t('…')}>
 *     <a class="poster-action" href="/v1/profile">…</a>
 *     <${MastheadButton} onClick=${open}>${MastheadCog}<span>…</span><//>
 *   <//>`
 * @version-history
 *   v1.2.1 — 2026-09-27 — MastheadPreview draws its own class name: .pf-avatar-preview →
 *     .poster-masthead-preview (a move, same look).
 *   v1.2.0 — 2026-09-26 — MastheadPreview: the head's picture framed as the head frames it, beside the
 *     field that sets it (the account dialog; its rule moved from profile.css to masthead.css;
 *     additive, page group G8).
 *   v1.1.0 — 2026-09-26 — `plate`: the page's own lines under the address; `onAvatar` and
 *     `avatarTitle`: a picture that opens something. The Settings overview's head is this head
 *     (Jouni's decision "Person head", a unification).
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/header.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** A cog, drawn rather than an icon font, so it needs nothing to load and scales cleanly. */
export const MastheadCog = html`
  <svg class="poster-masthead-cog" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>`;

/**
 * `plate` is what a page adds under the address (the Settings overview: this AIMEAT's address and
 * its marks). `onAvatar` makes the picture a control that opens something (the overview opens the
 * profile), with `avatarTitle` as its name.
 * @param {{ avatarSvg: string, name: any, identity?: string|null, identityTitle?: string, plate?: any,
 *   onAvatar?: () => void, avatarTitle?: string, children?: any }} props
 */
export function Masthead({ avatarSvg, name, identity, identityTitle, plate, onAvatar, avatarTitle, children }) {
  return html`
    <div class="poster-masthead">
      ${onAvatar
        ? html`<span class="poster-masthead-avatar poster-frame" role="button" tabindex="0" title=${avatarTitle}
            onClick=${onAvatar} dangerouslySetInnerHTML=${{ __html: avatarSvg }}></span>`
        : html`<span class="poster-masthead-avatar poster-frame" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: avatarSvg }}></span>`}
      <span class="poster-masthead-plate">
        <span class="poster-masthead-name">${name}</span>
        ${identity && html`
          <span class="poster-masthead-identity"
            title=${identityTitle}>
            ${identity}
          </span>`}
        ${plate}
      </span>
      <span class="poster-masthead-actions">
        ${children}
      </span>
    </div>`;
}

/** A door in the masthead that acts on this page (the underlined action shape). */
export function MastheadButton({ onClick, children }) {
  return html`
    <button type="button" class="poster-action poster-masthead-button" onClick=${onClick}>
      ${children}
    </button>`;
}

/**
 * The head's picture as a preview beside the field that sets it (added by page group G8: the
 * account dialog's avatar field): framed as the head frames it (Jouni's decision "Person head"),
 * 42px, the glyph at 1.3rem. Said to nobody; the field says it.
 */
export function MastheadPreview({ children }) {
  return html`<span class="poster-masthead-preview poster-frame" aria-hidden="true">${children}</span>`;
}

export default Masthead;

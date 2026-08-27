/**
 * @file public/views/home/header.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The topmost part of the home: the person's name on the left, and on the right the
 *   door to everything behind the home (settings and controls) and the button for the home's own
 *   two settings.
 *
 *   It reads as a nameplate on the wall of a house rather than a page title, which is why the name
 *   lives HERE and the heading below it states what is going on instead of greeting by name again.
 *   Before this, the greeting carried the name; keeping both would have printed it twice inside
 *   sixty pixels.
 *
 *   The button is deliberately not in `.koti-actions`: that row goes full-width below 560px, and a
 *   settings control that fills a phone screen reads as the page's main action, which it is not.
 * @structure HomeHeader({ name, owner, identity, onOpenSettings })
 * @usage
 *   import { HomeHeader } from '/views/home/header.js';
 *   html`<${HomeHeader} name=${name} onOpenSettings=${() => setOpen(true)} />`
 * @version-history
 *   v1.3.0 — 2026-08-27 — The door to settings and controls beside the settings button, and the
 *     button says "Home settings", since the dialog behind it now holds only the home's own two.
 *   v1.2.1 — 2026-08-23 — Em-dash swept from the identity hint (banned in every surface).
 *   v1.2.0 — 2026-08-19 — The GHII address under the name, with its meaning in the tooltip.
 *     Nothing anywhere told a person they HAVE a permanent address; the nameplate is where an
 *     address belongs, and the term arrives paired with what it means.
 *   v1.1.0 — 2026-08-18 — The pixel identicon beside the name — the same minidenticon the old
 *     profile draws from the owner handle, which Jouni missed here ("se oli minusta kiva"). A
 *     nameplate with a face on it.
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { minidenticon } from '/lib/minidenticons.min.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A cog, drawn rather than an icon font, so it needs nothing to load and scales cleanly. */
const Cog = html`
  <svg class="koti-cog" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>`;

export function HomeHeader({ name, owner, identity, onOpenSettings }) {
  const avatarSvg = minidenticon(typeof owner === 'string' && owner ? owner : (name || 'user'));
  return html`
    <div class="koti-header">
      <span class="koti-avatar" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: avatarSvg }}></span>
      <span class="koti-nameplate">
        <span class="koti-name">${name}</span>
        ${identity && html`
          <span class="koti-identity"
            title=${tr('home.identityHint', 'GHII: your permanent address. People, homes and agents everywhere find you by it.')}>
            ${identity}
          </span>`}
      </span>
      <span class="koti-header-actions">
        ${/* The door to everything behind the home. The header carries the same link, but a person
              reading the nameplate is not reading the header, and the relationship (home in front,
              controls behind) has to be visible on the page itself. */''}
        <a class="btn-ghost koti-controls-link" href="/v1/profile">
          ${tr('home.settings.allControls', 'All settings and controls')} →
        </a>
        <button type="button" class="btn-ghost koti-settings-btn" onClick=${onOpenSettings}>
          ${Cog}
          <span>${tr('home.settings.open', 'Home settings')}</span>
        </button>
      </span>
    </div>`;
}

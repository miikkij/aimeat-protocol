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
 *   The button is deliberately not in `.poster-actions`: that row goes full-width below 560px, and a
 *   settings control that fills a phone screen reads as the page's main action, which it is not.
 * @structure HomeHeader({ name, owner, identity, onOpenSettings })
 * @usage
 *   import { HomeHeader } from '/views/home/header.js';
 *   html`<${HomeHeader} name=${name} onOpenSettings=${() => setOpen(true)} />`
 * @version-history
 *   2026-09-23: Composed from components/Masthead.js (Masthead, MastheadButton, MastheadCog), which
 *     emits the markup this file wrote (UI consolidation phase 1, a move).
 *   2026-09-23: The masthead is the shared part in css/parts.css (.poster-masthead*), moved from
 *     home.css with its values; .koti-link, a class no rule reached here, is gone.
 *   2026-09-13: Compose the existing home shapes with shared poster classes.
 *   v1.4.0 — 2026-08-28 — The poster home: the two actions are ink-underlined links (.koti-link)
 *     rather than ghost buttons, so the nameplate's masthead has one register.
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
import { Masthead, MastheadButton, MastheadCog } from '/components/Masthead.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function HomeHeader({ name, owner, identity, onOpenSettings }) {
  const avatarSvg = minidenticon(typeof owner === 'string' && owner ? owner : (name || 'user'));
  return html`
    <${Masthead} avatarSvg=${avatarSvg} name=${name} identity=${identity}
      identityTitle=${tr('home.identityHint', 'GHII: your permanent address. People, homes and agents everywhere find you by it.')}>
      ${/* The door to everything behind the home. The header carries the same link, but a person
            reading the nameplate is not reading the header, and the relationship (home in front,
            controls behind) has to be visible on the page itself. */''}
      <a class="poster-action" href="/v1/profile">
        ${tr('home.settings.allControls', 'All settings and controls')} →
      </a>
      <${MastheadButton} onClick=${onOpenSettings}>
        ${MastheadCog}
        <span>${tr('home.settings.open', 'Home settings')}</span>
      <//>
    <//>`;
}

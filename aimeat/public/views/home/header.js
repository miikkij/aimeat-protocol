/**
 * @file public/views/home/header.js
 * @description The topmost part of the home: the person's name on the left, one settings button on
 *   the right.
 *
 *   It reads as a nameplate on the wall of a house rather than a page title, which is why the name
 *   lives HERE and the heading below it states what is going on instead of greeting by name again.
 *   Before this, the greeting carried the name; keeping both would have printed it twice inside
 *   sixty pixels.
 *
 *   The button is deliberately not in `.koti-actions`: that row goes full-width below 560px, and a
 *   settings control that fills a phone screen reads as the page's main action, which it is not.
 * @structure HomeHeader({ name, owner, onOpenSettings })
 * @usage
 *   import { HomeHeader } from '/views/home/header.js';
 *   html`<${HomeHeader} name=${name} onOpenSettings=${() => setOpen(true)} />`
 * @version-history
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

export function HomeHeader({ name, owner, onOpenSettings }) {
  const avatarSvg = minidenticon(typeof owner === 'string' && owner ? owner : (name || 'user'));
  return html`
    <div class="koti-header">
      <span class="koti-avatar" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: avatarSvg }}></span>
      <span class="koti-name">${name}</span>
      <button type="button" class="btn-ghost koti-settings-btn" onClick=${onOpenSettings}>
        ${Cog}
        <span>${tr('home.settings.open', 'Settings')}</span>
      </button>
    </div>`;
}

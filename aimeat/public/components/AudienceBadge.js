/**
 * @file public/components/AudienceBadge.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who can read one thing of the person's, said in words on a tag (plan doc-mvcn6c7e4e5q,
 *   V6.4): Private, "<organism> members", Signed-in, Anyone with the code (or the password), Anyone
 *   with the link, Public. The tooltip says the same in a sentence. The catalogue entry is
 *   `audience-badge`.
 *
 *   ONE BADGE FOR EVERY KIND. A memory record, a file, a workspace page, an app, a package, a
 *   knowledge package, a board and a skill each store their audience in their own words; the page
 *   passes what its API returned and /js/audience.js reads it into one level. `pnpm
 *   check:audience-badge` holds the views that show the owner their content to this component, so a
 *   view cannot go back to printing the raw stored word.
 *
 *   THE ORGANISM IS NAMED, never called "organisation" (decision 11.1 of the plan): the name comes
 *   from the organisms the person belongs to (/js/organism-names.js, one read for the whole page), or
 *   from `organismName` when the page already has it.
 *
 *   The look is the Tag (poster.css .poster-chip) with css/components/audience-badge.css: as wide as
 *   its words wherever it stands, public on the sun, a link, a code or a password in the attention
 *   colours (ink words on the pale amber ground, never the coral of a destructive action), private
 *   dim, the two in between plain. With `onClick` it is a button (mark.css .mark-button).
 * @structure AudienceBadge({ value, audience, app, organismName, onClick, expanded })
 * @usage
 *   html`<${AudienceBadge} value=${m.visibility} />`
 *   html`<${AudienceBadge} app=${app} />`
 *   html`<${AudienceBadge} audience=${shareAudienceOf(share.access, orgId)} />`
 * @version-history
 *   v1.2.0 — 2026-10-18 — An eye before the words and semibold words: on a board's page it read as one
 *     more of the tags beside it; the same mark everywhere it stands.
 *   v1.1.0 — 2026-10-18 — Its own sheet (audience-badge.css): it sizes to its words instead of filling
 *     a listing cell, 11.5px words, and a link or a code in the attention colours instead of coral
 *     (3.43:1 on the page); drawn here on the Tag's classes rather than through Mark.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { audienceOf, appAudienceOf, audienceKeys } from '/js/audience.js';
import { useOrganismName } from '/js/organism-names.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * The eye before the words: what makes the badge read as "who can read this" beside other tags (a
 * board's "0 notices", "A board of my own"), in a list and on a page head alike. 16px grid, drawn in
 * the words' colour.
 */
const eye = () => html`<svg class="audience-badge-eye" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
  <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
</svg>`;

/** The Tag's tone for each level; a link or a code is the badge's own attention tone. */
const TONE = { public: 'poster-chip--sun', private: 'poster-chip--dim', link: 'audience-badge--open', code: 'audience-badge--open' };

/**
 * `value` is the stored audience (a visibility, an `open_to`, a share's access); `audience` a level
 * already read (from /js/audience.js); `app` an app as GET /v1/apps hands it to its owner. One of the
 * three. `onClick` makes the tag the button that changes it (the memory row's visibility).
 */
export function AudienceBadge({ value, audience, app, organismName, onClick, expanded }) {
  const a = audience || (app ? appAudienceOf(app) : audienceOf(value));
  const fetched = useOrganismName(a.level === 'organism' && !organismName ? a.organismId : null);
  const name = a.level === 'organism' ? (organismName || fetched || '') : '';
  const keys = audienceKeys(a, !!name);
  const cls = cx('poster-chip', 'audience-badge', TONE[a.level]);
  const title = t(keys.who, { name });
  const words = html`${eye()}<span>${t(keys.word, { name })}</span>`;
  if (onClick) {
    return html`<button type="button" class=${cx(cls, 'mark-button')} title=${title}
      aria-expanded=${expanded === undefined ? undefined : String(!!expanded)} onClick=${onClick}>${words}</button>`;
  }
  return html`<span class=${cls} title=${title}>${words}</span>`;
}

export default AudienceBadge;

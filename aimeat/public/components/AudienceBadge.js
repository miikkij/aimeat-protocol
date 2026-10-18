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
 *   The look is the Mark's tag (css/components/mark.css and poster.css .poster-chip): public on the
 *   sun, a link or a code in coral (a stranger can read it), private dim (it reaches nobody), the two
 *   in between plain.
 * @structure AudienceBadge({ value, audience, app, organismName, onClick, expanded })
 * @usage
 *   html`<${AudienceBadge} value=${m.visibility} />`
 *   html`<${AudienceBadge} app=${app} />`
 *   html`<${AudienceBadge} audience=${shareAudienceOf(share.access, orgId)} />`
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Mark } from '/components/Mark.js';
import { audienceOf, appAudienceOf, audienceKeys } from '/js/audience.js';
import { useOrganismName } from '/js/organism-names.js';

const html = htm.bind(h);

const TONE = { public: 'sun', link: 'coral', code: 'coral', private: 'dim' };

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
  return html`<${Mark} tone=${TONE[a.level]} title=${t(keys.who, { name })} onClick=${onClick} expanded=${expanded}>${t(keys.word, { name })}<//>`;
}

export default AudienceBadge;

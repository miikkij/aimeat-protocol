/**
 * @file src/services/app-build/legal-readiness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which legal pages an app ought to have, and which of them it does not have yet.
 *   A pure move out of services/app/legal.ts (which re-exports both names), so the publish answer
 *   (app-publish-next-steps.ts) can say which pages are open without importing app-legal, whose
 *   imports lead back to the publish path and close an import cycle.
 *
 *   BY WHO THE APP IS OFFERED TO. Terms and a privacy page answer to the people an app is offered
 *   to. An app nobody but its owner is offered (unlisted and for signed-in members, or behind an
 *   access code) has nobody to answer to, and an app for one organism's members is that
 *   organism's own matter: neither is recommended a page. Until 2026-11-28 every published app was
 *   recommended both, and the publish answer said so on every publish: in four measured rounds of
 *   five builds each, builders wrote a privacy page for an errands list only its owner opens, about
 *   ten calls a round (Jouni, 2026-11-28: the pages are made when an app is opened to others, and
 *   then by what the case and the reach of the opening need).
 * @structure LegalAudience · legalAudienceOf(app) · LegalReadiness · legalReadiness(app, opts)
 * @usage
 *   const { missing, reason } = legalReadiness(app);
 * @version-history
 *   v1.1.0 — 2026-11-28 — The recommendation follows who the app is offered to (legalAudienceOf) and,
 *     when the caller knows it, whether the app keeps personal data. An app only its owner or one
 *     organism opens is recommended no page (wish-ehto-ja-tietosuojasivut-vasta-kun-sovellus-avataan-muille-la).
 *   v1.0.0 — 2026-11-08 — Moved from services/app-legal.ts unchanged.
 */
import { appListingOf, type AppLegalKind, type AppSummaryRecord } from '../../storage/types/apps.js';

/**
 * Who an app is offered to, as far as its pages go: `nobody-else` (unlisted and for signed-in
 * members, or behind an access code: the owner and the people they hand the address or the code
 * to), `organism` (one organism's members), `members` (listed for this node's signed-in members),
 * `link` (anyone who has the address, with or without an account) and `public` (listed, anyone).
 */
export type LegalAudience = 'nobody-else' | 'organism' | 'members' | 'link' | 'public';

/** The facts of an app record that say who is offered it. */
type Offered = { accessCode?: string | null; access?: string | null; parked?: boolean; community?: boolean };

export function legalAudienceOf(app: Offered): LegalAudience {
  if (app.accessCode) return 'nobody-else';
  const listing = appListingOf({ parked: !!app.parked, community: !!app.community });
  if (typeof app.access === 'string' && app.access.startsWith('organism:')) return 'organism';
  if (app.access === 'signed-in') return listing === 'unlisted' ? 'nobody-else' : 'members';
  return listing === 'listed' ? 'public' : 'link';
}

export interface LegalReadiness {
  /** The kinds this app should have, given what it is. */
  recommended: AppLegalKind[];
  /** Of those, the ones it does not have yet. */
  missing: AppLegalKind[];
  /** Why the recommendation is what it is, one line. */
  reason: string;
  /** Who the app is offered to, which the recommendation follows. */
  audience: LegalAudience;
}

const REASON: Record<LegalAudience, string> = {
  'nobody-else': 'Nobody but its owner is offered this app (it is unlisted and for signed-in members, or behind an access code), so it needs no terms or privacy page. They are recommended when it is listed or opened to anyone.',
  organism: 'This app is for the members of one organism. What they are told about their data is that organism\'s own matter, so no page of the app\'s own is recommended.',
  members: 'This app is listed for the signed-in members of this node, so it tells them what it does with their data.',
  link: 'Anyone who has the address opens this app, also people without an account, so it tells them what it does with their data.',
  public: 'This app is listed for everyone, so it answers for its own terms and for the personal data it handles.',
};

/**
 * Which pages an app ought to have. An app that takes money (appSellsForMoney): terms, privacy, who
 * is selling, how to withdraw, the accessibility statement the EAA asks of e-commerce, and a support
 * contact, whoever it is offered to. Any other app by who it is offered to (legalAudienceOf): none
 * for an app only its owner or one organism opens; a privacy page for one offered to this node's
 * members or to anyone with the address; terms as well for one listed for everyone. `personalData:
 * false` (the data map says the app keeps none) takes the privacy page away. Recommended, never
 * blocked: the owner decides, the details view shows what is missing, and a chip on the app's
 * masthead says so.
 */
export function legalReadiness(
  app: Pick<AppSummaryRecord, 'manifest'> & Offered,
  opts?: { sellsForMoney?: boolean; personalData?: boolean },
): LegalReadiness {
  const m = app.manifest;
  const sells = opts?.sellsForMoney === true;
  const audience = legalAudienceOf(app);
  const privacy: AppLegalKind[] = opts?.personalData === false ? [] : ['privacy'];
  const byAudience: Record<LegalAudience, AppLegalKind[]> = {
    'nobody-else': [], organism: [], members: privacy, link: privacy, public: ['terms', ...privacy],
  };
  const recommended: AppLegalKind[] = sells
    ? ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'support']
    : byAudience[audience];
  const have = new Set(Object.keys(m?.legal ?? {}));
  return {
    recommended,
    missing: recommended.filter(k => !have.has(k)),
    reason: sells
      ? 'This app sells something, so it answers for the sale: who is selling, on what terms, how to withdraw, how the data is handled, and how the shop can be used by everyone.'
      : REASON[audience],
    audience,
  };
}

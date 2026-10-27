/**
 * @file src/services/own-app-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When the owner's OWN app still asks the owner before it gets a permission.
 *
 *   The owner's own app signs in silently and gets every word its page declares: publishing the app
 *   is the owner's decision about their own account (routes/app-grants.ts, the silent bridge, and
 *   the consent page's auto-approve). Two cases are not the owner's decision, and there the words
 *   the owner's grant lacks go to the owner's one-press consent, listed, instead (secaudit2026oct22,
 *   app-grants/own-app-silent-ignores-publisher-and-owner-narrowing; developer decision 2026-10-25):
 *   - THE LIVE VERSION WAS PUBLISHED BY ANOTHER ACCOUNT, one the owner gave a publisher or full
 *     development right (services/app-publish.ts stamps `manifest.publishedBy` on every version).
 *     The owner's own agent is the owner (purpose rule 2) and counts as the owner here.
 *   - THE OWNER NARROWED THE GRANT BY HAND (PATCH /v1/app-grants/:id stamps scopesFixedAt). A word
 *     the owner took away does not come back without the owner saying yes again.
 *   A version the owner published keeps signing in silently, its new words included, as before. A
 *   version published before the stamp existed has no `publishedBy` and is treated as the owner's,
 *   so nothing that signs in today stops doing so at the update (purpose rule 6).
 * @structure OwnAppConsent · ownAppConsentNeed()
 * @usage
 *   const need = isOwnApp ? await ownAppConsentNeed(storage, owner, target, existing, wanted) : null;
 *   if (need) return reply({ ok: false, error: 'consent_required', reason: need.reason, added: need.added.join(' ') });
 * @version-history
 *   v1.1.0 — 2026-10-27 — A version published through the grant of ANOTHER AUTHOR'S APP
 *     (`manifest.publishedByApp`) asks like one another account published; the owner's own app
 *     publishing through its own grant does not (secaudit2026oct26, app-grant-publisher-reads-as-owner).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { accountOf } from './app-members.js';
import { authorAccountOf } from './app-grant-author.js';
import { byAnotherAuthorsApp } from './app-published-by-app.js';

/** Why the owner's own app asks the owner, and the words it asks for that the owner's grant lacks. */
export interface OwnAppConsent {
  reason: 'publisher_version' | 'owner_narrowed';
  /** The words the app asks for that the owner's live grant does not hold. */
  added: string[];
  /** publisher_version: who published the live version (a GHII or a GAII, public provenance), or the app whose grant did. */
  publisher?: string;
  /** publisher_version through an app's grant: that app, `<author>/<filename>`. */
  publisherApp?: string;
  /** owner_narrowed: when the owner narrowed the grant. */
  narrowedAt?: string;
}

/**
 * Whether the owner's own app at `target` (`<owner>/<file>`) must ask before it gets `wanted`.
 * Null: it signs in silently, as an own app always has. Only words the grant lacks are ever asked
 * for; a narrower or equal set never asks.
 */
export async function ownAppConsentNeed(
  storage: Pick<Storage, 'getAppByOwnerName'>,
  owner: string,
  target: string,
  existing: Pick<AppGrantRecord, 'scopes' | 'scopesFixedAt'> | null,
  wanted: readonly string[],
): Promise<OwnAppConsent | null> {
  const held = existing?.scopes ?? [];
  const added = wanted.filter(s => !held.includes(s));
  if (!added.length) return null;
  const author = authorAccountOf(target);
  if (author) {
    const app = await storage.getAppByOwnerName(author, target.slice(author.length + 1));
    const publisher = app?.manifest?.publishedBy;
    if (typeof publisher === 'string' && publisher && accountOf(publisher) !== accountOf(owner)) {
      return { reason: 'publisher_version', added, publisher };
    }
    // Published through the grant of another author's app: that app is the publisher, though the
    // token acts for the owner (services/app-published-by-app.ts; secaudit2026oct26).
    const byApp = app?.manifest?.publishedByApp;
    if (byAnotherAuthorsApp(byApp, owner)) {
      return { reason: 'publisher_version', added, publisher: byApp, publisherApp: byApp };
    }
  }
  if (existing?.scopesFixedAt) return { reason: 'owner_narrowed', added, narrowedAt: existing.scopesFixedAt };
  return null;
}

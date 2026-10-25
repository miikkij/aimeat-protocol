/**
 * @file src/services/app-grant-author.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an app grant was given to an app of an EARLIER holder of its author's account
 *   name, so that it covers nothing the current holder publishes.
 *
 *   WHY. A grant is keyed by the grantee and the app target `<author>/<file>`. An account name is
 *   released at erasure, and the next person to register it publishes under the same target, often
 *   at the same per-app origin (the subdomain binding names the target). A consent covers the app of
 *   the author the person consented to, and a later account under the same name is a new principal
 *   (the rule auth/credential-age.ts madeAfter applies to tokens and agents). So a grant made before
 *   the current author account was created is treated as absent: the silent bridge asks for consent
 *   again, a refresh is refused, and the grant list leaves it out (secaudit2026oct22,
 *   app-grants:grants-to-erased-authors-apps-rebind-on-name-reuse). A republish by the same author
 *   changes nothing: the account is older than every grant to its apps.
 * @structure authorAccountOf() · grantGivenToEarlierAuthor() · liveAppGrantFor()
 * @usage if (await grantGivenToEarlierAuthor(storage, grant)) { ...treat as absent... }
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { madeAfter, recordIssuedAt } from '../auth/credential-age.js';
import { isPortfolioTarget } from './app-origin-target.js';

/** The author account name an app target `<author>/<file>` names, or null for any other target. */
export function authorAccountOf(app: string): string | null {
  if (!app || isPortfolioTarget(app)) return null;
  const slash = app.indexOf('/');
  return slash > 0 ? app.slice(0, slash) : null;
}

/**
 * True when the account that holds the grant's author name now was created after the grant: the
 * grant was given to a previous holder's app. False when the author account is older, when no
 * account holds the name (there is no new author to hand anything to), and for a target that names
 * no author. `authors` caches the author records across calls, for a caller that checks a list.
 */
export async function grantGivenToEarlierAuthor(
  storage: Pick<Storage, 'getOwner'>,
  grant: Pick<AppGrantRecord, 'app' | 'createdAt'>,
  authors: Map<string, string | null> = new Map(),
): Promise<boolean> {
  const author = authorAccountOf(grant.app);
  if (!author) return false;
  if (!authors.has(author)) authors.set(author, (await storage.getOwner(author))?.createdAt ?? null);
  const authorCreatedAt = authors.get(author);
  return !!authorCreatedAt && madeAfter(authorCreatedAt, recordIssuedAt(grant.createdAt));
}

/**
 * The grantee's live grant for `app`, as getAppGrantByOwnerAndApp answers it, except that a grant
 * given to an earlier holder's app is revoked here and answered as absent. Revoking it (rather than
 * only skipping it) ends the access tokens minted from it, keeps it off the Access page, and lets
 * the next consent create a fresh grant instead of reusing the old row and its old creation time.
 */
export async function liveAppGrantFor(
  storage: Pick<Storage, 'getOwner' | 'getAppGrantByOwnerAndApp' | 'updateAppGrant'>,
  owner: string, app: string,
): Promise<AppGrantRecord | null> {
  const grant = await storage.getAppGrantByOwnerAndApp(owner, app);
  if (!grant || !(await grantGivenToEarlierAuthor(storage, grant))) return grant;
  await storage.updateAppGrant(grant.grantId, { revoked: true, refreshTokenHash: null });
  return null;
}

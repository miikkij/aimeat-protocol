/**
 * @file src/auth/credential-age.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule that a credential is no older than what it acts for, in one place.
 *
 *   An account name is released for reuse when the account is deleted, and every credential names
 *   the account it acts for by that name: an owner session and every token minted for an agent, an
 *   MCP client, an app grant or an ecosystem app, and a personal access token. So a credential counts
 *   only while an account holds the name, the account is not deactivated (BR-04), and the account is
 *   not newer than the credential. An account made after the credential was issued holds a name
 *   released by an earlier account, and the credential was that earlier account's.
 *
 *   TIME. A token minted from this release on carries its issue time in milliseconds (`iat_ms`,
 *   auth/jwt.ts issueJWT), and a stored credential (a session row, a grant, a PAT) has its own
 *   creation time, exact to the millisecond. A token minted before this release carries only `iat`,
 *   in whole seconds, and is compared in whole seconds, so a token issued in the same second as its
 *   account keeps working.
 *
 *   Who calls it: auth/middleware.ts credentialRevoked (every JWT, with one read of the account),
 *   services/access-token.ts resolvePat, services/owner-session.ts refreshOwnerSession, and the app
 *   grant refresh in routes/app-grants.ts, which mint from a stored credential.
 * @structure
 *   - IssuedAt: when a credential was issued, and whether that is exact to the millisecond
 *   - tokenIssuedAt(verified): from `iat_ms`, else from `iat`
 *   - recordIssuedAt(iso): from a stored credential's own creation time
 *   - madeAfter(createdAt, issued): was a record made after the credential?
 *   - ownerRefuses(owner, issued): the rule, on an owner record already read
 * @usage
 *   const owner = await storage.getOwner(verified.owner);
 *   if (ownerRefuses(owner, tokenIssuedAt(verified))) return true;
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: a credential counts only while the account it acts for exists and
 *     is not newer than the credential, to the millisecond where the credential says so.
 */
import type { OwnerRecord } from '../storage/interface.js';

/** When a credential was issued, in milliseconds, and whether that time is exact to the millisecond. */
export interface IssuedAt {
  ms: number;
  exact: boolean;
}

/** A verified token's issue time: `iat_ms` when the token carries it, else `iat` in whole seconds. */
export function tokenIssuedAt(verified: { iat?: number; iatMs?: number }): IssuedAt | null {
  if (typeof verified.iatMs === 'number' && Number.isFinite(verified.iatMs)) return { ms: verified.iatMs, exact: true };
  if (typeof verified.iat === 'number' && Number.isFinite(verified.iat)) return { ms: verified.iat * 1000, exact: false };
  return null;
}

/** A stored credential's creation time (a session row, an app grant, a PAT), exact to the millisecond. */
export function recordIssuedAt(iso: string | undefined | null): IssuedAt | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? { ms, exact: true } : null;
}

/**
 * Was a record made after the credential was issued? To the millisecond when the issue time is exact,
 * in whole seconds otherwise. A time that cannot be read answers no, so the rule never refuses on a
 * value it could not compare.
 */
export function madeAfter(createdAt: string | undefined | null, issued: IssuedAt | null): boolean {
  if (!issued) return false;
  const made = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(made)) return false;
  return issued.exact ? made > issued.ms : Math.floor(made / 1000) > Math.floor(issued.ms / 1000);
}

/**
 * Does the account a credential names refuse it? Yes when no account holds the name, when the
 * account is deactivated (BR-04), and when the account was made after the credential was issued.
 * The caller reads the owner record, so a caller that already holds it pays no second read.
 */
export function ownerRefuses(owner: Pick<OwnerRecord, 'createdAt' | 'disabledAt'> | null | undefined, issued: IssuedAt | null): boolean {
  return !owner || !!owner.disabledAt || madeAfter(owner.createdAt, issued);
}

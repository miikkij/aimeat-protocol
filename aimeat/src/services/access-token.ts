/**
 * @file access-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared resolution for owner-created Personal Access Tokens (PATs). Maps a
 *   raw token to the identity + roles it grants (revoked/expired checked, roles re-read from
 *   the owner's CURRENT roles so a token never grants more than the owner holds). Used by the
 *   auth middleware (Bearer header), the exchange endpoint, and the PAT-backed refresh cookie.
 * @structure PAT_PREFIX; ResolvedPat; resolvePat(storage, rawToken).
 * @usage import { resolvePat, PAT_PREFIX } from '../services/access-token.js'
 * @version-history
 * v1.2.1 - 2026-10-05 - The account's operator role is read with isOperatorAccount (secaudit 2026-10, C2).
 * v1.2.0 - 2026-09-26 - A PAT made before the account that now holds its owner name resolves to null,
 *   as one of a deleted or deactivated account does (auth/credential-age.ts ownerRefuses).
 * v1.1.0 - 2026-08-23 - A deactivated owner's PATs resolve to null (BR-04); the owner record was
 *   already read here, so the check costs nothing extra per request.
 * v1.0.0 - 2026-06-03 - Initial (plan 2026-06-03-agent-access-tokens).
 */
import type { Storage } from '../storage/interface.js';
import { hashToken } from './owner-session.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { ownerRefuses, recordIssuedAt } from '../auth/credential-age.js';

/** Raw PATs carry this prefix so they're distinguishable from JWTs / session tokens. */
export const PAT_PREFIX = 'aimeat_pat_';

export interface ResolvedPat {
  patId: string;
  sub: string;        // JWT subject: owner name (owner/operator) or the scoped test GAII
  owner: string;      // owning GHII owner name
  roles: string[];    // ['agent'] | ['owner'] | ['owner','operator']
  scopes: string[];   // enforced scopes (agent level); [] for owner/operator
  expiresAt: string | null;
}

/**
 * Resolve a raw PAT to its granted identity, or null if missing / revoked / expired / the
 * owner no longer exists. Pure: callers decide whether to record usage (touchPat).
 */
export async function resolvePat(storage: Storage, rawToken: string): Promise<ResolvedPat | null> {
  const pat = await storage.getPatByHash(hashToken(rawToken));
  if (!pat) return null;
  if (pat.expiresAt && Date.now() >= Date.parse(pat.expiresAt)) return null;
  const ownerRecord = await storage.getOwner(pat.owner);
  // A PAT answers like a revoked one when no account holds its owner name, when the account is
  // deactivated (BR-04), and when the account was made after the PAT: the name was released and
  // registered again, and the PAT was the earlier account's (auth/credential-age.ts). The owner
  // record is read here anyway, so this check adds no read to the PAT code path.
  if (!ownerRecord || ownerRefuses(ownerRecord, recordIssuedAt(pat.createdAt))) return null;

  let sub: string;
  let roles: string[];
  let scopes: string[];
  if (pat.grantOperator) {
    sub = pat.owner;
    roles = isOperatorAccount(ownerRecord) ? ['owner', 'operator'] : ['owner'];
    scopes = [];
  } else if (pat.grantOwner) {
    sub = pat.owner;
    roles = ['owner'];
    scopes = [];
  } else {
    sub = pat.gaii;
    roles = ['agent'];
    scopes = pat.scopes;
  }

  return { patId: pat.id, sub, owner: pat.owner, roles, scopes, expiresAt: pat.expiresAt };
}

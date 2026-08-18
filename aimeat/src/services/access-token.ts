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
 * v1.0.0 - 2026-06-03 - Initial (plan 2026-06-03-agent-access-tokens).
 */
import type { Storage } from '../storage/interface.js';
import { hashToken } from './owner-session.js';

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
  if (!ownerRecord) return null;

  let sub: string;
  let roles: string[];
  let scopes: string[];
  if (pat.grantOperator) {
    sub = pat.owner;
    roles = ownerRecord.roles.includes('operator') ? ['owner', 'operator'] : ['owner'];
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

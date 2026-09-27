/**
 * @file src/storage/providers/postgres-kysely/ghii-resolve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one resolver from any principal to the GHII whose balance it spends, for the
 *   Postgres backend. Moved out of methods/wallet.ts by pure extraction so the owner cascade can give
 *   an erased person's requesters their held morsels back through the resolver that took them,
 *   without an import cycle through the provider class (wallet.ts imports it back).
 * @structure resolveGhii(db, identity)
 * @usage import { resolveGhii } from '../ghii-resolve.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Extracted from methods/wallet.ts, body unchanged.
 */
import type { Kysely } from 'kysely';
import type { DB } from './db-types.js';

/**
 * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier. All balance operations go
 * through GHII — agents/ecosystem-apps don't hold their own balance. Mirrors the SQLite provider's resolver.
 */
export async function resolveGhii(db: Kysely<DB>, identity: string): Promise<string | null> {
  // GHII format: owner@node (no #) — already a GHII.
  if (!identity.includes('#') && identity.includes('@')) return identity;
  // GAII format: agent#owner@node → extract owner → lookup GHII by username.
  let owner = identity;
  if (identity.includes('#')) {
    const hashIdx = identity.indexOf('#');
    const atIdx = identity.lastIndexOf('@');
    if (atIdx <= hashIdx) return null;
    owner = identity.slice(hashIdx + 1, atIdx);
  }
  const row = await db.selectFrom('Ghii').select('ghii').where('username', '=', owner).executeTakeFirst();
  return row?.ghii ?? null;
}

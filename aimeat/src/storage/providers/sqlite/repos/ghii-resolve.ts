/**
 * @file src/storage/providers/sqlite/repos/ghii-resolve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one resolver from any principal to the GHII whose balance it spends, for the SQLite
 *   backend. Moved out of methods/agents.ts (resolveGhii, which now calls it) by pure extraction, so
 *   the boot migration in schema-identity-backfill.ts gives held morsels back through the resolver
 *   that took them. It runs before a provider instance exists, so it cannot call the method.
 * @structure resolveGhiiIn(db, identity)
 * @usage import { resolveGhiiIn } from '../repos/ghii-resolve.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Extracted from methods/agents.ts, body unchanged.
 */
import type Database from 'better-sqlite3';

/**
 * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
 * All balance operations go through GHII — agents don't have their own balance.
 */
export function resolveGhiiIn(db: Database.Database, identity: string): string | null {
  // GHII format: owner@node (no #)
  if (!identity.includes('#') && identity.includes('@')) return identity;
  // GAII format: agent#owner@node → extract owner → lookup GHII
  if (identity.includes('#')) {
    const hashIdx = identity.indexOf('#');
    const atIdx = identity.lastIndexOf('@');
    if (atIdx > hashIdx) {
      const owner = identity.slice(hashIdx + 1, atIdx);
      const row = db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(owner) as { ghii: string } | undefined;
      return row?.ghii ?? null;
    }
  }
  // Bare owner name → lookup GHII
  const row = db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(identity) as { ghii: string } | undefined;
  return row?.ghii ?? null;
}

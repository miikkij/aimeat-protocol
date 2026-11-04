/**
 * @file src/storage/memory-totals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a principal's kept memory totals count (storage.getMemoryTotals; codebase
 *   analysis 2026-11-03, item C3), in one place for both providers and for services/memory-ceilings.ts.
 *
 *   The totals are kept by the database itself, by triggers on the memory table: PostgreSQL migration
 *   0125_memory_totals.sql and SQLite schema-memory-totals.ts. A trigger sees every statement that
 *   changes a row, the bin, the archive, the TTL sweep and the owner cascade included, in the same
 *   transaction, so the totals cannot drift from the rows the way a count kept by each caller would.
 *
 *   `keys` is what countMemory([owner], { excludePrefixes: MEMORY_COUNT_EXCLUDED_PREFIXES }) answers:
 *   rows not in the bin, not archived, outside the excluded prefixes. `bytes` is what sumMemoryBytes
 *   answers on the same provider (PostgreSQL: rows not archived; SQLite: every row).
 *
 *   The PostgreSQL migration names these prefixes as literals, because a migration file never changes
 *   once it is on main; test/unit/memory-totals.test.ts holds the two lists equal.
 * @structure MEMORY_COUNT_EXCLUDED_PREFIXES
 * @usage import { MEMORY_COUNT_EXCLUDED_PREFIXES } from '../storage/memory-totals.js';
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C3).
 */

/**
 * Key prefixes the node writes under an owner for parties with no account here, each record with its
 * own expiry (commerce/ucp-guest-checkout.ts, routes/ucp-checkout.ts). They are left out of the
 * owner's key count: an unsigned platform request must not fill the owner's own limit
 * (secaudit2026oct22).
 */
export const MEMORY_COUNT_EXCLUDED_PREFIXES: readonly string[] = ['commerce.ucp.idem.', 'commerce.ucp.session.'];

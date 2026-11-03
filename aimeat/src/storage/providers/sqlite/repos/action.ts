/**
 * @file src/storage/providers/sqlite/repos/action.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite (better-sqlite3) helpers for action records that methods/actions.ts calls: the
 *   stored pricing JSON read as an ActionRecord reads it, and one COUNT across many providers. The
 *   action CRUD itself lives in methods/actions.ts.
 *
 * @structure
 *   - readStoredActionPricing: the `pricing` JSON column, an old `baseMorsels` read as `tollMorsels`
 *   - countActionsForProviders: COUNT of actions across many provider GAIIs in one query
 *
 * @version-history
 *   v1.3.0 — 2026-11-04 — deserializeAction, createAction, getAction, listActions, deleteAction,
 *     listActionsByProvider and updateAction deleted: nothing imported them, and methods/actions.ts
 *     holds the live copies since M8 (codebase analysis 2026-11-03, item A15).
 *   v1.2.0 — 2026-10-11 — readStoredActionPricing: a stored `baseMorsels` reads as `tollMorsels`, the
 *     pacing amount (a morsel is pacing, not a price).
 *   v1.1.0 — 2026-09-09 — deleteActionsByProvider deleted: no caller.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { ActionRecord } from '../../../interface.js';

/**
 * The `pricing` JSON column as an ActionRecord reads it. A row written by 3.26.x carries
 * `baseMorsels`, the old morsel price; it is the action's pacing amount now (ruling
 * decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa), so it reads as `tollMorsels`.
 * No migration: the old key is translated on every read, and the next write stores the new one.
 */
export function readStoredActionPricing(json: string): ActionRecord['pricing'] {
  const raw = (JSON.parse(json) ?? {}) as { tollMorsels?: unknown; baseMorsels?: unknown; perUnit?: ActionRecord['pricing']['perUnit'] };
  const toll = typeof raw.tollMorsels === 'number' ? raw.tollMorsels : typeof raw.baseMorsels === 'number' ? raw.baseMorsels : 0;
  return raw.perUnit ? { tollMorsels: toll, perUnit: raw.perUnit } : { tollMorsels: toll };
}

/** COUNT of actions across MANY provider GAIIs in one query — the owner-scope "services used" figure
 *  for the usage summary (replaces one listActionsByProvider-then-.length per agent). */
export function countActionsForProviders(db: Database.Database, providerGaiis: string[]): number {
  if (providerGaiis.length === 0) return 0;
  const ph = providerGaiis.map(() => '?').join(',');
  const row = db.prepare(`SELECT COUNT(*) AS c FROM actions WHERE providerGaii IN (${ph})`).get(...providerGaiis) as { c: number };
  return row.c;
}

/**
 * @file src/storage/scope-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The equality a scope-list compare-and-swap tests (setAgentScopesIf,
 *   setEcosystemAppScopesIf, setAppGrantScopesIf): the stored list holds exactly the words the caller
 *   read, in the same order. An empty expected list also matches no stored list, because the readers
 *   of both providers map a missing list to "no words". The PostgreSQL provider states the same
 *   condition in SQL (postgres-kysely/helpers.ts scopeListIs); the SQLite provider reads the row and
 *   tests it here inside one immediate transaction.
 *
 *   floorListOf reads the agents.taskStartFloor column both providers store as TEXT holding a JSON
 *   list of scope words (migration 0115), so the two readers cannot disagree on a malformed value.
 * @structure sameScopeList(stored, expected) · floorListOf(column)
 * @usage if (!sameScopeList(JSON.parse(row.defaultScopes ?? 'null'), expected)) return false;
 * @version-history
 *   v1.1.0 — 2026-10-23 — floorListOf, the one reader of agents.taskStartFloor.
 *   v1.0.0 — 2026-10-18 — Initial (check:atomic-writes, boot migrations).
 */
import { logger } from '../utils/logger.js';

/** The scope words a stored agents.taskStartFloor holds; undefined for none or for anything that is not a list of words. */
export function floorListOf(column: unknown): string[] | undefined {
  if (typeof column !== 'string' || !column) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(column); } catch (err) {
    // No acceptance is the safe reading: the floor then holds the agent, as it did before 0115.
    logger.warn('agents.taskStartFloor is not JSON; read as none accepted', { err: String(err) });
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const words = parsed.filter((w): w is string => typeof w === 'string' && w.length > 0);
  return words.length ? words : undefined;
}

/** True when `stored` is the list `expected` names, word for word; an empty `expected` also matches none. */
export function sameScopeList(stored: readonly string[] | null | undefined, expected: readonly string[]): boolean {
  if (!Array.isArray(stored)) return expected.length === 0;
  return stored.length === expected.length && stored.every((w, i) => w === expected[i]);
}

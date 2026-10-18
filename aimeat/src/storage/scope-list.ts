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
 * @structure sameScopeList(stored, expected)
 * @usage if (!sameScopeList(JSON.parse(row.defaultScopes ?? 'null'), expected)) return false;
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (check:atomic-writes, boot migrations).
 */

/** True when `stored` is the list `expected` names, word for word; an empty `expected` also matches none. */
export function sameScopeList(stored: readonly string[] | null | undefined, expected: readonly string[]): boolean {
  if (!Array.isArray(stored)) return expected.length === 0;
  return stored.length === expected.length && stored.every((w, i) => w === expected[i]);
}

/**
 * @file src/storage/key-prefix.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One meaning for "the keys that start with this prefix", on both storage providers.
 *   A prefix is a literal string compared with regard to case. `LIKE prefix%` is not that: `_` and
 *   `%` inside the prefix are wildcards on both backends, and SQLite's LIKE ignores ASCII case. So a
 *   subtree delete of `a_b` also removed `aXb.*`, and on SQLite a listing of `Notes.` returned
 *   `notes.*` while PostgreSQL returned nothing for the same call (QA audit D4-07).
 *
 *   PostgreSQL: LIKE is case-sensitive and its default escape character is the backslash, so the
 *   prefix is escaped and LIKE keeps doing the work.
 *   SQLite: GLOB is case-sensitive and, unlike LIKE, can use the key index under the default BINARY
 *   collation. GLOB's own wildcards (`*`, `?`, `[`) are escaped by putting each in a bracket.
 * @structure likePrefix · globPrefix
 * @usage q.where('key', 'like', likePrefix(prefix)) on PostgreSQL; `key GLOB ?` with globPrefix(prefix) on SQLite.
 * @version-history
 *   2026-10-16 — Initial: the prefix helper both providers' memory methods use (QA audit D4-07).
 */

/** A PostgreSQL LIKE pattern that matches exactly the strings starting with `prefix`. */
export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

/** A SQLite GLOB pattern that matches exactly the strings starting with `prefix`, with regard to case. */
export function globPrefix(prefix: string): string {
  return `${prefix.replace(/[*?[]/g, m => `[${m}]`)}*`;
}

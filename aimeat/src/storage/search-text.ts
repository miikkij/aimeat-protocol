/**
 * @file src/storage/search-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text a memory record is found by, written once for both storage providers.
 *
 *   ONE RULE FOR BOTH BACKENDS. A search finds a record by its key, its tags and the scalar VALUES
 *   inside it, to six levels deep. Field names are not searched: `{"status": "open"}` is found by
 *   "open" and not by "status". This is the rule the PostgreSQL provider (production) has applied
 *   since 2026-07-15 through its `searchBlob` column. The SQLite provider indexed the raw JSON text,
 *   field names included, at any depth, so the same query answered differently on the two backends
 *   (feature-list audit #52). Both now index what this module produces.
 *
 *   The match is word-start on every caller (PostgreSQL `to_tsquery('simple', 'tok:*')`, SQLite FTS5
 *   `tok*`): a query token matches a word in the text that begins with it.
 * @structure
 *   - SEARCH_VALUE_DEPTH — how deep the value walk goes
 *   - searchValueText(value) — the scalar values, space-joined
 *   - buildSearchBlob(record) — key, key segments, tags and the values (the PostgreSQL column)
 * @usage
 *   import { buildSearchBlob, searchValueText } from '../../search-text.js';
 * @version-history
 *   2026-10-15 — Initial: buildSearchBlob moved here from providers/postgres-kysely/helpers.ts so the
 *     SQLite provider indexes the same text (feature-list audit #52).
 */
import type { MemoryRecord } from './interface.js';

/** The value walk stops below this depth: the top-level value is depth 0. */
export const SEARCH_VALUE_DEPTH = 6;

/** The scalar values inside a memory value (strings, numbers, booleans), depth ≤ 6, space-joined. */
export function searchValueText(value: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > SEARCH_VALUE_DEPTH || v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { parts.push(String(v)); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1); }
  };
  walk(value, 0);
  return parts.join(' ');
}

/** The FTS source text for a row: key + tags + the scalar values (depth ≤ 6), space-joined. The
 *  PostgreSQL GENERATED searchTsv column turns this into the tsvector. */
export function buildSearchBlob(record: MemoryRecord): string {
  // Include the key AND its punctuation-split segments so a dotted key like `search.findme` is findable
  // by `findme`: the Postgres tsvector keeps `search.findme` as one token, whereas SQLite FTS5 splits
  // on punctuation; emitting the segments matches its recall.
  const parts: string[] = [record.key, ...record.key.split(/[._:/\-\s]+/).filter(Boolean), ...(record.tags ?? [])];
  const values = searchValueText(record.value);
  if (values) parts.push(values);
  return parts.join(' ');
}

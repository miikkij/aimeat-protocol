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
 *   - searchableValue(key, value) — the value without the fields the read doors mask
 *   - searchValueText(value, key?) — the scalar values, space-joined
 *   - buildSearchBlob(record) — key, key segments, tags and the values (the PostgreSQL column)
 * @usage
 *   import { buildSearchBlob, searchValueText } from '../../search-text.js';
 * @version-history
 *   2026-10-27 — searchableValue(): a credential record (the keys services/secret-records.ts masks on
 *     every read door) gives no value text at all, so it is found by its key and segments only; its
 *     value had been indexed whole and a word-prefix hit or miss on its key recovered it
 *     (secaudit2026oct26, search-text.ts:searchableValue:secret-record-values-indexed).
 *   2026-10-25 — searchableValue(): the passwordHash and icsKeyHash of a workspace share record are left
 *     out of the search text on both backends, as every read door masks them (secaudit2026oct22).
 *   2026-10-15 — Initial: buildSearchBlob moved here from providers/postgres-kysely/helpers.ts so the
 *     SQLite provider indexes the same text (feature-list audit #52).
 */
import type { MemoryRecord } from './interface.js';

/** The value walk stops below this depth: the top-level value is depth 0. */
export const SEARCH_VALUE_DEPTH = 6;

/** A workspace's public-share record, the same pattern services/secret-records.ts masks on read. */
const WORKSPACE_SHARE_KEY_RE = /^organism\.[^.]+\.w\.[^.]+\.meta\.share$/;

/** The fields of a share record that no read door shows (services/secret-records.ts shownMemoryValue). */
const SHARE_SECRET_FIELDS = ['passwordHash', 'icsKeyHash'] as const;

/**
 * The credential records every generic read door shows only as configured: the same keys as
 * services/secret-records.ts isSecretRecordKey, spelled here because storage does not import a
 * service (check:deps). test/unit/search-text-credentials.test.ts holds the two lists equal.
 */
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set(['openrouter.apikey', 'decide.apikey', 'commerce.psp']);
const CREDENTIAL_KEY_PREFIXES: readonly string[] = ['openrouter.apikey.agent.', 'decide.apikey.agent.', 'decide.apikey.provider.', 'ai.apikey.'];

/** True for a key whose value holds a credential, which the search text leaves out entirely. */
export function isIndexedCredentialKey(key: unknown): boolean {
  return typeof key === 'string' && (CREDENTIAL_KEYS.has(key) || CREDENTIAL_KEY_PREFIXES.some(p => key.startsWith(p)));
}

/**
 * The value as the search text may read it. A field that every read door masks is left out: search
 * matches a word at its start, so a hit or a miss on a chosen prefix of an indexed hash recovers the
 * hash a character at a time, and a masked field is then readable through the index (secaudit2026oct22,
 * search-index-prefix-oracle-on-masked-fields). The record stays findable by its key and its other
 * values. Every other key's value is returned unchanged.
 */
export function searchableValue(key: string | undefined, value: unknown): unknown {
  if (isIndexedCredentialKey(key)) return null;
  if (!key || !WORKSPACE_SHARE_KEY_RE.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of SHARE_SECRET_FIELDS) delete rest[field];
  return rest;
}

/**
 * The scalar values inside a memory value (strings, numbers, booleans), depth ≤ 6, space-joined.
 * With `key`, a field the read doors mask for that key is left out (searchableValue).
 */
export function searchValueText(value: unknown, key?: string): string {
  value = searchableValue(key, value);
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
  const values = searchValueText(record.value, record.key);
  if (values) parts.push(values);
  return parts.join(' ');
}

/**
 * @file stable-json.ts
 * @description Canonical JSON serialization for order-independent equality checks.
 *   Object keys are sorted recursively; array element order is preserved. This is
 *   essential when comparing values that round-trip through a store that does not
 *   preserve object key insertion order — notably PostgreSQL `jsonb` columns (which
 *   normalize object key order but keep array order). MongoDB/BSON and SQLite JSON
 *   preserve insertion order, so a naive `JSON.stringify` compare passes there but
 *   fails on PostgreSQL; `stableStringify` makes the comparison backend-agnostic.
 * @structure stableStringify(value) — canonical JSON string; sortKeysDeep — internal.
 * @usage
 *   import { stableStringify } from '../utils/stable-json.js';
 *   if (stableStringify(a) === stableStringify(b)) { ...unchanged... }
 * @version-history
 *   v1.0.0 — 2026-06-05 — Initial helper (fixes PostgreSQL jsonb key-order false-diffs).
 */

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep); // preserve array order
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeysDeep(obj[k]);
      return acc;
    }, {});
  }
  return value;
}

/**
 * JSON.stringify with object keys sorted recursively (array order preserved), so two
 * structurally-equal values produce the same string regardless of object key order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

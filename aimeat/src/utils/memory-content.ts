/**
 * @file src/utils/memory-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content bytes a memory provenance record describes, shared across transports.
 *
 *   CANONICAL, BECAUSE POSTGRES REORDERS KEYS. A memory value that is not a string is stored as JSONB
 *   on Postgres, and JSONB keeps object keys in its own order (shorter keys first), not in the order
 *   the writer sent them. The record's hash was taken of JSON.stringify(value) as written, so a
 *   reader who hashed the value it read back got different bytes and the by-hash lookup found
 *   nothing, and an export restored on the same node failed the import check and lost its record.
 *   memoryContentBytes() now serialises with the object keys sorted at every level (the RFC 8785
 *   ordering; numbers and strings as JSON.stringify writes them), which is the same whatever order
 *   a store hands the keys back in. A string value is its own bytes, as before.
 *
 *   OLD RECORDS KEEP WORKING. Records minted before the change carry the hash of
 *   legacyMemoryContentBytes(). A check that compares a value with a stored hash asks
 *   memoryContentHashes(), which gives both, and accepts a match on either.
 * @structure memoryContentBytes · legacyMemoryContentBytes · canonicalJson · memoryContentHashes ·
 *   documentContentBytes
 * @version-history
 *   v1.2.0 -- 2026-10-08 -- documentContentBytes(): a workspace document's record describes its
 *     markdown, the text a reader is served, not the stored {title, markdown} object (aiprov E13).
 *   v1.1.0 -- 2026-10-08 -- memoryContentBytes() serialises a non-string value canonically (sorted
 *     object keys); legacyMemoryContentBytes() and memoryContentHashes() keep the records minted
 *     before this matchable (aiprov E4).
 *   v1.0.0 -- 2026-09-27 -- Pure extraction from the memory route helpers.
 */
import { createHash } from 'node:crypto';

/**
 * JSON with the keys of every object sorted by UTF-16 code unit, the RFC 8785 order. Values that
 * JSON cannot hold are dropped from an object and written as null in an array, as JSON.stringify
 * does, so a value read back from either store serialises to the same bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const plain = JSON.stringify(value);
    return plain === undefined ? 'null' : plain;
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => {
      const s = canonicalJsonMember(item);
      return s === undefined ? 'null' : s;
    }).join(',')}]`;
  }
  // A Date, or anything else with its own JSON form, is written the way JSON.stringify writes it.
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') return canonicalJson(withJson.toJSON());
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const s = canonicalJsonMember(obj[k]);
    if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
  }
  return `{${parts.join(',')}}`;
}

/** One member's JSON, or undefined for a value JSON leaves out (undefined, a function, a symbol). */
function canonicalJsonMember(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  return canonicalJson(value);
}

/** The bytes a NEW memory provenance record describes: a string as itself, anything else canonical. */
export function memoryContentBytes(value: unknown): string {
  return typeof value === 'string' ? value : canonicalJson(value ?? null);
}

/** The bytes a record minted before 2026-10-08 describes: JSON.stringify of the value as written. */
export function legacyMemoryContentBytes(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

/**
 * Every hash a stored record about this value may carry: the canonical one and the legacy one
 * (the same string for a string value, a scalar or a value whose keys were already in order).
 * A check that compares a value with a record accepts a match on any of them.
 */
export function memoryContentHashes(value: unknown): string[] {
  const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return [...new Set([hash(memoryContentBytes(value)), hash(legacyMemoryContentBytes(value))])];
}

/**
 * The bytes a workspace DOCUMENT's record describes: its markdown, which is what every reader of a
 * document is served (the public share, the workspace read, the in-place edit tools). The stored
 * value is `{ title, markdown }`, and a record about that object could never be found by a reader
 * hashing the page they were given. Anything that is not a document with markdown falls back to
 * memoryContentBytes().
 */
export function documentContentBytes(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const markdown = (value as { markdown?: unknown }).markdown;
    if (typeof markdown === 'string') return markdown;
  }
  return memoryContentBytes(value);
}

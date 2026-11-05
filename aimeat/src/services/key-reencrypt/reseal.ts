/**
 * @file src/services/key-reencrypt/reseal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One stored value, sealed again with the current data key: what the re-encrypt job does
 *   to each value it finds (services/key-reencrypt/job.ts).
 *
 *   A value is under the current key when the key id it names (services/encryption.ts sealedKeyIdOf)
 *   is the ring's current key; it is left as it is. A value under another key is opened with the ring
 *   and sealed again with the current key, keeping its form: a bound value stays bound to the same
 *   context, an unbound one stays unbound. A value that does not open is UNREADABLE: it is never
 *   written over and never deleted, only counted, so the operator can decide about it while the key
 *   that may open it is still at hand. Anything that is not a sealed value of the data key is left
 *   alone and not counted.
 * @structure Tally · emptyTally · addTally · Resealed · resealString · count · ContextAt · resealTree
 * @usage
 *   const r = resealString(stored, key, context);   // 'current' | 'moved' (next) | 'unreadable' | 'not-sealed'
 *   const { value, changed } = resealTree(record.value, key, path => contextFor(path), tally);
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { decrypt, decryptBound, encrypt, encryptBound, isBoundCiphertext, keyRingOf, sealedKeyIdOf } from '../encryption.js';

/** What a pass found: values already under the current key, values it moved, values that did not open. */
export interface Tally { current: number; moved: number; unreadable: number }

export const emptyTally = (): Tally => ({ current: 0, moved: 0, unreadable: 0 });

export function addTally(into: Tally, t: Tally): Tally {
  into.current += t.current; into.moved += t.moved; into.unreadable += t.unreadable;
  return into;
}

/** `failure` is why a value did not open: a bound value found where no context is known, or the tag check. */
export type Resealed = { kind: 'not-sealed' } | { kind: 'current' } | { kind: 'moved'; next: string } | { kind: 'unreadable'; failure?: unknown };

/**
 * `value` sealed again with `key` (the ring's current key) when another key sealed it. `context` is
 * the context a bound value was sealed for; null where the place has none, and a bound value found
 * there counts as unreadable.
 */
export function resealString(value: unknown, key: Buffer, context: string | null): Resealed {
  const kid = sealedKeyIdOf(value);
  if (kid === null) return { kind: 'not-sealed' };
  if (kid === keyRingOf(key).current) return { kind: 'current' };
  const sealed = value as string;
  try {
    if (isBoundCiphertext(sealed)) {
      if (context === null) return { kind: 'unreadable' };
      return { kind: 'moved', next: encryptBound(decryptBound(sealed, key, context), key, context) };
    }
    return { kind: 'moved', next: encrypt(decrypt(sealed, key), key) };
  } catch (err) {
    // A value that opens with no key of the ring is the answer: it is counted as unreadable and left as it is.
    return { kind: 'unreadable', failure: err };
  }
}

/** Count one outcome. */
export function count(t: Tally, r: Resealed): void {
  if (r.kind === 'current') t.current++;
  else if (r.kind === 'moved') t.moved++;
  else if (r.kind === 'unreadable') t.unreadable++;
}

/** The context of the string at `path` inside a stored value, or null when it has none. */
export type ContextAt = (path: ReadonlyArray<string | number>) => string | null;

/**
 * Every sealed string inside `value` sealed again, in a copy; `changed` says whether any moved. The
 * walk stops at a depth no stored secret reaches, and leaves everything that is not a string as it is.
 */
export function resealTree(value: unknown, key: Buffer, contextAt: ContextAt, tally: Tally): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown, path: Array<string | number>, depth: number): unknown => {
    if (typeof v === 'string') {
      const r = resealString(v, key, contextAt(path));
      count(tally, r);
      if (r.kind === 'moved') { changed = true; return r.next; }
      return v;
    }
    if (depth > 12 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i], depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, [...path, k], depth + 1);
    return out;
  };
  const next = walk(value, [], 0);
  return { value: changed ? next : value, changed };
}

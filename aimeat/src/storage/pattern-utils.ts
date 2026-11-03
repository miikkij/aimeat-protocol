/**
 * @file pattern-utils.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Glob-style pattern matchers used across schema locking, consent, and federation.
 * @structure
 *   - matchWildcardPattern() — dot-segment matcher for schema key patterns
 *   - globMatchSimple() — plain-string glob (node IDs, domain names)
 *   - consentMatchPattern() — consent dataPattern matcher (dot AND slash structural separators)
 * @usage
 *   import { consentMatchPattern } from '../storage/pattern-utils.js';
 * @version-history
 *   v1.3.1 -- 2026-11-03 -- consentMatchPattern answers false for a pattern or key that is not a string,
 *     before it sizes anything by key.length (CodeQL js/loop-bound-injection, alert 1776).
 *   v1.3.0 -- 2026-10-31 -- consentMatchPattern evaluates the same pattern meaning as a set of
 *     reachable key positions instead of a compiled RegExp, so a pattern with many '**' segments ends
 *     in bounded time (secaudit2026oct31w2 round 10). Every pattern matches the same keys as before.
 *   v1.2.0 -- 2026-08-10 -- matchWildcardPattern understands a trailing '*' glued to a prefix
 *     ('chart:*'), which is how every cortex manifest writes a schema key_pattern. It split on '.'
 *     only, so those patterns matched nothing and every schema a cortex pack declared validated
 *     nothing — silently, because an unmatched schema means the write simply goes through.
 *   v1.1.0 -- 2026-06-07 -- consentMatchPattern is now slash-aware (G13): '.' and '/' are both
 *     literal structural separators, '*' = one segment (spans neither), so slash-keyed grants
 *     like 'packages/{id}/*' and 'storage:images/*' resolve. Strictly non-widening vs v1.0.0.
 */

/**
 * Wildcard pattern matching for schema key patterns.
 * Supports '*' (one segment), '**' (rest of key), and a trailing '*' glued to a prefix.
 * Example: 'profile.*.interests' matches 'profile.alice.interests'
 *          'iot.**' matches 'iot.temperature.living-room'
 *          'chart:*' matches 'chart:sales-2026'
 */
export function matchWildcardPattern(pattern: string, key: string): boolean {
  // A trailing '*' that is NOT its own dot-segment — 'chart:*', 'recipe:*', 'drawing:*'. Every
  // cortex manifest has written schema key_pattern this way since the first pack, and the segment
  // walk below cannot express it: splitting on '.' leaves 'chart:*' as a single part that equals
  // no key, so the pattern matched nothing and the schema it carried validated nothing. Handled
  // here as a literal prefix. The guard is deliberately narrow — the '*' must be the only one and
  // the last character, and must not follow a '.' — so every dot-form ('profile.*', 'iot.**',
  // 'profile.*.interests') still goes through the walk unchanged.
  const star = pattern.indexOf('*');
  if (star > 0 && star === pattern.length - 1 && pattern[star - 1] !== '.') {
    return key.startsWith(pattern.slice(0, -1));
  }

  const patternParts = pattern.split('.');
  const keyParts = key.split('.');

  let pi = 0, ki = 0;
  while (pi < patternParts.length && ki < keyParts.length) {
    if (patternParts[pi] === '**') {
      return true;
    }
    if (patternParts[pi] === '*') {
      pi++;
      ki++;
      continue;
    }
    if (patternParts[pi] !== keyParts[ki]) {
      return false;
    }
    pi++;
    ki++;
  }
  return pi === patternParts.length && ki === keyParts.length;
}

/**
 * Simple glob matching for plain strings (e.g. node IDs, domain names).
 * Supports '*' as a wildcard matching any characters.
 * Example: '*.health-network.fi' matches 'clinic.health-network.fi'
 *          'aimeat-*-001-*' matches 'aimeat-fi-001-genesis'
 */
export function globMatchSimple(pattern: string, value: string): boolean {
  const regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regex}$`).test(value);
}

/**
 * Glob pattern matching for consent data patterns.
 *
 * BOTH `.` and `/` are treated as literal structural separators that must match exactly
 * and are NOT interchangeable (so `a.*` matches `a.b` but never `a/b`). Wildcards:
 *   - `*`  → exactly one segment, spanning neither `.` nor `/`  (regex `[^./]+`)
 *   - `**` → the rest of the key, including separators            (regex `.*`)
 * Any other character is escaped to a literal.
 *
 * This makes slash-keyed grants resolve — e.g. `packages/{id}/*` matches
 * `packages/{id}/manifest`, and `storage:images/*` matches `storage:images/a.png`.
 *
 * Non-widening vs the prior dot-only matcher: separators stay literal and `*` is narrower
 * (`[^./]+` ⊂ the old `[^.]+`), so no pattern matches a key it did not match before.
 */
export function consentMatchPattern(pattern: string, key: string): boolean {
  // The meaning is the anchored RegExp the tokens used to compile to ('**' -> '.*', '*' -> '[^./]+',
  // anything else literal). It is evaluated as a set of reachable key positions, one token at a
  // time, so a pattern with many '**' segments costs O(pattern length * key length) instead of
  // backtracking through every placement of the separators (secaudit2026oct31w2 round 10).
  // Strings only: the position table is sized by key.length, and a value parsed from JSON may be an
  // object whose length is whatever its sender wrote (CodeQL js/loop-bound-injection, alert 1776).
  if (typeof pattern !== 'string' || typeof key !== 'string') return false;
  const n = key.length;
  let cur = new Uint8Array(n + 1);
  cur[0] = 1;
  for (const tok of pattern.split(/([./])/)) { // keep '.' and '/' as their own tokens
    const next = new Uint8Array(n + 1);
    let any = false;
    if (tok === '**') {
      // '.*' without the s flag: any run of code units that holds no line terminator, empty included.
      let run = false;
      for (let q = 0; q <= n; q++) {
        if (cur[q]) run = true;
        if (run) { next[q] = 1; any = true; }
        if (q < n && isLineTerminator(key.charCodeAt(q))) run = false;
      }
    } else if (tok === '*') {
      // '[^./]+': one or more code units, none of them '.' or '/'.
      let run = false;
      for (let q = 0; q < n; q++) {
        const c = key.charCodeAt(q);
        if (c === 0x2e || c === 0x2f) { run = false; continue; }
        if (cur[q]) run = true;
        if (run) { next[q + 1] = 1; any = true; }
      }
    } else {
      const len = tok.length;
      for (let p = 0; p + len <= n; p++) {
        if (cur[p] && key.startsWith(tok, p)) { next[p + len] = 1; any = true; }
      }
    }
    if (!any) return false;
    cur = next;
  }
  return cur[n] === 1;
}

/** The code units JavaScript's '.' does not match without the s flag. */
function isLineTerminator(c: number): boolean {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

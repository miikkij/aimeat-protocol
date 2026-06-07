/**
 * @file pattern-utils.ts
 * @description Glob-style pattern matchers used across schema locking, consent, and federation.
 * @structure
 *   - matchWildcardPattern() — dot-segment matcher for schema key patterns
 *   - globMatchSimple() — plain-string glob (node IDs, domain names)
 *   - consentMatchPattern() — consent dataPattern matcher (dot AND slash structural separators)
 * @usage
 *   import { consentMatchPattern } from '../storage/pattern-utils.js';
 * @version-history
 *   v1.1.0 -- 2026-06-07 -- consentMatchPattern is now slash-aware (G13): '.' and '/' are both
 *     literal structural separators, '*' = one segment (spans neither), so slash-keyed grants
 *     like 'packages/{id}/*' and 'storage:images/*' resolve. Strictly non-widening vs v1.0.0.
 */

/**
 * Wildcard pattern matching for schema key patterns.
 * Supports '*' (one segment) and '**' (rest of key).
 * Example: 'profile.*.interests' matches 'profile.alice.interests'
 *          'iot.**' matches 'iot.temperature.living-room'
 */
export function matchWildcardPattern(pattern: string, key: string): boolean {
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
  const regex = pattern
    .split(/([./])/) // keep '.' and '/' as their own tokens
    .map(tok => {
      if (tok === '**') return '.*';
      if (tok === '*') return '[^./]+';
      if (tok === '.') return '\\.';
      if (tok === '/') return '/';
      return tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${regex}$`).test(key);
}

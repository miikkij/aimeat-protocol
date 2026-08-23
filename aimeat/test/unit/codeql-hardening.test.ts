/**
 * @file codeql-hardening.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure helpers introduced to close the 2026-08-23 CodeQL findings: the shared,
 *   length-capped email validator (js/polynomial-redos) and the iterative depth guard used before
 *   schema validation (js/resource-exhaustion-from-deep-object-traversal). Each is tested at the
 *   boundary the finding was about — an over-length value and an over-deep value.
 * @usage cd aimeat && pnpm exec vitest run test/unit/codeql-hardening.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { isValidEmail, EMAIL_MAX_LENGTH } from '../../src/utils/email-validator.js';
import { exceedsMaxDepth } from '../../src/services/schema-validator.js';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });
  it('trims before checking', () => {
    expect(isValidEmail('  bob@example.org  ')).toBe(true);
  });
  it('rejects a non-string', () => {
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(['a@b.c'])).toBe(false);
  });
  it('rejects an empty or shapeless value', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
  it('rejects anything past the RFC length cap BEFORE the regex can backtrack', () => {
    // The ReDoS payload shape: a long local part with no valid domain. The length cap short-circuits
    // it; this must return fast and false rather than chew through the regex.
    const huge = 'a'.repeat(EMAIL_MAX_LENGTH + 100) + '@';
    const started = Date.now();
    expect(isValidEmail(huge)).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe('exceedsMaxDepth', () => {
  it('is false for shallow values', () => {
    expect(exceedsMaxDepth({ a: { b: { c: 1 } } }, 64)).toBe(false);
    expect(exceedsMaxDepth([1, [2, [3]]], 64)).toBe(false);
    expect(exceedsMaxDepth('scalar', 64)).toBe(false);
    expect(exceedsMaxDepth(null, 64)).toBe(false);
  });
  it('is true past the limit, without itself recursing (deep input does not overflow the check)', () => {
    // Build a 5000-deep nested object iteratively — deeper than any real record, and deep enough that
    // a recursive checker would overflow. The iterative check must simply return true.
    let deep: unknown = 0;
    for (let i = 0; i < 5000; i++) deep = { next: deep };
    expect(exceedsMaxDepth(deep, 64)).toBe(true);
  });
});

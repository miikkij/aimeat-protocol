/**
 * @file test/unit/regex-literal.test.ts
 * @description Unit tests for src/utils/regex-literal.ts.
 *
 *   The case that matters is the backslash, because it is the one both hand-written escapes this
 *   replaced had missed: one escaped `-` and one escaped `$` (CodeQL js/incomplete-sanitization,
 *   alerts 1640 and 1644). A backslash left alone does not stay a backslash — it turns the next
 *   character into an escape sequence, so the pattern matches something the caller never asked
 *   about, or fails to compile and throws inside a check that was counting class names.
 * @usage cd aimeat && pnpm test -- regex-literal
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial, with the helper.
 */
import { describe, it, expect } from 'vitest';
import { regexLiteral } from '../../src/utils/regex-literal.js';

/** Does the escaped text match itself, and only itself? */
const matchesOnlyItself = (text: string) =>
    new RegExp(`^${regexLiteral(text)}$`).test(text);

describe('regexLiteral', () => {
    it('escapes the backslash, which is the one the old escapes missed', () => {
        // Left alone, the backslash turns the next character into an escape sequence: `a\d` stops
        // being a name and becomes "a followed by any digit", so it matches a string the caller
        // never asked about. This is the assertion that separates this helper from what it
        // replaced; every hand-written escape in this repo passed the metacharacter cases below.
        expect(new RegExp('a\\d').test('a5')).toBe(true);            // what the old escape produced
        expect(new RegExp(regexLiteral('a\\d')).test('a5')).toBe(false);
        expect(matchesOnlyItself('a\\d')).toBe(true);
    });

    it('does not throw on text that would not compile unescaped', () => {
        for (const text of ['ends-with\\', '(', '[a-', '*', '+', '?', '{2,']) {
            expect(() => new RegExp(regexLiteral(text))).not.toThrow();
            expect(matchesOnlyItself(text)).toBe(true);
        }
    });

    it('holds for every metacharacter, one at a time', () => {
        for (const ch of '\\^$.*+?()[]{}|/-') expect(matchesOnlyItself(`a${ch}b`)).toBe(true);
    });

    it('leaves ordinary text matching as before', () => {
        expect(regexLiteral('ak-card')).toBe('ak\\-card');
        expect(matchesOnlyItself('ak-card')).toBe(true);
        expect(matchesOnlyItself('K$2')).toBe(true);
    });
});

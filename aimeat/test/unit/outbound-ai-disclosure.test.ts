/**
 * @file outbound-ai-disclosure.test.ts
 * @description Saying, in a header, that a machine wrote the message.
 *
 *   WHAT THIS PINS, and why each one is a property rather than a preference:
 *
 *   1. IT IS OPTIONAL AND IT DEFAULTS TO NOTHING. Article 50(4) obliges disclosure for text
 *      published to inform the PUBLIC on matters of PUBLIC INTEREST, and exempts even that when a
 *      person reviewed it and holds editorial responsibility. A message to one customer is neither,
 *      so a node that stamped every send would be adding a sentence to somebody's sales mail that
 *      the law does not ask for.
 *   2. 'none' IS AN ANSWER, NOT A MARK. Declaring "no AI" must not put a header on the wire that
 *      says AI, and must not put an empty one either.
 *   3. A WORD OUTSIDE THE VOCABULARY IS REFUSED, not coerced to the nearest one. The four values
 *      are the IETF draft's, and quietly turning 'ai' into 'ai-generated' would make the field mean
 *      whatever the caller happened to type.
 *   4. THE RECORD LINK IS A URL, not a bare id. A header carrying a hash that nobody can resolve is
 *      the exact failure the whole disclosure question turns on.
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-ai-disclosure.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */

import { describe, it, expect } from 'vitest';
import {
    disclosureHeaders, parseDisclosure, isDeclared, AI_DISCLOSURE_LEVELS,
} from '../../src/services/outbound/ai-disclosure.js';
import type { AimeatConfig } from '../../src/config.js';

const cfg = { baseUrl: 'https://aimeat.io/' } as unknown as AimeatConfig;

describe('nothing is stamped unless it was declared', () => {
    it('adds no header at all when nothing was said', () => {
        expect(disclosureHeaders(undefined, cfg)).toEqual({});
    });

    it("treats 'none' as an answer rather than as a mark", () => {
        // A message somebody wrote themselves must not carry a header about AI, empty or otherwise:
        // a recipient's filter reading X-AI-Disclosure: none would be reading a claim nobody made
        // about a message nobody generated.
        expect(disclosureHeaders({ level: 'none' }, cfg)).toEqual({});
        expect(isDeclared({ level: 'none' })).toBe(false);
    });
});

describe('what the header says', () => {
    it('carries the declared level under a name both providers accept', () => {
        // X- prefixed because Microsoft Graph accepts a custom header only in that form, and one
        // header that works on both beats two that each work on one.
        expect(disclosureHeaders({ level: 'ai-generated' }, cfg))
            .toEqual({ 'X-AI-Disclosure': 'ai-generated' });
        expect(disclosureHeaders({ level: 'ai-assisted' }, cfg))
            .toEqual({ 'X-AI-Disclosure': 'ai-assisted' });
    });

    it('resolves the provenance record to an address, not a bare id', () => {
        const h = disclosureHeaders({ level: 'ai-generated', provenanceId: 'abc-123' }, cfg);
        expect(h['X-AI-Disclosure-Record']).toBe('https://aimeat.io/v1/provenance/abc-123');
    });

    it('escapes an id rather than pasting it into a URL', () => {
        const h = disclosureHeaders({ level: 'ai-generated', provenanceId: 'a b/c' }, cfg);
        expect(h['X-AI-Disclosure-Record']).toBe('https://aimeat.io/v1/provenance/a%20b%2Fc');
    });
});

describe('the vocabulary is the IETF draft, and nothing else gets in', () => {
    it('accepts each of the four words on its own', () => {
        for (const level of AI_DISCLOSURE_LEVELS) {
            expect(parseDisclosure(level)).toEqual({ level });
        }
    });

    it('accepts a level with a provenance id, in either spelling', () => {
        expect(parseDisclosure({ level: 'ai-generated', provenance_id: 'p1' }))
            .toEqual({ level: 'ai-generated', provenanceId: 'p1' });
        expect(parseDisclosure({ level: 'ai-generated', provenanceId: 'p1' }))
            .toEqual({ level: 'ai-generated', provenanceId: 'p1' });
    });

    it('refuses a near-miss instead of guessing which word was meant', () => {
        for (const bad of ['ai', 'generated', 'AI-GENERATED', 'yes', '']) {
            const r = parseDisclosure(bad);
            expect(r && 'error' in r).toBe(true);
            expect((r as { error: string }).error).toMatch(/ai-generated/);
        }
    });

    it('refuses a shape that is not a level', () => {
        for (const bad of [42, true, ['ai-generated'], { nope: 1 }]) {
            const r = parseDisclosure(bad);
            expect(r && 'error' in r).toBe(true);
        }
    });

    it('reads absent as absent, never as a refusal', () => {
        expect(parseDisclosure(undefined)).toBeUndefined();
        expect(parseDisclosure(null)).toBeUndefined();
    });
});

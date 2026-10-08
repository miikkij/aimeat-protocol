/**
 * @file test/unit/memory-content-canonical.test.ts
 * @description The bytes a memory value's provenance record describes (src/utils/memory-content.ts).
 *   A non-string value serialises canonically, so the order a store hands the keys back in (JSONB
 *   reorders them) cannot change the hash; the legacy as-written form stays matchable; a document's
 *   record describes its markdown (aiprov E4, E13).
 * @usage pnpm test -- memory-content-canonical
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E4, E13).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    memoryContentBytes, legacyMemoryContentBytes, memoryContentHashes, canonicalJson, documentContentBytes,
} from '../../src/utils/memory-content.js';

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

describe('memoryContentBytes', () => {
    it('is the same for one object whatever order its keys arrive in, at every level', () => {
        const written = { zebra: 1, a: { y: [3, { k2: 'v', k1: null }], b: true } };
        const reordered = { a: { b: true, y: [3, { k1: null, k2: 'v' }] }, zebra: 1 };
        expect(memoryContentBytes(written)).toBe(memoryContentBytes(reordered));
        expect(memoryContentBytes(written)).toBe('{"a":{"b":true,"y":[3,{"k1":null,"k2":"v"}]},"zebra":1}');
    });

    it('leaves a string as its own bytes and writes JSON\'s own forms for scalars', () => {
        expect(memoryContentBytes('plain text')).toBe('plain text');
        expect(memoryContentBytes(42)).toBe('42');
        expect(memoryContentBytes(null)).toBe('null');
        expect(memoryContentBytes(undefined)).toBe('null');
        expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
        expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    });

    it('sorts keys by UTF-16 code unit (the RFC 8785 order)', () => {
        expect(canonicalJson({ b: 1, B: 2, a: 3, ä: 4 })).toBe('{"B":2,"a":3,"b":1,"ä":4}');
    });
});

describe('memoryContentHashes', () => {
    it('holds the canonical hash and the as-written hash, so a record minted before still matches', () => {
        const value = { zebra: 1, a: 2 };
        const hashes = memoryContentHashes(value);
        expect(hashes).toContain(sha('{"a":2,"zebra":1}'));
        expect(hashes).toContain(sha(legacyMemoryContentBytes(value)));
        expect(hashes).toContain(sha('{"zebra":1,"a":2}'));
    });

    it('is one hash when both forms are the same bytes', () => {
        expect(memoryContentHashes('text')).toHaveLength(1);
        expect(memoryContentHashes({ a: 1, b: 2 })).toHaveLength(1);
    });

    it('does not match different content', () => {
        expect(memoryContentHashes({ a: 1 })).not.toContain(sha('{"a":2}'));
    });
});

describe('documentContentBytes', () => {
    it('is a document\'s markdown, the text its reader is served', () => {
        expect(documentContentBytes({ title: 'T', markdown: '# Hello\n\nBody.' })).toBe('# Hello\n\nBody.');
    });

    it('falls back to the canonical value for anything without markdown', () => {
        expect(documentContentBytes({ title: 'T', b: 1 })).toBe('{"b":1,"title":"T"}');
        expect(documentContentBytes('text')).toBe('text');
    });
});

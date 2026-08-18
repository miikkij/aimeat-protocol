import { describe, it, expect } from 'vitest';
import { generateTrackingCode, generateRequestId, hasCheckDigit } from '../../src/utils/tracking-code.js';

describe('generateTrackingCode', () => {
    it('matches tc-{timestamp}-{8hex} format', () => {
        const code = generateTrackingCode();
        expect(code).toMatch(/^tc-\d+-[0-9a-f]{8}$/);
    });

    it('generates unique codes', () => {
        const codes = new Set(Array.from({ length: 100 }, () => generateTrackingCode()));
        expect(codes.size).toBe(100);
    });

    it('contains a reasonable timestamp', () => {
        const before = Date.now();
        const code = generateTrackingCode();
        const after = Date.now();
        const ts = Number(code.split('-')[1]);
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });
});

describe('generateRequestId', () => {
    it('matches req-{8hex} format', () => {
        const id = generateRequestId();
        expect(id).toMatch(/^req-[0-9a-f]{8}$/);
    });

    it('generates unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
        expect(ids.size).toBe(100);
    });
});

describe('check digit', () => {
    it('every minted request id carries it', () => {
        for (let i = 0; i < 500; i++) {
            expect(hasCheckDigit(generateRequestId().slice(4))).toBe(true);
        }
    });

    it('every minted tracking code carries it', () => {
        for (let i = 0; i < 500; i++) {
            expect(hasCheckDigit(generateTrackingCode().split('-')[2])).toBe(true);
        }
    });

    it('rejects a damaged id', () => {
        // Flip one nibble of a valid id: fifteen of the sixteen replacements must fail the check.
        const id = generateRequestId().slice(4);
        const rejected = '0123456789abcdef'.split('')
            .map((c) => id.slice(0, 3) + c + id.slice(4))
            .filter((candidate) => !hasCheckDigit(candidate));
        expect(rejected).toHaveLength(15);
    });
});

import { describe, it, expect } from 'vitest';
import { generateTrackingCode, generateRequestId } from '../../src/utils/tracking-code.js';

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

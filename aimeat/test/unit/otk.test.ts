import { describe, it, expect } from 'vitest';
import { generateOtk } from '../../src/utils/otk.js';

describe('generateOtk', () => {
    it('returns a string starting with "otk-"', () => {
        const key = generateOtk();
        expect(key).toMatch(/^otk-/);
    });

    it('generates 32 hex characters after prefix', () => {
        const key = generateOtk();
        const hex = key.replace('otk-', '');
        expect(hex).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique values', () => {
        const keys = new Set(Array.from({ length: 100 }, () => generateOtk()));
        expect(keys.size).toBe(100);
    });

    it('has fixed length of 36 characters', () => {
        const key = generateOtk();
        // "otk-" (4) + 32 hex = 36
        expect(key.length).toBe(36);
    });
});

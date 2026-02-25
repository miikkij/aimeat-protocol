import { describe, it, expect } from 'vitest';
import { calculateWorkCost } from '../../src/services/morsel.js';

describe('calculateWorkCost', () => {
    it('calculates 10% network fee', () => {
        const result = calculateWorkCost(100, 0.1);
        expect(result.basePrice).toBe(100);
        expect(result.networkFee).toBe(10);
        expect(result.total).toBe(110);
        expect(result.inEscrow).toBe(110);
    });

    it('rounds network fee up (ceil)', () => {
        const result = calculateWorkCost(15, 0.1);
        // 15 * 0.1 = 1.5 → ceil = 2
        expect(result.networkFee).toBe(2);
        expect(result.total).toBe(17);
    });

    it('handles zero base morsels', () => {
        const result = calculateWorkCost(0, 0.1);
        expect(result.basePrice).toBe(0);
        expect(result.networkFee).toBe(0);
        expect(result.total).toBe(0);
    });

    it('handles large amounts', () => {
        const result = calculateWorkCost(10000, 0.2);
        expect(result.basePrice).toBe(10000);
        expect(result.networkFee).toBe(1000);
        expect(result.total).toBe(11000);
    });

    it('network fee is always at least 1 for non-zero base', () => {
        const result = calculateWorkCost(1, 0.1);
        // 1 * 0.1 = 0.1 → ceil = 1
        expect(result.networkFee).toBe(1);
        expect(result.total).toBe(2);
    });

    it('burn rate parameter does not affect cost calculation', () => {
        // calculateWorkCost ignores burnRate — it's used only in settlement
        const a = calculateWorkCost(100, 0.0);
        const b = calculateWorkCost(100, 0.5);
        expect(a).toEqual(b);
    });
});

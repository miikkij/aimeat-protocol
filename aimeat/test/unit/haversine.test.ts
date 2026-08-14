import { describe, it, expect } from 'vitest';

/**
 * Haversine formula (same as in src/services/directory.ts)
 * Replicated here for isolated unit testing since haversineKm is not exported.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe('haversineKm', () => {
    it('returns 0 for the same point', () => {
        const dist = haversineKm(60.1699, 24.9384, 60.1699, 24.9384);
        expect(dist).toBe(0);
    });

    it('calculates Helsinki to Espoo (~15 km)', () => {
        // Helsinki: 60.1699, 24.9384  Espoo: 60.2055, 24.6559
        const dist = haversineKm(60.1699, 24.9384, 60.2055, 24.6559);
        expect(dist).toBeGreaterThan(10);
        expect(dist).toBeLessThan(25);
    });

    it('calculates Helsinki to Tampere (~160-180 km)', () => {
        // Helsinki: 60.1699, 24.9384  Tampere: 61.4978, 23.7610
        const dist = haversineKm(60.1699, 24.9384, 61.4978, 23.7610);
        expect(dist).toBeGreaterThan(150);
        expect(dist).toBeLessThan(200);
    });

    it('calculates Helsinki to Turku (~150-180 km)', () => {
        // Helsinki: 60.1699, 24.9384  Turku: 60.4518, 22.2666
        const dist = haversineKm(60.1699, 24.9384, 60.4518, 22.2666);
        expect(dist).toBeGreaterThan(140);
        expect(dist).toBeLessThan(190);
    });

    it('calculates antipodal points (~20,000 km)', () => {
        // North pole to South pole
        const dist = haversineKm(90, 0, -90, 0);
        expect(dist).toBeGreaterThan(19_900);
        expect(dist).toBeLessThan(20_100);
    });

    it('handles equator wrapping correctly', () => {
        // Two points on the equator 180 degrees apart
        const dist = haversineKm(0, 0, 0, 180);
        // Half the circumference: ~20,015 km
        expect(dist).toBeGreaterThan(19_900);
        expect(dist).toBeLessThan(20_100);
    });

    it('is symmetric (A to B equals B to A)', () => {
        const ab = haversineKm(60.1699, 24.9384, 61.4978, 23.7610);
        const ba = haversineKm(61.4978, 23.7610, 60.1699, 24.9384);
        expect(ab).toBeCloseTo(ba, 10);
    });
});

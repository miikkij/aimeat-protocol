import { describe, it, expect, vi } from 'vitest';
import { calculateTrustScore } from '../../src/services/trust.js';
import type { Storage } from '../../src/storage/interface.js';

function mockStorage(overrides: Partial<Storage> = {}): Storage {
    return {
        getAgent: vi.fn().mockResolvedValue(null),
        listWorkByProvider: vi.fn().mockResolvedValue([]),
        listDisputesByProvider: vi.fn().mockResolvedValue([]),
        ...overrides,
    } as unknown as Storage;
}

describe('calculateTrustScore', () => {
    it('returns default score 50 for unknown agent', async () => {
        const storage = mockStorage();
        const result = await calculateTrustScore('unknown#owner@node', storage);
        expect(result.score).toBe(50);
        expect(result.totalDeliveries).toBe(0);
    });

    it('returns score for agent with no work history', async () => {
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue({
                gaii: 'test#owner@node',
                createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
                lastSeen: new Date().toISOString(),
            }),
        });
        const result = await calculateTrustScore('test#owner@node', storage);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.totalDeliveries).toBe(0);
    });

    it('increases score with successful deliveries', async () => {
        const agent = {
            gaii: 'test#owner@node',
            createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
            lastSeen: new Date().toISOString(),
        };
        const work = Array.from({ length: 10 }, (_, i) => ({
            status: 'delivered',
            rating: { score: 5 },
            requesterGaii: `requester-${i % 5}#owner@node`,
            createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
            updatedAt: new Date(Date.now() - i * 86_400_000 + 60_000).toISOString(),
        }));
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(work),
        });
        const result = await calculateTrustScore('test#owner@node', storage);
        expect(result.score).toBeGreaterThan(40);
        expect(result.totalDeliveries).toBe(10);
        expect(result.positiveRatings).toBe(10);
    });

    it('caps new agent score at 65 for first 7 days', async () => {
        const agent = {
            gaii: 'new#owner@node',
            createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            lastSeen: new Date().toISOString(),
        };
        const work = Array.from({ length: 20 }, () => ({
            status: 'delivered',
            rating: { score: 5 },
            createdAt: new Date(Date.now() - 86_400_000).toISOString(),
            updatedAt: new Date().toISOString(),
        }));
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(work),
        });
        const result = await calculateTrustScore('new#owner@node', storage);
        expect(result.score).toBeLessThanOrEqual(65);
    });

    it('penalizes disputes lost', async () => {
        const agent = {
            gaii: 'test#owner@node',
            createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
            lastSeen: new Date().toISOString(),
        };
        const work = Array.from({ length: 5 }, (_, i) => ({
            status: 'delivered',
            rating: { score: 5 },
            requesterGaii: `requester-${i % 4}#owner@node`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }));

        const noDisputes = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(work),
        });
        const withDisputes = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(work),
            listDisputesByProvider: vi.fn().mockResolvedValue([
                { status: 'resolved', ruling: { ruling: 'requester_wins' } },
                { status: 'resolved', ruling: { ruling: 'requester_wins' } },
            ]),
        });

        const scoreNone = await calculateTrustScore('test#owner@node', noDisputes);
        const scoreLost = await calculateTrustScore('test#owner@node', withDisputes);
        expect(scoreLost.score).toBeLessThan(scoreNone.score);
        expect(scoreLost.disputesLost).toBe(2);
    });

    it('score stays between 0 and 100', async () => {
        const agent = {
            gaii: 'test#owner@node',
            createdAt: new Date(Date.now() - 365 * 86_400_000).toISOString(),
            lastSeen: new Date().toISOString(),
        };
        const work = Array.from({ length: 100 }, () => ({
            status: 'delivered',
            rating: { score: 5 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }));
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(work),
        });
        const result = await calculateTrustScore('test#owner@node', storage);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });
});

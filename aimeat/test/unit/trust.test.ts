/**
 * @file test/unit/trust.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for services/trust.ts: the score's components, its caps, and which work
 *   states and dispute verdicts it counts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/trust.test.ts
 * @version-history
 *   2026-10-15 — Header added. The score counts the states the routes write (cancelled, expired, the
 *     dispute states of delivered work) and the verdicts they store (requester_wins, timeout), and
 *     refreshTrustScore stores it (feature-list audit #144).
 */
import { describe, it, expect, vi } from 'vitest';
import { calculateTrustScore, refreshTrustScore } from '../../src/services/trust.js';
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

// Feature-list audit #144: the score counted `failed` and `rejected`, which no route writes, and
// dropped delivered work once a dispute moved it on.
describe('calculateTrustScore counts the states the routes write', () => {
    const agent = {
        gaii: 'test#owner@node',
        createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        lastSeen: new Date().toISOString(),
    };
    const item = (status: string, i: number) => ({
        status,
        requesterGaii: `requester-${i}#owner@node`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    it('a declined request (cancelled) is a failure and a timed-out one (expired) an expiry', async () => {
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue([item('delivered', 1), item('cancelled', 2), item('expired', 3)]),
        });
        const r = await calculateTrustScore(agent.gaii, storage);
        expect(r.failedDeliveries).toBe(1);
        expect(r.expiredDeliveries).toBe(1);
        expect(r.successRate).toBeCloseTo(1 / 3);
    });

    it('delivered work that a dispute moved on (disputed, contested, escalated, settled) still counts as delivered', async () => {
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listWorkByProvider: vi.fn().mockResolvedValue(
                ['disputed', 'contested', 'escalated', 'settled'].map((s, i) => item(s, i))),
        });
        const r = await calculateTrustScore(agent.gaii, storage);
        expect(r.totalDeliveries).toBe(4);
        expect(r.successRate).toBe(1);
    });

    it('requester_wins (an operator ruling or accepted fault) and timeout are lost disputes; provider_wins and split are not', async () => {
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue(agent),
            listDisputesByProvider: vi.fn().mockResolvedValue([
                { status: 'resolved', ruling: { ruling: 'requester_wins' } },
                { status: 'resolved', ruling: { ruling: 'timeout' } },
                { status: 'resolved', ruling: { ruling: 'provider_wins' } },
                { status: 'resolved', ruling: { ruling: 'split' } },
                { status: 'escalated' },
            ]),
        });
        expect((await calculateTrustScore(agent.gaii, storage)).disputesLost).toBe(2);
    });
});

describe('refreshTrustScore stores the score on the agent', () => {
    it('writes the recomputed score when it differs from the stored one', async () => {
        const updateAgent = vi.fn().mockResolvedValue(undefined);
        const storage = mockStorage({
            getAgent: vi.fn().mockResolvedValue({
                gaii: 'test#owner@node', trustScore: 77,
                createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), lastSeen: new Date().toISOString(),
            }),
            updateAgent,
        });
        await refreshTrustScore(storage, 'test#owner@node');
        const expected = (await calculateTrustScore('test#owner@node', storage)).score;
        expect(updateAgent).toHaveBeenCalledWith('test#owner@node', { trustScore: expected });
    });

    it('leaves a provider that is not an agent alone, and never throws', async () => {
        const updateAgent = vi.fn();
        await refreshTrustScore(mockStorage({ updateAgent }), 'alice@node');
        expect(updateAgent).not.toHaveBeenCalled();
        const broken = mockStorage({ getAgent: vi.fn().mockRejectedValue(new Error('db down')) });
        await expect(refreshTrustScore(broken, 'x#alice@node')).resolves.toBeUndefined();
    });
});

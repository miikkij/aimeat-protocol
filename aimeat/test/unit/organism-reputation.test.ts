import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { createOrganismReputationService } from '../../src/services/organism-reputation.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

const config = { nodeId: 'test-node' } as any;

function makeOrganism(overrides: Partial<OrganismRecord> = {}): OrganismRecord {
    return {
        id: 'org-1',
        name: 'Test Org',
        type: 'community',
        description: 'Test',
        creatorGhii: 'user1@test-node',
        admins: [],
        members: [],
        agentGaiis: [],
        boardId: 'board-org-1',
        joinPolicy: 'open',
        maxMembers: 100,
        visibility: 'public',
        moderationConfig: {
            flagsEnabled: true,
            autoHideThreshold: 3,
            appealsEnabled: true,
        },
        memoryNamespace: 'organism.org-1',
        interests: ['test'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeMembership(overrides: Partial<OrganismMembershipRecord> = {}): OrganismMembershipRecord {
    return {
        id: `mem-${Math.random().toString(36).slice(2, 10)}`,
        organismId: 'org-1',
        ghii: 'user1@test-node',
        role: 'member',
        status: 'active',
        joinedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeGHII(overrides: Partial<GHIIRecord> = {}): GHIIRecord {
    return {
        username: 'user1',
        nodeId: 'test-node',
        ghii: 'user1@test-node',
        displayName: 'User One',
        verificationLevel: 1,
        ownerName: 'user1',
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Organism Reputation Service', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('returns null for non-existent organism', async () => {
        const service = createOrganismReputationService(config, storage);
        const result = await service.calculateReputation('non-existent-org');
        expect(result).toBeNull();
    });

    it('calculates score for organism with no members', async () => {
        const service = createOrganismReputationService(config, storage);
        await storage.createOrganism(makeOrganism({ id: 'org-empty', members: [] }));

        const result = await service.calculateReputation('org-empty');
        expect(result).not.toBeNull();
        expect(result!.organismId).toBe('org-empty');
        expect(result!.score).toBeGreaterThanOrEqual(0);
        expect(result!.score).toBeLessThanOrEqual(100);
        // With no members, expect a low score
        expect(result!.breakdown.memberScore).toBeLessThanOrEqual(20);
        expect(result!.calculatedAt).toBeTruthy();
    });

    it('calculates score for active organism', async () => {
        const service = createOrganismReputationService(config, storage);
        await storage.createOrganism(makeOrganism({
            id: 'org-active',
            members: ['user1@test-node', 'user2@test-node', 'user3@test-node'],
        }));

        await storage.createMembership(makeMembership({ id: 'mem-1', organismId: 'org-active', ghii: 'user1@test-node' }));
        await storage.createMembership(makeMembership({ id: 'mem-2', organismId: 'org-active', ghii: 'user2@test-node' }));
        await storage.createMembership(makeMembership({ id: 'mem-3', organismId: 'org-active', ghii: 'user3@test-node' }));

        const result = await service.calculateReputation('org-active');
        expect(result).not.toBeNull();
        expect(result!.score).toBeGreaterThan(0);
        expect(result!.breakdown.memberScore).toBeGreaterThan(0);
        expect(result!.breakdown).toHaveProperty('activityScore');
        expect(result!.breakdown).toHaveProperty('trustScore');
        expect(result!.breakdown).toHaveProperty('ageScore');
        expect(result!.breakdown).toHaveProperty('flagScore');
    });

    it('member score scales with member count', async () => {
        const service = createOrganismReputationService(config, storage);

        // Small organism: 2 members
        await storage.createOrganism(makeOrganism({ id: 'org-small', members: ['u1@test-node', 'u2@test-node'] }));
        await storage.createMembership(makeMembership({ id: 'ms-1', organismId: 'org-small', ghii: 'u1@test-node' }));
        await storage.createMembership(makeMembership({ id: 'ms-2', organismId: 'org-small', ghii: 'u2@test-node' }));

        // Large organism: 10 members
        const largeMembers = Array.from({ length: 10 }, (_, i) => `user${i}@test-node`);
        await storage.createOrganism(makeOrganism({ id: 'org-large', members: largeMembers }));
        for (let i = 0; i < 10; i++) {
            await storage.createMembership(makeMembership({
                id: `ml-${i}`,
                organismId: 'org-large',
                ghii: `user${i}@test-node`,
            }));
        }

        const smallResult = await service.calculateReputation('org-small');
        const largeResult = await service.calculateReputation('org-large');

        expect(smallResult).not.toBeNull();
        expect(largeResult).not.toBeNull();
        expect(largeResult!.breakdown.memberScore).toBeGreaterThan(smallResult!.breakdown.memberScore);
    });

    it('trust score reflects member trust averages', async () => {
        const service = createOrganismReputationService(config, storage);

        // Low-trust organism
        await storage.createOrganism(makeOrganism({ id: 'org-low-trust', members: ['low1@test-node', 'low2@test-node'] }));
        await storage.createMembership(makeMembership({ id: 'mlt-1', organismId: 'org-low-trust', ghii: 'low1@test-node' }));
        await storage.createMembership(makeMembership({ id: 'mlt-2', organismId: 'org-low-trust', ghii: 'low2@test-node' }));
        await storage.createGHII(makeGHII({ username: 'low1', ghii: 'low1@test-node', ownerName: 'low1', trustScore: 10 }));
        await storage.createGHII(makeGHII({ username: 'low2', ghii: 'low2@test-node', ownerName: 'low2', trustScore: 15 }));

        // High-trust organism
        await storage.createOrganism(makeOrganism({ id: 'org-high-trust', members: ['high1@test-node', 'high2@test-node'] }));
        await storage.createMembership(makeMembership({ id: 'mht-1', organismId: 'org-high-trust', ghii: 'high1@test-node' }));
        await storage.createMembership(makeMembership({ id: 'mht-2', organismId: 'org-high-trust', ghii: 'high2@test-node' }));
        await storage.createGHII(makeGHII({ username: 'high1', ghii: 'high1@test-node', ownerName: 'high1', trustScore: 90 }));
        await storage.createGHII(makeGHII({ username: 'high2', ghii: 'high2@test-node', ownerName: 'high2', trustScore: 95 }));

        const lowResult = await service.calculateReputation('org-low-trust');
        const highResult = await service.calculateReputation('org-high-trust');

        expect(lowResult).not.toBeNull();
        expect(highResult).not.toBeNull();
        expect(highResult!.breakdown.trustScore).toBeGreaterThan(lowResult!.breakdown.trustScore);
    });

    it('age score increases with organism age', async () => {
        const service = createOrganismReputationService(config, storage);

        // Young organism: created 1 day ago
        const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
        await storage.createOrganism(makeOrganism({
            id: 'org-young',
            createdAt: oneDayAgo,
            updatedAt: oneDayAgo,
        }));

        // Old organism: created 180 days ago
        const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
        await storage.createOrganism(makeOrganism({
            id: 'org-old',
            createdAt: sixMonthsAgo,
            updatedAt: sixMonthsAgo,
        }));

        const youngResult = await service.calculateReputation('org-young');
        const oldResult = await service.calculateReputation('org-old');

        expect(youngResult).not.toBeNull();
        expect(oldResult).not.toBeNull();
        expect(oldResult!.breakdown.ageScore).toBeGreaterThan(youngResult!.breakdown.ageScore);
    });

    it('score is stored via setOrganismReputation', async () => {
        const service = createOrganismReputationService(config, storage);
        const setReputationSpy = vi.spyOn(storage, 'setOrganismReputation');

        await storage.createOrganism(makeOrganism({ id: 'org-stored' }));

        const result = await service.calculateReputation('org-stored');
        expect(result).not.toBeNull();

        // Verify setOrganismReputation was called with the computed record
        expect(setReputationSpy).toHaveBeenCalledTimes(1);
        expect(setReputationSpy).toHaveBeenCalledWith(expect.objectContaining({
            organismId: 'org-stored',
            score: expect.any(Number),
            breakdown: expect.objectContaining({
                memberScore: expect.any(Number),
                activityScore: expect.any(Number),
                trustScore: expect.any(Number),
                ageScore: expect.any(Number),
                flagScore: expect.any(Number),
            }),
            calculatedAt: expect.any(String),
        }));

        // Verify it is persisted in storage
        const stored = await storage.getOrganismReputation('org-stored');
        expect(stored).not.toBeNull();
        expect(stored!.organismId).toBe('org-stored');
        expect(stored!.score).toBe(result!.score);
    });

    it('score is capped between 0 and 100', async () => {
        const service = createOrganismReputationService(config, storage);

        // Minimal organism — should produce a low but valid score
        await storage.createOrganism(makeOrganism({
            id: 'org-min',
            members: [],
            createdAt: new Date().toISOString(),
        }));
        const minResult = await service.calculateReputation('org-min');
        expect(minResult).not.toBeNull();
        expect(minResult!.score).toBeGreaterThanOrEqual(0);
        expect(minResult!.score).toBeLessThanOrEqual(100);

        // Well-established organism — should produce a high but valid score
        const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const manyMembers = Array.from({ length: 50 }, (_, i) => `member${i}@test-node`);
        await storage.createOrganism(makeOrganism({
            id: 'org-max',
            members: manyMembers,
            createdAt: longAgo,
            updatedAt: longAgo,
        }));
        for (let i = 0; i < 50; i++) {
            await storage.createMembership(makeMembership({
                id: `mx-${i}`,
                organismId: 'org-max',
                ghii: `member${i}@test-node`,
            }));
            await storage.createGHII(makeGHII({
                username: `member${i}`,
                ghii: `member${i}@test-node`,
                ownerName: `member${i}`,
                trustScore: 95,
            }));
        }
        const maxResult = await service.calculateReputation('org-max');
        expect(maxResult).not.toBeNull();
        expect(maxResult!.score).toBeGreaterThanOrEqual(0);
        expect(maxResult!.score).toBeLessThanOrEqual(100);

        // Validate all breakdown components are also within reasonable bounds (0-100)
        for (const key of ['memberScore', 'activityScore', 'trustScore', 'ageScore', 'flagScore'] as const) {
            expect(minResult!.breakdown[key]).toBeGreaterThanOrEqual(0);
            expect(maxResult!.breakdown[key]).toBeGreaterThanOrEqual(0);
        }
    });
});

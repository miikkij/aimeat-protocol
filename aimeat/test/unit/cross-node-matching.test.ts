import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrossNodeMatchingService } from '../../src/services/cross-node-matching.js';
import type { CrossNodeMatchingService, AnonymizedProfile } from '../../src/services/cross-node-matching.js';
import type { AimeatConfig } from '../../src/config.js';
import type {
    Storage,
    GHIIRecord,
    ConsentRecord,
    AgentRecord,
    MemoryRecord,
} from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        ...overrides,
    } as AimeatConfig;
}

function makeGHII(username: string, nodeId = 'test-node-001'): GHIIRecord {
    return {
        username,
        nodeId,
        ghii: `${username}@${nodeId}`,
        displayName: username,
        verificationLevel: 1 as 0 | 1 | 2,
        ownerName: username,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function makeConsent(ownerGaii: string, purpose: string, scope: 'private' | 'dmz' | 'federation' = 'federation'): ConsentRecord {
    return {
        id: `consent-${Math.random().toString(36).slice(2, 8)}`,
        ownerGaii,
        dataPattern: 'profile.*',
        recipient: '*',
        purpose,
        scope,
        expires: null,
        status: 'active',
        grantedAt: new Date().toISOString(),
        revokedAt: null,
    };
}

function makeAgent(gaii: string, ownerName: string): AgentRecord {
    return {
        name: gaii.split('/')[1]?.split('@')[0] || 'agent-1',
        owner: ownerName,
        gaii,
        capabilities: [],
        publicKey: 'test-key',
        trustScore: 50,
        morselBalance: 100,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
    };
}

function makeMemory(key: string, ownerGaii: string, value: unknown): MemoryRecord {
    return {
        key,
        ownerGaii,
        value,
        visibility: 'private',
        tags: [],
        ttlHours: null,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

interface MockStorageData {
    ghiis?: GHIIRecord[];
    consents?: Map<string, ConsentRecord[]>;
    agents?: Map<string, AgentRecord[]>;
    memories?: Map<string, MemoryRecord[]>;
}

function makeMockStorage(data: MockStorageData = {}) {
    const ghiis = data.ghiis ?? [];
    const consents = data.consents ?? new Map();
    const agents = data.agents ?? new Map();
    const memories = data.memories ?? new Map();

    return {
        listGHIIs: vi.fn(async () => ghiis),
        listConsents: vi.fn(async (ownerGaii: string, _opts?: { status?: string }) =>
            consents.get(ownerGaii) ?? [],
        ),
        getAgentsByOwner: vi.fn(async (ownerName: string) =>
            agents.get(ownerName) ?? [],
        ),
        listMemory: vi.fn(async (gaii: string, _opts?: { prefix?: string }) =>
            memories.get(gaii) ?? [],
        ),
    } as unknown as Storage;
}

// ── Tests ────────────────────────────────────────────────────

describe('Cross-Node Matching Service', () => {
    describe('calculateCrossMatchScore', () => {
        let service: CrossNodeMatchingService;

        beforeEach(() => {
            const storage = makeMockStorage();
            service = createCrossNodeMatchingService(makeConfig(), storage);
        });

        it('returns 0 for no shared interests', () => {
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['music', 'art'] };
            const profileB: AnonymizedProfile = { hash: 'bbb', interests: ['cooking', 'sports'] };
            const score = service.calculateCrossMatchScore(profileA, profileB);
            expect(score).toBe(0);
        });

        it('returns higher score for more shared interests', () => {
            // Both profiles have 3 interests so the denominator is stable at min(3,3)=3
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['music', 'art', 'coding'] };
            const profileB_one: AnonymizedProfile = { hash: 'bbb', interests: ['music', 'sports', 'cooking'] };   // 1 shared
            const profileB_two: AnonymizedProfile = { hash: 'ccc', interests: ['music', 'art', 'cooking'] };      // 2 shared

            const scoreOne = service.calculateCrossMatchScore(profileA, profileB_one);
            const scoreTwo = service.calculateCrossMatchScore(profileA, profileB_two);
            expect(scoreTwo).toBeGreaterThan(scoreOne);
        });

        it('same city gives location bonus', () => {
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['music'], city: 'Helsinki' };
            const profileB_sameCity: AnonymizedProfile = { hash: 'bbb', interests: ['music'], city: 'Helsinki' };
            const profileB_noCity: AnonymizedProfile = { hash: 'ccc', interests: ['music'] };

            const scoreWithCity = service.calculateCrossMatchScore(profileA, profileB_sameCity);
            const scoreWithout = service.calculateCrossMatchScore(profileA, profileB_noCity);
            expect(scoreWithCity).toBeGreaterThan(scoreWithout);
        });

        it('same country gives smaller location bonus than same city', () => {
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['music'], city: 'Helsinki', country: 'FI' };
            const profileB_sameCity: AnonymizedProfile = { hash: 'bbb', interests: ['music'], city: 'Helsinki', country: 'FI' };
            const profileB_sameCountry: AnonymizedProfile = { hash: 'ccc', interests: ['music'], city: 'Tampere', country: 'FI' };

            const scoreSameCity = service.calculateCrossMatchScore(profileA, profileB_sameCity);
            const scoreSameCountry = service.calculateCrossMatchScore(profileA, profileB_sameCountry);
            expect(scoreSameCity).toBeGreaterThan(scoreSameCountry);
        });

        it('score is between 0 and 1', () => {
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['a', 'b', 'c', 'd', 'e'], city: 'Helsinki', country: 'FI' };
            const profileB: AnonymizedProfile = { hash: 'bbb', interests: ['a', 'b', 'c', 'd', 'e'], city: 'Helsinki', country: 'FI' };
            const score = service.calculateCrossMatchScore(profileA, profileB);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        });

        it('performs case-insensitive interest matching', () => {
            const profileA: AnonymizedProfile = { hash: 'aaa', interests: ['Music', 'ART'] };
            const profileB: AnonymizedProfile = { hash: 'bbb', interests: ['music', 'art'] };
            const score = service.calculateCrossMatchScore(profileA, profileB);
            expect(score).toBeGreaterThan(0);
        });
    });

    describe('getAnonymizedProfiles', () => {
        it('returns anonymized data (no GHII in output)', async () => {
            const ghiis = [makeGHII('alice'), makeGHII('bob')];
            const consents = new Map([
                ['alice@test-node-001', [makeConsent('alice@test-node-001', 'community-discovery', 'federation')]],
                ['bob@test-node-001', [makeConsent('bob@test-node-001', 'community-discovery', 'federation')]],
            ]);
            const aliceAgent = makeAgent('alice/agent-1@test-node-001', 'alice');
            const bobAgent = makeAgent('bob/agent-1@test-node-001', 'bob');
            const agents = new Map([
                ['alice', [aliceAgent]],
                ['bob', [bobAgent]],
            ]);
            const memories = new Map([
                [aliceAgent.gaii, [makeMemory('profile.interests', aliceAgent.gaii, ['music', 'art'])]],
                [bobAgent.gaii, [makeMemory('profile.interests', bobAgent.gaii, ['cooking'])]],
            ]);
            const storage = makeMockStorage({ ghiis, consents, agents, memories });
            const service = createCrossNodeMatchingService(makeConfig(), storage);

            const profiles = await service.getAnonymizedProfiles();
            for (const profile of profiles) {
                // Hash should not contain the actual GHII
                expect(profile.hash).not.toContain('alice');
                expect(profile.hash).not.toContain('bob');
                expect(profile.hash.length).toBe(16);
            }
        });

        it('profile hash is deterministic', async () => {
            const ghiis = [makeGHII('alice')];
            const consents = new Map([
                ['alice@test-node-001', [makeConsent('alice@test-node-001', 'community-discovery', 'federation')]],
            ]);
            const aliceAgent = makeAgent('alice/agent-1@test-node-001', 'alice');
            const agents = new Map([['alice', [aliceAgent]]]);
            const memories = new Map([
                [aliceAgent.gaii, [makeMemory('profile.interests', aliceAgent.gaii, ['music'])]],
            ]);
            const storage = makeMockStorage({ ghiis, consents, agents, memories });
            const config = makeConfig();
            const service = createCrossNodeMatchingService(config, storage);

            const profiles1 = await service.getAnonymizedProfiles();
            const profiles2 = await service.getAnonymizedProfiles();
            expect(profiles1[0].hash).toBe(profiles2[0].hash);
        });

        it('only includes profiles with community-discovery consent', async () => {
            const ghiis = [makeGHII('alice'), makeGHII('bob')];
            // Alice has discovery consent, Bob does not
            const consents = new Map([
                ['alice@test-node-001', [makeConsent('alice@test-node-001', 'community-discovery', 'federation')]],
                ['bob@test-node-001', [makeConsent('bob@test-node-001', 'marketplace', 'federation')]],
            ]);
            const aliceAgent = makeAgent('alice/agent-1@test-node-001', 'alice');
            const bobAgent = makeAgent('bob/agent-1@test-node-001', 'bob');
            const agents = new Map([
                ['alice', [aliceAgent]],
                ['bob', [bobAgent]],
            ]);
            const memories = new Map([
                [aliceAgent.gaii, [makeMemory('profile.interests', aliceAgent.gaii, ['music'])]],
                [bobAgent.gaii, [makeMemory('profile.interests', bobAgent.gaii, ['cooking'])]],
            ]);
            const storage = makeMockStorage({ ghiis, consents, agents, memories });
            const service = createCrossNodeMatchingService(makeConfig(), storage);

            const profiles = await service.getAnonymizedProfiles();
            // Only Alice should be included
            expect(profiles).toHaveLength(1);
        });

        it('excludes profiles without interests', async () => {
            const ghiis = [makeGHII('alice')];
            const consents = new Map([
                ['alice@test-node-001', [makeConsent('alice@test-node-001', 'community-discovery', 'federation')]],
            ]);
            const aliceAgent = makeAgent('alice/agent-1@test-node-001', 'alice');
            const agents = new Map([['alice', [aliceAgent]]]);
            // No interest memories
            const memories = new Map([
                [aliceAgent.gaii, [makeMemory('profile.location', aliceAgent.gaii, { city: 'Helsinki' })]],
            ]);
            const storage = makeMockStorage({ ghiis, consents, agents, memories });
            const service = createCrossNodeMatchingService(makeConfig(), storage);

            const profiles = await service.getAnonymizedProfiles();
            expect(profiles).toHaveLength(0);
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrganismReputationService } from '../../src/services/organism-reputation.js';
import type { OrganismReputationService } from '../../src/services/organism-reputation.js';
import type { AimeatConfig } from '../../src/config.js';
import type {
    Storage,
    OrganismRecord,
    OrganismReputationRecord,
    GHIIRecord,
    BoardRecord,
    BoardPostRecord,
    FlagRecord,
} from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        ...overrides,
    } as AimeatConfig;
}

function makeOrganism(overrides: Partial<OrganismRecord> = {}): OrganismRecord {
    return {
        id: `org-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Test Organism',
        description: 'A test community',
        type: 'community',
        interests: ['AI'],
        creatorGhii: 'alice@test-node-001',
        admins: ['alice@test-node-001'],
        members: ['alice@test-node-001'],
        agentGaiis: [],
        boardId: 'board-test',
        joinPolicy: 'open',
        maxMembers: 100,
        visibility: 'public',
        moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: 'organism.test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeGHII(ghii: string, verificationLevel: 0 | 1 | 2 = 1): GHIIRecord {
    return {
        username: ghii.split('@')[0],
        nodeId: ghii.split('@')[1] || 'test-node-001',
        ghii,
        displayName: ghii.split('@')[0],
        verificationLevel,
        ownerName: ghii.split('@')[0],
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function makeMockStorage(opts: {
    organisms?: Map<string, OrganismRecord>;
    ghiis?: Map<string, GHIIRecord>;
    boards?: Map<string, BoardRecord>;
    posts?: Map<string, BoardPostRecord[]>;
    flags?: FlagRecord[];
    reputations?: Map<string, OrganismReputationRecord>;
} = {}) {
    const organisms = opts.organisms ?? new Map();
    const ghiis = opts.ghiis ?? new Map();
    const boards = opts.boards ?? new Map();
    const posts = opts.posts ?? new Map();
    const flags = opts.flags ?? [];
    const reputations = opts.reputations ?? new Map();

    return {
        getOrganism: vi.fn(async (id: string) => organisms.get(id) ?? null),
        getGHII: vi.fn(async (ghii: string) => ghiis.get(ghii) ?? null),
        getBoard: vi.fn(async (id: string) => boards.get(id) ?? null),
        listPosts: vi.fn(async (boardId: string, _opts?: { limit?: number }) => posts.get(boardId) ?? []),
        listFlags: vi.fn(async (_opts?: { targetType?: string }) => flags),
        setOrganismReputation: vi.fn(async (record: OrganismReputationRecord) => {
            reputations.set(record.organismId, record);
            return record;
        }),
        getOrganismReputation: vi.fn(async (organismId: string) => reputations.get(organismId) ?? null),
    } as unknown as Storage;
}

// ── Tests ────────────────────────────────────────────────────

describe('Organism Reputation Service', () => {
    let service: OrganismReputationService;

    describe('calculateReputation', () => {
        it('returns null for nonexistent organism', async () => {
            const storage = makeMockStorage();
            service = createOrganismReputationService(makeConfig(), storage);
            const result = await service.calculateReputation('nonexistent');
            expect(result).toBeNull();
        });

        it('returns score in 0-100 range', async () => {
            const org = makeOrganism({ id: 'org-1', members: ['alice@test-node-001'] });
            const organisms = new Map([['org-1', org]]);
            const ghiis = new Map([['alice@test-node-001', makeGHII('alice@test-node-001', 1)]]);
            const storage = makeMockStorage({ organisms, ghiis });
            service = createOrganismReputationService(makeConfig(), storage);

            const result = await service.calculateReputation('org-1');
            expect(result).not.toBeNull();
            expect(result!.score).toBeGreaterThanOrEqual(0);
            expect(result!.score).toBeLessThanOrEqual(100);
        });

        it('breakdown has all 5 components', async () => {
            const org = makeOrganism({ id: 'org-1' });
            const organisms = new Map([['org-1', org]]);
            const storage = makeMockStorage({ organisms });
            service = createOrganismReputationService(makeConfig(), storage);

            const result = await service.calculateReputation('org-1');
            expect(result).not.toBeNull();
            expect(result!.breakdown).toHaveProperty('memberScore');
            expect(result!.breakdown).toHaveProperty('activityScore');
            expect(result!.breakdown).toHaveProperty('trustScore');
            expect(result!.breakdown).toHaveProperty('ageScore');
            expect(result!.breakdown).toHaveProperty('flagScore');
        });

        it('empty organism (just created, no flags) gets low member score but high flag score', async () => {
            const org = makeOrganism({
                id: 'org-1',
                members: ['alice@test-node-001'],
                boardId: 'board-1',
                createdAt: new Date().toISOString(), // just created
            });
            const organisms = new Map([['org-1', org]]);
            const ghiis = new Map([['alice@test-node-001', makeGHII('alice@test-node-001', 0)]]);
            const storage = makeMockStorage({ organisms, ghiis });
            service = createOrganismReputationService(makeConfig(), storage);

            const result = await service.calculateReputation('org-1');
            expect(result).not.toBeNull();
            // New organism with 1 member, no activity, just created => low score
            // Flag score should be high (100) since no flags
            expect(result!.breakdown.flagScore).toBe(100);
            // Age score should be 0 or very low (just created)
            expect(result!.breakdown.ageScore).toBeLessThanOrEqual(1);
        });

        it('organism with many members gets higher member score', async () => {
            const members = Array.from({ length: 20 }, (_, i) => `user${i}@test-node-001`);
            const org = makeOrganism({ id: 'org-1', members, maxMembers: 100 });
            const organisms = new Map([['org-1', org]]);
            const ghiis = new Map(members.map(m => [m, makeGHII(m, 1)]));
            const storage = makeMockStorage({ organisms, ghiis });
            service = createOrganismReputationService(makeConfig(), storage);

            const result = await service.calculateReputation('org-1');

            // Also check a smaller organism for comparison
            const smallMembers = ['solo@test-node-001'];
            const smallOrg = makeOrganism({ id: 'org-2', members: smallMembers, maxMembers: 100 });
            organisms.set('org-2', smallOrg);
            ghiis.set('solo@test-node-001', makeGHII('solo@test-node-001', 1));

            const smallResult = await service.calculateReputation('org-2');
            expect(result!.breakdown.memberScore).toBeGreaterThan(smallResult!.breakdown.memberScore);
        });

        it('old organism gets higher age score', async () => {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

            const oldOrg = makeOrganism({
                id: 'org-old',
                members: ['alice@test-node-001'],
                createdAt: oneYearAgo.toISOString(),
            });
            const newOrg = makeOrganism({
                id: 'org-new',
                members: ['bob@test-node-001'],
                createdAt: new Date().toISOString(),
            });

            const organisms = new Map([
                ['org-old', oldOrg],
                ['org-new', newOrg],
            ]);
            const ghiis = new Map([
                ['alice@test-node-001', makeGHII('alice@test-node-001', 1)],
                ['bob@test-node-001', makeGHII('bob@test-node-001', 1)],
            ]);
            const storage = makeMockStorage({ organisms, ghiis });
            service = createOrganismReputationService(makeConfig(), storage);

            const oldResult = await service.calculateReputation('org-old');
            const newResult = await service.calculateReputation('org-new');
            expect(oldResult!.breakdown.ageScore).toBeGreaterThan(newResult!.breakdown.ageScore);
        });

        it('score is stored via setOrganismReputation', async () => {
            const org = makeOrganism({ id: 'org-1' });
            const organisms = new Map([['org-1', org]]);
            const storage = makeMockStorage({ organisms });
            service = createOrganismReputationService(makeConfig(), storage);

            await service.calculateReputation('org-1');
            expect(storage.setOrganismReputation).toHaveBeenCalledOnce();
            const calledWith = (storage.setOrganismReputation as ReturnType<typeof vi.fn>).mock.calls[0][0] as OrganismReputationRecord;
            expect(calledWith.organismId).toBe('org-1');
            expect(calledWith.calculatedAt).toBeTruthy();
        });

        it('breakdown scores are individually in 0-100 range', async () => {
            const org = makeOrganism({ id: 'org-1', members: ['alice@test-node-001'] });
            const organisms = new Map([['org-1', org]]);
            const ghiis = new Map([['alice@test-node-001', makeGHII('alice@test-node-001', 2)]]);
            const storage = makeMockStorage({ organisms, ghiis });
            service = createOrganismReputationService(makeConfig(), storage);

            const result = await service.calculateReputation('org-1');
            const bd = result!.breakdown;
            for (const [key, value] of Object.entries(bd)) {
                expect(value, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
                expect(value, `${key} should be <= 100`).toBeLessThanOrEqual(100);
            }
        });
    });
});

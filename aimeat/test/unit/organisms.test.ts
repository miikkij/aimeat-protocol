import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.js';
import type { OrganismRecord, OrganismMembershipRecord, JoinRequestRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeOrganism(overrides: Partial<OrganismRecord> = {}): OrganismRecord {
    return {
        id: `org-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Test Organism',
        description: 'A test community',
        type: 'community',
        location: { city: 'Helsinki', country: 'FI' },
        interests: ['AI', 'TypeScript'],
        creatorGhii: 'alice@test-node-001',
        admins: ['alice@test-node-001'],
        members: ['alice@test-node-001'],
        agentGaiis: [],
        boardId: 'board-test',
        joinPolicy: 'open',
        maxMembers: 100,
        visibility: 'public',
        moderationConfig: {
            flagsEnabled: true,
            autoHideThreshold: 5,
            appealsEnabled: false,
        },
        memoryNamespace: 'organism.test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeMembership(overrides: Partial<OrganismMembershipRecord> = {}): OrganismMembershipRecord {
    return {
        id: `mem-${Math.random().toString(36).slice(2, 10)}`,
        organismId: 'org-1',
        ghii: 'alice@test-node-001',
        role: 'member',
        status: 'active',
        joinedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeJoinRequest(overrides: Partial<JoinRequestRecord> = {}): JoinRequestRecord {
    return {
        id: `jr-${Math.random().toString(36).slice(2, 10)}`,
        organismId: 'org-1',
        ghii: 'bob@test-node-001',
        message: 'I would like to join',
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Organisms (InMemoryStorage)', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
    });

    it('creates organism and retrieves it', async () => {
        const org = makeOrganism({ id: 'org-1', name: 'AI Club' });
        const created = await storage.createOrganism(org);
        expect(created.id).toBe('org-1');
        expect(created.name).toBe('AI Club');

        const retrieved = await storage.getOrganism('org-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe('AI Club');
        expect(retrieved!.type).toBe('community');
    });

    it('returns null for non-existent organism', async () => {
        const result = await storage.getOrganism('nonexistent');
        expect(result).toBeNull();
    });

    it('lists organisms with type filter', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1', type: 'community' }));
        await storage.createOrganism(makeOrganism({ id: 'org-2', type: 'team' }));
        await storage.createOrganism(makeOrganism({ id: 'org-3', type: 'community' }));

        const communities = await storage.listOrganisms({ type: 'community' });
        expect(communities).toHaveLength(2);

        const teams = await storage.listOrganisms({ type: 'team' });
        expect(teams).toHaveLength(1);
    });

    it('lists organisms with city filter (case-insensitive)', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1', location: { city: 'Helsinki', country: 'FI' } }));
        await storage.createOrganism(makeOrganism({ id: 'org-2', location: { city: 'Tampere', country: 'FI' } }));

        const results = await storage.listOrganisms({ city: 'helsinki' });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('org-1');
    });

    it('lists organisms with interest filter (case-insensitive)', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1', interests: ['AI', 'Music'] }));
        await storage.createOrganism(makeOrganism({ id: 'org-2', interests: ['Art', 'Dance'] }));

        const results = await storage.listOrganisms({ interest: 'ai' });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('org-1');
    });

    it('filters organisms by visibility', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1', visibility: 'public' }));
        await storage.createOrganism(makeOrganism({ id: 'org-2', visibility: 'private' }));
        await storage.createOrganism(makeOrganism({ id: 'org-3', visibility: 'listed' }));

        const publicOrgs = await storage.listOrganisms({ visibility: 'public' });
        expect(publicOrgs).toHaveLength(1);
        expect(publicOrgs[0].id).toBe('org-1');

        const privateOrgs = await storage.listOrganisms({ visibility: 'private' });
        expect(privateOrgs).toHaveLength(1);
    });

    it('creates membership and checks getMembership', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1' }));
        const membership = makeMembership({ id: 'mem-1', organismId: 'org-1', ghii: 'alice@node' });
        await storage.createMembership(membership);

        const retrieved = await storage.getMembership('org-1', 'alice@node');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe('mem-1');
        expect(retrieved!.role).toBe('member');

        // Non-existent membership
        const missing = await storage.getMembership('org-1', 'nobody@node');
        expect(missing).toBeNull();
    });

    it('lists members by organism', async () => {
        await storage.createMembership(makeMembership({ id: 'mem-1', organismId: 'org-1', ghii: 'alice@node' }));
        await storage.createMembership(makeMembership({ id: 'mem-2', organismId: 'org-1', ghii: 'bob@node' }));
        await storage.createMembership(makeMembership({ id: 'mem-3', organismId: 'org-2', ghii: 'carol@node' }));

        const members = await storage.listMembers('org-1');
        expect(members).toHaveLength(2);

        const org2Members = await storage.listMembers('org-2');
        expect(org2Members).toHaveLength(1);
    });

    it('lists memberships by GHII', async () => {
        await storage.createMembership(makeMembership({ id: 'mem-1', organismId: 'org-1', ghii: 'alice@node' }));
        await storage.createMembership(makeMembership({ id: 'mem-2', organismId: 'org-2', ghii: 'alice@node' }));
        await storage.createMembership(makeMembership({ id: 'mem-3', organismId: 'org-3', ghii: 'bob@node' }));

        const aliceMemberships = await storage.listMembershipsByGhii('alice@node');
        expect(aliceMemberships).toHaveLength(2);

        const bobMemberships = await storage.listMembershipsByGhii('bob@node');
        expect(bobMemberships).toHaveLength(1);
    });

    it('creates and reviews join request', async () => {
        const jr = makeJoinRequest({ id: 'jr-1', organismId: 'org-1', ghii: 'bob@node' });
        await storage.createJoinRequest(jr);

        const pending = await storage.listJoinRequests('org-1', { status: 'pending' });
        expect(pending).toHaveLength(1);
        expect(pending[0].ghii).toBe('bob@node');

        // Approve join request
        const updated = await storage.updateJoinRequest('jr-1', {
            status: 'approved',
            reviewedBy: 'alice@node',
            reviewedAt: new Date().toISOString(),
        });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('approved');

        // No more pending
        const afterApproval = await storage.listJoinRequests('org-1', { status: 'pending' });
        expect(afterApproval).toHaveLength(0);
    });

    it('deletes organism with cascade (memberships and join requests)', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1' }));
        await storage.createMembership(makeMembership({ id: 'mem-1', organismId: 'org-1', ghii: 'alice@node' }));
        await storage.createMembership(makeMembership({ id: 'mem-2', organismId: 'org-1', ghii: 'bob@node' }));
        await storage.createJoinRequest(makeJoinRequest({ id: 'jr-1', organismId: 'org-1' }));

        // Verify data exists
        expect(await storage.listMembers('org-1')).toHaveLength(2);
        expect(await storage.listJoinRequests('org-1')).toHaveLength(1);

        // Delete organism
        const deleted = await storage.deleteOrganism('org-1');
        expect(deleted).toBe(true);

        // Verify cascade
        expect(await storage.getOrganism('org-1')).toBeNull();
        expect(await storage.listMembers('org-1')).toHaveLength(0);
        expect(await storage.listJoinRequests('org-1')).toHaveLength(0);
    });

    it('updates organism partial fields', async () => {
        await storage.createOrganism(makeOrganism({ id: 'org-1', name: 'Original' }));

        const updated = await storage.updateOrganism('org-1', {
            name: 'Updated Name',
            description: 'Updated description',
        });
        expect(updated).not.toBeNull();
        expect(updated!.name).toBe('Updated Name');
        expect(updated!.description).toBe('Updated description');
        expect(updated!.id).toBe('org-1'); // ID should not change

        // Verify persistence
        const retrieved = await storage.getOrganism('org-1');
        expect(retrieved!.name).toBe('Updated Name');
    });

    it('duplicate membership prevention check via getMembership', async () => {
        await storage.createMembership(makeMembership({ id: 'mem-1', organismId: 'org-1', ghii: 'alice@node' }));

        // Check if membership already exists before creating
        const existing = await storage.getMembership('org-1', 'alice@node');
        expect(existing).not.toBeNull();
        expect(existing!.id).toBe('mem-1');

        // A second membership for a different user should not conflict
        await storage.createMembership(makeMembership({ id: 'mem-2', organismId: 'org-1', ghii: 'bob@node' }));
        const bobMembership = await storage.getMembership('org-1', 'bob@node');
        expect(bobMembership).not.toBeNull();
        expect(bobMembership!.id).toBe('mem-2');
    });
});

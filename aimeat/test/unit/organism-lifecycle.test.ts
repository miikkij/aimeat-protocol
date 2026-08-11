/**
 * @file test/unit/organism-lifecycle.test.ts
 * @description Unit tests for services/organism-lifecycle.ts, the create/update/join/leave writes
 *   shared by the REST organism routes and the MCP organism tools. Each case pins one of the
 *   behaviours the two copies used to disagree about: the board owner, the approver notification on
 *   a join request, and update refusing an unrecognised enum instead of dropping it.
 * @structure describe('organism lifecycle') — create, update, join, leave.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-lifecycle.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 MCP audit step 8).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import {
    createOrganismRecord, updateOrganismRecord, joinOrganism, leaveOrganism,
} from '../../src/services/organism-lifecycle.js';

const NODE = 'test-node';
const CREATOR = 'creatorowner';
const JOINER = 'joinerowner';

function makeConfig(): AimeatConfig {
    return { nodeId: NODE, baseUrl: 'http://localhost:40050' } as AimeatConfig;
}

async function seedOwner(storage: SqliteStorage, ownerName: string): Promise<void> {
    await storage.createGHII({
        username: ownerName,
        nodeId: NODE,
        ghii: `${ownerName}@${NODE}`,
        displayName: ownerName,
        verificationLevel: 1,
        ownerName,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}

describe('organism lifecycle (shared by /v1/organisms and the aimeat_organism_* tools)', () => {
    let storage: SqliteStorage;
    let config: AimeatConfig;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        config = makeConfig();
        await seedOwner(storage, CREATOR);
        await seedOwner(storage, JOINER);
    });

    async function makeOrganism(policy: 'open' | 'approval_required' | 'invite_only') {
        const out = await createOrganismRecord({ storage, config }, CREATOR, {
            name: `Org ${policy}`, joinPolicy: policy, visibility: 'listed',
        });
        if (!out.ok) throw new Error(`setup create failed: ${out.message}`);
        return out.organism;
    }

    it('create refuses a name under two characters', async () => {
        const out = await createOrganismRecord({ storage, config }, CREATOR, { name: 'x' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(400);
        expect(out.code).toBe('INVALID_INPUT');
    });

    it('create writes the organism, the creator membership and a board owned by the creator', async () => {
        const out = await createOrganismRecord({ storage, config }, CREATOR, {
            name: '  Test Organism  ', description: 'a description', type: 'team', visibility: 'listed',
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;

        expect(out.organism.name).toBe('Test Organism');
        expect(out.organism.type).toBe('team');
        expect(out.organism.creatorGhii).toBe(CREATOR);
        expect(out.organism.members).toEqual([CREATOR]);

        const membership = await storage.getMembership(out.organism.id, CREATOR);
        expect(membership?.role).toBe('creator');
        expect(membership?.status).toBe('active');

        // The board belongs to the creator's GHII, never to the agent that happened to make the call:
        // routes/boards.ts compares ownerGaii by equality for update and delete.
        const board = await storage.getBoard(out.organism.boardId);
        expect(board?.ownerGaii).toBe(`${CREATOR}@${NODE}`);
        expect(board?.visibility).toBe('shared');
    });

    it('create falls back to the defaults for an unrecognised type or policy', async () => {
        const out = await createOrganismRecord({ storage, config }, CREATOR, {
            name: 'Fallbacks', type: 'guild', joinPolicy: 'whenever', visibility: 'secret',
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.organism.type).toBe('community');
        expect(out.organism.joinPolicy).toBe('open');
        expect(out.organism.visibility).toBe('public');
    });

    it('update refuses an unrecognised visibility instead of dropping it', async () => {
        const organism = await makeOrganism('open');
        const out = await updateOrganismRecord({ storage, config }, organism, { visibility: 'unlisted' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(400);
        expect(out.code).toBe('INVALID_INPUT');

        const stored = await storage.getOrganism(organism.id);
        expect(stored?.visibility).toBe('listed');
    });

    it('update applies the fields it accepts and reports the README write', async () => {
        const organism = await makeOrganism('open');
        const out = await updateOrganismRecord({ storage, config }, organism, {
            name: 'Renamed', joinPolicy: 'invite_only', interests: ['music'], readme: '# Hello',
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.organism.name).toBe('Renamed');
        expect(out.organism.joinPolicy).toBe('invite_only');
        expect(out.readmeSet).toBe(true);
        expect(out.readme).toBe('# Hello');
    });

    it('join activates a membership on an open organism and adds the joiner to members[]', async () => {
        const organism = await makeOrganism('open');
        const out = await joinOrganism({ storage, config }, organism, JOINER);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.outcome).toBe('joined');

        const membership = await storage.getMembership(organism.id, JOINER);
        expect(membership?.status).toBe('active');
        expect(membership?.role).toBe('member');
        const stored = await storage.getOrganism(organism.id);
        expect(stored?.members).toContain(JOINER);
    });

    it('join a second time refuses with ALREADY_MEMBER', async () => {
        const organism = await makeOrganism('open');
        await joinOrganism({ storage, config }, organism, JOINER);
        const again = await joinOrganism({ storage, config }, (await storage.getOrganism(organism.id))!, JOINER);
        expect(again.ok).toBe(false);
        if (again.ok) return;
        expect(again.status).toBe(409);
        expect(again.code).toBe('ALREADY_MEMBER');
    });

    it('join on an approval_required organism records the request AND notifies the creator', async () => {
        const organism = await makeOrganism('approval_required');
        const out = await joinOrganism({ storage, config }, organism, JOINER, 'please let me in');
        expect(out.ok).toBe(true);
        if (!out.ok || out.outcome !== 'pending') throw new Error('expected a pending join request');

        expect(out.joinRequest.status).toBe('pending');
        expect(out.joinRequest.message).toBe('please let me in');
        const requests = await storage.listJoinRequests(organism.id, { status: 'pending' });
        expect(requests).toHaveLength(1);

        // The notification is the half the MCP tool used to skip: without it the request waits until
        // an admin happens to open the list.
        const notifications = await storage.listMemory(`${CREATOR}@${NODE}`, { prefix: 'notif.' });
        const notif = notifications.find(r => (r.value as { type?: string })?.type === 'organism_join_request');
        expect(notif).toBeDefined();
        expect((notif!.value as { title: string }).title).toContain(JOINER);
    });

    it('join refuses an invite_only organism', async () => {
        const organism = await makeOrganism('invite_only');
        const out = await joinOrganism({ storage, config }, organism, JOINER);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(403);
        expect(out.code).toBe('INVITE_ONLY');
        expect(await storage.getMembership(organism.id, JOINER)).toBeNull();
    });

    it('join refuses a full organism with CAPACITY_FULL', async () => {
        const organism = await makeOrganism('open');
        await storage.updateOrganism(organism.id, { maxMembers: 1 });
        const out = await joinOrganism({ storage, config }, (await storage.getOrganism(organism.id))!, JOINER);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('CAPACITY_FULL');
    });

    it('leave refuses the creator: they delete the organism instead', async () => {
        const organism = await makeOrganism('open');
        const out = await leaveOrganism({ storage, config }, organism, CREATOR);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(400);
        expect(out.code).toBe('CREATOR_CANNOT_LEAVE');
    });

    it('leave refuses someone who is not a member', async () => {
        const organism = await makeOrganism('open');
        const out = await leaveOrganism({ storage, config }, organism, JOINER);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(404);
        expect(out.code).toBe('NOT_MEMBER');
    });

    it('leave deletes the membership and drops the leaver from members[] and admins[]', async () => {
        const organism = await makeOrganism('open');
        await joinOrganism({ storage, config }, organism, JOINER);
        const joined = (await storage.getOrganism(organism.id))!;
        await storage.updateOrganism(joined.id, { admins: [...joined.admins, JOINER] });

        const out = await leaveOrganism({ storage, config }, (await storage.getOrganism(organism.id))!, JOINER);
        expect(out.ok).toBe(true);
        expect(await storage.getMembership(organism.id, JOINER)).toBeNull();
        const stored = await storage.getOrganism(organism.id);
        expect(stored?.members).not.toContain(JOINER);
        expect(stored?.admins).not.toContain(JOINER);
    });
});

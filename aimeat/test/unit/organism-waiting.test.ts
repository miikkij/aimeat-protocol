/**
 * @file test/unit/organism-waiting.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/organism-read/waiting.ts against SqliteStorage(':memory:'): the list GET
 *   /v1/organisms/waiting gives (every pending approval of a member organism, whoever may decide it),
 *   and the two reads the list of everything that waits for a person asks, which keep only what that
 *   person can decide: an approval by the member's role, a member's suggestion by its own rule (the
 *   workspace's creator or an organism admin, never its author), nothing overdue, nothing of a team,
 *   and a join request only for an owner or an admin.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord, PendingApprovalRecord, JoinRequestRecord } from '../../src/storage/interface.js';
import { organismWaitingFor, approvalsToDecideFor, joinRequestsToReviewFor } from '../../src/services/organism-read/waiting.js';
import { MEMBER_CHANGE_ACTIONS } from '../../src/services/workspace/suggestion-notices.js';
import { TEAM_RECORD_TYPE, teamRecordKey } from '../../src/services/team/record.js';

const N = 'node-test';
const stamp = '2026-11-20T10:00:00.000Z';
const ORG = 'org-desk';
const TEAM = 'org-team';
const config = { nodeId: N } as unknown as AimeatConfig;

let sqlite: SqliteStorage;
let deps: { storage: Storage; config: AimeatConfig };
const who = (owner: string) => ({ owner, principal: `${owner}@${N}` });

const put = (key: string, value: unknown) => sqlite.setMemory({
    key, ownerGaii: `alice@${N}`, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
} as never);

async function organism(id: string, name: string, roles: Array<[string, string]>): Promise<void> {
    const members = roles.map(([n]) => n);
    await sqlite.createOrganism({
        id, name, description: 'x', type: 'project', interests: [], creatorGhii: 'alice', createdBy: 'alice', owners: ['alice'],
        admins: roles.filter(([, r]) => r === 'admin').map(([n]) => n), members, agentGaiis: [], boardId: `b-${id}`,
        joinPolicy: 'approval_required', maxMembers: 10, visibility: 'public',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${id}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    for (const [n, role] of roles) {
        await sqlite.createMembership({ id: `m-${id}-${n}`, organismId: id, ghii: n, role, status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    }
}

let seq = 0;
const approval = (organismId: string, over: Partial<PendingApprovalRecord>) => sqlite.createPendingApproval({
    id: `ap-${++seq}`, organismId, actor: `bob@${N}`, action: 'external-release', risk: 'medium', approverRole: 'owner',
    status: 'pending', createdAt: stamp, updatedAt: stamp, ...over,
} as PendingApprovalRecord);

beforeEach(async () => {
    seq = 0;
    sqlite = new SqliteStorage(':memory:');
    deps = { storage: sqlite as unknown as Storage, config };
    await organism(ORG, 'Desk', [['alice', 'creator'], ['bob', 'member'], ['carol', 'member'], ['dave', 'admin']]);
    // Two workspaces: alice made the first, carol the second.
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [
        { id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' },
        { id: 'ws2', name: 'Notes', createdAt: stamp, createdBy: 'carol' },
    ] });
});
afterEach(() => { sqlite.close(); });

describe('approvalsToDecideFor', () => {
    it('keeps an approval for the members whose role satisfies its approver role, per workspace', async () => {
        await approval(ORG, { approverRole: 'owner', arguments: { ws: 'ws1' } });
        await approval(ORG, { approverRole: 'admin', arguments: { ws: 'ws1' }, createdAt: '2026-11-22T10:00:00.000Z' });
        await approval(ORG, { approverRole: 'member', arguments: { ws: 'ws2' } });

        const alice = await approvalsToDecideFor(deps, who('alice'));
        expect(alice.map(r => [r.wsId, r.wsName, r.n]).sort()).toEqual([['ws1', 'Board', 2], ['ws2', 'Notes', 1]]);
        // The row is as old as its newest approval.
        expect(alice.find(r => r.wsId === 'ws1')!.at).toBe('2026-11-22T10:00:00.000Z');

        const dave = await approvalsToDecideFor(deps, who('dave'));
        expect(dave.map(r => [r.wsId, r.n]).sort()).toEqual([['ws1', 1], ['ws2', 1]]);

        const bob = await approvalsToDecideFor(deps, who('bob'));
        expect(bob.map(r => [r.wsId, r.n])).toEqual([['ws2', 1]]);
    });

    it('answers nothing to a person who is in no organism, and nothing when no approval is pending', async () => {
        expect(await approvalsToDecideFor(deps, who('erin'))).toEqual([]);
        expect(await approvalsToDecideFor(deps, who('alice'))).toEqual([]);
        await approval(ORG, { status: 'approved' });
        expect(await approvalsToDecideFor(deps, who('alice'))).toEqual([]);
    });

    it('leaves out an overdue approval and does not expire it', async () => {
        const overdue = await approval(ORG, { deadline: '2026-01-01T00:00:00.000Z' });
        expect(await approvalsToDecideFor(deps, who('alice'))).toEqual([]);
        expect((await sqlite.getPendingApproval(overdue.id))?.status).toBe('pending');
    });

    it("a member's suggestion is for the workspace's creator or an organism admin, never for its author", async () => {
        await approval(ORG, { action: MEMBER_CHANGE_ACTIONS.space, actor: `bob@${N}`, approverRole: 'admin', arguments: { ws: 'ws2' } });
        // carol made ws2, dave is an admin, alice is the creator of the organism.
        for (const name of ['carol', 'dave', 'alice']) {
            expect((await approvalsToDecideFor(deps, who(name))).map(r => [r.wsId, r.n]), name).toEqual([['ws2', 1]]);
        }
        expect(await approvalsToDecideFor(deps, who('bob')), 'the author').toEqual([]);

        // In ws1, which alice made, carol is a plain member and decides nothing.
        await approval(ORG, { action: MEMBER_CHANGE_ACTIONS.sections, actor: `bob@${N}`, approverRole: 'admin', arguments: { ws: 'ws1' } });
        expect((await approvalsToDecideFor(deps, who('carol'))).map(r => r.wsId)).toEqual(['ws2']);
        // An admin's own suggestion waits for somebody else.
        await approval(ORG, { action: MEMBER_CHANGE_ACTIONS.space, actor: `dave@${N}`, approverRole: 'admin', arguments: { ws: 'ws1' } });
        expect((await approvalsToDecideFor(deps, who('dave'))).map(r => [r.wsId, r.n]).sort()).toEqual([['ws1', 1], ['ws2', 1]]);
    });

    it("leaves out a team's approvals, which the team's own waiting read names", async () => {
        await organism(TEAM, 'Team', [['alice', 'creator']]);
        await put(teamRecordKey(TEAM), { type: TEAM_RECORD_TYPE, language: 'en', workspaces: { shared: 'a', decisions: 'b', waiting: 'c' }, names: {}, leadsPending: [] });
        await approval(TEAM, {});
        await approval(ORG, {});
        const rows = await approvalsToDecideFor(deps, who('alice'));
        expect(rows.map(r => r.orgId)).toEqual([ORG]);
    });
});

describe('joinRequestsToReviewFor', () => {
    const request = (ghii: string, over: Partial<JoinRequestRecord> = {}) => sqlite.createJoinRequest({
        id: `jr-${ghii}`, organismId: ORG, ghii, message: 'please', status: 'pending', createdAt: stamp, ...over,
    } as JoinRequestRecord);

    it('gives the open requests to an owner and an admin, and none to a plain member', async () => {
        await request('erin');
        await request('frank', { status: 'rejected' });
        for (const name of ['alice', 'dave']) {
            const got = await joinRequestsToReviewFor(deps, who(name));
            expect(got.map(g => [g.organism.id, g.requests.map(r => r.ghii)]), name).toEqual([[ORG, ['erin']]]);
        }
        expect(await joinRequestsToReviewFor(deps, who('bob'))).toEqual([]);
        expect(await joinRequestsToReviewFor(deps, who('erin'))).toEqual([]);
    });

    it('leaves out a request whose asker is a member already', async () => {
        await request('bob');
        await request('erin');
        const got = await joinRequestsToReviewFor(deps, who('alice'));
        expect(got.flatMap(g => g.requests.map(r => r.ghii))).toEqual(['erin']);
    });

    it('reads the requests of every organism the person runs in one statement', async () => {
        for (let i = 0; i < 30; i++) {
            await organism(`org-${i}`, `Org ${i}`, [['alice', 'creator']]);
            await sqlite.createJoinRequest({ id: `jr-${i}`, organismId: `org-${i}`, ghii: `guest${i}`, status: 'pending', createdAt: stamp } as JoinRequestRecord);
        }
        const calls: string[] = [];
        const counted = new Proxy(sqlite, {
            get(target, prop, receiver) {
                const v = Reflect.get(target, prop, receiver);
                if (typeof v !== 'function') return v;
                return (...args: unknown[]) => { calls.push(String(prop)); return (v as (...a: unknown[]) => unknown).apply(target, args); };
            },
        });
        const got = await joinRequestsToReviewFor({ storage: counted as unknown as Storage, config }, who('alice'));
        expect(got).toHaveLength(30);
        expect(calls.filter(c => c === 'listJoinRequestsForOrgs')).toHaveLength(1);
        expect(calls.filter(c => c === 'listJoinRequests')).toHaveLength(0);
    });
});

describe('organismWaitingFor, the answer of GET /v1/organisms/waiting', () => {
    it('counts every pending approval of a member organism for every member, and join requests for a manager', async () => {
        await approval(ORG, { approverRole: 'owner', arguments: { ws: 'ws1' } });
        await approval(ORG, { approverRole: 'owner', arguments: { ws: 'ws1' } });
        await sqlite.createJoinRequest({ id: 'jr-erin', organismId: ORG, ghii: 'erin', status: 'pending', createdAt: stamp } as JoinRequestRecord);
        await sqlite.createMembership({ id: 'm-inv', organismId: TEAM, ghii: 'bob', role: 'member', status: 'invited', joinedAt: stamp } as OrganismMembershipRecord);
        await organism(TEAM, 'Team', [['alice', 'creator']]);

        expect(await organismWaitingFor(deps, who('alice'))).toEqual([
            { kind: 'review', n: 2, orgId: ORG, orgName: 'Desk', wsId: 'ws1', wsName: 'Board' },
            { kind: 'join', n: 1, orgId: ORG, orgName: 'Desk' },
        ]);
        // bob may decide neither approval, and the route lists them for him as before; he manages
        // nothing, and he holds an invitation.
        expect(await organismWaitingFor(deps, who('bob'))).toEqual([
            { kind: 'review', n: 2, orgId: ORG, orgName: 'Desk', wsId: 'ws1', wsName: 'Board' },
            { kind: 'invite', orgName: 'Team', organismId: TEAM },
        ]);
    });
});

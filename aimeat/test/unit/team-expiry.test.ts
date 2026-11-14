/**
 * @file test/unit/team-expiry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team end sweep (services/team/expiry.ts) on an in-memory node: a temporary member
 *   whose day has passed leaves the team, the leads are told once a week before a member's day and
 *   a team's day, the last lead is never removed this way, and a team whose last day has passed is
 *   archived. A second sweep changes nothing.
 * @structure the fixtures (alice leads, bob is temporary, carol is near her day, a project team with
 *   one lead and an end day) · one test per rule
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (team setup T17).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { sweepTeamEnds } from '../../src/services/team/expiry.js';
import { readTeamRecordWithVersion, writeTeamRecord, TEAM_RECORD_TYPE, type TeamRecord } from '../../src/services/team/record.js';

const SALES = '0a1b2c3d-1111-4222-8333-944455556666';
const ATLAS = '0a1b2c3d-2222-4222-8333-944455556666';
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

let storage: Storage;
let config: AimeatConfig;

async function organism(id: string, owners: string[], members: string[]): Promise<void> {
    const now = new Date(NOW).toISOString();
    await storage.createOrganism({
        id, name: id === SALES ? 'Myyntitiimi' : 'Atlas', description: '', type: 'team', interests: [],
        creatorGhii: owners[0], createdBy: owners[0], owners, admins: [], members,
        agentGaiis: [], boardId: `board-${id.slice(9, 13)}`, joinPolicy: 'invite_only', maxMembers: 100, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${id}`, createdAt: now, updatedAt: now,
    });
    for (const m of members) {
        await storage.createMembership({ id: `m-${id.slice(9, 13)}-${m}`, organismId: id, ghii: m, role: owners.includes(m) ? 'creator' : 'member', status: 'active', joinedAt: now });
    }
}

async function team(id: string, extra: Partial<TeamRecord>): Promise<void> {
    const now = new Date(NOW).toISOString();
    await writeTeamRecord(storage, config, id, {
        type: TEAM_RECORD_TYPE, names: { fi: 'Tiimi' }, language: 'fi', kind: 'team',
        workspaces: { shared: 'ws-a', decisions: 'ws-b', waiting: 'ws-c' }, skill: null, leadsPending: [],
        createdBy: 'alice', createdAt: now, updatedAt: now, ...extra,
    }, null, 'alice');
}

async function notices(owner: string): Promise<string[]> {
    const rows = await storage.listMemory(`${owner}@${config.nodeId}`, { prefix: 'notif.' }) as MemoryRecord[];
    return rows.map(r => String((r.value as { type?: string }).type));
}

beforeAll(async () => {
    config = loadConfig().config;
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date(NOW).toISOString();
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
        await storage.createGHII({ username: name, nodeId: config.nodeId, ghii: `${name}@${config.nodeId}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    }
    await organism(SALES, ['alice'], ['alice', 'bob', 'carol']);
    await team(SALES, { until: { 'account:bob': day(-1), 'account:carol': day(3), 'account:alice': day(-2) } });
    await organism(ATLAS, ['dave'], ['dave']);
    await team(ATLAS, { endsOn: day(-1), createdBy: 'dave' });
    await sweepTeamEnds(storage, config, NOW);
});

describe('the team end sweep', () => {
    it('takes a temporary member out of the team after their day', async () => {
        expect((await storage.getMembership(SALES, 'bob'))?.status ?? 'gone').not.toBe('active');
        const read = await readTeamRecordWithVersion(storage, SALES);
        expect(read!.team.until?.['account:bob']).toBeUndefined();
    });

    it('tells the leads a week before a member\'s day, once', async () => {
        expect(await notices('alice')).toContain('team_member_ending');
        await sweepTeamEnds(storage, config, NOW + 60_000);
        expect((await notices('alice')).filter(t => t === 'team_member_ending')).toHaveLength(1);
        expect((await storage.getMembership(SALES, 'carol'))?.status).toBe('active');
    });

    it('never removes the last lead this way, and tells the leads', async () => {
        expect((await storage.getMembership(SALES, 'alice'))?.status).toBe('active');
        expect(await notices('alice')).toContain('team_member_last_lead');
    });

    it('archives a team whose last day has passed', async () => {
        const atlas = await storage.getOrganism(ATLAS);
        expect(atlas?.archived).toBe(true);
        // The team record is archived with the organism, so it is read with the archived rows.
        const { items } = await storage.listAllMemory({ prefix: `organism.${ATLAS}.meta.team`, archived: 'include' });
        const rec = items.find(r => r.key === `organism.${ATLAS}.meta.team`)?.value as TeamRecord | undefined;
        expect(rec?.endsOn).toBeUndefined();
        expect(rec?.endedOn).toBe(day(-1));
        expect(await notices('dave')).toContain('team_ended');
    });
});

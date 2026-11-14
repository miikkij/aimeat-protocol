/**
 * @file test/unit/team-weekly-report.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team's week to its leads (services/team/weekly-report.ts) on an in-memory node: a
 *   team with a decision this week and a matter waiting gets one notice per lead, in that lead's
 *   language, with the team's figures; a team with nothing new and nothing open gets none.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (team setup T8).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { runTeamWeeklyReports } from '../../src/services/team/weekly-report.js';
import { writeTeamRecord, TEAM_RECORD_TYPE } from '../../src/services/team/record.js';

const BUSY = '0b1b2c3d-1111-4222-8333-944455556666';
const QUIET = '0b1b2c3d-2222-4222-8333-944455556666';
const NOW = Date.parse('2026-11-13T14:05:00Z');

let storage: Storage;
let config: AimeatConfig;

async function put(key: string, owner: string, value: unknown, at: number): Promise<void> {
    const iso = new Date(at).toISOString();
    await storage.setMemory({ key, ownerGaii: `${owner}@${config.nodeId}`, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: iso, updatedAt: iso } as MemoryRecord);
}

async function team(id: string, lead: string, name: string): Promise<void> {
    const now = new Date(NOW).toISOString();
    await storage.createOrganism({
        id, name, description: '', type: 'team', interests: [],
        creatorGhii: lead, createdBy: lead, owners: [lead], admins: [], members: [lead],
        agentGaiis: [], boardId: `board-${id.slice(9, 13)}`, joinPolicy: 'invite_only', maxMembers: 100, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${id}`, createdAt: now, updatedAt: now,
    });
    await storage.createMembership({ id: `m-${id.slice(9, 13)}`, organismId: id, ghii: lead, role: 'creator', status: 'active', joinedAt: now });
    await writeTeamRecord(storage, config, id, {
        type: TEAM_RECORD_TYPE, names: { fi: name, en: `${name} (en)` }, language: 'fi', kind: 'team',
        workspaces: { shared: 'ws-s', decisions: 'ws-d', waiting: 'ws-w' }, skill: null, leadsPending: [],
        createdBy: lead, createdAt: now, updatedAt: now,
    }, null, lead);
}

async function notices(owner: string): Promise<{ type: string; title: string }[]> {
    const rows = await storage.listMemory(`${owner}@${config.nodeId}`, { prefix: 'notif.' }) as MemoryRecord[];
    return rows.map(r => r.value as { type: string; title: string });
}

beforeAll(async () => {
    config = loadConfig().config;
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date(NOW).toISOString();
    await storage.createGHII({ username: 'alice', nodeId: config.nodeId, ghii: `alice@${config.nodeId}`, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, locale: 'fi', createdAt: now, updatedAt: now });
    await storage.createGHII({ username: 'dave', nodeId: config.nodeId, ghii: `dave@${config.nodeId}`, displayName: 'dave', ownerName: 'dave', verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    await team(BUSY, 'alice', 'Myyntitiimi');
    await put(`organism.${BUSY}.w.ws-d.shared.decisions.d1`, 'alice', { id: 'd1', title: 'Ylläpito kuukausihintana', decision: 'kuukausihinta' }, NOW - 86_400_000);
    await put(`organism.${BUSY}.w.ws-d.shared.decisions.d0`, 'alice', { id: 'd0', title: 'Vanha päätös', decision: 'x' }, NOW - 20 * 86_400_000);
    await put(`organism.${BUSY}.w.ws-w.shared.waiting.w1`, 'alice', { id: 'w1', title: 'Lähetä tarjous', kind: 'send', status: 'open' }, NOW - 3_600_000);
    await team(QUIET, 'dave', 'Hiljainen');
    await runTeamWeeklyReports(storage, config, NOW);
});

describe('the team\'s weekly report', () => {
    it('reaches the lead once, in the lead\'s language, with this week\'s decision only', async () => {
        const mine = (await notices('alice')).filter(n => n.type === 'team_weekly');
        expect(mine).toHaveLength(1);
        expect(mine[0].title).toContain('tällä viikolla');
        expect(mine[0].title).toContain('Myyntitiimi');
        expect(mine[0].title).toContain('1 päätöstä');
    });

    it('says nothing for a team with nothing new and nothing open', async () => {
        expect((await notices('dave')).filter(n => n.type === 'team_weekly')).toHaveLength(0);
    });
});

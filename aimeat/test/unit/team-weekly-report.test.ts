/**
 * @file test/unit/team-weekly-report.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team's week to its leads (services/team/weekly-report.ts) on an in-memory node: a
 *   team with a decision this week and a matter waiting gets one notice per lead, in that lead's
 *   language, with the team's figures; a team with nothing new and nothing open gets none.
 * @version-history
 *   v1.1.0 — 2026-11-14 — A classified decision is named only to the lead inside its label's audience.
 *   v1.0.0 — 2026-11-14 — Initial (team setup T8).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { runTeamWeeklyReports } from '../../src/services/team/weekly-report.js';
import { writeTeamRecord, TEAM_RECORD_TYPE } from '../../src/services/team/record.js';
import { memoryTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { writePolicy } from '../../src/services/classification/policy-admin.js';

const LABELLED = '0b1b2c3d-3333-4222-8333-944455556666';
const BUSY = '0b1b2c3d-1111-4222-8333-944455556666';
const QUIET = '0b1b2c3d-2222-4222-8333-944455556666';
const NOW = Date.parse('2026-11-13T14:05:00Z');

let storage: Storage;
let config: AimeatConfig;

async function put(key: string, owner: string, value: unknown, at: number): Promise<void> {
    const iso = new Date(at).toISOString();
    await storage.setMemory({ key, ownerGaii: `${owner}@${config.nodeId}`, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: iso, updatedAt: iso } as MemoryRecord);
}

async function team(id: string, lead: string, name: string, coLeads: string[] = []): Promise<void> {
    const now = new Date(NOW).toISOString();
    await storage.createOrganism({
        id, name, description: '', type: 'team', interests: [],
        creatorGhii: lead, createdBy: lead, owners: [lead, ...coLeads], admins: [], members: [lead, ...coLeads],
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

async function notices(owner: string): Promise<{ type: string; title: string; body: string }[]> {
    const rows = await storage.listMemory(`${owner}@${config.nodeId}`, { prefix: 'notif.' }) as MemoryRecord[];
    return rows.map(r => r.value as { type: string; title: string; body: string });
}

beforeAll(async () => {
    config = { ...loadConfig().config, classificationMode: 'all' };
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date(NOW).toISOString();
    await storage.createGHII({ username: 'alice', nodeId: config.nodeId, ghii: `alice@${config.nodeId}`, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, locale: 'fi', createdAt: now, updatedAt: now });
    await storage.createGHII({ username: 'dave', nodeId: config.nodeId, ghii: `dave@${config.nodeId}`, displayName: 'dave', ownerName: 'dave', verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    await team(BUSY, 'alice', 'Myyntitiimi');
    await put(`organism.${BUSY}.w.ws-d.shared.decisions.d1`, 'alice', { id: 'd1', title: 'Ylläpito kuukausihintana', decision: 'kuukausihinta' }, NOW - 86_400_000);
    await put(`organism.${BUSY}.w.ws-d.shared.decisions.d0`, 'alice', { id: 'd0', title: 'Vanha päätös', decision: 'x' }, NOW - 20 * 86_400_000);
    await put(`organism.${BUSY}.w.ws-w.shared.waiting.w1`, 'alice', { id: 'w1', title: 'Lähetä tarjous', kind: 'send', status: 'open' }, NOW - 3_600_000);
    await team(QUIET, 'dave', 'Hiljainen');
    // A team with two leads and one decision whose label's audience is alice alone.
    await storage.createGHII({ username: 'bob', nodeId: config.nodeId, ghii: `bob@${config.nodeId}`, displayName: 'bob', ownerName: 'bob', verificationLevel: 0, totpEnabled: false, locale: 'en', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() });
    await team(LABELLED, 'alice', 'Johtoryhmä', ['bob']);
    const secretKey = `organism.${LABELLED}.w.ws-d.shared.decisions.s1`;
    await put(secretKey, 'alice', { id: 's1', title: 'Yrityskauppa etenee', decision: 'x' }, NOW - 86_400_000);
    const d = { storage, config };
    const alice: LabelActor = { principal: `alice@${config.nodeId}`, ownerGhii: `alice@${config.nodeId}`, ownerName: 'alice', kind: 'human' };
    await writePolicy(d, alice, 'organism', LABELLED, { labels: [{ id: 'johto', rank: 40, name: { en: 'Management only' }, audience: { people: ['alice'] } }] });
    await setLabel(d, alice, memoryTarget(`alice@${config.nodeId}`, secretKey), { label: 'johto' });
    await runTeamWeeklyReports(storage, config, NOW);
});

describe('the team\'s weekly report', () => {
    it('reaches the lead once, in the lead\'s language, with this week\'s decision only', async () => {
        const mine = (await notices('alice')).filter(n => n.type === 'team_weekly' && !n.title.includes('Johtoryhmä'));
        expect(mine).toHaveLength(1);
        expect(mine[0].title).toContain('tällä viikolla');
        expect(mine[0].title).toContain('Myyntitiimi');
        expect(mine[0].title).toContain('1 päätöstä');
    });

    it('names a classified decision only to the lead inside its audience, and counts it for both', async () => {
        const forAlice = (await notices('alice')).find(n => n.type === 'team_weekly' && n.title.includes('Johtoryhmä'));
        const forBob = (await notices('bob')).find(n => n.type === 'team_weekly');
        expect(forAlice?.body).toContain('Yrityskauppa etenee');
        expect(forBob?.title).toContain('1 decisions');
        expect(forBob?.body).not.toContain('Yrityskauppa');
    });

    it('says nothing for a team with nothing new and nothing open', async () => {
        expect((await notices('dave')).filter(n => n.type === 'team_weekly')).toHaveLength(0);
    });
});

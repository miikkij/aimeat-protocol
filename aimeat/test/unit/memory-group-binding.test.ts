/**
 * @file test/unit/memory-group-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A memory record stored as 'group' with no group, against a real SQLite store. No route
 *   can create one any more, so a row an older node stored is seeded directly: that row is what these
 *   tests are about. Writing to it still works and says what is wrong; naming a group or leaving
 *   'group' repairs it. Before it, the one rule the routes ask (memoryGroupRefusal).
 * @structure Two describes: memoryGroupRefusal() and writeMemoryRecord() over a stored row.
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-group-binding.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial. Red before the change: memoryGroupRefusal did not exist, and a write
 *     over a stored row carried no warning.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { memoryGroupRefusal } from '../../src/storage/memory-sharing.js';
import { writeMemoryRecord, type MemoryWriteInput } from '../../src/services/memory-write.js';

const NODE = 'aimeat-memory-group-binding-test';
const ALICE = `alice@${NODE}`;

let storage: Storage;
let config: AimeatConfig;

async function seed(key: string, visibility: MemoryRecord['visibility'], groupId?: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key, ownerGaii: ALICE, value: { v: 0 }, visibility, ...(groupId ? { groupId } : {}),
        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    } as MemoryRecord);
}
const write = (input: Omit<MemoryWriteInput, 'value' | 'tags' | 'ttlHours' | 'pipeline'> & { value?: unknown }) => writeMemoryRecord({ storage, config }, {
    principal: ALICE, targetGaii: ALICE, scopes: ['*'], roles: ['owner'],
}, { value: { v: 1 }, tags: [], ttlHours: null, pipeline: 'test', ...input });

beforeAll(() => {
    setThisNodeId(NODE);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE };
});

afterAll(() => { setThisNodeId(null); });

describe('memoryGroupRefusal', () => {
    const stored = (visibility: MemoryRecord['visibility'], groupId?: string) => ({ visibility, ...(groupId ? { groupId } : {}) });

    it('asks nothing of another visibility', () => {
        for (const v of ['private', 'owner', 'members', 'public', 'organism:o1', undefined, null, 7]) {
            expect(memoryGroupRefusal(v, undefined, null)).toBeNull();
        }
    });

    it('refuses group on a new record with no id, a blank id and a value that is no id', () => {
        for (const id of [undefined, null, '', '   ', 7, {}]) {
            expect(memoryGroupRefusal('group', id, null)).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
        }
    });

    it('refuses group on a record of another visibility, which has no group to keep', () => {
        expect(memoryGroupRefusal('group', undefined, stored('private'))).toMatchObject({ status: 400 });
    });

    it('admits a named group, and a record that already has one', () => {
        expect(memoryGroupRefusal('group', 'g1', null)).toBeNull();
        expect(memoryGroupRefusal('group', undefined, stored('group', 'g1'))).toBeNull();
    });

    it('admits a stored row with no group: the rewrite takes nobody away, and the write warns', () => {
        expect(memoryGroupRefusal('group', undefined, stored('group'))).toBeNull();
    });

    it('says what to send', () => {
        expect(memoryGroupRefusal('group', undefined, null)?.message).toContain('group_id');
    });
});

describe('writeMemoryRecord over a stored row with no group', () => {
    it('stores the new value and warns, so a running writer keeps working and learns what is wrong', async () => {
        await seed('stored/rewrite', 'group');
        const out = await write({ key: 'stored/rewrite', visibility: 'group', value: { v: 2 } });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.record.version).toBe(2);
        expect(out.warnings.map(w => w.code)).toContain('GROUP_NOT_NAMED');
        expect(out.warnings.find(w => w.code === 'GROUP_NOT_NAMED')?.message).toContain('group_id');
        expect((await storage.getMemory(ALICE, 'stored/rewrite'))?.value).toEqual({ v: 2 });
    });

    it('is repaired by naming a group, and then warns no more', async () => {
        await seed('stored/named', 'group');
        const out = await write({ key: 'stored/named', visibility: 'group', groupId: 'g1' });
        expect(out.ok && out.warnings.map(w => w.code)).not.toContain('GROUP_NOT_NAMED');
        expect((await storage.getMemory(ALICE, 'stored/named'))?.groupId).toBe('g1');
    });

    it('is repaired by leaving group', async () => {
        await seed('stored/private', 'group');
        const out = await write({ key: 'stored/private', visibility: 'private' });
        expect(out.ok && out.warnings.map(w => w.code)).not.toContain('GROUP_NOT_NAMED');
        expect((await storage.getMemory(ALICE, 'stored/private'))?.visibility).toBe('private');
    });

    it('warns of nothing on a bound record, whose group the rewrite keeps', async () => {
        await seed('stored/bound', 'group', 'g1');
        const out = await write({ key: 'stored/bound', visibility: 'group' });
        expect(out.ok && out.warnings.map(w => w.code)).not.toContain('GROUP_NOT_NAMED');
        expect((await storage.getMemory(ALICE, 'stored/bound'))?.groupId).toBe('g1');
    });

    it('refuses a new record naming no group, and stores nothing', async () => {
        const out = await write({ key: 'stored/new', visibility: 'group' });
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
        expect(await storage.getMemory(ALICE, 'stored/new')).toBeNull();
    });

    it('does not take a blank id for a group, on a row that has one', async () => {
        await seed('stored/blank', 'group', 'g1');
        await write({ key: 'stored/blank', visibility: 'group', groupId: '   ' });
        expect((await storage.getMemory(ALICE, 'stored/blank'))?.groupId).toBe('g1');
    });
});

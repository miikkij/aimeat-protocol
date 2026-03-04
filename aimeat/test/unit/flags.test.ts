import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { FlagRecord } from '../../src/storage/interface.js';

function makeFlag(overrides: Partial<FlagRecord> = {}): FlagRecord {
    return {
        id: `flag-${Math.random().toString(36).slice(2, 10)}`,
        targetType: 'memory',
        targetId: 'test-key-1',
        flaggedBy: 'agent1#owner1@node1',
        reason: 'spam',
        status: 'active',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe('Flags (SqliteStorage)', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('creates and retrieves a flag', async () => {
        const flag = makeFlag({ id: 'flag-1' });
        const created = await storage.createFlag(flag);
        expect(created.id).toBe('flag-1');

        const retrieved = await storage.getFlag('flag-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.targetType).toBe('memory');
        expect(retrieved!.reason).toBe('spam');
    });

    it('returns null for non-existent flag', async () => {
        const result = await storage.getFlag('nonexistent');
        expect(result).toBeNull();
    });

    it('lists flags by target type and id', async () => {
        await storage.createFlag(makeFlag({ id: 'f1', targetType: 'memory', targetId: 'key-A' }));
        await storage.createFlag(makeFlag({ id: 'f2', targetType: 'memory', targetId: 'key-A' }));
        await storage.createFlag(makeFlag({ id: 'f3', targetType: 'board_post', targetId: 'post-1' }));

        const memoryFlags = await storage.getFlagsByTarget('memory', 'key-A');
        expect(memoryFlags).toHaveLength(2);

        const boardFlags = await storage.getFlagsByTarget('board_post', 'post-1');
        expect(boardFlags).toHaveLength(1);

        const noFlags = await storage.getFlagsByTarget('memory', 'nonexistent');
        expect(noFlags).toHaveLength(0);
    });

    it('detects duplicate flag by user', async () => {
        await storage.createFlag(makeFlag({
            id: 'f1',
            targetType: 'memory',
            targetId: 'key-A',
            flaggedBy: 'agent1#owner1@node1',
        }));

        const existing = await storage.getFlagByUser('memory', 'key-A', 'agent1#owner1@node1');
        expect(existing).not.toBeNull();
        expect(existing!.id).toBe('f1');

        const noFlag = await storage.getFlagByUser('memory', 'key-A', 'agent2#owner2@node2');
        expect(noFlag).toBeNull();
    });

    it('computes flag summary with reason breakdown', async () => {
        const now = new Date();
        await storage.createFlag(makeFlag({
            id: 'f1', targetType: 'agent', targetId: 'agent-bad',
            reason: 'spam', createdAt: new Date(now.getTime() - 10000).toISOString(),
        }));
        await storage.createFlag(makeFlag({
            id: 'f2', targetType: 'agent', targetId: 'agent-bad',
            reason: 'spam', createdAt: new Date(now.getTime() - 5000).toISOString(),
        }));
        await storage.createFlag(makeFlag({
            id: 'f3', targetType: 'agent', targetId: 'agent-bad',
            reason: 'inappropriate', createdAt: now.toISOString(),
        }));

        const summary = await storage.getFlagSummary('agent', 'agent-bad');
        expect(summary).not.toBeNull();
        expect(summary!.totalFlags).toBe(3);
        expect(summary!.byReason.spam).toBe(2);
        expect(summary!.byReason.inappropriate).toBe(1);
        expect(summary!.latestFlag).toBe(now.toISOString());
    });

    it('returns null summary for unflagged target', async () => {
        const summary = await storage.getFlagSummary('memory', 'clean-key');
        expect(summary).toBeNull();
    });

    it('updates flag status (dismiss / action)', async () => {
        await storage.createFlag(makeFlag({ id: 'f1' }));

        const dismissed = await storage.updateFlag('f1', {
            status: 'dismissed',
            reviewedBy: 'operator#admin@node1',
            reviewedAt: new Date().toISOString(),
        });
        expect(dismissed).not.toBeNull();
        expect(dismissed!.status).toBe('dismissed');
        expect(dismissed!.reviewedBy).toBe('operator#admin@node1');

        // Verify persistence
        const retrieved = await storage.getFlag('f1');
        expect(retrieved!.status).toBe('dismissed');
    });

    it('lists flags with status and targetType filters', async () => {
        await storage.createFlag(makeFlag({ id: 'f1', status: 'active', targetType: 'memory' }));
        await storage.createFlag(makeFlag({ id: 'f2', status: 'dismissed', targetType: 'memory' }));
        await storage.createFlag(makeFlag({ id: 'f3', status: 'active', targetType: 'board_post' }));

        const activeFlags = await storage.listFlags({ status: 'active' });
        expect(activeFlags).toHaveLength(2);

        const memoryFlags = await storage.listFlags({ targetType: 'memory' });
        expect(memoryFlags).toHaveLength(2);

        const activeMemory = await storage.listFlags({ status: 'active', targetType: 'memory' });
        expect(activeMemory).toHaveLength(1);
        expect(activeMemory[0].id).toBe('f1');
    });

    it('paginates flag listing', async () => {
        for (let i = 0; i < 5; i++) {
            await storage.createFlag(makeFlag({
                id: `f${i}`,
                createdAt: new Date(Date.now() - i * 1000).toISOString(),
            }));
        }

        const page1 = await storage.listFlags({ page: 1, perPage: 2 });
        expect(page1).toHaveLength(2);

        const page2 = await storage.listFlags({ page: 2, perPage: 2 });
        expect(page2).toHaveLength(2);

        const page3 = await storage.listFlags({ page: 3, perPage: 2 });
        expect(page3).toHaveLength(1);
    });
});

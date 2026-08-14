import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AppealRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeAppeal(overrides: Partial<AppealRecord> = {}): AppealRecord {
    return {
        id: `appeal-${Math.random().toString(36).slice(2, 10)}`,
        flagId: `flag-${Math.random().toString(36).slice(2, 10)}`,
        appealedBy: 'alice@test-node-001',
        reason: 'This content was flagged incorrectly',
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('Appeals (SqliteStorage)', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('creates appeal and retrieves it', async () => {
        const appeal = makeAppeal({ id: 'appeal-1', flagId: 'flag-1' });
        const created = await storage.createAppeal(appeal);
        expect(created.id).toBe('appeal-1');
        expect(created.status).toBe('pending');

        const retrieved = await storage.getAppeal('appeal-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.flagId).toBe('flag-1');
        expect(retrieved!.appealedBy).toBe('alice@test-node-001');
    });

    it('returns null for non-existent appeal', async () => {
        const result = await storage.getAppeal('nonexistent');
        expect(result).toBeNull();
    });

    it('gets appeal by flag ID', async () => {
        await storage.createAppeal(makeAppeal({ id: 'appeal-1', flagId: 'flag-42' }));
        await storage.createAppeal(makeAppeal({ id: 'appeal-2', flagId: 'flag-99' }));

        const found = await storage.getAppealByFlagId('flag-42');
        expect(found).not.toBeNull();
        expect(found!.id).toBe('appeal-1');

        const notFound = await storage.getAppealByFlagId('flag-nonexistent');
        expect(notFound).toBeNull();
    });

    it('lists appeals filtered by status', async () => {
        await storage.createAppeal(makeAppeal({ id: 'a1', status: 'pending', createdAt: new Date(Date.now() - 3000).toISOString() }));
        await storage.createAppeal(makeAppeal({ id: 'a2', status: 'upheld', createdAt: new Date(Date.now() - 2000).toISOString() }));
        await storage.createAppeal(makeAppeal({ id: 'a3', status: 'pending', createdAt: new Date(Date.now() - 1000).toISOString() }));
        await storage.createAppeal(makeAppeal({ id: 'a4', status: 'overturned', createdAt: new Date().toISOString() }));

        const pending = await storage.listAppeals({ status: 'pending' });
        expect(pending).toHaveLength(2);

        const upheld = await storage.listAppeals({ status: 'upheld' });
        expect(upheld).toHaveLength(1);
        expect(upheld[0].id).toBe('a2');

        const overturned = await storage.listAppeals({ status: 'overturned' });
        expect(overturned).toHaveLength(1);
    });

    it('updates appeal (upheld)', async () => {
        await storage.createAppeal(makeAppeal({ id: 'appeal-1', flagId: 'flag-1' }));

        const updated = await storage.updateAppeal('appeal-1', {
            status: 'upheld',
            reviewedBy: 'operator@test-node-001',
            reviewNote: 'Flag confirmed after review',
            reviewedAt: new Date().toISOString(),
        });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('upheld');
        expect(updated!.reviewedBy).toBe('operator@test-node-001');
        expect(updated!.reviewNote).toBe('Flag confirmed after review');

        // Verify persistence
        const retrieved = await storage.getAppeal('appeal-1');
        expect(retrieved!.status).toBe('upheld');
    });

    it('updates appeal (overturned)', async () => {
        await storage.createAppeal(makeAppeal({ id: 'appeal-2', flagId: 'flag-2' }));

        const updated = await storage.updateAppeal('appeal-2', {
            status: 'overturned',
            reviewedBy: 'operator@test-node-001',
            reviewNote: 'Flag was incorrect, content restored',
            reviewedAt: new Date().toISOString(),
        });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('overturned');
    });

    it('returns null when updating non-existent appeal', async () => {
        const result = await storage.updateAppeal('nonexistent', { status: 'upheld' });
        expect(result).toBeNull();
    });

    it('prevents duplicate appeals for same flag via getAppealByFlagId check', async () => {
        await storage.createAppeal(makeAppeal({ id: 'appeal-1', flagId: 'flag-1' }));

        // Check if appeal already exists for this flag
        const existing = await storage.getAppealByFlagId('flag-1');
        expect(existing).not.toBeNull();
        expect(existing!.id).toBe('appeal-1');

        // A different flag should have no appeal
        const noAppeal = await storage.getAppealByFlagId('flag-2');
        expect(noAppeal).toBeNull();
    });

    it('lists appeals with pagination', async () => {
        for (let i = 0; i < 5; i++) {
            await storage.createAppeal(makeAppeal({
                id: `appeal-${i}`,
                createdAt: new Date(Date.now() - i * 1000).toISOString(),
            }));
        }

        const page1 = await storage.listAppeals({ page: 1, perPage: 2 });
        expect(page1).toHaveLength(2);

        const page2 = await storage.listAppeals({ page: 2, perPage: 2 });
        expect(page2).toHaveLength(2);

        const page3 = await storage.listAppeals({ page: 3, perPage: 2 });
        expect(page3).toHaveLength(1);
    });
});

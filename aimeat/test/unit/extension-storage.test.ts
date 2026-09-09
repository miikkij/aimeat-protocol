import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ExtensionRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeExtension(overrides: Partial<ExtensionRecord> = {}): ExtensionRecord {
    return {
        name: 'test-extension',
        version: '1.0.0',
        description: 'A test extension',
        author: 'test-author',
        status: 'inactive',
        requiredApis: ['wallet', 'memory'],
        actions: [
            {
                id: 'action-1',
                method: 'POST',
                path: '/v1/ext/test-extension/action-1',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                scriptContent: 'export default async function(ctx) { return {}; }',
            },
        ],
        config: { retryCount: 3 },
        limits: {
            memoryMb: 64,
            timeoutMs: 5000,
            maxApiCalls: 100,
        },
        federation: {
            advertise: false,
            capabilities: ['marketplace'],
        },
        installedBy: 'operator',
        installedAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Extension Tests ─────────────────────────────────────────

describe('ExtensionRecord (SqliteStorage)', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('creates and retrieves an extension record', async () => {
        const ext = makeExtension({ name: 'marketplace-behaviors' });
        const created = await storage.createExtension(ext);
        expect(created.name).toBe('marketplace-behaviors');
        expect(created.status).toBe('inactive');
        expect(created.requiredApis).toEqual(['wallet', 'memory']);

        const retrieved = await storage.getExtension('marketplace-behaviors');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe('marketplace-behaviors');
        expect(retrieved!.version).toBe('1.0.0');
        expect(retrieved!.actions).toHaveLength(1);
    });

    it('returns null for non-existent extension', async () => {
        const result = await storage.getExtension('nonexistent');
        expect(result).toBeNull();
    });

    it('lists extensions with status filter', async () => {
        await storage.createExtension(makeExtension({ name: 'ext-a', status: 'active' }));
        await storage.createExtension(makeExtension({ name: 'ext-b', status: 'inactive' }));
        await storage.createExtension(makeExtension({ name: 'ext-c', status: 'active' }));

        const all = await storage.listExtensions();
        expect(all).toHaveLength(3);

        const active = await storage.listExtensions({ status: 'active' });
        expect(active).toHaveLength(2);
        expect(active.every(e => e.status === 'active')).toBe(true);

        const inactive = await storage.listExtensions({ status: 'inactive' });
        expect(inactive).toHaveLength(1);
        expect(inactive[0].name).toBe('ext-b');
    });

    it('updates extension status', async () => {
        await storage.createExtension(makeExtension({ name: 'ext-update' }));

        const updated = await storage.updateExtension('ext-update', {
            status: 'active',
            activatedAt: new Date().toISOString(),
        });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe('active');
        expect(updated!.activatedAt).toBeDefined();

        // Verify persisted
        const retrieved = await storage.getExtension('ext-update');
        expect(retrieved!.status).toBe('active');
    });

    it('returns null when updating non-existent extension', async () => {
        const result = await storage.updateExtension('nonexistent', { status: 'active' });
        expect(result).toBeNull();
    });

    it('deletes an extension', async () => {
        await storage.createExtension(makeExtension({ name: 'ext-delete' }));

        const deleted = await storage.deleteExtension('ext-delete');
        expect(deleted).toBe(true);

        const retrieved = await storage.getExtension('ext-delete');
        expect(retrieved).toBeNull();
    });

    it('returns false when deleting non-existent extension', async () => {
        const result = await storage.deleteExtension('nonexistent');
        expect(result).toBe(false);
    });
});

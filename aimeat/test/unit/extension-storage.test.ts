import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.js';
import type { ExtensionRecord, EscrowHoldRecord } from '../../src/storage/interface.js';

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

function makeEscrowHold(overrides: Partial<EscrowHoldRecord> = {}): EscrowHoldRecord {
    return {
        holdId: `hold-${Math.random().toString(36).slice(2, 10)}`,
        fromGaii: 'agent-1@test-node',
        amount: 100,
        reason: 'marketplace-escrow',
        status: 'held',
        extensionName: 'test-extension',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Extension Tests ─────────────────────────────────────────

describe('ExtensionRecord (InMemoryStorage)', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
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

// ── Escrow Hold Tests ───────────────────────────────────────

describe('EscrowHoldRecord (InMemoryStorage)', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
        storage = new InMemoryStorage();
    });

    it('creates and retrieves an escrow hold', async () => {
        const hold = makeEscrowHold({ holdId: 'hold-1', amount: 250 });
        const created = await storage.createEscrowHold(hold);
        expect(created.holdId).toBe('hold-1');
        expect(created.amount).toBe(250);
        expect(created.status).toBe('held');

        const retrieved = await storage.getEscrowHold('hold-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.holdId).toBe('hold-1');
        expect(retrieved!.fromGaii).toBe('agent-1@test-node');
        expect(retrieved!.extensionName).toBe('test-extension');
    });

    it('returns null for non-existent escrow hold', async () => {
        const result = await storage.getEscrowHold('nonexistent');
        expect(result).toBeNull();
    });

    it('lists escrow holds by gaii', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h1', fromGaii: 'agent-a@node' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h2', fromGaii: 'agent-a@node' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h3', fromGaii: 'agent-b@node' }));

        const agentA = await storage.listEscrowHolds('agent-a@node');
        expect(agentA).toHaveLength(2);

        const agentB = await storage.listEscrowHolds('agent-b@node');
        expect(agentB).toHaveLength(1);
        expect(agentB[0].holdId).toBe('h3');
    });

    it('lists escrow holds filtered by status', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h1', fromGaii: 'agent-a@node', status: 'held' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h2', fromGaii: 'agent-a@node', status: 'released' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h3', fromGaii: 'agent-a@node', status: 'held' }));

        const held = await storage.listEscrowHolds('agent-a@node', { status: 'held' });
        expect(held).toHaveLength(2);

        const released = await storage.listEscrowHolds('agent-a@node', { status: 'released' });
        expect(released).toHaveLength(1);
        expect(released[0].holdId).toBe('h2');
    });

    it('releases an escrow hold', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'hold-release' }));

        const released = await storage.releaseEscrowHold('hold-release', 'seller@test-node');
        expect(released).not.toBeNull();
        expect(released!.status).toBe('released');
        expect(released!.releasedTo).toBe('seller@test-node');
        expect(released!.releasedAt).toBeDefined();

        // Verify persisted
        const retrieved = await storage.getEscrowHold('hold-release');
        expect(retrieved!.status).toBe('released');
    });

    it('returns null when releasing non-existent hold', async () => {
        const result = await storage.releaseEscrowHold('nonexistent', 'someone@node');
        expect(result).toBeNull();
    });

    it('refunds an escrow hold', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'hold-refund' }));

        const refunded = await storage.refundEscrowHold('hold-refund');
        expect(refunded).not.toBeNull();
        expect(refunded!.status).toBe('refunded');
        expect(refunded!.releasedAt).toBeDefined();

        // Verify persisted
        const retrieved = await storage.getEscrowHold('hold-refund');
        expect(retrieved!.status).toBe('refunded');
    });

    it('returns null when refunding non-existent hold', async () => {
        const result = await storage.refundEscrowHold('nonexistent');
        expect(result).toBeNull();
    });
});

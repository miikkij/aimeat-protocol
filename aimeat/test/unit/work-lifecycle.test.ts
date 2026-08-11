import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord, WorkRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { acceptWork, deliverWork } from '../../src/services/work-lifecycle.js';
import { holdEscrow } from '../../src/services/morsel.js';

// The accept/deliver rules these cover used to live twice: once in routes/work.ts and once in
// mcp/core.ts. The point of the suite is the shared function, so both doors are covered at once.

const REQUESTER = 'requester#reqowner@test-node';
const PROVIDER = 'provider#provowner@test-node';
const OUTSIDER = 'outsider#outowner@test-node';

function makeAgent(gaii: string, name: string): AgentRecord {
    return {
        name,
        owner: gaii.split('#')[1].split('@')[0],
        gaii,
        capabilities: [],
        publicKey: 'dGVzdA==',
        trustScore: 50,
        morselBalance: 0,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
    };
}

function makeWork(overrides: Partial<WorkRecord> = {}): WorkRecord {
    return {
        trackingCode: 'wk-lifecycle',
        status: 'pending',
        actionId: 'action-1',
        providerGaii: PROVIDER,
        requesterGaii: REQUESTER,
        input: { q: 'hello' },
        cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        ttlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeConfig(): AimeatConfig {
    return {
        nodeId: 'test-node',
        burnRate: 0.1,
        webhookMaxRetries: 1,
    } as AimeatConfig;
}

async function seedOwner(storage: SqliteStorage, ownerName: string): Promise<void> {
    await storage.createGHII({
        username: ownerName,
        nodeId: 'test-node',
        ghii: `${ownerName}@test-node`,
        displayName: ownerName,
        verificationLevel: 1,
        ownerName,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}

async function balOf(storage: SqliteStorage, identity: string): Promise<number> {
    const ghii = storage.resolveGhii(identity);
    if (!ghii) return 0;
    const rec = await storage.getGHII(ghii);
    return rec?.morselBalance ?? 0;
}

describe('work lifecycle (shared by POST /v1/work/:tc/accept and aimeat_work_accept)', () => {
    let storage: SqliteStorage;
    let config: AimeatConfig;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        config = makeConfig();
        await storage.createAgent(makeAgent(REQUESTER, 'requester'));
        await storage.createAgent(makeAgent(PROVIDER, 'provider'));
        await storage.createAgent(makeAgent(OUTSIDER, 'outsider'));
        await seedOwner(storage, 'reqowner');
        await seedOwner(storage, 'provowner');
        await seedOwner(storage, 'outowner');
        await storage.creditBalance(REQUESTER, 1000);
        await storage.createWork(makeWork());
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-lifecycle', 110);
    });

    it('accept refuses an unknown tracking code with NOT_FOUND', async () => {
        const out = await acceptWork({ storage, config }, PROVIDER, 'wk-nope');
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(404);
        expect(out.code).toBe('NOT_FOUND');
    });

    it('accept refuses anyone but the provider of record', async () => {
        const out = await acceptWork({ storage, config }, OUTSIDER, 'wk-lifecycle');
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(403);
        expect(out.code).toBe('ACCESS_DENIED');

        const work = await storage.getWork('wk-lifecycle');
        expect(work!.status).toBe('pending');
    });

    it('accept stores the accepted status and returns the updated record', async () => {
        const out = await acceptWork({ storage, config }, PROVIDER, 'wk-lifecycle');
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.work.status).toBe('accepted');

        const stored = await storage.getWork('wk-lifecycle');
        expect(stored!.status).toBe('accepted');
    });

    it('accept a second time refuses with CONFLICT and names the status', async () => {
        await acceptWork({ storage, config }, PROVIDER, 'wk-lifecycle');
        const out = await acceptWork({ storage, config }, PROVIDER, 'wk-lifecycle');
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(409);
        expect(out.code).toBe('CONFLICT');
        expect(out.message).toContain('accepted');
    });

    it('deliver refuses a pending item: it has to be accepted first', async () => {
        const out = await deliverWork({ storage, config }, PROVIDER, 'wk-lifecycle', { answer: 42 });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(409);
        expect(out.code).toBe('CONFLICT');

        // Nothing settled: the requester's escrow is still held and the provider was not paid.
        expect(await balOf(storage, PROVIDER)).toBe(0);
    });

    it('deliver refuses anyone but the provider of record', async () => {
        await acceptWork({ storage, config }, PROVIDER, 'wk-lifecycle');
        const out = await deliverWork({ storage, config }, OUTSIDER, 'wk-lifecycle', { answer: 42 });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(403);
        expect(out.code).toBe('ACCESS_DENIED');
        expect(await balOf(storage, PROVIDER)).toBe(0);
    });

    it('deliver settles the escrow and stores the output', async () => {
        await acceptWork({ storage, config }, PROVIDER, 'wk-lifecycle');
        const out = await deliverWork({ storage, config }, PROVIDER, 'wk-lifecycle', { answer: 42 });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.work.status).toBe('delivered');
        expect(out.work.output).toEqual({ answer: 42 });

        const stored = await storage.getWork('wk-lifecycle');
        expect(stored!.status).toBe('delivered');
        expect(stored!.output).toEqual({ answer: 42 });

        // The provider is paid the base price, and the requester keeps what escrow did not take.
        expect(await balOf(storage, PROVIDER)).toBe(100);
        expect(await balOf(storage, REQUESTER)).toBe(890);
    });
});

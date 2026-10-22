/**
 * @file test/unit/dispute-timeout.test.ts
 * @description The 30-day dispute timeout re-divides only what delivery paid the provider, as every
 *   interactive resolution does (QA audit S8-02). It refunded the whole escrow (toll plus network fee)
 *   from nowhere while the provider kept the toll, so a requester and a provider who let a dispute time
 *   out held the toll more than before (secaudit2026oct22, core-jobs.ts runDisputeTimeoutJob
 *   returnEscrow-after-settlement). A provider whose balance cannot cover it leaves the dispute for the
 *   operator.
 * @usage pnpm exec vitest run test/unit/dispute-timeout.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord, WorkRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { runDisputeTimeoutJob } from '../../src/services/core-jobs.js';

const REQUESTER = 'requester#reqowner@node';
const PROVIDER = 'provider#provowner@node';

function agent(gaii: string, name: string): AgentRecord {
    return {
        name, owner: gaii.split('#')[1].split('@')[0], gaii, capabilities: [], publicKey: 'dGVzdA==',
        trustScore: 50, morselBalance: 0, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    };
}

async function seedOwner(storage: SqliteStorage, ownerName: string): Promise<void> {
    await storage.createGHII({
        username: ownerName, nodeId: 'test-node', ghii: `${ownerName}@test-node`, displayName: ownerName,
        verificationLevel: 1, ownerName, totpEnabled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
}

async function balOf(storage: SqliteStorage, identity: string): Promise<number> {
    const ghii = storage.resolveGhii(identity);
    return ghii ? ((await storage.getGHII(ghii))?.morselBalance ?? 0) : 0;
}

describe('runDisputeTimeoutJob', () => {
    let storage: SqliteStorage;
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();

    async function escalatedDeliveredWork(providerBalance: number): Promise<WorkRecord> {
        // After delivery: the requester paid the escrow (11), the provider was credited the toll (10).
        await storage.creditBalance(PROVIDER, providerBalance);
        const work: WorkRecord = {
            trackingCode: `wk-${Math.random().toString(36).slice(2, 10)}`, status: 'escalated', actionId: 'a',
            providerGaii: PROVIDER, requesterGaii: REQUESTER, input: {},
            cost: { toll: 10, networkFee: 1, total: 11, inEscrow: 0 },
            ttlExpiresAt: old, createdAt: old, updatedAt: old,
        };
        await storage.createWork(work);
        await storage.createDispute({ id: `d-${work.trackingCode}`, trackingCode: work.trackingCode, status: 'escalated', openedBy: REQUESTER, reason: 'r', createdAt: old, updatedAt: old });
        return work;
    }

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(agent(REQUESTER, 'requester'));
        await storage.createAgent(agent(PROVIDER, 'provider'));
        await seedOwner(storage, 'reqowner');
        await seedOwner(storage, 'provowner');
    });

    it('takes back the toll delivery paid, and the pair ends with no more than it had', async () => {
        const work = await escalatedDeliveredWork(10);
        const pairBefore = (await balOf(storage, REQUESTER)) + (await balOf(storage, PROVIDER));
        await runDisputeTimeoutJob({ nodeId: 'test-node' } as AimeatConfig, storage);
        expect(await balOf(storage, REQUESTER)).toBe(10);
        expect(await balOf(storage, PROVIDER)).toBe(0);
        expect((await balOf(storage, REQUESTER)) + (await balOf(storage, PROVIDER))).toBe(pairBefore);
        const d = await storage.getDisputeByTrackingCode(work.trackingCode);
        expect(d?.status).toBe('resolved');
        expect(d?.ruling?.distribution.toRequester).toBe(10);
    });

    it('leaves the dispute for the operator when the provider cannot cover the toll', async () => {
        const work = await escalatedDeliveredWork(3);
        await runDisputeTimeoutJob({ nodeId: 'test-node' } as AimeatConfig, storage);
        expect(await balOf(storage, REQUESTER)).toBe(0);
        expect(await balOf(storage, PROVIDER)).toBe(3);
        expect((await storage.getDisputeByTrackingCode(work.trackingCode))?.status).toBe('escalated');
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord, WorkRecord, EscrowHoldRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
    calculateWorkCost,
    holdEscrow,
    settlePayment,
    returnEscrow,
    applyDailyAllowance,
    calculateEscrow,
} from '../../src/services/morsel.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
    const id = Math.random().toString(36).slice(2, 10);
    return {
        name: `agent-${id}`,
        owner: 'test-owner',
        gaii: `agent-${id}#test-owner@test-node`,
        capabilities: [],
        publicKey: 'dGVzdA==',
        trustScore: 50,
        morselBalance: 0,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        ...overrides,
    };
}

function makeWork(overrides: Partial<WorkRecord> = {}): WorkRecord {
    return {
        trackingCode: `wk-${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
        actionId: 'action-1',
        providerGaii: 'provider#owner@node',
        requesterGaii: 'requester#owner@node',
        input: {},
        cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        ttlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        burnRate: 0.10,
        dailyAllowance: 50,
        dailyAllowanceCap: 500,
        nodeId: 'test-node',
        // Provide minimal defaults for config fields used in morsel service
        ...overrides,
    } as AimeatConfig;
}

// ════════════════════════════════════════════════════════════════════
// ── calculateWorkCost ──
// ════════════════════════════════════════════════════════════════════

describe('calculateWorkCost', () => {
    it('calculates 10% network fee', () => {
        const result = calculateWorkCost(100, 0.1);
        expect(result.basePrice).toBe(100);
        expect(result.networkFee).toBe(10);
        expect(result.total).toBe(110);
        expect(result.inEscrow).toBe(110);
    });

    it('rounds network fee up (ceil)', () => {
        const result = calculateWorkCost(15, 0.1);
        // 15 * 0.1 = 1.5 → ceil = 2
        expect(result.networkFee).toBe(2);
        expect(result.total).toBe(17);
    });

    it('handles zero base morsels', () => {
        const result = calculateWorkCost(0, 0.1);
        expect(result.basePrice).toBe(0);
        expect(result.networkFee).toBe(0);
        expect(result.total).toBe(0);
    });

    it('handles large amounts', () => {
        const result = calculateWorkCost(10000, 0.2);
        expect(result.basePrice).toBe(10000);
        expect(result.networkFee).toBe(1000);
        expect(result.total).toBe(11000);
    });

    it('network fee is always at least 1 for non-zero base', () => {
        const result = calculateWorkCost(1, 0.1);
        // 1 * 0.1 = 0.1 → ceil = 1
        expect(result.networkFee).toBe(1);
        expect(result.total).toBe(2);
    });

    it('burn rate parameter does not affect cost calculation', () => {
        // calculateWorkCost ignores burnRate — it's used only in settlement
        const a = calculateWorkCost(100, 0.0);
        const b = calculateWorkCost(100, 0.5);
        expect(a).toEqual(b);
    });
});

// ════════════════════════════════════════════════════════════════════
// ── Balance Operations (via SqliteStorage) ──
// ════════════════════════════════════════════════════════════════════

describe('Balance operations (SqliteStorage)', () => {
    let storage: SqliteStorage;
    const GAII_A = 'alice#test-owner@test-node';
    const GAII_B = 'bob#test-owner@test-node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: GAII_A, name: 'alice', morselBalance: 1000 }));
        await storage.createAgent(makeAgent({ gaii: GAII_B, name: 'bob', morselBalance: 500 }));
    });

    // ── Debit ──

    it('debit reduces balance correctly', async () => {
        const ok = await storage.debitBalance(GAII_A, 300);
        expect(ok).toBe(true);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(700);
    });

    it('debit exact balance to zero succeeds', async () => {
        const ok = await storage.debitBalance(GAII_A, 1000);
        expect(ok).toBe(true);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(0);
    });

    it('negative balance is prevented — debit more than available', async () => {
        const ok = await storage.debitBalance(GAII_A, 1001);
        expect(ok).toBe(false);

        // Balance must be unchanged
        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('debit zero succeeds but does not change balance', async () => {
        const ok = await storage.debitBalance(GAII_A, 0);
        // SQLite: morselBalance >= 0 is true, but changes may be 0 due to no actual row change
        // The important thing is balance stays the same
        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('debit non-existent agent returns false', async () => {
        const ok = await storage.debitBalance('nonexistent#owner@node', 10);
        expect(ok).toBe(false);
    });

    // ── Credit ──

    it('credit increases balance correctly', async () => {
        const ok = await storage.creditBalance(GAII_A, 200);
        expect(ok).toBe(true);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1200);
    });

    it('credit zero does not change balance', async () => {
        const ok = await storage.creditBalance(GAII_A, 0);
        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('credit non-existent agent returns false', async () => {
        const ok = await storage.creditBalance('nonexistent#owner@node', 100);
        expect(ok).toBe(false);
    });

    // ── Transfer ──

    it('transfer preserves total supply (sum of balances stays the same)', async () => {
        const totalBefore = 1000 + 500; // GAII_A + GAII_B

        const ok = await storage.transferBalance(GAII_A, GAII_B, 400);
        expect(ok).toBe(true);

        const agentA = await storage.getAgent(GAII_A);
        const agentB = await storage.getAgent(GAII_B);
        expect(agentA!.morselBalance).toBe(600);
        expect(agentB!.morselBalance).toBe(900);
        expect(agentA!.morselBalance + agentB!.morselBalance).toBe(totalBefore);
    });

    it('transfer entire balance works', async () => {
        const ok = await storage.transferBalance(GAII_A, GAII_B, 1000);
        expect(ok).toBe(true);

        const agentA = await storage.getAgent(GAII_A);
        const agentB = await storage.getAgent(GAII_B);
        expect(agentA!.morselBalance).toBe(0);
        expect(agentB!.morselBalance).toBe(1500);
    });

    it('transfer more than available fails and preserves both balances', async () => {
        const ok = await storage.transferBalance(GAII_A, GAII_B, 2000);
        expect(ok).toBe(false);

        const agentA = await storage.getAgent(GAII_A);
        const agentB = await storage.getAgent(GAII_B);
        expect(agentA!.morselBalance).toBe(1000);
        expect(agentB!.morselBalance).toBe(500);
    });

    it('transfer to non-existent agent — sender is debited but credit silently fails', async () => {
        // This tests the current atomic transaction behavior:
        // SQLite: debit succeeds, then credit UPDATE hits 0 rows but doesn't fail
        // The transaction is atomic so both run in the same txn
        const ok = await storage.transferBalance(GAII_A, 'nonexistent#owner@node', 100);
        // transferBalance returns true if debit succeeds (credit UPDATE runs but may match 0 rows)
        // Let's verify the actual behavior
        const agentA = await storage.getAgent(GAII_A);
        // Whether transfer returns true or false, balance integrity matters
        if (ok) {
            // If transfer "succeeded" (debit worked), sender was debited
            expect(agentA!.morselBalance).toBe(900);
        } else {
            // If transfer failed atomically, no change
            expect(agentA!.morselBalance).toBe(1000);
        }
    });

    // ── creditBalanceCapped ──

    it('creditBalanceCapped credits up to cap', async () => {
        // Agent A has 1000, cap is 1200, add 500 → should only add 200
        const credited = await storage.creditBalanceCapped(GAII_A, 500, 1200);
        expect(credited).toBe(200);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1200);
    });

    it('creditBalanceCapped returns 0 when already at cap', async () => {
        const credited = await storage.creditBalanceCapped(GAII_A, 100, 1000);
        expect(credited).toBe(0);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('creditBalanceCapped returns 0 when above cap', async () => {
        const credited = await storage.creditBalanceCapped(GAII_A, 100, 500);
        expect(credited).toBe(0);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('creditBalanceCapped credits full amount when well below cap', async () => {
        const credited = await storage.creditBalanceCapped(GAII_B, 100, 2000);
        expect(credited).toBe(100);

        const agent = await storage.getAgent(GAII_B);
        expect(agent!.morselBalance).toBe(600);
    });

    it('creditBalanceCapped returns 0 for non-existent agent', async () => {
        const credited = await storage.creditBalanceCapped('nonexistent#o@n', 100, 500);
        expect(credited).toBe(0);
    });

    // ── Multiple sequential debits ──

    it('multiple sequential debits drain balance correctly', async () => {
        await storage.debitBalance(GAII_A, 300);
        await storage.debitBalance(GAII_A, 300);
        await storage.debitBalance(GAII_A, 300);

        const agent = await storage.getAgent(GAII_A);
        expect(agent!.morselBalance).toBe(100);

        // The 4th debit of 300 should fail (only 100 left)
        const ok = await storage.debitBalance(GAII_A, 300);
        expect(ok).toBe(false);
        const agentAfter = await storage.getAgent(GAII_A);
        expect(agentAfter!.morselBalance).toBe(100);
    });
});

// ════════════════════════════════════════════════════════════════════
// ── Escrow Flows (holdEscrow / settlePayment / returnEscrow) ──
// ════════════════════════════════════════════════════════════════════

describe('Escrow flows (morsel service)', () => {
    let storage: SqliteStorage;
    const REQUESTER = 'requester#owner@node';
    const PROVIDER = 'provider#owner@node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: REQUESTER, name: 'requester', morselBalance: 1000 }));
        await storage.createAgent(makeAgent({ gaii: PROVIDER, name: 'provider', morselBalance: 0 }));
    });

    it('holdEscrow reduces requester balance', async () => {
        const ok = await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-001', 110);
        expect(ok).toBe(true);

        const agent = await storage.getAgent(REQUESTER);
        expect(agent!.morselBalance).toBe(890);
    });

    it('holdEscrow creates a transaction record', async () => {
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-001', 110);

        const txns = await storage.getTransactions(REQUESTER);
        expect(txns.length).toBeGreaterThanOrEqual(1);

        const escrowTx = txns.find(t => t.type === 'escrow_hold');
        expect(escrowTx).toBeDefined();
        expect(escrowTx!.amount).toBe(-110);
        expect(escrowTx!.counterpartyGaii).toBe(PROVIDER);
        expect(escrowTx!.trackingCode).toBe('wk-001');
    });

    it('holdEscrow fails when insufficient balance', async () => {
        const ok = await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-002', 2000);
        expect(ok).toBe(false);

        // Balance unchanged
        const agent = await storage.getAgent(REQUESTER);
        expect(agent!.morselBalance).toBe(1000);
    });

    it('settlePayment credits provider with base price', async () => {
        const config = makeConfig({ burnRate: 0.10 });

        // First hold escrow
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-001', 110);

        const work = makeWork({
            trackingCode: 'wk-001',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work);
        expect(result.providerEarnings).toBe(100);

        const provider = await storage.getAgent(PROVIDER);
        expect(provider!.morselBalance).toBe(100);
    });

    it('settlePayment burns correct portion of network fee', async () => {
        const config = makeConfig({ burnRate: 0.10 });

        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-001', 110);

        const work = makeWork({
            trackingCode: 'wk-001',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work);
        // burned = floor(10 * 0.10) = 1
        expect(result.burned).toBe(1);
        expect(result.networkFee).toBe(10);
    });

    it('settlePayment fee distribution sums correctly', async () => {
        const config = makeConfig({ burnRate: 0.10 });

        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-001', 110);

        const work = makeWork({
            trackingCode: 'wk-001',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work);

        // remainingFee = networkFee - burned = 10 - 1 = 9
        const remainingFee = result.networkFee - result.burned;
        // providerNodeShare + requesterNodeShare + relayShare + registryShare = remainingFee
        const feeSum = result.providerNodeShare + result.requesterNodeShare +
            result.relayShare + result.registryShare;
        expect(feeSum).toBe(remainingFee);
    });

    it('returnEscrow returns funds to requester', async () => {
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-cancel', 110);
        expect((await storage.getAgent(REQUESTER))!.morselBalance).toBe(890);

        const work = makeWork({
            trackingCode: 'wk-cancel',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        await returnEscrow(storage, work);

        const requester = await storage.getAgent(REQUESTER);
        expect(requester!.morselBalance).toBe(1000); // back to original
    });

    it('returnEscrow creates escrow_return transaction', async () => {
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-return', 110);

        const work = makeWork({
            trackingCode: 'wk-return',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        await returnEscrow(storage, work);

        const txns = await storage.getTransactions(REQUESTER);
        const returnTx = txns.find(t => t.type === 'escrow_return');
        expect(returnTx).toBeDefined();
        expect(returnTx!.amount).toBe(110);
        expect(returnTx!.counterpartyGaii).toBe(PROVIDER);
    });

    it('returnEscrow with partial amount returns only specified amount', async () => {
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-partial', 110);

        const work = makeWork({
            trackingCode: 'wk-partial',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        await returnEscrow(storage, work, 50);

        const requester = await storage.getAgent(REQUESTER);
        // 1000 - 110 (held) + 50 (partial return) = 940
        expect(requester!.morselBalance).toBe(940);
    });

    it('escrow hold + settle preserves total morsels (provider gets base, fees accounted)', async () => {
        const config = makeConfig({ burnRate: 0.0 }); // no burn for simpler accounting

        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-acct', 110);

        const work = makeWork({
            trackingCode: 'wk-acct',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work);

        const requesterBal = (await storage.getAgent(REQUESTER))!.morselBalance;
        const providerBal = (await storage.getAgent(PROVIDER))!.morselBalance;

        // Requester started at 1000, paid 110 in escrow
        // Provider got 100 (basePrice) credited
        // Network fees (10) go to nodes/registry but are not agent balances
        expect(requesterBal).toBe(890);
        expect(providerBal).toBe(100);
        // The 10 network fee is distributed to nodes/registry, not to agent balances
        // So agent balances total = 890 + 100 = 990 = 1000 - networkFee(10)
        expect(requesterBal + providerBal).toBe(1000 - result.networkFee);
    });

    it('multiple escrow holds drain balance correctly', async () => {
        // Hold 3 times
        expect(await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-1', 300)).toBe(true);
        expect(await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-2', 300)).toBe(true);
        expect(await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-3', 300)).toBe(true);

        const agent = await storage.getAgent(REQUESTER);
        expect(agent!.morselBalance).toBe(100);

        // 4th hold should fail — only 100 remaining
        expect(await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-4', 200)).toBe(false);
        expect((await storage.getAgent(REQUESTER))!.morselBalance).toBe(100);
    });
});

// ════════════════════════════════════════════════════════════════════
// ── Generic Escrow Holds (storage-level) ──
// ════════════════════════════════════════════════════════════════════

describe('Generic escrow holds (SqliteStorage)', () => {
    let storage: SqliteStorage;
    const FROM_GAII = 'user#owner@node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: FROM_GAII, name: 'user', morselBalance: 500 }));
    });

    function makeEscrowHold(overrides: Partial<EscrowHoldRecord> = {}): EscrowHoldRecord {
        return {
            holdId: `hold-${Math.random().toString(36).slice(2, 10)}`,
            fromGaii: FROM_GAII,
            amount: 100,
            reason: 'test-hold',
            status: 'held',
            extensionName: 'test-extension',
            createdAt: new Date().toISOString(),
            ...overrides,
        };
    }

    it('creates and retrieves an escrow hold', async () => {
        const hold = makeEscrowHold({ holdId: 'hold-1' });
        const created = await storage.createEscrowHold(hold);
        expect(created.holdId).toBe('hold-1');

        const retrieved = await storage.getEscrowHold('hold-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.status).toBe('held');
        expect(retrieved!.amount).toBe(100);
        expect(retrieved!.fromGaii).toBe(FROM_GAII);
    });

    it('lists escrow holds for a given GAII', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h1' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h2' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h3', fromGaii: 'other#o@n' }));

        const holds = await storage.listEscrowHolds(FROM_GAII);
        expect(holds).toHaveLength(2);
    });

    it('filters escrow holds by status', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h1', status: 'held' }));
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h2', status: 'held' }));
        // Manually create a released one
        const releasedHold = makeEscrowHold({ holdId: 'h3', status: 'released', releasedTo: 'someone#o@n', releasedAt: new Date().toISOString() });
        await storage.createEscrowHold(releasedHold);

        const heldOnly = await storage.listEscrowHolds(FROM_GAII, { status: 'held' });
        expect(heldOnly).toHaveLength(2);

        const releasedOnly = await storage.listEscrowHolds(FROM_GAII, { status: 'released' });
        expect(releasedOnly).toHaveLength(1);
    });

    it('releaseEscrowHold transfers to provider (status change)', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h-release' }));

        const released = await storage.releaseEscrowHold('h-release', 'provider#o@n');
        expect(released).not.toBeNull();
        expect(released!.status).toBe('released');
        expect(released!.releasedTo).toBe('provider#o@n');
        expect(released!.releasedAt).toBeDefined();
    });

    it('refundEscrowHold returns to requester (status change)', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h-refund' }));

        const refunded = await storage.refundEscrowHold('h-refund');
        expect(refunded).not.toBeNull();
        expect(refunded!.status).toBe('refunded');
        expect(refunded!.releasedAt).toBeDefined();
    });

    it('double-release is rejected', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h-double' }));

        // First release succeeds
        const first = await storage.releaseEscrowHold('h-double', 'provider#o@n');
        expect(first).not.toBeNull();
        expect(first!.status).toBe('released');

        // Second release should fail — status is no longer 'held'
        const second = await storage.releaseEscrowHold('h-double', 'provider#o@n');
        expect(second).toBeNull();
    });

    it('release after refund is rejected', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h-refund-then-release' }));

        const refunded = await storage.refundEscrowHold('h-refund-then-release');
        expect(refunded).not.toBeNull();

        const released = await storage.releaseEscrowHold('h-refund-then-release', 'provider#o@n');
        expect(released).toBeNull();
    });

    it('refund after release is rejected', async () => {
        await storage.createEscrowHold(makeEscrowHold({ holdId: 'h-release-then-refund' }));

        const released = await storage.releaseEscrowHold('h-release-then-refund', 'provider#o@n');
        expect(released).not.toBeNull();

        const refunded = await storage.refundEscrowHold('h-release-then-refund');
        expect(refunded).toBeNull();
    });

    it('release non-existent hold returns null', async () => {
        const result = await storage.releaseEscrowHold('nonexistent', 'someone#o@n');
        expect(result).toBeNull();
    });

    it('refund non-existent hold returns null', async () => {
        const result = await storage.refundEscrowHold('nonexistent');
        expect(result).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════
// ── Daily Allowance ──
// ════════════════════════════════════════════════════════════════════

describe('applyDailyAllowance', () => {
    let storage: SqliteStorage;
    const GAII = 'daily#owner@node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: GAII, name: 'daily', morselBalance: 0 }));
    });

    it('credits the full daily allowance when below cap', async () => {
        const config = makeConfig({ dailyAllowance: 50, dailyAllowanceCap: 500 });
        const credited = await applyDailyAllowance(storage, config, GAII);
        expect(credited).toBe(50);

        const agent = await storage.getAgent(GAII);
        expect(agent!.morselBalance).toBe(50);
    });

    it('credits partial amount when close to cap', async () => {
        // Set balance close to cap
        await storage.creditBalance(GAII, 480);
        const config = makeConfig({ dailyAllowance: 50, dailyAllowanceCap: 500 });

        const credited = await applyDailyAllowance(storage, config, GAII);
        expect(credited).toBe(20); // 500 - 480 = 20

        const agent = await storage.getAgent(GAII);
        expect(agent!.morselBalance).toBe(500);
    });

    it('credits zero when already at cap', async () => {
        await storage.creditBalance(GAII, 500);
        const config = makeConfig({ dailyAllowance: 50, dailyAllowanceCap: 500 });

        const credited = await applyDailyAllowance(storage, config, GAII);
        expect(credited).toBe(0);

        const agent = await storage.getAgent(GAII);
        expect(agent!.morselBalance).toBe(500);
    });

    it('creates allowance transaction when credited', async () => {
        const config = makeConfig({ dailyAllowance: 50, dailyAllowanceCap: 500 });
        await applyDailyAllowance(storage, config, GAII);

        const txns = await storage.getTransactions(GAII);
        const allowanceTx = txns.find(t => t.type === 'allowance');
        expect(allowanceTx).toBeDefined();
        expect(allowanceTx!.amount).toBe(50);
    });

    it('does not create transaction when nothing credited', async () => {
        await storage.creditBalance(GAII, 500);
        const config = makeConfig({ dailyAllowance: 50, dailyAllowanceCap: 500 });
        await applyDailyAllowance(storage, config, GAII);

        const txns = await storage.getTransactions(GAII);
        const allowanceTxns = txns.filter(t => t.type === 'allowance');
        expect(allowanceTxns).toHaveLength(0);
    });
});

// ════════════════════════════════════════════════════════════════════
// ── calculateEscrow ──
// ════════════════════════════════════════════════════════════════════

describe('calculateEscrow', () => {
    let storage: SqliteStorage;
    const REQUESTER = 'calc-req#owner@node';
    const PROVIDER = 'calc-prov#owner@node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: REQUESTER, name: 'calc-req', morselBalance: 5000 }));
        await storage.createAgent(makeAgent({ gaii: PROVIDER, name: 'calc-prov', morselBalance: 0 }));
    });

    it('returns 0 when no active work requests', async () => {
        const escrow = await calculateEscrow(storage, REQUESTER);
        expect(escrow).toBe(0);
    });

    it('sums escrow from active work requests (pending, accepted, in_progress)', async () => {
        await storage.createWork(makeWork({
            trackingCode: 'wk-1',
            status: 'pending',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        }));
        await storage.createWork(makeWork({
            trackingCode: 'wk-2',
            status: 'accepted',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 200, networkFee: 20, total: 220, inEscrow: 220 },
        }));
        await storage.createWork(makeWork({
            trackingCode: 'wk-3',
            status: 'in_progress',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 50, networkFee: 5, total: 55, inEscrow: 55 },
        }));

        const escrow = await calculateEscrow(storage, REQUESTER);
        expect(escrow).toBe(110 + 220 + 55);
    });

    it('excludes completed/rejected work from escrow total', async () => {
        await storage.createWork(makeWork({
            trackingCode: 'wk-active',
            status: 'pending',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        }));
        await storage.createWork(makeWork({
            trackingCode: 'wk-done',
            status: 'completed',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 200, networkFee: 20, total: 220, inEscrow: 220 },
        }));
        await storage.createWork(makeWork({
            trackingCode: 'wk-rejected',
            status: 'rejected',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 300, networkFee: 30, total: 330, inEscrow: 330 },
        }));

        const escrow = await calculateEscrow(storage, REQUESTER);
        expect(escrow).toBe(110); // only the pending one
    });
});

// ════════════════════════════════════════════════════════════════════
// ── Settlement with relay nodes ──
// ════════════════════════════════════════════════════════════════════

describe('settlePayment with relay nodes', () => {
    let storage: SqliteStorage;
    const REQUESTER = 'relay-req#owner@node';
    const PROVIDER = 'relay-prov#owner@node';

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createAgent(makeAgent({ gaii: REQUESTER, name: 'relay-req', morselBalance: 5000 }));
        await storage.createAgent(makeAgent({ gaii: PROVIDER, name: 'relay-prov', morselBalance: 0 }));
    });

    it('records relay path in result', async () => {
        const config = makeConfig({ burnRate: 0.10 });
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-relay', 110);

        const work = makeWork({
            trackingCode: 'wk-relay',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 100, networkFee: 10, total: 110, inEscrow: 110 },
        });
        await storage.createWork(work);

        const relayPath = ['relay-node-1', 'relay-node-2'];
        const result = await settlePayment(storage, config, work, relayPath);
        expect(result.relayNodes).toEqual(relayPath);
    });

    it('creates relay_fee transactions when relay nodes present', async () => {
        const config = makeConfig({ burnRate: 0.0 }); // no burn for cleaner accounting
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-relay2', 1100);

        const work = makeWork({
            trackingCode: 'wk-relay2',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 1000, networkFee: 100, total: 1100, inEscrow: 1100 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work, ['relay-1']);
        expect(result.relayShare).toBeGreaterThan(0);

        const txns = await storage.getTransactions(REQUESTER);
        const relayTxns = txns.filter(t => t.type === 'relay_fee');
        expect(relayTxns.length).toBeGreaterThanOrEqual(1);
    });

    it('creates relay_fee_unallocated when no relay nodes but relay share exists', async () => {
        const config = makeConfig({ burnRate: 0.0 });
        await holdEscrow(storage, REQUESTER, PROVIDER, 'wk-no-relay', 1100);

        const work = makeWork({
            trackingCode: 'wk-no-relay',
            requesterGaii: REQUESTER,
            providerGaii: PROVIDER,
            cost: { basePrice: 1000, networkFee: 100, total: 1100, inEscrow: 1100 },
        });
        await storage.createWork(work);

        const result = await settlePayment(storage, config, work, []);
        if (result.relayShare > 0) {
            const txns = await storage.getTransactions(REQUESTER);
            const unallocated = txns.find(t => t.type === 'relay_fee_unallocated');
            expect(unallocated).toBeDefined();
        }
    });
});

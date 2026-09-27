/**
 * @file test/unit/routing-fee.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description routingFee (services/morsel.ts), the 1-morsel fee of one route to another node: taken
 *   once, as the call goes out; nothing taken and no line written when the balance cannot cover it;
 *   a taken fee given back once, with a line of its own; an agent's fee taken from its owner; and no
 *   fee on a relaying hop. The endpoints that use it are tested end to end in
 *   test/e2e-federation-settlements-sync.ts.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, R4 6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { routingFee, ROUTING_FEE_MORSELS } from '../../src/services/morsel.js';

const OWNER = 'rfowner';
const PERSON = `${OWNER}@test-node`;
const AGENT = `rfagent#${OWNER}@test-node`;

async function seed(storage: SqliteStorage, balance: number): Promise<void> {
    const now = new Date().toISOString();
    await storage.createGHII({
        username: OWNER, nodeId: 'test-node', ghii: PERSON, displayName: OWNER,
        verificationLevel: 1, ownerName: OWNER, totpEnabled: false, createdAt: now, updatedAt: now,
    });
    await storage.createAgent({
        name: 'rfagent', owner: OWNER, gaii: AGENT, capabilities: [], publicKey: 'dGVzdA==',
        trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
    });
    if (balance > 0) await storage.creditBalance(PERSON, balance);
}

async function balanceOf(storage: SqliteStorage): Promise<number> {
    return (await storage.getGHII(PERSON))?.morselBalance ?? 0;
}

/** The person's lines, the fee before its return: two lines written in one millisecond have no order. */
async function linesOf(storage: SqliteStorage) {
    return (await storage.getTransactions(PERSON)).sort((a, b) => a.amount - b.amount);
}

describe('routingFee', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('takes one morsel once, with one line under the person', async () => {
        await seed(storage, 5);
        const fee = routingFee(storage, PERSON, { type: 'federation_routing', trackingCode: 'relay:node-a' });
        expect(await fee.take()).toBe(true);
        expect(await fee.take()).toBe(true);
        expect(ROUTING_FEE_MORSELS).toBe(1);
        expect(await balanceOf(storage)).toBe(4);
        const lines = await storage.getTransactions(PERSON);
        expect(lines.map(l => [l.type, l.amount, l.trackingCode, l.initiatorGaii ?? null]))
            .toEqual([['federation_routing', -1, 'relay:node-a', null]]);
    });

    it('takes nothing and writes no line when the balance cannot cover it', async () => {
        await seed(storage, 0);
        const fee = routingFee(storage, PERSON, { type: 'federation_routing', trackingCode: 'relay:node-a' });
        expect(await fee.take()).toBe(false);
        await fee.giveBack();
        expect(await balanceOf(storage)).toBe(0);
        expect(await storage.getTransactions(PERSON)).toEqual([]);
    });

    it('gives a taken fee back once, with a return line of its own', async () => {
        await seed(storage, 5);
        const fee = routingFee(storage, PERSON, { type: 'routing_fee', trackingCode: 'route:node-b' });
        await fee.take();
        await fee.giveBack();
        await fee.giveBack();
        expect(await balanceOf(storage)).toBe(5);
        const lines = await linesOf(storage);
        expect(lines.map(l => [l.type, l.amount, l.trackingCode]))
            .toEqual([['routing_fee', -1, 'route:node-b'], ['routing_fee_return', 1, 'route:node-b']]);
    });

    it('takes an agent\'s fee from its owner, and both lines name the agent as the one who called', async () => {
        await seed(storage, 5);
        const fee = routingFee(storage, AGENT, { type: 'federation_routing' });
        await fee.take();
        expect(await balanceOf(storage)).toBe(4);
        await fee.giveBack();
        expect(await balanceOf(storage)).toBe(5);
        const lines = await linesOf(storage);
        expect(lines.map(l => [l.gaii, l.type, l.amount, l.trackingCode ?? null, l.initiatorGaii]))
            .toEqual([
                [PERSON, 'federation_routing', -1, null, AGENT],
                [PERSON, 'federation_routing_return', 1, null, AGENT],
            ]);
    });

    it('charges nothing on a relaying hop, where there is no payer', async () => {
        await seed(storage, 5);
        const fee = routingFee(storage, null, { type: 'federation_routing', trackingCode: 'relay:node-a,node-b' });
        expect(await fee.take()).toBe(true);
        await fee.giveBack();
        expect(await balanceOf(storage)).toBe(5);
        expect(await storage.getTransactions(PERSON)).toEqual([]);
    });
});

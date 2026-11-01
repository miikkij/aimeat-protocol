/**
 * @file test/unit/ecosystem-subscriptions-by-owner.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ecosystem app event subscriptions are kept per owner (secaudit2026oct31w2 round 12,
 *   ecosystem-subscriptions:node-wide-registry-unbounded-size), on a real store:
 *   - a memory write by one owner reads only that owner's subscriptions, never another account's;
 *   - an owner's own subscription still delivers memory.write to the app (the designed use);
 *   - one owner's list is bounded by the node's memory value size (quota.memory_max_value_size_kb), and
 *     removing a subscription always works;
 *   - the once-only boot step moves the node-wide record of earlier nodes to the owners, so the
 *     subscriptions made before the update keep delivering, and leaves what it cannot place where it was.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ecosystem-subscriptions-by-owner.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 12).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { onDeliveryEvent, offDeliveryEvent, type DeliveryEvent } from '../../src/services/event-bus.js';
import * as eco from '../../src/services/ecosystem-events.js';

const NODE_ID = 'eco-node-test';
const SYSTEM = `system@${NODE_ID}`;
const earlier = () => new Date(Date.now() - 60_000).toISOString();
const geai = (app: string, owner: string) => `eco:${app}#${owner}@${NODE_ID}`;

let storage: Storage;
let config: AimeatConfig;
const reads: Array<{ owner: string; key: string; value: unknown }> = [];
let delivered: DeliveryEvent[] = [];
const onDelivery = (evt: DeliveryEvent) => { delivered.push(evt); };

async function app(name: string, owner: string): Promise<void> {
    await storage.createEcosystemApp({
        app: name, owner, geai: geai(name, owner), publicKey: 'pk', scopes: ['memory:read'], status: 'active',
        morselBalance: 0, createdAt: earlier(), lastSeen: earlier(),
    } as never);
}

beforeAll(async () => {
    setThisNodeId(null);
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    // Every record the code under test reads is noted, so a test can say what a write had to load.
    const getMemory = storage.getMemory.bind(storage);
    storage.getMemory = async (owner: string, key: string) => {
        const rec = await getMemory(owner, key);
        if (rec) reads.push({ owner, key, value: rec.value });
        return rec;
    };
    for (const [name, owner] of [['radio', 'anna'], ['radio', 'bert'], ['ledger', 'bert']] as const) await app(name, owner);
    onDeliveryEvent(onDelivery);
}, 60_000);

afterEach(() => { reads.length = 0; delivered = []; });

describe('subscriptions per owner', () => {
    it('a memory write by one owner never loads another account\'s subscriptions', async () => {
        // anna's subscriptions, many and wide: what one account could grow before.
        for (let i = 0; i < 20; i++) {
            await eco.addSubscription(storage, NODE_ID, {
                geai: geai('radio', 'anna'), ownerGhii: `anna@${NODE_ID}`, event: 'memory.write',
                match: { key: `anna.only.${i}.*` }, transport: ['tunnel'],
            });
        }
        reads.length = 0;
        await eco.emitEcosystemMemoryWrite(storage, config, `bert@${NODE_ID}`, 'notes.today');
        const loadedAnna = reads.filter(r => JSON.stringify(r.value ?? null).includes(geai('radio', 'anna')));
        expect(loadedAnna, 'bert\'s write loaded a record that holds anna\'s subscriptions').toEqual([]);
    });

    it('an owner\'s own subscription still delivers memory.write to the app, and only to that owner\'s app', async () => {
        await eco.addSubscription(storage, NODE_ID, {
            geai: geai('radio', 'bert'), ownerGhii: `bert@${NODE_ID}`, event: 'memory.write',
            match: { key: 'crm.*' }, transport: ['tunnel', 'webhook'],
        });
        await eco.emitEcosystemMemoryWrite(storage, config, `bert@${NODE_ID}`, 'crm.lead.1');
        expect(delivered.map(d => d.target)).toEqual([geai('radio', 'bert')]);
        expect((delivered[0].payload as { data: { key: string } }).data.key).toBe('crm.lead.1');

        delivered = [];
        // An agent of bert writes: the same owner's apps hear it, as before.
        await eco.emitEcosystemMemoryWrite(storage, config, `helper#bert@${NODE_ID}`, 'crm.lead.2');
        expect(delivered.map(d => d.target)).toEqual([geai('radio', 'bert')]);

        delivered = [];
        await eco.emitEcosystemMemoryWrite(storage, config, `bert@${NODE_ID}`, 'other.key');
        expect(delivered).toEqual([]);

        const listed = await eco.listSubscriptions(storage, NODE_ID, `bert@${NODE_ID}`);
        expect(listed.map(s => s.geai)).toEqual([geai('radio', 'bert')]);
        expect((await eco.listSubscriptions(storage, NODE_ID, `anna@${NODE_ID}`)).every(s => s.ownerGhii === `anna@${NODE_ID}`)).toBe(true);
    });

    it('the same subscription again replaces itself, and removing one leaves the owner\'s others', async () => {
        const sub = { geai: geai('ledger', 'bert'), ownerGhii: `bert@${NODE_ID}`, event: 'binding.revoked', transport: ['tunnel'] as ('tunnel' | 'webhook')[] };
        await eco.addSubscription(storage, NODE_ID, sub);
        await eco.addSubscription(storage, NODE_ID, sub);
        const before = await eco.listSubscriptions(storage, NODE_ID, `bert@${NODE_ID}`, geai('ledger', 'bert'));
        expect(before.length).toBe(1);
        expect(await eco.removeSubscriptions(storage, NODE_ID, `bert@${NODE_ID}`, geai('ledger', 'bert'))).toBe(1);
        expect(await eco.listSubscriptions(storage, NODE_ID, `bert@${NODE_ID}`, geai('ledger', 'bert'))).toEqual([]);
        expect((await eco.listSubscriptions(storage, NODE_ID, `bert@${NODE_ID}`, geai('radio', 'bert'))).length).toBe(1);
    });

    it('one owner\'s list stops at the node\'s memory value size, and a removal still works', async () => {
        const owner = 'carl';
        await app('radio', owner);
        const maxBytes = 4 * 1024;
        let refused: unknown = null;
        for (let i = 0; i < 100 && !refused; i++) {
            try {
                await eco.addSubscription(storage, NODE_ID, {
                    geai: geai('radio', owner), ownerGhii: `${owner}@${NODE_ID}`, event: 'memory.write',
                    match: { key: `carl.${i}.${'x'.repeat(200)}` }, transport: ['tunnel'],
                }, { maxBytes });
            } catch (err) { refused = err; }
        }
        expect(refused).toBeInstanceOf(eco.EcosystemSubscriptionsFullError);
        const stored = await storage.getMemory(SYSTEM, eco.ownerSubscriptionsKey(owner));
        expect(Buffer.byteLength(JSON.stringify(stored?.value), 'utf8')).toBeLessThanOrEqual(maxBytes);
        expect(await eco.removeSubscriptions(storage, NODE_ID, `${owner}@${NODE_ID}`, geai('radio', owner))).toBeGreaterThan(0);
        await eco.addSubscription(storage, NODE_ID, {
            geai: geai('radio', owner), ownerGhii: `${owner}@${NODE_ID}`, event: 'memory.write', match: { key: 'carl.*' }, transport: ['tunnel'],
        }, { maxBytes });
        expect((await eco.listSubscriptions(storage, NODE_ID, `${owner}@${NODE_ID}`)).length).toBe(1);
    });
});

describe('the once-only move of the node-wide record', () => {
    it('moves each owner\'s entries to that owner, keeps what it cannot place, and runs once', async () => {
        const { moveEcosystemSubscriptionsByOwnerOnce } = await import('../../src/services/ecosystem-subscriptions-by-owner.js');
        const fresh = new SqliteStorage(':memory:') as unknown as Storage;
        await fresh.createEcosystemApp({
            app: 'desk', owner: 'dora', geai: geai('desk', 'dora'), publicKey: 'pk', scopes: ['memory:read'], status: 'active',
            morselBalance: 0, createdAt: earlier(), lastSeen: earlier(),
        } as never);
        const at = earlier();
        const legacy = [
            { geai: geai('desk', 'dora'), ownerGhii: `dora@${NODE_ID}`, event: 'memory.write', match: { key: 'desk.*' }, transport: ['tunnel', 'webhook'], createdAt: at },
            { geai: geai('desk', 'emil'), ownerGhii: `emil@${NODE_ID}`, event: '*', transport: ['tunnel'], createdAt: at },
            { geai: 'eco:desk#fay@another-node-x', ownerGhii: 'fay@another-node-x', event: 'memory.write', transport: ['tunnel'], createdAt: at },
            'not a subscription',
        ];
        const rec: MemoryRecord = {
            key: eco.LEGACY_SUBSCRIPTIONS_KEY, ownerGaii: SYSTEM, value: legacy, visibility: 'private', tags: ['ecosystem-index'],
            ttlHours: null, version: 3, createdAt: at, updatedAt: at,
        };
        await fresh.setMemory(rec);

        const result = await moveEcosystemSubscriptionsByOwnerOnce(fresh, config);
        expect(result).toMatchObject({ ran: true, moved: 2, left: 2 });

        const dora = await eco.listSubscriptions(fresh, NODE_ID, `dora@${NODE_ID}`);
        expect(dora).toEqual([legacy[0]]);
        expect(await eco.listSubscriptions(fresh, NODE_ID, `emil@${NODE_ID}`)).toEqual([legacy[1]]);
        // What it cannot place stays exactly where it was; nothing reads it on a write any more.
        expect((await fresh.getMemory(SYSTEM, eco.LEGACY_SUBSCRIPTIONS_KEY))?.value).toEqual([legacy[2], legacy[3]]);

        // A subscription made before the update still delivers after the move.
        delivered = [];
        await eco.emitEcosystemMemoryWrite(fresh, config, `dora@${NODE_ID}`, 'desk.ticket.9');
        expect(delivered.map(d => d.target)).toEqual([geai('desk', 'dora')]);

        // Once: a second start changes nothing.
        expect((await moveEcosystemSubscriptionsByOwnerOnce(fresh, config)).ran).toBe(false);
        expect(await eco.listSubscriptions(fresh, NODE_ID, `dora@${NODE_ID}`)).toEqual([legacy[0]]);
    });

    it('removes the node-wide record when every entry found its owner, and does nothing on a node without one', async () => {
        const { moveEcosystemSubscriptionsByOwnerOnce } = await import('../../src/services/ecosystem-subscriptions-by-owner.js');
        const fresh = new SqliteStorage(':memory:') as unknown as Storage;
        const at = earlier();
        const entry = { geai: geai('desk', 'gus'), ownerGhii: `gus@${NODE_ID}`, event: 'memory.write', transport: ['tunnel'], createdAt: at };
        // gus already has a list of his own (made after an earlier half-run): the move adds, never duplicates.
        await eco.addSubscription(fresh, NODE_ID, { geai: entry.geai, ownerGhii: entry.ownerGhii, event: entry.event, transport: ['tunnel'] });
        await fresh.setMemory({
            key: eco.LEGACY_SUBSCRIPTIONS_KEY, ownerGaii: SYSTEM, value: [entry], visibility: 'private', tags: ['ecosystem-index'],
            ttlHours: null, version: 1, createdAt: at, updatedAt: at,
        });
        expect(await moveEcosystemSubscriptionsByOwnerOnce(fresh, config)).toMatchObject({ ran: true, moved: 1, left: 0 });
        expect(await fresh.getMemory(SYSTEM, eco.LEGACY_SUBSCRIPTIONS_KEY)).toBeNull();
        expect((await eco.listSubscriptions(fresh, NODE_ID, `gus@${NODE_ID}`)).length).toBe(1);

        const empty = new SqliteStorage(':memory:') as unknown as Storage;
        expect(await moveEcosystemSubscriptionsByOwnerOnce(empty, config)).toMatchObject({ ran: true, moved: 0, left: 0 });
    });
});

process.on('exit', () => offDeliveryEvent(onDelivery));

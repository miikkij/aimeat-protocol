/**
 * @file test/unit/dataspace-agree-once.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two approvals of one priced Dataspace request that run together (services/dataspace/
 *   negotiation.ts providerAgree). Driven in process on an in-memory SQLite store wrapped so that every
 *   storage call waits for the next turn of the event loop, which lets two calls interleave the way two
 *   requests on a database with real I/O do. The consumer's callback is stubbed to answer 200, and the
 *   sale booking is counted.
 *
 *   Properties: the negotiation is AGREED once, one sale is booked, and the contract slot of the
 *   participant stays active with exactly one block of reads, so the booked agreement reads. One
 *   approval alone still agrees, books and leaves an active slot.
 * @usage cd aimeat && pnpm exec vitest run test/unit/dataspace-agree-once.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14,
 *     dataspace:agreement:materialise-before-cas-loser-revokes-slot).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/dataspace/callbacks.js', async (orig) => ({
    ...(await orig<typeof import('../../src/services/dataspace/callbacks.js')>()),
    sendCallback: vi.fn(async () => ({ ok: true })),
}));
const booked: string[] = [];
vi.mock('../../src/services/dataspace/agreement.js', async (orig) => ({
    ...(await orig<typeof import('../../src/services/dataspace/agreement.js')>()),
    bookAgreementSale: vi.fn(async (_deps: unknown, n: { agreementId?: string }) => { booked.push(String(n.agreementId)); }),
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { putOffering, type Offering } from '../../src/services/exchange-market.js';
import { readContractForCall } from '../../src/services/metered-entitlements.js';
import { publishPackage } from '../../src/services/datapackage/store.js';
import { partyRefOf } from '../../src/services/parties/contract.js';
import { negotiationPid, newProcessHex, type NegotiationRecord } from '../../src/services/dataspace/contract.js';
import { createNegotiation, readNegotiation } from '../../src/services/dataspace/store.js';
import { providerAgree } from '../../src/services/dataspace/negotiation.js';
import { PER_READ_BLOCK } from '../../src/services/dataspace/policy.js';

const NODE = 'unit-dspagree-001';
const OWNER = 'seller';
const GHII = `${OWNER}@${NODE}`;
const PKG = 'feed';
const EXT = `datapkg:${OWNER}/${PKG}`;
const PARTICIPANT = 'did:web:example.test';
let storage: Storage;
let config: AimeatConfig;

/** Every storage call waits one turn of the event loop first, as a call to a database server does. */
function yielding(inner: Storage): Storage {
    return new Proxy(inner, {
        get(target, prop, receiver) {
            const v = Reflect.get(target, prop, receiver) as unknown;
            if (typeof v !== 'function') return v;
            return async (...args: unknown[]) => {
                await new Promise(r => setImmediate(r));
                return (v as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    });
}

const offering = (): Offering => ({
    offeringId: 'off-dspfeed', providerGhii: GHII, providerOwner: OWNER, kind: 'datapackage', ext: EXT, action: 'read',
    surface: { kind: 'datapackage', ownerName: OWNER, packageName: PKG, ifaceVersion: 1, model: 'per_read' },
    title: 'Feed', description: 'A feed', unit: 'money', basePrice: 1000, currency: 'EUR', plans: [], state: 'listed',
} as unknown as Offering);

async function waitingRequest(): Promise<NegotiationRecord> {
    const hex = newProcessHex();
    const at = new Date().toISOString();
    const n: NegotiationRecord = {
        providerPid: negotiationPid(OWNER, hex), consumerPid: `urn:uuid:${hex}`, state: 'REQUESTED', ownerGhii: GHII,
        participantId: PARTICIPANT, authMethod: 'static', callbackAddress: 'https://consumer.example/cb',
        datasetId: `urn:aimeat:dataset:${OWNER}:${PKG}`, packageName: PKG, offerId: `urn:aimeat:offer:${OWNER}:${PKG}:exchange`,
        offerKind: 'exchange', offer: {}, offerRef: 'off-dspfeed',
        priced: { amount: 1000, currency: 'EUR', model: 'per_read', offeringId: 'off-dspfeed' },
        lastOfferFrom: 'consumer', waitingForOwner: true, history: [], createdAt: at, updatedAt: at,
    };
    expect(await createNegotiation(storage, n, hex)).toBe(true);
    return n;
}

const hexOf = (n: NegotiationRecord) => n.providerPid.slice(n.providerPid.lastIndexOf(':') + 1);

beforeEach(async () => {
    const raw = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' };
    const published = await publishPackage({ storage: raw, config }, GHII, {
        name: PKG, changes: 'First.', visibility: 'private', resources: [{ name: 'items', rows: [{ id: 1 }, { id: 2 }], schema: 'infer' }],
    } as Parameters<typeof publishPackage>[2], { gaii: GHII, kind: 'manual' });
    expect(published.ok, JSON.stringify(published)).toBe(true);
    await putOffering(raw, offering());
    storage = yielding(raw);
    booked.length = 0;
});

describe('approving one priced Dataspace request', () => {
    it('twice at the same time: one agreement, one sale, and the contract slot stays active with one block', async () => {
        const n = await waitingRequest();
        await Promise.all([providerAgree({ storage, config }, n, 'owner', GHII), providerAgree({ storage, config }, n, 'owner', GHII)]);
        const after = await readNegotiation(storage, GHII, hexOf(n));
        expect(after?.state).toBe('AGREED');
        expect(booked).toHaveLength(1);
        const ref = partyRefOf(OWNER, after!.materialised!.partyName, NODE);
        const slot = await readContractForCall(storage, ref, EXT, 'read');
        expect(slot?.state, 'the booked agreement\'s contract slot').toBe('active');
        expect(slot?.pricing?.model === 'bundle' ? slot.pricing.callsRemaining : null).toBe(PER_READ_BLOCK);
    });

    it('once: agrees, books, and leaves an active slot', async () => {
        const n = await waitingRequest();
        const after = await providerAgree({ storage, config }, n, 'owner', GHII);
        expect(after?.state).toBe('AGREED');
        expect(booked).toHaveLength(1);
        const slot = await readContractForCall(storage, partyRefOf(OWNER, after!.materialised!.partyName, NODE), EXT, 'read');
        expect(slot?.state).toBe('active');
    });
});

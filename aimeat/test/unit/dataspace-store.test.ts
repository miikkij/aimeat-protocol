/**
 * @file test/unit/dataspace-store.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where DSP negotiations and transfers are kept (services/dataspace/store.ts; plan
 *   doc-mvwxcas3dom3, D8.3), on a SQLite storage of its own: a record is made once, changed on its
 *   version, and a process that ended more than 90 days ago folds into the monthly archive and leaves
 *   the owner's keys, while a live one, a recent one and a finalised agreement still in force stay.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { negotiationPid, transferPid, newProcessHex, type NegotiationRecord, type TransferRecord } from '../../src/services/dataspace/contract.js';
import { changeNegotiation, createNegotiation, createTransfer, liveProcessCount, readArchive, readNegotiation, sweepArchive } from '../../src/services/dataspace/store.js';

const SQLITE_PATH = `./test/.dsp-store-${process.pid}.db`;
const OWNER = 'alice@node-1';
let storage: Storage;

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }); });
afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) { const p = SQLITE_PATH + suffix; if (existsSync(p)) rmSync(p, { force: true }); }
});

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
function neg(hex: string, state: NegotiationRecord['state'], updatedAt: string, extra: Partial<NegotiationRecord> = {}): NegotiationRecord {
    return {
        providerPid: negotiationPid('alice', hex), consumerPid: `urn:uuid:${hex}`, state, ownerGhii: OWNER, participantId: 'did:web:c.example',
        authMethod: 'static', callbackAddress: 'https://c.example/cb', datasetId: 'urn:aimeat:dataset:alice:p', packageName: 'p',
        offerId: 'urn:aimeat:offer:alice:p:open', offerKind: 'open', offer: {}, lastOfferFrom: 'consumer', history: [],
        createdAt: updatedAt, updatedAt, ...extra,
    };
}

describe('dataspace store', () => {
    it('a record is made once and changed on its version', async () => {
        const hex = newProcessHex();
        expect(await createNegotiation(storage, neg(hex, 'REQUESTED', daysAgo(0)), hex)).toBe(true);
        expect(await createNegotiation(storage, neg(hex, 'REQUESTED', daysAgo(0)), hex)).toBe(false);
        const after = await changeNegotiation(storage, OWNER, hex, cur => ({ ...cur, state: 'AGREED' }));
        expect(after?.state).toBe('AGREED');
        expect((await readNegotiation(storage, OWNER, hex))?.state).toBe('AGREED');
        expect(await changeNegotiation(storage, OWNER, newProcessHex(), cur => cur)).toBeNull();
    });

    it('the sweep archives what ended long ago and keeps what is live, recent or still in force', async () => {
        const old = newProcessHex(), recent = newProcessHex(), live = newProcessHex(), inForce = newProcessHex(), ended = newProcessHex(), tOld = newProcessHex();
        await createNegotiation(storage, neg(old, 'TERMINATED', daysAgo(120)), old);
        await createNegotiation(storage, neg(recent, 'TERMINATED', daysAgo(10)), recent);
        await createNegotiation(storage, neg(live, 'REQUESTED', daysAgo(200)), live);
        await createNegotiation(storage, neg(inForce, 'FINALIZED', daysAgo(200)), inForce);
        await createNegotiation(storage, neg(ended, 'FINALIZED', daysAgo(200), { agreementEndedAt: daysAgo(95) }), ended);
        const t: TransferRecord = {
            providerPid: transferPid('alice', tOld), consumerPid: 'urn:uuid:t', state: 'COMPLETED', ownerGhii: OWNER, participantId: 'did:web:c.example',
            authMethod: 'static', agreementId: 'urn:aimeat:dsp:agreement:x', wireFormat: 'HttpData-PULL', callbackAddress: 'https://c.example/cb',
            history: [], createdAt: daysAgo(100), updatedAt: daysAgo(100),
        };
        await createTransfer(storage, t, tOld);
        const before = await liveProcessCount(storage, OWNER);
        const moved = await sweepArchive(storage, OWNER, { force: true });
        expect(moved).toBe(3);
        expect(await liveProcessCount(storage, OWNER)).toBe(before - 3);
        for (const kept of [recent, live, inForce]) expect(await readNegotiation(storage, OWNER, kept)).not.toBeNull();
        expect(await readNegotiation(storage, OWNER, old)).toBeNull();
        const month = daysAgo(120).slice(0, 7);
        expect((await readArchive(storage, OWNER, month)).some(l => l.providerPid === negotiationPid('alice', old))).toBe(true);
        // A second sweep within the hour does nothing unless forced.
        expect(await sweepArchive(storage, OWNER)).toBe(0);
    });
});

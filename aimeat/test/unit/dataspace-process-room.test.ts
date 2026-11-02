/**
 * @file test/unit/dataspace-process-room.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The room an owner keeps for DSP processes (services/dataspace/store.ts processRoom), on a
 *   SQLite storage of its own: one participant holds at most its own share of live processes, another
 *   participant still gets in, a process that ended takes no room, and the owner's records stay within
 *   MAX_LIVE_PROCESSES because the processes that ended longest ago fold into the archive at once
 *   (secaudit2026nov02d round 13).
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { MAX_LIVE_PROCESSES, negotiationPid, newProcessHex, type NegotiationRecord } from '../../src/services/dataspace/contract.js';
import { createNegotiation, liveProcessCount, processRoom, readArchive } from '../../src/services/dataspace/store.js';

const SQLITE_PATH = `./test/.dsp-room-${process.pid}.db`;
let storage: Storage;

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }); });
afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) { const p = SQLITE_PATH + suffix; if (existsSync(p)) rmSync(p, { force: true }); }
});

function neg(owner: string, hex: string, participantId: string, state: NegotiationRecord['state'], updatedAt: string): NegotiationRecord {
    return {
        providerPid: negotiationPid(owner, hex), consumerPid: `urn:uuid:${hex}`, state, ownerGhii: `${owner}@node-1`, participantId,
        authMethod: 'static', callbackAddress: 'https://c.example/cb', datasetId: `urn:aimeat:dataset:${owner}:p`, packageName: 'p',
        offerId: `urn:aimeat:offer:${owner}:p:open`, offerKind: 'open', offer: {}, lastOfferFrom: 'consumer', history: [],
        createdAt: updatedAt, updatedAt,
    };
}
async function fill(owner: string, participantId: string, n: number, state: NegotiationRecord['state'], at = (i: number) => new Date(Date.now() - (n - i) * 1000).toISOString()): Promise<void> {
    for (let i = 0; i < n; i++) { const hex = newProcessHex(); await createNegotiation(storage, neg(owner, hex, participantId, state, at(i)), hex); }
}

describe('the process room', () => {
    it('a participant at its own limit is refused; another participant is not; 0 is no limit of its own', async () => {
        await fill('room1', 'did:web:a.example', 100, 'REQUESTED');
        expect(await processRoom(storage, 'room1@node-1', 'did:web:a.example', 100)).toEqual({ full: 'participant', live: 100 });
        expect(await processRoom(storage, 'room1@node-1', 'did:web:b.example', 100)).toBeNull();
        expect(await processRoom(storage, 'room1@node-1', 'did:web:a.example', 0)).toBeNull();
    });

    it('processes that ended take no room, and the oldest of them fold into the archive so the records stay within the budget', async () => {
        await fill('room2', 'did:web:a.example', MAX_LIVE_PROCESSES, 'TERMINATED');
        expect(await liveProcessCount(storage, 'room2@node-1')).toBe(MAX_LIVE_PROCESSES);
        expect(await processRoom(storage, 'room2@node-1', 'did:web:b.example', 100)).toBeNull();
        expect(await liveProcessCount(storage, 'room2@node-1')).toBe(MAX_LIVE_PROCESSES - 1);
        expect(await processRoom(storage, 'room2@node-1', 'did:web:a.example', 100)).toBeNull();
        const month = new Date().toISOString().slice(0, 7);
        expect((await readArchive(storage, 'room2@node-1', month)).length).toBeGreaterThanOrEqual(1);
    });

    it('the owner\'s live processes still cap the room for everyone', async () => {
        for (let p = 0; p < 4; p++) await fill('room3', `did:web:p${p}.example`, MAX_LIVE_PROCESSES / 4, 'REQUESTED');
        expect(await processRoom(storage, 'room3@node-1', 'did:web:new.example', 100)).toEqual({ full: 'provider', live: MAX_LIVE_PROCESSES });
    });
});

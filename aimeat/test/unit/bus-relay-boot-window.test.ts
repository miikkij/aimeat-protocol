/**
 * @file test/unit/bus-relay-boot-window.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two windows in which a registry change another process made was recorded as read
 *   without a read (services/bus-relay.ts; secaudit2026nov08b round 15,
 *   bus-relay.ts:resync/first-mark-taken-without-read):
 *     1. the boot window: process B loads its registries early in its start and listens on the bus
 *        later; a change process A makes in between arrives as no event, and B's first resync took
 *        the moved mark as already read. B now reads its registries once after it listens.
 *     2. this process's own change: publish recorded the mark it wrote as read, so a change another
 *        process made to the same registry just before, whose event was lost, was never read here.
 *        The new mark counts as read only when the mark before it was the one this process read.
 *   With one process per node (the default) the start is as before: no extra read.
 * @usage cd aimeat && pnpm exec vitest run test/unit/bus-relay-boot-window.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  createBusRelay, startBusRelay, stopBusRelays, storedRegistryVersions, type BusRelay, type RemoteReload,
} from '../../src/services/bus-relay.js';
import type { BusWire } from '../../src/storage/bus-wire.js';
import type { MemoryRecord, Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-bus-boot-window-001';
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(async () => { await stopBusRelays(); });

/** The storage rows both processes share: the registry marks live here. */
function sharedRows() {
  const rows = new Map<string, MemoryRecord>();
  return {
    getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
    setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
  };
}

/** One process's in-memory copy of the federation peers, read from `db`. */
function peerRegistry(db: { peers: string[] }) {
  const held = { peers: new Set(db.peers), reads: 0 };
  const reload: RemoteReload = {
    name: 'federation peers', domains: ['federation'],
    run: async () => { held.reads++; held.peers = new Set(db.peers); },
  };
  return { held, reload };
}

describe('a peer removed on another process while this process starts', () => {
  async function bootB(severalProcesses: boolean) {
    const rows = sharedRows();
    const db = { peers: ['peer-1'] };
    const b = peerRegistry(db);                         // B loads its registries early in its start ...
    // ... and A removes the peer and moves the registry mark, before B listens on the bus.
    db.peers = [];
    await storedRegistryVersions(rows as unknown as Pick<Storage, 'getMemory' | 'setMemory'>, NODE).bump('federation');
    const wire: BusWire = { async send() { /* nothing goes out here */ }, async listen() { /* listening */ }, async close() { /* closed */ } };
    const storage = { ...rows, busWire: () => wire } as unknown as Storage;
    const relay = await startBusRelay(storage, NODE, [b.reload], { severalProcesses });
    return { relay: relay!, held: b.held };
  }

  it('several processes: B reads the registry once it listens, and the resync after it reads nothing more', async () => {
    const p = await bootB(true);
    await p.relay.resync();                            // the timer's first round
    expect(p.held.peers.has('peer-1')).toBe(false);
    const reads = p.held.reads;
    await p.relay.resync();
    expect(p.held.reads).toBe(reads);
  });

  it('one process per node, the default: the start reads nothing', async () => {
    const p = await bootB(false);
    expect(p.held.reads).toBe(0);
  });
});

describe('this process changes a registry just after another process changed it, whose event was lost', () => {
  it('the other process\'s change is read here at the next resync', async () => {
    const rows = sharedRows();
    const versions = storedRegistryVersions(rows as unknown as Pick<Storage, 'getMemory' | 'setMemory'>, NODE);
    const db = { peers: ['peer-1', 'peer-2'] };
    const relays: BusRelay[] = [];
    let failing = 1;                                   // A's event is the one that is lost
    const wire = {
      async send(payloads: readonly string[]) {
        if (failing > 0) { failing--; throw new Error('the pool refused the NOTIFY'); }
        setImmediate(() => { for (const p of payloads) for (const r of relays) r.receive(p); });
      },
    };
    const onA = peerRegistry(db);
    const onB = peerRegistry(db);
    const a = createBusRelay({ wire, nodeId: NODE, processId: 'A', reloads: [onA.reload], versions });
    const b = createBusRelay({ wire, nodeId: NODE, processId: 'B', reloads: [onB.reload], versions });
    relays.push(a, b);
    await a.resync(); await b.resync();

    db.peers = ['peer-2'];                              // the operator removes peer-1 on A ...
    a.publish('change', { domain: 'federation', timestamp: Date.now() });
    await a.idle(); await settle();                    // ... and A's event to B is lost

    db.peers = [];                                      // then B removes peer-2 itself
    onB.held.peers.delete('peer-2');
    b.publish('change', { domain: 'federation', timestamp: Date.now() });
    await b.idle(); await settle(); await a.idle();

    expect(onB.held.peers.has('peer-1')).toBe(true);   // the gap the resync closes
    await b.resync();
    expect(onB.held.peers.has('peer-1')).toBe(false);
  });

  it('with nobody else changing it, this process\'s own change is not read again', async () => {
    const rows = sharedRows();
    const versions = storedRegistryVersions(rows as unknown as Pick<Storage, 'getMemory' | 'setMemory'>, NODE);
    const db = { peers: ['peer-1'] };
    const onB = peerRegistry(db);
    const b = createBusRelay({ wire: { async send() { /* sent */ } }, nodeId: NODE, processId: 'B', reloads: [onB.reload], versions });
    await b.resync();
    db.peers = [];
    onB.held.peers.delete('peer-1');
    b.publish('change', { domain: 'federation', timestamp: Date.now() });
    await b.idle();
    await b.resync();
    expect(onB.held.reads).toBe(0);
  });
});

/**
 * @file test/unit/bus-relay-resync.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A lost event between two processes of one node no longer keeps a removed federation
 *   peer or a closed internet opening in force (services/bus-relay.ts RegistryVersions, resync;
 *   secaudit2026nov08 round 14, registry-reload/no-resync-after-lost-notify). An in-memory wire joins
 *   process A and process B; its send fails once, as a NOTIFY through a broken pool does, so B never
 *   hears A's change. With the registry marks B finds the moved mark at its next resync and reads the
 *   registry again. Without marks (one process per node, the default) the relay behaves as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/bus-relay-resync.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createBusRelay, storedRegistryVersions, type BusRelay, type RegistryVersions } from '../../src/services/bus-relay.js';
import { addBusTransport, emitChange } from '../../src/services/event-bus.js';
import type { MemoryRecord, Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-bus-resync-001';
const settle = () => new Promise((r) => setTimeout(r, 30));

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** The marks as the node stores them, in an in-memory storage both processes share. */
function sharedMarks(): RegistryVersions {
  const rows = new Map<string, MemoryRecord>();
  const storage = {
    getMemory: async (owner: string, key: string) => rows.get(`${owner}::${key}`) ?? null,
    setMemory: async (r: MemoryRecord) => { rows.set(`${r.ownerGaii}::${r.key}`, r); return r; },
  } as unknown as Pick<Storage, 'getMemory' | 'setMemory'>;
  return storedRegistryVersions(storage, NODE);
}

/** A and B on one wire whose next send fails `failSends` times. B keeps a peer registry it reads from `db`. */
function twoProcesses(versions: RegistryVersions | undefined, failSends: number) {
  const relays: BusRelay[] = [];
  let failing = failSends;
  const wire = {
    async send(payloads: readonly string[]) {
      if (failing > 0) { failing--; throw new Error('the pool refused the NOTIFY'); }
      setImmediate(() => { for (const p of payloads) for (const r of relays) r.receive(p); });
    },
  };
  const db = { peers: ['peer-1'] };
  const onB = { peers: new Set(db.peers), reads: 0 };
  const peersReload = (target: { peers: Set<string>; reads: number }) => ({
    name: 'federation peers', domains: ['federation'],
    run: async () => { target.reads++; target.peers = new Set(db.peers); },
  });
  const onA = { peers: new Set(db.peers), reads: 0 };
  const a = createBusRelay({ wire, nodeId: NODE, processId: 'A', reloads: [peersReload(onA)], ...(versions ? { versions } : {}) });
  const b = createBusRelay({ wire, nodeId: NODE, processId: 'B', reloads: [peersReload(onB)], ...(versions ? { versions } : {}) });
  relays.push(a, b);
  cleanups.push(addBusTransport(a));
  return { a, b, db, onA, onB };
}

describe('a federation peer removed on A while the event to B is lost', () => {
  it('is dropped on B at its next resync, and read once', async () => {
    const p = twoProcesses(sharedMarks(), 1);
    await p.a.resync(); await p.b.resync();          // each process takes the marks as they are at its start
    p.db.peers = [];                                  // the operator removes the peer on A ...
    emitChange('federation');                         // ... and A's event to B is lost
    await p.a.idle(); await p.b.idle(); await settle();
    expect(p.onB.peers.has('peer-1')).toBe(true);     // B still trusts it: the gap

    await p.b.resync();
    expect(p.onB.peers.has('peer-1')).toBe(false);
    expect(p.onB.reads).toBe(1);
    await p.b.resync();                               // nothing moved since
    expect(p.onB.reads).toBe(1);
    await p.a.resync();                               // A made the change and holds it already
    expect(p.onA.reads).toBe(0);
  });

  it('when the event does arrive, B reads the registry once and the resync after it reads nothing more', async () => {
    const p = twoProcesses(sharedMarks(), 0);
    await p.a.resync(); await p.b.resync();
    p.db.peers = [];
    emitChange('federation');
    await p.a.idle(); await settle(); await p.b.idle();
    expect(p.onB.peers.has('peer-1')).toBe(false);
    expect(p.onB.reads).toBe(1);
    await p.b.resync();
    expect(p.onB.reads).toBe(1);
  });
});

describe('one process per node, the default: no marks', () => {
  it('resync reads nothing and the relay is as before', async () => {
    const p = twoProcesses(undefined, 0);
    await p.b.resync();
    expect(p.onB.reads).toBe(0);
    p.db.peers = [];
    emitChange('federation');
    await p.a.idle(); await settle(); await p.b.idle();
    expect(p.onB.reads).toBe(1);
  });
});

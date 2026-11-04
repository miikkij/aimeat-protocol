/**
 * @file test/unit/bus-relay-reconnect.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description After the event bus's listening connection was down and came back, the process reads
 *   every registry it keeps in memory again (server-bootstrap/bus-relay-start.ts): the federation
 *   peers, the internet openings, maintenance mode and the stored settings, because a change another
 *   process announced while the connection was down never arrives. A wire stands in for PostgreSQL
 *   and says `reconnected` as the real one does after a dropped connection
 *   (storage/providers/postgres-kysely/bus-wire.ts); test/e2e-two-process-bus.ts case 6 drops the
 *   real connection.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startNodeBusRelay } from '../../src/server-bootstrap/bus-relay-start.js';
import { stopBusRelays } from '../../src/services/bus-relay.js';
import { createMaintenanceCache } from '../../src/services/maintenance-cache.js';
import type { BusWire, BusWireHandlers } from '../../src/storage/bus-wire.js';
import type { FederationPeerRecord, MaintenanceState, Storage } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-bus-reconnect-001';
const OFF: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(async () => { await stopBusRelays(); });

function peerRow(nodeId: string): FederationPeerRecord {
  return {
    nodeId, url: `http://${nodeId}`, publicKey: `key-${nodeId}`, status: 'active', addedAt: '2026-11-01T00:00:00.000Z',
    lastSeen: '2026-11-01T00:00:00.000Z', shareCatalogue: true, replicateMemory: true, allowRouting: true,
  } as FederationPeerRecord;
}

/** A node process whose storage the test changes behind its back, as another process would. */
async function processWithWire() {
  const { loadConfig } = await import('../../src/config.js');
  const config = { ...loadConfig().config, nodeId: NODE, sealedConfigKeys: [] } as AimeatConfig;
  const db = {
    peers: [] as FederationPeerRecord[],
    settings: {} as Record<string, string>,
    maintenance: OFF,
    reads: { peers: 0, openings: 0, settings: 0, maintenance: 0 },
  };
  let handlers: BusWireHandlers | null = null;
  const wire: BusWire = {
    async send() { /* nothing goes out in this test */ },
    async listen(h) { handlers = h; },
    async close() { handlers = null; },
  };
  const storage = {
    busWire: () => wire,
    listFederationPeers: async () => { db.reads.peers++; return db.peers; },
    listAllMemory: async () => { db.reads.openings++; return { items: [] }; },
    supportsConfigPersistence: () => true,
    getAllConfigValues: async () => { db.reads.settings++; return { ...db.settings }; },
  } as unknown as Storage;
  const maintenance = createMaintenanceCache(async () => { db.reads.maintenance++; return db.maintenance; }, OFF, { rereadMs: 3_600_000 });
  const peers = new Map<string, PeerInfo>();
  await startNodeBusRelay({ storage, config, peers, maintenance });
  expect(handlers).not.toBeNull();
  return { config, db, peers, maintenance, reconnected: () => handlers!.reconnected() };
}

describe('the event bus came back after its connection dropped', () => {
  it('reads every registry again: peers, openings, maintenance and settings', async () => {
    const p = await processWithWire();
    const before = { ...p.db.reads };
    p.reconnected();
    await settle();
    expect(p.db.reads.peers - before.peers).toBe(1);
    expect(p.db.reads.openings - before.openings).toBe(1);
    expect(p.db.reads.maintenance - before.maintenance).toBe(1);
    expect(p.db.reads.settings - before.settings).toBe(1);
  });

  it('a change another process made while the connection was down is in force after it came back', async () => {
    const p = await processWithWire();
    const was = p.config.registrationMode;
    const next = was === 'closed' ? 'invite' : 'closed';
    // Another process added a peer, switched maintenance on and closed registration; its NOTIFY went
    // out while this process was not listening.
    p.db.peers = [peerRow('aimeat-peer-added-in-the-gap')];
    p.db.maintenance = { enabled: true, message: 'switched in the gap', enabledAt: '2026-11-04T00:00:00.000Z', enabledBy: 'op' };
    p.db.settings = { 'registration.mode': next };
    await settle();
    expect(p.peers.has('aimeat-peer-added-in-the-gap')).toBe(false);
    expect(p.maintenance.get().enabled).toBe(false);
    expect(p.config.registrationMode).toBe(was);

    p.reconnected();
    await settle();
    expect(p.peers.has('aimeat-peer-added-in-the-gap')).toBe(true);
    expect(p.maintenance.get().enabled).toBe(true);
    expect(p.config.registrationMode).toBe(next);
  });
});

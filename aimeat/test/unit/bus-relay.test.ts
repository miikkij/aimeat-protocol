/**
 * @file test/unit/bus-relay.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event bus between two processes of one node, with an in-memory wire standing in
 *   for PostgreSQL NOTIFY (the real wire is exercised by test/e2e-two-process-bus.ts):
 *   - an event of process A reaches process B's listeners once, marked remote, with the same fields;
 *   - a message comes back to its own process and is dropped there, so one process tells each event once;
 *   - a listener that starts work (the origin rule) runs once across the two processes;
 *   - an event longer than one NOTIFY is cut, every part fits the wire, and B gets it whole;
 *   - an event over the relay's limit stays in its own process;
 *   - a `change` of a registry's domain reads that registry again before the listeners hear it, once
 *     for a burst, and a registry that does not answer holds the event at most reloadWaitMs;
 *   - reloadPeers, the stored-config reload and the maintenance refresh, which those registries are.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createBusRelay, encodeMessage, MAX_MESSAGE_BYTES, type BusRelay, type RemoteReload } from '../../src/services/bus-relay.js';
import { BUS_WIRE_PAYLOAD_BYTES } from '../../src/storage/bus-wire.js';
import {
  addBusTransport, emitChange, emitDelivery, emitPublicActivity, emitMemoryWritten, isRemoteEvent,
  onChangeEvent, offChangeEvent, onDeliveryEvent, offDeliveryEvent, onPublicActivityEvent, offPublicActivityEvent,
  onMemoryWrittenEvent, offMemoryWrittenEvent,
  type ChangeEvent, type DeliveryEvent, type PublicActivityEvent, type MemoryWriteEvent,
} from '../../src/services/event-bus.js';
import { reloadPeers } from '../../src/services/federation-peer-reload.js';
import { createStoredConfigReload } from '../../src/services/config/reload.js';
import { createMaintenanceCache } from '../../src/services/maintenance-cache.js';
import type { FederationPeerRecord, MaintenanceState } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-bus-unit-001';
const settle = () => new Promise((r) => setTimeout(r, 20));

/** The wire every relay of the "node" sends on; each message reaches every relay, its sender included, as NOTIFY does. */
function hub() {
  const relays: BusRelay[] = [];
  const sent: string[] = [];
  const wire = {
    async send(payloads: readonly string[]) {
      sent.push(...payloads);
      setImmediate(() => { for (const p of payloads) for (const r of relays) r.receive(p); });
    },
  };
  return { relays, sent, wire };
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** Process A publishes this process's events; process B only receives (it has no events of its own here). */
function twoProcesses(reloadsOfB: RemoteReload[] = [], reloadWaitMs?: number) {
  const h = hub();
  const a = createBusRelay({ wire: h.wire, nodeId: NODE, processId: 'A' });
  const b = createBusRelay({ wire: h.wire, nodeId: NODE, processId: 'B', reloads: reloadsOfB, ...(reloadWaitMs ? { reloadWaitMs } : {}) });
  h.relays.push(a, b);
  cleanups.push(addBusTransport(a));
  return { ...h, a, b };
}

function listen<T extends object>(on: (h: (e: T) => void) => void, off: (h: (e: T) => void) => void): Array<{ evt: T; remote: boolean }> {
  const seen: Array<{ evt: T; remote: boolean }> = [];
  const h = (evt: T) => { seen.push({ evt, remote: isRemoteEvent(evt) }); };
  on(h);
  cleanups.push(() => off(h));
  return seen;
}

describe('bus relay: an event reaches the other process once', () => {
  it('a change on A is told on B as remote, with the same fields, and once on A as local', async () => {
    const { a, b } = twoProcesses();
    const seen = listen<ChangeEvent>(onChangeEvent, offChangeEvent);
    emitChange('memory', 'alice@x');
    await a.idle(); await settle(); await b.idle();
    expect(seen.map(s => s.remote)).toEqual([false, true]);
    expect(seen[1]!.evt).toEqual(seen[0]!.evt);
  });

  it('with one process, its own message comes back and is dropped: every listener hears each event once', async () => {
    const h = hub();
    const only = createBusRelay({ wire: h.wire, nodeId: NODE, processId: 'ONLY' });
    h.relays.push(only);
    cleanups.push(addBusTransport(only));
    const seen = listen<ChangeEvent>(onChangeEvent, offChangeEvent);
    emitChange('apps');
    emitChange('memory');
    await only.idle(); await settle(); await only.idle();
    expect(h.sent.length).toBe(2);
    expect(seen.map(s => [s.evt.domain, s.remote])).toEqual([['apps', false], ['memory', false]]);
  });

  it('a public activity event keeps exactly its own fields on B (the visitor stream sends the object as it is)', async () => {
    const { a, b } = twoProcesses();
    const seen = listen<PublicActivityEvent>(onPublicActivityEvent, offPublicActivityEvent);
    const evt: PublicActivityEvent = { category: 'apps', at: '2026-11-04T10:00:00.000Z', actor: 'alice', summary: 'published', detail: 'x', link: '/apps/x' };
    emitPublicActivity(evt);
    await a.idle(); await settle(); await b.idle();
    expect(seen.length).toBe(2);
    expect(JSON.stringify(seen[1]!.evt)).toBe(JSON.stringify(evt));
    expect(seen[1]!.remote).toBe(true);
    expect(isRemoteEvent(evt)).toBe(false);
  });

  it('the origin rule: a listener that starts work runs once for one write across the two processes', async () => {
    const { a, b } = twoProcesses();
    let started = 0;
    const startsWork = (evt: MemoryWriteEvent) => { if (!isRemoteEvent(evt)) started++; };
    let told = 0;
    const tells = () => { told++; };
    onMemoryWrittenEvent(startsWork); onMemoryWrittenEvent(tells);
    cleanups.push(() => { offMemoryWrittenEvent(startsWork); offMemoryWrittenEvent(tells); });
    emitMemoryWritten('alice@x', 'notes.one', 'created');
    await a.idle(); await settle(); await b.idle();
    expect(started).toBe(1);
    expect(told).toBe(2);
  });

  it('events from A are told on B in the order A produced them', async () => {
    const { a, b } = twoProcesses();
    const seen = listen<ChangeEvent>(onChangeEvent, offChangeEvent);
    for (let i = 0; i < 50; i++) emitChange(`d${i}`);
    await a.idle(); await settle(); await b.idle();
    expect(seen.filter(s => s.remote).map(s => s.evt.domain)).toEqual(Array.from({ length: 50 }, (_, i) => `d${i}`));
  });
});

describe('bus relay: a long event', () => {
  it('a delivery longer than one NOTIFY is cut into parts that each fit the wire, and arrives whole', async () => {
    const { a, b, sent } = twoProcesses();
    const seen = listen<DeliveryEvent>(onDeliveryEvent, offDeliveryEvent);
    const description = 'Käännä tämä ✓ '.repeat(4000);   // multi-byte characters, about 70 kB
    emitDelivery({ target: 'agent#alice@x', kind: 'task_assigned', id: 't-1', payload: { id: 't-1', description } });
    await a.idle(); await settle(); await b.idle();
    expect(sent.length).toBeGreaterThan(1);
    for (const p of sent) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(BUS_WIRE_PAYLOAD_BYTES);
    const remote = seen.filter(s => s.remote);
    expect(remote.length).toBe(1);
    expect(remote[0]!.evt).toEqual(seen.find(s => !s.remote)!.evt);
  });

  it('an event over the relay limit is not sent, and its own process still hears it', async () => {
    expect(encodeMessage('A', 'delivery', { payload: 'x'.repeat(MAX_MESSAGE_BYTES + 1) })).toEqual([]);
    const { a, b, sent } = twoProcesses();
    const seen = listen<DeliveryEvent>(onDeliveryEvent, offDeliveryEvent);
    emitDelivery({ target: 'agent#alice@x', kind: 'task_assigned', id: 't-2', payload: 'x'.repeat(MAX_MESSAGE_BYTES + 1) });
    await a.idle(); await settle(); await b.idle();
    expect(sent.length).toBe(0);
    expect(seen.map(s => s.remote)).toEqual([false]);
  });
});

describe('bus relay: registries before the streams', () => {
  it('a `config` change from A reads B\'s settings again before B\'s listeners hear it, once for a burst', async () => {
    let reads = 0;
    let value = 'old';
    const order: string[] = [];
    const reload: RemoteReload = { name: 'settings', domains: ['config'], run: async () => { reads++; await settle(); value = 'new'; order.push('reloaded'); } };
    const { a, b } = twoProcesses([reload]);
    const seen: string[] = [];
    const h = (evt: ChangeEvent) => { if (isRemoteEvent(evt) && evt.domain === 'config') { seen.push(value); order.push('told'); } };
    onChangeEvent(h); cleanups.push(() => offChangeEvent(h));
    emitChange('config'); emitChange('config'); emitChange('config');
    await a.idle(); await settle(); await b.idle();
    expect(seen).toEqual(['new', 'new', 'new']);
    expect(order[0]).toBe('reloaded');
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('a registry that does not answer holds the event at most reloadWaitMs', async () => {
    const stuck: RemoteReload = { name: 'stuck', domains: ['federation'], run: () => new Promise<void>(() => undefined) };
    const { a, b } = twoProcesses([stuck], 50);
    const seen = listen<ChangeEvent>(onChangeEvent, offChangeEvent);
    const started = Date.now();
    emitChange('federation');
    await a.idle(); await settle(); await b.idle();
    expect(seen.filter(s => s.remote).length).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a domain no registry reads is told without reading anything', async () => {
    let reads = 0;
    const { a, b } = twoProcesses([{ name: 'peers', domains: ['federation'], run: async () => { reads++; } }]);
    emitChange('memory');
    await a.idle(); await settle(); await b.idle();
    expect(reads).toBe(0);
  });
});

// ── The registries ──────────────────────────────────────────────────────────

function row(nodeId: string, extra: Partial<FederationPeerRecord> = {}): FederationPeerRecord {
  return {
    nodeId, url: `http://${nodeId}`, publicKey: `key-${nodeId}`, status: 'active', addedAt: '2026-11-01T00:00:00.000Z',
    lastSeen: '2026-11-01T00:00:00.000Z', shareCatalogue: true, replicateMemory: true, allowRouting: true,
    ...extra,
  } as FederationPeerRecord;
}

describe('reloadPeers', () => {
  it('drops a peer storage no longer has, adds a new one, and takes the operator\'s decisions', async () => {
    const { peerInfoFromRow } = await import('../../src/services/federation-peer-reload.js');
    const peers = new Map<string, PeerInfo>();
    peers.set('gone', peerInfoFromRow(row('gone')));
    const kept = peerInfoFromRow(row('kept'));
    peers.set('kept', kept);
    const stored = [row('kept', { allowSettlement: false, tier: 'contact', status: 'suspended' }), row('new'), row(NODE)];
    const out = await reloadPeers({ listFederationPeers: async () => stored }, peers, NODE);
    expect(out).toEqual({ added: 1, removed: 1 });
    expect([...peers.keys()].sort()).toEqual(['kept', 'new']);
    expect(peers.get('kept')).toBe(kept);               // the same object: every holder of it sees the change
    expect(kept.allowSettlement).toBe(false);
    expect(kept.tier).toBe('contact');
    expect(kept.status).toBe('suspended');
  });

  it('keeps what this process learned from the peer: last seen, liveness status, version, heartbeats', async () => {
    const { peerInfoFromRow } = await import('../../src/services/federation-peer-reload.js');
    const peers = new Map<string, PeerInfo>();
    const p = peerInfoFromRow(row('p', { status: 'offline' }));
    p.status = 'active'; p.lastSeen = '2026-11-04T09:00:00.000Z'; p.softwareVersion = '4.2.0'; p.heartbeatOk = 9;
    peers.set('p', p);
    await reloadPeers({ listFederationPeers: async () => [row('p', { status: 'offline', softwareVersion: '4.1.0', heartbeatOk: 1 })] }, peers, NODE);
    expect(p.status).toBe('active');
    expect(p.lastSeen).toBe('2026-11-04T09:00:00.000Z');
    expect(p.softwareVersion).toBe('4.2.0');
    expect(p.heartbeatOk).toBe(9);
  });

  it('leaves a peer this process added, replaced or removed while the read was under way', async () => {
    const { peerInfoFromRow } = await import('../../src/services/federation-peer-reload.js');
    const peers = new Map<string, PeerInfo>();
    peers.set('removed-here', peerInfoFromRow(row('removed-here')));
    let release!: (rows: FederationPeerRecord[]) => void;
    const reading = reloadPeers({ listFederationPeers: () => new Promise((r) => { release = r; }) }, peers, NODE);
    peers.delete('removed-here');                                   // an emergency removal on this process
    peers.set('added-here', peerInfoFromRow(row('added-here')));    // a peer added before its row is written
    release([row('removed-here')]);
    await reading;
    expect(peers.has('removed-here')).toBe(false);
    expect(peers.has('added-here')).toBe(true);
  });
});

describe('createStoredConfigReload', () => {
  it('applies the rows another process changed, and nothing else', async () => {
    const { loadConfig } = await import('../../src/config.js');
    const config = { ...loadConfig().config, sealedConfigKeys: [] } as AimeatConfig;
    let rows: Record<string, string> = {};
    const storage = { supportsConfigPersistence: () => true, getAllConfigValues: async () => rows };
    const reload = createStoredConfigReload(config, storage);
    await reload.prime();
    const was = config.registrationMode;
    const next = was === 'closed' ? 'invite' : 'closed';
    rows = { 'registration.mode': next };                  // registration turned off on another process
    expect(await reload.reload()).toEqual(['registration.mode']);
    expect(config.registrationMode).toBe(next);
    config.registrationMode = was;                         // this process changed it on its own since
    expect(await reload.reload()).toEqual([]);            // the row did not change: nothing is applied
    expect(config.registrationMode).toBe(was);
  });

  it('binds a hook row as the boot does', async () => {
    const { loadConfig } = await import('../../src/config.js');
    const config = { ...loadConfig().config, sealedConfigKeys: [] } as AimeatConfig;
    const hook = Object.keys(config.extensionHooks)[0]!;
    let rows: Record<string, string> = {};
    const reload = createStoredConfigReload(config, { supportsConfigPersistence: () => true, getAllConfigValues: async () => rows });
    await reload.prime();
    rows = { [`hooks.${hook}`]: JSON.stringify(['act#provider']) };
    await reload.reload();
    expect((config.extensionHooks as Record<string, unknown>)[hook]).toEqual(['act#provider']);
  });
});

describe('maintenance refresh', () => {
  it('reads storage at once when another process says it switched maintenance', async () => {
    const OFF: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };
    let stored = OFF;
    const cache = createMaintenanceCache(async () => stored, OFF, { rereadMs: 60_000 });
    stored = { enabled: true, message: 'other process', enabledAt: '2026-11-04T00:00:00.000Z', enabledBy: 'op' };
    expect(cache.get().enabled).toBe(false);
    await cache.refresh();
    expect(cache.get().enabled).toBe(true);
    expect(cache.get().message).toBe('other process');
  });
});

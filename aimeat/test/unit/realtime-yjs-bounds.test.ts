/**
 * @file test/unit/realtime-yjs-bounds.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a realtime room keeps of the Yjs documents its peers sync, on the real
 *   RealtimeManager with a stub storage and fake sockets (secaudit2026oct26,
 *   realtime-manager.ts:yjsSnapshots:unbounded and saveAllYjsSnapshots:peer-docid-written-into-creator-namespace):
 *   - a room keeps the latest state of at most realtime.max_docs_per_room documents; a document past
 *     it is still relayed to the room, and its sender is told the limit;
 *   - an anonymous echat room keeps no document state;
 *   - the shutdown write files at most that many records under the room's creator, none for echat;
 *   - the use kept: a few documents per room are relayed, kept and replayed to a late joiner as
 *     before, and 0 is no limit.
 * @usage cd aimeat && pnpm exec vitest run test/unit/realtime-yjs-bounds.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { RealtimeManager } from '../../src/services/realtime-manager.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

/** A socket the manager can send to and hear from. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.readyState = 3; this.emit('close'); }
  frame(obj: unknown): void { this.emit('message', Buffer.from(JSON.stringify(obj))); }
  of(type: string): any[] { return this.sent.filter(m => m.type === type); }
}

let written: MemoryRecord[] = [];
const storage = {
  createRealtimeRoom: async () => undefined,
  updateRealtimeRoom: async () => undefined,
  deleteRealtimeRoom: async () => undefined,
  setMemory: async (r: MemoryRecord) => { written.push(r); return r; },
} as unknown as Storage;

function manager(maxDocs: number): RealtimeManager {
  const config = {
    nodeId: 'aimeat-test-rt-yjs', realtimeMaxRooms: 100, realtimeMaxPeersPerRoom: 20, realtimeRoomIdleTimeoutMs: 3_600_000,
    realtimeMaxMessageSizeBytes: 16_384, realtimeRateLimitPerSecond: 1000, realtimeMaxDocsPerRoom: maxDocs,
  } as unknown as AimeatConfig;
  return new RealtimeManager(config, storage);
}

const CREATOR = 'alice@aimeat-test-rt-yjs';

async function roomWithTwo(m: RealtimeManager) {
  const room = await m.createRoom({ appType: 'whiteboard', name: 'yjs', createdBy: CREATOR });
  const a = new FakeSocket(); const b = new FakeSocket();
  m.handleUpgrade(a as unknown as WebSocket, room.id, 'a');
  m.handleUpgrade(b as unknown as WebSocket, room.id, 'b');
  return { room, a, b };
}

beforeEach(() => { written = []; });

describe('a realtime room and the Yjs documents its peers sync', () => {
  it('relays, keeps and replays a few documents as before', async () => {
    const m = manager(64);
    const { room, a, b } = await roomWithTwo(m);
    a.frame({ type: 'yjs-sync', docId: 'doc-1', update: 'AAEC' });
    a.frame({ type: 'yjs-sync', docId: 'doc-2', update: 'AAED' });
    expect(b.of('yjs-sync').map(f => f.docId)).toEqual(['doc-1', 'doc-2']);
    const late = new FakeSocket();
    m.handleUpgrade(late as unknown as WebSocket, room.id, 'late');
    late.frame({ type: 'yjs-sync', docId: 'doc-2', requestState: true });
    expect(late.of('yjs-sync')).toEqual([{ type: 'yjs-sync', from: '__server__', docId: 'doc-2', update: 'AAED' }]);
    expect(a.of('error')).toEqual([]);
  });

  it('keeps at most realtime.max_docs_per_room documents, still relays the next, and tells its sender', async () => {
    const m = manager(3);
    const { room, a, b } = await roomWithTwo(m);
    for (let i = 0; i < 10; i++) a.frame({ type: 'yjs-sync', docId: `d${i}`, update: 'AAEC' });
    expect(room.yjsSnapshots.size).toBe(3);
    expect(b.of('yjs-sync')).toHaveLength(10);
    expect(a.of('error').some(e => e.code === 'DOC_LIMIT_REACHED')).toBe(true);
    // A document already kept is updated past the limit.
    a.frame({ type: 'yjs-sync', docId: 'd0', update: 'BBBB' });
    expect(room.yjsSnapshots.get('d0')).toBe('BBBB');
  });

  it('keeps every document when the limit is 0', async () => {
    const m = manager(0);
    const { room, a } = await roomWithTwo(m);
    for (let i = 0; i < 100; i++) a.frame({ type: 'yjs-sync', docId: `d${i}`, update: 'AAEC' });
    expect(room.yjsSnapshots.size).toBe(100);
    expect(a.of('error')).toEqual([]);
  });

  it('keeps no document state in an anonymous echat room', async () => {
    const m = manager(64);
    const room = await m.getOrCreateRoomByName('echat-yjs', 'echat-anonymous');
    const a = new FakeSocket(); const b = new FakeSocket();
    m.handleUpgrade(a as unknown as WebSocket, room.id, 'anon-1');
    m.handleUpgrade(b as unknown as WebSocket, room.id, 'anon-2');
    a.frame({ type: 'yjs-sync', docId: 'e1', update: 'AAEC' });
    expect(b.of('yjs-sync')).toHaveLength(1);
    expect(room.yjsSnapshots.size).toBe(0);
  });

  it('files at most the limit under the creator at shutdown, and nothing for an echat room', async () => {
    const m = manager(3);
    const { a } = await roomWithTwo(m);
    for (let i = 0; i < 10; i++) a.frame({ type: 'yjs-sync', docId: `d${i}`, update: 'AAEC' });
    const echat = await m.getOrCreateRoomByName('echat-yjs-2', 'echat-anonymous');
    const e = new FakeSocket();
    m.handleUpgrade(e as unknown as WebSocket, echat.id, 'anon');
    e.frame({ type: 'yjs-sync', docId: 'e1', update: 'AAEC' });
    await m.shutdown();
    expect(written).toHaveLength(3);
    expect(written.every(r => r.ownerGaii === CREATOR && r.key.startsWith('realtime.yjs.'))).toBe(true);
  });
});

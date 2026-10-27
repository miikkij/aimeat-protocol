/**
 * @file test/unit/realtime-upgrade-guards.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The limits the realtime upgrade applies before a socket joins a room
 *   (services/realtime-upgrade-guards.ts; secaudit2026oct26):
 *   - upgradeClientKey counts an anonymous echat visitor by the address Express would give req.ip:
 *     behind a trusted same-host proxy two visitors are two keys, with no trusted proxy the socket
 *     address is kept (local dev, pnpm sandbox), a forged header from an untrusted peer changes
 *     nothing, and IPv6 is folded to its /64;
 *   - EchatDoor keeps visitors to realtime.echat_max_rooms rooms (0 = no separate limit), lets a
 *     visitor into a room that already exists past it, never takes a room the apps need, and closes
 *     a room nobody joined once its handshake ends;
 *   - realtimeMaxPayload is above the largest frame the size check passes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/realtime-upgrade-guards.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { upgradeClientKey, EchatDoor, realtimeMaxPayload, type TrustProxyFn } from '../../src/services/realtime-upgrade-guards.js';
import { RealtimeManager } from '../../src/services/realtime-manager.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

function trustOf(setting: unknown): TrustProxyFn {
  const app = express();
  app.set('trust proxy', setting);
  return app.get('trust proxy fn') as TrustProxyFn;
}
const req = (socket: string, xff?: string) => ({ socket: { remoteAddress: socket }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as never;

describe('upgradeClientKey', () => {
  it('behind a trusted loopback proxy, two visitors are two keys', () => {
    const trust = trustOf('loopback');
    expect(upgradeClientKey(req('127.0.0.1', '203.0.113.5'), trust)).toBe('203.0.113.5');
    expect(upgradeClientKey(req('127.0.0.1', '198.51.100.7'), trust)).toBe('198.51.100.7');
    expect(upgradeClientKey(req('::1', '198.51.100.7'), trust)).toBe('198.51.100.7');
  });
  it('takes the nearest address the proxy did not vouch for, so a visitor cannot pick its key', () => {
    const trust = trustOf('loopback');
    expect(upgradeClientKey(req('127.0.0.1', '1.2.3.4, 203.0.113.5'), trust)).toBe('203.0.113.5');
  });
  it('with no trusted proxy keeps the socket address, whatever the header says', () => {
    expect(upgradeClientKey(req('127.0.0.1', '203.0.113.5'), null)).toBe('127.0.0.1');
    expect(upgradeClientKey(req('198.51.100.9', '203.0.113.5'), trustOf('loopback'))).toBe('198.51.100.9');
  });
  it('folds IPv6 to its /64, as the HTTP limiters do', () => {
    expect(upgradeClientKey(req('127.0.0.1', '2001:db8:1:2:aaaa::1'), trustOf('loopback'))).toBe('2001:db8:1:2::/64');
    expect(upgradeClientKey(req('2001:db8:1:2::9'), null)).toBe('2001:db8:1:2::/64');
  });
});

describe('realtimeMaxPayload', () => {
  it('is above three bytes for each character the size check allows', () => {
    expect(realtimeMaxPayload(16_384)).toBeGreaterThan(16_384 * 3);
    expect(realtimeMaxPayload(16_384)).toBeLessThan(1024 * 1024);
  });
});

class FakeSocket extends EventEmitter {
  readyState = 1;
  send(): void { /* not read here */ }
  close(): void { this.readyState = 3; this.emit('close'); }
}
const storage = {
  createRealtimeRoom: async () => undefined, updateRealtimeRoom: async () => undefined, deleteRealtimeRoom: async () => undefined,
} as unknown as Storage;
function setup(echatMax: number, maxRooms = 100) {
  const config = {
    nodeId: 'aimeat-test-echat-door', realtimeMaxRooms: maxRooms, realtimeMaxPeersPerRoom: 20, realtimeRoomIdleTimeoutMs: 3_600_000,
    realtimeMaxMessageSizeBytes: 16_384, realtimeRateLimitPerSecond: 50, realtimeMaxDocsPerRoom: 64, realtimeEchatMaxRooms: echatMax,
  } as unknown as AimeatConfig;
  const manager = new RealtimeManager(config, storage);
  return { manager, door: new EchatDoor(manager, config) };
}
const join = (m: RealtimeManager, roomId: string) => m.handleUpgrade(new FakeSocket() as unknown as WebSocket, roomId, 'anon');

describe('EchatDoor', () => {
  it('keeps visitors to the echat limit, lets them into a room that exists, and leaves the apps their rooms', async () => {
    const { manager, door } = setup(2, 3);
    const a = await door.open('room-a'); join(manager, a.room.id); a.settle();
    const b = await door.open('room-b'); join(manager, b.room.id); b.settle();
    await expect(door.open('room-c')).rejects.toThrow('ROOM_LIMIT_REACHED');
    const again = await door.open('room-a');
    expect(again.room.id).toBe(a.room.id);
    const app = await manager.createRoom({ appType: 'whiteboard', name: 'app', createdBy: 'alice@n' });
    expect(app.id).toBeTruthy();
  });

  it('has no separate limit at 0', async () => {
    const { door } = setup(0);
    for (let i = 0; i < 10; i++) await door.open(`room-${i}`);
  });

  it('closes a room nobody joined when its handshake ends, and keeps one a visitor joined', async () => {
    const { manager, door } = setup(50);
    const broken = await door.open('broken');
    broken.settle();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getRoom(broken.room.id)).toBeNull();

    const kept = await door.open('kept');
    join(manager, kept.room.id);
    kept.settle();
    kept.settle();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getRoom(kept.room.id)).not.toBeNull();
  });

  it('does not close a room under a second visitor still in the handshake', async () => {
    const { manager, door } = setup(50);
    const first = await door.open('shared');
    const second = await door.open('shared');
    first.settle();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getRoom(second.room.id)).not.toBeNull();
    join(manager, second.room.id);
    second.settle();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getRoom(second.room.id)).not.toBeNull();
  });
});

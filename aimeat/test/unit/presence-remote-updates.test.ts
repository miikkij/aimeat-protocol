/**
 * @file test/unit/presence-remote-updates.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A federation peer's presence push sets the presence of that peer's own people only,
 *   and only with a defined status (secaudit2026oct22, presence-peer-push-unbound-ghii-node).
 * @usage pnpm exec vitest run test/unit/presence-remote-updates.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — secaudit2026oct22: third-node and undefined-status cases, and the honest
 *     push of a peer's own people.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PresenceTracker } from '../../src/services/presence.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';

const VIEWER = 'viewer@node-a';
const trackers: PresenceTracker[] = [];

function trackerWithPeers(): PresenceTracker {
  const t = new PresenceTracker();
  const peers = new Map<string, PeerInfo>([
    ['peer-b', { nodeId: 'peer-b', status: 'active' } as unknown as PeerInfo],
    ['peer-c', { nodeId: 'peer-c', status: 'active' } as unknown as PeerInfo],
  ]);
  t.init({ nodeId: 'node-a' } as unknown as AimeatConfig, {} as unknown as Storage, peers);
  trackers.push(t);
  return t;
}

afterEach(() => { while (trackers.length) trackers.pop()!.stop(); });

describe('applyRemoteUpdates', () => {
  it('keeps a peer\'s push about its own people', async () => {
    const t = trackerWithPeers();
    t.applyRemoteUpdates('peer-b', [{ ghii: 'bob@peer-b', status: 'busy', since: '2026-10-25T10:00:00.000Z' }]);
    expect(await t.getVisible(VIEWER, 'bob@peer-b')).toEqual({ ghii: 'bob@peer-b', status: 'busy', since: '2026-10-25T10:00:00.000Z' });
    t.applyRemoteUpdates('peer-b', [{ ghii: 'bob@peer-b', status: 'unknown', since: null }]);
    expect((await t.getVisible(VIEWER, 'bob@peer-b')).status).toBe('unknown');
  });

  it('ignores a peer\'s push about a person homed on a third node', async () => {
    const t = trackerWithPeers();
    t.applyRemoteUpdates('peer-c', [{ ghii: 'carol@peer-c', status: 'away', since: null }]);
    t.applyRemoteUpdates('peer-b', [{ ghii: 'carol@peer-c', status: 'available', since: null }]);
    expect((await t.getVisible(VIEWER, 'carol@peer-c')).status).toBe('away');
    t.applyRemoteUpdates('peer-b', [{ ghii: 'carol@peer-c', status: 'unknown', since: null }]);
    expect((await t.getVisible(VIEWER, 'carol@peer-c')).status).toBe('away');
  });

  it('ignores a status outside the defined set', async () => {
    const t = trackerWithPeers();
    t.applyRemoteUpdates('peer-b', [{ ghii: 'bob@peer-b', status: 'on holiday until May' as never, since: null }]);
    expect((await t.getVisible(VIEWER, 'bob@peer-b')).status).toBe('unknown');
  });
});

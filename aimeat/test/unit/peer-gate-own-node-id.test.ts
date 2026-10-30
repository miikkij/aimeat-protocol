/**
 * @file test/unit/peer-gate-own-node-id.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description gatePeer refuses a source node equal to the id of the node that owns the peer map, at
 *   every door, whatever path wrote such a peer into the map. A peer speaks for the people of its node
 *   id, so a peer under this node's own id would speak for every person here (secaudit2026oct26 round
 *   8c, federation-07). Every other peer, and a map made without a node id, passes as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/peer-gate-own-node-id.test.ts
 * @version-history
 *   2026-10-29 -- Initial (secaudit2026oct26 round 8c, federation-07).
 */
import { describe, it, expect } from 'vitest';
import { gatePeer } from '../../src/services/federation-peer-gate.js';
import { peerRegistry, ownNodeIdOf } from '../../src/services/peer-registry.js';
import { deriveTierFlags } from '../../src/services/federation-tiers.js';
import type { PeerInfo } from '../../src/services/federation.js';

const now = new Date().toISOString();
const peer = (nodeId: string): PeerInfo => ({
  nodeId, url: `http://${nodeId}.example`, publicKey: `key-${nodeId}`, status: 'active', addedAt: now, lastSeen: now,
  ...deriveTierFlags('member'), tier: 'member',
});

describe('gatePeer and this node\'s own id', () => {
  it('refuses a peer filed under the node\'s own id, on every capability', () => {
    const peers = peerRegistry<PeerInfo>('node-a');
    peers.set('node-a', peer('node-a'));
    for (const cap of ['allowMessaging', 'allowBroadcast', 'replicateMemory', 'shareCatalogue', 'allowSettlement', 'allowRouting', null] as const) {
      const gate = gatePeer(peers, 'node-a', cap, { acceptStatuses: ['active', 'depeering'] });
      expect(gate).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
    }
  });

  it('designed use: another peer in the same registry passes as before', () => {
    const peers = peerRegistry<PeerInfo>('node-a');
    peers.set('node-b', peer('node-b'));
    const gate = gatePeer(peers, 'node-b', 'allowMessaging');
    expect(gate.ok).toBe(true);
  });

  it('designed use: a map made without a node id is gated as before', () => {
    const peers = new Map<string, PeerInfo>([['node-a', peer('node-a')]]);
    expect(ownNodeIdOf(peers)).toBeUndefined();
    expect(gatePeer(peers, 'node-a', 'allowMessaging').ok).toBe(true);
  });

  it('two registries in one process keep their own ids', () => {
    const a = peerRegistry<PeerInfo>('node-a');
    const b = peerRegistry<PeerInfo>('node-b');
    a.set('node-b', peer('node-b'));
    b.set('node-a', peer('node-a'));
    expect(gatePeer(a, 'node-b', null).ok).toBe(true);
    expect(gatePeer(b, 'node-a', null).ok).toBe(true);
    expect(ownNodeIdOf(a)).toBe('node-a');
    expect(ownNodeIdOf(b)).toBe('node-b');
  });
});

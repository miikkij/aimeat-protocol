/**
 * @file test/unit/package-peer-https.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A packages-only peer link (a seller, a grant's customer node, a claim's repository)
 *   asks the same address rule as every other peer admission (Core FED-13, services/peer-url-policy.ts):
 *   a public node takes only an https:// address, and a local node still links over plain http, which
 *   is how two sandbox nodes link. The card read is stubbed, so nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-peer-https.test.ts
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26, linkPackagePeer-no-peerUrlRefusal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/node-card.js', () => ({
  readNodeCard: vi.fn(async () => ({ ok: true, nodeId: 'node-b', publicKey: 'key-b' })),
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { linkPackagePeer } from '../../src/services/packages/peer/package-peer-register.js';
import type { PeerInfo } from '../../src/services/federation.js';

const WHO = { source: 'package-seller' as const, by: 'operator@node-a' };

describe('packages-only peer links follow the https rule of every peer admission', () => {
  let storage: SqliteStorage;
  let peers: Map<string, PeerInfo>;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); peers = new Map(); });

  it('a public node refuses a plain http address and writes nothing', async () => {
    const out = await linkPackagePeer({ storage, peers, timeoutMs: 1000, securityProfile: 'public' }, 'node-b',
      { url: 'http://b.example', public_key: 'key-b' }, WHO, { pendingWhenUnreachable: false });
    expect(out).toMatchObject({ ok: false, status: 400, code: 'PEER_HTTPS_REQUIRED' });
    expect(peers.size).toBe(0);
    expect(await storage.listFederationPeers()).toEqual([]);
  });

  it('designed use: a public node links an https address', async () => {
    const out = await linkPackagePeer({ storage, peers, timeoutMs: 1000, securityProfile: 'public' }, 'node-b',
      { url: 'https://b.example', public_key: 'key-b' }, WHO, { pendingWhenUnreachable: false });
    expect(out).toEqual({ ok: true, registered: true, pending: false });
    expect(peers.get('node-b')?.url).toBe('https://b.example');
  });

  it('designed use: a local node still links a plain http address', async () => {
    const out = await linkPackagePeer({ storage, peers, timeoutMs: 1000, securityProfile: 'local' }, 'node-b',
      { url: 'http://localhost:40601', public_key: 'key-b' }, WHO, { pendingWhenUnreachable: false });
    expect(out).toEqual({ ok: true, registered: true, pending: false });
  });
});

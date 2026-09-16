/**
 * @file test/unit/mcp-peer-transport.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Attaching another AIMEAT node as an MCP server: the peering is the permission.
 *
 *   A peer is NAMED, not addressed, and the difference is the whole feature. An address stored at
 *   attach time keeps working after the relationship that justified it has ended, which is the
 *   opposite of what the federation tiers are for. So the address is looked up on every call, and
 *   the assertions below are mostly about what happens when the peering changes under a link that
 *   already exists.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 6 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import type { FederationPeerRecord } from '../../src/storage/interface.js';
import { resolveWireAddress, buildTransport } from '../../src/services/mcp-client/transport.js';

const NODE = 'test-node-001';
const PEER = 'friend-node-002';

function peer(over: Partial<FederationPeerRecord> = {}): FederationPeerRecord {
  const now = new Date().toISOString();
  return {
    nodeId: PEER, url: 'https://friend.example', publicKey: 'k', status: 'active',
    addedAt: now, lastSeen: now,
    shareCatalogue: true, replicateMemory: true, allowRouting: true,
    allowMessaging: true, allowBroadcast: true, allowSettlement: true,
    peerMode: 'federation', allowFederatedAuth: false, federationAuthScopes: [],
    tier: 'member', ...over,
  } as FederationPeerRecord;
}

function server(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'friend', title: "A friend's node", description: '',
    ownership: 'owner', ownerGhii: `alice@${NODE}`, organismId: null, ws: null,
    createdBy: `alice@${NODE}`,
    transport: { kind: 'aimeat', peerNodeId: PEER },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('resolving a peer to an address', () => {
  it("becomes the peer's own MCP endpoint over ordinary http", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.saveFederationPeer(peer());

    const r = await resolveWireAddress(storage, server());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Nothing special about the wire: the guarded fetch, the credential and the timeout all apply
    // to it exactly as to anything else attached.
    expect(r.server.transport).toEqual({ kind: 'http', url: 'https://friend.example/v1/mcp' });
  });

  it('does not double the slash when the peer url ends in one', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.saveFederationPeer(peer({ url: 'https://friend.example/' }));

    const r = await resolveWireAddress(storage, server());
    expect(r.ok && r.server.transport).toEqual({ kind: 'http', url: 'https://friend.example/v1/mcp' });
  });

  it('leaves an ordinary server exactly as it is', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = server({ transport: { kind: 'http', url: 'https://jira.example/mcp' } });

    const r = await resolveWireAddress(storage, s);
    expect(r.ok && r.server).toBe(s);
  });
});

describe('when the peering will not carry it', () => {
  it('refuses a node this one has never peered with', async () => {
    const storage = new SqliteStorage(':memory:');
    const r = await resolveWireAddress(storage, server());
    expect(r).toMatchObject({ ok: false, code: 'PEER_UNKNOWN' });
  });

  it('refuses a peering that is no longer active', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.saveFederationPeer(peer({ status: 'revoked' }));
    // Absent and ended answer alike, which is why the message names neither state.
    expect(await resolveWireAddress(storage, server())).toMatchObject({
      ok: false, code: 'PEER_UNKNOWN',
    });
  });

  it('refuses a peer that does not carry routing', async () => {
    const storage = new SqliteStorage(':memory:');
    // `visiting` and `contact` cannot hold allowRouting at all: tierCeiling forbids raising it.
    // Calling a tool on somebody else's node IS forwarding traffic to them.
    await storage.saveFederationPeer(peer({ tier: 'visiting', allowRouting: false }));

    const r = await resolveWireAddress(storage, server());
    expect(r).toMatchObject({ ok: false, code: 'PEER_NOT_ROUTABLE' });
    expect(r.ok === false && r.message).toContain('promote');
  });

  it('stops an EXISTING link the moment routing is taken away', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.saveFederationPeer(peer());
    const s = server();
    expect((await resolveWireAddress(storage, s)).ok).toBe(true);

    // The whole reason the address is not stored at attach time.
    await storage.saveFederationPeer(peer({ allowRouting: false }));
    expect(await resolveWireAddress(storage, s)).toMatchObject({ code: 'PEER_NOT_ROUTABLE' });
  });
});

describe('what may not reach the wire', () => {
  it('refuses to build a transport for an unresolved peer', () => {
    // A programming error rather than a missing feature: something skipped resolveWireAddress, and
    // failing loudly here is what keeps that from becoming a silent second code path.
    expect(() => buildTransport(server(), null)).toThrow(/resolveWireAddress/);
  });

  it('still refuses a local process, which is a later phase', () => {
    const s = server({ transport: { kind: 'stdio', command: 'node', args: [] } });
    expect(() => buildTransport(s, null)).toThrow(/cannot run a local MCP server process/);
  });
});

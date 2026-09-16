/**
 * @file test/unit/mcp-discovery-source.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Attached MCP tools in the directory: what a caller finds, and what they must not.
 *
 *   The directory is the one surface where a leak is quiet. An entry that should not be there does
 *   not throw, does not 403, and does not look wrong — it just tells somebody that this account has
 *   a Jira. So the assertions that matter here are about absence.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 6 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { createRemoteMcpSource } from '../../src/services/discovery/sources/remote-mcp-source.js';
import type { DiscoveryContext } from '../../src/services/discovery/types.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node-001';
const config = { nodeId: NODE } as unknown as AimeatConfig;
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;

function server(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'jira', title: 'Jira', description: '',
    ownership: 'owner', ownerGhii: ALICE, organismId: null, ws: null, createdBy: ALICE,
    transport: { kind: 'http', url: 'https://jira.example/mcp' },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [
      { name: 'create_issue', description: 'Opens a ticket.', inputSchema: { type: 'object' } },
      { name: 'search_wiki', description: 'Looks through the pages.', inputSchema: { type: 'object' } },
    ],
    toolCacheHash: 'h', lastListedAt: now,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: now, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

const ctx = (over: Partial<DiscoveryContext> = {}): DiscoveryContext => ({
  caller: { ownerName: 'alice', sub: ALICE, gaii: ALICE, isOwnerSession: true, scopes: ['*'] },
  scope: 'own',
  filters: {},
  nodeId: NODE,
  ...over,
} as DiscoveryContext);

const run = async (storage: SqliteStorage, c: DiscoveryContext) => {
  const src = createRemoteMcpSource(storage, config);
  const hits = await src.enumerate(c);
  return hits.map((h) => src.toEntry(h, c));
};

describe('what a caller finds', () => {
  it('one entry per TOOL, not per server', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const entries = await run(storage, ctx());
    // A server is a container; a tool is the thing somebody is looking for.
    expect(entries.map((e) => e.id).sort()).toEqual(['jira__create_issue', 'jira__search_wiki']);
  });

  it('under the id a caller can actually use', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const entries = await run(storage, ctx());
    // aimeat_mcp_call takes these two apart, and a flattened tool registers under exactly this.
    expect(entries[0].id).toMatch(/^jira__/);
    expect(entries[0].tags).toContain('server:jira');
  });

  it('never carries the endpoint', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const whole = JSON.stringify(await run(storage, ctx()));
    // The one thing this design keeps away from callers, everywhere, including here.
    expect(whole).not.toContain('jira.example');
    expect(whole).not.toContain('https://');
  });

  it('matches on a word in the tool description, not only the name', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const found = await run(storage, ctx({ filters: { q: 'ticket' } } as never));
    expect(found.map((e) => e.id)).toEqual(['jira__create_issue']);
  });

  it('ranks a name match above a description match', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const src = createRemoteMcpSource(storage, config);
    const hits = await src.enumerate(ctx({ filters: { q: 'search' } } as never));
    // Somebody typing a tool's name means that tool.
    expect(hits[0].score).toBe(2);
  });

  it('says where a tool came from, because that changes what to expect', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server({
      ownership: 'node', ownerGhii: null, availability: 'all-owners',
      price: { unit: 'morsels', perCall: 3 },
    }));

    const entries = await run(storage, ctx());
    expect(entries[0].tags).toContain('offered-by-this-node');
    // A caller deciding whether to call something should know it costs.
    expect(entries[0].tags).toContain('costs-morsels');
  });
});

describe('what a caller must NOT find', () => {
  it("another owner's server", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    const asBob = ctx({
      caller: { ownerName: 'bob', sub: BOB, gaii: BOB, isOwnerSession: true, scopes: ['*'] },
    } as never);
    // The quiet leak this whole suite exists for: learning that somebody else has a Jira.
    expect(await run(storage, asBob)).toEqual([]);
  });

  it('anything at all on a public scope', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    // `public` and `shared` mean somebody else's things, and nobody else's attached servers are
    // ever anybody's to see.
    expect(await run(storage, ctx({ scope: 'public' }))).toEqual([]);
    expect(await run(storage, ctx({ scope: 'shared' }))).toEqual([]);
  });

  it('a switched-off server', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server({ enabled: false }));
    expect(await run(storage, ctx())).toEqual([]);
  });

  it('a server waiting to be signed in to', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server({ status: 'needs_reauth' }));
    // Its cached tools may still be there, and offering them would be offering something that
    // cannot answer.
    expect(await run(storage, ctx())).toEqual([]);
  });

  it('a node-wide server this caller is not admitted to', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server({
      ownership: 'node', ownerGhii: null, availability: 'allowlist', allowlist: [BOB],
    }));
    expect(await run(storage, ctx())).toEqual([]);
  });
});

describe('when the source cannot read', () => {
  it('answers nothing rather than failing the whole directory', async () => {
    const broken = { listMcpServers() { return Promise.reject(new Error('db gone')); } } as never;
    // Discovery is where somebody goes when they do not know what exists. Failing the whole
    // question because one source is unwell is the wrong trade.
    expect(await run(broken, ctx())).toEqual([]);
  });
});

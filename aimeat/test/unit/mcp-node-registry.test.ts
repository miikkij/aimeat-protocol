/**
 * @file test/unit/mcp-node-registry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's registry: who a node-wide server admits, and what a call costs.
 *
 *   Two things here would be invisible if they were wrong. A server attached but not yet offered
 *   must admit NOBODY — the failure would be a whole node silently given an integration on the
 *   strength of a half-finished setup. And a call that never happened must not be charged, which is
 *   the one way a billing bug reaches somebody's balance rather than a log.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 4 of the MCP proxy.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import {
  nodeWideAdmits, requireUsableServer, listUsableServers,
} from '../../src/services/mcp-client/registry.js';
import { callRemoteTool } from '../../src/services/mcp-client/invoke.js';
import { sealMcpCredential } from '../../src/services/mcp-client/credential.js';
import { mcpClientPool } from '../../src/services/mcp-client/pool.js';

process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

const PORT = 40686;
const KEY = 'd'.repeat(64);
const config = { encryptionKey: KEY, totpSecretEncryptionKey: null } as never;

const ALICE = 'alice@test-node-001';
const BOB = 'bob@test-node-001';

let upstream: http.Server;
const transports = new Map<string, StreamableHTTPServerTransport>();

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let t = sid ? transports.get(sid) : undefined;
    if (!t) {
      const srv = new McpServer({ name: 'paid-upstream', version: '1.0.0' });
      srv.tool('quote', 'Costs money somewhere.', { symbol: z.string() },
        async ({ symbol }) => ({ content: [{ type: 'text', text: `quote:${symbol}` }] }));
      srv.tool('explodes', 'Throws, so the refund path is exercised.', {},
        async () => { throw new Error('upstream blew up'); });
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => transports.set(id, created),
      });
      t = created;
      await srv.connect(created);
    }
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    await t.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => upstream.listen(PORT, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await mcpClientPool.closeAll();
  for (const t of transports.values()) await t.close();
  await new Promise<void>((r) => upstream.close(() => r()));
});

function nodeServer(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'market', title: 'Market data', description: '',
    ownership: 'node', ownerGhii: null, organismId: null, ws: null,
    createdBy: 'operator@test-node-001',
    transport: { kind: 'http', url: `http://127.0.0.1:${PORT}/mcp` },
    auth: 'static',
    credential: sealMcpCredential({ shape: 'static', accessToken: 'tok' }, Buffer.from(KEY, 'hex')),
    credentialShape: 'static', expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: 'all-owners', allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

/**
 * An owner with a balance, because a priced call needs somebody to charge.
 *
 * The balance lives on the GHII record rather than on the owner, which is the whole point of the
 * morsel design: debitBalance resolves every agent to the human it acts for, and the human is the
 * GHII.
 */
async function ownerWith(storage: SqliteStorage, name: string, morsels: number): Promise<void> {
  const ghii = `${name}@test-node-001`;
  await storage.createGHII({
    username: name, nodeId: 'test-node-001', ghii, displayName: name,
    verificationLevel: 'none', ownerName: name, morselBalance: morsels,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as never);
}

const balanceOf = async (storage: SqliteStorage, ghii: string): Promise<number> =>
  (await storage.getGHII(ghii))?.morselBalance ?? 0;

describe('who a node-wide server admits', () => {
  it('admits everybody under all-owners', () => {
    expect(nodeWideAdmits(nodeServer({ availability: 'all-owners' }), ALICE)).toBe(true);
    expect(nodeWideAdmits(nodeServer({ availability: 'all-owners' }), BOB)).toBe(true);
  });

  it('admits only the named under allowlist', () => {
    const s = nodeServer({ availability: 'allowlist', allowlist: [ALICE] });
    expect(nodeWideAdmits(s, ALICE)).toBe(true);
    expect(nodeWideAdmits(s, BOB)).toBe(false);
  });

  it('admits NOBODY when the allowlist is empty', () => {
    // The safe reading, and a decision rather than an accident: an operator who has switched to
    // allowlist and not yet named anybody has closed the door, not opened it.
    expect(nodeWideAdmits(nodeServer({ availability: 'allowlist', allowlist: [] }), ALICE)).toBe(false);
  });

  it('admits NOBODY when availability was never set', () => {
    // Attached is not offered. A registry that defaulted to everyone would hand the whole node an
    // integration on the strength of a typo.
    expect(nodeWideAdmits(nodeServer({ availability: null }), ALICE)).toBe(false);
  });

  it('says no to a personal server, whatever its fields say', () => {
    const personal = nodeServer({ ownership: 'owner', ownerGhii: ALICE, availability: 'all-owners' });
    expect(nodeWideAdmits(personal, BOB)).toBe(false);
  });
});

describe('reaching one', () => {
  it('an admitted owner finds it by name and by id', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = nodeServer();
    await storage.createMcpServer(s);

    expect((await requireUsableServer(storage, ALICE, 'market'))?.id).toBe(s.id);
    expect((await requireUsableServer(storage, ALICE, s.id))?.id).toBe(s.id);
  });

  it('an owner who is NOT admitted gets nothing, by name or by id', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = nodeServer({ availability: 'allowlist', allowlist: [ALICE] });
    await storage.createMcpServer(s);

    // Absent and not-yours answer alike: naming it must not confirm the node offers it.
    expect(await requireUsableServer(storage, BOB, 'market')).toBeNull();
    expect(await requireUsableServer(storage, BOB, s.id)).toBeNull();
  });

  it("a person's OWN server wins over the node's of the same name", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(nodeServer());
    const mine = nodeServer({
      id: randomUUID(), ownership: 'owner', ownerGhii: ALICE, availability: null, title: 'Mine',
    });
    await storage.createMcpServer(mine);

    // Otherwise attaching your own would be silently shadowed by the house's.
    expect((await requireUsableServer(storage, ALICE, 'market'))?.id).toBe(mine.id);
  });

  it("the listing shows the node's offerings beside the owner's own", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(nodeServer());
    await storage.createMcpServer(nodeServer({
      id: randomUUID(), slug: 'private-one', availability: 'allowlist', allowlist: [BOB],
    }));

    const listed = await listUsableServers(storage, ALICE);
    // The one Alice is admitted to, and not the one reserved for Bob.
    expect(listed.map((s) => s.slug)).toEqual(['market']);
  });
});

describe('what a call costs', () => {
  const priced = (perCall: number) => nodeServer({ price: { unit: 'morsels', perCall } });

  it("charges the caller's owner per call", async () => {
    const storage = new SqliteStorage(':memory:');
    const s = priced(5);
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE,
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before - 5);
  });

  it('GIVES IT BACK when the call never reached anybody', async () => {
    const storage = new SqliteStorage(':memory:');
    // A port nothing listens on: the transport fails, so the far side did no work and there is
    // nothing to pay for. This is the one way a billing bug reaches a balance rather than a log.
    const s = nodeServer({
      price: { unit: 'morsels', perCall: 5 },
      transport: { kind: 'http', url: 'http://127.0.0.1:40685/mcp' },
    });
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'X' }, caller: ALICE,
    });
    expect(r.ok).toBe(false);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });

  it('DOES charge for a tool that ran and failed', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = priced(5);
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: s, tool: 'explodes', args: {}, caller: ALICE,
    });
    // The proxy WORKED and the far side did the work; the tool is what said no. Refunding here
    // would mean the operator carries the cost of every failed query somebody sends their paid
    // server, which is not what "the call never happened" means.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isError).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before - 5);
  });

  it('refuses when the balance will not cover it', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = priced(1_000_000);
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 0);

    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INSUFFICIENT');
  });

  it('refuses a money price by name rather than charging nothing quietly', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = nodeServer({ price: { unit: 'money', perCall: 1_000_000, currency: 'EUR' } });
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // An operator who priced in money learns why immediately, instead of discovering later that
    // nobody was ever charged.
    expect(r.code).toBe('PRICE_UNSUPPORTED');
    expect(r.message).toContain('morsels');
  });

  it('charges nothing for an unpriced server', async () => {
    const storage = new SqliteStorage(':memory:');
    const free = nodeServer({ price: null });
    await storage.createMcpServer(free);
    await ownerWith(storage, 'alice', 50);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: free, tool: 'quote', args: { symbol: 'X' }, caller: ALICE,
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });

  it('never charges for a personal server, whatever price somebody put on it', async () => {
    const storage = new SqliteStorage(':memory:');
    // A price on an owner's own row is meaningless — a person does not bill themselves — and the
    // charge path reads ownership rather than the price field for exactly that reason.
    const mine = nodeServer({
      ownership: 'owner', ownerGhii: ALICE, price: { unit: 'morsels', perCall: 99 },
    });
    await storage.createMcpServer(mine);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: mine, tool: 'quote', args: { symbol: 'X' }, caller: ALICE,
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });
});

/**
 * @file test/unit/mcp-node-registry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's registry: who a node-wide server admits, and what a price may be.
 *
 *   Two things here would be invisible if they were wrong. A server attached but not yet offered
 *   must admit NOBODY — the failure would be a whole node silently given an integration on the
 *   strength of a half-finished setup. And no call may ever take morsels from anybody, because
 *   morsels are a pacer and buy nothing; that failure reaches a balance rather than a log.
 * @version-history
 *   v1.3.0 — 2026-09-24 — The price arms hand the chokepoint Alice's scopes as a door does
 *     (heldScopes); it no longer reads a missing list as mcp:use (secaudit 2026-09 f740ecf9bc39).
 *   v1.2.0 — 2026-09-24 — Changing one: an owner a node-wide server admits may use it and never
 *     change it; an owner changes their own server and nobody else's (secaudit 2026-09 A2-1).
 *   v1.1.0 — 2026-09-16 — Morsels are not money. The four tests that asserted a morsel charge, its
 *     refund and the INSUFFICIENT refusal now assert that no balance ever moves, and a new block
 *     holds the one check every door uses to refuse a morsel price.
 *   v1.0.0 — 2026-09-16 — Phase 4 of the MCP proxy.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { normalizeMcpPrice, type McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import {
  nodeWideAdmits, requireUsableServer, requireManageableServer, listUsableServers,
} from '../../src/services/mcp-client/registry.js';
import { callRemoteTool } from '../../src/services/mcp-client/invoke.js';
import { heldScopes } from '../../src/auth/effective-scopes.js';
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
 * An owner with a morsel balance, so a test can prove that no call ever touches it.
 *
 * The balance lives on the GHII record. Morsels pace how much gets used; nothing on this path may
 * charge them as a price, and the assertions below are that the number never moves.
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

describe('changing one', () => {
  it('an owner it admits may USE it and may not change it, by name or by id', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = nodeServer();
    await storage.createMcpServer(s);

    expect((await requireUsableServer(storage, ALICE, s.id))?.id).toBe(s.id);
    // The operator changes it at /v1/mcp-servers/node/:id. Every personal door asks this question,
    // and before 2026-09-24 they asked the one above, so any admitted owner could switch it off.
    expect(await requireManageableServer(storage, ALICE, 'market', config)).toBeNull();
    expect(await requireManageableServer(storage, ALICE, s.id, config)).toBeNull();
  });

  it("an owner changes their OWN server, and nobody else's", async () => {
    const storage = new SqliteStorage(':memory:');
    const mine = nodeServer({ ownership: 'owner', ownerGhii: ALICE, availability: null });
    await storage.createMcpServer(mine);

    expect((await requireManageableServer(storage, ALICE, 'market', config))?.id).toBe(mine.id);
    expect((await requireManageableServer(storage, ALICE, mine.id, config))?.id).toBe(mine.id);
    expect(await requireManageableServer(storage, BOB, 'market', config)).toBeNull();
    expect(await requireManageableServer(storage, BOB, mine.id, config)).toBeNull();
  });
});

describe('a call never takes morsels', () => {
  /**
   * A row as phase 4 could store it, before the ruling. The type no longer allows it, and storage
   * still may hold it, which is exactly why the call path has to be tested against it.
   */
  const legacyMorselPriced = (perCall: number) =>
    nodeServer({ price: { unit: 'morsels', perCall } as unknown as McpServerRecord['price'] });

  /**
   * What a door hands the chokepoint for Alice in person: every word, by the owner's role. These
   * calls named no scopes until 2026-09-24 and passed on the chokepoint's mcp:use default, which is
   * gone (secaudit 2026-09 f740ecf9bc39). The setup changed to match the doors; the assertions did not.
   */
  const scopes = heldScopes({ roles: ['owner'], scopes: [] });

  it('leaves the balance exactly where it was, on a row still priced in morsels', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = legacyMorselPriced(5);
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE, scopes,
    });
    // Morsels are a pacer and buy nothing. The row reads as FREE rather than as an error, because
    // refusing every call on it would punish the owners for the operator's old setting.
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });

  it('answers an owner with NO morsels at all, which a morsel price used to refuse', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = legacyMorselPriced(1_000_000);
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 0);

    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE, scopes,
    });
    // Phase 4 answered INSUFFICIENT here. A person with no morsels is not a person who cannot pay.
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(0);
  });

  it('refuses a money price by name, and does not point the operator at morsels', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = nodeServer({ price: { unit: 'money', perCall: 1_000_000, currency: 'EUR' } });
    await storage.createMcpServer(s);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: s, tool: 'quote', args: { symbol: 'AAPL' }, caller: ALICE, scopes,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // An operator who priced in money learns why at once, instead of discovering later that nobody
    // was ever charged. The phase 4 message told them to "price it in morsels instead".
    expect(r.code).toBe('PRICE_UNSUPPORTED');
    expect(r.message.toLowerCase()).not.toContain('morsel');
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });

  it('charges nothing for an unpriced server', async () => {
    const storage = new SqliteStorage(':memory:');
    const free = nodeServer({ price: null });
    await storage.createMcpServer(free);
    await ownerWith(storage, 'alice', 50);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: free, tool: 'quote', args: { symbol: 'X' }, caller: ALICE, scopes,
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });

  it('never charges for a personal server, whatever price somebody put on it', async () => {
    const storage = new SqliteStorage(':memory:');
    // A price on an owner's own row is meaningless — a person does not bill themselves — and the
    // charge path reads ownership rather than the price field for exactly that reason.
    const mine = nodeServer({
      ownership: 'owner', ownerGhii: ALICE, price: { unit: 'money', perCall: 99, currency: 'EUR' },
    });
    await storage.createMcpServer(mine);
    await ownerWith(storage, 'alice', 100);

    const before = await balanceOf(storage, ALICE);
    const r = await callRemoteTool({
      storage, config, server: mine, tool: 'quote', args: { symbol: 'X' }, caller: ALICE, scopes,
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(storage, ALICE)).toBe(before);
  });
});

describe('writing a price, the one check every door uses', () => {
  it('refuses a morsel price, and says why in words', () => {
    const r = normalizeMcpPrice({ unit: 'morsels', perCall: 3 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Refused rather than quietly dropped: an operator who meant it learns at once, instead of
    // finding later that the server was free all along.
    expect(r.message).toMatch(/not money/);
  });

  it('accepts money, with or without the unit spelled out', () => {
    expect(normalizeMcpPrice({ unit: 'money', perCall: 250_000, currency: 'EUR' }))
      .toEqual({ ok: true, price: { unit: 'money', perCall: 250_000, currency: 'EUR' } });
    // The agent-facing tool has no unit field at all, so a price arrives without one.
    expect(normalizeMcpPrice({ perCall: 250_000, currency: 'USD' }))
      .toEqual({ ok: true, price: { unit: 'money', perCall: 250_000, currency: 'USD' } });
  });

  it('reads nothing, null and zero as free', () => {
    expect(normalizeMcpPrice(undefined)).toEqual({ ok: true, price: null });
    expect(normalizeMcpPrice(null)).toEqual({ ok: true, price: null });
    // A price of zero stored as a price would send every call through a meter to charge nothing.
    expect(normalizeMcpPrice({ unit: 'money', perCall: 0 })).toEqual({ ok: true, price: null });
  });

  it('refuses what is not a price at all', () => {
    for (const bad of [
      'five euros', { unit: 'gold', perCall: 1 }, { unit: 'money', perCall: -1 },
      { unit: 'money', perCall: 'lots' }, { unit: 'money', perCall: 1, currency: 'euro' },
    ]) {
      expect(normalizeMcpPrice(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

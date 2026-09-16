/**
 * @file test/unit/mcp-client-invoke.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The proxy chokepoint against a REAL MCP server, not a mock of one.
 *
 *   A stub of the SDK would prove that our code calls the functions we wrote, which is the one
 *   thing never in doubt. What is in doubt is the handshake, the tool schemas coming back in the
 *   shape we cache, isError surviving the round trip, and a dead server producing a parked row
 *   instead of an exception — and only a real server on a real socket answers those.
 *
 *   The upstream server is built with the SDK's own server half, so the protocol on the wire is the
 *   protocol, and the test moves when the SDK does.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { callRemoteTool, listRemoteTools, toolCacheHash } from '../../src/services/mcp-client/invoke.js';
import { sealMcpCredential } from '../../src/services/mcp-client/credential.js';
import { mcpClientPool } from '../../src/services/mcp-client/pool.js';

// Loopback egress is gated, and the whole point of this suite is a real socket. RFC1918 and
// link-local stay blocked regardless of this flag, which is what the SSRF suite relies on.
process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

const PORT = 40694;
// 32 bytes of hex: a real key, so the sealer runs for real rather than being bypassed.
const KEY = 'a'.repeat(64);
const config = { encryptionKey: KEY, totpSecretEncryptionKey: null } as never;

let httpServer: http.Server;
const openTransports = new Map<string, StreamableHTTPServerTransport>();

beforeAll(async () => {
  httpServer = http.createServer(async (req, res) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let transport = sid ? openTransports.get(sid) : undefined;
    if (!transport) {
      // A fresh McpServer per transport: one server instance binds to one transport, the same way
      // src/mcp/index.ts builds one per session.
      const srv = new McpServer({ name: 'upstream', version: '1.0.0' });
      srv.tool('echo', 'Repeats its input.', { text: z.string() },
        async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
      srv.tool('always_fails', 'Answers isError, the way a tool says no.', {},
        async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }));
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => openTransports.set(id, created),
      });
      transport = created;
      await srv.connect(created);
    }
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => httpServer.listen(PORT, '127.0.0.1', () => r()));
});

afterAll(async () => {
  // Close the pool before the socket: exiting under a live SSE stream aborts on Windows.
  await mcpClientPool.closeAll();
  for (const t of openTransports.values()) await t.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

function makeRow(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'upstream', title: 'Upstream', description: '',
    ownership: 'owner', ownerGhii: 'alice@node-a', organismId: null, ws: null,
    createdBy: 'alice@node-a',
    transport: { kind: 'http', url: `http://127.0.0.1:${PORT}/mcp` },
    auth: 'static',
    credential: sealMcpCredential({ shape: 'static', accessToken: 'tok' }, Buffer.from(KEY, 'hex')),
    credentialShape: 'static', expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('the MCP proxy chokepoint, against a real server', () => {
  it('lists the far side\'s tools and caches them with a hash', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const listed = await listRemoteTools(storage, config, row);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.tools.map((t) => t.name).sort()).toEqual(['always_fails', 'echo']);
    // The upstream schema is stored verbatim: a schema we edited is one that disagrees with the
    // server that will validate the call.
    expect(listed.tools.find((t) => t.name === 'echo')?.inputSchema).toHaveProperty('properties');
    // First list is always a change, because the cached hash starts empty.
    expect(listed.changed).toBe(true);

    const stored = await storage.getMcpServer(row.id);
    expect(stored?.toolCache).toHaveLength(2);
    expect(stored?.toolCacheHash).toBe(toolCacheHash(listed.tools));
    expect(stored?.lastOkAt).not.toBeNull();
  });

  it('reports no change when the same tools come back, so sessions are not woken for nothing', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    await listRemoteTools(storage, config, row);
    const again = await listRemoteTools(
      storage, config, (await storage.getMcpServer(row.id))!,
    );
    expect(again.ok && again.changed).toBe(false);
  });

  it('proxies a tool call and returns the far side\'s content', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text: 'hello' }, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isError).toBe(false);
    expect(JSON.stringify(r.content)).toContain('echo:hello');
  });

  it('keeps a tool saying no separate from the proxy failing', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'always_fails', args: {}, caller: 'alice@node-a',
    });
    // ok: the proxy worked. isError: the TOOL refused. Folding these together would make an
    // upstream "no" indistinguishable from our own machinery breaking.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isError).toBe(true);
  });

  it('refuses a switched-off server without touching the network', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow({ enabled: false });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text: 'x' }, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SERVER_DISABLED');
    // The one-gesture stop has to read as a sentence, not a code.
    expect(r.message).toContain('switched off');
  });

  it('parks an unreachable server rather than throwing', async () => {
    const storage = new SqliteStorage(':memory:');
    // A port nothing listens on. Loopback is permitted here, so this is a genuine refused
    // connection and not the SSRF guard answering.
    const row = makeRow({ transport: { kind: 'http', url: 'http://127.0.0.1:40693/mcp' } });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text: 'x' }, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UNREACHABLE');
    // The endpoint must not leak into what a caller is told.
    expect(r.message).not.toContain('40693');

    const stored = await storage.getMcpServer(row.id);
    expect(stored?.status).toBe('unreachable');
    // The reason IS kept on the row, for the owner's own panel.
    expect(stored?.lastError).toBeTruthy();
  });

  it('tells the owner to reconnect when the credential will not open', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow({ credential: 'aa:bb:cc' });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text: 'x' }, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('CREDENTIAL_UNREADABLE');
    expect((await storage.getMcpServer(row.id))?.status).toBe('needs_reauth');
  });

  it('answers a node with no encryption key by naming the env var, never by storing plaintext', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage,
      config: { encryptionKey: null, totpSecretEncryptionKey: null } as never,
      server: row, tool: 'echo', args: { text: 'x' }, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ENCRYPTION_KEY');
    expect(r.message).toContain('AIMEAT_ENCRYPTION_KEY');
  });

  it('refuses a local process on a node that does not run them, by name', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow({
      slug: 'unbuilt-stdio',
      transport: { kind: 'stdio', command: 'npx', args: ['some-server'] },
    });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: {}, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // This used to read TRANSPORT_UNSUPPORTED, because the kind was not built at all. It is built
    // now (phase 7) and OFF, which is a different sentence: the `config` here has no stdio
    // settings, and an unanswered question about running a program is a no.
    // mcp-stdio-policy.test.ts holds the three conditions and the near misses.
    expect(r.code).toBe('STDIO_DISABLED');
  });

  it('refuses a peer node this one has no peering with', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow({
      slug: 'unknown-peer',
      transport: { kind: 'aimeat', peerNodeId: 'peer-node-001' },
    });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: {}, caller: 'alice@node-a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // This used to read TRANSPORT_UNSUPPORTED, because the kind was not built. It is built now
    // (phase 6), and what refuses the call is the missing PEERING rather than the missing feature,
    // which is a different sentence for the person reading it. mcp-peer-transport.test.ts holds
    // the rest of the peering rules.
    expect(r.code).toBe('PEER_UNKNOWN');
  });
});

describe('the tool-cache hash', () => {
  const tool = (name: string, description: string) => ({
    name, description, inputSchema: { type: 'object' as const },
  });

  it('ignores order, because a reordered list changed nothing a client can do', () => {
    expect(toolCacheHash([tool('a', 'x'), tool('b', 'y')]))
      .toBe(toolCacheHash([tool('b', 'y'), tool('a', 'x')]));
  });

  it('ignores a reworded description, so a full stop does not wake every session', () => {
    expect(toolCacheHash([tool('a', 'Does a thing')]))
      .toBe(toolCacheHash([tool('a', 'Does a thing.')]));
  });

  it('moves when a tool appears', () => {
    expect(toolCacheHash([tool('a', 'x')])).not.toBe(toolCacheHash([tool('a', 'x'), tool('b', 'y')]));
  });

  it('moves when a schema changes, because that DOES change how a client must call', () => {
    expect(toolCacheHash([{ name: 'a', description: 'x', inputSchema: { type: 'object' } }]))
      .not.toBe(toolCacheHash([
        { name: 'a', description: 'x', inputSchema: { type: 'object', required: ['q'] } },
      ]));
  });
});

/**
 * @file test/unit/mcp-loop-brake.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A proxied MCP call cannot come back to where it started.
 *
 *   Two guards, and the tests hold each one to the case it exists for. The header (hops.ts) is the
 *   brake: it must ride on every request a POOLED client sends, carrying the chain of the call that
 *   request belongs to rather than the chain of whichever call built the client, and a 508 from the
 *   far side must refuse the call without parking a server that answers every other call. The address
 *   check is for the person at the form: their own node's address is refused before anything is
 *   stored, and any other spelling of it is caught by the first look and leaves no row behind.
 * @version-history
 *   v1.0.0 — 2026-09-17 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  MAX_MCP_HOPS, MCP_VIA_HEADER, outgoingVia, parseVia, runWithVia, selfAddressRefusal, viaRefusal,
} from '../../src/services/mcp-client/hops.js';
import { callRemoteTool, statusForRemoteRefusal } from '../../src/services/mcp-client/invoke.js';
import { mcpClientPool } from '../../src/services/mcp-client/pool.js';
import { mcpServersRouter } from '../../src/routes/mcp-servers.js';

process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

const NODE_ID = 'node-a';
const UPSTREAM_PORT = 40681;
const LOOPING_PORT = 40682;
const OWN_BASE = 'http://127.0.0.1:40683';

const config = {
  nodeId: NODE_ID,
  baseUrl: OWN_BASE,
  encryptionKey: 'c'.repeat(64),
  totpSecretEncryptionKey: null,
  accountEventWindow: 100,
} as unknown as AimeatConfig;

describe('reading the header', () => {
  it('keeps node ids and drops anything that is not one', () => {
    expect(parseVia('peer-x, node.b ,  bad id!, , x'.padEnd(10))).toEqual(['peer-x', 'node.b', 'x']);
    expect(parseVia(['a1', 'b2, c3'])).toEqual(['a1', 'b2', 'c3']);
    expect(parseVia(undefined)).toEqual([]);
  });

  it('caps a huge header, so it cannot become a huge list', () => {
    const many = Array.from({ length: 500 }, (_, i) => `n${i}`).join(',');
    expect(parseVia(many)).toHaveLength(32);
  });

  it('refuses a call that names this node, whatever the case', () => {
    expect(viaRefusal(['peer-x', 'NODE-A'], NODE_ID)?.code).toBe('LOOP_DETECTED');
  });

  it('refuses a chain that is too long, and lets a shorter one through', () => {
    const long = Array.from({ length: MAX_MCP_HOPS }, (_, i) => `p${i}`);
    expect(viaRefusal(long, NODE_ID)?.code).toBe('TOO_MANY_HOPS');
    expect(viaRefusal(long.slice(1), NODE_ID)).toBeNull();
    expect(viaRefusal([], NODE_ID)).toBeNull();
  });

  it('adds this node after the chain the current request arrived with', async () => {
    expect(outgoingVia(NODE_ID)).toBe(NODE_ID);
    await runWithVia(['peer-x'], async () => {
      await Promise.resolve();
      expect(outgoingVia(NODE_ID)).toBe('peer-x, node-a');
    });
  });
});

describe('the address check at attach time', () => {
  const own = { nodeId: NODE_ID, baseUrl: 'https://aimeat.example' };

  it('refuses this node\'s own MCP endpoints', () => {
    for (const url of ['https://aimeat.example/v1/mcp', 'https://AIMEAT.example/mcp/',
      'https://aimeat.example/v2/mcp/agent']) {
      expect(selfAddressRefusal(own, { kind: 'http', url })?.code, url).toBe('SELF_ADDRESS');
    }
    expect(selfAddressRefusal(own, { kind: 'sse', url: 'https://aimeat.example/mcp' })?.code)
      .toBe('SELF_ADDRESS');
  });

  it('refuses a peer that is this node', () => {
    expect(selfAddressRefusal(own, { kind: 'aimeat', peerNodeId: 'Node-A' })?.code).toBe('SELF_ADDRESS');
    expect(selfAddressRefusal(own, { kind: 'aimeat', peerNodeId: 'node-b' })).toBeNull();
  });

  it('lets through another host, another port and a path this node does not serve MCP on', () => {
    expect(selfAddressRefusal(own, { kind: 'http', url: 'https://wiki.example/v1/mcp' })).toBeNull();
    expect(selfAddressRefusal(own, { kind: 'http', url: 'https://aimeat.example:8443/v1/mcp' })).toBeNull();
    expect(selfAddressRefusal(own, { kind: 'http', url: 'https://aimeat.example/apps/x/mcp' })).toBeNull();
    expect(selfAddressRefusal(own, { kind: 'stdio' })).toBeNull();
  });

  it('leaves an address that does not parse to the check that owns it', () => {
    expect(selfAddressRefusal(own, { kind: 'http', url: 'not a url' })).toBeNull();
    expect(selfAddressRefusal({ nodeId: NODE_ID, baseUrl: '' }, { kind: 'http', url: 'https://x.example/mcp' }))
      .toBeNull();
  });
});

// ── Against real sockets ────────────────────────────────────────────────────────────────────────

/** What the upstream saw on each tools/call: the text argument, and the header that came with it. */
const seen: Array<{ text: string; via: string | undefined }> = [];
let upstream: http.Server;
let looping: http.Server;
const openTransports = new Map<string, StreamableHTTPServerTransport>();

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let transport = sid ? openTransports.get(sid) : undefined;
    if (!transport) {
      const srv = new McpServer({ name: 'upstream', version: '1.0.0' });
      srv.tool('echo', 'Repeats its input.', { text: z.string() },
        async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => openTransports.set(id, created),
      });
      transport = created;
      await srv.connect(created);
    }
    let body: { method?: string; params?: { arguments?: { text?: string } } } | undefined;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body?.method === 'tools/call') {
        seen.push({ text: body.params?.arguments?.text ?? '', via: req.headers[MCP_VIA_HEADER] as string | undefined });
      }
    }
    await transport.handleRequest(req, res, body);
  });

  // This node's own endpoint, reached by a spelling the address check cannot know: it refuses what
  // names node-a exactly as src/mcp/index.ts does, with the same two functions.
  looping = http.createServer((req, res) => {
    const refused = viaRefusal(parseVia(req.headers[MCP_VIA_HEADER]), NODE_ID);
    res.writeHead(refused ? 508 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0', id: 0, error: { code: -32001, message: refused?.message ?? 'nothing here' },
    }));
  });

  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));
  await new Promise<void>((r) => looping.listen(LOOPING_PORT, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await mcpClientPool.closeAll();
  for (const t of openTransports.values()) await t.close();
  await new Promise<void>((r) => upstream.close(() => r()));
  await new Promise<void>((r) => looping.close(() => r()));
});

function makeRow(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'upstream', title: 'Upstream', description: '',
    ownership: 'owner', ownerGhii: `alice@${NODE_ID}`, organismId: null, ws: null,
    createdBy: `alice@${NODE_ID}`,
    transport: { kind: 'http', url: `http://127.0.0.1:${UPSTREAM_PORT}/mcp` },
    auth: 'none', credential: null, credentialShape: null, expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('the header on the wire', () => {
  it('carries each call\'s own chain, even when two calls share one pooled client', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);
    const callAs = (text: string) => callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text }, caller: `alice@${NODE_ID}`,
    });

    // The client is built by the first call. If the chain were fixed when the client was built,
    // every later call would carry this one's list.
    const first = await callAs('direct');
    expect(first.ok).toBe(true);
    const [fromX, fromY] = await Promise.all([
      runWithVia(['peer-x'], () => callAs('via-x')),
      runWithVia(['peer-y', 'peer-z'], () => callAs('via-yz')),
    ]);
    expect(fromX.ok && fromY.ok).toBe(true);
    expect(mcpClientPool.size).toBe(1);

    const viaFor = (text: string) => seen.find((s) => s.text === text)?.via;
    expect(viaFor('direct')).toBe('node-a');
    expect(viaFor('via-x')).toBe('peer-x, node-a');
    expect(viaFor('via-yz')).toBe('peer-y, peer-z, node-a');
    await mcpClientPool.closeAll();
  });

  it('refuses a call the far side answers with 508, and keeps the server in service', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow({ slug: 'loops', transport: { kind: 'http', url: `http://localhost:${LOOPING_PORT}/mcp` } });
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'echo', args: { text: 'x' }, caller: `alice@${NODE_ID}`,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('LOOP_DETECTED');
    expect(statusForRemoteRefusal(r.code)).toBe(508);
    // Not parked as unreachable or as needing a sign-in: only this call went round in a circle.
    expect((await storage.getMcpServer(row.id))?.status).toBe('active');
    await mcpClientPool.closeAll();
  });
});

describe('attaching this node to itself', () => {
  function appFor(storage: SqliteStorage) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { auth: unknown }).auth = {
        sub: 'alice', owner: 'alice', node: NODE_ID, roles: ['owner'],
        scopes: ['mcp:read', 'mcp:use', 'mcp:manage'], exp: 0,
      };
      next();
    });
    app.use(mcpServersRouter(config, storage));
    return app;
  }

  async function attach(storage: SqliteStorage, body: unknown) {
    const app = appFor(storage);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/v1/mcp-servers`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as { error?: { code: string; message: string } } };
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('refuses the node\'s own address before anything is stored', async () => {
    const storage = new SqliteStorage(':memory:');
    const res = await attach(storage, { name: 'myself', url: `${OWN_BASE}/v1/mcp` });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('SELF_ADDRESS');
    expect(await storage.listMcpServers()).toEqual([]);
  });

  it('catches another spelling of it at the first look, and leaves no row behind', async () => {
    const storage = new SqliteStorage(':memory:');
    const res = await attach(storage, { name: 'myself', url: `http://localhost:${LOOPING_PORT}/mcp` });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('LOOP_DETECTED');
    expect(await storage.listMcpServers()).toEqual([]);
    await mcpClientPool.closeAll();
  });
});

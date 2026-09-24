/**
 * @file test/unit/mcp-servers-route.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST door for remote MCP servers, driven end to end: a real Express app, a real
 *   upstream MCP server on a real socket, real attach-probe-call.
 *
 *   THE FOUR THINGS WORTH A TEST HERE ARE ALL REFUSALS, not the happy path. The happy path is
 *   visible the first time anyone uses the feature; what is invisible until it is wrong is whether
 *   the endpoint leaks, whether another owner's server can be reached by naming its id, whether a
 *   caller holding only the read word can call a tool, and whether a tool saying no is told apart
 *   from the proxy failing. Each of those has a named test below.
 * @version-history
 *   v1.1.0 — 2026-09-24 — A server the node offers: an owner it admits may call it, and gets 404 on
 *     every door that changes or removes it (secaudit 2026-09 A2-1).
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { mcpServersRouter } from '../../src/routes/mcp-servers.js';
import { mcpClientPool } from '../../src/services/mcp-client/pool.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

const UPSTREAM_PORT = 40691;
const KEY = 'b'.repeat(64);
const NODE_ID = 'test-node-001';

const config = {
  nodeId: NODE_ID,
  encryptionKey: KEY,
  totpSecretEncryptionKey: null,
  accountEventWindow: 100,
} as unknown as AimeatConfig;

let upstream: http.Server;
const upstreamTransports = new Map<string, StreamableHTTPServerTransport>();

/** Stands in for the auth middleware: whoever the test says is calling, with whatever scopes. */
interface Caller { sub: string; owner: string; roles: string[]; scopes: string[] }

function appFor(storage: Storage, caller: () => Caller) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const c = caller();
    (req as unknown as { auth: unknown }).auth = {
      sub: c.sub, owner: c.owner, node: NODE_ID, roles: c.roles, scopes: c.scopes, exp: 0,
    };
    next();
  });
  app.use(mcpServersRouter(config, storage));
  return app;
}

/** One request against the app, without pulling in a test-http library. */
function call(
  app: express.Express, method: string, path: string, body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { host: '127.0.0.1', port, path, method,
          headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            server.close();
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let transport = sid ? upstreamTransports.get(sid) : undefined;
    if (!transport) {
      const srv = new McpServer({ name: 'upstream', version: '1.0.0' });
      srv.tool('create_issue', 'Creates an issue.', { title: z.string() },
        async ({ title }) => ({ content: [{ type: 'text', text: `created:${title}` }] }));
      srv.tool('refuses', 'Always says no.', {},
        async () => ({ content: [{ type: 'text', text: 'not allowed' }], isError: true }));
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => upstreamTransports.set(id, created),
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
  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await mcpClientPool.closeAll();
  for (const t of upstreamTransports.values()) await t.close();
  await new Promise<void>((r) => upstream.close(() => r()));
});

const ALICE: Caller = { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: ['mcp:read', 'mcp:use', 'mcp:manage'] };
const BOB: Caller = { sub: 'bob', owner: 'bob', roles: ['owner'], scopes: ['mcp:read', 'mcp:use', 'mcp:manage'] };
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}/mcp`;

async function attachAs(app: express.Express, name = 'jira') {
  return call(app, 'POST', '/v1/mcp-servers', {
    name, url: UPSTREAM_URL, title: 'Jira', token: 'sekrit-token',
  });
}

describe('attaching a server', () => {
  it('probes the far side and reports its tools', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);

    const res = await attachAs(app);
    expect(res.status).toBe(201);
    const data = res.body.data as { server: Record<string, unknown>; tools: string[] };
    expect(data.tools.sort()).toEqual(['create_issue', 'refuses']);
    expect(data.server.slug).toBe('jira');
    expect(data.server.toolCount).toBe(2);
  });

  it('never puts the endpoint or the token in a response', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);

    await attachAs(app);
    const listed = await call(app, 'GET', '/v1/mcp-servers');
    const whole = JSON.stringify(listed.body);

    // The endpoint is out for the same reason the token is: a caller that learns it can call the
    // far side directly and leave every gate here behind.
    expect(whole).not.toContain('127.0.0.1');
    expect(whole).not.toContain(String(UPSTREAM_PORT));
    expect(whole).not.toContain('sekrit-token');
  });

  it('refuses a second server with the same name, and says so as a conflict', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);

    await attachAs(app);
    const again = await attachAs(app);
    expect(again.status).toBe(409);
  });

  it('refuses a name this node will not accept', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);

    const res = await call(app, 'POST', '/v1/mcp-servers', { name: 'Not A Slug!', url: UPSTREAM_URL });
    expect(res.status).toBe(400);
  });

  it('answers 503 and names the env var when the node cannot hold a secret', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { auth: unknown }).auth = {
        sub: 'alice', owner: 'alice', node: NODE_ID, roles: ['owner'], scopes: ['mcp:manage'], exp: 0,
      };
      next();
    });
    app.use(mcpServersRouter({ ...config, encryptionKey: null } as AimeatConfig, storage));

    const res = await call(app, 'POST', '/v1/mcp-servers', {
      name: 'jira', url: UPSTREAM_URL, token: 'x',
    });
    expect(res.status).toBe(503);
    // Naming the variable is the difference between an operator fixing it and filing a bug.
    expect(JSON.stringify(res.body)).toContain('AIMEAT_ENCRYPTION_KEY');
  });

  it('refuses a server that will not answer, as a bad gateway rather than our own error', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);

    const res = await call(app, 'POST', '/v1/mcp-servers', {
      name: 'dead', url: 'http://127.0.0.1:40690/mcp',
    });
    expect(res.status).toBe(502);
  });

  it('tells a person their address is RIGHT when the server only wants a token', async () => {
    // What an AIMEAT node's own /v1/mcp answers without a token: 401, with a body that never says
    // "401" or "unauthorized". The status is on the SDK error's `.code`.
    const refuser = http.createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: 0, error: { code: -32001, message: 'Authentication required.' },
      }));
    });
    await new Promise<void>((r) => refuser.listen(40684, '127.0.0.1', () => r()));
    try {
      const storage = new SqliteStorage(':memory:');
      const app = appFor(storage, () => ALICE);

      const res = await call(app, 'POST', '/v1/mcp-servers', {
        name: 'wantstoken', url: 'http://127.0.0.1:40684/mcp',
      });
      // Found on 2026-09-16 by attaching a sandbox node to itself: this answered 502 UNREACHABLE,
      // twice over. The probe misread the 401, and even once it read it right, all three attach
      // doors rewrote every failure to UNREACHABLE before a person saw it.
      expect(res.status).toBe(400);
      expect((res.body as any).error.code).toBe('UPSTREAM_UNAUTHORIZED');
      expect((res.body as any).error.message).toMatch(/needs a token or a sign-in/);

      // Parked as needing a sign-in, which the panel renders as a button, not as a dead server.
      const listed = await call(app, 'GET', '/v1/mcp-servers');
      const row = ((listed.body as any).data.servers as any[]).find((s) => s.slug === 'wantstoken');
      expect(row?.status).toBe('needs_reauth');
    } finally {
      await mcpClientPool.closeAll();
      await new Promise<void>((r) => refuser.close(() => r()));
    }
  });
});

describe('calling through a server', () => {
  it('runs the tool and returns what it said', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    const res = await call(app, 'POST', '/v1/mcp-servers/jira/call', {
      tool: 'create_issue', arguments: { title: 'Broken login' },
    });
    expect(res.status).toBe(200);
    const data = res.body.data as { content: unknown; is_error: boolean };
    expect(JSON.stringify(data.content)).toContain('created:Broken login');
    expect(data.is_error).toBe(false);
  });

  it('keeps the tool saying no apart from the proxy failing', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    const res = await call(app, 'POST', '/v1/mcp-servers/jira/call', { tool: 'refuses' });
    // 200 with is_error: the proxy worked and the TOOL refused. A 502 here would send somebody to
    // the wrong logs looking for an outage that did not happen.
    expect(res.status).toBe(200);
    expect((res.body.data as { is_error: boolean }).is_error).toBe(true);
  });

  it('refuses a call that names no tool', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    expect((await call(app, 'POST', '/v1/mcp-servers/jira/call', {})).status).toBe(400);
  });
});

describe('the fences', () => {
  it('answers 404, not 403, for another owner\'s server — by id as well as by name', async () => {
    const storage = new SqliteStorage(':memory:');
    let who: Caller = ALICE;
    const app = appFor(storage, () => who);

    const attached = await attachAs(app);
    const id = (attached.body.data as { server: { id: string } }).server.id;

    who = BOB;
    // Both spellings, because the lookup accepts either and a fence that holds for one is not a
    // fence. 404 and not 403: naming another owner's id must not confirm that it exists.
    expect((await call(app, 'GET', `/v1/mcp-servers/${id}/tools`)).status).toBe(404);
    expect((await call(app, 'GET', '/v1/mcp-servers/jira/tools')).status).toBe(404);
    expect((await call(app, 'POST', `/v1/mcp-servers/${id}/call`, { tool: 'create_issue' })).status).toBe(404);
    expect((await call(app, 'DELETE', `/v1/mcp-servers/${id}`)).status).toBe(404);
  });

  it('shows another owner nothing in the listing', async () => {
    const storage = new SqliteStorage(':memory:');
    let who: Caller = ALICE;
    const app = appFor(storage, () => who);
    await attachAs(app);

    who = BOB;
    const listed = await call(app, 'GET', '/v1/mcp-servers');
    expect((listed.body.data as { servers: unknown[] }).servers).toHaveLength(0);
  });

  // The scope fences are tested with AGENT sessions, and that is the real rule rather than a
  // convenience: requireScope deliberately waves a plain owner session past every word, because an
  // owner acts on behalf of all their agents. A scope test written with roles: ['owner'] therefore
  // passes whatever the route demands, and proves nothing at all.
  const agent = (scopes: string[]): Caller =>
    ({ sub: `claude#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes });

  it('will not let an agent holding only mcp:read call a tool', async () => {
    const storage = new SqliteStorage(':memory:');
    let who: Caller = ALICE;
    const app = appFor(storage, () => who);
    await attachAs(app);

    who = agent(['mcp:read']);
    const res = await call(app, 'POST', '/v1/mcp-servers/jira/call', { tool: 'create_issue' });
    // Knowing WHAT is attached and SPENDING it are two different favours; that split is the whole
    // reason there are three words rather than one.
    expect(res.status).toBe(403);
    // …and the read word still reads, on its owner's servers.
    const listed = await call(app, 'GET', '/v1/mcp-servers');
    expect(listed.status).toBe(200);
    expect((listed.body.data as { servers: unknown[] }).servers).toHaveLength(1);
  });

  it('will not let an agent holding mcp:use attach a server', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => agent(['mcp:read', 'mcp:use']));

    expect((await attachAs(app)).status).toBe(403);
  });

  it('will not let an agent with FULL ACCESS attach one either', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => agent(['*']));

    // mcp:manage is outside every wildcard. This is the assertion that keeps it there: an agent
    // holding '*' may call through an attached server all day and still cannot point the account
    // at a server of its own choosing.
    expect((await attachAs(app)).status).toBe(403);
  });

  it('DOES let an agent with full access call through a server its owner attached', async () => {
    const storage = new SqliteStorage(':memory:');
    let who: Caller = ALICE;
    const app = appFor(storage, () => who);
    await attachAs(app);

    who = agent(['*']);
    // The other half of the ruling above, and the point of the whole feature: the AI this person
    // already talks to reaches the tools they attached.
    const res = await call(app, 'POST', '/v1/mcp-servers/jira/call', {
      tool: 'create_issue', arguments: { title: 'From the agent' },
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('created:From the agent');
  });
});

describe('switching a server off and removing it', () => {
  it('stops calls the moment it is disabled', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    await call(app, 'PATCH', '/v1/mcp-servers/jira', { enabled: false });
    const res = await call(app, 'POST', '/v1/mcp-servers/jira/call', { tool: 'create_issue', arguments: { title: 'x' } });
    // Not later, when an idle sweeper notices: "I turned it off and it kept working" is the worst
    // possible answer to somebody cutting an integration. 403 rather than the 502 this asserted
    // until 2026-09-16: switched off is this node refusing, and 502 blamed the far side for it.
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('SERVER_DISABLED');
  });

  it('refuses to rename the slug, because every grant names it', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    await call(app, 'PATCH', '/v1/mcp-servers/jira', { slug: 'renamed', title: 'Still Jira' });
    const listed = await call(app, 'GET', '/v1/mcp-servers');
    const servers = (listed.body.data as { servers: { slug: string; title: string }[] }).servers;
    expect(servers[0].slug).toBe('jira');
    // The title DID change, so this proves the patch ran and ignored only what it must.
    expect(servers[0].title).toBe('Still Jira');
  });

  it('removes the server and says the far-side token is still theirs to revoke', async () => {
    const storage = new SqliteStorage(':memory:');
    const app = appFor(storage, () => ALICE);
    await attachAs(app);

    const res = await call(app, 'DELETE', '/v1/mcp-servers/jira');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('revoke');
    expect((await call(app, 'GET', '/v1/mcp-servers')).body.data).toEqual({ servers: [] });
  });
});

describe('a server the node offers', () => {
  /** The operator's server, offered to every owner. It belongs to the node and to no owner. */
  function houseServer(): McpServerRecord {
    const now = new Date().toISOString();
    return {
      id: randomUUID(), slug: 'market', title: 'Market data', description: '',
      ownership: 'node', ownerGhii: null, organismId: null, ws: null, createdBy: `operator@${NODE_ID}`,
      transport: { kind: 'http', url: UPSTREAM_URL },
      auth: 'none', credential: null, credentialShape: null, expiresAt: null, providerClientId: null,
      callerIdentity: 'node-credential', exposure: 'gateway',
      toolCache: [], toolCacheHash: '', lastListedAt: null,
      availability: 'all-owners', allowlist: [], price: null,
      directory: { listed: false, visibility: 'private', tags: [] },
      enabled: true, status: 'active', lastOkAt: null, lastError: null,
      createdAt: now, updatedAt: now,
    };
  }

  it('is USED by an owner it admits, and never changed, signed in or removed by them', async () => {
    const storage = new SqliteStorage(':memory:');
    const house = houseServer();
    await storage.createMcpServer(house);
    const app = appFor(storage, () => BOB);

    // Admitted: offering it to every owner is the point of a node-wide server.
    const used = await call(app, 'POST', '/v1/mcp-servers/market/call', {
      tool: 'create_issue', arguments: { title: 'on the house' },
    });
    expect(used.status).toBe(200);

    // Both spellings, as for another owner's server. Before 2026-09-24 each of these answered 200
    // (or started a sign-in) and wrote the operator's row: secaudit 2026-09 A2-1.
    for (const ref of [house.id, 'market']) {
      expect((await call(app, 'PATCH', `/v1/mcp-servers/${ref}`, {
        enabled: false, title: 'hijacked', exposure: 'flatten',
      })).status).toBe(404);
      expect((await call(app, 'POST', `/v1/mcp-servers/${ref}/authorize`, {})).status).toBe(404);
      expect((await call(app, 'DELETE', `/v1/mcp-servers/${ref}`)).status).toBe(404);
    }

    const after = await storage.getMcpServer(house.id);
    expect(after).not.toBeNull();
    expect(after?.enabled).toBe(true);
    expect(after?.title).toBe('Market data');
    expect(after?.exposure).toBe('gateway');
  });
});

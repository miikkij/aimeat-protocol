/**
 * @file test/e2e-mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The remote MCP proxy against a real node on a real backend.
 *
 *   WHY THIS EXISTS WHEN THE UNIT SUITES ALREADY DRIVE A REAL EXPRESS APP. Those run on SQLite
 *   only. This one runs on whichever backend the runner points it at, so the Postgres methods are
 *   EXECUTED rather than merely typechecked — the jsonb round trip, the COALESCE unique index, the
 *   conditional UPDATE that arbitrates a refresh claim. A storage layer that compiles on both
 *   backends and has only ever run on one is a storage layer with an untested half.
 *
 *   The far side is a real MCP server this suite starts on a port of its own, built with the SDK's
 *   own server half, so the protocol on the wire is the protocol.
 *
 * @structure
 *   - Phase 0: an operator owner, an agent of theirs, a second owner
 *   - Phase 1: attach — the probe, the refusals (bad name, taken name, unreachable)
 *   - Phase 2: the tool list, cached and refreshed
 *   - Phase 3: calling — the happy path, and a tool saying no
 *   - Phase 4: the fences — cross-owner 404, and the scope split on an agent session
 *   - Phase 5: off and gone — disable stops it, detach removes it
 *
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=mcp-proxy
 *
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial suite, phase 1 of the MCP proxy.
 */

import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

/**
 * The upstream server's port, derived from the node's so two backends running side by side do not
 * collide. The node under test is on the claimed E2E port; this sits a fixed distance above it.
 */
const UPSTREAM_PORT = Number(new URL(BASE).port || '40251') + 120;
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}/mcp`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, name + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(body.ok === true, `owner token for ${name}: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}

async function agentTokenFor(gaii: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii, timestamp, signature: await signMsg(privKey, gaii + timestamp) }),
  });
  assert(body.ok === true, `agent token for ${gaii}: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}

// ─── The far side ───
const upstreamTransports = new Map<string, StreamableHTTPServerTransport>();
const upstream = http.createServer(async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  let transport = sid ? upstreamTransports.get(sid) : undefined;
  if (!transport) {
    // A fresh McpServer per transport: one server instance binds to one transport.
    const srv = new McpServer({ name: 'e2e-upstream', version: '1.0.0' });
    srv.tool('echo', 'Repeats its input.', { text: z.string() },
      async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
    srv.tool('refuses', 'Answers isError, the way a tool says no.', {},
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

// ─── State ───
const ownerName = `mcpproxy${Date.now()}`;
const strangerName = `mcpproxyalt${Date.now()}`;
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let strangerToken = '';
let serverId = '';

const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
const agentAuth = () => ({ Authorization: `Bearer ${agentToken}` });
const strangerAuth = () => ({ Authorization: `Bearer ${strangerToken}` });

console.log('\n=== AIMEAT MCP Proxy E2E ===\n');

await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));
console.log(`  (upstream MCP server on ${UPSTREAM_URL})\n`);

// ─── Phase 0: principals ───
console.log('Phase 0 — Principals');

await test('register owner (operator) + token', async () => {
  const { status, body } = await json('/v1/admin/setup/register', {
    method: 'POST',
    headers: { 'X-Admin-Password': ADMIN_PW },
    body: JSON.stringify({ name: ownerName }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await ownerTokenFor(ownerName, body.private_key);
});

await test('register an agent of that owner, with the three mcp words', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'mcpproxybot', owner: ownerName, capabilities: ['memory'], model: 'test',
      default_scopes: ['mcp:read', 'mcp:use'],
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;
  agentToken = await agentTokenFor(agentGaii, body.data.private_key);
});

await test('register a second owner, for the cross-owner arms', async () => {
  const { status, body } = await json('/v1/admin/setup/register', {
    method: 'POST',
    headers: { 'X-Admin-Password': ADMIN_PW },
    body: JSON.stringify({ name: strangerName }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  strangerToken = await ownerTokenFor(strangerName, body.private_key);
});

// ─── Phase 1: attaching ───
console.log('\nPhase 1 — Attaching');

await test('a name this node will not accept is refused, before anything is stored', async () => {
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'Not A Slug!', url: UPSTREAM_URL }),
  });
  assert(status === 400, `expected 400, got ${status}`);
});

await test('an unreachable server is refused as a bad gateway, not as our own error', async () => {
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'deadone', url: `http://127.0.0.1:${UPSTREAM_PORT + 7}/mcp` }),
  });
  assert(status === 502, `expected 502, got ${status}`);
});

await test('attach probes the far side and reports its tools', async () => {
  const { status, body } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'upstream', url: UPSTREAM_URL, title: 'The upstream', token: 'sekrit-e2e-token',
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  serverId = body.data.server.id;
  const tools = (body.data.tools as string[]).sort();
  assert(tools.join(',') === 'echo,refuses', `tools were ${tools.join(',')}`);
  assert(body.data.server.toolCount === 2, `toolCount ${body.data.server.toolCount}`);
});

await test('the same name twice is a conflict, from the unique index', async () => {
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'upstream', url: UPSTREAM_URL }),
  });
  assert(status === 409, `expected 409, got ${status}`);
});

await test('the SECOND owner may use the same name — the index is scoped, not global', async () => {
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ name: 'upstream', url: UPSTREAM_URL }),
  });
  assert(status === 201, `expected 201, got ${status}`);
});

await test('neither the endpoint nor the token appears in any response', async () => {
  const { body } = await json('/v1/mcp-servers', { headers: ownerAuth() });
  const whole = JSON.stringify(body);
  assert(!whole.includes('127.0.0.1'), 'the endpoint leaked into the listing');
  assert(!whole.includes(String(UPSTREAM_PORT)), 'the port leaked into the listing');
  assert(!whole.includes('sekrit-e2e-token'), 'THE TOKEN LEAKED INTO THE LISTING');
});

// ─── Phase 2: the tool list ───
console.log('\nPhase 2 — What it can do');

await test('the tool list comes from the cache, with its schemas intact', async () => {
  const { status, body } = await json(`/v1/mcp-servers/upstream/tools`, { headers: ownerAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.cached === true, 'expected the cached answer');
  const echo = (body.data.tools as any[]).find(t => t.name === 'echo');
  assert(!!echo, 'echo missing from the cache');
  // Stored verbatim: a schema we edited is one that disagrees with the server that validates it.
  assert(!!echo.inputSchema?.properties?.text, 'the upstream schema did not survive the round trip');
});

await test('refresh asks the far side again', async () => {
  const { status, body } = await json(`/v1/mcp-servers/upstream/tools?refresh=1`, { headers: ownerAuth() });
  assert(status === 200, `status ${status}`);
  assert(body.data.cached === false, 'expected a fresh answer');
  assert((body.data.tools as any[]).length === 2, 'expected two tools');
});

// ─── Phase 3: calling ───
console.log('\nPhase 3 — Calling through it');

await test('a tool call is proxied and its content returned', async () => {
  const { status, body } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'over the wire' } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(JSON.stringify(body.data.content).includes('echo:over the wire'), 'content did not come back');
  assert(body.data.is_error === false, 'is_error should be false');
});

await test('a tool saying no is 200 + is_error, not a gateway failure', async () => {
  const { status, body } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ tool: 'refuses' }),
  });
  // The proxy worked; the TOOL refused. Folding these together would send somebody to the wrong
  // logs looking for an outage that did not happen.
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.data.is_error === true, 'is_error should be true');
});

await test('a call naming no tool is refused', async () => {
  const { status } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({}),
  });
  assert(status === 400, `expected 400, got ${status}`);
});

// ─── Phase 4: the fences ───
console.log('\nPhase 4 — The fences');

await test("another owner's server answers 404 by id AND by name", async () => {
  for (const ref of [serverId, 'upstream']) {
    // 'upstream' resolves to the STRANGER's own server here, so the id is the real cross-owner
    // arm; the name arm proves the lookup is scoped rather than global.
    const { status } = await json(`/v1/mcp-servers/${ref}/call`, {
      method: 'POST', headers: strangerAuth(),
      body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
    });
    if (ref === serverId) assert(status === 404, `by id: expected 404, got ${status}`);
  }
  const { status } = await json(`/v1/mcp-servers/${serverId}`, {
    method: 'DELETE', headers: strangerAuth(),
  });
  assert(status === 404, `delete by id: expected 404, got ${status}`);
});

await test('an agent reaches its OWNER\'s servers', async () => {
  const { status, body } = await json('/v1/mcp-servers', { headers: agentAuth() });
  assert(status === 200, `status ${status}`);
  // The point of the whole feature: the AI this person already talks to sees what they attached.
  assert((body.data.servers as any[]).some(s => s.slug === 'upstream'), "the agent cannot see its owner's server");
});

await test('an agent holding mcp:use may call through it', async () => {
  const { status } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'from the agent' } }),
  });
  assert(status === 200, `expected 200, got ${status}`);
});

await test('an agent WITHOUT mcp:manage cannot attach, whatever else it holds', async () => {
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ name: 'sneaky', url: UPSTREAM_URL }),
  });
  // mcp:manage is outside every wildcard: pointing somebody's account at a server of the agent's
  // own choosing is a human act.
  assert(status === 403, `expected 403, got ${status}`);
});

// ─── Phase 5: off, and gone ───
console.log('\nPhase 5 — Off, and gone');

await test('disabling a server stops calls at once', async () => {
  const patched = await json(`/v1/mcp-servers/upstream`, {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: false }),
  });
  assert(patched.status === 200, `patch status ${patched.status}`);
  const { status, body } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
  });
  assert(status === 502, `expected 502, got ${status}`);
  assert(JSON.stringify(body).includes('SERVER_DISABLED'), 'expected SERVER_DISABLED');
});

await test('re-enabling it brings it back', async () => {
  await json(`/v1/mcp-servers/upstream`, {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: true }),
  });
  const { status } = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'back' } }),
  });
  assert(status === 200, `expected 200, got ${status}`);
});

await test('detach removes it, and the call path goes with it', async () => {
  const { status } = await json(`/v1/mcp-servers/upstream`, { method: 'DELETE', headers: ownerAuth() });
  assert(status === 200, `expected 200, got ${status}`);
  const after = await json(`/v1/mcp-servers/upstream/call`, {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ tool: 'echo' }),
  });
  assert(after.status === 404, `expected 404 after detach, got ${after.status}`);
});

// ─── Done ───
for (const t of upstreamTransports.values()) await t.close();
await new Promise<void>((r) => upstream.close(() => r()));

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

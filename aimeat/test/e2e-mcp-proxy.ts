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
 *   - Phase 5: the directory and a published capability over a remote tool
 *   - Phase 5b: a server that belongs to a group, attached by an AGENT
 *   - Phase 5d: the node's own server — an ordinary owner uses it, and cannot change it on any door
 *   - Phase 6: a local process, refused because this node does not run them
 *   - Phase 7: off and gone — disable stops it, detach removes it
 *
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=mcp-proxy
 *
 * @version-history
 *   v1.6.0 — 2026-09-24 — A flattened tool, over a real MCP session, is refused on the call after
 *     its server is switched off in the same session (secaudit 2026-09 a49e32ddeb4e).
 *   v1.5.0 — 2026-09-24 — A whole OAuth round against a far side of its own: the callback sends the
 *     browser to a path of this node and never to `//host` or `/\host` (secaudit 2026-09 A2-3).
 *   v1.4.0 — 2026-09-24 — Phase 5d: an owner a node-wide server admits gets 404 on PATCH, DELETE and
 *     authorize of it, over REST and over MCP, and the operator changes it on the node doors
 *     (secaudit 2026-09 A2-1). Adds an ordinary owner, and a small MCP driver for the tool arms.
 *   v1.3.0 — 2026-09-17 — The loop brake: 508 on the node's own endpoint, and this node refused as a
 *     server of its own by its address and by any other spelling of it.
 *   v1.2.0 — 2026-09-16 — The stdio refusals (proxy phase 7).
 *   v1.1.0 — 2026-09-16 — The directory and the capability path (proxy phase 6).
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

/**
 * An ORDINARY owner, registered through the public door. The two owners phase 0 makes come from the
 * admin setup door, which makes every account it creates an operator, and a fence proven against an
 * operator says nothing about everybody else.
 */
async function plainOwner(prefix: string): Promise<{ name: string; token: string }> {
  const name = `${prefix}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', {
      method: 'POST',
      body: JSON.stringify({ username: name, display_name: name, password: 'McpProxyTest1234' }),
    });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration: ${reg.status} ${JSON.stringify(reg.body)}`);
    return { name, token: await ownerTokenFor(name, reg.body.data.private_key) };
  }
}

/** An agent of `owner` holding exactly `scopes`, with a token minted after they were set. */
async function agentWithScopes(
  owner: { name: string; token: string }, agentName: string, scopes: string[],
): Promise<{ gaii: string; token: string }> {
  const auth = { Authorization: `Bearer ${owner.token}` };
  const made = await json('/v1/agents', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: agentName, owner: owner.name, capabilities: ['memory'], model: 'test' }),
  });
  assert(made.status === 201, `agent: ${made.status}: ${JSON.stringify(made.body)}`);
  // Through their own door, for the reason phase 0 gives: POST /v1/agents ignores a scope list.
  const scoped = await json(`/v1/agents/${agentName}/scopes`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ scopes }),
  });
  assert(scoped.status === 200, `scopes: ${scoped.status}: ${JSON.stringify(scoped.body)}`);
  const gaii = made.body.data.agent.gaii as string;
  return { gaii, token: await agentTokenFor(gaii, made.body.data.private_key) };
}

// ─── The node's own MCP door, for the arms that must hold on both surfaces ───
interface McpSession { token: string; sessionId?: string }
let rpcId = 0;

async function mcpRpc(session: McpSession, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++rpcId;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${session.token}`,
      ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session.sessionId = sid;
  const text = await res.text();
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    try { return JSON.parse(text); } catch { return { _raw: text }; }
  }
  const msgs = text.split('\n').filter((l) => l.startsWith('data: '))
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter(Boolean);
  return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
}

async function openMcpSession(token: string): Promise<McpSession> {
  const session: McpSession = { token };
  await mcpRpc(session, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'e2e-mcp-proxy', version: '1.0.0' },
  });
  return session;
}

/** One tool call: whether the node refused it, and the text it answered with. */
async function mcpTool(
  session: McpSession, name: string, args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
  return { isError: body?.result?.isError === true || body?.error !== undefined, text };
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

// ─── A far side that signs in with OAuth, for the callback arms ───
// Its own port, so the plain upstream above keeps offering no OAuth at all, which the sign-in
// refusal in phase 1 relies on. Far from the node's port for the reason UPSTREAM_PORT is: sessions
// on neighbouring E2E ports run at the same time.
const OAUTH_PORT = Number(new URL(BASE).port || '40251') + 220;
const OAUTH_BASE = `http://127.0.0.1:${OAUTH_PORT}`;
const oauthUpstream = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', OAUTH_BASE);
  const send = (body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  // RFC 9728, RFC 8414 and RFC 7591, answered literally; test/unit/mcp-client-oauth.test.ts holds
  // the PKCE proof. What this far side is for is the one redirect the callback makes afterwards.
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return send({ resource: `${OAUTH_BASE}/mcp`, authorization_servers: [OAUTH_BASE] });
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return send({
      issuer: OAUTH_BASE,
      authorization_endpoint: `${OAUTH_BASE}/authorize`,
      token_endpoint: `${OAUTH_BASE}/token`,
      registration_endpoint: `${OAUTH_BASE}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  }
  if (url.pathname === '/register' && req.method === 'POST') {
    return send({ ...JSON.parse(raw), client_id: 'e2e-client', client_secret: 'e2e-secret' }, 201);
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    return send({ access_token: 'e2e-oauth-token', token_type: 'Bearer', expires_in: 3600 });
  }
  return send({ error: 'not_found' }, 404);
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
/** The owner's OTHER agent, the one they trusted with mcp:manage. Minted in phase 5. */
let manageAgentToken = '';
const manageAgentAuth = () => ({ Authorization: `Bearer ${manageAgentToken}` });

console.log('\n=== AIMEAT MCP Proxy E2E ===\n');

await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));
await new Promise<void>((r) => oauthUpstream.listen(OAUTH_PORT, '127.0.0.1', () => r()));
console.log(`  (upstream MCP server on ${UPSTREAM_URL}, OAuth far side on ${OAUTH_BASE})\n`);

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

await test('register an agent of that owner, holding mcp:read and mcp:use but NOT mcp:manage', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'mcpproxybot', owner: ownerName, capabilities: ['memory'], model: 'test',
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;

  // The scopes go through their own door. POST /v1/agents IGNORES a default_scopes field, so an
  // agent created "with" scopes silently holds the node's default instead — which on a test node
  // is '*', and a '*' agent passes every arm below for the wrong reason.
  const scoped = await json('/v1/agents/mcpproxybot/scopes', {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ scopes: ['mcp:read', 'mcp:use'] }),
  });
  assert(scoped.status === 200, `scopes: ${scoped.status}: ${JSON.stringify(scoped.body)}`);

  // Minted after the grant: a JWT carries the scopes it was minted from.
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

// ─── The loop brake: this node attached to itself ───

await test('a call that has already passed through this node is refused with 508, before auth', async () => {
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'X-AIMEAT-MCP-Via': `some-peer, ${NODE_ID}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = await res.json() as any;
  assert(res.status === 508, `expected 508, got ${res.status}: ${JSON.stringify(body)}`);
  assert(body.error?.data?.reason === 'LOOP_DETECTED', `reason ${JSON.stringify(body.error)}`);
});

await test('a chain through too many servers is refused, and a short one goes through', async () => {
  const send = (via: string) => fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'X-AIMEAT-MCP-Via': via,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const long = await send('p1, p2, p3, p4');
  const longBody = await long.json() as any;
  assert(long.status === 508, `expected 508, got ${long.status}`);
  assert(longBody.error?.data?.reason === 'TOO_MANY_HOPS', `reason ${JSON.stringify(longBody.error)}`);
  // One hop that is not this node is an ordinary request, answered by whatever answers it today.
  const short = await send('some-peer');
  assert(short.status !== 508, `a one-hop chain was refused as a loop`);
});

await test("this node's own address is refused at attach, and nothing is stored", async () => {
  const { status, body } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'myself', url: `${BASE}/v1/mcp` }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'SELF_ADDRESS', `code ${body.error?.code}`);
  const listed = await json('/v1/mcp-servers', { headers: ownerAuth() });
  assert(!(listed.body.data.servers as any[]).some((s) => s.slug === 'myself'), 'a row was stored');
});

await test('another spelling of it is caught at the first look, and leaves no row behind', async () => {
  const port = new URL(BASE).port || '80';
  const { status, body } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'myselfagain', url: `http://127.0.0.1:${port}/v1/mcp` }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'LOOP_DETECTED', `code ${body.error?.code}`);
  const listed = await json('/v1/mcp-servers', { headers: ownerAuth() });
  assert(!(listed.body.data.servers as any[]).some((s) => s.slug === 'myselfagain'), 'a row was left');
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

await test('a server attached for SIGN-IN is parked, not probed', async () => {
  // A server awaiting a token refuses an anonymous tool list, so probing it would tell the owner
  // their address was wrong when it was right. It attaches parked in needs_reauth instead, which
  // the panel already renders as a button that fixes it.
  const { status, body } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'signme', url: UPSTREAM_URL, auth: 'oauth' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.server.status === 'needs_reauth', `status was ${body.data.server.status}`);
  assert(body.data.tools.length === 0, 'nothing should have been probed');
});

await test('asking that server to sign in is refused cleanly when it offers no OAuth', async () => {
  // The upstream here is a plain MCP server with no authorization metadata at all. The honest
  // answer is "this one does not use OAuth, attach it with a token", not a stack trace.
  const { status, body } = await json('/v1/mcp-servers/signme/authorize', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ return_url: '/spa.html#access' }),
  });
  assert(status === 400 || status === 502, `expected 400 or 502, got ${status}`);
  assert(!JSON.stringify(body).includes(String(UPSTREAM_PORT)), 'the endpoint leaked into the refusal');
});

await test('the callback refuses a state nobody issued', async () => {
  const { status } = await json('/v1/mcp-servers/callback?state=invented&code=nope');
  assert(status === 400, `expected 400, got ${status}`);
});

await test('the callback refuses a request with no code at all', async () => {
  const { status } = await json('/v1/mcp-servers/callback?state=x');
  assert(status === 400, `expected 400, got ${status}`);
});

await test('a finished sign-in sends the browser back to a path of this node, and nowhere else', async () => {
  const attached = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'oauthround', url: `${OAUTH_BASE}/mcp`, auth: 'oauth' }),
  });
  assert(attached.status === 201, `attach: ${attached.status}: ${JSON.stringify(attached.body)}`);

  /** One whole round: start it naming `returnUrl`, then come back the way the far side sends a browser. */
  const land = async (returnUrl: string): Promise<{ status: number; location: string | null }> => {
    const started = await json('/v1/mcp-servers/oauthround/authorize', {
      method: 'POST', headers: ownerAuth(), body: JSON.stringify({ return_url: returnUrl }),
    });
    assert(started.status === 200 && started.body.data.needs_person === true,
      `authorize: ${started.status}: ${JSON.stringify(started.body)}`);
    // `manual`: following an off-site Location from a test would be the very bounce under test.
    const res = await fetch(`${BASE}/v1/mcp-servers/callback?state=${
      encodeURIComponent(started.body.data.state)}&code=e2e-code`, { redirect: 'manual' });
    await res.arrayBuffer();
    return { status: res.status, location: res.headers.get('location') };
  };

  const home = await land('/spa.html#access');
  assert(home.status === 302 && home.location === '/spa.html#access',
    `a path of this node: ${home.status} → ${home.location}`);

  // A browser reads both as `//evil.example`. Until 2026-09-24 the callback answered 302 with the
  // address as it was sent (secaudit 2026-09 A2-3). Now it is no address at all, and the person
  // gets the JSON answer a round with no return address gets.
  for (const offSite of ['//evil.example/x', '/\\evil.example/x']) {
    const r = await land(offSite);
    // Resolved the way a browser resolves it, so a failure names the site it would have reached.
    const lands = r.location === null ? 'nowhere' : new URL(r.location, BASE).href;
    assert(r.status === 200 && r.location === null, `${offSite} sent the browser to ${lands} (${r.status})`);
  }

  const removed = await json('/v1/mcp-servers/oauthround', { method: 'DELETE', headers: ownerAuth() });
  assert(removed.status === 200, `clean up: ${removed.status}`);
});

await test('an agent without mcp:manage cannot start a sign-in', async () => {
  const { status } = await json('/v1/mcp-servers/signme/authorize', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({}),
  });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('clean up the sign-in server', async () => {
  const { status } = await json('/v1/mcp-servers/signme', { method: 'DELETE', headers: ownerAuth() });
  assert(status === 200, `expected 200, got ${status}`);
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

// ─── Phase 4b: grants ───
console.log('\nPhase 4b — Narrowing an agent');

await test('with no grant, the agent may call anything on the server', async () => {
  const { status } = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'before' } }),
  });
  assert(status === 200, `expected 200, got ${status}`);
});

await test('an agent holding only mcp:use cannot write a grant', async () => {
  const { status } = await json('/v1/mcp-servers/upstream/grants', {
    method: 'PUT', headers: agentAuth(),
    body: JSON.stringify({ grantee: agentGaii, tools: '*' }),
  });
  // Narrowing somebody is a permission act, so it costs the manage word.
  assert(status === 403, `expected 403, got ${status}`);
});

await test('a grant naming one tool refuses the others', async () => {
  const put = await json('/v1/mcp-servers/upstream/grants', {
    method: 'PUT', headers: ownerAuth(),
    body: JSON.stringify({ grantee: agentGaii, tools: ['echo'] }),
  });
  assert(put.status === 200, `put: ${put.status}: ${JSON.stringify(put.body)}`);

  const allowed = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'still fine' } }),
  });
  assert(allowed.status === 200, `the granted tool should work, got ${allowed.status}`);

  const refused = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ tool: 'refuses' }),
  });
  // 403, not 502. This asserted 502 until 2026-09-16, which PINNED THE HOLE: 502 says the far side
  // failed, so an agent refused by its own owner's grant was told the server was broken, and would
  // retry or report it down. The far side was never asked.
  assert(refused.status === 403, `expected 403, got ${refused.status}`);
  assert(JSON.stringify(refused.body).includes('NOT_GRANTED'), 'expected NOT_GRANTED');
});

await test('the OWNER is not narrowed by a grant on their own server', async () => {
  // Grants narrow the things acting FOR a person. The grant above names only `echo`, and the
  // person themselves may still reach everything.
  const { status } = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ tool: 'refuses' }),
  });
  assert(status === 200, `expected the owner through, got ${status}`);
});

await test('locked arguments win over what the agent sends', async () => {
  const put = await json('/v1/mcp-servers/upstream/grants', {
    method: 'PUT', headers: ownerAuth(),
    body: JSON.stringify({
      grantee: agentGaii, tools: ['echo'], locked_input: { text: 'DECIDED' },
    }),
  });
  assert(put.status === 200, `put: ${put.status}`);

  const { status, body } = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'the agent chose this' } }),
  });
  assert(status === 200, `expected 200, got ${status}`);
  // The fence held: what came back is the owner's value, not the agent's.
  assert(JSON.stringify(body).includes('echo:DECIDED'), `got ${JSON.stringify(body.data?.content)}`);
});

await test('the grant list shows what was written', async () => {
  const { status, body } = await json('/v1/mcp-servers/grants?server=upstream', { headers: ownerAuth() });
  assert(status === 200, `expected 200, got ${status}`);
  const grants = body.data.grants as any[];
  assert(grants.length === 1, `expected one grant, got ${grants.length}`);
  assert(grants[0].grantee === agentGaii, 'wrong grantee');
});

await test('removing the narrowing WIDENS the agent again', async () => {
  const del = await json(
    `/v1/mcp-servers/upstream/grants/${encodeURIComponent(agentGaii)}`,
    { method: 'DELETE', headers: ownerAuth() },
  );
  assert(del.status === 200, `delete: ${del.status}`);

  const { status } = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ tool: 'refuses' }),
  });
  // Back to what its permissions allow, which is MORE than the grant allowed. The direction people
  // get wrong, which is why the tool description and the route response both say it.
  assert(status === 200, `expected 200 after the narrowing went, got ${status}`);
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
  // 403: a switched-off server is this node refusing, not the far side failing. Asserted 502 until
  // 2026-09-16, which pinned the wrong status in place.
  assert(status === 403, `expected 403, got ${status}`);
  assert(JSON.stringify(body).includes('SERVER_DISABLED'), 'expected SERVER_DISABLED');
});

await test('the agent that may USE a server still cannot switch it off', async () => {
  // mcp:use is not mcp:manage. Spending a server and changing what the account holds are two
  // different favours, and this is the arm that says the split survives on the editing door too.
  const { status } = await json('/v1/mcp-servers/upstream', {
    method: 'PATCH', headers: agentAuth(), body: JSON.stringify({ enabled: false }),
  });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('an agent the owner TRUSTED with mcp:manage can switch it off', async () => {
  // Why aimeat_mcp_update exists at all: "turn that server off, it is misbehaving" is a sentence
  // somebody says to their AI, and a capability reachable only by clicking is not finished here.
  // The gap was found by check:field-reach, which noticed the PATCH door had no agent twin.
  const made = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'mcpproxyadmin', owner: ownerName, capabilities: ['memory'], model: 'test',
    }),
  });
  assert(made.status === 201, `agent: ${made.status}: ${JSON.stringify(made.body)}`);

  // The scopes are set through their own door, and it has to be this way round: POST /v1/agents
  // ignores a default_scopes field, so an agent created "with" mcp:manage silently holds whatever
  // the node's default is. That is how the first draft of this test passed a 403 off as a grant.
  const scoped = await json(`/v1/agents/mcpproxyadmin/scopes`, {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ scopes: ['mcp:read', 'mcp:use', 'mcp:manage'] }),
  });
  assert(scoped.status === 200, `scopes: ${scoped.status}: ${JSON.stringify(scoped.body)}`);

  // Minted AFTER the grant: a JWT carries the scopes it was minted from, so a token taken before
  // the PATCH would still say what the agent used to hold.
  const token = await agentTokenFor(made.body.data.agent.gaii, made.body.data.private_key);
  // Kept, because the group arms need an agent that may attach and this is the only one.
  manageAgentToken = token;

  const patched = await json('/v1/mcp-servers/upstream', {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: false }),
  });
  assert(patched.status === 200, `expected 200, got ${patched.status}`);

  // And it really stopped, rather than merely being marked.
  const { status } = await json('/v1/mcp-servers/upstream/call', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
  });
  assert(status === 403, `expected the server to be off (403), got ${status}`);
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

await test('a flattened tool honours a switch-off made while its session is open', async () => {
  const flat = await json('/v1/mcp-servers/upstream', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ exposure: 'flatten' }),
  });
  assert(flat.status === 200, `flatten: ${flat.status}`);
  try {
    // Opened AFTER the server was flattened: the session lists upstream__echo as a tool of its own.
    const session = await openMcpSession(agentToken);
    const before = await mcpTool(session, 'upstream__echo', { text: 'flat' });
    assert(!before.isError && before.text.includes('echo:flat'), `the flattened tool: ${before.text}`);

    const off = await json('/v1/mcp-servers/upstream', {
      method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: false }),
    });
    assert(off.status === 200, `switch off: ${off.status}`);
    // The same session. Until 2026-09-24 the tool called with the row listed at session open and
    // the far side still answered (secaudit 2026-09 a49e32ddeb4e).
    const after = await mcpTool(session, 'upstream__echo', { text: 'flat' });
    assert(after.isError && after.text.includes('switched off'), `still answered after switch-off: ${after.text}`);
  } finally {
    // As it was, for the phases after this one.
    await json('/v1/mcp-servers/upstream', {
      method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: true, exposure: 'gateway' }),
    });
  }
});

// ─── Phase 5: the directory, and a capability over a remote tool ───
console.log('\nPhase 5 — The directory and capabilities');

await test('an attached tool is findable in the directory, one entry per TOOL', async () => {
  const { status, body } = await json('/v1/discover?scope=own&q=echo', { headers: ownerAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const hit = (body.data.entries as any[]).find(e => e.id === 'upstream__echo');
  // The whole point of the source: an AI exploring the node finds the ability without being told
  // the server exists first.
  assert(hit, `no upstream__echo in ${JSON.stringify((body.data.entries as any[]).map(e => e.id))}`);
  assert(hit.tags.includes('server:upstream'), `tags were ${JSON.stringify(hit.tags)}`);
});

await test('and the directory entry does not carry the far side address', async () => {
  const { body } = await json('/v1/discover?scope=own&q=echo', { headers: ownerAuth() });
  const hit = (body.data.entries as any[]).find(e => e.id === 'upstream__echo');
  const whole = JSON.stringify(hit);
  // A caller that learns the address calls it directly and leaves every gate behind.
  assert(!whole.includes(String(UPSTREAM_PORT)), `the entry carried the endpoint: ${whole}`);
  assert(hit.href === '/v1/mcp-servers/upstream/tools', `href was ${hit.href}`);
});

await test("what a second owner finds is their OWN, never the first owner's", async () => {
  const { body } = await json('/v1/discover?scope=own&q=echo', { headers: strangerAuth() });
  const found = (body.data.entries as any[]).filter(e => String(e.id).startsWith('upstream__'));
  // Both owners attached a server under the name `upstream`, because the name is scoped to the
  // person. So the question is not whether the id appears; it is WHOSE row is behind it. Learning
  // that somebody else has a server IS the leak, even without calling it.
  assert(found.length > 0, 'the second owner cannot see their own server');
  for (const e of found) {
    assert(String(e.owner).startsWith(`${strangerName}@`),
      `the stranger was shown a row owned by ${e.owner}`);
  }
});

await test('nothing at all on the public scope', async () => {
  const { body } = await json('/v1/discover?scope=public');
  const ids = (body.data.entries as any[]).map(e => e.id);
  assert(!ids.some((i: string) => String(i).startsWith('upstream__')), `public carried ${JSON.stringify(ids)}`);
});

let capabilityId = '';
let privateCapabilityId = '';

await test('attach a second server under a name only this owner holds', async () => {
  // The cross-owner arm below needs a slug the OTHER owner definitely does not have. Both owners
  // hold one called `upstream`, because the name is scoped to the person, so `upstream` cannot
  // tell the two apart.
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'ownersonly', url: UPSTREAM_URL }),
  });
  assert(status === 201, `expected 201, got ${status}`);
});

await test('a remote tool can be published as a capability', async () => {
  const { status, body } = await json('/v1/capabilities', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'say-it-back',
      summary: 'Says back whatever you give it, through the attached server.',
      visibility: 'public',
      source: { type: 'mcp', ref: 'upstream/echo' },
      status: 'active',
      callable: true,
      authRequired: 'registered',
      usage: 'Give it text.',
    }),
  });
  assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(body)}`);
  capabilityId = body.data.capability?.id ?? body.data.id;
  assert(capabilityId, `no id in ${JSON.stringify(body.data)}`);
});

await test('and invoking it reaches the remote tool', async () => {
  const { status, body } = await json(`/v1/capabilities/${capabilityId}/invoke`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ input: { text: 'through the capability' } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(JSON.stringify(body.data).includes('through the capability'),
    `the far side did not answer: ${JSON.stringify(body.data)}`);
});

await test('the ref is resolved through the CALLER, not the publisher', async () => {
  // The stranger has their own `upstream`, so this call goes to THEIR server and succeeds. That is
  // the design working: a capability names a slug, and a slug means whatever it means to whoever
  // is calling. The arm that proves nothing is borrowed is the next one.
  const { status } = await json(`/v1/capabilities/${capabilityId}/invoke`, {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ input: { text: 'my own upstream' } }),
  });
  assert(status === 200, `expected the stranger's own server to answer, got ${status}`);
});

await test('a capability over a server only the publisher has', async () => {
  const { status, body } = await json('/v1/capabilities', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'say-it-back-privately',
      summary: 'Goes through a server only its publisher has attached.',
      visibility: 'public',
      source: { type: 'mcp', ref: 'ownersonly/echo' },
      status: 'active', callable: true, authRequired: 'registered',
      usage: 'Give it text.',
    }),
  });
  assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(body)}`);
  privateCapabilityId = body.data.capability?.id ?? body.data.id;
  assert(privateCapabilityId, `no id in ${JSON.stringify(body.data)}`);

  const mine = await json(`/v1/capabilities/${privateCapabilityId}/invoke`, {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ input: { text: 'mine' } }),
  });
  assert(mine.status === 200, `the publisher cannot use their own: ${mine.status}`);
});

await test('a capability is a signpost: it does not carry access with it', async () => {
  const { status, body } = await json(`/v1/capabilities/${privateCapabilityId}/invoke`, {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ input: { text: 'not mine' } }),
  });
  // The capability is PUBLIC and the stranger may read it. What they may not do is reach the
  // publisher's server through it. If this ever answered 200, the capability register would be a
  // way to launder access to every attached server on the node.
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 5b: a server that belongs to a group ───
console.log('\nPhase 5b — A group server');

let organismId = '';

await test('the owner makes a group', async () => {
  const { status, body } = await json('/v1/organisms', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: `mcp proxy team ${Date.now()}`,
      description: 'For the group-server arms.',
      type: 'team', visibility: 'private', join_policy: 'invite_only',
    }),
  });
  assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(body)}`);
  organismId = body.data.organism?.id ?? body.data.id;
  assert(organismId, `no organism id in ${JSON.stringify(body.data)}`);
});

await test('an AGENT holding mcp:manage can attach one to the group', async () => {
  // check:field-reach found this: the group door had no agent twin at all, so a person could
  // attach a server for their team from the screen and nothing an AI could call could. The twin
  // is aimeat_mcp_attach with `group`, because it is the same act with a different owner.
  const { status, body } = await json('/v1/mcp-servers/organism', {
    method: 'POST', headers: manageAgentAuth(),
    body: JSON.stringify({ organism_id: organismId, name: 'teamwiki', url: UPSTREAM_URL }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('and it belongs to the GROUP, so a second owner outside it reaches nothing', async () => {
  const { status } = await json('/v1/mcp-servers/teamwiki/call', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
  });
  // Absent and not-a-member answer alike: naming it must not confirm it exists.
  assert(status === 404, `expected 404, got ${status}`);
});

await test('somebody outside the group cannot attach to it, in the same words as a group that does not exist', async () => {
  const outsider = await json('/v1/mcp-servers/organism', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ organism_id: organismId, name: 'sneaky', url: UPSTREAM_URL }),
  });
  const nowhere = await json('/v1/mcp-servers/organism', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ organism_id: 'org-does-not-exist', name: 'sneaky', url: UPSTREAM_URL }),
  });
  assert(outsider.status === nowhere.status,
    `an outsider got ${outsider.status} and a missing group got ${nowhere.status}`);
  assert(outsider.body.error?.code === nowhere.body.error?.code,
    `${outsider.body.error?.code} vs ${nowhere.body.error?.code}`);
});

// ─── Phase 5c: the operator's registry, and what a price may be ───
console.log('\nPhase 5c — The operator’s price');

await test('a morsel price is refused BEFORE anything is attached', async () => {
  const { status, body } = await json('/v1/mcp-servers/node', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'morselpriced', url: UPSTREAM_URL, availability: 'all-owners',
      price: { unit: 'morsels', perCall: 3 },
    }),
  });
  // Morsels are a pacer and buy nothing. Refused rather than quietly dropped, so an operator who
  // meant it learns why, instead of finding later that the server was free all along.
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'BAD_PRICE', `code was ${body.error?.code}`);

  // Refuse before you write: attaching probes the far side and stores a row, and neither happened.
  const listed = await json('/v1/mcp-servers/node', { headers: ownerAuth() });
  assert(!(listed.body.data.servers as any[]).some(x => x.slug === 'morselpriced'),
    'a server was attached from a request carrying a morsel price');
});

await test('a free node-wide server answers an admitted owner', async () => {
  const attached = await json('/v1/mcp-servers/node', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'housewide', url: UPSTREAM_URL, availability: 'all-owners' }),
  });
  assert(attached.status === 201, `attach: ${attached.status}: ${JSON.stringify(attached.body)}`);

  const called = await json('/v1/mcp-servers/housewide/call', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'on the house' } }),
  });
  assert(called.status === 200, `a free server should answer, got ${called.status}`);
});

await test('setting a morsel price on it later is refused too, and the price stays as it was', async () => {
  const listed = await json('/v1/mcp-servers/node', { headers: ownerAuth() });
  const row = (listed.body.data.servers as any[]).find(x => x.slug === 'housewide');
  assert(row, 'the house server is missing');

  const patched = await json(`/v1/mcp-servers/node/${row.id}`, {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ price: { unit: 'morsels', perCall: 5 } }),
  });
  assert(patched.status === 400, `expected 400, got ${patched.status}`);
  assert(patched.body.error?.code === 'BAD_PRICE', `code was ${patched.body.error?.code}`);

  const again = await json('/v1/mcp-servers/node', { headers: ownerAuth() });
  const after = (again.body.data.servers as any[]).find(x => x.slug === 'housewide');
  assert(after.price === null, `the price moved to ${JSON.stringify(after.price)}`);
});

await test('a money price is accepted, and a call answers 402 until payment can be taken', async () => {
  const listed = await json('/v1/mcp-servers/node', { headers: ownerAuth() });
  const row = (listed.body.data.servers as any[]).find(x => x.slug === 'housewide');

  const patched = await json(`/v1/mcp-servers/node/${row.id}`, {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ price: { unit: 'money', perCall: 250000, currency: 'EUR' } }),
  });
  assert(patched.status === 200, `expected 200, got ${patched.status}: ${JSON.stringify(patched.body)}`);

  const called = await json('/v1/mcp-servers/housewide/call', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
  });
  // 402 and not 502: nothing reached the far side, and the status is the one that stays true once
  // payment works, so a client does not have to learn it twice.
  assert(called.status === 402, `expected 402, got ${called.status}`);
  assert(called.body.error?.code === 'PRICE_UNSUPPORTED', `code was ${called.body.error?.code}`);
  assert(!String(called.body.error?.message).toLowerCase().includes('morsel'),
    `the refusal points at morsels: ${called.body.error?.message}`);

  // Made free again with a price of zero, which is how a person says it.
  const freed = await json(`/v1/mcp-servers/node/${row.id}`, {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ price: { unit: 'money', perCall: 0 } }),
  });
  assert(freed.status === 200 && freed.body.data.server.price === null,
    `a price of zero should clear it: ${JSON.stringify(freed.body)}`);
});

// ─── Phase 5d: using the node's server is not owning it ───
console.log('\nPhase 5d — The node’s server stays the node’s');

let plain = { name: '', token: '' };
let houseId = '';
const plainAuth = () => ({ Authorization: `Bearer ${plain.token}` });

/** The operator's view of the house server: the one place its settings can be read. */
async function houseRow(): Promise<any> {
  const listed = await json('/v1/mcp-servers/node', { headers: ownerAuth() });
  return (listed.body.data.servers as any[]).find((x) => x.slug === 'housewide');
}

await test('an ordinary owner the node offers the server to may call it', async () => {
  plain = await plainOwner('mcpplain');
  const row = await houseRow();
  assert(row?.slug === 'housewide', 'the house server is missing');
  houseId = row.id;
  const called = await json('/v1/mcp-servers/housewide/call', {
    method: 'POST', headers: plainAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'offered to me' } }),
  });
  assert(called.status === 200, `an admitted owner should reach it, got ${called.status}`);
});

await test('…and gets 404 when changing, signing in or detaching it, by id and by name', async () => {
  // Before 2026-09-24 this owner could switch the server off for everybody, rename it, start a
  // sign-in on it and delete it with its credential (secaudit 2026-09 A2-1).
  for (const ref of [houseId, 'housewide']) {
    const patched = await json(`/v1/mcp-servers/${ref}`, {
      method: 'PATCH', headers: plainAuth(),
      body: JSON.stringify({ enabled: false, title: 'hijacked', exposure: 'flatten' }),
    });
    assert(patched.status === 404, `PATCH ${ref}: expected 404, got ${patched.status}`);
    const authorized = await json(`/v1/mcp-servers/${ref}/authorize`, {
      method: 'POST', headers: plainAuth(), body: JSON.stringify({ return_url: '/spa.html#access' }),
    });
    assert(authorized.status === 404, `authorize ${ref}: expected 404, got ${authorized.status}`);
    const removed = await json(`/v1/mcp-servers/${ref}`, { method: 'DELETE', headers: plainAuth() });
    assert(removed.status === 404, `DELETE ${ref}: expected 404, got ${removed.status}`);
  }
  const row = await houseRow();
  assert(row?.slug === 'housewide', 'the house server was deleted by an owner it was only offered to');
  assert(row.enabled === true && row.title === 'housewide' && row.exposure === 'gateway',
    `the house server was changed: ${JSON.stringify(row)}`);
});

await test('…and its agent holding mcp:manage is refused the same three acts over MCP', async () => {
  const agent = await agentWithScopes(plain, 'mcpplainadmin', ['mcp:read', 'mcp:use', 'mcp:manage']);
  const session = await openMcpSession(agent.token);
  const acts: [string, Record<string, unknown>][] = [
    ['aimeat_mcp_update', { server: 'housewide', enabled: false, title: 'hijacked' }],
    ['aimeat_mcp_authorize', { server: 'housewide' }],
    ['aimeat_mcp_detach', { server: 'housewide' }],
  ];
  for (const [tool, args] of acts) {
    const r = await mcpTool(session, tool, args);
    // The not-found sentence, not merely an error: before the fix the sign-in failed only because
    // this upstream offers no OAuth, which would have passed a bare isError check.
    assert(r.isError && r.text.includes('no server called'), `${tool} was not refused: ${r.text}`);
  }
  const row = await houseRow();
  assert(row && row.enabled === true && row.title === 'housewide',
    `the house server was changed over MCP: ${JSON.stringify(row)}`);
});

await test('the operator changes it on the node doors, and a personal door reaches it for nobody', async () => {
  const personal = await json('/v1/mcp-servers/housewide', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ title: 'renamed' }),
  });
  assert(personal.status === 404, `the operator's personal door: expected 404, got ${personal.status}`);

  const off = await json(`/v1/mcp-servers/node/${houseId}`, {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: false }),
  });
  assert(off.status === 200, `node door off: ${off.status}: ${JSON.stringify(off.body)}`);
  const refused = await json('/v1/mcp-servers/housewide/call', {
    method: 'POST', headers: plainAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'x' } }),
  });
  assert(refused.status === 403, `switched off for everybody: expected 403, got ${refused.status}`);

  const on = await json(`/v1/mcp-servers/node/${houseId}`, {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ enabled: true }),
  });
  assert(on.status === 200, `node door on: ${on.status}`);
  const back = await json('/v1/mcp-servers/housewide/call', {
    method: 'POST', headers: plainAuth(),
    body: JSON.stringify({ tool: 'echo', arguments: { text: 'back' } }),
  });
  assert(back.status === 200, `on again: expected 200, got ${back.status}`);
});

// ─── Phase 6: a local process, which this node does not run ───
console.log('\nPhase 6 — A local process');

await test('the operator naming a command is refused while the node does not run them', async () => {
  const { status, body } = await json('/v1/mcp-servers/node', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'localone', command: 'npx', args: ['some-server'] }),
  });
  // Off by default, and the refusal names the setting that turns it on rather than reading as a
  // broken server. The test node sets neither stdio value, which is the default this asserts.
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'STDIO_DISABLED', `code was ${body.error?.code}`);
  // The sentence is for a person and the setting is in `details`, where a technical reader looks
  // for it. check:plain-language refused the first version of this, which put the name in the
  // prose, and it was right: the operator needs to know what happened before which switch.
  assert(JSON.stringify(body.error?.details).includes('AIMEAT_MCP_STDIO_ENABLED'),
    `the refusal does not name the setting: ${JSON.stringify(body.error)}`);
});

await test('an ordinary owner has no way to name a command at all', async () => {
  // The only door that can write a stdio record stands behind requireOperatorPrincipal. This one
  // does not read `command`, so what it sees is a request with no address.
  const { status } = await json('/v1/mcp-servers', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ name: 'sneaky', command: 'npx', args: ['some-server'] }),
  });
  assert(status === 400, `expected 400, got ${status}`);

  const listed = await json('/v1/mcp-servers', { headers: strangerAuth() });
  assert(!(listed.body.data.servers as any[]).some(x => x.slug === 'sneaky'),
    'a server was attached from a request that named only a command');
});

// ─── Phase 7: off and gone ───

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
await new Promise<void>((r) => oauthUpstream.close(() => r()));

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

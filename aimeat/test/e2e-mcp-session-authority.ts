/**
 * @file test/e2e-mcp-session-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A01/A02 regressions: the real MCP transport binds every request to its
 *   principal and honors scope removal without changing the existing E2E expectations.
 * @version-history
 *   v1.0.0 -- 2026-09-27 -- Added session bearer, cross-owner and live-scope regressions.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
let passed = 0;
let failed = 0;
let sequence = 0;

async function test(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function rest(path: string, method = 'GET', token?: string, body?: unknown) {
  const response = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  // The HTTP boundary is validated by the assertions below, not a generated static response.
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function sign(key: string, text: string) {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(text), Buffer.from(key, 'base64'))).toString('base64');
}

interface Session { token: string; id: string; path: string }
async function rpc(session: Session, method: string, params: unknown = {}, token: string | undefined = session.token) {
  const id = ++sequence;
  const response = await fetch(BASE + session.path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session.id ? { 'mcp-session-id': session.id, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(30_000),
  });
  session.id = response.headers.get('mcp-session-id') ?? session.id;
  const raw = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    : raw ? [JSON.parse(raw)] : [];
  return { status: response.status, body: frames.find(frame => frame.id === id) };
}

async function open(token: string, path = '/v1/mcp'): Promise<Session> {
  const session = { token, path, id: '' };
  const result = await rpc(session, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'session-authority', version: '1' },
  });
  assert.equal(result.status, 200, 'valid agent initializes');
  assert.ok(session.id, 'initialize assigns an MCP session');
  return session;
}

async function owner(label: string) {
  const name = `authority${label}${Date.now()}`;
  const registration = await rest('/v1/ghii', 'POST', undefined, {
    username: name, display_name: label, password: 'SessionAuthority1234',
  });
  assert.equal(registration.status, 201, 'owner registration');
  const time = new Date().toISOString();
  const login = await rest('/v1/auth/token', 'POST', undefined, {
    owner: name, timestamp: time, signature: await sign(registration.body.data.private_key, name + NODE + time),
  });
  assert.equal(login.status, 200, 'owner credential');
  return { name, token: login.body.data.token as string };
}

async function agent(account: Awaited<ReturnType<typeof owner>>, name: string) {
  const registration = await rest('/v1/agents', 'POST', account.token, {
    owner: account.name, name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write', 'catalogue:read'],
  });
  assert.equal(registration.status, 201, 'agent registration');
  const gaii = registration.body.data.agent.gaii as string;
  const client = await rest('/v1/mcp/register', 'POST', undefined, { client_name: 'authority-test', redirect_uris: [] });
  const time = new Date().toISOString();
  const authorization = await rest('/v1/mcp/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: client.body.client_id, gaii, timestamp: time,
    signature: await sign(registration.body.data.private_key, gaii + NODE + time),
  }));
  const token = await rest('/v1/mcp/token', 'POST', undefined, {
    grant_type: 'authorization_code', code: authorization.body.code,
    client_id: client.body.client_id, client_secret: client.body.client_secret,
  });
  assert.equal(token.status, 200, 'agent credential');
  return { name, gaii, token: token.body.access_token as string,
    refresh: token.body.refresh_token as string, client: client.body };
}

const first = await owner('a');
const second = await owner('b');
const actor = await agent(first, 'actor');
const sibling = await agent(first, 'sibling');
const foreign = await agent(second, 'actor');
const key = 'session.authority.private';
assert.equal((await rest('/v1/memory', 'POST', actor.token, { key, value: { marker: 'private' }, visibility: 'private' })).status, 201);
const call = { name: 'aimeat_memory_read', arguments: { key } };

for (const path of ['/v1/mcp', '/v2/mcp/agent']) {
  await test(`${path}: authenticated positive control reads its record`, async () => {
    const session = await open(actor.token, path);
    const result = await rpc(session, 'tools/call', call);
    assert.equal(result.status, 200);
    assert.ok(result.body?.result && !result.body.result.isError, 'own read succeeds');
  });
  for (const [label, token] of [['missing bearer', ''], ['other owner', second.token], ['other agent', foreign.token], ['sibling agent', sibling.token]]) {
    await test(`${path}: rejects ${label} on an existing session`, async () => {
      const session = await open(actor.token, path);
      const result = await rpc(session, 'tools/call', call, token);
      assert.equal(result.status, token ? 403 : 401);
      const own = await rpc(session, 'tools/call', call);
      assert.ok(own.body?.result && !own.body.result.isError, 'refusal leaves the valid session usable');
    });
  }
  for (const method of ['GET', 'DELETE']) {
    for (const token of ['', foreign.token]) {
      await test(`${path}: ${method} checks ${token ? 'principal' : 'bearer'}`, async () => {
        const session = await open(actor.token, path);
        const response = await fetch(BASE + path, {
          method, headers: { Accept: 'text/event-stream', 'mcp-session-id': session.id,
            ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(5_000),
        });
        await response.body?.cancel();
        assert.equal(response.status, token ? 403 : 401);
        assert.equal((await rpc(session, 'ping')).status, 200);
      });
    }
  }
}
await test('An open session loses a removed scope, in discovery and execution', async () => {
  const session = await open(actor.token);
  const before = await rpc(session, 'tools/list');
  assert.ok(before.body.result.tools.some((tool: { name: string }) => tool.name === 'aimeat_memory_write'));
  assert.equal((await rest(`/v1/agents/${actor.name}/scopes`, 'PATCH', first.token, { scopes: ['catalogue:read'] })).status, 200);
  assert.equal((await rest('/v1/memory', 'POST', actor.token, { key: key + '.rest', value: 'denied' })).status, 403);
  const after = await rpc(session, 'tools/list');
  assert.equal(after.status, 200, 'session remains usable after permission removal');
  assert.ok(!after.body.result.tools.some((tool: { name: string }) => tool.name === 'aimeat_memory_write'));
  const write = await rpc(session, 'tools/call', { name: 'aimeat_memory_write', arguments: { key: key + '.denied', value: 'denied' } });
  assert.ok(write.body?.error || write.body?.result?.isError, 'removed permission cannot execute by name');
  const stored = await rest(`/v1/memory/${encodeURIComponent(actor.gaii)}/${key}.denied`, 'GET', first.token);
  assert.equal(stored.status, 404, 'the rejected call did not store a record');
});
await test('A refreshed credential for the same principal can resume its session', async () => {
  const session = await open(sibling.token);
  const refreshed = await rest('/v1/mcp/token', 'POST', undefined, {
    grant_type: 'refresh_token', refresh_token: sibling.refresh,
    client_id: sibling.client.client_id, client_secret: sibling.client.client_secret,
  });
  assert.equal(refreshed.status, 200);
  const result = await rpc(session, 'ping', {}, refreshed.body.access_token);
  assert.equal(result.status, 200);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exitCode = failed > 0 ? 1 : 0;

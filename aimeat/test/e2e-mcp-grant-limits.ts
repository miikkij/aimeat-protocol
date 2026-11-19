/**
 * @file test/e2e-mcp-grant-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An owner's narrowing of an agent on an attached MCP server can carry an end date and
 *   a ceiling on calls (services/mcp-client/grants.ts resolveMcpAccess). Both were held by unit tests
 *   only (test/unit/mcp-grants.test.ts, mcp-grant-cap-count.test.ts), on SQLite, with the usage rows
 *   written by hand. This suite holds them on a real node, on the run's backend, with the calls the
 *   agent really makes counted from the usage stream:
 *     1. an end date in the past refuses every call with 403 NOT_GRANTED and names the date, on REST
 *        and over MCP; an end date in the future admits the call; the owner in person is never
 *        narrowed by it;
 *     2. a call ceiling admits `count` calls in the window and refuses the next one with 403
 *        NOT_GRANTED; a call the tool itself answered with isError does not count, a refused call
 *        does not count, another agent of the same owner is not counted against it, and a higher
 *        ceiling written later admits the next call; over MCP the refusal is the same.
 *   The far side is a real MCP server this suite starts on a port of its own.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-grant-limits
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

const UPSTREAM_PORT = Number(new URL(BASE).port || '40251') + 261;
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}/mcp`;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ─── The far side: `echo` answers, `refuses` answers isError (the tool saying no) ───
const transports = new Map<string, NodeStreamableHTTPServerTransport>();
let upstreamCalls = 0;
const upstream = http.createServer(async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid && !transports.has(sid)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}');
    return;
  }
  let transport = sid ? transports.get(sid) : undefined;
  if (!transport) {
    const srv = new McpServer({ name: 'e2e-grant-limits', version: '1.0.0' });
    srv.registerTool('echo', { description: 'Repeats its input.', inputSchema: z.object({ text: z.string() }), annotations: { readOnlyHint: true } },
      async ({ text }) => { upstreamCalls++; return { content: [{ type: 'text', text: `echo:${text}` }] }; });
    srv.registerTool('refuses', { description: 'Answers isError.', inputSchema: z.object({}) },
      async () => { upstreamCalls++; return { content: [{ type: 'text', text: 'not allowed' }], isError: true }; });
    const created = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => transports.set(id, created),
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

console.log('\n=== An MCP grant\'s end date and call ceiling ===\n');
await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

const stamp = Date.now().toString(36);
const SERVER = 'limited';
let owner!: { name: string; token: string };
let agent!: McpAgent;
let neighbour!: McpAgent;

/** An agent of `owner` holding exactly mcp:read and mcp:use, set through the scopes route. */
async function mcpAgent(name: string): Promise<McpAgent> {
  const made = await makeAgent(BASE, owner, ['mcp:read', 'mcp:use'], name);
  const scoped = await json(`/v1/agents/${name}/scopes`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ scopes: ['mcp:read', 'mcp:use'] }) });
  assert(scoped.status === 200, `scopes ${name}: ${scoped.status} ${JSON.stringify(scoped.body)}`);
  // A token minted after the scopes were set carries them.
  return makeAgentToken(made);
}
async function makeAgentToken(a: McpAgent): Promise<McpAgent> {
  const ed = await import('@noble/ed25519');
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(a.gaii + ts), Buffer.from(a.privateKey, 'base64'));
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: a.gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
  assert(tok.status === 200, `agent token: ${tok.status} ${JSON.stringify(tok.body)}`);
  return { ...a, token: tok.body.data.token };
}
const call = (token: string, tool: string, args: Record<string, unknown> = {}) =>
  json(`/v1/mcp-servers/${SERVER}/call`, { method: 'POST', headers: auth(token), body: JSON.stringify({ tool, arguments: args }) });
const putGrant = (body: Record<string, unknown>) =>
  json(`/v1/mcp-servers/${SERVER}/grants`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(body) });

try {
  console.log('Setup');
  await test('An owner, two agents holding mcp:read and mcp:use, and an attached server', async () => {
    const reg = await registerOwner(BASE, `grantlim${stamp}`);
    owner = { name: reg.name, token: reg.token };
    agent = await mcpAgent('limitbot');
    neighbour = await mcpAgent('neighbourbot');
    const attached = await json('/v1/mcp-servers', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: SERVER, url: UPSTREAM_URL }) });
    assert(attached.status === 201, `attach: ${attached.status} ${JSON.stringify(attached.body)}`);
    const before = await call(agent.token, 'echo', { text: 'no grant yet' });
    assert(before.status === 200, `with no grant the scope decides: ${before.status} ${JSON.stringify(before.body)}`);
  });

  console.log('\n1. The end date');
  await test('1a. A grant whose end date has passed refuses the call with 403 NOT_GRANTED and names the date', async () => {
    const put = await putGrant({ grantee: agent.gaii, tools: '*', expires: '2020-01-31' });
    assert(put.status === 200, `put: ${put.status} ${JSON.stringify(put.body)}`);
    const reached = upstreamCalls;
    const r = await call(agent.token, 'echo', { text: 'too late' });
    expectRefusal(r, 403, 'NOT_GRANTED');
    assert(String(r.body.error?.message).includes('ran out on 2020-01-31'), `the refusal names the date: ${r.body.error?.message}`);
    assert(upstreamCalls === reached, 'the far side was never asked');
  });

  await test('1b. The same refusal over MCP (aimeat_mcp_call)', async () => {
    const s = await openSession(BASE, agent.token, 'grant-limits-expired');
    const r = await callTool(s, 'aimeat_mcp_call', { server: SERVER, tool: 'echo', arguments: { text: 'too late' } });
    assert(r.isError && /ran out on 2020-01-31/.test(r.text), `expected the expiry refusal, got ${r.text.slice(0, 300)}`);
  });

  await test('1c. The owner in person is not narrowed by the expired grant', async () => {
    const r = await call(owner.token, 'echo', { text: 'mine' });
    assert(r.status === 200, `owner: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });

  await test('1d. An end date in the future admits the call', async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const put = await putGrant({ grantee: agent.gaii, tools: '*', expires: future });
    assert(put.status === 200, `put: ${put.status}`);
    const r = await call(agent.token, 'echo', { text: 'in time' });
    assert(r.status === 200 && JSON.stringify(r.body.data?.content).includes('echo:in time'), `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  });

  console.log('\n2. The call ceiling');
  await test('2a. A ceiling of 3 calls an hour admits the third call and refuses the fourth with 403 NOT_GRANTED', async () => {
    const put = await putGrant({ grantee: agent.gaii, tools: '*', call_cap: { count: 3, windowHours: 1 } });
    assert(put.status === 200 && put.body.data.grant.callCap?.count === 3, `put: ${put.status} ${JSON.stringify(put.body)}`);
    // The calls before this grant (setup and 1d) are inside the window and count: the cap reads the
    // agent's ok calls on this server from the usage stream, not a counter the grant started. The
    // refused calls of 1a and 1b are not among them.
    const third = await call(agent.token, 'echo', { text: 'three' });
    assert(third.status === 200, `the third ok call in the hour: ${third.status} ${JSON.stringify(third.body?.error)}`);
    const reached = upstreamCalls;
    const fourth = await call(agent.token, 'echo', { text: 'four' });
    expectRefusal(fourth, 403, 'NOT_GRANTED');
    assert(/used "limited" 3 times in the last 1 hours, which is its limit/.test(String(fourth.body.error?.message)), `the refusal says the limit: ${fourth.body.error?.message}`);
    assert(upstreamCalls === reached, 'the refused call never reached the far side');
  });

  await test('2b. The same refusal over MCP, and a refused call does not count as a call', async () => {
    const s = await openSession(BASE, agent.token, 'grant-limits-cap');
    const r = await callTool(s, 'aimeat_mcp_call', { server: SERVER, tool: 'echo', arguments: { text: 'four' } });
    assert(r.isError && /which is its limit/.test(r.text), `expected the cap refusal, got ${r.text.slice(0, 300)}`);
    // Raising the ceiling by one admits exactly one more call: the refusals above were not counted.
    const put = await putGrant({ grantee: agent.gaii, tools: '*', call_cap: { count: 4, windowHours: 1 } });
    assert(put.status === 200, `put: ${put.status}`);
    const one = await call(agent.token, 'echo', { text: 'one more' });
    assert(one.status === 200, `a ceiling of 4 admits a fourth ok call: ${one.status} ${JSON.stringify(one.body?.error)}`);
    const none = await call(agent.token, 'echo', { text: 'and no more' });
    expectRefusal(none, 403, 'NOT_GRANTED');
  });

  await test('2c. A call the tool answered with isError does not count against the ceiling', async () => {
    const put = await putGrant({ grantee: agent.gaii, tools: '*', call_cap: { count: 5, windowHours: 1 } });
    assert(put.status === 200, `put: ${put.status}`);
    const no = await call(agent.token, 'refuses');
    assert(no.status === 200 && no.body.data?.is_error === true, `the tool says no: ${no.status} ${JSON.stringify(no.body)}`);
    const ok = await call(agent.token, 'echo', { text: 'five ok calls' });
    assert(ok.status === 200, `the tool's own no left room for a fifth ok call: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const over = await call(agent.token, 'echo', { text: 'six' });
    expectRefusal(over, 403, 'NOT_GRANTED');
  });

  await test('2d. Another agent of the same owner is not counted against this agent\'s ceiling', async () => {
    const r = await call(neighbour.token, 'echo', { text: 'my own' });
    assert(r.status === 200, `the neighbour has no grant and its own count: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const still = await call(agent.token, 'echo', { text: 'still capped' });
    expectRefusal(still, 403, 'NOT_GRANTED');
  });

  await test('2e. A ceiling on the neighbour counts only the neighbour\'s calls', async () => {
    const put = await putGrant({ grantee: neighbour.gaii, tools: '*', call_cap: { count: 2, windowHours: 1 } });
    assert(put.status === 200, `put: ${put.status}`);
    const second = await call(neighbour.token, 'echo', { text: 'second' });
    assert(second.status === 200, `the neighbour's second call: ${second.status} ${JSON.stringify(second.body?.error)}`);
    const third = await call(neighbour.token, 'echo', { text: 'third' });
    expectRefusal(third, 403, 'NOT_GRANTED');
    assert(/used "limited" 2 times/.test(String(third.body.error?.message)), `the neighbour's own count: ${third.body.error?.message}`);
  });

  await test('2f. Removing the grant lifts the ceiling, and the scope decides again', async () => {
    const del = await json(`/v1/mcp-servers/${SERVER}/grants/${encodeURIComponent(agent.gaii)}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(del.status === 200, `delete: ${del.status}`);
    const r = await call(agent.token, 'echo', { text: 'free again' });
    assert(r.status === 200, `no grant, no ceiling: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });
} finally {
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
}

finish();

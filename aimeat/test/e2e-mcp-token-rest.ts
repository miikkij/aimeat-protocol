/**
 * @file test/e2e-mcp-token-rest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An MCP OAuth access token (bound to the node's MCP endpoint, RFC 8707) on a running 3.x
 *   node: a REST route accepts it, answers with `Deprecation: true` and `X-AIMEAT-Removed-In: 4.0.0`,
 *   and GET /v1/stats counts it (`deprecated_use_by_type.mcp_token_on_rest`). The MCP endpoint takes
 *   it and does not count it. The three MCP tools that reach REST routes over loopback with the
 *   session's bearer (aimeat_invoke, aimeat_capabilities_invoke, aimeat_app_tool_invoke) work for a
 *   session signed in with it, count nothing (their loopback request carries the node's pass,
 *   src/auth/loopback-pass.ts), and still refuse a session without the scope the route asks for.
 *   The 4.0.0 refusal is proved by test/unit/mcp-token-on-rest.test.ts, which runs the same code as
 *   4.0.0; a running node is the version its package says.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-token-rest
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-tokeni-ei-kelpaa-rest-reiteill-4-0-0-sta-ensin-kolme-mcp).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { mcpPkce, authorizeParams, tokenParams } from './helpers/mcp-oauth-pkce.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = randomBytes(5).toString('hex');
const EXT = 'tokenrest' + stamp;
const FILE = 'tokenrest-' + stamp + '.html';
const CAPABILITY = `ext:${EXT}:echo`;
const PASSWORD = 'TokenRestTest1234';
const FULL_SCOPES = ['memory:read', 'memory:write', 'work:request', 'exchange:write', 'ext:invoke', 'social:read'];
const LIMITED_SCOPES = ['memory:read', 'work:request', 'exchange:write', 'social:read'];
ed.hashes.sha512 = message => new Uint8Array(createHash('sha512').update(message).digest());

let passed = 0, failed = 0, rpcId = 0;
type Owner = { owner: string; token: string };
type Agent = { gaii: string; privateKey: string };
const owners: Owner[] = [];

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message); }
}
const auth = (token: string) => ({ Authorization: 'Bearer ' + token });
async function json(path: string, options: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const text = await response.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: response.status, body, headers: response.headers };
}
async function signed(privateKey: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKey, 'base64'))).toString('base64');
}
async function makeOwner(prefix: string): Promise<Owner> {
  const owner = prefix + stamp;
  const registration = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: PASSWORD }) });
  assert(registration.status === 201, 'register ' + registration.status + ' ' + JSON.stringify(registration.body.error));
  const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: owner, password: PASSWORD }) });
  assert(login.status === 200, 'owner login ' + login.status + ' ' + JSON.stringify(login.body.error));
  const result = { owner, token: login.body.data.token as string }; owners.push(result); return result;
}
async function makeAgent(owner: Owner, scopes: string[]): Promise<Agent> {
  const registration = await json('/v1/agents', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: 'tok' + randomBytes(3).toString('hex'), owner: owner.owner, scopes }) });
  assert(registration.status === 201, 'agent register ' + registration.status + ' ' + JSON.stringify(registration.body.error));
  return { gaii: registration.body.data.agent.gaii as string, privateKey: registration.body.data.private_key as string };
}
/** The agent's token from POST /v1/auth/token: no audience. */
async function plainToken(agent: Agent): Promise<string> {
  const timestamp = new Date().toISOString();
  const login = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agent.gaii, timestamp,
    signature: await signed(agent.privateKey, agent.gaii + timestamp) }) });
  assert(login.status === 200, 'agent login ' + login.status); return login.body.data.token as string;
}
/** The MCP OAuth flow with PKCE and the resource: a token bound to the MCP endpoint. */
async function mcpToken(agent: Agent): Promise<string> {
  const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'token-rest-' + stamp }) });
  const clientId = reg.body.client_id as string, clientSecret = reg.body.client_secret as string;
  assert(typeof clientId === 'string', 'client register ' + reg.status);
  const pkce = mcpPkce(BASE);
  const timestamp = new Date().toISOString();
  const signature = await signed(agent.privateKey, agent.gaii + NODE_ID + timestamp);
  const qs = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii: agent.gaii, signature, timestamp, ...authorizeParams(pkce) });
  const a = await json('/v1/mcp/authorize?' + qs);
  assert(a.status === 200 && typeof a.body.code === 'string', 'authorize ' + a.status + ' ' + JSON.stringify(a.body));
  const t = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({
    grant_type: 'authorization_code', code: a.body.code, client_id: clientId, client_secret: clientSecret, ...tokenParams(pkce) }) });
  assert(t.status === 200, 'token ' + t.status + ' ' + JSON.stringify(t.body));
  const aud = JSON.parse(Buffer.from(String(t.body.access_token).split('.')[1], 'base64url').toString('utf-8')).aud;
  assert(aud === pkce.resource, 'the token names the MCP endpoint: ' + aud);
  return t.body.access_token as string;
}
async function rpc(token: string, sessionId: string | null, method: string, params: Record<string, unknown>): Promise<{ status: number; sessionId: string | null; message: any }> {
  const id = ++rpcId;
  const response = await fetch(BASE + '/v1/mcp', { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth(token),
    ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await response.text();
  let message: any = null;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const messages = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    message = messages.find(m => m.id === id) ?? messages[0] ?? null;
  } else if (text) { try { message = JSON.parse(text); } catch { message = text; } }
  return { status: response.status, sessionId: response.headers.get('mcp-session-id') ?? sessionId, message };
}
async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; data: any }> {
  const init = await rpc(token, null, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'token-rest-e2e', version: '1' } });
  assert(init.status === 200, 'initialize ' + init.status);
  const out = await rpc(token, init.sessionId, 'tools/call', { name, arguments: args });
  await fetch(BASE + '/v1/mcp', { method: 'DELETE', headers: { ...auth(token), 'mcp-session-id': init.sessionId ?? '' } }).catch(() => undefined);
  const text: string = out.message?.result?.content?.[0]?.text ?? JSON.stringify(out.message?.error ?? out.message);
  let data: any = null; try { data = JSON.parse(text); } catch { /* a refusal sentence */ }
  return { isError: out.message?.result?.isError === true || !!out.message?.error, text, data };
}

console.log('An MCP-bound token on REST routes, on a 3.x node, at ' + BASE);
let seller: Owner | undefined;
try {
  seller = await makeOwner('trs');
  const buyer = await makeOwner('trb');
  const actor = await makeAgent(buyer, FULL_SCOPES);
  const limited = await makeAgent(buyer, LIMITED_SCOPES);
  const actorMcp = await mcpToken(actor);
  const limitedMcp = await mcpToken(limited);
  const actorPlain = await plainToken(actor);
  const restUses = async (): Promise<number> => {
    const { body } = await json('/v1/stats', { headers: auth(buyer.token) });
    return Number(body?.data?.deprecated_use_by_type?.mcp_token_on_rest ?? 0);
  };

  const manifest = JSON.stringify({ metadata: { name: EXT, version: '1.0.0', description: 'Token on REST fixture', author: 'e2e' },
    actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo' }],
    config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 } });
  const install = await json('/v1/extensions', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ manifest,
    scripts: { echo: 'export default async function(ctx,input){return {input,caller:ctx.caller.gaii,scopes:ctx.caller.scopes};}' } }) });
  assert(install.status === 201, 'extension install ' + install.status + ' ' + JSON.stringify(install.body.error));
  assert((await json('/v1/extensions/' + EXT + '/activate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'activate');
  assert((await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'aggregate');
  const tool = { name: 'echo', action_id: CAPABILITY,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
  const saved = await json('/v1/memory', { method: 'POST', headers: auth(seller.token),
    body: JSON.stringify({ key: 'apps.' + FILE + '.tools', visibility: 'public', value: { version: 1, tools: [tool] } }) });
  assert(saved.status === 201, 'manifest ' + saved.status);

  await test('a REST route accepts an MCP-bound token on 3.x, names its removal, and counts it', async () => {
    const before = await restUses();
    const r = await json('/v1/memory?limit=1', { headers: auth(actorMcp) });
    assert(r.status === 200, 'status ' + r.status + ' ' + JSON.stringify(r.body.error));
    assert(r.headers.get('deprecation') === 'true', 'Deprecation: ' + r.headers.get('deprecation'));
    assert(r.headers.get('x-aimeat-removed-in') === '4.0.0', 'X-AIMEAT-Removed-In: ' + r.headers.get('x-aimeat-removed-in'));
    const after = await restUses();
    assert(after === before + 1, `counted once: ${before} -> ${after}`);
  });
  await test('the MCP endpoint takes the same token and does not count it', async () => {
    const before = await restUses();
    const init = await rpc(actorMcp, null, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'token-rest-e2e', version: '1' } });
    assert(init.status === 200 && init.message?.result?.serverInfo, 'initialize ' + init.status);
    assert(await restUses() === before, 'the MCP endpoint is not a REST use');
  });
  await test('an agent token without an audience is not judged', async () => {
    const r = await json('/v1/memory?limit=1', { headers: auth(actorPlain) });
    assert(r.status === 200 && r.headers.get('deprecation') === null, 'status ' + r.status + ', Deprecation ' + r.headers.get('deprecation'));
  });
  await test('aimeat_invoke runs a capability as the caller and counts nothing', async () => {
    const before = await restUses();
    const out = await callTool(actorMcp, 'aimeat_invoke', { capability: 'aimeat_memory_write', input: { key: 'notes.token-rest', value: { ok: true } } });
    assert(!out.isError, out.text);
    const read = await json('/v1/memory/notes.token-rest', { headers: auth(actorPlain) });
    assert(read.status === 200 && read.body.data?.value?.ok === true, 'written as the agent: ' + read.status);
    assert(await restUses() === before, 'the loopback request is the node\'s own');
  });
  await test('aimeat_invoke still refuses a caller without memory:write', async () => {
    const out = await callTool(limitedMcp, 'aimeat_invoke', { capability: 'aimeat_memory_write', input: { key: 'notes.denied', value: { ok: false } } });
    assert(out.isError && out.data?.code === 'SCOPE_DENIED', out.text);
  });
  await test('aimeat_capabilities_invoke runs an extension capability as the caller and counts nothing', async () => {
    const before = await restUses();
    const out = await callTool(actorMcp, 'aimeat_capabilities_invoke', { id: CAPABILITY, input: { query: 'cap' } });
    assert(!out.isError, out.text);
    assert(out.data?.result?.caller === actor.gaii, 'caller ' + JSON.stringify(out.data?.result));
    assert(await restUses() === before, 'the loopback request is the node\'s own');
  });
  await test('aimeat_app_tool_invoke calls an app tool as the caller and counts nothing', async () => {
    const before = await restUses();
    const out = await callTool(actorMcp, 'aimeat_app_tool_invoke', { owner: seller!.owner, app: FILE, tool: 'echo', input: { query: 'tool' } });
    assert(!out.isError, out.text);
    const result = out.data?.result?.result ?? out.data?.result;
    assert(result?.caller === actor.gaii, 'caller ' + JSON.stringify(result));
    assert(await restUses() === before, 'the loopback request is the node\'s own');
  });
} catch (error) { failed++; console.error('Fixture failed: ' + (error as Error).message); }
finally {
  if (seller) {
    await test('fixture extension cleanup', async () => {
      const result = await json('/v1/extensions/' + EXT, { method: 'DELETE', headers: auth(seller!.token) });
      assert(result.status === 200, 'extension delete ' + result.status);
    });
  }
  for (const current of owners.reverse()) await test('fixture owner cleanup ' + current.owner, async () => {
    assert((await json('/v1/owners/' + current.owner, { method: 'DELETE', headers: auth(current.token) })).status === 200, 'owner cleanup');
  });
}
console.log(passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exitCode = failed ? 1 : 0;

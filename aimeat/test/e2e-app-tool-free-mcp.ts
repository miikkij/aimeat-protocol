/**
 * @file test/e2e-app-tool-free-mcp.ts
 * @description Real HTTP/MCP parity for unpriced cross-owner app tools, with paid and private refusals.
 * @structure Authenticated fixtures; free calls and caller identity; refusal paths; cleanup.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-tool-free-mcp
 * @version-history
 *   2026-10-06 — Regression: the MCP adapter refused an unpriced public tool that REST could invoke.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = randomBytes(5).toString('hex'), EXT = 'freetool' + stamp, FILE = 'free-' + stamp + '.html';
const PRIVATE_FILE = 'private-' + stamp + '.html';
let passed = 0, failed = 0, rpcId = 0;
type Owner = { owner: string; token: string };
type Agent = { gaii: string; token: string };
type Session = { token: string; sessionId?: string };
const owners: Owner[] = [], sessions: Session[] = [];
ed.hashes.sha512 = message => new Uint8Array(createHash('sha512').update(message).digest());

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message); }
}
const auth = (token: string) => ({ Authorization: 'Bearer ' + token });
async function json(path: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const text = await response.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: response.status, body };
}
async function signed(privateKey: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKey, 'base64'))).toString('base64');
}
async function makeOwner(prefix: string): Promise<Owner> {
  const owner = prefix + stamp;
  const registration = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: 'FreeToolTest1234' }) });
  assert(registration.status === 201, 'register ' + registration.status);
  const timestamp = new Date().toISOString();
  const login = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp,
    signature: await signed(registration.body.data.private_key, owner + NODE_ID + timestamp) }) });
  assert(login.status === 200, 'owner login ' + login.status);
  const result = { owner, token: login.body.data.token as string }; owners.push(result); return result;
}
async function makeAgent(owner: Owner, scopes: string[]): Promise<Agent> {
  const registration = await json('/v1/agents', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: 'helper' + randomBytes(3).toString('hex'), owner: owner.owner, scopes }) });
  assert(registration.status === 201, 'agent register ' + registration.status);
  const gaii = registration.body.data.agent.gaii as string, timestamp = new Date().toISOString();
  const login = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp,
    signature: await signed(registration.body.data.private_key, gaii + timestamp) }) });
  assert(login.status === 200, 'agent login ' + login.status); return { gaii, token: login.body.data.token };
}
async function rpc(session: Session, method: string, params: Record<string, unknown>): Promise<any> {
  const id = ++rpcId;
  const response = await fetch(BASE + '/v1/mcp', { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth(session.token),
    ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
  }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const sid = response.headers.get('mcp-session-id'); if (sid) session.sessionId = sid;
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const messages = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    return messages.find(message => message.id === id) ?? messages[0];
  }
  return JSON.parse(text);
}
async function session(token: string): Promise<Session> {
  const result: Session = { token }; sessions.push(result);
  const initialized = await rpc(result, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'free-app-tools-e2e', version: '1' } });
  assert(initialized.result, 'MCP initialized'); return result;
}
async function invoke(session: Session, owner: Owner, name: string, input: Record<string, unknown> = {}, app = FILE) {
  const body = await rpc(session, 'tools/call', { name: 'aimeat_app_tool_invoke', arguments: { owner: owner.owner, app, tool: name, input } });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
  let data: any; try { data = JSON.parse(text); } catch { data = null; }
  return { isError: body?.result?.isError === true || !!body?.error, text, data };
}
const echo = (response: any) => response?.result?.result ?? response?.result;
async function deleteExtension(owner: Owner): Promise<void> {
  await test('fixture extension cleanup', async () => {
    const result = await json('/v1/extensions/' + EXT, { method: 'DELETE', headers: auth(owner.token) });
    assert(result.status === 200, 'extension delete ' + result.status);
  });
}

console.log('Free app-tool MCP parity at ' + BASE);
let seller: Owner | undefined;
try {
  seller = await makeOwner('fts'); const buyer = await makeOwner('ftb');
  const actor = await makeAgent(buyer, ['exchange:write', 'social:read']);
  const limited = await makeAgent(buyer, ['exchange:read', 'social:read']);
  const agentSession = await session(actor.token), limitedSession = await session(limited.token);
  const manifest = JSON.stringify({ metadata: { name: EXT, version: '1.0.0', description: 'Free app tool parity fixture', author: 'e2e' },
    actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo' },
      { id: 'paid', method: 'POST', path: '/paid', script: 'echo', commercial: { payMoney: { amount: 1000, currency: 'EUR' } } }],
    config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 } });
  const install = await json('/v1/extensions', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ manifest,
    scripts: { echo: 'export default async function(ctx,input){return {input,caller:ctx.caller.gaii,owner:ctx.caller.owner,roles:ctx.caller.roles,scopes:ctx.caller.scopes};}' } }) });
  assert(install.status === 201, 'fresh extension install ' + install.status + ' ' + JSON.stringify(install.body.error));
  assert((await json('/v1/extensions/' + EXT + '/activate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'activate');
  assert((await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'aggregate');
  const baseTool = { action_id: 'ext:' + EXT + ':echo', lockedInput: { op: 'get' },
    inputSchema: { type: 'object', properties: { op: { type: 'string' }, query: { type: 'string' } }, required: ['query'] } };
  const tools = [{ ...baseTool, name: 'free' }, { ...baseTool, name: 'zero', price: { morsels: 0 } },
    { ...baseTool, name: 'priced', price: { morsels: 5 } },
    { ...baseTool, name: 'usd', pricesMoney: [{ amount: 1000, currency: 'USD' }] },
    { ...baseTool, name: 'action-paid', action_id: 'ext:' + EXT + ':paid' }];
  for (const [filename, visibility] of [[FILE, 'public'], [PRIVATE_FILE, 'private']]) {
    const saved = await json('/v1/memory', { method: 'POST', headers: auth(seller.token),
      body: JSON.stringify({ key: 'apps.' + filename + '.tools', visibility, value: { version: 1, tools } }) });
    assert(saved.status === 201, 'fresh manifest ' + saved.status);
  }
  const rest = (name: string, input: Record<string, unknown>, filename = FILE) => json('/v1/apps/' + seller!.owner + '/' + filename + '/webmcp/tools/' + name,
    { method: 'POST', headers: auth(actor.token), body: JSON.stringify({ input }) });

  await test('REST and MCP invoke an unpriced sibling of a paid tool as the real agent', async () => {
    const input = { query: 'visible', op: 'forged' };
    const http = await rest('free', input), mcp = await invoke(agentSession, seller!, 'free', input);
    assert(http.status === 200, 'REST ' + http.status + ' ' + JSON.stringify(http.body.error));
    assert(!mcp.isError, 'MCP ' + mcp.text);
    const httpResult = echo(http.body.data), mcpResult = echo(mcp.data);
    assert(JSON.stringify(httpResult) === JSON.stringify(mcpResult), 'identical results from both surfaces');
    assert(mcpResult.caller === actor.gaii && mcpResult.owner === buyer.owner, 'consumer agent identity survives loopback');
    assert(mcpResult.roles.includes('agent') && !mcpResult.roles.includes('owner'), 'agent never becomes provider or owner');
    assert(mcpResult.scopes.includes('social:read') && !mcpResult.scopes.includes('memory:write'), 'scopes preserved');
    assert(mcpResult.input.op === 'get', 'locked input wins'); assert(mcp.data.metered === false, 'unpriced result is not metered');
  });
  await test('an explicit zero price also remains free', async () => {
    const result = await invoke(agentSession, seller!, 'zero', { query: 'zero' });
    assert(!result.isError && echo(result.data).input.query === 'zero', result.text);
  });
  await test('a private manifest is absent on both surfaces', async () => {
    const http = await rest('free', { query: 'secret' }, PRIVATE_FILE);
    const mcp = await invoke(agentSession, seller!, 'free', { query: 'secret' }, PRIVATE_FILE);
    assert(http.status === 404 && http.body.error.code === 'APP_TOOLS_NOT_FOUND', 'REST private refusal');
    assert(mcp.isError && mcp.text.startsWith('APP_TOOLS_NOT_FOUND:'), 'MCP private refusal: ' + mcp.text);
  });
  await test('missing input is refused before invocation on both surfaces', async () => {
    const http = await rest('free', {}), mcp = await invoke(agentSession, seller!, 'free');
    assert(http.status === 400 && http.body.error.code === 'INVALID_INPUT', 'REST input refusal');
    assert(mcp.isError && mcp.text.startsWith('INVALID_INPUT:'), 'MCP input refusal: ' + mcp.text);
  });
  await test('MCP caller without exchange:write cannot invoke even a free tool', async () => {
    const result = await invoke(limitedSession, seller!, 'free', { query: 'limited' });
    assert(result.isError && !result.data?.result, 'scope-limited agent must be refused');
  });
  for (const name of ['priced', 'usd']) await test(name + ' still requires a contract', async () => {
    const http = await rest(name, { query: 'paid' }), mcp = await invoke(agentSession, seller!, name, { query: 'paid' });
    assert(http.status === 402, 'REST paid refusal ' + http.status);
    assert(mcp.isError && mcp.text.startsWith('NO_CONTRACT:'), 'MCP paid refusal ' + mcp.text);
  });
  await test('a free tool cannot remove the backing action money price', async () => {
    const http = await rest('action-paid', { query: 'paid' }), mcp = await invoke(agentSession, seller!, 'action-paid', { query: 'paid' });
    assert(http.status === 402 && !http.body.data?.result, 'REST action price survives');
    assert(mcp.isError && mcp.text.startsWith('EXTENSION_ERROR:') && !mcp.data?.result, 'MCP action price survives: ' + mcp.text);
  });
  await test('deactivated extension is not reached through the free path', async () => {
    assert((await json('/v1/extensions/' + EXT + '/deactivate', { method: 'POST', headers: auth(seller!.token) })).status === 200, 'deactivate');
    const result = await invoke(agentSession, seller!, 'free', { query: 'inactive' });
    assert(result.isError && !result.data?.result, 'inactive extension refused');
  });
} catch (error) { failed++; console.error('Fixture failed: ' + (error as Error).message); }
finally {
  for (const current of sessions) if (current.sessionId) {
    await fetch(BASE + '/v1/mcp', { method: 'DELETE', headers: { ...auth(current.token), 'mcp-session-id': current.sessionId } }).catch(() => undefined);
  }
  if (seller) await deleteExtension(seller);
  for (const current of owners.reverse()) await test('fixture owner cleanup ' + current.owner, async () => {
    assert((await json('/v1/owners/' + current.owner, { method: 'DELETE', headers: auth(current.token) })).status === 200, 'owner cleanup');
  });
}
console.log(passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exitCode = failed ? 1 : 0;

/**
 * @file test/e2e-ai-embed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Embeddings end to end (System 2 plan, V5; docs/internal/llmproviderintegrations/09
 *   section 5, 11 section 7, 12): POST /v1/ai/embed against the fake provider with the owner's key,
 *   the owner's model policy applied to it, a fallback that moves only to the SAME model (vectors of
 *   two models cannot be compared), the limits of one call, aimeat_ai_embed over MCP, and a caller
 *   without ai:use refused.
 *
 *   Its own node on 40442, whose fixed provider types point at the fake provider.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-embed.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, providerStatus, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_EMBED_PORT ?? '40442';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-embed-'));
const DB_PATH = join(dbDir, 'ai-embed.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(stub: FakeAiProvider): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_OPENROUTER_INSTANCE_KEY: '', AIMEAT_MODEL_DEFAULT_EMBED: '',
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openai: `${stub.baseUrl}/openai`, openrouter: `${stub.baseUrl}/or` }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI embeddings node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

interface Owner { name: string; token: string }
async function setupOwner(label: string): Promise<Owner> {
  const name = `aiemb${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Embeddings', password: 'AiEmbeddings1234' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
  assert(tok.status === 200, `auth/token ${tok.status}`);
  return { name, token: tok.body.data.token as string };
}

async function connectAgent(owner: Owner, agentName: string, scopes: string[]): Promise<string> {
  const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
  assert(da.status === 200, `device-authorize ${da.status}`);
  const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }) });
  assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body?.error)}`);
  const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
  assert(t.status === 200, `device-token ${t.status}`);
  return t.body.token as string;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<any> {
  let session = '';
  const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
    const res = await fetch(`${BASE}/v1/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
        ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    session = res.headers.get('mcp-session-id') ?? session;
    const text = await res.text();
    const events = text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5).trim()));
    return (events.find((e: any) => e.id === id) ?? (events.length ? events[0] : JSON.parse(text))) as any;
  };
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-embed-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}

(async () => {
  console.log('\n── Embeddings (System 2, V5) ──');
  const stub = await startFakeAiProvider(0);
  const server = await startServer(stub);
  const at = (prefix: string) => (r: RecordedRequest) => r.pathname.startsWith(`/v1/${prefix}/`);

  try {
    const a = await setupOwner('a');
    const put = (o: Owner, id: string, body: Record<string, unknown>) => json(`/v1/ai/providers/${id}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const setKey = (o: Owner, id: string, key: string) => json(`/v1/ai/providers/${id}/key`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ api_key: key }) });
    const routing = (o: Owner, r: Record<string, unknown>) => json('/v1/ai/routing', { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ routing: r }) });
    const embed = (token: string, body: Record<string, unknown>) => json('/v1/ai/embed', { method: 'POST', headers: auth(token), body: JSON.stringify({ app_id: 'embed-e2e', ...body }) });

    assert((await put(a, 'e-openai', { title: 'E OpenAI', type: 'openai', capabilities: { embed: { enabled: true, model: 'text-embedding-3-small', pool: true } } })).status === 200, 'put e-openai');
    assert((await setKey(a, 'e-openai', 'sk-openai-embed')).status === 200, 'key');
    assert((await routing(a, { defaults: { embed: ['e-openai'] }, rules: { onlyTested: false } })).status === 200, 'routing');

    await test('1. two texts give two vectors from the owner\'s provider, with its key, and the model to store beside them', async () => {
      const r = await embed(a.token, { input: ['invoice late', 'payment not received'] });
      assert(r.status === 200, `embed ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const d = r.body.data;
      assert(d.embeddings.length === 2 && d.dimensions === 3 && d.model === 'text-embedding-3-small', `answer: ${JSON.stringify({ n: d.embeddings.length, dims: d.dimensions, model: d.model })}`);
      const sent = stub.lastRequest('embeddings');
      assert(sent?.headers.authorization === 'Bearer sk-openai-embed', `key sent: ${sent?.headers.authorization}`);
      assert(JSON.stringify(sent?.json?.input) === JSON.stringify(['invoice late', 'payment not received']) && sent?.json?.model === 'text-embedding-3-small', `request: ${sent?.body}`);
      assert(d.route.answeredBy.provider === 'e-openai' && d.usage.cost_exact === false && d.usage.cost_usd > 0, `route and cost: ${JSON.stringify({ route: d.route.answeredBy, usage: d.usage })}`);
    });

    await test('2. one string is one text', async () => {
      const r = await embed(a.token, { input: 'one text' });
      assert(r.status === 200 && r.body.data.embeddings.length === 1, `single: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('3. the owner\'s model policy applies: a list without an embedding model refuses the call', async () => {
      assert((await json('/v1/ai/policy', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ policy: { mode: 'custom', allow: ['openai:gpt-5.4'] } }) })).status === 200, 'policy');
      try {
        const r = await embed(a.token, { input: ['x'] });
        assert(r.status === 403 && r.body.error.code === 'AI_MODEL_NOT_ALLOWED', `refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const named = await embed(a.token, { input: ['x'], model: 'openai:text-embedding-3-small' });
        assert(named.status === 403 && named.body.error.code === 'AI_MODEL_NOT_ALLOWED', `named model refused: ${named.status}`);
      } finally {
        await json('/v1/ai/policy', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ policy: { mode: 'open' } }) });
      }
    });

    await test('4. a failing provider falls back only to the same model, never to another one', async () => {
      assert((await put(a, 'e-or', { title: 'E OpenRouter', type: 'openrouter', capabilities: { embed: { enabled: true, model: 'openai/text-embedding-3-large', pool: true } } })).status === 200, 'put e-or');
      assert((await setKey(a, 'e-or', 'sk-or-embed')).status === 200, 'key');
      assert((await routing(a, { defaults: { embed: ['e-openai', 'e-or'] } })).status === 200, 'routing');
      const orBefore = stub.requests.filter(at('or')).length;
      stub.queue('embeddings', providerStatus(503, '{"error":{"message":"down"}}'), at('openai'));
      const other = await embed(a.token, { input: ['x'] });
      assert(other.status === 502, `no fallback to another model: ${other.status} ${JSON.stringify(other.body?.data?.route ?? other.body?.error)}`);
      assert(stub.requests.filter(at('or')).length === orBefore, 'the other model was not called');
      assert((await put(a, 'e-or', { title: 'E OpenRouter', type: 'openrouter', capabilities: { embed: { enabled: true, model: 'openai/text-embedding-3-small', pool: true } } })).status === 200, 'same model on e-or');
      stub.queue('embeddings', providerStatus(503, '{"error":{"message":"down"}}'), at('openai'));
      const same = await embed(a.token, { input: ['x'] });
      assert(same.status === 200 && same.body.data.route.fellBack === true && same.body.data.route.answeredBy.provider === 'e-or', `fell back to the same model: ${JSON.stringify(same.body?.data?.route ?? same.body?.error)}`);
      await routing(a, { defaults: { embed: ['e-openai'] } });
    });

    // A provider's key refusal is 424 with the code INVALID_API_KEY: not 401, which says the caller's
    // own credential failed, and not 502, which clients retry (Jouni, 2026-10-07).
    await test('4b. a key the provider rejects is 424 INVALID_API_KEY, not 401', async () => {
      // Both providers serve the same model after test 4, so the call falls back once; both refuse.
      stub.queue('embeddings', providerStatus(401, '{"error":{"message":"User not found."}}'), at('openai'));
      stub.queue('embeddings', providerStatus(401, '{"error":{"message":"User not found."}}'), at('or'));
      const r = await embed(a.token, { input: ['x'] });
      assert(r.status === 424 && r.body.error?.code === 'INVALID_API_KEY', `a rejected key: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('5. the limits of one call, and an empty input, are refused before anything is sent', async () => {
      const before = stub.requestsFor('embeddings').length;
      const many = await embed(a.token, { input: Array.from({ length: 257 }, (_, i) => `t${i}`) });
      assert(many.status === 400 && many.body.error.code === 'INPUT_TOO_LARGE', `257 texts: ${many.status} ${JSON.stringify(many.body?.error)}`);
      const empty = await embed(a.token, { input: [] });
      assert(empty.status === 400 && empty.body.error.code === 'INVALID_BODY', `empty: ${empty.status}`);
      assert(stub.requestsFor('embeddings').length === before, 'nothing reached the provider');
    });

    await test('6. an agent embeds through aimeat_ai_embed; an agent without ai:use is refused', async () => {
      const agent = await connectAgent(a, 'embedder', ['ai:use']);
      const out = await mcpCall(agent, 'aimeat_ai_embed', { input: ['from the agent'] });
      const text = String(out?.result?.content?.[0]?.text ?? '');
      assert(!out?.result?.isError && JSON.parse(text).embeddings?.length === 1, `tool: ${text.slice(0, 200)}`);
      const reader = await connectAgent(a, 'reader', ['memory:read']);
      const refused = await embed(reader, { input: ['x'] });
      assert(refused.status === 403, `without ai:use: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    });
  } finally {
    await stopServer(server);
    await stub.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

/**
 * @file test/e2e-ai-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI providers and routing end to end (System 2 plan, V3; docs/internal/
 *   llmproviderintegrations/09 section 3 and 11 section 13): an owner's own providers with their own
 *   keys, the node's key bound to the node's own provider, the lazy migration of the legacy setting,
 *   capability routing with fallback and health.
 *
 *   One stub (test/helpers/fake-ai-provider.ts) stands in for every provider, each at its own path
 *   prefix, so a suite can read which provider a request reached and with which key. The fixed types
 *   (openrouter, anthropic, openai, mistral) are pointed at the stub with
 *   AIMEAT_AI_FIXED_BASEURL_OVERRIDES, which a node that is not public accepts.
 *
 *   PASS CRITERION (09, V3): an owner adds an Anthropic provider, sets its key and gets an answer
 *   from anthropic:claude-opus-5-5; e2e-ai-provider-stub passes unchanged on the legacy setting; the
 *   node's key never leaves for an owner's provider.
 * @structure
 *   - the node under test: the runner's backend, its own port, a node key, the fixed-type overrides
 *   - 1-9: the nine cases of 09 section 3 (4 is in test/unit/ai-providers.test.ts: a public node)
 *   - F1-F9: the cases of 11 section 13 that run over HTTP (F3, F7 and F10 are unit or V5)
 *   - R1-R3: the routing endpoint, the MCP tools and the deprecated routes
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-providers.ts
 * @version-history
 *   v1.1.0 — 2026-10-04 — 5b: both rounds of one /v1/llm conversation reach OpenRouter with one session_id.
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import {
  startFakeAiProvider, chatJson, sseChat, providerStatus, anthropicJson, anthropicToolCallStream,
  type FakeAiProvider, type RecordedRequest,
} from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

// Its own port, outside the 40251-up range sessions claim; the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_PROVIDERS_PORT ?? '40439';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const REDIRECT = 'http://localhost:9912/callback';
const NODE_KEY = 'sk-node-e2e-bound-to-node-openrouter';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-providers-'));
const DB_PATH = join(dbDir, 'ai-providers.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(stub: FakeAiProvider): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    // The node's own key, with an allowance, so a person with no provider is answered by it.
    AIMEAT_OPENROUTER_INSTANCE_KEY: NODE_KEY,
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
    AIMEAT_MODEL_DEFAULT_CHAT: 'stub/node-chat',
    // Every fixed type at its own path on the stub. Accepted because this node is not public.
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({
      openrouter: `${stub.baseUrl}/node-or`, anthropic: `${stub.baseUrl}/anthropic`,
      openai: `${stub.baseUrl}/openai`, mistral: `${stub.baseUrl}/mistral`,
    }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI providers node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

// ── principals ────────────────────────────────────────────────────────────────

interface Owner { name: string; gaii: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
  const name = `aiprov${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', {
    method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Providers', password: 'AiProviders1234' }),
  });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts),
    Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
  assert(tok.status === 200, `auth/token ${tok.status}`);
  return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function connectAgent(owner: Owner, agentName: string, scopes: string[]): Promise<string> {
  const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
  assert(da.status === 200, `device-authorize ${da.status}`);
  const v = await json('/v1/agents/verify', {
    method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
  });
  assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body?.error)}`);
  const t = await json('/v1/agents/device-token', {
    method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  assert(t.status === 200, `device-token ${t.status}`);
  return t.body.token as string;
}

async function appGrantToken(owner: Owner, filename: string): Promise<string> {
  const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="ai:use"></head><body>providers</body></html>';
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename, content: b64(html), name: `Providers ${filename}`, description: 'providers e2e probe', category: 'utility' }),
  });
  assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope: 'ai:use',
    redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
  assert(!!m, `consent redirect expected, got ${res.status}`);
  const con = await json('/v1/app-grants/authorize-consent', {
    method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
  });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', {
    method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
  });
  assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
  return tok.body.data.access_token as string;
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-providers-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}
const toolText = (r: any) => String(r?.result?.content?.[0]?.text ?? '');

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── AI providers and routing (System 2, V3) ──');
  const stub: FakeAiProvider = await startFakeAiProvider(0);
  // Every provider answers with where it was reached, so a test reads which one answered.
  stub.setDefault('chat', (r) => chatJson(`answered at ${r.pathname} by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
  const server = await startServer(stub);
  const at = (prefix: string) => (r: RecordedRequest) => r.pathname.startsWith(`/v1/${prefix}/`);
  const count = (prefix: string) => stub.requests.filter(at(prefix)).length;
  const bearer = (r: RecordedRequest | undefined) => r?.headers.authorization ?? '';

  try {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const put = (o: Owner, id: string, body: Record<string, unknown>) => json(`/v1/ai/providers/${id}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const setKey = (o: Owner, id: string, key: string) => json(`/v1/ai/providers/${id}/key`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ api_key: key }) });
    const complete = (o: Owner | string, body: Record<string, unknown>) => json('/v1/ai/complete', {
      method: 'POST', headers: auth(typeof o === 'string' ? o : o.token), body: JSON.stringify({ prompt: 'Say one word.', ...body }),
    });
    const testProv = (o: Owner, id: string) => json(`/v1/ai/providers/${id}/test`, { method: 'POST', headers: auth(o.token), body: JSON.stringify({}) });
    const routing = (o: Owner, r: Record<string, unknown>) => json('/v1/ai/routing', { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ routing: r }) });
    const compat = (id: string, model: string, pool = true, type = 'openai-compatible') =>
      ({ title: id, type, baseUrl: `${stub.baseUrl}/${id}`, auth: { type: 'none' }, capabilities: { text: { enabled: true, model, pool } } });

    await test('1. an owner adds an Anthropic provider, sets its key, and anthropic:claude-opus-5-5 answers with that key', async () => {
      const p = await put(a, 'my-anthropic', { title: 'My Anthropic', type: 'anthropic', capabilities: { text: { enabled: true, model: 'claude-opus-5-5' } } });
      assert(p.status === 200, `put ${p.status}: ${JSON.stringify(p.body?.error)}`);
      assert(p.body.data.provider.auth.has_key === false && !JSON.stringify(p.body).includes('sk-'), `no key yet, none shown: ${JSON.stringify(p.body.data.provider.auth)}`);
      const k = await setKey(a, 'my-anthropic', 'sk-ant-owner-a-key');
      assert(k.status === 200, `key ${k.status}: ${JSON.stringify(k.body?.error)}`);
      stub.queue('messages', anthropicJson('hei from claude', { model: 'claude-opus-5-5' }));
      const r = await complete(a, { model: 'anthropic:claude-opus-5-5' });
      assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(r.body.data.content === 'hei from claude', `content: ${r.body.data.content}`);
      assert(r.body.data.route?.answeredBy?.provider === 'my-anthropic' && r.body.data.route.chosenBy === 'call-model', `route: ${JSON.stringify(r.body.data.route)}`);
      const req = stub.lastRequest('messages');
      assert(req?.pathname === '/v1/anthropic/messages', `reached ${req?.pathname}`);
      assert(req?.headers['x-api-key'] === 'sk-ant-owner-a-key', `the owner's key, got ${req?.headers['x-api-key']}`);
      assert(req?.json?.model === 'claude-opus-5-5', `model sent: ${String(req?.json?.model)}`);
      assert(!JSON.stringify(req?.headers).includes(NODE_KEY), 'the node key is not on an owner\'s call');
    });

    await test('1b. OpenAI and Mistral providers answer on their own address with the owner\'s own key', async () => {
      for (const [id, type, key] of [['my-openai', 'openai', 'sk-oa-owner-a'], ['my-mistral', 'mistral', 'sk-mi-owner-a']] as const) {
        const p = await put(a, id, { title: id, type, capabilities: { text: { enabled: true, model: `${type}-stub-model` } } });
        assert(p.status === 200, `${id} put ${p.status}: ${JSON.stringify(p.body?.error)}`);
        assert((await setKey(a, id, key)).status === 200, `${id} key`);
        const r = await complete(a, { provider: id });
        assert(r.status === 200, `${id} complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const req = stub.requests.filter(at(type)).pop();
        assert(!!req && req.pathname === `/v1/${type}/chat/completions`, `${id} reached ${req?.pathname}`);
        assert(bearer(req) === `Bearer ${key}`, `${id} carried ${bearer(req)}`);
        assert(r.body.data.route.chosenBy === 'call-provider', `${id} chosen by the call: ${r.body.data.route.chosenBy}`);
      }
    });

    await test('5b. every round of one /v1/llm conversation reaches OpenRouter with the same session_id, so its prompt cache can hit', async () => {
      // OpenRouter keeps a conversation on one provider only after a cache hit unless the request names
      // a session_id; DeepSeek has several providers, and three agent requests measured on 2026-10-02 had
      // no cache hit in any round. The key is a hash: it names neither the person nor the content.
      const d = await setupOwner('d');
      const llm = (messages: unknown[]) => fetch(`${BASE}/v1/llm/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(d.token) },
        body: JSON.stringify({ messages }),
      });
      const opening = [{ role: 'system', content: 'You are a test agent.' }, { role: 'user', content: 'MARK-SESSION-ROUND-1' }];
      const r1 = await llm(opening);
      assert(r1.status === 200, `round 1: ${r1.status} ${await r1.clone().text()}`);
      const first = stub.requests.filter(at('node-or')).pop()?.json as any;
      const r2 = await llm([...opening, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'MARK-SESSION-ROUND-2' }]);
      assert(r2.status === 200, `round 2: ${r2.status}`);
      const second = stub.requests.filter(at('node-or')).pop()?.json as any;
      assert(typeof first?.session_id === 'string' && /^aimeat-[0-9a-f]{40}$/.test(first.session_id), `round 1 session_id: ${first?.session_id}`);
      assert(second?.session_id === first.session_id, `the same session_id on round 2: ${second?.session_id} vs ${first.session_id}`);
      assert(!first.session_id.includes(d.name), 'the session_id does not name the person');
    });

    await test('2. an Anthropic tool call streams through /v1/llm as OpenAI SSE frames', async () => {
      const t = await testProv(a, 'my-anthropic');
      assert(t.status === 200 && t.body.data.ok === true, `test ${t.status}: ${JSON.stringify(t.body?.error)}`);
      const rt = await routing(a, { defaults: { text: ['my-anthropic'] } });
      assert(rt.status === 200 && rt.body.data.mode === 'applied', `routing ${rt.status}: ${JSON.stringify(rt.body?.error)}`);
      stub.queue('messages', anthropicToolCallStream({ id: 'toolu_e2e1', name: 'get_weather', argsChunks: ['{"ci', 'ty":"Oulu"}'] }).reply);
      const res = await fetch(`${BASE}/v1/llm/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(a.token) },
        body: JSON.stringify({
          stream: true, messages: [{ role: 'user', content: 'Weather in Oulu?' }],
          tools: [{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
        }),
      });
      assert(res.status === 200, `proxy ${res.status}: ${await res.clone().text()}`);
      const text = await res.text();
      const frames = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
      assert(frames[frames.length - 1] === '[DONE]', `ends with [DONE]: ${frames.slice(-2).join(' | ')}`);
      const chunks = frames.filter(f => f !== '[DONE]').map(f => JSON.parse(f));
      const calls = chunks.flatMap(c => c.choices?.[0]?.delta?.tool_calls ?? []);
      assert(calls[0]?.id === 'toolu_e2e1' && calls[0]?.function?.name === 'get_weather', `first tool frame: ${JSON.stringify(calls[0])}`);
      const args = calls.map((c: any) => c.function?.arguments ?? '').join('');
      assert(args === '{"city":"Oulu"}', `arguments joined: ${args}`);
      assert(chunks.some(c => c.choices?.[0]?.finish_reason === 'tool_calls'), 'finish_reason tool_calls');
      const sent = stub.lastRequest('messages')?.json as any;
      assert(Array.isArray(sent?.tools) && sent.tools[0]?.name === 'get_weather' && !!sent.tools[0]?.input_schema, `Anthropic got the tool: ${JSON.stringify(sent?.tools)}`);
    });

    await test('3. an owner\'s local provider at a remote address is refused, naming why', async () => {
      const r = await put(a, 'bad-local', { title: 'x', type: 'local', baseUrl: 'https://models.example.com/v1', auth: { type: 'none' } });
      assert(r.status === 400 && r.body.error?.code === 'INVALID_PROVIDER', `got ${r.status} ${r.body.error?.code}`);
      assert(/somewhere else/.test(r.body.error.message), `the reason: ${r.body.error.message}`);
      const env = await put(a, 'env-key', { title: 'x', type: 'openai-compatible', baseUrl: `${stub.baseUrl}/x`, auth: { type: 'env', env: 'AIMEAT_OPENROUTER_INSTANCE_KEY' } });
      assert(env.status === 400, `an owner cannot name a variable of the node as their key: ${env.status}`);
      const moved = await put(a, 'moved-anthropic', { title: 'x', type: 'anthropic', baseUrl: `${stub.baseUrl}/elsewhere` });
      assert(moved.status === 400 && /reached at https:\/\/api\.anthropic\.com/.test(moved.body.error?.message ?? ''), `a fixed type keeps its address: ${moved.status} ${moved.body.error?.message}`);
    });

    await test('5. the node\'s key goes only to the node\'s own provider, never to an owner\'s', async () => {
      const c = await setupOwner('c');
      const r = await complete(c, {});
      assert(r.status === 200, `c on the node key: ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(r.body.data.route.answeredBy.provider === 'node-openrouter', `answered by ${JSON.stringify(r.body.data.route.answeredBy)}`);
      const nodeReq = stub.requests.filter(at('node-or')).pop();
      assert(bearer(nodeReq) === `Bearer ${NODE_KEY}`, `the node key reached the node provider: ${bearer(nodeReq)}`);
      assert(r.body.data.route && JSON.stringify(r.body.data).includes('node-openrouter') && !JSON.stringify(r.body).includes(NODE_KEY), 'the key is never in an answer');
      const p = await put(c, 'c-own', compat('c-own', 'stub/c-own'));
      assert(p.status === 200, `c-own ${p.status}`);
      const own = await complete(c, { provider: 'c-own' });
      assert(own.status === 200, `c-own call ${own.status}: ${JSON.stringify(own.body?.error)}`);
      const ownReq = stub.requests.filter(at('c-own')).pop();
      assert(!!ownReq && !ownReq.headers.authorization, `a keyless owner provider gets no Authorization at all: ${bearer(ownReq)}`);
      const leaked = stub.requests.filter(q => JSON.stringify(q.headers).includes(NODE_KEY) && !at('node-or')(q));
      assert(leaked.length === 0, `the node key reached ${leaked.map(q => q.pathname).join(', ')}`);
    });

    await test('6. a provider key is never readable or writable through the general memory endpoints', async () => {
      const read = await json('/v1/memory/ai.apikey.provider.my-anthropic', { headers: auth(a.token) });
      assert(read.status === 200 && !JSON.stringify(read.body).includes('encrypted'), `read shows no ciphertext: ${JSON.stringify(read.body?.data?.value ?? read.body)}`);
      const list = await json('/v1/memory?prefix=ai.apikey.', { headers: auth(a.token) });
      assert(!JSON.stringify(list.body).includes('"encrypted"'), 'a listing shows no ciphertext');
      const w = await json('/v1/memory/ai.apikey.provider.my-anthropic', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ value: { encrypted: 'x' }, version: 1 }) });
      assert(w.status === 403 && w.body.error?.code === 'SECRET_RECORD', `owner PUT refused: ${w.status} ${w.body.error?.code}`);
      // An app cannot write a provider record into the owner's namespace; an agent's own memory write
      // lands in the agent's namespace, which the node never reads providers from.
      const appToken = await appGrantToken(a, 'providers-memory.html');
      const byApp = await json('/v1/memory', { method: 'POST', headers: auth(appToken), body: JSON.stringify({ key: 'ai.providers.evil', value: { type: 'openai-compatible', baseUrl: 'https://evil.example/v1' }, visibility: 'private' }) });
      assert(byApp.status === 403, `an app writing a provider record: ${byApp.status}`);
      const agent = await connectAgent(a, `aiprovag${Date.now()}`, ['ai:use', 'memory:write']);
      await json('/v1/memory', { method: 'POST', headers: auth(agent), body: JSON.stringify({ key: 'ai.providers.evil', value: { type: 'openai-compatible', baseUrl: 'https://evil.example/v1' }, visibility: 'private' }) });
      const list2 = await json('/v1/ai/providers', { headers: auth(a.token) });
      assert(!JSON.stringify(list2.body).includes('evil'), 'no memory write made a provider of the owner\'s');
    });

    await test('7. another owner neither sees nor uses nor deletes these providers; agents and apps cannot change them', async () => {
      const list = await json('/v1/ai/providers', { headers: auth(b.token) });
      assert(list.status === 200 && !JSON.stringify(list.body).includes('my-anthropic'), 'b does not see a\'s providers');
      const use = await complete(b, { provider: 'my-anthropic' });
      assert(use.status === 400 && use.body.error?.code === 'AI_PROVIDER_NOT_CONFIGURED', `b naming it: ${use.status} ${use.body.error?.code}`);
      const del = await json('/v1/ai/providers/my-anthropic', { method: 'DELETE', headers: auth(b.token) });
      assert(del.status === 404, `b deleting it: ${del.status}`);
      const agent = await connectAgent(a, `aiprovadm${Date.now()}`, ['ai:use', 'memory:write-reserved']);
      const byAgent = await json('/v1/ai/providers/x-agent', { method: 'PUT', headers: auth(agent), body: JSON.stringify(compat('x-agent', 'm')) });
      assert(byAgent.status === 403, `an agent adding a provider: ${byAgent.status}`);
      const keyByAgent = await json('/v1/ai/providers/my-anthropic/key', { method: 'PUT', headers: auth(agent), body: JSON.stringify({ api_key: 'sk-evil-agent' }) });
      assert(keyByAgent.status === 403, `an agent setting a key: ${keyByAgent.status}`);
      const appToken = await appGrantToken(a, 'providers-grant.html');
      const byApp = await json('/v1/ai/routing', { method: 'PUT', headers: auth(appToken), body: JSON.stringify({ routing: { defaults: { text: ['my-openai'] } } }) });
      assert(byApp.status === 403, `an app changing the routing: ${byApp.status}`);
      const still = await json('/v1/ai/providers', { headers: auth(a.token) });
      assert(still.body.data.providers.some((p: any) => p.id === 'my-anthropic'), 'a\'s provider is still there');
    });

    await test('8. the legacy setting becomes a provider record on the first read, the legacy record stays, and edits follow', async () => {
      const m = await setupOwner('m');
      const s = await json('/v1/memory', {
        method: 'POST', headers: auth(m.token),
        body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: `${stub.baseUrl}/legacy`, model: 'stub/legacy-one', daily_budget_usd: 50 } }),
      });
      assert(s.status === 201, `legacy settings ${s.status}`);
      const list = await json('/v1/ai/providers', { headers: auth(m.token) });
      const mig = list.body.data.providers.find((p: any) => p.id === 'custom');
      assert(!!mig && mig.type === 'openai-compatible' && mig.migrated_from === 'openrouter.settings', `migrated: ${JSON.stringify(mig)}`);
      assert(mig.health?.text?.status === 'ok', `a migrated provider starts as working: ${JSON.stringify(mig.health)}`);
      const legacy = await json('/v1/memory/openrouter.settings', { headers: auth(m.token) });
      assert(legacy.status === 200 && legacy.body.data.value.model === 'stub/legacy-one', 'the legacy record is still there');
      const r = await complete(m, {});
      assert(r.status === 200 && stub.requests.filter(at('legacy')).pop()?.json?.model === 'stub/legacy-one', `answered on the legacy setting: ${r.status} ${JSON.stringify(r.body?.error)}`);
      const edit = await json('/v1/openrouter/settings', { method: 'PUT', headers: auth(m.token), body: JSON.stringify({ provider: 'custom', baseUrl: `${stub.baseUrl}/legacy`, model: 'stub/legacy-two' }) });
      assert(edit.status === 200, `legacy edit ${edit.status}`);
      const r2 = await complete(m, {});
      assert(r2.status === 200 && stub.requests.filter(at('legacy')).pop()?.json?.model === 'stub/legacy-two', 'the migrated provider follows the legacy edit');
    });

    // ── routing, fallback and health (plan 11, section 13) ──
    const d = await setupOwner('d');
    for (const [id, model] of [['p-one', 'stub/one'], ['p-two', 'stub/two']] as const) {
      assert((await put(d, id, compat(id, model))).status === 200, `put ${id}`);
    }

    await test('F8. a provider the node may not pick by capability alone is never picked so, but answers when named', async () => {
      const g = await setupOwner('g');
      assert((await put(g, 'nopool', compat('nopool', 'stub/np', false))).status === 200, 'put nopool');
      assert((await testProv(g, 'nopool')).status === 200, 'test nopool');
      const byCap = await complete(g, {});
      assert(byCap.status === 200 && byCap.body.data.route.answeredBy.provider === 'node-openrouter', `capability only: ${JSON.stringify(byCap.body.data?.route ?? byCap.body.error)}`);
      const named = await complete(g, { provider: 'nopool' });
      assert(named.status === 200 && named.body.data.route.answeredBy.provider === 'nopool', `named: ${JSON.stringify(named.body.data?.route)}`);
    });

    await test('F0. an untested provider is not picked by capability alone; a test makes it eligible', async () => {
      const before = count('p-one') + count('p-two');
      const r = await complete(d, {});
      assert(r.status === 400 && r.body.error?.code === 'AI_CAPABILITY_UNAVAILABLE', `untested: ${r.status} ${r.body.error?.code}`);
      assert(r.body.error.details.rejected.every((x: any) => x.reason === 'untested'), `reasons: ${JSON.stringify(r.body.error.details.rejected)}`);
      assert(count('p-one') + count('p-two') === before, 'nothing was sent');
      for (const id of ['p-one', 'p-two']) {
        const t = await testProv(d, id);
        assert(t.status === 200 && t.body.data.ok === true && typeof t.body.data.latency_ms === 'number', `test ${id}: ${JSON.stringify(t.body?.error ?? t.body.data)}`);
      }
      const rt = await routing(d, { defaults: { text: ['p-one', 'p-two'] } });
      assert(rt.status === 200, `routing ${rt.status}`);
    });

    await test('F1. the first provider answers 503, the second answers; route.fellBack and two usage rows', async () => {
      const usageBefore = (await json('/v1/ai/usage', { headers: auth(d.token) })).body.data.total_calls;
      stub.queue('chat', providerStatus(503, '{"error":{"message":"overloaded"}}'), at('p-one'));
      const r = await complete(d, {});
      assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(r.body.data.route.fellBack === true && r.body.data.route.answeredBy.provider === 'p-two', `route: ${JSON.stringify(r.body.data.route)}`);
      assert(r.body.data.route.attempts[0].provider === 'p-one' && r.body.data.route.attempts[0].error === 'unavailable', `attempt 1: ${JSON.stringify(r.body.data.route.attempts[0])}`);
      const usageAfter = (await json('/v1/ai/usage', { headers: auth(d.token) })).body.data.total_calls;
      assert(usageAfter - usageBefore === 2, `two usage rows, got ${usageAfter - usageBefore}`);
    });

    await test('F2. a content refusal is returned, never tried on the next provider', async () => {
      const twoBefore = count('p-two');
      stub.queue('chat', providerStatus(403, '{"error":{"message":"Your input was flagged by the moderation system","code":403}}'), at('p-one'));
      const r = await complete(d, {});
      assert(r.status >= 400, `refused: ${r.status}`);
      assert(count('p-two') === twoBefore, 'the second provider was not asked');
      const h = (await json('/v1/ai/providers', { headers: auth(d.token) })).body.data.providers.find((p: any) => p.id === 'p-one');
      assert(h.health.text.status !== 'failing', `a content refusal says nothing about health: ${JSON.stringify(h.health)}`);
    });

    await test('F5. three failures in a row mark the capability failing, and the next call skips it', async () => {
      // A passing test first, so the count starts from working (F1 left one failure on it).
      assert((await testProv(d, 'p-one')).status === 200, 'test p-one');
      for (let i = 0; i < 3; i++) {
        stub.queue('chat', providerStatus(502, '{"error":{"message":"bad gateway"}}'), at('p-one'));
        const r = await complete(d, {});
        assert(r.status === 200 && r.body.data.route.answeredBy.provider === 'p-two' && r.body.data.route.attempts.length === 2,
          `call ${i + 1} tried p-one and fell back: ${JSON.stringify(r.body.data?.route ?? r.body.error)}`);
      }
      const oneBefore = count('p-one');
      const r = await complete(d, {});
      assert(r.status === 200 && r.body.data.route.attempts.length === 1 && r.body.data.route.answeredBy.provider === 'p-two', `skipped: ${JSON.stringify(r.body.data?.route)}`);
      assert(count('p-one') === oneBefore, 'the failing provider was not called');
      const h = (await json('/v1/ai/providers', { headers: auth(d.token) })).body.data.providers.find((p: any) => p.id === 'p-one');
      assert(h.health.text.status === 'failing', `recorded: ${JSON.stringify(h.health)}`);
    });

    await test('F4. a fallback from a local provider does not send the data off this machine', async () => {
      const f = await setupOwner('f');
      assert((await put(f, 'loc', { ...compat('loc', 'stub/loc'), type: 'local' })).status === 200, 'put loc');
      assert((await put(f, 'away', compat('away', 'stub/away'))).status === 200, 'put away');
      for (const id of ['loc', 'away']) assert((await testProv(f, id)).status === 200, `test ${id}`);
      assert((await routing(f, { defaults: { text: ['loc', 'away'] } })).status === 200, 'routing');
      const awayBefore = count('away');
      stub.queue('chat', providerStatus(503, '{"error":{"message":"down"}}'), at('loc'));
      const r = await complete(f, {});
      assert(r.status === 502, `no fallback, the failure is the answer: ${r.status} ${r.body.error?.code}`);
      assert(count('away') === awayBefore, 'the provider outside this machine was not asked');
    });

    await test('F6. a refused key marks the provider failing at once; a passing test makes it work again', async () => {
      const q = await setupOwner('q');
      for (const [id, m] of [['q-one', 'stub/q1'], ['q-two', 'stub/q2']] as const) {
        assert((await put(q, id, compat(id, m))).status === 200, `put ${id}`);
        assert((await testProv(q, id)).status === 200, `test ${id}`);
      }
      assert((await routing(q, { defaults: { text: ['q-one', 'q-two'] } })).status === 200, 'routing');
      stub.queue('chat', providerStatus(401, '{"error":{"message":"invalid key"}}'), at('q-one'));
      const r = await complete(q, {});
      assert(r.status === 200 && r.body.data.route.answeredBy.provider === 'q-two' && r.body.data.route.attempts[0].error === 'auth', `fell back on auth: ${JSON.stringify(r.body.data?.route)}`);
      const oneBefore = count('q-one');
      const r2 = await complete(q, {});
      assert(r2.status === 200 && r2.body.data.route.answeredBy.provider === 'q-two' && count('q-one') === oneBefore, 'skipped after one refused key');
      assert((await testProv(q, 'q-one')).status === 200, 'the owner tests it again');
      const r3 = await complete(q, {});
      assert(r3.status === 200 && r3.body.data.route.answeredBy.provider === 'q-one', `works again: ${JSON.stringify(r3.body.data?.route)}`);
    });

    await test('F9. a stream that breaks after its first byte is not moved to another provider', async () => {
      const q2 = await setupOwner('s');
      for (const [id, m] of [['s-one', 'stub/s1'], ['s-two', 'stub/s2']] as const) {
        assert((await put(q2, id, compat(id, m))).status === 200, `put ${id}`);
        assert((await testProv(q2, id)).status === 200, `test ${id}`);
      }
      assert((await routing(q2, { defaults: { text: ['s-one', 's-two'] } })).status === 200, 'routing');
      const twoBefore = count('s-two');
      // One frame and then the end, with no [DONE]: the provider broke off mid-answer.
      const partial = sseChat(['Hel'], { model: 'stub/s1' }).body.split('data: [DONE]')[0];
      stub.queue('chat', { kind: 'sse', body: partial }, at('s-one'));
      const res = await fetch(`${BASE}/v1/llm/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(q2.token) },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      });
      const text = await res.text();
      assert(res.status === 200 && text.includes('Hel'), `the part that came was passed on: ${res.status}`);
      assert(count('s-two') === twoBefore, 'the second provider was not asked');
    });

    // ── the routing endpoint, the MCP tools, the deprecated routes ──

    await test('R1. the routing refuses a provider the owner cannot use, and keeps the rules the owner set', async () => {
      const bad = await routing(d, { defaults: { text: ['not-a-provider'] } });
      assert(bad.status === 400 && bad.body.error?.code === 'AI_ROUTING_INVALID', `unknown id: ${bad.status} ${bad.body.error?.code}`);
      const rules = await routing(d, { rules: { maxAttempts: 2, fallbackMayLeaveMachine: false } });
      assert(rules.status === 200 && rules.body.data.routing.owner.rules.maxAttempts === 2, `rules: ${JSON.stringify(rules.body.data?.routing?.owner?.rules)}`);
      const read = await json('/v1/ai/routing', { headers: auth(d.token) });
      assert(JSON.stringify(read.body.data.routing.defaults.text) === JSON.stringify(['p-one', 'p-two']), `defaults kept: ${JSON.stringify(read.body.data.routing.defaults)}`);
    });

    await test('R2. over MCP an agent lists providers without a key, tests one, and proposes a routing change it must confirm', async () => {
      const agent = await connectAgent(d, `aiprovmcp${Date.now()}`, ['ai:use', 'memory:write-reserved']);
      const list = toolText(await mcpCall(agent, 'aimeat_ai_providers', {}));
      assert(list.includes('p-one') && !/sk-[a-z]/.test(list), `listed, no key: ${list.slice(0, 200)}`);
      const t = JSON.parse(toolText(await mcpCall(agent, 'aimeat_ai_provider_test', { provider: 'p-two' })));
      assert(t.ok === true && t.provider === 'p-two', `tested: ${JSON.stringify(t)}`);
      const proposal = JSON.parse(toolText(await mcpCall(agent, 'aimeat_ai_routing_set', { routing: { defaults: { text: ['p-two'] } } })));
      assert(proposal.mode === 'proposal' && typeof proposal.confirm_token === 'string', `proposal: ${JSON.stringify(proposal).slice(0, 200)}`);
      const between = await json('/v1/ai/routing', { headers: auth(d.token) });
      assert(JSON.stringify(between.body.data.routing.defaults.text) === JSON.stringify(['p-one', 'p-two']), 'nothing changed before the confirmation');
      const applied = JSON.parse(toolText(await mcpCall(agent, 'aimeat_ai_routing_set', { routing: { defaults: { text: ['p-two'] } }, confirm_token: proposal.confirm_token })));
      assert(applied.mode === 'applied', `applied: ${JSON.stringify(applied).slice(0, 200)}`);
      const after = await json('/v1/ai/routing', { headers: auth(d.token) });
      assert(JSON.stringify(after.body.data.routing.defaults.text) === JSON.stringify(['p-two']), `in force: ${JSON.stringify(after.body.data.routing.defaults)}`);
    });

    await test('R3. the settings routes from before providers say they are deprecated, with their successor and removal', async () => {
      const r = await json('/v1/openrouter/settings', { headers: auth(d.token) });
      assert(r.status === 200, `still answers: ${r.status}`);
      assert(r.headers.get('deprecation') === 'true' && r.headers.get('x-aimeat-removed-in') === '4.0.0', `headers: ${r.headers.get('deprecation')} ${r.headers.get('x-aimeat-removed-in')}`);
      assert((r.headers.get('link') ?? '').includes('/v1/ai/providers'), `successor: ${r.headers.get('link')}`);
    });
  } finally {
    await stopServer(server);
    await stub.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

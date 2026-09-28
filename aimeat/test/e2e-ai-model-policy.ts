/**
 * @file test/e2e-ai-model-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model policy end to end (System 2 plan, V2; docs/internal/llmproviderintegrations/
 *   05 and 09 section 2): which models an owner's AI calls may use, and what the node does when a
 *   call names one the rules leave out.
 *
 *   Against the OpenAI-compatible stub (test/helpers/fake-ai-provider.ts), so a call that is allowed
 *   really reaches a provider and the suite can read which model the node sent. The node gets a
 *   recommended list through AIMEAT_AI_RECOMMENDED_MODELS, the way an operator sets it, and the
 *   owners are aimed at the stub with the one settings record a person writes.
 *
 *   PASS CRITERION (09, V2): an owner turns the recommended models on, and an app naming
 *   openai/gpt-4o-mini gets 403 AI_MODEL_NOT_ALLOWED listing the allowed models, while the same call
 *   without a model is answered by a recommended model with policy_chose_model: true.
 * @structure
 *   - the node under test: the runner's backend, its own port, a recommended list, a node key
 *   - 1-11: the eleven cases of 09 section 2, in that order
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-model-policy.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
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
  startFakeAiProvider, chatJson, modelsJson, type FakeAiProvider,
} from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

// Its own port, outside the 40251-up range sessions claim; the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_MODEL_POLICY_PORT ?? '40438';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const REDIRECT = 'http://localhost:9912/callback';

const OPUS_OR = 'openrouter:anthropic/claude-opus-5.5';
const GOOD = 'openai-compatible:stub/good-model';
const SECOND = 'openai-compatible:stub/second-model';
const RECOMMENDED = { text: [OPUS_OR, GOOD, SECOND], image: ['openai-compatible:stub/image-model'] };

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
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-model-policy-'));
const DB_PATH = join(dbDir, 'model-policy.db');
// The runner's backend when it names Postgres (the production store), a temporary SQLite file otherwise.
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    // The stub lives on loopback, which outbound validation refuses on a public node and must.
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    // What an operator sets: the recommended models, per capability, in order.
    AIMEAT_AI_RECOMMENDED_MODELS: JSON.stringify(RECOMMENDED),
    // Case 7: a node key with no allowance, so the key is chosen and found spent, never called.
    AIMEAT_OPENROUTER_INSTANCE_KEY: 'sk-node-e2e-never-sent',
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '0',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the model-policy node' });
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
  const name = `mpol${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', {
    method: 'POST', body: JSON.stringify({ username: name, display_name: 'Model Policy', password: 'ModelPolicy1234' }),
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

async function publish(owner: Owner, filename: string, meta = ''): Promise<any> {
  const html = `<!DOCTYPE html><html><head>${meta}<meta name="aimeat-scopes" content="ai:use"></head><body>policy</body></html>`;
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename, content: b64(html), name: `Policy ${filename}`, description: 'model policy e2e probe', category: 'utility' }),
  });
  assert(pub.status === 201, `publish ${filename} ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  return pub.body.data;
}

/** An app-grant token for an already published app, with ai:use: the app as the node identifies it. */
async function appGrantToken(owner: Owner, filename: string): Promise<string> {
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

/** One MCP tools/call as the holder of `token`: a session, then the call. */
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'model-policy-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}
const toolJson = (r: any) => JSON.parse(r?.result?.content?.[0]?.text ?? '{}');

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── The model policy (System 2, V2) ──');
  const provider: FakeAiProvider = await startFakeAiProvider(0);
  provider.setDefault('chat', (r) => chatJson(`answered by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
  provider.setDefault('models', modelsJson([{ id: 'stub/good-model' }, { id: 'stub/second-model' }, { id: 'stub/cheap-model' }]));
  const server = await startServer();
  const sentModel = () => String(provider.lastRequest('chat')?.json?.model);

  try {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const c = await setupOwner('c');
    for (const o of [a, b]) {
      const s = await json('/v1/memory', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: provider.baseUrl, model: 'stub/owner-model', daily_budget_usd: 50 } }),
      });
      assert(s.status === 201, `settings ${s.status}: ${JSON.stringify(s.body?.error)}`);
    }
    const complete = (o: Owner | string, body: Record<string, unknown>) => json('/v1/ai/complete', {
      method: 'POST', headers: auth(typeof o === 'string' ? o : o.token), body: JSON.stringify({ prompt: 'Say one word.', ...body }),
    });
    const setPolicy = (o: Owner, policy: Record<string, unknown>) => json('/v1/ai/policy', {
      method: 'PUT', headers: auth(o.token), body: JSON.stringify({ policy }),
    });

    await test('1. open: nothing is restricted, and a named model reaches the provider as named', async () => {
      const r = await complete(a, { model: 'openai/gpt-4o-mini' });
      assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentModel() === 'openai/gpt-4o-mini', `the provider saw ${sentModel()}`);
      assert(r.body.data.policy_chose_model === undefined, 'no policy, no policy choice');
    });

    await test('2. recommended: a named model outside the list is 403 AI_MODEL_NOT_ALLOWED, naming the allowed models', async () => {
      const s = await setPolicy(a, { mode: 'recommended' });
      assert(s.status === 200 && s.body.data.mode === 'applied', `the owner applies it at once: ${s.status} ${JSON.stringify(s.body?.data ?? s.body?.error)}`);
      const before = provider.requestsFor('chat').length;
      const r = await complete(a, { model: 'openai/gpt-4o-mini', app_id: 'policy-e2e' });
      assert(r.status === 403 && r.body.error?.code === 'AI_MODEL_NOT_ALLOWED', `got ${r.status} ${r.body.error?.code}`);
      const d = r.body.error.details;
      assert(Array.isArray(d?.allowed) && d.allowed.includes(GOOD) && d.allowed.includes(SECOND), `allowed is listed: ${JSON.stringify(d?.allowed)}`);
      assert(d.layer === 'owner' && d.source === 'recommended', `the layer that refused: ${d.layer}/${d.source}`);
      assert(d.next?.url === '/v1/ai/policy', `next points somewhere to read: ${JSON.stringify(d.next)}`);
      assert(provider.requestsFor('chat').length === before, 'a refused call never reaches the provider');
      const prefixed = await complete(a, { model: SECOND });
      assert(prefixed.status === 200 && sentModel() === 'stub/second-model', `an allowed reference is sent as the bare id: ${prefixed.status} ${sentModel()}`);
    });

    await test('3. recommended: the owner\'s own model is not allowed, so the node chooses the first allowed one and says so', async () => {
      const r = await complete(a, {});
      assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentModel() === 'stub/good-model', `the first recommended model the owner's provider reaches, got ${sentModel()}`);
      assert(r.body.data.policy_chose_model === true, `policy_chose_model: ${JSON.stringify(r.body.data)}`);
    });

    await test('4. an app\'s own list binds it: a model outside it is 403 at the app layer', async () => {
      const pub = await publish(a, 'policy-meta.html', `<meta name="aimeat-ai" content="generates=text; discloses=yes; models=${SECOND}">`);
      assert(JSON.stringify(pub.ai_posture?.models) === JSON.stringify([SECOND]), `the list is on the posture: ${JSON.stringify(pub.ai_posture)}`);
      const r = await complete(a, { model: 'stub/good-model', app_id: `${a.name}/policy-meta.html` });
      assert(r.status === 403 && r.body.error?.code === 'AI_MODEL_NOT_ALLOWED', `got ${r.status} ${r.body.error?.code}`);
      assert(r.body.error.details.layer === 'app' && r.body.error.details.source === 'app-meta', `layer ${JSON.stringify(r.body.error.details)}`);
      const free = await complete(a, { app_id: `${a.name}/policy-meta.html` });
      assert(free.status === 200 && sentModel() === 'stub/second-model', `without a model, the one both allow: ${free.status} ${sentModel()}`);
    });

    await test('5. an app\'s list and the owner\'s with nothing in common: 403 AI_MODEL_POLICY_EMPTY naming both', async () => {
      await publish(a, 'policy-conflict.html', '<meta name="aimeat-ai" content="generates=text; models=openai-compatible:stub/other-model">');
      const r = await complete(a, { app_id: `${a.name}/policy-conflict.html` });
      assert(r.status === 403 && r.body.error?.code === 'AI_MODEL_POLICY_EMPTY', `got ${r.status} ${r.body.error?.code}`);
      assert(r.body.error.details.layers?.length === 2, `both lists are named: ${JSON.stringify(r.body.error.details.layers)}`);
    });

    await test('6. an unreadable models= entry still publishes, is left out, and is named in a hint', async () => {
      const pub = await publish(a, 'policy-bad.html', `<meta name="aimeat-ai" content="generates=text; models=claude-opus,${GOOD}">`);
      assert(JSON.stringify(pub.ai_posture?.models) === JSON.stringify([GOOD]), `the good entry stays: ${JSON.stringify(pub.ai_posture?.models)}`);
      assert((pub.ai_hints ?? []).some((h: string) => h.includes('claude-opus')), `the hint names it: ${JSON.stringify(pub.ai_hints)}`);
    });

    await test('7. the node\'s allowance is spent and the free model is not allowed: 402, never a weaker model', async () => {
      // Owner c has no key and no settings: OpenRouter's own address, the node's key, no allowance.
      const s = await setPolicy(c, { mode: 'recommended' });
      assert(s.status === 200, `policy ${s.status}`);
      const before = provider.requests.length;
      const r = await complete(c, {});
      assert(r.status === 402 && r.body.error?.code === 'QUOTA_EXHAUSTED', `got ${r.status} ${r.body.error?.code}: ${r.body.error?.message}`);
      assert(/model policy/.test(r.body.error.message), `the reason names the policy: ${r.body.error.message}`);
      assert(provider.requests.length === before, 'nothing was sent anywhere');
    });

    await test('8. /v1/llm: the model the node chooses obeys the policy, and the model list shows only allowed ones', async () => {
      const list = await json('/v1/llm/models', { headers: auth(a.token) });
      assert(list.status === 200, `models ${list.status}`);
      const ids = (list.body.data as Array<{ id: string }>).map(m => m.id).sort();
      assert(JSON.stringify(ids) === JSON.stringify(['stub/good-model', 'stub/second-model']), `only allowed models: ${JSON.stringify(ids)}`);
      const r = await json('/v1/llm/chat/completions', {
        method: 'POST', headers: auth(a.token),
        body: JSON.stringify({ model: 'stub/cheap-model', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert(r.status === 200, `proxy ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentModel() === 'stub/good-model', `the node's choice, under the policy: ${sentModel()}`);
    });

    await test('9. another owner neither reads nor is bound by this policy, and no app or plain agent can change it', async () => {
      const bp = await json('/v1/ai/policy', { headers: auth(b.token) });
      assert(bp.status === 200 && bp.body.data.policy.mode === 'open', `b reads its own policy: ${JSON.stringify(bp.body.data?.policy)}`);
      const r = await complete(b, { model: 'openai/gpt-4o-mini' });
      assert(r.status === 200, `a's policy does not bind b: ${r.status}`);
      await publish(a, 'policy-grant.html');
      const appToken = await appGrantToken(a, 'policy-grant.html');
      const byApp = await json('/v1/ai/policy', { method: 'PUT', headers: auth(appToken), body: JSON.stringify({ policy: { mode: 'open' } }) });
      // The scope middleware or the route's own owner test, whichever an app meets first: both refuse.
      assert(byApp.status === 403 && ['OWNER_ONLY', 'SCOPE_DENIED'].includes(byApp.body.error?.code), `an app: ${byApp.status} ${byApp.body.error?.code}`);
      const viaMemory = await json('/v1/memory', {
        method: 'POST', headers: auth(appToken), body: JSON.stringify({ key: 'ai.policy.models', value: { mode: 'open' }, visibility: 'private' }),
      });
      assert(viaMemory.status === 403, `an app writing the record directly: ${viaMemory.status}`);
      const plain = await connectAgent(a, `mpolplain${Date.now()}`, ['ai:use']);
      const byAgent = await json('/v1/ai/policy', { method: 'PUT', headers: auth(plain), body: JSON.stringify({ policy: { mode: 'open' } }) });
      assert(byAgent.status === 403 && byAgent.body.error?.code === 'SCOPE_DENIED', `a plain agent: ${byAgent.status} ${byAgent.body.error?.code}`);
      const still = await json('/v1/ai/policy', { headers: auth(a.token) });
      assert(still.body.data.policy.mode === 'recommended', `a's policy is unchanged: ${still.body.data.policy.mode}`);
    });

    await test('10. an agent proposes over MCP; nothing changes until it confirms with the token', async () => {
      const admin = await connectAgent(a, `mpoladmin${Date.now()}`, ['ai:use', 'memory:write-reserved']);
      const proposal = toolJson(await mcpCall(admin, 'aimeat_ai_policy_set', { policy: { mode: 'custom', allow: [SECOND] } }));
      assert(proposal.mode === 'proposal' && typeof proposal.confirm_token === 'string', `a proposal: ${JSON.stringify(proposal).slice(0, 300)}`);
      const between = await json('/v1/ai/policy', { headers: auth(a.token) });
      assert(between.body.data.policy.mode === 'recommended', `not in force before the confirmation: ${between.body.data.policy.mode}`);
      const applied = toolJson(await mcpCall(admin, 'aimeat_ai_policy_set', { policy: { mode: 'custom', allow: [SECOND] }, confirm_token: proposal.confirm_token }));
      assert(applied.mode === 'applied', `applied: ${JSON.stringify(applied).slice(0, 300)}`);
      const after = await json('/v1/ai/policy', { headers: auth(a.token) });
      assert(after.body.data.policy.mode === 'custom' && JSON.stringify(after.body.data.policy.allow) === JSON.stringify([SECOND]), `in force: ${JSON.stringify(after.body.data.policy)}`);
      const reused = await mcpCall(admin, 'aimeat_ai_policy_set', { policy: { mode: 'open' }, confirm_token: proposal.confirm_token });
      const reusedText = String(reused?.result?.content?.[0]?.text ?? '');
      assert(reused?.result?.isError === true && /^(TOKEN_USED|PAYLOAD_MISMATCH):/.test(reusedText),
        `a token binds one exact change, once: ${reusedText.slice(0, 200)}`);
    });

    await test('11. the owner\'s per-app list binds an app identified from its grant, never a self-declared app_id', async () => {
      const s = await setPolicy(a, { mode: 'recommended', apps: { [`${a.name}/policy-grant.html`]: { allow: [SECOND] } } });
      assert(s.status === 200, `policy ${s.status}: ${JSON.stringify(s.body?.error)}`);
      const declared = await complete(a, { model: 'stub/good-model', app_id: `${a.name}/policy-grant.html` });
      assert(declared.status === 200, `a self-declared app_id does not take the owner's per-app list: ${declared.status} ${declared.body.error?.code}`);
      const appToken = await appGrantToken(a, 'policy-grant.html');
      const granted = await complete(appToken, { model: 'stub/good-model' });
      assert(granted.status === 403 && granted.body.error?.code === 'AI_MODEL_NOT_ALLOWED', `the granted app: ${granted.status} ${granted.body.error?.code}`);
      assert(granted.body.error.details.source === 'owner-app', `the owner's per-app rule refused: ${JSON.stringify(granted.body.error.details)}`);
    });
  } finally {
    await stopServer(server);
    await provider.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

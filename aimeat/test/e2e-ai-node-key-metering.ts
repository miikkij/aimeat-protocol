/**
 * @file test/e2e-ai-node-key-metering.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a call on the node's shared AI key costs the account's allowance, before and after
 *   it runs (secaudit2026oct26, the AI and model access group).
 *
 *   The node's key pays for a person with no key of their own, up to their allowance. A call is priced
 *   before it runs and its estimate held while it runs (services/ai/node-key-hold.ts), and what the
 *   provider answered is debited when it is settled. Four leads said where that bookkeeping missed:
 *   - a streamed /v1/llm call the provider answered and then broke off was never settled
 *     (llm-proxy.ts:chat-completions:answered-call-unsettled-on-abort);
 *   - text attempts that answered nothing and were asked again were never debited
 *     (gateway.ts:gatewayText:node-key-empty-answer-attempts-not-debited);
 *   - the estimate counted only the messages, not the tools a /v1/llm call sends
 *     (node-key-hold.ts:estimate:node-key-estimate-omits-call-inputs);
 *   - a model the catalogue does not price was neither priced nor held
 *     (route-plan.ts:planRoute:node-key-unpriced-model-zero-hold).
 *   Each has a case that failed on the code before the fix, beside the usage cases that pass on both:
 *   a whole and a streamed call settle once with the provider's cost, an answer after one empty
 *   attempt comes back unchanged, tools reach the provider untouched, a single call on an unpriced
 *   model runs, and a client that hangs up mid-stream still has its call settled.
 *
 *   NOTHING INSIDE THE NODE IS MOCKED. The provider is test/helpers/fake-ai-provider.ts, on loopback;
 *   the node's OpenRouter address points at it (AIMEAT_AI_FIXED_BASEURL_OVERRIDES, accepted on a node
 *   that is not public). No money moves and no outside service is reached.
 * @structure
 *   - the node under test: the run's backend, its own port, a node key, a 0.10 USD allowance,
 *     openai/gpt-4o (catalogue-priced) as the node's chat model
 *   - U1-U7: the uses that keep working
 *   - A1, A4, A5, A6: the four leads
 *   - B2: an allowlist entry under an app's bare file name still lets that app in, and the owner is
 *     told once when the app it let in is another author's (ai-app-id.ts:entryNamesApp:
 *     bare-allowlist-entry-matches-any-author, designed use made visible)
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-node-key-metering
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, chatJson, sseChat, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';
import { ownerSignIn } from './helpers/owner-login.js';

// Its own port, outside the 40251-up range sessions claim; the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_NODE_KEY_METERING_PORT ?? '40467';
const BASE = `http://localhost:${PORT}`;
const NODE_KEY = 'sk-node-e2e-metering-never-billed';
const NODE_MODEL = 'openai/gpt-4o';
const FREE_MODEL = 'openrouter/free';
const ALLOWANCE = 0.1;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-node-key-metering-'));
const DB_PATH = join(dbDir, 'metering.db');
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
    // The node's key, a small allowance per account, and a catalogue-priced chat model.
    AIMEAT_OPENROUTER_INSTANCE_KEY: NODE_KEY,
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: String(ALLOWANCE),
    AIMEAT_MODEL_DEFAULT_CHAT: NODE_MODEL,
    AIMEAT_MODEL_FREE_FALLBACK: FREE_MODEL,
    // The node's OpenRouter is the stub. Accepted because this node is not public.
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openrouter: `${stub.baseUrl}/node-or` }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the node-key metering node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

// ── principals and readings ───────────────────────────────────────────────────

let seq = 0;
/** A fresh account, so each case starts from the whole allowance. */
async function ownerNamed(label: string): Promise<{ token: string; name: string }> {
  const name = `nkm${label}${Date.now() % 1_000_000}${++seq}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Metering', password: 'Metering12345' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, 'Metering12345');
  assert(tok.status === 200, `auth/token ${tok.status}`);
  return { token: tok.body.data.token as string, name };
}
const owner = async (label: string): Promise<string> => (await ownerNamed(label)).token;

const REDIRECT = 'http://localhost:9912/callback';
/** The author publishes `filename` with ai:use (once), and `user` grants it ai:use: the app's token. */
async function appGrant(user: string, authorName: string, author: string, filename: string): Promise<string> {
  const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="ai:use"></head><body>metering</body></html>';
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(author),
    body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), name: `Metering ${filename}`, description: 'metering e2e probe', category: 'utility', visibility: 'public' }),
  });
  assert(pub.status === 201 || pub.status === 200 || pub.status === 409, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${authorName}/${filename}`, response_type: 'code', scope: 'ai:use',
    redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
  assert(!!m, `consent redirect expected, got ${res.status} ${res.headers.get('location')}`);
  const con = await json('/v1/app-grants/authorize-consent', {
    method: 'POST', headers: auth(user), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
  });
  assert(con.status === 200, `consent ${con.status}: ${JSON.stringify(con.body?.error)}`);
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', {
    method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
  });
  assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
  return tok.body.data.access_token as string;
}
const allowanceLeft = async (t: string) => Number((await json('/v1/chat/status', { headers: auth(t) })).body.data.allowance_remaining_usd);
const usage = async (t: string) => (await json('/v1/ai/usage', { headers: auth(t) })).body.data as { total_calls: number; spent_today_usd: number };
/** Wait until `read` answers what `ok` accepts, or the deadline passes; the last reading either way. */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < deadline) { await sleep(150); v = await read(); }
  return v;
}

const proxy = (t: string, body: Record<string, unknown>) =>
  fetch(`${BASE}/v1/llm/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(t) }, body: JSON.stringify(body) });
const complete = (t: string, body: Record<string, unknown>) =>
  json('/v1/ai/complete', { method: 'POST', headers: auth(t), body: JSON.stringify({ max_tokens: 16, ...body }) });
const marked = (marker: string) => (r: RecordedRequest) => r.body.includes(marker);
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── AI on the node\'s key: what an account\'s allowance is charged (secaudit2026oct26) ──');
  const stub = await startFakeAiProvider(0);
  const server = await startServer(stub);
  try {
    // ── the uses that keep working ──

    await test('U1. a whole /v1/llm call on the node key answers and is settled once, at the provider\'s cost', async () => {
      const t = await owner('u1');
      const [left, before] = [await allowanceLeft(t), await usage(t)];
      stub.queue('chat', chatJson('whole answer', { model: NODE_MODEL, usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0003 } }), marked('U1WHOLE'));
      const r = await proxy(t, { messages: [{ role: 'user', content: 'U1WHOLE hello' }], max_tokens: 16 });
      const body = await r.json() as any;
      assert(r.status === 200 && body.choices?.[0]?.message?.content === 'whole answer', `${r.status} ${JSON.stringify(body)}`);
      const after = await usage(t);
      assert(after.total_calls === before.total_calls + 1, `one usage row: ${before.total_calls} -> ${after.total_calls}`);
      assert(near(left - await allowanceLeft(t), 0.0003), `the allowance fell by the provider's cost, ${left} -> ${await allowanceLeft(t)}`);
    });

    await test('U2. a streamed /v1/llm call is forwarded frame for frame and settled once', async () => {
      const t = await owner('u2');
      const [left, before] = [await allowanceLeft(t), await usage(t)];
      const s = sseChat(['Hel', 'lo'], { model: NODE_MODEL, usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14, cost: 0.0002 } });
      stub.queue('chat', s.reply, marked('U2STREAM'));
      const r = await proxy(t, { messages: [{ role: 'user', content: 'U2STREAM hello' }], stream: true, max_tokens: 16 });
      const text = await r.text();
      assert(r.status === 200 && text.startsWith(s.body), `the frames as the provider sent them: ${text.slice(0, 120)}`);
      const after = await until(() => usage(t), (u) => u.total_calls > before.total_calls);
      assert(after.total_calls === before.total_calls + 1, `one usage row: ${before.total_calls} -> ${after.total_calls}`);
      assert(near(left - await allowanceLeft(t), 0.0002), `the allowance fell by the provider's cost, ${left} -> ${await allowanceLeft(t)}`);
    });

    await test('U3. /v1/ai/complete answers, and an answer after one empty attempt comes back unchanged', async () => {
      const t = await owner('u3');
      stub.queue('chat', chatJson('plain answer', { model: NODE_MODEL }), marked('U3PLAIN'));
      const plain = await complete(t, { prompt: 'U3PLAIN hello' });
      assert(plain.status === 200 && plain.body.data.content === 'plain answer', `${plain.status} ${JSON.stringify(plain.body?.error)}`);
      stub.queue('chat', chatJson('', { model: NODE_MODEL, usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, cost: 0.01 } }), marked('U3RETRY'));
      stub.queue('chat', chatJson('second time lucky', { model: NODE_MODEL, usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104, cost: 0.0004 } }), marked('U3RETRY'));
      const r = await complete(t, { prompt: 'U3RETRY hello' });
      assert(r.status === 200 && r.body.data.content === 'second time lucky', `${r.status} ${JSON.stringify(r.body?.error ?? r.body.data)}`);
      assert(near(r.body.data.usage.cost_usd, 0.0004) && r.body.data.usage.completion_tokens === 4,
        `the answer's own usage is reported as before: ${JSON.stringify(r.body.data.usage)}`);
    });

    await test('U4. tools reach the provider untouched on a /v1/llm call that fits the allowance', async () => {
      const t = await owner('u4');
      const tools = [{ type: 'function', function: { name: 'lookup', description: 'Look a word up.', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }];
      stub.queue('chat', chatJson('used no tool', { model: NODE_MODEL }), marked('U4TOOLS'));
      const r = await proxy(t, { messages: [{ role: 'user', content: 'U4TOOLS hello' }], tools, tool_choice: 'auto', max_tokens: 16 });
      assert(r.status === 200, `status ${r.status}`);
      const sent = stub.requestsFor('chat').filter(marked('U4TOOLS')).at(-1)!;
      assert(JSON.stringify(sent.json?.tools) === JSON.stringify(tools) && sent.json?.tool_choice === 'auto', `the tools as given: ${JSON.stringify(sent.json?.tools)}`);
      assert(sent.json?.model === NODE_MODEL, `on the node's model, got ${sent.json?.model}`);
    });

    await test('U5. one call on a model the catalogue does not price runs on the node key', async () => {
      const t = await owner('u5');
      stub.queue('chat', chatJson('auto answered', { model: 'openai/gpt-4o-mini' }), marked('U5AUTO'));
      const r = await complete(t, { prompt: 'U5AUTO hello', model: 'openrouter:openrouter/auto', max_tokens: undefined });
      assert(r.status === 200 && r.body.data.content === 'auto answered', `${r.status} ${JSON.stringify(r.body?.error)}`);
      const sent = stub.requestsFor('chat').filter(marked('U5AUTO')).at(-1)!;
      assert(sent.json?.model === 'openrouter/auto', `the named model, got ${sent.json?.model}`);
    });

    await test('U6. a client that hangs up mid-stream: the provider is not cut off and the call is settled once', async () => {
      // On Node 24 the proxy's req 'close' listener, added after the body was read, never fires, so
      // the provider's answer runs to its end and is settled (the lead's other outcome).
      const t = await owner('u6');
      const before = await usage(t);
      const head = frame({ id: 'c', model: NODE_MODEL, choices: [{ index: 0, delta: { content: 'part one ' } }] });
      const tail = frame({ id: 'c', model: NODE_MODEL, choices: [{ index: 0, delta: { content: 'part two' } }] })
        + frame({ id: 'c', model: NODE_MODEL, choices: [], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11, cost: 0.0002 } })
        + 'data: [DONE]\n\n';
      stub.queue('chat', { kind: 'sse-partial', head, tail }, marked('U6HANGUP'));
      const leaving = new AbortController();
      const r = await fetch(`${BASE}/v1/llm/chat/completions`, {
        method: 'POST', signal: leaving.signal, headers: { 'Content-Type': 'application/json', ...auth(t) },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'U6HANGUP hello' }], stream: true, max_tokens: 16 }),
      });
      const reader = r.body!.getReader();
      await reader.read();
      leaving.abort();
      await sleep(300);
      stub.releaseHeld();
      const after = await until(() => usage(t), (u) => u.total_calls > before.total_calls);
      assert(after.total_calls === before.total_calls + 1, `the call is settled once: ${before.total_calls} -> ${after.total_calls}`);
      const sent = stub.requestsFor('chat').filter(marked('U6HANGUP')).at(-1)!;
      assert(sent.aborted !== true, 'the provider was not cut off');
    });

    await test('U7. pictures on the node key within the allowance answer as before', async () => {
      const t = await owner('u7');
      stub.queue('chat', chatJson('two pictures seen', { model: NODE_MODEL }), marked('U7PICS'));
      const r = await complete(t, { prompt: 'U7PICS what is here', images: ['https://example.org/a.png', 'https://example.org/b.png'] });
      assert(r.status === 200 && r.body.data.content === 'two pictures seen', `${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    // ── the four leads ──

    await test('A1. a streamed call the provider answered and then broke off is settled (answered-call-unsettled-on-abort)', async () => {
      const t = await owner('a1');
      const before = await usage(t);
      const head = frame({ id: 'c', model: NODE_MODEL, choices: [{ index: 0, delta: { content: 'an answer the provider ' } }] })
        + frame({ id: 'c', model: NODE_MODEL, choices: [{ index: 0, delta: { content: 'did not finish' } }] });
      stub.queue('chat', { kind: 'sse-partial', head }, marked('A1BREAK'));
      const r = await proxy(t, { messages: [{ role: 'user', content: 'A1BREAK hello' }], stream: true, max_tokens: 16 });
      const text = await r.text().catch(() => '');
      assert(text.includes('did not finish'), `the client got the frames that came: ${text.slice(0, 160)}`);
      const after = await until(() => usage(t), (u) => u.total_calls > before.total_calls);
      assert(after.total_calls === before.total_calls + 1, `the answered call is on the account's record: ${before.total_calls} -> ${after.total_calls}`);
      assert(after.spent_today_usd > before.spent_today_usd, `with a cost: ${before.spent_today_usd} -> ${after.spent_today_usd}`);
    });

    await test('A4. text attempts that answered nothing are debited from the allowance (node-key-empty-answer-attempts-not-debited)', async () => {
      const t = await owner('a4');
      const left = await allowanceLeft(t);
      for (let i = 0; i < 3; i++) {
        stub.queue('chat', chatJson('  ', { model: NODE_MODEL, usage: { prompt_tokens: 1000, completion_tokens: 1, total_tokens: 1001, cost: 0.01 } }), marked('A4EMPTY'));
      }
      const r = await complete(t, { prompt: 'A4EMPTY hello' });
      assert(r.status === 502 && r.body?.error?.code === 'EMPTY_COMPLETION', `three empty answers fail as before: ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(stub.requestsFor('chat').filter(marked('A4EMPTY')).length === 3, 'three attempts reached the provider');
      const now = await until(() => allowanceLeft(t), (v) => v < left);
      assert(near(left - now, 0.03), `the three attempts the node key paid are debited: ${left} -> ${now}`);
    });

    await test('A4b. the empty attempt before an answer is debited beside the answer', async () => {
      const t = await owner('a4b');
      const left = await allowanceLeft(t);
      stub.queue('chat', chatJson('', { model: NODE_MODEL, usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, cost: 0.01 } }), marked('A4BRETRY'));
      stub.queue('chat', chatJson('answered', { model: NODE_MODEL, usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104, cost: 0.0004 } }), marked('A4BRETRY'));
      const r = await complete(t, { prompt: 'A4BRETRY hello' });
      assert(r.status === 200 && r.body.data.content === 'answered', `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(near(left - await allowanceLeft(t), 0.0104), `both attempts are debited: ${left} -> ${await allowanceLeft(t)}`);
    });

    await test('A5. a /v1/llm call is priced with its tools, not only its messages (node-key-estimate-omits-call-inputs)', async () => {
      const t = await owner('a5');
      // About 100 000 tokens of tool definitions at gpt-4o's 2.5 USD a million is 0.25 USD, over the
      // 0.10 USD allowance: the call is not run on the priced model; it named none, so the free model answers.
      const tools = [{ type: 'function', function: { name: 'big', description: 'x'.repeat(400_000), parameters: { type: 'object', properties: {} } } }];
      stub.queue('chat', chatJson('free model answered', { model: FREE_MODEL }), marked('A5TOOLS'));
      const r = await proxy(t, { messages: [{ role: 'user', content: 'A5TOOLS hi' }], tools, max_tokens: 16 });
      assert(r.status === 200, `status ${r.status}`);
      const sent = stub.requestsFor('chat').filter(marked('A5TOOLS')).at(-1)!;
      assert(sent.json?.model === FREE_MODEL, `the call too costly for the allowance goes to the free model, got ${sent.json?.model}`);
    });

    await test('A6. calls side by side on a model the catalogue does not price hold what is left (node-key-unpriced-model-zero-hold)', async () => {
      const t = await owner('a6');
      stub.setDefault('chat', (req) => req.body.includes('A6AUTO') ? { kind: 'hold' } : chatJson('The stub provider answered.'));
      try {
        const calls = Array.from({ length: 5 }, () => complete(t, { prompt: 'A6AUTO hello', model: 'openrouter:openrouter/auto', max_tokens: undefined }));
        await until(async () => stub.requestsFor('chat').filter(marked('A6AUTO')).length, (n) => n >= 1);
        await sleep(1_000);
        const reached = stub.requestsFor('chat').filter(marked('A6AUTO')).length;
        stub.setDefault('chat', chatJson('The stub provider answered.'));
        stub.releaseHeld();
        const answers = await Promise.all(calls);
        const refused = answers.filter((a) => a.status === 402 && a.body?.error?.code === 'QUOTA_EXHAUSTED').length;
        assert(reached === 1, `one call runs at a time on what is left, got ${reached} at the provider`);
        assert(refused === 4, `the others are refused with the price, got ${answers.map((a) => `${a.status} ${a.body?.error?.code ?? ''}`).join(', ')}`);
      } finally {
        stub.setDefault('chat', chatJson('The stub provider answered.'));
        stub.releaseHeld();
      }
    });

    // ── which app an allowlist entry lets in (ai-app-id.ts:entryNamesApp:bare-allowlist-entry-matches-any-author) ──

    await test('B2. a bare allowlist entry still lets the app in, and the owner is told once when it is another author\'s app', async () => {
      const { token: alice, name: aliceName } = await ownerNamed('b2a');
      const { token: bob, name: bobName } = await ownerNamed('b2b');
      // Alice's own app and Bob's app share the file name the list names.
      const ownGrant = await appGrant(alice, aliceName, alice, 'notes.html');
      const bobGrant = await appGrant(alice, bobName, bob, 'notes.html');
      const saved = await json('/v1/ai/settings', { method: 'POST', headers: auth(alice), body: JSON.stringify({ app_allowlist: ['notes'] }) });
      assert(saved.status === 200, `allowlist ${saved.status}`);
      const told = async () => ((await json('/v1/notifications', { headers: auth(alice) })).body?.data?.notifications as any[] ?? [])
        .filter((n) => n.type === 'ai_app_name_match');

      stub.queue('chat', chatJson('own app answered', { model: NODE_MODEL }), marked('B2OWN'));
      const own = await complete(ownGrant, { prompt: 'B2OWN hello', app_id: 'notes' });
      assert(own.status === 200, `Alice's own app is let in: ${own.status} ${JSON.stringify(own.body?.error)}`);
      await sleep(500);
      assert((await told()).length === 0, 'her own app tells her nothing');

      for (const marker of ['B2BOB1', 'B2BOB2']) {
        stub.queue('chat', chatJson('bob app answered', { model: NODE_MODEL }), marked(marker));
        const r = await complete(bobGrant, { prompt: `${marker} hello`, app_id: 'notes' });
        assert(r.status === 200, `Bob's app is let in as before: ${r.status} ${JSON.stringify(r.body?.error)}`);
      }
      const notices = await until(told, (n) => n.length > 0);
      assert(notices.length === 1, `one notice for the pair, got ${notices.length}`);
      assert(String(notices[0].title).includes(`${bobName}/notes`) && String(notices[0].body).includes('"notes"'),
        `it names the app and the entry: ${JSON.stringify(notices[0])}`);
    });
  } finally {
    await stopServer(server);
    await stub.close();
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`\nNode-key metering E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

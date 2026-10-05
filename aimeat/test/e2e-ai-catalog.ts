/**
 * @file test/e2e-ai-catalog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model catalogue end to end (System 2 plan, V4; docs/internal/llmproviderintegrations/
 *   06 and 09 section 4): the seed a fresh node starts with, a refresh from the three sources, a source
 *   that does not answer, retirement, prices from the catalogue on a direct provider's call, and the
 *   V3 rules that read the catalogue (a named model's fallback to the same model at another type,
 *   the pool ordered by price, the price ceiling, the capability check when a provider is saved).
 *
 *   The three sources are a stub serving the samples in test/fixtures/ai-catalog/, which were cut from
 *   the real sources on 2026-09-28, so the refresh reads real shapes. The model providers are the
 *   fake provider (test/helpers/fake-ai-provider.ts) with the fixed types pointed at it.
 *
 *   PASS CRITERION (09, V4): GET /v1/ai/models?capability=transcription returns OpenRouter's
 *   transcription models with the right capabilities; an Anthropic call's cost comes from the
 *   catalogue; a retired model shows to the owner whose provider uses it.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-catalog.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import {
  startFakeAiProvider, chatJson, anthropicJson, anthropicError, type FakeAiProvider, type RecordedRequest,
} from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_CATALOG_PORT ?? '40440';
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

// ── the three catalogue sources: real samples, switchable ────────────────────────

const FIX = join(process.cwd(), 'test', 'fixtures', 'ai-catalog');
const samples = {
  modelsDev: JSON.parse(readFileSync(join(FIX, 'models-dev.sample.json'), 'utf8')),
  openRouter: JSON.parse(readFileSync(join(FIX, 'openrouter.sample.json'), 'utf8')),
  liteLlm: JSON.parse(readFileSync(join(FIX, 'litellm.sample.json'), 'utf8')),
};
type SourceKey = keyof typeof samples;
/** What each source answers: its sample, a variant a test sets, or a failure. */
const serving: Record<SourceKey, unknown | 'down'> = { ...samples };

async function startSources(): Promise<{ server: Server; urls: Record<SourceKey, string> }> {
  const server = createServer((req, res) => {
    const key = (req.url ?? '').slice(1) as SourceKey;
    const body = serving[key];
    if (body === undefined || body === 'down') { res.writeHead(503).end('down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const at = (k: string) => `http://127.0.0.1:${port}/${k}`;
  return { server, urls: { modelsDev: at('modelsDev'), openRouter: at('openRouter'), liteLlm: at('liteLlm') } };
}

// ── the node ─────────────────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-catalog-'));
const DB_PATH = join(dbDir, 'ai-catalog.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(sources: Record<SourceKey, string>, stub: FakeAiProvider): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_OPENROUTER_INSTANCE_KEY: '',
    AIMEAT_AI_CATALOG_SOURCES: JSON.stringify(sources),
    // An operator's correction for one model: it wins over every source.
    AIMEAT_AI_PRICE_OVERRIDES: JSON.stringify({ 'openai:gpt-5.4': { inPerMtok: 1, outPerMtok: 2 } }),
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ anthropic: `${stub.baseUrl}/anthropic`, openrouter: `${stub.baseUrl}/or`, openai: `${stub.baseUrl}/openai` }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI catalogue node' });
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
  const name = `aicat${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Catalogue', password: 'AiCatalogue1234' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
  assert(tok.status === 200, `auth/token ${tok.status}`);
  return { name, token: tok.body.data.token as string };
}

// ── the run ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── The model catalogue (System 2, V4) ──');
  const { server: sourceServer, urls } = await startSources();
  const stub = await startFakeAiProvider(0);
  stub.setDefault('chat', (r) => chatJson(`answered at ${r.pathname} by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
  const server = await startServer(urls, stub);
  const at = (p: string) => (r: RecordedRequest) => r.pathname.startsWith(`/v1/${p}/`);

  try {
    // The first account on a fresh node takes the operator role.
    const op = await setupOwner('op');
    const a = await setupOwner('a');
    const refresh = () => json('/v1/admin/ai/catalog/refresh', { method: 'POST', headers: auth(op.token) });
    const models = (o: Owner, q: string) => json(`/v1/ai/models?${q}`, { headers: auth(o.token) });
    const put = (o: Owner, id: string, body: Record<string, unknown>) => json(`/v1/ai/providers/${id}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const setKey = (o: Owner, id: string, key: string) => json(`/v1/ai/providers/${id}/key`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ api_key: key }) });
    const testProv = (o: Owner, id: string) => json(`/v1/ai/providers/${id}/test`, { method: 'POST', headers: auth(o.token), body: JSON.stringify({}) });
    const complete = (o: Owner, body: Record<string, unknown>) => json('/v1/ai/complete', { method: 'POST', headers: auth(o.token), body: JSON.stringify({ prompt: 'Say one word.', ...body }) });

    await test('1. a fresh node starts from the seed, and the catalogue meta is public', async () => {
      const meta = await json('/v1/ai/catalog/meta');
      assert(meta.status === 200 && meta.body.data.origin === 'seed', `seeded: ${JSON.stringify(meta.body.data ?? meta.body)}`);
      assert(meta.body.data.counts.openrouter > 100 && meta.body.data.counts.anthropic > 0, `counts: ${JSON.stringify(meta.body.data.counts)}`);
    });

    await test('2. PASS: GET /v1/ai/models?capability=transcription lists OpenRouter\'s transcription models with the right capabilities', async () => {
      const r = await models(a, 'capability=transcription&type=openrouter');
      assert(r.status === 200 && r.body.data.models.length > 3, `transcription models: ${r.status} ${r.body.data?.models?.length}`);
      assert(r.body.data.models.every((m: any) => m.caps.transcription === true && m.caps.audioIn === true && m.type === 'openrouter'), 'every row can transcribe');
      assert(r.body.data.models.every((m: any) => m.price.inPerMtok === undefined), 'an audio model carries no guessed per-token price');
      const bad = await models(a, 'capability=poetry');
      assert(bad.status === 400, `an unknown capability is named: ${bad.status}`);
    });

    await test('3. a refresh from the three sources replaces the seed, and the operator\'s correction wins', async () => {
      const r = await refresh();
      assert(r.status === 200 && r.body.data.written === true, `refresh: ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
      const meta = (await json('/v1/ai/catalog/meta')).body.data;
      assert(meta.origin === 'refresh' && meta.sources['models.dev']?.lastOkAt && meta.sources.openrouter?.lastOkAt && meta.sources.litellm?.lastOkAt, `every source answered: ${JSON.stringify(meta.sources)}`);
      const gpt = (await models(a, 'type=openai&status=all')).body.data.models.find((m: any) => m.id === 'gpt-5.4');
      assert(gpt?.price.inPerMtok === 1 && gpt.price.outPerMtok === 2 && gpt.sources.includes('operator'), `override: ${JSON.stringify(gpt?.price)}`);
      const whisper = (await models(a, 'type=openai&status=all&capability=transcription')).body.data.models.find((m: any) => m.id === 'whisper-1');
      assert(typeof whisper?.price.transcriptionPerSecond === 'number', `LiteLLM fills the per-second price: ${JSON.stringify(whisper?.price)}`);
      const nonAdmin = await json('/v1/admin/ai/catalog/refresh', { method: 'POST', headers: auth(a.token) });
      assert(nonAdmin.status === 403, `only an operator refreshes on demand: ${nonAdmin.status}`);
    });

    await test('4. no source answering keeps the catalogue as it was, and the failure is recorded', async () => {
      const before = (await json('/v1/ai/catalog/meta')).body.data;
      serving.modelsDev = 'down'; serving.openRouter = 'down'; serving.liteLlm = 'down';
      const r = await refresh();
      assert(r.status === 200 && r.body.data.written === false, `nothing written: ${JSON.stringify(r.body.data)}`);
      const after = (await json('/v1/ai/catalog/meta')).body.data;
      assert(JSON.stringify(after.counts) === JSON.stringify(before.counts) && after.snapshot === before.snapshot, `counts kept: ${JSON.stringify(after.counts)}`);
      assert(after.sources.openrouter?.lastError?.message, `the failure is recorded: ${JSON.stringify(after.sources.openrouter)}`);
      Object.assign(serving, samples);
    });

    await test('5. one source down: what only it knew is carried, never started on retirement', async () => {
      serving.openRouter = 'down';
      const r = await refresh();
      assert(r.status === 200 && r.body.data.written === true, `written from the other two: ${JSON.stringify(r.body.data)}`);
      const or = (await models(a, 'type=openrouter&status=all')).body.data.models;
      const whisper = or.find((m: any) => m.id === 'openai/whisper-1');
      assert(whisper?.status === 'active', `an OpenRouter-only model stays active: ${JSON.stringify(whisper && { status: whisper.status })}`);
      serving.openRouter = samples.openRouter;
    });

    await test('6. a model the sources drop starts retiring; a passed retirement date retires it, and its owner sees it', async () => {
      // The owner's own OpenRouter provider uses google/gemini-2.5-flash for text.
      assert((await put(a, 'my-or', { title: 'My OpenRouter', type: 'openrouter', capabilities: { text: { enabled: true, model: 'google/gemini-2.5-flash', pool: true } } })).status === 200, 'put my-or');
      const or = structuredClone(samples.openRouter) as { data: Array<Record<string, unknown>> };
      or.data = or.data.filter(m => m.id !== 'openai/gpt-audio');
      // Past, but under 180 days: a model that far past its date is dropped, not kept as retired.
      for (const m of or.data) if (m.id === 'google/gemini-2.5-flash') m.expiration_date = '2026-09-01';
      serving.openRouter = or;
      // models.dev lists the same two ids under its openrouter provider; drop them there too.
      const md = structuredClone(samples.modelsDev) as Record<string, { models: Record<string, unknown> }>;
      delete md.openrouter.models['openai/gpt-audio'];
      serving.modelsDev = md;
      try {
        assert((await refresh()).body.data.written === true, 'refresh');
        const all = (await models(a, 'type=openrouter&status=all')).body.data.models;
        assert(all.find((m: any) => m.id === 'openai/gpt-audio')?.status === 'retiring', 'missing once: retiring');
        assert(all.find((m: any) => m.id === 'google/gemini-2.5-flash')?.status === 'retired', 'retirement date passed: retired');
        const view = (await json('/v1/ai/providers', { headers: auth(a.token) })).body.data.providers.find((p: any) => p.id === 'my-or');
        assert(view.capabilities.text.model_status === 'retired', `the owner sees it where it is used: ${JSON.stringify(view.capabilities.text)}`);
        const listed = (await models(a, 'type=openrouter')).body.data.models;
        assert(!listed.some((m: any) => m.id === 'google/gemini-2.5-flash'), 'a retired model is not in the default list');
      } finally {
        Object.assign(serving, samples);
        assert((await refresh()).body.data.written === true, 'refresh back');
      }
    });

    await test('7. PASS: an Anthropic call is priced from the catalogue, and the answer says it is not the provider\'s own number', async () => {
      assert((await put(a, 'my-anthropic', { title: 'Anthropic', type: 'anthropic', capabilities: { text: { enabled: true, model: 'claude-opus-5-5' } } })).status === 200, 'put');
      assert((await setKey(a, 'my-anthropic', 'sk-ant-catalog')).status === 200, 'key');
      stub.queue('messages', anthropicJson('hei', { inputTokens: 1000, outputTokens: 500, model: 'claude-opus-5-5' }));
      const r = await complete(a, { model: 'anthropic:claude-opus-5-5' });
      assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
      // claude-opus-5-5 is $4 in and $20 out per million tokens in the sample.
      const expected = (1000 * 4 + 500 * 20) / 1e6;
      assert(Math.abs(r.body.data.usage.cost_usd - expected) < 1e-9, `cost ${r.body.data.usage.cost_usd}, expected ${expected}`);
      assert(r.body.data.usage.cost_exact === false, 'not the provider\'s reported charge');
    });

    await test('8. saving a provider checks each model against the catalogue', async () => {
      const bad = await put(a, 'my-openai', { title: 'OpenAI', type: 'openai', capabilities: { text: { enabled: true, model: 'text-embedding-3-small' } } });
      assert(bad.status === 400 && /does not serve text/.test(bad.body.error?.message ?? ''), `an embedding model for text: ${bad.status} ${bad.body.error?.message}`);
      const unknown = await put(a, 'my-openai', { title: 'OpenAI', type: 'openai', capabilities: { text: { enabled: true, model: 'gpt-7-preview' } } });
      assert(unknown.status === 200 && (unknown.body.data.warnings ?? []).some((w: string) => /not in the model catalogue/.test(w)), `an unknown model is a warning: ${JSON.stringify(unknown.body.data?.warnings ?? unknown.body.error)}`);
    });

    await test('9. a named model falls back to the same model at another provider type', async () => {
      assert((await put(a, 'my-or', { title: 'My OpenRouter', type: 'openrouter', capabilities: { text: { enabled: true, model: 'anthropic/claude-opus-5.5', pool: true } } })).status === 200, 'put my-or');
      assert((await setKey(a, 'my-or', 'sk-or-catalog')).status === 200, 'key');
      stub.queue('messages', anthropicError(529, 'overloaded_error', 'overloaded'));
      const r = await complete(a, { model: 'anthropic:claude-opus-5-5' });
      assert(r.status === 200, `answered: ${r.status} ${JSON.stringify(r.body?.error)}`);
      const route = r.body.data.route;
      assert(route.fellBack === true && route.answeredBy.provider === 'my-or' && route.answeredBy.model === 'anthropic/claude-opus-5.5', `route: ${JSON.stringify(route)}`);
      assert(stub.requests.filter(at('or')).pop()?.json?.model === 'anthropic/claude-opus-5.5', 'OpenRouter got its own id for the model');
    });

    await test('10. the pool ordered by price, and a price ceiling that skips a dearer model', async () => {
      // Named so the owner's order (the records' key order) puts the dear one first.
      const q = await setupOwner('q');
      assert((await put(q, 'a-dear', { title: 'Dear', type: 'anthropic', capabilities: { text: { enabled: true, model: 'claude-opus-5-5', pool: true } } })).status === 200, 'put dear');
      assert((await setKey(q, 'a-dear', 'sk-ant-q')).status === 200, 'key dear');
      assert((await put(q, 'z-cheap', { title: 'Cheap', type: 'openrouter', capabilities: { text: { enabled: true, model: 'google/gemini-2.5-flash', pool: true } } })).status === 200, 'put cheap');
      assert((await setKey(q, 'z-cheap', 'sk-or-q')).status === 200, 'key cheap');
      for (const id of ['a-dear', 'z-cheap']) assert((await testProv(q, id)).status === 200, `test ${id}`);
      const first = await complete(q, {});
      assert(first.status === 200 && first.body.data.route.answeredBy.provider === 'a-dear', `priority keeps the owner's order: ${JSON.stringify(first.body.data?.route ?? first.body.error)}`);
      const rules = (r: Record<string, unknown>) => json('/v1/ai/routing', { method: 'PUT', headers: auth(q.token), body: JSON.stringify({ routing: { rules: r } }) });
      assert((await rules({ poolOrder: 'cheapest' })).status === 200, 'cheapest');
      const r = await complete(q, {});
      assert(r.status === 200 && r.body.data.route.answeredBy.provider === 'z-cheap', `cheapest first: ${JSON.stringify(r.body.data?.route ?? r.body.error)}`);
      // At 1024 tokens each way Opus is about $0.025 and Gemini Flash about $0.003: a $0.01 ceiling
      // skips the first and keeps the second.
      assert((await rules({ poolOrder: 'priority', maxCostPerCallUsd: 0.01 })).status === 200, 'ceiling');
      const r2 = await complete(q, {});
      assert(r2.status === 200 && r2.body.data.route.answeredBy.provider === 'z-cheap', `the dearer one skipped: ${JSON.stringify(r2.body.data?.route ?? r2.body.error)}`);
      // Secaudit 2026-10, AI-4: the ceiling measures this call. 200,000 characters are about 50,000
      // tokens, which on Gemini Flash alone cost more than $0.005; the old 1,024-token guess put the
      // call at about $0.003 and let it through.
      assert((await rules({ poolOrder: 'priority', maxCostPerCallUsd: 0.005 })).status === 200, 'lower ceiling');
      const long = await complete(q, { prompt: 'word '.repeat(40_000) });
      assert(long.status !== 200, `a long prompt over the ceiling is refused on both: ${long.status} ${JSON.stringify(long.body.data?.route ?? long.body.error)}`);
      const short = await complete(q, {});
      assert(short.status === 200 && short.body.data.route.answeredBy.provider === 'z-cheap', `a short one still goes: ${JSON.stringify(short.body.data?.route ?? short.body.error)}`);
    });

    await test('11. allowed=true lists only what the caller\'s policy allows on a provider it has', async () => {
      const s = await json('/v1/ai/policy', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ policy: { mode: 'custom', allow: ['anthropic:claude-opus-5-5'] } }) });
      assert(s.status === 200, `policy ${s.status}`);
      const r = await models(a, 'capability=text&allowed=true');
      const refs = r.body.data.models.map((m: any) => m.ref);
      assert(JSON.stringify(refs) === JSON.stringify(['anthropic:claude-opus-5-5']), `allowed: ${JSON.stringify(refs)}`);
    });
  } finally {
    await stopServer(server);
    await stub.close();
    sourceServer.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

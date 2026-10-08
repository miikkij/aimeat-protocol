/**
 * @file test/e2e-ai-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a caller can do with AI, end to end (System 2 plan, V5; docs/internal/
 *   llmproviderintegrations/07 section 2, 09 section 5): GET /v1/ai/capabilities for an owner, an agent
 *   and an app, every `reason` a capability can be off for, and the fix aimeat_ai_capabilities gives;
 *   then the calls V5 changed: files in a text call, speech without a model or a voice, GET
 *   /v1/ai/available on the provider records, the provider test of speech and embeddings, an app's
 *   prefer.* in its meta, and the publish hints.
 *
 *   Its own node on 40441, whose fixed provider types point at the fake provider
 *   (test/helpers/fake-ai-provider.ts), and whose catalogue sources point at a stub serving the V4
 *   samples, so a retirement can be made to happen.
 *
 *   PASS CRITERION (09, V5): an app calls capabilities(), sees image on and makes a picture; an AI
 *   calls aimeat_ai_capabilities and gets a fix for a capability that is off.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-capabilities.ts
 * @version-history
 *   v1.2.0 — 2026-10-08 — 10b (aiprov plan, A1, A4, A5, A6): an OpenRouter TTS model's PCM layout on
 *     the start, done and json=1 answers; a voice the catalogue says it lacks refused before the call;
 *     an mp3 refusal as 422 PROVIDER_REJECTED with a pcm hint; the speech fallback when allowed.
 *   v1.1.0 — 2026-10-02 — An UNTESTED capability leads the person to the test: `fix` is their sentence
 *     (no tool names) in the cookie's or the browser's language, `settingsUrl` opens the provider at
 *     its text test, `testProvider` names it, and a refused /v1/ai/complete carries the same in
 *     error.details. The AI-facing words moved from `fix` to `agentFix`, so tests 2, 5, 6 and 13 read
 *     them there (their setup no longer matched the contract; the source was right).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
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
import { startFakeAiProvider, chatJson, imageJson, anthropicJson, providerStatus, speechPcm, type FakeAiProvider } from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_CAPABILITIES_PORT ?? '40441';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const REDIRECT = 'http://localhost:9912/callback';
/** One transparent pixel, which is all an image answer needs to be stored. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
const b64 = (s: string) => Buffer.from(s).toString('base64');

// ── the catalogue sources: the V4 samples, switchable ─────────────────────────

const FIX = join(process.cwd(), 'test', 'fixtures', 'ai-catalog');
const samples = {
  modelsDev: JSON.parse(readFileSync(join(FIX, 'models-dev.sample.json'), 'utf8')),
  openRouter: JSON.parse(readFileSync(join(FIX, 'openrouter.sample.json'), 'utf8')),
  liteLlm: JSON.parse(readFileSync(join(FIX, 'litellm.sample.json'), 'utf8')),
};
type SourceKey = keyof typeof samples;
const serving: Record<SourceKey, unknown> = { ...samples };

async function startSources(): Promise<{ server: Server; urls: Record<SourceKey, string> }> {
  const server = createServer((req, res) => {
    const body = serving[(req.url ?? '').slice(1) as SourceKey];
    if (body === undefined) { res.writeHead(503).end('down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const at = (k: string) => `http://127.0.0.1:${port}/${k}`;
  return { server, urls: { modelsDev: at('modelsDev'), openRouter: at('openRouter'), liteLlm: at('liteLlm') } };
}

// ── the node ─────────────────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-capabilities-'));
const DB_PATH = join(dbDir, 'ai-capabilities.db');
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
    // No node key: every capability here is the owner's own provider, or off.
    AIMEAT_OPENROUTER_INSTANCE_KEY: '',
    AIMEAT_MODEL_DEFAULT_TTS: '', AIMEAT_TTS_VOICE_DEFAULT: '', AIMEAT_MODEL_DEFAULT_EMBED: '',
    AIMEAT_AI_CATALOG_SOURCES: JSON.stringify(sources),
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({
      openai: `${stub.baseUrl}/openai`, anthropic: `${stub.baseUrl}/anthropic`, openrouter: `${stub.baseUrl}/or`,
    }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI capabilities node' });
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

interface Owner { name: string; token: string }
async function setupOwner(label: string): Promise<Owner> {
  const name = `aicap${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Capabilities', password: 'AiCapabilities1234' }) });
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

/** Publish an app and take an app-grant token with ai:use for it. Answers the token and the publish body. */
async function publishApp(owner: Owner, filename: string, html: string): Promise<{ token: string; publish: any }> {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename, content: b64(html), name: `Capabilities ${filename}`, description: 'capabilities e2e probe', category: 'utility' }),
  });
  assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope: 'ai:use', redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
  assert(!!m, `consent redirect expected, got ${res.status}`);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }) });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
  assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
  return { token: tok.body.data.access_token as string, publish: pub.body.data };
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-capabilities-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}
const toolJson = (r: any) => JSON.parse(String(r?.result?.content?.[0]?.text ?? '{}'));

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── AI capabilities for apps and agents (System 2, V5) ──');
  const { server: sourceServer, urls } = await startSources();
  const stub = await startFakeAiProvider(0);
  stub.setDefault('chat', (r) => chatJson(`answered by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
  stub.setDefault('images', imageJson({ b64: PNG_1PX }));
  stub.setDefault('messages', (r) => anthropicJson('anthropic answered', { model: String(r.json?.model) }));
  const server = await startServer(urls, stub);

  try {
    const op = await setupOwner('op');       // the first account on a fresh node is the operator
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const c = await setupOwner('c');
    const caps = (token: string, q = '') => json(`/v1/ai/capabilities${q}`, { headers: auth(token) });
    const put = (o: Owner, id: string, body: Record<string, unknown>) => json(`/v1/ai/providers/${id}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const setKey = (o: Owner, id: string, key: string) => json(`/v1/ai/providers/${id}/key`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ api_key: key }) });
    const routing = (o: Owner, r: Record<string, unknown>) => json('/v1/ai/routing', { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ routing: r }) });
    const settings = (o: Owner, body: Record<string, unknown>) => json('/v1/ai/settings', { method: 'POST', headers: auth(o.token), body: JSON.stringify(body) });
    const setPolicy = (o: Owner, policy: Record<string, unknown>) => json('/v1/ai/policy', { method: 'PUT', headers: auth(o.token), body: JSON.stringify({ policy }) });
    const openaiAll = (speech: Record<string, unknown> = { enabled: true, model: 'tts-1', voice: 'alloy', pool: true }) => ({
      title: 'My OpenAI', type: 'openai', capabilities: {
        text: { enabled: true, model: 'gpt-5.4', pool: true }, vision: { enabled: true, model: 'gpt-5.4', pool: true },
        files: { enabled: true, model: 'gpt-5.4', pool: true }, image: { enabled: true, model: 'gpt-image-2', pool: true },
        speech, transcription: { enabled: true, model: 'whisper-1', pool: true },
        embed: { enabled: true, model: 'text-embedding-3-small', pool: true },
      },
    });

    await test('1. an owner with no provider: every capability is off with NO_PROVIDER_SUPPORTS and the types that can', async () => {
      const r = await caps(b.token);
      assert(r.status === 200, `capabilities ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const all = r.body.data.capabilities;
      for (const cap of ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed']) {
        assert(all[cap]?.on === false && all[cap].reason === 'NO_PROVIDER_SUPPORTS', `${cap}: ${JSON.stringify(all[cap])}`);
        assert(typeof all[cap].fix === 'string' && all[cap].fix.length > 20 && typeof all[cap].howTo === 'string', `${cap} has a fix and a howTo`);
      }
      assert(all.image.providersThatCan.includes('openai') && !all.image.providersThatCan.includes('anthropic'), `image types: ${all.image.providersThatCan}`);
      assert(r.body.data.guide === 'node:aimeat-ai-capabilities', 'names the guide skill');
    });

    await test('2. PASS: an AI calls aimeat_ai_capabilities and gets a fix it can pass on', async () => {
      const agent = await connectAgent(b, 'capbot', ['ai:use']);
      const out = toolJson(await mcpCall(agent, 'aimeat_ai_capabilities', {}));
      const img = out.capabilities?.image;
      assert(img?.on === false && /AI settings page/.test(img.agentFix) && /AI settings/.test(img.fix) && img.settingsUrl === `${BASE}/v1/profile?tab=ai&open=ai-providers`, `tool answer: ${JSON.stringify(img)}`);
    });

    await test('3. an owner provider that is not tested yet: UNTESTED, and the provider test of speech and embeddings works', async () => {
      assert((await put(a, 'my-openai', openaiAll())).status === 200, 'put my-openai');
      assert((await setKey(a, 'my-openai', 'sk-openai-a')).status === 200, 'key');
      const before = (await caps(a.token)).body.data.capabilities;
      assert(before.text.on === false && before.text.reason === 'UNTESTED', `text: ${JSON.stringify(before.text)}`);
      // The person is led to the test (Jouni 2026-10-02): a sentence for them with no tool names, a
      // link that opens this provider at its text test, and the tool for an AI in agentFix.
      assert(before.text.fix.includes('My OpenAI') && before.text.fix.includes('Test now') && !/aimeat_|\{/.test(before.text.fix), `person's fix: ${before.text.fix}`);
      assert(before.text.settingsUrl === `${BASE}/v1/profile?tab=ai&open=ai-provider-my-openai&test=text`, `settingsUrl: ${before.text.settingsUrl}`);
      assert(before.text.testProvider?.id === 'my-openai' && before.text.testProvider.capability === 'text', `testProvider: ${JSON.stringify(before.text.testProvider)}`);
      assert(/aimeat_ai_provider_test/.test(before.text.agentFix), `agentFix: ${before.text.agentFix}`);
      // In the person's language: the interface's cookie first, then the browser's.
      const fi = (await json('/v1/ai/capabilities', { headers: { ...auth(a.token), 'accept-language': 'fi-FI,fi;q=0.9' } })).body.data.capabilities.text;
      assert(fi.fix.startsWith('Tekoälyn tarjoajaasi My OpenAI ei ole vielä testattu.') && fi.fix.includes('Testaa nyt'), `fi fix: ${fi.fix}`);
      const es = (await json('/v1/ai/capabilities', { headers: { ...auth(a.token), 'accept-language': 'fi', cookie: 'aimeat-lang=es' } })).body.data.capabilities.text;
      assert(es.fix.includes('aún no se ha probado'), `es fix (cookie over browser): ${es.fix}`);
      // A refused call carries the same in error.details, for an app to show.
      const refused = await json('/v1/ai/complete', { method: 'POST', headers: { ...auth(a.token), 'accept-language': 'fi' }, body: JSON.stringify({ prompt: 'One word.', app_id: 'cap-e2e' }) });
      const d = refused.body?.error?.details ?? {};
      assert(refused.status === 400 && refused.body.error.code === 'AI_CAPABILITY_UNAVAILABLE' && d.reason === 'UNTESTED', `refusal: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
      assert(d.fix.includes('Testaa nyt') && d.settingsUrl === before.text.settingsUrl && /aimeat_ai_provider_test/.test(d.agentFix), `refusal details: ${JSON.stringify(d)}`);
      for (const capability of ['text', 'embed', 'speech']) {
        const t = await json('/v1/ai/providers/my-openai/test', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ capability }) });
        assert(t.status === 200 && t.body.data.ok === true, `${capability} test ${t.status}: ${JSON.stringify(t.body?.error ?? t.body?.data)}`);
      }
      assert(stub.requestsFor('embeddings').length >= 1 && stub.requestsFor('speech').length >= 1, 'the embedding and speech tests reached the provider');
      const after = (await caps(a.token)).body.data.capabilities;
      assert(after.text.on === true && after.embed.on === true && after.speech.on === true, `after the tests: text ${after.text.on}, embed ${after.embed.on}, speech ${after.speech.on}`);
      assert(after.image.on === false && after.image.reason === 'UNTESTED', `image still untested: ${JSON.stringify(after.image)}`);
    });

    await test('4. PASS: with every capability on, the answer names the model, the provider and the catalogue price, and a picture is made', async () => {
      assert((await routing(a, { rules: { onlyTested: false } })).status === 200, 'rules');
      const r = (await caps(a.token)).body.data;
      for (const cap of ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed']) {
        assert(r.capabilities[cap].on === true, `${cap} on: ${JSON.stringify(r.capabilities[cap])}`);
      }
      assert(r.capabilities.text.model === 'openai:gpt-5.4' && r.capabilities.text.provider === 'my-openai' && r.capabilities.text.keySource === 'own', `text: ${JSON.stringify(r.capabilities.text)}`);
      assert(r.capabilities.text.price?.inPerMtok === 2.5 && r.capabilities.embed.price?.inPerMtok === 0.02, `prices: ${JSON.stringify(r.capabilities.text.price)} ${JSON.stringify(r.capabilities.embed.price)}`);
      assert(r.budget.keySource === 'own' && typeof r.budget.dailyBudgetUsd === 'number', `budget: ${JSON.stringify(r.budget)}`);
      const img = await json('/v1/ai/image', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ prompt: 'A blue square.', app_id: 'cap-e2e' }) });
      assert(img.status === 200 && typeof img.body.data.storage_key === 'string', `image ${img.status}: ${JSON.stringify(img.body?.error)}`);
      assert(stub.lastRequest('images')?.headers.authorization === 'Bearer sk-openai-a', 'the picture was made with the owner\'s key');
      // A private picture carries a signed address that loads with no sign-in, so an app holding
      // only ai:use can show it (found by the V5 browser check).
      assert(typeof img.body.data.download_url === 'string' && img.body.data.download_expires_in_seconds === 3600, `download_url: ${JSON.stringify(img.body.data)}`);
      const shown = await fetch(img.body.data.download_url);
      assert(shown.status === 200 && (shown.headers.get('content-type') ?? '').startsWith('image/'), `the signed address loads: ${shown.status} ${shown.headers.get('content-type')}`);
      const plain = await fetch(`${BASE}${img.body.data.url}`);
      assert(plain.status === 401, `the plain url still needs a sign-in: ${plain.status}`);
    });

    await test('5. NO_KEY and NO_MODEL: a provider without its key, and a capability listed with no model', async () => {
      assert((await put(c, 'c-openai', {
        title: 'C OpenAI', type: 'openai',
        capabilities: { text: { enabled: true, model: 'gpt-5.4', pool: true }, transcription: { enabled: true, pool: false } },
      })).status === 200, 'put c-openai');
      assert((await routing(c, { defaults: { transcription: ['c-openai'] } })).status === 200, 'routing');
      const r = (await caps(c.token)).body.data.capabilities;
      assert(r.text.on === false && r.text.reason === 'NO_KEY' && /never ask for a key in chat/i.test(r.text.agentFix) && r.text.fix.includes('no key'), `text: ${JSON.stringify(r.text)}`);
      assert(r.transcription.on === false && r.transcription.reason === 'NO_MODEL', `transcription: ${JSON.stringify(r.transcription)}`);
      assert(r.image.reason === 'NO_PROVIDER_SUPPORTS', `image: ${JSON.stringify(r.image)}`);
    });

    await test('6. POLICY_EMPTY: a custom list of one text model leaves pictures with no model', async () => {
      assert((await setPolicy(a, { mode: 'custom', allow: ['openai:gpt-5.4'] })).status === 200, 'policy');
      try {
        const r = (await caps(a.token)).body.data;
        assert(r.capabilities.text.on === true, `text stays on: ${JSON.stringify(r.capabilities.text)}`);
        assert(r.capabilities.image.on === false && r.capabilities.image.reason === 'POLICY_EMPTY' && /aimeat_ai_policy_set/.test(r.capabilities.image.agentFix), `image: ${JSON.stringify(r.capabilities.image)}`);
        assert(r.policy.mode === 'custom' && r.policy.appliesToCaller === true, `policy: ${JSON.stringify(r.policy)}`);
      } finally {
        await setPolicy(a, { mode: 'open' });
      }
    });

    await test('7. BUDGET_EXHAUSTED and APP_NOT_ALLOWED', async () => {
      assert((await settings(a, { daily_budget_usd: 0 })).status === 200, 'budget 0');
      try {
        const r = (await caps(a.token)).body.data.capabilities;
        assert(r.text.on === false && r.text.reason === 'BUDGET_EXHAUSTED', `text: ${JSON.stringify(r.text)}`);
      } finally { await settings(a, { daily_budget_usd: 5 }); }
      assert((await settings(a, { app_allowlist: ['another-app'] })).status === 200, 'allowlist');
      try {
        const r = (await caps(a.token, '?app_id=cap-app')).body.data.capabilities;
        assert(r.text.on === false && r.text.reason === 'APP_NOT_ALLOWED', `text for cap-app: ${JSON.stringify(r.text)}`);
      } finally { await settings(a, { app_allowlist: null }); }
    });

    await test('8. an agent reads its own answer, and an app\'s prefer.text orders the owner\'s providers', async () => {
      const agent = await connectAgent(a, 'capagent', ['ai:use']);
      const byAgent = (await caps(agent)).body.data.capabilities;
      assert(byAgent.text.on === true && byAgent.text.provider === 'my-openai', `agent text: ${JSON.stringify(byAgent.text)}`);
      assert((await put(a, 'my-anthropic', { title: 'My Anthropic', type: 'anthropic', capabilities: { text: { enabled: true, model: 'claude-opus-5-5', pool: true } } })).status === 200, 'put my-anthropic');
      assert((await setKey(a, 'my-anthropic', 'sk-ant-a')).status === 200, 'anthropic key');
      // The owner's own order puts OpenAI first; the app's preference must move Anthropic ahead of it.
      assert((await routing(a, { defaults: { text: ['my-openai', 'my-anthropic'] } })).status === 200, 'owner order');
      const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="ai:use">'
        + '<meta name="aimeat-ai" content="generates=text; discloses=yes; prefer.text=anthropic"></head><body>prefer</body></html>';
      const { token } = await publishApp(a, 'cap-prefer.html', html);
      const byApp = (await caps(token)).body.data.capabilities;
      assert(byApp.text.provider === 'my-anthropic' && byApp.text.chosenBy === 'app-prefer', `app text: ${JSON.stringify(byApp.text)}`);
      const byOwner = (await caps(a.token)).body.data.capabilities;
      assert(byOwner.text.provider === 'my-openai', `owner text stays: ${JSON.stringify(byOwner.text)}`);
      const call = await json('/v1/ai/complete', { method: 'POST', headers: auth(token), body: JSON.stringify({ prompt: 'One word.' }) });
      assert(call.status === 200 && call.body.data.route.answeredBy.provider === 'my-anthropic', `the app's call went to anthropic: ${JSON.stringify(call.body?.data?.route ?? call.body?.error)}`);
    });

    await test('9. files in a text call reach the model as a file part; an https URL is refused', async () => {
      const pdf = `data:application/pdf;base64,${b64('%PDF-1.4 stub')}`;
      const r = await json('/v1/ai/complete', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ prompt: 'What does it say?', files: [{ data_url: pdf, filename: 'a.pdf' }], provider: 'my-openai' }) });
      assert(r.status === 200 && r.body.data.route.capability === 'files', `files call ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.route)}`);
      const sent = stub.lastRequest('chat')?.body ?? '';
      assert(sent.includes('"file"') && sent.includes(b64('%PDF-1.4 stub')), `the file reached the provider: ${sent.slice(0, 300)}`);
      const bad = await json('/v1/ai/complete', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ prompt: 'x', files: [{ data_url: 'https://example.com/a.pdf' }] }) });
      assert(bad.status === 400 && bad.body.error.code === 'INVALID_BODY', `https refused: ${bad.status} ${JSON.stringify(bad.body?.error)}`);
    });

    await test('10. speech without a model or a voice uses the provider\'s; with no voice anywhere it is NO_TTS_VOICE', async () => {
      const r = await json('/v1/ai/speak?json=1', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ app_id: 'cap-e2e', input: 'hei' }) });
      assert(r.status === 200, `speak ${r.status}: ${JSON.stringify(r.body?.error ?? r.body)}`);
      const sent = stub.lastRequest('speech')?.json ?? {};
      assert(sent.model === 'tts-1' && sent.voice === 'alloy', `sent: ${JSON.stringify(sent)}`);
      assert((await put(a, 'my-openai', openaiAll({ enabled: true, model: 'tts-1', pool: true }))).status === 200, 'provider without a voice');
      const none = await json('/v1/ai/speak?json=1', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ app_id: 'cap-e2e', input: 'hei' }) });
      assert(none.status === 400 && none.body.error.code === 'NO_TTS_VOICE', `no voice: ${none.status} ${JSON.stringify(none.body?.error)}`);
    });

    // aiprov plan, workstream A, on speech: what the PCM is (A4), the voice checked before the paid
    // call (A6), an mp3 refusal named as one (A1) and the owner's speech fallback (A5).
    await test('10b. speech: an OpenRouter TTS model says its PCM layout, refuses a voice it lacks before calling, names an mp3 refusal, and falls back when the owner allows another voice', async () => {
      const e = await setupOwner('e');
      const gemini = 'google/gemini-3.8-flash-tts';
      assert((await put(e, 'e-or', { title: 'E OpenRouter', type: 'openrouter', capabilities: { speech: { enabled: true, model: gemini, voice: 'Kore', pool: true } } })).status === 200, 'put e-or');
      assert((await setKey(e, 'e-or', 'sk-or-e')).status === 200, 'e-or key');
      assert((await routing(e, { rules: { onlyTested: false } })).status === 200, 'rules');
      const speak = (body: Record<string, unknown>, q = '') => json(`/v1/ai/speak${q}`, { method: 'POST', headers: auth(e.token), body: JSON.stringify({ app_id: 'cap-e2e', input: 'hei', ...body }) });

      // A4: OpenRouter's PCM is 24000 Hz mono s16le, said on the start and done frames and the json=1 result.
      stub.queue('speech', speechPcm(4800));
      const streamed = await fetch(`${BASE}/v1/ai/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(e.token) }, body: JSON.stringify({ app_id: 'cap-e2e', input: 'hei', response_format: 'pcm' }) });
      const frames = (await streamed.text()).trim().split('\n').map(l => JSON.parse(l));
      const pcm = JSON.stringify({ mime: 'audio/pcm', sample_rate: 24000, channels: 1, sample_format: 's16le' });
      assert(streamed.status === 200 && JSON.stringify(frames[0].audio) === pcm && JSON.stringify(frames.at(-1).audio) === pcm, `frames: ${JSON.stringify([frames[0], frames.at(-1)])}`);
      assert((stub.lastRequest('speech')?.json as any)?.voice === 'Kore', 'the provider\'s voice was sent');
      stub.queue('speech', speechPcm(4800));
      const stored = await speak({ response_format: 'pcm' }, '?json=1');
      assert(stored.status === 200 && JSON.stringify(stored.body.data.audio) === pcm, `json=1: ${JSON.stringify(stored.body?.data?.audio ?? stored.body?.error)}`);

      // A6: a voice the catalogue says the model lacks is refused before anything is sent or paid.
      const heard = stub.requestsFor('speech').length;
      const wrongVoice = await speak({ voice: 'alloy' });
      assert(wrongVoice.status === 400 && wrongVoice.body.error?.code === 'INVALID_VOICE' && wrongVoice.body.error.details?.voices?.includes('Kore'),
        `unknown voice: ${wrongVoice.status} ${JSON.stringify(wrongVoice.body?.error)}`);
      assert(stub.requestsFor('speech').length === heard, 'the provider heard nothing');

      // A1: the omnituinen case, mp3 the model does not make, is a refusal that names pcm.
      stub.queue('speech', providerStatus(400, '{"error":{"message":"Provider returned error","metadata":{"raw":"{\\"error\\":{\\"message\\":\\"Unsupported response_format: mp3\\"}}"}}}'));
      const mp3 = await speak({ response_format: 'mp3' });
      assert(mp3.status === 422 && mp3.body.error?.code === 'PROVIDER_REJECTED' && /Unsupported response_format: mp3/.test(mp3.body.error.details?.provider_message ?? '')
        && /pcm/.test(mp3.body.error.details?.hint ?? ''), `mp3: ${mp3.status} ${JSON.stringify(mp3.body?.error)}`);

      // A5: with another voice allowed, a provider that fails moves to the next one, before the first byte.
      assert((await put(e, 'e-oa', openaiAll())).status === 200, 'put e-oa');
      assert((await setKey(e, 'e-oa', 'sk-e-openai')).status === 200, 'e-oa key');
      assert((await routing(e, { defaults: { speech: ['e-or', 'e-oa'] }, rules: { onlyTested: false, speechVoiceMayChange: true } })).status === 200, 'fallback rules');
      stub.queue('speech', providerStatus(503, '{"error":{"message":"upstream overloaded"}}'), r => r.pathname.startsWith('/v1/or'));
      const moved = await speak({ response_format: 'mp3' }, '?json=1');
      assert(moved.status === 200, `fallback: ${moved.status} ${JSON.stringify(moved.body?.error)}`);
      const route = moved.body.data.route;
      assert(route?.fellBack === true && route.answeredBy?.provider === 'e-oa' && route.attempts?.[0]?.provider === 'e-or', `route: ${JSON.stringify(route)}`);
      assert((stub.lastRequest('speech')?.json as any)?.voice === 'alloy', 'the second provider\'s voice was used');
    });

    await test('11. GET /v1/ai/available reads the provider records', async () => {
      const yes = await json('/v1/ai/available', { headers: auth(a.token) });
      const no = await json('/v1/ai/available', { headers: auth(b.token) });
      assert(yes.body.data.available === true && no.body.data.available === false, `a ${yes.body.data?.available}, b ${no.body.data?.available}`);
    });

    await test('12. publishing an app that makes pictures without checking first gets the hint', async () => {
      const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="ai:use">'
        + '<meta name="aimeat-ai" content="generates=image; discloses=yes"></head><body><script>'
        + 'async function go(){ const r = await AIMEAT.ai.image({ app_id: "x", prompt: "p", model: "openai:gpt-image-2" }); AIMEAT.ai.disclose(r.provenance); }'
        + '</script></body></html>';
      const { publish } = await publishApp(a, 'cap-hints.html', html);
      const hints: string[] = publish.ai_hints ?? [];
      assert(hints.some(h => h.includes('AIMEAT.ai.capabilities()')), `check-first hint: ${JSON.stringify(hints)}`);
      assert(hints.some(h => h.includes('declares no models')), `declare-models hint: ${JSON.stringify(hints)}`);
    });

    await test('13. RETIRED_MODEL: the model a provider uses retires in the catalogue', async () => {
      const d = await setupOwner('d');
      assert((await put(d, 'd-or', { title: 'D OpenRouter', type: 'openrouter', capabilities: { text: { enabled: true, model: 'google/gemini-2.5-flash', pool: true } } })).status === 200, 'put d-or');
      assert((await setKey(d, 'd-or', 'sk-or-d')).status === 200, 'key');
      assert((await routing(d, { rules: { onlyTested: false } })).status === 200, 'rules');
      assert((await caps(d.token)).body.data.capabilities.text.on === true, 'on before the retirement');
      const or = structuredClone(samples.openRouter) as { data: Array<Record<string, unknown>> };
      for (const m of or.data) if (m.id === 'google/gemini-2.5-flash') m.expiration_date = '2026-09-01';
      serving.openRouter = or;
      const refresh = await json('/v1/admin/ai/catalog/refresh', { method: 'POST', headers: auth(op.token) });
      assert(refresh.status === 200 && refresh.body.data.written === true, `refresh: ${JSON.stringify(refresh.body)}`);
      const r = (await caps(d.token)).body.data.capabilities;
      assert(r.text.on === false && r.text.reason === 'RETIRED_MODEL' && /aimeat_ai_models/.test(r.text.agentFix), `text: ${JSON.stringify(r.text)}`);
    });
  } finally {
    await stopServer(server);
    await stub.close();
    sourceServer.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

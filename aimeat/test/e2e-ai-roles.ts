/**
 * @file test/e2e-ai-roles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI roles end to end (wish-tekoalyn-roolit, brief-tekoalyn-roolit): the owner's roles and
 *   their checks, a call running as a role, an app's declared role refused until the owner binds it and
 *   then running with the app's fine-tuning, the request the owner sees, an agent proposing a binding
 *   the owner confirms, an app never binding, the reserved keys, and the provider's default fine-tuning
 *   under the call's own.
 *
 *   Its own node on 40444, whose fixed provider types point at the fake provider
 *   (test/helpers/fake-ai-provider.ts). The catalogue sources are a closed port: nothing is fetched.
 *   The models are gpt-4.1: the AI SDK's OpenAI adapter drops temperature for a reasoning model
 *   (gpt-5 and the o-series), so fine-tuning is only seen on the wire for a model that is not one.
 *
 *   PASS CRITERION: an app's role does not run until the owner (or their AI, confirmed) binds it, and
 *   then it runs on the providers and models of the owner's role with the app's fine-tuning.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-roles.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, chatJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_ROLES_PORT ?? '40444';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const REDIRECT = 'http://localhost:9912/callback';

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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── the node ─────────────────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-roles-'));
const DB_PATH = join(dbDir, 'ai-roles.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(stub: FakeAiProvider): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const closed = 'http://127.0.0.1:9/none';
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_OPENROUTER_INSTANCE_KEY: '',
    AIMEAT_AI_CATALOG_SOURCES: JSON.stringify({ modelsDev: closed, openRouter: closed, liteLlm: closed }),
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openai: `${stub.baseUrl}/openai`, openrouter: `${stub.baseUrl}/or` }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI roles node' });
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
  const name = `airole${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Roles', password: 'AiRoles12345678' }) });
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

/** Publish an app and take an app-grant token with ai:use for it. */
async function publishApp(owner: Owner, filename: string, html: string): Promise<string> {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename, content: b64(html), name: `Roles ${filename}`, description: 'roles e2e probe', category: 'utility' }),
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
  return tok.body.data.access_token as string;
}

const APP_HTML = `<!doctype html><html><head><title>Recipes</title>
<meta name="aimeat-scopes" content="ai:use">
<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no; role.summarizer=text; role.summarizer.purpose=Short recipe summaries; role.summarizer.temperature=0.3; role.bad=teleport">
</head><body>recipes</body></html>`;

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── AI roles ──');
  const stub = await startFakeAiProvider(0);
  stub.setDefault('chat', (r) => chatJson(`answered by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
  const server = await startServer(stub);

  try {
    await setupOwner('op');                  // the first account on a fresh node is the operator
    const a = await setupOwner('a');
    const roles = (t: string) => json('/v1/ai/roles', { headers: auth(t) });
    const putRoles = (t: string, body: Record<string, unknown>) => json('/v1/ai/roles', { method: 'PUT', headers: auth(t), body: JSON.stringify(body) });
    const complete = (t: string, body: Record<string, unknown>) => json('/v1/ai/complete', { method: 'POST', headers: auth(t), body: JSON.stringify({ prompt: 'Say hello.', ...body }) });
    const lastChat = () => stub.lastRequest('chat')?.json as Record<string, unknown> | undefined;

    const put = await json('/v1/ai/providers/my-openai', {
      method: 'PUT', headers: auth(a.token),
      body: JSON.stringify({ title: 'My OpenAI', type: 'openai', capabilities: { text: { enabled: true, model: 'gpt-4.1', pool: true } } }),
    });
    assert(put.status === 200, `provider ${put.status}: ${JSON.stringify(put.body?.error)}`);
    assert((await json('/v1/ai/providers/my-openai/key', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ api_key: 'sk-a' }) })).status === 200, 'key');
    // The node picks by capability alone only tested providers; the owner's defaults name this one.
    assert((await json('/v1/ai/routing', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ routing: { rules: { onlyTested: false } } }) })).status === 200, 'rules');

    await test('1. the two built-in roles are always there, and an owner with no apps has no app roles', async () => {
      const r = await roles(a.token);
      assert(r.status === 200, `GET roles ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const ids = r.body.data.roles.map((x: any) => x.id);
      assert(ids.includes('reasoning') && ids.includes('execution'), `built-in roles: ${ids}`);
      assert(r.body.data.roles.every((x: any) => x.id !== 'reasoning' || x.builtIn === true), 'built-in is marked');
      assert(Array.isArray(r.body.data.apps) && r.body.data.apps.length === 0, `apps: ${JSON.stringify(r.body.data.apps)}`);
    });

    await test('2. a role that does not check is refused with every problem named, and a built-in role cannot be removed', async () => {
      const r = await putRoles(a.token, { roles: {
        writer: { title: 'Writer', capabilities: { text: [{ provider: 'nope' }, { provider: 'my-openai' }, { provider: 'my-openai' }], teleport: [] } },
        reasoning: null,
      } });
      assert(r.status === 400 && r.body.error.code === 'AI_ROLES_INVALID', `status ${r.status} ${r.body?.error?.code}`);
      const problems: string[] = r.body.error.details.problems;
      assert(problems.some(p => /nope is not a provider/.test(p)), `unknown provider named: ${problems}`);
      assert(problems.some(p => /listed twice/.test(p)), `duplicate named: ${problems}`);
      assert(problems.some(p => /teleport: not a capability/.test(p)), `bad capability named: ${problems}`);
      assert(problems.some(p => /built-in role cannot be removed/.test(p)), `built-in named: ${problems}`);
    });

    await test('3. a call as the owner\'s role runs on the role\'s provider and model, untested or not', async () => {
      const r = await putRoles(a.token, { roles: { writer: { title: 'Writer', purpose: 'Drafts', capabilities: { text: [{ provider: 'my-openai', model: 'gpt-4.1-mini' }] } } } });
      assert(r.status === 200 && r.body.data.mode === 'applied', `put ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert((await json('/v1/ai/routing', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ routing: { rules: { onlyTested: true } } }) })).status === 200, 'only tested');
      const c = await complete(a.token, { role: 'writer' });
      assert(c.status === 200, `complete ${c.status}: ${JSON.stringify(c.body?.error)}`);
      assert(lastChat()?.model === 'gpt-4.1-mini', `model sent: ${lastChat()?.model}`);
      assert(c.body.data.route?.chosenBy === 'role', `chosen by: ${JSON.stringify(c.body.data.route)}`);
      assert((await json('/v1/ai/routing', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ routing: { rules: { onlyTested: false } } }) })).status === 200, 'rules back');
    });

    await test('4. an unknown role and a role without the capability are refused with the fix', async () => {
      const u = await complete(a.token, { role: 'ghost' });
      assert(u.status === 400 && u.body.error.code === 'AI_ROLE_UNKNOWN', `unknown ${u.status} ${u.body?.error?.code}`);
      const i = await json('/v1/ai/image', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ prompt: 'A square.', role: 'writer', app_id: 'roles-e2e' }) });
      assert(i.status === 400 && i.body.error.code === 'AI_ROLE_LACKS_CAPABILITY', `image ${i.status} ${i.body?.error?.code}`);
    });

    let appToken = '';
    const binding = () => `${a.name}/recipes.html#summarizer`;
    await test('5. PASS: an app\'s declared role does not run before the owner binds it, and the owner sees the request', async () => {
      appToken = await publishApp(a, 'recipes.html', APP_HTML);
      const before = stub.requestsFor('chat').length;
      const c = await complete(appToken, { role: 'summarizer' });
      assert(c.status === 409 && c.body.error.code === 'AI_ROLE_NOT_BOUND', `unbound ${c.status} ${c.body?.error?.code}: ${c.body?.error?.message}`);
      assert(stub.requestsFor('chat').length === before, 'nothing reached a provider');
      let app: any;
      for (let i = 0; i < 20 && !app?.roles?.[0]?.requestedAt; i++) {
        app = (await roles(a.token)).body.data.apps.find((x: any) => x.app === `${a.name}/recipes.html`);
        if (!app?.roles?.[0]?.requestedAt) await sleep(100);
      }
      const s = app?.roles?.find((x: any) => x.name === 'summarizer');
      assert(!!s && s.boundTo === null && typeof s.requestedAt === 'string', `the owner sees the request: ${JSON.stringify(app)}`);
      assert(s.purpose === 'Short recipe summaries' && s.capabilities.join() === 'text' && s.params?.temperature === 0.3, `what the app needs: ${JSON.stringify(s)}`);
      assert(!app.roles.some((x: any) => x.name === 'bad'), 'an unreadable role is left out');
      const caps = await json('/v1/ai/capabilities', { headers: auth(appToken) });
      const cr = caps.body.data.roles?.find((x: any) => x.name === 'summarizer');
      assert(cr?.bound === false && /connects the role/.test(cr.fix), `capabilities say unbound: ${JSON.stringify(caps.body.data.roles)}`);
    });

    await test('6. an app never binds its own role', async () => {
      const r = await putRoles(appToken, { bindings: { [binding()]: 'writer' } });
      assert(r.status === 403, `app PUT roles ${r.status}`);
      const w = await json('/v1/memory', { method: 'POST', headers: auth(appToken), body: JSON.stringify({ key: 'ai.roles.owner', value: { roles: {}, bindings: { [binding()]: { role: 'writer' } } }, visibility: 'private' }) });
      assert(w.status === 403, `memory write of ai.roles.owner by the app: ${w.status}`);
      const c = await complete(appToken, { role: 'summarizer' });
      assert(c.status === 409, `still unbound: ${c.status}`);
    });

    await test('7. an agent proposes the binding, the owner confirms, and the app\'s role runs with its fine-tuning', async () => {
      const agent = await connectAgent(a, 'rolebot', ['ai:use', 'memory:write-reserved']);
      const p = await putRoles(agent, { bindings: { [binding()]: 'writer' } });
      assert(p.status === 200 && p.body.data.mode === 'proposal' && typeof p.body.data.confirm_token === 'string', `proposal ${p.status}: ${JSON.stringify(p.body?.error ?? p.body?.data?.mode)}`);
      assert((await complete(appToken, { role: 'summarizer' })).status === 409, 'a proposal binds nothing');
      const ok = await putRoles(agent, { bindings: { [binding()]: 'writer' }, confirm_token: p.body.data.confirm_token });
      assert(ok.status === 200 && ok.body.data.mode === 'applied', `confirm ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
      const c = await complete(appToken, { role: 'summarizer' });
      assert(c.status === 200, `bound ${c.status}: ${JSON.stringify(c.body?.error)}`);
      assert(lastChat()?.model === 'gpt-4.1-mini' && lastChat()?.temperature === 0.3, `model ${lastChat()?.model}, temperature ${lastChat()?.temperature}`);
      const caps = await json('/v1/ai/capabilities', { headers: auth(appToken) });
      assert(caps.body.data.roles?.find((x: any) => x.name === 'summarizer')?.bound === true, 'capabilities say bound');
      const d = await complete(appToken, { role: 'other' });
      assert(d.status === 400 && d.body.error.code === 'AI_ROLE_NOT_DECLARED', `undeclared ${d.status} ${d.body?.error?.code}`);
    });

    await test('8. the provider\'s default fine-tuning applies, and the call\'s own wins over it', async () => {
      const p = await json('/v1/ai/providers/my-openai', {
        method: 'PUT', headers: auth(a.token),
        body: JSON.stringify({ title: 'My OpenAI', type: 'openai', capabilities: { text: { enabled: true, model: 'gpt-4.1', pool: true, params: { temperature: 0.9, max_tokens: 700 } } } }),
      });
      assert(p.status === 200, `params ${p.status}: ${JSON.stringify(p.body?.error)}`);
      const bad = await json('/v1/ai/providers/my-openai', {
        method: 'PUT', headers: auth(a.token),
        body: JSON.stringify({ title: 'My OpenAI', type: 'openai', capabilities: { text: { enabled: true, model: 'gpt-4.1', params: { temperature: 7 } } } }),
      });
      assert(bad.status === 400 && /temperature/.test(bad.body.error.message), `bad params ${bad.status}`);
      assert((await complete(a.token, {})).status === 200, 'plain call');
      assert(lastChat()?.temperature === 0.9, `provider default: ${lastChat()?.temperature}`);
      assert((await complete(a.token, { temperature: 0.1 })).status === 200, 'call with its own');
      assert(lastChat()?.temperature === 0.1, `the call's own: ${lastChat()?.temperature}`);
      assert((await complete(appToken, { role: 'summarizer' })).status === 200, 'app role');
      assert(lastChat()?.temperature === 0.3, `the app's own for its role: ${lastChat()?.temperature}`);
    });

    await test('9. removing the owner\'s role removes its bindings, and the app\'s role stops', async () => {
      const r = await putRoles(a.token, { roles: { writer: null } });
      assert(r.status === 200, `remove ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(Object.keys(r.body.data.roles.bindings).length === 0, `bindings left: ${JSON.stringify(r.body.data.roles.bindings)}`);
      const c = await complete(appToken, { role: 'summarizer' });
      assert(c.status === 409 && c.body.error.code === 'AI_ROLE_NOT_BOUND', `after removal ${c.status} ${c.body?.error?.code}`);
    });

    await test('10. a role\'s last use is noted', async () => {
      assert((await putRoles(a.token, { roles: { brief: { title: 'Brief', capabilities: { text: [{ provider: 'my-openai' }] } } } })).status === 200, 'role');
      assert((await complete(a.token, { role: 'brief' })).status === 200, 'call');
      let used: string | undefined;
      for (let i = 0; i < 20 && !used; i++) {
        used = (await roles(a.token)).body.data.roles.find((x: any) => x.id === 'brief')?.lastUsedAt;
        if (!used) await sleep(100);
      }
      assert(typeof used === 'string', 'lastUsedAt is set');
    });
  } finally {
    await stopServer(server);
    await stub.close();
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * @file test/e2e-ai-extension-provider.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An installed extension as an AI provider, end to end (System 2 plan, V6; docs/internal/
 *   llmproviderintegrations/08, section 7): text, embeddings and speech through the extension's ai.*
 *   actions and the node's gate (usage recorded, provenance made); the owner's key reaches only the
 *   host the manifest lists, the script never sees it, an unlisted host is refused and a redirect to
 *   another origin drops the key; another owner's extension is refused 403; a manifest or a provider
 *   that does not fit is refused, naming what to fix.
 *
 *   Its own node on 40443, and a small service on this machine that records what it received; the
 *   manifest lists `localhost`, and the script also tries 127.0.0.1, the same machine under another
 *   name, which the provider run must refuse.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-extension-provider.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V6 of the System 2 plan).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_EXTENSION_PROVIDER_PORT ?? '40443';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const SECRET = 'sk-extension-provider-secret-7731';

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

// ── the outside service the extension calls ───────────────────────────────────

interface Seen { method: string; path: string; host: string; authorization: string | undefined; body: string }
const seen: Seen[] = [];
async function startService(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', path: req.url ?? '', host: String(req.headers.host ?? ''), authorization: req.headers.authorization, body });
      const send = (status: number, value: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(value));
      };
      if (req.url === '/chat') return send(200, { echo: (JSON.parse(body || '{}') as { text?: string }).text ?? '' });
      if (req.url === '/speak') return send(200, { audio: Buffer.from('ID3-extension-audio').toString('base64') });
      if (req.url === '/redirect') { res.writeHead(302, { location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/landing` }).end(); return; }
      return send(200, { ok: true });
    });
  });
  // No host: both loopback families, so `localhost` and 127.0.0.1 both reach it.
  await new Promise<void>(r => server.listen(0, r));
  return { server, port: (server.address() as AddressInfo).port };
}

// ── the node ─────────────────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-extension-provider-'));
const DB_PATH = join(dbDir, 'ai-extension-provider.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_OPENROUTER_INSTANCE_KEY: '', AIMEAT_EXT_TIMEOUT_MS: '15000',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the AI extension provider node' });
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
  const name = `aiext${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI Extension', password: 'AiExtension1234' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
  assert(tok.status === 200, `auth/token ${tok.status}`);
  return { name, token: tok.body.data.token as string };
}

// ── the extension ─────────────────────────────────────────────────────────────

function manifest(name: string, actions: string[], provides: string): string {
  return `
extension: "1.0"
metadata:
  name: "${name}"
  version: "1.0.0"
  description: "An AI provider under test"
  author: "e2e"
required_apis:
  - memory
actions:
${actions.map(a => `  - id: ${a}
    method: POST
    path: "/v1/ext/${name}/${a}"
    script: "actions/${a}.js"`).join('\n')}
limits:
  memory_mb: 16
  timeout_ms: 15000
  max_api_calls: 10
federation:
  advertise: false
${provides}`;
}

const PROVIDES = `provides:
  ai_provider:
    ops: [text, embed, speak]
    models:
      - id: demo-1
        name: Demo model
        price: { in_per_mtok: 1, out_per_mtok: 2 }
    data_statement: "The text goes to the demo service on this machine."
    hosts: [localhost]`;

function scripts(port: number): Record<string, string> {
  return {
    // The script sets its own Authorization, reads what it can of ctx and the answer's headers, tries a
    // host the manifest does not list, and follows a redirect to another origin.
    'actions/ai.text.js': `export default async function(ctx, input) {
  const last = input.messages[input.messages.length - 1];
  const text = typeof last.content === 'string' ? last.content : last.content.map(function (p) { return p.text || ''; }).join('');
  const r = await ctx.fetch('http://localhost:${port}/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'Authorization': 'Bearer from-the-script' }, body: JSON.stringify({ text: text }) });
  const j = JSON.parse(r.text);
  let unlisted = '';
  try { await ctx.fetch('http://127.0.0.1:${port}/other', {}); unlisted = 'REACHED'; } catch (e) { unlisted = String((e && e.message) || e).slice(0, 60); }
  await ctx.fetch('http://localhost:${port}/redirect', {});
  const view = JSON.stringify({ keys: Object.keys(ctx), config: ctx.config || null, caller: ctx.caller || null, headers: r.headers });
  return { text: 'echo:' + j.echo + ' | unlisted:' + unlisted + ' | view:' + view, finishReason: 'stop', usage: { inputTokens: 1000, outputTokens: 500 } };
}`,
    'actions/ai.embed.js': `export default async function(ctx, input) {
  return { embeddings: input.input.map(function (_t, i) { return [i, 0.5, 1]; }), usage: { inputTokens: 3 } };
}`,
    'actions/ai.speak.js': `export default async function(ctx, input) {
  const r = await ctx.fetch('http://localhost:${port}/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: input.text, voice: input.voice }) });
  return { audio: JSON.parse(r.text).audio, mimeType: 'audio/mpeg' };
}`,
  };
}

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── An extension as an AI provider (System 2, V6) ──');
  const { server: service, port } = await startService();
  const server = await startServer();

  try {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const install = (o: Owner, name: string, actions: string[], provides: string, files: Record<string, string>) =>
      json('/v1/extensions', { method: 'POST', headers: auth(o.token), body: JSON.stringify({ manifest: manifest(name, actions, provides), scripts: files }) });
    const put = (o: Owner, id: string, body: Record<string, unknown>) => json(`/v1/ai/providers/${id}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const extName = `demo-ai-${Date.now()}`;

    await test('1. a manifest that declares an op with no ai.<op> action is refused, naming the action', async () => {
      const r = await install(a, `${extName}-bad`, ['ai.text'], PROVIDES, { 'actions/ai.text.js': scripts(port)['actions/ai.text.js'] });
      assert(r.status === 400 && r.body.error.code === 'INVALID_MANIFEST' && /ai\.embed/.test(r.body.error.message), `refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    const inst = await install(a, extName, ['ai.text', 'ai.embed', 'ai.speak'], PROVIDES, scripts(port));
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${extName}/activate`, { method: 'POST', headers: auth(a.token) })).status === 200, 'activate');
    const provider = {
      title: 'Demo extension', type: 'extension', extension: extName,
      capabilities: {
        text: { enabled: true, model: 'demo-1', pool: true }, embed: { enabled: true, model: 'demo-1', pool: true },
        speech: { enabled: true, model: 'demo-1', voice: 'v1', pool: true },
      },
    };

    await test('2. a provider that asks for a capability the extension does not declare is refused', async () => {
      const r = await put(a, 'my-ext', { ...provider, capabilities: { ...provider.capabilities, image: { enabled: true, model: 'demo-1', pool: true } } });
      assert(r.status === 400 && r.body.error.code === 'INVALID_PROVIDER' && /image/.test(r.body.error.message), `refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('3. another owner\'s extension cannot be their provider: 403', async () => {
      const r = await put(b, 'their-ext', provider);
      assert(r.status === 403 && r.body.error.code === 'FORBIDDEN', `cross-owner: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('4. the owner adds it, sets its key, and sees the manifest\'s own statement of where the data goes', async () => {
      assert((await put(a, 'my-ext', provider)).status === 200, 'put my-ext');
      assert((await json('/v1/ai/providers/my-ext/key', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ api_key: SECRET }) })).status === 200, 'key');
      assert((await json('/v1/ai/routing', { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ routing: { defaults: { text: ['my-ext'], embed: ['my-ext'], speech: ['my-ext'] }, rules: { onlyTested: false } } }) })).status === 200, 'routing');
      const view = (await json('/v1/ai/providers', { headers: auth(a.token) })).body.data.providers.find((p: any) => p.id === 'my-ext');
      assert(view?.data_statement === 'The text goes to the demo service on this machine.' && view.extension_provider?.hosts?.[0] === 'localhost', `view: ${JSON.stringify(view)}`);
      assert(!JSON.stringify(view).includes(SECRET), 'the view holds no key');
    });

    await test('5. PASS: a text call runs the extension through the gate: the key reaches the listed host only, the script never sees it', async () => {
      seen.length = 0;
      const r = await json('/v1/ai/complete', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ prompt: 'hello there', app_id: 'ext-e2e' }) });
      assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const content: string = r.body.data.content;
      assert(content.startsWith('echo:hello there'), `answer: ${content.slice(0, 120)}`);
      assert(!content.includes(SECRET), 'the script saw nothing of the key');
      assert(/unlisted:Fetch blocked/.test(content), `an unlisted host is refused: ${content.slice(0, 300)}`);
      const chat = seen.find(s => s.path === '/chat');
      assert(chat?.authorization === `Bearer ${SECRET}`, `the listed host got the owner's key, not the script's: ${chat?.authorization}`);
      assert(!seen.some(s => s.path === '/other'), 'the unlisted host received nothing');
      const landing = seen.find(s => s.path === '/landing');
      assert(!!landing && landing.authorization === undefined, `a redirect to another origin dropped the key: ${JSON.stringify(landing)}`);
      assert(r.body.data.route.answeredBy.provider === 'my-ext', `route: ${JSON.stringify(r.body.data.route)}`);
      // The manifest's price, 1000 in at $1/M and 500 out at $2/M, since the action reported none.
      assert(Math.abs(r.body.data.usage.cost_usd - 0.002) < 1e-9, `cost: ${r.body.data.usage.cost_usd}`);
      assert(typeof r.body.meta?.provenance?.id === 'string', `provenance made: ${JSON.stringify(r.body.meta ?? {})}`);
      const hist = await json('/v1/ai/usage', { headers: auth(a.token) });
      assert(hist.status === 200 && hist.body.data.total_calls >= 1, `usage recorded: ${JSON.stringify(hist.body?.data ?? hist.body?.error).slice(0, 200)}`);
    });

    await test('6. embeddings and speech run the extension\'s ai.embed and ai.speak', async () => {
      const e = await json('/v1/ai/embed', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ input: ['one', 'two'], app_id: 'ext-e2e' }) });
      assert(e.status === 200 && e.body.data.embeddings.length === 2 && e.body.data.dimensions === 3, `embed: ${e.status} ${JSON.stringify(e.body?.error ?? e.body?.data)}`);
      const s = await json('/v1/ai/speak?json=1', { method: 'POST', headers: auth(a.token), body: JSON.stringify({ app_id: 'ext-e2e', input: 'hei' }) });
      assert(s.status === 200, `speak: ${s.status} ${JSON.stringify(s.body?.error ?? s.body)}`);
      assert(seen.some(x => x.path === '/speak' && x.authorization === `Bearer ${SECRET}` && x.body.includes('"voice":"v1"')), 'the speech call reached the service with the key and the provider\'s voice');
    });

    await test('7. the capabilities answer names the extension provider for text', async () => {
      const r = await json('/v1/ai/capabilities', { headers: auth(a.token) });
      const text = r.body.data.capabilities.text;
      assert(text.on === true && text.provider === 'my-ext' && text.model === 'extension:demo-1', `text: ${JSON.stringify(text)}`);
    });
  } finally {
    await stopServer(server);
    service.close();
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

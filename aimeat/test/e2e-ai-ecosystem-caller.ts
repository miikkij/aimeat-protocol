/**
 * @file test/e2e-ai-ecosystem-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An ecosystem app's AI calls, end to end (secaudit2026nov02d round 13, group ai-caller).
 *
 *   An ecosystem app (`eco:<app>#<owner>@<node>`) that the owner approved with ai:use keeps making
 *   text and pictures. What the two leads said, and what this suite holds:
 *   - ai-gen-rules/ecosystem-caller-classed-as-owner: the generation rules took the app for the owner
 *     in person, so its per-call bypass of a rule was accepted and recorded as the owner's, and the
 *     owner's own rule switches were not read for it. Now the app is the owner's app `eco:<app>`: the
 *     owner's rules apply to it, its bypass is refused, and the owner may exempt it by that name.
 *   - agent-ai-keys.ts:aiPayerOf:geai-payer-is-own-namespace: the app paid from its own `eco:`
 *     namespace, with a node-key allowance of its own and outside the owner's budget and usage. Now its
 *     owner pays: the owner's allowance falls, the owner's usage names the app, the owner's daily
 *     budget holds it. Its pictures stay in its own namespace, as before.
 *
 *   NOTHING INSIDE THE NODE IS MOCKED. The provider is test/helpers/fake-ai-provider.ts on loopback;
 *   the node's OpenRouter address points at it (AIMEAT_AI_FIXED_BASEURL_OVERRIDES, accepted on a node
 *   that is not public), so the node's key pays for the owner and, before the fix, for the app.
 *
 *   PASS CRITERION: with people-artistic on for the owner, the app's picture carries the directive and
 *   its bypass is refused 403 GEN_RULE_BYPASS_REFUSED before the provider hears anything; the app's
 *   text call lowers the owner's allowance and appears in the owner's usage as `eco:<app>`; the owner's
 *   spent daily budget refuses the app's next call 402; the app still gets its answers and reads its
 *   picture from its own storage.
 * @structure
 *   - the node under test: the run's backend, its own port, a node key on the stub, a small allowance
 *   - U1-U5: the uses that keep working
 *   - A1-A5: the two leads
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-ecosystem-caller
 * @version-history
 *   v1.0.0 -- 2026-11-02 -- Initial (secaudit2026nov02d round 13).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { startFakeAiProvider, chatJson, imageJson, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';
import { GEN_RULES } from '../src/services/ai/gen-rules.js';

// Its own port, in the suites' fixed band (scripts/check-suite-ports.ts); the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_ECOSYSTEM_CALLER_PORT ?? '29397';
const BASE = `http://localhost:${PORT}`;
const NODE_KEY = 'sk-node-e2e-eco-caller-never-billed';
const NODE_MODEL = 'openai/gpt-4o';
const IMAGE_MODEL = 'stub/node-image-model';
const ALLOWANCE = 0.1;
const RULE = 'people-artistic';
const DIRECTIVE = GEN_RULES.find(r => r.id === RULE)!.directive.image;
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** A PNG signature and IHDR chunk header: enough for the node's sniffer. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0, 0, 4, 0, 0, 0, 4, 0, 8, 6, 0, 0, 0, 9, 9, 9]),
]);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

/** The first provenance record anywhere in an answer. */
function recordIn(v: unknown): any {
  if (!v || typeof v !== 'object') return undefined;
  if ((v as any).spec === 'aimeat.provenance/v1') return v;
  for (const x of Object.values(v as Record<string, unknown>)) { const r = recordIn(x); if (r) return r; }
  return undefined;
}

// ── the node ──────────────────────────────────────────────────────────────────
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-eco-caller-'));
const DB_PATH = join(dbDir, 'eco-caller.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startNode(stub: FakeAiProvider): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    // The node's key on the stub, a small allowance per account, a chat and an image model of the node's.
    AIMEAT_OPENROUTER_INSTANCE_KEY: NODE_KEY,
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: String(ALLOWANCE),
    AIMEAT_MODEL_DEFAULT_CHAT: NODE_MODEL,
    AIMEAT_MODEL_DEFAULT_IMAGE: IMAGE_MODEL,
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openrouter: `${stub.baseUrl}/node-or` }),
    // A fresh node: every generation rule off, so each owner decides.
    AIMEAT_AI_GEN_RULES: '',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the ecosystem-caller node' });
}

async function stopNode(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

/** Hello, the owner's approval with these scopes, and the token: the ecosystem app's session. */
async function connectEcoApp(owner: { name: string; token: string }, app: string, scopes: string[]): Promise<{ geai: string; token: string }> {
  const hello = await json('/v1/ecosystem-apps/hello', '', { method: 'POST', body: JSON.stringify({ owner: owner.name, app, public_key: Buffer.from(`vk-${app}`).toString('base64'), scopes }) });
  assert(hello.body.ok === true, `hello ${app}: ${JSON.stringify(hello.body.error)}`);
  const { user_code, device_code } = hello.body.data;
  const approve = await json(`/v1/ecosystem-apps/${user_code}/approve`, owner.token, { method: 'POST', body: JSON.stringify({ action: 'approve', scopes }) });
  assert(approve.body.data?.status === 'approved', `approve ${app}: ${JSON.stringify(approve.body)}`);
  const tok = await json('/v1/ecosystem-apps/token', '', { method: 'POST', body: JSON.stringify({ device_code, grant_type: GRANT }) });
  assert(typeof tok.body.access_token === 'string', `token ${app}: ${JSON.stringify(tok.body)}`);
  return { geai: approve.body.data.geai, token: tok.body.access_token };
}

(async () => {
  console.log('\n── An ecosystem app\'s AI calls: the owner\'s app, paid by the owner (secaudit2026nov02d round 13) ──');
  const stub = await startFakeAiProvider(0);
  stub.setDefault('images', imageJson({ b64: PNG.toString('base64'), cost: 0.001 }));
  stub.setDefault('chat', chatJson('The stub provider answered.', { model: NODE_MODEL, usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10, cost: 0.0004 } }));
  const node = await startNode(stub);
  const sentPrompt = () => String((stub.lastRequest('images')?.json as any)?.prompt ?? '');
  const marked = (marker: string) => (r: RecordedRequest) => r.body.includes(marker);

  try {
    const stamp = Date.now().toString(36).slice(-6);
    await registerOwner(BASE, `ecop${stamp}`);   // the first account is the operator
    const alice = await registerOwner(BASE, `ecalice${stamp}`);
    const appName = `drumnews${stamp}`;
    const eco = await connectEcoApp(alice, appName, ['ai:use', 'storage:read']);
    const ecoName = `eco:${appName}`;
    const other = await connectEcoApp(alice, `drumtwo${stamp}`, ['ai:use']);

    const image = (token: string, body: Record<string, unknown> = {}) =>
      json('/v1/ai/image', token, { method: 'POST', body: JSON.stringify({ prompt: 'A family at a lake.', ...body }) });
    const complete = (token: string, marker: string) =>
      json('/v1/ai/complete', token, { method: 'POST', body: JSON.stringify({ prompt: `${marker} say hello`, max_tokens: 16 }) });
    const setRules = (genRules: Record<string, unknown>) => json('/v1/ai/gen-rules', alice.token, { method: 'PUT', body: JSON.stringify({ gen_rules: genRules }) });
    const allowanceLeft = async (t: string) => Number((await json('/v1/chat/status', t)).body.data?.allowance_remaining_usd);
    const usage = async () => (await json('/v1/ai/usage', alice.token)).body.data as { total_calls: number; spent_today_usd: number; per_app: Record<string, { cost_usd: number; calls: number }> };

    // ── the uses that keep working ──

    await test('U1. An ecosystem app with ai:use gets a text answer', async () => {
      const r = await complete(eco.token, 'U1ECO');
      assert(r.status === 200 && typeof r.body.data?.content === 'string' && r.body.data.content.length > 0, `complete ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    });

    await test('U2. An ecosystem app makes a picture, and reads it back from its own storage', async () => {
      const r = await image(eco.token, { prompt: 'A red bicycle.' });
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const key = r.body.data.storage_key as string;
      const own = await fetch(`${BASE}/v1/storage/${key.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${eco.token}` } });
      assert(own.status === 200, `the app reads its own picture: ${own.status}`);
      const dl = await fetch(r.body.data.download_url);
      assert(dl.status === 200, `the signed download address loads: ${dl.status}`);
    });

    await test('U3. The owner in person still skips a rule for one picture, with the reason kept', async () => {
      const on = await setRules({ rules: { [RULE]: true } });
      assert(on.status === 200 && on.body.data.mode === 'applied', `PUT ${on.status} ${JSON.stringify(on.body?.error)}`);
      const r = await image(alice.token, { gen_rules_bypass: { rules: [RULE], reason: 'A product shot, no people.' } });
      assert(r.status === 200 && sentPrompt() === 'A family at a lake.', `owner bypass ${r.status} ${sentPrompt()}`);
      assert(r.body.data.gen_rules[0]?.state === 'bypassed', `mark ${JSON.stringify(r.body.data.gen_rules)}`);
    });

    await test('U4. The record of the app\'s picture names the app as who asked', async () => {
      const r = await image(eco.token, { prompt: 'A blue kite.' });
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      const rec = recordIn(r.body);
      assert(rec, `a provenance record: ${JSON.stringify(r.body?.meta ?? r.body?.data)}`);
      const who = JSON.stringify(rec);
      assert(who.includes(eco.geai), `the record names ${eco.geai}: ${who.slice(0, 600)}`);
    });

    // ── the leads ──

    await test('A1. The app\'s bypass of the owner\'s rule is refused 403 before the provider hears anything, and names the exception to ask for', async () => {
      const before = stub.requestsFor('images').length;
      const r = await image(eco.token, { gen_rules_bypass: { rules: [RULE], reason: 'I would like a photo.' } });
      assert(r.status === 403 && r.body.error?.code === 'GEN_RULE_BYPASS_REFUSED', `got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.gen_rules)}`);
      assert(String(r.body.error?.message).includes(ecoName), `the refusal names the exception: ${r.body.error?.message}`);
      assert(stub.requestsFor('images').length === before, 'nothing reached the provider');
    });

    await test('A2. The owner\'s rule switch applies to the app\'s picture: the directive follows the prompt', async () => {
      const r = await image(eco.token);
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentPrompt() === `A family at a lake.\n\n${DIRECTIVE}`, `prompt ${sentPrompt()}`);
      assert(r.body.data.gen_rules[0]?.id === RULE && r.body.data.gen_rules[0]?.state === 'applied', `gen_rules ${JSON.stringify(r.body.data.gen_rules)}`);
    });

    await test('A3. The owner exempts the app by its name eco:<app>, and the exception lifts the rule for that app only', async () => {
      const e = await setRules({ exceptions: [{ rule: RULE, app: ecoName, reason: 'Draws product sketches only.' }] });
      assert(e.status === 200, `PUT ${e.status} ${JSON.stringify(e.body?.error)}`);
      const r = await image(eco.token, { prompt: 'A red bicycle.' });
      assert(r.status === 200 && sentPrompt() === 'A red bicycle.', `the app's prompt ${r.status} ${sentPrompt()}`);
      assert(r.body.data.gen_rules[0]?.state === 'bypassed' && /product sketches/.test(r.body.data.gen_rules[0].reason), `mark ${JSON.stringify(r.body.data.gen_rules)}`);
      const two = await image(other.token, { prompt: 'A red bicycle.' });
      assert(two.status === 200 && sentPrompt().endsWith(DIRECTIVE), `the other app still gets the directive: ${two.status} ${sentPrompt()}`);
      const clear = await setRules({ exceptions: [], rules: { [RULE]: null } });
      assert(clear.status === 200, `cleared ${clear.status}`);
    });

    await test('A4. The app\'s text call is paid from the owner\'s allowance and shows in the owner\'s usage as eco:<app>', async () => {
      const left = await allowanceLeft(alice.token);
      const before = await usage();
      stub.queue('chat', chatJson('paid by alice', { model: NODE_MODEL, usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0003 } }), marked('A4PAY'));
      const r = await complete(other.token, 'A4PAY');
      assert(r.status === 200 && r.body.data?.content === 'paid by alice', `complete ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
      const after = await usage();
      assert(after.total_calls === before.total_calls + 1, `one call on the owner's usage: ${before.total_calls} -> ${after.total_calls}`);
      const name = `eco:drumtwo${stamp}`;
      const row = after.per_app?.[name];
      assert(row && near(row.cost_usd - (before.per_app?.[name]?.cost_usd ?? 0), 0.0003), `the owner's usage names the app: ${JSON.stringify(after.per_app)}`);
      assert(near(left - await allowanceLeft(alice.token), 0.0003), `the owner's allowance fell by the call's cost: ${left} -> ${await allowanceLeft(alice.token)}`);
    });

    await test('A5. The owner\'s spent daily budget holds the app too: 402, and the provider hears nothing', async () => {
      const spent = (await usage()).spent_today_usd;
      const set = await json('/v1/ai/settings', alice.token, { method: 'POST', body: JSON.stringify({ daily_budget_usd: Math.max(0, spent / 2) }) });
      assert(set.status === 200, `budget ${set.status}: ${JSON.stringify(set.body?.error)}`);
      const before = stub.requestsFor('chat').length;
      const r = await complete(eco.token, 'A5BUDGET');
      assert(r.status === 402 && r.body.error?.code === 'QUOTA_EXHAUSTED', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(stub.requestsFor('chat').length === before, 'nothing reached the provider');
      const back = await json('/v1/ai/settings', alice.token, { method: 'POST', body: JSON.stringify({ daily_budget_usd: 5 }) });
      assert(back.status === 200, `budget back ${back.status}`);
      const again = await complete(eco.token, 'A5AGAIN');
      assert(again.status === 200, `with budget left the app answers again: ${again.status} ${JSON.stringify(again.body?.error)}`);
    });

    await test('U5. An exception naming anything but an app address, eco:<name> or an agent is still refused 400', async () => {
      const r = await setRules({ exceptions: [{ rule: RULE, app: 'eco:', reason: 'x' }] });
      assert(r.status === 400 && r.body.error?.code === 'GEN_RULES_INVALID', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
    });
  } finally {
    await stopNode(node);
    await stub.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

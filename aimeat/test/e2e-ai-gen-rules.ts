/**
 * @file test/e2e-ai-gen-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The generation rules end to end (wish
 *   wish-image-and-video-generation-people-only-in-an-artistic-non-ph): built-in instructions the
 *   node gives to AI pictures, switched per node and per owner, lifted for one app or agent by the
 *   owner's exception, skipped for one picture only by the owner in person, and recorded in the
 *   provenance record of every image the node makes or a writer brings in.
 *
 *   Against the OpenAI-compatible stub (test/helpers/fake-ai-provider.ts), so each case reads the
 *   prompt the provider actually received.
 *
 *   PASS CRITERION: with people-artistic on for the owner, the prompt a provider receives for the
 *   owner's picture ends with the rule's directive and the picture's record says `applied`; an agent
 *   asking to skip the rule is refused 403 GEN_RULE_BYPASS_REFUSED and the provider hears nothing;
 *   with the node requiring the rule, the owner cannot switch it off.
 * @structure
 *   - the node under test: the runner's backend, its own port
 *   - 1-15: the cases, the designed uses first, then the refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-gen-rules
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
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
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { startFakeAiProvider, imageJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';
import { GEN_RULES } from '../src/services/ai/gen-rules.js';

// Its own port, in the band the suites keep to (scripts/check-suite-ports.ts).
const PORT = process.env.E2E_AI_GEN_RULES_PORT ?? '29873';
const BASE = `http://localhost:${PORT}`;
const RULE = 'people-artistic';
const DIRECTIVE = GEN_RULES.find(r => r.id === RULE)!.directive.image;

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

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

/** The rules as the holder of `token` sees them. */
const rules = (token: string) => json('/v1/ai/gen-rules', token);
/** Change the rules as the holder of `token`, with the confirm token when confirming. */
const setRules = (token: string, genRules: Record<string, unknown>, confirm?: string) => json('/v1/ai/gen-rules', token, {
  method: 'PUT', body: JSON.stringify({ gen_rules: genRules, ...(confirm ? { confirm_token: confirm } : {}) }),
});

/** The first provenance record anywhere in an answer. */
function recordIn(v: unknown): any {
  if (!v || typeof v !== 'object') return undefined;
  if ((v as any).spec === 'aimeat.provenance/v1') return v;
  for (const x of Object.values(v as Record<string, unknown>)) { const r = recordIn(x); if (r) return r; }
  return undefined;
}

// ── the node ──────────────────────────────────────────────────────────────────
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-gen-rules-'));
const DB_PATH = join(dbDir, 'gen-rules.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startNode(): Promise<ChildProcess> {
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
    // A fresh node: every rule off, so each owner decides.
    AIMEAT_AI_GEN_RULES: '',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the generation rules node' });
}

async function stopNode(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

(async () => {
  console.log('\n── Generation rules for AI pictures and videos ──');
  const stub: FakeAiProvider = await startFakeAiProvider(0);
  stub.setDefault('images', imageJson({ b64: PNG.toString('base64'), cost: 0.01 }));
  const node = await startNode();
  const sentPrompt = () => String((stub.lastRequest('images')?.json as any)?.prompt ?? '');

  try {
    const stamp = Date.now().toString(36).slice(-6);
    const operator = await registerOwner(BASE, `grop${stamp}`);   // the first account is the operator
    const alice = await registerOwner(BASE, `gralice${stamp}`);
    const bob = await registerOwner(BASE, `grbob${stamp}`);
    for (const o of [alice, bob]) {
      const p = await json('/v1/ai/providers/my-images', o.token, { method: 'PUT', body: JSON.stringify({
        title: 'My image server', type: 'openai-compatible', baseUrl: `${stub.baseUrl}/custom`, auth: { type: 'none' },
        capabilities: { image: { enabled: true, model: 'local-image', pool: true } },
      }) });
      assert(p.status === 200, `provider ${p.status}: ${JSON.stringify(p.body?.error)}`);
      const r = await json('/v1/ai/routing', o.token, { method: 'PUT', body: JSON.stringify({ routing: { rules: { onlyTested: false } } }) });
      assert(r.status === 200, `routing ${r.status}: ${JSON.stringify(r.body?.error)}`);
    }
    const image = (token: string, body: Record<string, unknown> = {}) =>
      json('/v1/ai/image', token, { method: 'POST', body: JSON.stringify({ prompt: 'A family at a lake.', ...body }) });
    const setNode = (value: string) => json('/v1/admin/config', operator.token, {
      method: 'PUT', body: JSON.stringify({ changes: [{ path: 'ai.gen_rules', value }] }),
    });

    await test('1. A fresh node: the rule is off, a picture\'s prompt is the caller\'s own and its record names no rule', async () => {
      const g = await rules(alice.token);
      assert(g.status === 200, `GET ${g.status}: ${JSON.stringify(g.body?.error)}`);
      const rule = g.body.data.rules.find((r: any) => r.id === RULE);
      assert(rule && rule.node === 'off' && rule.owner === null && rule.on === false, `rule ${JSON.stringify(rule)}`);
      assert(g.body.data.for_caller.image.directive === '', 'no directive while off');
      const r = await image(alice.token);
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentPrompt() === 'A family at a lake.', `prompt ${sentPrompt()}`);
      assert(Array.isArray(r.body.data.gen_rules) && r.body.data.gen_rules.length === 0, `gen_rules ${JSON.stringify(r.body.data.gen_rules)}`);
      assert(!recordIn(r.body)?.rules, 'the record names no rule');
    });

    await test('2. The owner switches the rule on: the directive follows the prompt and the record says applied', async () => {
      const s = await setRules(alice.token, { rules: { [RULE]: true } });
      assert(s.status === 200 && s.body.data.mode === 'applied', `PUT ${s.status} ${JSON.stringify(s.body?.data ?? s.body?.error)}`);
      const r = await image(alice.token);
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentPrompt() === `A family at a lake.\n\n${DIRECTIVE}`, `prompt ${sentPrompt()}`);
      assert(r.body.data.gen_rules[0]?.id === RULE && r.body.data.gen_rules[0]?.state === 'applied', `gen_rules ${JSON.stringify(r.body.data.gen_rules)}`);
      const rec = recordIn(r.body);
      assert(rec?.rules?.[0]?.state === 'applied' && rec.rules[0].version === 1, `record rules ${JSON.stringify(rec?.rules)}`);
    });

    await test('3. Another owner is untouched by alice\'s choice', async () => {
      const r = await image(bob.token);
      assert(r.status === 200 && sentPrompt() === 'A family at a lake.', `bob's prompt ${sentPrompt()}`);
    });

    await test('4. The owner in person skips the rule for one picture, with a reason the record keeps', async () => {
      const r = await image(alice.token, { gen_rules_bypass: { rules: [RULE], reason: 'A photo-real product shot, no people.' } });
      assert(r.status === 200, `image ${r.status}: ${JSON.stringify(r.body?.error)}`);
      assert(sentPrompt() === 'A family at a lake.', `prompt ${sentPrompt()}`);
      const m = r.body.data.gen_rules[0];
      assert(m?.state === 'bypassed' && /photo-real product shot/.test(m.reason), `mark ${JSON.stringify(m)}`);
    });

    const agent = await makeAgent(BASE, alice, ['ai:use', 'storage:write', 'storage:read', 'provenance:write'], `gragent${stamp}`);
    const admin = await makeAgent(BASE, alice, ['ai:use', 'memory:write-reserved'], `gradmin${stamp}`);

    await test('5. An agent reads the directive to use elsewhere, and the node gives it to the agent\'s own picture', async () => {
      const s = await openSession(BASE, agent.token, 'gen-rules-agent');
      const g = await callTool(s, 'aimeat_ai_gen_rules', {});
      assert(!g.isError, `read ${g.text}`);
      assert(g.data.for_caller.image.directive === DIRECTIVE && g.data.for_caller.video.rules.includes(RULE), `for_caller ${JSON.stringify(g.data.for_caller)}`);
      const r = await callTool(s, 'aimeat_image_generate', { prompt: 'Two hikers on a ridge.' });
      assert(!r.isError, `image ${r.text}`);
      assert(sentPrompt() === `Two hikers on a ridge.\n\n${DIRECTIVE}`, `prompt ${sentPrompt()}`);
      assert(r.data.gen_rules?.[0]?.state === 'applied', `gen_rules ${JSON.stringify(r.data.gen_rules)}`);
    });

    await test('6. An agent asking to skip the rule is refused 403 GEN_RULE_BYPASS_REFUSED, and the provider hears nothing', async () => {
      const before = stub.requestsFor('images').length;
      const r = await image(agent.token, { gen_rules_bypass: { rules: [RULE], reason: 'I would like a photo.' } });
      assert(r.status === 403 && r.body.error?.code === 'GEN_RULE_BYPASS_REFUSED', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(stub.requestsFor('images').length === before, 'nothing reached the provider');
    });

    await test('7. An agent without memory:write-reserved cannot change the rules (403), and the rule stays on', async () => {
      const r = await setRules(agent.token, { rules: { [RULE]: false } });
      assert(r.status === 403, `got ${r.status} ${JSON.stringify(r.body?.error)}`);
      const g = await rules(alice.token);
      assert(g.body.data.rules.find((x: any) => x.id === RULE).on === true, 'still on');
    });

    await test('8. An agent with memory:write-reserved proposes, changes nothing, and the token applies exactly that change', async () => {
      const s = await openSession(BASE, admin.token, 'gen-rules-admin');
      const change = { rules: { [RULE]: false } };
      const p = await callTool(s, 'aimeat_ai_gen_rules_set', { gen_rules: change });
      assert(!p.isError && p.data.mode === 'proposal' && p.data.confirm_token, `proposal ${p.text}`);
      assert((await rules(alice.token)).body.data.rules.find((x: any) => x.id === RULE).on === true, 'a proposal changes nothing');
      const other = await callTool(s, 'aimeat_ai_gen_rules_set', { gen_rules: { rules: { [RULE]: null } }, confirm_token: p.data.confirm_token });
      assert(other.isError, `a token for another change is refused: ${other.text}`);
      const p2 = await callTool(s, 'aimeat_ai_gen_rules_set', { gen_rules: change });
      const c = await callTool(s, 'aimeat_ai_gen_rules_set', { gen_rules: change, confirm_token: p2.data.confirm_token });
      assert(!c.isError && c.data.mode === 'applied', `confirm ${c.text}`);
      assert((await rules(alice.token)).body.data.rules.find((x: any) => x.id === RULE).on === false, 'off after the confirm');
      const back = await setRules(alice.token, { rules: { [RULE]: true } });
      assert(back.status === 200, `owner switches it back on: ${back.status}`);
    });

    await test('9. The owner\'s exception for one agent lifts the rule for that agent only, with the reason in the record', async () => {
      const e = await setRules(alice.token, { exceptions: [{ rule: RULE, agent: agent.name, reason: 'Makes product photos only.' }] });
      assert(e.status === 200, `PUT ${e.status} ${JSON.stringify(e.body?.error)}`);
      const r = await image(agent.token, { prompt: 'A red bicycle.' });
      assert(r.status === 200 && sentPrompt() === 'A red bicycle.', `the agent's prompt ${sentPrompt()}`);
      assert(r.body.data.gen_rules[0]?.state === 'bypassed' && /product photos/.test(r.body.data.gen_rules[0].reason), `mark ${JSON.stringify(r.body.data.gen_rules)}`);
      const own = await image(alice.token, { prompt: 'A red bicycle.' });
      assert(own.status === 200 && sentPrompt().endsWith(DIRECTIVE), 'the owner\'s own picture still gets the directive');
      const clear = await setRules(alice.token, { exceptions: [] });
      assert(clear.status === 200 && clear.body.data.gen_rules.exceptions.length === 0, 'cleared');
    });

    await test('10. A picture an agent brings in: declared when it names the rule, unknown when it does not; never refused', async () => {
      const s = await openSession(BASE, agent.token, 'gen-rules-arrival');
      const up = (key: string, extra: Record<string, unknown>) => callTool(s, 'aimeat_storage_upload', {
        key, data_base64: PNG.toString('base64'), mime_type: 'image/png',
        ai_provenance: { level: 'ai-generated', media_kind: 'image', model: 'grok-imagine', ...extra },
      });
      const declared = await up('arrivals/declared.png', { rules_followed: [RULE] });
      assert(!declared.isError, `upload ${declared.text}`);
      const recD = recordIn(declared.data);
      assert(recD?.rules?.[0]?.id === RULE && recD.rules[0].state === 'declared', `declared record ${JSON.stringify(recD?.rules ?? declared.data)}`);
      const silent = await up('arrivals/silent.png', {});
      assert(!silent.isError, `upload without the rule is stored: ${silent.text}`);
      const recU = recordIn(silent.data);
      assert(recU?.rules?.[0]?.state === 'unknown', `unknown record ${JSON.stringify(recU?.rules ?? silent.data)}`);
    });

    await test('11. The node requires the rule: the owner cannot switch it off or skip it, and the view says required', async () => {
      const n = await setNode(`${RULE}=required`);
      assert(n.status === 200 && (n.body.data.errors ?? []).length === 0, `config ${n.status} ${JSON.stringify(n.body?.data ?? n.body?.error)}`);
      const g = await rules(bob.token);
      const rule = g.body.data.rules.find((x: any) => x.id === RULE);
      assert(rule.node === 'required' && rule.required === true && rule.on === true, `bob's view ${JSON.stringify(rule)}`);
      const off = await setRules(bob.token, { rules: { [RULE]: false } });
      assert(off.status === 400 && off.body.error?.code === 'GEN_RULES_INVALID', `switch off ${off.status} ${JSON.stringify(off.body?.error)}`);
      const before = stub.requestsFor('images').length;
      const skip = await image(bob.token, { gen_rules_bypass: { rules: [RULE], reason: 'Just this once.' } });
      assert(skip.status === 403 && skip.body.error?.code === 'GEN_RULE_BYPASS_REFUSED', `skip ${skip.status} ${JSON.stringify(skip.body?.error)}`);
      assert(stub.requestsFor('images').length === before, 'nothing reached the provider');
      const plain = await image(bob.token);
      assert(plain.status === 200 && sentPrompt().endsWith(DIRECTIVE), 'bob\'s picture gets the directive');
    });

    await test('12. A node setting that names no rule, or no level, is refused and changes nothing', async () => {
      const bad = await setNode('people-artistic=always');
      assert(bad.status !== 200 || (bad.body.data.errors ?? []).length > 0, `refused: ${bad.status} ${JSON.stringify(bad.body?.data ?? bad.body?.error)}`);
      const g = await rules(bob.token);
      assert(g.body.data.rules.find((x: any) => x.id === RULE).node === 'required', 'still required');
      const reset = await setNode('');
      assert(reset.status === 200, `reset ${reset.status}`);
    });

    await test('13. A change that names no rule, or an exception without a reason, is 400 with every problem named', async () => {
      const r = await setRules(alice.token, { rules: { 'no-such-rule': true }, exceptions: [{ rule: RULE, app: 'x/y.html' }] });
      assert(r.status === 400 && r.body.error?.code === 'GEN_RULES_INVALID', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
      const fields = (r.body.error.details?.problems ?? []).map((p: any) => p.field);
      assert(fields.includes('rules.no-such-rule') && fields.some((f: string) => f.endsWith('.reason')), `problems ${JSON.stringify(fields)}`);
    });

    await test('14. Without a sign-in, reading and changing the rules are both refused 401', async () => {
      const read = await rules('');
      assert(read.status === 401, `GET without a token: ${read.status}`);
      const change = await setRules('', { rules: { [RULE]: false } });
      assert(change.status === 401, `PUT without a token: ${change.status}`);
    });

    await test('15. A malformed bypass is 400 before anything is spent', async () => {
      const before = stub.requestsFor('images').length;
      const r = await image(alice.token, { gen_rules_bypass: { rules: [RULE] } });
      assert(r.status === 400 && r.body.error?.code === 'INVALID_BODY', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(stub.requestsFor('images').length === before, 'nothing reached the provider');
    });
  } finally {
    await stopNode(node);
    await stub.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

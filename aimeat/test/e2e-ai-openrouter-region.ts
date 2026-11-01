/**
 * @file test/e2e-ai-openrouter-region.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an OpenRouter call on the node's key is processed: eu.openrouter.ai,
 *   us.openrouter.ai or openrouter.ai (services/ai/openrouter-region.ts; Jouni, 2026-10-31).
 *
 *   The node runs with region eu and the US fallback, the operator's settings aimeat.io takes. Each
 *   case reads WHERE the request arrived, not only what the node answered: the stub serves the three
 *   addresses at three paths, so a call to the wrong region is visible in the stub's record.
 *   - R1 a model the EU offers is processed in the EU, and the answer says so;
 *   - R2 a model only the US offers goes to the US, and the answer names the region it was meant for;
 *   - R3 a person who turned the fallback off is refused, the refusal names the EU's models, and
 *     nothing reaches any address;
 *   - R4 a model in neither region is refused on the default fallback, and nothing is sent;
 *   - R5 a person who chose "any" reaches openrouter.ai with that model;
 *   - R6 a malformed rule is refused with the field's name;
 *   - R7 the provider list states the node's region, the person's choice and what applies now;
 *   - R8 the privacy page states the region, the fallback and the choice, in English and Finnish;
 *   - R9 a person who does not run the node is refused (403) when they try to change the node's
 *     region, and another person's choice does not reach them;
 *   - R10 a chat call with tools passes over an EU endpoint listed without tool calling;
 *   - R11 the buyer's choice eu-only (ai.region_mode), set by the operator and by nobody else, moves the
 *     chat to the EU model in the EU, refuses a named model the EU lacks, and the provider list, the
 *     privacy page and the transparency statement say so.
 *
 *   NOTHING INSIDE THE NODE IS MOCKED. The provider is test/helpers/fake-ai-provider.ts on loopback;
 *   the node's three OpenRouter addresses point at it (AIMEAT_AI_FIXED_BASEURL_OVERRIDES with
 *   openrouter, openrouter-eu and openrouter-us, accepted on a node that is not public).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-openrouter-region
 * @version-history
 *   v1.1.1 -- 2026-11-01 -- R8: /v1/privacy?lang=fi reaches the Finnish page.
 *   v1.1.0 -- 2026-11-01 -- R10, R11: tool calling in the region's list, and the buyer's choice eu-only (Jouni, 2026-11-01).
 *   v1.0.0 -- 2026-10-31 -- Initial (Jouni, 2026-10-31).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, chatJson, modelsJson, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';
import { ownerSignIn } from './helpers/owner-login.js';

// Its own port, in the suites' fixed band (28000-29999); the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_OPENROUTER_REGION_PORT ?? '28494';
const BASE = `http://localhost:${PORT}`;
const NODE_KEY = 'sk-node-e2e-region-never-billed';
const EU_MODEL = 'mistralai/mistral-large-4-0';
const US_MODEL = 'deepseek/deepseek-v4-pro-0813';
const BOTH_MODEL = 'openai/gpt-oss-120b';
const NOWHERE_MODEL = 'openai/whisper-large-v3-turbo';
/** services/ai/openrouter-region.ts EU_ONLY_TEXT_MODEL. */
const EU_ONLY_TEXT_MODEL = 'mistralai/mistral-small-2603';
/** The first owner runs the node (the operator); set by owner(). */
let operatorToken = '';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-openrouter-region-'));
const DB_PATH = join(dbDir, 'region.db');
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
    AIMEAT_OPENROUTER_INSTANCE_KEY: NODE_KEY,
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
    AIMEAT_MODEL_DEFAULT_CHAT: BOTH_MODEL,
    // The operator's choice on aimeat.io: the EU, a model it lacks goes to the US, people may choose.
    AIMEAT_AI_OPENROUTER_REGION: 'eu',
    AIMEAT_AI_OPENROUTER_REGION_FALLBACK: 'us',
    AIMEAT_AI_OPENROUTER_REGIONS: 'eu,us,any',
    AIMEAT_AI_OPENROUTER_REGION_PERSON_CHOICE: 'true',
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({
      openrouter: `${stub.baseUrl}/any`, 'openrouter-eu': `${stub.baseUrl}/eu`, 'openrouter-us': `${stub.baseUrl}/us`,
    }),
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the OpenRouter region node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

let seq = 0;
async function owner(label: string): Promise<string> {
  const name = `orr${label}${Date.now() % 1_000_000}${++seq}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Region', password: 'Region12345678' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, 'Region12345678');
  assert(tok.status === 200, `auth/token ${tok.status}`);
  operatorToken ||= tok.body.data.token as string;
  return tok.body.data.token as string;
}

/** A chat call on the node route, as the node's own chat makes it: tools sent, no model named. */
const chatWithTools = (t: string, marker: string) => json('/v1/llm/chat/completions', {
  method: 'POST', headers: auth(t),
  body: JSON.stringify({ messages: [{ role: 'user', content: `${marker} hello` }], max_tokens: 16,
    tools: [{ type: 'function', function: { name: 'noop', description: 'Does nothing.', parameters: { type: 'object', properties: {} } } }] }),
});
/** The model each chat request carrying this marker asked the provider for. */
const modelsAsked = (stub: FakeAiProvider, marker: string) =>
  stub.requestsFor('chat').filter(marked(marker)).map(r => (JSON.parse(r.body) as { model?: string }).model);

const complete = (t: string, body: Record<string, unknown>) =>
  json('/v1/ai/complete', { method: 'POST', headers: auth(t), body: JSON.stringify({ max_tokens: 16, ...body }) });
const setRules = (t: string, rules: Record<string, unknown>) =>
  json('/v1/ai/routing', { method: 'PUT', headers: auth(t), body: JSON.stringify({ routing: { rules } }) });
const marked = (marker: string) => (r: RecordedRequest) => r.body.includes(marker);
/** The chat requests carrying this marker, with the region path each arrived at. */
const arrivals = (stub: FakeAiProvider, marker: string) =>
  stub.requestsFor('chat').filter(marked(marker)).map(r => r.pathname.split('/')[2]);

(async () => {
  console.log('\n── Where an OpenRouter call is processed: eu, us or any (Jouni, 2026-10-31) ──');
  const stub = await startFakeAiProvider(0);
  // Each region's model list, as OpenRouter answers GET <region>/models.
  // The EU lists BOTH_MODEL without tool calling, as eu.openrouter.ai listed openai/gpt-oss-120b on
  // 2026-11-01; the EU-only stand-in has it.
  stub.setDefault('models', (req: RecordedRequest) => req.pathname.includes('/eu/')
    ? modelsJson([{ id: EU_MODEL }, { id: BOTH_MODEL, supported_parameters: ['temperature'] }, { id: EU_ONLY_TEXT_MODEL, supported_parameters: ['tools'] }])
    : req.pathname.includes('/us/') ? modelsJson([{ id: US_MODEL }, { id: BOTH_MODEL, supported_parameters: ['tools'] }]) : modelsJson([]));
  const server = await startServer(stub);
  try {
    await test('R1. a model the EU offers is processed at the EU address, and the answer says eu', async () => {
      const t = await owner('r1');
      stub.queue('chat', chatJson('from the eu', { model: EU_MODEL }), marked('R1EU'));
      const r = await complete(t, { prompt: 'R1EU hello', model: EU_MODEL });
      assert(r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(JSON.stringify(arrivals(stub, 'R1EU')) === '["eu"]', `arrived at ${JSON.stringify(arrivals(stub, 'R1EU'))}`);
      const by = r.body.data.route?.answeredBy;
      assert(by?.region === 'eu' && by.regionWanted === undefined, `answeredBy ${JSON.stringify(by)}`);
    });

    await test('R2. a model only the US offers goes to the US address, and the answer says it was meant for eu', async () => {
      const t = await owner('r2');
      stub.queue('chat', chatJson('from the us', { model: US_MODEL }), marked('R2US'));
      const r = await complete(t, { prompt: 'R2US hello', model: US_MODEL });
      assert(r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(JSON.stringify(arrivals(stub, 'R2US')) === '["us"]', `arrived at ${JSON.stringify(arrivals(stub, 'R2US'))}`);
      const by = r.body.data.route?.answeredBy;
      assert(by?.region === 'us' && by.regionWanted === 'eu', `answeredBy ${JSON.stringify(by)}`);
    });

    await test('R3. with the fallback off, a model the EU lacks is refused, the refusal names the EU models, nothing is sent', async () => {
      const t = await owner('r3');
      const set = await setRules(t, { openrouterRegionFallback: 'off' });
      assert(set.status === 200 && set.body.data.routing.owner.rules.openrouterRegionFallback === 'off', `rule: ${set.status} ${JSON.stringify(set.body?.error)}`);
      const r = await complete(t, { prompt: 'R3OFF hello', model: US_MODEL });
      assert(r.status === 400 && r.body.error?.code === 'AI_MODEL_NOT_IN_REGION', `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(r.body.error.message.includes(EU_MODEL) && r.body.error.message.includes('eu.openrouter.ai'), `message: ${r.body.error.message}`);
      assert(arrivals(stub, 'R3OFF').length === 0, `sent to ${JSON.stringify(arrivals(stub, 'R3OFF'))}`);
    });

    await test('R4. a model neither the EU nor the US offers is refused on the default fallback, and nothing is sent', async () => {
      const t = await owner('r4');
      const r = await complete(t, { prompt: 'R4NONE hello', model: NOWHERE_MODEL });
      assert(r.status === 400 && r.body.error?.code === 'AI_MODEL_NOT_IN_REGION', `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(arrivals(stub, 'R4NONE').length === 0, `sent to ${JSON.stringify(arrivals(stub, 'R4NONE'))}`);
    });

    await test('R5. a person who chose any reaches openrouter.ai with that model', async () => {
      const t = await owner('r5');
      const set = await setRules(t, { openrouterRegion: 'any' });
      assert(set.status === 200, `rule: ${set.status} ${JSON.stringify(set.body?.error)}`);
      stub.queue('chat', chatJson('from anywhere', { model: NOWHERE_MODEL }), marked('R5ANY'));
      const r = await complete(t, { prompt: 'R5ANY hello', model: NOWHERE_MODEL });
      assert(r.status === 200, `${r.status} ${JSON.stringify(r.body?.error)}`);
      assert(JSON.stringify(arrivals(stub, 'R5ANY')) === '["any"]', `arrived at ${JSON.stringify(arrivals(stub, 'R5ANY'))}`);
      assert(r.body.data.route?.answeredBy?.region === 'any', `answeredBy ${JSON.stringify(r.body.data.route?.answeredBy)}`);
    });

    await test('R6. a malformed region rule is refused with the field\'s name', async () => {
      const t = await owner('r6');
      const bad = await setRules(t, { openrouterRegion: 'mars' });
      assert(bad.status === 400 && /openrouterRegion/.test(bad.body.error?.message ?? ''), `${bad.status} ${bad.body.error?.message}`);
      const badFallback = await setRules(t, { openrouterRegionFallback: true });
      assert(badFallback.status === 400 && /openrouterRegionFallback/.test(badFallback.body.error?.message ?? ''), `${badFallback.status} ${badFallback.body.error?.message}`);
    });

    await test('R7. the provider list states the node\'s region, the person\'s choice and what applies now', async () => {
      const t = await owner('r7');
      const before = await json('/v1/ai/providers', { headers: auth(t) });
      const reg = before.body.data?.openrouter_region;
      assert(reg?.node?.region === 'eu' && reg.node.fallback === 'us' && reg.node.person_may_choose === true, `node: ${JSON.stringify(reg?.node)}`);
      assert(reg.in_effect?.node_key?.region === 'eu' && reg.in_effect.node_key.source === 'node', `before: ${JSON.stringify(reg.in_effect)}`);
      await setRules(t, { openrouterRegion: 'us' });
      const after = (await json('/v1/ai/providers', { headers: auth(t) })).body.data?.openrouter_region;
      assert(after?.in_effect?.node_key?.region === 'us' && after.in_effect.node_key.source === 'person', `after: ${JSON.stringify(after?.in_effect)}`);
    });

    await test('R9. a person who does not run the node cannot change the node\'s region; their own rule stays theirs', async () => {
      await owner('r9first');
      const t = await owner('r9');
      const change = await json('/v1/admin/config', { method: 'PUT', headers: auth(t), body: JSON.stringify({ changes: [{ path: 'ai.openrouter_region', value: 'any' }] }) });
      assert(change.status === 403, `a non-operator changing ai.openrouter_region: ${change.status} ${JSON.stringify(change.body?.error)}`);
      const reg = (await json('/v1/ai/providers', { headers: auth(t) })).body.data?.openrouter_region;
      assert(reg?.node?.region === 'eu', `the node's region after the refused change: ${JSON.stringify(reg?.node)}`);
      // Another person's choice does not reach this one: R5's owner chose any, this owner is on eu.
      assert(reg.in_effect?.node_key?.region === 'eu' && reg.in_effect.node_key.source === 'node', `this person's region: ${JSON.stringify(reg.in_effect)}`);
    });

    await test('R8. the privacy page states the region, the fallback and the choice, in English and in Finnish', async () => {
      const en = await fetch(`${BASE}/v1/privacy`).then(r => r.text());
      assert(en.includes('processed at eu.openrouter.ai') && en.includes('goes to us.openrouter.ai in the United States'), 'English: region and fallback');
      assert(en.includes('Standard Contractual Clauses') && !en.includes('{{aiRegionNotice}}'), 'English: the transfer basis, and no placeholder left');
      const fi = await fetch(`${BASE}/v1/privacy/fi`).then(r => r.text());
      assert(fi.includes('osoitteessa eu.openrouter.ai') && fi.includes('Voit valita alueen'), 'Finnish: region and choice');
      // ?lang=fi on the bare path reaches the Finnish page, as ?lang does on the other pages (crew45, 2026-11-01).
      const viaLang = await fetch(`${BASE}/v1/privacy?lang=fi`, { redirect: 'manual' });
      assert(viaLang.status === 302 && viaLang.headers.get('location') === '/v1/privacy/fi', `?lang=fi: ${viaLang.status} ${viaLang.headers.get('location')}`);
      const followed = await fetch(`${BASE}/v1/privacy?lang=fi`).then(r => r.text());
      assert(followed.includes('osoitteessa eu.openrouter.ai'), '?lang=fi followed: Finnish');
      const plain = await fetch(`${BASE}/v1/privacy?lang=en`, { redirect: 'manual' });
      assert(plain.status === 200, `?lang=en stays on the English page: ${plain.status}`);
    });

    await test('R10. a chat call with tools passes over an EU endpoint without tool calling and runs in the US, recorded', async () => {
      // The source was broken: the region list held ids only, so the call went to the EU endpoint,
      // which has no tool calling for this model (crew36, openai/gpt-oss-120b, 2026-11-01).
      const t = await owner('r10');
      stub.queue('chat', chatJson('from the us', { model: BOTH_MODEL }), marked('R10TOOLS'));
      const r = await chatWithTools(t, 'R10TOOLS');
      assert(r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
      assert(JSON.stringify(arrivals(stub, 'R10TOOLS')) === '["us"]', `arrived at ${JSON.stringify(arrivals(stub, 'R10TOOLS'))}`);
    });

    await test('R11. the operator sets the buyer\'s choice eu-only, and the node follows it everywhere; nobody else may set it', async () => {
      const other = await owner('r11');
      const refused = await json('/v1/admin/config', { method: 'PUT', headers: auth(other), body: JSON.stringify({ changes: [{ path: 'ai.region_mode', value: 'any' }] }) });
      assert(refused.status === 403, `a non-operator setting ai.region_mode: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
      const set = await json('/v1/admin/config', { method: 'PUT', headers: auth(operatorToken), body: JSON.stringify({ changes: [{ path: 'ai.region_mode', value: 'eu-only' }] }) });
      assert(set.status === 200 && set.body.data?.applied?.[0]?.new_value === 'eu-only', `operator: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
      try {
        // What the person reads: the choice, the region in effect, no free model.
        const view = (await json('/v1/ai/providers', { headers: auth(other) })).body.data;
        assert(view?.openrouter_region?.mode?.id === 'eu-only' && /speech-to-text/.test(view.openrouter_region.mode.limits ?? ''), `mode: ${JSON.stringify(view?.openrouter_region?.mode)}`);
        assert(view.openrouter_region.node?.fallback === 'off' && JSON.stringify(view.openrouter_region.node.allowed) === '["eu"]', `node: ${JSON.stringify(view.openrouter_region.node)}`);
        assert(view.free_model?.available === false, `free model: ${JSON.stringify(view.free_model)}`);
        // The chat's call with tools stays in the EU, on the EU model, though the person asked for the US.
        await setRules(other, { openrouterRegion: 'us', openrouterRegionFallback: 'any' });
        stub.queue('chat', chatJson('from the eu', { model: EU_ONLY_TEXT_MODEL }), marked('R11CHAT'));
        const chat = await chatWithTools(other, 'R11CHAT');
        assert(chat.status === 200, `chat: ${chat.status} ${JSON.stringify(chat.body?.error ?? chat.body)}`);
        assert(JSON.stringify(arrivals(stub, 'R11CHAT')) === '["eu"]', `arrived at ${JSON.stringify(arrivals(stub, 'R11CHAT'))}`);
        assert(JSON.stringify(modelsAsked(stub, 'R11CHAT')) === JSON.stringify([EU_ONLY_TEXT_MODEL]), `model: ${JSON.stringify(modelsAsked(stub, 'R11CHAT'))}`);
        // A model the caller names that the EU lacks is refused with the reason, and nothing is sent.
        const named = await complete(other, { prompt: 'R11US hello', model: US_MODEL });
        assert(named.status === 400 && named.body.error?.code === 'AI_MODEL_NOT_IN_REGION' && /EU only/.test(named.body.error.message), `named: ${named.status} ${JSON.stringify(named.body?.error)}`);
        assert(arrivals(stub, 'R11US').length === 0, `sent to ${JSON.stringify(arrivals(stub, 'R11US'))}`);
        // The privacy page and the transparency statement say the same.
        const privacy = await fetch(`${BASE}/v1/privacy`).then(r => r.text());
        assert(privacy.includes('use AI in the EU only') && privacy.includes('is refused'), 'privacy: EU only and no fallback');
        const tr = (await json('/v1/ai-transparency')).body.data?.ai_processing_region;
        assert(tr?.mode === 'eu-only' && tr.fallback === 'off' && JSON.stringify(tr.regions_in_use?.map((x: { region: string }) => x.region)) === '["eu"]', `transparency: ${JSON.stringify(tr)}`);
      } finally {
        await json('/v1/admin/config', { method: 'PUT', headers: auth(operatorToken), body: JSON.stringify({ changes: [{ path: 'ai.region_mode', value: '' }] }) });
      }
    });
  } finally {
    await stopServer(server);
    await stub.close();
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

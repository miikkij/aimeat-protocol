/**
 * @file test/e2e-ai-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision provider (TARGET-080, AIMEAT.decide) end to end, against a local stub
 *   that stands in for TypeSafe and for nothing else.
 *
 *   WHAT THIS PROVES, AND HOW. The stub records every request it receives, so each claim about what
 *   leaves the node is checked on the bytes that ARRIVED, not on what the node says it sent:
 *   - personal data is gone from the state, the instructions and the choice option names, and the
 *     real option name comes back in the answer;
 *   - the owner's policy lets a class through when, and only when, the owner says so;
 *   - the node's key is used until the owner sets their own, and neither is ever shown;
 *   - a decision is recorded with the pinned model, the thresholds and the provider's request id,
 *     metered into the owner's usage, reused from the cache without a second provider call, readable
 *     by its owner and a 404 to anyone else, and reviewable;
 *   - an app is refused until its data map names TypeSafe, and served once it does;
 *   - a request over the limits never reaches the provider;
 *   - a run over several records finishes and records each one.
 *
 *   WHY IT OWNS ITS SERVER. The endpoint, the node key and loopback egress are boot-time settings.
 *   It follows the runner's backend: Postgres when the env file names it, a temporary SQLite file
 *   otherwise.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-decide.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/e2e-ai-decide.ts
 * @version-history
 *   v1.1.0 — 2026-09-19 — 3c/3d: one app has one name in the register, the spend and the cap.
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

// Its own port, outside the 40251-up range sessions claim; the stub takes an ephemeral one.
const PORT = process.env.E2E_AI_DECIDE_PORT ?? '40436';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const NODE_KEY = 'ts-node-key-e2e-0001';
const OWN_KEY = 'ts-own-key-e2e-0002';
const REDIRECT = 'http://localhost:9911/callback';
const FILENAME = 'decide-probe.html';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the TypeSafe stand-in ─────────────────────────────────────────────────────

interface Seen { auth: string; body: any }
const seen: Seen[] = [];
let stubStatus = 200;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => resolve(s));
  });
}

/** Answers every question by its type, the way the real service shapes an answer. A state that
 *  carries the word UNSURE gets a middling yes/no, and one with HOPELESS a low one, so a rule's
 *  bands have something to cut. */
function answerFor(q: any, state: string): any {
  if (q.type === 'noul') return { type: 'noul', noul: state.includes('HOPELESS') ? 0.2 : state.includes('UNSURE') ? 0.6 : 0.91 };
  if (q.type === 'choice') {
    const opts = Object.keys(q.criteria);
    const probs = Object.fromEntries(opts.map((o, i) => [o, i === 0 ? 0.9 : 0.1 / (opts.length - 1)]));
    return { type: 'choice', choice: opts[0], probabilities: probs, confidence: 0.88 };
  }
  // Levels are numbered from 0, as the live model answers (its documentation says 1).
  const levels = q.criteria as unknown[];
  return {
    type: 'score', score: 2, confidence: 0.7,
    legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
    probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === 2 ? 1 : 0])),
  };
}

async function startStub(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    seen.push({ auth: String(req.headers.authorization ?? ''), body });
    if (stubStatus !== 200) {
      res.writeHead(stubStatus, { 'content-type': 'application/json', 'x-typesafe-request-id': 'req-err' });
      res.end(JSON.stringify({ detail: 'refused by the stub' }));
      return;
    }
    const stateText = JSON.stringify(body.state ?? '');
    const answers = Object.fromEntries(Object.entries(body.questions ?? {}).map(([id, q]) => [id, answerFor(q, stateText)]));
    res.writeHead(200, { 'content-type': 'application/json', 'x-typesafe-request-id': `req-${seen.length}` });
    res.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1200, output_tokens: 40 } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/v1/systemone` };
}

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-decide-'));
const DB_PATH = join(dbDir, 'decide.db');

// The runner's backend when it names Postgres (the production store, where the decision table's
// jsonb review update and cache lookup run), a temporary SQLite file otherwise.
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(stubUrl: string): Promise<ChildProcess> {
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
    AIMEAT_DECIDE_ENABLED: 'true',
    AIMEAT_DECIDE_BASE_URL: stubUrl,
    AIMEAT_TYPESAFE_INSTANCE_KEY: NODE_KEY,
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the decide node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

interface Owner { name: string; gaii: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
  const name = `decide${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', {
    method: 'POST', body: JSON.stringify({ username: name, display_name: 'Decide Test', password: 'DecideTest1234' }),
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

async function appGrantToken(owner: Owner): Promise<string> {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>decide</body></html>'),
      name: 'Decide Probe', description: 'decide e2e probe app', category: 'utility' }),
  });
  assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${owner.name}/${FILENAME}`, response_type: 'code', scope: 'ai:use',
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

// A record shaped like a CRM contact and a mail, in Finnish, with English questions.
const EMAIL = 'anna.virtanen@esimerkki.fi';
const HETU = '131052-308T';
const STATE = {
  contact: { name: 'Anna Virtanen', email: EMAIL, company: 'Overscale Solutions Oy', businessId: '3323553-5' },
  message: `Hei, Anna tässä. Tarvitsen laskun tänään. Henkilötunnukseni on ${HETU}. Soita 040 123 4567.`,
};
const QUESTIONS = {
  urgent: { type: 'noul', instructions: 'The sender needs an answer today.' },
  next: { type: 'choice', instructions: 'What should happen next?', criteria: { 'Call Anna Virtanen': 'Phone the sender', 'Send the invoice': null, 'Nothing': null } },
  tone: { type: 'score', instructions: 'How polite is the message?', criteria: ['Rude', 'Neutral', 'Polite'] },
};

(async () => {
  const stub = await startStub();
  const server = await startServer(stub.url);
  const A = await setupOwner('a');
  const B = await setupOwner('b');
  const agentAi = await connectAgent(A, 'deciderbot', ['ai:use', 'memory:read']);
  const agentNoAi = await connectAgent(A, 'readerbot', ['memory:read']);

  console.log('\nPhase 1: the doors refuse before anything is sent');

  await test('1a. unauthenticated is 401', async () => {
    const r = await json('/v1/ai/decide', { method: 'POST', body: JSON.stringify({ state: 'x', questions: QUESTIONS }) });
    assert(r.status === 401, `got ${r.status}`);
  });
  await test('1b. an agent without ai:use is 403', async () => {
    const r = await json('/v1/ai/decide', { method: 'POST', headers: auth(agentNoAi), body: JSON.stringify({ state: 'x', questions: QUESTIONS }) });
    assert(r.status === 403, `got ${r.status}`);
  });
  await test('1c. eleven score levels are refused and never reach the provider', async () => {
    const before = seen.length;
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ state: 'x', questions: { s: { type: 'score', instructions: 'Rate it.', criteria: Array.from({ length: 11 }, (_, i) => `level ${i}`) } } }),
    });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_REQUEST', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(Array.isArray(r.body.error?.details?.violations), 'the violations are listed');
    assert(seen.length === before, 'the stub was not called');
  });

  console.log('\nPhase 2: a decision, scrubbed, answered, metered and recorded');

  let decisionId = '';
  await test('2a. the owner asks and gets typed answers with the real option name back', async () => {
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ state: STATE, questions: QUESTIONS, subject: 'crm.contacts.anna', gates: 'who handles the mail', thresholds: { urgent: 0.8 }, app_id: 'decide-e2e' }),
    });
    assert(r.status === 200, `got ${r.status} ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    decisionId = d.decision_id;
    assert(d.model === 'jev-1.13.0', `pinned model answered, got ${d.model}`);
    assert(d.answers.urgent.value === 0.91, 'noul value');
    assert(d.answers.next.value === 'Call Anna Virtanen', `real option name restored, got ${d.answers.next.value}`);
    assert('Call Anna Virtanen' in d.answers.next.probabilities, 'probability keys restored');
    assert(d.answers.tone.value === 2, 'score value');
    assert(d.scrub.total >= 3, `scrubbed something, total ${d.scrub.total}`);
    assert(d.key_source === 'node', `the node key paid, got ${d.key_source}`);
    assert(d.cached === false, 'first call is not cached');
  });

  await test('2b. what ARRIVED at the provider carries no personal data, only placeholders', async () => {
    const last = seen[seen.length - 1];
    const raw = JSON.stringify(last.body);
    for (const bad of [EMAIL, HETU, 'Anna Virtanen', '040 123 4567']) {
      assert(!raw.includes(bad), `"${bad}" left the node`);
    }
    assert(raw.includes('[PERSON_'), 'a person placeholder was sent');
    assert(raw.includes('3323553-5'), 'the public business id is left alone');
    assert(last.auth === `Bearer ${NODE_KEY}`, 'the node key was used');
    assert(last.body.model === 'jev-1.13.0', 'the pinned model was requested');
  });

  await test('2c. the decision is on the register with thresholds, subject and request id', async () => {
    const r = await json(`/v1/ai/decisions/${decisionId}`, { headers: auth(A.token) });
    assert(r.status === 200, `got ${r.status}`);
    const rec = r.body.data.record;
    assert(rec.spec === 'aimeat.decision/v1', 'spec');
    assert(rec.thresholds?.urgent === 0.8, 'threshold in force recorded');
    assert(rec.subject === 'crm.contacts.anna' && rec.gates === 'who handles the mail', 'subject and gate');
    assert(typeof rec.requestId === 'string' && rec.requestId.startsWith('req-'), `request id, got ${rec.requestId}`);
    assert(/^sha256:[0-9a-f]{64}$/.test(rec.stateHash), 'a hash of the state, not the state');
    assert(rec.scrubbedState === undefined, 'no copy of the state by default');
  });

  await test('2d. the call is metered in the owner\'s usage', async () => {
    const r = await json('/v1/ai/usage', { headers: auth(A.token) });
    assert(r.status === 200, `got ${r.status}`);
    assert(r.body.data.total_calls >= 1, `calls ${r.body.data.total_calls}`);
    assert(r.body.data.per_app['decide-e2e']?.calls >= 1, 'attributed to the app id');
  });

  await test('2e. the same question again is answered from the record without a provider call', async () => {
    const before = seen.length;
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ state: STATE, questions: QUESTIONS, subject: 'crm.contacts.anna', app_id: 'decide-e2e' }),
    });
    assert(r.status === 200 && r.body.data.cached === true, `cached, got ${JSON.stringify(r.body.data?.cached)}`);
    assert(seen.length === before, 'no second provider call');
    assert(r.body.data.decision_id !== decisionId, 'the reuse is its own record');
  });

  await test('2f. another owner cannot read it', async () => {
    const r = await json(`/v1/ai/decisions/${decisionId}`, { headers: auth(B.token) });
    assert(r.status === 404, `got ${r.status}`);
    const l = await json('/v1/ai/decisions?subject=crm.contacts.anna', { headers: auth(B.token) });
    assert(l.status === 200 && l.body.data.total === 0, 'nothing in their list');
  });

  await test('2g. a person\'s review is recorded', async () => {
    const r = await json(`/v1/ai/decisions/${decisionId}/review`, {
      method: 'POST', headers: auth(A.token), body: JSON.stringify({ outcome: 'overridden', note: 'Anna is on holiday' }),
    });
    assert(r.status === 200 && r.body.data.record.review?.outcome === 'overridden', `got ${r.status}`);
    const other = await json(`/v1/ai/decisions/${decisionId}/review`, {
      method: 'POST', headers: auth(B.token), body: JSON.stringify({ outcome: 'confirmed' }),
    });
    assert(other.status === 404, `another owner's review is 404, got ${other.status}`);
  });

  await test('2h. an agent with ai:use decides in its owner\'s name', async () => {
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(agentAi),
      body: JSON.stringify({ state: { text: 'Invoice 42 is overdue.' }, questions: { overdue: { type: 'noul', instructions: 'An invoice is overdue.' } }, subject: 'inv.42' }),
    });
    assert(r.status === 200, `got ${r.status} ${JSON.stringify(r.body.error)}`);
    const l = await json('/v1/ai/decisions?subject=inv.42', { headers: auth(A.token) });
    assert(l.body.data.total === 1, 'the owner sees it');
    assert(String(l.body.data.decisions[0].principal).includes('deciderbot'), 'the agent is named as the principal');
  });

  console.log('\nPhase 3: an app must name TypeSafe in its data map');

  const appToken = await appGrantToken(A);
  await test('3a. an app with no data map is refused, and nothing is sent', async () => {
    const before = seen.length;
    const r = await json('/v1/ai/decide', { method: 'POST', headers: auth(appToken), body: JSON.stringify({ state: 'x', questions: { q: QUESTIONS.urgent } }) });
    assert(r.status === 403 && r.body.error?.code === 'DATAMAP_REQUIRED', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(seen.length === before, 'the stub was not called');
  });
  await test('3b. once the map says what goes to TypeSafe, the app is served', async () => {
    const w = await json(`/v1/datamap/apps/${A.name}/${FILENAME}`, {
      method: 'PUT', headers: auth(A.token),
      body: JSON.stringify({ spec: 'aimeat.datamap/2', what: 'Probe', usedFor: 'Testing decisions', form: 'one-person',
        leaves: [{ what: 'scrubbed text of the record being judged', to: 'TypeSafe (decision model, USA)', recallable: false }] }),
    });
    assert(w.status === 200, `datamap ${w.status}: ${JSON.stringify(w.body.error)}`);
    const r = await json('/v1/ai/decide', { method: 'POST', headers: auth(appToken), body: JSON.stringify({ state: 'Pay today.', questions: { q: QUESTIONS.urgent } }) });
    assert(r.status === 200, `got ${r.status} ${JSON.stringify(r.body.error)}`);
  });

  // One app, one name (services/ai-app-id.ts). The app token names the app by its file
  // (`decide-probe.html`), an owner session by what the app says (`decide-probe`); Päätöspaja was
  // recorded under both on aimeat.io on 2026-09-19, with the daily cap split between them.
  const APP_NAME = FILENAME.replace(/\.html$/, '');
  await test('3c. the app token and the owner naming the app land under ONE name', async () => {
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ state: 'Pay tomorrow.', questions: { q: QUESTIONS.urgent }, app_id: APP_NAME }),
    });
    assert(r.status === 200, `owner call ${r.status} ${JSON.stringify(r.body.error)}`);
    const byName = await json(`/v1/ai/decisions?app_id=${APP_NAME}`, { headers: auth(A.token) });
    const byFile = await json(`/v1/ai/decisions?app_id=${FILENAME}`, { headers: auth(A.token) });
    assert(byName.body.data.total === 2, `both calls under "${APP_NAME}", got ${byName.body.data.total}`);
    assert(byFile.body.data.total === 2, `the file name finds the same two, got ${byFile.body.data.total}`);
    const u = await json('/v1/ai/usage', { headers: auth(A.token) });
    assert(u.body.data.per_app[APP_NAME]?.calls === 2, `one spend row with both calls: ${JSON.stringify(u.body.data.per_app)}`);
    assert(u.body.data.per_app[FILENAME] === undefined, 'no second row under the file name');
  });
  await test('3d. a cap saved under the app\'s full reference holds for every name', async () => {
    const set = await json('/v1/ai/settings', {
      method: 'POST', headers: auth(A.token), body: JSON.stringify({ app_quotas: { [`${A.name}/${FILENAME}`]: { daily_usd: 0 } } }),
    });
    assert(set.status === 200, `settings ${set.status}`);
    const before = seen.length;
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ state: 'Pay next week.', questions: { q: QUESTIONS.urgent }, app_id: APP_NAME }),
    });
    assert(r.status === 402 && r.body.error?.code === 'APP_QUOTA_EXHAUSTED', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(seen.length === before, 'the stub was not called');
    await json('/v1/ai/settings', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ app_quotas: {} }) });
  });

  console.log('\nPhase 4: the owner\'s settings');

  await test('4a. the settings show who pays and never a key', async () => {
    const r = await json('/v1/ai/decide/settings', { headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.node_key_available === true && r.body.data.has_own_key === false, JSON.stringify(r.body.data));
    assert(!JSON.stringify(r.body).includes(NODE_KEY), 'the node key is not shown');
    assert(r.body.data.available === true && r.body.data.unavailable_reason === null, 'available, because the node has a key');
    const ov = await json('/v1/appdev/overview?sections=apps', { headers: auth(A.token) });
    assert(ov.status === 200, `appdev overview ${ov.status}`);
    assert(ov.body.data.decision_model?.available === true && ov.body.data.decision_model?.skill === 'node:aimeat-decide',
      `the appdev overview says the builder may use it, got ${JSON.stringify(ov.body.data.decision_model)}`);
  });
  await test('4b. an agent cannot change them', async () => {
    const r = await json('/v1/ai/decide/settings', { method: 'PUT', headers: auth(agentAi), body: JSON.stringify({ policy: { allow: ['email'] } }) });
    assert(r.status === 403, `got ${r.status}`);
  });
  await test('4c. the owner lets e-mail through, and only e-mail goes out unscrubbed', async () => {
    const p = await json('/v1/ai/decide/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ policy: { allow: ['email'] } }) });
    assert(p.status === 200 && p.body.data.policy.allow.includes('email'), `put ${p.status}`);
    const r = await json('/v1/ai/decide', {
      method: 'POST', headers: auth(A.token), body: JSON.stringify({ state: { note: `Mail ${EMAIL}, hetu ${HETU}` }, questions: { q: QUESTIONS.urgent }, cache: false }),
    });
    assert(r.status === 200, `decide ${r.status}`);
    const raw = JSON.stringify(seen[seen.length - 1].body);
    assert(raw.includes(EMAIL), 'the allowed class went through');
    assert(!raw.includes(HETU), 'the rest is still scrubbed');
    await json('/v1/ai/decide/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ policy: { allow: [] } }) });
  });
  await test('4d. with their own key set, their key pays and is never shown', async () => {
    const p = await json('/v1/ai/decide/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ api_key: OWN_KEY }) });
    assert(p.status === 200 && p.body.data.has_own_key === true, `put ${p.status}`);
    assert(!JSON.stringify(p.body).includes(OWN_KEY), 'the key is not echoed');
    const r = await json('/v1/ai/decide', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ state: 'Own key test.', questions: { q: QUESTIONS.urgent } }) });
    assert(r.status === 200 && r.body.data.key_source === 'own', `got ${r.status} ${r.body.data?.key_source}`);
    assert(seen[seen.length - 1].auth === `Bearer ${OWN_KEY}`, 'their key was sent');
  });
  await test('4d2. the key test makes one tiny call on the owner\'s key and says it works', async () => {
    const before = seen.length;
    const r = await json('/v1/ai/decide/settings/test', { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 200 && r.body.data.ok === true && r.body.data.key_source === 'own', `got ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
    assert(seen.length === before + 1 && seen[seen.length - 1].auth === `Bearer ${OWN_KEY}`, 'exactly one call, on their key');
    const agentTry = await json('/v1/ai/decide/settings/test', { method: 'POST', headers: auth(agentAi), body: '{}' });
    assert(agentTry.status === 403, `an agent may not run the owner's key test, got ${agentTry.status}`);
    // B, not A: on this node the first owner registered is the operator.
    const adminTry = await json('/v1/admin/decide/test', { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(adminTry.status === 403, `a non-operator may not test the node key, got ${adminTry.status}`);
    const adminOk = await json('/v1/admin/decide/test', { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(adminOk.status === 200 && adminOk.body.data.ok === true && adminOk.body.data.key_source === 'node', `operator test, got ${JSON.stringify(adminOk.body.data)}`);
    assert(seen[seen.length - 1].auth === `Bearer ${NODE_KEY}`, 'the operator test used the node key');
  });

  await test('4e. a key the provider refuses is the owner\'s to fix: 401 INVALID_API_KEY', async () => {
    stubStatus = 401;
    const r = await json('/v1/ai/decide', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ state: 'Refused.', questions: { q: QUESTIONS.urgent }, cache: false }) });
    stubStatus = 200;
    assert(r.status === 401 && r.body.error?.code === 'INVALID_API_KEY', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(!JSON.stringify(r.body).includes(OWN_KEY), 'the key is not in the error');
    stubStatus = 401;
    const t = await json('/v1/ai/decide/settings/test', { method: 'POST', headers: auth(A.token), body: '{}' });
    stubStatus = 200;
    assert(t.status === 200 && t.body.data.ok === false && t.body.data.code === 'INVALID_API_KEY', `key test on a refused key, got ${JSON.stringify(t.body.data)}`);
    const d = await json('/v1/ai/decide/settings/key', { method: 'DELETE', headers: auth(A.token) });
    assert(d.status === 200 && d.body.data.has_own_key === false, 'the key is forgotten');
  });

  console.log('\nPhase 5: one decision over many records');

  await test('5a. a run over three items finishes and records each', async () => {
    const r = await json('/v1/ai/decide/runs', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ questions: { q: QUESTIONS.urgent }, items: [
        { subject: 'run.1', state: 'Pay now.' }, { subject: 'run.2', state: 'No hurry.' }, { subject: 'run.3', state: 'Today please.' },
      ] }),
    });
    assert(r.status === 202, `got ${r.status} ${JSON.stringify(r.body.error)}`);
    const id = r.body.data.id;
    let run: any;
    for (let i = 0; i < 40; i++) {
      run = (await json(`/v1/ai/decide/runs/${id}`, { headers: auth(A.token) })).body.data;
      if (run.state !== 'running') break;
      await sleep(250);
    }
    assert(run.state === 'done', `state ${run.state}`);
    assert(run.counts.done === 3 && run.counts.failed === 0, JSON.stringify(run.counts));
    assert(Object.values(run.results).every((x: any) => typeof x.decision_id === 'string'), 'each item has a decision');
    const l = await json('/v1/ai/decisions?subject=run.2', { headers: auth(A.token) });
    assert(l.body.data.total === 1, 'the item decision is on the register');
  });

  console.log('\nPhase 6: the key stays on the node');

  await test('6a. the served library carries no key', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-decide.js`);
    const src = await res.text();
    assert(res.status === 200 && src.includes('decide'), `lib ${res.status}`);
    assert(!src.includes(NODE_KEY) && !src.includes(OWN_KEY), 'no key in the served library');
  });

  console.log('\nPhase 7: a decision rule, written once and run by name');

  const RULE = {
    title: 'Send the reply without a person reading it',
    decides: 'whether the drafted reply goes out on its own',
    sends: ['draft', 'question'],
    questions: { good: { type: 'noul', instructions: 'The draft answers the question fully and politely.' } },
    thresholds: { good: 0.5 },
    bands: { act: 0.85, ask: 0.5 },
    use: 'agent',
    gate: false,
    sample: { draft: 'Thank you, the invoice is attached.', question: 'Where is my invoice?' },
  };
  const put = (id: string, body: unknown, token = A.token) =>
    json(`/v1/ai/decide/rules/${id}`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
  const runRule = (token: string, rule: string, state: unknown, extra: Record<string, unknown> = {}) =>
    json('/v1/ai/decide', { method: 'POST', headers: auth(token), body: JSON.stringify({ rule, state, cache: false, ...extra }) });

  await test('7a. a rule with bands out of order, or a threshold naming no question, is refused with every problem', async () => {
    const r = await put('send-reply', { ...RULE, bands: { act: 0.4, ask: 0.6 }, thresholds: { nosuch: 0.5 } });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_RULE', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    const codes = (r.body.error.details?.problems ?? []).map((p: any) => p.code);
    assert(codes.includes('BANDS_NOT_ORDERED') && codes.includes('UNKNOWN_QUESTION'), `both problems named, got ${codes}`);
  });
  await test('7b. the owner writes a rule; an agent and another owner cannot', async () => {
    const asAgent = await put('send-reply', RULE, agentAi);
    assert(asAgent.status === 403, `an agent may not write a rule, got ${asAgent.status}`);
    const r = await put('send-reply', RULE);
    assert(r.status === 201 && r.body.data.rule.version === 1, `got ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const other = await json('/v1/ai/decide/rules/send-reply', { headers: auth(B.token) });
    assert(other.status === 404, `another owner does not see it, got ${other.status}`);
  });
  await test('7c. the version is bumped by a question change, and not by tuning a threshold', async () => {
    const tuned = await put('send-reply', { ...RULE, thresholds: { good: 0.55 } });
    assert(tuned.status === 200 && tuned.body.data.rule.version === 1, `tuning keeps the version, got ${tuned.body.data?.rule?.version}`);
    const reworded = await put('send-reply', { ...RULE, questions: { good: { type: 'noul', instructions: 'The draft fully answers the question and is polite.' } } });
    assert(reworded.body.data.rule.version === 2, `a new wording is version 2, got ${reworded.body.data?.rule?.version}`);
  });
  let ruleDecision = '';
  await test('7d. an agent runs it by name: the record carries the rule, its version and the outcome', async () => {
    const r = await runRule(agentAi, 'send-reply', RULE.sample, { subject: 'ticket.1' });
    assert(r.status === 200, `got ${r.status} ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    ruleDecision = d.decision_id;
    assert(d.rule?.id === 'send-reply' && d.rule?.version === 2, `rule on the answer, got ${JSON.stringify(d.rule)}`);
    assert(d.outcome === 'act' && d.proceed === true && d.passed?.good === true, `0.91 is in the act band, got ${d.outcome}`);
    assert(JSON.stringify(seen[seen.length - 1].body.questions) === JSON.stringify(RULE.questions).replace('answers the question fully and politely', 'fully answers the question and is polite'),
      'the questions that left the node are the rule\'s own');
    const rec = (await json(`/v1/ai/decisions/${ruleDecision}`, { headers: auth(A.token) })).body.data;
    assert(rec.rule === 'send-reply' && rec.ruleVersion === 2 && rec.outcome === 'act', `columns, got ${rec.rule} ${rec.ruleVersion} ${rec.outcome}`);
    assert(rec.record.thresholds?.good === 0.5 && rec.record.bands?.act === 0.85 && rec.record.gates === RULE.decides, 'thresholds, bands and what it gates are the rule\'s');
  });
  await test('7e. a caller may not override the rule: questions, thresholds or bands beside it are refused unsent', async () => {
    const before = seen.length;
    for (const extra of [{ questions: QUESTIONS }, { thresholds: { good: 0.01 } }, { bands: { act: 0, ask: 0 } }]) {
      const r = await runRule(agentAi, 'send-reply', RULE.sample, extra);
      assert(r.status === 400 && r.body.error?.code === 'RULE_FIXES_QUESTIONS', `${Object.keys(extra)[0]}: got ${r.status} ${r.body.error?.code}`);
    }
    const outside = await runRule(agentAi, 'send-reply', { ...RULE.sample, customerEmail: EMAIL });
    assert(outside.status === 400 && outside.body.error?.code === 'STATE_OUTSIDE_RULE', `a field the rule does not send, got ${outside.status} ${outside.body.error?.code}`);
    assert(seen.length === before, 'nothing reached the provider');
  });
  await test('7f. the use lock: a rule for agents refuses an app, and a rule for apps refuses an agent', async () => {
    const before = seen.length;
    const app = await runRule(appToken, 'send-reply', RULE.sample);
    assert(app.status === 403 && app.body.error?.code === 'RULE_NOT_FOR_CALLER', `app on an agent rule, got ${app.status} ${app.body.error?.code}`);
    const mk = await put('app-only', { ...RULE, title: 'App only', use: 'app' });
    assert(mk.status === 201, `put app-only ${mk.status}`);
    const agent = await runRule(agentAi, 'app-only', RULE.sample);
    assert(agent.status === 403 && agent.body.error?.code === 'RULE_NOT_FOR_CALLER', `agent on an app rule, got ${agent.status} ${agent.body.error?.code}`);
    assert(seen.length === before, 'neither reached the provider');
    const okApp = await runRule(appToken, 'app-only', RULE.sample);
    assert(okApp.status === 200 && okApp.body.data.outcome === 'act', `the app runs its own kind, got ${okApp.status} ${JSON.stringify(okApp.body.error)}`);
    const list = await json('/v1/ai/decide/rules', { headers: auth(agentAi) });
    const ids = (list.body.data.rules ?? []).map((x: any) => x.id);
    assert(ids.includes('send-reply') && !ids.includes('app-only'), `an agent is shown only what it may run, got ${ids}`);
    const missing = await runRule(agentAi, 'no-such-rule', RULE.sample);
    assert(missing.status === 404 && missing.body.error?.code === 'RULE_NOT_FOUND', `got ${missing.status}`);
  });
  await test('7g. the owner tries a rule on its sample, and a try is not counted as the rule\'s decision', async () => {
    const before = (await json('/v1/ai/decisions?rule=send-reply', { headers: auth(A.token) })).body.data.total;
    const r = await json('/v1/ai/decide/rules/send-reply/try', { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 200 && r.body.data.outcome === 'act', `got ${r.status} ${JSON.stringify(r.body.error ?? r.body.data?.outcome)}`);
    const after = (await json('/v1/ai/decisions?rule=send-reply', { headers: auth(A.token) })).body.data.total;
    assert(after === before, `the try is not among the rule's decisions (${before} then ${after})`);
    const agentTry = await json('/v1/ai/decide/rules/send-reply/try', { method: 'POST', headers: auth(agentAi), body: '{}' });
    assert(agentTry.status === 403, `an agent may not run the owner's try, got ${agentTry.status}`);
  });

  console.log('\nPhase 8: an agent proposes a rule, and nothing exists until the owner approves');

  let proposalId = '';
  await test('8a. a proposal creates no rule and lands on the owner\'s open-items list', async () => {
    const r = await json('/v1/ai/decide/rule-proposals', {
      method: 'POST', headers: auth(agentAi),
      body: JSON.stringify({ rule: { ...RULE, id: 'refund-ok', title: 'Refund without asking', use: 'agent' }, reason: 'Small refunds wait a day for a person today.' }),
    });
    assert(r.status === 202, `got ${r.status} ${JSON.stringify(r.body.error)}`);
    proposalId = r.body.data.proposal_id;
    const rule = await json('/v1/ai/decide/rules/refund-ok', { headers: auth(A.token) });
    assert(rule.status === 404, `no rule was created, got ${rule.status}`);
    const run = await runRule(agentAi, 'refund-ok', RULE.sample);
    assert(run.status === 404, `and it cannot be run, got ${run.status}`);
    const items = await json('/v1/open-items', { headers: auth(A.token) });
    assert((items.body.data.items ?? []).some((i: any) => i.object?.type === 'decision-rule-proposal' && i.object?.id === proposalId),
      'the owner\'s list carries the proposal');
    const bad = await json('/v1/ai/decide/rule-proposals', {
      method: 'POST', headers: auth(agentAi), body: JSON.stringify({ rule: { ...RULE, id: 'bad', bands: { act: 0.1, ask: 0.9 } }, reason: 'A rule the node would refuse.' }),
    });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_RULE', `an invalid proposal never reaches the owner, got ${bad.status}`);
    const asApp = await json('/v1/ai/decide/rule-proposals', {
      method: 'POST', headers: auth(appToken), body: JSON.stringify({ rule: { ...RULE, id: 'from-app' }, reason: 'An app has no business proposing rules.' }),
    });
    assert(asApp.status === 403, `an app may not propose, got ${asApp.status}`);
  });
  await test('8b. the agent cannot approve its own proposal; the owner\'s press creates the rule', async () => {
    const self = await json(`/v1/ai/decide/rule-proposals/${proposalId}/approve`, { method: 'POST', headers: auth(agentAi), body: '{}' });
    assert(self.status === 403, `got ${self.status}`);
    const other = await json(`/v1/ai/decide/rule-proposals/${proposalId}/approve`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(other.status === 404, `another owner, got ${other.status}`);
    const ok = await json(`/v1/ai/decide/rule-proposals/${proposalId}/approve`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(ok.status === 201 && ok.body.data.rule.id === 'refund-ok', `got ${ok.status} ${JSON.stringify(ok.body.error)}`);
    const run = await runRule(agentAi, 'refund-ok', RULE.sample);
    assert(run.status === 200, `now it runs, got ${run.status}`);
    const items = await json('/v1/open-items', { headers: auth(A.token) });
    assert(!(items.body.data.items ?? []).some((i: any) => i.object?.id === proposalId), 'the item is closed');
  });

  console.log('\nPhase 9: the gate, per agent, off by default');

  const gateItems = async () => ((await json('/v1/open-items', { headers: auth(A.token) })).body.data.items ?? [])
    .filter((i: any) => i.object?.type === 'ai-decision');
  await test('9a. switched off, a sub-threshold answer is recorded and the agent may proceed; nothing lands on the list', async () => {
    const r = await runRule(agentAi, 'send-reply', { draft: 'UNSURE draft', question: 'q' });
    assert(r.status === 200 && r.body.data.outcome === 'ask', `0.6 is in the ask band, got ${r.body.data?.outcome}`);
    assert(r.body.data.proceed === true && r.body.data.gate?.on === false, `ungated, got ${JSON.stringify(r.body.data.gate)}`);
    const rec = (await json(`/v1/ai/decisions/${r.body.data.decision_id}`, { headers: auth(A.token) })).body.data;
    assert(rec.outcome === 'ask' && rec.record.gate === undefined, 'recorded, with no gate');
    assert((await gateItems()).length === 0, 'no task for the owner');
  });
  await test('9b. only the owner switches it; switched on, the same answer becomes a task and the agent is told not to proceed', async () => {
    const byAgent = await json('/v1/agents/deciderbot/ai-keys', { method: 'PUT', headers: auth(agentAi), body: JSON.stringify({ gate: 'on' }) });
    assert(byAgent.status === 403, `an agent may not open its own gate, got ${byAgent.status}`);
    const on = await json('/v1/agents/deciderbot/ai-keys', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ gate: 'on' }) });
    assert(on.status === 200 && on.body.data.gate === 'on', `got ${on.status} ${JSON.stringify(on.body.error ?? on.body.data)}`);
    const r = await runRule(agentAi, 'send-reply', { draft: 'UNSURE second draft', question: 'q' }, { subject: 'ticket.2' });
    assert(r.status === 200 && r.body.data.outcome === 'ask' && r.body.data.proceed === false, `got ${JSON.stringify(r.body.data)}`);
    assert(r.body.data.gate?.on === true && r.body.data.gate?.stopped === true && typeof r.body.data.gate?.task === 'string', 'the gate stopped it and names the task');
    const items = await gateItems();
    assert(items.length === 1 && items[0].object.id === r.body.data.decision_id, `one task, about this decision, got ${items.length}`);
    const low = await runRule(agentAi, 'send-reply', { draft: 'HOPELESS draft', question: 'q' });
    assert(low.body.data.outcome === 'stop' && low.body.data.proceed === false, `under its floor is stop, got ${low.body.data?.outcome}`);
    const fine = await runRule(agentAi, 'send-reply', { draft: 'A good draft', question: 'q' });
    assert(fine.body.data.outcome === 'act' && fine.body.data.proceed === true && fine.body.data.gate?.stopped === false, 'an answer in the act band passes the gate');
  });
  await test('9c. the quality numbers count decisions, gate stops and overrides, per rule and per agent', async () => {
    await json(`/v1/ai/decisions/${ruleDecision}/review`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ outcome: 'overridden' }) });
    const s = await json('/v1/ai/decisions/stats?group_by=rule&rule=send-reply', { headers: auth(A.token) });
    assert(s.status === 200, `got ${s.status} ${JSON.stringify(s.body.error)}`);
    const g = s.body.data.groups[0];
    assert(g.key === 'send-reply' && g.decisions === 5, `five decisions by the rule, got ${JSON.stringify(g)}`);
    assert(g.gateStops === 2 && g.overridden === 1 && g.outcomes.ask === 2 && g.outcomes.stop === 1, `counts, got ${JSON.stringify(g)}`);
    const agentGaii = `deciderbot#${A.gaii}`;
    const pa = await json(`/v1/ai/decisions/stats?group_by=principal&principal=${encodeURIComponent(agentGaii)}`, { headers: auth(A.token) });
    assert(pa.body.data.groups[0]?.gateStops === 2, `the agent's own numbers, got ${JSON.stringify(pa.body.data.groups)}`);
    const theirs = await json('/v1/ai/decisions/stats?group_by=rule', { headers: auth(B.token) });
    assert(theirs.body.data.groups.length === 0, 'another owner counts nothing of this');
  });

  console.log('\nPhase 10: a key per agent');

  const AGENT_KEY = 'ts-agent-key-e2e-0003';
  await test('10a. the agent\'s own key pays, the record says so, and no door returns it', async () => {
    const set = await json('/v1/agents/deciderbot/ai-keys', {
      method: 'PUT', headers: auth(A.token), body: JSON.stringify({ decide: { api_key: AGENT_KEY, key_env: 'TYPESAFE_API_KEY' } }),
    });
    assert(set.status === 200 && set.body.data.decide.has_key === true && set.body.data.decide.key_env === 'TYPESAFE_API_KEY', `got ${set.status} ${JSON.stringify(set.body.error ?? set.body.data)}`);
    assert(!JSON.stringify(set.body).includes(AGENT_KEY), 'the key is not echoed');
    const r = await runRule(agentAi, 'send-reply', { draft: 'Paid by the agent', question: 'q' });
    assert(r.status === 200 && r.body.data.key_source === 'agent', `got ${r.status} ${r.body.data?.key_source}`);
    assert(seen[seen.length - 1].auth === `Bearer ${AGENT_KEY}`, 'the agent\'s key was sent to the provider');
    const rec = (await json(`/v1/ai/decisions/${r.body.data.decision_id}`, { headers: auth(A.token) })).body.data;
    assert(rec.keyScope === 'agent' && rec.record.keyScope === 'agent', `key_scope on the record, got ${rec.keyScope}`);
    const ownerCall = await runRule(A.token, 'send-reply', { draft: 'Asked by the owner', question: 'q' });
    assert(ownerCall.body.data.key_source === 'node', `the owner's own call does not use an agent's key, got ${ownerCall.body.data?.key_source}`);
    const otherAgent = await json('/v1/ai/decide', { method: 'POST', headers: auth(agentNoAi), body: JSON.stringify({ state: 'x', questions: { q: QUESTIONS.urgent } }) });
    assert(otherAgent.status === 403, 'another agent still needs ai:use');
  });
  await test('10b. the key is unreadable through every door: its own view, the memory doors, search and export', async () => {
    const recKey = 'decide.apikey.agent.deciderbot';
    const doors = [
      await json('/v1/agents/deciderbot/ai-keys', { headers: auth(A.token) }),
      await json('/v1/agents/deciderbot/ai-keys', { headers: auth(agentAi) }),
      await json(`/v1/memory/${recKey}`, { headers: auth(A.token) }),
      await json(`/v1/memory?prefix=decide.apikey`, { headers: auth(A.token) }),
      await json(`/v1/memory/search?q=${encodeURIComponent('decide.apikey')}`, { headers: auth(A.token) }),
      await json('/v1/memory/export', { headers: auth(A.token) }),
      await json('/v1/ai/decide/settings', { headers: auth(agentAi) }),
    ];
    for (const [i, d] of doors.entries()) {
      const raw = JSON.stringify(d.body);
      assert(!raw.includes(AGENT_KEY), `door ${i} returned the key`);
      assert(!/"encrypted"\s*:/.test(raw), `door ${i} returned the ciphertext`);
    }
    assert(doors[1].status === 200 && doors[1].body.data.decide.key_env === 'TYPESAFE_API_KEY', 'the agent is told the NAME of the variable, never the key');
    const write = await json(`/v1/memory/${recKey}`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ value: { encrypted: 'x' }, version: 1 }) });
    assert(write.status === 403 && write.body.error?.code === 'SECRET_RECORD', `the generic memory door refuses to write it, got ${write.status}`);
    const sibling = await json('/v1/agents/deciderbot/ai-keys', { headers: auth(agentNoAi) });
    assert(sibling.status === 403, `a sibling agent may not read another agent's settings, got ${sibling.status}`);
    const stranger = await json('/v1/agents/deciderbot/ai-keys', { headers: auth(B.token) });
    assert(stranger.status === 404, `another owner, got ${stranger.status}`);
  });
  await test('10c. a key name that is a key is refused, and the owner tests the agent\'s key', async () => {
    const bad = await json('/v1/agents/deciderbot/ai-keys', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ decide: { key_env: 'ts-live-abcdef123456' } }) });
    assert(bad.status === 400, `got ${bad.status}`);
    const before = seen.length;
    const t = await json('/v1/agents/deciderbot/ai-keys/decide/test', { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(t.status === 200 && t.body.data.ok === true && t.body.data.key_source === 'agent', `got ${t.status} ${JSON.stringify(t.body.data ?? t.body.error)}`);
    assert(seen.length === before + 1 && seen[seen.length - 1].auth === `Bearer ${AGENT_KEY}`, 'one call, on the agent\'s key');
  });
  await test('10d. the per-agent daily cap refuses the agent and nobody else, before anything is sent', async () => {
    const cap = await json('/v1/agents/deciderbot/ai-keys', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ daily_usd: 0 }) });
    assert(cap.status === 200 && cap.body.data.daily_usd === 0, `got ${cap.status}`);
    const before = seen.length;
    const r = await runRule(agentAi, 'send-reply', { draft: 'Over the cap', question: 'q' });
    assert(r.status === 402 && r.body.error?.code === 'AGENT_QUOTA_EXHAUSTED', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(seen.length === before, 'the stub was not called');
    const owner = await runRule(A.token, 'send-reply', { draft: 'The owner is not capped by it', question: 'q' });
    assert(owner.status === 200, `got ${owner.status}`);
    await json('/v1/agents/deciderbot/ai-keys', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ daily_usd: null }) });
  });
  await test('10e. forgetting the agent\'s key moves the next call down the order, to the node\'s key', async () => {
    const del = await json('/v1/agents/deciderbot/ai-keys/decide', { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200 && del.body.data.decide.has_key === false, `got ${del.status}`);
    const r = await runRule(agentAi, 'send-reply', { draft: 'Back on the node key', question: 'q' });
    assert(r.status === 200 && r.body.data.key_source === 'node', `falls back to the node's key, got ${r.body.data?.key_source}`);
  });

  await stopServer(server);
  stub.server.close();
  try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('SUITE CRASHED:', err);
  process.exit(1);
});

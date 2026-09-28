/**
 * @file test/e2e-refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mail refinery end to end (wish aimeat-refinery): a batch reads a connected
 *   mailbox, classifies each message, reads its fields from the text and the PDFs, and files it as a
 *   workspace row in a queue; the REST endpoints, the MCP tools and the `refinery` schedule kind all
 *   start the same batch.
 *
 *   WHAT IT RUNS AGAINST. The sandbox's test mailbox (scripts/lib/fake-mail-server.ts, in process):
 *   18 sample messages with the class and fields a person would give each, a PDF invoice with a text
 *   layer and one with none, and stand-ins for the decision model and the completion model that
 *   answer from those known answers and record what arrived. So a queue a message lands in is a
 *   fact about the pipeline, not about a model's mood.
 *
 *   WHAT IT PROVES:
 *   - a batch files each message in the queue its class and certainty call for, with its fields,
 *     and continues from where the last one stopped;
 *   - a PDF with a text layer is read here, and a scanned PDF goes to the model as a file;
 *   - one batch per definition at a time; a batch where every message fails files nothing; one
 *     failure among good ones is filed as Unclear with its error;
 *   - the refusals: a token lacking one of the four words, an agent running its owner's mailbox,
 *     another owner reading a run, a status without the word that reads mail;
 *   - a `refinery` schedule checks its input on create and runs a batch when triggered.
 *
 *   WHY IT OWNS ITS SERVER. The mailbox, the model addresses and loopback egress are boot-time
 *   settings. It follows the runner's backend: Postgres when the env file names it, a temporary
 *   SQLite file otherwise.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-refinery.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/e2e-refinery.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeMailServer, type FakeMailServer } from '../scripts/lib/fake-mail-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

// Its own port, outside the 40251-up range sessions claim; the mailbox takes an ephemeral one.
const PORT = process.env.E2E_REFINERY_PORT ?? '40449';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-refinery-'));
const DB_PATH = join(dbDir, 'refinery.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(mailPort: number): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const mail = `http://127.0.0.1:${mailPort}`;
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    AIMEAT_CONNECTIONS_ENABLED: 'true',
    AIMEAT_CONNECT_FAKE_BASE_URL: mail,
    AIMEAT_DECIDE_ENABLED: 'true',
    AIMEAT_DECIDE_BASE_URL: `${mail}/v1/systemone`,
    AIMEAT_TYPESAFE_INSTANCE_KEY: 'refinery-e2e-decide-key',
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openrouter: `${mail}/ai/v1` }),
    AIMEAT_OPENROUTER_INSTANCE_KEY: 'refinery-e2e-ai-key',
    AIMEAT_MODEL_DEFAULT_CHAT: 'e2e/refinery-model', AIMEAT_MODEL_DEFAULT_EXECUTION: 'e2e/refinery-model',
    AIMEAT_MODEL_DEFAULT_VISION: 'e2e/refinery-model', AIMEAT_MODEL_FREE_FALLBACK: 'e2e/refinery-model',
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the refinery node' });
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
  const name = `refinery${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', {
    method: 'POST', body: JSON.stringify({ username: name, display_name: 'Refinery Test', password: 'RefineryTest1234' }),
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'refinery-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}
const toolText = (r: any): string => String(r?.result?.content?.[0]?.text ?? r?.error?.message ?? '');

// ── the refinery's own world: a mailbox, an organism, a definition ────────────

/** Connect the owner to the test mailbox through the real round: start, consent, callback. */
async function connectMailbox(owner: Owner): Promise<string> {
  const start = await json('/v1/connections/start', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ provider: 'fake-mail', return_url: '/' }) });
  assert(start.status === 200, `connections/start ${start.status}: ${JSON.stringify(start.body?.error)}`);
  const consent = await fetch(start.body.data.authorize_url, { redirect: 'manual' });
  const callback = consent.headers.get('location');
  assert(!!callback, 'the mailbox sent the browser back');
  const done = await fetch(callback!, { redirect: 'manual' });
  assert(done.status < 400, `callback ${done.status}`);
  const list = await json('/v1/connections', { headers: auth(owner.token) });
  const found = (list.body.data?.connections ?? []).find((c: any) => c.provider === 'fake-mail');
  assert(!!found, 'the mailbox is listed after the round');
  return found.id as string;
}

async function makeWorkspace(owner: Owner): Promise<{ org: string; ws: string }> {
  const o = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: 'Refinery ' + Date.now().toString(36), description: 'Refinery e2e', type: 'team', visibility: 'private' }) });
  assert(o.status === 201 || o.status === 200, `organism ${o.status}: ${JSON.stringify(o.body?.error)}`);
  const org = o.body.data.id ?? o.body.data.organism?.id;
  const space = (name: string, ns: string, indexOn: string[]) =>
    ({ name, schemaRef: `schema:${name}@1`, namespace: ns, backing: 'rows', writeRole: 'member', mode: 'records', indexOn, retention: { maxDays: 365 } });
  const w = await json(`/v1/organisms/${org}/workspaces`, { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: 'Postin jalostus', manifest: { name: 'Postin jalostus', objectTypes: [
      space('viesti', 'posti.viesti', ['queue', 'klass', 'status']), space('tapahtuma', 'posti.tapahtuma', ['kind']),
    ] } }) });
  assert(w.status === 201 || w.status === 200, `workspace ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const d = w.body.data;
  const ws = d.id ?? d.workspace?.id ?? d.workspaceId ?? d.wsId ?? d.ws;
  assert(typeof ws === 'string' && ws.length > 0, `a workspace id: ${JSON.stringify(d).slice(0, 200)}`);
  return { org, ws };
}

async function saveDefinition(owner: Owner, prefix: string, value: Record<string, unknown>): Promise<void> {
  const r = await json('/v1/memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ key: `${prefix}.config`, visibility: 'private', value }) });
  assert(r.status === 201 || r.status === 200, `definition ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

async function waitRun(token: string, id: string): Promise<any> {
  for (let i = 0; i < 120; i++) {
    const r = await json(`/v1/refinery/runs/${id}`, { headers: auth(token) });
    assert(r.status === 200, `run status ${r.status}: ${JSON.stringify(r.body?.error)}`);
    if (r.body.data.run.status !== 'running') return r.body.data.run;
    await sleep(250);
  }
  throw new Error('the run did not finish in 30 s');
}

async function startBatch(token: string, body: Record<string, unknown>) {
  return json('/v1/refinery/runs', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
}

async function row(owner: Owner, org: string, ws: string, id: string): Promise<any> {
  const r = await json(`/v1/organisms/${org}/workspace/rows/viesti/${encodeURIComponent(`fake-mail:${id}`)}?ws=${ws}`, { headers: auth(owner.token) });
  if (r.status !== 200) return null;
  return r.body.data.row?.body ?? r.body.data.body ?? null;
}

// ── the suite ─────────────────────────────────────────────────────────────────

(async () => {
  const mail: FakeMailServer = await startFakeMailServer(0);
  const server = await startServer(mail.port);
  console.log('\nThe mail refinery (wish aimeat-refinery)\n');

  const A = await setupOwner('a');
  const B = await setupOwner('b');
  const mailbox = await connectMailbox(A);
  const { org, ws } = await makeWorkspace(A);
  const DEF = {
    v: 2, connectionId: mailbox, provider: 'fake-mail', since: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10),
    batchSize: 6, query: '', organismId: org, workspaceId: ws, thresholds: { clear: 0.8, unclear: 0.5 },
    models: { text: '', vision: '' }, rules: [], app: 'postinjalostamo.html',
    classes: ['receipt', 'invoice', 'order', 'booking', 'job', 'system', 'support', 'newsletter', 'personal'],
  };
  await saveDefinition(A, 'mt', DEF);

  // ── 1. The class packs ──
  await test('1a. GET /v1/refinery/classes lists the nine packs, an invoice with its due date and reference', async () => {
    const r = await json('/v1/refinery/classes', { headers: auth(A.token) });
    assert(r.status === 200, `got ${r.status}`);
    const ids = r.body.data.classes.map((c: any) => c.id);
    assert(ids.length === 9 && ids.includes('invoice') && ids.includes('personal'), `packs: ${ids.join(',')}`);
    const inv = r.body.data.classes.find((c: any) => c.id === 'invoice');
    const names = inv.fields.map((f: any) => f.name);
    assert(names.includes('due_date') && names.includes('reference'), `invoice fields: ${names.join(',')}`);
    assert(r.body.data.classes.find((c: any) => c.id === 'newsletter').process === false, 'a newsletter is filed, not processed');
  });

  await test('1b. no credential is 401 on all three endpoints', async () => {
    const a = await json('/v1/refinery/classes');
    const b = await json('/v1/refinery/runs', { method: 'POST', body: JSON.stringify({ prefix: 'mt' }) });
    const c = await json('/v1/refinery/runs/rr-x');
    assert(a.status === 401 && b.status === 401 && c.status === 401, `got ${a.status} ${b.status} ${c.status}`);
  });

  // ── 2. A batch, and the next one ──
  let first: any = null;
  await test('2a. a batch files the first six messages, each in the queue its class and certainty call for', async () => {
    const s = await startBatch(A.token, { prefix: 'mt' });
    assert(s.status === 202 && s.body.data.already_running === false, `got ${s.status} ${JSON.stringify(s.body?.error)}`);
    first = await waitRun(A.token, s.body.data.run.id);
    assert(first.status === 'done', `run ${first.status}: ${first.error}`);
    assert(first.n === 6 && first.counts.seen === 6 && first.counts.clear === 6, `counts ${JSON.stringify(first.counts)}`);
  });

  await test('2b. a digital invoice carries its fields, read from the PDF\'s own text', async () => {
    const r = await row(A, org, ws, 'm02');
    assert(r && r.queue === 'selkea' && r.klass === 'invoice', `row ${JSON.stringify(r)?.slice(0, 200)}`);
    assert(r.fields?.amount === 41.57 && r.fields?.due_date === '2026-10-05', `fields ${JSON.stringify(r.fields)}`);
    assert(r.extractor?.files === 0 && r.extractor?.attachmentChars > 40, `the text layer was read here: ${JSON.stringify(r.extractor)}`);
    assert(r.attachments?.[0]?.key && r.attachments[0].mime === 'application/pdf', `the PDF was stored: ${JSON.stringify(r.attachments)}`);
  });

  await test('2c. a scanned invoice has no text layer, so the PDF itself went to the model as a file', async () => {
    const r = await row(A, org, ws, 'm03');
    assert(r && r.queue === 'selkea' && r.fields?.reference === 'RF18 5390 0754 7034', `row ${JSON.stringify(r)?.slice(0, 240)}`);
    assert(r.extractor?.files === 1, `files ${JSON.stringify(r.extractor)}`);
    const call = mail.seen.chat.find((b: any) => JSON.stringify(b.messages).includes('Subject: Lasku 2026/117'));
    const parts = (call as any)?.messages?.flatMap((m: any) => Array.isArray(m.content) ? m.content : []) ?? [];
    assert(parts.some((p: any) => p.type === 'file' || p.type === 'image_url'), `the call carried the PDF: ${JSON.stringify(parts.map((p: any) => p.type))}`);
  });

  await test('2d. what reached the decision model had no sender address in it', async () => {
    const one = mail.seen.decide.find((b: any) => String(b.state?.subject ?? '').includes('Wolt')) as any;
    assert(!!one, 'the Wolt receipt was decided');
    assert(!JSON.stringify(one.state).includes('receipts@wolt.com'), `state ${JSON.stringify(one.state).slice(0, 200)}`);
    assert(one.state.from_domain === 'wolt.com', 'the domain is kept, it is what the class turns on');
  });

  await test('2e. the next batch continues from where the first stopped: an unsure alert is Unclear, newsletters and a letter are Skipped', async () => {
    const s = await startBatch(A.token, { prefix: 'mt' });
    const run = await waitRun(A.token, s.body.data.run.id);
    assert(run.status === 'done' && run.counts.seen === 6, `run ${run.status} ${JSON.stringify(run.counts)}`);
    assert(run.counts.clear === 1 && run.counts.unclear === 1 && run.counts.skip === 4, `counts ${JSON.stringify(run.counts)}`);
    const m08 = await row(A, org, ws, 'm08');
    assert(m08?.queue === 'epaselva' && m08.confidence === 0.64, `m08 ${JSON.stringify(m08)?.slice(0, 160)}`);
    const m09 = await row(A, org, ws, 'm09');
    assert(m09?.queue === 'ohitettu' && m09.klass === 'newsletter' && m09.fields === null, `m09 ${JSON.stringify(m09)?.slice(0, 160)}`);
  });

  await test('2f. the cursor and the run log are the owner\'s records', async () => {
    const c = await json('/v1/memory/mt.cursor', { headers: auth(A.token) });
    assert(c.status === 200 && c.body.data.value.page === '12', `cursor ${JSON.stringify(c.body.data?.value)}`);
    const l = await json('/v1/memory/mt.runs', { headers: auth(A.token) });
    assert(l.status === 200 && l.body.data.value.length === 2 && l.body.data.value[0].count === 6, `runs ${JSON.stringify(l.body.data?.value)?.slice(0, 200)}`);
  });

  // ── 3. Reruns, failures, one at a time ──
  await test('3a. message_ids runs one message again although it has a row', async () => {
    const s = await startBatch(A.token, { prefix: 'mt', message_ids: ['m01'] });
    const run = await waitRun(A.token, s.body.data.run.id);
    assert(run.status === 'done' && run.n === 1 && run.counts.seen === 1 && run.counts.skipped_seen === 0, `run ${JSON.stringify(run.counts)}`);
  });

  await test('3b. one failure among good ones is filed as Unclear with its error', async () => {
    const s = await startBatch(A.token, { prefix: 'mt', message_ids: ['m04', 'zz404'] });
    const run = await waitRun(A.token, s.body.data.run.id);
    assert(run.status === 'done' && run.counts.seen === 1 && run.counts.unclear === 1, `run ${run.status} ${JSON.stringify(run.counts)}`);
    const r = await row(A, org, ws, 'zz404');
    assert(r?.queue === 'epaselva' && r.klass === 'ERROR' && String(r.error).length > 0, `row ${JSON.stringify(r)?.slice(0, 200)}`);
  });

  await test('3c. a batch where every message fails files nothing and says why', async () => {
    const s = await startBatch(A.token, { prefix: 'mt', message_ids: ['zz1', 'zz2'] });
    const run = await waitRun(A.token, s.body.data.run.id);
    assert(run.status === 'failed' && String(run.error).startsWith('BATCH_FAILED'), `run ${run.status} ${run.error}`);
    assert(await row(A, org, ws, 'zz1') === null, 'no row was filed');
    const l = await json('/v1/memory/mt.runs', { headers: auth(A.token) });
    assert(String(l.body.data.value[0].error ?? '').length > 0 && l.body.data.value[0].failed === 2, `run log ${JSON.stringify(l.body.data.value[0])}`);
  });

  await test('3d. a second start while one runs answers 200 with the run already working', async () => {
    const [x, y] = await Promise.all([startBatch(A.token, { prefix: 'mt' }), startBatch(A.token, { prefix: 'mt' })]);
    const codes = [x.status, y.status].sort();
    assert(codes[0] === 200 && codes[1] === 202, `codes ${codes.join(',')}`);
    const again = x.status === 200 ? x : y;
    const other = x.status === 200 ? y : x;
    assert(again.body.data.already_running === true && again.body.data.run.id === other.body.data.run.id, 'the same run');
    await waitRun(A.token, other.body.data.run.id);
  });

  // ── 4. Refusals ──
  await test('4a. a prefix that is not a definition name is 400; a missing definition is a failed run that names it', async () => {
    const bad = await startBatch(A.token, { prefix: 'Bad Prefix!' });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `got ${bad.status}`);
    const s = await startBatch(A.token, { prefix: 'nothere' });
    const run = await waitRun(A.token, s.body.data.run.id);
    assert(run.status === 'failed' && String(run.error).startsWith('NO_DEFINITION'), `run ${run.error}`);
  });

  await test('4b. an agent lacking organism:rows is refused before anything runs', async () => {
    const t = await connectAgent(A, `refnorows${Date.now()}`, ['connections:read-through', 'ai:use', 'memory:write']);
    const r = await startBatch(t, { prefix: 'mt' });
    assert(r.status === 403, `got ${r.status} ${JSON.stringify(r.body?.error)}`);
  });

  let agentAll = '';
  await test('4c. an agent holding all four words cannot run its owner\'s mailbox: a connection is its maker\'s', async () => {
    agentAll = await connectAgent(A, `refall${Date.now()}`, ['connections:read-through', 'ai:use', 'organism:rows', 'memory:write', 'memory:read']);
    const s = await startBatch(agentAll, { prefix: 'mt' });
    assert(s.status === 202, `start ${s.status} ${JSON.stringify(s.body?.error)}`);
    const run = await waitRun(agentAll, s.body.data.run.id);
    assert(run.status === 'failed' && String(run.error).startsWith('NOT_FOUND'), `run ${run.status} ${run.error}`);
  });

  await test('4d. another owner does not see a run, and a token without connections:read-through cannot read one', async () => {
    const id = first.id;
    const other = await json(`/v1/refinery/runs/${id}`, { headers: auth(B.token) });
    assert(other.status === 404, `another owner got ${other.status}`);
    const narrow = await connectAgent(A, `refnarrow${Date.now()}`, ['memory:read']);
    const n = await json(`/v1/refinery/runs/${id}`, { headers: auth(narrow) });
    assert(n.status === 403, `a narrow agent got ${n.status}`);
  });

  // ── 5. The MCP tools ──
  await test('5a. over MCP an agent lists the packs, and its batch is refused for the mailbox, as on REST', async () => {
    const c = await mcpCall(agentAll, 'aimeat_refinery_classes', {});
    assert(toolText(c).includes('"invoice"'), `classes ${toolText(c).slice(0, 120)}`);
    const r = await mcpCall(agentAll, 'aimeat_refinery_run', { prefix: 'mt' });
    const started = JSON.parse(toolText(r));
    assert(typeof started.run?.id === 'string', `run ${toolText(r).slice(0, 160)}`);
    await sleep(400);
    const st = await mcpCall(agentAll, 'aimeat_refinery_status', { run_id: started.run.id });
    const run = JSON.parse(toolText(st)).run;
    assert(run.status === 'failed' && String(run.error).startsWith('NOT_FOUND'), `status ${toolText(st).slice(0, 200)}`);
  });

  await test('5b. an agent without the words does not get the run tool', async () => {
    const narrow = await connectAgent(A, `refmcpnarrow${Date.now()}`, ['memory:read']);
    const r = await mcpCall(narrow, 'aimeat_refinery_run', { prefix: 'mt' });
    assert(r.error || r.result?.isError, `the call should be refused: ${JSON.stringify(r).slice(0, 200)}`);
  });

  // ── 6. The schedule kind ──
  await test('6a. a refinery schedule checks its input: the prefix, the definition, and whose mailbox it is', async () => {
    const mk = (token: string, input: unknown) => json('/v1/schedules', { method: 'POST', headers: auth(token),
      body: JSON.stringify({ kind: 'refinery', cron: '0 6 * * *', display_name: 'Mail refinery', input }) });
    const bad = await mk(A.token, { prefix: 'Bad!' });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `bad prefix ${bad.status} ${bad.body.error?.code}`);
    const none = await mk(A.token, { prefix: 'nothere' });
    assert(none.status === 404, `no definition ${none.status}`);
    const byAgent = await mk(agentAll, { prefix: 'mt' });
    assert(byAgent.status === 404 && byAgent.body.error?.code === 'NOT_FOUND', `an agent on its owner's mailbox ${byAgent.status}`);
    const narrow = await connectAgent(A, `refschednarrow${Date.now()}`, ['connections:read-through', 'memory:write']);
    const scoped = await mk(narrow, { prefix: 'mt' });
    assert(scoped.status === 403 && scoped.body.error?.code === 'SCOPE_DENIED', `a narrow agent ${scoped.status}`);
    assert(String(scoped.body.error?.message).includes('organism:rows'), `the refusal names the missing word: ${scoped.body.error?.message}`);
  });

  await test('6b. the owner\'s schedule stores only the prefix, and a trigger runs the next batch', async () => {
    const c = await json('/v1/schedules', { method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ kind: 'refinery', cron: '0 6 * * *', display_name: 'Mail refinery', input: { prefix: 'mt', extra: 'dropped' } }) });
    assert(c.status === 201, `create ${c.status} ${JSON.stringify(c.body?.error)}`);
    const sched = c.body.data.schedule;
    assert(JSON.stringify(sched.input) === JSON.stringify({ prefix: 'mt' }), `input ${JSON.stringify(sched.input)}`);
    const before = (await json('/v1/memory/mt.runs', { headers: auth(A.token) })).body.data.value.length;
    const t = await json(`/v1/schedules/${sched.id}/trigger`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(t.status === 200 && t.body.data.outcome === 'ran', `trigger ${t.status} ${JSON.stringify(t.body?.data ?? t.body?.error)}`);
    const runs = (await json('/v1/memory/mt.runs', { headers: auth(A.token) })).body.data.value;
    assert(runs.length === before + 1 && String(runs[0].by).startsWith('schedule'), `runs ${JSON.stringify(runs[0])}`);
    const m14 = await row(A, org, ws, 'm14');
    assert(m14?.klass === 'booking' && m14.fields?.booking_number === 'HK-77120', `m14 ${JSON.stringify(m14)?.slice(0, 200)}`);
  });

  await stopServer(server);
  await mail.close();
  try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('SUITE CRASHED:', err);
  process.exit(1);
});

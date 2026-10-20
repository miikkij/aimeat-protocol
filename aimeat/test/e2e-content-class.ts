/**
 * @file test/e2e-content-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Content classes end to end (wish-sis-ll-n-purku-luokittelu-ja-owl): a stored file and
 *   a long memory record are read on arrival, the owner's settings decide which model steps run, a
 *   PDF invoice is classified and its fields extracted into a JSON-LD entity, a model's proposal for
 *   a new class waits for the owner and joins the OWL ontology when approved, a scan reads what
 *   arrived while the pipeline was off, and a removed file takes its facts with it.
 *
 *   WHAT IT RUNS AGAINST. Its own node, with the decision and completion models pointed at the
 *   sandbox's stand-ins (scripts/lib/fake-content-model.ts, in process through the fake mail server),
 *   so a class an item lands in is the pipeline's doing, not a model's mood.
 *
 *   WHAT IT PROVES:
 *   - on arrival, with nothing turned on, a PDF gets its author, title, pages, text layer and
 *     signature verdict, and a PNG its size, bit depth and the AI mark its XMP carries; no model is
 *     called (every model step is off by default);
 *   - with the steps on, the invoice is a member of `invoice` and its entity is typed cc:invoice;
 *     an extraction's new property waits as a proposal; a long recipe record, saved twice in a row,
 *     is described once and gets a class proposal, and approving it adds cc:recipe to the ontology;
 *   - a scan with missing_only reads a file stored while arrival was off; removing a file removes
 *     its facts;
 *   - the refusals: another owner and an agent asking for the owner's file answer 404; an agent
 *     without ai:use asking for a model step, and an agent without memory:write-reserved changing
 *     the settings, answer 403; an unknown setting answers 400 naming it; a token without
 *     storage:read is refused on every content route;
 *   - the five MCP tools answer as the routes do, and refuse what the routes refuse.
 *
 *   WHY IT OWNS ITS SERVER. The model addresses and loopback egress are boot-time settings. It
 *   follows the runner's backend: Postgres when the env file names it, a temporary SQLite file
 *   otherwise.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-content-class.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/e2e-content-class.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeMailServer, type FakeMailServer } from '../scripts/lib/fake-mail-server.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { buildXmp } from '../src/services/provenance-embed/xmp.js';
import { markPng } from '../src/services/provenance-embed/raster.js';

const PORT = process.env.E2E_CONTENT_CLASS_PORT ?? '40451';
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
  return { status: res.status, body, type: ct };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── fixtures ──────────────────────────────────────────────────────────────────

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A 24 × 16 RGB PNG carrying the node's own XMP that says a model made it. */
function aiMarkedPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(24, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((24 * 3 + 1) * 16, 0x80);
  for (let y = 0; y < 16; y++) raw[y * (24 * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const xmp = buildXmp({ digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    description: 'Made by an AI model.', records: [], markedAt: '2026-10-20T00:00:00Z', tool: 'AIMEAT e2e' });
  return markPng(png, xmp, 'Made by an AI model.');
}

/** A one-page invoice with Title and Author in its Info dictionary and a text layer. */
async function invoicePdf(): Promise<Buffer> {
  const PDFDocument = createRequire(import.meta.url)('pdfkit');
  return new Promise((resolve) => {
    const doc = new PDFDocument({ info: { Title: 'Lasku 2026-041', Author: 'Acme Oy' } });
    const parts: Buffer[] = [];
    doc.on('data', (c: Buffer) => parts.push(c));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.text('LASKU / INVOICE 2026-041');
    doc.text('Myyjä: Acme Oy. Eräpäivä: 2026-10-31. Yhteensä: 248,00 EUR.');
    doc.end();
  });
}

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-contentclass-'));
const DB_PATH = join(dbDir, 'contentclass.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(mailPort: number): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const stub = `http://127.0.0.1:${mailPort}`;
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_CONTENT_CLASS: 'on',
    AIMEAT_DECIDE_ENABLED: 'true',
    AIMEAT_DECIDE_BASE_URL: `${stub}/v1/systemone`,
    AIMEAT_TYPESAFE_INSTANCE_KEY: 'contentclass-e2e-decide-key',
    AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openrouter: `${stub}/ai/v1` }),
    AIMEAT_OPENROUTER_INSTANCE_KEY: 'contentclass-e2e-ai-key',
    AIMEAT_MODEL_DEFAULT_CHAT: 'e2e/content-model', AIMEAT_MODEL_DEFAULT_EXECUTION: 'e2e/content-model',
    AIMEAT_MODEL_DEFAULT_VISION: 'e2e/content-model', AIMEAT_MODEL_FREE_FALLBACK: 'e2e/content-model',
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the content class node' });
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
  const name = `cclass${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', {
    method: 'POST', body: JSON.stringify({ username: name, display_name: 'Content Class Test', password: 'ContentClass1234' }),
  });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, 'ContentClass1234');
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'content-class-e2e', version: '1.0.0' } }, 1);
  return rpc('tools/call', { name, arguments: args }, 2);
}
const toolText = (r: any): string => String(r?.result?.content?.[0]?.text ?? r?.error?.message ?? '');

async function store(owner: Owner, key: string, data: Buffer, mime: string) {
  const r = await json('/v1/storage', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key, data: data.toString('base64'), mime_type: mime }) });
  assert(r.status === 201, `store ${key} ${r.status} ${JSON.stringify(r.body?.error)}`);
}

const factsPath = (key: string, kind = 'file', owner?: string) =>
  `/v1/content/facts?kind=${kind}&key=${encodeURIComponent(key)}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}`;

/**
 * The facts of an item once the arrival hook has kept them; null after the wait. A memory record is
 * read only after ten quiet seconds (intake.ts MEMORY_QUIET_MS), so its wait is longer.
 */
async function factsOnArrival(owner: Owner, key: string, kind = 'file'): Promise<any> {
  const tries = kind === 'memory' ? 120 : 40;
  for (let i = 0; i < tries; i++) {
    const r = await json(factsPath(key, kind), { headers: auth(owner.token) });
    if (r.status === 200) return r.body.data.facts;
    await sleep(250);
  }
  return null;
}

// ── the suite ─────────────────────────────────────────────────────────────────

(async () => {
  const mail: FakeMailServer = await startFakeMailServer(0);
  const server = await startServer(mail.port);
  const A = await setupOwner('a');
  const B = await setupOwner('b');
  const pdf = await invoicePdf();

  await test('1. on arrival, a PDF is read without any model', async () => {
    const before = mail.seen.chat.length + mail.seen.decide.length;
    await store(A, 'docs/invoice.pdf', pdf, 'application/pdf');
    const f = await factsOnArrival(A, 'docs/invoice.pdf');
    assert(!!f, 'no facts after arrival');
    const p = f.technical.pdf;
    assert(f.technical.kind === 'pdf' && p.title === 'Lasku 2026-041' && p.author === 'Acme Oy' && p.pages === 1, `pdf ${JSON.stringify(p)}`);
    // Signature checking is on by default (AIMEAT_DOCSIGN_ENABLED), so an unsigned PDF says so.
    assert(p.signatures.verdict === 'unsigned', `signatures ${p.signatures.verdict}`);
    assert(!f.description && !f.classes, 'a model step ran although every model step is off by default');
    assert(mail.seen.chat.length + mail.seen.decide.length === before, 'a model was called on arrival with the model steps off');
    const t = await json(`/v1/content/text?kind=file&key=${encodeURIComponent('docs/invoice.pdf')}`, { headers: auth(A.token) });
    assert(t.status === 200 && String(t.body.data.text).includes('INVOICE 2026-041'), `text ${t.status} ${JSON.stringify(t.body?.data ?? t.body?.error)}`);
  });

  await test('2. a picture\'s AI mark and size are read from the picture itself', async () => {
    await store(A, 'pics/made.png', aiMarkedPng(), 'image/png');
    const f = await factsOnArrival(A, 'pics/made.png');
    assert(!!f, 'no facts after arrival');
    const t = f.technical;
    assert(t.kind === 'image' && t.image.width === 24 && t.image.height === 16 && t.image.bitDepth === 8, `image ${JSON.stringify(t.image)}`);
    assert(t.ai.verdict === 'ai-generated' && t.ai.sources.some((s: any) => s.from === 'iptc'), `ai ${JSON.stringify(t.ai)}`);
    assert(t.ai.euAiAct.marked === true && t.ai.euAiAct.markMissing === false, `euAiAct ${JSON.stringify(t.ai.euAiAct)}`);
  });

  await test('3. another owner, and the owner\'s own agent, cannot read the owner\'s facts', async () => {
    const other = await json(factsPath('docs/invoice.pdf', 'file', A.gaii), { headers: auth(B.token) });
    assert(other.status === 404, `another owner ${other.status}`);
    const own = await json(factsPath('docs/invoice.pdf'), { headers: auth(B.token) });
    assert(own.status === 404, `another owner's own namespace ${own.status}`);
    const agent = await connectAgent(A, `ccread${Date.now()}`, ['storage:read', 'storage:write']);
    const viaAgent = await json(factsPath('docs/invoice.pdf', 'file', A.gaii), { headers: auth(agent) });
    assert(viaAgent.status === 404, `the owner's agent on the owner's file ${viaAgent.status}`);
  });

  await test('4. a model step needs ai:use, and the settings need memory:write-reserved', async () => {
    const reader = await connectAgent(A, `ccnoai${Date.now()}`, ['storage:read', 'storage:write']);
    await json('/v1/storage', { method: 'POST', headers: auth(reader),
      body: JSON.stringify({ key: 'agent/own.pdf', data: pdf.toString('base64'), mime_type: 'application/pdf' }) });
    const r = await json('/v1/content/inspect', { method: 'POST', headers: auth(reader),
      body: JSON.stringify({ source: { kind: 'file', key: 'agent/own.pdf' }, stages: ['describe'] }) });
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED' && String(r.body.error.message).includes('ai:use'), `no ai:use ${r.status} ${JSON.stringify(r.body?.error)}`);
    const all = await connectAgent(A, `ccall${Date.now()}`, ['*']);
    const s = await json('/v1/content/settings', { method: 'PUT', headers: auth(all), body: JSON.stringify({ stages: { describe: true } }) });
    assert(s.status === 403 && String(s.body.error?.message).includes('memory:write-reserved'), `settings by an agent ${s.status} ${JSON.stringify(s.body?.error)}`);
    const bad = await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ stages: { nonsense: true } }) });
    assert(bad.status === 400 && String(bad.body.error?.message).includes('nonsense'), `unknown setting ${bad.status} ${JSON.stringify(bad.body?.error)}`);
  });

  await test('5. with the steps on, the invoice is classified and its fields extracted as JSON-LD', async () => {
    const s = await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token),
      body: JSON.stringify({ stages: { describe: true, classify: true, extract: true, propose: true } }) });
    assert(s.status === 200 && s.body.data.settings.stages.extract === true, `settings ${s.status}`);
    const r = await json('/v1/content/inspect', { method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ source: { kind: 'file', key: 'docs/invoice.pdf' } }) });
    assert(r.status === 200, `inspect ${r.status} ${JSON.stringify(r.body?.error)}`);
    const f = r.body.data.facts;
    assert(r.body.data.ran.includes('classify') && r.body.data.ran.includes('extract'), `ran ${JSON.stringify(r.body.data.ran)} skipped ${JSON.stringify(r.body.data.skipped)}`);
    assert(f.classes?.some((c: any) => c.id === 'invoice' && c.confidence >= 0.6), `classes ${JSON.stringify(f.classes)}`);
    const e = f.entities?.invoice?.entity;
    assert(e && e['@type'].includes('cc:invoice') && e['@type'].includes('schema:Invoice') && e['cc:invoice.amount'] === 248, `entity ${JSON.stringify(e)}`);
    const p = await json('/v1/content/proposals?status=pending', { headers: auth(A.token) });
    assert(p.body.data.proposals.some((x: any) => x.kind === 'properties' && x.classId === 'invoice'), `proposals ${JSON.stringify(p.body.data.proposals)}`);
  });

  await test('6. a long recipe record gets a class proposal on arrival, and approving it extends the ontology', async () => {
    await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ minTextChars: 200 }) });
    const describing = () => mail.seen.chat.filter((c: any) => JSON.stringify(c).includes('Summarise the content below')).length;
    const describesBefore = describing();
    const recipe ='Resepti: mustikkapiirakka. Ainekset: voita, sokeria, munia, jauhoja ja mustikoita. '.repeat(4);
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'notes.recipe.pie', value: recipe, visibility: 'private' }) });
    assert(w.status === 201, `memory ${w.status}`);
    // Saved twice in a row, as an editor saves while a person types: read once, after the quiet time.
    const again = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'notes.recipe.pie', value: recipe + ' Tarjoile kermavaahdon kanssa.', visibility: 'private' }) });
    assert(again.status === 200, `memory again ${again.status}`);
    const f = await factsOnArrival(A, 'notes.recipe.pie', 'memory');
    assert(f && f.stages?.propose?.ok, `recipe facts ${JSON.stringify(f?.stages)}`);
    await sleep(1500);
    const describes = describing() - describesBefore;
    assert(describes === 1, `two quick saves were described ${describes} times, not once`);
    const p = await json('/v1/content/proposals?status=pending', { headers: auth(A.token) });
    const prop = p.body.data.proposals.find((x: any) => x.kind === 'class' && x.class?.id === 'recipe');
    assert(!!prop, `no recipe proposal in ${JSON.stringify(p.body.data.proposals.map((x: any) => x.class?.id ?? x.classId))}`);
    const d = await json(`/v1/content/proposals/${prop.id}`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(d.status === 200 && d.body.data.proposal.status === 'approved', `approve ${d.status}`);
    const o = await json('/v1/content/ontology?format=jsonld', { headers: auth(A.token) });
    assert(o.type.includes('application/ld+json'), `ontology type ${o.type}`);
    const graph = (o.body['@graph'] ?? []) as any[];
    assert(graph.some((n) => n['@id'] === 'cc:recipe' && n['@type'] === 'owl:Class'), 'cc:recipe is not in the ontology');
    assert(graph.some((n) => n['@id'] === 'cc:recipe.servings' && n['rdfs:range']?.['@id'] === 'xsd:decimal'), 'cc:recipe.servings is not a decimal property');
  });

  await test('7. a scan reads what arrived while arrival was off, and a removed file takes its facts', async () => {
    await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token),
      body: JSON.stringify({ onArrival: false, stages: { describe: false, classify: false, extract: false, propose: false } }) });
    await store(A, 'docs/later.pdf', pdf, 'application/pdf');
    await sleep(800);
    const none = await json(factsPath('docs/later.pdf'), { headers: auth(A.token) });
    assert(none.status === 404, `facts with arrival off ${none.status}`);
    const s = await json('/v1/content/scans', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ kinds: ['pdf'] }) });
    assert(s.status === 202, `scan ${s.status} ${JSON.stringify(s.body?.error)}`);
    let scan: any = null;
    for (let i = 0; i < 40 && scan?.status !== 'done'; i++) {
      await sleep(150);
      scan = (await json(`/v1/content/scans/${s.body.data.scan.id}`, { headers: auth(A.token) })).body.data?.scan;
    }
    assert(scan?.status === 'done' && scan.counts.inspected >= 1, `scan ${JSON.stringify(scan)}`);
    const got = await json(factsPath('docs/later.pdf'), { headers: auth(A.token) });
    assert(got.status === 200 && got.body.data.facts.technical.pdf.pages === 1, `facts after scan ${got.status}`);
    const del = await json('/v1/storage/' + encodeURIComponent('docs/later.pdf'), { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200, `delete ${del.status}`);
    let gone = 0;
    for (let i = 0; i < 20 && gone !== 404; i++) { await sleep(150); gone = (await json(factsPath('docs/later.pdf'), { headers: auth(A.token) })).status; }
    assert(gone === 404, `facts of a removed file ${gone}`);
  });

  await test('8. a token without storage:read is refused on every content route', async () => {
    const t = await connectAgent(A, `ccnoread${Date.now()}`, ['memory:read', 'memory:write']);
    const h = { headers: auth(t) };
    const r1 = await json('/v1/content', h);
    assert(r1.status === 403, `GET /v1/content ${r1.status}`);
    const r2 = await json('/v1/content/facts?kind=file&key=docs%2Finvoice.pdf', h);
    assert(r2.status === 403, `GET /v1/content/facts ${r2.status}`);
    const r3 = await json('/v1/content/text?kind=file&key=docs%2Finvoice.pdf', h);
    assert(r3.status === 403, `GET /v1/content/text ${r3.status}`);
    const r4 = await json('/v1/content/inspect', { method: 'POST', ...h, body: JSON.stringify({ source: { key: 'docs/invoice.pdf' } }) });
    assert(r4.status === 403, `POST /v1/content/inspect ${r4.status}`);
    const r5 = await json('/v1/content/scans', { method: 'POST', ...h, body: '{}' });
    assert(r5.status === 403, `POST /v1/content/scans ${r5.status}`);
    const r6 = await json('/v1/content/scans/scan_0000000000000000', h);
    assert(r6.status === 403, `GET /v1/content/scans/{id} ${r6.status}`);
    const r7 = await json('/v1/content/settings', h);
    assert(r7.status === 403, `GET /v1/content/settings ${r7.status}`);
    const r8 = await json('/v1/content/settings', { method: 'PUT', ...h, body: JSON.stringify({ onArrival: true }) });
    assert(r8.status === 403, `PUT /v1/content/settings ${r8.status}`);
    const r9 = await json('/v1/content/classes', h);
    assert(r9.status === 403, `GET /v1/content/classes ${r9.status}`);
    const r10 = await json('/v1/content/classes/recipe', { method: 'PUT', ...h, body: JSON.stringify({ label: { fi: 'x', en: 'x' } }) });
    assert(r10.status === 403, `PUT /v1/content/classes/{id} ${r10.status}`);
    const r11 = await json('/v1/content/classes/recipe', { method: 'DELETE', ...h });
    assert(r11.status === 403, `DELETE /v1/content/classes/{id} ${r11.status}`);
    const r12 = await json('/v1/content/proposals', h);
    assert(r12.status === 403, `GET /v1/content/proposals ${r12.status}`);
    const r13 = await json('/v1/content/proposals/prop-none', { method: 'POST', ...h, body: JSON.stringify({ decision: 'reject' }) });
    assert(r13.status === 403, `POST /v1/content/proposals/{id} ${r13.status}`);
    const r14 = await json('/v1/content/ontology', h);
    assert(r14.status === 403, `GET /v1/content/ontology ${r14.status}`);
  });

  await test('9. the MCP tools answer as REST does, and refuse what REST refuses', async () => {
    const agent = await connectAgent(A, `ccmcp${Date.now()}`, ['*']);
    await json('/v1/storage', { method: 'POST', headers: auth(agent),
      body: JSON.stringify({ key: 'mcp/own.pdf', data: pdf.toString('base64'), mime_type: 'application/pdf' }) });
    const insp = await mcpCall(agent, 'aimeat_content_inspect', { kind: 'file', key: 'mcp/own.pdf' });
    assert(!insp?.result?.isError && toolText(insp).includes('Lasku 2026-041'), `inspect ${toolText(insp).slice(0, 200)}`);
    const facts = await mcpCall(agent, 'aimeat_content_facts', { kind: 'file', key: 'mcp/own.pdf', with_text: true });
    assert(!facts?.result?.isError && toolText(facts).includes('INVOICE 2026-041'), `facts ${toolText(facts).slice(0, 200)}`);
    const owners = await mcpCall(agent, 'aimeat_content_facts', { kind: 'file', key: 'docs/invoice.pdf', owner: A.gaii });
    assert(owners?.result?.isError === true && toolText(owners).includes('NOT_FOUND'), `the owner's file over MCP ${toolText(owners).slice(0, 200)}`);
    const scan = await mcpCall(agent, 'aimeat_content_scan', { kinds: ['pdf'] });
    assert(!scan?.result?.isError && toolText(scan).includes('scan_'), `scan ${toolText(scan).slice(0, 200)}`);
    const classes = await mcpCall(agent, 'aimeat_content_classes', { action: 'ontology' });
    assert(!classes?.result?.isError && toolText(classes).includes('owl:Ontology'), `ontology ${toolText(classes).slice(0, 200)}`);
    const settings = await mcpCall(agent, 'aimeat_content_settings', {});
    assert(!settings?.result?.isError && toolText(settings).includes('onArrival'), `settings ${toolText(settings).slice(0, 200)}`);
    const change = await mcpCall(agent, 'aimeat_content_settings', { patch: { stages: { describe: true } } });
    assert(change?.result?.isError === true && toolText(change).includes('memory:write-reserved'), `settings change over MCP ${toolText(change).slice(0, 200)}`);
    const approve = await mcpCall(agent, 'aimeat_content_classes', { action: 'approve', id: 'prop-none' });
    assert(approve?.result?.isError === true && toolText(approve).includes('memory:write-reserved'), `approve over MCP ${toolText(approve).slice(0, 200)}`);
  });

  await test('10. a person corrects a class and a field; the decision says so, and a new extraction keeps the value', async () => {
    const src = { kind: 'file', key: 'docs/invoice.pdf' };
    await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ stages: { extract: true } }) });
    // The field first: the invoice's due date as the person says it is.
    const f = await json('/v1/content/correct', { method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ source: src, fields: { invoice: { due_date: '2026-11-30', reference: null } } }) });
    assert(f.status === 200, `fields ${f.status} ${JSON.stringify(f.body?.error)}`);
    const e = f.body.data.facts.entities.invoice;
    assert(e.entity['cc:invoice.due_date'] === '2026-11-30' && !('cc:invoice.reference' in e.entity), `entity ${JSON.stringify(e.entity)}`);
    assert(JSON.stringify(e.corrected?.properties?.sort()) === JSON.stringify(['due_date', 'reference']), `corrected ${JSON.stringify(e.corrected)}`);
    // Extract again: the model answers 2026-10-31 for every date; the corrected value stays.
    const again = await json('/v1/content/inspect', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ source: src, stages: ['extract'], force: true }) });
    assert(again.status === 200 && again.body.data.facts.entities.invoice.entity['cc:invoice.due_date'] === '2026-11-30', `after extract ${JSON.stringify(again.body?.data?.facts?.entities?.invoice?.entity)}`);
    assert(again.body.data.facts.entities.invoice.entity['cc:invoice.date'] === '2026-10-31', 'an uncorrected field is extracted again');
    // The class: the person says it is a receipt, not an invoice.
    const decisionId = again.body.data.facts.classes.find((m: any) => m.id === 'invoice')?.decisionId;
    const c = await json('/v1/content/correct', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ source: src, classes: ['receipt'] }) });
    assert(c.status === 200, `classes ${c.status} ${JSON.stringify(c.body?.error)}`);
    const cls = c.body.data.facts.classes;
    assert(cls.length === 1 && cls[0].id === 'receipt' && cls[0].by === 'owner', `classes ${JSON.stringify(cls)}`);
    assert(!c.body.data.facts.entities?.invoice, 'the invoice entity went with its class');
    assert(JSON.stringify(c.body.data.review ?? null).includes('"overridden"'), `review ${JSON.stringify(c.body.data.review)?.slice(0, 300)}`);
    const d = await json(`/v1/ai/decisions/${decisionId}`, { headers: auth(A.token) });
    assert(JSON.stringify(d.body).includes('overridden'), `the decision record ${d.status} ${JSON.stringify(d.body)?.slice(0, 300)}`);
    // Refusals: an unknown class, another owner, an agent without memory:write.
    const unknown = await json('/v1/content/correct', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ source: src, classes: ['no-such-class'] }) });
    assert(unknown.status === 400 && String(unknown.body.error?.message).includes('no-such-class'), `unknown class ${unknown.status}`);
    const other = await json('/v1/content/correct', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ source: { ...src, owner: A.gaii }, classes: [] }) });
    assert(other.status === 404, `another owner ${other.status}`);
    const reader = await connectAgent(A, `cccorr${Date.now()}`, ['storage:read', 'storage:write']);
    await json('/v1/storage', { method: 'POST', headers: auth(reader),
      body: JSON.stringify({ key: 'agent/corr.pdf', data: pdf.toString('base64'), mime_type: 'application/pdf' }) });
    await factsOnArrival({ ...A, token: reader }, 'agent/corr.pdf');
    const noWrite = await json('/v1/content/correct', { method: 'POST', headers: auth(reader), body: JSON.stringify({ source: { key: 'agent/corr.pdf' }, classes: [] }) });
    assert(noWrite.status === 403 && String(noWrite.body.error?.message).includes('memory:write'), `no memory:write ${noWrite.status} ${JSON.stringify(noWrite.body?.error)}`);
    // The same over MCP, as the person's AI does it.
    const agent = await connectAgent(A, `ccmcpcorr${Date.now()}`, ['*']);
    const viaMcp = await mcpCall(agent, 'aimeat_content_correct', { kind: 'file', key: 'docs/invoice.pdf', owner: A.gaii, classes: ['receipt'] });
    assert(viaMcp?.result?.isError === true && toolText(viaMcp).includes('NOT_FOUND'), `an agent on its owner's item over MCP ${toolText(viaMcp).slice(0, 200)}`);
    await json('/v1/storage', { method: 'POST', headers: auth(agent),
      body: JSON.stringify({ key: 'mcp/corr.pdf', data: pdf.toString('base64'), mime_type: 'application/pdf' }) });
    await mcpCall(agent, 'aimeat_content_inspect', { kind: 'file', key: 'mcp/corr.pdf' });
    const mine = await mcpCall(agent, 'aimeat_content_correct', { kind: 'file', key: 'mcp/corr.pdf', classes: ['contract'], fields: { contract: { subject: 'Lease' } } });
    assert(!mine?.result?.isError && toolText(mine).includes('cc:contract.subject'), `correct over MCP ${toolText(mine).slice(0, 300)}`);
    await json('/v1/content/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ stages: { extract: false } }) });
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

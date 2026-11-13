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
 *   - the five MCP tools answer as the routes do, and refuse what the routes refuse;
 *   - a picture whose metadata read never ends leaves the node answering, and at the media read time
 *     limit its facts keep the format and size and name the limit and its setting;
 *   - the fingerprint is off by default, needs ai:use, labels each section of a long text, answers
 *     the tag and (asked) the sections, and stays the owner's own.
 *
 *   WHY IT OWNS ITS SERVER. The model addresses and loopback egress are boot-time settings. It
 *   follows the runner's backend: Postgres when the env file names it, a temporary SQLite file
 *   otherwise.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-content-class.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/e2e-content-class.ts
 * @version-history
 *   2026-11-13 — Test 12c: the person's AI makes the fingerprint of the person's context by its key
 *     alone, the person's own read sees it, a private record needs memory:read-as-owner, and another
 *     person's agent reaches nothing. Before the fix every AI connected over MCP got NOT_FOUND.
 *   2026-11-06 — Test 12b: the fingerprint is made only on request; with the profile step on, an
 *     arriving text and an inspect on the settings make none. Test 12: the sections file is never read
 *     on arrival (each reading had stored the next file, without end).
 *   2026-11-03 — Tests 4 and 9: an agent refused a permission by the content service gets the address
 *     where its person allows it, on REST (`details.allow_url` and a next action) and over MCP.
 *   2026-11-03 — Test 13: a workspace document's shared fingerprint: one for every reader, read with
 *     the document's read rule, listed by prefix, made again or corrected only by an editor, stale
 *     after a new version, made on publication when the workspace turned it on, gone with the document.
 *   2026-11-02 — Test 12: the fingerprint (the profile step): off by default, ai:use to run it, the
 *     tag and the sections on the facts answer, another owner refused, the MCP tools the same.
 *   2026-11-01 — Test 11: a HEIF whose box walk never ends does not hold the node; the facts name
 *     content_class.media_read_seconds (secaudit2026oct31w2 round 12).
 *   2026-10-31 — Test 9b: a correction whose fields are refused leaves the classes and the model's
 *     decision record as they were (secaudit 2026-10-31 inv-16).
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

const PORT = process.env.E2E_CONTENT_CLASS_PORT ?? '28451';
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

/**
 * A HEIF that exifr opens, whose second top-level box declares length 0: exifr's box walk stays on
 * that offset until the media read time limit ends it (services/content/media-read-bounded.ts).
 */
function heifZeroBox(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftypheic', 4, 'latin1');
  ftyp.write('mif1heic', 16, 'latin1');
  const box = Buffer.alloc(16);
  box.write('free', 4, 'latin1');
  return Buffer.concat([ftyp, box, Buffer.alloc(64)]);
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

/** A report of three sections the fake model marks + ~ ? (scripts/lib/fake-content-model.ts). */
function fingerprintDoc(extra = ''): string {
  const filler = 'Tämä kappale jatkuu vielä useilla sanoilla, jotta osio on riittävän pitkä omaksi osiokseen eikä yhdisty seuraavaan osioon.';
  return [
    '# Kaukolämpöraportti',
    `## Hinnat\nKeskihinta nousi 38 % vuonna 2025. Lähde: https://example.org/raportti-2025. ${filler} ${filler}`,
    `## Päätös\nKokouksessa päätettiin, että hintavertailu julkaistaan keväällä ja vastuuhenkilö kokoaa sen. ${filler} ${filler}`,
    `## Näkemys\nKaukolämpö on aina paras ratkaisu kaikille kotitalouksille ja muuttaa koko alan suunnan. ${filler} ${filler}${extra}`,
  ].join('\n\n');
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
    const readerName = `ccnoai${Date.now()}`;
    const reader = await connectAgent(A, readerName, ['storage:read', 'storage:write']);
    await json('/v1/storage', { method: 'POST', headers: auth(reader),
      body: JSON.stringify({ key: 'agent/own.pdf', data: pdf.toString('base64'), mime_type: 'application/pdf' }) });
    const r = await json('/v1/content/inspect', { method: 'POST', headers: auth(reader),
      body: JSON.stringify({ source: { kind: 'file', key: 'agent/own.pdf' }, stages: ['describe'] }) });
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED' && String(r.body.error.message).includes('ai:use'), `no ai:use ${r.status} ${JSON.stringify(r.body?.error)}`);
    // The refusal hands the agent the address where its person allows the word, as a route's
    // requireScope does (auth/deny.ts): the one-press page, or the agent's page for a word that
    // needs its own tick.
    const allowsAt = (body: any, agentName: string, word: string) => {
      const d = body?.error?.details ?? {};
      const url = String(d.allow_url ?? '');
      const where = d.one_press === true ? url.includes('/v1/allow?') && url.includes(`need=${encodeURIComponent(word)}`) : url.includes('/v1/profile?tab=agents');
      return where && url.includes(`agent=${agentName}`) && JSON.stringify(d.needed) === JSON.stringify([word])
        && (body?.hints?.next_actions ?? []).some((a: any) => a.url === url);
    };
    assert(allowsAt(r.body, readerName, 'ai:use'), `no allow address for ai:use ${JSON.stringify(r.body?.error)} ${JSON.stringify(r.body?.hints)}`);
    const allName = `ccall${Date.now()}`;
    const all = await connectAgent(A, allName, ['*']);
    const s = await json('/v1/content/settings', { method: 'PUT', headers: auth(all), body: JSON.stringify({ stages: { describe: true } }) });
    assert(s.status === 403 && String(s.body.error?.message).includes('memory:write-reserved'), `settings by an agent ${s.status} ${JSON.stringify(s.body?.error)}`);
    assert(allowsAt(s.body, allName, 'memory:write-reserved'), `no allow address for the settings ${JSON.stringify(s.body?.error)}`);
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
    assert(e['cc:invoice.vendor'] === 'Acme Oy' && e['cc:invoice.due_date'] === '2026-10-31' && !('cc:invoice.vat' in e), `what the invoice states, and nothing it does not ${JSON.stringify(e)}`);
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
    const mcpName = `ccmcp${Date.now()}`;
    const agent = await connectAgent(A, mcpName, ['*']);
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
    assert(toolText(change).startsWith('SCOPE_DENIED') && toolText(change).includes(`agent=${mcpName}`)
      && /\/v1\/(allow\?|profile\?tab=agents)/.test(toolText(change)), `no allow address over MCP ${toolText(change).slice(0, 400)}`);
    const approve = await mcpCall(agent, 'aimeat_content_classes', { action: 'approve', id: 'prop-none' });
    assert(approve?.result?.isError === true && toolText(approve).includes('memory:write-reserved'), `approve over MCP ${toolText(approve).slice(0, 200)}`);
  });

  await test('9b. a correction whose fields are refused changes nothing: the classes stay and the model\'s decision is not reviewed', async () => {
    const before = await json('/v1/content/facts?kind=file&key=docs%2Finvoice.pdf', { headers: auth(A.token) });
    assert(before.status === 200, `facts ${before.status} ${JSON.stringify(before.body?.error)}`);
    const decisionId = (before.body.data.facts.classes ?? []).find((m: any) => m.id === 'invoice' && m.by === 'model')?.decisionId;
    assert(typeof decisionId === 'string' && decisionId.length > 0, `the model's class carries its decision ${JSON.stringify(before.body.data.facts.classes)}`);
    // A new class list and a field the class does not have, in one call: the field is refused.
    const r = await json('/v1/content/correct', { method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ source: { kind: 'file', key: 'docs/invoice.pdf' }, classes: ['receipt'], fields: { receipt: { no_such_property: 'x' } } }) });
    assert(r.status === 400 && String(r.body.error?.message).includes('no_such_property'), `refused fields ${r.status} ${JSON.stringify(r.body?.error)}`);
    const after = await json('/v1/content/facts?kind=file&key=docs%2Finvoice.pdf', { headers: auth(A.token) });
    assert((after.body.data.facts.classes ?? []).some((m: any) => m.id === 'invoice' && m.by === 'model'), `the classes stay ${JSON.stringify(after.body.data.facts.classes)}`);
    const d = await json(`/v1/ai/decisions/${decisionId}`, { headers: auth(A.token) });
    assert(d.status === 200 && !JSON.stringify(d.body).includes('overridden'), `the decision record says nobody corrected it ${d.status} ${JSON.stringify(d.body)?.slice(0, 300)}`);
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
    // Extract again: the model reads the due date 2026-10-31 from the PDF; the corrected value stays.
    const again = await json('/v1/content/inspect', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ source: src, stages: ['extract'], force: true }) });
    assert(again.status === 200 && again.body.data.facts.entities.invoice.entity['cc:invoice.due_date'] === '2026-11-30', `after extract ${JSON.stringify(again.body?.data?.facts?.entities?.invoice?.entity)}`);
    assert(again.body.data.facts.entities.invoice.entity['cc:invoice.amount'] === 248, 'an uncorrected field is extracted again');
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

  await test('11. a picture whose metadata read never ends does not hold the node; its facts name the limit that ended it', async () => {
    const C = await setupOwner('c');
    await store(C, 'pics/endless.heic', heifZeroBox(), 'image/heic');
    // The arrival read of the picture starts now. Every other request is answered meanwhile.
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const r = await fetch(`${BASE}/v1/build`, { signal: AbortSignal.timeout(3000) }).catch((err: Error) => ({ ok: false, status: err.name }));
      assert(r.ok && Date.now() - t0 < 2000, `GET /v1/build ${r.status} after ${Date.now() - t0} ms`);
      await sleep(500);
    }
    // At the time limit (content_class.media_read_seconds, 30 s by default) the facts are kept.
    let f: any = null;
    for (let i = 0; i < 120 && !f; i++) {
      const r = await json(factsPath('pics/endless.heic'), { headers: auth(C.token) });
      if (r.status === 200) f = r.body.data.facts;
      else await sleep(500);
    }
    assert(!!f, 'no facts after the time limit');
    assert(f.technical.kind === 'image' && f.technical.image?.format === 'heic' && f.technical.size === heifZeroBox().length, `image ${JSON.stringify(f.technical.image)}`);
    assert(/longer than the limit of 30 s.*content_class\.media_read_seconds/.test(f.technical.errors?.exif ?? ''), `errors ${JSON.stringify(f.technical.errors)}`);
  });

  await test('12. the fingerprint: off by default, written on request with ai:use, shown as a tag, its sections the owner\'s own', async () => {
    const D = await setupOwner('d');
    const doc = fingerprintDoc();
    const w = await json('/v1/memory', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ key: 'notes.report.heat', value: doc, visibility: 'private' }) });
    assert(w.status === 201, `memory ${w.status}`);
    const src = { kind: 'memory', key: 'notes.report.heat' };
    const s = await json('/v1/content/settings', { headers: auth(D.token) });
    assert(s.body.data.settings.stages.profile === false, `profile is off by default ${JSON.stringify(s.body.data.settings.stages)}`);
    // The owner's settings run nothing that calls a model: a plain inspect writes no profile.
    const plain = await json('/v1/content/inspect', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ source: src }) });
    assert(plain.status === 200 && !plain.body.data.facts.profile && !plain.body.data.ran.includes('profile'), `plain inspect ${JSON.stringify(plain.body?.data?.ran ?? plain.body?.error)}`);
    // An agent without ai:use asking for the profile step on its own record is refused.
    const reader = await connectAgent(D, `ccprof${Date.now()}`, ['storage:read', 'memory:read', 'memory:write']);
    await json('/v1/memory', { method: 'POST', headers: auth(reader), body: JSON.stringify({ key: 'notes.agent.heat', value: doc, visibility: 'private' }) });
    const noAi = await json('/v1/content/inspect', { method: 'POST', headers: auth(reader), body: JSON.stringify({ source: { kind: 'memory', key: 'notes.agent.heat' }, stages: ['profile'] }) });
    assert(noAi.status === 403 && String(noAi.body.error?.message).includes('ai:use'), `profile without ai:use ${noAi.status} ${JSON.stringify(noAi.body?.error)}`);
    // The owner asks for it.
    const r = await json('/v1/content/inspect', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ source: src, stages: ['profile'] }) });
    assert(r.status === 200 && r.body.data.ran.includes('profile'), `profile ${r.status} ${JSON.stringify(r.body?.data?.skipped ?? r.body?.error)}`);
    const p = r.body.data.facts.profile;
    // The decision service is on in this node, so the decision model labels and the text model writes.
    assert(p && p.labels === 'decide' && p.labelModel === 'sandbox-jev' && p.decisionIds?.length === 1, `labelled by the decision model ${JSON.stringify(p && { labels: p.labels, labelModel: p.labelModel, decisionIds: p.decisionIds })}`);
    assert(p.prompt === 'profile-text-1' && p.sections.length === 3 && typeof p.model === 'string' && p.model, `profile ${JSON.stringify(p)}`);
    assert(JSON.stringify(p.sections.map((x: any) => x[3])) === '["+","~","?"]', `marks ${JSON.stringify(p.sections)}`);
    assert(p.topics.length === 2 && Math.abs(p.topics.reduce((a: number, t: any) => a + t.share, 0) - 1) < 0.01, `topics ${JSON.stringify(p.topics)}`);
    assert(typeof p.detailKey === 'string' && p.detailKey.startsWith('contentclass-profile/'), `detailKey ${p.detailKey}`);
    // The sections file is the pipeline's own output: it is never read on arrival. It was, and each
    // reading stored the next file, without end (2026-11-06).
    await sleep(800);
    const ownFile = await json(factsPath(p.detailKey), { headers: auth(D.token) });
    assert(ownFile.status === 404, `the sections file was read on arrival ${ownFile.status}`);
    // The owner chose no fingerprint model: the node's default (content_class.profile_model) is asked.
    const asked = mail.seen.chat.filter((c: any) => JSON.stringify(c).includes('You write the headings, one-sentence claims and topics')).pop() as any;
    assert(JSON.stringify(asked ?? {}).includes('~deepseek/deepseek-pro-latest'), `the profile asked ${JSON.stringify(asked)?.slice(0, 200)}`);
    const labelAsk = mail.seen.decide.filter((d: any) => Object.keys(d.questions ?? {}).some((k) => k === 's1_mark')).pop() as any;
    assert(labelAsk && Object.keys(labelAsk.questions).length === 27, `the decision model was asked nine questions a section ${labelAsk ? Object.keys(labelAsk.questions).length : 'none'}`);
    // The facts answer carries the tag; with_profile adds the sections with their headings and claims.
    const f = await json(`${factsPath('notes.report.heat', 'memory')}&with_profile=true`, { headers: auth(D.token) });
    assert(f.status === 200, `facts ${f.status}`);
    const tag = f.body.data.fingerprint;
    assert(tag && tag.squares.length > 0 && tag.lines.some((l: string) => l.startsWith('Trust: + 33 %')) && tag.lines.some((l: string) => l.startsWith('Topics: ')), `tag ${JSON.stringify(tag)}`);
    const secs = f.body.data.profile_sections;
    assert(Array.isArray(secs) && secs.length === 3 && secs[0].heading === 'Hinnat' && secs[0].claim.includes('38 %') && secs[1].mark === '~', `sections ${JSON.stringify(secs)}`);
    const noSecs = await json(factsPath('notes.report.heat', 'memory'), { headers: auth(D.token) });
    assert(noSecs.body.data.fingerprint && !('profile_sections' in noSecs.body.data), 'sections only when asked');
    // Another owner reaches neither the facts nor the sections file.
    const other = await json(`${factsPath('notes.report.heat', 'memory', D.gaii)}&with_profile=true`, { headers: auth(B.token) });
    assert(other.status === 404, `another owner ${other.status}`);
    const file = await json(`/v1/storage/${encodeURIComponent(p.detailKey)}?owner=${encodeURIComponent(D.gaii)}`, { headers: auth(B.token) });
    assert(file.status === 403 || file.status === 404, `another owner on the sections file ${file.status}`);
    // A text too short to tell its kind: the step runs and says why it wrote nothing.
    await json('/v1/memory', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ key: 'notes.short', value: 'Lyhyt muistiinpano.', visibility: 'private' }) });
    const short = await json('/v1/content/inspect', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ source: { kind: 'memory', key: 'notes.short' }, stages: ['profile'] }) });
    assert(short.status === 200 && !short.body.data.facts.profile && /too few words/.test(short.body.data.facts.stages.profile?.note ?? ''), `short ${JSON.stringify(short.body?.data?.facts?.stages)}`);
    // The same over MCP, as the person's AI asks it: the agent's own record.
    const agent = await connectAgent(D, `ccprofmcp${Date.now()}`, ['*']);
    await json('/v1/memory', { method: 'POST', headers: auth(agent), body: JSON.stringify({ key: 'notes.mcp.heat', value: doc, visibility: 'private' }) });
    const insp = await mcpCall(agent, 'aimeat_content_inspect', { kind: 'memory', key: 'notes.mcp.heat', stages: ['profile'] });
    assert(!insp?.result?.isError && toolText(insp).includes('profile-text-1'), `inspect over MCP ${toolText(insp).slice(0, 200)}`);
    const viaMcp = await mcpCall(agent, 'aimeat_content_facts', { kind: 'memory', key: 'notes.mcp.heat', with_profile: true });
    const body = JSON.parse(toolText(viaMcp) || '{}');
    assert(!viaMcp?.result?.isError && body.fingerprint?.lines?.length === 5 && body.profile_sections?.length === 3, `facts over MCP ${toolText(viaMcp).slice(0, 300)}`);
    const listing = await mcpCall(agent, 'aimeat_content_facts', { with_profile: true });
    assert(listing?.result?.isError === true && toolText(listing).includes('with_profile'), `with_profile on a listing ${toolText(listing).slice(0, 200)}`);
  });

  await test('12c. the person\'s AI makes the fingerprint of the person\'s context by its key, and the person reads it; a private record needs memory:read-as-owner', async () => {
    const F = await setupOwner('f');
    const doc = fingerprintDoc();
    const ctxKey = `context.heat-${Date.now()}`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(F.token), body: JSON.stringify({ key: ctxKey, value: doc, visibility: 'owner' }) });
    assert(w.status === 201, `context ${w.status}`);
    // The sentence the Contexts page hands the person names only the key: the AI finds the person's record.
    const agent = await connectAgent(F, `ccctx${Date.now()}`, ['*']);
    const insp = await mcpCall(agent, 'aimeat_content_inspect', { kind: 'memory', key: ctxKey, stages: ['profile'] });
    assert(!insp?.result?.isError && toolText(insp).includes('profile-text-1'), `the AI's inspect of the person's context ${toolText(insp).slice(0, 300)}`);
    // The person's own read, as the Contexts page makes it, sees that fingerprint.
    const page = await json(`${factsPath(ctxKey, 'memory')}&with_profile=true`, { headers: auth(F.token) });
    assert(page.status === 200 && page.body.data.fingerprint && page.body.data.profile_sections?.length === 3, `the person's read ${page.status} ${JSON.stringify(page.body?.error ?? page.body?.data?.fingerprint)}`);
    // A private record of the person: refused as absent without memory:read-as-owner, made with it.
    const privKey = `notes.private-heat-${Date.now()}`;
    await json('/v1/memory', { method: 'POST', headers: auth(F.token), body: JSON.stringify({ key: privKey, value: doc, visibility: 'private' }) });
    const plain = await connectAgent(F, `ccpriv${Date.now()}`, ['storage:read', 'memory:read', 'ai:use']);
    const refused = await json('/v1/content/inspect', { method: 'POST', headers: auth(plain), body: JSON.stringify({ source: { kind: 'memory', key: privKey, owner: F.gaii }, stages: ['profile'] }) });
    assert(refused.status === 404, `a private record without memory:read-as-owner ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    const reads = await connectAgent(F, `ccasown${Date.now()}`, ['storage:read', 'memory:read', 'memory:read-as-owner', 'ai:use']);
    const made = await json('/v1/content/inspect', { method: 'POST', headers: auth(reads), body: JSON.stringify({ source: { kind: 'memory', key: privKey }, stages: ['profile'] }) });
    assert(made.status === 200 && made.body.data.ran.includes('profile'), `a private record with memory:read-as-owner ${made.status} ${JSON.stringify(made.body?.error ?? made.body?.data?.skipped)}`);
    // Another person's agent reaches nothing of it, by key or by naming the account.
    const strangerAgent = await connectAgent(B, `ccstr${Date.now()}`, ['*']);
    const byKey = await json(factsPath(ctxKey, 'memory'), { headers: auth(strangerAgent) });
    const byOwner = await json(factsPath(ctxKey, 'memory', F.gaii), { headers: auth(strangerAgent) });
    assert(byKey.status === 404 && byOwner.status === 404, `another person's agent ${byKey.status} ${byOwner.status}`);
  });

  await test('12b. the fingerprint is made only on request: with the profile step on, an arriving text and an inspect on the settings make none', async () => {
    const E = await setupOwner('e');
    const on = await json('/v1/content/settings', { method: 'PUT', headers: auth(E.token),
      body: JSON.stringify({ onArrival: true, minTextChars: 200, sources: { files: true, memory: true, workspace: true }, stages: { profile: true } }) });
    assert(on.status === 200 && on.body.data.settings.stages.profile === true, `settings ${on.status} ${JSON.stringify(on.body?.error)}`);
    const asksBefore = mail.seen.chat.filter((c: any) => JSON.stringify(c).includes('You write the headings, one-sentence claims and topics')).length;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(E.token), body: JSON.stringify({ key: 'notes.arrived.heat', value: fingerprintDoc(), visibility: 'private' }) });
    assert(w.status === 201, `memory ${w.status}`);
    // The record is read once it has gone ten seconds without a new write (intake.ts MEMORY_QUIET_MS).
    let f: any = null;
    for (let i = 0; i < 60 && !f; i++) {
      await sleep(500);
      const r = await json(factsPath('notes.arrived.heat', 'memory'), { headers: auth(E.token) });
      if (r.status === 200) f = r.body.data.facts;
    }
    assert(!!f, 'the arrived record was not read');
    assert(!f.profile && !f.stages.profile, `a fingerprint was made on arrival ${JSON.stringify(f.stages)}`);
    const plain = await json('/v1/content/inspect', { method: 'POST', headers: auth(E.token), body: JSON.stringify({ source: { kind: 'memory', key: 'notes.arrived.heat' } }) });
    assert(plain.status === 200 && !plain.body.data.ran.includes('profile') && !plain.body.data.facts.profile, `inspect on the settings ${JSON.stringify(plain.body?.data?.ran ?? plain.body?.error)}`);
    const asksAfter = mail.seen.chat.filter((c: any) => JSON.stringify(c).includes('You write the headings, one-sentence claims and topics')).length;
    assert(asksAfter === asksBefore, `the fingerprint model was asked ${asksAfter - asksBefore} times`);
    // Named, it is made.
    const asked = await json('/v1/content/inspect', { method: 'POST', headers: auth(E.token), body: JSON.stringify({ source: { kind: 'memory', key: 'notes.arrived.heat' }, stages: ['profile'] }) });
    assert(asked.status === 200 && asked.body.data.ran.includes('profile') && asked.body.data.facts.profile, `on request ${JSON.stringify(asked.body?.data?.skipped ?? asked.body?.error)}`);
  });

  await test('13. a workspace document has one shared fingerprint: every reader sees the same one, a new version makes it stale, only an editor makes it again or corrects it', async () => {
    const [W, V, N, X] = [await setupOwner('w'), await setupOwner('v'), await setupOwner('n'), await setupOwner('x')];
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(W.token),
      body: JSON.stringify({ name: `Fingerprint ${Date.now()}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'private' }) });
    assert(o.status === 201, `organism ${o.status} ${JSON.stringify(o.body?.error)}`);
    const org = o.body.data.organism.id as string;
    for (const m of [V, N]) {
      const j = await json(`/v1/organisms/${org}/join`, { method: 'POST', headers: auth(m.token), body: '{}' });
      assert(j.status === 201, `join ${j.status} ${JSON.stringify(j.body?.error)}`);
    }
    const w = await json(`/v1/organisms/${org}/workspaces`, { method: 'POST', headers: auth(W.token), body: JSON.stringify({ name: 'Muistiot', manifest: {
      manifestVersion: '1', name: 'Muistiot', kind: 'project',
      objectTypes: [{ name: 'page', namespace: 'shared.pages', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:page@1' }],
    } }) });
    assert(w.status === 201, `workspace ${w.status} ${JSON.stringify(w.body?.error)}`);
    const ws = w.body.data.ws as string;
    // V reads the workspace; N is a member who may not; X is no member at all.
    const g = await json(`/v1/organisms/${org}/workspace-access/grant`, { method: 'POST', headers: auth(W.token), body: JSON.stringify({ ws, grantee: V.name, role: 'viewer' }) });
    assert(g.status === 200, `grant ${g.status} ${JSON.stringify(g.body?.error)}`);
    const publish = async (id: string, markdown: string) => {
      const d = await json(`/v1/organisms/${org}/workspace/drafts`, { method: 'POST', headers: auth(W.token), body: JSON.stringify({ ws, space: 'page', id, value: { title: id, markdown } }) });
      assert(d.status === 200, `draft ${id} ${d.status} ${JSON.stringify(d.body?.error)}`);
      const p = await json(`/v1/organisms/${org}/publish`, { method: 'POST', headers: auth(W.token), body: JSON.stringify({ ws, namespace: 'shared.pages', id }) });
      assert(p.status === 200, `publish ${id} ${p.status} ${JSON.stringify(p.body?.error)}`);
    };
    await publish('fp1', fingerprintDoc());
    await publish('fp2', fingerprintDoc(' Toinen sivu.'));
    const key = `organism.${org}.w.${ws}.shared.pages.fp1.latest`;
    const src = { kind: 'memory', key };
    const facts = (who: Owner, sections = true) => json(`${factsPath(key, 'memory')}${sections ? '&with_profile=true' : ''}`, { headers: auth(who.token) });
    const inspect = (who: Owner, force = true) => json('/v1/content/inspect', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ source: src, stages: ['profile'], force }) });
    const list = (who: Owner, extra = '') => json(`/v1/content/facts?prefix=${encodeURIComponent(`organism.${org}.w.${ws}.`)}${extra}`, { headers: auth(who.token) });

    assert((await facts(V)).status === 404, 'a fingerprint before anyone made one');
    // A reader makes it, on the reader's own key; the writer sees the same one, sections and all.
    const made = await inspect(V);
    assert(made.status === 200 && made.body.data.ran.includes('profile') && made.body.data.shared?.made_by === V.gaii, `the reader makes it ${made.status} ${JSON.stringify(made.body?.data?.skipped ?? made.body?.error)}`);
    const byW = await facts(W);
    const byV = await facts(V);
    assert(byW.status === 200 && byW.body.data.facts.profile?.at === made.body.data.facts.profile?.at && byW.body.data.shared.stale === false, `the writer sees the reader's one ${JSON.stringify(byW.body?.data?.shared ?? byW.body?.error)}`);
    assert(JSON.stringify(byW.body.data.facts.profile) === JSON.stringify(byV.body.data.facts.profile) && byW.body.data.profile_sections?.length === 3, 'two readers, two fingerprints');
    assert(!byW.body.data.facts.profile.detailKey && byW.body.data.fingerprint?.lines?.length === 5, `the tag ${JSON.stringify(byW.body.data.fingerprint)}`);
    // Who may not read the document gets what a missing one gets, on every route.
    for (const who of [N, X]) {
      assert((await facts(who)).status === 404, 'a fingerprint for someone who may not read the document');
      assert((await inspect(who)).status === 404, 'a fingerprint made by someone who may not read the document');
    }
    // A current one is not made again by a reader; asked without force it is answered as it is.
    const again = await inspect(V);
    assert(again.status === 403 && again.body.error?.code === 'ACCESS_DENIED', `a reader replaces the current one ${again.status}`);
    const asIs = await inspect(V, false);
    assert(asIs.status === 200 && /already has/.test(asIs.body.data.skipped?.profile ?? '') && !asIs.body.data.ran.length, `without force ${JSON.stringify(asIs.body?.data)}`);
    // The workspace's fingerprints in one call: compact, both documents, filtered by has_profile.
    const all = await list(V, '&limit=1000');
    assert(all.status === 200 && all.body.data.total === 2, `listing ${all.status} ${JSON.stringify(all.body?.data ?? all.body?.error)}`);
    const one = all.body.data.items.find((i: any) => i.id === 'fp1');
    const none = all.body.data.items.find((i: any) => i.id === 'fp2');
    assert(one?.profile?.sections?.length === 3 && one.stale === false && one.made_by === V.gaii && !JSON.stringify(one).includes('claim'), `fp1 ${JSON.stringify(one)}`);
    assert(none && none.profile === null && none.stale === null, `fp2 ${JSON.stringify(none)}`);
    const withOnly = await list(W, '&has_profile=true');
    const withoutOnly = await list(W, '&has_profile=false');
    assert(withOnly.body.data.items.map((i: any) => i.id).join() === 'fp1' && withoutOnly.body.data.items.map((i: any) => i.id).join() === 'fp2', 'has_profile');
    const barred = await list(N);
    assert(barred.status === 403 && barred.body.error?.code === 'ACCESS_DENIED', `a member who may not read the workspace lists it ${barred.status}`);
    assert((await list(X)).status === 403, 'a non-member lists the workspace');
    // The fingerprint stays out of the workspace read.
    const read = await json(`/v1/organisms/${org}/workspace?ws=${ws}`, { headers: auth(V.token) });
    assert(read.status === 200 && !JSON.stringify(read.body).includes('meta.fingerprint'), 'the workspace read hands out the fingerprint record');
    // A correction takes the right to edit the document; the corrector is named, and every reader sees it.
    const correct = (who: Owner) => json('/v1/content/correct', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ source: src, profile: { sections: [{ n: 3, mark: '+' }] } }) });
    const byReader = await correct(V);
    assert(byReader.status === 403 && byReader.body.error?.code === 'ACCESS_DENIED', `a reader corrects ${byReader.status}`);
    const byWriter = await correct(W);
    assert(byWriter.status === 200 && byWriter.body.data.facts.profile.corrected?.by === W.gaii, `the writer corrects ${byWriter.status} ${JSON.stringify(byWriter.body?.error)}`);
    const seen = await facts(V);
    assert(seen.body.data.facts.profile.sections[2][3] === '+' && seen.body.data.profile_sections[2].mark === '+' && seen.body.data.shared.corrected_by === W.gaii, 'the reader sees the correction');
    assert(seen.body.data.fingerprint.lines[4].includes(`corrected by ${W.gaii}`), `the tag names the corrector ${seen.body.data.fingerprint.lines[4]}`);
    const badFix = await json('/v1/content/correct', { method: 'POST', headers: auth(W.token), body: JSON.stringify({ source: src, profile: { sections: [{ n: 9, mark: '+' }] } }) });
    assert(badFix.status === 400 && String(badFix.body.error?.message).includes('sections[0].n'), `a section that is not there ${badFix.status} ${JSON.stringify(badFix.body?.error)}`);
    // The writer making it again on the same words keeps the correction.
    const remade = await inspect(W);
    assert(remade.status === 200 && remade.body.data.facts.profile.sections[2][3] === '+' && remade.body.data.facts.profile.corrected?.by === W.gaii, `the correction kept ${JSON.stringify(remade.body?.data?.facts?.profile?.sections ?? remade.body?.error)}`);
    // A new version makes it stale, and it stays visible; a reader may then make it again.
    await publish('fp1', fingerprintDoc(' Lisätty lause uuteen versioon.'));
    const stale = await facts(V);
    assert(stale.status === 200 && stale.body.data.shared.stale === true && !!stale.body.data.facts.profile, `stale ${JSON.stringify(stale.body?.data?.shared)}`);
    const fresh = await inspect(V);
    assert(fresh.status === 200 && fresh.body.data.shared.stale === false && !fresh.body.data.facts.profile.corrected, `remade on the new words ${JSON.stringify(fresh.body?.data?.shared ?? fresh.body?.error)}`);
    // Over MCP, as a reader's AI asks: the same listing.
    const vAgent = await connectAgent(V, `ccfpmcp${Date.now()}`, ['*']);
    const viaMcp = JSON.parse(toolText(await mcpCall(vAgent, 'aimeat_content_facts', { prefix: `organism.${org}.w.${ws}.`, has_profile: true })) || '{}');
    assert(viaMcp.page?.items?.length === 1 && viaMcp.page.items[0].id === 'fp1', `listing over MCP ${JSON.stringify(viaMcp).slice(0, 300)}`);
    // On publication: off by default; the workspace's creator turns it on; it runs on the publisher's key when their settings run the step.
    const setPath = `/v1/content/settings?organism_id=${org}&ws=${ws}`;
    const off = await json(setPath, { headers: auth(V.token) });
    assert(off.status === 200 && off.body.data.settings.effective === false && off.body.data.settings.from === 'default', `default ${JSON.stringify(off.body?.data ?? off.body?.error)}`);
    const byViewer = await json(setPath, { method: 'PUT', headers: auth(V.token), body: JSON.stringify({ autoProfile: true }) });
    assert(byViewer.status === 403, `a reader turns it on ${byViewer.status}`);
    const on = await json(setPath, { method: 'PUT', headers: auth(W.token), body: JSON.stringify({ autoProfile: true }) });
    assert(on.status === 200 && on.body.data.settings.effective === true && on.body.data.settings.from === 'workspace', `on ${JSON.stringify(on.body?.data ?? on.body?.error)}`);
    await json('/v1/content/settings', { method: 'PUT', headers: auth(W.token), body: JSON.stringify({ stages: { profile: true }, minTextChars: 200 }) });
    await publish('fp3', fingerprintDoc(' Kolmas sivu.'));
    let auto: any = null;
    for (let i = 0; i < 120 && !auto; i++) {
      auto = (await list(V, '&has_profile=true')).body.data?.items?.find((x: any) => x.id === 'fp3') ?? null;
      if (!auto) await sleep(250);
    }
    assert(auto?.made_by === W.gaii, `made on publication by the publisher ${JSON.stringify(auto)}`);
    // The fingerprint goes with its document.
    const wAgent = await connectAgent(W, `ccfpdel${Date.now()}`, ['*']);
    const del = await mcpCall(wAgent, 'aimeat_workspace_object_delete', { organism_id: org, ws, namespace: 'shared.pages', id: 'fp1' });
    assert(!del?.result?.isError, `delete ${toolText(del).slice(0, 200)}`);
    assert((await facts(W)).status === 404, 'the fingerprint of a deleted document');
    const left = await list(W);
    assert(left.body.data.items.every((i: any) => i.id !== 'fp1'), `the listing after the delete ${JSON.stringify(left.body.data.items.map((i: any) => i.id))}`);
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

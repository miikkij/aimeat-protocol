/**
 * @file test/e2e-files-connections.ts
 * @description A connected SharePoint or OneDrive, end to end against a Graph answered inside this
 *   process: connecting the read and the write halves, browsing, reading a file as text, keeping it
 *   as a stored file, writing a file, a folder and a list row, and every refusal on the way, over
 *   REST and over MCP.
 *
 *   HOW IT IS BUILT. The node boots IN THIS PROCESS on its own port, the pattern of
 *   e2e-mail-connections: the providers address graph.microsoft.com with module constants, so a
 *   replacement for globalThis.fetch is the only seam (test/helpers/fake-mail-upstreams.ts answers
 *   the sign-in and /me; the document library below answers the drive). It follows the runner's
 *   backend: a SQLite file of its own, or the runner's Postgres database.
 *
 *   WHAT IT PROVES THAT A UNIT TEST CANNOT. The download is fetched with no Authorization header (the
 *   token is Graph's alone); a path id that tries to walk somewhere else never reaches Graph; a stale
 *   etag is refused as a conflict; an agent writes through its owner's account on connections:use and
 *   reads it only on connections:read-as-owner; and a stored file goes out byte for byte.
 * @structure boot · the fake library · helpers · Phase 0 owners and connections · Phase 1 browse ·
 *   Phase 2 a file as text and kept · Phase 3 writing · Phase 4 refusals · Phase 5 over MCP
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=files-connections
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import { randomBytes } from 'node:crypto';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { BROWSER_START, roundCookie } from './helpers/oauth-round.js';

const PORT = parseInt(process.env.E2E_FILES_PORT ?? '28285', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-files-e2e-'));
const USE_SQLITE = (process.env.AIMEAT_STORAGE ?? 'sqlite') !== 'postgres-kysely';

Object.assign(process.env, {
  AIMEAT_PORT: String(PORT),
  AIMEAT_BASE_URL: BASE,
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_DEV_MODE: 'true',
  AIMEAT_TEST_MODE: 'true',
  AIMEAT_ANONYMOUS: 'true',
  AIMEAT_LOG_LEVEL: 'error',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
  AIMEAT_STORAGE: USE_SQLITE ? 'sqlite' : 'postgres-kysely',
  AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
  AIMEAT_CONNECTIONS_ENABLED: 'true',
  AIMEAT_CONNECT_MICROSOFT_CLIENT_ID: 'microsoft-client-id',
  AIMEAT_CONNECT_MICROSOFT_CLIENT_SECRET: 'microsoft-client-secret',
  AIMEAT_CONNECT_MICROSOFT_TENANT: 'contoso-test-directory',
  AIMEAT_CONNECT_FAKE_BASE_URL: '',
  AIMEAT_CONNECT_REDIRECT_URI: `${BASE}/v1/connections/callback`,
  AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url'),
  AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '200',
  AIMEAT_LOGIN_RATE_LIMIT_MAX: '200',
  AIMEAT_DEFAULT_AGENT_SCOPES: '*',
  AIMEAT_RL_GLOBAL: '10000',
  AIMEAT_RL_AUTH: '1000',
  AIMEAT_RL_MEMORY: '1000',
});
if (USE_SQLITE) process.env.AIMEAT_SQLITE_PATH = join(TMP, 'files.db');

const { createServer } = await import('../src/server.js');
const { loadConfig } = await import('../src/config.js');
const { installFakeUpstreams } = await import('./helpers/fake-mail-upstreams.js');
const { registerOwner } = await import('./helpers/owner-login.js');
const { makeAgent, openSession, callTool } = await import('./helpers/mcp-session.js');

const { config } = loadConfig({});
config.port = PORT;
const { app, storage } = await createServer(config);
await (storage as { ready?: Promise<unknown> }).ready;
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });
const { restore } = installFakeUpstreams();

// ── The document library, answered in this process ──────────────────────────────────────────
// One drive with a text file, a folder and a list; uploads land in `uploads`. Every request the
// drive sees is recorded with its Authorization header, so the download can be proven token-free.

const DRIVE = 'b!drive-one_A';
const FILE = '01MINUTES';
const SITE = 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';
const LIST = '33333333-3333-3333-3333-333333333333';
const MINUTES = 'Board minutes 2026-10-30.\nDecision: approve the budget.';
const seen: Array<{ method: string; path: string; search: string; auth: string; body: Buffer; ifMatch: string }> = [];
const uploads = new Map<string, Buffer>();
let fileEtag = '"etag-1"';

const inner = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const isDrive = url.host === 'graph.microsoft.com' && (url.pathname.startsWith('/v1.0/drives') || url.pathname.startsWith('/v1.0/sites')
    || url.pathname === '/v1.0/me/drives' || url.pathname.startsWith('/fake-download/'));
  if (!isDrive) return inner(input, init);
  const headers = new Headers(init.headers);
  const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
  seen.push({ method: init.method ?? 'GET', path: decodeURIComponent(url.pathname), search: decodeURIComponent(url.search), auth: headers.get('authorization') ?? '', body, ifMatch: headers.get('if-match') ?? '' });
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const p = decodeURIComponent(url.pathname);
  const item = { id: FILE, name: 'Minutes.txt', size: Buffer.byteLength(MINUTES), eTag: fileEtag, webUrl: 'https://contoso.sharepoint.com/sites/Board/Shared%20Documents/Minutes.txt', lastModifiedDateTime: '2026-10-30T10:00:00Z', file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': `https://graph.microsoft.com/fake-download/${FILE}` };

  if (p.startsWith('/fake-download/')) return new Response(MINUTES, { status: 200, headers: { 'content-type': 'text/plain' } });
  if (p === '/v1.0/sites') return json({ value: [{ id: SITE, displayName: 'Board', webUrl: 'https://contoso.sharepoint.com/sites/Board' }] });
  if (p === `/v1.0/sites/${SITE}/drives`) return json({ value: [{ id: DRIVE, name: 'Documents', driveType: 'documentLibrary' }] });
  if (p === `/v1.0/drives/${DRIVE}/items/root/children` && (init.method ?? 'GET') === 'GET') return json({ value: [item, { id: '01FOLDER', name: 'Archive', folder: { childCount: 0 } }] });
  if (p === `/v1.0/drives/${DRIVE}/items/${FILE}` && (init.method ?? 'GET') === 'GET') return json(item);
  if (p === `/v1.0/drives/${DRIVE}/items/01FOLDER`) return json({ id: '01FOLDER', name: 'Archive', folder: { childCount: 0 } });
  if (p === `/v1.0/drives/${DRIVE}/root/delta`) return json({ value: [item], '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE}/root/delta?token=tok-2` });
  if (p === `/v1.0/sites/${SITE}/lists`) return json({ value: [{ id: LIST, displayName: 'Decisions' }] });
  if (p.startsWith(`/v1.0/drives/${DRIVE}/items/root:/`) && init.method === 'PUT') {
    const name = p.slice(`/v1.0/drives/${DRIVE}/items/root:/`.length).replace(/:\/content$/, '');
    uploads.set(name, body);
    return json({ id: `01NEW${uploads.size}`, name, size: body.length, eTag: '"new-1"' }, 201);
  }
  if (p === `/v1.0/drives/${DRIVE}/items/${FILE}/content` && init.method === 'PUT') {
    if (headers.get('if-match') && headers.get('if-match') !== fileEtag) return json({ error: { code: 'resourceModified' } }, 412);
    fileEtag = '"etag-2"';
    return json({ ...item, eTag: fileEtag }, 200);
  }
  if (p === `/v1.0/drives/${DRIVE}/items/root/children` && init.method === 'POST') return json({ id: '01NEWFOLDER', ...JSON.parse(body.toString('utf8')) }, 201);
  if (p === `/v1.0/sites/${SITE}/lists/${LIST}/items` && init.method === 'POST') return json({ id: '7', fields: JSON.parse(body.toString('utf8')).fields }, 201);
  return json({ error: { code: 'itemNotFound' } }, 404);
}) as typeof fetch;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

interface Call { status: number; data: any }
async function api(path: string, opts: { method?: string; body?: unknown; bearer?: string } = {}): Promise<Call> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}

/** One full authorization round as the owner's browser makes it; answers the new connection's id. */
async function connect(bearer: string, provider: string): Promise<string> {
  const res = await fetch(`${BASE}/v1/connections/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...BROWSER_START },
    body: JSON.stringify({ provider, mode: 'personal', return_url: '/profile#access' }),
  });
  const start = await res.json() as any;
  assert(res.status === 200, `start ${provider}: ${res.status} ${JSON.stringify(start?.error)}`);
  const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(start.data.state)}&code=code-${provider}`, {
    redirect: 'manual', headers: { Cookie: roundCookie(res) },
  });
  assert(cb.status === 302, `callback ${provider}: ${cb.status} ${await cb.text()}`);
  const list = await api('/v1/connections', { method: 'GET', bearer });
  const conn = (list.data.data.connections as any[]).find((c) => c.provider === provider);
  assert(conn, `no ${provider} connection after the round`);
  return conn.id as string;
}

console.log('\n=== AIMEAT SharePoint connection E2E ===\n');
const stamp = Date.now().toString(36);
let owner = { name: '', token: '' }, other = { name: '', token: '' };
let readConn = '', writeConn = '', storedKey = '';

try {
  console.log('Phase 0 — Owners and the two connections');
  await test('the node offers SharePoint as a read half and a write half', async () => {
    const o = await registerOwner(BASE, `fx${stamp}`);
    owner = { name: o.name, token: o.token };
    const p = await registerOwner(BASE, `fy${stamp}`);
    other = { name: p.name, token: p.token };
    const r = await api('/v1/connections/providers', { method: 'GET', bearer: owner.token });
    const offered = (r.data?.data?.providers ?? []) as any[];
    const files = offered.find((x) => x.id === 'microsoft-files');
    const write = offered.find((x) => x.id === 'microsoft-files-write');
    assert(files && write, `providers: ${offered.map((x) => x.id).join(', ')} (${r.status})`);
    assert(!files.capabilities.includes('write-files') && write.capabilities.includes('write-files'), 'the read half claims to write');
  });
  await test('the owner connects both halves through the Microsoft round', async () => {
    readConn = await connect(owner.token, 'microsoft-files');
    writeConn = await connect(owner.token, 'microsoft-files-write');
  });

  console.log('\nPhase 1 — Browsing');
  await test('sites, a site\'s libraries and a folder, through the read route', async () => {
    const sites = await api(`/v1/connections/${readConn}/read/sites`, { bearer: owner.token, body: { query: 'Board' } });
    assert(sites.status === 200 && sites.data.data.data.value[0].id === SITE, `sites: ${sites.status} ${JSON.stringify(sites.data.error)}`);
    assert(seen.at(-1)!.search.includes('search=Board'), `the search was not sent: ${seen.at(-1)!.search}`);
    const drives = await api(`/v1/connections/${readConn}/read/drives`, { bearer: owner.token, body: { site_id: SITE } });
    assert(drives.status === 200 && drives.data.data.data.value[0].id === DRIVE, `drives: ${drives.status}`);
    const kids = await api(`/v1/connections/${readConn}/read/children`, { bearer: owner.token, body: { drive_id: DRIVE } });
    assert(kids.status === 200 && kids.data.data.data.value.length === 2, `children: ${kids.status}`);
    assert(seen.at(-1)!.auth.startsWith('Bearer '), 'a Graph read carried no token');
  });
  await test('what changed: the delta link\'s token comes back for the next round', async () => {
    const r = await api(`/v1/connections/${readConn}/read/changes`, { bearer: owner.token, body: { drive_id: DRIVE } });
    assert(r.status === 200 && String(r.data.data.data['@odata.deltaLink']).includes('token=tok-2'), `changes: ${r.status}`);
  });
  await test('an id that tries to walk elsewhere is refused before Graph hears of it', async () => {
    const before = seen.length;
    for (const body of [{ drive_id: DRIVE, item_id: '../../me/messages' }, { drive_id: 'b!x/../../me', item_id: FILE }]) {
      const r = await api(`/v1/connections/${readConn}/read/item`, { bearer: owner.token, body });
      assert(r.status === 400 && r.data.error.code === 'BAD_PARAMETERS', `${JSON.stringify(body)}: ${r.status} ${r.data?.error?.code}`);
    }
    assert(seen.length === before, 'a refused id still reached Graph');
  });

  console.log('\nPhase 2 — One file, as text and kept');
  await test('a file as text, with where it came from; the download carries no token', async () => {
    const r = await api(`/v1/connections/${readConn}/files/text`, { bearer: owner.token, body: { drive_id: DRIVE, item_id: FILE } });
    assert(r.status === 200 && r.data.data.text === MINUTES, `text: ${r.status} ${JSON.stringify(r.data.error ?? r.data.data)}`);
    assert(r.data.data.source.etag === fileEtag && r.data.data.source.web_url.includes('Minutes.txt'), `source: ${JSON.stringify(r.data.data.source)}`);
    const download = seen.filter((c) => c.path.startsWith('/fake-download/')).at(-1)!;
    assert(download && download.auth === '', `the download carried "${download?.auth}"`);
  });
  await test('a folder is not a file', async () => {
    const r = await api(`/v1/connections/${readConn}/files/text`, { bearer: owner.token, body: { drive_id: DRIVE, item_id: '01FOLDER' } });
    assert(r.status === 422 && r.data.error.code === 'NOT_A_FILE', `folder: ${r.status} ${r.data?.error?.code}`);
  });
  await test('a file kept as a private file reads back byte for byte', async () => {
    const r = await api(`/v1/connections/${readConn}/files/store`, { bearer: owner.token, body: { drive_id: DRIVE, item_id: FILE } });
    assert(r.status === 201, `store: ${r.status} ${JSON.stringify(r.data.error)}`);
    storedKey = r.data.data.stored.key;
    const back = await fetch(`${BASE}/v1/storage/${storedKey.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${owner.token}` } });
    assert(back.status === 200 && (await back.text()) === MINUTES, `read back: ${back.status}`);
  });

  console.log('\nPhase 3 — Writing');
  await test('the read half writes nothing: it has no write resources', async () => {
    const r = await api(`/v1/connections/${readConn}/write/upload`, { bearer: owner.token, body: { drive_id: DRIVE, filename: 'x.txt', text: 'x' } });
    assert(r.status === 400 && r.data.error.code === 'NO_SUCH_RESOURCE', `${r.status} ${r.data?.error?.code}`);
  });
  await test('a new file from text lands in the folder under its name, renamed on a clash by default', async () => {
    const r = await api(`/v1/connections/${writeConn}/write/upload`, { bearer: owner.token, body: { drive_id: DRIVE, filename: 'Summary.md', text: '# Summary', mime_type: 'text/markdown' } });
    assert(r.status === 201 && r.data.data.data.name === 'Summary.md', `upload: ${r.status} ${JSON.stringify(r.data.error)}`);
    const put = seen.at(-1)!;
    assert(put.method === 'PUT' && put.search.includes('@microsoft.graph.conflictBehavior=rename'), `put: ${put.method} ${put.search}`);
    assert(uploads.get('Summary.md')?.toString('utf8') === '# Summary', 'the bytes that arrived differ');
  });
  await test('a stored file goes out byte for byte under its own name', async () => {
    const r = await api(`/v1/connections/${writeConn}/write/upload`, { bearer: owner.token, body: { drive_id: DRIVE, from_key: storedKey } });
    assert(r.status === 201, `upload from_key: ${r.status} ${JSON.stringify(r.data.error)}`);
    assert(uploads.get('Minutes.txt')?.toString('utf8') === MINUTES, 'the stored file did not arrive as it was');
  });
  await test('replacing a file with a stale etag is a conflict, and the current one writes', async () => {
    const stale = await api(`/v1/connections/${writeConn}/write/replace`, { bearer: owner.token, body: { drive_id: DRIVE, item_id: FILE, etag: '"etag-0"', text: 'new' } });
    assert(stale.status === 409 && stale.data.error.code === 'CHANGED_SINCE_READ', `stale: ${stale.status} ${stale.data?.error?.code}`);
    const fresh = await api(`/v1/connections/${writeConn}/write/replace`, { bearer: owner.token, body: { drive_id: DRIVE, item_id: FILE, etag: fileEtag, text: 'new' } });
    assert(fresh.status === 201, `fresh: ${fresh.status} ${JSON.stringify(fresh.data.error)}`);
  });
  await test('a folder and a list row', async () => {
    const f = await api(`/v1/connections/${writeConn}/write/folder`, { bearer: owner.token, body: { drive_id: DRIVE, name: 'Reports 2026' } });
    assert(f.status === 201 && f.data.data.data.name === 'Reports 2026', `folder: ${f.status}`);
    const row = await api(`/v1/connections/${writeConn}/write/list_item`, { bearer: owner.token, body: { site_id: SITE, list_id: LIST, fields: { Title: 'Budget approved', Amount: 1200 } } });
    assert(row.status === 201 && row.data.data.data.fields.Title === 'Budget approved', `row: ${row.status} ${JSON.stringify(row.data.error)}`);
  });

  console.log('\nPhase 4 — Refusals');
  await test('a name SharePoint refuses, and fields that are not plain values, are refused here', async () => {
    const before = seen.length;
    const name = await api(`/v1/connections/${writeConn}/write/upload`, { bearer: owner.token, body: { drive_id: DRIVE, filename: '../escape.txt', text: 'x' } });
    assert(name.status === 400 && name.data.error.code === 'BAD_PARAMETERS', `name: ${name.status}`);
    const fields = await api(`/v1/connections/${writeConn}/write/list_item`, { bearer: owner.token, body: { site_id: SITE, list_id: LIST, fields: { Title: { nested: true } } } });
    assert(fields.status === 400 && fields.data.error.code === 'BAD_PARAMETERS', `fields: ${fields.status}`);
    assert(seen.length === before, 'a refused write still reached Graph');
  });
  await test('another owner reaches neither connection: the same 404 as none', async () => {
    const r = await api(`/v1/connections/${readConn}/files/text`, { bearer: other.token, body: { drive_id: DRIVE, item_id: FILE } });
    assert(r.status === 404, `read: ${r.status}`);
    const w = await api(`/v1/connections/${writeConn}/write/folder`, { bearer: other.token, body: { drive_id: DRIVE, name: 'x' } });
    assert(w.status === 404, `write: ${w.status}`);
  });

  console.log('\nPhase 5 — Over MCP');
  await test('an agent with read-through and read-as-owner browses and reads its owner\'s library', async () => {
    const agent = await makeAgent(BASE, owner, ['connections:read', 'connections:read-through', 'connections:read-as-owner']);
    const session = await openSession(BASE, agent.token, 'e2e-files');
    const browse = await callTool(session, 'aimeat_files_browse', { connection_id: readConn, what: 'children', drive_id: DRIVE });
    assert(!browse.isError && browse.data.data.value.length === 2, `browse: ${browse.text.slice(0, 200)}`);
    const got = await callTool(session, 'aimeat_files_get', { connection_id: readConn, drive_id: DRIVE, item_id: FILE, as: 'text' });
    assert(!got.isError && got.data.text === MINUTES, `get: ${got.text.slice(0, 200)}`);
    const keep = await callTool(session, 'aimeat_files_get', { connection_id: readConn, drive_id: DRIVE, item_id: FILE, as: 'store' });
    assert(keep.isError && keep.text.startsWith('SCOPE_DENIED'), `store without storage:write: ${keep.text.slice(0, 200)}`);
  });
  await test('without read-as-owner the owner\'s library is refused by name, and on REST alike', async () => {
    // connections:use lists the owner's connection to the agent, so "no such connection" would not be
    // true; the refusal names the missing word instead. Without connections:use it is the plain 404.
    const agent = await makeAgent(BASE, owner, ['connections:read', 'connections:read-through', 'connections:use']);
    const session = await openSession(BASE, agent.token, 'e2e-files-narrow');
    const r = await callTool(session, 'aimeat_files_browse', { connection_id: readConn, what: 'sites' });
    assert(r.isError && r.text.startsWith('READ_AS_OWNER_REQUIRED'), `browse: ${r.text.slice(0, 200)}`);
    const rest = await api(`/v1/connections/${readConn}/files/text`, { bearer: agent.token, body: { drive_id: DRIVE, item_id: FILE } });
    assert(rest.status === 403 && rest.data.error.code === 'READ_AS_OWNER_REQUIRED', `REST: ${rest.status} ${rest.data?.error?.code}`);
  });
  await test('an agent with connections:use writes through its owner\'s account; one without is refused', async () => {
    const writer = await makeAgent(BASE, owner, ['connections:read', 'connections:use']);
    const session = await openSession(BASE, writer.token, 'e2e-files-writer');
    const w = await callTool(session, 'aimeat_files_write', { connection_id: writeConn, what: 'upload', drive_id: DRIVE, filename: 'From agent.txt', text: 'hello' });
    assert(!w.isError && w.data.data.name === 'From agent.txt', `write: ${w.text.slice(0, 200)}`);
    assert(uploads.get('From agent.txt')?.toString('utf8') === 'hello', 'the agent\'s file did not arrive');
    const reader = await makeAgent(BASE, owner, ['connections:read', 'connections:read-through']);
    const rs = await openSession(BASE, reader.token, 'e2e-files-reader');
    const refused = await callTool(rs, 'aimeat_files_write', { connection_id: writeConn, what: 'folder', drive_id: DRIVE, name: 'x' });
    assert(refused.isError, `a reader wrote: ${refused.text.slice(0, 200)}`);
  });
} finally {
  globalThis.fetch = inner;
  restore();
  server.close();
  await (storage as { disconnect?: () => Promise<void> }).disconnect?.();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows may still hold the file */ }
}

console.log(`\n═══ FILES CONNECTIONS: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\n`);
process.exit(failed > 0 ? 1 : 0);

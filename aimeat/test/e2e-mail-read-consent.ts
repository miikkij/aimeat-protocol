/**
 * @file test/e2e-mail-read-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a connected mailbox took a permission of its own on 2026-09-24
 *   (connections:read-through), and the app grants made before it kept connections:use without it,
 *   on purpose: their owners approved them when the screen said "publish". This suite proves the
 *   owner's one-tap way back, on the runner's node and database, so it runs on both backends:
 *   - the boot run leaves its marker, so it runs once per node
 *   - run over grants the node already holds, it tells an owner whose app read mail, in ONE
 *     notification, and lists only the apps the evidence names; a second run tells nobody again
 *   - the button adds connections:read-through and nothing else to that one grant, and it is the
 *     owner's own door: the app, an agent of the owner and another owner are refused
 *   - a refresh keeps the word the owner added, and it goes when the owner takes it away, on the
 *     grants page's door or on the same door; a refresh does not bring it back
 *   - an app without the word is refused the mailbox, told the word and how an app asks for it
 *   The silent sign-in half of "the owner's word holds" needs an app origin, so it lives in
 *   test/e2e-app-silent.ts Phase 5.
 *
 *   The migration is run in this process against the server's own database, the way the node runs
 *   it at boot, because the boot run on a test database has nothing to find: the runner empties the
 *   database before each suite. The marker is taken away first, which is the state of a node that
 *   has not run it yet.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mail-read-consent
 * @version-history
 *   v1.1.0 — 2026-09-26 — The marker is read under system@<node>, key migrations.mail-read-consent,
 *     where services/mail-read-consent.ts now records it beside the operator:admin migration.
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import type { ConnectionRecord } from '../src/models/connection-schemas.js';
import { loadConfig, type AimeatConfig } from '../src/config.js';
import { serverSqlitePath, serverDbUrl } from './helpers/server-db.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const REDIRECT = 'http://localhost:9911/callback';
const READ_WORD = 'connections:read-through';
// Where the node keeps its marker: under its own system identity, where every run-once boot migration
// records that it ran. Spelled out rather than imported, so this suite reports a missing migration as
// a failed assertion instead of failing to load.
const MARKER_NS = `system@${NODE_ID}`;
const MARKER_KEY = 'migrations.mail-read-consent';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `mrc${label}${Date.now() % 1000000}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Mail ${label}`, password: 'MailRead1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await sleep(1500);
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Mail ${label}`, password: 'MailRead1234' }) });
    }
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Publish an app whose page declares `scopes` and carries `script` as its code. */
async function publish(token: string, filename: string, name: string, scopes: string, script: string) {
    const html = `<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="${scopes}"><title>${name}</title></head>`
        + `<body><script>${script}</script></body></html>`;
    const r = await json('/v1/apps', { method: 'POST', headers: auth(token), body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), name, description: name, category: 'utility' }) });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

/** The visible grant flow: `owner` approves `app` for `scopes`; the app's token answer comes back. */
async function grant(owner: { token: string }, app: string, scopes: string[]) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app, response_type: 'code', scope: scopes.join(' '), redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const loc = (await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' })).headers.get('location') ?? '';
    const rid = decodeURIComponent(/req=([^&]+)/.exec(loc)?.[1] ?? '');
    assert(rid.startsWith('agreq-'), `authorize ${app}: no request id in ${loc}`);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200, `consent ${app}: ${con.status} ${JSON.stringify(con.body.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
    assert(tok.status === 200, `token ${app}: ${tok.status} ${JSON.stringify(tok.body.error)}`);
    return tok.body.data as { access_token: string; refresh_token: string; grant_id: string; scope: string };
}

const grantsOf = async (token: string) => (await json('/v1/app-grants', { headers: auth(token) })).body.data.grants as Array<{ grant_id: string; app: string; scopes: string[] }>;
const mailNotices = async (token: string) => ((await json('/v1/notifications?limit=200', { headers: auth(token) })).body.data.notifications || [])
    .filter((n: any) => n.type === 'app_mail_read_consent');
/** The server's own configuration, as far as this run needs it: the node id the records carry. */
const nodeConfig = (): AimeatConfig => ({ ...loadConfig().config, nodeId: NODE_ID });

async function openServerStorage(): Promise<Storage | null> {
    const provider = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
    if (provider !== 'sqlite' && provider !== 'postgres-kysely') return null;
    return createStorage({ provider, sqlitePath: serverSqlitePath(), dbUrl: serverDbUrl() });
}

// What an app does is not the evidence: the node keeps no record of which app read a mailbox. The
// grant's word and the owner's mailbox are, so every app here carries the same trivial code.
const CODE = 'void 0;';

console.log('\n=== Mail read permission for apps granted before it had a word of its own ===\n');

const storage = await openServerStorage();
if (!storage) {
    console.log('  (skipped: this backend lives inside the server, so its database cannot be reached from here)');
    process.exit(0);
}

let A: Awaited<ReturnType<typeof setupOwner>>;   // uses the apps, and has a Gmail the node may read
let B: Awaited<ReturnType<typeof setupOwner>>;   // publishes the apps; uses one, and can only send mail
let C: Awaited<ReturnType<typeof setupOwner>>;   // four apps that may publish, and an Outlook mailbox
const g: Record<string, { access_token: string; refresh_token: string; grant_id: string; scope: string }> = {};
let mailbox = '';

await test('0. The node ran the mail read migration at boot and left its marker', async () => {
    // The runner boots a fresh node for this suite, and the run is fire-and-forget after storage
    // is ready: give it a moment rather than racing it.
    const statusOf = async () => ((await storage.getMemory(MARKER_NS, MARKER_KEY))?.value as { status?: string } | undefined)?.status;
    let status = await statusOf();
    for (let i = 0; i < 40 && status !== 'done'; i++) { await sleep(250); status = await statusOf(); }
    assert(status === 'done', `marker ${MARKER_NS}/${MARKER_KEY} says ${JSON.stringify(status)}: the node did not run the migration at boot`);
});

await test('Setup: three owners, six apps, the grants made before reading had a word of its own, three mail connections', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
    await publish(B.token, 'mail-reader.html', 'Mail Reader', 'memory:read connections:use', CODE);
    await publish(B.token, 'social-poster.html', 'Social Poster', 'memory:read connections:use', CODE);
    await publish(B.token, 'inbox-helper.html', 'Inbox Helper', `memory:read connections:use ${READ_WORD}`, CODE);
    await publish(B.token, 'notes.html', 'Notes', 'memory:read', CODE);
    await publish(B.token, 'agenda.html', 'Agenda', 'memory:read connections:use', CODE);
    await publish(B.token, 'drafts.html', 'Drafts', 'memory:read connections:use', CODE);
    g.reader = await grant(A, `${B.name}/mail-reader.html`, ['memory:read', 'connections:use']);
    g.poster = await grant(A, `${B.name}/social-poster.html`, ['memory:read', 'connections:use']);
    // Already holds the word: nothing to give back.
    g.helper = await grant(A, `${B.name}/inbox-helper.html`, ['memory:read', 'connections:use', READ_WORD]);
    // Never held connections:use: it could not read mail, and it is not offered the word.
    g.notes = await grant(A, `${B.name}/notes.html`, ['memory:read']);
    // B uses the same app, but B's mail connection only sends, so there was nothing to read.
    g.readerB = await grant(B, `${B.name}/mail-reader.html`, ['memory:read', 'connections:use']);
    // C has four such apps: one more than the buttons one notification can carry.
    for (const f of ['mail-reader', 'social-poster', 'agenda', 'drafts']) {
        g[`c-${f}`] = await grant(C, `${B.name}/${f}.html`, ['memory:read', 'connections:use']);
    }

    const then = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const row = (id: string, principal: string, provider: string, scopes: string[]) => ({
        id, principal, mode: 'personal', provider, instance: null, accountLabel: `${id}@example.test`, externalId: id,
        credential: 'sealed', credentialShape: 'oauth2', scopes, expiresAt: null, status: 'active', lastOkAt: then,
        lastError: null, providerClientId: null, createdAt: then, updatedAt: then,
    } as unknown as ConnectionRecord);
    mailbox = `conn-mrc-a-${Date.now()}`;
    await storage.createConnection(row(mailbox, A.ghii, 'google-mail', ['https://www.googleapis.com/auth/gmail.readonly']));
    await storage.createConnection(row(`conn-mrc-b-${Date.now()}`, B.ghii, 'google-mail-send', ['https://www.googleapis.com/auth/gmail.send']));
    await storage.createConnection(row(`conn-mrc-c-${Date.now()}`, C.ghii, 'microsoft-mail', ['Mail.Read', 'User.Read', 'offline_access']));
    const held = await storage.listConnections({});
    assert([A.ghii, B.ghii, C.ghii].every(p => held.some(c => c.principal === p)), `the three connections are stored: ${held.length}`);
    assert(Object.keys(g).length === 9, `nine grants: ${Object.keys(g).join(', ')}`);
});

const door = (grantId: string) => `/v1/app-grants/${encodeURIComponent(grantId)}/read-through`;

// The state of a node that has not run the migration yet: the grants and the mailbox exist, and
// the marker does not.
let migrate: ((s: Storage, c: AimeatConfig) => Promise<{ ran: boolean; owners: number; grants: number }>) | null = null;

await test('1. Run over the grants the node already holds, it tells each owner with a readable mailbox once, naming the apps that may publish', async () => {
    const mod = await import('../src/services/mail-read-consent.js').catch(() => null) as any;
    migrate = mod?.migrateMailReadConsent ?? null;
    assert(typeof migrate === 'function', 'this node has no mail read migration (services/mail-read-consent.ts)');
    await storage.deleteMemory(MARKER_NS, MARKER_KEY);
    const out = await migrate!(storage, nodeConfig());
    assert(out.ran === true && out.owners === 2 && out.grants === 6, `the run: ${JSON.stringify(out)}`);

    const mine = await mailNotices(A.token);
    assert(mine.length === 1, `A has one notice, got ${mine.length}`);
    const n = mine[0];
    assert(n.source?.kind === 'aimeat' && n.group === 'apps', `the node sent it, among the apps: ${JSON.stringify([n.source, n.group])}`);
    assert(n.link === '/v1/profile#access', `the notice opens Access: ${n.link}`);
    assert(n.i18n?.key === 'app_mail_read_consent', `said in the reader's language: ${JSON.stringify(n.i18n)}`);
    const text = `${n.title} ${n.body}`;
    for (const app of ['Mail Reader', 'Social Poster']) assert(text.includes(app), `${app} is named: ${text}`);
    for (const other of ['Inbox Helper', 'Notes']) assert(!text.includes(other), `${other} is not named: ${text}`);
    const acts = n.actions as any[];
    assert(acts.length === 2, `a button per app, got ${JSON.stringify(acts)}`);
    for (const [a, key] of [[acts[0], 'reader'], [acts[1], 'poster']] as const) {
        assert(a.kind === 'api' && a.method === 'POST' && a.endpoint === door(g[key].grant_id), `the button calls the owner's door for that grant: ${JSON.stringify(a)}`);
        assert(a.i18n?.key === 'app_mail_read_consent.allow' && typeof a.i18n.vars?.app === 'string', `the button is said in the reader's language: ${JSON.stringify(a.i18n)}`);
    }
    assert(acts[0].label.includes('Mail Reader') && acts[1].label.includes('Social Poster'), `each button names its app: ${acts.map(a => a.label).join(' | ')}`);

    // Four apps, three buttons: the text names all four, says so, and the link is the grants page.
    const theirs = await mailNotices(C.token);
    assert(theirs.length === 1, `C has one notice, got ${theirs.length}`);
    const m = theirs[0];
    assert(m.i18n?.key === 'app_mail_read_consent_more' && m.i18n?.vars?.shown === 3, `the text says there are more: ${JSON.stringify(m.i18n)}`);
    for (const app of ['Mail Reader', 'Social Poster', 'Agenda', 'Drafts']) assert(`${m.title} ${m.body}`.includes(app), `${app} is named: ${m.body}`);
    assert((m.actions as any[]).length === 3 && m.link === '/v1/profile#access', `three buttons and the grants page: ${JSON.stringify([m.actions.length, m.link])}`);

    assert((await mailNotices(B.token)).length === 0, 'B, whose mail connection only sends, is told nothing');
});

await test('2. It runs once: a second run tells nobody again', async () => {
    assert(typeof migrate === 'function', 'no migration to run');
    const out = await migrate!(storage, nodeConfig());
    assert(out.ran === false, `the second run did something: ${JSON.stringify(out)}`);
    assert((await mailNotices(A.token)).length === 1, 'A was told twice');
});

await test('3. SECURITY: the door is the owner\'s own: refused without a session, to another owner, to the app, to the owner\'s agent', async () => {
    const none = await json(door(g.reader.grant_id), { method: 'POST' });
    assert(none.status === 401, `no session: ${none.status}`);
    const other = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(B.token) });
    assert(other.status === 404, `another owner: ${other.status} ${JSON.stringify(other.body.error)}`);
    const app = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(g.reader.access_token) });
    assert(app.status === 403, `the app itself: ${app.status} ${JSON.stringify(app.body.error)}`);
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: `mrcbot${Date.now() % 100000}`, owner: A.name, capabilities: ['memory'], scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent: ${ag.status} ${JSON.stringify(ag.body.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }) });
    assert(at.body.ok === true, `agent token: ${JSON.stringify(at.body.error)}`);
    const agent = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(at.body.data.token) });
    assert(agent.status === 403, `an agent of the owner: ${agent.status} ${JSON.stringify(agent.body.error)}`);
    const still = (await grantsOf(A.token)).find(x => x.grant_id === g.reader.grant_id)!;
    assert(!still.scopes.includes(READ_WORD), `a refused call changed the grant: ${JSON.stringify(still.scopes)}`);
});

await test('4. The owner\'s tap adds connections:read-through and nothing else, to that grant alone', async () => {
    const before = await grantsOf(A.token);
    const r = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.added === true, `allow: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const after = await grantsOf(A.token);
    for (const was of before) {
        const now = after.find(x => x.grant_id === was.grant_id)!;
        const expected = was.grant_id === g.reader.grant_id ? [...was.scopes, READ_WORD] : was.scopes;
        assert(JSON.stringify([...now.scopes].sort()) === JSON.stringify([...expected].sort()), `${was.app}: ${JSON.stringify(was.scopes)} → ${JSON.stringify(now.scopes)}`);
    }
    const again = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(A.token) });
    assert(again.status === 200 && again.body.data.added === false, `a second tap: ${again.status} ${JSON.stringify(again.body.data ?? again.body.error)}`);
    const notes = await json(door(g.notes.grant_id), { method: 'POST', headers: auth(A.token) });
    assert(notes.status === 409, `a grant that never held connections:use: ${notes.status} ${JSON.stringify(notes.body.error)}`);
});

/** Refresh the reader's token, keeping the rotated refresh token for the next one. */
async function refreshReader(): Promise<string[]> {
    const r = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: g.reader.refresh_token }) });
    assert(r.status === 200, `refresh: ${r.status} ${JSON.stringify(r.body.error)}`);
    g.reader.refresh_token = r.body.data.refresh_token;
    return String(r.body.data.scope).split(' ');
}
const readerRow = async () => (await grantsOf(A.token) as any[]).find(x => x.grant_id === g.reader.grant_id);

await test('5. A refresh keeps the word the owner added, though the app declares only connections:use', async () => {
    const words = await refreshReader();
    assert(words.includes(READ_WORD) && words.includes('connections:use'), `the refreshed token: ${words.join(' ')}`);
    const row = await readerRow();
    assert(JSON.stringify(row.owner_added_scopes) === JSON.stringify([READ_WORD]), `the grant says the owner added it: ${JSON.stringify(row.owner_added_scopes)}`);
});

await test('5b. The owner takes it away on the grants page, and a refresh does not bring it back', async () => {
    const keep = (await readerRow()).scopes.filter((w: string) => w !== READ_WORD);
    const r = await json(`/v1/app-grants/${encodeURIComponent(g.reader.grant_id)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: keep }) });
    assert(r.status === 200, `take away: ${r.status} ${JSON.stringify(r.body.error)}`);
    const row = await readerRow();
    assert(!row.scopes.includes(READ_WORD) && row.owner_added_scopes.length === 0, `after taking it away: ${JSON.stringify(row)}`);
    assert(!(await refreshReader()).includes(READ_WORD), 'the refresh brought the word back');
});

await test('5c. The owner takes it away on the same door, and a refresh does not bring it back', async () => {
    const add = await json(door(g.reader.grant_id), { method: 'POST', headers: auth(A.token) });
    assert(add.status === 200 && add.body.data.added === true, `add again: ${add.status} ${JSON.stringify(add.body.error ?? add.body.data)}`);
    const other = await json(door(g.reader.grant_id), { method: 'DELETE', headers: auth(B.token) });
    assert(other.status === 404, `another owner takes it away: ${other.status}`);
    const del = await json(door(g.reader.grant_id), { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200 && del.body.data.removed === true, `take away: ${del.status} ${JSON.stringify(del.body.error ?? del.body.data)}`);
    const row = await readerRow();
    assert(!row.scopes.includes(READ_WORD) && row.owner_added_scopes.length === 0 && row.scopes.includes('connections:use'), `after taking it away: ${JSON.stringify(row)}`);
    assert(!(await refreshReader()).includes(READ_WORD), 'the refresh brought the word back');
    const again = await json(door(g.reader.grant_id), { method: 'DELETE', headers: auth(A.token) });
    assert(again.status === 200 && again.body.data.removed === false, `a second removal: ${again.status} ${JSON.stringify(again.body.data ?? again.body.error)}`);
});

await test('6. An app without the word is refused the mailbox, and told the word and how an app asks for it', async () => {
    const r = await json(`/v1/connections/${encodeURIComponent(mailbox)}/read/messages`, { method: 'POST', headers: auth(g.poster.access_token), body: '{}' });
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `refusal: ${r.status} ${JSON.stringify(r.body.error)}`);
    const msg = String(r.body.error?.message ?? '');
    assert(msg.includes(READ_WORD), `the refusal names the word: ${msg}`);
    assert(msg.includes('aimeat-scopes') && /consent|approve/i.test(msg), `the refusal says how an app asks for it: ${msg}`);
    assert((r.headers.get('www-authenticate') ?? '').includes(`scope="${READ_WORD}"`), `the challenge header names it: ${r.headers.get('www-authenticate')}`);
});

await storage.close?.();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

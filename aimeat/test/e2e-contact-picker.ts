/**
 * @file e2e-contact-picker.ts
 * @description E2E for TARGET-063 phase 3: an app reaches ONE person from the owner's address book
 *   without ever being able to read it. Covers the whole shape — the owner mints a handle from the
 *   apex picker, the app spends it through the node, and every refusal that keeps it honest:
 *   an origin that serves no app, a contact the owner does not have, a contact with no address, a
 *   handle another app was given, a handle another owner minted, an unknown handle, and an app
 *   without `outbound:send`. It also asserts the two things the app must NOT learn: the address,
 *   and anybody else in the book.
 *
 *   Starts its OWN server, like e2e-app-silent: the shared runner pins AIMEAT_APP_HOST to '' (the
 *   app origin family off), and every assertion here is about which app an origin resolves to.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
// Run: cd aimeat && pnpm exec node --import tsx test/e2e-contact-picker.ts

import { randomBytes, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

const PORT = process.env.E2E_PICKER_PORT ?? '40273';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const APP_HOST = 'apps.localhost';
const DB_PATH = './test/.test-contact-picker.db';

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        // eslint-disable-next-line aimeat/no-silent-catch -- a database file that is not there is the state this wants
        try { if (existsSync(f)) unlinkSync(f); } catch { /* already gone */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => { /* drained */ });
    child.stderr?.on('data', () => { /* drained */ });
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        // eslint-disable-next-line aimeat/no-silent-catch -- not listening yet is the normal state for the first second
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGKILL');
    throw new Error('Server failed to start');
}

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
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const stamp = Date.now();

async function register(username: string): Promise<string> {
    const pw = 'PickerPw#2026';
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200, `login ${username}: ${login.status}`);
    return login.body.data.token as string;
}

async function publishApp(token: string, filename: string): Promise<void> {
    const r = await json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, content: b64('<!DOCTYPE html><html><body>app</body></html>'), name: filename, description: 'picker probe', category: 'utility' }),
    });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

/** The FIRST owner on a fresh node is the operator; only they may bind a subdomain. */
async function bindSubdomain(operatorToken: string, sub: string, target: string): Promise<void> {
    const r = await json('/v1/admin/subdomains', {
        method: 'POST', headers: auth(operatorToken),
        body: JSON.stringify({ subdomain: sub, kind: 'app', target }),
    });
    assert(r.status === 201, `bind ${sub}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

/** The visible authorize → consent → token flow, as an app does it. */
async function appToken(ownerToken: string, app: string, redirect: string, scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!rid, `authorize did not redirect to consent (${res.status})`);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ request_id: decodeURIComponent(rid![1]) }),
    });
    assert(con.status === 200, `consent: ${con.status} ${JSON.stringify(con.body.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }),
    });
    assert(tok.status === 200, `token: ${tok.status} ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.access_token as string;
}

async function savePerson(token: string, name: string, email: string): Promise<string> {
    const r = await json('/v1/contacts', { method: 'POST', headers: auth(token), body: JSON.stringify({ name, email }) });
    assert(r.status === 201, `save person: ${r.status} ${JSON.stringify(r.body.error)}`);
    return r.body.data.contact_id as string;
}

const mint = (token: string, contactId: string, origin: string) =>
    json('/v1/contacts/handles', { method: 'POST', headers: auth(token), body: JSON.stringify({ contact_id: contactId, app_origin: origin }) });

const spend = (token: string, handle: string, extra: Record<string, unknown> = {}) =>
    json('/v1/contacts/handle/send', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ handle, subject: 'Hello', body: 'A message the app never addressed.', ...extra }),
    });

async function main() {
    const server = await startServer();
    try {
    console.log('\n=== AIMEAT Contact Picker (an app reaches ONE person) E2E ===\n');

    let operatorToken = '';
    let A = '', B = '';                                   // owner tokens
    const appFile = `picker-${stamp}.html`;
    const otherFile = `picker-other-${stamp}.html`;
    const appSub = `pick${stamp}`;
    const otherSub = `pickb${stamp}`;
    let appOrigin = '', otherOrigin = '';
    let appTarget = '', otherTarget = '';
    let aToken = '', otherAppToken = '';                  // app-grant tokens (owner A's grants)
    let contactId = '', identityContactId = '';
    let handle = '';
    const personEmail = `picked-${stamp}@example.com`;

    await test('Setup: operator, two owners, two apps, two subdomains', async () => {
        // The first account on a fresh database becomes the operator, and only an operator may bind a
        // subdomain — so it is taken deliberately rather than by whichever test ran first.
        operatorToken = await register(`pickop${stamp}`);
        A = await register(`picka${stamp}`);
        B = await register(`pickb${stamp}`);

        await publishApp(A, appFile);
        await publishApp(A, otherFile);
        appTarget = `picka${stamp}/${appFile}`;
        otherTarget = `picka${stamp}/${otherFile}`;
        await bindSubdomain(operatorToken, appSub, appTarget);
        await bindSubdomain(operatorToken, otherSub, otherTarget);
        appOrigin = `http://${appSub}.${APP_HOST}`;
        otherOrigin = `http://${otherSub}.${APP_HOST}`;

        contactId = await savePerson(A, 'Picked Paula', personEmail);
        const ident = await json('/v1/contacts', { method: 'POST', headers: auth(A), body: JSON.stringify({ contact_id: `pickb${stamp}` }) });
        assert(ident.status === 201, `save identity: ${ident.status} ${JSON.stringify(ident.body.error)}`);
        identityContactId = ident.body.data.contact_id;
    });

    // ── Minting: the owner's half ──

    await test('1. The owner mints a handle for a saved person, and gets back a LABEL, not an address', async () => {
        const r = await mint(A, contactId, appOrigin);
        assert(r.status === 201, `mint ${r.status}: ${JSON.stringify(r.body.error)}`);
        handle = r.body.data.handle;
        assert(!!handle, 'a handle came back');
        assert(r.body.data.app === appTarget, `bound to the app the origin serves: ${r.body.data.app}`);
        assert(r.body.data.contact.label === 'Picked Paula', `label: ${JSON.stringify(r.body.data.contact)}`);
        assert(r.body.data.contact.reachable.join() === 'email', `reachable: ${JSON.stringify(r.body.data.contact.reachable)}`);
        // The two things that must never cross: the address, and the address-book id.
        const wire = JSON.stringify(r.body.data);
        assert(!wire.includes(personEmail), `the address must not be in the reply: ${wire}`);
        assert(!wire.includes(contactId), `the contact id must not be in the reply: ${wire}`);
    });

    await test('2. An origin that serves no app on this node mints nothing', async () => {
        for (const origin of ['https://evil.example.com', `http://nosuchsub-${stamp}.${APP_HOST}`, `http://a.b.${APP_HOST}`, 'not-a-url']) {
            const r = await mint(A, contactId, origin);
            assert(r.status === 400, `origin ${origin} expected 400, got ${r.status}`);
        }
    });

    await test('3. A contact the owner does not have mints nothing (404), and neither does a foreign one', async () => {
        const nope = await mint(A, `mail:${randomBytes(8).toString('hex')}`, appOrigin);
        assert(nope.status === 404, `unknown contact expected 404, got ${nope.status}`);
        // B has their own address book; A's contact is not in it, and B learns nothing else about it.
        const theirs = await mint(B, contactId, appOrigin);
        assert(theirs.status === 404, `cross-owner mint expected 404, got ${theirs.status}`);
    });

    await test('4. A contact with no saved address is refused rather than offered (422)', async () => {
        const r = await mint(A, identityContactId, appOrigin);
        assert(r.status === 422 && r.body.error?.code === 'NOT_REACHABLE', `expected 422 NOT_REACHABLE, got ${r.status} ${r.body.error?.code}`);
    });

    // ── Spending: the app's half ──

    await test('5. The app spends the handle and the NODE sends; the send log records it', async () => {
        aToken = await appToken(A, appTarget, `${appOrigin}/cb`, 'outbound:send');
        const r = await spend(aToken, handle);
        assert(r.status === 200, `spend ${r.status}: ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.channel === 'email', `channel: ${r.body.data.channel}`);
        assert(!!r.body.data.message_id, 'a send-log id came back');
        // The owner can see what left; the app cannot see the address it went to.
        const log = await json('/v1/outbound/log', { headers: auth(A) });
        assert(log.status === 200 && log.body.data.messages.length >= 1, `send log: ${log.status}`);
        assert(!JSON.stringify(r.body.data).includes(personEmail), 'the address is not echoed to the app');
    });

    await test('6. The handle is reusable inside its window (a permission that dies after one use is not one)', async () => {
        const r = await spend(aToken, handle, { subject: 'Second', body: 'Still allowed.' });
        assert(r.status === 200, `second spend ${r.status}: ${JSON.stringify(r.body.error)}`);
    });

    await test('7. ANOTHER app cannot spend this handle, even for the same owner (403)', async () => {
        otherAppToken = await appToken(A, otherTarget, `${otherOrigin}/cb`, 'outbound:send');
        const r = await spend(otherAppToken, handle);
        assert(r.status === 403 && r.body.error?.code === 'INVALID_HANDLE', `expected 403 INVALID_HANDLE, got ${r.status} ${r.body.error?.code}`);
    });

    await test('8. An unknown handle, and an owner session with no app, are both refused (403)', async () => {
        const unknown = await spend(aToken, randomBytes(24).toString('base64url'));
        assert(unknown.status === 403, `unknown handle expected 403, got ${unknown.status}`);
        // An owner token carries no app, so it can never be the principal a handle was minted for —
        // even though an owner session sails past requireScope.
        const asOwner = await spend(A, handle);
        assert(asOwner.status === 403, `owner session expected 403, got ${asOwner.status}`);
    });

    await test('9. An app without outbound:send cannot spend anything (403 on the scope)', async () => {
        const readOnly = await appToken(A, appTarget, `${appOrigin}/cb`, 'memory:read');
        const r = await spend(readOnly, handle);
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    });

    await test('10. The app still cannot read the address book with the token it holds (403)', async () => {
        const list = await json('/v1/contacts', { headers: auth(aToken) });
        assert(list.status === 403, `app reading the address book expected 403, got ${list.status}`);
        const mintAsApp = await mint(aToken, contactId, appOrigin);
        assert(mintAsApp.status === 403, `app minting its own handle expected 403, got ${mintAsApp.status}`);
    });

    await test('11. Removing the contact cancels the handle immediately', async () => {
        const del = await json(`/v1/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE', headers: auth(A) });
        assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
        const r = await spend(aToken, handle);
        assert(r.status === 403, `spend after removal expected 403, got ${r.status}`);
    });
    } finally {
        server.kill('SIGKILL');
        cleanupDb();
    }
    console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) process.exit(1);
}

await main();

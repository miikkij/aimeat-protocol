/**
 * @file e2e-app-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: an APP reaching an organism row space, the two-hand rule.
 *
 *   An app running in a person's browser holds an app grant, not a membership, and the
 *   organism's data is not the person's to open with a click. So the ORGANISM names the app in the
 *   row space's manifest (`objectTypes[].apps: ["owner/filename"]`) and the PERSON approves the
 *   `organism:rows` scope at sign-in; only both together let the app append to and read that one
 *   space, and only while the person is an active member.
 *
 *   What it proves:
 *     - named app + scope + member → append 200, read 200 (the row carries the app's principal);
 *     - the same app without the scope → 403 at the route (the person's hand missing);
 *     - a space that does not name the app → 403 from the service (the organism's hand missing);
 *     - a memory space → 403 (row spaces only);
 *     - the same app granted by a NON-member → 403 (membership still required);
 *     - a member's own session keeps working as before on the same space.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const FILENAME = 'rows-demo.html';
const REDIRECT = 'http://localhost:9922/callback';
const WS = 'ws-approws';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setupOwner(label: string) {
    const name = `approw${label}${Date.now() % 100000}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.data.token as string };
}

/** The full app-grant flow, as a person approving `scopes` for the app `owner/FILENAME`. */
async function grantApp(personToken: string, appOwner: string, scopes: string[]): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${appOwner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
    });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${personToken}` }, body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token as string;
}

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
let appNamed = '';     // A's grant, organism:rows, on a space that names the app
let appNoScope = '';   // A's grant, memory scopes only
let appOfB = '';       // B's grant (B is not a member)
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const rowsUrl = (space: string, qs = '') => `/v1/organisms/${orgId}/workspace/rows/${space}?ws=${WS}${qs}`;
const row = (kind: string, detail: string) => ({ body: { app: FILENAME, kind, actor: A.name, at: new Date().toISOString(), detail } });

console.log('\n=== App → organism row space (two-hand rule) E2E ===\n');

await test('Setup: two owners, an organism, a workspace naming the app on one row space, the app published', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ name: 'App Rows Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
    orgId = o.body.data.organism.id;
    const manifest = {
        manifestVersion: '1', id: orgId, name: 'App Rows WS', kind: 'workspace', status: 'active',
        objectTypes: [
            { name: 'event', schemaRef: 'schema:event@1', namespace: 'demo.event', backing: 'rows', writeRole: 'member', mode: 'records',
              indexOn: ['app', 'kind'], apps: [`${A.name}/${FILENAME}`] },
            { name: 'closed', schemaRef: 'schema:closed@1', namespace: 'demo.closed', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['kind'] },
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'demo.notes', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
    };
    const m = await json('/v1/memory', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }),
    });
    assert(m.status === 200 || m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body)}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>rows</body></html>'), name: 'Rows Demo', description: 'app rows', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body)}`);
});

await test('The person approves organism:rows for the app; a grant without it is minted too; B grants as well', async () => {
    appNamed = await grantApp(A.token, A.name, ['memory:read', 'memory:write', 'organism:rows']);
    appNoScope = await grantApp(A.token, A.name, ['memory:read', 'memory:write']);
    appOfB = await grantApp(B.token, A.name, ['memory:read', 'organism:rows']);
    assert(!!appNamed && !!appNoScope && !!appOfB, 'three app tokens');
});

await test('Named app + scope + member: append lands, the row carries the app principal', async () => {
    const r = await json(rowsUrl('event'), { method: 'POST', headers: bearer(appNamed), body: JSON.stringify({ rows: [row('order', 'first'), row('order', 'second')] }) });
    assert(r.status === 200, `append ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.written === 2, 'two written');
});

await test('Named app reads the space back, and only that space', async () => {
    const r = await json(rowsUrl('event', '&kind=order'), { headers: bearer(appNamed) });
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.rows.length === 2, `two rows: ${r.body.data.rows.length}`);
    assert(r.body.data.rows.every((x: any) => x.body.app === FILENAME), 'rows are the app\'s');
    const s = await json(`/v1/organisms/${orgId}/workspace/rows/event/stats?ws=${WS}`, { headers: bearer(appNamed) });
    assert(s.status === 200 && s.body.data.stats.rows === 2, `stats: ${s.status} ${JSON.stringify(s.body.data)}`);
    const closed = await json(rowsUrl('closed'), { headers: bearer(appNamed) });
    assert(closed.status === 403, `a space that does not name the app: ${closed.status}`);
});

await test('The person\'s hand missing: the same app without organism:rows is refused at the door', async () => {
    const r = await json(rowsUrl('event'), { method: 'POST', headers: bearer(appNoScope), body: JSON.stringify(row('order', 'no scope')) });
    assert(r.status === 403, `append without scope: ${r.status}`);
    const g = await json(rowsUrl('event'), { headers: bearer(appNoScope) });
    assert(g.status === 403, `read without scope: ${g.status}`);
});

await test('The organism\'s hand missing: a space that does not name the app refuses the append, and says so', async () => {
    const r = await json(rowsUrl('closed'), { method: 'POST', headers: bearer(appNamed), body: JSON.stringify(row('order', 'closed')) });
    assert(r.status === 403, `append to an unnamed space: ${r.status}`);
    assert(/not open to the app/.test(r.body.error?.message ?? ''), `message: ${r.body.error?.message}`);
});

await test('A memory space is not a row space, whoever asks', async () => {
    const r = await json(rowsUrl('note'), { method: 'POST', headers: bearer(appNamed), body: JSON.stringify(row('order', 'note')) });
    assert(r.status === 400 || r.status === 403 || r.status === 404, `memory space: ${r.status}`);
});

await test('Membership still required: B (not a member) granting the same app is refused', async () => {
    const r = await json(rowsUrl('event'), { method: 'POST', headers: bearer(appOfB), body: JSON.stringify(row('order', 'from B')) });
    assert(r.status === 403, `non-member's app: ${r.status}`);
    const g = await json(rowsUrl('event'), { headers: bearer(appOfB) });
    assert(g.status === 403, `non-member's app read: ${g.status}`);
});

await test('The member\'s own session keeps working on the same space', async () => {
    const r = await json(rowsUrl('event'), { method: 'POST', headers: bearer(A.token), body: JSON.stringify(row('other', 'by the person')) });
    assert(r.status === 200, `member append: ${r.status} ${JSON.stringify(r.body)}`);
    const g = await json(rowsUrl('event'), { headers: bearer(A.token) });
    assert(g.status === 200 && g.body.data.rows.length === 3, `member read: ${g.status} ${g.body.data?.rows?.length}`);
});

console.log('\nCleanup');
await test('Delete the app', async () => {
    const { status } = await json(`/v1/apps/${FILENAME}`, { method: 'DELETE', headers: bearer(A.token) });
    assert(status === 200, `delete ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file e2e-account-events-readers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: who reads a task's title and decline reason in the account's event record
 *   (GET /v1/account/events, GET /v1/account/events/archive) and the home feed (GET /v1/home/feed).
 *   The task route GET /v1/agents/:name/tasks shows a task's content to the owner in person, an app
 *   grant holding task:read and the task's own agent, and answers 403 to a sibling agent and an
 *   ecosystem app. Until 2026-10-22 those two read the title and the reason from the event rows on
 *   memory:read (secaudit 2026-10, v89). The developer's ruling, 2026-10-22: the title and reason are
 *   shown to exactly those who may read that agent's tasks; every other reader still sees each row's
 *   kind, time, link and agent name. Covered here:
 *
 *   REFUSED (each red on the unfixed code):
 *   - a sibling agent with the shipped default scopes gets the agent_task_declined and
 *     agent_task_failed rows without title and reason, on the window, the archive and the feed;
 *   - an ecosystem app with the default scopes, the same on the window and the feed;
 *   - an app grant holding memory:read without task:read, the same (the task route refuses it too).
 *
 *   KEPT (green before and after):
 *   - the owner in person, an app grant holding task:read, and the task's own agent get the title and
 *     the reason, on the window, the archive and the feed;
 *   - every other reader still gets the row: kind, time, link and the agent's name;
 *   - an app's own rows (POST /v1/account/events) come back to it unchanged.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=account-events-readers
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const TAG = Date.now().toString(36);
const REDIRECT = 'http://localhost:9922/callback';
const FILENAME = `evreaders${TAG}.html`;
/** SHIPPED_DEFAULT_AGENT_SCOPES (src/config.ts): no task:read, no memory:read-as-owner. */
const SHIPPED_DEFAULT = ['memory:read', 'memory:write', 'memory:delete', 'catalogue:read', 'organism:read', 'agent:read', 'messages:send', 'storage:write'];
const TITLE_DECLINED = `probe-title-declined-${TAG}`;
const REASON = `probe-reason-${TAG}`;
const TITLE_FAILED = `probe-title-failed-${TAG}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// PKCE, reused: each authorize -> consent mints its own single-use code.
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

/** The app-grant flow for `scopes`, consented by the owner. Returns the app's access token. */
async function grantApp(appRef: string, ownerToken: string, scopes: string[]): Promise<string> {
    const q = new URLSearchParams({
        app: appRef, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `authorize: ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token;
}

/** An ecosystem app of the owner, approved with the default scopes and no data areas. */
async function ecosystemApp(owner: RegisteredOwner, app: string): Promise<string> {
    const priv = ed.utils.randomSecretKey();
    const pub = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64');
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner: owner.name, app, display_name: app, public_key: pub }) });
    assert(hello.status === 200, `hello ${hello.status}: ${JSON.stringify(hello.body)}`);
    const appr = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, { method: 'POST', headers: bearer(owner.token), body: JSON.stringify({ action: 'approve' }) });
    assert(appr.status === 200, `approve ${appr.status}: ${JSON.stringify(appr.body)}`);
    const tk = await json('/v1/ecosystem-apps/token', {
        method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(tk.status === 200 && tk.body.access_token, `eco token ${tk.status}: ${JSON.stringify(tk.body)}`);
    return tk.body.access_token as string;
}

type Row = { kind: string; at: string; link?: string | null; data?: Record<string, string>; withheld?: string[] };
const windowRows = async (token: string) => {
    const r = await json('/v1/account/events', { headers: bearer(token) });
    assert(r.status === 200, `events ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return { rows: r.body.data.events as Row[], note: r.body.data.note as string | undefined, window: r.body.data.window as number };
};
const archiveRows = async (token: string) => {
    const r = await json('/v1/account/events/archive?limit=500', { headers: bearer(token) });
    assert(r.status === 200, `archive ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return { rows: r.body.data.events as Row[], note: r.body.data.note as string | undefined };
};
const feedRows = async (token: string) => {
    const r = await json('/v1/home/feed', { headers: bearer(token) });
    assert(r.status === 200, `feed ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return { rows: r.body.data.items as Row[], note: r.body.data.note as string | undefined };
};
const declinedRow = (rows: Row[]) => rows.find(r => r.kind === 'agent_task_declined' && r.data?.agent === worker.name);
const failedRow = (rows: Row[]) => rows.find(r => r.kind === 'agent_task_failed' && r.data?.agent === worker.name);

/** The row without the task's content, and with everything else a reader needs to say what happened. */
function assertWithheld(row: Row | undefined, where: string): void {
    assert(row !== undefined, `${where}: the row is gone, and "what happened lately" lost it`);
    assert(row.data?.title === undefined && row.data?.reason === undefined, `${where}: the task's content reached this reader: ${JSON.stringify(row)}`);
    assert(row.data?.agent === worker.name && typeof row.at === 'string' && !!row.link, `${where}: the row lost its agent, time or link: ${JSON.stringify(row)}`);
    assert(Array.isArray(row.withheld) && row.withheld.includes('title'), `${where}: the row does not say what was taken out: ${JSON.stringify(row)}`);
}
function assertFull(rows: Row[], where: string): void {
    const d = declinedRow(rows);
    assert(d?.data?.title === TITLE_DECLINED && d.data?.reason === REASON && !d.withheld, `${where}: the declined row lost its content: ${JSON.stringify(d)}`);
    const f = failedRow(rows);
    assert(f?.data?.title === TITLE_FAILED && !f.withheld, `${where}: the failed row lost its title: ${JSON.stringify(f)}`);
}

console.log('\n=== A task\'s title and reason in the account record and the home feed, by reader (secaudit 2026-10, v89) ===\n');

let O!: RegisteredOwner;
let worker!: McpAgent;    // the agent whose tasks these are
let sibling!: McpAgent;   // another agent of the same owner
let eco = '';
let appTasks = '';        // app grant: memory:read + task:read
let appMemory = '';       // app grant: memory:read + memory:write, no task:read

await test('Setup: an owner, two agents with the shipped default scopes, an ecosystem app, two app grants, a declined task and a failed one', async () => {
    O = await registerOwner(BASE, `evr${TAG}`);
    worker = await makeAgent(BASE, O, SHIPPED_DEFAULT);
    sibling = await makeAgent(BASE, O, SHIPPED_DEFAULT);
    eco = await ecosystemApp(O, `evr-eco-${TAG}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(O.token),
        body: JSON.stringify({ filename: FILENAME, content: Buffer.from('<!DOCTYPE html><html><body>events</body></html>').toString('base64'), name: 'Events', description: 'reads what happened', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body)}`);
    appTasks = await grantApp(`${O.name}/${FILENAME}`, O.token, ['memory:read', 'task:read']);
    appMemory = await grantApp(`${O.name}/${FILENAME}`, O.token, ['memory:read', 'memory:write']);

    const t1 = await json(`/v1/agents/${worker.name}/tasks`, { method: 'POST', headers: bearer(O.token), body: JSON.stringify({ title: TITLE_DECLINED, description: 'probe' }) });
    assert(t1.status === 201, `task 1 ${t1.status}: ${JSON.stringify(t1.body)}`);
    const d = await json(`/v1/agents/${worker.name}/tasks/${t1.body.data.task.id}/decline`, { method: 'POST', headers: bearer(worker.token), body: JSON.stringify({ reason: REASON }) });
    assert(d.status === 200, `decline ${d.status}: ${JSON.stringify(d.body)}`);
    const t2 = await json(`/v1/agents/${worker.name}/tasks`, { method: 'POST', headers: bearer(O.token), body: JSON.stringify({ title: TITLE_FAILED, description: 'probe' }) });
    assert(t2.status === 201, `task 2 ${t2.status}: ${JSON.stringify(t2.body)}`);
    // The shipped default scopes carry no task:write, so the owner starts the task.
    const st = await json(`/v1/agents/${worker.name}/tasks/${t2.body.data.task.id}/start`, { method: 'POST', headers: bearer(O.token) });
    assert(st.status === 200, `start ${st.status}: ${JSON.stringify(st.body)}`);
    const f = await json(`/v1/agents/${worker.name}/tasks/${t2.body.data.task.id}/fail`, { method: 'POST', headers: bearer(worker.token), body: JSON.stringify({ message: 'probe failure' }) });
    assert(f.status === 200, `fail ${f.status}: ${JSON.stringify(f.body)}`);

    // The rows are recorded fire-and-forget: wait until the owner sees both.
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
        const { rows } = await windowRows(O.token);
        ok = !!declinedRow(rows) && !!failedRow(rows);
        if (!ok) await new Promise(r => setTimeout(r, 250));
    }
    assert(ok === true, 'the owner never saw the two task rows');
    // Controls: the task route refuses the sibling, the ecosystem app and the app without task:read.
    for (const [who, tok] of [['sibling', sibling.token], ['ecosystem app', eco], ['app without task:read', appMemory]] as const) {
        const r = await json(`/v1/agents/${worker.name}/tasks`, { headers: bearer(tok) });
        assert(r.status === 403, `control: the task route answered the ${who} ${r.status}`);
    }
});

// ── Refused ──────────────────────────────────────────────────────────────────────────────────

await test('1. A sibling agent gets the task rows without title and reason on the window, with a note', async () => {
    const { rows, note } = await windowRows(sibling.token);
    assertWithheld(declinedRow(rows), 'window, declined');
    assert(declinedRow(rows)!.withheld!.includes('reason'), 'the declined row does not name the reason as taken out');
    assertWithheld(failedRow(rows), 'window, failed');
    assert(typeof note === 'string' && note.includes('task:read'), `the answer does not say who sees the content: ${note}`);
});

await test('2. ...and on the home feed', async () => {
    const { rows, note } = await feedRows(sibling.token);
    assertWithheld(declinedRow(rows), 'feed, declined');
    assertWithheld(failedRow(rows), 'feed, failed');
    assert(typeof note === 'string', 'the feed answer carries no note');
});

await test('3. An ecosystem app with the default scopes gets the same on the window and the feed', async () => {
    assertWithheld(declinedRow((await windowRows(eco)).rows), 'eco window');
    assertWithheld(declinedRow((await feedRows(eco)).rows), 'eco feed');
});

await test('4. An app grant without task:read gets the same, as the task route refuses it', async () => {
    assertWithheld(declinedRow((await windowRows(appMemory)).rows), 'app window');
    assertWithheld(declinedRow((await feedRows(appMemory)).rows), 'app feed');
});

// ── Kept ─────────────────────────────────────────────────────────────────────────────────────

await test('5. The owner in person gets the title and the reason on the window and the feed, and no note', async () => {
    const w = await windowRows(O.token);
    assertFull(w.rows, 'owner window');
    assert(w.note === undefined, `the owner was given a note: ${w.note}`);
    assertFull((await feedRows(O.token)).rows, 'owner feed');
});

await test('6. An app grant holding task:read gets them, as on the task route', async () => {
    assertFull((await windowRows(appTasks)).rows, 'app with task:read, window');
    assertFull((await feedRows(appTasks)).rows, 'app with task:read, feed');
});

await test('7. The task\'s own agent gets them', async () => {
    assertFull((await windowRows(worker.token)).rows, 'own agent, window');
    assertFull((await feedRows(worker.token)).rows, 'own agent, feed');
});

await test('8. An app\'s own rows come back to it unchanged, and other kinds pass every reader unchanged', async () => {
    const rec = await json('/v1/account/events', { method: 'POST', headers: bearer(appMemory), body: JSON.stringify({ kind: 'order_placed', data: { item: `book-${TAG}` }, link: '/v1/home' }) });
    assert(rec.status === 201, `record ${rec.status}: ${JSON.stringify(rec.body)}`);
    const kind = rec.body.data.kind as string;
    for (const tok of [appMemory, sibling.token, eco]) {
        const mine = (await windowRows(tok)).rows.find(r => r.kind === kind);
        assert(mine?.data?.item === `book-${TAG}` && !mine.withheld, `the app row changed for a reader: ${JSON.stringify(mine)}`);
    }
});

await test('9. The archive projects the same way: the sibling gets the rows without content, the owner and the own agent with it', async () => {
    // Push the task rows out of the window with the app's own rows.
    const { window } = await windowRows(O.token);
    for (let i = 0; i < window; i++) {
        const r = await json('/v1/account/events', { method: 'POST', headers: bearer(appMemory), body: JSON.stringify({ kind: 'filler', data: { n: String(i) } }) });
        assert(r.status === 201, `filler ${i}: ${r.status}`);
    }
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
        moved = !!declinedRow((await archiveRows(O.token)).rows);
        if (!moved) await new Promise(r => setTimeout(r, 250));
    }
    assert(moved === true, 'the task rows never reached the archive');
    const sib = await archiveRows(sibling.token);
    assertWithheld(declinedRow(sib.rows), 'sibling archive, declined');
    assertWithheld(failedRow(sib.rows), 'sibling archive, failed');
    assert(typeof sib.note === 'string', 'the archive answer carries no note');
    assertFull((await archiveRows(O.token)).rows, 'owner archive');
    assertFull((await archiveRows(worker.token)).rows, 'own agent archive');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

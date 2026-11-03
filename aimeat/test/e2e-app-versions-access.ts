/**
 * @file test/e2e-app-versions-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The version list of an app answers what the app's own read answers for that caller,
 *   and it carries no content (codebase analysis 2026-11-03, item A1).
 *     - Attack: an app the operator hid answers 404 at GET /v1/apps/:owner/:filename/versions to a
 *       caller who is neither its owner nor an operator, with the message GET /v1/apps/:owner/:filename
 *       gives; an app that opens for signed-in people answers 401 to a caller with no account; another
 *       owner's agent asking aimeat_app_manage action versions of the hidden app gets NOT_FOUND.
 *     - Usage kept: anybody reads the version list of a public app with the same fields as before
 *       (version_number, version, size, created_at, ai_provenance_id), newest first, and no content;
 *       the list of a parked (unlisted) app stays readable, as the app does; the owner, the owner's
 *       agent and the operator read the hidden app's list; a signed-in account reads the list of an
 *       app that opens for signed-in people.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-versions-access
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A1).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 300);
const stamp = Date.now().toString(36).slice(-5);
const OPEN = `ver-open-${stamp}.html`;
const HIDDEN = `ver-hidden-${stamp}.html`;
const SIGNED = `ver-signed-${stamp}.html`;
const PARKED = `ver-parked-${stamp}.html`;
const MARKER = `content-marker-${stamp}`;

let operator: RegisteredOwner;
let owner: RegisteredOwner;
let other: RegisteredOwner;
const versionsPath = (file: string) => `/v1/apps/${owner.name}/${file}/versions`;

async function publish(file: string, version: string): Promise<void> {
    const r = await json('/v1/apps', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ filename: file, content: Buffer.from(`<h1>${file} ${MARKER}</h1>`).toString('base64'), name: file, description: 'A page with versions.', category: 'utility', tags: [], version }),
    });
    assert(r.status === 201, `publish ${file}: ${r.status} ${short(r.body?.error)}`);
}

const patch = (file: string, body: Record<string, unknown>) => json(`/v1/apps/${file}`, { method: 'PATCH', token: owner.token, body: JSON.stringify(body) });

console.log('\n=== APP VERSIONS ACCESS E2E ===\n');

await test('fixture: an operator, an owner with four apps (public, hidden, signed-in, parked), and another account', async () => {
    operator = await registerOwner(BASE, `verop${stamp}`);
    assert(operator.roles.includes('operator'), `the first owner on the node is its operator: ${short(operator.roles)}`);
    owner = await registerOwner(BASE, `verown${stamp}`);
    other = await registerOwner(BASE, `veroth${stamp}`);
    await publish(OPEN, '1.0.0');
    await publish(OPEN, '1.1.0');
    for (const f of [HIDDEN, SIGNED, PARKED]) await publish(f, '1.0.0');
    const hide = await json(`/v1/admin/apps/${owner.name}/${HIDDEN}/moderate`, { method: 'POST', token: operator.token, body: JSON.stringify({ hidden: true, reason: 'versions suite' }) });
    assert(hide.status === 200 && hide.body.data?.operator_hidden === true, `hide: ${hide.status} ${short(hide.body)}`);
    const s = await patch(SIGNED, { open_to: 'signed-in' });
    assert(s.status === 200, `signed-in: ${s.status} ${short(s.body?.error)}`);
    const p = await patch(PARKED, { listing: 'unlisted' });
    assert(p.status === 200, `parked: ${p.status} ${short(p.body?.error)}`);
});

console.log('\nUsage kept');

await test('usage: anybody reads a public app\'s version list with the same fields as before, newest first, and no content', async () => {
    const r = await json(versionsPath(OPEN));
    assert(r.status === 200, `anonymous list: ${r.status} ${short(r.body)}`);
    const d = r.body.data;
    assert(d.owner === owner.name && d.filename === OPEN && d.total === 2, `envelope: ${short(d)}`);
    assert(d.versions.length === 2, `two versions: ${short(d.versions)}`);
    const [newest, oldest] = d.versions;
    assert(newest.version_number === 2 && oldest.version_number === 1, `newest first: ${short(d.versions)}`);
    assert(newest.version === '1.1.0' && oldest.version === '1.0.0', `manifest versions: ${short(d.versions)}`);
    for (const v of d.versions) {
        assert(JSON.stringify(Object.keys(v).sort()) === JSON.stringify(['ai_provenance_id', 'created_at', 'size', 'version', 'version_number']),
            `fields of a version: ${short(Object.keys(v))}`);
        assert(typeof v.size === 'number' && v.size > 0, `size: ${short(v)}`);
        assert(typeof v.created_at === 'string' && !Number.isNaN(Date.parse(v.created_at)), `created_at: ${short(v)}`);
    }
    assert(!JSON.stringify(r.body).includes(MARKER), 'the answer carries the app\'s content');
});

await test('usage: a parked (unlisted) app\'s version list stays readable, as the app itself does', async () => {
    const app = await json(`/v1/apps/${owner.name}/${PARKED}`);
    assert(app.status === 200, `the parked app is served: ${app.status}`);
    const r = await json(versionsPath(PARKED));
    assert(r.status === 200 && r.body.data?.total === 1, `parked list: ${r.status} ${short(r.body)}`);
});

await test('usage: the owner and the operator read the hidden app\'s version list', async () => {
    const own = await json(versionsPath(HIDDEN), { token: owner.token });
    assert(own.status === 200 && own.body.data?.total === 1, `owner: ${own.status} ${short(own.body)}`);
    const op = await json(versionsPath(HIDDEN), { token: operator.token });
    assert(op.status === 200 && op.body.data?.total === 1, `operator: ${op.status} ${short(op.body)}`);
});

await test('usage: the owner\'s agent reads the hidden app\'s versions over MCP (aimeat_app_manage action versions)', async () => {
    const agent = await makeAgent(BASE, owner, ['app:read']);
    const s = await openSession(BASE, agent.token, 'e2e-app-versions-access');
    const r = await callTool(s, 'aimeat_app_manage', { action: 'versions', filename: HIDDEN });
    assert(!r.isError && r.data?.total === 1 && r.data?.versions?.[0]?.version_number === 1, `agent: ${r.text.slice(0, 300)}`);
    const open = await callTool(s, 'aimeat_app_manage', { action: 'versions', filename: OPEN });
    assert(!open.isError && open.data?.total === 2, `agent, public app: ${open.text.slice(0, 300)}`);
    assert(!open.text.includes(MARKER), 'the tool answer carries the app\'s content');
});

await test('usage: a signed-in account reads the version list of an app that opens for signed-in people', async () => {
    const r = await json(versionsPath(SIGNED), { token: other.token });
    assert(r.status === 200 && r.body.data?.total === 1, `signed-in account: ${r.status} ${short(r.body)}`);
});

console.log('\nThe attack: a caller the app does not open for');

await test('no account: the hidden app\'s version list answers 404 with the app read\'s own message', async () => {
    const read = await json(`/v1/apps/${owner.name}/${HIDDEN}`);
    assert(read.status === 404, `the app read hides it: ${read.status}`);
    const r = await json(versionsPath(HIDDEN));
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `anonymous versions of the hidden app: ${r.status} ${short(r.body)}`);
    assert(r.body.error?.message === read.body.error?.message, `message: ${short(r.body.error?.message)} vs ${short(read.body.error?.message)}`);
});

await test('another account: the hidden app\'s version list answers 404', async () => {
    const r = await json(versionsPath(HIDDEN), { token: other.token });
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `other account: ${r.status} ${short(r.body)}`);
});

await test('another owner\'s agent: aimeat_app_manage action versions of the hidden app answers NOT_FOUND', async () => {
    const agent = await makeAgent(BASE, other, ['app:read']);
    const s = await openSession(BASE, agent.token, 'e2e-app-versions-access-other');
    const r = await callTool(s, 'aimeat_app_manage', { action: 'versions', filename: HIDDEN, owner: owner.name });
    assert(r.isError && /NOT_FOUND/.test(r.text), `other agent: ${r.text.slice(0, 300)}`);
});

await test('no account: the signed-in app\'s version list answers 401 SIGN_IN_REQUIRED, as the app does', async () => {
    const read = await json(`/v1/apps/${owner.name}/${SIGNED}`);
    assert(read.status === 401, `the app read asks for a sign-in: ${read.status}`);
    const r = await json(versionsPath(SIGNED));
    assert(r.status === 401 && r.body.error?.code === 'SIGN_IN_REQUIRED', `anonymous versions of the signed-in app: ${r.status} ${short(r.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

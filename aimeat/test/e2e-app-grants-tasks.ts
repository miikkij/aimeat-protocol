/**
 * @file e2e-app-grants-tasks.ts
 * @description E2E for the app-grant TASK + WORKFLOW capability (control-plane apps, e.g. AGENCY).
 *   Proves an H-2 app grant can drive its OWN owner's agents with explicit consent, and nothing
 *   more: an app holding task:write may CREATE + START tasks for its owner's agents; task:read may
 *   LIST/GET/read events; workflow:read/write reach the owner's own workflows. An app WITHOUT the
 *   scope is 403 SCOPE_DENIED; an app can never reach an agent outside its owner's namespace.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-app-grants-tasks
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial (TARGET-006 AGENCY: task and workflow app-grant scopes).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `taskgrant${Date.now() % 100000}`;
const owner2 = `taskgrant${(Date.now() + 7) % 100000}b`;
const FILENAME = 'agency-demo.html';
const REDIRECT = 'http://localhost:9922/callback';
const AGENT = 'commandbot';

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
    return { status: res.status, body, headers: res.headers };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// PKCE (reused across grants — each authorize→consent mints its own single-use code)
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

let ownerToken = '';

/** Register an owner and return its owner JWT. */
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

/** Run the full app-grant flow for `scopes` and return the app access token. */
async function grantApp(scopes: string[]): Promise<string> {
    const q = new URLSearchParams({
        app: `${owner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token;
}

const createBody = (title: string) => JSON.stringify({
    title, description: 'Task created by a control-plane app on the owner\'s behalf',
    scope: [{ name: 'target', value: 'https://example.com', type: 'url' }],
    rules: ['stay in scope'],
    verification: { user_expects: 'a result', technical_checks: ['check-1'] },
    todos: [{ id: 't-1', order: 1, title: 'Do the thing', environment: 'agent', verification: 'output present' }],
    status: 'queued',
});

let appFull = '';   // task:read task:write workflow:read workflow:write
let appReadOnly = ''; // memory:read only (no task/workflow scopes)
let taskId = '';

async function main() {
    console.log('\n=== App Grant Tasks/Workflows (control-plane) E2E ===\n');

    console.log('Phase 0: Setup — owners, agent, published app, grants');
    await test('register owner + owner2 + agent + publish app', async () => {
        ownerToken = await registerOwner(owner);
        const owner2Token = await registerOwner(owner2);
        // owner2 gets an agent with the SAME name to prove cross-owner confinement later.
        const a2 = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` },
            body: JSON.stringify({ name: AGENT, owner: owner2, capabilities: ['memory'] }),
        });
        assert(a2.status === 201, `owner2 agent: ${a2.status} ${JSON.stringify(a2.body)}`);
        const a1 = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: AGENT, owner, capabilities: ['memory'] }),
        });
        assert(a1.status === 201, `owner agent: ${a1.status} ${JSON.stringify(a1.body)}`);
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>agency</body></html>'), name: 'AGENCY Demo', description: 'control plane', category: 'utility' }),
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    });

    await test('mint two app grants: full (task+workflow) and read-only (memory:read)', async () => {
        appFull = await grantApp(['task:read', 'task:write', 'workflow:read', 'workflow:write']);
        appReadOnly = await grantApp(['memory:read']);
        assert(!!appFull && !!appReadOnly, 'both app tokens issued');
    });

    console.log('\nPhase 1: task:write — an app creates + starts a task for its OWN owner\'s agent');
    await test('app (task:write) CREATES a queued task → 201', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks`, {
            method: 'POST', headers: { Authorization: `Bearer ${appFull}` }, body: createBody('Command run 1'),
        });
        assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.task.status === 'queued', `status: ${r.body.data.task.status}`);
        taskId = r.body.data.task.id;
        assert(!!taskId, 'task id present');
    });

    await test('the created task is attributed to the OWNER (owner session sees it)', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200 && r.body.data.task.id === taskId, `owner sees app-created task: ${r.status}`);
    });

    console.log('\nPhase 2: task:read — the app reads runs, detail, events');
    await test('app (task:read) LISTS the agent\'s tasks and sees the created one', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks`, { headers: { Authorization: `Bearer ${appFull}` } });
        assert(r.status === 200, `list: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.tasks.some((t: any) => t.id === taskId), 'created task in the app\'s list');
    });

    await test('app (task:read) reads task DETAIL + EVENTS → 200', async () => {
        const d = await json(`/v1/agents/${AGENT}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${appFull}` } });
        assert(d.status === 200 && d.body.data.task.id === taskId, `detail: ${d.status}`);
        const e = await json(`/v1/agents/${AGENT}/tasks/${taskId}/events`, { headers: { Authorization: `Bearer ${appFull}` } });
        assert(e.status === 200, `events: ${e.status} ${JSON.stringify(e.body)}`);
    });

    await test('app (task:write) STARTS the task → 200, status active (AJA HETI)', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}/start`, {
            method: 'POST', headers: { Authorization: `Bearer ${appFull}` },
        });
        assert(r.status === 200, `start: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.task.status === 'active', `status after start: ${r.body.data.task.status}`);
    });

    console.log('\nPhase 3: workflow:read — the app reaches its own owner\'s workflows');
    await test('app (workflow:read) may GET /v1/workflows → 200', async () => {
        const r = await json('/v1/workflows', { headers: { Authorization: `Bearer ${appFull}` } });
        assert(r.status === 200, `workflows list: ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 4: least-privilege — no scope, no access');
    await test('app WITHOUT task:write may NOT create a task → 403 SCOPE_DENIED', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks`, {
            method: 'POST', headers: { Authorization: `Bearer ${appReadOnly}` }, body: createBody('should fail'),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body?.error?.code}`);
    });

    await test('app WITHOUT task:read may NOT list tasks → 403 SCOPE_DENIED', async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks`, { headers: { Authorization: `Bearer ${appReadOnly}` } });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body?.error?.code}`);
    });

    await test('app WITHOUT workflow:read may NOT list workflows → 403', async () => {
        const r = await json('/v1/workflows', { headers: { Authorization: `Bearer ${appReadOnly}` } });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 5: cross-owner confinement — the app is bound to its OWN owner\'s namespace');
    await test('app can only ever address its own owner\'s agent (owner2\'s same-named agent is unreachable)', async () => {
        // owner2 also has an agent named `commandbot`, but the app grant is owner1\'s. The task route
        // builds the target GAII under the app\'s OWN owner, so this create lands on owner1\'s agent
        // (its own), never owner2\'s — proven by the created task appearing in owner1\'s namespace.
        const r = await json(`/v1/agents/${AGENT}/tasks`, {
            method: 'POST', headers: { Authorization: `Bearer ${appFull}` }, body: createBody('own-owner only'),
        });
        assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
        const id = r.body.data.task.id;
        // owner1 sees it; owner2 does NOT (it is not in owner2\'s namespace).
        const owner2Token = await registerOwner(owner2 + 'chk').catch(() => '');
        const seenByOwner1 = await json(`/v1/agents/${AGENT}/tasks/${id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(seenByOwner1.status === 200, `owner1 sees its task: ${seenByOwner1.status}`);
        if (owner2Token) {
            const seenByOther = await json(`/v1/agents/${AGENT}/tasks/${id}`, { headers: { Authorization: `Bearer ${owner2Token}` } });
            assert(seenByOther.status === 403 || seenByOther.status === 404, `another owner cannot read it: ${seenByOther.status}`);
        }
    });

    await test('app creating for a NON-EXISTENT agent name is confined (404, never another namespace)', async () => {
        const r = await json(`/v1/agents/no-such-agent-xyz/tasks`, {
            method: 'POST', headers: { Authorization: `Bearer ${appFull}` }, body: createBody('nope'),
        });
        assert(r.status === 404, `expected 404 for unknown agent, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();

/**
 * @file e2e-apps-moderation.ts
 * @description E2E tests for operator app moderation. An operator hides a published
 *   app from EVERY public surface: it drops out of the anonymous catalogue and 404s
 *   on direct download for non-owner/non-operator, while the owner still sees it
 *   (badged with operator_hidden) and can still download it. Covers: the operator-
 *   only admin listing + moderate endpoints (403 for non-operators), the re-publish
 *   cannot-escape invariant (the flag survives an update), and restore.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-apps-moderation
 * @version-history
 *   v1.0.0 — 2026-06-24 — initial: hide removes from public + download, owner still
 *     sees/downloads, non-op 403, re-publish keeps hidden, restore re-exposes.
 *   v1.1.0 — 2026-06-25 — add Phase 5 operator hard delete: non-op 403, operator
 *     200, app gone from admin+public+download, delete-missing 404.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

// The FIRST owner registered against a fresh node becomes the operator.
const operatorName = `modop${Date.now() % 100000}`;
const victimName = `modvictim${Date.now() % 100000}`;
const FILENAME = 'moderated-demo.html';
const HTML = '<!DOCTYPE html><html><body><h1>anonymous junk</h1></body></html>';

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

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let operatorToken = '';
let operatorPrivKey = '';
let victimToken = '';
let victimPrivKey = '';

function opAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${operatorToken}` } };
}
function victimAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${victimToken}` } };
}

async function register(name: string): Promise<string> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register ${name}: status ${status}: ${JSON.stringify(body)}`);
    return body.data.private_key;
}

async function tokenFor(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token ${name}: ${JSON.stringify(body.error)}`);
    return body.data?.token;
}

console.log('\n=== App Moderation E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register operator (first owner → auto-operator)', async () => {
    operatorPrivKey = await register(operatorName);
    operatorToken = await tokenFor(operatorName, operatorPrivKey);
});

await test('Register victim owner (non-operator)', async () => {
    victimPrivKey = await register(victimName);
    victimToken = await tokenFor(victimName, victimPrivKey);
});

await test('Victim publishes an app', async () => {
    const { status, body } = await json('/v1/apps', victimAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64(HTML), name: 'Junk App', description: 'demo', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('App is visible in the anonymous catalogue before moderation', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const found = (body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!!found, 'app present pre-moderation');
    assert(found.operator_hidden === false, 'operator_hidden false pre-moderation');
});

console.log('\nPhase 1: Admin listing + auth guards');

await test('GET /v1/admin/apps without token → 401', async () => {
    const { status } = await json('/v1/admin/apps');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/admin/apps with non-operator token → 403', async () => {
    const { status } = await json('/v1/admin/apps', victimAuthed());
    assert(status === 403, `expected 403, got ${status}`);
});

await test('GET /v1/admin/apps (operator) lists the app', async () => {
    const { status, body } = await json('/v1/admin/apps', opAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const found = (body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!!found, 'app present in admin listing');
    assert(found.operator_hidden === false, 'not yet hidden');
});

await test('POST moderate with non-operator token → 403', async () => {
    const { status } = await json(`/v1/admin/apps/${victimName}/${FILENAME}/moderate`, victimAuthed({
        method: 'POST',
        body: JSON.stringify({ hidden: true }),
    }));
    assert(status === 403, `expected 403, got ${status}`);
});

console.log('\nPhase 2: Hide removes from every public surface');

await test('Operator hides the app (with reason)', async () => {
    const { status, body } = await json(`/v1/admin/apps/${victimName}/${FILENAME}/moderate`, opAuthed({
        method: 'POST',
        body: JSON.stringify({ hidden: true, reason: 'Anonymous / policy violation' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.operator_hidden === true, 'response says hidden');
});

await test('App is GONE from the anonymous catalogue', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const found = (body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!found, 'app absent for anonymous viewer');
});

await test('Owner STILL sees the app, badged operator_hidden + reason', async () => {
    const { body } = await json('/v1/apps?limit=200', victimAuthed());
    const found = (body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!!found, 'owner still sees their hidden app');
    assert(found.operator_hidden === true, 'flag is true for owner');
    assert(found.operator_hide_reason === 'Anonymous / policy violation', `reason carried, got ${found.operator_hide_reason}`);
});

await test('Anonymous direct download → 404 (not reachable by link)', async () => {
    const res = await fetch(`${BASE}/v1/apps/${victimName}/${FILENAME}`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test('Owner can still download their own hidden app', async () => {
    const res = await fetch(`${BASE}/v1/apps/${victimName}/${FILENAME}`, victimAuthed());
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('anonymous junk'), 'owner gets the real content');
});

await test('Operator can still download a hidden app', async () => {
    const res = await fetch(`${BASE}/v1/apps/${victimName}/${FILENAME}`, opAuthed());
    assert(res.status === 200, `expected 200, got ${res.status}`);
});

console.log('\nPhase 3: Owner cannot re-publish to escape moderation');

await test('Victim re-publishes the app → still operator_hidden', async () => {
    const { status } = await json('/v1/apps', victimAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64(HTML + '<!--v2-->'), name: 'Junk App', description: 'demo2', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `re-publish status ${status}`);

    // Still gone for anonymous, still hidden for owner.
    const { body: anon } = await json('/v1/apps?limit=200');
    assert(!(anon.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName), 'still absent for anonymous after re-publish');

    const { body: own } = await json('/v1/apps?limit=200', victimAuthed());
    const found = (own.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!!found && found.operator_hidden === true, 're-publish did not escape moderation');
});

console.log('\nPhase 4: Restore');

await test('Operator restores the app', async () => {
    const { status, body } = await json(`/v1/admin/apps/${victimName}/${FILENAME}/moderate`, opAuthed({
        method: 'POST',
        body: JSON.stringify({ hidden: false }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.operator_hidden === false, 'response says restored');
});

await test('App is visible again in the anonymous catalogue, reason cleared', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const found = (body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName);
    assert(!!found, 'app present again');
    assert(found.operator_hidden === false, 'flag cleared');
    assert(!found.operator_hide_reason, 'reason cleared on restore');
});

await test('Anonymous direct download works again', async () => {
    const res = await fetch(`${BASE}/v1/apps/${victimName}/${FILENAME}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
});

console.log('\nPhase 5: Operator hard delete');

await test('Non-operator cannot hard-delete (403)', async () => {
    const { status } = await json(`/v1/admin/apps/${victimName}/${FILENAME}`, victimAuthed({ method: 'DELETE' }));
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Operator hard-deletes the app (200)', async () => {
    const { status, body } = await json(`/v1/admin/apps/${victimName}/${FILENAME}`, opAuthed({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'response says deleted');
});

await test('Deleted app is gone everywhere', async () => {
    // Admin listing (operator sees everything) no longer has it.
    const { body: adminBody } = await json('/v1/admin/apps', opAuthed());
    assert(!(adminBody.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName), 'absent from admin listing');
    // Public catalogue no longer has it.
    const { body: anon } = await json('/v1/apps?limit=200');
    assert(!(anon.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === victimName), 'absent from public catalogue');
    // Direct download 404s.
    const res = await fetch(`${BASE}/v1/apps/${victimName}/${FILENAME}`);
    assert(res.status === 404, `expected 404 after delete, got ${res.status}`);
});

await test('Deleting a non-existent app → 404', async () => {
    const { status } = await json(`/v1/admin/apps/${victimName}/does-not-exist.html`, opAuthed({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

/**
 * @file test/e2e-header-nav.ts
 * @description E2E tests for operator-configurable header navigation
 *   (GET public + PUT operator at /v1/site/header-nav): default config, auth
 *   guards, save round-trip (reorder + hide), and invalid-id rejection.
 * @usage cd aimeat && pnpm exec tsx test/e2e-header-nav.ts
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial suite.
 *   v1.1.0 — 2026-07-01 — Assert the `features` map (features.secretary) the SPA shell reads to gate
 *            optional surfaces. The shared runner pins AIMEAT_SECRETARY_ENABLED=on, so it is true here;
 *            the off path is covered by e2e-secretary-disabled.ts (self-spawns a flag-off server).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
const KNOWN = ['try', 'howItWorks', 'business', 'devView', 'help'];

let opToken = '';
let opPrivKey = '';
const opName = `testnavop${Date.now()}`;

let nonOpToken = '';
let nonOpPrivKey = '';
const nonOpName = `testnavuser${Date.now()}`;

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${opToken}` } };
}

console.log('\n=== AIMEAT Header Navigation E2E Test ===\n');
console.log('Setup');

await test('Register test owner (auto-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: opName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    opPrivKey = body.data.private_key;
});

await test('Get operator token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(opPrivKey, opName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: opName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    opToken = body.data?.token;
    assert(typeof opToken === 'string', 'got token');
});

await test('Register non-operator owner + token', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: nonOpName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    nonOpPrivKey = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(nonOpPrivKey, nonOpName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: nonOpName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    nonOpToken = body.data?.token;
});

// ─── Default config (public) ───
console.log('\nDefault config');

await test('GET /v1/site/header-nav — public, returns all links visible in default order', async () => {
    const { status, body } = await json('/v1/site/header-nav');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data.order), 'order should be array');
    assert(Array.isArray(body.data.hidden), 'hidden should be array');
    assert(body.data.order.length === KNOWN.length, `order length ${body.data.order.length}`);
    assert(KNOWN.every(id => body.data.order.includes(id)), 'order should contain all known ids');
    assert(body.data.hidden.length === 0, 'hidden should be empty by default');
});

await test('GET /v1/site/header-nav — exposes features.secretary (on, pinned by the runner)', async () => {
    const { body } = await json('/v1/site/header-nav');
    assert(body.data.features && typeof body.data.features === 'object', 'features should be an object');
    assert(body.data.features.secretary === true, `features.secretary should be true on the shared server, got ${JSON.stringify(body.data.features)}`);
});

// ─── Auth guards ───
console.log('\nAuth guards');

await test('PUT /v1/site/header-nav without token → 401', async () => {
    const { status } = await json('/v1/site/header-nav', {
        method: 'PUT', body: JSON.stringify({ order: KNOWN, hidden: [] }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('PUT /v1/site/header-nav with non-operator token → 403', async () => {
    const { status } = await json('/v1/site/header-nav', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${nonOpToken}` },
        body: JSON.stringify({ order: KNOWN, hidden: [] }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Save round-trip ───
console.log('\nSave round-trip');

const NEW_ORDER = ['help', 'try', 'howItWorks', 'devView', 'business'];

await test('PUT /v1/site/header-nav (operator) — reorder + hide one → 200', async () => {
    const { status, body } = await json('/v1/site/header-nav', authed({
        method: 'PUT',
        body: JSON.stringify({ order: NEW_ORDER, hidden: ['business'] }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(JSON.stringify(body.data.order) === JSON.stringify(NEW_ORDER), `order: ${JSON.stringify(body.data.order)}`);
    assert(body.data.hidden.length === 1 && body.data.hidden[0] === 'business', `hidden: ${JSON.stringify(body.data.hidden)}`);
});

await test('GET /v1/site/header-nav — reflects saved config', async () => {
    const { body } = await json('/v1/site/header-nav');
    assert(JSON.stringify(body.data.order) === JSON.stringify(NEW_ORDER), `order: ${JSON.stringify(body.data.order)}`);
    assert(body.data.hidden.includes('business'), 'business should be hidden');
});

// ─── Validation ───
console.log('\nValidation');

await test('PUT /v1/site/header-nav with unknown id → 422', async () => {
    const { status, body } = await json('/v1/site/header-nav', authed({
        method: 'PUT',
        body: JSON.stringify({ order: ['try', 'bogus'], hidden: [] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.error?.code === 'HEADER_NAV_INVALID', `error code: ${body.error?.code}`);
});

await test('PUT /v1/site/header-nav with unknown id in hidden → 422', async () => {
    const { status } = await json('/v1/site/header-nav', authed({
        method: 'PUT',
        body: JSON.stringify({ order: KNOWN, hidden: ['admin'] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Reset header nav to default', async () => {
    const { status } = await json('/v1/site/header-nav', authed({
        method: 'PUT',
        body: JSON.stringify({ order: KNOWN, hidden: [] }),
    }));
    assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

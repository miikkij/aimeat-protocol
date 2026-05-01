// E2E test for AIMEAT Capability Layer
//
// Run: pnpm test:e2e (auto-discovered by test runner)

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
const ownerName = 'captest-' + Math.random().toString(36).slice(2, 8);
let ownerToken = '';
let ownerPrivKey = '';
let isOperator = false;
let capId = '';

console.log('\n=== AIMEAT Capability Layer E2E ===\n');

// ─── Phase 0: Setup ───
console.log('Phase 0 — Setup');

await test('Register owner', async () => {
    if (ADMIN_PW) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: ownerName }),
        });
        assert(status === 200, `admin register status ${status}: ${JSON.stringify(body)}`);
        assert(body.ok === true, 'ok');
        ownerPrivKey = body.private_key;
        isOperator = true;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        ownerPrivKey = body.data.private_key;
    }
});

await test('Owner auth', async () => {
    if (ADMIN_PW && isOperator) {
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.token;
    } else {
        const ts = new Date().toISOString();
        const message = ownerName + NODE_ID + ts;
        const sig = await signMsg(ownerPrivKey, message);
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: ownerName, timestamp: ts, signature: sig }),
        });
        assert(body.ok === true, 'auth ok');
        ownerToken = body.data.token;
    }
});

// ─── Phase 1: Manual Capability CRUD ───
console.log('\nPhase 1 — Manual Capability CRUD');

await test('POST /v1/capabilities — create manual capability', async () => {
    capId = 'test-cap-' + Math.random().toString(36).slice(2, 8);
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({
            id: capId,
            name: 'Test Capability',
            summary: 'A capability for E2E testing',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' },
            callable: true,
            authRequired: 'registered',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
            outputSchema: { type: 'object', properties: { r: { type: 'string' } } },
            usage: `await AIMEAT.capabilities.invoke('${capId}', { q: 'hello' })`,
            whenToUse: 'For testing',
            whenNotToUse: 'In production',
            examples: [{ description: 'Basic', input: { q: 'hello' }, output: { r: 'world' } }],
            visibility: 'public',
            status: 'active',
            tags: ['test', 'e2e'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.id === capId, 'id matches');
});

await test('GET /v1/capabilities/:id — retrieve', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`);
    assert(status === 200, `status ${status}`);
    assert(body.data.name === 'Test Capability', 'name matches');
    assert(body.data.source.type === 'manual', 'source type');
    assert(body.data.callable === true, 'callable');
    assert(body.data.inputSchema.required[0] === 'q', 'inputSchema preserved');
});

await test('PUT /v1/capabilities/:id — update', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ summary: 'Updated summary', tags: ['updated'] }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.summary === 'Updated summary', 'summary updated');
    assert(body.data.tags[0] === 'updated', 'tags updated');
});

await test('GET /v1/capabilities — list', async () => {
    const { body } = await json('/v1/capabilities');
    assert(body.ok === true, 'ok');
    assert(body.data.capabilities.length >= 1, 'at least one capability');
});

await test('GET /v1/capabilities?search=Updated — search', async () => {
    const { body } = await json('/v1/capabilities?search=Updated');
    assert(body.data.capabilities.some((c: any) => c.id === capId), 'found by search');
});

await test('GET /v1/capabilities?callable=true — filter', async () => {
    const { body } = await json('/v1/capabilities?callable=true');
    assert(body.data.capabilities.every((c: any) => c.callable === true), 'all callable');
});

// ─── Phase 2: Visibility and Auth ───
console.log('\nPhase 2 — Visibility and Auth');

let privateCap = '';

await test('Create private capability', async () => {
    privateCap = 'priv-cap-' + Math.random().toString(36).slice(2, 8);
    const { status } = await json('/v1/capabilities', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({
            id: privateCap, name: 'Private Cap', summary: 'Private',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' },
            callable: false, visibility: 'private', status: 'active',
        }),
    });
    assert(status === 201, `status ${status}`);
});

await test('Anonymous cannot see private capability', async () => {
    const { status } = await json(`/v1/capabilities/${privateCap}`);
    assert(status === 404, 'private cap returns 404 for anon');
});

await test('Owner can see private capability', async () => {
    const { status, body } = await json(`/v1/capabilities/${privateCap}`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.id === privateCap, 'id matches');
});

// ─── Phase 3: Invoke (non-callable returns usage) ───
console.log('\nPhase 3 — Invoke');

await test('Invoke non-callable returns NOT_CALLABLE with usage', async () => {
    const { status, body } = await json(`/v1/capabilities/${privateCap}/invoke`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ input: {} }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.error.code === 'NOT_CALLABLE', `code: ${body.error.code}`);
});

// ─── Phase 4: Stats ───
console.log('\nPhase 4 — Stats & Telemetry');

await test('POST /v1/capabilities/:id/telemetry — record stats', async () => {
    const res = await fetch(`${BASE}/v1/capabilities/${capId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ duration_ms: 50, status: 'success' }),
    });
    assert(res.status === 204, `status ${res.status}`);
});

await test('Stats updated after telemetry', async () => {
    const { body } = await json(`/v1/capabilities/${capId}`);
    assert(body.data.stats.totalInvocations >= 1, `invocations: ${body.data.stats.totalInvocations}`);
    assert(body.data.stats.successCount >= 1, `success: ${body.data.stats.successCount}`);
});

// ─── Phase 5: Admin ───
if (isOperator) {
    console.log('\nPhase 5 — Admin Endpoints');

    await test('GET /v1/admin/capabilities — list all', async () => {
        const { status, body } = await json('/v1/admin/capabilities', {
            headers: { 'Authorization': `Bearer ${ownerToken}` },
        });
        assert(status === 200, `status ${status}`);
        assert(body.data.capabilities.length >= 2, 'sees all including private');
    });

    await test('PUT /v1/admin/capabilities/:id/override — disable', async () => {
        const { status, body } = await json(`/v1/admin/capabilities/${capId}/override`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ disabled: true, notes: 'E2E test disable' }),
        });
        assert(status === 200, `status ${status}`);
        assert(body.data.operatorOverride.disabled === true, 'disabled');
    });

    await test('PUT /v1/admin/capabilities/:id/override — re-enable', async () => {
        const { status } = await json(`/v1/admin/capabilities/${capId}/override`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ disabled: false, notes: null }),
        });
        assert(status === 200, `status ${status}`);
    });
}

// ─── Phase 6: Delete ───
console.log('\nPhase 6 — Delete');

await test('DELETE /v1/capabilities/:id — delete manual', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.deleted === true, 'deleted');
});

await test('GET /v1/capabilities/:id — verify 404 after delete', async () => {
    const { status } = await json(`/v1/capabilities/${capId}`);
    assert(status === 404, 'deleted cap returns 404');
});

await test('Cleanup private cap', async () => {
    await json(`/v1/capabilities/${privateCap}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Delete test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

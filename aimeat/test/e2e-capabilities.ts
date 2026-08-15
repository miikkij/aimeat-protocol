/**
 * @file test/e2e-capabilities.ts
 * @description E2E for the capability layer over the HTTP door: manual CRUD, visibility, invoke,
 *   stats, the cortex and extension aggregators, vouch, cross-owner list isolation, and the webhook
 *   policy gate.
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capabilities
 * @version-history
 *   v1.1.0 — 2026-08-14 — Phase 11: the webhook policy gate. A body carrying a webhookUrl and no
 *     `source` at all used to skip both WEBHOOKS_DISABLED and the domain allowlist, and was then
 *     stored as the manual webhook capability the gate would have refused (August 2026 audit,
 *     NEW-1). The allowlist half runs against a node this suite spawns itself, because
 *     capabilityWebhooks is read at boot and the shared test server boots with it 'disabled'.
 *   v1.0.0 — 2026-08-14 — Header added; file pre-dates the header standard.
 */

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

// `base` is the node being driven. Everything runs against the shared test server except Phase 11,
// which spawns a second node because the webhook policy is read at boot and cannot be changed after.
async function json(path: string, opts: RequestInit = {}, base = BASE) {
    const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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

await test('POST /v1/capabilities — a PARTIAL source is normalised, not crashed into a 500', async () => {
    // {type:'manual'} with no ref used to build a record with ref undefined and hit the
    // sourceRef NOT NULL constraint on both backends → 500 INTERNAL_ERROR.
    const id = 'partial-src-' + Math.random().toString(36).slice(2, 8);
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ id, name: 'Partial source', summary: 'no ref supplied', visibility: 'private', source: { type: 'manual' } }),
    });
    assert(status === 201, `partial manual source should be accepted, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.source.ref === 'manual', `ref should default to 'manual', got ${JSON.stringify(body.data.source)}`);
    assert(body.data.source.version === '1.0.0', `version should default, got ${JSON.stringify(body.data.source)}`);
    // ...and it is really stored, not just echoed.
    const back = await json(`/v1/capabilities/${id}`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
    assert(back.status === 200 && back.body.data.source.ref === 'manual', `stored source: ${back.status} ${JSON.stringify(back.body.data?.source)}`);
});

await test('POST /v1/capabilities — a bad source is a 400, not a 500', async () => {
    const cases: [Record<string, unknown>, string][] = [
        [{ type: 'nonsense' }, 'source.type must be one of'],
        [{ type: 'cortex' }, "source.ref is required for source.type 'cortex'"],
    ];
    for (const [source, fragment] of cases) {
        const { status, body } = await json('/v1/capabilities', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'Bad source', summary: 'x', visibility: 'private', source }),
        });
        assert(status === 400, `source ${JSON.stringify(source)} should be 400, got ${status}: ${JSON.stringify(body.error ?? body)}`);
        assert(body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${body.error?.code}`);
        assert((body.error?.message ?? '').includes(fragment), `expected message to mention "${fragment}", got ${body.error?.message}`);
    }
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

// A12 (E2E test-quality audit). The two tests above ping as the capability's OWNER, so the suite
// proves the counter moves and never asks who may move it. Client-side telemetry is self-reported by
// design and a third-party caller is the normal case — but three things were the caller's to decide
// and must not be: that the capability exists at all, how long the call took, and the `lastError`
// TEXT, which is rendered on somebody else's public capability record. Against the pre-fix source
// this test fails on the first assertion with 204 for a capability id that was never created.
await test('A stranger cannot write telemetry for a capability that does not exist, or its error text', async () => {
    const strangerName = 'capstranger-' + Math.random().toString(36).slice(2, 8);
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `stranger register expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, strangerName + NODE_ID + ts);
    const tk = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: strangerName, timestamp: ts, signature: sig }),
    });
    assert(tk.body.ok === true, `stranger auth: ${JSON.stringify(tk.body.error)}`);
    const strangerToken = tk.body.data.token;

    // A capability id nobody created: this wrote stats for a row with no owner.
    const ghost = await json(`/v1/capabilities/no-such-cap-${Math.random().toString(36).slice(2, 8)}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${strangerToken}` },
        body: JSON.stringify({ duration_ms: 10, status: 'success' }),
    });
    assert(ghost.status === 404, `telemetry for a nonexistent capability expected 404, got ${ghost.status}`);

    // A real capability owned by somebody else: the failure still COUNTS (self-reported by design),
    // but the stranger's free text must not become the owner's published lastError.
    const before = await json(`/v1/capabilities/${capId}`);
    const avgBefore = before.body.data.stats.avgResponseMs;
    const poison = await json(`/v1/capabilities/${capId}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${strangerToken}` },
        body: JSON.stringify({ duration_ms: 999_999_999, status: 'error', error: 'CONTACT attacker.example TO RESTORE SERVICE' }),
    });
    assert(poison.status === 204, `a third party may still report a failure, got ${poison.status}`);

    const after = await json(`/v1/capabilities/${capId}`);
    assert(!String(after.body.data.stats.lastError ?? '').includes('attacker.example'),
        `a stranger's text was published on the owner's capability: ${after.body.data.stats.lastError}`);
    assert(after.body.data.stats.errorCount >= 1, 'the reported failure is still counted');
    assert(after.body.data.stats.avgResponseMs < 3_600_001,
        `an unbounded duration moved the published average to ${after.body.data.stats.avgResponseMs} (was ${avgBefore})`);

    // The owner's own error text still lands — the gate must not blind the owner to their own reports.
    const own = await json(`/v1/capabilities/${capId}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ duration_ms: 12, status: 'error', error: 'upstream timeout at 12ms' }),
    });
    assert(own.status === 204, `the owner's own telemetry expected 204, got ${own.status}`);
    const mine = await json(`/v1/capabilities/${capId}`);
    assert(String(mine.body.data.stats.lastError ?? '').includes('upstream timeout'),
        `the owner's own error text must be kept, got ${mine.body.data.stats.lastError}`);

    await json(`/v1/owners/${strangerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${strangerToken}` } });
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

// ─── Phase 6: Cortex Install + Aggregator ───
console.log('\nPhase 6 — Cortex & Aggregator');

const testCortexName = 'e2e-test-cortex-' + Math.random().toString(36).slice(2, 8);
const testCortexManifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${testCortexName}
  namespace: ${ownerName}
  description: "E2E test cortex for capability aggregation"
  author: ${ownerName}
  tags: [e2e, test]
  visibility: public
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: ${testCortexName}.js
      filename: ${testCortexName}.js
      exports: [doStuff, getInfo]
      api_surface: |
        AIMEAT.e2eTest.doStuff({ input: string }) — Process input. Returns { result: string, timestamp: string }
        AIMEAT.e2eTest.getInfo() — Get info. Returns { version: string, name: string }
    - type: prompt
      name: e2e-assistant
      content: |
        You are using the ${testCortexName} cortex.
        API: AIMEAT.e2eTest.doStuff({ input }) and AIMEAT.e2eTest.getInfo()
`;

const testCortexLib = `(function(AIMEAT) {
  if (!AIMEAT.e2eTest) AIMEAT.e2eTest = {};
  AIMEAT.e2eTest.doStuff = async function(params) {
    return { result: 'processed: ' + (params.input || ''), timestamp: new Date().toISOString() };
  };
  AIMEAT.e2eTest.getInfo = async function() {
    return { version: '1.0.0', name: '${testCortexName}' };
  };
})(window.AIMEAT || (window.AIMEAT = {}));`;

await test('Install cortex', async () => {
    const libs: Record<string, string> = {};
    libs[`${testCortexName}.js`] = testCortexLib;
    const { status, body } = await json('/v1/cortex', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: testCortexManifest, libs }),
    });
    assert(status === 201 || status === 200, `install status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.ok === true, `install ok: ${JSON.stringify(body.error)}`);
});

await test('Activate cortex', async () => {
    const { status, body } = await json(`/v1/cortex/${testCortexName}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `activate status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
});

await test('Lib without exports/api_surface warns on install (discovery contract)', async () => {
    const bareName = 'e2e-bare-cortex-' + Math.random().toString(36).slice(2, 8);
    const bareManifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${bareName}
  namespace: ${ownerName}
  description: "Bare lib with no discovery fields"
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: bare
      filename: bare.js
`;
    const { status, body } = await json('/v1/cortex', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: bareManifest, libs: { 'bare.js': '(function(){})();' } }),
    });
    assert(status === 201, `install status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    const warnings: string[] = body.data.warnings ?? [];
    assert(warnings.some(w => w.includes('no exports')), `should warn about exports: ${JSON.stringify(warnings)}`);
    assert(warnings.some(w => w.includes('no api_surface')), `should warn about api_surface: ${JSON.stringify(warnings)}`);
    await json(`/v1/cortex/${encodeURIComponent(bareName)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
});

// Trigger aggregator manually by importing and running it
await test('Trigger aggregator via admin endpoint', async () => {
    const { status, body } = await json('/v1/admin/capabilities/aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `aggregate status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.data.created >= 0, 'created count');
});

await test('Cortex capability now exists', async () => {
    const { body } = await json(`/v1/capabilities?search=${testCortexName}`);
    assert(body.data?.total > 0, `aggregator did not create capability for ${testCortexName}`);
});

await test('Cortex capability has correct metadata', async () => {
    const { status, body } = await json(`/v1/capabilities/cortex:${testCortexName}`);
    assert(status === 200, `status ${status}`);
    const cap = body.data;
    assert(cap.source.type === 'cortex', `source type: ${cap.source.type}`);
    assert(cap.callable === true, 'cortex should be callable');
    assert(cap.status === 'active', `status: ${cap.status}`);
    assert(cap.usage.includes('loadScript'), `usage should contain loadScript: ${cap.usage}`);
    // Verify exports were populated from cortex manifest
    if (cap.exports) {
        assert(Array.isArray(cap.exports), 'exports should be array');
        const exportNames = cap.exports.map((e: any) => e.name);
        assert(exportNames.includes('doStuff'), `exports should include doStuff, got: ${exportNames}`);
        assert(exportNames.includes('getInfo'), `exports should include getInfo, got: ${exportNames}`);
    }
    // Verify API surface is in usage
    if (cap.usage.includes('API:')) {
        assert(cap.usage.includes('doStuff'), 'usage API should mention doStuff');
    }
});

await test('Cortex capability visible in list', async () => {
    const { body } = await json('/v1/capabilities?source_type=cortex');
    const found = body.data.capabilities.some((c: any) => c.id === `cortex:${testCortexName}`);
    assert(found, 'cortex capability should appear in filtered list');
});

await test('Manifest update refreshes the aggregated capability', async () => {
    // Enrich the manifest: version bump + new export + new api_surface line.
    const updatedManifest = testCortexManifest
        .replace('version: "1.0.0"', 'version: "1.1.0"')
        .replace('exports: [doStuff, getInfo]', 'exports: [doStuff, getInfo, resetAll]')
        .replace('AIMEAT.e2eTest.getInfo() — Get info. Returns { version: string, name: string }',
            'AIMEAT.e2eTest.getInfo() — Get info. Returns { version: string, name: string }\n        AIMEAT.e2eTest.resetAll() — Reset all state. Returns { ok: boolean }');
    const libs: Record<string, string> = {};
    libs[`${testCortexName}.js`] = testCortexLib + '\n// v1.1.0';
    const put = await json(`/v1/cortex/${testCortexName}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: updatedManifest, libs }),
    });
    assert(put.status === 200, `PUT status ${put.status}: ${JSON.stringify(put.body).slice(0, 200)}`);

    const agg = await json('/v1/admin/capabilities/aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(agg.status === 200, `aggregate status ${agg.status}`);
    assert(agg.body.data.updated >= 1, `should update >=1 capability, got: ${JSON.stringify(agg.body.data)}`);

    const { status, body } = await json(`/v1/capabilities/cortex:${testCortexName}`);
    assert(status === 200, `capability status ${status}`);
    const cap = body.data;
    assert(cap.source.version === '1.1.0', `source version should refresh, got: ${cap.source.version}`);
    assert(cap.usage.includes('resetAll'), `usage should carry the new api_surface line: ${cap.usage.slice(0, 200)}`);
    const exportNames = (cap.exports ?? []).map((e: any) => e.name);
    assert(exportNames.includes('resetAll'), `exports should include resetAll, got: ${exportNames}`);
});

await test('Cortex invoke from API returns BROWSER_ONLY', async () => {
    const { status, body } = await json(`/v1/capabilities/cortex:${testCortexName}/invoke`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ input: { test: true } }),
    });
    // Cortex capabilities should not be invokable via API
    assert(status === 400, `status ${status}`);
    assert(body.error.message.includes('browser') || body.error.code === 'NOT_CALLABLE',
        `should mention browser-only: ${body.error.message}`);
});

// Cleanup cortex
await test('Deactivate and delete cortex', async () => {
    await json(`/v1/cortex/${testCortexName}/deactivate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    const { status } = await json(`/v1/cortex/${testCortexName}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete cortex status ${status}`);
});

// ─── Phase 7: Extension Install + Invoke via Capability ───
console.log('\nPhase 7 — Extension Install + Invoke via Capability');

const testExtName = 'e2e-cap-ext-' + Math.random().toString(36).slice(2, 8);
const testExtManifest = `metadata:
  name: ${testExtName}
  version: 1.0.0
  description: "E2E test extension for capability invoke"
  author: ${ownerName}

required_apis:
  - memory

actions:
  - id: echo
    method: POST
    path: /echo
    script: actions/echo.js
    description: "Echo input back with timestamp"
    auth: authenticated
    input:
      message:
        type: string
        required: true
        description: "Message to echo"
    output:
      type: object
      properties:
        echoed: { type: string, description: "The echoed message" }
        timestamp: { type: string, description: "ISO timestamp" }
        success: { type: boolean }

limits:
  memory_mb: 32
  timeout_ms: 3000
  max_api_calls: 5
`;

const testExtScript = `export default async function(ctx, input) {
  ctx.log('echo called with: ' + (input.message || ''));
  return {
    echoed: 'Echo: ' + (input.message || '(empty)'),
    timestamp: new Date().toISOString(),
    success: true,
  };
}`;

await test('Install server extension with script', async () => {
    const { status, body } = await json('/v1/extensions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({
            manifest: testExtManifest,
            scripts: { 'actions/echo.js': testExtScript },
        }),
    });
    assert(status === 201 || status === 200, `install status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.ok === true, `install ok: ${JSON.stringify(body.error)}`);
});

await test('Activate server extension', async () => {
    const { status, body } = await json(`/v1/extensions/${testExtName}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `activate status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
});

await test('Execute extension action directly', async () => {
    const { status, body } = await json(`/v1/ext/${testExtName}/echo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ message: 'hello from e2e' }),
    });
    assert(status === 200, `execute status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.ok === true, `execute ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.echoed === 'Echo: hello from e2e', `echoed: ${body.data?.echoed}`);
    assert(body.data?.success === true, 'success flag');
});

await test('Trigger aggregator picks up extension', async () => {
    const { status, body } = await json('/v1/admin/capabilities/aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `aggregate status ${status}`);
});

await test('Extension capability exists and is callable', async () => {
    const capId = `ext:${testExtName}:echo`;
    const { status, body } = await json(`/v1/capabilities/${capId}`);
    assert(status === 200, `cap status ${status}`);
    assert(body.data.callable === true, 'should be callable');
    assert(body.data.source.type === 'extension', 'source type');
    assert(body.data.inputSchema?.message?.type === 'string', `inputSchema: ${JSON.stringify(body.data.inputSchema)}`);
});

await test('Invoke extension via capability proxy', async () => {
    const capId = `ext:${testExtName}:echo`;
    const { status, body } = await json(`/v1/capabilities/${capId}/invoke`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ input: { message: 'via capability' } }),
    });
    assert(status === 200, `invoke status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    assert(body.data?.result?.echoed === 'Echo: via capability', `result: ${JSON.stringify(body.data?.result)}`);
});

await test('Invoke stats recorded', async () => {
    const capId = `ext:${testExtName}:echo`;
    const { body } = await json(`/v1/capabilities/${capId}`);
    assert(body.data.stats.totalInvocations >= 1, `invocations: ${body.data.stats.totalInvocations}`);
    assert(body.data.stats.successCount >= 1, `success: ${body.data.stats.successCount}`);
});

await test('Cleanup test extension', async () => {
    await json(`/v1/extensions/${testExtName}/deactivate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    const { status } = await json(`/v1/extensions/${testExtName}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete status ${status}`);
});

// ─── Phase 8: Vouch ───
console.log('\nPhase 8 — Vouch');

await test('Cannot vouch own capability', async () => {
    // Create a temp capability to vouch test
    const vouchCapId = 'vouch-test-' + Math.random().toString(36).slice(2, 8);
    await json('/v1/capabilities', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({
            id: vouchCapId, name: 'Vouch Test', summary: 'Test',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' },
            callable: false, visibility: 'public', status: 'active',
        }),
    });
    const { status, body } = await json(`/v1/capabilities/${vouchCapId}/vouch`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 400, `vouch own: status ${status}`);
    assert(body.error.code === 'CANNOT_VOUCH_OWN', `code: ${body.error.code}`);
    // Cleanup
    await json(`/v1/capabilities/${vouchCapId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
});

// ─── Phase 9: Delete ───
console.log('\nPhase 9 — Delete');

await test('DELETE manual capability', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.deleted === true, 'deleted');
});

await test('Verify 404 after delete', async () => {
    const { status } = await json(`/v1/capabilities/${capId}`);
    assert(status === 404, 'deleted cap returns 404');
});

await test('Cleanup private cap', async () => {
    await json(`/v1/capabilities/${privateCap}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
});

// ─── Phase 10: Cross-owner PRIVATE list isolation (B5 regression) ───
// A registered non-operator must NEVER see ANOTHER owner's PRIVATE capability via the discovery list.
// Before the fix, GET /v1/capabilities forced visibility=public ONLY for anonymous callers, so every
// logged-in user saw all owners' private rows (ownerGhii + webhookUrl). Here the operator owns a
// private + a public cap; a freshly-registered non-operator (B) must be blind to the private one but
// still see the public one (guards against over-restricting the public directory).
console.log('\nPhase 10 — Cross-owner PRIVATE list isolation (B5)');

const opPrivCap = 'op-priv-' + Math.random().toString(36).slice(2, 8);
const opPubCap = 'op-pub-' + Math.random().toString(36).slice(2, 8);
const nonOp = 'capb-' + Math.random().toString(36).slice(2, 8);
let nonOpToken = '';

await test('Operator creates a PRIVATE + a PUBLIC capability', async () => {
    for (const [id, visibility] of [[opPrivCap, 'private'], [opPubCap, 'public']] as const) {
        const { status, body } = await json('/v1/capabilities', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({
                id, name: `${visibility} cap`, summary: `operator ${visibility} capability`,
                source: { type: 'manual', ref: 'manual', version: '1.0.0' },
                callable: true, authRequired: 'registered', visibility, status: 'active',
            }),
        });
        assert(status === 201, `create ${visibility}: ${status} ${JSON.stringify(body)}`);
    }
});

await test('Register a non-operator owner (B)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: nonOp, public_key: 'placeholder' }),
    });
    assert(status === 201, `register ${nonOp}: ${status} ${JSON.stringify(body)}`);
    const priv = body.data.private_key;
    const ts = new Date().toISOString();
    const sig = await signMsg(priv, nonOp + NODE_ID + ts);
    const { body: tb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: nonOp, timestamp: ts, signature: sig }),
    });
    assert(tb.ok === true, `auth ${nonOp}: ${JSON.stringify(tb.error)}`);
    assert(!(tb.data.roles ?? []).includes('operator'), 'B must NOT be an operator');
    nonOpToken = tb.data.token;
});

await test('Non-operator B does NOT see the operator PRIVATE capability (LEAK closed)', async () => {
    const { status, body } = await json('/v1/capabilities?per_page=200', {
        headers: { 'Authorization': `Bearer ${nonOpToken}` },
    });
    assert(status === 200, `list status ${status}`);
    const ids = (body.data?.capabilities ?? []).map((c: any) => c.id);
    assert(!ids.includes(opPrivCap), 'B must NOT see another owner private cap (LEAK!)');
});

await test('Non-operator B DOES still see the operator PUBLIC capability', async () => {
    const { status, body } = await json('/v1/capabilities?per_page=200', {
        headers: { 'Authorization': `Bearer ${nonOpToken}` },
    });
    assert(status === 200, `list status ${status}`);
    const ids = (body.data?.capabilities ?? []).map((c: any) => c.id);
    assert(ids.includes(opPubCap), 'B must still see public caps (not over-restricted)');
});

await test('Cleanup B + operator caps', async () => {
    await json(`/v1/owners/${nonOp}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${nonOpToken}` } });
    for (const id of [opPrivCap, opPubCap]) {
        await json(`/v1/capabilities/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${ownerToken}` } });
    }
});

// ─── Phase 11: the webhook gate reads the NORMALISED source (August 2026 audit, NEW-1) ───
// POST /v1/capabilities checked the webhook policy against the source the CALLER SENT, while the
// record was built from a source that defaults a missing type to 'manual'. So a body carrying a
// webhookUrl and no `source` at all walked past WEBHOOKS_DISABLED and the domain allowlist and was
// then stored as exactly the manual webhook capability the gate would have refused: one omitted
// field and the operator's setting meant nothing. Invariant 13 in security-development-dna.md.
// Both shapes must be answered identically, and a refusal must leave nothing behind.
console.log('\nPhase 11 — Webhook gate reads the normalised source');

const WEBHOOK_SHAPES: [string, Record<string, unknown> | undefined][] = [
    ['source sent', { type: 'manual', ref: 'manual', version: '1.0.0' }],
    ['source omitted', undefined],
];

function webhookBody(id: string, source: Record<string, unknown> | undefined, url: string) {
    return JSON.stringify({
        id, name: 'Hook cap', summary: 'carries a webhook', visibility: 'private',
        webhookUrl: url, ...(source ? { source } : {}),
    });
}

await test('Webhooks disabled: refused with AND without `source`, and nothing is stored', async () => {
    const { body: list } = await json('/v1/capabilities');
    assert(list.data?.policy?.webhooks === 'disabled',
        `this node must boot with capabilityWebhooks=disabled, got '${list.data?.policy?.webhooks}'`);
    for (const [label, source] of WEBHOOK_SHAPES) {
        const id = 'hook-off-' + Math.random().toString(36).slice(2, 8);
        const { status, body } = await json('/v1/capabilities', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ownerToken}` },
            body: webhookBody(id, source, 'https://elsewhere.test/hook'),
        });
        assert(status === 403 && body.error?.code === 'WEBHOOKS_DISABLED',
            `${label}: expected 403 WEBHOOKS_DISABLED, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
        const back = await json(`/v1/capabilities/${id}`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
        assert(back.status === 404, `${label}: a refused capability must not be stored, got ${back.status}`);
    }
});

// The allowlist branch is a boot-time setting, so it needs a node of its own. The port is derived
// from this suite's own so two suites running side by side cannot land on the same one.
const ALT_PORT = String(Number(new URL(BASE).port || '80') + 500);
const ALT_BASE = `http://localhost:${ALT_PORT}`;
const ALT_DB = resolve(process.cwd(), `test/.caps-allowlist-${ALT_PORT}.db`);
let altNode: ChildProcess | null = null;
let altToken = '';

function cleanupAltDb() {
    for (const f of [ALT_DB, ALT_DB + '-wal', ALT_DB + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* a leftover file is not worth failing over */ }
    }
}

async function startAllowlistNode(): Promise<ChildProcess> {
    cleanupAltDb();
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', ALT_DB], {
        env: {
            ...process.env,
            AIMEAT_PORT: ALT_PORT,
            AIMEAT_BASE_URL: ALT_BASE,
            // The whole point of this node: webhooks admitted only from one named domain.
            AIMEAT_CAPABILITY_WEBHOOKS: 'allowlist_only',
            AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST: 'hooks.example.test',
            AIMEAT_CAPABILITY_PUBLISHING: 'self_only',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
    });
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    const started = Date.now();
    while (Date.now() - started < 60_000) {
        try { if ((await fetch(`${ALT_BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`allowlist node did not start on port ${ALT_PORT}`);
}

await test('Start a node with capabilityWebhooks=allowlist_only', async () => {
    altNode = await startAllowlistNode();
    const altOwner = 'capalw-' + Math.random().toString(36).slice(2, 8);
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: altOwner }),
    }, ALT_BASE);
    assert(reg.body.ok === true, `register on alt node: ${JSON.stringify(reg.body)}`);
    const tok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ owner: altOwner, private_key: reg.body.private_key }),
    }, ALT_BASE);
    assert(tok.body.ok === true, `token on alt node: ${JSON.stringify(tok.body.error)}`);
    altToken = tok.body.token;
    const { body } = await json('/v1/capabilities', {}, ALT_BASE);
    assert(body.data?.policy?.webhooks === 'allowlist_only', `alt node policy: ${body.data?.policy?.webhooks}`);
});

await test('Allowlist only: an off-list domain is refused with AND without `source`', async () => {
    for (const [label, source] of WEBHOOK_SHAPES) {
        const id = 'hook-offlist-' + Math.random().toString(36).slice(2, 8);
        const { status, body } = await json('/v1/capabilities', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${altToken}` },
            body: webhookBody(id, source, 'https://elsewhere.test/hook'),
        }, ALT_BASE);
        assert(status === 403 && body.error?.code === 'WEBHOOK_DOMAIN_NOT_ALLOWED',
            `${label}: expected 403 WEBHOOK_DOMAIN_NOT_ALLOWED, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
        const back = await json(`/v1/capabilities/${id}`, { headers: { 'Authorization': `Bearer ${altToken}` } }, ALT_BASE);
        assert(back.status === 404, `${label}: a refused capability must not be stored, got ${back.status}`);
    }
});

await test('Allowlist only: a listed domain still goes through with `source` omitted', async () => {
    // The gate reading the normalised source must not turn into a blanket refusal: what the
    // operator allowed still passes, and the record is the manual capability it was read as.
    const id = 'hook-onlist-' + Math.random().toString(36).slice(2, 8);
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${altToken}` },
        body: webhookBody(id, undefined, 'https://hooks.example.test/x'),
    }, ALT_BASE);
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.source.type === 'manual' && body.data.source.ref === 'manual',
        `record should carry the normalised manual source: ${JSON.stringify(body.data.source)}`);
    assert(body.data.webhookUrl === 'https://hooks.example.test/x', `webhook stored: ${body.data.webhookUrl}`);
});

await test('Stop the allowlist node', async () => {
    if (!altNode) return;
    const ended = new Promise<void>(r => altNode!.once('exit', () => r()));
    altNode.kill('SIGTERM');
    await Promise.race([ended, new Promise(r => setTimeout(r, 5000))]);
    if (!altNode.killed) altNode.kill('SIGKILL');
    cleanupAltDb();
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


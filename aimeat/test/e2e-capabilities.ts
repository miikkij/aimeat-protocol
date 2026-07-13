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


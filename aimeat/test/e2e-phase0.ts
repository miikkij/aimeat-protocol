// E2E tests for Phase 0 features: Schema Locking, CSM, Consent, MSM
// Run: cd aimeat && pnpm exec tsx test/e2e-phase0.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  \u2705 ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  \u274C ${name}: ${err.message}`);
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

// Helper: sign a message with a base64 private key
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
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `testphase0_${Date.now()}`;

let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const agentName = 'phase0agent';

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerToken}` } };
}

function agentAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
}

// ─── Setup ───
console.log('\n=== AIMEAT Phase 0 E2E Test ===\n');
console.log('Setup \u2014 registering test owner & agent');

await test('Register test owner (auto-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got private key');
});

await test('Get owner token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register test agent', async () => {
    const { status, body } = await json('/v1/agents', authed({
        method: 'POST',
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentGaii === 'string' && agentGaii.length > 0, 'got agent gaii');
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Get agent token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ═══════════════════════════════════════════════════════════════
// Phase 0.1 — Schema Locking
// ═══════════════════════════════════════════════════════════════
console.log('\nPhase 0.1 \u2014 Schema Locking');

const schemaKey = 'test-schema-key';
const testSchema = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        age: { type: 'number' },
    },
    required: ['name'],
};

await test('PUT /v1/memory/:key/schema \u2192 set a schema', async () => {
    const { status, body } = await json(`/v1/memory/${schemaKey}/schema`, authed({
        method: 'PUT',
        body: JSON.stringify({
            schema: testSchema,
            apply_to: 'exact',
            schema_mode: 'open',
        }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.status === 'schema_set', `status is schema_set, got ${body.data?.status}`);
    assert(body.data?.key === schemaKey, `key matches, got ${body.data?.key}`);
});

await test('GET /v1/memory/:key/schema \u2192 read back the schema', async () => {
    const { status, body } = await json(`/v1/memory/${schemaKey}/schema`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.has_schema === true, 'has_schema is true');
    assert(body.data?.schema?.type === 'object', 'schema type is object');
    assert(Array.isArray(body.data?.schema?.required), 'schema has required array');
    assert(body.data.schema.required.includes('name'), 'required contains name');
});

await test('POST /v1/memory \u2192 write valid data matching schema \u2192 200', async () => {
    const { status, body } = await json('/v1/memory', agentAuthed({
        method: 'POST',
        body: JSON.stringify({
            key: schemaKey,
            value: { name: 'Alice', age: 30 },
            visibility: 'private',
            ttl_hours: 1,
        }),
    }));
    assert(status === 200 || status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
});

await test('POST /v1/memory \u2192 write invalid data violating schema \u2192 400', async () => {
    const { status, body } = await json('/v1/memory', agentAuthed({
        method: 'POST',
        body: JSON.stringify({
            key: schemaKey,
            value: { age: 'not-a-number' },
            visibility: 'private',
            ttl_hours: 1,
        }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
});

await test('DELETE /v1/memory/:key/schema \u2192 remove the schema', async () => {
    const { status, body } = await json(`/v1/memory/${schemaKey}/schema`, authed({
        method: 'DELETE',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.status === 'schema_removed', `status is schema_removed, got ${body.data?.status}`);
});

// ═══════════════════════════════════════════════════════════════
// Phase 0.2 — CSM Registration
// ═══════════════════════════════════════════════════════════════
console.log('\nPhase 0.2 \u2014 CSM Registration');

let csmTemplateYaml = '';
let csmTemplateName = '';

await test('GET /v1/csm/templates \u2192 200, has templates with total >= 1', async () => {
    const { status, body } = await json('/v1/csm/templates');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.templates), 'has templates array');
    assert(body.data.total >= 1, `total >= 1, got ${body.data.total}`);
    // Find hobby-directory template if available
    const hobby = body.data.templates.find((t: any) => t.type === 'hobby-directory');
    if (hobby) {
        csmTemplateName = hobby.name;
    }
});

await test('POST /v1/csm \u2192 201, register CSM from hobby-directory template', async () => {
    // Fetch the template YAML first
    const res = await fetch(`${BASE}/v1/csm/templates/hobby-directory`);
    assert(res.status === 200, `template fetch status ${res.status}`);
    csmTemplateYaml = await res.text();
    assert(csmTemplateYaml.length > 0, 'template YAML is non-empty');

    const { status, body } = await json('/v1/csm', authed({
        method: 'POST',
        body: JSON.stringify({ yaml: csmTemplateYaml }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.csm?.name === 'string', 'has name');
    csmTemplateName = body.data.csm.name;
    assert(typeof body.data?.csm?.service_type === 'string', 'has service_type');
});

await test('GET /v1/csm \u2192 200, list includes registered service', async () => {
    const { status, body } = await json('/v1/csm');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.services), 'has services array');
    const found = body.data.services.find((s: any) => s.name === csmTemplateName);
    assert(found, `found registered CSM "${csmTemplateName}" in list`);
});

await test('GET /v1/csm/{name} \u2192 200, returns full definition', async () => {
    const { status, body } = await json(`/v1/csm/${encodeURIComponent(csmTemplateName)}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.csm?.name === 'string', 'has name');
    assert(typeof body.data?.csm?.definition === 'object', 'has definition');
});

await test('DELETE /v1/csm/{name} \u2192 200, cleanup', async () => {
    const { status, body } = await json(`/v1/csm/${encodeURIComponent(csmTemplateName)}`, authed({
        method: 'DELETE',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === true, 'confirmed deleted');
});

// ═══════════════════════════════════════════════════════════════
// Phase 0.3 — Consent Layer
// ═══════════════════════════════════════════════════════════════
console.log('\nPhase 0.3 \u2014 Consent Layer');

let consentId = '';

await test('POST /v1/consent \u2192 201, create consent grant', async () => {
    const { status, body } = await json('/v1/consent', agentAuthed({
        method: 'POST',
        body: JSON.stringify({
            data_pattern: 'profile.*',
            recipient: '*',
            scope: 'dmz',
            purpose: 'test-phase0',
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.id === 'string', 'has id');
    assert(body.data?.data_pattern === 'profile.*', `data_pattern matches, got ${body.data?.data_pattern}`);
    assert(body.data?.recipient === '*', `recipient matches, got ${body.data?.recipient}`);
    assert(body.data?.status === 'active', `status is active, got ${body.data?.status}`);
    consentId = body.data.id;
});

await test('GET /v1/consent \u2192 200, list includes created consent', async () => {
    const { status, body } = await json('/v1/consent', agentAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.consents), 'has consents array');
    const found = body.data.consents.find((c: any) => c.id === consentId);
    assert(found, `found consent ${consentId} in list`);
});

await test('GET /v1/consent/:id \u2192 200, get single consent', async () => {
    const { status, body } = await json(`/v1/consent/${consentId}`, agentAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.id === consentId, `id matches, got ${body.data?.id}`);
    assert(body.data?.data_pattern === 'profile.*', 'data_pattern matches');
    assert(body.data?.purpose === 'test-phase0', 'purpose matches');
});

await test('DELETE /v1/consent/:id \u2192 200, revoke consent', async () => {
    const { status, body } = await json(`/v1/consent/${consentId}`, agentAuthed({
        method: 'DELETE',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.status === 'revoked', `status is revoked, got ${body.data?.status}`);
    assert(body.data?.consent_id === consentId, 'consent_id matches');
});

await test('GET /v1/consent/audit \u2192 200, audit trail endpoint works', async () => {
    const { status, body } = await json('/v1/consent/audit', agentAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.entries), 'has entries array');
    assert(typeof body.data?.total === 'number', 'has total');
    assert(typeof body.data?.period_days === 'number', 'has period_days');
});

// ═══════════════════════════════════════════════════════════════
// MSM Integration (via API)
// ═══════════════════════════════════════════════════════════════
console.log('\nMSM Integration');

await test('GET /v1/msm \u2192 200, endpoint reachable, returns integrations', async () => {
    const { status, body } = await json('/v1/msm');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.integrations), 'has integrations array');
    assert(typeof body.data?.total === 'number', 'has total');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete owner: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');
});

// ─── Summary ───
console.log(`\n--- Phase 0 Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);

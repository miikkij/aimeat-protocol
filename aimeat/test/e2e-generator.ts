/**
 * @file e2e-generator.ts
 * @description E2E tests for the Generator service — tests the full lifecycle
 *   of project creation, component management, and cleanup via Memory API.
 *   Validates that the frontend generator workflow (create project → add
 *   components → archive → delete) works correctly against the backend.
 * @version-history
 *   v1.0.0 — 2026-03-14 — Initial generator E2E test suite
 *   v1.1.0 — 2026-03-18 — Add agent-driven generator API endpoint tests
 *   v1.2.0 — 2026-03-21 — Add provider settings E2E tests (lmstudio, custom, URL validation)
 *   v1.3.0 — 2026-03-21 — Add generator settings collection E2E tests
 *   v1.4.0 — 2026-03-21 — Add test execution endpoint E2E tests (none/basic/invalid/404)
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-generator.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

// ─── Boot embedded server ───
const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40251', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;

if (!process.env.E2E_BASE) {
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    }
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(TEST_PORT, () => resolve(s));
    });
    console.log(`Test server started on port ${TEST_PORT}`);
}

// ─── Test harness ───
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

// ─── Crypto helpers ───
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
const ownerName = `genowner${Date.now()}`;
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
let generatorAgentToken = '';
let generatorAgentGaii = '';
let generatorAgentPrivKey = '';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';

console.log('\n=== Generator E2E Tests ===\n');

// ─── Setup: Register owner + agent ───
console.log('Setup — Auth');

await test('Register owner', async () => {
    if (ADMIN_PW) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: ownerName }),
        });
        assert(status === 200, `admin register status ${status}: ${JSON.stringify(body)}`);
        ownerPrivKey = body.private_key;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        ownerPrivKey = body.data.private_key;
    }
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth token', async () => {
    if (ADMIN_PW) {
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.token;
    } else {
        const timestamp = new Date().toISOString();
        const message = ownerName + NODE_ID + timestamp;
        const signature = await signMsg(ownerPrivKey, message);
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerName, timestamp, signature }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.data?.token;
    }
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'gen-test-agent',
            owner: ownerName,
            capabilities: ['memory', 'generator'],
            scopes: ['memory:read', 'memory:write', 'memory:delete'],
            model: 'test',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('Agent auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token ok: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ─── Setup: Register generator agent ───
console.log('\nSetup — Generator Agent');

await test('Register generator agent with generator scopes', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'gen-api-agent',
            owner: ownerName,
            capabilities: ['memory', 'generator'],
            scopes: ['memory:read', 'memory:write', 'generator:read', 'generator:write', 'generator:execute'],
            model: 'test',
        }),
    });
    assert(status === 201, `generator agent register status ${status}: ${JSON.stringify(body)}`);
    generatorAgentGaii = body.data.agent.gaii;
    generatorAgentPrivKey = body.data.private_key;
});

await test('Generator agent auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = generatorAgentGaii + timestamp;
    const signature = await signMsg(generatorAgentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: generatorAgentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `generator agent token ok: ${JSON.stringify(body.error)}`);
    generatorAgentToken = body.data?.token;
    assert(typeof generatorAgentToken === 'string', 'got generator agent token');
});

const auth = () => ({ Authorization: `Bearer ${agentToken}` });

// ─── Generator Project Lifecycle ───
console.log('\nGenerator — Project Lifecycle');

const projectId = 'prj-test-' + Date.now().toString(36);
const projectKey = `generator.${projectId}.project`;

await test('Create project via POST /v1/memory (new key)', async () => {
    const project = {
        projectId,
        name: 'Test Alert Monitor',
        description: 'E2E test project',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        blueprint: null,
    };
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
            key: projectKey,
            value: project,
            visibility: 'private',
        }),
    });
    assert(status === 201, `create project status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'create project ok');
    assert(body.data?.version === 1, `version should be 1, got ${body.data?.version}`);
});

await test('Read project via GET /v1/memory/:key', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        headers: auth(),
    });
    assert(status === 200, `read project status ${status}`);
    assert(body.ok === true, 'read ok');
    assert(body.data?.value?.projectId === projectId, 'correct projectId');
    assert(body.data?.value?.name === 'Test Alert Monitor', 'correct name');
    assert(body.data?.version === 1, 'version is 1');
});

await test('Update project via PUT /v1/memory/:key (optimistic locking)', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({
            value: {
                projectId,
                name: 'Test Alert Monitor',
                description: 'E2E test project — updated',
                status: 'blueprint',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                blueprint: { components: [], phases: [] },
            },
            visibility: 'private',
            version: 1,
        }),
    });
    assert(status === 200, `update project status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'update ok');
    assert(body.data?.version === 2, `version should be 2, got ${body.data?.version}`);
});

await test('Version conflict on stale update (PUT with wrong version)', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({
            value: { stale: true },
            version: 1, // stale — current is 2
        }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(body.error?.code === 'VERSION_CONFLICT', `error code: ${body.error?.code}`);
});

await test('PUT to non-existent key returns 404 (not auto-create)', async () => {
    const fakeKey = `generator.prj-doesnotexist.project`;
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(fakeKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({
            value: { test: true },
            visibility: 'private',
            version: 0,
        }),
    });
    assert(status === 404, `expected 404 for PUT on missing key, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FOUND', `error code: ${body.error?.code}`);
});

// ─── Generator Component Lifecycle ───
console.log('\nGenerator — Component Lifecycle');

const compId = 'csm-1';
const compKey = `generator.${projectId}.component.${compId}`;

await test('Create component via POST /v1/memory', async () => {
    const component = {
        id: compId,
        type: 'csm',
        label: 'Alert Monitor CSM',
        status: 'not_started',
        result: null,
        validationErrors: [],
        history: [{ action: 'created', at: new Date().toISOString(), by: 'system' }],
    };
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
            key: compKey,
            value: component,
            visibility: 'private',
        }),
    });
    assert(status === 201, `create component status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'create component ok');
});

await test('Update component status via PUT', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(compKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({
            value: {
                id: compId,
                type: 'csm',
                label: 'Alert Monitor CSM',
                status: 'done',
                result: 'csm: "1.0"\nservice:\n  name: alert-monitor\n  type: directory',
                validationErrors: [],
                history: [
                    { action: 'created', at: new Date().toISOString(), by: 'system' },
                    { action: 'validation_passed', at: new Date().toISOString(), by: 'user' },
                ],
            },
            version: 1,
        }),
    });
    assert(status === 200, `update component status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.version === 2, `version should be 2, got ${body.data?.version}`);
});

await test('List components by prefix', async () => {
    const prefix = `generator.${projectId}.component.`;
    const { status, body } = await json(`/v1/memory?prefix=${encodeURIComponent(prefix)}`, {
        headers: auth(),
    });
    assert(status === 200, `list status ${status}`);
    assert(body.ok === true, 'list ok');
    const items = body.data?.items || [];
    assert(items.length >= 1, `expected at least 1 component, got ${items.length}`);
    const comp = items.find((i: any) => i.key === compKey);
    assert(comp, 'found component by key');
    assert(comp.value?.status === 'done', `component status: ${comp.value?.status}`);
});

// ─── Generator Task Queue ───
console.log('\nGenerator — Task Queue');

const taskQueueKey = `generator.${projectId}.queue.task-test-1`;

await test('Enqueue task via POST /v1/memory', async () => {
    const task = {
        taskId: 'task-test-1',
        componentId: compId,
        type: 'csm',
        prompt: 'Generate a CSM for alert monitoring',
        status: 'pending',
        assignedTo: agentGaii,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
            key: taskQueueKey,
            value: task,
            visibility: 'owner',
        }),
    });
    assert(status === 201, `enqueue task status ${status}: ${JSON.stringify(body)}`);
});

await test('Claim task (optimistic lock via PUT)', async () => {
    const { body: readBody } = await json(`/v1/memory/${encodeURIComponent(taskQueueKey)}`, {
        headers: auth(),
    });
    const version = readBody.data?.version;
    assert(typeof version === 'number', `got version: ${version}`);

    const task = readBody.data?.value;
    task.status = 'processing';
    task.claimedBy = agentGaii;

    const { status, body } = await json(`/v1/memory/${encodeURIComponent(taskQueueKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({ value: task, version }),
    });
    assert(status === 200, `claim task status ${status}: ${JSON.stringify(body)}`);
});

await test('Write task result via POST /v1/memory', async () => {
    const resultKey = `generator.${projectId}.results.task-test-1`;
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
            key: resultKey,
            value: {
                taskId: 'task-test-1',
                componentId: compId,
                status: 'completed',
                result: 'csm: "1.0"\nservice:\n  name: alert-monitor',
                completedAt: new Date().toISOString(),
            },
            visibility: 'owner',
        }),
    });
    assert(status === 201, `write result status ${status}: ${JSON.stringify(body)}`);
});

// ─── Generator Project Listing ───
console.log('\nGenerator — Project Listing');

await test('List projects by prefix filter', async () => {
    const { status, body } = await json(`/v1/memory?prefix=${encodeURIComponent('generator.')}`, {
        headers: auth(),
    });
    assert(status === 200, `list status ${status}`);
    const items = body.data?.items || [];
    const projects = items.filter((i: any) => i.key.endsWith('.project'));
    assert(projects.length >= 1, `expected at least 1 project, got ${projects.length}`);
});

// ─── Generator Interview Spec & Blueprint ───
console.log('\nGenerator — Interview Spec & Blueprint');

await test('store and retrieve interview spec', async () => {
    const spec = {
        version: '1.0',
        projectName: 'Test Interview Project',
        description: 'A test project from interview',
        useCases: [{ id: 'uc-1', title: 'Test use case', description: 'Testing', priority: 'must-have' }],
        audience: { type: 'personal', scale: 'single', description: 'Just me' },
        dataSources: [],
        dataModel: { entities: [] },
        views: [{ id: 'view-1', type: 'list', title: 'Main view', description: 'Shows data' }],
        constraints: { updateMode: 'on-demand', locales: ['en'] },
    };

    // Store spec using the same key pattern as generator.js
    const storeResp = await json('/v1/memory', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
            key: `generator.${projectId}.interview-spec`,
            value: spec,
            visibility: 'private',
        }),
    });
    assert(storeResp.body.ok, 'Should store interview spec');

    // Retrieve spec
    const getResp = await json(`/v1/memory/${encodeURIComponent(`generator.${projectId}.interview-spec`)}`, {
        headers: auth(),
    });
    assert(getResp.body.ok, 'Should retrieve interview spec');
    const retrieved = getResp.body.data.value;
    assert(retrieved.projectName === 'Test Interview Project', 'Spec projectName should match');
    assert(Array.isArray(retrieved.useCases) && retrieved.useCases.length === 1, 'Spec should have 1 use case');
    assert(retrieved.useCases[0].id === 'uc-1', 'Use case id should match');
});

await test('blueprint with cortex type stores and retrieves', async () => {
    const blueprint = {
        components: [
            { id: 'csm-1', type: 'csm', label: 'Data Schema' },
            { id: 'ext-1', type: 'extension', label: 'Data Collector' },
            { id: 'cortex-1', type: 'cortex', label: 'Domain SDK' },
            { id: 'app-1', type: 'app', label: 'Web App' },
        ],
        phases: [
            { id: 'define', label: 'Define Service', componentIds: ['csm-1'] },
            { id: 'logic', label: 'Build Logic', componentIds: ['ext-1'] },
            { id: 'connect', label: 'Connect', componentIds: ['cortex-1'] },
            { id: 'ui', label: 'Build UI', componentIds: ['app-1'] },
        ],
    };

    // First get current version for optimistic locking
    const curResp = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        headers: auth(),
    });
    const curVersion = curResp.body.data?.version || 1;

    const storeResp = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({
            value: { projectId, name: 'Test', description: 'Test', blueprint, status: 'in_progress' },
            version: curVersion,
        }),
    });
    assert(storeResp.body.ok, 'Should store blueprint with cortex type');

    const getResp = await json(`/v1/memory/${encodeURIComponent(projectKey)}`, {
        headers: auth(),
    });
    const bp = getResp.body.data.value.blueprint;
    assert(bp.components.some((c: any) => c.type === 'cortex'), 'Blueprint should include cortex component');
    assert(bp.phases.some((p: any) => p.id === 'connect'), 'Blueprint should include connect phase');
});

await test('cortex extension installs and serves lib via generator flow', async () => {
    const cortexName = `test-gen-cortex-${Date.now()}`;
    const manifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${cortexName}
  namespace: ${ownerName}
  description: "Test cortex from generator"
  author: ${ownerName}
  tags: [test]
  labels:
    domain: test
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: test-gen-lib
      filename: test-gen-lib.js
      exports: [init, getData]
      api_surface: |
        init() - Initialize
        getData() - Get data`;

    const libCode = '(function(A){A.testGen={init:async function(){return{ready:true}},getData:async function(){return[]}};if(A.register)A.register("testGen",A.testGen)})(window.AIMEAT||(window.AIMEAT={}));';

    // Install
    const installResp = await json('/v1/cortex', {
        method: 'POST',
        headers: { ...auth(), 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({
            manifest,
            libs: { 'test-gen-lib.js': libCode },
        }),
    });
    assert(installResp.body.ok, 'Should install cortex extension: ' + JSON.stringify(installResp.body));

    // Activate
    const activateResp = await json(`/v1/cortex/${encodeURIComponent(cortexName)}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(activateResp.body.ok, 'Should activate cortex extension');

    // Verify lib is served
    const libResp = await fetch(`${BASE}/v1/cortex/${encodeURIComponent(cortexName)}/libs/test-gen-lib.js`);
    assert(libResp.status === 200, 'Should serve cortex lib file');
    const libText = await libResp.text();
    assert(libText.includes('testGen'), 'Lib should contain testGen');

    // Cleanup
    await json(`/v1/cortex/${encodeURIComponent(cortexName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
});

// ─── Generator API (agent-driven endpoints) ───
console.log('\nGenerator API — Agent-Driven Endpoints');

let generatorApiProjectId = '';

await test('Agent: create generator project via POST /v1/generator/projects', async () => {
    const { status, body } = await json('/v1/generator/projects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
        body: JSON.stringify({ name: 'API Test Service', description: 'E2E test via generator API' }),
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.projectId, 'Expected projectId in response');
    generatorApiProjectId = body.data.projectId;
    assert(typeof generatorApiProjectId === 'string' && generatorApiProjectId.length > 0, 'Got projectId');
});

await test('Agent: save interview spec (must be readable back with agent token)', async () => {
    const spec = {
        version: '1.0', projectName: 'API Test', description: 'E2E test',
        technicalLevel: 'beginner',
        useCases: [{ id: 'uc1', title: 'Test UC', description: 'Test', priority: 'must-have' }],
        audience: { type: 'personal', scale: 'single', description: '' },
        dataSources: [],
        dataModel: { entities: [] },
        views: [{ id: 'v1', type: 'list', title: 'Main View', description: 'Shows data' }],
        constraints: {},
    };
    const { status } = await json(`/v1/generator/${generatorApiProjectId}/interview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
        body: JSON.stringify({ interviewSpec: spec }),
    });
    assert(status === 200, `Interview spec save: expected 200, got ${status}`);

    // Verify agent can read it back via memory API (visibility: 'owner' allows agents of same owner)
    const { status: readStatus } = await json(`/v1/memory/generator.${generatorApiProjectId}.interview-spec`, {
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
    });
    assert(readStatus === 200, `Agent should read interview-spec (visibility: owner), got ${readStatus}`);
});

await test('Agent: blueprint submit returns validation errors for invalid YAML', async () => {
    const { status, body } = await json(`/v1/generator/${generatorApiProjectId}/steps/blueprint`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
        body: JSON.stringify({ blueprint: 'not: valid: yaml: [' }),
    });
    assert(status === 422, `Blueprint validation: expected HTTP 422 for invalid input, got ${status}`);
    assert(body.ok === false, 'Expected ok:false for validation error');
    assert(body.error?.code === 'VALIDATION_FAILED', `Expected VALIDATION_FAILED, got: ${body.error?.code}`);

    // Submit a valid blueprint so subsequent component-submit tests can proceed
    const validBlueprint = JSON.stringify({
        service_slug: 'api-test-service',
        components: [
            { id: 'csm-main', type: 'csm', label: 'Main CSM' },
        ],
        phases: [{ id: 'phase-1', label: 'Core', componentIds: ['csm-main'] }],
    });
    const { status: validStatus } = await json(`/v1/generator/${generatorApiProjectId}/steps/blueprint`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
        body: JSON.stringify({ blueprint: validBlueprint }),
    });
    assert(validStatus === 200, `Valid blueprint submit: expected 200, got ${validStatus}`);
});

await test('Agent: component submit validates and stores valid CSM', async () => {
    const validCsm = `\`\`\`yaml
service:
  name: api-test-service
  description: API test
  version: "1.0"
data_schema:
  required:
    name:
      type: string
consent_requirements:
  data_access: required
\`\`\``;

    const { status, body } = await json(`/v1/generator/${generatorApiProjectId}/components/csm-main/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
        body: JSON.stringify({ type: 'csm', content: validCsm }),
    });
    assert(status === 200, `Component submit: expected 200, got ${status}`);
    assert(body.data?.valid === true, `Expected valid:true, errors: ${JSON.stringify(body.data?.errors)}`);

    // Verify the component is stored in memory
    const { status: memStatus } = await json(`/v1/memory/generator.${generatorApiProjectId}.component.csm-main`, {
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
    });
    assert(memStatus === 200, `Component should be stored in memory after valid submit, got ${memStatus}`);
});

// Session claim/heartbeat/release tests removed — agent session endpoints removed in OpenRouter autopilot refactor

// ─── Generator Settings Collection ───
console.log('\nGenerator — Settings Collection');

await test('POST /v1/generator/:projectId/settings stores values', async () => {
    const res = await json(`/v1/generator/${generatorApiProjectId}/settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ values: { finnhub_api_key: 'test-key-123', default_city: 'Helsinki' } }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.data?.stored === 2, `Expected 2 stored, got ${res.body.data?.stored}`);
});

await test('GET /v1/generator/:projectId/settings retrieves values', async () => {
    const res = await json(`/v1/generator/${generatorApiProjectId}/settings`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.data?.values?.finnhub_api_key === 'test-key-123', `Key mismatch: ${res.body.data?.values?.finnhub_api_key}`);
    assert(res.body.data?.values?.default_city === 'Helsinki', `City mismatch: ${res.body.data?.values?.default_city}`);
});

await test('POST /v1/generator/:projectId/settings overwrites existing values', async () => {
    const res = await json(`/v1/generator/${generatorApiProjectId}/settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ values: { finnhub_api_key: 'updated-key', new_setting: true } }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.data?.stored === 2, `Expected 2 stored`);

    // Verify new values replaced old
    const getRes = await json(`/v1/generator/${generatorApiProjectId}/settings`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getRes.body.data?.values?.finnhub_api_key === 'updated-key', 'Key should be updated');
    assert(getRes.body.data?.values?.new_setting === true, 'New setting should exist');
    // Old default_city should be gone (full replace)
    assert(getRes.body.data?.values?.default_city === undefined, 'Old key should be gone after overwrite');
});

await test('POST /v1/generator/:projectId/settings rejects missing values', async () => {
    const res = await json(`/v1/generator/${generatorApiProjectId}/settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
});

await test('POST /v1/generator/:projectId/settings returns 404 for non-existent project', async () => {
    const res = await json('/v1/generator/nonexistent-project/settings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ values: { key: 'value' } }),
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
});

await test('GET /v1/generator/:projectId/settings returns empty for no settings', async () => {
    // Use the memory-based projectId which has no settings stored via the settings endpoint
    const res = await json(`/v1/generator/${projectId}/settings`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Object.keys(res.body.data?.values ?? {}).length === 0, 'Should return empty values');
});

// ─── Test Execution ───
console.log('\nTest Execution');

await test('POST /v1/generator/:projectId/test with level none returns empty', async () => {
  const res = await json(`/v1/generator/${generatorApiProjectId}/test`, {
    method: 'POST',
    body: JSON.stringify({ level: 'none' }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.data?.report?.overall === 'passed', `None level should pass, got: ${res.body.data?.report?.overall}`);
  assert(res.body.data?.report?.components?.length === 0, `None level no components, got: ${res.body.data?.report?.components?.length}`);
});

// Create a fresh test project with blueprint stored as a parsed object so the test endpoint can read it
const testExecProjectId = 'prj-texec-' + Date.now().toString(36);
await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
        key: `generator.${testExecProjectId}.project`,
        value: {
            projectId: testExecProjectId,
            name: 'Test Exec Project',
            description: 'E2E test for test execution endpoint',
            status: 'blueprint_ready',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            blueprint: { components: [{ id: 'cmp-1', type: 'csm', label: 'Main CSM', produces: [], consumes: [] }], phases: [], testScenarios: [] },
        },
        visibility: 'owner',
    }),
});

await test('POST /v1/generator/:projectId/test with level basic runs', async () => {
  const res = await json(`/v1/generator/${testExecProjectId}/test`, {
    method: 'POST',
    body: JSON.stringify({ level: 'basic' }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.data?.report, `Expected test report, got: ${JSON.stringify(res.body.data)}`);
  assert(res.body.data?.report?.level === 'basic', `Expected basic level, got: ${res.body.data?.report?.level}`);
  assert(Array.isArray(res.body.data?.report?.components), `Expected components array`);
  assert(['passed', 'failed'].includes(res.body.data?.report?.overall), `Expected overall passed/failed, got: ${res.body.data?.report?.overall}`);
});

await test('POST /v1/generator/:projectId/test rejects invalid level', async () => {
  const res = await json(`/v1/generator/${generatorApiProjectId}/test`, {
    method: 'POST',
    body: JSON.stringify({ level: 'invalid' }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
  });
  assert(res.status === 400, `Expected 400, got ${res.status}`);
});

await test('POST /v1/generator/:projectId/test returns 404 for non-existent project', async () => {
  const res = await json('/v1/generator/nonexistent-proj-xyz/test', {
    method: 'POST',
    body: JSON.stringify({ level: 'basic' }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
  });
  // 404 or 400 (no blueprint) are both acceptable; not 200
  assert(res.status === 404 || res.status === 400, `Expected 404 or 400, got ${res.status}`);
});

await test('Agent: cleanup generator API test project', async () => {
    // Delete all generator.{id}.* keys
    const { body: listBody } = await json(`/v1/memory?prefix=${encodeURIComponent(`generator.${generatorApiProjectId}.`)}`, {
        headers: { Authorization: `Bearer ${generatorAgentToken}` },
    });
    const items: Array<{ key: string }> = listBody.data?.items || [];
    for (const item of items) {
        await json(`/v1/memory/${encodeURIComponent(item.key)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${generatorAgentToken}` },
        });
    }
});

// ─── Provider Settings ───
console.log('\nProvider Settings');

await test('PUT /v1/openrouter/settings with lmstudio provider (no API key)', async () => {
  const res = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1', model: 'local-model' }),
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
});

await test('PUT /v1/openrouter/settings with lmstudio + API key', async () => {
  const res = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1', model: 'local-model', apiKey: 'lms-key-123' }),
  });
  // Without AIMEAT_ENCRYPTION_KEY configured, storing an API key returns 503.
  // With encryption configured, it returns 200. Both are valid outcomes.
  assert(res.status === 200 || res.status === 503, `Expected 200 or 503, got ${res.status}: ${JSON.stringify(res.body)}`);
});

await test('GET /v1/openrouter/settings returns provider info', async () => {
  const res = await json('/v1/openrouter/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.data?.provider === 'lmstudio', `Expected lmstudio, got ${res.body.data?.provider}`);
  assert(res.body.data?.baseUrl === 'http://localhost:1234/v1', `Bad baseUrl: ${res.body.data?.baseUrl}`);
});

await test('PUT /v1/openrouter/settings rejects insecure remote URL', async () => {
  const res = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ provider: 'custom', baseUrl: 'http://evil.com/v1' }),
  });
  assert(res.status === 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── Generator Cleanup ───
console.log('\nGenerator — Cleanup');

await test('Delete all project keys', async () => {
    const prefix = `generator.${projectId}.`;
    const { body: listBody } = await json(`/v1/memory?prefix=${encodeURIComponent(prefix)}`, {
        headers: auth(),
    });
    const items = listBody.data?.items || [];
    assert(items.length >= 3, `expected at least 3 keys (project, component, queue), got ${items.length}`);

    for (const item of items) {
        const { status } = await json(`/v1/memory/${encodeURIComponent(item.key)}`, {
            method: 'DELETE',
            headers: auth(),
        });
        assert(status === 200, `delete ${item.key} status ${status}`);
    }

    // Verify deletion
    const { body: afterBody } = await json(`/v1/memory?prefix=${encodeURIComponent(prefix)}`, {
        headers: auth(),
    });
    const remaining = afterBody.data?.items || [];
    assert(remaining.length === 0, `expected 0 keys after cleanup, got ${remaining.length}`);
});

// ─── Cleanup: Delete owner (cascade) ───
console.log('\nCleanup');

await test('Delete test owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete owner status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`Generator E2E: ${passed} passed, ${failed} failed`);
if (failed > 0) console.log('⚠️  Some tests failed!');
console.log(`${'─'.repeat(40)}\n`);

if (server) server.close();
process.exit(failed > 0 ? 1 : 0);

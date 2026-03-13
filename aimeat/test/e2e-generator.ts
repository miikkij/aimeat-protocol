/**
 * @file e2e-generator.ts
 * @description E2E tests for the Generator service — tests the full lifecycle
 *   of project creation, component management, and cleanup via Memory API.
 *   Validates that the frontend generator workflow (create project → add
 *   components → archive → delete) works correctly against the backend.
 * @version-history
 *   v1.0.0 — 2026-03-14 — Initial generator E2E test suite
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

/**
 * @file e2e-agent-skill-bundle.ts
 * @description E2E tests for skill bundle download and version check endpoints.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-agent-skill-bundle.ts

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

async function rawFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, opts);
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

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ZIP inspection using yauzl
import yauzl from 'yauzl';

function listZipEntries(buffer: Buffer): Promise<string[]> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            const entries: string[] = [];
            zipfile!.readEntry();
            zipfile!.on('entry', (entry: yauzl.Entry) => {
                entries.push(entry.fileName);
                zipfile!.readEntry();
            });
            zipfile!.on('end', () => resolve(entries));
            zipfile!.on('error', reject);
        });
    });
}

function readZipEntry(buffer: Buffer, targetPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            zipfile!.readEntry();
            zipfile!.on('entry', (entry: yauzl.Entry) => {
                if (entry.fileName === targetPath) {
                    zipfile!.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr) return reject(streamErr);
                        const chunks: Buffer[] = [];
                        readStream!.on('data', (chunk: Buffer) => chunks.push(chunk));
                        readStream!.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                    });
                } else {
                    zipfile!.readEntry();
                }
            });
            zipfile!.on('end', () => reject(new Error(`Entry ${targetPath} not found`)));
            zipfile!.on('error', reject);
        });
    });
}

// ─── State ───
const ownerName = `sbowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'bundle-test-agent';

console.log('\n=== AIMEAT Agent Skill Bundle E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'tasks'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth token', async () => {
    agentToken = await getToken(agentGaii, agentPrivKey, true);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ─── Phase 1: Download ZIP bundle ───
console.log('\nPhase 1 -- Download ZIP Bundle');

await test('1. Hermes bundle returns ZIP with correct headers', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'application/zip', `ct: ${res.headers.get('content-type')}`);
    assert(!!res.headers.get('x-bundle-version'), 'has X-Bundle-Version');
    assert(res.headers.get('x-bundle-runtime') === 'hermes', `runtime: ${res.headers.get('x-bundle-runtime')}`);
    assert(res.headers.get('content-disposition')?.includes('aimeat-hermes.zip') === true, 'filename');

    const buffer = Buffer.from(await res.arrayBuffer());
    const entries = await listZipEntries(buffer);
    assert(entries.includes('aimeat-hermes/SKILL.md'), 'has SKILL.md');
    assert(entries.includes('aimeat-hermes/references/api-overview.md'), 'has api-overview');
    assert(entries.includes('aimeat-hermes/references/task-lifecycle.md'), 'has task-lifecycle');
    assert(entries.includes('aimeat-hermes/references/message-protocol.md'), 'has message-protocol');
    assert(entries.includes('aimeat-hermes/references/telemetry-protocol.md'), 'has telemetry-protocol');
    assert(entries.includes('aimeat-hermes/references/capability-report.md'), 'has capability-report');
    assert(entries.includes('aimeat-hermes/references/error-protocol.md'), 'has error-protocol');
    assert(entries.includes('aimeat-hermes/scripts/poll-inbox.sh'), 'has poll-inbox');
    assert(entries.includes('aimeat-hermes/scripts/post-telemetry.sh'), 'has post-telemetry');
    assert(entries.includes('aimeat-hermes/scripts/test-connection.sh'), 'has test-connection');
    assert(entries.includes('aimeat-hermes/config/webhook-route.yaml'), 'has webhook-route');
    assert(entries.includes('aimeat-hermes/config/hooks.yaml'), 'has hooks');
});

await test('2. Generic bundle when runtime omitted', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('x-bundle-runtime') === 'generic', `runtime: ${res.headers.get('x-bundle-runtime')}`);
    assert(res.headers.get('content-disposition')?.includes('aimeat-agent.zip') === true, 'filename');

    const buffer = Buffer.from(await res.arrayBuffer());
    const entries = await listZipEntries(buffer);
    assert(entries.includes('aimeat-agent/SKILL.md'), 'has SKILL.md');
    assert(entries.includes('aimeat-agent/references/api-overview.md'), 'has api-overview');
    assert(!entries.some(e => e.includes('/scripts/')), 'no scripts');
    assert(!entries.some(e => e.includes('/config/')), 'no config');
});

await test('3. Unknown runtime falls back to generic', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle?runtime=unknown-platform`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('x-bundle-runtime') === 'generic', `runtime: ${res.headers.get('x-bundle-runtime')}`);
});

await test('4. 404 for non-existent agent', async () => {
    const { status } = await json('/v1/agents/no-such-agent/skill-bundle?runtime=hermes', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `status ${status}`);
});

await test('5. Agent can download its own bundle', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'application/zip', 'is zip');
});

await test('6. ZIP contains agent-specific GAII in SKILL.md', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const skillMd = await readZipEntry(buffer, 'aimeat-hermes/SKILL.md');
    assert(skillMd.includes(agentName), 'SKILL.md contains agent name');
    assert(skillMd.includes('#'), 'SKILL.md contains GAII separator');
    assert(skillMd.includes(NODE_ID), 'SKILL.md contains node ID');
});

await test('7. 401 without auth', async () => {
    const res = await rawFetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`);
    assert(res.status === 401, `status ${res.status}`);
});

// ─── Phase 2: Version check endpoint ───
console.log('\nPhase 2 -- Version Check');

await test('8. Version info without downloading ZIP', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.version === 'string' && body.data.version.length === 12, `version: ${body.data.version}`);
    assert(body.data.runtime === 'hermes', `runtime: ${body.data.runtime}`);
    assert(body.data.bundle_name === 'aimeat-hermes', `bundle_name: ${body.data.bundle_name}`);
    assert(typeof body.data.generated_at === 'string', 'has generated_at');
});

await test('9. Version is stable for same agent config', async () => {
    const { body: body1 } = await json(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const { body: body2 } = await json(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body1.data.version === body2.data.version, `v1=${body1.data.version} v2=${body2.data.version}`);
});

await test('10. Hermes and generic have different versions', async () => {
    const { body: hermesBody } = await json(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const { body: genericBody } = await json(`/v1/agents/${agentName}/skill-bundle/version`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(hermesBody.data.version !== genericBody.data.version,
        `hermes=${hermesBody.data.version} generic=${genericBody.data.version}`);
});

await test('11. Version 404 for non-existent agent', async () => {
    const { status } = await json('/v1/agents/no-such-agent/skill-bundle/version', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `status ${status}`);
});

await test('12. Agent can check its own version', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Skill Bundle E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

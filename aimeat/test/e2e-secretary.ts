// E2E Tests for the Secretary feature — Phase 0 (identity + auto-provisioning).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary
//
// Covers: provisioning on OpenRouter key save (happy path), correct scopes/tags/mode,
// exclusion from the public catalogue, idempotency, and the failure mode (no key → no Secretary).

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

const EXPECTED_SCOPES = ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'messages:read', 'workflow:read'];

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

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
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
        return { status: res.status, body };
    }
    throw new Error('unreachable');
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

async function getOwnerToken(owner: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwner(name: string): Promise<string> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register owner ${name}: status ${status}: ${JSON.stringify(body)}`);
    return getOwnerToken(name, body.data.private_key);
}

function findSecretary(agents: any[]): any | undefined {
    return agents.find(a => (a.tags || []).includes('system:secretary')) || agents.find(a => a.name === 'secretary');
}

// ─── State ───
const ownerName = `secowner${Date.now()}`;
const noKeyOwner = `seconone${Date.now()}`;
const secretaryGaii = `secretary#${ownerName}@${NODE_ID}`;
let ownerToken = '';
let noKeyToken = '';

console.log('\n=== AIMEAT Secretary E2E Test (Phase 0) ===\n');

console.log('Setup');
await test('Register owner (with key) + owner (no key)', async () => {
    ownerToken = await registerOwner(ownerName);
    noKeyToken = await registerOwner(noKeyOwner);
});

console.log('\nPhase 0 -- Provisioning');

await test('1. No Secretary before OpenRouter is configured', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(findSecretary(body.data.agents) === undefined, 'Secretary should not exist before a key is saved');
});

await test('2. Saving an OpenRouter key provisions the Secretary', async () => {
    const { status, body } = await json('/v1/openrouter/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ apiKey: 'sk-or-test-key-phase0', model: 'anthropic/claude-sonnet-4' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.saved === true, 'settings saved');
});

await test('3. Secretary appears in the owner Agents list with the right shape', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const sec = findSecretary(body.data.agents);
    assert(!!sec, 'Secretary should exist after key save');
    assert(sec.gaii === secretaryGaii, `gaii: ${sec.gaii}`);
    assert(sec.name === 'secretary', `name: ${sec.name}`);
    assert(sec.mode === 'interactive', `mode: ${sec.mode}`);
    assert((sec.tags || []).includes('system:secretary'), `tags: ${JSON.stringify(sec.tags)}`);
    assert((sec.tags || []).includes('unlisted'), `tags missing unlisted: ${JSON.stringify(sec.tags)}`);
    assert(typeof sec.public_key === 'string' && sec.public_key.length > 0, 'has a public key');
});

await test('4. Secretary holds exactly the `secretary` scope profile', async () => {
    const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const sec = findSecretary(body.data.agents);
    const scopes = (sec.default_scopes || []).slice().sort();
    const expected = EXPECTED_SCOPES.slice().sort();
    assert(JSON.stringify(scopes) === JSON.stringify(expected), `scopes: ${JSON.stringify(sec.default_scopes)}`);
});

await test('5. Secretary is hidden from the public agent catalogue', async () => {
    const { status, body } = await json('/v1/catalogue/agents?per_page=50');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const leaked = (body.data.agents || []).some((a: any) => a.gaii === secretaryGaii);
    assert(!leaked, 'Secretary must not appear in /v1/catalogue/agents');
});

await test('6. Provisioning is idempotent — a second key save makes no duplicate', async () => {
    const { status } = await json('/v1/openrouter/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ apiKey: 'sk-or-test-key-phase0-again', model: 'anthropic/claude-opus-4' }),
    });
    assert(status === 200, `status ${status}`);
    const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const secs = (body.data.agents || []).filter((a: any) => a.name === 'secretary');
    assert(secs.length === 1, `expected exactly 1 Secretary, got ${secs.length}`);
});

await test('7. Failure mode: an owner who never configured a key has no Secretary', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${noKeyToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(findSecretary(body.data.agents) === undefined, 'no-key owner should have no Secretary');
});

console.log('\nCleanup');
await test('Cascade-delete owners', async () => {
    await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    await json(`/v1/owners/${encodeURIComponent(noKeyOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${noKeyToken}` } });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Secretary E2E (Phase 0): ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

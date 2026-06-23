// E2E for the node member showcase (owners with a published portfolio)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=members
//
// GET /v1/portfolio/members lists owners whose portfolio.config.enabled === true.

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function sign(priv: string, msg: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(priv, 'base64'))).toString('base64'); }
async function getToken(owner: string, priv: string) {
    const ts = new Date().toISOString();
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: await sign(priv, owner + NODE_ID + ts) }) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
async function registerOwner(name: string) {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(status === 201, `register ${name}: ${status}`);
    return { token: await getToken(name, body.data.private_key), name };
}
async function createAgent(ownerName: string, ownerToken: string, agentName: string) {
    const { status } = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes: ['memory:read'] }),
    });
    assert(status === 201, `create agent ${agentName}: ${status}`);
}

const stamp = Date.now();
const pubName = `mbrpub${stamp}`;   // will publish a portfolio
const quietName = `mbrquiet${stamp}`; // will NOT publish

console.log('\n=== AIMEAT Node Members (published portfolio) E2E ===\n');

await test('Setup: one owner publishes a portfolio, another does not', async () => {
    const pub = await registerOwner(pubName);
    await createAgent(pubName, pub.token, 'pubbot');
    const cfg = await json('/v1/portfolio/config', {
        method: 'PUT', headers: { Authorization: `Bearer ${pub.token}` },
        body: JSON.stringify({ enabled: true }),
    });
    assert(cfg.status === 200, `enable portfolio: ${cfg.status} ${JSON.stringify(cfg.body)}`);
    await registerOwner(quietName); // no portfolio
});

await test('1. The published-portfolio owner appears in /v1/portfolio/members', async () => {
    const { status, body } = await json('/v1/portfolio/members');
    assert(status === 200, `members ${status}`);
    const names = (body.data.members || []).map((m: any) => m.username);
    assert(names.includes(pubName), `expected ${pubName} in members, got ${JSON.stringify(names.slice(0, 10))}`);
});

await test('2. The owner WITHOUT a published portfolio is NOT listed', async () => {
    const { body } = await json('/v1/portfolio/members');
    const names = (body.data.members || []).map((m: any) => m.username);
    assert(!names.includes(quietName), `${quietName} should NOT be listed`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-members.ts
 * @description E2E for the node member showcase — GET /v1/portfolio/members lists owners whose
 *   portfolio.config.enabled === true. Covers all four identity shapes a published portfolio can
 *   have, because the config lives under a different gaii depending on when it was written:
 *   owner with an agent (config under the agent), owner with NO agent (config under the GHII),
 *   owner who published before connecting an agent (config stays under the GHII), and an owner who
 *   never published (must not be listed).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=members
 * @version-history
 *   v1.1.0 — 2026-08-08 — Agentless and published-before-agent owners. The listing used to read
 *     only the first agent's gaii, so those two were published, served, and on no list; every
 *     account created by the remake onboarding is agentless at that moment.
 *   v1.0.0 — 2026-07-03 — Initial (owner with a portfolio is listed, owner without is not).
 */

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

async function publishPortfolio(ownerName: string, token: string) {
    const cfg = await json('/v1/portfolio/config', {
        method: 'PUT', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: true }),
    });
    assert(cfg.status === 200, `enable portfolio for ${ownerName}: ${cfg.status} ${JSON.stringify(cfg.body)}`);
}

const stamp = Date.now();
const pubName = `mbrpub${stamp}`;         // publishes, has an agent (config under the agent gaii)
const quietName = `mbrquiet${stamp}`;     // never publishes
const noAgentName = `mbrnoag${stamp}`;    // publishes with NO agent (config under the GHII)
const lateAgentName = `mbrlate${stamp}`;  // publishes first, connects an agent after

console.log('\n=== AIMEAT Node Members (published portfolio) E2E ===\n');

// Every account is set up BEFORE the first /v1/portfolio/members read: the endpoint caches its
// list for 60s, so an owner created between two reads would be judged against a stale snapshot.
await test('Setup: four owners across every publish/agent ordering', async () => {
    const pub = await registerOwner(pubName);
    await createAgent(pubName, pub.token, 'pubbot');
    await publishPortfolio(pubName, pub.token);

    await registerOwner(quietName); // no portfolio

    // The remake path: the welcome mat IS the portfolio and is made before any agent exists.
    const solo = await registerOwner(noAgentName);
    await publishPortfolio(noAgentName, solo.token);

    // Published under the GHII, then an agent arrives — the portfolio must not vanish from the list.
    const late = await registerOwner(lateAgentName);
    await publishPortfolio(lateAgentName, late.token);
    await createAgent(lateAgentName, late.token, 'latebot');
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

await test('3. An owner with NO agent who published IS listed', async () => {
    const { body } = await json('/v1/portfolio/members');
    const names = (body.data.members || []).map((m: any) => m.username);
    assert(names.includes(noAgentName), `expected agentless ${noAgentName} in members, got ${JSON.stringify(names.slice(0, 10))}`);
});

await test('4. An owner who published BEFORE connecting an agent stays listed', async () => {
    const { body } = await json('/v1/portfolio/members');
    const names = (body.data.members || []).map((m: any) => m.username);
    assert(names.includes(lateAgentName), `expected ${lateAgentName} in members, got ${JSON.stringify(names.slice(0, 10))}`);
});

await test('5. Every listed member resolves as a published portfolio', async () => {
    const { body } = await json('/v1/portfolio/members');
    for (const name of [pubName, noAgentName, lateAgentName]) {
        const r = await json(`/v1/portfolio/data/${name}`);
        assert(r.status === 200 && r.body.ok === true, `data/${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
    }
    const quiet = await json(`/v1/portfolio/data/${quietName}`);
    assert(quiet.status === 404, `data/${quietName} should 404, got ${quiet.status}`);
    assert((body.data.members || []).length === body.data.total, 'total must match members length');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);

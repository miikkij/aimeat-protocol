/**
 * @file e2e-account-events.ts
 * @description E2E for the account's own record: GET /v1/account/events, its archive, and the
 *   app-facing write door. Design: docs/internal/telemetria/04-account-events.md
 *
 *   WHY THIS SUITE EXISTS. The reads shipped mounted at `/v1/events`, where the SSE stream was
 *   already listening and matched first, so every call to the window came back
 *   `MISSING_TICKET` — a working route, a working service, and nothing between them. Unit tests
 *   could not see it because the collision lives in the mount order, not in either handler. The
 *   first test here asserts the SHAPE of a successful read rather than merely a 200, so a second
 *   route stealing the path fails it.
 *
 *   The rest is the boundary: an owner reads their own record and nobody else's, an app may add to
 *   the record of the owner who granted it and cannot name itself, and both reads refuse a session
 *   without the scope.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial: the path collision, the window, the archive, cross-owner 403s.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=account-events

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `acev${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Account Events', password: 'AccountEv12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.status === 200, `token ${tok.status}`);
    return { name, token: tok.body.data.token as string, ghii: `${name}@${NODE_ID}` };
}

console.log('\n=== AIMEAT Account Events E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const authB = () => ({ Authorization: `Bearer ${B.token}` });

await test('Setup: two owners', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
});

// ── The collision this suite was written for ────────────────────────────────────────────────────
// A 200 alone would not have caught it: the SSE stream on the same path answered 400 with
// MISSING_TICKET, and any read of `body.data.events` on that response is undefined rather than an
// error. Assert the shape, and assert the error code is NOT the stream's.
await test('GET /v1/account/events returns the record, not another route on the same path', async () => {
    const r = await json('/v1/account/events', { headers: authA() });
    assert(r.status === 200, `expected 200, got ${r.status} (${r.body?.error?.code ?? 'no code'})`);
    assert(r.body?.error?.code !== 'MISSING_TICKET', 'the SSE stream answered: the path is shadowed');
    assert(Array.isArray(r.body?.data?.events), 'data.events is not an array');
    assert(typeof r.body?.data?.count === 'number', 'data.count missing');
    assert(typeof r.body?.data?.window === 'number' && r.body.data.window > 0,
        `data.window missing or not positive: ${r.body?.data?.window}`);
});

await test('Registering the account put its first row on the record', async () => {
    const r = await json('/v1/account/events', { headers: authA() });
    const kinds = (r.body.data.events as any[]).map(e => e.kind);
    assert(kinds.includes('account_created'), `no account_created row; kinds: ${kinds.join(', ') || '(none)'}`);
    const row = (r.body.data.events as any[]).find(e => e.kind === 'account_created');
    assert(typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)), `row has no usable timestamp: ${row.at}`);
    // A kind is a key the interface translates. A stored sentence is a translation that became a
    // data migration, so the row must not carry one.
    assert(!/\s/.test(row.kind), `kind reads as a sentence rather than a key: ${row.kind}`);
});

await test('GET /v1/account/events/archive answers, and is empty on a young account', async () => {
    const r = await json('/v1/account/events/archive', { headers: authA() });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(Array.isArray(r.body?.data?.events), 'data.events is not an array');
    assert(r.body.data.total === 0, `a fresh account has an empty archive, got total=${r.body.data.total}`);
});

await test('The window is one account’s own: B does not see A’s rows', async () => {
    const a = await json('/v1/account/events', { headers: authA() });
    const b = await json('/v1/account/events', { headers: authB() });
    assert(b.status === 200, `B read ${b.status}`);
    const aIds = new Set((a.body.data.events as any[]).map(e => e.id));
    const leaked = (b.body.data.events as any[]).filter(e => aIds.has(e.id));
    assert(leaked.length === 0, `B sees ${leaked.length} of A's rows`);
});

await test('Both reads refuse an unauthenticated caller', async () => {
    const w = await json('/v1/account/events');
    const a = await json('/v1/account/events/archive');
    assert(w.status === 401, `window without a token → ${w.status}`);
    assert(a.status === 401, `archive without a token → ${a.status}`);
});

// ── The write door ──────────────────────────────────────────────────────────────────────────────
await test('POST refuses a principal that is not an app under a grant', async () => {
    const r = await json('/v1/account/events', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ kind: 'order_placed', data: { total: '24.90' } }),
    });
    assert(r.status === 403, `an owner session posting an app event → ${r.status}, expected 403`);
    assert(r.body?.error?.code === 'APP_ONLY', `expected APP_ONLY, got ${r.body?.error?.code}`);
});

await test('POST refuses a kind that is a sentence rather than a key', async () => {
    const r = await json('/v1/account/events', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ kind: 'Your order was placed' }),
    });
    // The shape check comes first, so this is a 400 and not the APP_ONLY refusal above.
    assert(r.status === 400, `a sentence as a kind → ${r.status}, expected 400`);
    assert(r.body?.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body?.error?.code}`);
});

await test('The read hints at the archive, so a client never has to guess the path', async () => {
    const r = await json('/v1/account/events', { headers: authA() });
    const urls = (r.body?.hints?.next_actions ?? []).map((h: any) => h.url);
    assert(urls.includes('/v1/account/events/archive'),
        `the archive is not offered; hints: ${urls.join(', ') || '(none)'}`);
});

console.log(`\n=== Account Events E2E: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

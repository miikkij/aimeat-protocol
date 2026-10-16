/**
 * @file test/e2e-session-forgery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A session JWT the node did not sign, or did sign and somebody changed, authenticates
 *   nothing. Every forgery names the operator, so a node that accepted one would hand out the
 *   strongest identity it has:
 *     - a session-shaped token signed with another Ed25519 key,
 *     - a real owner token whose payload was rewritten to name the operator (signature kept),
 *     - a real owner token whose expiry was pushed out (signature kept),
 *     - an unsigned token (alg none),
 *     - a token signed with HS256 instead of EdDSA.
 *   Each is refused with 401 on a route that needs a signed-in caller (GET /v1/ghii/me), on a
 *   route that also serves an anonymous caller (GET /v1/memory), and on the MCP endpoint. The
 *   owner's own unchanged token is the control.
 *
 *   WHY. Every session rests on verifyJWT checking the EdDSA signature and the expiry against the
 *   node key. The only negatives the E2E suites sent were strings that are not JWTs at all, which a
 *   bare decode refuses too, so a change that turned the verification into a decode would have left
 *   every suite green. The expired case needs a token signed with the node key, which only a unit
 *   test can mint: test/unit/session-jwt-forgery.test.ts.
 *
 *   ANONYMOUS MODE OFF. With anonymous mode on, a refused credential on GET /v1/memory falls back to
 *   the shared anonymous identity and answers 200, so a verification that refused nothing would
 *   still look like a refusal there. The suite is in ANONYMOUS_OFF_SUITES (test/run-e2e-server.ts),
 *   the setting production runs, and asserts the exact 401.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-session-forgery
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F20-01).
 */
import { SignJWT, generateKeyPair } from 'jose';
import { createHmac } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ANONYMOUS_OFF = process.env.AIMEAT_ANONYMOUS === 'false';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function call(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const decode = (token: string) => ({
    header: JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')),
});
const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const MARKER_KEY = `forgery.marker.${stamp}`;

let operator: RegisteredOwner;
let alice: RegisteredOwner;
const forgeries: Array<[string, string]> = [];

console.log(`\n=== SESSION FORGERY E2E (anonymous mode ${ANONYMOUS_OFF ? 'off' : 'on'}) ===\n`);
console.log('Phase 0 — fixtures');

await test('The operator and a plain owner; the operator keeps a private record', async () => {
    operator = await registerOwner(BASE, `sfop${stamp}`);
    alice = await registerOwner(BASE, `sfa${stamp}`);
    const w = await call('/v1/memory', operator.token, {
        method: 'POST', body: JSON.stringify({ key: MARKER_KEY, value: { secret: 'operator-only' }, visibility: 'private' }),
    });
    assert(w.status === 201, `operator record: ${w.status} ${short(w.body)}`);
});

await test('The forgeries are built, each naming the operator', async () => {
    const real = decode(alice.token);
    const sig = alice.token.split('.')[2];
    const now = Math.floor(Date.now() / 1000);
    const operatorClaims = {
        ...real.payload, sub: operator.name, owner: operator.name, node: real.payload.node ?? NODE_ID,
        roles: ['owner', 'operator'], scopes: [],
    };

    const foreign = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    forgeries.push(['signed with another Ed25519 key', await new SignJWT({
        owner: operator.name, node: real.payload.node ?? NODE_ID, roles: ['owner', 'operator'], scopes: [], iat_ms: Date.now(),
    }).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(operator.name).setIssuedAt(now).setExpirationTime(now + 3600).sign(foreign.privateKey)]);

    forgeries.push(['a real token rewritten to name the operator', `${b64url(real.header)}.${b64url(operatorClaims)}.${sig}`]);
    forgeries.push(['a real token with its expiry pushed out', `${b64url(real.header)}.${b64url({ ...real.payload, exp: now + 365 * 86400 })}.${sig}`]);
    forgeries.push(['alg none', `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(operatorClaims)}.`]);
    const hsInput = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(operatorClaims)}`;
    forgeries.push(['HS256 instead of EdDSA', `${hsInput}.${createHmac('sha256', 'guessed-secret').update(hsInput).digest('base64url')}`]);
    assert(forgeries.length === 5, `forgeries: ${forgeries.length}`);
});

console.log('\nPhase 1 — the control');

await test('The owner\'s unchanged token is accepted (the route and the fixture work)', async () => {
    const me = await call('/v1/ghii/me', alice.token);
    assert(me.status === 200, `GET /v1/ghii/me with the real token: ${me.status} ${short(me.body)}`);
    assert(JSON.stringify(me.body).includes(alice.name), `the profile is not the owner's: ${short(me.body)}`);
    const op = await call(`/v1/memory/${encodeURIComponent(MARKER_KEY)}`, operator.token);
    assert(op.status === 200 && JSON.stringify(op.body).includes('operator-only'), `the operator reads its record: ${op.status} ${short(op.body)}`);
});

console.log('\nPhase 2 — every forgery is refused');

await test('GET /v1/ghii/me answers 401 for each forgery', async () => {
    for (const [label, token] of forgeries) {
        const r = await call('/v1/ghii/me', token);
        assert(r.status === 401, `${label}: ${r.status} ${short(r.body)}`);
        assert(!JSON.stringify(r.body).includes(operator.name), `${label}: the answer names the operator: ${short(r.body)}`);
    }
});

await test('GET /v1/memory answers 401 to each forgery and never serves the operator\'s record', async () => {
    assert(ANONYMOUS_OFF, 'this suite runs with AIMEAT_ANONYMOUS=false (ANONYMOUS_OFF_SUITES in test/run-e2e-server.ts); with it on, a refused token reads as the anonymous identity');
    for (const [label, token] of forgeries) {
        const one = await call(`/v1/memory/${encodeURIComponent(MARKER_KEY)}`, token);
        assert(!JSON.stringify(one.body).includes('operator-only'), `${label}: the operator's record was served: ${one.status}`);
        const list = await call('/v1/memory?limit=50', token);
        assert(!JSON.stringify(list.body).includes(MARKER_KEY), `${label}: the operator's key was listed: ${list.status}`);
        // Anonymous mode is off (ANONYMOUS_OFF_SUITES), so there is no identity to fall back to.
        assert(one.status === 401, `${label}: GET one record: ${one.status} ${short(one.body)}`);
        assert(list.status === 401, `${label}: GET the list: ${list.status} ${short(list.body)}`);
    }
});

await test('An operator route answers 401 for each forgery (GET /v1/admin/maintenance)', async () => {
    for (const [label, token] of forgeries) {
        const r = await call('/v1/admin/maintenance', token);
        assert(r.status === 401, `${label}: ${r.status} ${short(r.body)}`);
    }
});

await test('The MCP endpoint refuses each forgery at initialize (401)', async () => {
    for (const [label, token] of forgeries) {
        const r = await call('/v1/mcp', token, {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'forgery', version: '1' } } }),
        });
        assert(r.status === 401, `${label}: ${r.status} ${short(r.body)}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-agent-token-revocation.ts
 * @description Deleting an agent has to end its sessions.
 *
 *   Until this suite there was nothing asking. An agent JWT is signed, carries a 90-day expiry and
 *   is checked against the token-revocation table by exact token hash, so deleting the agent record
 *   left every credential it held valid: the record was gone, `storage.getAgent` returned null, and
 *   the bearer kept authenticating. The middleware documented the desync as a caching problem
 *   (`agentNotFoundResponse`) rather than as the security hole it also was, and the owner pressing
 *   Delete had no way to reach the token — you cannot revoke by hash a string you never see.
 *
 *   Both mint paths are covered, because they behaved differently: POST /v1/auth/token has always
 *   written a session row, device authorization never did, and only a token with a session row can
 *   be revoked without enumerating credentials.
 *
 *   The last test is the one that keeps the fix honest: revocation must reach exactly the deleted
 *   agent's sessions and not the sibling standing next to it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-token-revocation
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, with the fix.
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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

/** Can this bearer still act? memory:read is in every agent's default scopes. */
async function stillWorks(token: string): Promise<{ ok: boolean; status: number }> {
    const { status } = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${token}` } });
    return { ok: status === 200, status };
}

/** Register an owner and return an owner session token. */
async function setupOwner(label: string) {
    const owner = `arev${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'RevokeMe123456' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'RevokeMe123456' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

/**
 * Connect an agent the way a real one connects: device authorization, auto-approved because the
 * caller is its own owner. Returns the credentials the poll hands back.
 */
async function connectAgent(owner: string, ownerToken: string, agentName: string) {
    const auth = { Authorization: `Bearer ${ownerToken}` };
    const start = await json('/v1/agents/device-authorize', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ owner, agent_name: agentName }),
    });
    assert(start.status === 200, `device-authorize ${start.status}: ${JSON.stringify(start.body?.error)}`);
    assert(start.body.data.auto_approved === true, 'same-owner registration should be auto-approved');

    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200, `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    return { name: agentName, gaii: poll.body.gaii as string, token: poll.body.access_token as string, privateKey: poll.body.privateKey as string };
}

console.log('\n=== Deleting an agent ends its sessions ===\n');

async function run() {
    const o = await setupOwner('a');
    const auth = { Authorization: `Bearer ${o.ownerToken}` };

    const doomed = await connectAgent(o.owner, o.ownerToken, 'doomed');
    const bystander = await connectAgent(o.owner, o.ownerToken, 'bystander');

    // A second credential for the same agent, minted the OTHER way, so the test covers both.
    let signedToken = '';
    await test('both mint paths hand out a working credential', async () => {
        const ts = new Date().toISOString();
        const signed = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: doomed.gaii, timestamp: ts, signature: await sign(doomed.privateKey, doomed.gaii + ts) }),
        });
        assert(signed.status === 200, `auth/token ${signed.status}: ${JSON.stringify(signed.body?.error)}`);
        signedToken = signed.body.data.token;

        const a = await stillWorks(doomed.token);
        const b = await stillWorks(signedToken);
        assert(a.ok, `device-auth token should work before deletion, got ${a.status}`);
        assert(b.ok, `signed token should work before deletion, got ${b.status}`);
    });

    await test('the owner deletes the agent', async () => {
        const { status } = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: auth });
        assert(status === 200, `delete ${status}`);
    });

    await test('the DEVICE-AUTH token is dead — this is the hole', async () => {
        const r = await stillWorks(doomed.token);
        assert(!r.ok, 'a deleted agent\'s token must not authenticate');
        assert(r.status === 401, `expected 401 (not authenticated), got ${r.status}`);
    });

    await test('the SIGNED token is dead too', async () => {
        const r = await stillWorks(signedToken);
        assert(!r.ok, 'the second credential must die with the first');
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('the sibling agent is untouched', async () => {
        const r = await stillWorks(bystander.token);
        assert(r.ok, `deleting one agent must not sign out another, got ${r.status}`);
    });

    // A second owner for the two session-scope tests: the first one is about to sign itself out.
    const o2 = await setupOwner('b');
    const auth2 = { Authorization: `Bearer ${o2.ownerToken}` };
    const keeper = await connectAgent(o2.owner, o2.ownerToken, 'keeper');

    await test('the device list is the human\'s own sign-ins, not their agents\'', async () => {
        const { status, body } = await json('/v1/auth/sessions', { headers: auth2 });
        assert(status === 200, `sessions ${status}`);
        const gaiis = (body.data.sessions ?? []).map((s: any) => s.gaii);
        assert(gaiis.length > 0, 'the owner has at least their own session listed');
        assert(!gaiis.some((g: string) => g.includes('#')), `no agent rows in the device list: ${JSON.stringify(gaiis)}`);
    });

    await test('"sign out everywhere" leaves the fleet connected', async () => {
        assert((await stillWorks(keeper.token)).ok, 'the agent works to begin with');
        const { status } = await json('/v1/auth/sessions', { method: 'DELETE', headers: auth2 });
        assert(status === 200, `revoke-all ${status}`);
        const r = await stillWorks(keeper.token);
        assert(r.ok, `signing out of every device must not disconnect an agent, got ${r.status}`);
    });

    // Session revocation was checked in a branch the global optionalAuth() made unreachable, so
    // until now logging out revoked the row and the bearer carried on. Same fix, second symptom.
    await test('logging out actually ends the session it revoked', async () => {
        assert((await stillWorks(o.ownerToken)).ok, 'the owner token works before logout');
        const { status } = await json('/v1/auth/revoke', { method: 'POST', headers: auth });
        assert(status === 200, `revoke ${status}`);
        const after = await stillWorks(o.ownerToken);
        assert(!after.ok && after.status === 401, `a logged-out token must not authenticate, got ${after.status}`);
    });

    console.log('\nCleanup');
    await test('cascade-delete both owners', async () => {
        // Both signed themselves out above, so both log in again for the delete.
        for (const owner of [o.owner, o2.owner]) {
            const login = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: owner, password: 'RevokeMe123456' }),
            });
            assert(login.status === 200, `re-login ${owner}: ${login.status}`);
            const { status } = await json(`/v1/owners/${encodeURIComponent(owner)}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${login.body.data.token}` },
            });
            assert(status === 200, `delete owner ${owner}: ${status}`);
        }
    });
}

await run();

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent token revocation E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

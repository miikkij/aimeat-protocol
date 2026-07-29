// E2E test for aimeat-auth.js library flow (server-side simulation)
// Tests the exact same API calls the browser auth library makes
// Run: cd aimeat && AIMEAT_PORT=40251 npx tsx test/e2e-auth-lib.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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

async function api(path: string, opts: RequestInit = {}): Promise<any> {
    const url = `${BASE}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json() as any;
    return { ...data, _status: res.status };
}

async function authApi(path: string, jwt: string, opts: RequestInit = {}): Promise<any> {
    return api(path, { ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Authorization: `Bearer ${jwt}` } });
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
const username = `authtest${Date.now()}`;
const displayName = 'Auth Test User';
let ownerName = '';
let ownerPrivKey = '';
let ownerJwt = '';
let agentGaii = '';
let agentPrivKey = '';
let agentJwt = '';
let ghii = '';

console.log(`\n=== AIMEAT Auth Library E2E Test ===\n`);
console.log(`Server: ${BASE}`);
console.log(`Username: ${username}\n`);

// ─── Phase 1: GHII Registration ───
console.log('Phase 1 — GHII Registration (what auth.register() does)');

await test('POST /v1/ghii — register human identity', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: displayName }),
    });
    assert(data.ok === true, `GHII registration failed: ${data.error?.message}`);
    assert(data._status === 201, `expected 201, got ${data._status}`);

    ownerName = data.data.owner.name;
    ghii = data.data.ghii.ghii;
    ownerPrivKey = data.data.private_key;

    assert(ownerName === username, `owner name mismatch: ${ownerName}`);
    assert(ghii === `${username}@${NODE_ID}`, `ghii format: ${ghii}`);
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'missing private key');
    assert(typeof data.data.public_key === 'string', 'missing public key');
    assert(data.data.owner.roles.includes('owner'), 'owner should have owner role');
});

// ─── Phase 2: Owner JWT ───
console.log('\nPhase 2 — Owner Authentication');

await test('POST /v1/auth/token — get owner JWT', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(data.ok === true, `Owner auth failed: ${data.error?.message}`);
    ownerJwt = data.data.token;
    assert(typeof ownerJwt === 'string' && ownerJwt.length > 0, 'missing owner JWT');
    assert(data.data.roles.includes('owner'), `owner JWT should have owner role, got: ${data.data.roles}`);
});

// ─── Phase 3: Agent Registration ───
console.log('\nPhase 3 — Agent Registration (using owner JWT)');

await test('POST /v1/agents — register agent with owner JWT', async () => {
    const data = await authApi('/v1/agents', ownerJwt, {
        method: 'POST',
        body: JSON.stringify({
            name: 'app',
            owner: ownerName,
            display_name: `${displayName}'s App Agent`,
            description: 'Default agent for AIMEAT apps',
        }),
    });
    assert(data.ok === true, `Agent registration failed: ${data.error?.message}`);

    agentGaii = data.data.agent.gaii;
    agentPrivKey = data.data.private_key;

    assert(agentGaii.startsWith('app#'), `expected gaii starting with app#, got: ${agentGaii}`);
    assert(typeof agentPrivKey === 'string' && agentPrivKey.length > 0, 'missing agent private key');
});

await test('POST /v1/agents — fails without auth', async () => {
    const data = await api('/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
            name: 'noauth',
            owner: ownerName,
            display_name: 'Should fail',
        }),
    });
    assert(data.ok === false, 'should have failed without auth');
    assert(data._status === 401 || data._status === 403, `expected 401/403, got ${data._status}`);
});

await test('POST /v1/agents — fails with X-AIMEAT-Owner-Key (old broken way)', async () => {
    const data = await api('/v1/agents', {
        method: 'POST',
        headers: { 'X-AIMEAT-Owner-Key': ownerPrivKey },
        body: JSON.stringify({
            name: 'oldway',
            owner: ownerName,
            display_name: 'Should fail',
        }),
    });
    assert(data.ok === false, 'X-AIMEAT-Owner-Key should not work for agent registration');
    assert(data._status === 401 || data._status === 403, `expected 401/403, got ${data._status}`);
});

// ─── Phase 4: Agent Authentication ───
console.log('\nPhase 4 — Agent Authentication');

await test('POST /v1/auth/token — get agent JWT', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);

    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(data.ok === true, `Agent auth failed: ${data.error?.message}`);
    agentJwt = data.data.token;
    assert(typeof agentJwt === 'string' && agentJwt.length > 0, 'missing agent JWT');
    assert(data.data.roles.includes('agent'), 'should have agent role');
    assert(data.data.roles.includes('owner'), 'agent of owner should inherit owner role');
});

await test('Agent JWT signature: gaii+owner+host format should FAIL', async () => {
    const timestamp = new Date().toISOString();
    // This is the OLD broken format the library was using
    const nodeHost = new URL(BASE).host;
    const badMessage = agentGaii + ownerName + nodeHost + timestamp;
    const signature = await signMsg(agentPrivKey, badMessage);

    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(data.ok === false, 'old message format should fail');
    assert(data._status === 401, `expected 401, got ${data._status}`);
});

// ─── Phase 5: Authenticated Operations ───
console.log('\nPhase 5 — Authenticated Operations');

await test('POST /v1/memory — store data with agent JWT', async () => {
    const data = await authApi('/v1/memory', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'e2e-test', value: { message: 'auth library works' }, visibility: 'private' }),
    });
    assert(data.ok === true, `Memory store failed: ${data.error?.message}`);
});

await test('GET /v1/memory/e2e-test — read data back', async () => {
    const data = await authApi('/v1/memory/e2e-test', agentJwt);
    assert(data.ok === true, `Memory read failed: ${data.error?.message}`);
    assert(data.data.value.message === 'auth library works', 'data mismatch');
});

await test('POST /v1/apps — upload app with agent JWT', async () => {
    const content = Buffer.from('<html><body>Auth test app</body></html>').toString('base64');
    const data = await authApi('/v1/apps', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ filename: 'auth-test.html', description: 'Auth-lib smoke test app.', content, mime_type: 'text/html' }),
    });
    assert(data.ok === true, `App upload failed: ${data.error?.message}`);
    assert(data.data.download_url.includes('auth-test.html'), 'download URL should contain filename');
});

await test('PATCH /v1/apps/auth-test.html — update access code', async () => {
    const data = await authApi('/v1/apps/auth-test.html', agentJwt, {
        method: 'PATCH',
        body: JSON.stringify({ access_code: 'test1234' }),
    });
    assert(data.ok === true, `PATCH failed: ${data.error?.message}`);
    assert(data.data.protected === true, 'should be protected');
});

// ─── Phase 6: Token Refresh ───
console.log('\nPhase 6 — Token Refresh');

await test('POST /v1/auth/refresh — refresh agent JWT', async () => {
    const data = await authApi('/v1/auth/refresh', agentJwt, { method: 'POST' });
    assert(data.ok === true, `Refresh failed: ${data.error?.message}`);
    const newJwt = data.data.token;
    assert(typeof newJwt === 'string' && newJwt.length > 0, 'missing refreshed JWT');

    // Verify new token works
    const memData = await authApi('/v1/memory/e2e-test', newJwt);
    assert(memData.ok === true, 'refreshed JWT should work');
});

await test('Re-authenticate with agent key (simulates session.refresh())', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);

    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(data.ok === true, `Re-auth failed: ${data.error?.message}`);
    assert(typeof data.data.token === 'string', 'should get new token');
});

// ─── Phase 7: Password Login ───
// v1.1.0 — 2026-07-29 — Batch 01 holes 12 + the lockout suspicion: assert that a weak password is
// refused with WEAK_PASSWORD and leaves no account behind, and that the brute-force lockout (not
// the rate limiter, which shares its 429) is what refuses a hammered account.
console.log('\nPhase 7 — Password Login');

const pwUsername = `pwtest${Date.now()}`;
const pwPassword = 'TestPass123';
let pwOwnerJwt = '';

await test('POST /v1/ghii — register with password', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, display_name: 'Password User', password: pwPassword }),
    });
    assert(data.ok === true, `Registration failed: ${data.error?.message}`);
    assert(data._status === 201, `expected 201, got ${data._status}`);
    assert(data.data.has_password === true, 'should indicate password is set');
});

await test('POST /v1/ghii — a weak password is REFUSED, never silently dropped', async () => {
    // The strength gate and the hashing line below it were independently conditioned on length:
    // with the gate gone a short password produced passwordHash undefined and an account that
    // silently could not be logged into. The refusal is what the suite has to hold.
    const weakCases: [string, string][] = [
        ['abc', 'too short'],
        ['alllowercase1', 'no uppercase'],
        ['ALLUPPERCASE1', 'no lowercase'],
        ['NoDigitsHere', 'no digit'],
        ['password', 'too common'],
    ];
    for (const [password, why] of weakCases) {
        const name = `weak${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        const data = await api('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: name, display_name: 'Weak', password }),
        });
        assert(data._status === 400, `${why} (${JSON.stringify(password)}) should be 400, got ${data._status}`);
        assert(data.error?.code === 'WEAK_PASSWORD', `expected WEAK_PASSWORD for ${why}, got ${data.error?.code}`);
        // The refusal was real: no account was created behind it. (Checked via the owner profile
        // rather than a login attempt — a login per case would spend the login rate limiter.)
        const probe = await api(`/v1/owners/${name}`);
        assert(probe._status === 404, `a refused registration must not create an account (${why}), got ${probe._status}`);
    }
});

await test('POST /v1/ghii/login — login with correct password (new device requests key)', async () => {
    // request_owner_key simulates a fresh device that holds no signing key locally,
    // so the server mints one and returns the private key.
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: pwPassword, request_owner_key: true }),
    });
    assert(data.ok === true, `Login failed: ${data.error?.message}`);
    assert(typeof data.data.token === 'string', 'should return JWT');
    assert(typeof data.data.owner_private_key === 'string', 'should return owner private key when requested');
    assert(typeof data.data.owner_public_key === 'string', 'should return owner public key');
    assert(data.data.ghii.username === pwUsername, `username mismatch: ${data.data.ghii.username}`);
    pwOwnerJwt = data.data.token;
});

await test('Authenticated ops with password-login JWT (owner JWT)', async () => {
    const data = await authApi('/v1/memory', pwOwnerJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'pw-test', value: { from: 'password login' }, visibility: 'private' }),
    });
    assert(data.ok === true, `Memory store failed: ${data.error?.message}`);
});

await test('POST /v1/ghii/login — wrong password rejected', async () => {
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: 'wrongpass' }),
    });
    assert(data.ok === false, 'wrong password should fail');
    assert(data._status === 401, `expected 401, got ${data._status}`);
});

/**
 * The brute-force lockout was DEAD on BOTH backends and nothing noticed, because the only assertion
 * about a wrong password was the 401 above. The counter is written by updateGHII: Postgres deleted
 * passwordFailedAttempts/passwordLockedUntil as "not columns" (leaving an UPDATE with nothing to set,
 * whose error was swallowed into null), and SQLite left both out of its UPDATE and its row
 * deserializer. Every wrong password therefore read back "0 attempts so far" and
 * config.passwordLockoutAttempts could never engage. Assert the LOCKOUT, not just the rejection.
 *
 * Uses its OWN account: a locked account refuses the correct password too, which would cascade into
 * every later login test in this file.
 */
const lockUsername = `lockout${Date.now()}`;
const lockPassword = 'LockoutPass123';

await test('lockout fixture: register a throwaway password account', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: lockUsername, display_name: 'Lockout User', password: lockPassword }),
    });
    assert(data._status === 201, `expected 201, got ${data._status}: ${data.error?.message}`);
});

await test('POST /v1/ghii/login — repeated wrong passwords LOCK the account (brute-force guard)', async () => {
    const attempts = 6;   // config default is 5 (AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS)
    let locked = false;
    let lastStatus = 0;
    let lastCode = '';
    for (let i = 0; i < attempts; i++) {
        const r = await api('/v1/ghii/login', {
            method: 'POST',
            body: JSON.stringify({ username: lockUsername, password: `wrongpass-${i}` }),
        });
        lastStatus = r._status;
        lastCode = r.error?.code ?? '';
        // Every attempt must be a clean rejection, never a 500 from a failed counter write.
        assert(r._status === 401 || r._status === 423 || r._status === 429,
            `attempt ${i + 1} returned ${r._status} (${lastCode}) — a failed lockout-counter write must not surface as a server error`);
        if (r._status !== 401) { locked = true; break; }
    }
    assert(locked, `after ${attempts} wrong passwords the account was still not locked (last ${lastStatus} ${lastCode}) — the attempt counter is not persisting`);
    // Which mechanism refused matters: accepting "any non-401" cannot tell the brute-force lockout
    // from a plain rate limit, and that is what made the original dead-lockout bug survivable.
    // The lockout answers 429 PASSWORD_LOCKED — the SAME status the rate limiter uses, which is
    // exactly why "any non-401" could not tell the two apart. The code is the discriminator.
    assert(lastCode === 'PASSWORD_LOCKED',
        `the refusal must be the brute-force lockout, not the rate limiter — got ${lastStatus} ${lastCode}`);
});

await test('the lockout also refuses the CORRECT password while it holds', async () => {
    const r = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: lockUsername, password: lockPassword }),
    });
    assert(r.ok === false, 'a locked account must refuse even the correct password');
    assert(r._status !== 200, `expected a refusal, got ${r._status}`);
});

await test('POST /v1/ghii/login — nonexistent user rejected', async () => {
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'nobody_exists_999', password: 'whatever' }),
    });
    assert(data.ok === false, 'nonexistent user should fail');
    assert(data._status === 401, `expected 401, got ${data._status}`);
});

await test('POST /v1/ghii/login — no-password account rejected', async () => {
    // The 'username' account (from Phase 1) was registered without password
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username, password: 'trylogin' }),
    });
    assert(data.ok === false, 'no-password account should reject login');
    assert(data.error?.code === 'NO_PASSWORD', `expected NO_PASSWORD, got: ${data.error?.code}`);
});

await test('POST /v1/ghii/login — re-login without request_owner_key reuses the existing key', async () => {
    // A device that already holds its key logs in again. The server must NOT
    // rotate the owner key (rotating it would invalidate the signing key held by
    // every other device and break their silent refresh), so no private key is
    // returned — but the public key and a working JWT are.
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: pwPassword }),
    });
    assert(data.ok === true, `Second login failed: ${data.error?.message}`);
    const newJwt = data.data.token;
    assert(typeof newJwt === 'string' && newJwt.length > 0, 'should get a JWT');
    assert(data.data.owner_private_key === undefined, 'must NOT return/rotate a private key when not requested');
    assert(typeof data.data.owner_public_key === 'string', 'should still return the existing owner public key');

    // New owner JWT should work for authenticated ops
    const memData = await authApi('/v1/memory/pw-test', newJwt);
    assert(memData.ok === true, 'new JWT from re-login should work');
    assert(memData.data.value.from === 'password login', 'data should match');
});

await test('POST /v1/ghii/login — request_owner_key mints a fresh owner key that works', async () => {
    // A brand-new device (holds no key) explicitly requests one; the server mints
    // and returns it, and the resulting JWT authenticates successfully.
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: pwPassword, request_owner_key: true }),
    });
    assert(data.ok === true, `Key-minting login failed: ${data.error?.message}`);
    assert(typeof data.data.owner_private_key === 'string', 'should return a freshly minted owner private key');
    assert(typeof data.data.owner_public_key === 'string', 'should return owner public key');

    const memData = await authApi('/v1/memory/pw-test', data.data.token);
    assert(memData.ok === true, 'JWT from key-minting login should work');
    assert(memData.data.value.from === 'password login', 'data should match');
});

// ─── Phase 7b: Set initial password on a passwordless (OAuth-style) account ───
// An account created without a password (as Google sign-in does) can later set one
// via /v1/ghii/password/change WITHOUT supplying a current password — enabling
// username + password login alongside the OAuth provider.
console.log('\nPhase 7b — Set initial password on passwordless account');

const noPwUsername = `nopwtest${Date.now()}`;
const noPwNewPassword = 'FreshPass123';
let noPwOwnerJwt = '';

await test('POST /v1/ghii — register WITHOUT a password (OAuth-style)', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: noPwUsername, display_name: 'No Password User' }),
    });
    assert(data.ok === true, `Registration failed: ${data.error?.message}`);
    assert(data.data.has_password === false, 'newly registered passwordless account should report has_password=false');

    // Obtain an owner JWT via signature (the OAuth flow yields a session the same way).
    const timestamp = new Date().toISOString();
    const message = noPwUsername + NODE_ID + timestamp;
    const signature = await signMsg(data.data.private_key, message);
    const tok = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: noPwUsername, timestamp, signature }),
    });
    assert(tok.ok === true, `Owner auth failed: ${tok.error?.message}`);
    noPwOwnerJwt = tok.data.token;
});

await test('GET /v1/ghii/me — reports has_password=false before setting one', async () => {
    const data = await authApi('/v1/ghii/me', noPwOwnerJwt);
    assert(data.ok === true, `me failed: ${data.error?.message}`);
    assert(data.data.has_password === false, `expected has_password=false, got ${data.data.has_password}`);
});

await test('POST /v1/ghii/password/change — sets initial password with NO current_password', async () => {
    const data = await authApi('/v1/ghii/password/change', noPwOwnerJwt, {
        method: 'POST',
        body: JSON.stringify({ new_password: noPwNewPassword }),
    });
    assert(data.ok === true, `set-password failed: ${data.error?.message}`);
    assert(data._status === 200, `expected 200, got ${data._status}`);
});

await test('GET /v1/ghii/me — reports has_password=true after setting one', async () => {
    const data = await authApi('/v1/ghii/me', noPwOwnerJwt);
    assert(data.data.has_password === true, `expected has_password=true, got ${data.data.has_password}`);
});

await test('POST /v1/ghii/login — username + the newly set password now works', async () => {
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: noPwUsername, password: noPwNewPassword }),
    });
    assert(data.ok === true, `login with new password failed: ${data.error?.message}`);
    assert(typeof data.data.token === 'string', 'should return a JWT');
});

await test('POST /v1/ghii/password/change — now that a password exists, current_password is required', async () => {
    const data = await authApi('/v1/ghii/password/change', noPwOwnerJwt, {
        method: 'POST',
        body: JSON.stringify({ new_password: 'AnotherPass123' }),
    });
    assert(data.ok === false, 'should reject change without current_password once a password is set');
    assert(data._status === 400, `expected 400, got ${data._status}`);
    assert(data.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${data.error?.code}`);
});

await test('POST /v1/ghii/password/change — wrong current_password is rejected', async () => {
    const data = await authApi('/v1/ghii/password/change', noPwOwnerJwt, {
        method: 'POST',
        body: JSON.stringify({ current_password: 'WrongPass123', new_password: 'AnotherPass123' }),
    });
    assert(data.ok === false, 'should reject wrong current password');
    assert(data._status === 401, `expected 401, got ${data._status}`);
    assert(data.error?.code === 'WRONG_PASSWORD', `expected WRONG_PASSWORD, got ${data.error?.code}`);
});

// ─── Phase 8: Dev Mode Re-registration ───
console.log('\nPhase 8 — Dev Mode Re-registration');

await test('POST /v1/ghii — re-register same username (dev mode)', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: 'Re-registered User' }),
    });
    // In dev mode, should succeed (old account wiped)
    // In production, would be 409
    if (data.ok) {
        assert(data._status === 201, `expected 201, got ${data._status}`);
        assert(data.data.ghii.display_name === 'Re-registered User', 'display name should be updated');
        // Old JWT should no longer work (agent was deleted)
        const memData = await authApi('/v1/memory/e2e-test', agentJwt);
        // Agent was wiped, memory might still work or might not — just verify we got a response
        console.log(`    (old JWT after re-register: ok=${memData.ok})`);
    } else {
        assert(data._status === 409, `expected 409, got ${data._status}`);
        console.log('    (production mode — re-registration blocked as expected)');
    }
});

// ─── Cleanup ───
console.log('\n─────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
} else {
    console.log('✅ All tests passed!');
}

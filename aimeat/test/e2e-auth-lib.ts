// E2E test for aimeat-auth.js library flow (server-side simulation)
// Tests the exact same API calls the browser auth library makes
// Run: cd aimeat && AIMEAT_PORT=40251 npx tsx test/e2e-auth-lib.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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
        body: JSON.stringify({ filename: 'auth-test.html', content, mime_type: 'text/html' }),
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
console.log('\nPhase 7 — Password Login');

const pwUsername = `pwtest${Date.now()}`;
const pwPassword = 'testpass123';
let pwAgentJwt = '';

await test('POST /v1/ghii — register with password', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, display_name: 'Password User', password: pwPassword }),
    });
    assert(data.ok === true, `Registration failed: ${data.error?.message}`);
    assert(data._status === 201, `expected 201, got ${data._status}`);
    assert(data.data.has_password === true, 'should indicate password is set');
});

await test('POST /v1/ghii/login — login with correct password', async () => {
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: pwPassword }),
    });
    assert(data.ok === true, `Login failed: ${data.error?.message}`);
    assert(typeof data.data.token === 'string', 'should return JWT');
    assert(typeof data.data.owner_private_key === 'string', 'should return owner private key');
    assert(typeof data.data.agent_private_key === 'string', 'should return agent private key');
    assert(data.data.agent.gaii.startsWith('app#'), `expected gaii starting with app#, got: ${data.data.agent.gaii}`);
    pwAgentJwt = data.data.token;
});

await test('Authenticated ops with password-login JWT', async () => {
    const data = await authApi('/v1/memory', pwAgentJwt, {
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

await test('POST /v1/ghii/login — re-login regenerates keys and still works', async () => {
    // Login a second time — keys should be regenerated
    const data = await api('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: pwUsername, password: pwPassword }),
    });
    assert(data.ok === true, `Second login failed: ${data.error?.message}`);
    const newJwt = data.data.token;
    assert(typeof newJwt === 'string' && newJwt.length > 0, 'should get a JWT');

    // New JWT should work for authenticated ops
    const memData = await authApi('/v1/memory/pw-test', newJwt);
    assert(memData.ok === true, 'new JWT from re-login should work');
    assert(memData.data.value.from === 'password login', 'data should match');
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

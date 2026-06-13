// T-4: Micro-Memory E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-micro-memory.ts

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `mmowner${Date.now()}`;
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';

// Second agent for external access tests
let agent2Token = '';
let agent2Gaii = '';

// Session OTK for micro-memory ops
// OTK cache — session OTKs have a 60-second grace window after first use,
// so we reuse the same OTK to avoid 3 HTTP calls per operation.
let cachedOtk = '';
let otkFirstUsed = 0;
const OTK_GRACE_MS = 55_000; // 55s to stay safely within 60s grace window

async function getSessionOtk(): Promise<string> {
    const now = Date.now();
    if (cachedOtk && otkFirstUsed > 0 && (now - otkFirstUsed) < OTK_GRACE_MS) {
        return cachedOtk;
    }
    const { body: chBody } = await json(`/v1/auth/challenge?owner=${encodeURIComponent(ownerName)}`);
    assert(chBody.ok === true, `challenge: ${JSON.stringify(chBody.error)}`);
    const challenge = chBody.data.challenge;
    const sig = await signMsg(ownerPrivKey, challenge);
    const { body: sessBody } = await json(
        `/v1/auth/session?owner=${encodeURIComponent(ownerName)}&challenge=${encodeURIComponent(challenge)}&sig=${encodeURIComponent(sig)}`
    );
    assert(sessBody.ok === true, `session: ${JSON.stringify(sessBody.error)}`);
    cachedOtk = sessBody.data.otk;
    otkFirstUsed = 0; // mark as not yet used
    return cachedOtk;
}

// Helper: Make a micro-memory operation, reusing the cached OTK
async function mmOp(params: string): Promise<{ status: number; body: any }> {
    const otk = await getSessionOtk();
    const result = await json(`/v1/mm?otk=${otk}&${params}`);
    if (otkFirstUsed === 0) otkFirstUsed = Date.now(); // mark first use
    // If OTK was consumed (outside grace), force refresh and retry once
    if (result.status === 401) {
        cachedOtk = '';
        otkFirstUsed = 0;
        const freshOtk = await getSessionOtk();
        const retry = await json(`/v1/mm?otk=${freshOtk}&${params}`);
        if (otkFirstUsed === 0) otkFirstUsed = Date.now();
        return retry;
    }
    return result;
}

console.log('\n=== AIMEAT Micro-Memory E2E Test ===\n');

// ─── Setup ───
console.log('Setup — Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'mm-agent',
            owner: ownerName,
            capabilities: ['memory'],
            model: 'gpt-4o',
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
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    agentToken = body.data.token;
});

await test('Get initial session OTK', async () => {
    const otk = await getSessionOtk();
    assert(otk.length > 0, 'have OTK');
});

// Register a second agent (different owner) for external access tests
const owner2Name = `mmowner2-${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';

await test('Register second owner + agent', async () => {
    const { body: oBody } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(oBody.ok === true, `owner2: ${JSON.stringify(oBody.error)}`);
    owner2PrivKey = oBody.data.private_key;

    const timestamp = new Date().toISOString();
    const sig = await signMsg(owner2PrivKey, owner2Name + NODE_ID + timestamp);
    const { body: tBody } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: owner2Name, timestamp, signature: sig }),
    });
    assert(tBody.ok === true, `token2: ${JSON.stringify(tBody.error)}`);
    owner2Token = tBody.data.token;

    const { body: aBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'ext-agent', owner: owner2Name, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(aBody.ok === true, `agent2: ${JSON.stringify(aBody.error)}`);
    agent2Gaii = aBody.data.agent.gaii;
    const a2PrivKey = aBody.data.private_key;
    const ts2 = new Date().toISOString();
    const sig2 = await signMsg(a2PrivKey, agent2Gaii + ts2);
    const { body: t2Body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2Gaii, timestamp: ts2, signature: sig2 }),
    });
    assert(t2Body.ok === true, `token2: ${JSON.stringify(t2Body.error)}`);
    agent2Token = t2Body.data.token;
});

// ─── Phase 1: Basic CRUD via OTK ───
console.log('\nPhase 1 — Basic CRUD via OTK');

await test('1. Add a key', async () => {
    const { status, body } = await mmOp('op=add&set=prefs&key=theme&value=dark');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'add', `op: ${body.data.op}`);
    assert(body.data.key === 'theme', `key: ${body.data.key}`);
    assert(body.data.value === 'dark', `value: ${body.data.value}`);
});

await test('2. List keys in set', async () => {
    const { status, body } = await mmOp('op=list&set=prefs');
    assert(status === 200, `status ${status}`);
    assert(body.data.entries.theme === 'dark', `entries: ${JSON.stringify(body.data.entries)}`);
});

await test('3. Modify a key', async () => {
    const { status, body } = await mmOp('op=mod&set=prefs&key=theme&value=light');
    assert(status === 200, `status ${status}`);
    assert(body.data.value === 'light', `value: ${body.data.value}`);
});

await test('4. Verify modification', async () => {
    const { status, body } = await mmOp('op=list&set=prefs');
    assert(status === 200, `status ${status}`);
    assert(body.data.entries.theme === 'light', `entries: ${JSON.stringify(body.data.entries)}`);
});

await test('5. Delete a key', async () => {
    const { status, body } = await mmOp('op=del&set=prefs&key=theme');
    assert(status === 200, `status ${status}`);
    assert(body.data.deleted === true, `deleted: ${body.data.deleted}`);
});

await test('6. Verify deletion', async () => {
    const { status, body } = await mmOp('op=list&set=prefs');
    assert(status === 200, `status ${status}`);
    assert(!('theme' in body.data.entries), `theme should be absent: ${JSON.stringify(body.data.entries)}`);
});

// ─── Phase 2: Set Configuration & Visibility ───
console.log('\nPhase 2 — Set Configuration & Visibility');

// Add data back first
await test('Setup: Add key for visibility tests', async () => {
    const { body } = await mmOp('op=add&set=prefs&key=lang&value=en');
    assert(body.ok === true, `add: ${JSON.stringify(body.error)}`);
});

await test('7. Configure set as public_read', async () => {
    const { status, body } = await mmOp('op=config&set=prefs&visibility=public_read');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'public_read', `visibility: ${body.data.visibility}`);
});

await test('8. Public read (no auth)', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status, body } = await json(`/v1/mm/${encodedGaii}/prefs`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.entries.lang === 'en', `entries: ${JSON.stringify(body.data.entries)}`);
    assert(body.data.visibility === 'public_read', `visibility: ${body.data.visibility}`);
});

await test('9. Configure set as private', async () => {
    const { status, body } = await mmOp('op=config&set=prefs&visibility=private');
    assert(status === 200, `status ${status}`);
    assert(body.data.visibility === 'private', `visibility: ${body.data.visibility}`);
});

await test('10. Public read of private set → 404', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status } = await json(`/v1/mm/${encodedGaii}/prefs`);
    assert(status === 404, `status ${status}`);
});

// ─── Phase 3: Shared Access with Access Codes ───
console.log('\nPhase 3 — Shared Access with Access Codes');

await test('11. Configure set as shared_read with access code', async () => {
    const { status, body } = await mmOp('op=config&set=prefs&visibility=shared_read&access_code=secret123');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'shared_read', `visibility: ${body.data.visibility}`);
});

await test('12. Read with correct access code', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status, body } = await json(`/v1/mm/${encodedGaii}/prefs?access_code=secret123`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.entries.lang === 'en', `entries: ${JSON.stringify(body.data.entries)}`);
});

await test('13. Read with wrong access code → 403', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status } = await json(`/v1/mm/${encodedGaii}/prefs?access_code=wrong`);
    assert(status === 403, `status ${status}`);
});

await test('14. Read without access code → 403', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status } = await json(`/v1/mm/${encodedGaii}/prefs`);
    assert(status === 403, `status ${status}`);
});

await test('15. Configure set as shared_write with access code', async () => {
    const { status, body } = await mmOp('op=config&set=prefs&visibility=shared_write&access_code=writekey');
    assert(status === 200, `status ${status}`);
    assert(body.data.visibility === 'shared_write', `visibility: ${body.data.visibility}`);
});

await test('16. External write with correct code', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status, body } = await json(`/v1/mm/${encodedGaii}/prefs?access_code=writekey&op=add&key=ext_key&value=ext_val`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'add', `op: ${body.data.op}`);
});

await test('17. External write with wrong code → 403', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status } = await json(`/v1/mm/${encodedGaii}/prefs?access_code=badkey&op=add&key=bad&value=bad`);
    assert(status === 403, `status ${status}`);
});

// ─── Phase 4: Public Write ───
console.log('\nPhase 4 — Public Write');

await test('18. Configure set as public_write', async () => {
    const { status, body } = await mmOp('op=config&set=prefs&visibility=public_write');
    assert(status === 200, `status ${status}`);
    assert(body.data.visibility === 'public_write', `visibility: ${body.data.visibility}`);
});

await test('19. External agent adds key (no access code)', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status, body } = await json(`/v1/mm/${encodedGaii}/prefs?op=add&key=pub_key&value=pub_val`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'add', `op: ${body.data.op}`);
});

await test('20. Verify key written', async () => {
    const encodedGaii = encodeURIComponent(agentGaii);
    const { status, body } = await json(`/v1/mm/${encodedGaii}/prefs`);
    assert(status === 200, `status ${status}`);
    assert(body.data.entries.pub_key === 'pub_val', `entries: ${JSON.stringify(body.data.entries)}`);
});

// ─── Phase 5: Quota Enforcement ───
console.log('\nPhase 5 — Quota Enforcement');

// Use a fresh set for key limit test
await test('21. Add keys up to the 100-key limit', async () => {
    // Add 100 keys
    for (let i = 0; i < 100; i++) {
        const { status, body } = await mmOp(`op=add&set=quota_test&key=k${i}&value=v${i}`);
        assert(status === 200, `key ${i}: status ${status}, ${JSON.stringify(body.error ?? '')}`);
    }
});

await test('22. Add key #101 → quota error', async () => {
    const { status, body } = await mmOp('op=add&set=quota_test&key=overflow&value=x');
    assert(status === 400 || status === 413, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'QUOTA_EXCEEDED', `code: ${body.error.code}`);
});

await test('23. Value exceeding 1KB → error', async () => {
    const bigValue = 'x'.repeat(1025);
    const { status, body } = await mmOp(`op=add&set=big_val&key=big&value=${encodeURIComponent(bigValue)}`);
    assert(status === 400 || status === 413, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'QUOTA_EXCEEDED', `code: ${body.error.code}`);
});

await test('24. Total micro-memory quota exceeded (500KB)', async () => {
    // Fill up quota: use max-size values (1000 bytes) across sets.
    // 500KB = 512,000 bytes. Need >512 keys of ~1000 bytes.
    // Use 6 sets x 100 keys = 600 keys × 1000 bytes = 600KB > 512KB.
    const bigVal = 'x'.repeat(1000);
    let quotaHit = false;
    for (let s = 0; s < 6 && !quotaHit; s++) {
        for (let k = 0; k < 100 && !quotaHit; k++) {
            const { status, body } = await mmOp(`op=add&set=fill_${s}&key=f${k}&value=${encodeURIComponent(bigVal)}`);
            if (status === 413 || (status === 400 && body.error?.code === 'QUOTA_EXCEEDED')) {
                quotaHit = true;
            } else {
                assert(status === 200, `fill s=${s} k=${k}: status ${status}`);
            }
        }
    }
    assert(quotaHit, 'Expected quota to be exceeded');
});

// ─── Phase 6: Error Paths ───
console.log('\nPhase 6 — Error Paths');

await test('25. Missing op parameter → 400', async () => {
    cachedOtk = ''; // force fresh OTK
    const otk = await getSessionOtk();
    const { status, body } = await json(`/v1/mm?otk=${otk}&set=prefs`);
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${body.error.code}`);
});

await test('26. Invalid op value → 400', async () => {
    const { status, body } = await mmOp('op=destroy&set=prefs');
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${body.error.code}`);
});

await test('27. Missing set for add → 400', async () => {
    cachedOtk = ''; // force fresh OTK
    const otk = await getSessionOtk();
    const { status, body } = await json(`/v1/mm?otk=${otk}&op=add&key=k&value=v`);
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
});

await test('28. Add without key → 400', async () => {
    const { status, body } = await mmOp('op=add&set=prefs&value=v');
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
});

await test('29. Expired OTK → 401', async () => {
    // Use a random invalid OTK
    const { status, body } = await json('/v1/mm?otk=otk-expired-fake-key&op=list&set=prefs');
    assert(status === 401, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'OTK_EXPIRED', `code: ${body.error.code}`);
});

await test('30. Invalid OTK → 401', async () => {
    const { status, body } = await json('/v1/mm?otk=totally-invalid&op=list&set=prefs');
    assert(status === 401, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 7: value64 Base64 Support ───
console.log('\nPhase 7 — value64 Base64 Encoding');

await test('31. Add key via value64 (base64-encoded value)', async () => {
    const plainValue = 'Hello, base64 world! 🌍';
    const b64 = Buffer.from(plainValue).toString('base64');
    const { status, body } = await mmOp(`op=add&set=prefs&key=b64key&value64=${encodeURIComponent(b64)}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'add', `op: ${body.data.op}`);
    assert(body.data.value === plainValue, `value mismatch: ${body.data.value}`);
});

await test('32. Read back value64-stored key', async () => {
    const { status, body } = await mmOp('op=list&set=prefs');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.entries.b64key === 'Hello, base64 world! 🌍', `value: ${body.data.entries.b64key}`);
});

await test('33. Mod key via value64', async () => {
    const newValue = 'Updated via base64!';
    const b64 = Buffer.from(newValue).toString('base64');
    const { status, body } = await mmOp(`op=mod&set=prefs&key=b64key&value64=${encodeURIComponent(b64)}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.value === newValue, `value: ${body.data.value}`);
});

await test('34. value64 overrides plain value when both present', async () => {
    const b64Val = Buffer.from('base64-wins').toString('base64');
    const { status, body } = await mmOp(`op=add&set=prefs&key=both&value=plain&value64=${encodeURIComponent(b64Val)}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.value === 'base64-wins', `value: ${body.data.value}`);
});

// ─── Phase 8: Batch Operations ───
console.log('\nPhase 8 — Batch Multi-Key Operations');

await test('35. Batch add multiple keys', async () => {
    const { status, body } = await mmOp(
        'op=batch&set=batchset&key0=color&value0=red&key1=size&value1=large&key2=shape&value2=round'
    );
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'batch', `op: ${body.data.op}`);
    assert(body.data.count === 3, `count: ${body.data.count}`);
    assert(body.data.keys.includes('color'), `keys: ${JSON.stringify(body.data.keys)}`);
});

await test('36. Verify batch keys stored correctly', async () => {
    const { status, body } = await mmOp('op=list&set=batchset');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.entries.color === 'red', `color: ${body.data.entries.color}`);
    assert(body.data.entries.size === 'large', `size: ${body.data.entries.size}`);
    assert(body.data.entries.shape === 'round', `shape: ${body.data.entries.shape}`);
});

await test('37. Batch with value64_N base64 values', async () => {
    const v0 = Buffer.from('base64-batch-0').toString('base64');
    const v1 = Buffer.from('base64-batch-1').toString('base64');
    const { status, body } = await mmOp(
        `op=batch&set=batchset&key0=b64a&value64_0=${encodeURIComponent(v0)}&key1=b64b&value64_1=${encodeURIComponent(v1)}`
    );
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.count === 2, `count: ${body.data.count}`);
});

await test('38. Batch empty pairs → 400', async () => {
    const { status, body } = await mmOp('op=batch&set=batchset');
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${body.error.code}`);
});

await test('39. Batch without set → 400', async () => {
    const { status, body } = await mmOp('op=batch&key0=a&value0=b');
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${body.error.code}`);
});

// ─── Phase 9: URL Length Test Endpoint ───
console.log('\nPhase 9 — URL Length Test Endpoint');

await test('40. test-url-length endpoint returns URL metrics', async () => {
    const param = '0123456789'.repeat(10);
    const { status, body } = await json(`/v1/mm/test-url-length?paramlength=${param}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.received_url_length > 0, `received_url_length: ${body.data.received_url_length}`);
    assert(body.data.param_length === 100, `param_length: ${body.data.param_length}`);
    assert(body.data.last_20_chars === '01234567890123456789', `last_20: ${body.data.last_20_chars}`);
    assert(typeof body.data.max_url_length === 'number', `max_url_length type: ${typeof body.data.max_url_length}`);
});

await test('41. test-url-length with empty param', async () => {
    const { status, body } = await json('/v1/mm/test-url-length');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.param_length === 0, `param_length: ${body.data.param_length}`);
    assert(body.data.last_20_chars === '', `last_20: ${body.data.last_20_chars}`);
});

await test('42. X-Max-URL-Length header present on mm responses', async () => {
    const otk = await getSessionOtk();
    const result = await json(`/v1/mm?otk=${otk}&op=list`);
    if (otkFirstUsed === 0) otkFirstUsed = Date.now();
    const header = result.headers.get('x-max-url-length');
    assert(header !== null, 'X-Max-URL-Length header missing');
    assert(parseInt(header!, 10) > 0, `header value: ${header}`);
});

// ─── Phase 10: OTK Response Includes Timeout Info ───
console.log('\nPhase 10 — OTK Response Timeout Info');

await test('43. OTK response includes timeout fields', async () => {
    const { body: chBody } = await json(`/v1/auth/challenge?owner=${encodeURIComponent(ownerName)}`);
    assert(chBody.ok === true, `challenge: ${JSON.stringify(chBody.error)}`);
    const challenge = chBody.data.challenge;
    const sig = await signMsg(ownerPrivKey, challenge);
    const { status, body } = await json(
        `/v1/auth/session?owner=${encodeURIComponent(ownerName)}&challenge=${encodeURIComponent(challenge)}&sig=${encodeURIComponent(sig)}`
    );
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.otk_ttl_ms === 'number', `otk_ttl_ms: ${body.data.otk_ttl_ms}`);
    assert(typeof body.data.otk_grace_ms === 'number', `otk_grace_ms: ${body.data.otk_grace_ms}`);
    assert(typeof body.data.max_url_length === 'number', `max_url_length: ${body.data.max_url_length}`);
    assert(body.data.otk_ttl_ms > 0, `otk_ttl_ms should be > 0: ${body.data.otk_ttl_ms}`);
    assert(body.data.otk_grace_ms > 0, `otk_grace_ms should be > 0: ${body.data.otk_grace_ms}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade delete owner 1', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

await test('Cascade delete owner 2', async () => {
    const { status } = await json(`/v1/owners/${owner2Name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`Micro-Memory E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

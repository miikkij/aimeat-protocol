// E2E test for AIMEAT Node Extension System
//
// Prerequisites: Server running on :40251 with AIMEAT_EXTENSIONS_ENABLED=true
// Run: cd aimeat && AIMEAT_EXTENSIONS_ENABLED=true pnpm exec tsx test/e2e-extensions.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  \u2705 ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  \u274C ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key, return base64 signature
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
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `extowner${Date.now()}`;
const agentName = 'extagent';

console.log('\n=== AIMEAT Extension System E2E Test ===\n');

// ─── Phase 0: Setup — Create owner + agent + get tokens ───
console.log('Phase 0 \u2014 Setup');

await test('POST /v1/admin/setup/register \u2014 register owner with operator role', async () => {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ name: ownerName }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.owner?.roles?.includes('operator'), 'has operator role');
    ownerPrivKey = body.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth \u2014 sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('POST /v1/agents \u2014 register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.agent?.gaii?.includes(agentName), 'gaii');
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth \u2014 sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token ok: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ─── Phase 1: Extension Installation ───
console.log('Phase 1 \u2014 Extension Installation');

await test('GET /v1/extensions \u2014 initially empty', async () => {
    const { status, body } = await json('/v1/extensions');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.extensions), 'has extensions array');
    // May not be completely empty if other tests ran, but the call should succeed
    assert(typeof body.data?.total === 'number', 'has total count');
});

const testManifest = `
extension: "1.0"
metadata:
  name: "test-echo"
  version: "1.0.0"
  description: "Simple echo extension for testing"
  author: "test"
required_apis:
  - memory
actions:
  - id: echo
    description: "Echo back the input with a greeting"
    method: POST
    path: "/v1/ext/test-echo/echo"
    script: "actions/echo.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;

const testScripts: Record<string, string> = {
    'actions/echo.js': `export default async function(ctx, input) {
    return { message: 'Hello ' + (input.name || 'World'), caller: ctx.caller.gaii };
  }`,
};

await test('POST /v1/extensions \u2014 install echo extension', async () => {
    const { status, body } = await json('/v1/extensions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: testManifest, scripts: testScripts }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.extension?.name === 'test-echo', 'name matches');
    assert(body.data?.extension?.version === '1.0.0', 'version matches');
    assert(body.data?.extension?.status === 'inactive', 'status is inactive after install');
});

await test('GET /v1/extensions \u2014 echo appears in list', async () => {
    const { status, body } = await json('/v1/extensions');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    const echoExt = body.data.extensions.find((e: any) => e.name === 'test-echo');
    assert(echoExt, 'test-echo found in extensions list');
    assert(echoExt.status === 'inactive', 'status is inactive');
    assert(echoExt.actionCount === 1, 'has 1 action');
});

// ─── Phase 2: Extension Activation ───
console.log('Phase 2 \u2014 Extension Activation');

await test('POST /v1/ext/test-echo/echo \u2014 returns error while inactive', async () => {
    const { status, body } = await json('/v1/ext/test-echo/echo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'AIMEAT' }),
    });
    assert(status === 503, `expected 503, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'not ok');
});

await test('POST /v1/extensions/test-echo/activate \u2014 activate extension', async () => {
    const { status, body } = await json('/v1/extensions/test-echo/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
});

await test('GET /v1/extensions/test-echo \u2014 verify status is active', async () => {
    const { status, body } = await json('/v1/extensions/test-echo');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.extension?.status === 'active', 'status is active');
    assert(body.data?.extension?.activatedAt, 'has activatedAt timestamp');
});

// ─── Cross-owner authorization (TARGET-020) ───
// Owner sessions bypass requireScope, so the canManageInstalledExt guard on activate/deactivate
// is what stops a second owner from toggling the first owner's extension. test-echo is active
// under ownerName here; a second owner must get 403 and change nothing.
await test('Second owner CANNOT deactivate/activate first owner\'s extension (403)', async () => {
    const otherName = `extother${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, otherName + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: otherName, timestamp, signature }) });
    assert(tok.body.ok === true, `token ok: ${JSON.stringify(tok.body.error)}`);
    const otherToken = tok.body.data.token;

    const deact = await json('/v1/extensions/test-echo/deactivate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert(deact.status === 403, `deactivate status ${deact.status}: ${JSON.stringify(deact.body)}`);

    const act = await json('/v1/extensions/test-echo/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert(act.status === 403, `activate status ${act.status}: ${JSON.stringify(act.body)}`);

    const chk = await json('/v1/extensions/test-echo');
    assert(chk.body.data?.extension?.status === 'active', 'test-echo still active after blocked cross-owner calls');

    await json(`/v1/owners/${otherName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherToken}` } });
});

// ─── Phase 3: Action Execution ───
console.log('Phase 3 \u2014 Action Execution');

await test('POST /v1/ext/test-echo/echo \u2014 execute echo action', async () => {
    const { status, body } = await json('/v1/ext/test-echo/echo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'AIMEAT' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.message === 'Hello AIMEAT', `message: ${body.data?.message}`);
    assert(body.data?.caller === agentGaii, `caller: ${body.data?.caller}`);
});

await test('POST /v1/ext/test-echo/echo \u2014 execute with default name', async () => {
    const { status, body } = await json('/v1/ext/test-echo/echo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.message === 'Hello World', `message: ${body.data?.message}`);
});

// ─── Phase 4: Extension with Memory Access ───
console.log('Phase 4 \u2014 Extension with Memory Access');

const memoryExtManifest = `
extension: "1.0"
metadata:
  name: "test-memory"
  version: "1.0.0"
  description: "Extension that tests memory API"
  author: "test"
required_apis:
  - memory
actions:
  - id: store
    description: "Store a value in memory"
    method: POST
    path: "/v1/ext/test-memory/store"
    script: "actions/store.js"
  - id: retrieve
    description: "Retrieve a value from memory"
    method: POST
    path: "/v1/ext/test-memory/retrieve"
    script: "actions/retrieve.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
`;

const memoryScripts: Record<string, string> = {
    'actions/store.js': `export default async function(ctx, input) {
    await ctx.memory.set(input.key, { data: input.value, storedAt: new Date().toISOString() });
    return { stored: true, key: input.key };
  }`,
    'actions/retrieve.js': `export default async function(ctx, input) {
    const result = await ctx.memory.get(input.key);
    return { found: result !== null, value: result };
  }`,
};

await test('POST /v1/extensions \u2014 install memory extension', async () => {
    const { status, body } = await json('/v1/extensions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: memoryExtManifest, scripts: memoryScripts }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.extension?.name === 'test-memory', 'name matches');
    assert(body.data?.extension?.status === 'inactive', 'status is inactive');
});

await test('POST /v1/extensions/test-memory/activate \u2014 activate memory extension', async () => {
    const { status, body } = await json('/v1/extensions/test-memory/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
});

await test('POST /v1/ext/test-memory/store \u2014 store a value via extension', async () => {
    const { status, body } = await json('/v1/ext/test-memory/store', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'ext-test-key', value: 'hello from extension' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.stored === true, 'stored');
    assert(body.data?.key === 'ext-test-key', 'key matches');
});

await test('POST /v1/ext/test-memory/retrieve \u2014 retrieve the stored value', async () => {
    const { status, body } = await json('/v1/ext/test-memory/retrieve', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'ext-test-key' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.found === true, 'found');
    assert(body.data?.value?.data === 'hello from extension', `value: ${JSON.stringify(body.data?.value)}`);
    assert(typeof body.data?.value?.storedAt === 'string', 'has storedAt timestamp');
});

// ─── Phase 5: Deactivation + Uninstallation ───
console.log('Phase 5 \u2014 Deactivation + Uninstallation');

await test('POST /v1/extensions/test-echo/deactivate \u2014 deactivate echo extension', async () => {
    const { status, body } = await json('/v1/extensions/test-echo/deactivate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
});

await test('POST /v1/ext/test-echo/echo \u2014 verify action fails after deactivation', async () => {
    const { status, body } = await json('/v1/ext/test-echo/echo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'AIMEAT' }),
    });
    assert(status === 503, `expected 503, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'not ok');
});

await test('DELETE /v1/extensions/test-echo \u2014 uninstall echo extension', async () => {
    const { status, body } = await json('/v1/extensions/test-echo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === 'test-echo', 'deleted name matches');
});

await test('GET /v1/extensions/test-echo \u2014 verify 404 after uninstall', async () => {
    const { status, body } = await json('/v1/extensions/test-echo');
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('DELETE /v1/extensions/test-memory \u2014 cleanup memory extension', async () => {
    const { status, body } = await json('/v1/extensions/test-memory', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === 'test-memory', 'deleted name matches');
});

// ─── Phase 6: Wallet consume amount guard (CR-1 regression) ───
// A negative consume amount must NOT mint morsels (it would invert the debit).
console.log('Phase 6 — Wallet consume guard (CR-1)');

const walletManifest = `
extension: "1.0"
metadata:
  name: "test-wallet-guard"
  version: "1.0.0"
  description: "Extension that consumes morsels — used to verify the amount guard"
  author: "test"
required_apis:
  - wallet
actions:
  - id: spend
    description: "Consume the given amount and report the result + balance"
    method: POST
    path: "/v1/ext/test-wallet-guard/spend"
    script: "actions/spend.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;

const walletScripts: Record<string, string> = {
    'actions/spend.js': `export default async function(ctx, input) {
    const result = await ctx.wallet.consume(input.amount, 'e2e-cr1');
    const balance = await ctx.wallet.getBalance();
    return { result, balance };
  }`,
};

async function ownerBalance(): Promise<number> {
    const { body } = await json('/v1/wallet', { headers: { Authorization: `Bearer ${ownerToken}` } });
    return body.data?.balance ?? 0;
}

await test('Install + activate wallet-guard extension', async () => {
    const inst = await json('/v1/extensions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: walletManifest, scripts: walletScripts }),
    });
    assert(inst.status === 201, `install status ${inst.status}: ${JSON.stringify(inst.body)}`);
    const act = await json('/v1/extensions/test-wallet-guard/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(act.status === 200, `activate status ${act.status}: ${JSON.stringify(act.body)}`);
});

// The REST consume wrapper rejects bad amounts by throwing INVALID_AMOUNT (matching its
// existing DEBIT_LIMIT throw), so the action surfaces a 500 EXTENSION_ERROR. The security
// invariant we assert is that the balance is NOT minted.
await test('Negative consume amount does NOT mint morsels (CR-1)', async () => {
    const before = await ownerBalance();
    const { status, body } = await json('/v1/ext/test-wallet-guard/spend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ amount: -1000000 }),
    });
    assert(status === 500, `expected 500 (rejected), got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false && /INVALID_AMOUNT/.test(body.error?.message ?? ''),
        `expected INVALID_AMOUNT rejection, got: ${JSON.stringify(body.error)}`);
    const after = await ownerBalance();
    assert(after === before, `balance must be unchanged after negative consume (before=${before}, after=${after})`);
});

await test('Zero consume amount is rejected (CR-1)', async () => {
    const before = await ownerBalance();
    const { status, body } = await json('/v1/ext/test-wallet-guard/spend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ amount: 0 }),
    });
    assert(status === 500, `expected 500 (rejected), got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false && /INVALID_AMOUNT/.test(body.error?.message ?? ''),
        `expected INVALID_AMOUNT rejection, got: ${JSON.stringify(body.error)}`);
    const after = await ownerBalance();
    assert(after === before, `balance must be unchanged after zero consume (before=${before}, after=${after})`);
});

await test('Positive consume amount debits normally (happy path)', async () => {
    const before = await ownerBalance();
    assert(before >= 1, `owner needs >=1 morsel for this test, has ${before}`);
    const { status, body } = await json('/v1/ext/test-wallet-guard/spend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ amount: 1 }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.result?.success === true, `consume should succeed, got: ${JSON.stringify(body.data?.result)}`);
    const after = await ownerBalance();
    assert(after === before - 1, `balance must drop by 1 (before=${before}, after=${after})`);
});

await test('Cleanup wallet-guard extension', async () => {
    const { status } = await json('/v1/extensions/test-wallet-guard', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete status ${status}`);
});

// ─── Phase 7: Extension memory quota (H-5 regression) ───
// ctx.memory.set must enforce the per-value-size hard limit (default 1 MB) — an
// extension writing directly via storage would otherwise bypass it (DoS).
console.log('Phase 7 — Extension memory quota (H-5)');

const memManifest = `
extension: "1.0"
metadata:
  name: "test-mem-quota"
  version: "1.0.0"
  description: "Writes to extension memory — used to verify the value-size limit"
  author: "test"
required_apis:
  - memory
actions:
  - id: bigset
    description: "Set a value of the requested byte size"
    method: POST
    path: "/v1/ext/test-mem-quota/bigset"
    script: "actions/bigset.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;

const memScripts: Record<string, string> = {
    'actions/bigset.js': `export default async function(ctx, input) {
    const big = 'x'.repeat(input.size);
    await ctx.memory.set(input.key || 'blob', big);
    return { ok: true, bytes: big.length };
  }`,
};

await test('Install + activate mem-quota extension', async () => {
    const inst = await json('/v1/extensions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: memManifest, scripts: memScripts }),
    });
    assert(inst.status === 201, `install status ${inst.status}: ${JSON.stringify(inst.body)}`);
    const act = await json('/v1/extensions/test-mem-quota/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(act.status === 200, `activate status ${act.status}: ${JSON.stringify(act.body)}`);
});

await test('Small extension memory write succeeds (happy path)', async () => {
    const { status, body } = await json('/v1/ext/test-mem-quota/bigset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'small', size: 1024 }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.ok === true, `expected ok, got: ${JSON.stringify(body.data)}`);
});

await test('Oversized extension memory write is rejected (H-5)', async () => {
    // 2 MB — exceeds the default 1 MB (memoryMaxValueSizeKb=1024) per-value limit.
    const { status, body } = await json('/v1/ext/test-mem-quota/bigset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'huge', size: 2 * 1024 * 1024 }),
    });
    assert(status === 500, `expected 500 (rejected), got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false && /QUOTA_EXCEEDED/.test(body.error?.message ?? ''),
        `expected QUOTA_EXCEEDED, got: ${JSON.stringify(body.error)}`);
});

await test('Cleanup mem-quota extension', async () => {
    const { status } = await json('/v1/extensions/test-mem-quota', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete status ${status}`);
});

// ─── Cleanup: delete test owner (cascade) ───
console.log('Cleanup');

await json(`/v1/owners/${ownerName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

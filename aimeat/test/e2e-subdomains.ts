// E2E tests for subdomain routing (operator-only management + serving)
// Run: cd aimeat && pnpm exec tsx test/e2e-subdomains.ts

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        redirect: 'manual',
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let opToken = '';
let opPrivKey = '';
const opName = `testsubop${Date.now()}`;

let nonOpToken = '';
let nonOpPrivKey = '';
const nonOpName = `testsubuser${Date.now()}`;

const APP_FILENAME = 'sub-e2e-app.html';
const APP_HTML = '<!doctype html><html><head><title>Sub E2E</title></head><body><h1>subdomain-e2e-marker</h1></body></html>';
const SUB = 'sube2etest';
const REDIR_SUB = 'sube2eredir';

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${opToken}` } };
}

// ─── Setup ───
console.log('\n=== AIMEAT Subdomain Routing E2E Test ===\n');
console.log('Setup');

await test('Register test owner (auto-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: opName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    opPrivKey = body.data.private_key;
    assert(typeof opPrivKey === 'string' && opPrivKey.length > 0, 'got private key');
});

await test('Get operator token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(opPrivKey, opName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: opName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    opToken = body.data?.token;
    assert(typeof opToken === 'string', 'got token');
});

await test('Register non-operator owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: nonOpName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    nonOpPrivKey = body.data.private_key;
});

await test('Get non-operator token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(nonOpPrivKey, nonOpName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: nonOpName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    nonOpToken = body.data?.token;
});

await test('Publish a test app', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: APP_FILENAME,
            content: Buffer.from(APP_HTML).toString('base64'),
            name: 'Sub E2E App',
        }),
    }));
    assert(status === 201 || status === 200, `publish status ${status}: ${JSON.stringify(body)}`);
});

// ─── Auth guards ───
console.log('\nAuth guards');

await test('GET /v1/admin/subdomains without token → 401', async () => {
    const { status } = await json('/v1/admin/subdomains');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/admin/subdomains with non-operator token → 403', async () => {
    const { status } = await json('/v1/admin/subdomains', {
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('POST /v1/admin/subdomains with non-operator token → 403', async () => {
    const { status } = await json('/v1/admin/subdomains', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpToken}` },
        body: JSON.stringify({ subdomain: 'hacker', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Validation ───
console.log('\nValidation');

await test('Reserved subdomain rejected (www) → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'www', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'RESERVED_SUBDOMAIN', `code ${body.error?.code}`);
});

await test('Reserved subdomain rejected (mcp) → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'mcp', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'RESERVED_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Invalid subdomain name rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'Bad_Sub!', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Single-char subdomain rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'a', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Nonexistent app target rejected → 404', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'ghostapp', kind: 'app', target: `${opName}/no-such-app.html` }),
    }));
    assert(status === 404 && body.error?.code === 'APP_NOT_FOUND', `${status} ${body.error?.code}`);
});

await test('Invalid redirect target rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'badredir', kind: 'redirect', target: 'not-a-url' }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_TARGET', `${status} ${body.error?.code}`);
});

// ─── CRUD + serving ───
console.log('\nCRUD + serving');

await test('Create app mapping → 201', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB, kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.site?.subdomain === SUB, 'site echoed');
    assert(body.data?.site?.enabled === true, 'enabled by default');
});

await test('Duplicate mapping → 409', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB, kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 409 && body.error?.code === 'ALREADY_EXISTS', `${status} ${body.error?.code}`);
});

await test('Uppercase subdomain input normalized to lowercase', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB.toUpperCase(), kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    // Normalizes to the same lowercase subdomain → conflict, not a parallel entry
    assert(status === 409, `expected 409 for uppercase duplicate, got ${status}: ${JSON.stringify(body)}`);
});

await test('List mappings includes the new one', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed());
    assert(status === 200, `status ${status}`);
    const subs = (body.data?.sites ?? []).map((s: any) => s.subdomain);
    assert(subs.includes(SUB), `sites: ${subs.join(',')}`);
});

await test('Subdomain root serves the app HTML', async () => {
    const { status, body, headers } = await json('/', { headers: { 'X-Subdomain': SUB, 'Host': `${SUB}.aimeat.io` } });
    assert(status === 200, `status ${status}`);
    assert((headers.get('content-type') ?? '').includes('text/html'), `content-type ${headers.get('content-type')}`);
    assert(typeof body._raw === 'string' && body._raw.includes('subdomain-e2e-marker'), 'app HTML served');
});

await test('X-Subdomain header is case-insensitive', async () => {
    const { status, body } = await json('/', { headers: { 'X-Subdomain': SUB.toUpperCase() } });
    assert(status === 200, `status ${status}`);
    assert(body._raw?.includes('subdomain-e2e-marker'), 'app HTML served');
});

await test('Apex GET / behaves exactly as before (no subdomain)', async () => {
    const { status, body } = await json('/', { headers: { 'Accept': 'application/json' } });
    assert(status === 200 || status === 302, `status ${status}`);
    if (status === 200 && !body._raw) {
        assert(body.ok === true, `apex envelope: ${JSON.stringify(body.error)}`);
    }
});

await test('Unknown subdomain → 404', async () => {
    const { status } = await json('/', { headers: { 'X-Subdomain': 'nosuchsubdomain' } });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Reserved subdomain www → 301 to apex', async () => {
    const { status, headers } = await json('/', { headers: { 'X-Subdomain': 'www' } });
    assert(status === 301, `expected 301, got ${status}`);
    const loc = headers.get('location') ?? '';
    assert(loc.length > 0, 'has Location header');
});

await test('Reserved subdomain (non-www) → 404', async () => {
    const { status } = await json('/', { headers: { 'X-Subdomain': 'admin' } });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Disable mapping → subdomain 404s', async () => {
    const { status, body } = await json(`/v1/admin/subdomains/${SUB}`, authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
    }));
    assert(status === 200 && body.data?.site?.enabled === false, `patch: ${status} ${JSON.stringify(body.data)}`);
    const served = await json('/', { headers: { 'X-Subdomain': SUB } });
    assert(served.status === 404, `expected 404 after disable, got ${served.status}`);
});

await test('Re-enable mapping → serves again', async () => {
    const { status } = await json(`/v1/admin/subdomains/${SUB}`, authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
    }));
    assert(status === 200, `patch status ${status}`);
    const served = await json('/', { headers: { 'X-Subdomain': SUB } });
    assert(served.status === 200 && served.body._raw?.includes('subdomain-e2e-marker'), 'served after re-enable');
});

await test('Redirect mapping → 301 with Location', async () => {
    const { status } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: REDIR_SUB, kind: 'redirect', target: 'https://example.com/landing' }),
    }));
    assert(status === 201, `create redirect status ${status}`);
    const served = await json('/', { headers: { 'X-Subdomain': REDIR_SUB } });
    assert(served.status === 301, `expected 301, got ${served.status}`);
    assert(served.headers.get('location') === 'https://example.com/landing', `location ${served.headers.get('location')}`);
});

await test('PATCH unknown subdomain → 404', async () => {
    const { status } = await json('/v1/admin/subdomains/nosuch', authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('DELETE mapping → subdomain 404s', async () => {
    const { status, body } = await json(`/v1/admin/subdomains/${SUB}`, authed({ method: 'DELETE' }));
    assert(status === 200 && body.data?.deleted === true, `delete: ${status}`);
    const served = await json('/', { headers: { 'X-Subdomain': SUB } });
    assert(served.status === 404, `expected 404 after delete, got ${served.status}`);
});

await test('DELETE again → 404', async () => {
    const { status } = await json(`/v1/admin/subdomains/${SUB}`, authed({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete redirect mapping', async () => {
    const { status } = await json(`/v1/admin/subdomains/${REDIR_SUB}`, authed({ method: 'DELETE' }));
    assert(status === 200, `status ${status}`);
});

await test('Delete test app', async () => {
    const { body } = await json(`/v1/apps/${APP_FILENAME}`, authed({ method: 'DELETE' }));
    assert(body.ok === true, `delete app: ${JSON.stringify(body.error)}`);
});

await test('Delete test operator (cascade)', async () => {
    const { body } = await json(`/v1/owners/${opName}`, authed({ method: 'DELETE' }));
    assert(body.ok === true, `delete operator: ${JSON.stringify(body.error)}`);
});

await test('Delete non-operator test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${nonOpName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(body.ok === true, `delete non-op: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);

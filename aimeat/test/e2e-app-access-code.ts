/**
 * @file e2e-app-access-code.ts
 * @description E2E for the access-code cluster (UX-remake v3, P6). The measured dead end: the
 *   owner's own Open button on a code-protected app landed on raw ACCESS_DENIED JSON, and the
 *   catalog's authenticated Details fetch 403'd silently. Pins the three fixes: (1) an
 *   AUTHENTICATED owner (or operator) bypasses the code on their own app; (2) a BROWSER
 *   navigation without the code gets a human unlock page with a form, not JSON; (3) the /v1/apps
 *   listing hands the code value to the app's OWN owner only — never to another signed-in user
 *   or an anonymous one (that would break the protection outright).
 *
 *   Failure modes covered: wrong code on a browser navigation re-shows the page with the error
 *   line, a non-owner API caller still gets the JSON 403, and the correct ?code= still opens.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-access-code
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerA = `aca${Date.now() % 100000}`;
const ownerB = `acb${Date.now() % 100000}`;
const FILENAME = 'code-test-app.html';
const CODE = 'sekret99';

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
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<{ token: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string };
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const appPath = `/v1/apps/${encodeURIComponent(ownerA)}/${encodeURIComponent(FILENAME)}`;

let tokenA = '';
let tokenB = '';

console.log('\n=== App Access-Code E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owners A + B, publish a protected app under A', async () => {
    tokenA = (await registerOwner(ownerA)).token;
    tokenB = (await registerOwner(ownerB)).token;
    const html = '<!DOCTYPE html><html><head><title>Code Test</title></head><body>secret content</body></html>';
    const r = await json('/v1/apps', auth(tokenA, {
        method: 'POST',
        body: JSON.stringify({
            filename: FILENAME,
            content: Buffer.from(html).toString('base64'),
            mime_type: 'text/html',
            description: 'Access-code e2e fixture',
            access_code: CODE,
        }),
    }));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 1: the owner is never gated by their own code');

await test('AUTHENTICATED owner fetches their protected app without a code → 200', async () => {
    const res = await fetch(`${BASE}${appPath}`, { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(res.status === 200, `owner fetch ${res.status} (the measured silent-403 dead end)`);
    const text = await res.text();
    assert(text.includes('secret content'), 'owner must receive the app bytes');
});

await test('Another signed-in user without the code still gets the JSON 403', async () => {
    const { status, body } = await json(appPath, auth(tokenB));
    assert(status === 403, `non-owner fetch ${status}`);
    assert(body?.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${JSON.stringify(body)}`);
});

console.log('\nPhase 2: a browser gets a human page, not JSON');

await test('Anonymous BROWSER navigation without code → 403 HTML unlock page with a form', async () => {
    const res = await fetch(`${BASE}${appPath}?mode=inline`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    assert(res.status === 403, `browser nav ${res.status}`);
    const text = await res.text();
    assert((res.headers.get('content-type') ?? '').includes('text/html'), 'must be an HTML page');
    assert(text.includes('<form') && text.includes('name="code"'), 'page must carry the code form');
    assert(text.includes('name="mode"'), 'other query params must be preserved as hidden inputs');
});

await test('Wrong code on a browser navigation → unlock page with the mismatch line', async () => {
    const res = await fetch(`${BASE}${appPath}?code=wrong`, { headers: { Accept: 'text/html' } });
    assert(res.status === 403, `wrong code ${res.status}`);
    const text = await res.text();
    assert(text.includes('did not match') || text.includes('ei täsmännyt'), 'mismatch must be said on the page');
});

await test('Anonymous API caller (no text/html) keeps the JSON contract', async () => {
    const { status, body } = await json(appPath);
    assert(status === 403 && body?.error?.code === 'ACCESS_DENIED', `expected JSON 403, got ${status} ${JSON.stringify(body)}`);
});

await test('The correct ?code= opens the app for anyone', async () => {
    const res = await fetch(`${BASE}${appPath}?code=${CODE}`, { headers: { Accept: 'text/html' } });
    assert(res.status === 200, `correct code ${res.status}`);
    assert((await res.text()).includes('secret content'), 'app bytes expected');
});

console.log('\nPhase 3: who the listing shows the code to');

await test('The OWNER sees access_code in the /v1/apps listing', async () => {
    const { body } = await json('/v1/apps?limit=200', auth(tokenA));
    const mine = (body.data?.apps ?? []).find((a: any) => a.owner === ownerA && a.filename === FILENAME);
    assert(!!mine, 'own app must be listed');
    assert(mine.protected === true, 'protected flag expected');
    assert(mine.access_code === CODE, `owner must receive the code value, got ${JSON.stringify(mine.access_code)}`);
});

await test('Another user and an anonymous caller NEVER see the code value', async () => {
    for (const opts of [auth(tokenB), {}]) {
        const { body } = await json('/v1/apps?limit=200', opts as RequestInit);
        const seen = (body.data?.apps ?? []).find((a: any) => a.owner === ownerA && a.filename === FILENAME);
        if (seen) {
            assert(!('access_code' in seen), `code value leaked to a non-owner: ${JSON.stringify(seen.access_code)}`);
            assert(seen.protected === true, 'boolean flag stays visible');
        }
    }
});

console.log(`\n=== App Access-Code: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-app-protect.ts
 * @description E2E tests for opt-in per-app copy-protection (manifest.protection).
 *   Covers: the protection flag lifecycle (PATCH accepts/validates, survives a
 *   re-publish, clears with {}); `obfuscate` (an inline script's local identifier is
 *   mangled in the served inline HTML, restored when cleared); `watermark` (an
 *   invisible aimeat-wm comment is embedded on inline serve, and the operator can
 *   decode it back to viewer/app/version/time while a non-operator cannot);
 *   `noRawDownload` (an outsider is 403'd on the raw attachment while the owner is
 *   not, and inline delivery still works). `domainLock` needs an app origin (none on
 *   the shared test server) and is verified by driving the browser instead.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-protect
 * @version-history
 *   v1.0.0 — 2026-07-07 — initial: obfuscate, watermark + operator decode, noRawDownload.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `prota${Date.now() % 100000}`;   // first owner → operator
const ownerBName = `protb${Date.now() % 100000}`;
const FILE = 'protect-demo.html';
// Local var inside an IIFE so obfuscation renames it (top-level globals are not renamed).
const APP_HTML = `<!DOCTYPE html><html><body><h1>protected demo</h1><script>(function(){var secretToken='AIMEATSECRETVALUE123';console.log(secretToken);})();</script></body></html>`;

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
async function signMsg(priv: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'))).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let aToken = '';
let bToken = '';
const aAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } });
const bAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** Fetch the inline (runnable) HTML of the app as text. */
async function inline(): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}?mode=inline`, { redirect: 'manual' });
    return res.text();
}

console.log('\n=== App copy-protection E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A (operator) + owner B, publish the demo app', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    const pub = await json('/v1/apps', aAuth({ method: 'POST', body: JSON.stringify({ filename: FILE, content: b64(APP_HTML), name: 'Protect Demo', description: 'copy-protection demo', category: 'utility', tags: [] }) }));
    assert(pub.status === 201, `publish status ${pub.status}`);
});

// ── Phase 1: obfuscate ──
console.log('\nPhase 1: obfuscate');

await test('Baseline inline serve exposes the source identifier', async () => {
    const html = await inline();
    if (html.length === 0) { console.log('    (inline 301 / empty — app origin on; skipping)'); return; }
    assert(html.includes('secretToken'), 'un-protected inline HTML contains the original identifier');
});

await test('PATCH { protection: { obfuscate: true } } is accepted', async () => {
    const r = await json(`/v1/apps/${FILE}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: { obfuscate: true } }) }));
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.protection?.obfuscate === true, `response protection.obfuscate true, got ${JSON.stringify(r.body.data?.protection)}`);
});

await test('Obfuscated inline serve mangles the source identifier', async () => {
    const html = await inline();
    if (html.length === 0) return;
    assert(!html.includes('secretToken'), 'obfuscated inline HTML no longer contains the original local identifier');
});

await test('PATCH protection with a non-object is rejected (400)', async () => {
    const r = await json(`/v1/apps/${FILE}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: 'nope' }) }));
    assert(r.status === 400, `non-object protection must 400, got ${r.status}`);
});

// ── Phase 2: watermark + operator decode ──
console.log('\nPhase 2: watermark + operator decode');

let wmToken = '';
await test('PATCH { protection: { watermark: true } }, inline serve embeds an aimeat-wm fingerprint', async () => {
    const r = await json(`/v1/apps/${FILE}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: { watermark: true } }) }));
    assert(r.status === 200, `status ${r.status}`);
    const html = await inline();
    if (html.length === 0) { console.log('    (app origin on; skipping)'); return; }
    const m = html.match(/aimeat-wm:([0-9a-f:]+)/i);
    assert(!!m, 'inline HTML carries an <!--aimeat-wm:...--> fingerprint');
    wmToken = m![1];
});

await test('Operator decodes the watermark back to the app it was served for', async () => {
    if (!wmToken) { console.log('    (no watermark captured; skipping)'); return; }
    const r = await json('/v1/admin/apps/watermark/decode', aAuth({ method: 'POST', body: JSON.stringify({ token: wmToken }) }));
    assert(r.status === 200, `operator decode status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.app === `${ownerAName}/${FILE}`, `decoded app should be ${ownerAName}/${FILE}, got ${r.body.data?.app}`);
    assert(typeof r.body.data?.served_at === 'string', 'decoded served_at present');
});

await test('A non-operator cannot decode a watermark (403)', async () => {
    if (!wmToken) return;
    const r = await json('/v1/admin/apps/watermark/decode', bAuth({ method: 'POST', body: JSON.stringify({ token: wmToken }) }));
    assert(r.status === 403, `non-operator decode must 403, got ${r.status}`);
});

await test('A garbage watermark token is undecodable (422)', async () => {
    const r = await json('/v1/admin/apps/watermark/decode', aAuth({ method: 'POST', body: JSON.stringify({ token: 'deadbeef:deadbeef:deadbeef' }) }));
    assert(r.status === 422, `garbage token must 422, got ${r.status}`);
});

// ── Phase 3: noRawDownload ──
console.log('\nPhase 3: noRawDownload');

await test('PATCH { protection: { noRawDownload: true } } blocks the raw download for outsiders', async () => {
    const r = await json(`/v1/apps/${FILE}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: { noRawDownload: true } }) }));
    assert(r.status === 200, `status ${r.status}`);
    // Outsider (owner B) raw download → 403.
    const outsider = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}`, bAuth());
    assert(outsider.status === 403, `outsider raw download must 403, got ${outsider.status}`);
    // Inline (runnable) delivery still works.
    const runnable = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}?mode=inline`, { redirect: 'manual' });
    assert(runnable.status === 200 || runnable.status === 301, `inline delivery still available, got ${runnable.status}`);
});

await test('The owner can still raw-download their own protected app', async () => {
    const ownerDl = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}`, aAuth());
    assert(ownerDl.status === 200, `owner raw download should be allowed, got ${ownerDl.status}`);
});

// ── Phase 4: re-publish carry-forward + clear ──
console.log('\nPhase 4: carry-forward + clear');

await test('Re-publishing keeps the protection flags (carry-forward)', async () => {
    const pub = await json('/v1/apps', aAuth({ method: 'POST', body: JSON.stringify({ filename: FILE, content: b64(APP_HTML), name: 'Protect Demo', category: 'utility', tags: [] }) }));
    assert(pub.status === 201, `re-publish status ${pub.status}`);
    const stillBlocked = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}`, bAuth());
    assert(stillBlocked.status === 403, `noRawDownload survived the re-publish, got ${stillBlocked.status}`);
});

await test('PATCH { protection: {} } clears all protection', async () => {
    const r = await json(`/v1/apps/${FILE}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: {} }) }));
    assert(r.status === 200, `status ${r.status}`);
    // Raw download is available again, and inline HTML is un-obfuscated + un-watermarked.
    const dl = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}`, bAuth());
    assert(dl.status === 200, `raw download restored, got ${dl.status}`);
    const html = await inline();
    if (html.length === 0) return;
    assert(html.includes('secretToken'), 'inline HTML is un-obfuscated again');
    assert(!/aimeat-wm:/i.test(html), 'no watermark after clearing');
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

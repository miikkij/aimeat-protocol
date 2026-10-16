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
 *   2026-10-16 — Phase 6: an older version is gated by the latest version's access code and pacing
 *     amount, on read and on fork (QA audit F10a-01).
 *   2026-10-15 — Phase 5: an older version is served with the app's current protection
 *     (feature-list audit #103).
 *   v1.0.0 — 2026-07-07 — initial: obfuscate, watermark + operator decode, noRawDownload.
 */

import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let aToken = '';
let bToken = '';
const aAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } });
const bAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } });

/** Fetch the inline (runnable) HTML of the app as text. */
async function inline(): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}?mode=inline`, { redirect: 'manual' });
    return res.text();
}

console.log('\n=== App copy-protection E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A (operator) + owner B, publish the demo app', async () => {
    aToken = (await registerOwner(BASE, ownerAName)).token;
    bToken = (await registerOwner(BASE, ownerBName)).token;
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

// ── Phase 5: an older version is served with the app's current protection ──
// FAILED FIRST, on 2026-10-15 (feature-list audit #103): protection is written on the latest
// version only, and ?version=1 served the first version raw and unprotected.
console.log('\nPhase 5: older versions');
const FILE2 = 'protect-versions.html';

await test('An older version answers with the protection set after it was published', async () => {
    for (let i = 0; i < 2; i++) {
        const pub = await json('/v1/apps', aAuth({ method: 'POST', body: JSON.stringify({ filename: FILE2, content: b64(APP_HTML), name: 'Protect Versions', description: 'protection on older versions', category: 'utility', tags: [] }) }));
        assert(pub.status === 201, `publish ${i + 1}: ${pub.status}`);
    }
    const r = await json(`/v1/apps/${FILE2}`, aAuth({ method: 'PATCH', body: JSON.stringify({ protection: { noRawDownload: true, obfuscate: true } }) }));
    assert(r.status === 200, `status ${r.status}`);
    const v1raw = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE2}?version=1`, bAuth());
    assert(v1raw.status === 403, `an outsider's raw download of version 1 must 403, got ${v1raw.status}`);
    const v1inline = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE2}?version=1&mode=inline`, { redirect: 'manual' });
    const html = v1inline.status === 200 ? await v1inline.text() : '';
    if (html.length > 0) assert(!html.includes('secretToken'), 'version 1 inline HTML is obfuscated too');
    const ownerDl = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE2}?version=1`, aAuth());
    assert(ownerDl.status === 200, `the owner still downloads version 1, got ${ownerDl.status}`);
});

// ── Phase 6: an older version is gated by the access code and the pacing amount of the latest ──
// QA audit F10a-01: a publish writes an access code and a pacing amount on its new row only, so an
// outsider's ?version=1 answered without the code, and read a version from before the pacing amount
// without a licence.
console.log('\nPhase 6: older versions, access code and pacing');
const FILE3 = 'protect-code-versions.html';
const FILE4 = 'protect-paced-versions.html';
const publishV = (file: string, extra: Record<string, unknown> = {}) => json('/v1/apps', aAuth({
    method: 'POST',
    body: JSON.stringify({ filename: file, content: b64(APP_HTML), name: 'Gate Versions', description: 'gates on older versions', category: 'utility', tags: [], ...extra }),
}));

await test('An access code set in the publish of version 2 also gates version 1', async () => {
    assert((await publishV(FILE3)).status === 201, 'publish 1');
    const v2 = await publishV(FILE3, { access_code: 'gate-code-1234' });
    assert(v2.status === 201, `publish 2: ${v2.status} ${JSON.stringify(v2.body.error)}`);
    const v1 = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE3}?version=1`, bAuth());
    assert(v1.status === 403, `an outsider's read of version 1 without the code must 403, got ${v1.status}`);
    const withCode = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE3}?version=1&code=gate-code-1234`, bAuth());
    assert(withCode.status === 200, `with the current code version 1 opens, got ${withCode.status}`);
});

await test('A pacing amount set in the publish of version 2 also gates version 1 (read and fork)', async () => {
    assert((await publishV(FILE4)).status === 201, 'publish 1');
    const v2 = await publishV(FILE4, { toll_morsels: 40, license_type: 'lifetime' });
    assert(v2.status === 201, `publish 2: ${v2.status} ${JSON.stringify(v2.body.error)}`);
    const latest = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE4}`, bAuth());
    if (latest.status === 200) { console.log('    (pacing is off on this node: the app store is disabled; skipped)'); return; }
    assert(latest.status === 402, `the latest version asks for a licence, got ${latest.status}`);
    const v1 = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE4}?version=1`, bAuth());
    assert(v1.status === 402, `an outsider's read of version 1 without a licence must 402, got ${v1.status}`);
    await json(`/v1/apps/${FILE4}`, aAuth({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    const fork = await json(`/v1/apps/${ownerAName}/${FILE4}/fork`, bAuth({ method: 'POST', body: JSON.stringify({ version: 1, new_filename: `fork-${Date.now() % 100000}.html` }) }));
    assert(fork.status === 402, `a fork of version 1 without a licence must 402, got ${fork.status} ${JSON.stringify(fork.body.error)}`);
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

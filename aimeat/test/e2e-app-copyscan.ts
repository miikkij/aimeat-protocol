/**
 * @file e2e-app-copyscan.ts
 * @description E2E for the operator unattributed-copy scan (Phase 4). Covers:
 *   a near-duplicate published by a different owner WITHOUT forking is flagged;
 *   a legitimate fork of a different app is NOT flagged (fork chains are collapsed);
 *   an app whose stored bytes embed another app's per-serve watermark shows up as a
 *   watermark hit; and the endpoint is operator-only.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-copyscan
 * @version-history
 *   v1.0.0 — 2026-07-07 — initial: near-duplicate detection, fork exclusion, watermark hit, authz.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const A = `scana${Date.now() % 100000}`;   // first owner → operator
const B = `scanb${Date.now() % 100000}`;
const C = `scanc${Date.now() % 100000}`;

// Two distinct, substantial app bodies (long enough to fingerprint).
const C1 = `<!DOCTYPE html><html><head><title>Budget Tracker</title></head><body><h1>Monthly Budget Tracker</h1><p>Track your income and expenses across categories with rollover and a savings goal projection engine.</p><script>function computeRollover(months){var total=0;for(var i=0;i<months.length;i++){total+=months[i].income-months[i].expenses;}return total;}window.onload=function(){console.log('budget ready',computeRollover([]));};</script></body></html>`;
const C2 = `<!DOCTYPE html><html><head><title>Recipe Book</title></head><body><h1>Family Recipe Book</h1><p>Store recipes with ingredients, steps, and a scaling calculator that adjusts quantities for any serving size.</p><script>function scaleRecipe(qty,from,to){return qty.map(function(q){return q*(to/from);});}window.onload=function(){console.log('recipes ready',scaleRecipe([1,2],4,8));};</script></body></html>`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
async function sign(priv: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(priv, 'base64'))).toString('base64'); }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
async function tok(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return t.body.data.token;
}
const auth = (tk: string, o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tk}` } });
const pairMatches = (pairs: any[], x: string, y: string) => pairs.some((p: any) => (p.a === x && p.b === y) || (p.a === y && p.b === x));

let aTok = '', bTok = '', cTok = '';

console.log('\n=== App unattributed-copy scan E2E ===\n');
console.log('Phase 0: Setup — original + a copy (no fork) + a legit fork of a different app');

await test('Register owners, publish original + base2, an unattributed copy, and a legit fork', async () => {
    aTok = await tok(A); bTok = await tok(B); cTok = await tok(C);
    // A owns two distinct apps, both forkable.
    assert((await json('/v1/apps', auth(aTok, { method: 'POST', body: JSON.stringify({ filename: 'original.html', content: b64(C1), name: 'Budget', description: 'budget tracker', category: 'utility', tags: [] }) }))).status === 201, 'publish original');
    assert((await json('/v1/apps', auth(aTok, { method: 'POST', body: JSON.stringify({ filename: 'base2.html', content: b64(C2), name: 'Recipe', description: 'recipe book', category: 'utility', tags: [] }) }))).status === 201, 'publish base2');
    await json(`/v1/apps/base2.html`, auth(aTok, { method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    // B copies A's original content WITHOUT forking.
    assert((await json('/v1/apps', auth(bTok, { method: 'POST', body: JSON.stringify({ filename: 'copy.html', content: b64(C1), name: 'My Budget', description: 'my budget', category: 'utility', tags: [] }) }))).status === 201, 'publish copy');
    // C legitimately forks base2 (fork endpoint records lineage).
    const f = await json(`/v1/apps/${A}/base2.html/fork`, auth(cTok, { method: 'POST', body: JSON.stringify({ new_filename: 'cfork.html' }) }));
    assert(f.status === 201, `fork base2 status ${f.status}: ${JSON.stringify(f.body)}`);
});

// ── Phase 1: the scan ──
console.log('\nPhase 1: scan');

let scan: any = null;
await test('Operator scan returns 200', async () => {
    const r = await json('/v1/admin/apps/similar', auth(aTok));
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    scan = r.body.data;
    assert(scan.scanned >= 4, `scanned >= 4, got ${scan.scanned}`);
});

await test('The unattributed copy is flagged (high similarity, no fork link)', async () => {
    assert(pairMatches(scan.suspiciousPairs, `${A}/original.html`, `${B}/copy.html`),
        `expected original~copy in suspiciousPairs, got ${JSON.stringify(scan.suspiciousPairs)}`);
});

await test('The legitimate fork is NOT flagged (fork chain collapsed)', async () => {
    assert(!pairMatches(scan.suspiciousPairs, `${A}/base2.html`, `${C}/cfork.html`),
        'base2 and its legit fork must not be flagged as an unattributed copy');
});

// ── Phase 2: watermark hit ──
console.log('\nPhase 2: watermark hit');

await test('An app whose stored bytes embed another app\'s watermark is caught', async () => {
    // Turn on the watermark for original, serve it inline, and lift the fingerprint.
    await json(`/v1/apps/original.html`, auth(aTok, { method: 'PATCH', body: JSON.stringify({ protection: { watermark: true } }) }));
    const served = await (await fetch(`${BASE}/v1/apps/${A}/original.html?mode=inline`, { redirect: 'manual' })).text();
    const m = served.match(/aimeat-wm:[0-9a-f:]+/i);
    if (!m) { console.log('    (no watermark — app origin on or no key; skipping)'); return; }
    // B pastes a served, watermarked copy — the fingerprint rides along in the bytes.
    const wmHtml = `<!DOCTYPE html><html><body><h1>stolen</h1><!--${m[0]}--></body></html>`;
    assert((await json('/v1/apps', auth(bTok, { method: 'POST', body: JSON.stringify({ filename: 'wmcopy.html', content: b64(wmHtml), name: 'WM Copy', description: 'pasted', category: 'utility', tags: [] }) }))).status === 201, 'publish wmcopy');
    const r = await json('/v1/admin/apps/similar', auth(aTok));
    const hit = (r.body.data.watermarkHits ?? []).find((w: any) => w.inApp === `${B}/wmcopy.html`);
    assert(!!hit, `expected a watermark hit for ${B}/wmcopy.html, got ${JSON.stringify(r.body.data.watermarkHits)}`);
    assert(hit.watermarkOf === `${A}/original.html`, `watermark should trace to ${A}/original.html, got ${hit.watermarkOf}`);
});

// ── Phase 3: authorization ──
console.log('\nPhase 3: authorization');

await test('A non-operator cannot run the scan (403)', async () => {
    const r = await json('/v1/admin/apps/similar', auth(bTok));
    assert(r.status === 403, `non-operator scan must 403, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

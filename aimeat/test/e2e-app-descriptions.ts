/**
 * @file e2e-app-descriptions.ts
 * @description E2E tests for per-locale app descriptions (manifest.descriptions map). Covers:
 *   publishing with a { en, fi } descriptions map (returned by GET /v1/apps), PATCH editing the
 *   map in place, blank values dropped, carry-forward across a re-publish, and validation
 *   (non-object descriptions → 400).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-descriptions
 * @version-history
 *   v1.0.0 — 2026-07-20 — initial (Phase 2a multilingual descriptions).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `desc${Date.now() % 100000}`;
const FILE = 'descriptions-demo.html';
const APP_HTML = '<!DOCTYPE html><html><body><h1>descriptions demo</h1></body></html>';

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

let token = '';
const auth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** Fetch this owner's app manifest from the listing (descriptions live on manifest). */
async function manifest(): Promise<any> {
    const r = await json('/v1/apps?limit=200', auth());
    assert(r.status === 200, `list status ${r.status}`);
    const apps = (r.body.data?.apps ?? []) as any[];
    const mine = apps.find((a) => a.filename === FILE && a.owner === ownerName);
    assert(!!mine, `own app ${FILE} present in listing`);
    return mine.manifest;
}

console.log('\n=== App per-locale descriptions E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner', async () => {
    token = await registerOwner(ownerName);
});

// ── Phase 1: publish with a descriptions map ──
console.log('\nPhase 1: publish with { en, fi } descriptions');

await test('Publish with descriptions: { en, fi } → 201', async () => {
    const pub = await json('/v1/apps', auth({
        method: 'POST',
        body: JSON.stringify({
            filename: FILE, content: b64(APP_HTML), name: 'Descriptions Demo',
            description: 'the canonical description',
            descriptions: { en: 'An English description.', fi: 'Suomenkielinen kuvaus.' },
            category: 'utility', tags: [],
        }),
    }));
    assert(pub.status === 201, `publish status ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

await test('GET listing returns manifest.descriptions with en + fi', async () => {
    const m = await manifest();
    assert(m.descriptions?.en === 'An English description.', `en, got ${JSON.stringify(m.descriptions)}`);
    assert(m.descriptions?.fi === 'Suomenkielinen kuvaus.', `fi, got ${JSON.stringify(m.descriptions)}`);
    assert(m.description === 'the canonical description', `canonical description preserved, got ${m.description}`);
});

// ── Phase 2: PATCH edits the map in place, blanks dropped ──
console.log('\nPhase 2: PATCH edits + blank-drop');

await test('PATCH { descriptions: { en, fi } } updates the map; a blank locale is dropped', async () => {
    const r = await json(`/v1/apps/${FILE}`, auth({
        method: 'PATCH',
        body: JSON.stringify({ descriptions: { en: 'Edited English.', fi: '   ' } }),
    }));
    assert(r.status === 200, `patch status ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const m = await manifest();
    assert(m.descriptions?.en === 'Edited English.', `en updated, got ${JSON.stringify(m.descriptions)}`);
    assert(m.descriptions?.fi === undefined, `blank fi dropped, got ${JSON.stringify(m.descriptions)}`);
});

// ── Phase 3: carry-forward across a re-publish ──
console.log('\nPhase 3: carry-forward on re-publish');

await test('Re-publishing WITHOUT descriptions keeps the existing map', async () => {
    const pub = await json('/v1/apps', auth({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(APP_HTML), name: 'Descriptions Demo', category: 'utility', tags: [] }),
    }));
    assert(pub.status === 201, `re-publish status ${pub.status}`);
    const m = await manifest();
    assert(m.descriptions?.en === 'Edited English.', `descriptions survived re-publish, got ${JSON.stringify(m.descriptions)}`);
});

// ── Phase 4: validation ──
console.log('\nPhase 4: validation');

await test('PATCH with a non-object descriptions → 400', async () => {
    const r = await json(`/v1/apps/${FILE}`, auth({ method: 'PATCH', body: JSON.stringify({ descriptions: 'nope' }) }));
    assert(r.status === 400, `non-object descriptions must 400, got ${r.status}`);
});

await test('PATCH with a non-string locale value → 400', async () => {
    const r = await json(`/v1/apps/${FILE}`, auth({ method: 'PATCH', body: JSON.stringify({ descriptions: { en: 123 } }) }));
    assert(r.status === 400, `non-string locale value must 400, got ${r.status}`);
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

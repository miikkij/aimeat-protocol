/**
 * @file aimeat/test/e2e-dependency-map.ts
 * @description The dependency map E2E: an app that loads a cortex and calls an extension gets its
 *   edges from its bytes at publish (bare and pinned addresses, plus the manifest's usesCortex); a
 *   cortex library that calls an extension gets its edge at install and again at upsert; the
 *   extension and cortex lists carry `used_by`, the app list carries `requires`, and
 *   GET /v1/dependencies answers all three ways; a republish replaces the edges; deleting the app
 *   and the cortex removes them; a parked app is counted for a stranger but not named.
 *   Failure modes: ?app= without a slash → 400; no token → 401.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dependency-map
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1; brief doc-mtkr34qa1dg1).
 *   v1.1.0 — 2026-09-03 — A library pack an app includes is an edge: ?pack=, requires.packs, the pack index used_by, and the edge goes with the app.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const ownerA = `depowna${stamp}`;
const ownerB = `depownb${stamp}`;
const CORTEX = `depcx${stamp}`;
const EXT = `depext${stamp}`;
const APP = 'dep-app.html';
const PARKED_APP = 'dep-parked.html';

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
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function makeOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201 || reg.status === 200, `owner ${name}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 120)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const APP_V1 = `<!DOCTYPE html><html><head>
<script src="/v1/cortex/${CORTEX}/libs/dep.js"></script>
<script src="https://example.test/v1/cortex/aimeat-charts@1.1.2/libs/charts.js"></script>
</head><body><script>
fetch('/v1/ext/${EXT}/hello', { method: 'POST' });
fetch('/v1/ext/other-ext@2.0.0/run', { method: 'POST' });
</script></body></html>`;
const APP_V2 = `<!DOCTYPE html><html><body><script>fetch('/v1/ext/${EXT}@1.0.0/hello');</script></body></html>`;
const CORTEX_MANIFEST = (owner: string, version: string) => `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX}
  namespace: ${owner}
spec:
  version: "${version}"
  components:
    - type: lib
      name: dep.js
      filename: dep.js
      exports: [ping]
`;
const LIB_V1 = `(function(A){ A.dep = { ping: () => fetch('/v1/ext/${EXT}/hello') }; })(window.AIMEAT = window.AIMEAT || {});`;
const LIB_V2 = `(function(A){ A.dep = { ping: () => 42 }; })(window.AIMEAT = window.AIMEAT || {});`;

console.log('\n=== AIMEAT Dependency Map E2E ===\n');
console.log(`Base: ${BASE}\n`);

let tokenA = '';
let tokenB = '';

await test('setup: two owners', async () => {
    tokenA = await makeOwner(ownerA);
    tokenB = await makeOwner(ownerB);
});

await test('GET /v1/dependencies needs a token', async () => {
    const { status } = await json('/v1/dependencies');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('a cortex library that calls an extension gets its edge at install', async () => {
    const { status, body } = await json('/v1/cortex', auth(tokenA, { method: 'POST', body: JSON.stringify({ manifest: CORTEX_MANIFEST(ownerA, '1.0.0'), libs: { 'dep.js': LIB_V1 } }) }));
    assert(status === 201, `install ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    // The lib is served only from an active cortex, and the publish check below probes the path.
    const act = await json(`/v1/cortex/${CORTEX}/activate`, auth(tokenA, { method: 'POST' }));
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body).slice(0, 160)}`);
    const { body: d } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenA));
    assert(d.data.used_by.cortexes.some((c: any) => c.name === CORTEX && c.version === '1.0.0' && c.pinned === null), `cortex edge missing: ${JSON.stringify(d.data)}`);
});

await test('an app gets its edges from its bytes at publish: bare, pinned and declared', async () => {
    const { status, body } = await json('/v1/apps', auth(tokenA, { method: 'POST', body: JSON.stringify({ filename: APP, content: b64(APP_V1), name: 'Dep app', description: 'uses things', category: 'utility', uses_cortex: ['declared-cx'] }) }));
    assert(status === 201 || status === 200, `publish ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    const { body: d } = await json(`/v1/dependencies?app=${ownerA}/${APP}`, auth(tokenA));
    const r = d.data.requires;
    const cx = (n: string) => r.cortex.find((c: any) => c.name === n);
    const ex = (n: string) => r.extensions.find((e: any) => e.name === n);
    assert(cx(CORTEX) && cx(CORTEX).pinned === null && cx(CORTEX).via === 'source', `bare cortex edge: ${JSON.stringify(r)}`);
    assert(cx('aimeat-charts') && cx('aimeat-charts').pinned === '1.1.2', `pinned cortex edge: ${JSON.stringify(r)}`);
    assert(cx('declared-cx') && cx('declared-cx').via === 'manifest', `declared cortex edge: ${JSON.stringify(r)}`);
    assert(ex(EXT) && ex(EXT).pinned === null, `bare extension edge: ${JSON.stringify(r)}`);
    assert(ex('other-ext') && ex('other-ext').pinned === '2.0.0', `pinned extension edge: ${JSON.stringify(r)}`);
});

await test('the extension and cortex lists carry used_by, the app list carries requires', async () => {
    const { body: ext } = await json('/v1/extensions');
    // The extension itself need not be installed for the map to know who calls it; the list only
    // shows installed ones, so read the map's answer through the dependencies door as well.
    const { body: d } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenA));
    assert(d.data.used_by.apps_total === 1 && d.data.used_by.apps[0].owner === ownerA && d.data.used_by.apps[0].filename === APP, `extension used_by: ${JSON.stringify(d.data)}`);
    assert(d.data.used_by.cortexes.length === 1, 'cortex dependant missing');
    assert(Array.isArray(ext.data.extensions) && ext.data.extensions.every((e: any) => 'used_by' in e && 'installedBy' in e), 'extension list rows lack used_by/installedBy');
    const { body: cx } = await json('/v1/cortex', auth(tokenA));
    const row = cx.data.extensions.find((e: any) => e.name === CORTEX);
    assert(row && row.used_by.apps === 1 && row.used_by.app_names[0] === `${ownerA}/${APP}`, `cortex list used_by: ${JSON.stringify(row?.used_by)}`);
    const { body: apps } = await json(`/v1/apps?q=Dep%20app`, auth(tokenA));
    const app = apps.data.apps.find((a: any) => a.filename === APP && a.owner === ownerA);
    assert(app && app.requires.extensions.some((e: any) => e.name === EXT) && app.requires.cortex.some((c: any) => c.name === CORTEX), `app list requires: ${JSON.stringify(app?.requires)}`);
});

await test('the whole map lists what exists and who uses it', async () => {
    const { body } = await json('/v1/dependencies', auth(tokenA));
    const e = body.data.extensions.find((x: any) => x.name === EXT);
    assert(e && e.apps === 1 && e.cortexes === 1, `whole map extension row: ${JSON.stringify(e)}`);
    assert(body.data.apps.some((a: any) => a.app === `${ownerA}/${APP}`), 'whole map lacks the app');
});

await test('a republish replaces the edges; a cortex upsert replaces its own', async () => {
    const { status } = await json('/v1/apps', auth(tokenA, { method: 'POST', body: JSON.stringify({ filename: APP, content: b64(APP_V2), name: 'Dep app', description: 'uses less', category: 'utility', uses_cortex: [] }) }));
    assert(status === 201 || status === 200, `republish ${status}`);
    const { body: d } = await json(`/v1/dependencies?app=${ownerA}/${APP}`, auth(tokenA));
    assert(d.data.requires.cortex.length === 0, `stale cortex edges survived: ${JSON.stringify(d.data.requires)}`);
    assert(d.data.requires.extensions.length === 1 && d.data.requires.extensions[0].pinned === '1.0.0', `republished extension edge: ${JSON.stringify(d.data.requires)}`);
    const up = await json(`/v1/cortex/${CORTEX}`, auth(tokenA, { method: 'PUT', body: JSON.stringify({ manifest: CORTEX_MANIFEST(ownerA, '1.1.0'), libs: { 'dep.js': LIB_V2 } }) }));
    assert(up.status === 200, `upsert ${up.status}: ${JSON.stringify(up.body).slice(0, 200)}`);
    const { body: d2 } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenA));
    assert(d2.data.used_by.cortexes.length === 0, `cortex edge survived the upsert: ${JSON.stringify(d2.data.used_by)}`);
});

await test('a parked app is counted for a stranger and named only to its owner', async () => {
    const { status } = await json('/v1/apps', auth(tokenB, { method: 'POST', body: JSON.stringify({ filename: PARKED_APP, content: b64(APP_V1), name: 'Parked dep', description: 'private', category: 'utility', parked: true }) }));
    assert(status === 201 || status === 200, `publish parked ${status}`);
    const parkedNow = await json(`/v1/apps/${PARKED_APP}`, auth(tokenB, { method: 'PATCH', body: JSON.stringify({ parked: true }) }));
    assert(parkedNow.status === 200, `park ${parkedNow.status}: ${JSON.stringify(parkedNow.body).slice(0, 160)}`);
    const { body: mine } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenB));
    const { body: theirs } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenA));
    assert(mine.data.used_by.apps.some((a: any) => a.owner === ownerB), `owner cannot see own parked dependant: ${JSON.stringify(mine.data.used_by)}`);
    assert(theirs.data.used_by.apps_total >= 2, `stranger count lost the parked app: ${JSON.stringify(theirs.data.used_by)}`);
    assert(!theirs.data.used_by.apps.some((a: any) => a.owner === ownerB), `stranger was handed a parked app's name: ${JSON.stringify(theirs.data.used_by)}`);
});

await test('a library pack an app includes is an edge too: ?pack=, requires.packs and the pack index used_by', async () => {
    const src = `<!DOCTYPE html><html><head><script src="/v1/libs/aimeat-auth.js"></script><script src="https://example.test/lib/chartjs@4.js"></script></head><body></body></html>`;
    const pub = await json('/v1/apps', auth(tokenA, { method: 'POST', body: JSON.stringify({ filename: 'dep-pack.html', content: b64(src), name: 'Dep pack app', description: 'includes packs', category: 'utility' }) }));
    assert(pub.status === 201 || pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    const { body: d } = await json(`/v1/dependencies?pack=aimeat-auth`, auth(tokenA));
    assert(d.data.pack === 'aimeat-auth' && d.data.used_by.apps.some((a: any) => a.owner === ownerA && a.filename === 'dep-pack.html'), `?pack= used_by: ${JSON.stringify(d.data)}`);
    const { body: r } = await json(`/v1/dependencies?app=${ownerA}/dep-pack.html`, auth(tokenA));
    const packs = r.data.requires.packs.map((p: any) => p.name).sort();
    assert(packs.join(',') === 'aimeat-auth,chartjs', `requires.packs: ${JSON.stringify(r.data.requires)}`);
    const { body: idx } = await json('/v1/library-packs');
    const chart = idx.data.packs.find((p: any) => p.id === 'chartjs');
    assert(chart && chart.used_by.apps >= 1 && chart.used_by.app_names.includes(`${ownerA}/dep-pack.html`), `pack index used_by: ${JSON.stringify(chart?.used_by)}`);
    const del = await json('/v1/apps/dep-pack.html', auth(tokenA, { method: 'DELETE' }));
    assert(del.status === 200, `delete ${del.status}`);
    const { body: after } = await json(`/v1/dependencies?pack=chartjs`, auth(tokenA));
    assert(!after.data.used_by.apps.some((a: any) => a.filename === 'dep-pack.html'), 'deleted app still listed under the pack');
});

await test('?app= without a slash → 400', async () => {
    const { status, body } = await json('/v1/dependencies?app=nope', auth(tokenA));
    assert(status === 400 && body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${status}`);
});

await test('deleting the app and the cortex removes their edges', async () => {
    const del = await json(`/v1/apps/${APP}`, auth(tokenA, { method: 'DELETE' }));
    assert(del.status === 200, `delete app ${del.status}`);
    const cdel = await json(`/v1/cortex/${CORTEX}`, auth(tokenA, { method: 'DELETE' }));
    assert(cdel.status === 200, `delete cortex ${cdel.status}`);
    await json(`/v1/apps/${PARKED_APP}`, auth(tokenB, { method: 'DELETE' }));
    const { body } = await json(`/v1/dependencies?extension=${EXT}`, auth(tokenA));
    assert(body.data.used_by.apps_total === 0 && body.data.used_by.cortexes.length === 0, `edges survived deletion: ${JSON.stringify(body.data.used_by)}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`Dependency map E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All dependency-map tests passed!\n');

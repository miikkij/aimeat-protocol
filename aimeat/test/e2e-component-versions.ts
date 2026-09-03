/**
 * @file aimeat/test/e2e-component-versions.ts
 * @description Kept versions of extensions and cortexes, and the pinned address. An extension
 *   installed at 1.0.0 and upserted to 1.1.0 keeps both: the bare call runs 1.1.0, the call at
 *   `name@1.0.0` runs the old script, the versions list has two, and an unknown pinned version is a
 *   404 that names it. A cortex installed at 1.0.0 and upserted to 1.1.0: the bare lib address
 *   serves the new bytes (no-cache), `name@1.0.0` the old ones (immutable), and the app that pinned
 *   it shows the pin in the dependency map. Uninstalling drops the kept versions.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=component-versions
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2; brief doc-mtkr34qa1dg1).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const owner = `verowna${stamp}`;
const EXT = `verext${stamp}`;
const CORTEX = `vercx${stamp}`;
const APP = 'ver-app.html';

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
    return { status: res.status, body, headers: res.headers };
}
async function raw(path: string) {
    const res = await fetch(`${BASE}${path}`);
    return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control') ?? '' };
}
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function makeOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `owner ${name}: ${reg.status}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const extManifest = (version: string) => `
extension: "1.0"
metadata:
  name: "${EXT}"
  version: "${version}"
  description: "version test"
  author: "test"
required_apis:
  - memory
actions:
  - id: hello
    description: "Say which version"
    method: POST
    path: "/v1/ext/${EXT}/hello"
    script: "actions/hello.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;
const extScript = (version: string) => ({ 'actions/hello.js': `export default async function(ctx, input) { return { version: '${version}' }; }` });
const cortexManifest = (version: string) => `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX}
  namespace: ${owner}
spec:
  version: "${version}"
  components:
    - type: lib
      name: v.js
      filename: v.js
      exports: [version]
`;
const cortexLib = (version: string) => ({ 'v.js': `window.AIMEAT_VER = '${version}';` });

console.log('\n=== AIMEAT Component Versions E2E ===\n');
console.log(`Base: ${BASE}\n`);

let token = '';

await test('setup: an owner', async () => { token = await makeOwner(owner); });

await test('an extension keeps 1.0.0 and 1.1.0; the bare call runs the latest, the pinned call the old', async () => {
    const inst = await json('/v1/extensions', auth(token, { method: 'POST', body: JSON.stringify({ manifest: extManifest('1.0.0'), scripts: extScript('1.0.0') }) }));
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body).slice(0, 200)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, auth(token, { method: 'POST' }));
    assert(act.status === 200, `activate ${act.status}`);
    const up = await json(`/v1/extensions/${EXT}`, auth(token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest('1.1.0'), scripts: extScript('1.1.0') }) }));
    assert(up.status === 200, `upsert ${up.status}: ${JSON.stringify(up.body).slice(0, 200)}`);

    const bare = await json(`/v1/ext/${EXT}/hello`, auth(token, { method: 'POST', body: '{}' }));
    assert(bare.status === 200 && JSON.stringify(bare.body).includes('"1.1.0"'), `bare call: ${bare.status} ${JSON.stringify(bare.body).slice(0, 200)}`);
    const pinned = await json(`/v1/ext/${EXT}@1.0.0/hello`, auth(token, { method: 'POST', body: '{}' }));
    assert(pinned.status === 200 && JSON.stringify(pinned.body).includes('"1.0.0"'), `pinned call: ${pinned.status} ${JSON.stringify(pinned.body).slice(0, 200)}`);
    const current = await json(`/v1/ext/${EXT}@1.1.0/hello`, auth(token, { method: 'POST', body: '{}' }));
    assert(current.status === 200 && JSON.stringify(current.body).includes('"1.1.0"'), 'pinning the current version runs the current code');

    const { body: list } = await json(`/v1/extensions/${EXT}/versions`, auth(token));
    assert(list.data.current === '1.1.0' && list.data.total === 2, `versions list: ${JSON.stringify(list.data)}`);
    assert(list.data.versions[0].version === '1.1.0' && list.data.versions[1].version === '1.0.0', 'newest first');
    const { body: detail } = await json(`/v1/extensions/${EXT}`, auth(token));
    assert(Array.isArray(detail.data.extension.versions) && detail.data.extension.versions.length === 2, 'detail lacks versions');
});

await test('an unknown pinned version → 404 that names it', async () => {
    const { status, body } = await json(`/v1/ext/${EXT}@9.9.9/hello`, auth(token, { method: 'POST', body: '{}' }));
    assert(status === 404 && /9\.9\.9/.test(body.error?.message ?? ''), `expected 404 naming the version, got ${status} ${JSON.stringify(body).slice(0, 160)}`);
});

await test('a cortex keeps 1.0.0 and 1.1.0; the bare lib is the latest (no-cache), the pinned one the old (immutable)', async () => {
    const inst = await json('/v1/cortex', auth(token, { method: 'POST', body: JSON.stringify({ manifest: cortexManifest('1.0.0'), libs: cortexLib('1.0.0') }) }));
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body).slice(0, 200)}`);
    const act = await json(`/v1/cortex/${CORTEX}/activate`, auth(token, { method: 'POST' }));
    assert(act.status === 200, `activate ${act.status}`);
    const up = await json(`/v1/cortex/${CORTEX}`, auth(token, { method: 'PUT', body: JSON.stringify({ manifest: cortexManifest('1.1.0'), libs: cortexLib('1.1.0') }) }));
    assert(up.status === 200, `upsert ${up.status}: ${JSON.stringify(up.body).slice(0, 200)}`);

    const bare = await raw(`/v1/cortex/${CORTEX}/libs/v.js`);
    assert(bare.status === 200 && bare.text.includes("'1.1.0'") && /no-cache/.test(bare.cache), `bare lib: ${bare.status} ${bare.text} ${bare.cache}`);
    const pinned = await raw(`/v1/cortex/${CORTEX}@1.0.0/libs/v.js`);
    assert(pinned.status === 200 && pinned.text.includes("'1.0.0'") && /immutable/.test(pinned.cache), `pinned lib: ${pinned.status} ${pinned.text} ${pinned.cache}`);
    const missing = await raw(`/v1/cortex/${CORTEX}@0.0.1/libs/v.js`);
    assert(missing.status === 404, `unknown cortex version expected 404, got ${missing.status}`);

    const { body: list } = await json(`/v1/cortex/${CORTEX}/versions`, auth(token));
    assert(list.data.current === '1.1.0' && list.data.total === 2, `cortex versions: ${JSON.stringify(list.data)}`);
    const { body: detail } = await json(`/v1/cortex/${CORTEX}`, auth(token));
    assert(detail.data.versions.length === 2, 'cortex detail lacks versions');
});

await test('an app that pins a version shows the pin in the dependency map', async () => {
    const html = `<!DOCTYPE html><html><head><script src="/v1/cortex/${CORTEX}@1.0.0/libs/v.js"></script></head><body><script>fetch('/v1/ext/${EXT}@1.0.0/hello',{method:'POST'})</script></body></html>`;
    const pub = await json('/v1/apps', auth(token, { method: 'POST', body: JSON.stringify({ filename: APP, content: b64(html), name: 'Ver app', description: 'pins', category: 'utility' }) }));
    assert(pub.status === 201 || pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    const { body } = await json(`/v1/dependencies?app=${owner}/${APP}`, auth(token));
    const cx = body.data.requires.cortex.find((c: any) => c.name === CORTEX);
    const ex = body.data.requires.extensions.find((e: any) => e.name === EXT);
    assert(cx?.pinned === '1.0.0' && ex?.pinned === '1.0.0', `pins not recorded: ${JSON.stringify(body.data.requires)}`);
});

await test('the kept versions and the map refuse a caller without a session (401)', async () => {
    const v1 = await json(`/v1/extensions/${EXT}/versions`);
    assert(v1.status === 401, `anonymous extension versions expected 401, got ${v1.status}`);
    const v2 = await json(`/v1/cortex/${CORTEX}/versions`);
    assert(v2.status === 401, `anonymous cortex versions expected 401, got ${v2.status}`);
    const m = await json(`/v1/dependencies?extension=${EXT}`);
    assert(m.status === 401, `anonymous dependency map expected 401, got ${m.status}`);
});

await test('uninstalling drops the kept versions', async () => {
    await json(`/v1/apps/${APP}`, auth(token, { method: 'DELETE' }));
    const d1 = await json(`/v1/extensions/${EXT}`, auth(token, { method: 'DELETE' }));
    assert(d1.status === 200, `delete extension ${d1.status}`);
    const d2 = await json(`/v1/cortex/${CORTEX}`, auth(token, { method: 'DELETE' }));
    assert(d2.status === 200, `delete cortex ${d2.status}`);
    const gone = await json(`/v1/ext/${EXT}@1.0.0/hello`, auth(token, { method: 'POST', body: '{}' }));
    assert(gone.status === 404, `pinned call after uninstall expected 404, got ${gone.status}`);
    const lib = await raw(`/v1/cortex/${CORTEX}@1.0.0/libs/v.js`);
    assert(lib.status === 404, `pinned lib after uninstall expected 404, got ${lib.status}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`Component versions E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All component-version tests passed!\n');

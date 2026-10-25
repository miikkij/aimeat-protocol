/**
 * @file aimeat/test/e2e-component-namespaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension and cortex names live in the owner's namespace (services/component-address.ts;
 *   wish wish-cortex-and-extension-names-live-in-the-owner-s-namespace, secaudit2026oct22 leads 589 and
 *   2827). A name was a node-wide key: when its owner uninstalled it, the next owner to install the
 *   same name took over every app that loaded it, every consent that named it and every pinned
 *   version number. Now an install is stored as `<owner>/<name>` and nobody else can create a name
 *   under another account's prefix.
 *
 *   ATTACKS (each failed on the code before the change): two owners install the same short name and
 *   the second one's install is refused; a name the first owner freed goes to the second owner, whose
 *   bytes are then served at the first owner's address, pinned version included.
 *
 *   USES THAT STAY: the author keeps calling and managing an install by the bare name it typed; another
 *   account calls it by `<owner>/<name>` (an extension is a service other accounts call); the SDK's
 *   `owner/name` and `owner/name/instance` reach it; the shipped extensions and cortexes keep their bare
 *   names and are reached through `system/<name>` too.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-component-namespaces
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (owner namespaces wish, secaudit2026oct22).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);
const SHORT = `nsx${stamp}`;
const CX = `nscx${stamp}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown) => JSON.stringify(v).slice(0, 300);
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function raw(path: string) {
    const res = await fetch(`${BASE}${path}`);
    return { status: res.status, text: await res.text() };
}
const as = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const extManifest = (who: string) => JSON.stringify({
    metadata: { name: SHORT, version: '1.0.0', description: 'namespace e2e', author: 'e2e' },
    actions: [{ id: 'who', method: 'POST', path: '/who', script: 'who' }],
    limits: { timeout_ms: 5000, max_api_calls: 1 },
});
const extScripts = (who: string) => ({ who: `export default async function(ctx, input){ return { who: '${who}' }; }` });
const cxManifest = (version: string, name = CX) => `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: community
  visibility: public
spec:
  version: "${version}"
  components:
    - type: lib
      name: v.js
      filename: v.js
      exports: [who]
`;
const cxLib = (who: string) => ({ 'v.js': `window.NS_WHO = '${who}';` });
const said = (r: { body: any }) => JSON.stringify(r.body);

console.log('\n=== Extension and cortex names in the owner\'s namespace ===\n');

const alice = await registerOwner(BASE, `nsalice${stamp}`);
const bob = await registerOwner(BASE, `nsbob${stamp}`);
const aliceExt = `${alice.name}/${SHORT}`, bobExt = `${bob.name}/${SHORT}`;
const aliceCx = `${alice.name}/${CX}`, bobCx = `${bob.name}/${CX}`;

await test('two owners install an extension of the same name, and each is stored in its own namespace', async () => {
    const a = await json('/v1/extensions', as(alice.token, { method: 'POST', body: JSON.stringify({ manifest: extManifest('alice'), scripts: extScripts('alice') }) }));
    assert(a.status === 201 && a.body.data.extension.name === aliceExt, `alice: ${a.status} ${short(a.body)}`);
    const b = await json('/v1/extensions', as(bob.token, { method: 'POST', body: JSON.stringify({ manifest: extManifest('bob'), scripts: extScripts('bob') }) }));
    assert(b.status === 201 && b.body.data.extension.name === bobExt, `bob's install of the same name: ${b.status} ${short(b.body)}`);
    for (const [who, token] of [['alice', alice.token], ['bob', bob.token]] as const) {
        const on = await json(`/v1/extensions/${SHORT}/activate`, as(token, { method: 'POST' }));
        assert(on.status === 200, `${who} activates by the bare name: ${on.status} ${short(on.body)}`);
    }
});

await test('the author calls by the bare name and reaches its own; another account calls by the owner\'s name', async () => {
    const own = await json(`/v1/ext/${SHORT}/who`, as(bob.token, { method: 'POST', body: '{}' }));
    assert(own.status === 200 && said(own).includes('"bob"'), `bob's bare call: ${own.status} ${short(own.body)}`);
    const theirs = await json(`/v1/ext/${encodeURIComponent(aliceExt)}/who`, as(bob.token, { method: 'POST', body: '{}' }));
    assert(theirs.status === 200 && said(theirs).includes('"alice"'), `bob calls alice's: ${theirs.status} ${short(theirs.body)}`);
    // The SDK sends `owner/name` literally (AIMEAT.data.action('alice/nsx', 'who')).
    const literal = await json(`/v1/ext/${alice.name}/${SHORT}/who`, as(bob.token, { method: 'POST', body: '{}' }));
    assert(literal.status === 200 && said(literal).includes('"alice"'), `the literal owner/name path: ${literal.status} ${short(literal.body)}`);
});

await test('another account cannot write under the owner\'s name, and a bare name of another account reaches nothing', async () => {
    const put = await json(`/v1/extensions/${encodeURIComponent(aliceExt)}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest('bob'), scripts: extScripts('bob') }) }));
    assert(put.status === 403, `bob's redeploy of alice's: ${put.status} ${short(put.body)}`);
    const off = await json(`/v1/extensions/${encodeURIComponent(aliceExt)}/deactivate`, as(bob.token, { method: 'POST' }));
    assert(off.status === 403, `bob switches alice's off: ${off.status}`);
    const anon = await json(`/v1/extensions/${SHORT}`);
    assert(anon.status === 404, `a bare name without a sign-in names nobody's: ${anon.status}`);
    const detail = await json(`/v1/extensions/${encodeURIComponent(aliceExt)}`);
    assert(detail.status === 200 && detail.body.data.extension.installedBy === alice.name, `alice's by her name: ${detail.status}`);
});

await test('a name the owner freed never goes to another account', async () => {
    const del = await json(`/v1/extensions/${SHORT}`, as(alice.token, { method: 'DELETE' }));
    assert(del.status === 200, `alice uninstalls: ${del.status} ${short(del.body)}`);
    const squat = await json(`/v1/extensions/${encodeURIComponent(aliceExt)}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest('bob'), scripts: extScripts('bob') }) }));
    assert(squat.status === 403 && squat.body.error?.code === 'NAMESPACE_DENIED', `bob creates under alice's name: ${squat.status} ${short(squat.body)}`);
    const call = await json(`/v1/ext/${encodeURIComponent(aliceExt)}/who`, as(bob.token, { method: 'POST', body: '{}' }));
    assert(call.status === 404, `alice's freed address runs nothing: ${call.status} ${short(call.body)}`);
    const again = await json('/v1/extensions', as(alice.token, { method: 'POST', body: JSON.stringify({ manifest: extManifest('alice'), scripts: extScripts('alice') }) }));
    assert(again.status === 201 && again.body.data.extension.name === aliceExt, `alice installs it again under her name: ${again.status} ${short(again.body)}`);
});

await test('two owners install a cortex of the same name, and each serves its own bytes at its own address', async () => {
    for (const [who, token] of [['alice', alice.token], ['bob', bob.token]] as const) {
        const r = await json('/v1/cortex', as(token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0'), libs: cxLib(who) }) }));
        assert(r.status === 201, `${who}'s cortex: ${r.status} ${short(r.body)}`);
        const on = await json(`/v1/cortex/${CX}/activate`, as(token, { method: 'POST' }));
        assert(on.status === 200, `${who} activates by the bare name: ${on.status} ${short(on.body)}`);
    }
    const a = await raw(`/v1/cortex/${alice.name}/${CX}/libs/v.js`);
    const b = await raw(`/v1/cortex/${bob.name}/${CX}/libs/v.js`);
    assert(a.status === 200 && a.text.includes("'alice'"), `alice's lib: ${a.status} ${a.text.slice(0, 80)}`);
    assert(b.status === 200 && b.text.includes("'bob'"), `bob's lib: ${b.status} ${b.text.slice(0, 80)}`);
    const encoded = await raw(`/v1/cortex/${encodeURIComponent(aliceCx)}@1.0.0/libs/v.js`);
    assert(encoded.status === 200 && encoded.text.includes("'alice'"), `the encoded pinned address: ${encoded.status}`);
    const bare = await raw(`/v1/cortex/${CX}/libs/v.js`);
    assert(bare.status === 404, `a bare address names nobody's cortex: ${bare.status}`);
});

await test('a cortex name the owner freed, and its pinned version, never serve another account\'s bytes', async () => {
    const del = await json(`/v1/cortex/${CX}`, as(alice.token, { method: 'DELETE' }));
    assert(del.status === 200, `alice uninstalls: ${del.status} ${short(del.body)}`);
    const squat = await json(`/v1/cortex/${encodeURIComponent(aliceCx)}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: cxManifest('1.0.0', aliceCx), libs: cxLib('bob') }) }));
    assert(squat.status === 403, `bob creates under alice's name: ${squat.status} ${short(squat.body)}`);
    const viaPost = await json('/v1/cortex', as(bob.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('2.0.0', aliceCx), libs: cxLib('bob') }) }));
    assert(viaPost.status !== 201 || viaPost.body.data?.name === bobCx, `bob's install named alice's lands in alice's namespace: ${short(viaPost.body)}`);
    for (const path of [`/v1/cortex/${alice.name}/${CX}/libs/v.js`, `/v1/cortex/${alice.name}/${CX}@1.0.0/libs/v.js`]) {
        const r = await raw(path);
        assert(r.status === 404, `${path} serves after alice's uninstall: ${r.status} ${r.text.slice(0, 80)}`);
    }
});

await test('what the node ships keeps its bare name, and `system/<name>` reaches it too', async () => {
    const bare = await raw('/v1/cortex/aimeat-input/libs/aimeat-input.js');
    const sys = await raw('/v1/cortex/system/aimeat-input/libs/aimeat-input.js');
    assert(bare.status === 200 && sys.status === 200 && bare.text === sys.text, `the bundled cortex: ${bare.status} / ${sys.status}`);
    const ext = await json('/v1/extensions/vocab-finto');
    const extSys = await json(`/v1/extensions/${encodeURIComponent('system/vocab-finto')}`);
    assert(ext.status === extSys.status, `the shipped extension answers alike under both names: ${ext.status} / ${extSys.status}`);
    if (ext.status === 200) assert(extSys.body.data.extension.name === 'vocab-finto', `the alias is the bare record: ${short(extSys.body)}`);
});

console.log('\nCleanup');
for (const [token] of [[alice.token], [bob.token]]) {
    await json(`/v1/extensions/${SHORT}`, as(token, { method: 'DELETE' }));
    await json(`/v1/cortex/${CX}`, as(token, { method: 'DELETE' }));
}

console.log(`\nComponent namespaces E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);

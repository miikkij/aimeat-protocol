/**
 * @file aimeat/test/e2e-component-namespaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner is ADDED to extension and cortex names, and every address that worked before
 *   works as before (services/component-address.ts; wish
 *   wish-cortex-and-extension-names-live-in-the-owner-s-namespace, secaudit2026oct22 leads 589 and
 *   2827). A name was a node-wide key: when its owner uninstalled it, the next owner to install the
 *   same name took over every app that loaded it, every consent that named it and every pinned
 *   version number.
 *
 *   ATTACK (failed on the code before the change): a name the first owner freed goes to the second
 *   owner, whose bytes are then served at the first owner's address, pinned version included. Now the
 *   second owner's install lands in its own namespace, `<owner>/<name>`, and the freed bare address
 *   stays retired until its holder installs it again.
 *
 *   USES THAT STAY: an install keeps its bare name and every answer keeps `name` as the manifest gives
 *   it, with `owner` and `full_name` added; a bare call, a bare lib address and another owner's refusal
 *   answer as before; `<owner>/<name>` (encoded, or the literal owner/name path the SDK sends) is the
 *   exact address everywhere; a name only one account holds in its namespace is reached by the bare
 *   name, and two such accounts make the bare name answer 409 AMBIGUOUS_NAME naming both.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-component-namespaces
 * @version-history
 *   v1.3.1 — 2026-10-30 — The app owner's Don't allow holds the app back, and approving the same request
 *     later releases it (secaudit2026oct26 round 8c, no dead end).
 *   v1.3.0 — 2026-10-29 — A cortex name an account erasure freed stays free for a new holder, and an app
 *     that loaded it loads the new holder's library only after its owner's one-press Allow
 *     (secaudit2026oct26 round 8c, memory-b-08).
 *   v1.2.0 — 2026-10-29 — An account does not install a new extension or cortex under a name that
 *     starts with aimeat- (secaudit2026oct26 round 8c, extensions-02).
 *   v1.1.0 — 2026-10-26 — The owner is added, nothing else changes (Jouni, 2026-10-26: "piti lisätä
 *     omistaja johonkin tohon ja pitää toi formaatti mahdollisimman samana").
 *   v1.0.0 — 2026-10-25 — Initial (owner namespaces wish, secaudit2026oct22).
 */
import { registerOwner, tokenRoles } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);
const SHORT = `nsx${stamp}`;
const AMB = `nsamb${stamp}`;
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

const extManifest = (name: string) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'namespace e2e', author: 'e2e' },
    actions: [{ id: 'who', method: 'POST', path: '/who', script: 'who' }],
    limits: { timeout_ms: 5000, max_api_calls: 1 },
});
const extScripts = (who: string) => ({ who: `export default async function(ctx, input){ return { who: '${who}' }; }` });
const install = (token: string, who: string, name = SHORT) =>
    json('/v1/extensions', as(token, { method: 'POST', body: JSON.stringify({ manifest: extManifest(name), scripts: extScripts(who) }) }));
const call = (token: string, address: string) => json(`/v1/ext/${address}/who`, as(token, { method: 'POST', body: '{}' }));
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

console.log('\n=== The owner added to extension and cortex names ===\n');

const alice = await registerOwner(BASE, `nsalice${stamp}`);
const bob = await registerOwner(BASE, `nsbob${stamp}`);
const carol = await registerOwner(BASE, `nscarol${stamp}`);
const aliceExt = encodeURIComponent(`${alice.name}/${SHORT}`);

await test('an install keeps its bare name, the answer adds the owner, and another owner meets the old refusals', async () => {
    const a = await install(alice.token, 'alice');
    const ext = a.body.data?.extension;
    assert(a.status === 201 && ext.name === SHORT && ext.owner === alice.name && ext.full_name === `${alice.name}/${SHORT}`, `alice: ${a.status} ${short(a.body)}`);
    const on = await json(`/v1/extensions/${SHORT}/activate`, as(alice.token, { method: 'POST' }));
    assert(on.status === 200, `alice activates by the bare name: ${on.status} ${short(on.body)}`);
    const b = await install(bob.token, 'bob');
    assert(b.status === 409, `bob's POST of the same name, as before: ${b.status} ${short(b.body)}`);
    const put = await json(`/v1/extensions/${SHORT}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(SHORT), scripts: extScripts('bob') }) }));
    assert(put.status === 403, `bob's PUT of alice's, as before: ${put.status}`);
    const putFull = await json(`/v1/extensions/${aliceExt}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(SHORT), scripts: extScripts('bob') }) }));
    assert(putFull.status === 403, `bob's PUT of alice's full name: ${putFull.status}`);
});

await test('the bare name, the encoded full name and the literal owner/name path reach the same extension', async () => {
    for (const address of [SHORT, aliceExt, `${alice.name}/${SHORT}`]) {
        const r = await call(bob.token, address);
        assert(r.status === 200 && said(r).includes('"alice"'), `${address}: ${r.status} ${short(r.body)}`);
    }
    const detail = await json(`/v1/extensions/${SHORT}`);
    assert(detail.status === 200 && detail.body.data.extension.name === SHORT, `the bare detail, signed out: ${detail.status}`);
});

await test('a name the owner freed never goes to another account: the next install lands in its own namespace', async () => {
    const del = await json(`/v1/extensions/${SHORT}`, as(alice.token, { method: 'DELETE' }));
    assert(del.status === 200, `alice uninstalls: ${del.status} ${short(del.body)}`);
    const b = await install(bob.token, 'bob');
    const ext = b.body.data?.extension;
    assert(b.status === 201 && ext.name === SHORT && ext.full_name === `${bob.name}/${SHORT}`, `bob installs the freed name: ${b.status} ${short(b.body)}`);
    await json(`/v1/extensions/${SHORT}/activate`, as(bob.token, { method: 'POST' }));
    const own = await call(bob.token, SHORT);
    assert(own.status === 200 && said(own).includes('"bob"'), `bob's own bare call: ${own.status} ${short(own.body)}`);
    const theirs = await call(carol.token, SHORT);
    assert(theirs.status === 404, `alice's freed bare address runs nobody's code for carol: ${theirs.status} ${short(theirs.body)}`);
    const aliceAddr = await call(carol.token, aliceExt);
    assert(aliceAddr.status === 404, `alice's full address runs nothing: ${aliceAddr.status}`);
    const again = await install(alice.token, 'alice');
    assert(again.status === 201 && again.body.data.extension.full_name === `${alice.name}/${SHORT}`, `alice takes her name back: ${again.status} ${short(again.body)}`);
    await json(`/v1/extensions/${SHORT}/activate`, as(alice.token, { method: 'POST' }));
    const back = await call(carol.token, SHORT);
    assert(back.status === 200 && said(back).includes('"alice"'), `the bare address is alice's again: ${back.status} ${short(back.body)}`);
});

await test('a name one account holds in its namespace answers to the bare name; two such accounts are named in a 409', async () => {
    const one = await json(`/v1/extensions/${encodeURIComponent(`${bob.name}/${AMB}`)}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(AMB), scripts: extScripts('bob') }) }));
    assert(one.status === 201 && one.body.data.extension.name === AMB && one.body.data.extension.full_name === `${bob.name}/${AMB}`, `bob asks for his full name: ${one.status} ${short(one.body)}`);
    await json(`/v1/extensions/${AMB}/activate`, as(bob.token, { method: 'POST' }));
    const reached = await call(alice.token, AMB);
    assert(reached.status === 200 && said(reached).includes('"bob"'), `the one holder by the bare name: ${reached.status} ${short(reached.body)}`);
    const two = await json(`/v1/extensions/${encodeURIComponent(`${carol.name}/${AMB}`)}`, as(carol.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(AMB), scripts: extScripts('carol') }) }));
    assert(two.status === 201, `carol asks for hers: ${two.status} ${short(two.body)}`);
    const amb = await call(alice.token, AMB);
    assert(amb.status === 409 && said(amb).includes(`${bob.name}/${AMB}`) && said(amb).includes(`${carol.name}/${AMB}`), `two holders: ${amb.status} ${short(amb.body)}`);
    const exact = await call(alice.token, encodeURIComponent(`${bob.name}/${AMB}`));
    assert(exact.status === 200 && said(exact).includes('"bob"'), `the full name is exact: ${exact.status} ${short(exact.body)}`);
});

await test('a cortex keeps its bare lib address, gains its owner\'s, and a freed name serves nobody else\'s bytes', async () => {
    const r = await json('/v1/cortex', as(alice.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0'), libs: cxLib('alice') }) }));
    assert(r.status === 201, `alice's cortex: ${r.status} ${short(r.body)}`);
    const on = await json(`/v1/cortex/${CX}/activate`, as(alice.token, { method: 'POST' }));
    assert(on.status === 200, `alice activates by the bare name: ${on.status} ${short(on.body)}`);
    for (const path of [`/v1/cortex/${CX}/libs/v.js`, `/v1/cortex/${alice.name}/${CX}/libs/v.js`, `/v1/cortex/${CX}@1.0.0/libs/v.js`]) {
        const lib = await raw(path);
        assert(lib.status === 200 && lib.text.includes("'alice'"), `${path}: ${lib.status} ${lib.text.slice(0, 80)}`);
    }
    const bobSame = await json('/v1/cortex', as(bob.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0'), libs: cxLib('bob') }) }));
    assert(bobSame.status === 403, `bob's install of alice's name, as before: ${bobSame.status} ${short(bobSame.body)}`);

    const del = await json(`/v1/cortex/${CX}`, as(alice.token, { method: 'DELETE' }));
    assert(del.status === 200, `alice uninstalls: ${del.status} ${short(del.body)}`);
    const b = await json('/v1/cortex', as(bob.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('2.0.0'), libs: cxLib('bob') }) }));
    assert(b.status === 201, `bob installs the freed name: ${b.status} ${short(b.body)}`);
    const bobOn = await json(`/v1/cortex/${CX}/activate`, as(bob.token, { method: 'POST' }));
    assert(bobOn.status === 200, `bob activates his own by the bare name: ${bobOn.status} ${short(bobOn.body)}`);
    for (const path of [`/v1/cortex/${CX}/libs/v.js`, `/v1/cortex/${CX}@1.0.0/libs/v.js`, `/v1/cortex/${alice.name}/${CX}/libs/v.js`]) {
        const lib = await raw(path);
        assert(lib.status === 404, `${path} serves after alice's uninstall: ${lib.status} ${lib.text.slice(0, 80)}`);
    }
    const bobs = await raw(`/v1/cortex/${bob.name}/${CX}/libs/v.js`);
    assert(bobs.status === 200 && bobs.text.includes("'bob'"), `bob's at his own address: ${bobs.status}`);
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

await test('an account does not install a new extension or cortex under a name that starts with aimeat- (secaudit2026oct26 round 8c)', async () => {
    // The first account a fresh node registers is its operator, who may; bob never is.
    assert(!tokenRoles(bob.token).includes('operator'), 'bob is not an operator');
    const PRE = `aimeat-nsx${stamp}`;
    const post = await install(bob.token, 'bob', PRE);
    assert(post.status === 409 && post.body.error?.code === 'NAME_RESERVED' && said(post).includes(`${bob.name}-nsx${stamp}`), `POST /v1/extensions: ${post.status} ${short(post.body)}`);
    const put = await json(`/v1/extensions/${PRE}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(PRE), scripts: extScripts('bob') }) }));
    assert(put.status === 409 && put.body.error?.code === 'NAME_RESERVED', `PUT create: ${put.status} ${short(put.body)}`);
    const putFull = await json(`/v1/extensions/${encodeURIComponent(`${bob.name}/${PRE}`)}`, as(bob.token, { method: 'PUT', body: JSON.stringify({ manifest: extManifest(PRE), scripts: extScripts('bob') }) }));
    assert(putFull.status === 409 && putFull.body.error?.code === 'NAME_RESERVED', `PUT create in his own namespace: ${putFull.status} ${short(putFull.body)}`);
    const cx = await json('/v1/cortex', as(bob.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0', PRE), libs: cxLib('bob') }) }));
    assert(cx.status === 409 && cx.body.error?.code === 'NAME_RESERVED', `POST /v1/cortex: ${cx.status} ${short(cx.body)}`);
    const listed = await json('/v1/extensions', as(bob.token));
    assert(!said(listed).includes(PRE), `nothing was written under the name: ${short(listed.body)}`);
    // The account's own names install as before.
    const own = await install(bob.token, 'bob', `nsown${stamp}`);
    assert(own.status === 201, `his own name: ${own.status} ${short(own.body)}`);
    await json(`/v1/extensions/nsown${stamp}`, as(bob.token, { method: 'DELETE' }));
});

await test('a cortex name an account erasure freed stays free; an app that loaded it loads the new holder\'s library only after its owner allows it (secaudit2026oct26 round 8c)', async () => {
    const CX3 = `nscxh${stamp}`;
    const appFile = `nsuse${stamp}.html`;
    const dave = await registerOwner(BASE, `nsdave${stamp}`);
    const d = await json('/v1/cortex', as(dave.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0', CX3), libs: cxLib('dave') }) }));
    assert(d.status === 201, `dave's cortex: ${d.status} ${short(d.body)}`);
    await json(`/v1/cortex/${CX3}/activate`, as(dave.token, { method: 'POST' }));
    // carol's app loads dave's library by its bare name; the page's address is what its browser sends.
    const html = `<!DOCTYPE html><html><head><title>uses</title><script src="/v1/cortex/${CX3}/libs/v.js"></script></head><body>uses</body></html>`;
    const pub = await json('/v1/apps', as(carol.token, { method: 'POST', body: JSON.stringify({ filename: appFile, content: Buffer.from(html).toString('base64'), name: 'Uses a library', description: 'namespace e2e', category: 'utility' }) }));
    assert(pub.status === 201, `carol's app: ${pub.status} ${short(pub.body)}`);
    const fromApp = async () => {
        const res = await fetch(`${BASE}/v1/cortex/${CX3}/libs/v.js`, { headers: { Referer: `${BASE}/v1/apps/${carol.name}/${appFile}?mode=inline` } });
        return { status: res.status, text: await res.text() };
    };
    const before = await fromApp();
    assert(before.status === 200 && before.text.includes("'dave'"), `carol's app loads dave's library: ${before.status}`);

    const gone = await json(`/v1/owners/${dave.name}`, as(dave.token, { method: 'DELETE' }));
    assert(gone.status === 200, `dave's account erasure: ${gone.status} ${short(gone.body)}`);
    const erin = await registerOwner(BASE, `nserin${stamp}`);
    const e = await json('/v1/cortex', as(erin.token, { method: 'POST', body: JSON.stringify({ manifest: cxManifest('1.0.0', CX3), libs: cxLib('erin') }) }));
    assert(e.status === 201, `erin installs the freed name: ${e.status} ${short(e.body)}`);
    const on = await json(`/v1/cortex/${CX3}/activate`, as(erin.token, { method: 'POST' }));
    assert(on.status === 200, `erin activates it by the bare name: ${on.status} ${short(on.body)}`);
    const plain = await raw(`/v1/cortex/${CX3}/libs/v.js`);
    assert(plain.status === 200 && plain.text.includes("'erin'"), `the name stayed free: the bare address serves erin's: ${plain.status}`);

    const held = await fromApp();
    assert(held.status === 404, `carol's app runs erin's library before carol allowed it: ${held.status} ${held.text.slice(0, 80)}`);
    const list = await json('/v1/publish-requests', as(carol.token));
    const ask = (list.body.data?.requests ?? []).find((r: any) => r.kind === 'cortex-holder' && r.name === CX3);
    assert(ask && ask.state === 'awaiting_owner', `carol has the question: ${short(list.body)}`);
    const pending = await json(`/v1/publish-requests/${ask.id}?account=${carol.name}`, as(erin.token));
    assert(pending.status === 200 && pending.body.data.request.state === 'awaiting_owner', `erin sees it pending: ${pending.status} ${short(pending.body)}`);
    // Don't allow holds the app back, and carol can change her mind on the same request later.
    const no = await json(`/v1/publish-requests/${ask.id}/decision`, as(carol.token, { method: 'POST', body: JSON.stringify({ decision: 'decline' }) }));
    assert(no.status === 200, `carol does not allow it: ${no.status} ${short(no.body)}`);
    const stillHeld = await fromApp();
    assert(stillHeld.status === 404, `Don't allow holds carol's app back: ${stillHeld.status}`);
    const yes = await json(`/v1/publish-requests/${ask.id}/decision`, as(carol.token, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }));
    assert(yes.status === 200, `carol allows it later on the same request: ${yes.status} ${short(yes.body)}`);
    const after = await fromApp();
    assert(after.status === 200 && after.text.includes("'erin'"), `carol's app loads erin's library after the Allow: ${after.status}`);
    const told = ((await json('/v1/notifications', as(erin.token))).body?.data?.notifications ?? [])
        .some((n: any) => n.type === 'approval_answer');
    assert(told, 'erin heard the answer');
    await json(`/v1/cortex/${CX3}`, as(erin.token, { method: 'DELETE' }));
    await json(`/v1/apps/${carol.name}/${appFile}`, as(carol.token, { method: 'DELETE' }));
});

console.log('\nCleanup');
for (const token of [alice.token, bob.token, carol.token]) {
    for (const name of [SHORT, AMB]) await json(`/v1/extensions/${name}`, as(token, { method: 'DELETE' }));
    await json(`/v1/cortex/${CX}`, as(token, { method: 'DELETE' }));
}

console.log(`\nComponent namespaces E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-package-compose-holder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/packages/compose packages a cortex only when the composer holds it. A cortex
 *   another account installed, named by the composer's own app (bare, `<holder>/<name>`, or
 *   `<anyone>/<name>`), is named in `expects.cortex` and its manifest and lib files never enter the
 *   composer's package. The composer's own bare and namespaced cortexes still travel in the package.
 * @structure
 *   - Phase 1: fixtures (the holder's private, inactive cortexes; the composer's own cortexes; one app)
 *   - Phase 2: compose (what travels and what is named) and the ZIP export
 *   - Phase 3: another account's public cortex travels while active, and is named while inactive
 * @version-history
 *   v1.1.0 — 2026-11-01 — Phase 3: another account's public, active cortex travels with a note naming
 *     its installer, and a public, inactive one stays in expects.cortex (Jouni's ruling).
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11,
 *     package-compose.ts:planComposeFromApps:cortex-copied-without-holder-check).
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-compose-holder

import yauzl from 'yauzl';
import { registerOwner } from './helpers/owner-login.js';

/** Every file entry of a ZIP, decompressed and joined as text. */
function zipText(buffer: Buffer): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            const parts: string[] = [];
            zipfile!.readEntry();
            zipfile!.on('entry', (entry: yauzl.Entry) => {
                if (/\/$/.test(entry.fileName)) { zipfile!.readEntry(); return; }
                zipfile!.openReadStream(entry, (e, stream) => {
                    if (e || !stream) return reject(e);
                    const chunks: Buffer[] = [];
                    stream.on('data', (c: Buffer) => chunks.push(c));
                    stream.on('end', () => { parts.push(Buffer.concat(chunks).toString('utf8')); zipfile!.readEntry(); });
                });
            });
            zipfile!.on('end', () => resolvePromise(parts.join('\n')));
            zipfile!.on('error', reject);
        });
    });
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const stamp = Date.now() % 1000000;
const composerName = `holdcomp${stamp}`;
const holderName = `holdowner${stamp}`;
/** The holder's private, inactive cortex under a bare name. */
const HELD_BARE = `held-bare-${stamp}`;
/** The holder's private, inactive cortex stored under `<holder>/<name>`. */
const HELD_NS = `held-ns-${stamp}`;
/** The composer's own cortexes: one bare, one stored under `<composer>/<name>`. */
const OWN_BARE = `own-bare-${stamp}`;
const OWN_NS = `own-ns-${stamp}`;
const SECRET = `held-secret-${stamp}`;
const APP = 'holder-probe.html';
const PKG = `holder-pack-${stamp}`;

let composerToken = '';
let holderToken = '';
let groupId = '';

const manifestFor = (name: string, namespace: string) => `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: ${namespace}
  description: ${namespace === holderName ? SECRET : 'own'} manifest text
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: kit
      filename: kit.js
`;

/** Install a cortex at `address` (bare, or `<owner>/<name>` by PUT) and return the stored name. */
async function installCortex(token: string, owner: string, name: string, address: string, marker: string): Promise<string> {
    const body = JSON.stringify({ manifest: manifestFor(name, owner), libs: { 'kit.js': `export const MARK = "${marker}";` } });
    const res = address === name
        ? await json('/v1/cortex', { method: 'POST', headers: authed(token), body })
        : await json(`/v1/cortex/${encodeURIComponent(address)}`, { method: 'PUT', headers: authed(token), body });
    assert(res.status === 201, `install ${address}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.full_name ?? res.body.data.name;
}

console.log('\n═══ Package compose: only the composer\'s own cortexes travel ═══');
console.log('\nPhase 1 — Fixtures');

/** POST /v1/cortex/<address>/<step> (activate or deactivate) as `token`. */
async function cortexStep(token: string, address: string, step: 'activate' | 'deactivate') {
    const r = await json(`/v1/cortex/${encodeURIComponent(address)}/${step}`, { method: 'POST', headers: authed(token), body: '{}' });
    assert(r.status === 200 || r.status === 201, `${step} ${address}: ${r.status} ${JSON.stringify(r.body)}`);
}

await test('Register the cortex holder and the composing owner', async () => {
    // The holder first: the first account on a fresh node is its operator, and the composer must
    // be an ordinary account for the direct reads below to mean anything.
    holderToken = (await registerOwner(BASE, holderName)).token;
    composerToken = (await registerOwner(BASE, composerName)).token;
    assert(!!composerToken && !!holderToken, 'both tokens');
});

await test('The holder installs two private cortexes, activates them once and leaves them inactive', async () => {
    await installCortex(holderToken, holderName, HELD_BARE, HELD_BARE, `${SECRET}-bare-lib`);
    await installCortex(holderToken, holderName, HELD_NS, `${holderName}/${HELD_NS}`, `${SECRET}-ns-lib`);
    // Activated once and deactivated: the lib files stay listed on the record, and no route serves them.
    for (const address of [HELD_BARE, `${holderName}/${HELD_NS}`]) {
        await cortexStep(holderToken, address, 'activate');
        await cortexStep(holderToken, address, 'deactivate');
    }
    for (const address of [HELD_BARE, `${holderName}/${HELD_NS}`]) {
        const r = await json(`/v1/cortex/${encodeURIComponent(address)}`, { headers: authed(composerToken) });
        assert(r.status === 404, `the composer cannot read ${address} directly, got ${r.status}`);
        const lib = await fetch(`${BASE}/v1/cortex/${address}/libs/kit.js`);
        assert(lib.status === 404, `${address}'s lib is not served while inactive, got ${lib.status}`);
        const act = await json(`/v1/cortex/${encodeURIComponent(address)}/activate`, { method: 'POST', headers: authed(composerToken), body: '{}' });
        assert(act.status === 403, `the composer cannot activate ${address}, got ${act.status}`);
    }
});

await test('The composer installs and activates a bare and a namespaced cortex of their own', async () => {
    await installCortex(composerToken, composerName, OWN_BARE, OWN_BARE, 'own-bare-lib');
    await installCortex(composerToken, composerName, OWN_NS, `${composerName}/${OWN_NS}`, 'own-ns-lib');
    await cortexStep(composerToken, OWN_BARE, 'activate');
    await cortexStep(composerToken, `${composerName}/${OWN_NS}`, 'activate');
});

await test('The composer publishes one app that names all of them', async () => {
    const uses = [
        HELD_BARE,
        `${holderName}/${HELD_BARE}`,
        `anyone${stamp}/${HELD_BARE}`,
        `${holderName}/${HELD_NS}`,
        OWN_BARE,
        `${composerName}/${OWN_NS}`,
    ];
    const html = '<!DOCTYPE html><html><head><title>Holder probe</title></head><body><h1>Probe</h1></body></html>';
    const { status, body } = await json('/v1/apps', {
        method: 'POST', headers: authed(composerToken),
        body: JSON.stringify({ filename: APP, content: b64(html), name: 'Holder probe', description: 'Compose fixture', category: 'utility', uses_cortex: uses }),
    });
    assert(status === 201, `publish: ${status} ${JSON.stringify(body)}`);
    const list = await json('/v1/apps?limit=200&own=true', { headers: authed(composerToken) });
    const app = (list.body.data?.apps ?? []).find((a: any) => a.filename === APP);
    const names = (app?.requires?.cortex ?? []).map((c: any) => c.name);
    for (const u of uses) assert(names.includes(u), `the dependency map names ${u}, got ${JSON.stringify(names)}`);
});

console.log('\nPhase 2 — Compose');

await test('Compose packages the composer\'s own cortexes and names the holder\'s', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(composerToken),
        body: JSON.stringify({ name: PKG, apps: [APP], allow_expectations: true }),
    });
    assert(status === 201, `compose: ${status} ${JSON.stringify(body)}`);
    groupId = body.data.packageGroupId;

    const pkg = await json(`/v1/packages/${encodeURIComponent(groupId)}`, { headers: authed(composerToken) });
    const comps = pkg.body.data?.components ?? [];
    const cortexIds = comps.filter((c: any) => c.type === 'cortex').map((c: any) => c.id).sort();
    assert(JSON.stringify(cortexIds) === JSON.stringify([`cortex-${OWN_BARE}`, `cortex-${OWN_NS}`].sort()),
        `only the composer's own cortexes travel, got ${JSON.stringify(cortexIds)}`);
    const ownLibs = comps.filter((c: any) => c.type === 'cortex').map((c: any) => JSON.stringify(JSON.parse(c.content).libs)).join(' ');
    assert(ownLibs.includes('own-bare-lib') && ownLibs.includes('own-ns-lib'),
        `the composer's own cortexes travel with their lib files, got ${ownLibs}`);
    assert(!JSON.stringify(comps).includes(SECRET),
        'no manifest or lib text of the holder\'s cortexes is in the package');

    const expects = JSON.parse(pkg.body.data.manifest).expects;
    for (const n of [HELD_BARE, `${holderName}/${HELD_BARE}`, `anyone${stamp}/${HELD_BARE}`, `${holderName}/${HELD_NS}`]) {
        assert(expects.cortex.includes(n), `${n} is named in expects.cortex, got ${JSON.stringify(expects.cortex)}`);
    }
    for (const n of [OWN_BARE, `${composerName}/${OWN_NS}`]) {
        assert(!expects.cortex.includes(n), `the composer's own ${n} travels, so it is not an expectation`);
    }
    const app = comps.find((c: any) => c.id === APP);
    assert(JSON.stringify((app?.dependencies ?? []).slice().sort()) === JSON.stringify(cortexIds),
        `the app depends on the packaged cortexes, got ${JSON.stringify(app?.dependencies)}`);
});

await test('The exported ZIP carries none of the holder\'s cortex text', async () => {
    const res = await fetch(`${BASE}/v1/packages/${encodeURIComponent(groupId)}/export`, { headers: authed(composerToken) });
    assert(res.status === 200, `export: ${res.status}`);
    const all = await zipText(Buffer.from(await res.arrayBuffer()));
    assert(all.includes('own-bare-lib'), 'the composer\'s own lib is in the ZIP');
    assert(!all.includes(SECRET), 'the holder\'s manifest and lib text are not in the ZIP');
});

console.log('\nPhase 3 — Another account\'s public cortex');

/** The holder's public, active cortexes (bare and `<holder>/<name>`) and a public one left inactive. */
const PUB_BARE = `pub-bare-${stamp}`;
const PUB_NS = `pub-ns-${stamp}`;
const PUB_OFF = `pub-off-${stamp}`;
const PUB_APP = 'public-probe.html';
const PUB_PKG = `public-pack-${stamp}`;
let pubGroupId = '';

await test('The holder installs three cortexes, makes them public and leaves one inactive', async () => {
    await installCortex(holderToken, holderName, PUB_BARE, PUB_BARE, 'pub-bare-lib');
    await installCortex(holderToken, holderName, PUB_NS, `${holderName}/${PUB_NS}`, 'pub-ns-lib');
    await installCortex(holderToken, holderName, PUB_OFF, PUB_OFF, 'pub-off-lib');
    for (const address of [PUB_BARE, `${holderName}/${PUB_NS}`, PUB_OFF]) {
        const r = await json(`/v1/cortex/${encodeURIComponent(address)}/visibility`, {
            method: 'POST', headers: authed(holderToken), body: JSON.stringify({ visibility: 'public' }),
        });
        assert(r.status === 200, `make ${address} public: ${r.status} ${JSON.stringify(r.body)}`);
    }
    await cortexStep(holderToken, PUB_BARE, 'activate');
    await cortexStep(holderToken, `${holderName}/${PUB_NS}`, 'activate');
});

await test('The composer publishes an app that names the three public cortexes', async () => {
    const uses = [PUB_BARE, `${holderName}/${PUB_NS}`, PUB_OFF];
    const html = '<!DOCTYPE html><html><head><title>Public probe</title></head><body><h1>Probe</h1></body></html>';
    const { status, body } = await json('/v1/apps', {
        method: 'POST', headers: authed(composerToken),
        body: JSON.stringify({ filename: PUB_APP, content: b64(html), name: 'Public probe', description: 'Compose fixture', category: 'utility', uses_cortex: uses }),
    });
    assert(status === 201, `publish: ${status} ${JSON.stringify(body)}`);
});

await test('Compose carries the holder\'s public, active cortexes and names the inactive one', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(composerToken),
        body: JSON.stringify({ name: PUB_PKG, apps: [PUB_APP], allow_expectations: true }),
    });
    assert(status === 201, `compose: ${status} ${JSON.stringify(body)}`);
    pubGroupId = body.data.packageGroupId;

    const pkg = await json(`/v1/packages/${encodeURIComponent(pubGroupId)}`, { headers: authed(composerToken) });
    const comps = pkg.body.data?.components ?? [];
    const cortexIds = comps.filter((c: any) => c.type === 'cortex').map((c: any) => c.id).sort();
    assert(JSON.stringify(cortexIds) === JSON.stringify([`cortex-${PUB_BARE}`, `cortex-${PUB_NS}`].sort()),
        `the public, active cortexes travel, got ${JSON.stringify(cortexIds)}`);
    const libs = comps.filter((c: any) => c.type === 'cortex').map((c: any) => JSON.stringify(JSON.parse(c.content).libs)).join(' ');
    assert(libs.includes('pub-bare-lib') && libs.includes('pub-ns-lib'), `they travel with their lib files, got ${libs}`);
    assert(!libs.includes('pub-off-lib'), 'the inactive public cortex does not travel');

    const manifest = JSON.parse(pkg.body.data.manifest);
    assert(manifest.expects.cortex.includes(PUB_OFF), `the inactive one is named in expects.cortex, got ${JSON.stringify(manifest.expects.cortex)}`);
    for (const n of [PUB_BARE, `${holderName}/${PUB_NS}`]) {
        assert(!manifest.expects.cortex.includes(n), `${n} travels, so it is not an expectation`);
    }
    const notes = JSON.stringify(body.data.notes ?? []);
    assert(notes.includes(`${PUB_BARE} (by ${holderName})`), `a note names the installer of the carried cortex, got ${notes}`);
});

console.log('\nCleanup');
await json(`/v1/packages/${encodeURIComponent(groupId)}`, { method: 'DELETE', headers: authed(composerToken) });
await json(`/v1/packages/${encodeURIComponent(pubGroupId)}`, { method: 'DELETE', headers: authed(composerToken) });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-package-compose.ts
 * @description POST /v1/packages/compose — building a package out of apps that already exist.
 *   Two apps load one cortex the owner installed; the package must carry the cortex once, both apps
 *   must depend on it, each app must keep its own name, and what the node itself supplies must be
 *   named rather than copied.
 * @structure
 *   - Phase 1: fixtures (two owners, one owner-installed cortex, three apps)
 *   - Phase 2: compose — components, dedup, dependency order, carried metadata
 *   - Phase 3: install — the composed package registers apps under their own names
 *   - Phase 4: the ZIP round trip keeps the metadata
 *   - Phase 5: updating the whole instance in one act
 *   - Phase 6: refusals (extension, another owner's app, unknown app, no token)
 *   - Phase 7: the skills bound to the apps travel, install bound to the installed copy, never
 *     overwrite the installer's own skill, update, and leave with the uninstall
 * @version-history
 *   v1.1.0 — 2026-09-30 — Phase 7: a package carries the skills bound to its apps.
 *   v1.0.0 — 2026-09-05 — Initial.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-compose

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function authed(token: string) { return { Authorization: `Bearer ${token}` }; }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Register an owner and return its token. */
async function newOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

// ─── State ───────────────────────────────────────────────────────────

const stamp = Date.now() % 1000000;
const ownerName = `composer${stamp}`;
const otherName = `composerb${stamp}`;
const CORTEX = `compose-kit-${stamp}`;
const APP_A = 'compose-shop.html';
const APP_B = 'compose-admin.html';
const APP_EXT = 'compose-needs-ext.html';
const PKG = `compose-pack-${stamp}`;

let ownerToken = '';
let otherToken = '';
let groupId = '';
let encodedGroupId = '';
let exportedZip: Buffer | null = null;
let instanceId = '';
let installedShopFilename = '';

// Both apps load the SAME cortex, which is what proves the dedup. The reference shape is the one
// services/dependency-map.ts reads from the source at publish time.
const htmlFor = (title: string) =>
    `<!DOCTYPE html><html><head><title>${title}</title>`
    + `<script src="/v1/cortex/${CORTEX}/libs/kit.js"></script>`
    + `</head><body><h1>${title}</h1></body></html>`;

// An app that calls an extension. Extensions are never packaged, so composing this must refuse.
const htmlWithExt = `<!DOCTYPE html><html><head><title>Needs ext</title></head><body>`
    + `<script>fetch('/v1/ext/compose-missing-ext/ping');</script></body></html>`;

console.log('\n═══ Package compose E2E ═══');
console.log('\nPhase 1 — Fixtures');

await test('Register the composing owner and a second owner', async () => {
    ownerToken = await newOwner(ownerName);
    otherToken = await newOwner(otherName);
    assert(!!ownerToken && !!otherToken, 'both tokens');
});

await test('Owner installs a cortex of their own', async () => {
    const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX}
  namespace: ${ownerName}
  description: A kit the composed apps load
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: kit
      filename: kit.js
`;
    const { status, body } = await json('/v1/cortex', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ manifest, libs: { 'kit.js': 'export const KIT_MARK = "compose-kit-v1";' } }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.name === CORTEX, `name ${body.data.name}`);

    // Installed is not served. A cortex arrives inactive, and until it is activated
    // /v1/cortex/<name>/libs/<file> answers 404 — which the publish gate reads as an app that would
    // throw before it drew anything, and refuses. The gate is right; the fixture has to be real.
    const act = await json(`/v1/cortex/${encodeURIComponent(CORTEX)}/activate`, {
        method: 'POST', headers: authed(ownerToken), body: JSON.stringify({}),
    });
    assert(act.status === 200 || act.status === 201, `activate: ${act.status} ${JSON.stringify(act.body)}`);

    const lib = await fetch(`${BASE}/v1/cortex/${encodeURIComponent(CORTEX)}/libs/kit.js`);
    assert(lib.status === 200, `the lib is served before any app claims to load it, got ${lib.status}`);
});

await test('Owner publishes two apps that both load that cortex', async () => {
    for (const [filename, name] of [[APP_A, 'Compose Shop'], [APP_B, 'Compose Admin']] as const) {
        const { status, body } = await json('/v1/apps', {
            method: 'POST',
            headers: authed(ownerToken),
            body: JSON.stringify({
                filename,
                content: b64(htmlFor(name)),
                name,
                description: `${name}, a fixture for the compose suite`,
                category: 'utility',
                tags: ['compose', 'fixture'],
                icon: '🧪',
            }),
        });
        assert(status === 201, `publish ${filename}: ${status} ${JSON.stringify(body)}`);
    }
});

await test('The dependency map saw the cortex in both apps', async () => {
    const { body } = await json(`/v1/apps?limit=200&own=true`, { headers: authed(ownerToken) });
    const apps = (body.data?.apps ?? []).filter((a: any) => a.filename === APP_A || a.filename === APP_B);
    assert(apps.length === 2, `both apps listed, got ${apps.length}`);
    for (const a of apps) {
        const cortexNames = (a.requires?.cortex ?? []).map((c: any) => c.name);
        assert(cortexNames.includes(CORTEX),
            `${a.filename} requires ${CORTEX}, got ${JSON.stringify(cortexNames)}`);
    }
});

console.log('\nPhase 2 — Compose');

await test('The shop app has a priced tool list and a data map of its own', async () => {
    const tools = { version: 1, tools: [
        { name: 'quote', description: 'Price a basket.', inputSchema: { type: 'object' }, price: { morsels: 7 }, priceMoney: { amount: 2_000_000, currency: 'EUR' }, exchange: true },
    ] };
    const w = await json('/v1/memory', { method: 'POST', headers: authed(ownerToken), body: JSON.stringify({ key: `apps.${APP_A}.tools`, value: tools, visibility: 'public' }) });
    assert(w.status === 200 || w.status === 201, `tools ${w.status}: ${JSON.stringify(w.body.error)}`);
    const m = await json(`/v1/datamap/apps/${ownerName}/${APP_A}`, { method: 'PUT', headers: authed(ownerToken), body: JSON.stringify({
        spec: 'aimeat.datamap/2', what: 'A small shop that keeps orders.', usedFor: 'Selling a few products.',
        form: 'one-person', arrangement: 'Nothing is stored yet.', machinery: [], leaves: [], held: [], elsewhere: [],
    }) });
    assert(m.status === 200, `datamap ${m.status}: ${JSON.stringify(m.body.error)}`);
});

await test('Compose builds one package from the two apps', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({
            name: PKG,
            apps: [APP_A, APP_B],
            description: 'Two apps and the kit they share',
            category: 'utility',
            tags: ['compose'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    groupId = body.data.packageGroupId;
    encodedGroupId = encodeURIComponent(groupId);

    // Published so the author can install it at once; private so it is not world-visible.
    assert(body.data.status === 'published', `status ${body.data.status}`);
    assert(body.data.visibility === 'private', `visibility ${body.data.visibility}`);
});

await test('The shared cortex is packaged ONCE and both apps depend on it', async () => {
    const { body } = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(ownerToken) });
    const comps = body.data?.components ?? [];
    assert(comps.length === 3, `expected 3 components (1 cortex + 2 apps), got ${comps.length}: ${comps.map((c: any) => c.id).join(', ')}`);

    const cortexComps = comps.filter((c: any) => c.type === 'cortex');
    assert(cortexComps.length === 1, `one cortex component, got ${cortexComps.length}`);
    const cortexId = cortexComps[0].id;

    const appComps = comps.filter((c: any) => c.type === 'app');
    assert(appComps.length === 2, `two app components, got ${appComps.length}`);
    for (const a of appComps) {
        assert((a.dependencies ?? []).includes(cortexId),
            `${a.id} depends on ${cortexId}, got ${JSON.stringify(a.dependencies)}`);
    }
});

await test('The packaged cortex carries its lib bytes, not just its manifest', async () => {
    const { body } = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(ownerToken) });
    const cortex = (body.data?.components ?? []).find((c: any) => c.type === 'cortex');
    const parsed = JSON.parse(cortex.content);
    assert(typeof parsed.manifest === 'string' && parsed.manifest.includes(CORTEX), 'manifest present');
    assert(parsed.libs?.['kit.js']?.includes('compose-kit-v1'),
        `lib bytes present, got ${JSON.stringify(Object.keys(parsed.libs ?? {}))}`);
});

await test('An app component carries its own name, icon and category', async () => {
    const { body } = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(ownerToken) });
    const shop = (body.data?.components ?? []).find((c: any) => c.id === APP_A);
    assert(!!shop, `${APP_A} is a component`);
    assert(shop.meta?.app?.name === 'Compose Shop', `meta name, got ${JSON.stringify(shop.meta)}`);
    assert(shop.meta?.app?.category === 'utility', `meta category, got ${shop.meta?.app?.category}`);
    assert(shop.meta?.app?.icon === '🧪', `meta icon, got ${shop.meta?.app?.icon}`);
    // Deliberately absent: the reasons are on PackageAppMeta in storage/types/apps.ts.
    assert(shop.meta?.app?.seo === undefined, 'seo does not travel');
    assert(shop.meta?.app?.legal === undefined, 'legal does not travel');
});

await test('Compose says what the installing node must supply itself', async () => {
    const { body } = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(ownerToken) });
    const manifest = JSON.parse(body.data.manifest);
    assert(Array.isArray(manifest.expects?.cortex), 'expects.cortex present');
    assert(Array.isArray(manifest.expects?.extensions), 'expects.extensions present');
    assert(Array.isArray(manifest.expects?.packs), 'expects.packs present');
    assert(!manifest.expects.cortex.includes(CORTEX),
        'the owner-installed cortex is packaged, so it is not an expectation');
});

console.log('\nPhase 3 — Install');

await test('The second owner installs it and gets both apps under their own names', async () => {
    // Public first, so a second owner may reach it at all.
    const pub = await json(`/v1/packages/${encodedGroupId}`, {
        method: 'PATCH', headers: authed(ownerToken), body: JSON.stringify({ visibility: 'public' }),
    });
    assert(pub.status === 200, `make public: ${pub.status} ${JSON.stringify(pub.body)}`);

    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({ label: 'A copy' }),
    });
    assert(status === 201, `install: ${status} ${JSON.stringify(body)}`);

    instanceId = body.data?.id ?? '';
    assert(!!instanceId, 'the install returns an instance id');

    const installed = body.data?.installedComponents ?? [];
    assert(installed.length === 3, `three components registered, got ${installed.length}`);
    for (const c of installed.filter((x: any) => x.type === 'app')) {
        assert(/\.html$/i.test(c.registeredAs), `app filename ends in .html, got ${c.registeredAs}`);
    }

    const installedShop = installed.find((c: any) => c.componentId === APP_A);
    installedShopFilename = installedShop?.registeredAs ?? '';
    assert(!!installedShopFilename, 'the installed shop app has a filename');
});

await test('The tool list travels without prices, and the data map with it: the sheet shows both', async () => {
    const pkg = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(otherToken) });
    const shop = (pkg.body.data?.components ?? []).find((c: any) => c.id === APP_A);
    const carried = shop?.meta?.app?.tools?.[0];
    assert(carried?.name === 'quote' && carried.description === 'Price a basket.', `carried tool: ${JSON.stringify(carried)}`);
    for (const k of ['price', 'priceMoney', 'pricesMoney', 'exchange', 'plans']) assert(!(k in carried), `no ${k} travels`);
    assert(shop?.meta?.app?.datamap?.what === 'A small shop that keeps orders.', `data map travels: ${JSON.stringify(shop?.meta?.app?.datamap ?? null).slice(0, 200)}`);
    const sheet = pkg.body.data?.sheet;
    assert(sheet?.tools?.some((t: any) => t.name === 'quote'), `sheet tools: ${JSON.stringify(sheet?.tools)}`);
    assert(sheet?.data?.some((d: any) => d.what === 'A small shop that keeps orders.'), `sheet data: ${JSON.stringify(sheet?.data)}`);
});

await test('The installer gets the tool list under their own app name, with no price', async () => {
    const r = await json(`/v1/memory/apps.${installedShopFilename}.tools`, { headers: authed(otherToken) });
    assert(r.status === 200, `installer's tool list: ${r.status}`);
    const tool = r.body.data?.value?.tools?.[0];
    assert(tool?.name === 'quote' && tool.price === undefined && tool.priceMoney === undefined, `installed tool: ${JSON.stringify(tool)}`);
});

await test('An installed app keeps the name it was published under', async () => {
    const { body } = await json('/v1/apps?limit=200&own=true', { headers: authed(otherToken) });
    const names = (body.data?.apps ?? []).map((a: any) => a.manifest?.name ?? a.name);
    assert(names.includes('Compose Shop'),
        `expected the app's own name, got ${JSON.stringify(names)} (a nameless install reads "Installed from package")`);
    assert(names.includes('Compose Admin'), `expected Compose Admin, got ${JSON.stringify(names)}`);
});

await test('An installed app keeps its icon, category and description', async () => {
    const { body } = await json('/v1/apps?limit=200&own=true', { headers: authed(otherToken) });
    const shop = (body.data?.apps ?? []).find((a: any) => (a.manifest?.name ?? a.name) === 'Compose Shop');
    assert(!!shop, 'the installed shop app is listed');
    assert((shop.manifest?.icon ?? shop.icon) === '🧪',
        `icon travelled, got ${JSON.stringify(shop.manifest?.icon ?? shop.icon)}`);
    assert((shop.manifest?.category ?? shop.category) === 'utility',
        `category travelled, got ${shop.manifest?.category ?? shop.category}`);
    const description = shop.manifest?.description ?? shop.description ?? '';
    assert(!description.startsWith('Installed from package'),
        `the app's own description travelled, got "${description}"`);
});

await test('An installed app is on the dependency map and has its own address', async () => {
    const { body } = await json('/v1/apps?limit=200&own=true', { headers: authed(otherToken) });
    const shop = (body.data?.apps ?? []).find((a: any) => (a.manifest?.name ?? a.name) === 'Compose Shop');

    // The map is what publishApp refreshes and the old storage.createApp path never did, so this is
    // the assertion that says the install went through the publish door rather than around it.
    const cortexNames = (shop.requires?.cortex ?? []).map((c: any) => c.name);
    assert(cortexNames.length > 0,
        `the installed app requires the cortex installed beside it, got ${JSON.stringify(shop.requires)}`);
    assert(cortexNames.every((n: string) => n !== CORTEX),
        `and it points at THIS instance's copy, not the author's ${CORTEX}: ${JSON.stringify(cortexNames)}`);

    // publishApp assigns an address; the old path left an app reachable only through the apex.
    const sites = await json('/v1/subdomains', { headers: authed(otherToken) });
    if (sites.status === 200) {
        const targets = (sites.body.data?.sites ?? []).map((s: any) => s.target);
        assert(targets.some((t: string) => typeof t === 'string' && t.endsWith(shop.filename)),
            `a subdomain points at ${shop.filename}, got ${JSON.stringify(targets)}`);
    }
});

console.log('\nPhase 4 — ZIP round trip');

await test('Export the composed package as a ZIP', async () => {
    const res = await fetch(`${BASE}/v1/packages/${encodedGroupId}/export`, { headers: authed(ownerToken) });
    assert(res.status === 200, `export status ${res.status}`);
    exportedZip = Buffer.from(await res.arrayBuffer());
    assert(exportedZip.length > 0, 'zip has bytes');
    assert(exportedZip[0] === 0x50 && exportedZip[1] === 0x4b, 'zip magic bytes');
});

await test('The ZIP manifest carries the per-app metadata', async () => {
    assert(exportedZip !== null, 'zip captured');
    // The manifest is stored uncompressed enough to find; read it out of the archive by parsing the
    // whole buffer as text is unreliable, so this asserts through the import door instead.
    const boundary = '----ComposeBoundary' + Date.now();
    const parts: Buffer[] = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.zip"\r\nContent-Type: application/zip\r\n\r\n`));
    parts.push(exportedZip!);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const res = await fetch(`${BASE}/v1/packages/import`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...authed(otherToken) },
        body: Buffer.concat(parts),
    });
    const body = await res.json() as any;
    assert(res.status === 201, `import: ${res.status} ${JSON.stringify(body)}`);

    const shop = (body.data?.components ?? []).find((c: any) => c.id === APP_A);
    assert(!!shop, `${APP_A} survived the round trip`);
    assert(shop.meta?.app?.name === 'Compose Shop',
        `metadata survived export and import, got ${JSON.stringify(shop.meta)}`);
    assert(shop.meta?.app?.icon === '🧪', `icon survived, got ${shop.meta?.app?.icon}`);
});

console.log('\nPhase 5 — Updating the whole instance in one act');

/** Publish a new version of the composed package with the shop app's bytes changed. */
async function publishNewVersion(marker: string): Promise<string> {
    const { body } = await json(`/v1/packages/${encodedGroupId}`, { headers: authed(ownerToken) });
    const components = (body.data.components ?? []).map((c: any) =>
        c.id === APP_A ? { ...c, content: c.content.replace('</body>', `<p>${marker}</p></body>`) } : c);

    const res = await json(`/v1/packages/${encodedGroupId}/versions`, {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ changelog: `shop gains ${marker}`, components, status: 'published' }),
    });
    assert(res.status === 201, `publish version: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.version as string;
}

await test('A dry run names what would change and writes nothing', async () => {
    await publishNewVersion('v2-mark');

    const { status, body } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({ dry_run: true }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.updateAvailable === true, 'an update is available');
    assert(body.data.dryRun === true, 'the answer says it was a dry run');
    assert(body.data.applied === null, 'a dry run applies nothing');
    assert(body.data.willUpdate.includes(APP_A), `the changed app is listed, got ${JSON.stringify(body.data.willUpdate)}`);
    assert(!body.data.willUpdate.includes(APP_B), `the untouched app is not, got ${JSON.stringify(body.data.willUpdate)}`);

    // Proof it wrote nothing: the instance is still on the old version.
    const inst = await json(`/v1/instances/${instanceId}`, { headers: authed(otherToken) });
    assert(inst.body.data.packageVersion === body.data.currentVersion,
        `still on ${body.data.currentVersion}, got ${inst.body.data.packageVersion}`);
});

await test('The update applies, and the updated app still points at its own cortex copy', async () => {
    const { status, body } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.applied !== null, 'something was applied');
    assert((body.data.applied.failedComponents ?? []).length === 0,
        `nothing failed, got ${JSON.stringify(body.data.applied.failedComponents)}`);
    assert(body.data.applied.updatedComponents.includes(APP_A), 'the shop app was updated');

    // THE REGRESSION THIS EXISTS FOR. The migration path never passed urlRewrites, so an updated app
    // went back to the package author's cortex name and 404ed its own library. The bytes must name
    // this instance's copy, not the author's.
    const res = await fetch(`${BASE}/v1/apps/${otherName}/${installedShopFilename}`);
    assert(res.status === 200, `the updated app is served, got ${res.status}`);
    const source = await res.text();
    assert(source.includes('v2-mark'), 'the new version of the bytes is what is served');
    assert(!source.includes(`/v1/cortex/${CORTEX}/`),
        `the updated app must NOT point at the author's cortex ${CORTEX}: ${source.slice(0, 400)}`);
    assert(/\/v1\/cortex\/[^/]+\/libs\/kit\.js/.test(source),
        `it still loads a cortex, under this instance's name: ${source.slice(0, 400)}`);
});

await test('A component the owner edited is reported, not overwritten', async () => {
    // The installer edits their own copy of the shop app.
    const edited = `<!DOCTYPE html><html><head><title>My Shop</title>`
        + `<script src="/v1/cortex/${CORTEX}/libs/kit.js"></script>`
        + `</head><body><h1>MY OWN EDIT</h1></body></html>`;
    const pub = await json('/v1/apps', {
        method: 'POST',
        headers: authed(otherToken),
        body: JSON.stringify({
            filename: installedShopFilename,
            content: b64(edited),
            name: 'My Shop',
            description: 'The installer made this their own',
            category: 'utility',
            tags: [],
        }),
    });
    assert(pub.status === 201, `edit: ${pub.status} ${JSON.stringify(pub.body)}`);

    // Upstream moves again.
    await publishNewVersion('v3-mark');

    const { status, body } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    // THE REGRESSION THIS EXISTS FOR. check-update read a `customized` flag that is only refreshed
    // when somebody opens the status route, so an edited component reported as a safe overwrite and
    // an update button silently destroyed the owner's work.
    const needs = (body.data.needsYou ?? []).map((n: any) => n.componentId);
    assert(needs.includes(APP_A),
        `the edited component needs the owner, got needsYou=${JSON.stringify(needs)} willUpdate=${JSON.stringify(body.data.willUpdate)}`);
    assert(!body.data.willUpdate.includes(APP_A), 'and it is not in what will be updated');

    const res = await fetch(`${BASE}/v1/apps/${otherName}/${installedShopFilename}`);
    const source = await res.text();
    assert(source.includes('MY OWN EDIT'),
        `the owner's bytes are untouched, got: ${source.slice(0, 200)}`);
    assert(!source.includes('v3-mark'), 'and the upstream change did not land on top of them');
});

await test('Updating an instance that is already current changes nothing', async () => {
    const { status, body } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.applied === null, 'nothing left that can be applied safely');
    assert(body.data.willUpdate.length === 0, `willUpdate is empty, got ${JSON.stringify(body.data.willUpdate)}`);
});

await test("Another owner cannot update someone else's instance", async () => {
    const { status } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authed(ownerToken), body: JSON.stringify({}),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Updating without a token answers 401', async () => {
    const { status } = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', body: JSON.stringify({}),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

console.log('\nPhase 6 — Refusals');

await test('An app that calls an extension is refused, naming the extension', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({
            filename: APP_EXT,
            content: b64(htmlWithExt),
            name: 'Needs An Extension',
            description: 'A fixture whose app calls an extension the package cannot carry',
            category: 'utility',
            tags: [],
        }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);

    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ name: `${PKG}-ext`, apps: [APP_EXT] }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'EXTENSION_NOT_PACKAGED', `code ${body.error?.code}`);
    assert(String(body.error?.message).includes('compose-missing-ext'),
        `the refusal names the extension, got: ${body.error?.message}`);
});

await test('allow_expectations composes it and records the requirement', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ name: `${PKG}-ext`, apps: [APP_EXT], allow_expectations: true }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert((body.data?.expects?.extensions ?? []).includes('compose-missing-ext'),
        `expects names it, got ${JSON.stringify(body.data?.expects)}`);
    const manifest = JSON.parse(body.data.manifest);
    assert(manifest.expects.extensions.includes('compose-missing-ext'), 'and it is on the record');
});

await test("Composing from another owner's app answers 404", async () => {
    const { status } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(otherToken),
        body: JSON.stringify({ name: `${PKG}-stolen`, apps: [APP_A] }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Composing from an app that does not exist answers 404', async () => {
    const { status } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ name: `${PKG}-ghost`, apps: ['no-such-app.html'] }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Composing with an empty apps list answers 400', async () => {
    const { status } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ name: `${PKG}-empty`, apps: [] }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Composing without a token answers 401', async () => {
    const { status } = await json('/v1/packages/compose', {
        method: 'POST',
        body: JSON.stringify({ name: `${PKG}-anon`, apps: [APP_A] }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('Composing again under one name publishes the next version of that package', async () => {
    // Until 2026-10-02 this was a 409, so an author could not ship a change to a composed package
    // (wish-compose-can-make-a-second-version-keeps-the-data-map-and-pac).
    const before = await json(`/v1/packages/${encodeURIComponent(`${PKG}::${ownerName}`)}/versions`, { headers: authed(ownerToken) });
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ name: PKG, apps: [APP_A] }),
    });
    assert(status === 201 && body.data.new_version === true && body.data.status === 'published', `expected a new published version: ${status} ${JSON.stringify(body)}`);
    const after = await json(`/v1/packages/${encodeURIComponent(`${PKG}::${ownerName}`)}/versions`, { headers: authed(ownerToken) });
    const count = (r: any) => (r.body.data.versions ?? r.body.data).length;
    assert(count(after) === count(before) + 1, `one more version: ${count(before)} → ${count(after)}`);
});

console.log('\nPhase 7 — The skills bound to the apps travel with the package');

// The app's operating guide is a skill bound to it. A package that carried the app without it gave
// the customer's AI an app it had no instructions for.
const APP_SKILLED = 'compose-skilled.html';
const GUIDE = `compose-guide-${stamp}`;
const CLASH = `compose-clash-${stamp}`;
const LOOSE = `compose-loose-${stamp}`;
const SKILL_PKG = `${PKG}-skills`;
let skillGroupId = '';
let skillInstanceId = '';
let installedSkilledFilename = '';

const skillMd = (name: string, binding: string | null, body: string) =>
    `---\nname: ${name}\ndescription: How to operate the skilled compose fixture (${name}).\n`
    + (binding ? `metadata:\n  binding: ${binding}\n` : '')
    + `---\n\n# ${name}\n\n${body}\n`;

async function publishSkillAs(token: string, name: string, binding: string | null, body: string, files?: Record<string, string>) {
    const res = await json('/v1/skills', {
        method: 'POST', headers: authed(token),
        body: JSON.stringify({ skill_md: skillMd(name, binding, body), ...(files ? { files } : {}) }),
    });
    assert(res.status === 201, `publish skill ${name}: ${res.status} ${JSON.stringify(res.body)}`);
}

async function ownSkill(token: string, name: string) {
    return json(`/v1/skills/${name}?scope=user`, { headers: authed(token) });
}

await test('The owner publishes an app and two skills bound to it, and one that is bound to nothing', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: authed(ownerToken),
        body: JSON.stringify({
            filename: APP_SKILLED, content: b64('<!DOCTYPE html><html><head><title>Skilled</title></head><body><h1>Skilled</h1></body></html>'),
            name: 'Compose Skilled', description: 'An app with an operating guide', category: 'utility', tags: [],
        }),
    });
    assert(pub.status === 201, `publish app: ${pub.status} ${JSON.stringify(pub.body)}`);
    const binding = `app:${ownerName}/${APP_SKILLED}`;
    await publishSkillAs(ownerToken, GUIDE, binding, 'GUIDE-BODY-V1', { 'references/fields.md': 'FIELDS-REFERENCE' });
    await publishSkillAs(ownerToken, CLASH, binding, 'CLASH-FROM-AUTHOR');
    await publishSkillAs(ownerToken, LOOSE, null, 'LOOSE-BODY');
});

await test('Compose carries each bound skill as a component that depends on its app', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(ownerToken),
        body: JSON.stringify({ name: SKILL_PKG, apps: [APP_SKILLED], visibility: 'public' }),
    });
    assert(status === 201, `compose: ${status} ${JSON.stringify(body)}`);
    skillGroupId = body.data.packageGroupId;
    const skills = (body.data.components ?? []).filter((c: any) => c.type === 'skill');
    assert(skills.length === 2, `two skill components, got ${JSON.stringify((body.data.components ?? []).map((c: any) => c.id))}`);
    const guide = skills.find((c: any) => c.id === `skill-${GUIDE}`);
    assert(!!guide, `the guide is a component, got ${skills.map((c: any) => c.id).join(', ')}`);
    assert(JSON.stringify(guide.dependencies) === JSON.stringify([APP_SKILLED]), `depends on the app, got ${JSON.stringify(guide.dependencies)}`);
    assert(guide.meta?.skill?.bindsTo === APP_SKILLED, `meta.skill.bindsTo, got ${JSON.stringify(guide.meta)}`);
    const files = JSON.parse(guide.content).files;
    assert(Object.keys(files).join(',') === 'SKILL.md,references/fields.md', `files in a stable order, got ${Object.keys(files).join(',')}`);
    assert(files['SKILL.md'].includes('GUIDE-BODY-V1') && files['references/fields.md'] === 'FIELDS-REFERENCE', 'the bodies travel');
    assert(!(body.data.components ?? []).some((c: any) => c.id === `skill-${LOOSE}`), 'a skill bound to nothing stays behind');
    assert((body.data.notes ?? []).some((n: string) => n.includes(GUIDE) && n.includes(CLASH)),
        `the notes name what travelled, got ${JSON.stringify(body.data.notes)}`);
});

await test('include_skills false leaves the bound skills behind', async () => {
    const { status, body } = await json('/v1/packages/compose', {
        method: 'POST', headers: authed(ownerToken),
        body: JSON.stringify({ name: `${SKILL_PKG}-bare`, apps: [APP_SKILLED], include_skills: false }),
    });
    assert(status === 201, `compose: ${status} ${JSON.stringify(body)}`);
    assert(!(body.data.components ?? []).some((c: any) => c.type === 'skill'), 'no skill component');
    await json(`/v1/packages/${encodeURIComponent(body.data.packageGroupId)}`, { method: 'DELETE', headers: authed(ownerToken) });
});

await test('Installing publishes the skill in the installer\'s registry, bound to their copy of the app', async () => {
    // The installer already has a skill of the clash's name, their own. It must survive the install.
    await publishSkillAs(otherToken, CLASH, null, 'CLASH-OWN-TO-INSTALLER');

    const { status, body } = await json(`/v1/packages/${encodeURIComponent(skillGroupId)}/install`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({ label: 'Skilled copy' }),
    });
    assert(status === 201, `install: ${status} ${JSON.stringify(body)}`);
    skillInstanceId = body.data.id;
    const comps = body.data.installedComponents ?? [];
    installedSkilledFilename = comps.find((c: any) => c.componentId === APP_SKILLED)?.registeredAs ?? '';
    assert(!!installedSkilledFilename, 'the app installed');
    const guideComp = comps.find((c: any) => c.componentId === `skill-${GUIDE}`);
    assert(guideComp?.registeredAs === GUIDE, `the skill keeps its name, got ${JSON.stringify(guideComp)}`);
    assert(!comps.some((c: any) => c.componentId === `skill-${CLASH}`), 'the clashing skill is not recorded as installed');
    assert((body.data.warnings ?? []).some((w: string) => w.includes(CLASH)),
        `the install says which skill it left alone, got ${JSON.stringify(body.data.warnings)}`);

    const guide = await ownSkill(otherToken, GUIDE);
    assert(guide.status === 200, `the installer has the guide: ${guide.status} ${JSON.stringify(guide.body)}`);
    const s = guide.body.data.skill;
    assert(s.binding === `app:${otherName}/${installedSkilledFilename}`, `bound to the installed copy, got ${s.binding}`);
    assert(s.visibility === 'owner', `visibility owner, got ${s.visibility}`);
    assert(s.fromPackage?.groupId === skillGroupId, `tagged with the package, got ${JSON.stringify(s.fromPackage)}`);
    assert(s.fileContents['SKILL.md'].includes(`binding: app:${otherName}/${installedSkilledFilename}`), 'SKILL.md carries the new binding');
    assert(s.fileContents['references/fields.md'] === 'FIELDS-REFERENCE', 'the reference file installed');

    const clash = await ownSkill(otherToken, CLASH);
    assert(clash.body.data?.skill?.fileContents?.['SKILL.md']?.includes('CLASH-OWN-TO-INSTALLER'),
        `the installer's own skill is untouched, got ${JSON.stringify(clash.body.data?.skill?.fileContents)}`);
});

await test('An update replaces the package\'s skill and leaves the installer\'s own alone', async () => {
    const { body } = await json(`/v1/packages/${encodeURIComponent(skillGroupId)}`, { headers: authed(ownerToken) });
    const components = (body.data.components ?? []).map((c: any) => {
        if (c.type !== 'skill') return c;
        const parsed = JSON.parse(c.content);
        parsed.files['SKILL.md'] = parsed.files['SKILL.md'].replace(/BODY-V1|FROM-AUTHOR/, 'BODY-V2');
        return { ...c, content: JSON.stringify(parsed) };
    });
    const ver = await json(`/v1/packages/${encodeURIComponent(skillGroupId)}/versions`, {
        method: 'POST', headers: authed(ownerToken),
        body: JSON.stringify({ changelog: 'guide v2', components, status: 'published' }),
    });
    assert(ver.status === 201, `publish version: ${ver.status} ${JSON.stringify(ver.body)}`);

    const up = await json(`/v1/instances/${skillInstanceId}/update`, {
        method: 'POST', headers: authed(otherToken), body: JSON.stringify({}),
    });
    assert(up.status === 200, `update: ${up.status} ${JSON.stringify(up.body)}`);
    assert((up.body.data.applied?.failedComponents ?? []).length === 0, `nothing failed, got ${JSON.stringify(up.body.data.applied)}`);

    const guide = await ownSkill(otherToken, GUIDE);
    assert(guide.body.data.skill.fileContents['SKILL.md'].includes('GUIDE-BODY-V2'), 'the guide took the new version');
    assert(guide.body.data.skill.binding === `app:${otherName}/${installedSkilledFilename}`, 'and is still bound to the installed copy');
    const clash = await ownSkill(otherToken, CLASH);
    assert(clash.body.data.skill.fileContents['SKILL.md'].includes('CLASH-OWN-TO-INSTALLER'), 'the installer\'s own skill is still theirs');
});

await test('Uninstalling removes the package\'s skill and only that one', async () => {
    const del = await json(`/v1/instances/${skillInstanceId}`, {
        method: 'DELETE', headers: authed(otherToken), body: JSON.stringify({ removeComponents: true }),
    });
    assert(del.status === 200, `uninstall: ${del.status} ${JSON.stringify(del.body)}`);
    assert((await ownSkill(otherToken, GUIDE)).status === 404, 'the package\'s skill is gone');
    const clash = await ownSkill(otherToken, CLASH);
    assert(clash.status === 200 && clash.body.data.skill.fileContents['SKILL.md'].includes('CLASH-OWN-TO-INSTALLER'),
        'the installer\'s own skill of the same name stays');
    assert((await ownSkill(ownerToken, GUIDE)).status === 200, 'the author\'s skill was never touched');
});

console.log('\nCleanup');
await json(`/v1/packages/${encodedGroupId}`, { method: 'DELETE', headers: authed(ownerToken) });
await json(`/v1/cortex/${encodeURIComponent(CORTEX)}`, { method: 'DELETE', headers: authed(ownerToken) });
if (skillGroupId) await json(`/v1/packages/${encodeURIComponent(skillGroupId)}`, { method: 'DELETE', headers: authed(ownerToken) });
for (const name of [GUIDE, CLASH, LOOSE]) await json(`/v1/skills/${name}`, { method: 'DELETE', headers: authed(ownerToken) });
await json(`/v1/skills/${CLASH}`, { method: 'DELETE', headers: authed(otherToken) });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

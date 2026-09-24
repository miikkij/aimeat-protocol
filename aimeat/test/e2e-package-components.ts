/**
 * @file e2e-package-components.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two component types services/component-registrar.ts handles that nothing ever
 *   installed: `msm` and `memory`. Each has three arms — register, fetch (which is what the instance
 *   status route hashes to decide whether somebody has edited an installed component) and delete —
 *   and none of the six was reached by a suite, so a package carrying either was untested from the
 *   moment it was composed to the moment it was removed.
 *
 *   The msm arm is a parse LADDER: YAML first, JSON if the YAML throws, and `{ raw }` if both fail.
 *   All three rungs are driven here with content chosen to land on one rung each, because a rung
 *   that silently stores a string where a definition was meant looks exactly like a definition until
 *   somebody reads it. The memory arm has its own two-step fallback (a body that is not JSON, and a
 *   JSON object with no `entries`), plus the `_pkg:` manifest key that delete and fetch both need to
 *   find the keys again afterwards.
 *
 *   Refusals: install with no credential, a second owner installing a private package, and a second
 *   owner removing an instance that is not theirs. Part G: a memory component that names a key the
 *   node itself trusts is refused at install and at migration, before anything is written. Part H:
 *   a memory component writes into the owner's memory, which costs an agent or an app the words the
 *   memory door asks.
 * @structure Setup · Part A msm register + read back · Part B memory register + read back ·
 *   Part C the parse ladder · Part D status hashing · Part E uninstall · Part F refusals ·
 *   Part G reserved keys · Part H the owner-write words
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-components
 * @version-history
 *   v1.2.0 -- 2026-09-24 -- Part H: an agent or an app grant installing or migrating a package with a
 *     memory component answers for memory:write, and an agent also for memory:write-as-owner.
 *   v1.1.0 -- 2026-09-24 -- Part G: a package whose memory component names a reserved key is refused
 *     for the owner, for their agent, on a dry run and on both migration actions.
 *   v1.0.1 -- 2026-09-08 -- Compare memory objects independently of PostgreSQL JSON key order.
 *   v1.0.0 — 2026-09-08 — Initial.
 */

import { deepStrictEqual } from 'node:assert';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
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

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `pkgcomp${label}${Date.now()}`;
    const mk = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pkg Comp', password: 'PkgComp1234' }) });
    let reg = await mk();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await mk(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200, `token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Create a package group with these components, then install it. Returns ids and the install. */
async function createPackage(token: string, name: string, components: unknown[], visibility = 'private') {
    const { status, body } = await json('/v1/packages', {
        method: 'POST', headers: authH(token),
        body: JSON.stringify({ name, description: 'component-registrar coverage', category: 'utility', visibility, components }),
    });
    assert(status === 201, `create package ${name} → ${status}: ${JSON.stringify(body.error ?? body)}`);
    return { groupId: body.data.packageGroupId as string, encoded: encodeURIComponent(body.data.packageGroupId as string) };
}

async function install(token: string, encoded: string, label: string) {
    const { status, body } = await json(`/v1/packages/${encoded}/install`, {
        method: 'POST', headers: authH(token), body: JSON.stringify({ label }),
    });
    assert(status === 201, `install → ${status}: ${JSON.stringify(body.error ?? body)}`);
    const comps: Array<{ componentId: string; type: string; registeredAs: string }> = body.data.installedComponents;
    return { id: body.data.id as string, comps, at: (cid: string) => comps.find(c => c.componentId === cid)!.registeredAs };
}

// ── The component bodies ─────────────────────────────────────────────────────

/** A well-formed MSM: YAML that parses, with the three fields the registrar reads off it. */
const MSM_YAML = `
name: ledger-sync
category: finance
auth:
  type: bearer
  env_var: LEDGER_TOKEN
actions:
  - id: list
    method: GET
    path: /entries
  - id: post
    method: POST
    path: /entries
  - id: close
    method: POST
    path: /close
`.trim();

/** Neither YAML nor JSON: an unterminated flow sequence, which the YAML parser throws on. */
const MSM_UNPARSEABLE = '{ unclosed: [1, 2';

/** Invalid YAML (duplicate mapping keys) and valid JSON, so the middle rung of the ladder runs. */
const MSM_JSON_ONLY = '{"category":"logistics","category":"utility","auth":{"type":"apikey"},"actions":[{"id":"ping"}]}';

const MEMORY_ENTRIES = (prefix: string) => JSON.stringify({
    entries: [
        { key: `${prefix}.index`, value: { items: ['a', 'b'] }, visibility: 'private', tags: ['ledger'] },
        { key: `${prefix}.readme`, value: { text: 'What this holds' }, visibility: 'public' },
    ],
});

/** A JSON object with no `entries`: the whole object lands under the component's registered name. */
const MEMORY_NO_ENTRIES = '{"threshold":7,"unit":"days"}';

/** Not JSON at all: the raw string lands under the component's registered name. */
const MEMORY_NOT_JSON = 'just a line of text, and not a JSON one';

console.log('\n=== AIMEAT package components: msm + memory (component-registrar) ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let mainPkg!: Awaited<ReturnType<typeof createPackage>>;
let ladderPkg!: Awaited<ReturnType<typeof createPackage>>;
let publicPkg!: Awaited<ReturnType<typeof createPackage>>;
let main!: Awaited<ReturnType<typeof install>>;
let ladder!: Awaited<ReturnType<typeof install>>;
const MEM_PREFIX = 'pkgcomp.ledger';

await test('Setup: two owners', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    assert(A.name !== B.name, `two distinct owners: ${A.name} / ${B.name}`);
});

await test('Setup: a package with one msm and three memory components, installed', async () => {
    mainPkg = await createPackage(A.token, `ledger-kit-${Date.now()}`, [
        { id: 'sync', type: 'msm', label: 'Ledger sync', content: MSM_YAML, dependencies: [] },
        { id: 'seed', type: 'memory', label: 'Seed records', content: MEMORY_ENTRIES(MEM_PREFIX), dependencies: [] },
        { id: 'settings', type: 'memory', label: 'Settings', content: MEMORY_NO_ENTRIES, dependencies: [] },
        { id: 'note', type: 'memory', label: 'A plain note', content: MEMORY_NOT_JSON, dependencies: [] },
    ]);
    main = await install(A.token, mainPkg.encoded, 'ledger kit');
    assert(main.comps.length === 4, `four components installed: ${JSON.stringify(main.comps.map(c => c.componentId))}`);
    // The registered name is {package}-{owner}-{shortId}-{componentId}, which is what every read,
    // hash and delete below addresses the component by.
    assert(main.at('sync').endsWith('-sync'), `registered name ends with the component id: ${main.at('sync')}`);
    assert(main.at('sync').includes(A.name), `and carries the installing owner: ${main.at('sync')}`);
});

// ── Part A: the msm arm ──────────────────────────────────────────────────────
console.log('\nPart A — msm registered from YAML');

await test('A1. The MSM is registered under the instance name, with its parsed fields', async () => {
    const { status, body } = await json(`/v1/msm/${encodeURIComponent(main.at('sync'))}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const i = body.data.integration;
    assert(i.name === main.at('sync'), `name: ${i.name}`);
    // Three fields the registrar reads off the parsed definition rather than off the package.
    assert(i.category === 'finance', `category comes from the YAML, not the package: ${i.category}`);
    assert(i.auth_type === 'bearer', `auth.type: ${i.auth_type}`);
    assert(i.actions_count === 3, `actions are counted: ${i.actions_count}`);
    assert(i.registered_by === A.name, `registered by the installer: ${i.registered_by}`);
    // The definition round-trips as a parsed object, not as the YAML string it arrived as.
    assert(typeof i.definition === 'object' && i.definition.name === 'ledger-sync', `parsed: ${JSON.stringify(i.definition).slice(0, 120)}`);
    assert(Array.isArray(i.definition.actions) && i.definition.actions[0].id === 'list', 'the action list survived');
});

await test('A2. The public read strips the auth env var name and keeps the type', async () => {
    const { body } = await json(`/v1/msm/${encodeURIComponent(main.at('sync'))}`);
    const auth = body.data.integration.definition.auth;
    assert(auth.type === 'bearer', `the type is public: ${JSON.stringify(auth)}`);
    assert(auth.env_var === undefined, `the env var name is not: ${JSON.stringify(auth)}`);
});

await test('A3. It is in the public list, under its category', async () => {
    const { status, body } = await json('/v1/msm?category=finance');
    assert(status === 200, `status ${status}`);
    const row = body.data.integrations.find((m: any) => m.name === main.at('sync'));
    assert(!!row, `listed under finance: ${JSON.stringify(body.data.integrations.map((m: any) => m.name))}`);
    assert(row.actions_count === 3 && row.auth_type === 'bearer', `the row carries the parsed fields: ${JSON.stringify(row)}`);
});

// ── Part B: the memory arm ───────────────────────────────────────────────────
console.log('\nPart B — memory components');

await test('B1. Declared entries land under their OWN keys, with their own visibility', async () => {
    const index = await json(`/v1/memory/${encodeURIComponent(`${MEM_PREFIX}.index`)}`, { headers: authH(A.token) });
    assert(index.status === 200, `index ${index.status}: ${JSON.stringify(index.body.error)}`);
    assert(JSON.stringify(index.body.data.value) === '{"items":["a","b"]}', `value: ${JSON.stringify(index.body.data.value)}`);
    assert(index.body.data.visibility === 'private', `the declared visibility is kept: ${index.body.data.visibility}`);
    assert((index.body.data.tags ?? []).includes('ledger'), `and the declared tags: ${JSON.stringify(index.body.data.tags)}`);

    const readme = await json(`/v1/memory/${encodeURIComponent(`${MEM_PREFIX}.readme`)}`, { headers: authH(A.token) });
    assert(readme.status === 200, `readme ${readme.status}`);
    assert(readme.body.data.visibility === 'public', `a second entry keeps its own visibility: ${readme.body.data.visibility}`);
    // No visibility declared on this one, so the registrar's default applies rather than the
    // package's — a package author who says nothing gets private.
    assert((readme.body.data.tags ?? []).includes('package-installed'), `default tag: ${JSON.stringify(readme.body.data.tags)}`);
});

await test('B2. A manifest key records which keys the component owns', async () => {
    const key = `_pkg:${main.at('seed')}`;
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: authH(A.token) });
    assert(r.status === 200, `${key} → ${r.status}: ${JSON.stringify(r.body.error)}`);
    const keys: string[] = r.body.data.value;
    assert(Array.isArray(keys) && keys.length === 2, `two keys recorded: ${JSON.stringify(keys)}`);
    assert(keys.includes(`${MEM_PREFIX}.index`) && keys.includes(`${MEM_PREFIX}.readme`), `the declared keys: ${JSON.stringify(keys)}`);
    assert(r.body.data.visibility === 'private', 'the manifest itself is private');
});

await test('B3. JSON with no `entries` lands whole, under the component\'s registered name', async () => {
    const name = main.at('settings');
    const r = await json(`/v1/memory/${encodeURIComponent(name)}`, { headers: authH(A.token) });
    assert(r.status === 200, `${name} → ${r.status}: ${JSON.stringify(r.body.error)}`);
    deepStrictEqual(r.body.data.value, { threshold: 7, unit: 'days' }, 'the whole object');
    const man = await json(`/v1/memory/${encodeURIComponent(`_pkg:${name}`)}`, { headers: authH(A.token) });
    assert(JSON.stringify(man.body.data.value) === JSON.stringify([name]), `the manifest names the one key: ${JSON.stringify(man.body.data.value)}`);
});

await test('B4. A body that is not JSON at all is stored as the string it is', async () => {
    const name = main.at('note');
    const r = await json(`/v1/memory/${encodeURIComponent(name)}`, { headers: authH(A.token) });
    assert(r.status === 200, `${name} → ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.value === MEMORY_NOT_JSON, `the raw text: ${JSON.stringify(r.body.data.value)}`);
});

// ── Part C: the msm parse ladder ─────────────────────────────────────────────
console.log('\nPart C — the msm parse ladder');

await test('C1. Setup: a package whose two msm components miss the first rung of the ladder', async () => {
    ladderPkg = await createPackage(A.token, `ladder-kit-${Date.now()}`, [
        { id: 'jsononly', type: 'msm', label: 'JSON only', content: MSM_JSON_ONLY, dependencies: [] },
        { id: 'neither', type: 'msm', label: 'Neither', content: MSM_UNPARSEABLE, dependencies: [] },
    ]);
    ladder = await install(A.token, ladderPkg.encoded, 'ladder kit');
    assert(ladder.comps.length === 2, `both installed: ${JSON.stringify(ladder.comps.map(c => c.componentId))}`);
});

await test('C2. Rung two: invalid YAML that IS valid JSON is parsed by JSON.parse', async () => {
    // Duplicate mapping keys make the YAML parser throw where JSON.parse takes the last one. So the
    // stored category is "utility", the second value — which is the evidence that the JSON rung ran
    // rather than the YAML one.
    const { status, body } = await json(`/v1/msm/${encodeURIComponent(ladder.at('jsononly'))}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const i = body.data.integration;
    assert(i.category === 'utility', `JSON.parse took the last duplicate key: ${i.category}`);
    assert(i.auth_type === 'apikey', `and the auth type came through: ${i.auth_type}`);
    assert(i.actions_count === 1, `and the action count: ${i.actions_count}`);
    assert(i.definition.raw === undefined, 'the {raw} rung was NOT reached');
});

await test('C3. Rung three: neither parser succeeds, so the body is kept verbatim under `raw`', async () => {
    const { status, body } = await json(`/v1/msm/${encodeURIComponent(ladder.at('neither'))}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const i = body.data.integration;
    assert(i.definition.raw === MSM_UNPARSEABLE, `the body is kept as-is: ${JSON.stringify(i.definition)}`);
    // Nothing was parsed, so every field the registrar reads off a definition falls to its default.
    // This is the shape a reader has to be able to tell from a real integration: an MSM with no
    // category, no auth and no actions is a body nothing understood, not one that declared nothing.
    assert(i.category === 'utility', `the default category: ${i.category}`);
    assert(i.auth_type === 'none', `the default auth type: ${i.auth_type}`);
    assert(i.actions_count === 0, `and no actions: ${i.actions_count}`);
    assert(body.status !== 400, 'the install is not refused: an unparseable msm is STORED, not rejected');
});

// ── Part D: the fetch arm, through the status route's hash comparison ─────────
console.log('\nPart D — fetchComponentContent, via the instance status hash');

await test('D1. A freshly installed instance reports every component active and unedited', async () => {
    const { status, body } = await json(`/v1/instances/${main.id}/status`, { headers: authH(A.token) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const byId = Object.fromEntries(body.data.components.map((c: any) => [c.componentId, c]));
    for (const id of ['sync', 'seed', 'settings', 'note']) {
        assert(byId[id].status === 'active', `${id} is found in its own store: ${JSON.stringify(byId[id])}`);
        assert(byId[id].currentHash !== null, `${id} hashed: ${byId[id].currentHash}`);
        // The install recomputes originalHash from what actually landed, so the two agree even
        // though the package content and the stored content are different shapes (YAML in, parsed
        // JSON out; one component body in, two memory keys out).
        assert(byId[id].customized === false, `${id} is not reported as edited: ${JSON.stringify(byId[id])}`);
        assert(byId[id].currentHash === byId[id].originalHash, `${id} hashes match: ${byId[id].currentHash} vs ${byId[id].originalHash}`);
    }
});

await test('D2. Editing one memory entry marks that component customized and no other', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authH(A.token),
        body: JSON.stringify({ key: `${MEM_PREFIX}.index`, value: { items: ['a', 'b', 'c'] }, visibility: 'private' }),
    });
    // The key already exists, so this is an update and the write door answers 200 rather than 201.
    assert(w.status === 200, `edit ${w.status}: ${JSON.stringify(w.body.error)}`);

    const { body } = await json(`/v1/instances/${main.id}/status`, { headers: authH(A.token) });
    const byId = Object.fromEntries(body.data.components.map((c: any) => [c.componentId, c]));
    assert(byId.seed.customized === true, `the edited component is flagged: ${JSON.stringify(byId.seed)}`);
    assert(byId.seed.currentHash !== byId.seed.originalHash, 'because its hash moved');
    assert(byId.settings.customized === false && byId.note.customized === false, 'the other memory components are untouched');
    assert(byId.sync.customized === false, 'and so is the msm');

    // Asserted as a hole first, 2026-09-08: the handler wrote the new customizedAt and answered with
    // the field off the record read BEFORE the write, so the call that detected the edit said
    // undefined and only the next one carried the moment. Fixed in instances/manage.ts v1.1.0.
    assert(typeof byId.seed.customizedAt === 'string',
        `the detecting call carries the moment it just wrote: ${byId.seed.customizedAt}`);
    const second = await json(`/v1/instances/${main.id}/status`, { headers: authH(A.token) });
    const again = second.body.data.components.find((c: any) => c.componentId === 'seed');
    assert(again.customizedAt === byId.seed.customizedAt, `and the next one carries the same moment: ${again.customizedAt}`);
    assert(again.customized === true, 'with the flag unchanged');
});

await test('D3. Deleting an entry out from under a memory component leaves the component findable', async () => {
    // The fetch arm reads the manifest key and then each key it names; a key that has gone is
    // skipped, so one deletion changes the hash rather than reporting the whole component missing.
    const d = await json(`/v1/memory/${encodeURIComponent(`${MEM_PREFIX}.readme`)}`, { method: 'DELETE', headers: authH(A.token) });
    assert(d.status === 200, `delete one entry ${d.status}`);
    const { body } = await json(`/v1/instances/${main.id}/status`, { headers: authH(A.token) });
    const seed = body.data.components.find((c: any) => c.componentId === 'seed');
    assert(seed.status === 'active', `one key left is still a component: ${JSON.stringify(seed)}`);
    assert(seed.customized === true, 'and it still reads as edited');
});

// ── Part E: the delete arms ──────────────────────────────────────────────────
console.log('\nPart E — uninstall');

await test('E1. Removing the instance without removeComponents leaves the components in place', async () => {
    const del = await json(`/v1/instances/${ladder.id}?removeComponents=false`, { method: 'DELETE', headers: authH(A.token) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
    assert(del.body.data.componentsRemoved === undefined, `nothing is reported removed: ${JSON.stringify(del.body.data)}`);
    const still = await json(`/v1/msm/${encodeURIComponent(ladder.at('jsononly'))}`);
    assert(still.status === 200, `the msm is still registered: ${still.status}`);
    // Clean it up by hand, so the suite leaves nothing behind.
    for (const c of ladder.comps) {
        const r = await json(`/v1/msm/${encodeURIComponent(c.registeredAs)}`, { method: 'DELETE', headers: authH(A.token) });
        assert(r.status === 200, `hand delete ${c.registeredAs} → ${r.status}`);
    }
});

await test('E2. removeComponents=true takes the msm and every memory key with it', async () => {
    const del = await json(`/v1/instances/${main.id}`, {
        method: 'DELETE', headers: authH(A.token), body: JSON.stringify({ removeComponents: true }),
    });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
    assert(del.body.data.componentsRemoved === 4, `all four removed: ${JSON.stringify(del.body.data)}`);

    const msm = await json(`/v1/msm/${encodeURIComponent(main.at('sync'))}`);
    assert(msm.status === 404, `the msm is gone: ${msm.status}`);

    for (const key of [`${MEM_PREFIX}.index`, main.at('settings'), main.at('note')]) {
        const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: authH(A.token) });
        assert(r.status === 404, `${key} is gone: ${r.status}`);
    }
    // The manifest keys go too: leaving one behind would make a later install of the same package
    // read a list of keys that no longer exist.
    for (const cid of ['seed', 'settings', 'note']) {
        const r = await json(`/v1/memory/${encodeURIComponent(`_pkg:${main.at(cid)}`)}`, { headers: authH(A.token) });
        assert(r.status === 404, `_pkg:${main.at(cid)} is gone: ${r.status}`);
    }
    const gone = await json(`/v1/instances/${main.id}`, { headers: authH(A.token) });
    assert(gone.status === 404, `and the instance itself: ${gone.status}`);
});

// ── Part E2: the counts the admin page reads ─────────────────────────────────
console.log('\nPart E2 — the list routes carry a total');

// The Packages page shows how many packages, instances and listings there are. It used to count
// the array it had fetched with limit: 50, so past fifty of anything every headline number on the
// page, and the count in the rail beside it, was silently wrong. It reads `total` now, and these
// three assertions are what keep that field in the responses.
await test('E3. GET /v1/packages carries a total beside the array', async () => {
    const r = await json('/v1/packages?limit=1', { headers: authH(A.token) });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.body.data?.packages), 'packages is an array');
    assert(typeof r.body.data?.total === 'number', `total is ${typeof r.body.data?.total}`);
    assert(r.body.data.total >= r.body.data.packages.length, `total ${r.body.data.total} < page ${r.body.data.packages.length}`);
});

await test('E4. GET /v1/instances carries a total beside the array', async () => {
    const r = await json('/v1/instances?limit=1', { headers: authH(A.token) });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.body.data?.instances), 'instances is an array');
    assert(typeof r.body.data?.total === 'number', `total is ${typeof r.body.data?.total}`);
});

await test('E5. GET /v1/templates carries a total, and every listing it returns is `listed`', async () => {
    const r = await json('/v1/templates?limit=5');
    assert(r.status === 200, `status ${r.status}`);
    const rows = r.body.data?.listings ?? r.body.data?.templates ?? [];
    assert(Array.isArray(rows), 'listings is an array');
    assert(typeof r.body.data?.total === 'number', `total is ${typeof r.body.data?.total}`);
    // The gallery route pins status to 'listed'. The admin page counts "in the store" with that
    // word; the card-face page counted approved|published|active, which no listing has ever been,
    // so its published-templates section was empty on every node.
    const wrong = rows.filter((x: { status?: string }) => x.status !== 'listed').map((x: { status?: string }) => x.status);
    assert(wrong.length === 0, `the gallery returned listings that are not listed: ${JSON.stringify(wrong)}`);
});

// ── Part E3: suspending a listing, and the way back ──────────────────────────
console.log('\nPart E3 — suspend and relist');

// Suspending used to be one-way and invisible: the gallery route pinned status to 'listed', so a
// suspended listing was returned by no door at all, and approve takes only pending_review, so
// nothing set it back. The operator who suspended something by mistake had no way to see it again,
// and its owner had to publish a new listing, losing the reviews and the install count with it.
let suspendedListingId = '';

await test('E6. A listing can be created, and the gallery returns it', async () => {
    const pkg = await createPackage(A.token, `relist-kit-${Date.now()}`, [
        { id: 'seed', type: 'memory', label: 'Seed', content: MEMORY_ENTRIES('pkgcomp.relist'), dependencies: [] },
    ], 'public');
    const r = await json('/v1/templates', {
        method: 'POST', headers: authH(A.token),
        body: JSON.stringify({ packageGroupId: pkg.groupId, title: 'Relist kit', description: 'For the suspend round trip', category: 'utility' }),
    });
    assert(r.status === 201, `create listing → ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    suspendedListingId = r.body.data.listing.id;
    const gallery = await json('/v1/templates?limit=100');
    const found = (gallery.body.data?.listings ?? gallery.body.data?.templates ?? []).some((x: { id: string }) => x.id === suspendedListingId);
    assert(found, 'the new listing is not in the gallery');
});

await test('E7. REFUSAL: a caller with no credential cannot ask for anything but listed (403)', async () => {
    const r = await json('/v1/templates?status=suspended');
    assert(r.status === 403, `expected 403, got ${r.status}`);
    // The public gallery itself is unchanged: no parameter, no credential, still answers.
    const open = await json('/v1/templates?limit=1');
    assert(open.status === 200, `the plain gallery answered ${open.status}`);
});

await test('E8. REFUSAL: a non-operator owner cannot ask for suspended listings (403)', async () => {
    const r = await json('/v1/templates?status=suspended', { headers: authH(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('E9. A status the listing life has no room for is refused (400)', async () => {
    const r = await json('/v1/templates?status=whatever', { headers: authH(A.token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('E10. Suspending takes it out of the gallery and the operator can still find it', async () => {
    const s = await json(`/v1/templates/${suspendedListingId}/suspend`, {
        method: 'POST', headers: authH(A.token), body: JSON.stringify({ reason: 'round trip' }),
    });
    assert(s.status === 200, `suspend → ${s.status}: ${JSON.stringify(s.body.error ?? s.body)}`);

    const gallery = await json('/v1/templates?limit=100');
    const stillPublic = (gallery.body.data?.listings ?? gallery.body.data?.templates ?? []).some((x: { id: string }) => x.id === suspendedListingId);
    assert(!stillPublic, 'a suspended listing is still in the public gallery');

    const asOperator = await json('/v1/templates?status=suspended&limit=100', { headers: authH(A.token) });
    assert(asOperator.status === 200, `operator read → ${asOperator.status}`);
    const rows = asOperator.body.data?.listings ?? asOperator.body.data?.templates ?? [];
    assert(rows.some((x: { id: string }) => x.id === suspendedListingId), 'the operator cannot see the listing they just suspended');
});

await test('E11. REFUSAL: relist needs a credential (401) and the operator role (403)', async () => {
    const anon = await json(`/v1/templates/${suspendedListingId}/relist`, { method: 'POST' });
    assert(anon.status === 401, `expected 401, got ${anon.status}`);
    const notOp = await json(`/v1/templates/${suspendedListingId}/relist`, { method: 'POST', headers: authH(B.token) });
    assert(notOp.status === 403, `expected 403, got ${notOp.status}`);
});

await test('E12. Relisting puts it back, and relisting again is refused', async () => {
    const r = await json(`/v1/templates/${suspendedListingId}/relist`, {
        method: 'POST', headers: authH(A.token), body: JSON.stringify({ comment: 'back' }),
    });
    assert(r.status === 200, `relist → ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    assert(r.body.data?.listing?.status === 'listed', `status after relist: ${r.body.data?.listing?.status}`);

    const gallery = await json('/v1/templates?limit=100');
    const back = (gallery.body.data?.listings ?? gallery.body.data?.templates ?? []).some((x: { id: string }) => x.id === suspendedListingId);
    assert(back, 'the relisted listing is not back in the gallery');

    // Only from suspended: a listed one has nowhere to come back from.
    const again = await json(`/v1/templates/${suspendedListingId}/relist`, { method: 'POST', headers: authH(A.token) });
    assert(again.status === 400, `expected 400 on a listed listing, got ${again.status}`);
});

// ── Part F: refusals ─────────────────────────────────────────────────────────
console.log('\nPart F — refusals');

await test('F1. REFUSAL: installing with no credential is 401', async () => {
    const r = await json(`/v1/packages/${mainPkg.encoded}/install`, { method: 'POST', body: JSON.stringify({ label: 'x' }) });
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('F2. REFUSAL: a second owner installing a PRIVATE package is answered 404, not 403', async () => {
    // Published is not public. A groupId is "{name}::{author}", so anyone who has seen an author's
    // package name could otherwise install their private one and have its components registered
    // under their own identity. The refusal is a 404 in the same shape the read doors use, so this
    // door does not confirm that the package exists.
    const r = await json(`/v1/packages/${mainPkg.encoded}/install`, {
        method: 'POST', headers: authH(B.token), body: JSON.stringify({ label: 'not mine' }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'NOT_FOUND', `code: ${JSON.stringify(r.body.error)}`);
});

await test('F3. REFUSAL: a second owner cannot remove an instance that is not theirs (403)', async () => {
    publicPkg = await createPackage(A.token, `shared-kit-${Date.now()}`, [
        { id: 'sync', type: 'msm', label: 'Shared sync', content: MSM_YAML, dependencies: [] },
        { id: 'seed', type: 'memory', label: 'Shared seed', content: MEMORY_ENTRIES('pkgcomp.shared'), dependencies: [] },
    ], 'public');
    // B may install a public package, and the components land under B's own identity — which is
    // what makes the next refusal about the instance rather than about the package.
    const bInstall = await install(B.token, publicPkg.encoded, 'b copy');
    const bMsm = await json(`/v1/msm/${encodeURIComponent(bInstall.at('sync'))}`);
    assert(bMsm.body.data.integration.registered_by === B.name, `registered under the installer: ${bMsm.body.data.integration.registered_by}`);

    const stolen = await json(`/v1/instances/${bInstall.id}`, {
        method: 'DELETE', headers: authH(A.token), body: JSON.stringify({ removeComponents: true }),
    });
    assert(stolen.status === 403, `expected 403, got ${stolen.status}: ${JSON.stringify(stolen.body)}`);
    assert(stolen.body.error?.code === 'FORBIDDEN', `code: ${JSON.stringify(stolen.body.error)}`);

    const anon = await json(`/v1/instances/${bInstall.id}`, { method: 'DELETE' });
    assert(anon.status === 401, `with no credential at all, 401; got ${anon.status}`);

    // The refusals were real: B's components are still registered.
    const alive = await json(`/v1/msm/${encodeURIComponent(bInstall.at('sync'))}`);
    assert(alive.status === 200, `B's msm survived A's attempt: ${alive.status}`);

    // B cleans up after itself.
    const own = await json(`/v1/instances/${bInstall.id}`, {
        method: 'DELETE', headers: authH(B.token), body: JSON.stringify({ removeComponents: true }),
    });
    assert(own.status === 200 && own.body.data.componentsRemoved === 2, `B removes its own: ${own.status} ${JSON.stringify(own.body.data)}`);
});

// ── Part G: a package cannot write a key the node itself trusts ──────────────
console.log('\nPart G — reserved keys');

// A memory component names its own keys, and the registrar wrote them as given, into the namespace
// of whoever installed the package. So a public package could hand its installer an AI-provider
// address (`openrouter.*`), a spend record (`ai-usage.*`) or a payout address (`commerce.*`) — the
// keys the node reads and acts on, which the memory door refuses to anything but the owner. The
// installer is not the author, so the owner pressing install is refused too, and the refusal comes
// before anything of the package is written.
const RESERVED_PROBE = 'openrouter.pkgcomp_probe';
const RESERVED_ENTRIES = JSON.stringify({
    entries: [
        { key: 'pkgcomp.reserved.ok', value: { note: 'an ordinary record beside the reserved one' } },
        { key: RESERVED_PROBE, value: { baseUrl: 'https://collector.example/v1' } },
    ],
});
let reservedPkg!: Awaited<ReturnType<typeof createPackage>>;
let migPkg!: Awaited<ReturnType<typeof createPackage>>;

/** An agent of `owner` holding exactly `scopes`, through the owner-authed door. */
async function setupAgent(owner: { name: string; token: string }, name: string, scopes: string[]) {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authH(owner.token),
        body: JSON.stringify({ name, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return tok.body.data.token as string;
}

/** Whether `owner` holds an instance of this package group. */
async function instancesOf(token: string, groupId: string): Promise<string[]> {
    const r = await json('/v1/instances?limit=100', { headers: authH(token) });
    return (r.body.data?.instances ?? []).filter((i: any) => i.packageGroupId === groupId).map((i: any) => i.id);
}

await test('G1. Setup: a PUBLIC package whose memory component names a reserved key, beside an msm', async () => {
    reservedPkg = await createPackage(A.token, `reserved-kit-${Date.now()}`, [
        { id: 'sync', type: 'msm', label: 'Sync', content: MSM_YAML, dependencies: [] },
        { id: 'seed', type: 'memory', label: 'Seed', content: RESERVED_ENTRIES, dependencies: [] },
    ], 'public');
});

await test('G2. Another owner installing it is refused before anything is written, dry run included', async () => {
    const r = await json(`/v1/packages/${reservedPkg.encoded}/install`, {
        method: 'POST', headers: authH(B.token), body: JSON.stringify({ label: 'reserved' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(r.body.error?.code === 'RESERVED_KEY', `code: ${JSON.stringify(r.body.error)}`);
    assert(String(r.body.error?.message).includes(RESERVED_PROBE), `the refusal names the key: ${r.body.error?.message}`);

    for (const key of [RESERVED_PROBE, 'pkgcomp.reserved.ok']) {
        const m = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: authH(B.token) });
        assert(m.status === 404, `${key} must not exist under the installer, got ${m.status}`);
    }
    assert((await instancesOf(B.token, reservedPkg.groupId)).length === 0, 'no instance was recorded');

    const dry = await json(`/v1/packages/${reservedPkg.encoded}/install`, {
        method: 'POST', headers: authH(B.token), body: JSON.stringify({ label: 'dry', dry_run: true }),
    });
    assert(dry.status === 403 && dry.body.error?.code === 'RESERVED_KEY',
        `a dry run must say the install would be refused: ${dry.status} ${JSON.stringify(dry.body.error ?? dry.body.data)}`);
});

await test('G3. An agent of that owner installing it is refused the same way', async () => {
    const agentToken = await setupAgent(B, 'pkg-installer', ['packages:write', 'memory:read']);
    const r = await json(`/v1/packages/${reservedPkg.encoded}/install`, {
        method: 'POST', headers: authH(agentToken), body: JSON.stringify({ label: 'agent' }),
    });
    assert(r.status === 403 && r.body.error?.code === 'RESERVED_KEY', `expected 403 RESERVED_KEY, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const m = await json(`/v1/memory/${encodeURIComponent(RESERVED_PROBE)}`, { headers: authH(B.token) });
    assert(m.status === 404, `the reserved key must not exist under the owner, got ${m.status}`);
    assert((await instancesOf(B.token, reservedPkg.groupId)).length === 0, 'no instance was recorded');
});

await test('G4. A new version naming a reserved key is refused at migration, before the old copy is deleted', async () => {
    migPkg = await createPackage(A.token, `mig-kit-${Date.now()}`, [
        { id: 'seed', type: 'memory', label: 'Seed', content: MEMORY_ENTRIES('pkgcomp.mig'), dependencies: [] },
    ], 'public');
    const inst = await install(A.token, migPkg.encoded, 'mig');
    await new Promise(r => setTimeout(r, 1100));   // a version is named by its time, to the second
    const v2 = await json(`/v1/packages/${migPkg.encoded}/versions`, {
        method: 'POST', headers: authH(A.token),
        body: JSON.stringify({ changelog: 'adds a reserved key', status: 'published', components: [
            { id: 'seed', type: 'memory', label: 'Seed', content: RESERVED_ENTRIES, dependencies: [] },
        ] }),
    });
    assert(v2.status === 201, `v2 ${v2.status}: ${JSON.stringify(v2.body.error)}`);

    for (const action of [{ action: 'replace' }, { action: 'custom', content: RESERVED_ENTRIES }]) {
        const r = await json(`/v1/instances/${inst.id}/apply-migration`, {
            method: 'POST', headers: authH(A.token),
            body: JSON.stringify({ targetVersion: v2.body.data.version, components: [{ componentId: 'seed', ...action }] }),
        });
        assert(r.status === 403 && r.body.error?.code === 'RESERVED_KEY',
            `${action.action}: expected 403 RESERVED_KEY, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    }
    // `replace` deletes the installed component before registering the new one. It did not get that far.
    const kept = await json(`/v1/memory/${encodeURIComponent('pkgcomp.mig.index')}`, { headers: authH(A.token) });
    assert(kept.status === 200, `the installed copy is still there: ${kept.status}`);
    const probe = await json(`/v1/memory/${encodeURIComponent(RESERVED_PROBE)}`, { headers: authH(A.token) });
    assert(probe.status === 404, `the reserved key was not written: ${probe.status}`);
});

await test('G5. Cleanup: whatever an unfixed node let through is removed', async () => {
    for (const o of [A, B]) {
        for (const g of [reservedPkg, migPkg].filter(Boolean)) {
            for (const id of await instancesOf(o.token, g.groupId)) {
                await json(`/v1/instances/${id}`, { method: 'DELETE', headers: authH(o.token), body: JSON.stringify({ removeComponents: true }) });
            }
        }
        await json(`/v1/memory/${encodeURIComponent(RESERVED_PROBE)}`, { method: 'DELETE', headers: authH(o.token) });
    }
});

// ── Part H: a memory component is a write into the owner's memory ─────────────
console.log('\nPart H — who may write the owner\'s memory through a package');

// A package installs under the OWNER whoever presses install, so its memory component writes into
// the owner's namespace. The memory door asks memory:write for that, and memory:write-as-owner of a
// principal that writes there from outside it (an agent). packages:write, which every agent holds,
// had been enough for all of it.
const OWNED_PREFIX = 'pkgcomp.owned';
let ownedPkg!: Awaited<ReturnType<typeof createPackage>>;
let plainPkg!: Awaited<ReturnType<typeof createPackage>>;
let narrowAgent = '';

// PKCE for the app grants below: each authorize and consent mints its own single-use code.
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
const APP_FILE = 'pkg-installer-app.html';
const REDIRECT = 'http://localhost:9922/callback';

/** An app grant of B's own app holding exactly `scopes`, through the real consent flow. */
async function grantApp(scopes: string[]): Promise<string> {
    const q = new URLSearchParams({
        app: `${B.name}/${APP_FILE}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `authorize: ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: authH(B.token), body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token as string;
}

async function removeInstancesOf(token: string, groupId: string): Promise<void> {
    for (const id of await instancesOf(token, groupId)) {
        await json(`/v1/instances/${id}`, { method: 'DELETE', headers: authH(token), body: JSON.stringify({ removeComponents: true }) });
    }
}

await test('H1. Setup: a public package with an ordinary memory component, one without, and an app of B\'s', async () => {
    ownedPkg = await createPackage(A.token, `owned-kit-${Date.now()}`, [
        { id: 'seed', type: 'memory', label: 'Seed', content: MEMORY_ENTRIES(OWNED_PREFIX), dependencies: [] },
    ], 'public');
    plainPkg = await createPackage(A.token, `plain-kit-${Date.now()}`, [
        { id: 'sync', type: 'msm', label: 'Sync', content: MSM_YAML, dependencies: [] },
    ], 'public');
    const pub = await json('/v1/apps', {
        method: 'POST', headers: authH(B.token),
        body: JSON.stringify({ filename: APP_FILE, content: Buffer.from('<!DOCTYPE html><html><body>installer</body></html>').toString('base64'), name: 'Installer', description: 'installs packages', category: 'utility' }),
    });
    assert(pub.status === 201, `publish B's app: ${pub.status} ${JSON.stringify(pub.body.error)}`);
    narrowAgent = await setupAgent(B, 'pkg-narrow', ['packages:write', 'memory:read']);
});

await test('H2. An agent holding packages:write but not the owner-write words is refused before anything registers', async () => {
    const r = await json(`/v1/packages/${ownedPkg.encoded}/install`, {
        method: 'POST', headers: authH(narrowAgent), body: JSON.stringify({ label: 'narrow' }),
    });
    // Whatever an unfixed node let through is removed before the verdict.
    if (r.status === 201) await removeInstancesOf(B.token, ownedPkg.groupId);
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED',
        `expected 403 SCOPE_DENIED, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    for (const word of ['memory:write', 'memory:write-as-owner']) {
        assert(String(r.body.error?.message).includes(word), `the refusal names ${word}: ${r.body.error?.message}`);
    }
    const index = await json(`/v1/memory/${encodeURIComponent(`${OWNED_PREFIX}.index`)}`, { headers: authH(B.token) });
    assert(index.status === 404, `nothing landed in the owner's memory: ${index.status}`);
    assert((await instancesOf(B.token, ownedPkg.groupId)).length === 0, 'no instance was recorded');
});

await test('H3. The same agent installs a package with no memory component: it writes no memory', async () => {
    const r = await json(`/v1/packages/${plainPkg.encoded}/install`, {
        method: 'POST', headers: authH(narrowAgent), body: JSON.stringify({ label: 'plain' }),
    });
    assert(r.status === 201, `a package without memory costs packages:write alone: ${r.status} ${JSON.stringify(r.body.error)}`);
    await removeInstancesOf(B.token, plainPkg.groupId);
});

await test('H4. An agent holding memory:write and memory:write-as-owner installs it, into the owner\'s memory', async () => {
    const writer = await setupAgent(B, 'pkg-writer', ['packages:write', 'memory:write', 'memory:write-as-owner']);
    const r = await json(`/v1/packages/${ownedPkg.encoded}/install`, {
        method: 'POST', headers: authH(writer), body: JSON.stringify({ label: 'writer' }),
    });
    assert(r.status === 201, `with the owner-write words the install passes: ${r.status} ${JSON.stringify(r.body.error)}`);
    const index = await json(`/v1/memory/${encodeURIComponent(`${OWNED_PREFIX}.index`)}`, { headers: authH(B.token) });
    assert(index.status === 200, `the keys are the owner's: ${index.status}`);
});

await test('H5. A migration that registers a memory component asks the same, before anything is deleted', async () => {
    const [instanceId] = await instancesOf(B.token, ownedPkg.groupId);
    assert(!!instanceId, 'the writer\'s install is there to migrate');
    await new Promise(r => setTimeout(r, 1100));   // a version is named by its time, to the second
    const v2 = await json(`/v1/packages/${ownedPkg.encoded}/versions`, {
        method: 'POST', headers: authH(A.token),
        body: JSON.stringify({ changelog: 'new seed', status: 'published', components: [
            { id: 'seed', type: 'memory', label: 'Seed', content: MEMORY_ENTRIES(`${OWNED_PREFIX}.v2`), dependencies: [] },
        ] }),
    });
    assert(v2.status === 201, `v2 ${v2.status}: ${JSON.stringify(v2.body.error)}`);
    const migrate = await json(`/v1/instances/${instanceId}/apply-migration`, {
        method: 'POST', headers: authH(narrowAgent),
        body: JSON.stringify({ targetVersion: v2.body.data.version, components: [{ componentId: 'seed', action: 'replace' }] }),
    });
    assert(migrate.status === 403 && migrate.body.error?.code === 'SCOPE_DENIED',
        `apply-migration by the narrow agent: ${migrate.status} ${JSON.stringify(migrate.body.error ?? migrate.body.data)}`);
    const update = await json(`/v1/instances/${instanceId}/update`, {
        method: 'POST', headers: authH(narrowAgent), body: JSON.stringify({}),
    });
    assert(update.status === 403 && update.body.error?.code === 'SCOPE_DENIED',
        `update by the narrow agent: ${update.status} ${JSON.stringify(update.body.error ?? update.body.data)}`);
    const kept = await json(`/v1/memory/${encodeURIComponent(`${OWNED_PREFIX}.index`)}`, { headers: authH(B.token) });
    assert(kept.status === 200, `the installed copy is still there: ${kept.status}`);
    const moved = await json(`/v1/memory/${encodeURIComponent(`${OWNED_PREFIX}.v2.index`)}`, { headers: authH(B.token) });
    assert(moved.status === 404, `the new version wrote nothing: ${moved.status}`);
    await removeInstancesOf(B.token, ownedPkg.groupId);
});

await test('H6. An app grant writes the owner\'s memory as its own, so memory:write is its word', async () => {
    const installOnly = await grantApp(['packages:write']);
    const refused = await json(`/v1/packages/${ownedPkg.encoded}/install`, {
        method: 'POST', headers: authH(installOnly), body: JSON.stringify({ label: 'app' }),
    });
    if (refused.status === 201) await removeInstancesOf(B.token, ownedPkg.groupId);
    assert(refused.status === 403 && /memory:write/.test(refused.body.error?.message ?? ''),
        `an app grant without memory:write: ${refused.status} ${JSON.stringify(refused.body.error ?? refused.body.data)}`);
    const writes = await grantApp(['packages:write', 'memory:write']);
    const allowed = await json(`/v1/packages/${ownedPkg.encoded}/install`, {
        method: 'POST', headers: authH(writes), body: JSON.stringify({ label: 'app' }),
    });
    assert(allowed.status === 201, `an app grant with memory:write: ${allowed.status} ${JSON.stringify(allowed.body.error)}`);
    await removeInstancesOf(B.token, ownedPkg.groupId);
});

await test('Cleanup: delete the packages and both owners', async () => {
    for (const p of [mainPkg, ladderPkg, publicPkg, reservedPkg, migPkg, ownedPkg, plainPkg].filter(Boolean)) {
        const r = await json(`/v1/packages/${p.encoded}`, { method: 'DELETE', headers: authH(A.token) });
        assert(r.status === 200, `package delete ${p.groupId} → ${r.status}`);
    }
    for (const o of [A, B]) {
        const r = await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: authH(o.token) });
        assert(r.status === 200, `owner delete ${o.name} → ${r.status}`);
    }
});

console.log(`\nPackage components: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

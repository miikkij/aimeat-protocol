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
 *   owner removing an instance that is not theirs.
 * @structure Setup · Part A msm register + read back · Part B memory register + read back ·
 *   Part C the parse ladder · Part D status hashing · Part E uninstall · Part F refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-components
 * @version-history
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
import { createHash } from 'node:crypto';
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

await test('Cleanup: delete the packages and both owners', async () => {
    for (const p of [mainPkg, ladderPkg, publicPkg]) {
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

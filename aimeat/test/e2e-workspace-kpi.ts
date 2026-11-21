/**
 * @file e2e-workspace-kpi.ts
 * @description Tests the measurability KPI rollup (Phase B) + the overview surface (Phase C) of the
 *   organism-measurability convention. A workspace manifest declares objectives[] with KPIs whose
 *   source is `{from:'records',...}`; GET /v1/organisms/:id/workspace/overview resolves each KPI's
 *   `current` from the workspace's OWN published records (sum / count + equality filter), excludes
 *   drafts, and falls back to the declared `current` for a string-recipe source. The structured
 *   objectives ride in the JSON response and the KPI lines appear in the Markdown.
 *   Design: docs/internal/2026-06-23-organism-measurability-design.md.
 *   Also the organism's own objectives (organism.<id>.meta.manifest) on GET /v1/organisms/:id and
 *   the organism overview, an objective's level/serves/until in both overviews, and the workspace
 *   manifest version lock (expected_version, 409 VERSION_CONFLICT).
 * @version-history
 *   v1.1.0 — 2026-11-21 — Organism objectives, level/serves/until, expected_version (tests 8 to 12 and
 *     the organism-objectives SECURITY test; red before the change: no surface returned them).
 *   v1.0.0 — 2026-06-23 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-kpi

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
import { ownerSignIn } from './helpers/owner-login.js';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function mkOwner(name: string) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'WsKpi1234' }) });
    const tk = await ownerSignIn(BASE, name, 'WsKpi1234');
    return tk.body.data.token as string;
}

console.log('\n=== AIMEAT Workspace KPI Rollup E2E ===\n');
let creator = '', creatorTok = '', orgId = '';
const WS = 'ws-kpi1', root = () => `organism.${orgId}.w.${WS}`;
const findKpi = (objs: any[], name: string) => objs.flatMap((o: any) => o.kpis).find((k: any) => k.name === name);
const writeMem = (key: string, value: unknown) => json('/v1/memory', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ key, value, visibility: 'private' }) });

await test('Setup creator + org + workspace (manifest with objectives + records)', async () => {
    creator = `wskpi${Date.now()}`;
    creatorTok = await mkOwner(creator);
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ name: 'Cabin Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;

    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Build my cabin', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'costs', schemaRef: 'schema:costs@1', namespace: 'shared.costs', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, servesObjective: 'the-cabin' },
            { name: 'locations', schemaRef: 'schema:locations@1', namespace: 'shared.locations', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, servesObjective: 'the-cabin' },
        ],
        objectives: [{
            id: 'the-cabin', statement: 'A year-round cabin under 80 000 €, within 2 h', why: 'No mortgage-sized build', status: 'active',
            kpis: [
                { name: 'total-build-cost', kind: 'cost', unit: 'EUR', target: { op: '<', value: 80000 },
                  source: { from: 'records', space: 'costs', agg: 'sum', field: 'quote_eur' } },
                { name: 'viable-locations', kind: 'outcome', unit: 'count', target: { op: '>=', value: 2 },
                  source: { from: 'records', space: 'locations', agg: 'count', equals: { field: 'status', value: 'viable' } } },
                { name: 'build-quality', kind: 'quality', unit: '%', target: { op: '>=', value: 90 },
                  source: 'eyeballed at each milestone', current: 88 },
                { name: 'unresolvable', kind: 'cost', unit: 'EUR', target: { op: '<', value: 1 },
                  source: { from: 'records', space: 'does-not-exist', agg: 'sum', field: 'x' } },
            ],
        }],
    };
    const m = await writeMem(`${root()}.meta.manifest`, manifest);
    assert(m.status === 200 || m.status === 201, `manifest write ${m.status}: ${JSON.stringify(m.body)}`);
    await writeMem(`organism.${orgId}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Build my cabin', createdBy: creator, createdAt: new Date().toISOString() }] });

    // Published cost records (bare keys = published; .draft must be EXCLUDED from the sum).
    await writeMem(`${root()}.shared.costs.c1`, { item: 'Foundation', quote_eur: 11000, status: 'quoted' });
    await writeMem(`${root()}.shared.costs.c2`, { item: 'Frame', quote_eur: 30000, status: 'quoted' });
    await writeMem(`${root()}.shared.costs.c3`, { item: 'Roof', quote_eur: 25000, status: 'quoted' });
    await writeMem(`${root()}.shared.costs.c4.draft`, { item: 'Sauna', quote_eur: 99999, status: 'draft' });   // draft → excluded
    // Locations: 2 viable + 1 ruled out.
    await writeMem(`${root()}.shared.locations.l1`, { name: 'Plot A', status: 'viable' });
    await writeMem(`${root()}.shared.locations.l2`, { name: 'Plot B', status: 'viable' });
    await writeMem(`${root()}.shared.locations.l3`, { name: 'Plot C', status: 'ruled-out' });
});

let objectives: any[] = [];
await test('1. overview returns the objectives with resolved KPIs', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth(creatorTok) });
    assert(r.status === 200 && r.body.data.readable, `overview ${r.status}: ${JSON.stringify(r.body)}`);
    objectives = r.body.data.objectives;
    assert(Array.isArray(objectives) && objectives.length === 1 && objectives[0].id === 'the-cabin', `objectives: ${JSON.stringify(objectives)}`);
});

await test('2. sum KPI computes from published records and EXCLUDES the draft', async () => {
    const k = findKpi(objectives, 'total-build-cost');
    assert(!!k, 'total-build-cost present');
    assert(k.current === 66000, `expected 66000 (11k+30k+25k, draft 99999 excluded), got ${k.current}`);
    assert(k.computed === true, 'computed flag set for a records source');
});

await test('3. count KPI with an equality filter counts only matching records', async () => {
    const k = findKpi(objectives, 'viable-locations');
    assert(k.current === 2 && k.computed === true, `expected 2 viable, got ${k.current} (computed=${k.computed})`);
});

await test('4. string-recipe KPI keeps its declared current (not computed)', async () => {
    const k = findKpi(objectives, 'build-quality');
    assert(k.current === 88 && k.computed === false, `expected declared 88/uncomputed, got ${k.current}/${k.computed}`);
});

await test('5. a records KPI pointing at a missing space resolves to null', async () => {
    const k = findKpi(objectives, 'unresolvable');
    assert(k.current === null && k.computed === false, `expected null/uncomputed, got ${k.current}/${k.computed}`);
});

await test('6. markdown renders an Objectives block with the KPI lines', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}&format=md`, { headers: auth(creatorTok) });
    const md = r.body._raw as string;
    assert(/Objectives/.test(md), 'markdown has an Objectives heading');
    assert(/total-build-cost/.test(md) && /66000/.test(md), `markdown shows the computed cost: ${md.slice(0, 400)}`);
    assert(/viable-locations/.test(md), 'markdown shows the count KPI');
});

await test('7. a newer .latest overrides a bare write for the same instance (published value wins)', async () => {
    // c2 had quote_eur 30000 as a bare write; publish a .latest correcting it to 20000 → sum drops by 10k.
    await writeMem(`${root()}.shared.costs.c2.latest`, { item: 'Frame', quote_eur: 20000, status: 'quoted' });
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth(creatorTok) });
    const k = findKpi(r.body.data.objectives, 'total-build-cost');
    assert(k.current === 56000, `expected 56000 (11k + 20k(.latest) + 25k), got ${k.current}`);
});

// ── The organism's own objectives and the manifest version lock
// (wish-suunta-n-kyviin-organismin-manifestin-tavoitteet-ja-tasot-yl) ──

await test('8. without an organism manifest the read and the overview show no organism objectives, and no error', async () => {
    const g = await json(`/v1/organisms/${orgId}`, { headers: auth(creatorTok) });
    assert(g.status === 200, `GET organism ${g.status}: ${JSON.stringify(g.body?.error)}`);
    assert(Array.isArray(g.body.data.objectives) && g.body.data.objectives.length === 0, `objectives without a manifest: ${JSON.stringify(g.body.data.objectives)}`);
    const o = await json(`/v1/organisms/${orgId}/overview`, { headers: auth(creatorTok) });
    assert(o.status === 200 && Array.isArray(o.body.data.objectives) && o.body.data.objectives.length === 0, `overview ${o.status}: ${JSON.stringify(o.body.data?.objectives)}`);
    assert(!/Organism objectives/.test(o.body.data.markdown), 'no Organism objectives block without a manifest');
});

const ORG_OBJECTIVE = {
    id: 'year-round', statement: 'Live at the cabin all year', status: 'active',
    level: 'main', until: '2027-06-30', serves: [{ organism: 'family-org', objective: 'more-time-outdoors' }],
    kpis: [
        { name: 'org-build-cost', kind: 'cost', unit: 'EUR', target: { op: '<', value: 80000 },
          source: { from: 'records', ws: WS, space: 'costs', agg: 'sum', field: 'quote_eur' } },
        { name: 'org-nights', kind: 'outcome', unit: 'nights', source: 'counted by hand', current: 3 },
    ],
};

await test('9. the organism manifest\'s objectives reach the organism read with level, serves, until and a computed KPI', async () => {
    // The organism manifest is held to the same manifest schema as a workspace's.
    const w = await writeMem(`organism.${orgId}.meta.manifest`, {
        manifestVersion: '1.0', id: orgId, name: 'Cabin Org', kind: 'project', status: 'active',
        objectTypes: [{ name: 'notes', schemaRef: 'schema:notes@1', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member' }],
        objectives: [ORG_OBJECTIVE],
    });
    assert(w.status === 200 || w.status === 201, `organism manifest write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const g = await json(`/v1/organisms/${orgId}`, { headers: auth(creatorTok) });
    const o = g.body.data.objectives?.[0];
    assert(o && o.id === 'year-round' && o.level === 'main' && o.until === '2027-06-30', `organism objective: ${JSON.stringify(o)}`);
    assert(o.serves?.[0]?.organism === 'family-org' && o.serves[0].objective === 'more-time-outdoors', `serves: ${JSON.stringify(o.serves)}`);
    const cost = o.kpis.find((k: any) => k.name === 'org-build-cost');
    assert(cost.current === 56000 && cost.computed === true, `the KPI named the workspace's costs: ${JSON.stringify(cost)}`);
    const nights = o.kpis.find((k: any) => k.name === 'org-nights');
    assert(nights.current === 3 && nights.computed === false, `declared KPI: ${JSON.stringify(nights)}`);
});

await test('10. the organism overview opens with the organism objectives, in the answer and in the Markdown', async () => {
    const r = await json(`/v1/organisms/${orgId}/overview`, { headers: auth(creatorTok) });
    assert(r.status === 200, `overview ${r.status}`);
    assert(r.body.data.objectives?.[0]?.level === 'main', `overview objectives: ${JSON.stringify(r.body.data.objectives)}`);
    const md = r.body.data.markdown as string;
    assert(/## Organism objectives/.test(md) && /Live at the cabin all year/.test(md), `markdown block: ${md.slice(0, 500)}`);
    assert(/main · until 2027-06-30/.test(md) && /serves: family-org \/ more-time-outdoors/.test(md), `level, until and serves in the Markdown: ${md.slice(0, 600)}`);
    assert(md.indexOf('Organism objectives') < md.indexOf('## Build my cabin'), 'the organism objectives come before the workspaces');
});

let manifestVersion = 0;
await test('11. the workspace index answers manifest_version, and a stale expected_version is refused 409 with nothing written', async () => {
    const idx = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(creatorTok) });
    assert(idx.status === 200 && typeof idx.body.data.manifest_version === 'number', `index ${idx.status}: manifest_version ${idx.body.data?.manifest_version}`);
    manifestVersion = idx.body.data.manifest_version;
    const manifest = idx.body.data.manifest;
    const changed = { ...manifest, objectives: manifest.objectives.map((o: any) => ({ ...o, level: 'important' })) };
    const stale = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ manifest: changed, expected_version: manifestVersion - 1 }) });
    assert(stale.status === 409 && stale.body.error?.code === 'VERSION_CONFLICT', `stale version: ${stale.status} ${JSON.stringify(stale.body.error)}`);
    const after = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(creatorTok) });
    assert(after.body.data.manifest_version === manifestVersion, `the refused update wrote the manifest: ${after.body.data.manifest_version} != ${manifestVersion}`);
    assert(after.body.data.manifest.objectives[0].level === undefined, `the refused level landed: ${after.body.data.manifest.objectives[0].level}`);
});

await test('12. the current expected_version updates the manifest, and the workspace overview passes level, serves and until', async () => {
    const idx = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(creatorTok) });
    const manifest = idx.body.data.manifest;
    const changed = { ...manifest, objectives: manifest.objectives.map((o: any) => ({ ...o, level: 'important', until: '2026-12-31', serves: [{ organism: orgId, objective: 'year-round' }] })) };
    const ok = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ manifest: changed, expected_version: manifestVersion }) });
    assert(ok.status === 200 && ok.body.data.manifest_version === manifestVersion + 1, `update ${ok.status}: ${JSON.stringify(ok.body.data ?? ok.body.error)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth(creatorTok) });
    const o = r.body.data.objectives[0];
    assert(o.level === 'important' && o.until === '2026-12-31' && o.serves?.[0]?.objective === 'year-round', `workspace objective: ${JSON.stringify(o)}`);
    assert(/important · until 2026-12-31/.test(r.body.data.markdown) && new RegExp(`serves: ${orgId} / year-round`).test(r.body.data.markdown), `workspace Markdown: ${String(r.body.data.markdown).slice(0, 500)}`);
});

await test('SECURITY. the organism objectives: a member without the workspace gets the declared value only, a visitor gets none', async () => {
    const memberTok = await mkOwner(`kpiorg${Date.now()}`);
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}`);
    const g = await json(`/v1/organisms/${orgId}`, { headers: auth(memberTok) });
    const cost = g.body.data.objectives?.[0]?.kpis?.find((k: any) => k.name === 'org-build-cost');
    assert(cost && cost.computed === false && cost.current === null, `the KPI was computed from a workspace the member may not read: ${JSON.stringify(cost)}`);
    const visitor = await mkOwner(`kpivis${Date.now()}`);
    const v = await json(`/v1/organisms/${orgId}`, { headers: auth(visitor) });
    assert(v.status === 200 && v.body.data.objectives === undefined, `a visitor read the objectives of a public organism: ${JSON.stringify(v.body.data?.objectives)}`);
});

await test('SECURITY. the KPI numbers are gated: a member without the workspace, and a non-member', async () => {
    // Test 1 asserts `readable` and then trusts it. Every call in this suite is the creator's, so no
    // non-member and no member-without-a-workspace-grant is ever refused. Change
    // `objectives: readable ? summary.objectives : []` to `objectives: summary.objectives` in
    // GET /v1/organisms/:id/workspace/overview and — this organism is join_policy 'open' — anyone who
    // joins reads the cost and location KPI values of a gated workspace.
    const memberName = `kpimem${Date.now()}`;
    const memberTok = await mkOwner(memberName);
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);

    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth(memberTok) });
    assert(r.status === 200, `a member may ask: ${r.status}`);
    assert(r.body.data.readable === false, `the member has no grant on this workspace: ${r.body.data.readable}`);
    assert(Array.isArray(r.body.data.objectives) && r.body.data.objectives.length === 0,
        `the KPI objectives were served to an ungranted member: ${JSON.stringify(r.body.data.objectives)}`);
    // The markdown rendering is the same data by another door.
    const md = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}&format=md`, { headers: auth(memberTok) });
    const text = JSON.stringify(md.body ?? {});
    assert(!text.includes('66000') && !text.includes('the-cabin'),
        `the markdown carried the KPI numbers: ${text.slice(0, 200)}`);

    // And a complete stranger does not get as far as asking.
    const outsiderTok = await mkOwner(`kpiout${Date.now()}`);
    const out = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth(outsiderTok) });
    assert(out.status === 403 || out.status === 404, `a non-member read the overview: ${out.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${creator}`, { method: 'DELETE', headers: auth(creatorTok) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

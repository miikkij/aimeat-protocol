/**
 * @file e2e-workspace-kpi.ts
 * @description Tests the measurability KPI rollup (Phase B) + the overview surface (Phase C) of the
 *   organism-measurability convention. A workspace manifest declares objectives[] with KPIs whose
 *   source is `{from:'records',...}`; GET /v1/organisms/:id/workspace/overview resolves each KPI's
 *   `current` from the workspace's OWN published records (sum / count + equality filter), excludes
 *   drafts, and falls back to the declared `current` for a string-recipe source. The structured
 *   objectives ride in the JSON response and the KPI lines appear in the Markdown.
 *   Design: docs/internal/2026-06-23-organism-measurability-design.md.
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-kpi

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function mkOwner(name: string) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'WsKpi1234' }) });
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
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

await test('Cleanup', async () => {
    await json(`/v1/owners/${creator}`, { method: 'DELETE', headers: auth(creatorTok) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

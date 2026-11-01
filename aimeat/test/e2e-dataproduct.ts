/**
 * @file e2e-dataproduct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for data products (plan doc-mvwxcas3dom3, D9): a definition that builds a data
 *   package version from material. Owner A has an organism workspace with a records space, memory
 *   records, an app with a data map, an extension, a CSV file and a data package; owner B has none of
 *   A's access.
 *   D9.1 each of the six source kinds builds a version (records, app, memory, extension, file,
 *     datapackage), with provenance naming the source; the app source reads only the families its
 *     data map marks publishable, and leaves out the personal ones.
 *   D9.9 tables, union (and the column mismatch refusal) and join (unmatched left rows kept, the
 *     duplicate right key refused); the filter is in the transformations.
 *   D9.3 the audience may not be wider than the narrowest source; a personal column included makes
 *     public refused; the same rows give no new version; a failing source writes no version, keeps
 *     the previous one and names the source in lastRun.
 *   D9.4 a preview publishes nothing and answers the rows, the schema, the validation and the ODPS sheet.
 *   D9.5 a schedule is made with the definition, builds on a trigger, and is removed with it.
 *   Cross-owner and cross-scope: B cannot define from A's private memory key, A's workspace or A's
 *   file, and cannot read, run or delete A's definition; an agent without memory:write is refused; an
 *   agent with the words defines and previews over MCP.
 * @version-history
 *   v1.1.0 — 2026-11-01 — D9.6: the list's package, freshness, shares, reads, next run, source label and
 *     intermediation mode; retention keeps the newest versions; the parties list's share cap and
 *     dataspace flag (WP9a; the assertions fail on the code before it: retention was an unknown field).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dataproduct

import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body; text: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 500)}`;
const stamp = Date.now() % 10_000_000;

async function mkOwner(label: string) {
    const name = `dpr${label}${stamp}`;
    let reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dpr12345!' } });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dpr12345!' } }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'Dpr12345!');
    return { name, token: tk.body.data.token as string };
}
const putMemory = (token: string, key: string, value: unknown, visibility = 'private') =>
    call('/v1/memory', { token, body: { key, value, visibility } });
const define = (token: string, name: string, body: Record<string, unknown>) =>
    call(`/v1/dataproducts/${name}`, { token, method: 'PUT', body });
const run = (token: string, name: string) => call(`/v1/dataproducts/${name}/run`, { token, body: {} });
const descriptorOf = async (token: string, owner: string, name: string) => (await call(`/v1/datapackages/${owner}/${name}`, { token })).body?.data?.descriptor as Body | undefined;
const rowsOf = async (token: string, owner: string, name: string, resource = 'rows') =>
    (await call(`/v1/datapackages/${owner}/${name}/rows/${resource}?limit=100`, { token })).body?.data?.rows as Body[] | undefined;

console.log('\n=== AIMEAT data products E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' };
let orgId = '', ws = '';
const APP = `dpapp${stamp}.html`;
const EXT = `dpext${stamp}`;
const SRC = `dpsrc${stamp}`;
const N = (s: string) => `dp${s}${stamp}`;

await test('Setup: A has a records space, memory, an app with a data map, an extension, a CSV and a package', async () => {
    A = await mkOwner('a'); B = await mkOwner('b');
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Dpr Org ${stamp}`, type: 'project', join_policy: 'approval_required', visibility: 'private' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgId = org.body.data.organism.id;
    const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: { name: 'Signals', manifest: {
        manifestVersion: '1', name: 'Signals', kind: 'project',
        objectTypes: [{ name: 'signal', namespace: 'shared.signals', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:signal@1' }],
    }, schemas: { 'shared.signals': { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, kunta: { type: 'string' }, signaali: { type: 'integer' } } } } } });
    assert(w.status === 201 || w.status === 200, `workspace: ${show(w)}`);
    ws = w.body.data.ws;
    for (const [id, kunta, signaali] of [['s1', 'Espoo', 3], ['s2', 'Vantaa', 5], ['s3', 'Oulu', 1]] as const) {
        const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'signal', id, value: { kunta, signaali } } });
        assert(d.status === 200, `draft ${id}: ${show(d)}`);
        const p = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.signals', id } });
        assert(p.status === 200, `publish ${id}: ${show(p)}`);
    }
    // A record whose draft is never published is not data yet.
    await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'signal', id: 's4', value: { kunta: 'Draft', signaali: 9 } } });

    assert((await putMemory(A.token, 'dpr.budget', { items: [{ kunta: 'Espoo', budjetti: 10 }, { kunta: 'Vantaa', budjetti: 7 }, { kunta: 'Oulu', budjetti: 3 }] })).status < 300, 'budget');
    assert((await putMemory(A.token, 'dpr.pop', [{ kunta: 'Espoo', asukkaat: 300 }, { kunta: 'Vantaa', asukkaat: 240 }], 'public')).status < 300, 'pop');
    assert((await putMemory(A.token, 'dpr.popdup', [{ kunta: 'Espoo', asukkaat: 1 }, { kunta: 'Espoo', asukkaat: 2 }], 'public')).status < 300, 'popdup');
    assert((await putMemory(A.token, 'dpr.more', [{ kunta: 'Turku', budjetti: 4 }], 'public')).status < 300, 'more');

    const app = await call('/v1/apps', { token: A.token, body: { filename: APP, name: 'Dp', description: 'dp e2e', content: Buffer.from('<!doctype html><title>d</title><p>d', 'utf8').toString('base64') } });
    assert(app.status === 200 || app.status === 201, `app: ${show(app)}`);
    const base = { holds: 'x', kind: 'register', usedFor: 'shown-as-a-list', where: 'owner-memory-private', owner: 'person', readers: 'owner-only',
        writers: ['the-app-for-the-person'], shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy', why: 'test' };
    const appId = APP.replace(/\.html$/, '');
    const m = await call(`/v1/datamap/apps/${A.name}/${APP}`, { token: A.token, method: 'PUT', body: {
        spec: 'aimeat.datamap/2', what: 'A data product test app.', usedFor: 'Testing.', form: 'one-person', arrangement: 'Memory.', machinery: [], leaves: [], elsewhere: [],
        held: [
            { ...base, what: `${appId}.items.*`, personalData: 'no', publishable: true },
            { ...base, what: `${appId}.people.*`, personalData: 'yes', domains: [], publishable: true },
            { ...base, what: `${appId}.secret.*`, personalData: 'no' },
        ] } });
    assert(m.status === 200, `map: ${show(m)}`);
    await putMemory(A.token, `${appId}.items.1`, { name: 'kahvi', qty: 2 });
    await putMemory(A.token, `${appId}.items.2`, { name: 'tee', qty: 5 });
    await putMemory(A.token, `${appId}.people.1`, { name: 'Ann', email: 'ann@example.com' });
    await putMemory(A.token, `${appId}.secret.1`, { pin: '1234' });

    const manifest = JSON.stringify({ metadata: { name: EXT, version: '1.0.0', description: 'dp e2e', author: 'e2e' },
        actions: [{ id: 'rows', method: 'POST', path: '/rows', script: 'rows' }, { id: 'boom', method: 'POST', path: '/boom', script: 'boom' }],
        config: { public_access: { default: true } }, limits: { timeout_ms: 10000, max_api_calls: 4 } });
    const scripts = {
        rows: 'export default async function(ctx, input){ return { data: { rows: [{ kunta: "Espoo", arvo: 1 }, { kunta: "Lahti", arvo: 2 }] } }; }',
        boom: 'export default async function(ctx, input){ throw new Error("upstream did not answer"); }',
    };
    const inst = await call('/v1/extensions', { token: A.token, body: { manifest, scripts } });
    assert(inst.status === 201 || inst.status === 200, `extension: ${show(inst)}`);
    assert((await call(`/v1/extensions/${EXT}/activate`, { token: A.token, body: {} })).status === 200, 'activate');

    const csv = 'kunta,vuosi,summa\nEspoo,2025,100\nOulu,2025,40\n';
    const up = await call('/v1/storage', { token: A.token, body: { key: 'dpr/towns.csv', data: Buffer.from(csv).toString('base64'), mime_type: 'text/csv', visibility: 'private' } });
    assert(up.status === 201, `upload: ${show(up)}`);

    const pkg = await call('/v1/datapackages', { token: A.token, body: { name: SRC, changes: 'source', visibility: 'public', resources: [{ name: 'rows', rows: [{ kunta: 'Espoo', x: 1 }] }] } });
    assert(pkg.status === 201, `package: ${show(pkg)}`);
});

console.log('\nD9.1 Six source kinds');

await test('D9.1a memory: a private key builds a private version, its provenance names the source and when it was read', async () => {
    const d = await define(A.token, N('mem'), { title: 'Budgets', keywords: ['budget'], sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }] });
    assert(d.status === 201 && d.body.data.created === true, `define: ${show(d)}`);
    const r = await run(A.token, N('mem'));
    assert(r.status === 201 && r.body.data.rows === 3 && r.body.data.unchanged === false, `run: ${show(r)}`);
    const desc = await descriptorOf(A.token, A.name, N('mem'));
    assert(desc?.aimeat?.sources?.[0]?.kind === 'memory' && desc.aimeat.sources[0].address.includes('dpr.budget'), `sources ${JSON.stringify(desc?.aimeat?.sources)}`);
    assert(typeof desc?.aimeat?.sourcesFetchedAt?.A === 'string' && desc?.aimeat?.producer?.kind === 'dataproduct', `fetched ${JSON.stringify(desc?.aimeat)}`);
    assert(desc?.keywords?.[0] === 'budget', `keywords ${JSON.stringify(desc?.keywords)}`);
    const got = await call(`/v1/dataproducts/${N('mem')}`, { token: A.token });
    assert(got.body.data.definition.lastRun.ok === true && got.body.data.package.visibility === 'private', `get: ${show(got)}`);
});

await test('D9.1b records: the published records of the space are the rows, typed by the locked schema, at the organism', async () => {
    const d = await define(A.token, N('rec'), { visibility: `organism:${orgId}`, sources: [{ kind: 'records', organism_id: orgId, ws, space: 'signal' }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('rec'));
    assert(r.status === 201 && r.body.data.rows === 3, `run: ${show(r)}`);
    const desc = await descriptorOf(A.token, A.name, N('rec'));
    const fields = desc?.resources?.[0]?.schema?.fields as Body[];
    assert(fields?.find(f => f.name === 'signaali')?.type === 'integer', `schema ${JSON.stringify(fields)}`);
    const rows = await rowsOf(A.token, A.name, N('rec'));
    assert(rows?.every(x => x.kunta !== 'Draft'), 'a draft became a row');
});

await test('D9.1c app: only the publishable families, the personal one left out by default and recorded', async () => {
    const appId = APP.replace(/\.html$/, '');
    const notMarked = await define(A.token, N('appx'), { sources: [{ kind: 'app', app: APP, key_prefix: `${appId}.secret` }] });
    assert(notMarked.status === 400 && notMarked.body.error?.code === 'NOT_PUBLISHABLE', `secret family: ${show(notMarked)}`);
    const d = await define(A.token, N('app'), { sources: [{ kind: 'app', app: APP, key_prefix: `${appId}.items` }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('app'));
    assert(r.status === 201 && r.body.data.rows === 2, `run: ${show(r)}`);
    const rows = await rowsOf(A.token, A.name, N('app'));
    assert(rows?.length === 2 && rows.every(x => !('pin' in x) && !('email' in x)), `rows ${JSON.stringify(rows)}`);
    // A family the map marks personal hands on nothing until a column is named with include: true.
    const people = await define(A.token, N('ppl'), { sources: [{ kind: 'app', app: APP, key_prefix: `${appId}.people` }] });
    assert(people.status === 400 && people.body.error?.code === 'NO_COLUMNS' && people.text.includes('personal'), `people: ${show(people)}`);
});

await test('D9.1d extension: the action the node runs is the material', async () => {
    const d = await define(A.token, N('ext'), { sources: [{ kind: 'extension', ext: EXT, action: 'rows', rows_at: 'data.rows' }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('ext'));
    assert(r.status === 201 && r.body.data.rows === 2, `run: ${show(r)}`);
    const desc = await descriptorOf(A.token, A.name, N('ext'));
    assert(desc?.aimeat?.sources?.[0]?.address === `ext:${EXT}/rows`, `address ${JSON.stringify(desc?.aimeat?.sources)}`);
});

await test('D9.1e file: a stored CSV, with its numbers typed', async () => {
    const d = await define(A.token, N('csv'), { sources: [{ kind: 'file', key: 'dpr/towns.csv' }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('csv'));
    assert(r.status === 201 && r.body.data.rows === 2, `run: ${show(r)}`);
    const fields = (await descriptorOf(A.token, A.name, N('csv')))?.resources?.[0]?.schema?.fields as Body[];
    assert(fields?.find(f => f.name === 'summa')?.type === 'integer', `schema ${JSON.stringify(fields)}`);
});

await test('D9.1f datapackage: another package, which goes into the lineage', async () => {
    const d = await define(A.token, N('pkg'), { visibility: 'public', sources: [{ kind: 'datapackage', name: SRC }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('pkg'));
    assert(r.status === 201, `run: ${show(r)}`);
    const desc = await descriptorOf(A.token, A.name, N('pkg'));
    assert((desc?.aimeat?.lineage as string[])?.[0]?.startsWith(`pkg:${A.name}/${SRC}@sha256:`), `lineage ${JSON.stringify(desc?.aimeat?.lineage)}`);
});

console.log('\nD9.9 Combining');

await test('D9.9a tables: two sources, two resources', async () => {
    const d = await define(A.token, N('tbl'), { combine: { mode: 'tables' }, sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'memory', key: 'dpr.pop' }] });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('tbl'));
    assert(r.status === 201 && (r.body.data.resources as Body[]).map(x => x.name).join(',') === 'source-a,source-b', `run: ${show(r)}`);
});

await test('D9.9b union: rows appended; different columns are refused by name', async () => {
    const bad = await define(A.token, N('uni'), { combine: { mode: 'union' }, sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'memory', key: 'dpr.pop' }] });
    assert(bad.status === 400 && bad.body.error?.code === 'UNION_COLUMNS_MISMATCH' && bad.body.error?.details?.source === 'B', `mismatch: ${show(bad)}`);
    const ok = await define(A.token, N('uni'), { combine: { mode: 'union' }, sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'memory', key: 'dpr.more' }] });
    assert(ok.status === 201, `define: ${show(ok)}`);
    const r = await run(A.token, N('uni'));
    assert(r.status === 201 && r.body.data.rows === 4, `run: ${show(r)}`);
});

await test('D9.9c join: unmatched left rows kept with nulls; a duplicate right key refused; the filter recorded', async () => {
    const dup = await define(A.token, N('joi'), { combine: { mode: 'join', key: { left: 'A.kunta', right: 'B.kunta' } },
        sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'memory', key: 'dpr.popdup' }] });
    assert(dup.status === 400 && dup.body.error?.code === 'JOIN_DUPLICATE_KEY', `dup: ${show(dup)}`);
    const d = await define(A.token, N('joi'), { combine: { mode: 'join', key: { left: 'A.kunta', right: 'B.kunta' } },
        sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'memory', key: 'dpr.pop' }],
        filter: { column: 'budjetti', op: 'gte', value: 3 } });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('joi'));
    assert(r.status === 201 && r.body.data.rows === 3, `run: ${show(r)}`);
    const rows = await rowsOf(A.token, A.name, N('joi'));
    const oulu = rows?.find(x => x.kunta === 'Oulu');
    assert(oulu && oulu.asukkaat === null && rows?.find(x => x.kunta === 'Espoo')?.asukkaat === 300, `rows ${JSON.stringify(rows)}`);
    const what = ((await descriptorOf(A.token, A.name, N('joi')))?.aimeat?.transformations as Body[]).map(t => t.what);
    assert(what.includes('kept the rows where budjetti gte 3') && what.some(w => w.startsWith('left join of A with B')), `transformations ${JSON.stringify(what)}`);
});

console.log('\nD9.3 Audience, personal data, versions, failures');

await test('D9.3a public from a private key, or from the organism workspace, is refused naming the source', async () => {
    const mem = await define(A.token, N('pubm'), { visibility: 'public', sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }] });
    assert(mem.status === 409 && mem.body.error?.code === 'AUDIENCE_WIDER_THAN_SOURCE' && mem.body.error?.details?.source === 'A', `memory: ${show(mem)}`);
    const rec = await define(A.token, N('pubr'), { visibility: 'public', sources: [{ kind: 'records', organism_id: orgId, ws, space: 'signal' }] });
    assert(rec.status === 409 && rec.body.error?.code === 'AUDIENCE_WIDER_THAN_SOURCE', `records: ${show(rec)}`);
    assert((await call(`/v1/dataproducts/${N('pubm')}`, { token: A.token })).status === 404, 'a refused definition was stored');
});

await test('D9.3b a personal column included makes public refused, until the owner confirms', async () => {
    // An extension source is public material; the personal mark comes from a data map naming it.
    const appId = APP.replace(/\.html$/, '');
    const body = { visibility: 'members', sources: [{ kind: 'app', app: APP, key_prefix: `${appId}.people` }], columns: [{ source: 'A', from: 'name' }, { source: 'A', from: 'email', include: true }] };
    const members = await define(A.token, N('pers'), body);
    // The app's records are private, so members is too wide: the audience rule comes first.
    assert(members.status === 409 && members.body.error?.code === 'AUDIENCE_WIDER_THAN_SOURCE', `members: ${show(members)}`);
    await putMemory(A.token, `${appId}.people.1`, { name: 'Ann', email: 'ann@example.com' }, 'public');
    const pub = await define(A.token, N('pers'), { ...body, visibility: 'public' });
    assert(pub.status === 409 && pub.body.error?.code === 'PERSONAL_DATA_PUBLIC', `public: ${show(pub)}`);
    const confirmed = await define(A.token, N('pers'), { ...body, visibility: 'public', confirm_personal_public: true });
    assert(confirmed.status === 201, `confirmed: ${show(confirmed)}`);
    const dropped = await define(A.token, N('pers2'), { sources: [{ kind: 'app', app: APP, key_prefix: `${appId}.people` }],
        columns: [{ source: 'A', from: 'name', include: true }, { source: 'A', from: 'email' }] });
    assert(dropped.status === 201, `a mapping without include leaves the column out: ${show(dropped)}`);
    const pv = await call(`/v1/dataproducts/${N('pers2')}/preview`, { token: A.token, body: {} });
    assert(pv.body.data.resources[0].schema.fields.map((f: Body) => f.name).join(',') === 'name', `columns ${JSON.stringify(pv.body.data.resources[0].schema)}`);
    assert((pv.body.data.transformations as Body[]).some(t => t.what === 'left out A.email, which the data map marks personal'), `transformations ${JSON.stringify(pv.body.data.transformations)}`);
});

await test('D9.3c the same rows give no new version', async () => {
    const again = await run(A.token, N('mem'));
    assert(again.status === 200 && again.body.data.unchanged === true, `again: ${show(again)}`);
    const versions = await call(`/v1/datapackages/${A.name}/${N('mem')}/versions`, { token: A.token });
    assert(versions.body.data.total === 1, `versions: ${show(versions)}`);
});

await test('D9.3d a failing source writes no version, keeps the previous one, and lastRun names the source', async () => {
    const d = await define(A.token, N('mem'), { title: 'Budgets', keywords: ['budget'],
        sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }, { kind: 'extension', ext: EXT, action: 'boom' }], combine: { mode: 'tables' } });
    // The define reads the sources too, so the failing action is refused at once.
    assert(d.status === 502 && d.body.error?.code === 'SOURCE_FAILED' && d.body.error?.details?.source === 'B', `define: ${show(d)}`);
    // A source that goes away after the definition: the run fails, the version stays.
    assert((await putMemory(A.token, 'dpr.gone', [{ a: 1 }])).status < 300, 'gone');
    assert((await define(A.token, N('gone'), { sources: [{ kind: 'memory', key: 'dpr.gone' }] })).status === 201, 'define gone');
    assert((await run(A.token, N('gone'))).status === 201, 'first run');
    assert((await call('/v1/memory/dpr.gone', { token: A.token, method: 'DELETE' })).status < 300, 'delete the source');
    const r = await run(A.token, N('gone'));
    assert(r.status === 404 && r.body.error?.details?.source === 'A', `run: ${show(r)}`);
    const got = await call(`/v1/dataproducts/${N('gone')}`, { token: A.token });
    const last = got.body.data.definition.lastRun;
    assert(last.ok === false && last.source === 'A' && /Source A/.test(last.error), `lastRun ${JSON.stringify(last)}`);
    assert(got.body.data.package.content_hash && got.body.data.package.last_error, `pointer ${JSON.stringify(got.body.data.package)}`);
    const versions = await call(`/v1/datapackages/${A.name}/${N('gone')}/versions`, { token: A.token });
    assert(versions.body.data.total === 1, `versions: ${show(versions)}`);
});

console.log('\nD9.4 Preview');

await test('D9.4 a preview publishes nothing and answers rows, schema, validation and the ODPS sheet', async () => {
    const pv = await call(`/v1/dataproducts/${N('draft')}/preview`, { token: A.token, body: { sources: [{ kind: 'memory', key: 'dpr.pop' }], visibility: 'public' } });
    assert(pv.status === 200, `preview: ${show(pv)}`);
    const d = pv.body.data;
    assert(d.published === false && d.publish_check.ok === true && d.validation.ok === true, `checks ${JSON.stringify({ c: d.publish_check, v: d.validation })}`);
    assert(d.resources[0].row_count === 2 && d.resources[0].rows.length === 2 && d.resources[0].schema.fields.length === 2, `resources ${JSON.stringify(d.resources)}`);
    assert(typeof d.odps_yaml === 'string' && d.odps_yaml.includes('version: "4.1"') && d.odps?.product?.details?.en?.productID === `pkg:${A.name}/${N('draft')}` && typeof d.content_hash === 'string', `odps ${String(d.odps_yaml).slice(0, 200)}`);
    assert((await call(`/v1/datapackages/${A.name}/${N('draft')}`, { token: A.token })).status === 404, 'the preview published a package');
    assert((await call(`/v1/dataproducts/${N('draft')}`, { token: A.token })).status === 404, 'the preview stored a definition');
});

console.log('\nD9.5 Schedule');

await test('D9.5 a schedule is made with the definition, builds on a trigger, and goes with it', async () => {
    const d = await define(A.token, N('sch'), { sources: [{ kind: 'memory', key: 'dpr.pop' }], schedule: { cron: '0 6 * * 1', timezone: 'Europe/Helsinki' } });
    assert(d.status === 201 && d.body.data.schedule?.id, `define: ${show(d)}`);
    const id = d.body.data.schedule.id as string;
    const job = await call(`/v1/schedules/${id}`, { token: A.token });
    assert(job.status === 200 && JSON.stringify(job.body.data).includes('"dataproduct"'), `job: ${show(job)}`);
    const fire = await call(`/v1/schedules/${id}/trigger`, { token: A.token, body: {} });
    assert(fire.status === 200 && fire.body.data.outcome === 'ran', `trigger: ${show(fire)}`);
    assert((await descriptorOf(A.token, A.name, N('sch')))?.aimeat?.producer?.schedule === '0 6 * * 1', 'the fire did not publish');
    const off = await define(A.token, N('sch'), { sources: [{ kind: 'memory', key: 'dpr.pop' }], schedule: null });
    assert(off.status === 200 && off.body.data.schedule === null, `off: ${show(off)}`);
    assert((await call(`/v1/schedules/${id}`, { token: A.token })).status === 404, 'schedule: null left the schedule');
    const on = await define(A.token, N('sch'), { sources: [{ kind: 'memory', key: 'dpr.pop' }], schedule: { cron: '0 7 * * *' } });
    const id2 = on.body.data.schedule.id as string;
    const del = await call(`/v1/dataproducts/${N('sch')}`, { token: A.token, method: 'DELETE' });
    assert(del.status === 200 && del.body.data.schedules_removed.includes(id2) && del.body.data.package_kept === true, `delete: ${show(del)}`);
    assert((await call(`/v1/schedules/${id2}`, { token: A.token })).status === 404, 'deleting the definition left its schedule');
});

await test('D9.6 the list says each product\'s package, freshness, live shares, reads and next run; retention keeps the newest versions', async () => {
    const name = N('lst');
    const rowsFor = (k: number) => ({ rows: Array.from({ length: 3 }, (_, i) => ({ kunta: `K${i}`, n: i * k })) });
    assert((await putMemory(A.token, 'dpr.lst', rowsFor(1))).status < 300, 'memory');
    const bad = await define(A.token, name, { sources: [{ kind: 'memory', key: 'dpr.lst', rows_at: 'rows' }], retention: { keep: 0 } });
    assert(bad.status === 400, `retention keep 0 must be refused: ${show(bad)}`);
    const d = await define(A.token, name, { sources: [{ kind: 'memory', key: 'dpr.lst', rows_at: 'rows' }], retention: { keep: 1, unit: 'versions' }, schedule: { cron: '0 6 * * 1' } });
    assert(d.status === 201 && d.body.data.definition.retention?.keep === 1, `define: ${show(d)}`);
    const before = (await call('/v1/dataproducts', { token: A.token })).body.data.products.find((p: Body) => p.name === name);
    assert(before && before.package === null && before.freshness === null && before.shares === 0 && before.reads_7d === 0, `before the first run: ${JSON.stringify(before)}`);
    assert(before.sources[0].label === 'dpr.lst › rows' && before.next_run_at, `label and next run: ${JSON.stringify(before)}`);
    for (const k of [1, 2, 3]) {
        assert((await putMemory(A.token, 'dpr.lst', rowsFor(k))).status < 300, 'memory');
        const r = await run(A.token, name);
        assert(r.status === 201, `run ${k}: ${show(r)}`);
    }
    const versions = await call(`/v1/datapackages/${A.name}/${name}/versions`, { token: A.token });
    assert(versions.status === 200 && versions.body.data.versions.length <= 2 && versions.body.data.retention_policy?.keep === 1, `retention: ${show(versions)}`);
    const share = await call('/v1/parties/share', { token: A.token, body: { name: `lp${stamp % 100000}`, package: name, purpose: 'reporting', days: 7 } });
    assert(share.status === 201, `share: ${show(share)}`);
    const after = (await call('/v1/dataproducts', { token: A.token })).body.data.products.find((p: Body) => p.name === name);
    assert(after.package?.visibility === 'private' && after.package.withdrawn === false && after.package.content_hash, `package: ${JSON.stringify(after)}`);
    assert(after.freshness?.state === 'fresh' && after.shares === 1 && after.reads_7d === 0, `facts: ${JSON.stringify(after)}`);
    const list = await call('/v1/dataproducts', { token: A.token });
    assert(['report', 'none', 'node', 'owners'].includes(list.body.data.data_intermediation), `data_intermediation: ${show(list)}`);
    const parties = await call('/v1/parties', { token: A.token });
    assert(parties.status === 200 && typeof parties.body.data.share_max_days === 'number' && parties.body.data.share_max_days >= 1
        && typeof parties.body.data.dataspace === 'boolean', `share_max_days, dataspace: ${show(parties)}`);
});

console.log('\nCross-owner and cross-scope');

await test('X1 B cannot define from A\'s private memory key, A\'s workspace or A\'s file', async () => {
    const mem = await define(B.token, N('xm'), { sources: [{ kind: 'memory', key: 'dpr.budget', owner: A.name, rows_at: 'items' }] });
    assert(mem.status === 403 && mem.body.error?.code === 'FORBIDDEN', `memory: ${show(mem)}`);
    const rec = await define(B.token, N('xr'), { sources: [{ kind: 'records', organism_id: orgId, ws, space: 'signal' }] });
    assert(rec.status === 403 || rec.status === 404, `records: ${show(rec)}`);
    const node = (await call('/v1/dataproducts', { token: B.token })).body.node as string;
    const file = await define(B.token, N('xf'), { sources: [{ kind: 'file', key: `${A.name}@${node}/dpr/towns.csv` }] });
    assert(file.status === 403 && file.body.error?.code === 'FORBIDDEN', `file: ${show(file)}`);
    // A public record of A is readable to B, so B's product from it is allowed.
    const pub = await define(B.token, N('xp'), { sources: [{ kind: 'memory', key: 'dpr.pop', owner: A.name }] });
    assert(pub.status === 201, `public record: ${show(pub)}`);
});

await test('X2 B cannot read, run or delete A\'s definition', async () => {
    assert((await call(`/v1/dataproducts/${N('mem')}`, { token: B.token })).status === 404, 'B read A\'s definition');
    assert((await run(B.token, N('mem'))).status === 404, 'B ran A\'s definition');
    assert((await call(`/v1/dataproducts/${N('mem')}`, { token: B.token, method: 'DELETE' })).status === 404, 'B deleted A\'s definition');
    assert((await call(`/v1/dataproducts/${N('mem')}`, { token: A.token })).status === 200, 'A lost the definition');
    const list = await call('/v1/dataproducts', { token: B.token });
    assert(!JSON.stringify(list.body.data.products).includes(N('mem')), 'B lists A\'s product');
});

await test('X3 an agent without memory:write is refused; one without memory:read-as-owner cannot read A\'s private key', async () => {
    const noWrite = await makeAgent(BASE, A, ['storage:read', 'storage:write', 'memory:read']);
    const r = await define(noWrite.token, N('ag1'), { sources: [{ kind: 'memory', key: 'dpr.pop' }] });
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `no memory:write: ${show(r)}`);
    const writer = await makeAgent(BASE, A, ['storage:read', 'storage:write', 'memory:read', 'memory:write']);
    const priv = await define(writer.token, N('ag2'), { sources: [{ kind: 'memory', key: 'dpr.budget', rows_at: 'items' }] });
    assert(priv.status === 403 && priv.body.error?.code === 'SCOPE_DENIED' && priv.text.includes('memory:read-as-owner'), `read-as-owner: ${show(priv)}`);
    const ok = await define(writer.token, N('ag2'), { sources: [{ kind: 'memory', key: 'dpr.pop' }] });
    assert(ok.status === 201, `public key: ${show(ok)}`);
});

await test('X5 every endpoint asks its word: storage:read to read and preview, storage:write and memory:write to define, run and delete', async () => {
    const mute = await makeAgent(BASE, A, ['memory:read']);
    const reader = await makeAgent(BASE, A, ['storage:read', 'memory:read']);
    const mem = N('mem');
    const p = `/v1/dataproducts/${mem}`;
    const list = await call('/v1/dataproducts', { token: mute.token });
    assert(list.status === 403, `list without storage:read: ${show(list)}`);
    const one = await call(p, { token: mute.token });
    assert(one.status === 403, `get without storage:read: ${show(one)}`);
    const pv = await call(`/v1/dataproducts/${mem}/preview`, { method: 'POST', token: mute.token, body: {} });
    assert(pv.status === 403, `preview without storage:read: ${show(pv)}`);
    const put = await call(`/v1/dataproducts/${mem}`, { method: 'PUT', token: reader.token, body: { sources: [{ kind: 'memory', key: 'dpr.pop' }] } });
    assert(put.status === 403, `define without storage:write: ${show(put)}`);
    const runIt = await call(`/v1/dataproducts/${mem}/run`, { method: 'POST', token: reader.token, body: {} });
    assert(runIt.status === 403, `run without storage:write: ${show(runIt)}`);
    const del = await call(`/v1/dataproducts/${mem}`, { method: 'DELETE', token: reader.token });
    assert(del.status === 403, `delete without storage:write: ${show(del)}`);
    assert((await call(p, { token: reader.token })).status === 200, 'storage:read does not read the definition');
    const anon = await call(p);
    assert(anon.status === 401, `anonymous: ${show(anon)}`);
});

await test('X4 MCP: aimeat_dataproduct defines and previews as the agent, and refuses run without memory:write', async () => {
    const agent = await makeAgent(BASE, A, ['storage:read', 'storage:write', 'memory:read', 'memory:write']);
    const s = await openSession(BASE, agent.token);
    const def = await callTool(s, 'aimeat_dataproduct', { action: 'define', name: N('mcp'), sources: [{ kind: 'memory', key: 'dpr.pop' }] });
    assert(!def.isError && def.data?.created === true, `define: ${def.text.slice(0, 300)}`);
    const pv = await callTool(s, 'aimeat_dataproduct', { action: 'preview', name: N('mcp') });
    assert(!pv.isError && pv.data?.resources?.[0]?.row_count === 2, `preview: ${pv.text.slice(0, 300)}`);
    const list = await callTool(s, 'aimeat_dataproduct', { action: 'list' });
    assert(!list.isError && JSON.stringify(list.data).includes(N('mcp')), `list: ${list.text.slice(0, 300)}`);
    const reader = await makeAgent(BASE, A, ['storage:read', 'memory:read']);
    const rs = await openSession(BASE, reader.token);
    const denied = await callTool(rs, 'aimeat_dataproduct', { action: 'run', name: N('mcp') });
    assert(denied.isError && /SCOPE_DENIED/.test(denied.text), `run without the words: ${denied.text.slice(0, 300)}`);
});

console.log(`\n=== Data products: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

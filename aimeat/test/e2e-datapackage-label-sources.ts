/**
 * @file test/e2e-datapackage-label-sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the labels a data package version keeps of what it was copied from
 *   (secaudit2026nov08b round 15). Owner A makes an organism with classification on and two labels of
 *   its own whose audiences do not contain each other in rank order: "hr" (rank 27, A only) and "fin"
 *   (rank 33, A and C). C is a member of the organism. A writes records and rows, some labelled hr.
 *     R1  A product over records labelled hr and fin: C, inside fin but outside hr, reads no row of it.
 *         Fails on the code before round 15, where the version kept only the higher-ranked label (fin).
 *     R2  A product built while every record had the default label, then one record not first in order
 *         is labelled hr: C reads no row of that version any more. Fails before round 15, where the
 *         version kept the first record's label only.
 *     R3  A second product whose datapackage source is the product of R1: C reads no row of it. Fails
 *         before round 15, where the derived version kept no label.
 *     R4  A product whose memory source is an hr-labelled organism record (a plain memory record the
 *         organism's members read): C reads no row of it.
 *     R5  An extension A calls reads the hr record and publishes it with ctx.datapackage.publish at the
 *         organism: C reads no row of that package.
 *     R6  The same extension run unattended (a data product's extension source) reads the row space,
 *         where one row is labelled hr, and publishes: C reads no row of the package it published, nor of
 *         the product built from its answer.
 *     U1  A reads every row of every version above; C reads, before and after the change, a product over
 *         unlabelled records, a product over that product, a memory source over an unlabelled record, a
 *         package an extension published from literal rows, and the R2 version before the label was set.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-datapackage-label-sources
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15: datapackage/source-labels:single-rank-picked-source-stands-for-all-labels,
 *     dataproduct/sources-io:derived-product-drops-upstream-version-label-source,
 *     datapackage/ext-capability:publish-drops-label-source-of-run-reads).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST' | 'PUT', path: string, token?: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;

let A!: RegisteredOwner, C!: RegisteredOwner;
let orgId = '', ws = '';
const EXT = `dlsext${stamp}`;
const N = (s: string) => `dls${s}${stamp}`;
const OPEN = `OPEN-${stamp}`;
const HR = `HR-ONLY-${stamp}`;
const FIN = `FIN-${stamp}`;
const LATE1 = `LATE-ONE-${stamp}`;
const LATE2 = `LATE-TWO-${stamp}`;
const OPEN_ROW = `ROW-OPEN-${stamp}`;
const HR_ROW = `ROW-HR-${stamp}`;
const LITERAL = `LITERAL-${stamp}`;

const org = () => `organism:${orgId}`;
const recordKey = (ns: string, id: string) => `organism.${orgId}.w.${ws}.${ns}.${id}`;
const noteKey = (id: string) => `organism.${orgId}.notes.${id}`;
const OWN_NOTE = `dlsnote.open${stamp}`;
const records = (space: string) => ({ kind: 'records', organism_id: orgId, ws, space });
const define = (token: string, name: string, sources: unknown[], visibility = org()) =>
    call('PUT', `/v1/dataproducts/${name}`, token, { visibility, sources });
const run = (token: string, name: string) => call('POST', `/v1/dataproducts/${name}/run`, token, {});
const rowsOf = (token: string, owner: string, name: string) =>
    call('GET', `/v1/datapackages/${owner}/${name}/rows/rows?limit=100`, token);
const invoke = (action: string, input: Record<string, unknown>) =>
    call('POST', `/v1/ext/${EXT}/${action}`, A.token, { org: orgId, ws, ...input });
const setMode = (mode: string) => call('PUT', '/v1/admin/config', A.token, { changes: [{ path: 'classification.mode', value: mode }] });
const label = (body: Record<string, unknown>) => call('PUT', '/v1/classification/label', A.token, body);

/** A product A defines and runs, answering the run. */
async function build(name: string, sources: unknown[]): Promise<Answer> {
    const d = await define(A.token, name, sources);
    assert(d.status === 201, `define ${name}: ${show(d)}`);
    const r = await run(A.token, name);
    assert(r.status === 201, `run ${name}: ${show(r)}`);
    return r;
}
/** C reads none of `secret` through the package `name`; A reads it. */
async function keptFromC(name: string, secret: string): Promise<void> {
    const c = await rowsOf(C.token, A.name, name);
    assert(!c.text.includes(secret), `C reads "${secret}" through ${name}: ${show(c)}`);
    const a = await rowsOf(A.token, A.name, name);
    assert(a.status === 200 && a.text.includes(secret), `A's own read of ${name}: ${show(a)}`);
}
/** C reads `text` through the package `name`. */
async function readByC(name: string, text: string): Promise<void> {
    const c = await rowsOf(C.token, A.name, name);
    assert(c.status === 200 && c.text.includes(text), `C's read of ${name}: ${show(c)}`);
}

const SCRIPTS = {
    // Appends the two rows of the row space: one stays unlabelled, the other is labelled hr below.
    ingest: `export default async function(ctx, input){
        return ctx.workspace.appendRows(input.org, input.ws, 'alert', [
            { rowId: 'r-open', body: { severity: 'low', note: '${OPEN_ROW}' } },
            { rowId: 'r-hr', body: { severity: 'high', note: '${HR_ROW}' } }]);
    }`,
    // Attended: reads records as the caller and publishes them as a package.
    pubrecords: `export default async function(ctx, input){
        var got = await ctx.workspace.get(input.org, input.ws, input.ids, { space: input.space });
        var rows = (got.items || []).map(function(it){ return { id: it.id, note: it.value && it.value.note }; });
        return await ctx.datapackage.publish({ name: input.name, changes: 'records', visibility: input.visibility, resources: [{ name: 'rows', rows: rows, schema: 'infer' }] });
    }`,
    // Unattended or attended: reads the row space and publishes it, and answers the rows.
    pubrows: `export default async function(ctx, input){
        var page = await ctx.workspace.readRows(input.org, input.ws, 'alert', {});
        var rows = (page.rows || []).map(function(r){ return { id: r.rowId, note: r.body && r.body.note }; });
        var p = await ctx.datapackage.publish({ name: input.name, changes: 'rows', visibility: input.visibility, resources: [{ name: 'rows', rows: rows, schema: 'infer' }] });
        return { rows: rows, hash: p.contentHash };
    }`,
    // Publishes literal rows and reads nothing.
    pubplain: `export default async function(ctx, input){
        return await ctx.datapackage.publish({ name: input.name, changes: 'plain', visibility: input.visibility, resources: [{ name: 'rows', rows: [{ id: 'p1', note: '${LITERAL}' }], schema: 'infer' }] });
    }`,
};

console.log('\n=== A data package version keeps the labels of what it was copied from (secaudit2026nov08b round 15) ===\n');

await test('Setup: an organism with classification on, two labels, records, rows and an extension the row space names', async () => {
    A = await registerOwner(BASE, `dlsa${stamp}`);
    C = await registerOwner(BASE, `dlsc${stamp}`);
    const o = await call('POST', '/v1/organisms', A.token, { name: `Dls Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id;
    const j = await call('POST', `/v1/organisms/${orgId}/join`, C.token, {});
    assert(j.status === 200 || j.status === 201, `join: ${show(j)}`);
    const space = (name: string, namespace: string) => ({ name, namespace, mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: `schema:${name}@1` });
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, A.token, { name: 'Labels', manifest: {
        manifestVersion: '1', name: 'Labels', kind: 'project',
        objectTypes: [space('signal', 'shared.signals'), space('later', 'shared.later'), space('open', 'shared.open'),
            { name: 'alert', namespace: 'shared.alert', mode: 'records', backing: 'rows', writeRole: 'member', schemaRef: 'schema:alert@1',
              indexOn: ['severity'], extensions: [`${A.name}/${EXT}`] }],
    } });
    assert(w.status === 201 || w.status === 200, `workspace: ${show(w)}`);
    ws = w.body.data.ws;
    const put = async (spaceName: string, ns: string, id: string, note: string) => {
        const d = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, A.token, { ws, space: spaceName, id, value: { note } });
        assert(d.status === 200, `draft ${id}: ${show(d)}`);
        const p = await call('POST', `/v1/organisms/${orgId}/publish`, A.token, { ws, namespace: ns, id });
        assert(p.status === 200, `publish ${id}: ${show(p)}`);
    };
    await put('signal', 'shared.signals', 's1', OPEN);
    await put('signal', 'shared.signals', 's2', HR);
    await put('signal', 'shared.signals', 's3', FIN);
    await put('later', 'shared.later', 'l1', LATE1);
    await put('later', 'shared.later', 'l2', LATE2);
    await put('open', 'shared.open', 'o1', OPEN);
    // The workspace opens to every member, so the control read below reads it as C.
    const manKey = `organism.${orgId}.w.${ws}.meta.manifest`;
    const man = await call('GET', `/v1/memory/${encodeURIComponent(manKey)}`, A.token);
    const manValue = man.body.data?.value ?? man.body.data?.record?.value;
    assert(man.status === 200 && manValue && typeof manValue === 'object', `the manifest: ${show(man)}`);
    const opened = await call('POST', '/v1/memory', A.token, { key: manKey, value: manValue, visibility: org() });
    assert(opened.status === 200 || opened.status === 201, `open the workspace: ${show(opened)}`);
    // A plain organism record the organism's members read, labelled below; and A's own record at
    // the organism's audience, unlabelled.
    for (const [key, note] of [[noteKey('hrnote'), HR], [OWN_NOTE, OPEN]] as const) {
        const m = await call('POST', '/v1/memory', A.token, { key, value: { note }, visibility: org() });
        assert(m.status === 200 || m.status === 201, `note ${key}: ${show(m)}`);
    }
    const manifest = JSON.stringify({
        metadata: { name: EXT, version: '1.0.0', description: 'label sources e2e', author: 'e2e' },
        actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
        workspace: { read: true, rows: true },
    });
    const inst = await call('POST', '/v1/extensions', A.token, { manifest, scripts: SCRIPTS });
    assert(inst.status === 201, `install: ${show(inst)}`);
    const act = await call('POST', `/v1/extensions/${EXT}/activate`, A.token, {});
    assert(act.status === 200, `activate: ${show(act)}`);
    const ing = await invoke('ingest', {});
    assert(ing.status === 200 && ing.body.data?.written === 2, `ingest: ${show(ing)}`);

    const on = await setMode('owner');
    assert(on.status === 200, `classification on: ${show(on)}`);
    const policy = await call('PUT', '/v1/classification/policy', A.token, { level: 'organism', organism_id: orgId, policy: {
        enabled: true,
        labels: [
            { id: 'hr', rank: 27, name: { en: 'HR only', fi: 'Vain HR', es: 'Solo RR. HH.' }, audience: { people: [A.name] } },
            { id: 'fin', rank: 33, name: { en: 'Finance', fi: 'Talous', es: 'Finanzas' }, audience: { people: [A.name, C.name] } },
            // Below the node's internal label, so it inherits "may leave the organism" from public: a
            // memory source at the organism's audience reads it (sources-memory.ts mayLeave).
            { id: 'note', rank: 5, name: { en: 'A only', fi: 'Vain A', es: 'Solo A' }, audience: { people: [A.name] } },
        ],
    } });
    assert(policy.status === 200 && policy.body.data.applied === true, `organism policy: ${show(policy)}`);
    for (const [key, l] of [[recordKey('shared.signals', 's2'), 'hr'], [recordKey('shared.signals', 's3'), 'fin'], [noteKey('hrnote'), 'note']] as const) {
        const r = await label({ kind: 'memory', key, label: l });
        assert(r.status === 200 && r.body.data.applied === true, `label ${key}: ${show(r)}`);
    }
    const lr = await label({ kind: 'row', organism_id: orgId, ws, space: 'alert', row_id: 'r-hr', label: 'hr' });
    assert(lr.status === 200 && lr.body.data.applied === true, `label the row: ${show(lr)}`);
    // The control: C reads the workspace without the hr record, and with the fin one.
    const readC = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${ws}`, C.token);
    assert(readC.status === 200 && readC.text.includes(FIN) && !readC.text.includes(HR), `C's workspace read: ${show(readC)}`);
});

await test('R1. A product over records labelled hr and fin: C, inside fin and outside hr, reads no row', async () => {
    const r = await build(N('mix'), [records('signal')]);
    assert(r.body.data.rows === 3, `rows: ${show(r)}`);
    await keptFromC(N('mix'), HR);
    // The same on /v1/pub, the CSV address of the version.
    const csv = String(r.body.data.resources?.[0]?.url ?? '');
    assert(csv.includes('/v1/pub/'), `the resource address: ${csv}`);
    const pub = await fetch(csv.replace(/^https?:\/\/[^/]+/, BASE), { headers: { Authorization: `Bearer ${C.token}` } });
    const body = await pub.text();
    assert(!body.includes(HR), `C reads the hr record through /v1/pub: ${pub.status} ${body.slice(0, 200)}`);
});

await test('R2. A label set after the build on a record that is not first in order reaches the version', async () => {
    await build(N('late'), [records('later')]);
    // The use, before the label: C reads the version.
    await readByC(N('late'), LATE2);
    const l = await label({ kind: 'memory', key: recordKey('shared.later', 'l2'), label: 'hr' });
    assert(l.status === 200 && l.body.data.applied === true, `label l2: ${show(l)}`);
    await keptFromC(N('late'), LATE2);
});

await test('R3. A product over the R1 product: C reads no row of the derived version', async () => {
    const r = await build(N('derived'), [{ kind: 'datapackage', name: N('mix') }]);
    assert(r.body.data.rows === 3, `rows: ${show(r)}`);
    await keptFromC(N('derived'), HR);
});

await test('R4. A product whose memory source is the hr-labelled organism record: C reads no row', async () => {
    // The control: C reads the record's neighbour directly, and the labelled record not.
    const direct = await call('GET', `/v1/memory/${encodeURIComponent(noteKey('hrnote'))}?owner=${A.name}`, C.token);
    assert(!direct.text.includes(HR), `C reads the labelled record directly: ${show(direct)}`);
    await build(N('mem'), [{ kind: 'memory', key: noteKey('hrnote') }]);
    await keptFromC(N('mem'), HR);
});

await test('R5. An extension A calls reads the hr record and publishes it at the organism: C reads no row', async () => {
    const p = await invoke('pubrecords', { ids: ['s2'], space: 'signal', name: N('extrec'), visibility: org() });
    assert(p.status === 200 && p.body.data?.contentHash, `publish: ${show(p)}`);
    await keptFromC(N('extrec'), HR);
});

await test('R6. The extension run unattended reads the row space and publishes: C reads neither its package nor the product', async () => {
    const r = await build(N('extprod'), [{ kind: 'extension', ext: EXT, action: 'pubrows', rows_at: 'rows',
        input: { org: orgId, ws, name: N('extrows'), visibility: org() } }]);
    assert(r.body.data.rows === 2, `rows: ${show(r)}`);
    await keptFromC(N('extrows'), HR_ROW);
    await keptFromC(N('extprod'), HR_ROW);
});

await test('U1. Unlabelled material reads for C as before: records, a product over it, a memory record, literal rows', async () => {
    await build(N('open'), [records('open')]);
    await readByC(N('open'), OPEN);
    await build(N('openderived'), [{ kind: 'datapackage', name: N('open') }]);
    await readByC(N('openderived'), OPEN);
    await build(N('openmem'), [{ kind: 'memory', key: OWN_NOTE }]);
    await readByC(N('openmem'), OPEN);
    const p = await invoke('pubplain', { name: N('plain'), visibility: org() });
    assert(p.status === 200 && p.body.data?.contentHash, `publish: ${show(p)}`);
    await readByC(N('plain'), LITERAL);
});

await test('U2. With classification off every version reads as before', async () => {
    const off = await setMode('off');
    assert(off.status === 200, `classification off: ${show(off)}`);
    for (const [name, secret] of [[N('mix'), HR], [N('late'), LATE2], [N('derived'), HR], [N('mem'), HR], [N('extrec'), HR], [N('extrows'), HR_ROW]] as const) {
        await readByC(name, secret);
    }
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);

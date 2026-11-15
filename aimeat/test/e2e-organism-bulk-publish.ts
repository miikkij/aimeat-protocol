/**
 * @file e2e-organism-bulk-publish.ts
 * @description E2E for POST /v1/organisms/:id/workspace/records/publish — the Phase 2 batch publish.
 *   Proves it is behaviourally IDENTICAL to the single publish: a batch-published record and a
 *   single-published record built from the same draft end up with the same .version.1 + .latest (value,
 *   version, ownership), drafts are consumed, an unchanged re-publish is change-guard skipped, and the
 *   route's authorization holds (non-member → 403, publish review gate → 409).
 * @version-history
 *   v1.2.0 — 2026-11-15 — Audit M237, M238: the publish review gate refuses the batch (409) and gates
 *     the single publish (202); parity compares owner, visibility, tags and the write guard.
 *   v1.1.0 — 2026-09-26 — A record the batch refuses opens none of its embedded files, and the record
 *     it publishes does (secaudit 2026-09, N1). Failed on the old code first.
 *   v1.0.0 — 2026-07-15 — Initial: batch publish happy path + parity-with-single + change-guard + auth.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-bulk-publish

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import { ownerSignIn } from './helpers/owner-login.js';
async function setupOwner(label: string) {
    const name = `bp${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'BP', password: 'BulkPub12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'BulkPub12');
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Batch Publish E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wspub';
const NS = 'shared.tasks';
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const root = () => `organism.${orgId}.w.${WS}`;
const base = (inst: string) => `${root()}.${NS}.${inst}`;
const readKey = async (key: string) => json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true&soft=1`, { headers: authA() });
const writeDraft = (inst: string, value: unknown) => json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${base(inst)}.draft`, value, visibility: 'private' }) });

await test('Setup: owner + org + workspace + a records namespace', async () => {
    A = await setupOwner('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: authA(), body: JSON.stringify({ name: 'Batch Publish Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test('Batch publish 3 drafts → version.1 + latest created, drafts consumed', async () => {
    for (const t of ['t1', 't2', 't3']) await writeDraft(t, { id: t, title: `Task ${t}` });
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t1', 't2', 't3'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.published === 3, `published ${JSON.stringify(r.body.data)}`);
    for (const t of ['t1', 't2', 't3']) {
        const latest = await readKey(`${base(t)}.latest`);
        assert(latest.body.data.value?.title === `Task ${t}`, `${t}.latest value`);
        assert(latest.body.data.value !== null, `${t}.latest exists`);
        const v1 = await readKey(`${base(t)}.version.1`);
        assert(v1.body.data.value?.title === `Task ${t}`, `${t}.version.1 value`);
        const draft = await readKey(`${base(t)}.draft`);
        assert(draft.body.data.value === null, `${t}.draft consumed`);
    }
});

await test('Batch publish == single publish (same draft → same version.1 + latest)', async () => {
    // Single publish path for s1.
    await writeDraft('s1', { id: 's1', title: 'Same', n: 7 });
    const single = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, id: 's1' }) });
    assert(single.status === 200, `single ${single.status}`);
    // Batch publish path for b1, identical draft value.
    await writeDraft('b1', { id: 'b1', title: 'Same', n: 7 });
    const batch = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['b1'] }) });
    assert(batch.status === 200 && batch.body.data.published === 1, `batch ${batch.status}`);
    // Both must have version 1 latest + a version.1 record, with matching structural fields.
    const sLatest = (await readKey(`${base('s1')}.latest`)).body.data;
    const bLatest = (await readKey(`${base('b1')}.latest`)).body.data;
    assert(sLatest.version === bLatest.version && sLatest.version === 1, `latest version parity: ${sLatest.version} vs ${bLatest.version}`);
    assert(sLatest.value.title === bLatest.value.title && sLatest.value.n === bLatest.value.n, 'latest value parity');
    const sV1 = (await readKey(`${base('s1')}.version.1`)).body.data;
    const bV1 = (await readKey(`${base('b1')}.version.1`)).body.data;
    assert(sV1.value.n === bV1.value.n && sV1.value.title === bV1.value.title, 'version.1 value parity');
});

// Audit M238: the batch is its own implementation of publish, so parity covers ownership,
// visibility and tags, and the copied write-guard branch in a create_only + requires_expected_version space.
const metaOf = async (key: string) => {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(key)}&include=meta&owner_scope=true`, { headers: authA() });
    return { node: r.body.node as string, item: ((r.body.data?.items ?? []) as any[]).find(i => i.key === key) };
};
await test('Batch publish == single publish: owner, visibility and tags, and the write guard', async () => {
    const draft = (inst: string, ns = NS) => json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.${ns}.${inst}.draft`, value: { id: inst, title: 'Tagged' }, visibility: 'private', tags: ['parity', 'm238'] }) });
    await draft('s2'); await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, id: 's2' }) });
    await draft('b2'); await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['b2'] }) });
    for (const copy of ['latest', 'version.1']) {
        const s = await metaOf(`${base('s2')}.${copy}`), b = await metaOf(`${base('b2')}.${copy}`);
        assert(!!s.item && !!b.item, `${copy}: both records exist (${!!s.item}/${!!b.item})`);
        assert(s.item.owner_gaii === `${A.name}@${s.node}` && b.item.owner_gaii === s.item.owner_gaii, `${copy} owner: single ${s.item.owner_gaii}, batch ${b.item.owner_gaii}`);
        assert(b.item.visibility === s.item.visibility, `${copy} visibility: single ${s.item.visibility}, batch ${b.item.visibility}`);
        assert(JSON.stringify([...(b.item.tags ?? [])].sort()) === JSON.stringify([...(s.item.tags ?? [])].sort()) && (s.item.tags ?? []).includes('m238'),
            `${copy} tags: single ${JSON.stringify(s.item.tags)}, batch ${JSON.stringify(b.item.tags)}`);
    }
    // The guard: a second publish over an existing record in an append-only space is refused on both.
    const LEDGER = 'shared.ledger';
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        { name: 'ledger', schemaRef: 'schema:ledger@1', namespace: LEDGER, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', create_only: true, requires_expected_version: true },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 200, `manifest ${mr.status}`);
    const single = () => json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: LEDGER, id: 'ls' }) });
    const batch = () => json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: LEDGER, instances: ['lb'] }) });
    await draft('ls', LEDGER); await draft('lb', LEDGER);
    const s1 = await single(), b1 = await batch();
    assert(s1.status === 200 && b1.status === 200 && b1.body.data.published === 1, `first publish: single ${s1.status}, batch ${JSON.stringify(b1.body.data ?? b1.body.error)}`);
    const again = (inst: string) => json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.${LEDGER}.${inst}.draft`, value: { id: inst, title: 'Changed' }, visibility: 'private' }) });
    await again('ls'); await again('lb');
    const s2 = await single(), b2 = await batch();
    assert(s2.status === 409 && s2.body?.error?.code === 'WRITE_CONFLICT' && s2.body.error.details?.violations?.[0]?.schema_rule === 'write_guard_conflict', `single re-publish: ${s2.status} ${JSON.stringify(s2.body?.error)}`);
    assert(b2.status === 200 && b2.body.data.failed === 1 && b2.body.data.results[0].violations?.[0]?.schema_rule === 'write_guard_conflict', `batch re-publish: ${JSON.stringify(b2.body.data)}`);
});

await test('Unchanged re-publish is change-guard skipped (no new version)', async () => {
    // Re-create t1's draft with the SAME value as its published .latest, then batch publish.
    await writeDraft('t1', { id: 't1', title: 'Task t1' });
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t1'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.skipped === 1 && r.body.data.published === 0, `expected skipped, got ${JSON.stringify(r.body.data)}`);
    // No .version.2 was appended.
    const v2 = await readKey(`${base('t1')}.version.2`);
    assert(v2.body.data.value === null, 't1.version.2 must NOT exist (unchanged publish)');
    // The stale draft was consumed.
    const draft = await readKey(`${base('t1')}.draft`);
    assert(draft.body.data.value === null, 't1.draft consumed on skip');
});

await test('Draft-less import: records:[{id,value}] publishes directly (no draft round-trip)', async () => {
    const recs = [{ id: 'imp1', value: { id: 'imp1', title: 'Imported 1' } }, { id: 'imp2', value: { id: 'imp2', title: 'Imported 2' } }];
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, records: recs }) });
    assert(r.status === 200 && r.body.data.published === 2, `draft-less publish ${r.status} ${JSON.stringify(r.body.data)}`);
    // .version.1 + .latest exist directly, though no draft was ever written.
    const latest = await readKey(`${base('imp1')}.latest`);
    assert(latest.body.data.value?.title === 'Imported 1', 'imp1.latest from direct value');
    const v1 = await readKey(`${base('imp1')}.version.1`);
    assert(v1.body.data.value?.title === 'Imported 1', 'imp1.version.1 from direct value');
    const draft = await readKey(`${base('imp1')}.draft`);
    assert(draft.body.data.value === null, 'no draft was created');
});

await test('NO_DRAFT for an instance with no draft', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['nope'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.failed === 1 && r.body.data.results[0].code === 'NO_DRAFT', `expected NO_DRAFT, got ${JSON.stringify(r.body.data)}`);
});

// REFUSE BEFORE YOU WRITE (secaudit 2026-09, N1). Opening a document's embedded files to the
// workspace's members is a write, so the batch publish does it after the record's own refusals and
// only for the records that pass them.
await test('A record the batch refuses opens none of its embedded files; the record it publishes does', async () => {
    const LOG = 'shared.log';
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        { name: 'entry', schemaRef: 'schema:entry@1', namespace: LOG, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', create_only: true },
    ] };
    // The setup wrote this manifest, so this write replaces it (200).
    const mr = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 200, `manifest ${mr.status}`);
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const key = `img/bp-refused-${Date.now()}.png`;
    const up = await json('/v1/storage', { method: 'POST', headers: authA(), body: JSON.stringify({ key, data: PNG, mime_type: 'image/png', visibility: 'private' }) });
    assert(up.status === 201, `upload ${up.status}: ${JSON.stringify(up.body?.error)}`);
    const visibility = async () => (await fetch(`${BASE}/v1/storage/${key}`, { method: 'HEAD', headers: authA() })).headers.get('x-aimeat-visibility');
    assert(await visibility() === 'private', 'the file starts private');
    const publish = (records: unknown[]) => json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: LOG, records }) });

    const first = await publish([{ id: 'e1', value: { id: 'e1', title: 'First' } }]);
    assert(first.status === 200 && first.body.data.published === 1, `first ${first.status} ${JSON.stringify(first.body.data ?? first.body.error)}`);
    const embed = { title: 'Second', markdown: `# Second\n\n![x](/v1/storage/${key})` };
    const refused = await publish([{ id: 'e1', value: { id: 'e1', ...embed } }]);
    assert(refused.status === 200 && refused.body.data.failed === 1 && refused.body.data.published === 0, `the append-only space refused it: ${JSON.stringify(refused.body.data ?? refused.body.error)}`);
    assert(await visibility() === 'private', `a record the batch refused opened its file: ${await visibility()}`);

    // The record that lands is the one that opens it to the members.
    const landed = await publish([{ id: 'e2', value: { id: 'e2', ...embed } }]);
    assert(landed.status === 200 && landed.body.data.published === 1, `landed ${JSON.stringify(landed.body.data ?? landed.body.error)}`);
    assert(await visibility() !== 'private', 'the record that landed scoped the file to the workspace');
});

await test('With the publish review gate on, the batch answers 409 GATE_ENABLED and the single publish files an approval (audit M237)', async () => {
    const setGate = (enabled: boolean) => json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `organism.${orgId}.meta.config`, value: { gates: { publish: { enabled, approverRole: 'owner' } } }, visibility: 'private' }) });
    const on = await setGate(true);
    assert(on.status === 201 || on.status === 200, `gate on ${on.status}`);
    try {
        await writeDraft('g1', { id: 'g1', title: 'Gated' });
        const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['g1'] }) });
        assert(r.status === 409 && r.body.error?.code === 'GATE_ENABLED', `batch with the gate on: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
        const latest = await readKey(`${base('g1')}.latest`);
        assert(latest.body.data.value === null, 'the refused batch published g1 anyway');
        const single = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, id: 'g1' }) });
        assert(single.status === 202 && single.body.data?.gated === true && typeof single.body.data?.approval?.id === 'string', `single with the gate on: ${single.status} ${JSON.stringify(single.body.error ?? single.body.data)}`);
    } finally {
        const off = await setGate(false);
        assert(off.status === 200, `gate off ${off.status}`);
    }
});

await test('Missing namespace/instances → 400; non-member → 403', async () => {
    const bad = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, instances: [] }) });
    assert(bad.status === 400, `expected 400, got ${bad.status}`);
    const B = await setupOwner('b');
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` }, body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t2'] }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.token}` } });
});

await test('Cleanup owner', async () => { await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: authA() }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

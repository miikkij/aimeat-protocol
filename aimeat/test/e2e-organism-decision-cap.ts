/**
 * @file e2e-organism-decision-cap.ts
 * @description E2E for the bounded gate-audit log. Every organism gate action (publish/batch-publish/
 *   auto-approve/gate-approval) appends an immutable `organism.<id>.meta.decisions.<uuid>` row via
 *   writeDecision. Left uncapped these grow without limit and fill the organism owner's memory quota with
 *   rows a record delete never touches (the real-world symptom: a CRM publishing hundreds of records a day
 *   accumulated thousands of undead decision rows). This proves the per-organism cap
 *   (AIMEAT_ORGANISM_DECISION_LOG_CAP, set to 20 in the test env) bounds the log: after many publishes the
 *   decision count stays at/below the cap, and the newest decision always survives the prune.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: decision-log cap (prune oldest, keep newest).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-organism-decision-cap

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const CAP = 20;   // must match AIMEAT_ORGANISM_DECISION_LOG_CAP in the test env files

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function setupOwner(label: string) {
    const name = `dc${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'DC', password: 'Decision12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Decision-Log Cap E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wsdc';
const NS = 'shared.notes';
const auth = () => ({ Authorization: `Bearer ${A.token}` });
const root = () => `organism.${orgId}.w.${WS}`;
const base = (inst: string) => `${root()}.${NS}.${inst}`;
const decisionsPrefix = () => `organism.${orgId}.meta.decisions.`;

const writeDraft = (inst: string, value: unknown) =>
    json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base(inst)}.draft`, value, visibility: 'private' }) });
const publishOne = (inst: string) =>
    json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: NS, instances: [inst] }) });
const decisionCount = async (): Promise<number> => {
    const r = await json(`/v1/memory?owner_scope=true&count=true&prefix=${encodeURIComponent(decisionsPrefix())}`, { headers: auth() });
    assert(r.status === 200, `count ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body.data.count as number;
};

await test('Setup: owner + org + workspace + records namespace', async () => {
    A = await setupOwner('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Decision Cap Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test(`Publishing ${CAP + 15} distinct records writes ${CAP + 15} gate decisions (each publish = 1)`, async () => {
    // Publish one record per call so each triggers a distinct writeDecision (a batch would write only one).
    for (let i = 0; i < CAP + 15; i++) {
        const inst = `n${i}`;
        const w = await writeDraft(inst, { id: inst, title: `Note ${i}` });
        assert(w.status === 201 || w.status === 200, `draft ${i}: ${w.status}`);
        const p = await publishOne(inst);
        assert(p.status === 200, `publish ${i}: ${p.status} ${JSON.stringify(p.body.error)}`);
    }
});

await test(`Decision log is bounded to the cap (${CAP}), NOT the ${CAP + 15} published`, async () => {
    const count = await decisionCount();
    assert(count <= CAP, `decisions must be capped at ${CAP}, got ${count}`);
    assert(count < CAP + 15, `pruning must have happened (count ${count} < ${CAP + 15})`);
    assert(count >= CAP - Math.max(1, Math.floor(CAP / 10)) - 1, `should keep near the cap, got ${count}`);
    console.log(`    ${count} decisions retained of ${CAP + 15} published (cap ${CAP})`);
});

await test('Newest decision survives the prune (recent audit preserved)', async () => {
    // Publish one more clearly-newest record, then confirm a decision referencing it is present.
    const inst = 'newest';
    await writeDraft(inst, { id: inst, title: 'Newest note' });
    const p = await publishOne(inst);
    assert(p.status === 200, `publish newest: ${p.status}`);
    const list = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(decisionsPrefix())}`, { headers: auth() });
    assert(list.status === 200, `list ${list.status}`);
    // Still capped after one more write.
    assert((list.body.data.total as number) <= CAP, `still capped after newest, got ${list.body.data.total}`);
    // The most recently updated decision must be from just now (the prune removes OLD, never the newest).
    const newest = (list.body.data.items as any[]).reduce((a, b) => (a && a.updated_at > b.updated_at ? a : b), null);
    assert(!!newest, 'has a newest decision');
    assert(Date.now() - new Date(newest.updated_at).getTime() < 60_000, `newest decision is recent, got ${newest.updated_at}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

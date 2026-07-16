/**
 * @file e2e-workspace-retention.ts
 * @description E2E for workspace version-history RETENTION (P2 of the version/archive perf work):
 *   - Prune on publish: a space with `maxVersions: 3` keeps only the newest 3 `.version.N` rows —
 *     the 4th/5th publish deletes the oldest snapshots (window includes the just-published one).
 *   - `maxVersions: 0` keeps ALL history (overrides the node default window).
 *   - Append-only (`create_only`) spaces are NEVER pruned — not on publish, not by compaction —
 *     even when the manifest also declares a (bogus) maxVersions.
 *   - One-shot compaction: POST /v1/admin/maintenance/compact-workspace-versions applies the same
 *     window to PRE-EXISTING bloat (operator-only; 403 for non-operators, 401 unauthenticated).
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: prune-on-publish + maxVersions:0 keep-all + append-only guard +
 *     admin compaction endpoint + auth gates.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-retention

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

console.log('\n=== AIMEAT Workspace Version-Retention E2E ===\n');

const opName = `retop${Date.now()}`;      // first owner on the fresh test server → operator
const nonOpName = `retnon${Date.now()}`;
let opToken = '', nonOpToken = '';
let orgId = '';
const WS = 'wsret';
const root = () => `organism.${orgId}.w.${WS}`;
const auth = () => ({ Authorization: `Bearer ${opToken}` });

async function versionKeys(base: string): Promise<string[]> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.version.`)}`, { headers: auth() });
    assert(r.status === 200, `versionKeys ${r.status}`);
    return (r.body.data.items as any[]).map(i => i.key as string).sort();
}
async function writeMem(key: string, value: unknown): Promise<void> {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key, value, visibility: 'private' }) });
    assert(r.status === 201 || r.status === 200, `write ${key}: ${r.status} ${JSON.stringify(r.body.error)}`);
}
async function publish(namespace: string, id: string): Promise<any> {
    const r = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace, id }) });
    assert(r.status === 200, `publish ${namespace}.${id}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    return r.body.data;
}

await test('Setup: operator (first owner) + a non-operator', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
});

await test('Create organism + PRE-manifest bloat + manifest with retention spaces', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Retention Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await writeMem(`organism.${orgId}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString(), createdBy: opName }] });

    // Seed PRE-EXISTING history bloat BEFORE the manifest exists (once shared.logs is declared
    // create_only, direct .version writes are refused by the write guard — exactly the point).
    for (let v = 1; v <= 10; v++) await writeMem(`${root()}.shared.bloats.b1.version.${v}`, { id: 'b1', rev: v });
    await writeMem(`${root()}.shared.bloats.b1.latest`, { id: 'b1', rev: 10 });
    for (let v = 1; v <= 4; v++) await writeMem(`${root()}.shared.logs.e1.version.${v}`, { id: 'e1', rev: v });
    await writeMem(`${root()}.shared.logs.e1.latest`, { id: 'e1', rev: 4 });

    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            // note: retention window 3 → the publish path prunes history beyond the newest 3.
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', maxVersions: 3 },
            // keep: maxVersions 0 = keep ALL history (overrides the node default window).
            { name: 'keep', schemaRef: 'schema:keep@1', namespace: 'shared.keeps', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', maxVersions: 0 },
            // log: APPEND-ONLY — must never be pruned, even with a (bogus) maxVersions declared.
            { name: 'log', schemaRef: 'schema:log@1', namespace: 'shared.logs', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', create_only: true, maxVersions: 2 },
            // bloat: window 3 — compaction target for the pre-seeded 10-version history above.
            { name: 'bloat', schemaRef: 'schema:bloat@1', namespace: 'shared.bloats', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', maxVersions: 3 },
        ],
    };
    await writeMem(`${root()}.meta.manifest`, manifest);
});

// ── Prune on publish ──
await test('Publishing 5 revisions with maxVersions:3 keeps only .version.3/4/5', async () => {
    const base = `${root()}.shared.notes.n1`;
    for (let v = 1; v <= 5; v++) {
        await writeMem(`${base}.draft`, { id: 'n1', title: `rev ${v}` });
        const d = await publish('shared.notes', 'n1');
        assert(d.skipped !== true, `publish ${v} must not be skipped`);
    }
    const keys = await versionKeys(base);
    assert(keys.length === 3, `expected 3 surviving versions, got ${keys.length}: ${keys.join(', ')}`);
    assert(keys.join(',') === `${base}.version.3,${base}.version.4,${base}.version.5`, `newest window survives, got ${keys.join(', ')}`);
    // The live pointer is unaffected.
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.`)}`, { headers: auth() });
    const latest = (r.body.data.items as any[]).find(i => i.key === `${base}.latest`);
    assert(latest?.value?.title === 'rev 5', `latest is rev 5, got ${JSON.stringify(latest?.value)}`);
});

await test('maxVersions:0 keeps ALL history (4 publishes → 4 versions)', async () => {
    const base = `${root()}.shared.keeps.k1`;
    for (let v = 1; v <= 4; v++) {
        await writeMem(`${base}.draft`, { id: 'k1', title: `rev ${v}` });
        await publish('shared.keeps', 'k1');
    }
    const keys = await versionKeys(base);
    assert(keys.length === 4, `expected all 4 versions kept, got ${keys.length}: ${keys.join(', ')}`);
});

// ── One-shot compaction ──
await test('Compaction endpoint is operator-only (403 non-operator, 401 unauthenticated)', async () => {
    const non = await json('/v1/admin/maintenance/compact-workspace-versions', { method: 'POST', headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(non.status === 403, `expected 403, got ${non.status}`);
    const anon = await json('/v1/admin/maintenance/compact-workspace-versions', { method: 'POST' });
    assert(anon.status === 401, `expected 401, got ${anon.status}`);
});

await test('Compaction prunes pre-existing bloat to the window (10 → 3 versions)', async () => {
    const r = await json('/v1/admin/maintenance/compact-workspace-versions', { method: 'POST', headers: auth(), body: JSON.stringify({ organism_id: orgId }) });
    assert(r.status === 200, `compact ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(typeof r.body.data.pruned === 'number' && r.body.data.pruned >= 7, `pruned >= 7, got ${JSON.stringify(r.body.data)}`);
    const keys = await versionKeys(`${root()}.shared.bloats.b1`);
    assert(keys.length === 3, `bloat kept newest 3, got ${keys.length}: ${keys.join(', ')}`);
    assert(keys.every(k => /\.version\.(8|9|10)$/.test(k)), `newest 8/9/10 survive, got ${keys.join(', ')}`);
});

await test('Append-only (create_only) history is untouched by compaction AND publish pruning', async () => {
    const keys = await versionKeys(`${root()}.shared.logs.e1`);
    assert(keys.length === 4, `append-only keeps all 4 versions, got ${keys.length}: ${keys.join(', ')}`);
});

await test('Compaction is idempotent (second run prunes 0)', async () => {
    const r = await json('/v1/admin/maintenance/compact-workspace-versions', { method: 'POST', headers: auth(), body: JSON.stringify({ organism_id: orgId }) });
    assert(r.status === 200, `compact ${r.status}`);
    assert(r.body.data.pruned === 0, `second run prunes nothing, got ${r.body.data.pruned}`);
});

await test('Cleanup owners', async () => {
    const a = await json(`/v1/owners/${opName}`, { method: 'DELETE', headers: auth() });
    assert(a.status === 200, `del op ${a.status}`);
    const b = await json(`/v1/owners/${nonOpName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(b.status === 200, `del non-op ${b.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

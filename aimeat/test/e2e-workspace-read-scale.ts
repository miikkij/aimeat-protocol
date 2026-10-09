/**
 * @file e2e-workspace-read-scale.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: GET /v1/organisms/:id/workspace stays fast at the size production has.
 *
 *   WHY THIS EXISTS. On 2026-10-09 the claims workspace of AIMEAT CODING CENTRAL (771 records, every
 *   one agent-written and so carrying an AI-provenance record) took 9.4 s to read on aimeat.io, and
 *   board_read and claim_open timed out for every session. The cause was one clause in the
 *   "is this provenance record public" predicate: it searched every App row's manifest (one row per
 *   app VERSION) once per provenance id. Every functional suite was green, because a test node has a
 *   handful of apps and a handful of records; the cost was apps x records and only production had
 *   both. This suite seeds both at production size and times the real route.
 *
 *   What it proves:
 *     - an owner reads a workspace of RECORDS agent-written records, each with its provenance block,
 *       in under READ_BUDGET_MS (median of three reads after one warm-up), with APPS app rows on the
 *       node, a tenth of them carrying legal pages;
 *     - the rewritten predicate still answers right: a provenance record named on a served app's legal
 *       page resolves anonymously, a private one does not, and an app whose legal entry is a plain
 *       string (a restored backup can hold one) does not fail the statement;
 *     - another owner who is not a member is refused the read (403).
 *
 *   The seed goes straight into the server's database (createApp, createAiProvenance, setMemory),
 *   because publishing 2000 app versions and minting 800 records through HTTP would take minutes and
 *   measure the write path instead. The READ is the real route. On the in-memory backend the suite
 *   skips, since a second handle would open a different, empty database.
 *
 *   The timing assertion asserts the hole the fix closed: on the code before it the median read was
 *   2.2 s on postgres-kysely and 8.0 s on sqlite, and about 0.1 s on both after it.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=workspace-read-scale
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import type { AppRecord } from '../src/storage/types/apps.js';
import type { AiProvenance } from '../src/models/ai-provenance-schemas.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.AIMEAT_NODE_ID ?? process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
/** Production on 2026-10-09: 771 claims in one workspace. */
const RECORDS = Number(process.env.SCALE_RECORDS ?? 800);
/** App rows, one per version. Production has thousands; 2000 already showed the defect. */
const APPS = Number(process.env.SCALE_APPS ?? 2000);
/** Measured 2026-10-09 on a dev machine: about 100 ms with the fix, 2.2 s (postgres-kysely) and
 *  8.0 s (sqlite) without it. The budget sits ten times above the fixed figure. */
const READ_BUDGET_MS = Number(process.env.SCALE_READ_BUDGET_MS ?? 1000);
const WS = 'wsscale';
const NS = 'shared.claims';

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT Workspace Read at Production Size E2E Test ===\n');

const provider = (process.env.AIMEAT_STORAGE ?? process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
const sqlitePath = pinnedSqlitePath();
const dbUrl = serverDbUrl();
if (!((provider === 'sqlite' && sqlitePath) || (provider === 'postgres-kysely' && dbUrl))) {
    console.log(`  ⏭  skipped: the ${provider} backend keeps its data inside the server process`);
    console.log(`\n📊 Results: 0 passed, 0 failed\n`);
    process.exit(0);
}

const name = `scale${Date.now() % 1_000_000}`;
const ghii = `${name}@${NODE_ID}`;
let token = '';
let orgId = '';
const provIds: string[] = [];
const appFiles = new Set<string>();
let storage!: Storage;

await test('Setup: owner, organism and a workspace with one record space', async () => {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Scale', password: 'Scale12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200, `token ${tok.status}`);
    token = tok.body.data.token;
    const auth = { Authorization: `Bearer ${token}` };
    const o = await json('/v1/organisms', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Scale Org', type: 'project', join_policy: 'invite', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`);
    orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Claims', createdAt: ts, createdBy: name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Claims', kind: 'project', status: 'active',
        objectTypes: [{ name: 'claim', schemaRef: 'schema:claim@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: false }],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test(`Seed: ${APPS} app rows and ${RECORDS} agent-written records with provenance`, async () => {
    storage = await createStorage({ provider, sqlitePath, dbUrl });
    const now = new Date().toISOString();
    const agent = `claude#${ghii}`;
    for (let i = 0; i < RECORDS; i++) {
        const id = randomUUID();
        provIds.push(id);
        const record = {
            spec: 'aimeat.provenance/v1', level: 'ai-generated', method: 'fully-generated', humanInvolvement: 'none',
            notes: 'Produced by an automated step (ext.lifecycle-central.claim_release).',
            generator: { nodeId: NODE_ID, pipeline: 'ext.lifecycle-central.claim_release', principal: agent },
            disclosure: { reason: 'none', required: false, strength: 'none', short: { en: 'AI-generated' }, long: { en: 'This text was written by AI.' } },
            generatedAt: now,
        } as unknown as AiProvenance;
        await storage.createAiProvenance({ id, ownerGhii: ghii, principal: agent, contentHash: null, generatedAt: now, createdAt: now, record });
        await storage.setMemory({
            key: `organism.${orgId}.w.${WS}.${NS}.c${i}.latest`, ownerGaii: ghii, visibility: 'private', tags: [], ttlHours: null,
            version: 1, createdAt: now, updatedAt: now, aiProvenanceId: id,
            // About the size of a production claim (median 2.6 kB).
            value: { id: `c${i}`, title: `Claim ${i}`, status: i < 2 ? 'active' : 'released', intent: 'i'.repeat(1200), notes: 'n'.repeat(1000), area: ['aimeat/src/'] },
        });
    }
    // A manifest the size real ones have, with a version history; a tenth carry legal pages. The
    // first app's terms name the provenance record of record c7, which makes c7's record public.
    const history = Array.from({ length: 30 }, (_, i) => ({ version: `1.${i}.0`, date: '2026-10-01', note: 'h'.repeat(120) }));
    for (let i = 0; i < APPS; i++) {
        const filename = `scale-${i % 200}.html`;
        appFiles.add(filename);
        // App 1 carries a legal entry that is a plain string, which a restored backup can hold: the
        // predicate must skip it rather than fail the statement (SQLite's json_extract throws on it).
        const legal = i === 0 ? { terms: { format: 'markdown', aiProvenanceId: provIds[7] } }
            : i === 1 ? { terms: 'plain text page' }
            : i % 10 === 0 ? { terms: { format: 'markdown', aiProvenanceId: randomUUID() } } : undefined;
        const manifest = { name: `Scale ${i}`, version: `1.${i}.0`, description: 'd'.repeat(400), history, ...(legal ? { legal } : {}) };
        await storage.createApp({
            ownerGaii: ghii, ownerName: name, filename, versionNumber: Math.floor(i / 200) + 1,
            manifest: manifest as unknown as AppRecord['manifest'], mimeType: 'text/html', size: 1, data: Buffer.from(' '), createdAt: now,
        });
    }
});

await test(`The owner reads all ${RECORDS} records, each with its provenance, in under ${READ_BUDGET_MS} ms`, async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const read = async () => {
        const t0 = performance.now();
        const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth });
        const ms = performance.now() - t0;
        assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body.error)}`);
        return { ms, items: (r.body.data.objects.claim ?? []) as Array<Record<string, unknown>> };
    };
    const warm = await read();
    assert(warm.items.length === RECORDS, `expected ${RECORDS} records, got ${warm.items.length}`);
    const withProv = warm.items.filter(it => it._aiProvenance).length;
    assert(withProv === RECORDS, `every record carries its provenance block: ${withProv} of ${RECORDS}`);
    const times = [(await read()).ms, (await read()).ms, (await read()).ms].sort((a, b) => a - b);
    const median = times[1];
    console.log(`     reads: warm ${Math.round(warm.ms)} ms, then ${times.map(t => Math.round(t)).join(' / ')} ms (median ${Math.round(median)})`);
    assert(median < READ_BUDGET_MS, `median read ${Math.round(median)} ms exceeds the ${READ_BUDGET_MS} ms budget`);
});

await test('A record named on a served app\'s legal page resolves anonymously; a private one does not', async () => {
    const legal = await json(`/v1/provenance/${provIds[7]}`);
    assert(legal.status === 200, `legal-page record: expected 200, got ${legal.status}`);
    const priv = await json(`/v1/provenance/${provIds[8]}`);
    assert(priv.status === 404, `private record: expected 404, got ${priv.status}`);
});

await test('Refused: another owner who is not a member reads nothing of the workspace (403)', async () => {
    const other = `scaleo${Date.now() % 1_000_000}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'Other', password: 'Scale12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: other, timestamp: ts, signature: await signMsg(reg.body.data.private_key, other + NODE_ID + ts) }) });
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: { Authorization: `Bearer ${tok.body.data.token}` } });
    assert(r.status === 403, `a non-member's read: expected 403, got ${r.status}`);
});

await test('Cleanup: the seeded apps and records are removed', async () => {
    for (const f of appFiles) await storage.deleteApp(ghii, f);
    for (let i = 0; i < RECORDS; i++) await storage.deleteMemory(ghii, `organism.${orgId}.w.${WS}.${NS}.c${i}.latest`);
    // Provenance records are append-only by design and have no delete; the runner empties the
    // database between suites.
    await storage.close?.();
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-production-size.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: the read paths whose answer depends on HOW MUCH data a node holds, driven past the
 *   size where each one used to stop being true (QA audit chapter 3.8, package W31).
 *
 *   WHY THIS EXISTS. A capped read passes every functional test, because a test node holds a handful
 *   of rows: the window is never full. The audit found reads that cut a window in key order and then
 *   reported what was inside it as the whole:
 *     - a workspace export read one window of 10 000 memory records, and the workspace's own manifest
 *       sorts after most namespaces, so a larger workspace lost its tail (F06c-01);
 *     - the operator dashboard summed the platform-fee receivable and the money volume from the first
 *       2000 records, and a provider's obligations came from the first 1000 records of every
 *       beneficiary on the node (S8-10);
 *     - the operator's memory listing paged a cross-owner read whose order had no tie-breaker and whose
 *       window PostgreSQL took in JavaScript (D4-05);
 *     - registration and every sign-in that is not the operator's loaded the whole owner table, and the
 *       notification senders read loaded every agent on the node (P7-10).
 *   The notification windows (F13-01) are in e2e-notifications.ts (tests 14 to 14c) and the OData
 *   paging (F15-02) in e2e-datapackage-odata.ts.
 *
 *   The seed goes straight into the server's database, as e2e-workspace-read-scale does, because
 *   writing ten thousand records through HTTP would measure the write path for minutes. Every READ is
 *   the real route. On the in-memory backend the suite skips and says so.
 *
 *   Runs against a live server (E2E_BASE). cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely
 *   --import tsx test/run-e2e-ci.ts --test=production-size
 * @version-history
 *   2026-10-16 — Initial (QA audit W31: F06c-01, S8-10, D4-05, P7-10).
 */
import { randomUUID } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../src/storage/interface.js';
import { safeUnzip, BACKUP_ZIP_LIMITS } from '../src/services/safe-zip.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.AIMEAT_NODE_ID ?? process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
/** One page past the old 10 000 export window, with the manifest sorting after every seeded key. */
const WS_RECORDS = Number(process.env.SIZE_WS_RECORDS ?? 10_050);
/** Past the dashboard's old window of 2000. */
const FEES = Number(process.env.SIZE_FEES ?? 2_050);
/** Past the obligations read's old window of 1000. */
const OBLIGATIONS = Number(process.env.SIZE_OBLIGATIONS ?? 1_050);
/** Owners and agents on the node while one person registers and signs in. */
const ACCOUNTS = Number(process.env.SIZE_ACCOUNTS ?? 3_000);
/** A sign-in, a registration and the senders read each stay under this with ACCOUNTS rows present.
 *  Measured 2026-10-16 on a loaded dev machine at about 0.3 s; the budget is a ceiling, not a goal. */
const REQUEST_BUDGET_MS = Number(process.env.SIZE_REQUEST_BUDGET_MS ?? 5_000);
const WS = 'wssize';

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
    return { status: res.status, body, headers: res.headers };
}

console.log('\n=== AIMEAT Production Size E2E ===\n');

const provider = (process.env.AIMEAT_STORAGE ?? process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
const sqlitePath = pinnedSqlitePath();
const dbUrl = serverDbUrl();
if (!((provider === 'sqlite' && sqlitePath) || (provider === 'postgres-kysely' && dbUrl))) {
    console.log(`  ⏭  skipped: the ${provider} backend keeps its data inside the server process`);
    console.log(`\n📊 Results: 0 passed, 0 failed\n`);
    process.exit(0);
}

const name = `size${Date.now() % 1_000_000}`;
const ghii = `${name}@${NODE_ID}`;
const PASSWORD = 'Size123456';
let token = '';
let orgId = '';
let storage!: Storage;
const auth = () => ({ Authorization: `Bearer ${token}` });
const now = new Date().toISOString();

function rec(ownerGaii: string, key: string, value: unknown): MemoryRecord {
    return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}
async function putAll(rows: MemoryRecord[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        if (storage.bulkSetMemory) await storage.bulkSetMemory(chunk);
        else for (const r of chunk) await storage.setMemory(r);
    }
}

await test('Setup: the operator (first account), an organism and a workspace', async () => {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Size', password: PASSWORD }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, PASSWORD);
    assert(tok.status === 200, `token ${tok.status}`);
    token = tok.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Size Org', type: 'project', join_policy: 'invite', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`);
    orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Alerts', createdAt: now, createdBy: name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Alerts', kind: 'project', status: 'active',
        objectTypes: [{ name: 'alert', schemaRef: 'schema:alert@1', namespace: 'alerts', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: false }],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    storage = await createStorage({ provider, sqlitePath, dbUrl });
});

// ─── F06c-01: the workspace export reads every record ───
console.log('\nWorkspace export past one read window (F06c-01)');

await test(`a workspace of ${WS_RECORDS} records exports whole, its manifest included`, async () => {
    await putAll(Array.from({ length: WS_RECORDS }, (_, i) =>
        rec(ghii, `organism.${orgId}.w.${WS}.alerts.a${String(i).padStart(6, '0')}.latest`, { id: `a${i}`, level: i % 3 })));
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/export?ws=${WS}`, { headers: auth() });
    assert(res.status === 200, `export ${res.status}`);
    assert(res.headers.get('x-aimeat-export-truncated') !== 'true', 'the export says it was truncated');
    const files = await safeUnzip(Buffer.from(await res.arrayBuffer()), BACKUP_ZIP_LIMITS);
    const ws = JSON.parse(files.get('workspace.json')!.toString('utf8'));
    assert(ws.manifest?.name === 'Alerts', `the manifest is in the export: ${JSON.stringify(ws.manifest)?.slice(0, 80)}`);
    const alerts = (ws.objects as Array<{ namespace: string }>).filter(o => o.namespace === 'alerts').length;
    assert(alerts === WS_RECORDS, `every record is in the export: ${alerts} of ${WS_RECORDS}`);
    assert((ws.truncated ?? []).length === 0, `nothing named as truncated: ${JSON.stringify(ws.truncated)}`);
});

// ─── S8-10: money totals ───
console.log('\nMoney totals past their old windows (S8-10)');

await test(`the dashboard sums all ${FEES} platform-fee records and every completed sale`, async () => {
    const fees = Array.from({ length: FEES }, (_, i) =>
        rec(`system@${NODE_ID}`, `commerce.platform-fee.tc${String(i).padStart(6, '0')}`, { fee: 1_000, currency: 'EUR', mode: 'receivable' }));
    const sessions = Array.from({ length: FEES }, (_, i) =>
        rec(`buyer${i % 7}@${NODE_ID}`, `commerce.session.s${String(i).padStart(6, '0')}`, { status: 'completed', currency: 'EUR', total: 5_000 }));
    await putAll([...fees, ...sessions]);
    const r = await json('/v1/admin/dashboard', { headers: auth() });
    assert(r.status === 200, `dashboard ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const commerce = JSON.stringify(r.body.data).match(/"operator_money_fees":(\{[^}]*\})/);
    const feesEur = commerce ? JSON.parse(commerce[1]).EUR : undefined;
    assert(feesEur === FEES * 1_000, `operator money fees: ${feesEur}, expected ${FEES * 1_000}`);
    const volume = JSON.stringify(r.body.data).match(/"money_volume":(\{[^}]*\})/);
    const volEur = volume ? JSON.parse(volume[1]).EUR : undefined;
    assert(volEur === FEES * 5_000, `money volume: ${volEur}, expected ${FEES * 5_000}`);
});

await test(`a provider's obligations total all ${OBLIGATIONS} entries owed across beneficiaries`, async () => {
    const rows = Array.from({ length: OBLIGATIONS }, (_, i) => rec(`benef${i % 5}@${NODE_ID}`, `commerce.benefit.tb${String(i).padStart(6, '0')}`, {
        items: [{ amount: 2_000, currency: 'EUR', fromGhii: ghii, weight: 1, kind: 'static', status: 'accrued', at: new Date(Date.now() - i * 1000).toISOString() }],
    }));
    await putAll(rows);
    const r = await json('/v1/commerce/beneficiary/obligations?limit=10', { headers: auth() });
    assert(r.status === 200, `obligations ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.total === OBLIGATIONS, `every entry is counted: ${r.body.data.total}`);
    assert(r.body.data.totals?.EUR?.accrued === OBLIGATIONS * 2_000, `the total owed: ${JSON.stringify(r.body.data.totals)}`);
    assert(r.body.data.entries.length === 10 && r.body.data.count === 10, `the list is the newest ten: ${r.body.data.entries.length}`);
});

// ─── D4-05: the operator's cross-owner listing pages over every row exactly once ───
console.log('\nThe cross-owner memory listing in pages (D4-05)');

await test('paging the operator memory listing visits each record exactly once, and total is the count', async () => {
    const seen = new Set<string>();
    let total = -1;
    let rows = 0;
    for (let offset = 0; offset < FEES + 400; offset += 200) {
        const r = await json(`/v1/admin/memory?prefix=commerce.platform-fee.&limit=200&offset=${offset}`, { headers: auth() });
        assert(r.status === 200, `listing ${r.status}`);
        total = r.body.data.total;
        for (const it of r.body.data.items) { seen.add(`${it.key}|${it.owner_gaii ?? it.ownerGaii}`); rows++; }
        if (r.body.data.items.length < 200) break;
    }
    assert(total === FEES, `total ${total}, expected ${FEES}`);
    assert(rows === FEES && seen.size === FEES, `rows ${rows}, distinct ${seen.size}, expected ${FEES} each`);
});

// ─── P7-10: requests that used to read a whole table ───
console.log('\nOwners and agents at size (P7-10)');

await test(`with ${ACCOUNTS} owners and agents present, registration, sign-in and the senders read stay under the budget`, async () => {
    const t0 = new Date().toISOString();
    for (let i = 0; i < ACCOUNTS; i++) {
        const n = `bulk${i}x${name}`;
        await storage.createOwner({ name: n, displayName: n, publicKey: 'pk', roles: ['owner'], createdAt: t0 });
        await storage.createAgent({
            name: 'bot', owner: n, gaii: `bot#${n}@${NODE_ID}`, capabilities: [], publicKey: 'pk', trustScore: 50,
            morselBalance: 0, createdAt: t0, lastSeen: t0,
        } as Parameters<Storage['createAgent']>[0]);
    }
    const timed = async <T extends { status: number }>(fn: () => Promise<T>, label: string): Promise<T> => {
        const s = Date.now();
        const r = await fn();
        const ms = Date.now() - s;
        assert(ms < REQUEST_BUDGET_MS, `${label} took ${ms} ms with ${ACCOUNTS} accounts (budget ${REQUEST_BUDGET_MS})`);
        return r;
    };
    const late = `late${randomUUID().slice(0, 6)}`;
    const reg = await timed(() => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: late, display_name: 'Late', password: PASSWORD }) }), 'registration');
    assert(reg.status === 201, `registration ${reg.status}`);
    const signIn = await timed(() => ownerSignIn(BASE, late, PASSWORD), 'sign-in');
    assert(signIn.status === 200, `sign-in ${signIn.status}`);
    // The late account is not the operator, and the operator still is: the self-heal asked the right question.
    const roles = JSON.parse(Buffer.from(String(signIn.body.data.token).split('.')[1], 'base64url').toString()).roles ?? [];
    assert(!roles.includes('operator'), `a later account is not made operator: ${JSON.stringify(roles)}`);
    const senders = await timed(() => json('/v1/notifications/senders', { headers: { Authorization: `Bearer ${signIn.body.data.token}` } }), 'senders');
    assert(senders.status === 200, `senders ${senders.status}`);
    const agentsListed = (senders.body.data.senders as Array<{ kind: string }>).filter(s => s.kind === 'agent').length;
    assert(agentsListed === 0, `nobody else's agent is listed: ${agentsListed}`);
});

// The totals above are the operator's; the size changes nothing about who may read them.
await test('a person who is not the operator is refused the dashboard and the cross-owner listing (403), and owes nothing', async () => {
    const other = `plain${randomUUID().slice(0, 6)}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'Plain', password: PASSWORD }) });
    assert(reg.status === 201, `registration ${reg.status}`);
    const t = (await ownerSignIn(BASE, other, PASSWORD)).body.data.token as string;
    const dash = await json('/v1/admin/dashboard', { headers: { Authorization: `Bearer ${t}` } });
    assert(dash.status === 403, `dashboard for a non-operator: ${dash.status}`);
    const listing = await json('/v1/admin/memory?prefix=commerce.platform-fee.&limit=5', { headers: { Authorization: `Bearer ${t}` } });
    assert(listing.status === 403, `cross-owner listing for a non-operator: ${listing.status}`);
    const owed = await json('/v1/commerce/beneficiary/obligations', { headers: { Authorization: `Bearer ${t}` } });
    assert(owed.status === 200 && owed.body.data.total === 0, `another provider's obligations are not theirs: ${JSON.stringify(owed.body.data?.total)}`);
});

await test('Cleanup: close the seed handle', async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

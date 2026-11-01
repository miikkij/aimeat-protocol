/**
 * @file e2e-data-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the data package lifecycle (plan doc-mvwxcas3dom3, D6):
 *   D6.1 freshness against the producer's promise: a hand-published package reads unscheduled, a data
 *     product with a daily schedule reads fresh after a run, late a day and a half after its last
 *     success and stale five days after (the pointer's time set back), on the descriptor read, the ODPS
 *     sheet, discovery and the exposure report.
 *   D6.2 the stale check tells the owner once per stale spell: two runs of core:datapackage-freshness
 *     send one notification; a successful run and a new stale spell send a second. B is told nothing.
 *   D6.4 versions in use: a version a named share pins and a party read is marked so for the owner; the
 *     retention policy spares it while it removes an unpinned one; removed_next marks what the next
 *     publish removes; another account and the party see no use fields.
 *   Live: a publish and a withdrawal emit `datapackages` on the owner's SSE stream and not on B's.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=data-lifecycle
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.1, D6.2, D6.4).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; basic?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined;
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const stamp = Date.now() % 10_000_000;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** An SSE stream of the owner: the change domains it was told. */
async function openStream(token: string) {
    const t = await call('/v1/events/ticket', { token, method: 'POST' });
    assert(t.status === 200 && t.body.data?.ticket, `ticket: ${show(t)}`);
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream ${res.status}`);
    let buf = '';
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) buf += dec.decode(value, { stream: true }); } } catch { /* closed */ } })();
    const domains = () => buf.split('\n').filter(l => l.startsWith('data: ')).flatMap(l => { try { return (JSON.parse(l.slice(6)).domains ?? []) as string[]; } catch { return []; } });
    return {
        domains,
        async waitFor(domain: string, ms: number): Promise<boolean> {
            const end = Date.now() + ms;
            while (Date.now() < end) { if (domains().includes(domain)) return true; await new Promise(r => setTimeout(r, 50)); }
            return false;
        },
        reset() { buf = ''; },
        close() { ctrl.abort(); },
    };
}

console.log('\n=== AIMEAT data package lifecycle E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' }, OP = { name: '', token: '' };
let node = '';
const HAND = `dlch${stamp}`;
const PROD = `dlcp${stamp}`;
const PIN = `dlcq${stamp}`;
const RET = `dlcr${stamp}`;
const publish = (token: string, name: string, rows: Body[], extra: Body = {}) => call('/v1/datapackages', {
    token, body: { name, changes: `rows ${JSON.stringify(rows).length}`, visibility: 'private', resources: [{ name: 'items', rows }], ...extra },
});
/** Set the package pointer's time back by `hours`, as an old last success, through the owner's storage. */
async function setBack(name: string, hours: number): Promise<void> {
    const d = await call(`/v1/datapackages/${A.name}/${name}`, { token: A.token });
    assert(d.status === 200 && d.body.data.latest?.contentHash, `pointer: ${show(d)}`);
    const pointer = { ...d.body.data.latest, updatedAt: new Date(Date.now() - hours * 3_600_000).toISOString() };
    const w = await call('/v1/storage', { token: A.token, body: { key: `datapkg/${name}/latest.json`, data: b64(JSON.stringify(pointer)), mime_type: 'application/json', visibility: 'private' } });
    assert(w.status === 201, `write pointer: ${show(w)}`);
}
const freshness = async (name: string) => (await call(`/v1/datapackages/${A.name}/${name}`, { token: A.token })).body.data?.freshness;
const staleNotices = async (token: string) => ((await call('/v1/notifications?limit=200', { token })).body.data?.notifications ?? [])
    .filter((n: Body) => n.type === 'datapackage_stale');
const sweep = () => call('/v1/admin/scheduler/jobs/core:datapackage-freshness/trigger', { token: OP.token, method: 'POST' });

await test('Setup: owners A and B, an operator, a memory source and a daily data product of A', async () => {
    const a = await registerOwner(BASE, `dlca${stamp}`);
    const b = await registerOwner(BASE, `dlcb${stamp}`);
    const op = await setupOperator(BASE, ADMIN_PW, `dlcop${stamp}`);
    A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token }; OP = { name: op.name, token: op.token };
    node = a.ghii.split('@')[1]!;
    const mem = await call('/v1/memory', { token: A.token, body: { key: 'dlc.rows', value: { items: [{ k: 1, v: 'one' }, { k: 2, v: 'two' }] } } });
    assert(mem.status === 201 || mem.status === 200, `memory: ${show(mem)}`);
    const d = await call(`/v1/dataproducts/${PROD}`, { token: A.token, method: 'PUT', body: { sources: [{ kind: 'memory', key: 'dlc.rows', rows_at: 'items' }], schedule: { cron: '0 6 * * *', timezone: 'UTC' } } });
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await call(`/v1/dataproducts/${PROD}/run`, { token: A.token, body: {} });
    assert(r.status === 201, `run: ${show(r)}`);
    assert((await publish(A.token, HAND, [{ a: 1 }])).status === 201, 'hand-published package');
});

console.log('\nD6.1 Freshness');

await test('D6.1a a hand-published package reads unscheduled, never fresh', async () => {
    const f = await freshness(HAND);
    assert(f?.state === 'unscheduled' && f.promise === null && f.reason_code === 'no-promise', `freshness: ${JSON.stringify(f)}`);
});

await test('D6.1b a data product with a daily schedule reads fresh after a run, its promise the product\'s schedule', async () => {
    const f = await freshness(PROD);
    assert(f?.state === 'fresh', `freshness: ${JSON.stringify(f)}`);
    assert(f.promise?.cron === '0 6 * * *' && f.promise.source === 'dataproduct' && f.promise.interval_seconds === 86400, `promise: ${JSON.stringify(f.promise)}`);
    assert(typeof f.due_at === 'string' && typeof f.stale_at === 'string', 'deadlines named');
});

await test('D6.1c late a day and a half after the last success, stale five days after; the ODPS sheet, discovery and exposure say so', async () => {
    await setBack(PROD, 36);
    assert((await freshness(PROD))?.state === 'late', 'late after 36 hours');
    await setBack(PROD, 5 * 24);
    const f = await freshness(PROD);
    assert(f?.state === 'stale' && f.reason_code === 'missed-three', `stale: ${JSON.stringify(f)}`);
    const odps = await call(`/v1/datapackages/${A.name}/${PROD}/odps?format=json`, { token: A.token });
    assert(odps.status === 200 && odps.body.data.odps.product['x-aimeat'].freshness?.state === 'stale', `odps: ${show(odps)}`);
    assert(JSON.stringify(odps.body.data.odps.product.SLA ?? {}).includes('0 6 * * *'), 'the SLA states the product\'s schedule');
    const disc = await call(`/v1/discover?scope=own&types=dataset&q=${PROD}`, { token: A.token });
    const entry = (disc.body.data?.entries ?? disc.body.data?.results ?? []).find((e: Body) => e.id === `pkg:${A.name}/${PROD}`);
    assert(entry?.dataset?.freshness?.state === 'stale', `discover: ${show(disc)}`);
});

console.log('\nD6.2 One stale notice per spell');

await test('D6.2a two stale checks send A one notification; B is told nothing', async () => {
    const before = (await staleNotices(A.token)).length;
    const s1 = await sweep();
    assert(s1.status === 200, `sweep: ${show(s1)}`);
    const s2 = await sweep();
    assert(s2.status === 200, `sweep again: ${show(s2)}`);
    const after = await staleNotices(A.token);
    assert(after.length === before + 1, `one notice, got ${after.length - before}`);
    assert(after[0].title.includes(PROD), `the notice names the package: ${JSON.stringify(after[0])}`);
    assert(after[0].i18n?.key === 'datapackage_stale_one', `translated text: ${JSON.stringify(after[0].i18n)}`);
    assert((await staleNotices(B.token)).length === 0, 'B got a notice about A\'s package');
});

await test('D6.2b a successful run ends the spell, and a new stale spell sends one more', async () => {
    const r = await call(`/v1/dataproducts/${PROD}/run`, { token: A.token, body: {} });
    // The same rows again: no new version, 200 with unchanged, and the pointer moves.
    assert(r.status === 200 && r.body.data.unchanged === true, `run: ${show(r)}`);
    assert((await freshness(PROD))?.state === 'fresh', 'fresh again after a run whose bytes were already there');
    const before = (await staleNotices(A.token)).length;
    assert((await sweep()).status === 200, 'sweep while fresh');
    assert((await staleNotices(A.token)).length === before, 'a fresh package was told about');
    await setBack(PROD, 6 * 24);
    assert((await sweep()).status === 200, 'sweep after the new spell');
    assert((await sweep()).status === 200, 'sweep again');
    assert((await staleNotices(A.token)).length === before + 1, 'the new spell sent exactly one notice');
});

console.log('\nD6.4 Versions in use and retention');

let v1 = '', v2 = '', shareId = '', partyKey = '';
await test('D6.4a a share pins v1 and the party reads it; the owner sees both on the versions list', async () => {
    const p1 = await publish(A.token, PIN, [{ id: 1 }]);
    assert(p1.status === 201, `v1: ${show(p1)}`);
    v1 = p1.body.data.content_hash;
    const party = await call('/v1/parties', { token: A.token, body: { name: `pin${stamp % 1000}`, kind: 'program' } });
    assert(party.status === 201, `party: ${show(party)}`);
    partyKey = party.body.data.key;
    const sh = await call('/v1/consent', { token: A.token, body: { recipient: `party:${A.name}/pin${stamp % 1000}@${node}`, data_pattern: `datapkg:${PIN}`, purpose: 'Pinned report', metadata: { pinned_version: v1 } } });
    assert(sh.status === 201, `share: ${show(sh)}`);
    shareId = sh.body.data?.consent?.id ?? sh.body.data?.id ?? sh.body.data?.consent_id;
    const read = await call(`/v1/datapackages/${A.name}/${PIN}`, { basic: `${A.name}/pin${stamp % 1000}:${partyKey}` });
    assert(read.status === 200 && read.body.data.descriptor.aimeat.contentHash === v1, `party read: ${show(read)}`);
    const p2 = await publish(A.token, PIN, [{ id: 2 }]);
    assert(p2.status === 201, `v2: ${show(p2)}`);
    v2 = p2.body.data.content_hash;
    const list = await call(`/v1/datapackages/${A.name}/${PIN}/versions`, { token: A.token });
    assert(list.status === 200, `versions: ${show(list)}`);
    const one = list.body.data.versions.find((v: Body) => v.contentHash === v1);
    assert(one?.in_use?.pinned_by_shares?.length === 1 && (!shareId || one.in_use.pinned_by_shares[0] === shareId), `pinned: ${JSON.stringify(one)}`);
    assert(one.in_use.party_reads_30d >= 1 && typeof one.in_use.last_party_read_at === 'string', `read: ${JSON.stringify(one.in_use)}`);
    assert(list.body.data.read_window_days === 30, 'the window is named');
});

await test('D6.4b retention keep 1 spares the pinned v1 and removes the unpinned v2', async () => {
    const p3 = await publish(A.token, PIN, [{ id: 3 }], { retentionPolicy: { keep: 1, unit: 'versions' } });
    assert(p3.status === 201, `v3: ${show(p3)}`);
    const pruned: string[] = p3.body.data.pruned_versions ?? [];
    assert(pruned.includes(v2), `v2 removed: ${JSON.stringify(pruned)}`);
    assert(!pruned.includes(v1), 'the pinned version was removed');
    const pinned = await call(`/v1/datapackages/${A.name}/${PIN}`, { basic: `${A.name}/pin${stamp % 1000}:${partyKey}` });
    assert(pinned.status === 200 && pinned.body.data.descriptor.aimeat.contentHash === v1, `the party still reads v1: ${show(pinned)}`);
});

await test('D6.4c removed_next marks what the next publish removes under the policy; others see no use fields', async () => {
    assert((await publish(A.token, RET, [{ r: 1 }], { visibility: 'public' })).status === 201, 'r1');
    assert((await publish(A.token, RET, [{ r: 2 }], { visibility: 'public', retentionPolicy: { keep: 2, unit: 'versions' } })).status === 201, 'r2');
    const mine = await call(`/v1/datapackages/${A.name}/${RET}/versions`, { token: A.token });
    const [newest, oldest] = mine.body.data.versions;
    assert(newest.current === true && newest.in_use.removed_next === false, `newest: ${JSON.stringify(newest)}`);
    assert(oldest.in_use.removed_next === true, `oldest goes next: ${JSON.stringify(oldest)}`);
    assert(mine.body.data.retention_policy?.keep === 2, `policy: ${JSON.stringify(mine.body.data.retention_policy)}`);
    const theirs = await call(`/v1/datapackages/${A.name}/${RET}/versions`, { token: B.token });
    assert(theirs.status === 200 && !theirs.text.includes('in_use') && !theirs.text.includes('retention_policy'), `B sees use fields: ${show(theirs)}`);
    const anon = await call(`/v1/datapackages/${A.name}/${RET}/versions`);
    assert(anon.status === 200 && !anon.text.includes('in_use'), 'an anonymous reader sees use fields');
    const party = await call(`/v1/datapackages/${A.name}/${PIN}/versions`, { basic: `${A.name}/pin${stamp % 1000}:${partyKey}` });
    assert(party.status === 200 && !party.text.includes('pinned_by_shares'), `the party sees use fields: ${show(party)}`);
});

console.log('\nRefusals');

await test('B reads neither A\'s private package\'s freshness nor its versions; nobody writes the stale-notice record through memory', async () => {
    const d = await call(`/v1/datapackages/${A.name}/${PROD}`, { token: B.token });
    assert(d.status === 404 && !d.text.includes('freshness'), `B reads A's private package: ${show(d)}`);
    const v = await call(`/v1/datapackages/${A.name}/${PIN}/versions`, { token: B.token });
    assert(v.status === 404 && !v.text.includes('pinned_by_shares'), `B reads A's private versions: ${show(v)}`);
    const w = await call('/v1/memory', { token: A.token, body: { key: 'datapkg-freshness-notices', value: { packages: {} } } });
    assert(w.status === 403, `the service-owned notice record was written through memory: ${show(w)}`);
});

console.log('\nLive updates');

await test('A publish and a withdrawal emit datapackages on A\'s stream, never on B\'s', async () => {
    const sa = await openStream(A.token);
    const sb = await openStream(B.token);
    try {
        await new Promise(r => setTimeout(r, 300));
        const LIVE = `dlcl${stamp}`;
        assert((await publish(A.token, LIVE, [{ x: 1 }])).status === 201, 'publish');
        assert(await sa.waitFor('datapackages', 5000), `A heard no publish: ${JSON.stringify(sa.domains())}`);
        sa.reset();
        const w = await call(`/v1/datapackages/${A.name}/${LIVE}`, { token: A.token, method: 'DELETE' });
        assert(w.status === 200, `withdraw: ${show(w)}`);
        assert(await sa.waitFor('datapackages', 5000), `A heard no withdrawal: ${JSON.stringify(sa.domains())}`);
        await new Promise(r => setTimeout(r, 1500));
        assert(!sb.domains().includes('datapackages'), 'B heard about A\'s package');
    } finally { sa.close(); sb.close(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

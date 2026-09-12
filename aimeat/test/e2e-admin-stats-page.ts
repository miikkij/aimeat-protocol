/**
 * @file test/e2e-admin-stats-page.ts
 * @description E2E for the numbers behind the admin Statistics page: that they exist at all.
 *
 *   THIS SUITE IS THE TWIN OF e2e-metrics.ts, and it is here because that suite's lesson was only
 *   half learnt. metricsMiddleware was written, left unmounted, and caught on 2026-08-17 by an
 *   assertion that a counter GROWS. statsMiddleware — the same shape, the same file date, feeding
 *   the page an operator actually opens rather than a Prometheus scrape — stayed unmounted until
 *   2026-09-12, because nothing asserted the same thing about GET /v1/stats. `requests_total` read
 *   0 on every node that has ever run this code, and the Statistics page led on that zero.
 *
 *   scope_denials_total is the other counter in the same state: declared in the snapshot, in the
 *   Prometheus registry and on the Security page, written by nothing. It is asserted the way the
 *   page needs it — a refusal happens, the number goes up.
 *
 *   The last case is what lets the page tell an absence from a zero. A counter read over a period
 *   before this node existed is 0; the same counter read over the node's whole life is not. Without
 *   both readings a dead counter and a quiet week look identical, which is how this went unnoticed.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-stats-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial: requests_total is counted, scope denials are counted, and a
 *     period reading is a different reading from the node's whole life.
 */

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

/** The stats read the page makes: un-ranged is the node's whole life, ranged is one period. */
async function stats(token: string, from?: string, to?: string) {
    const qs = from && to ? `?from=${from}&to=${to}` : '';
    const r = await json(`/v1/stats${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    assert(r.body.ok === true, `stats read: ${JSON.stringify(r.body.error ?? r.status)}`);
    return r.body.data as Record<string, any>;
}

const today = new Date().toISOString().split('T')[0];

console.log('\n=== AIMEAT Admin Statistics page E2E ===\n');

const ownerName = `statsop${Date.now()}`;
let ownerToken = '';
let narrowToken = '';

await test('Setup: an operator, and an agent holding memory:read only', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body.error ?? '')}`);
    const ownerKey = reg.body.data.private_key as string;

    let ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerKey, ownerName + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;

    const agent = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'statsnarrow', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'] }),
    });
    assert(agent.status === 201, `register agent: ${agent.status} ${JSON.stringify(agent.body.error ?? '')}`);
    const gaii = agent.body.data.agent.gaii as string;
    const agentKey = agent.body.data.private_key as string;

    // An agent signs gaii + timestamp; an owner signs name + nodeId + timestamp. Two shapes, and
    // the wrong one here reads as "Invalid signature" rather than as a mistake in the test.
    ts = new Date().toISOString();
    const atok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(agentKey, gaii + ts) }),
    });
    assert(atok.body.ok === true, `agent token: ${JSON.stringify(atok.body.error)}`);
    narrowToken = atok.body.data.token;
});

let firstRequests = 0;

await test('requests_total is a real number, not the zero an unmounted middleware leaves', async () => {
    const snap = await stats(ownerToken);
    firstRequests = Number(snap.requests_total ?? 0);
    assert(firstRequests > 0, `requests_total > 0 after the setup above made requests, got ${firstRequests}`);
});

await test('requests_total grows when requests are made', async () => {
    for (let i = 0; i < 3; i++) await json('/v1/build');
    const snap = await stats(ownerToken);
    const second = Number(snap.requests_total ?? 0);
    assert(second > firstRequests, `counter grew: ${firstRequests} -> ${second}`);
});

await test("today's tally carries requests_total, so the page can draw a day", async () => {
    const snap = await stats(ownerToken);
    const daily = snap.daily ?? snap.daily_history ?? {};
    const day = daily[today];
    assert(!!day, `daily history has today (${today}); days present: ${Object.keys(daily).join(',') || 'none'}`);
    assert(Number(day.requests_total ?? 0) > 0, `today's requests_total > 0, got ${day.requests_total}`);
});

await test('requests_by_method and requests_by_status are filled in too', async () => {
    const snap = await stats(ownerToken);
    assert(Number(snap.requests_by_method?.GET ?? 0) > 0, `GET counted, got ${JSON.stringify(snap.requests_by_method)}`);
    const byStatus = snap.requests_by_status ?? {};
    const any = Object.values(byStatus).reduce((a: number, b: any) => a + Number(b), 0);
    assert(any > 0, `some status bucket counted, got ${JSON.stringify(byStatus)}`);
});

await test('a scope refusal increments scope_denials_total', async () => {
    const before = Number((await stats(ownerToken)).scope_denials_total ?? 0);

    // memory:read reaching for a memory:write door. denyScope403 is the one place this passes.
    const refused = await json('/v1/account/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${narrowToken}` },
        body: JSON.stringify({ type: 'e2e.stats.probe' }),
    });
    assert(refused.status === 403, `expected 403, got ${refused.status} ${JSON.stringify(refused.body.error ?? '')}`);
    assert(refused.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${refused.body.error?.code}`);

    const after = Number((await stats(ownerToken)).scope_denials_total ?? 0);
    assert(after > before, `scope_denials_total grew: ${before} -> ${after}`);
});

await test('a period before this node existed reads 0 while its whole life does not', async () => {
    const life = Number((await stats(ownerToken)).requests_total ?? 0);
    const old = await stats(ownerToken, '2020-01-01', '2020-01-07');
    assert(Number(old.requests_total ?? 0) === 0, `an empty period reads 0, got ${old.requests_total}`);
    assert(life > 0, `the whole life still reads ${life}`);
    assert(Object.keys(old.daily ?? {}).length === 0, 'an empty period carries no days');
});

await test('a period that includes today reads what today counted', async () => {
    const ranged = await stats(ownerToken, today, today);
    assert(Number(ranged.requests_total ?? 0) > 0, `today's range counts requests, got ${ranged.requests_total}`);
    assert(!!(ranged.daily ?? {})[today], 'the range carries today');
    assert(ranged.from === today && ranged.to === today, 'the response names the period it answered for');
});

await test('the live gauges ride along on a ranged read, and are not summed', async () => {
    const ranged = await stats(ownerToken, today, today);
    assert(typeof ranged.uptime_seconds === 'number', 'uptime is there');
    assert(typeof ranged.active_owners === 'number', 'owner count is there');
    assert(!!ranged.gauges, 'the gauges block is there');
    assert(typeof ranged.gauges.mailbox_items_total === 'number', 'a mailbox gauge is a number');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

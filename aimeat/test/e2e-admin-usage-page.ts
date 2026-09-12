/**
 * @file test/e2e-admin-usage-page.ts
 * @description E2E for the Usage page's read: that it says whose money each figure is, that it
 *   refuses a half-stated period, and that it never claims to have counted the key it cannot count.
 *
 *   THE ASSERTION THAT MATTERS MOST is the one about the chat agent. Every chat turn on this node
 *   is spent from a key handed to a child process, so no total the node computes contains any of
 *   it. A payload that omitted `keys.chat.metered_here: false` would read as a complete bill, and
 *   an operator acting on a complete-looking bill that is missing its largest item is the failure
 *   this whole page was rebuilt around.
 *
 *   THE HALF-PERIOD CASE is the other one worth writing down. `from` without `to` used to be
 *   completed with a default on the neighbouring stats route, which answers a caller who named one
 *   boundary with a range they did not ask for. Here it is a 400, and the CLI surface forwards a
 *   lone date precisely so that refusal reaches the caller instead of being hidden.
 *
 *   What it does NOT do: ask the provider. GET /v1/admin/usage/keys reaches openrouter.ai, and a
 *   suite that depends on a third party answering is a suite that goes red for reasons that have
 *   nothing to do with this code. Its shape is asserted through the un-asked path, where every
 *   `spend` is null by construction.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-usage-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Usage page's rebuild.
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

const today = new Date().toISOString().split('T')[0];

console.log('\n=== AIMEAT Admin Usage page E2E ===\n');

const opName = `usageop${Date.now()}`;
const otherName = `usageother${Date.now()}`;
let opToken = '';
let otherToken = '';

await test('Setup: the first owner is the operator; a second is not', async () => {
    const mk = async (name: string) => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register ${name}: ${reg.status}`);
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
        });
        assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
        return tok.body.data.token as string;
    };
    opToken = await mk(opName);
    otherToken = await mk(otherName);
});

const page = async (qs = '') =>
    json(`/v1/admin/usage/page${qs}`, { headers: { Authorization: `Bearer ${opToken}` } });

await test('The read answers, and names the period it answered for', async () => {
    const r = await page();
    assert(r.body.ok === true, `ok: ${JSON.stringify(r.body.error ?? r.status)}`);
    const d = r.body.data;
    assert(typeof d.from === 'string' && typeof d.to === 'string', 'from and to are there');
    assert(d.to === today, `to defaults to today, got ${d.to}`);
});

await test('Every figure says whose money it is', async () => {
    const m = (await page()).body.data.whose_money;
    for (const scope of ['house', 'own'] as const) {
        assert(typeof m[scope].cost_usd === 'number', `${scope}.cost_usd is a number`);
        assert(typeof m[scope].calls === 'number', `${scope}.calls is a number`);
        assert(typeof m[scope].people === 'number', `${scope}.people is a number`);
    }
    // The third count is NAMED as a third count rather than presented as a fourth fact.
    assert(typeof m.ledger?.cost_usd === 'number', 'the ledger total is there');
    assert(typeof m.ledger?.counted_from === 'string', 'the ledger says which table it read');
});

await test('The ceiling is the grant times the accounts, done rather than implied', async () => {
    const m = (await page()).body.data.whose_money;
    assert(typeof m.grant_usd === 'number', 'the grant is there');
    assert(typeof m.accounts === 'number' && m.accounts >= 2, `at least the two owners above, got ${m.accounts}`);
    assert(m.ceiling_usd === m.grant_usd * m.accounts,
        `ceiling ${m.ceiling_usd} === ${m.grant_usd} × ${m.accounts}`);
    assert(m.drawn_usd === m.house.cost_usd, 'what is drawn is what the house key was spent on');
});

await test('The chat agent is reported as NOT metered here', async () => {
    const keys = (await page()).body.data.keys;
    assert(keys.chat.metered_here === false,
        'keys.chat.metered_here is false — every chat turn is spent outside the metering');
    assert(keys.chat.node_counted_usd === null,
        'and the node offers no number of its own for it, rather than a zero that reads as "nothing"');
    assert(keys.house.metered_here === true, 'the house key IS metered per call');
});

await test('No provider is asked unless asked: every spend is null', async () => {
    const keys = (await page()).body.data.keys;
    assert(keys.chat.spend === null, 'chat spend is null on the page read');
    assert(keys.house.spend === null, 'house spend is null on the page read');
});

await test('The models carry their own tail and explain the unpriced calls', async () => {
    const models = (await page()).body.data.models;
    assert(Array.isArray(models.rows), 'the model rows are an array');
    assert(models.other === null || typeof models.other.models === 'number',
        'the tail is either absent or says how many models it folds');
    const u = models.unpriced;
    for (const field of ['calls', 'in_the_tail', 'on_models_that_charge', 'estimated_missing_usd']) {
        assert(typeof u[field] === 'number', `unpriced.${field} is a number`);
    }
});

await test('A period that is half stated is refused, not quietly completed', async () => {
    for (const qs of [`?from=${today}`, `?to=${today}`]) {
        const r = await page(qs);
        assert(r.status === 400, `${qs}: expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'BAD_RANGE', `${qs}: expected BAD_RANGE, got ${r.body.error?.code}`);
    }
});

await test('A malformed day and a backwards period are refused too', async () => {
    const bad = await page('?from=14%2F08%2F2026&to=' + today);
    assert(bad.status === 400, `a malformed day: expected 400, got ${bad.status}`);
    const backwards = await page(`?from=${today}&to=2020-01-01`);
    assert(backwards.status === 400, `from after to: expected 400, got ${backwards.status}`);
});

await test('A period both sides given is answered for exactly that period', async () => {
    const r = await page(`?from=${today}&to=${today}`);
    assert(r.body.ok === true, `ok: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.from === today && r.body.data.to === today, 'it answered for the day asked');
});

await test('Both doors are operator-only', async () => {
    for (const path of ['/v1/admin/usage/page', '/v1/admin/usage/keys']) {
        const other = await json(path, { headers: { Authorization: `Bearer ${otherToken}` } });
        assert(other.status === 403, `${path} as a non-operator: expected 403, got ${other.status}`);
        const anon = await json(path);
        assert(anon.status === 401 || anon.status === 403, `${path} unauthenticated: got ${anon.status}`);
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file e2e-admin-work-page.ts
 * @description E2E for the one read the Work page is folded from. GET /v1/admin/work is asserted
 *   elsewhere only on an EMPTY node (e2e-admin-doors-2 checks the envelope and that `total` matches
 *   the length), so nothing has ever held the SHAPE OF A ROW — and the page counts every figure it
 *   prints out of those fields.
 *
 *   `cost` gets its own assertion on purpose: it is an OBJECT, and the page this replaces printed it
 *   with a number formatter. The escrow inside it is what the page sums into "morsels held", so a
 *   row that carried a bare number there would make that figure quietly wrong rather than loud.
 *
 *   `ttl_expires_at` likewise: the page reads it to say which open item has outlived the deadline it
 *   was given, which is the one row it draws in coral and the only sign an operator gets that the
 *   hourly expiry sweep is not running.
 * @version-history
 *   v1.0.0 -- 2026-09-12 -- Initial (the Work page in the poster face).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-work-page

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// A message built into a passing assert is still evaluated, so this has to survive `undefined`.
const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 300));

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function ownerToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${short(tok.body.error)}`);
    return tok.body.data.token;
}

async function agentToken(gaii: string, privB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const r = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: await signMsg(privB64, gaii + timestamp) }),
    });
    assert(r.status === 200, `agent token for ${gaii}: ${r.status} ${short(r.body)}`);
    return r.body.data.token as string;
}

/** An owner's agent, with a session of its own. Agents are what ask each other for work. */
async function agent(owner: string, ownerTok: string, label: string): Promise<{ gaii: string; token: string }> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name: label, owner, capabilities: ['*'], model: 'test' }),
    });
    assert(created.status === 201, `agent ${label}: ${created.status} ${short(created.body)}`);
    const gaii = created.body.data.agent.gaii as string;
    return { gaii, token: await agentToken(gaii, created.body.data.private_key as string) };
}

async function adminWork(token: string) {
    const r = await json('/v1/admin/work', { headers: auth(token) });
    assert(r.status === 200, `admin work ${r.status}: ${short(r.body.error)}`);
    return r.body.data;
}

console.log('\n=== AIMEAT Admin Work Page E2E ===\n');

const stamp = Date.now();
const opName = `wkop${stamp}`;
const reqName = `wkreq${stamp}`;
const provName = `wkprov${stamp}`;
const ACTION = `work-page-probe-${stamp}`;

let opToken = '';
let reqTok = '';
let requester = { gaii: '', token: '' };
let provider = { gaii: '', token: '' };
let trackingCode = '';

await test('Setup: an operator, a requester agent with morsels, and a provider with an action', async () => {
    opToken = await ownerToken(opName);
    reqTok = await ownerToken(reqName);
    const provTok = await ownerToken(provName);
    requester = await agent(reqName, reqTok, 'asker');
    provider = await agent(provName, provTok, 'doer');

    const publish = await json('/v1/actions', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({
            id: ACTION, display_name: 'Work page probe', description: 'Used to prove the admin work listing carries a row',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 10 },
        }),
    });
    assert(publish.status === 201, `publish action: ${publish.status} ${short(publish.body)}`);

    const mint = await json('/v1/admin/mint', {
        method: 'POST', headers: auth(opToken), body: JSON.stringify({ gaii: requester.gaii, amount: 100 }),
    });
    assert(mint.status === 200, `mint: ${mint.status} ${short(mint.body)}`);
});

await test('A work item is asked for, and it is pending from the first moment', async () => {
    const submitted = await json('/v1/work', {
        method: 'POST', headers: auth(requester.token),
        body: JSON.stringify({ action_id: ACTION, provider_gaii: provider.gaii, input: { text: 'probe' }, ttl_hours: 24 }),
    });
    assert(submitted.status === 201, `work submit: ${submitted.status} ${short(submitted.body)}`);
    trackingCode = submitted.body.data.tracking_code;
    assert(typeof trackingCode === 'string' && trackingCode.startsWith('tc-'),
        `the tracking code is what every row is addressed by: ${trackingCode}`);

    // The morsels are the OWNER's, never the agent's: debit and credit resolve any principal to the
    // owner GHII, and an agent's own balance is 0 by design. So the escrow below is the human's
    // money, and the page says so rather than naming the agent as the payer.
    const r = await json('/v1/admin/agents', { headers: auth(opToken) });
    const asker = r.body.data.agents.find((a: any) => a.gaii === requester.gaii);
    assert(asker.morsel_balance === 0, `an agent holds no balance of its own: ${asker.morsel_balance}`);
});

await test('An owner who is not an operator cannot read the listing the page is built on', async () => {
    const r = await json('/v1/admin/work', { headers: auth(reqTok) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Every row carries the field set the page folds its figures from', async () => {
    const data = await adminWork(opToken);
    assert(Array.isArray(data.work), 'work is not a list');
    assert(data.total === data.work.length, 'total disagrees with the list');
    const row = data.work.find((w: any) => w.tracking_code === trackingCode);
    assert(!!row, 'the item just asked for is not in the listing');
    for (const field of ['tracking_code', 'status', 'action_id', 'provider_gaii', 'requester_gaii', 'cost', 'created_at', 'updated_at', 'ttl_expires_at']) {
        assert(field in row, `a row has no ${field}: the page counts on it`);
    }
    assert(row.status === 'pending', `a fresh item should be pending: ${row.status}`);
    assert(row.action_id === ACTION, `action_id: ${row.action_id}`);
});

await test('The cost is an object, and the escrow inside it is what "morsels held" sums', async () => {
    const row = (await adminWork(opToken)).work.find((w: any) => w.tracking_code === trackingCode);
    assert(row.cost !== null && typeof row.cost === 'object',
        `cost must be an object, not ${typeof row.cost}: a number formatter would print [object Object]`);
    for (const field of ['base_price', 'network_fee', 'total', 'in_escrow']) {
        assert(field in row.cost, `cost has no ${field}`);
    }
    assert(row.cost.total > 0, `total should carry the price: ${row.cost.total}`);
    assert(row.cost.in_escrow === row.cost.total,
        `an open item holds its whole cost: ${row.cost.in_escrow} of ${row.cost.total}`);
});

await test('The deadline is a date in the future, which is what says whether the sweep is behind', async () => {
    const row = (await adminWork(opToken)).work.find((w: any) => w.tracking_code === trackingCode);
    const ttl = Date.parse(row.ttl_expires_at);
    assert(Number.isFinite(ttl), `ttl_expires_at is not a date: ${row.ttl_expires_at}`);
    assert(ttl > Date.now(), 'a fresh item asked with 24 hours should not already be past its deadline');
});

await test('Delivering it settles the escrow, and the row says delivered', async () => {
    const accepted = await json(`/v1/work/${trackingCode}/accept`, { method: 'POST', headers: auth(provider.token) });
    assert(accepted.status === 200, `accept: ${accepted.status} ${short(accepted.body)}`);

    const midway = (await adminWork(opToken)).work.find((w: any) => w.tracking_code === trackingCode);
    assert(midway.status === 'accepted', `after accept: ${midway.status}`);

    const delivered = await json(`/v1/work/${trackingCode}/deliver`, {
        method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: { result: 'as asked' } }),
    });
    assert(delivered.status === 200, `deliver: ${delivered.status} ${short(delivered.body)}`);

    const row = (await adminWork(opToken)).work.find((w: any) => w.tracking_code === trackingCode);
    assert(row.status === 'delivered', `after deliver: ${row.status}`);
    assert(row.updated_at !== row.created_at, 'updated_at should move when the item is delivered: the closed row prints it');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

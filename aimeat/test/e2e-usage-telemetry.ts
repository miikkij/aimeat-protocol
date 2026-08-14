/**
 * @file e2e-usage-telemetry.ts
 * @description E2E for usage telemetry end to end: an AI-shaped spend and an app open become raw
 *   rows, the fold turns them into precomputed rollups, the owner reads their OWN numbers and only
 *   their own, and the operator reads across owners with the raw drill leaving its audit row.
 *
 *   The failure modes it exists to catch, in order of what they would cost:
 *     1. one owner reading another's usage through /v1/usage/summary (cross-owner)
 *     2. a non-operator reaching any /v1/admin/usage route
 *     3. the operator's raw drill leaving no trace of who looked at whom
 *     4. an archive prune running without an explicit date and confirmation
 *
 *   Design: docs/internal/telemetria/02-design.md
 * @version-history
 *   v1.0.0 -- 2026-08-14 -- Initial: the ingest → fold → serve chain plus its authorization gates.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-usage-telemetry

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

console.log('\n=== AIMEAT Usage Telemetry E2E ===\n');

const opName = `usageop${Date.now()}`;
const otherName = `usageother${Date.now()}`;
let opToken = '';
let otherToken = '';
const authOp = () => ({ Authorization: `Bearer ${opToken}` });
const authOther = () => ({ Authorization: `Bearer ${otherToken}` });

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    otherToken = await registerAndToken(otherName);
});

// ── Ingest ──────────────────────────────────────────────────────────────────────────────────────
// Telemetry is the door every agent already uses, and it is the one that reaches the LLM ledger.
// One llm_call with a model produces a priced ledger row, which is what the fold reads.

await test('Setup: an agent llm_call lands in the ledger for each owner', async () => {
    for (const [name, auth] of [[opName, authOp()], [otherName, authOther()]] as const) {
        // A telemetry report needs an agent to exist. Owner sessions may report for their own agent.
        const created = await json('/v1/agents', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ name: 'reporter', owner: name, capabilities: ['test'] }),
        });
        assert(created.status === 201 || created.status === 200 || created.status === 409,
            `agent create for ${name}: ${created.status} ${JSON.stringify(created.body.error)}`);

        const rep = await json('/v1/agents/reporter/telemetry', {
            method: 'POST', headers: auth,
            body: JSON.stringify({
                type: 'llm_call',
                data: {
                    model: name === opName ? 'anthropic/claude-opus-5' : 'openai/gpt-5',
                    provider: 'openrouter', prompt_tokens: 100, completion_tokens: 40, cost_usd: 0.02,
                },
            }),
        });
        assert(rep.status === 201, `telemetry for ${name}: ${rep.status} ${JSON.stringify(rep.body.error)}`);
    }
});

// ── Fold ────────────────────────────────────────────────────────────────────────────────────────
// The scheduled job runs every 5 minutes; a test cannot wait for it, so it is triggered the same way
// an operator would after declaring a new cut.

await test('Fold: a rebuild computes the serving layer from raw', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await json('/v1/admin/usage/rollup/rebuild', {
        method: 'POST', headers: authOp(), body: JSON.stringify({ from: today }),
    });
    assert(status === 200, `rebuild: ${status} ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data.folded), 'reports what it folded');
});

await test('GET /v1/admin/usage/status reports how fresh the layer is', async () => {
    const { status, body } = await json('/v1/admin/usage/status', { headers: authOp() });
    assert(status === 200, `status: ${status}`);
    assert(typeof body.data.hot_window_days === 'number', 'names the hot window');
    assert(body.data.computed_through !== undefined, 'states computed_through, even when null');
});

// ── The owner's own view ────────────────────────────────────────────────────────────────────────

await test('An owner sees their own model usage, grouped', async () => {
    const { status, body } = await json('/v1/usage/summary?report=model', { headers: authOp() });
    assert(status === 200, `summary: ${status} ${JSON.stringify(body.error)}`);
    assert(body.data.cut === 'llm.owner.model', `owner scope resolves to an owner cut, got ${body.data.cut}`);
    const models = body.data.groups.map((g: any) => g.key);
    assert(models.includes('anthropic/claude-opus-5'), `own model present, got ${JSON.stringify(models)}`);
});

await test('CROSS-OWNER: an owner never sees another owner model usage', async () => {
    const { body } = await json('/v1/usage/summary?report=model', { headers: authOp() });
    const models = body.data.groups.map((g: any) => g.key);
    // The other owner's spend exists and was folded; the only reason it is absent here is scoping.
    assert(!models.includes('openai/gpt-5'),
        `the other owner model leaked into this report: ${JSON.stringify(models)}`);
});

await test('CROSS-OWNER: an owner cannot ask for another owner rows via a query param', async () => {
    // There is no `owner` parameter on this router by design. Passing one must change nothing
    // rather than being honoured, so the assertion is that the answer is still only their own.
    const { body } = await json(`/v1/usage/summary?report=model&owner=${otherName}&ownerGhii=${otherName}@${NODE_ID}`, { headers: authOp() });
    const models = body.data.groups.map((g: any) => g.key);
    assert(!models.includes('openai/gpt-5'), 'a query parameter must not widen an owner-scoped read');
    assert(body.data.owner === `${opName}@${NODE_ID}`, `report stays on the caller identity, got ${body.data.owner}`);
});

await test('An unknown report name is refused, and says what exists', async () => {
    const { status, body } = await json('/v1/usage/summary?report=nonsense', { headers: authOp() });
    assert(status === 400, `status ${status}`);
    assert(String(body.error?.message ?? '').includes('model'), 'lists the available reports');
});

await test('GET /v1/usage/reports lists what may be asked for', async () => {
    const { status, body } = await json('/v1/usage/reports', { headers: authOp() });
    assert(status === 200, `status ${status}`);
    assert(body.data.reports.some((r: any) => r.name === 'tool'), 'includes the tool report');
});

// ── The scope gate ──────────────────────────────────────────────────────────────────────────────
// A usage report is the owner's whole spend and activity history. An app or agent the owner
// approved for something narrower must not be able to read it just by being authenticated, which is
// the widening the route-scope invariant exists to catch.

async function scopedToken(scopes: string[]): Promise<string> {
    const pat = await json('/v1/access/tokens', {
        method: 'POST', headers: authOp(),
        body: JSON.stringify({ label: `usage-scope-${scopes.join('-')}`, scopes }),
    });
    assert(pat.status === 201, `mint PAT ${scopes}: ${pat.status} ${JSON.stringify(pat.body.error)}`);
    const ex = await json('/v1/auth/token/exchange', {
        method: 'POST', headers: { Authorization: `Bearer ${pat.body.data.token}` },
    });
    assert(ex.status === 200, `exchange ${scopes}: ${ex.status} ${JSON.stringify(ex.body.error)}`);
    return ex.body.data.token ?? ex.body.data.access_token;
}

await test('SCOPE: a token without wallet:read is refused both usage routes (403)', async () => {
    const narrow = await scopedToken(['memory:read']);
    for (const path of ['/v1/usage/summary?report=model', '/v1/usage/reports']) {
        const r = await json(path, { headers: { Authorization: `Bearer ${narrow}` } });
        assert(r.status === 403, `${path}: expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body?.error?.code}`);
    }
});

await test('SCOPE: the same token WITH wallet:read is let through', async () => {
    // The other half of the gate: proving the refusal above is the scope and not something else
    // about a scoped token.
    const allowed = await scopedToken(['wallet:read']);
    const r = await json('/v1/usage/summary?report=model', { headers: { Authorization: `Bearer ${allowed}` } });
    assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body.error)}`);
});

// ── The operator's view ─────────────────────────────────────────────────────────────────────────

await test('The operator sees every owner model usage node-wide', async () => {
    const { status, body } = await json('/v1/admin/usage/summary?report=model', { headers: authOp() });
    assert(status === 200, `status ${status} ${JSON.stringify(body.error)}`);
    const models = body.data.groups.map((g: any) => g.key);
    assert(models.includes('anthropic/claude-opus-5') && models.includes('openai/gpt-5'),
        `node scope covers both owners, got ${JSON.stringify(models)}`);
});

await test('The operator can scope a node report to one named owner', async () => {
    const { status, body } = await json(`/v1/admin/usage/summary?report=model&owner=${otherName}`, { headers: authOp() });
    assert(status === 200, `status ${status}`);
    const models = body.data.groups.map((g: any) => g.key);
    assert(models.includes('openai/gpt-5'), `sees the named owner, got ${JSON.stringify(models)}`);
    assert(!models.includes('anthropic/claude-opus-5'), 'and only that owner');
});

await test('AUTH: a non-operator is refused every /v1/admin/usage route', async () => {
    for (const path of ['/v1/admin/usage/summary', '/v1/admin/usage/calls', '/v1/admin/usage/status', '/v1/admin/usage/reports']) {
        const { status } = await json(path, { headers: authOther() });
        assert(status === 403, `${path} for a non-operator: expected 403, got ${status}`);
    }
    const rebuild = await json('/v1/admin/usage/rollup/rebuild', {
        method: 'POST', headers: authOther(), body: JSON.stringify({ from: new Date().toISOString().slice(0, 10) }),
    });
    assert(rebuild.status === 403, `rebuild for a non-operator: expected 403, got ${rebuild.status}`);
});

// ── Liability and its counterweight ─────────────────────────────────────────────────────────────

await test('The operator raw drill returns calls AND records that it looked', async () => {
    const target = `${otherName}@${NODE_ID}`;
    const drill = await json(`/v1/admin/usage/calls?owner=${encodeURIComponent(target)}`, { headers: authOp() });
    assert(drill.status === 200, `drill: ${drill.status} ${JSON.stringify(drill.body.error)}`);
    assert(drill.body.data.audited === true, 'the answer states that the read was audited');

    // The audit row is the counterweight to the operator seeing identifiable per-user activity: it
    // is written into the same stream, so it shows up in an ordinary drill rather than a log file.
    const audit = await json('/v1/admin/usage/calls?surface=operator', { headers: authOp() });
    assert(audit.status === 200, `audit read: ${audit.status}`);
    const looked = audit.body.data.calls.filter((c: any) => c.coordinate === 'usage.calls');
    assert(looked.length >= 1, 'an inspection left a row');
    assert(looked.some((c: any) => c.counterpartyGhii === target),
        `the audit row names WHO was inspected, got ${JSON.stringify(looked.map((c: any) => c.counterpartyGhii))}`);
});

await test('Archive prune refuses without an explicit date and an explicit confirmation', async () => {
    const noDate = await json('/v1/admin/usage/archive/prune', {
        method: 'POST', headers: authOp(), body: JSON.stringify({ confirm: true }),
    });
    assert(noDate.status === 400, `no date: expected 400, got ${noDate.status}`);

    const noConfirm = await json('/v1/admin/usage/archive/prune', {
        method: 'POST', headers: authOp(), body: JSON.stringify({ before: '2020-01-01' }),
    });
    assert(noConfirm.status === 400, `no confirm: expected 400, got ${noConfirm.status}`);
    assert(noConfirm.body.error?.code === 'CONFIRMATION_REQUIRED', `names why, got ${noConfirm.body.error?.code}`);
});

await test('A rebuild past the hot window is refused rather than deleting what it cannot refill', async () => {
    const { status, body } = await json('/v1/admin/usage/rollup/rebuild', {
        method: 'POST', headers: authOp(), body: JSON.stringify({ from: '2020-01-01' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(String(body.error?.message ?? '').includes('hot window'), 'explains the boundary');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

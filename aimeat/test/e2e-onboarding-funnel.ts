/**
 * @file e2e-onboarding-funnel.ts
 * @description E2E for the activation funnel (UX-remake v3, 05-mittaus.md). The funnel's whole
 *   point is that activation is ONE event with a kind, written once, by whichever of the three
 *   doors the account walked through first: a published app, published workspace content, or an
 *   agent's first write. This suite drives each door with its own account and asserts the marker,
 *   then reads the operator view and checks the cohort rollup counts what happened.
 *
 *   Failure modes covered: the marker never moves once written (an account's SECOND publish must
 *   not overwrite the first kind or timestamp), the funnel view is operator-gated, and the
 *   onboarding.* markers themselves never count as an agent activation (the funnel measuring
 *   itself would activate every account that merely opened the hello page).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-onboarding-funnel
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const ownerApp = `fnla${stamp}`;
const ownerAgent = `fnlg${stamp}`;
const ACTIVATED_KEY = 'onboarding.activated';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<{ token: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string };
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const readActivation = async (token: string) => {
    const { body } = await json(`/v1/memory/${encodeURIComponent(ACTIVATED_KEY)}?soft=1`, auth(token));
    return body.data?.exists === false ? null : body.data?.value ?? null;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The marker is written fire-and-forget off the request path — poll briefly for it. */
const waitForActivation = async (token: string) => {
    for (let i = 0; i < 12; i++) {
        const v = await readActivation(token);
        if (v) return v;
        await sleep(250);
    }
    return null;
};

let tokenApp = '';
let tokenAgent = '';
let agentToken = '';

console.log('\n=== Onboarding Funnel E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register two owners (one per activation door)', async () => {
    tokenApp = (await registerOwner(ownerApp)).token;
    tokenAgent = (await registerOwner(ownerAgent)).token;
});

await test('A fresh account has NO activation marker', async () => {
    assert((await readActivation(tokenApp)) === null, 'a new account must not be activated');
});

console.log('\nPhase 1: the app door');

await test('Publishing an app activates the account with kind=app', async () => {
    const html = '<!DOCTYPE html><html><head><title>Funnel Test</title></head><body>hi</body></html>';
    const r = await json('/v1/apps', auth(tokenApp, {
        method: 'POST',
        body: JSON.stringify({
            filename: 'funnel-test.html', content: Buffer.from(html).toString('base64'),
            mime_type: 'text/html', description: 'Funnel e2e fixture',
        }),
    }));
    assert(r.status === 201 || r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body)}`);
    const v = await waitForActivation(tokenApp);
    assert(!!v, 'activation marker must exist after a publish');
    assert(v.kind === 'app', `expected kind=app, got ${JSON.stringify(v.kind)}`);
    assert(typeof v.at === 'string', 'activation must carry a timestamp');
});

await test('A SECOND publish does not move the marker (write-once)', async () => {
    const before = await readActivation(tokenApp);
    const html = '<!DOCTYPE html><html><head><title>Funnel Test 2</title></head><body>hi again</body></html>';
    const r = await json('/v1/apps', auth(tokenApp, {
        method: 'POST',
        body: JSON.stringify({
            filename: 'funnel-test-2.html', content: Buffer.from(html).toString('base64'),
            mime_type: 'text/html', description: 'Second app',
        }),
    }));
    assert(r.status === 201 || r.status === 200, `second publish ${r.status}`);
    await sleep(600);
    const after = await readActivation(tokenApp);
    assert(after.at === before.at && after.kind === before.kind,
        `marker moved: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
});

console.log('\nPhase 2: the agent door');

await test('An AGENT write activates its owner with kind=agent', async () => {
    const { status, body } = await json('/v1/agents', auth(tokenAgent, {
        method: 'POST',
        body: JSON.stringify({ name: 'fnlagent', owner: ownerAgent, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(status === 201, `agent register ${status}: ${JSON.stringify(body)}`);
    const gaii = body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;

    // An onboarding.* write first: the funnel measuring itself must NOT count as activation.
    const marker = await json('/v1/memory', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'onboarding.hello_mcp', value: { ok: true }, visibility: 'private' }),
    }));
    assert(marker.status === 201, `hello_mcp write ${marker.status}`);
    await sleep(600);
    assert((await readActivation(tokenAgent)) === null,
        'an onboarding.* marker write must not activate the account');

    // A real write does.
    const real = await json('/v1/memory', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'funnel.worklog', value: { items: [1, 2] }, visibility: 'private' }),
    }));
    assert(real.status === 201, `agent write ${real.status}`);
    const v = await waitForActivation(tokenAgent);
    assert(!!v, 'agent write must activate the owner');
    assert(v.kind === 'agent', `expected kind=agent, got ${JSON.stringify(v.kind)}`);
});

console.log('\nPhase 3: the operator view');

/** Roles from a JWT payload — the node grants `operator` to the node's FIRST owner, so which of
 *  these accounts is privileged depends on whether this suite ran alone or after others. */
const rolesOf = (jwt: string): string[] => {
    try {
        const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        return Array.isArray(p.roles) ? p.roles : [];
    } catch { return []; }
};

await test('A NON-operator owner cannot read the funnel', async () => {
    // ownerAgent registered second, so it is never the node's first owner and never an operator.
    assert(!rolesOf(tokenAgent).includes('operator'), 'the second owner must not be an operator');
    const { status } = await json('/v1/admin/onboarding-funnel', auth(tokenAgent));
    assert(status === 403, `a plain owner must not read the funnel; got ${status}`);
});

await test('An operator reads cohorts + rows, and this account appears activated', async () => {
    // Solo run: ownerApp is the node's first owner and holds operator. In a shared run it does
    // not, and the assertion above already covers the gate — say which branch ran either way.
    if (!rolesOf(tokenApp).includes('operator')) {
        console.log('     (skipped: no operator token in this run — the 403 gate above is the coverage)');
        return;
    }
    const { status, body } = await json('/v1/admin/onboarding-funnel', auth(tokenApp));
    assert(status === 200, `operator read ${status}: ${JSON.stringify(body.error)}`);
    const rows = body.data?.rows ?? [];
    const cohorts = body.data?.cohorts ?? [];
    assert(Array.isArray(rows) && Array.isArray(cohorts), 'rows + cohorts must both be arrays');
    const mine = rows.find((r: any) => r.owner === ownerApp);
    assert(!!mine, `${ownerApp} must appear in the funnel rows`);
    assert(mine.activationKind === 'app', `expected activationKind=app, got ${mine.activationKind}`);
    assert(typeof mine.ttfvMinutes === 'number', 'an activated row must carry a TTFV');
    const week = cohorts[0];
    assert(week && week.created >= 2 && week.activated >= 2,
        `this week's cohort must count both accounts: ${JSON.stringify(week)}`);
    assert(week.activation_kinds.app >= 1 && week.activation_kinds.agent >= 1,
        `both activation kinds must be counted: ${JSON.stringify(week.activation_kinds)}`);
});

await test('Test accounts (uxtest-*) are excluded from the funnel', async () => {
    if (!rolesOf(tokenApp).includes('operator')) return;
    const { body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenApp));
    const leaked = (body.data?.rows ?? []).filter((r: any) => String(r.owner).startsWith('uxtest-'));
    assert(leaked.length === 0, `measurement accounts must not pollute the numbers: ${leaked.length} found`);
});

console.log(`\n=== Onboarding Funnel: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

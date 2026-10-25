/**
 * @file test/e2e-admin-operator-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's identity and scheduler routes write the operator trail when they act in
 *   another person's account: a line on that person's account feed and a row in the operator's usage
 *   stream (secaudit2026oct22, operator-cross-account-writes:no-operator-trail). The routes keep
 *   working for the operator as before, and an act on the operator's own account writes no line.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-operator-trail
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string; ghii: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'OperatorTrail1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const tok = await ownerSignIn(BASE, owner, 'OperatorTrail1234');
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner, ghii: `${owner}@${NODE_ID}` };
    }
}

async function operatorTrail(token: string): Promise<any[]> {
    const r = await json('/v1/account/events?limit=200', { headers: authed(token) });
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data.events as any[]).filter((e) => e.kind === 'operator_acted');
}

const actedOn = async (token: string, area: string, action: string): Promise<any[]> =>
    (await operatorTrail(token)).filter((e) => e.data?.area === area && e.data?.action === action);

console.log('═══ E2E: the operator trail on the identity and scheduler routes (secaudit2026oct22) ═══');
console.log(`Base: ${BASE}`);

// The first owner on the runner's emptied database is the operator.
const OP = await makeOwner('otop');
const B = await makeOwner('otother');
let jobId = '';

await test('The operator sets another person\'s verification level, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(B.ghii)}`, {
        method: 'PUT', headers: authed(OP.token), body: JSON.stringify({ verificationLevel: 1 }),
    });
    assert(r.status === 200, `PUT level: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.ghii_user?.verification_level === 1, `level echoed: ${JSON.stringify(r.body.data)}`);
    const acted = await actedOn(B.token, 'identity', 'verification-level');
    assert(acted.length === 1, `one operator_acted line for the level, got ${acted.length}`);
    assert(acted[0].data.operator === OP.ghii, `the line names the operator: ${JSON.stringify(acted[0].data)}`);
    assert(acted[0].data.level === '1', `the line names the level: ${JSON.stringify(acted[0].data)}`);
});

await test('The operator setting their own level writes no operator line', async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(OP.ghii)}`, {
        method: 'PUT', headers: authed(OP.token), body: JSON.stringify({ verificationLevel: 1 }),
    });
    assert(r.status === 200, `PUT own level: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(OP.token)).length === 0, 'an act on the operator\'s own account wrote an operator line');
});

await test('The operator clears another person\'s e-mail, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(B.ghii)}/email`, { method: 'DELETE', headers: authed(OP.token) });
    assert(r.status === 200, `DELETE email: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await actedOn(B.token, 'identity', 'email-clear')).length === 1, 'no operator line for the e-mail clear');
});

await test('Setup: the other person schedules a job of their own', async () => {
    const r = await json('/v1/schedules', {
        method: 'POST', headers: authed(B.token),
        body: JSON.stringify({ kind: 'ai', cron: '0 8 * * *', display_name: 'Morning summary', prompt: 'Summarise the input.', input_keys: ['news.raw'] }),
    });
    assert(r.status === 201, `schedule create: ${r.status} ${JSON.stringify(r.body)}`);
    jobId = r.body.data.schedule.id;
});

await test('The operator runs the person\'s job now, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/scheduler/jobs/${encodeURIComponent(jobId)}/trigger`, { method: 'POST', headers: authed(OP.token) });
    // The job's own run may fail on a node with no AI key; the route ran it either way.
    assert(r.status === 200 || r.body?.error?.code === 'TRIGGER_FAILED', `trigger: ${r.status} ${JSON.stringify(r.body)}`);
    const acted = await actedOn(B.token, 'schedule', 'trigger');
    assert(acted.length === 1, `one operator line for the run, got ${acted.length}`);
});

await test('The operator switches the job off, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/scheduler/jobs/${encodeURIComponent(jobId)}`, {
        method: 'PATCH', headers: authed(OP.token), body: JSON.stringify({ enabled: false }),
    });
    assert(r.status === 200, `PATCH job: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.job?.enabled === false, `job echoed: ${JSON.stringify(r.body.data)}`);
    assert((await actedOn(B.token, 'schedule', 'update')).length === 1, 'no operator line for the change');
});

await test('The operator deletes the job, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/scheduler/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: authed(OP.token) });
    assert(r.status === 200, `DELETE job: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await actedOn(B.token, 'schedule', 'delete')).length === 1, 'no operator line for the delete');
});

await test('A core job the operator runs writes no person\'s feed', async () => {
    const r = await json('/v1/admin/scheduler/jobs/core:usage-rollup/trigger', { method: 'POST', headers: authed(OP.token) });
    assert(r.status === 200 || r.status === 404, `core trigger: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(OP.token)).length === 0, 'a core job wrote an operator line in the operator\'s feed');
});

await test('The operator deletes another person\'s identity profile, and the person reads that in their feed', async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(B.ghii)}`, { method: 'DELETE', headers: authed(OP.token) });
    assert(r.status === 200, `DELETE ghii: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await actedOn(B.token, 'identity', 'delete')).length === 1, 'no operator line for the profile delete');
});

await test('FAILURE: a person who is not the operator cannot set another person\'s level, and no line is written', async () => {
    const C = await makeOwner('otthird');
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(C.ghii)}`, {
        method: 'PUT', headers: authed(B.token), body: JSON.stringify({ verificationLevel: 2 }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(C.token)).length === 0, 'a refused attempt wrote an operator line');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

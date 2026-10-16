/**
 * @file test/e2e-flag-review.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may review a flag: PUT /v1/flags/:id, whose only middleware is requireAuth(), so
 *   the code inside the handler is the whole authorization.
 *     - The operator dismisses and actions flags; reviewedBy names them.
 *     - An organism admin, signed in as the account holder, reviews a flag on their organism's
 *       memory, and is refused on another organism's flag and on a flag outside any organism.
 *     - The admin's own agent is refused, even holding social:write and memory:* (the 2026-09-14 fix:
 *       it moderated in the admin's name because the check read the owner name).
 *     - A plain owner and the reporter of the flag are refused; the flag is unchanged afterwards.
 *     - An invalid status is 400, an unknown id is 404, no credential is 401, and GET /v1/flags is
 *       the operator's alone.
 *
 *   WHY. No test of any kind sent this route. Its organism-admin branch compared admins[] (which
 *   holds bare owner names) with the GHII, so it matched nobody and an organism admin got 403, the
 *   opposite of what the handler and the transparency page say. Fixed on 2026-10-16 (flags.ts
 *   v1.3.1); test 7 failed on the old code. With the branch reachable, the refusal of the admin's
 *   agent guards something again, and the visitor from another node is refused in
 *   test/unit/flag-review-visitor.test.ts, because an E2E node cannot mint a visitor session.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-flag-review
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F13-03).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

let operator: RegisteredOwner;
let admin: RegisteredOwner;      // creates organism A, so admins[] holds this bare name
let other: RegisteredOwner;      // a plain owner; creates organism B
let reporter: RegisteredOwner;   // files the flags
let adminAgent: McpAgent;
let orgA = '';
let orgB = '';
let flagOrgA1 = '';
let flagOrgA2 = '';
let flagOrgB = '';
let flagAgent = '';

const review = (id: string, status: unknown, token?: string) =>
    json(`/v1/flags/${encodeURIComponent(id)}`, { method: 'PUT', token, body: JSON.stringify({ status }) });

async function flagState(id: string): Promise<any> {
    const r = await json('/v1/flags?per_page=100', { token: operator.token });
    if (r.status !== 200) throw new Error(`GET /v1/flags as the operator: ${r.status} ${short(r.body)}`);
    return (r.body.data as any[]).find((f) => f.id === id);
}

async function organismWithMemory(owner: RegisteredOwner, label: string): Promise<string> {
    const org = await json('/v1/organisms', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ name: `Flag review ${label} ${stamp}`, description: 'organism for the flag review suite', type: 'community' }),
    });
    if (org.status !== 201) throw new Error(`organism ${label}: ${org.status} ${short(org.body)}`);
    const id = org.body.data.organism.id as string;
    const mem = await json('/v1/memory', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ key: `organism.${id}.notes`, value: { note: `content of ${label}` }, visibility: 'private' }),
    });
    if (mem.status !== 201) throw new Error(`organism memory ${label}: ${mem.status} ${short(mem.body)}`);
    const mem2 = await json('/v1/memory', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ key: `organism.${id}.minutes`, value: { note: `minutes of ${label}` }, visibility: 'private' }),
    });
    if (mem2.status !== 201) throw new Error(`second organism memory ${label}: ${mem2.status} ${short(mem2.body)}`);
    return id;
}

async function file(targetType: string, targetId: string): Promise<string> {
    const r = await json('/v1/flags', {
        method: 'POST', token: reporter.token,
        body: JSON.stringify({ targetType, targetId, reason: 'inappropriate', description: 'raised by the flag review suite' }),
    });
    if (r.status !== 201) throw new Error(`flag ${targetType}: ${r.status} ${short(r.body)}`);
    return r.body.data.id as string;
}

console.log('\n=== FLAG REVIEW E2E (PUT /v1/flags/:id) ===\n');
console.log('Phase 0 — fixtures');

await test('The operator, an organism admin with an agent, a plain owner and a reporter', async () => {
    operator = await registerOwner(BASE, `frop${stamp}`);
    admin = await registerOwner(BASE, `fradm${stamp}`);
    other = await registerOwner(BASE, `froth${stamp}`);
    reporter = await registerOwner(BASE, `frrep${stamp}`);
    adminAgent = await makeAgent(BASE, admin, ['social:write', 'social:read', 'memory:*', 'organism:write']);
    assert(adminAgent.gaii.includes(`#${admin.name}@`), `the agent is the admin's: ${adminAgent.gaii}`);
});

await test('Two organisms with memory, and four flags: two on organism A, one on organism B, one on an agent', async () => {
    orgA = await organismWithMemory(admin, 'A');
    orgB = await organismWithMemory(other, 'B');
    const org = await json(`/v1/organisms/${orgA}`, { token: admin.token });
    const admins = ((org.body.data?.organism ?? org.body.data)?.admins ?? []) as string[];
    assert(admins.includes(admin.name), `admins[] holds the bare name, the form the route must match: ${JSON.stringify(admins)}`);
    flagOrgA1 = await file('memory', `${admin.name}@${NODE_ID}::organism.${orgA}.notes`);
    // A second flag on organism A needs a second target: the reporter may flag a target once.
    flagOrgA2 = await file('memory', `${admin.name}@${NODE_ID}::organism.${orgA}.minutes`);
    flagOrgB = await file('memory', `${other.name}@${NODE_ID}::organism.${orgB}.notes`);
    flagAgent = await file('agent', adminAgent.gaii);
});

console.log('\nPhase 1 — input, existence and credential');

await test('An invalid status is 400 VALIDATION_ERROR, including the old "reviewed"', async () => {
    for (const status of ['reviewed', 'deleted', '', null]) {
        const r = await review(flagOrgA1, status, operator.token);
        assert(r.status === 400 && r.body.error?.code === 'VALIDATION_ERROR', `status ${JSON.stringify(status)}: ${r.status} ${short(r.body)}`);
    }
});

await test('An unknown flag id is 404', async () => {
    const r = await review('flag-does-not-exist', 'dismissed', operator.token);
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `${r.status} ${short(r.body)}`);
});

await test('No credential is 401', async () => {
    const r = await review(flagOrgA1, 'dismissed');
    assert(r.status === 401, `${r.status} ${short(r.body)}`);
});

await test('GET /v1/flags is refused to a plain owner (403) and served to the operator', async () => {
    const plain = await json('/v1/flags', { token: other.token });
    assert(plain.status === 403, `plain owner listed flags: ${plain.status} ${short(plain.body)}`);
    const op = await json('/v1/flags?per_page=100', { token: operator.token });
    assert(op.status === 200 && Array.isArray(op.body.data), `operator list: ${op.status} ${short(op.body)}`);
});

console.log('\nPhase 2 — who is refused');

await test('A plain owner is refused (403), and the flag is still open', async () => {
    const r = await review(flagOrgA1, 'dismissed', other.token);
    assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `${r.status} ${short(r.body)}`);
    const f = await flagState(flagOrgA1);
    assert(f && f.status !== 'dismissed' && !f.reviewedBy, `the flag changed: ${short(f)}`);
});

await test('The reporter cannot review the flag they filed (403)', async () => {
    const r = await review(flagOrgA1, 'actioned', reporter.token);
    assert(r.status === 403, `${r.status} ${short(r.body)}`);
});

await test('The organism admin\'s own agent is refused on the organism\'s flag (403), holding social:write and memory:*', async () => {
    const r = await review(flagOrgA1, 'dismissed', adminAgent.token);
    assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `the admin's agent moderated in the admin's name: ${r.status} ${short(r.body)}`);
    const f = await flagState(flagOrgA1);
    assert(f && f.status !== 'dismissed' && !f.reviewedBy, `the flag changed: ${short(f)}`);
});

console.log('\nPhase 3 — the organism admin in person');

await test('The organism admin dismisses a flag on their organism\'s memory; reviewedBy names them', async () => {
    const r = await review(flagOrgA1, 'dismissed', admin.token);
    assert(r.status === 200 && r.body.data?.status === 'dismissed', `organism admin review: ${r.status} ${short(r.body)}`);
    const f = await flagState(flagOrgA1);
    assert(f?.status === 'dismissed' && f.reviewedBy === admin.name, `read back: ${short(f)}`);
});

await test('The organism admin is refused on another organism\'s flag (403)', async () => {
    const r = await review(flagOrgB, 'dismissed', admin.token);
    assert(r.status === 403, `admin of A reviewed a flag of B: ${r.status} ${short(r.body)}`);
    const f = await flagState(flagOrgB);
    assert(f && f.status !== 'dismissed', `the flag of B changed: ${short(f)}`);
});

await test('The organism admin is refused on a flag outside any organism (403)', async () => {
    const r = await review(flagAgent, 'dismissed', admin.token);
    assert(r.status === 403, `admin reviewed a non-organism flag: ${r.status} ${short(r.body)}`);
});

console.log('\nPhase 4 — the operator');

await test('The operator actions a flag on another organism and dismisses one outside any organism', async () => {
    const a = await review(flagOrgB, 'actioned', operator.token);
    assert(a.status === 200 && a.body.data?.status === 'actioned', `actioned: ${a.status} ${short(a.body)}`);
    const d = await review(flagAgent, 'dismissed', operator.token);
    assert(d.status === 200 && d.body.data?.status === 'dismissed', `dismissed: ${d.status} ${short(d.body)}`);
    const f = await flagState(flagOrgB);
    assert(f?.status === 'actioned' && f.reviewedBy === operator.name, `read back: ${short(f)}`);
});

await test('The operator\'s agent holding operator:admin reviews a flag; one without the word is refused', async () => {
    const withWord = await makeAgent(BASE, operator, ['operator:admin', 'social:write']);
    const without = await makeAgent(BASE, operator, ['social:write', 'memory:*']);
    const refused = await review(flagOrgA2, 'actioned', without.token);
    assert(refused.status === 403, `operator's agent without operator:admin: ${refused.status} ${short(refused.body)}`);
    const ok = await review(flagOrgA2, 'actioned', withWord.token);
    assert(ok.status === 200 && ok.body.data?.status === 'actioned', `operator's agent with operator:admin: ${ok.status} ${short(ok.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

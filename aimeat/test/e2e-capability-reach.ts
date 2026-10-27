/**
 * @file test/e2e-capability-reach.ts
 * @description E2E for who reaches one capability by its id (secaudit2026oct22; developer decision
 *   2026-10-26).
 *
 *   WHAT THIS PROVES. A capability that is not yet active (draft, waiting for review, rejected) is
 *   served by GET /v1/capabilities/:id, POST /v1/capabilities/:id/invoke and the MCP tools
 *   aimeat_capabilities_get and aimeat_capabilities_invoke to its owner, the owner's agents and the
 *   operator only. Another account gets the 404 a missing id gets.
 *
 *   AND WHAT STAYS. The owner reads and invokes the own draft, the owner's agent does too, and an
 *   active capability open to others ('owner' or 'public') is reached by another account as before.
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capability-reach
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const suffix = Math.random().toString(36).slice(2, 8);
const ownerName = `capreach-a-${suffix}`;
const otherName = `capreach-b-${suffix}`;
const operatorName = `capreach-op-${suffix}`;
const draftId = `capreach-draft-${suffix}`;
const publicId = `capreach-public-${suffix}`;
let owner = { name: ownerName, token: '' };
let other = { name: otherName, token: '' };
let operator = { name: operatorName, token: '' };
let ownerAgent: McpSession | null = null;
let otherAgent: McpSession | null = null;
let ownerAgentToken = '';

/** A capability the 'owner' word opens to every signed-in account once it is active; created as a draft. */
function draftBody(id: string, extra: Record<string, unknown> = {}) {
    return {
        id, name: `Reach ${id}`, summary: 'capability reach fixture', visibility: 'owner',
        callable: false, usage: 'not callable; the answer to invoke is its usage', ...extra,
    };
}

const invoke = (id: string, token: string) => json(`/v1/capabilities/${id}/invoke`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ input: {} }),
});

console.log('\n=== Capability reach by id ===\n');

await test('Setup: two owners, an operator, an agent of each owner', async () => {
    owner.token = (await registerOwner(BASE, ownerName)).token;
    other.token = (await registerOwner(BASE, otherName)).token;
    operator.token = (await setupOperator(BASE, ADMIN_PW, operatorName)).token;
    const a = await makeAgent(BASE, owner, ['work:request', 'capability:write']);
    ownerAgentToken = a.token;
    ownerAgent = await openSession(BASE, a.token, 'capreach-owner-agent');
    const b = await makeAgent(BASE, other, ['work:request', 'capability:write']);
    otherAgent = await openSession(BASE, b.token, 'capreach-other-agent');
    const made = await json('/v1/capabilities', { method: 'POST', headers: auth(owner.token), body: JSON.stringify(draftBody(draftId)) });
    assert(made.status === 201 && made.body.data?.status === 'draft', `the owner's draft: ${made.status} ${JSON.stringify(made.body.error ?? made.body.data?.status)}`);
});

console.log('A draft');

await test('another account reads the draft by id: 404 NOT_FOUND, as for a missing id', async () => {
    const got = await json(`/v1/capabilities/${draftId}`, { headers: auth(other.token) });
    assert(got.status === 404 && got.body.error?.code === 'NOT_FOUND', `another account read the draft: ${got.status}`);
    const anon = await json(`/v1/capabilities/${draftId}`);
    assert(anon.status === 404, `an anonymous reader read the draft: ${anon.status}`);
});

await test('another account invokes the draft by id: 404 NOT_FOUND', async () => {
    const r = await invoke(draftId, other.token);
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `another account reached the draft: ${r.status} ${r.body.error?.code}`);
});

await test('another account\'s agent gets "not found" from aimeat_capabilities_get and _invoke', async () => {
    const got = await callTool(otherAgent!, 'aimeat_capabilities_get', { id: draftId });
    assert(got.isError && /not found/i.test(got.text), `the MCP read served the draft: ${got.text.slice(0, 200)}`);
    const inv = await callTool(otherAgent!, 'aimeat_capabilities_invoke', { id: draftId, input: {} });
    assert(inv.isError && /not found/i.test(inv.text), `the MCP invoke reached the draft: ${inv.text.slice(0, 200)}`);
});

await test('the owner reads and invokes the own draft', async () => {
    const got = await json(`/v1/capabilities/${draftId}`, { headers: auth(owner.token) });
    assert(got.status === 200 && got.body.data?.id === draftId, `owner read: ${got.status}`);
    const r = await invoke(draftId, owner.token);
    assert(r.status === 400 && r.body.error?.code === 'NOT_CALLABLE', `owner invoke reached the capability: ${r.status} ${r.body.error?.code}`);
});

await test('the owner\'s agent reads and invokes the owner\'s draft, over REST and MCP', async () => {
    const got = await json(`/v1/capabilities/${draftId}`, { headers: auth(ownerAgentToken) });
    assert(got.status === 200 && got.body.data?.id === draftId, `agent REST read: ${got.status}`);
    const r = await invoke(draftId, ownerAgentToken);
    assert(r.status === 400 && r.body.error?.code === 'NOT_CALLABLE', `agent REST invoke: ${r.status} ${r.body.error?.code}`);
    const mcp = await callTool(ownerAgent!, 'aimeat_capabilities_get', { id: draftId });
    assert(!mcp.isError && mcp.data?.id === draftId, `agent MCP read: ${mcp.text.slice(0, 200)}`);
    const inv = await callTool(ownerAgent!, 'aimeat_capabilities_invoke', { id: draftId, input: {} });
    assert(inv.isError && /not directly callable/i.test(inv.text), `agent MCP invoke reached it: ${inv.text.slice(0, 200)}`);
});

await test('the operator reads the draft', async () => {
    const got = await json(`/v1/capabilities/${draftId}`, { headers: auth(operator.token) });
    assert(got.status === 200 && got.body.data?.id === draftId, `operator read: ${got.status}`);
});

console.log('Active capabilities');

await test('once the owner publishes it, another account reads and invokes it as before', async () => {
    const put = await json(`/v1/capabilities/${draftId}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ status: 'active' }) });
    assert(put.status === 200 && put.body.data?.status === 'active', `publish: ${put.status} ${put.body.data?.status}`);
    const got = await json(`/v1/capabilities/${draftId}`, { headers: auth(other.token) });
    assert(got.status === 200, `another account read the active capability: ${got.status}`);
    const r = await invoke(draftId, other.token);
    assert(r.status === 400 && r.body.error?.code === 'NOT_CALLABLE', `another account invoke: ${r.status} ${r.body.error?.code}`);
    const mcp = await callTool(otherAgent!, 'aimeat_capabilities_get', { id: draftId });
    assert(!mcp.isError && mcp.data?.id === draftId, `another agent MCP read: ${mcp.text.slice(0, 200)}`);
});

await test('an active public capability is reached by everyone', async () => {
    const made = await json('/v1/capabilities', {
        method: 'POST', headers: auth(operator.token),
        body: JSON.stringify(draftBody(publicId, { visibility: 'public', status: 'active' })),
    });
    assert(made.status === 201 && made.body.data?.status === 'active', `operator's public capability: ${made.status} ${JSON.stringify(made.body.error)}`);
    const anon = await json(`/v1/capabilities/${publicId}`);
    assert(anon.status === 200, `anonymous read: ${anon.status}`);
    const got = await json(`/v1/capabilities/${publicId}`, { headers: auth(other.token) });
    assert(got.status === 200, `another account read: ${got.status}`);
    const r = await invoke(publicId, other.token);
    assert(r.status === 400 && r.body.error?.code === 'NOT_CALLABLE', `another account invoke: ${r.status} ${r.body.error?.code}`);
});

await test('Cleanup', async () => {
    await json(`/v1/capabilities/${draftId}`, { method: 'DELETE', headers: auth(owner.token) });
    await json(`/v1/capabilities/${publicId}`, { method: 'DELETE', headers: auth(operator.token) });
    for (const p of [owner, other, operator]) {
        await json(`/v1/owners/${p.name}`, { method: 'DELETE', headers: auth(p.token) });
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

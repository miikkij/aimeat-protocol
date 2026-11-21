/**
 * @file e2e-workspace-write-role.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace record space's `writeRole` holds on every write path, on memory-backed and
 *   row-backed spaces alike: `owner` is the workspace's creator or an organism admin, `admin` is an
 *   organism admin, and `member` (or none) is every member the workspace's other rules admit.
 *
 *   Ruled by the developer on 2026-11-21 (decision-writerole-on-memory-record-spaces-who-is-owner-and-how-it-is).
 *   Before it, only the row service read writeRole, and there `owner` was the organism's creator alone;
 *   a member with a contributor grant wrote a memory space marked `owner` or `admin` through every
 *   record path.
 *
 *   The people: alice creates the organism and the workspace, bob is a plain member with a contributor
 *   grant (so writeRole is the only rule that can refuse him), carol is an organism admin. bob's agent
 *   and alice's agent act with their owners' standing.
 *
 *   The boot step that holds the spaces members already wrote into is tested with the real store in
 *   test/unit/workspace-write-role-hold.test.ts: a shared E2E node runs its boot steps before any suite
 *   writes data.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-write-role

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

console.log('\n=== Workspace writeRole E2E ===\n');

const STAMP = Date.now().toString(36);
const AGENT_SCOPES = ['memory:read', 'memory:write', 'organism:read', 'organism:write', 'organism:rows'];
const NS_OWNER = 'shared.charter';
const NS_ADMIN = 'shared.budget';
const NS_MEMBER = 'shared.notes';
const NS_ROWS = 'books.ledger';

let alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let aliceAgent!: McpSession, bobAgent!: McpSession;
let bobAgentToken = '';
let orgId = '';
let ws = '';
let bobWs = '';

const key = (space: string, id: string, w = ws) => `organism.${orgId}.w.${w}.${space}.${id}.draft`;
const publish = (token: string, namespace: string, id: string, w = ws) =>
    post(`/v1/organisms/${orgId}/workspace/records/publish`, token, { ws: w, namespace, records: [{ id, value: { id, title: `by test ${id}` } }] });
const appendRow = (token: string, rowId: string) =>
    post(`/v1/organisms/${orgId}/workspace/rows/ledger?ws=${ws}`, token, { row_id: rowId, body: { account: 'a-1', amount: 1 } });

/** The refusal of the writeRole rule over REST: 403 ACCESS_DENIED whose message names the space and its writeRole. */
function assertWriteRoleRefused(r: { status: number; body: any }, space: string, role: string, what: string) {
    const msg = String(r.body?.error?.message ?? '');
    assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED' && msg.includes(`"${space}"`) && msg.includes(`writeRole "${role}"`),
        `${what}: expected 403 ACCESS_DENIED naming "${space}" and writeRole "${role}", got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
}
/** The same refusal from an MCP tool. Some tools answer a JSON object, where the quotes come escaped. */
function assertToolRefused(r: { isError: boolean; text: string }, space: string, role: string, what: string) {
    const text = r.text.replace(/\\"/g, '"');
    assert(r.isError && text.includes('ACCESS_DENIED') && text.includes(`"${space}"`) && text.includes(`writeRole "${role}"`),
        `${what}: expected a tool refusal naming "${space}" and writeRole "${role}", got ${r.text.slice(0, 600)}`);
}
/** A batch publish and a row append both answer 200 when they wrote. */
function assertWritten(r: { status: number; body: any }, what: string) {
    assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 300)}`);
}

await test('Setup: alice, bob and carol; an organism; a workspace with owner, admin, member and row spaces', async () => {
    alice = await registerOwner(BASE, `wra${STAMP}`);
    bob = await registerOwner(BASE, `wrb${STAMP}`);
    carol = await registerOwner(BASE, `wrc${STAMP}`);
    const o = await post('/v1/organisms', alice.token, { name: 'Write Role Org', description: 'x', type: 'project', join_policy: 'invite', visibility: 'private' });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    for (const who of [bob, carol]) {
        const add = await post(`/v1/organisms/${orgId}/members`, alice.token, { ghii: who.name });
        assert(add.status === 201, `add ${who.name}: ${add.status} ${JSON.stringify(add.body?.error)}`);
    }
    const promoted = await post(`/v1/organisms/${orgId}/admins`, alice.token, { target_ghii: carol.name });
    assert(promoted.status === 200, `carol promoted ${promoted.status}: ${JSON.stringify(promoted.body?.error)}`);
    const space = (name: string, namespace: string, writeRole: string, extra: Record<string, unknown> = {}) =>
        ({ name, schemaRef: `schema:${name}@1`, namespace, backing: 'memory', writeRole, mode: 'records', ...extra });
    const w = await post(`/v1/organisms/${orgId}/workspaces`, alice.token, {
        name: 'Charter', manifest: { objectTypes: [
            space('charter', NS_OWNER, 'owner'),
            space('budget', NS_ADMIN, 'admin'),
            space('note', NS_MEMBER, 'member'),
            { name: 'ledger', schemaRef: 'schema:ledger@1', namespace: NS_ROWS, backing: 'rows', writeRole: 'owner', indexOn: ['account'] },
        ] },
    });
    assert(w.status === 201, `workspace ${w.status}: ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    // bob holds the contributor grant, so the workspace role admits him and writeRole is what decides.
    const g = await post(`/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws, grantee: bob.name, role: 'contributor' });
    assert(g.status === 200, `contributor grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    const aAgent = await makeAgent(BASE, alice, AGENT_SCOPES);
    aliceAgent = await openSession(BASE, aAgent.token, 'wr-alice');
    const bAgent = await makeAgent(BASE, bob, AGENT_SCOPES);
    bobAgentToken = bAgent.token;
    bobAgent = await openSession(BASE, bAgent.token, 'wr-bob');
});

// ── An owner space: the workspace's creator or an organism admin. ──

await test('Refused: bob publishes into the owner space over REST', async () => {
    assertWriteRoleRefused(await publish(bob.token, NS_OWNER, 'c-bob'), 'charter', 'owner', 'REST batch publish');
});

await test('Refused: bob writes the owner space with POST /v1/memory, in person and through his agent', async () => {
    const body = JSON.stringify({ key: key(NS_OWNER, 'c-mem'), value: { id: 'c-mem', title: 'x' }, visibility: 'private' });
    assertWriteRoleRefused(await json('/v1/memory', { method: 'POST', headers: auth(bob.token), body }), 'charter', 'owner', 'POST /v1/memory in person');
    assertWriteRoleRefused(await json('/v1/memory', { method: 'POST', headers: auth(bobAgentToken), body }), 'charter', 'owner', 'POST /v1/memory by his agent');
});

await test('Refused: bob\'s agent over MCP aimeat_workspace_write and aimeat_memory_write', async () => {
    assertToolRefused(await callTool(bobAgent, 'aimeat_workspace_write', { organism_id: orgId, ws, space: 'charter', id: 'c-mcp', value: { id: 'c-mcp', title: 'x' } }),
        'charter', 'owner', 'aimeat_workspace_write');
    assertToolRefused(await callTool(bobAgent, 'aimeat_memory_write', { key: key(NS_OWNER, 'c-mcp2'), value: { id: 'c-mcp2', title: 'x' } }),
        'charter', 'owner', 'aimeat_memory_write');
});

await test('Allowed: alice in person publishes and her agent writes a draft in the owner space', async () => {
    assertWritten(await publish(alice.token, NS_OWNER, 'c-alice'), 'alice REST publish');
    const r = await callTool(aliceAgent, 'aimeat_workspace_write', { organism_id: orgId, ws, space: 'charter', id: 'c-alice-agent', value: { id: 'c-alice-agent', title: 'x' } });
    assert(!r.isError, `alice's agent: ${r.text.slice(0, 300)}`);
});

await test('Allowed: carol, an organism admin, publishes into the owner space and the admin space', async () => {
    assertWritten(await publish(carol.token, NS_OWNER, 'c-carol'), 'carol owner space');
    assertWritten(await publish(carol.token, NS_ADMIN, 'b-carol'), 'carol admin space');
});

// ── An admin space: an organism admin. ──

await test('Refused: bob publishes into the admin space, and his agent writes its draft', async () => {
    assertWriteRoleRefused(await publish(bob.token, NS_ADMIN, 'b-bob'), 'budget', 'admin', 'REST batch publish');
    assertToolRefused(await callTool(bobAgent, 'aimeat_workspace_write', { organism_id: orgId, ws, space: 'budget', id: 'b-mcp', value: { id: 'b-mcp', title: 'x' } }),
        'budget', 'admin', 'aimeat_workspace_write');
});

// ── A member space stays as it was. ──

await test('Guard: bob publishes into the member space and his agent writes its draft, as before', async () => {
    assertWritten(await publish(bob.token, NS_MEMBER, 'n-bob'), 'bob member space');
    const r = await callTool(bobAgent, 'aimeat_workspace_write', { organism_id: orgId, ws, space: 'note', id: 'n-mcp', value: { id: 'n-mcp', title: 'x' } });
    assert(!r.isError, `bob's agent on the member space: ${r.text.slice(0, 300)}`);
});

// ── The same rule on a row space: owner is the workspace's creator or an organism admin. ──

await test('Row space marked owner: alice and carol append, bob is refused', async () => {
    assertWritten(await appendRow(alice.token, 'r-alice'), 'alice row');
    assertWritten(await appendRow(carol.token, 'r-carol'), 'carol row (an admin who is not the organism\'s creator)');
    const r = await appendRow(bob.token, 'r-bob');
    assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED', `bob row: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

// ── owner means the WORKSPACE's creator: a plain member's own workspace. ──

await test('A workspace bob created: bob writes its owner space, carol too, and alice as the organism\'s creator', async () => {
    const w = await post(`/v1/organisms/${orgId}/workspaces`, bob.token, {
        name: 'Bob Own', manifest: { objectTypes: [{ name: 'plan', schemaRef: 'schema:plan@1', namespace: 'shared.plan', backing: 'memory', writeRole: 'owner', mode: 'records' }] },
    });
    assert(w.status === 201, `bob's workspace ${w.status}: ${JSON.stringify(w.body?.error)}`);
    bobWs = w.body.data.ws;
    assertWritten(await publish(bob.token, 'shared.plan', 'p-bob', bobWs), 'bob, the workspace creator');
    for (const who of [carol, alice]) {
        const g = await post(`/v1/organisms/${orgId}/workspace-access/grant`, bob.token, { ws: bobWs, grantee: who.name, role: 'contributor' });
        assert(g.status === 200, `grant ${who.name} ${g.status}: ${JSON.stringify(g.body?.error)}`);
    }
    assertWritten(await publish(carol.token, 'shared.plan', 'p-carol', bobWs), 'carol, an organism admin');
    assertWritten(await publish(alice.token, 'shared.plan', 'p-alice', bobWs), 'alice, the organism creator');
});

await test('Edge: the refusal wrote nothing: bob\'s refused record is absent from the owner space', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${ws}&space=charter&ids=c-bob,c-mcp,c-alice,c-carol`, { headers: auth(alice.token) });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = (r.body.data.items as any[]).map(i => i.id);
    assert(!ids.includes('c-bob') && !ids.includes('c-mcp') && ids.includes('c-alice') && ids.includes('c-carol'), `ids: ${JSON.stringify(ids)}`);
});

await test('Cleanup', async () => {
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(alice.token) });
    for (const who of [alice, bob, carol]) if (who) await json(`/v1/owners/${who.name}`, { method: 'DELETE', headers: auth(who.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-mcp-owner-only-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent, one answer, on the node MCP and on the REST route, for the tools whose route
 *   used to be owner-only while the node MCP offered the tool to an agent holding its word.
 *
 *   WHY THIS SUITE EXISTS. The connector MCP and /local/call (what `aimeat connect serve` offers a fleet
 *   agent) proxy the REST route; the node MCP calls the service directly. For contacts, capabilities,
 *   sharing groups, the payout status, the AI budget and an agent's scope list the route answered
 *   requireRole('owner') and refused every agent token, while the node MCP let the same agent do the
 *   same thing, so the agent's power depended on the endpoint it was connected to. And in the other
 *   direction: removing the payment secret is the owner's act in person (decision D5), which REST
 *   held and the node MCP did not. Each tool below now gives ONE answer, and this suite pins it on
 *   both surfaces with the same agent:
 *     - aimeat_contact_add / _remove           messages:send   both allow (fixed 2026-10-15, verified here)
 *     - aimeat_capabilities_create/_update/_delete  capability:write  both allow, on the agent's own rows
 *     - aimeat_capabilities_vouch              capability:write  both allow (the tool now declares the word)
 *     - aimeat_group_create/_add_member/_remove_member  consent:groups  both allow, on the owner's groups
 *     - aimeat_commerce_psp_status             commerce:sell   both allow (a read; the key is a hint)
 *     - aimeat_commerce_psp_delete             commerce:psp    both REFUSE an agent (screen only)
 *     - aimeat_operator_ai_config              memory:write-reserved + memory:write-as-owner  both allow
 *     - aimeat_operator_agent_configure scopes agent:permissions + agent:write  both allow narrowing, both
 *       refuse widening
 *   Every case also has the refusal that matters: an agent without the word (the tool is not offered
 *   on the node MCP; the route answers 403), and where an object has an owner, another owner's object.
 * @structure
 *   - Phase 1: fixtures (the operator, alice with four agents, bob)
 *   - Phase 2: contacts · Phase 3: capabilities · Phase 4: sharing groups
 *   - Phase 5: payout status and the payment secret · Phase 6: the AI budget · Phase 7: scope narrowing
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-owner-only-parity
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D2-02).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

/** One REST call with a bearer token; retries a 429, which is not what this suite tests. */
async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
        return { status: res.status, body: parsed };
    }
}

const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const stamp = Date.now().toString(36).slice(-6);

console.log('\n=== Owner-only routes and their MCP tools: one answer per agent (QA audit D2-02) ===\n');

// ── Phase 1: fixtures ─────────────────────────────────────────────────────────────────────────────
// The first owner registered on the node is its operator; alice and bob are plain owners, so no
// operator exemption hides a refusal.
let operator: RegisteredOwner;
let alice: RegisteredOwner;
let bob: RegisteredOwner;
/** Holds every word the tools below declare. */
let worker: McpAgent;
/** Holds none of them. */
let bare: McpAgent;
/** Holds memory:write-reserved but not memory:write-as-owner. */
let half: McpAgent;
/** The sibling whose permissions the worker narrows. */
let sibling: McpAgent;
let workerMcp: McpSession;
let bareMcp: McpSession;
let halfMcp: McpSession;

const WORKER_SCOPES = [
    'memory:read', 'messages:send', 'contacts:read', 'capability:write', 'consent:groups',
    'commerce:sell', 'commerce:psp', 'memory:write-reserved', 'memory:write-as-owner',
    'agent:permissions', 'agent:write',
];

await test('Phase 1: the operator, alice with four agents, bob', async () => {
    operator = await registerOwner(BASE, `oppar${stamp}`);
    alice = await registerOwner(BASE, `alpar${stamp}`);
    bob = await registerOwner(BASE, `bopar${stamp}`);
    worker = await makeAgent(BASE, alice, WORKER_SCOPES, `wk${stamp}`);
    bare = await makeAgent(BASE, alice, ['memory:read'], `br${stamp}`);
    half = await makeAgent(BASE, alice, ['memory:read', 'memory:write-reserved'], `hf${stamp}`);
    sibling = await makeAgent(BASE, alice, ['memory:read', 'memory:write', 'task:read'], `sb${stamp}`);
    workerMcp = await openSession(BASE, worker.token, 'parity-worker');
    bareMcp = await openSession(BASE, bare.token, 'parity-bare');
    halfMcp = await openSession(BASE, half.token, 'parity-half');
});

// ── Phase 2: contacts (the fix of 2026-10-15, held on both surfaces) ──────────────────────────────
const bookOf = async (owner: RegisteredOwner): Promise<any[]> => {
    const r = await rest('GET', '/v1/contacts', owner.token);
    assert(r.status === 200, `the owner's book: ${r.status} ${short(r.body.error)}`);
    return r.body.data.contacts as any[];
};
const savedIn = (rows: any[], id: string): boolean => rows.some((c) => c.contact_id === id && c.origin === 'saved');
let bobContact = '';
let operatorContact = '';

await test('2a. contact add: the agent holding messages:send saves into the OWNER\'s book on the node MCP and on REST', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_contact_add', { contact_id: bob.name });
    assert(!mcp.isError && mcp.data.status === 'saved' && typeof mcp.data.contact_id === 'string', `node MCP: ${mcp.text.slice(0, 300)}`);
    bobContact = mcp.data.contact_id;
    const viaRest = await rest('POST', '/v1/contacts', worker.token, { contact_id: operator.name });
    assert(viaRest.status === 201, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    operatorContact = viaRest.body.data.contact_id;
    const book = await bookOf(alice);
    assert(savedIn(book, bobContact) && savedIn(book, operatorContact), `both contacts in alice's book: ${short(book.map((c) => [c.contact_id, c.origin]))}`);
});

await test('2b. contact remove: the same agent removes on both surfaces', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_contact_remove', { contact_id: bobContact });
    assert(!mcp.isError, `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('DELETE', `/v1/contacts/${encodeURIComponent(operatorContact)}`, worker.token);
    assert(viaRest.status === 200, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    const book = await bookOf(alice);
    assert(!savedIn(book, bobContact) && !savedIn(book, operatorContact), `both gone from the book: ${short(book.map((c) => [c.contact_id, c.origin]))}`);
});

await test('2c. contact add/remove: an agent without messages:send is refused on both surfaces', async () => {
    const add = await callTool(bareMcp, 'aimeat_contact_add', { contact_id: bob.name });
    assert(add.isError && !add.offered, `node MCP add must not be offered: ${add.text.slice(0, 200)}`);
    const remove = await callTool(bareMcp, 'aimeat_contact_remove', { contact_id: bobContact });
    assert(remove.isError && !remove.offered, `node MCP remove must not be offered: ${remove.text.slice(0, 200)}`);
    const viaRest = await rest('POST', '/v1/contacts', bare.token, { contact_id: bob.name });
    assert(viaRest.status === 403, `REST add: ${viaRest.status}`);
    const del = await rest('DELETE', `/v1/contacts/${encodeURIComponent(bobContact)}`, bare.token);
    assert(del.status === 403, `REST remove: ${del.status}`);
    assert(!savedIn(await bookOf(alice), bobContact), 'the refused save landed');
});

// ── Phase 3: capabilities ─────────────────────────────────────────────────────────────────────────
let capMcp = '';
let capRest = '';
let bobCap = '';

await test('3a. capabilities create: the agent holding capability:write creates on both surfaces, under its own GAII', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_capabilities_create', { name: `parity-mcp-${stamp}`, summary: 'made over the node MCP', visibility: 'private' });
    assert(!mcp.isError && typeof mcp.data.id === 'string', `node MCP: ${mcp.text.slice(0, 300)}`);
    assert(mcp.data.ownerGhii === worker.gaii, `node MCP owner: ${mcp.data.ownerGhii}`);
    capMcp = mcp.data.id;
    const viaRest = await rest('POST', '/v1/capabilities', worker.token, { name: `parity-rest-${stamp}`, summary: 'made over REST', visibility: 'private' });
    assert(viaRest.status === 201, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    assert(viaRest.body.data.ownerGhii === worker.gaii, `REST owner: ${viaRest.body.data.ownerGhii}`);
    capRest = viaRest.body.data.id;
    const made = await rest('POST', '/v1/capabilities', bob.token, { name: `parity-bob-${stamp}`, summary: 'bob\'s own', visibility: 'private' });
    assert(made.status === 201, `bob's capability: ${made.status} ${short(made.body.error)}`);
    bobCap = made.body.data.id;
});

await test('3b. capabilities create: an agent without capability:write is refused on both surfaces', async () => {
    const mcp = await callTool(bareMcp, 'aimeat_capabilities_create', { name: `parity-bare-${stamp}`, summary: 'refused' });
    assert(mcp.isError && !mcp.offered, `node MCP must not offer it: ${mcp.text.slice(0, 200)}`);
    const viaRest = await rest('POST', '/v1/capabilities', bare.token, { name: `parity-bare-${stamp}`, summary: 'refused', visibility: 'private' });
    assert(viaRest.status === 403, `REST: ${viaRest.status} ${short(viaRest.body)}`);
});

await test('3c. capabilities update: the agent updates its own on both surfaces, and bob\'s on neither', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_capabilities_update', { id: capMcp, summary: 'updated over MCP' });
    assert(!mcp.isError && mcp.data.summary === 'updated over MCP', `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('PUT', `/v1/capabilities/${encodeURIComponent(capRest)}`, worker.token, { summary: 'updated over REST' });
    assert(viaRest.status === 200 && viaRest.body.data.summary === 'updated over REST', `REST: ${viaRest.status} ${short(viaRest.body)}`);
    const mcpBob = await callTool(workerMcp, 'aimeat_capabilities_update', { id: bobCap, summary: 'rewritten by alice\'s agent' });
    assert(mcpBob.isError && mcpBob.text.includes('FORBIDDEN'), `node MCP on bob's: ${mcpBob.text.slice(0, 200)}`);
    const restBob = await rest('PUT', `/v1/capabilities/${encodeURIComponent(bobCap)}`, worker.token, { summary: 'rewritten by alice\'s agent' });
    assert(restBob.status === 403 && restBob.body.error?.code === 'FORBIDDEN', `REST on bob's: ${restBob.status} ${short(restBob.body.error)}`);
    const still = await rest('GET', `/v1/capabilities/${encodeURIComponent(bobCap)}`, bob.token);
    assert(still.status === 200 && still.body.data.summary === 'bob\'s own', `bob's capability changed: ${short(still.body.data)}`);
});

await test('3d. capabilities vouch: the agent vouches for bob\'s on both surfaces, in alice\'s name, and takes it back on REST', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_capabilities_vouch', { id: bobCap, comment: 'parity check' });
    assert(!mcp.isError && mcp.data.vouchCount === 1 && mcp.data.already === false, `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('POST', `/v1/capabilities/${encodeURIComponent(bobCap)}/vouch`, worker.token, {});
    assert(viaRest.status === 200 && viaRest.body.data.vouchCount === 1 && viaRest.body.data.already === true,
        `REST (one vouch per owner, so the second is the same vouch): ${viaRest.status} ${short(viaRest.body)}`);
    const back = await rest('DELETE', `/v1/capabilities/${encodeURIComponent(bobCap)}/vouch`, worker.token);
    assert(back.status === 200 && back.body.data.removed === true && back.body.data.vouchCount === 0, `REST unvouch: ${back.status} ${short(back.body)}`);
});

await test('3e. capabilities vouch: refused without capability:write on both surfaces, and for the agent\'s own on both', async () => {
    const mcp = await callTool(bareMcp, 'aimeat_capabilities_vouch', { id: bobCap });
    assert(mcp.isError && !mcp.offered, `node MCP must not offer it: ${mcp.text.slice(0, 200)}`);
    const viaRest = await rest('POST', `/v1/capabilities/${encodeURIComponent(bobCap)}/vouch`, bare.token, {});
    assert(viaRest.status === 403, `REST: ${viaRest.status}`);
    const ownMcp = await callTool(workerMcp, 'aimeat_capabilities_vouch', { id: capMcp });
    assert(ownMcp.isError && ownMcp.text.includes('CANNOT_VOUCH_OWN'), `node MCP own: ${ownMcp.text.slice(0, 200)}`);
    const ownRest = await rest('POST', `/v1/capabilities/${encodeURIComponent(capRest)}/vouch`, worker.token, {});
    assert(ownRest.status === 400 && ownRest.body.error?.code === 'CANNOT_VOUCH_OWN', `REST own: ${ownRest.status} ${short(ownRest.body.error)}`);
});

await test('3f. capabilities delete: the agent deletes its own on both surfaces, and bob\'s on neither', async () => {
    const mcpBob = await callTool(workerMcp, 'aimeat_capabilities_delete', { id: bobCap });
    assert(mcpBob.isError && mcpBob.text.includes('FORBIDDEN'), `node MCP on bob's: ${mcpBob.text.slice(0, 200)}`);
    const restBob = await rest('DELETE', `/v1/capabilities/${encodeURIComponent(bobCap)}`, worker.token);
    assert(restBob.status === 403, `REST on bob's: ${restBob.status}`);
    assert((await rest('GET', `/v1/capabilities/${encodeURIComponent(bobCap)}`, bob.token)).status === 200, 'bob\'s capability is gone');
    const mcp = await callTool(workerMcp, 'aimeat_capabilities_delete', { id: capMcp });
    assert(!mcp.isError && mcp.data.deleted === true, `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('DELETE', `/v1/capabilities/${encodeURIComponent(capRest)}`, worker.token);
    assert(viaRest.status === 200, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    for (const id of [capMcp, capRest]) {
        const gone = await rest('GET', `/v1/capabilities/${encodeURIComponent(id)}`, worker.token);
        assert(gone.status === 404, `${id} still there: ${gone.status}`);
    }
});

await test('3g. capabilities list: a public capability is listed, bob\'s private one is not, and a malformed filter is refused', async () => {
    const pub = await rest('POST', '/v1/capabilities', operator.token, { name: `parity-public-${stamp}`, summary: 'listed for everyone', visibility: 'public', status: 'active' });
    assert(pub.status === 201, `the operator's public capability: ${pub.status} ${short(pub.body.error)}`);
    const listed = await callTool(bareMcp, 'aimeat_capabilities_list', { search: `parity-public-${stamp}` });
    assert(!listed.isError && (listed.data.capabilities as any[]).some((c) => c.id === pub.body.data.id), `the public one: ${listed.text.slice(0, 300)}`);
    const hidden = await callTool(workerMcp, 'aimeat_capabilities_list', { search: `parity-bob-${stamp}` });
    assert(!hidden.isError && !(hidden.data.capabilities as any[]).some((c) => c.id === bobCap), `bob's private capability was listed: ${hidden.text.slice(0, 300)}`);
    const bad = await callTool(workerMcp, 'aimeat_capabilities_list', { callable: 'yes' });
    assert(bad.isError, `a filter of the wrong type must be refused: ${bad.text.slice(0, 200)}`);
});

// ── Phase 4: sharing groups ───────────────────────────────────────────────────────────────────────
let groupMcp = '';
let groupRest = '';
let bobGroup = '';

await test('4a. group create: the agent holding consent:groups creates on both surfaces, owned by alice\'s GHII', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_group_create', { name: `parity-mcp-${stamp}` });
    assert(!mcp.isError && mcp.data.created === true, `node MCP: ${mcp.text.slice(0, 300)}`);
    assert(mcp.data.group.owner_gaii === alice.ghii, `node MCP owner: ${mcp.data.group.owner_gaii}`);
    groupMcp = mcp.data.group.id;
    const viaRest = await rest('POST', '/v1/groups', worker.token, { name: `parity-rest-${stamp}` });
    assert(viaRest.status === 201, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    assert(viaRest.body.data.group.ownerGaii === alice.ghii, `REST owner: ${viaRest.body.data.group.ownerGaii}`);
    groupRest = viaRest.body.data.group.id;
    const made = await rest('POST', '/v1/groups', bob.token, { name: `parity-bob-${stamp}` });
    assert(made.status === 201, `bob's group: ${made.status}`);
    bobGroup = made.body.data.group.id;
});

await test('4b. group add member: on both surfaces for alice\'s groups, on neither for bob\'s', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_group_add_member', { group_id: groupMcp, identifier: bob.ghii, identifier_type: 'ghii' });
    assert(!mcp.isError && mcp.data.added === true, `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('POST', `/v1/groups/${groupRest}/members`, worker.token, { identifier: bob.ghii, identifier_type: 'ghii' });
    assert(viaRest.status === 201, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    const mcpBob = await callTool(workerMcp, 'aimeat_group_add_member', { group_id: bobGroup, identifier: operator.ghii, identifier_type: 'ghii' });
    assert(mcpBob.isError, `node MCP on bob's group: ${mcpBob.text.slice(0, 200)}`);
    const restBob = await rest('POST', `/v1/groups/${bobGroup}/members`, worker.token, { identifier: operator.ghii, identifier_type: 'ghii' });
    assert(restBob.status === 403, `REST on bob's group: ${restBob.status} ${short(restBob.body.error)}`);
    const bobs = await rest('GET', `/v1/groups/${bobGroup}`, bob.token);
    assert(!JSON.stringify(bobs.body.data).includes(operator.ghii), `a member landed in bob's group: ${short(bobs.body.data)}`);
});

await test('4c. group remove member: on both surfaces', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_group_remove_member', { group_id: groupMcp, identifier: bob.ghii });
    assert(!mcp.isError && mcp.data.removed === true, `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('DELETE', `/v1/groups/${groupRest}/members/${encodeURIComponent(bob.ghii)}`, worker.token);
    assert(viaRest.status === 200, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    for (const id of [groupMcp, groupRest]) {
        const g = await rest('GET', `/v1/groups/${id}`, alice.token);
        assert(g.status === 200 && !JSON.stringify(g.body.data).includes(bob.ghii), `bob is still in ${id}: ${short(g.body.data)}`);
    }
});

await test('4d. groups: an agent without consent:groups is refused create, add and remove on both surfaces', async () => {
    for (const [tool, args] of [
        ['aimeat_group_create', { name: `parity-bare-${stamp}` }],
        ['aimeat_group_add_member', { group_id: groupMcp, identifier: bob.ghii, identifier_type: 'ghii' }],
        ['aimeat_group_remove_member', { group_id: groupMcp, identifier: bob.ghii }],
    ] as const) {
        const r = await callTool(bareMcp, tool, args as Record<string, unknown>);
        assert(r.isError && !r.offered, `${tool} must not be offered: ${r.text.slice(0, 200)}`);
    }
    assert((await rest('POST', '/v1/groups', bare.token, { name: `parity-bare-${stamp}` })).status === 403, 'REST create');
    assert((await rest('POST', `/v1/groups/${groupRest}/members`, bare.token, { identifier: bob.ghii, identifier_type: 'ghii' })).status === 403, 'REST add');
    assert((await rest('DELETE', `/v1/groups/${groupRest}/members/${encodeURIComponent(bob.ghii)}`, bare.token)).status === 403, 'REST remove');
});

// ── Phase 5: payout status, and the payment secret (screen only) ──────────────────────────────────
await test('5a. psp status: the agent holding commerce:sell reads the owner\'s state on both surfaces', async () => {
    const before = await callTool(workerMcp, 'aimeat_commerce_psp_status', {});
    assert(!before.isError && before.data.configured === false, `node MCP before: ${before.text.slice(0, 300)}`);
    const restBefore = await rest('GET', '/v1/commerce/payout', worker.token);
    assert(restBefore.status === 200 && restBefore.body.data.stripe.configured === false, `REST before: ${restBefore.status} ${short(restBefore.body)}`);
    const set = await rest('PUT', '/v1/commerce/payout/stripe', alice.token, { secret_key: `sk_test_parity_${stamp}9876` });
    assert(set.status === 200, `alice sets her key: ${set.status} ${short(set.body.error)}`);
    const after = await callTool(workerMcp, 'aimeat_commerce_psp_status', {});
    assert(!after.isError && after.data.configured === true && String(after.data.key_hint).includes('9876'), `node MCP after: ${after.text.slice(0, 300)}`);
    assert(!after.text.includes(`sk_test_parity_${stamp}`), 'the node MCP answer carried the secret');
    const restAfter = await rest('GET', '/v1/commerce/payout', worker.token);
    assert(restAfter.status === 200 && restAfter.body.data.stripe.configured === true && String(restAfter.body.data.stripe.keyHint).includes('9876'),
        `REST after: ${short(restAfter.body.data?.stripe)}`);
    assert(!JSON.stringify(restAfter.body).includes(`sk_test_parity_${stamp}`), 'the REST answer carried the secret');
});

await test('5b. psp status: an agent without commerce:sell is refused on both surfaces', async () => {
    const mcp = await callTool(bareMcp, 'aimeat_commerce_psp_status', {});
    assert(mcp.isError && !mcp.offered, `node MCP must not offer it: ${mcp.text.slice(0, 200)}`);
    const viaRest = await rest('GET', '/v1/commerce/payout', bare.token);
    assert(viaRest.status === 403, `REST: ${viaRest.status}`);
});

await test('5c. psp delete: refused for an agent holding commerce:psp on both surfaces; the key stays, and alice removes it herself', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_commerce_psp_delete', {});
    assert(mcp.offered && mcp.isError && mcp.text.includes('SCREEN_ONLY') && mcp.text.includes('tab=wallet'), `node MCP: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('DELETE', '/v1/commerce/payout/stripe', worker.token);
    assert(viaRest.status === 403, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    const still = await rest('GET', '/v1/commerce/payout', alice.token);
    assert(still.body.data.stripe.configured === true, `the key was removed by a refused call: ${short(still.body.data.stripe)}`);
    const own = await rest('DELETE', '/v1/commerce/payout/stripe', alice.token);
    assert(own.status === 200 && own.body.data.configured === false, `alice's own removal: ${own.status} ${short(own.body)}`);
});

// ── Phase 6: the owner's AI budget ────────────────────────────────────────────────────────────────
const budgetOf = async (): Promise<unknown> => (await rest('GET', '/v1/ai/settings', alice.token)).body.data?.daily_budget_usd;

await test('6a. ai config: the agent holding memory:write-reserved and memory:write-as-owner sets alice\'s budget on both surfaces', async () => {
    const proposal = await callTool(workerMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 3 });
    assert(!proposal.isError && proposal.data.mode === 'proposal' && typeof proposal.data.confirm_token === 'string', `node MCP propose: ${proposal.text.slice(0, 300)}`);
    const applied = await callTool(workerMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 3, confirm_token: proposal.data.confirm_token });
    assert(!applied.isError && applied.data.mode === 'applied', `node MCP confirm: ${applied.text.slice(0, 300)}`);
    assert(await budgetOf() === 3, `alice's budget after MCP: ${await budgetOf()}`);
    const viaRest = await rest('POST', '/v1/ai/settings', worker.token, { daily_budget_usd: 4 });
    assert(viaRest.status === 200 && viaRest.body.data.saved === true, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    assert(await budgetOf() === 4, `alice's budget after REST: ${await budgetOf()}`);
    const agentsOwn = await rest('GET', '/v1/ai/settings', alice.token);
    assert(agentsOwn.status === 200, 'alice reads her settings');
});

await test('6b. ai config: refused without memory:write-as-owner (SCOPE_DENIED) and without memory:write-reserved, on both surfaces', async () => {
    const mcpHalf = await callTool(halfMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 9 });
    assert(mcpHalf.isError && mcpHalf.text.includes('SCOPE_DENIED'), `node MCP without write-as-owner: ${mcpHalf.text.slice(0, 300)}`);
    const restHalf = await rest('POST', '/v1/ai/settings', half.token, { daily_budget_usd: 9 });
    assert(restHalf.status === 403 && restHalf.body.error?.code === 'SCOPE_DENIED', `REST without write-as-owner: ${restHalf.status} ${short(restHalf.body.error)}`);
    const mcpBare = await callTool(bareMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 9 });
    assert(mcpBare.isError && !mcpBare.offered, `node MCP must not offer it without memory:write-reserved: ${mcpBare.text.slice(0, 200)}`);
    const restBare = await rest('POST', '/v1/ai/settings', bare.token, { daily_budget_usd: 9 });
    assert(restBare.status === 403, `REST without memory:write-reserved: ${restBare.status}`);
    assert(await budgetOf() === 4, `a refused call moved the budget: ${await budgetOf()}`);
});

// ── Phase 7: an agent narrows a sibling's permissions, and never widens them ─────────────────────
const scopesOf = async (agent: McpAgent): Promise<string[]> => {
    const r = await rest('GET', `/v1/agents?owner=${encodeURIComponent(alice.name)}`, alice.token);
    assert(r.status === 200, `alice's agents: ${r.status} ${short(r.body.error)}`);
    const row = (r.body.data.agents as any[]).find((a) => a.gaii === agent.gaii || a.name === agent.name);
    return (row?.default_scopes ?? []) as string[];
};

await test('7a. agent configure: the agent holding agent:permissions and agent:write narrows a sibling on both surfaces', async () => {
    const proposal = await callTool(workerMcp, 'aimeat_operator_agent_configure', { agent_name: sibling.name, scopes: ['memory:read', 'memory:write'] });
    assert(!proposal.isError && typeof proposal.data.confirm_token === 'string', `node MCP propose: ${proposal.text.slice(0, 300)}`);
    const applied = await callTool(workerMcp, 'aimeat_operator_agent_configure', { agent_name: sibling.name, scopes: ['memory:read', 'memory:write'], confirm_token: proposal.data.confirm_token });
    assert(!applied.isError && applied.data.mode === 'applied', `node MCP confirm: ${applied.text.slice(0, 300)}`);
    assert(JSON.stringify(await scopesOf(sibling)) === JSON.stringify(['memory:read', 'memory:write']), `after MCP: ${short(await scopesOf(sibling))}`);
    const viaRest = await rest('PATCH', `/v1/agents/${encodeURIComponent(sibling.name)}/scopes`, worker.token, { scopes: ['memory:read'] });
    assert(viaRest.status === 200, `REST: ${viaRest.status} ${short(viaRest.body.error)}`);
    assert(JSON.stringify(await scopesOf(sibling)) === JSON.stringify(['memory:read']), `after REST: ${short(await scopesOf(sibling))}`);
});

await test('7b. agent configure: widening is refused on both surfaces, an agent without the words is refused, and the owner may widen', async () => {
    const mcp = await callTool(workerMcp, 'aimeat_operator_agent_configure', { agent_name: sibling.name, scopes: ['memory:read', 'task:write'] });
    assert(mcp.isError && /Scope additions are not allowed/.test(mcp.text), `node MCP widening: ${mcp.text.slice(0, 300)}`);
    const viaRest = await rest('PATCH', `/v1/agents/${encodeURIComponent(sibling.name)}/scopes`, worker.token, { scopes: ['memory:read', 'task:write'] });
    assert(viaRest.status === 403 && viaRest.body.error?.code === 'SCOPE_ADDITION_REFUSED', `REST widening: ${viaRest.status} ${short(viaRest.body.error)}`);
    const mcpBare = await callTool(bareMcp, 'aimeat_operator_agent_configure', { agent_name: sibling.name, scopes: ['memory:read'] });
    assert(mcpBare.isError && !mcpBare.offered, `node MCP must not offer it: ${mcpBare.text.slice(0, 200)}`);
    const restBare = await rest('PATCH', `/v1/agents/${encodeURIComponent(sibling.name)}/scopes`, bare.token, { scopes: ['memory:read'] });
    assert(restBare.status === 403, `REST without the words: ${restBare.status}`);
    assert(JSON.stringify(await scopesOf(sibling)) === JSON.stringify(['memory:read']), `a refused call changed the list: ${short(await scopesOf(sibling))}`);
    const owner = await rest('PATCH', `/v1/agents/${encodeURIComponent(sibling.name)}/scopes`, alice.token, { scopes: ['memory:read', 'task:write'] });
    assert(owner.status === 200, `the owner widens in person: ${owner.status} ${short(owner.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

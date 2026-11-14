/**
 * @file test/e2e-tool-route-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for seven places where an MCP tool and the REST route beside it answered the same
 *   caller differently (structure programme 2026-11, unit 7). Each section holds the refused case and
 *   the designed use of the same path. WS-ROLE and GROUPS follow the developer's decision of
 *   2026-11-13 on the two differences that waited for it.
 *     APPROVALS  POST /v1/organisms/:id/approvals: a caller that is not the person in person does not
 *                choose who may resolve its request (approverRole), as it does not lower `risk`; the
 *                person's own word stands, and an agent following a flow gate takes the gate's role.
 *     DISCOVER   aimeat_discover decides with the session's permissions, as GET /v1/discover does,
 *                never with a longer list on the agent's record.
 *     ROSTER     aimeat_organism_members names no agent when the roster is hidden from the caller,
 *                as GET /v1/organisms/:id/members does; a caller who sees the roster sees the agents.
 *     BARRED     GET /v1/organisms?member=<self> leaves out, for an agent, an organism that does not
 *                admit it, as aimeat_organism_list does; the owner and an admitted agent see it.
 *     WS-ROLE    An agent attached to an organism, whose owner is an active member, acts with its
 *                owner's role on both surfaces: attaching never narrows an agent. An attached agent
 *                whose owner left manages nothing on either surface.
 *     GROUPS     An agent holding consent:groups sees its owner's sharing groups on both surfaces;
 *                without it, only the groups it is a member of. The owner in person as before.
 *     FILES      GET /v1/memory/files lists to an agent only the files its classification reader
 *                shows, as the download beside it and the MCP storage resource do.
 *   Unit 2b, phase B (each section red on the code it was written against, where the two disagree):
 *     BOARD-RES      the aimeat://boards/{id} resource gives a reader holding the board owner's
 *                    consent the posts GET /v1/boards/:id/posts and aimeat_board_read give it.
 *     JOIN-PRIVATE   a private organism answers an outside agent's join as not found on both
 *                    surfaces (developer decision 2026-11-14).
 *     BOARD-MEMBERS  an owner's agent holding social:members changes a shared board's reader list
 *                    (a question: REST takes the owner in person only, the tool admits the agent on
 *                    purpose).
 *     ORG-READ       who reads a private organism on GET /v1/organisms/:id, aimeat_organism_get and
 *                    the aimeat://organisms resource: one answer per caller.
 *     ROSTER-PRIVATE a private organism's member list is for its active members only, on all three
 *                    surfaces (developer decision 2026-11-14).
 *     ARCHIVED-LIST  an archived organism in the owner's own list, for the owner's agent.
 *     WS-UPDATE      an attached agent whose owner left changes a workspace's structure.
 *     MEMBER-LIST    the organisms a caller's owner is in: one answer on GET /v1/organisms?member=
 *                    and aimeat_organism_list for the owner's agent, another owner's agent and the
 *                    operator's agent.
 *   BOARD-MEMBERS asserts today's two answers and names the question.
 *   The operator (the suite's first account) turns classification on for the FILES section only and
 *   off again at its end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-tool-route-parity
 * @version-history
 *   v1.9.0 — 2026-11-14 — Unit 2b part 2, phase B, the other seventeen rows: B11, B13, B10, B9, B7 and
 *     B3 assert the rule both surfaces now share (operator pass and trail, fork gates, the anonymous
 *     own/building refusal, the account's escrow); B13b, B16, B17, B8, B12, B14, B15, B18, B2 and B4
 *     record today's two answers and name the open question; B5 shows the two lists agree. Two phase B
 *     owners, deleted at the end.
 *   v1.8.0 — 2026-11-14 — Unit 2b part 2, phase B: B6, aimeat_admin_agents against GET /v1/admin/agents
 *     with a negative limit, recorded as an open question.
 *   v1.7.0 — 2026-11-14 — MEMBER-LIST.
 *   v1.6.0 — 2026-11-14 — JOIN-PRIVATE asserts the developer's decision instead of today's answers.
 *   v1.5.0 — 2026-11-14 — ROSTER-PRIVATE asserts the developer's decision instead of today's answers.
 *   v1.4.0 — 2026-11-14 — ORG-READ, ROSTER-PRIVATE, ARCHIVED-LIST and WS-UPDATE; the question sections
 *     assert today's two answers (structure programme 2026-11, unit 2b, phase B).
 *   v1.3.0 — 2026-11-13 — BOARD-RES, JOIN-PRIVATE and BOARD-MEMBERS (structure programme 2026-11,
 *     unit 2b, phase B).
 *   v1.2.0 — 2026-11-13 — WS-ROLE asserts the decided rule instead of today's answer.
 *   v1.1.0 — 2026-11-13 — GROUPS asserts the decided rule instead of today's answer.
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 7).
 */
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';
import { makeAgent, openSession, callTool, mcpRpc, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
const stamp = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 300)}`;
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
const N = (s: string) => `u7${s}${stamp}`;

async function organism(token: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const o = await call('POST', '/v1/organisms', token, { name, type: 'project', join_policy: 'open', visibility: 'public', ...extra });
    assert(o.status === 201, `organism ${name}: ${show(o)}`);
    return o.body.data.organism.id as string;
}
async function join(token: string, orgId: string): Promise<void> {
    const j = await call('POST', `/v1/organisms/${orgId}/join`, token, {});
    assert(j.status === 200 || j.status === 201, `join: ${show(j)}`);
}

console.log('\n=== A tool and its route give one caller one answer (structure programme 2026-11, unit 7) ===\n');

await test('Setup: the operator, three owners', async () => {
    op = await setupOperator(BASE, ADMIN_PW, N('op'));
    alice = await registerOwner(BASE, N('alice'));
    bob = await registerOwner(BASE, N('bob'));
    carol = await registerOwner(BASE, N('carol'));
});

// ─── APPROVALS ───
console.log('\nAPPROVALS: who may resolve a request is not the requesting agent\'s word');

let apOrg = '', apWs = '';
let bobAgent!: McpAgent;
await test('Setup: alice\'s organism, bob and carol members, bob\'s workspace with two flow gates (member approvers, owner approvers)', async () => {
    apOrg = await organism(alice.token, `U7 approvals ${stamp}`);
    await join(bob.token, apOrg);
    await join(carol.token, apOrg);
    // Bob's own workspace: its manifest is his word in person, and his agent may read it.
    const w = await call('POST', `/v1/organisms/${apOrg}/workspaces`, bob.token, { name: 'Flow', manifest: {
        objectTypes: [{ name: 'note', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' }],
        flow: { stages: [{ id: 's', type: 'note' }], gates: [
            { id: 'gm', after: 's', rule: 'approve', approverRole: 'member' },
            { id: 'go', after: 's', rule: 'approve', approverRole: 'owner' },
        ], branches: [] },
    } });
    assert(w.status === 201, `workspace: ${show(w)}`);
    apWs = w.body.data.ws;
    bobAgent = await makeAgent(BASE, bob, ['*'], N('bobag'));
});

let agentAid = '';
await test('REFUSED: bob\'s agent asks that any member may resolve its request; the request needs the owner, and bob cannot resolve it', async () => {
    const r = await call('POST', `/v1/organisms/${apOrg}/approvals`, bobAgent.token, { action: N('notes'), rule: 'approve', approverRole: 'member' });
    assert(r.status === 201 && r.body.data.gated === true, `file: ${show(r)}`);
    agentAid = r.body.data.approval.id;
    assert(r.body.data.approval.approverRole === 'owner', `stored approverRole: ${r.body.data.approval.approverRole}`);
    const decide = await call('POST', `/v1/organisms/${apOrg}/approvals/${agentAid}`, bob.token, { decision: 'approve' });
    assert(decide.status === 403, `bob resolves his own agent's request: ${show(decide)}`);
});

await test('USE KEPT: the creator resolves the agent\'s request', async () => {
    const decide = await call('POST', `/v1/organisms/${apOrg}/approvals/${agentAid}`, alice.token, { decision: 'approve' });
    assert(decide.status === 200 && decide.body.data.approval.status === 'approved', `alice resolves: ${show(decide)}`);
});

await test('USE KEPT: bob in person asks for member approvers and gets them; carol resolves it', async () => {
    const r = await call('POST', `/v1/organisms/${apOrg}/approvals`, bob.token, { action: N('notes'), rule: 'approve', approverRole: 'member' });
    assert(r.status === 201 && r.body.data.approval.approverRole === 'member', `file in person: ${show(r)}`);
    const decide = await call('POST', `/v1/organisms/${apOrg}/approvals/${r.body.data.approval.id}`, carol.token, { decision: 'approve' });
    assert(decide.status === 200, `carol resolves: ${show(decide)}`);
});

await test('USE KEPT: bob\'s agent following the workspace flow gate that names member approvers gets member approvers', async () => {
    const r = await call('POST', `/v1/organisms/${apOrg}/approvals`, bobAgent.token, { action: N('advance'), rule: 'approve', flowGateId: 'gm', approverRole: 'member', arguments: { ws: apWs } });
    assert(r.status === 201 && r.body.data.approval.approverRole === 'member', `flow gate: ${show(r)}`);
});

await test('REFUSED: bob\'s agent naming a flow gate that needs the owner cannot ask for member approvers', async () => {
    const r = await call('POST', `/v1/organisms/${apOrg}/approvals`, bobAgent.token, { action: N('advance'), rule: 'approve', flowGateId: 'go', approverRole: 'member', arguments: { ws: apWs } });
    assert(r.status === 201 && r.body.data.approval.approverRole === 'owner', `flow gate: ${show(r)}`);
});

// ─── DISCOVER ───
console.log('\nDISCOVER: the session\'s permissions decide, not the agent record\'s');

const WORD = N('discword');
const SECRET_KEY = `${N('disc')}.private`;
let narrow!: McpAgent, narrowMcp!: McpSession, wide!: McpAgent, wideMcp!: McpSession;
await test('Setup: alice\'s private record; an agent whose token carries less than its record now allows; an agent that holds the words', async () => {
    const w = await call('POST', '/v1/memory', alice.token, { key: SECRET_KEY, value: { note: `${WORD} private` }, visibility: 'private' });
    assert(w.status === 201 || w.status === 200, `write: ${show(w)}`);
    narrow = await makeAgent(BASE, alice, ['task:read'], N('narrow'));
    const widened = await call('PATCH', `/v1/agents/${narrow.name}/scopes`, alice.token, { scopes: ['task:read', 'memory:read', 'memory:read-as-owner'] });
    assert(widened.status === 200, `widen the record: ${show(widened)}`);
    narrowMcp = await openSession(BASE, narrow.token, 'u7 narrow');
    wide = await makeAgent(BASE, alice, ['memory:read', 'memory:read-as-owner'], N('wide'));
    wideMcp = await openSession(BASE, wide.token, 'u7 wide');
});

await test('REFUSED: GET /v1/discover with the narrow token does not find alice\'s private record', async () => {
    const r = await call('GET', `/v1/discover?${q({ scope: 'own', q: WORD })}`, narrow.token);
    assert(r.status === 200 && !r.text.includes(SECRET_KEY), `REST: ${show(r)}`);
});

await test('REFUSED: aimeat_discover on the narrow session does not find it either', async () => {
    const r = await callTool(narrowMcp, 'aimeat_discover', { q: WORD, scope: 'own' });
    assert(!r.text.includes(SECRET_KEY), `MCP: ${r.text.slice(0, 400)}`);
});

await test('USE KEPT: an agent whose token holds memory:read and memory:read-as-owner finds it on both surfaces', async () => {
    const rest = await call('GET', `/v1/discover?${q({ scope: 'own', q: WORD })}`, wide.token);
    assert(rest.status === 200 && rest.text.includes(SECRET_KEY), `REST: ${show(rest)}`);
    const mcp = await callTool(wideMcp, 'aimeat_discover', { q: WORD, scope: 'own' });
    assert(!mcp.isError && mcp.text.includes(SECRET_KEY), `MCP: ${mcp.text.slice(0, 400)}`);
});

// ─── ROSTER ───
console.log('\nROSTER: a hidden roster names no agent');

let rosterOrg = '', openOrg = '';
let aliceAgent!: McpAgent, bobMcp!: McpSession, aliceMcp!: McpSession;
await test('Setup: an organism whose roster only admins see, one whose roster members see; alice\'s agent; bob a member of both', async () => {
    rosterOrg = await organism(alice.token, `U7 hidden roster ${stamp}`, { member_visibility: 'admins' });
    openOrg = await organism(alice.token, `U7 open roster ${stamp}`, { member_visibility: 'members' });
    await join(bob.token, rosterOrg);
    await join(bob.token, openOrg);
    aliceAgent = await makeAgent(BASE, alice, ['*'], N('aliceag'));
    aliceMcp = await openSession(BASE, aliceAgent.token, 'u7 alice agent');
    bobMcp = await openSession(BASE, bobAgent.token, 'u7 bob agent');
});

await test('REFUSED: GET /v1/organisms/:id/members to bob\'s agent hides the roster and names no agent', async () => {
    const r = await call('GET', `/v1/organisms/${rosterOrg}/members`, bobAgent.token);
    assert(r.status === 200 && r.body.data.members_hidden === true && !r.text.includes(aliceAgent.gaii), `REST: ${show(r)}`);
});

await test('REFUSED: aimeat_organism_members to bob\'s agent names no agent either', async () => {
    const r = await callTool(bobMcp, 'aimeat_organism_members', { organism_id: rosterOrg });
    assert(!r.isError, `MCP: ${r.text.slice(0, 300)}`);
    assert(!r.text.includes(aliceAgent.gaii), `MCP names alice's agent: ${r.text.slice(0, 400)}`);
});

await test('USE KEPT: the creator\'s agent, and bob where members see the roster, read the agents on both surfaces', async () => {
    const own = await callTool(aliceMcp, 'aimeat_organism_members', { organism_id: rosterOrg });
    assert(!own.isError && own.text.includes(aliceAgent.gaii), `creator's agent, MCP: ${own.text.slice(0, 300)}`);
    const ownRest = await call('GET', `/v1/organisms/${rosterOrg}/members`, aliceAgent.token);
    assert(ownRest.status === 200 && ownRest.text.includes(aliceAgent.gaii), `creator's agent, REST: ${show(ownRest)}`);
    const mcp = await callTool(bobMcp, 'aimeat_organism_members', { organism_id: openOrg });
    assert(!mcp.isError && mcp.text.includes(aliceAgent.gaii), `bob, open roster, MCP: ${mcp.text.slice(0, 300)}`);
    const rest = await call('GET', `/v1/organisms/${openOrg}/members`, bobAgent.token);
    assert(rest.status === 200 && rest.text.includes(aliceAgent.gaii), `bob, open roster, REST: ${show(rest)}`);
});

// ─── BARRED ───
console.log('\nBARRED: an organism that does not admit an agent is not in that agent\'s list');

let barOrg = '';
let listed!: McpAgent, barredMcp!: McpSession;
await test('Setup: alice\'s private organism admits only listed agents and lists one of hers', async () => {
    barOrg = await organism(alice.token, `U7 listed agents ${stamp}`, { visibility: 'private' });
    listed = await makeAgent(BASE, alice, ['*'], N('listed'));
    const att = await call('POST', `/v1/organisms/${barOrg}/agents`, alice.token, { agent_gaii: listed.gaii });
    assert(att.status === 201, `attach: ${show(att)}`);
    const put = await call('PUT', `/v1/organisms/${barOrg}`, alice.token, { agent_access: 'listed' });
    assert(put.status === 200, `agent_access: ${show(put)}`);
    barredMcp = await openSession(BASE, aliceAgent.token, 'u7 barred agent');
});

const memberList = async (token: string): Promise<string[]> => {
    const r = await call('GET', `/v1/organisms?${q({ member: alice.name })}`, token);
    assert(r.status === 200, `list: ${show(r)}`);
    return (r.body.data.organisms as Body[]).map(o => o.id as string);
};

await test('REFUSED: aimeat_organism_list leaves the organism out for alice\'s unlisted agent', async () => {
    const r = await callTool(barredMcp, 'aimeat_organism_list', {});
    assert(!r.isError && !r.text.includes(barOrg), `MCP: ${r.text.slice(0, 300)}`);
});

await test('REFUSED: GET /v1/organisms?member=alice leaves it out for the same agent', async () => {
    assert(!(await memberList(aliceAgent.token)).includes(barOrg), 'REST lists the organism that bars the agent');
});

await test('USE KEPT: alice in person and her listed agent see it in the member list', async () => {
    assert((await memberList(alice.token)).includes(barOrg), 'alice in person');
    assert((await memberList(listed.token)).includes(barOrg), 'the listed agent');
});

// ─── WS-ROLE ───
console.log('\nWS-ROLE: attaching an agent never narrows it (developer ruling 2026-11-13, after the 2026-11-10 ruling)');

let roleOrg = '', bobWs = '';
let attached!: McpAgent, attachedMcp!: McpSession, sibling!: McpAgent, carolAgent!: McpAgent, carolMcp!: McpSession;
await test('Setup: alice\'s organism; bob a member who creates a workspace; one of alice\'s agents attached, one not; carol\'s agent attached, then carol leaves', async () => {
    roleOrg = await organism(alice.token, `U7 roles ${stamp}`);
    await join(bob.token, roleOrg);
    const w = await call('POST', `/v1/organisms/${roleOrg}/workspaces`, bob.token, { name: 'Bob\'s', manifest: {
        objectTypes: [{ name: 'note', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' }],
    } });
    assert(w.status === 201, `workspace: ${show(w)}`);
    bobWs = w.body.data.ws;
    attached = await makeAgent(BASE, alice, ['*'], N('attached'));
    sibling = await makeAgent(BASE, alice, ['*'], N('sibling'));
    const att = await call('POST', `/v1/organisms/${roleOrg}/agents`, alice.token, { agent_gaii: attached.gaii });
    assert(att.status === 201, `attach: ${show(att)}`);
    attachedMcp = await openSession(BASE, attached.token, 'u7 attached');
    await join(carol.token, roleOrg);
    carolAgent = await makeAgent(BASE, carol, ['*'], N('carolag'));
    const catt = await call('POST', `/v1/organisms/${roleOrg}/agents`, carol.token, { agent_gaii: carolAgent.gaii });
    assert(catt.status === 201, `carol attaches her agent: ${show(catt)}`);
    const left = await call('POST', `/v1/organisms/${roleOrg}/leave`, carol.token, {});
    assert(left.status === 200, `carol leaves: ${show(left)}`);
    carolMcp = await openSession(BASE, carolAgent.token, 'u7 carol agent');
});

await test('USE KEPT: the attached agent lists the members of bob\'s workspace over MCP (its owner\'s creator role)', async () => {
    const r = await callTool(attachedMcp, 'aimeat_workspace_members', { organism_id: roleOrg, ws: bobWs });
    assert(!r.isError, `MCP: ${r.text.slice(0, 300)}`);
});

await test('DECIDED: the same agent reads the same list on REST with its owner\'s role', async () => {
    const r = await call('GET', `/v1/organisms/${roleOrg}/workspace-access?${q({ ws: bobWs })}`, attached.token);
    assert(r.status === 200, `REST: ${show(r)}`);
});

await test('USE KEPT: alice\'s agent that is not attached reads the same list on REST (its owner\'s role)', async () => {
    const r = await call('GET', `/v1/organisms/${roleOrg}/workspace-access?${q({ ws: bobWs })}`, sibling.token);
    assert(r.status === 200, `REST, not attached: ${show(r)}`);
});

await test('REFUSED: an attached agent whose owner is no longer a member manages nothing, on both surfaces', async () => {
    const mcp = await callTool(carolMcp, 'aimeat_workspace_members', { organism_id: roleOrg, ws: bobWs });
    assert(mcp.isError, `MCP: ${mcp.text.slice(0, 300)}`);
    const rest = await call('GET', `/v1/organisms/${roleOrg}/workspace-access?${q({ ws: bobWs })}`, carolAgent.token);
    assert(rest.status === 403, `REST: ${show(rest)}`);
});

// ─── GROUPS ───
console.log('\nGROUPS: an agent sees its owner\'s sharing groups with consent:groups, and only its own without (developer ruling 2026-11-13)');

let groupId = '';
let reader!: McpAgent, readerMcp!: McpSession, manager!: McpAgent, managerMcp!: McpSession;
await test('Setup: alice in person makes a sharing group; one of her agents holds memory:read, another memory:read and consent:groups', async () => {
    const g = await call('POST', '/v1/groups', alice.token, { name: N('group') });
    assert(g.status === 201, `group: ${show(g)}`);
    groupId = g.body.data.group.id;
    reader = await makeAgent(BASE, alice, ['memory:read'], N('reader'));
    readerMcp = await openSession(BASE, reader.token, 'u7 reader');
    manager = await makeAgent(BASE, alice, ['memory:read', 'consent:groups'], N('manager'));
    managerMcp = await openSession(BASE, manager.token, 'u7 manager');
});

await test('REFUSED: without consent:groups, aimeat_group_list leaves the owner\'s group out and aimeat_group_get refuses it', async () => {
    const list = await callTool(readerMcp, 'aimeat_group_list', {});
    assert(!list.isError && !list.text.includes(groupId), `list: ${list.text.slice(0, 300)}`);
    const one = await callTool(readerMcp, 'aimeat_group_get', { group_id: groupId });
    assert(one.isError, `get: ${one.text.slice(0, 300)}`);
});

await test('REFUSED: without consent:groups, GET /v1/groups leaves the group out and GET /v1/groups/:id answers 403', async () => {
    const list = await call('GET', '/v1/groups', reader.token);
    assert(list.status === 200 && !list.text.includes(groupId), `list: ${show(list)}`);
    const one = await call('GET', `/v1/groups/${groupId}`, reader.token);
    assert(one.status === 403, `get: ${show(one)}`);
});

await test('DECIDED: with consent:groups, the owner\'s group is listed and read on both surfaces', async () => {
    const list = await callTool(managerMcp, 'aimeat_group_list', {});
    assert(!list.isError && list.text.includes(groupId), `MCP list: ${list.text.slice(0, 300)}`);
    const one = await callTool(managerMcp, 'aimeat_group_get', { group_id: groupId });
    assert(!one.isError && one.text.includes(groupId), `MCP get: ${one.text.slice(0, 300)}`);
    const rest = await call('GET', '/v1/groups', manager.token);
    assert(rest.status === 200 && rest.text.includes(groupId), `REST list: ${show(rest)}`);
    const restOne = await call('GET', `/v1/groups/${groupId}`, manager.token);
    assert(restOne.status === 200, `REST get: ${show(restOne)}`);
});

await test('USE KEPT: alice in person lists and reads her group; an agent that is a member sees that group without consent:groups', async () => {
    const mine = await call('GET', '/v1/groups', alice.token);
    assert(mine.status === 200 && mine.text.includes(groupId), `owner list: ${show(mine)}`);
    const add = await call('POST', `/v1/groups/${groupId}/members`, alice.token, { identifier: reader.gaii, identifier_type: 'gaii' });
    assert(add.status === 201, `add the agent: ${show(add)}`);
    const rest = await call('GET', `/v1/groups/${groupId}`, reader.token);
    assert(rest.status === 200, `member agent, REST: ${show(rest)}`);
    const mcp = await callTool(readerMcp, 'aimeat_group_list', {});
    assert(!mcp.isError && mcp.text.includes(groupId), `member agent, MCP: ${mcp.text.slice(0, 300)}`);
});

// ─── BOARD-RES ───
console.log('\nBOARD-RES: the board posts resource asks the board read gate GET /v1/boards/:id/posts asks');

let brBoard = '';
let brReader!: McpAgent;
let brMcp!: McpSession;
const BR_TITLE = N('brpost');
await test('Setup: alice\'s private board with one post; bob\'s agent holds alice\'s consent for that board', async () => {
    const b = await call('POST', '/v1/boards', alice.token, { name: N('brboard'), visibility: 'private' });
    assert(b.status === 201, `board: ${show(b)}`);
    brBoard = b.body.data.id ?? b.body.data.board?.id;
    const p = await call('POST', `/v1/boards/${brBoard}/posts`, alice.token, { title: BR_TITLE, body: 'consent reads this' });
    assert(p.status === 201, `post: ${show(p)}`);
    brReader = await makeAgent(BASE, bob, ['social:read', 'memory:read'], N('brag'));
    const c = await call('POST', '/v1/consent', alice.token, { data_pattern: `board:${brBoard}`, recipient: brReader.gaii, purpose: 'read the board', scope: 'local' });
    assert(c.status === 201, `consent: ${show(c)}`);
    brMcp = await openSession(BASE, brReader.token, 'u2b-board-res');
});

await test('USE KEPT: GET /v1/boards/:id/posts and aimeat_board_read give the consent-holding agent the post', async () => {
    const rest = await call('GET', `/v1/boards/${brBoard}/posts`, brReader.token);
    assert(rest.status === 200 && rest.text.includes(BR_TITLE), `REST: ${show(rest)}`);
    const tool = await callTool(brMcp, 'aimeat_board_read', { board_id: brBoard });
    assert(!tool.isError && tool.text.includes(BR_TITLE), `tool: ${tool.text.slice(0, 300)}`);
});

await test('DIFFERS TODAY: the aimeat://boards/{id} resource gives the same agent the same post', async () => {
    const body = await mcpRpc(brMcp, 'resources/read', { uri: `aimeat://boards/${encodeURIComponent(brBoard)}` });
    const text = String(body?.result?.contents?.[0]?.text ?? JSON.stringify(body?.error ?? body));
    assert(text.includes(BR_TITLE), `resource: ${text.slice(0, 300)}`);
});

await test('REFUSED: carol\'s agent without consent is refused by the resource and by REST', async () => {
    const outsider = await makeAgent(BASE, carol, ['social:read', 'memory:read'], N('brout'));
    const rest = await call('GET', `/v1/boards/${brBoard}/posts`, outsider.token);
    assert(rest.status === 403, `REST: ${show(rest)}`);
    const s = await openSession(BASE, outsider.token, 'u2b-board-res-out');
    const body = await mcpRpc(s, 'resources/read', { uri: `aimeat://boards/${encodeURIComponent(brBoard)}` });
    const text = String(body?.result?.contents?.[0]?.text ?? JSON.stringify(body?.error ?? body));
    assert(!text.includes(BR_TITLE) && /ACCESS_DENIED/.test(text), `resource: ${text.slice(0, 300)}`);
});

// ─── JOIN-PRIVATE ───
console.log('\nJOIN-PRIVATE: joining a private organism with an open join policy');

let jpOrg = '';
await test('Setup: alice\'s private organism with an open join policy; bob\'s agent', async () => {
    jpOrg = await organism(alice.token, `U2b join ${stamp}`, { visibility: 'private' });
});

await test('DECIDED (developer, 2026-11-14): a private organism answers an outside agent\'s join as not found, on POST /v1/organisms/:id/join and aimeat_organism_join', async () => {
    // Both agents hold social:write, the word both surfaces ask for a join, so neither answer is a scope refusal.
    const restAgent = await makeAgent(BASE, bob, ['organism:read', 'organism:write', 'social:write'], N('jprest'));
    const rest = await call('POST', `/v1/organisms/${jpOrg}/join`, restAgent.token, {});
    const toolAgent = await makeAgent(BASE, carol, ['organism:read', 'organism:write', 'social:write'], N('jptool'));
    const tool = await callTool(await openSession(BASE, toolAgent.token, 'u2b-join'), 'aimeat_organism_join', { organism_id: jpOrg });
    assert(rest.status === 404, `REST: ${show(rest)}`);
    assert(tool.isError && /Organism not found/.test(tool.text), `tool: ${tool.text.slice(0, 200)}`);
});

await test('USE KEPT: an agent joins a public organism with an open join policy on REST; carol in person joins the private one by its id', async () => {
    const pub = await organism(alice.token, `U2b join public ${stamp}`);
    const agent = await makeAgent(BASE, bob, ['organism:read', 'organism:write', 'social:write'], N('jppub'));
    const rest = await call('POST', `/v1/organisms/${pub}/join`, agent.token, {});
    assert(rest.status === 201, `agent, public: ${show(rest)}`);
    const person = await call('POST', `/v1/organisms/${jpOrg}/join`, carol.token, {});
    assert(person.status === 201, `carol in person, private: ${show(person)}`);
});

// ─── BOARD-MEMBERS ───
console.log('\nBOARD-MEMBERS: who changes a shared board\'s reader list');

let bmBoard = '';
let bmAgent!: McpAgent;
await test('Setup: alice\'s shared board; an agent of alice holding social:members', async () => {
    const b = await call('POST', '/v1/boards', alice.token, { name: N('bmboard'), visibility: 'shared' });
    assert(b.status === 201, `board: ${show(b)}`);
    bmBoard = b.body.data.id ?? b.body.data.board?.id;
    bmAgent = await makeAgent(BASE, alice, ['social:read', 'social:write', 'social:members'], N('bmag'));
});

await test('QUESTION for the developer (today\'s two answers): REST refuses alice\'s agent a board\'s reader list; aimeat_board_members lets it change the list, on purpose per the tool', async () => {
    const add = `ext-${stamp}#someone@aimeat-fi-001-test`;
    const rest = await call('PATCH', `/v1/boards/${bmBoard}/members`, bmAgent.token, { add: [add] });
    const tool = await callTool(await openSession(BASE, bmAgent.token, 'u2b-board-members'), 'aimeat_board_members', { board_id: bmBoard, add: [add] });
    assert(rest.status === 403, `REST today refuses the agent: ${show(rest)}`);
    assert(!tool.isError && tool.text.includes(add), `tool today changes the list: ${tool.text.slice(0, 200)}`);
});

// ─── ORG-READ ───
console.log('\nORG-READ: who reads a private organism, on GET /v1/organisms/:id, aimeat_organism_get and its resource');

let orOrg = '';
let orMember!: McpAgent, orOutsider!: McpAgent, orOperator!: McpAgent;
await test('Setup: alice\'s private organism; bob joins it; an agent each of bob, carol and the operator', async () => {
    orOrg = await organism(alice.token, `U2b read ${stamp}`, { visibility: 'private' });
    await join(bob.token, orOrg);
    orMember = await makeAgent(BASE, bob, ['*'], N('ormem'));
    orOutsider = await makeAgent(BASE, carol, ['*'], N('orout'));
    // operator:admin named: the operator's reach is a word the operator ticks for one agent.
    orOperator = await makeAgent(BASE, op, ['*', 'operator:admin'], N('orop'));
});

/** Whether each of the three doors admits the caller: REST, the tool, the resource. */
async function orgReadDoors(agent: McpAgent): Promise<{ rest: boolean; tool: boolean; resource: boolean; detail: string }> {
    const rest = await call('GET', `/v1/organisms/${orOrg}`, agent.token);
    const s = await openSession(BASE, agent.token, 'u2b-org-read');
    const tool = await callTool(s, 'aimeat_organism_get', { organism_id: orOrg });
    const res = await mcpRpc(s, 'resources/read', { uri: `aimeat://organisms/${encodeURIComponent(orOrg)}` });
    const resText = String(res?.result?.contents?.[0]?.text ?? JSON.stringify(res?.error ?? res));
    return {
        rest: rest.status === 200, tool: !tool.isError, resource: resText.trim().startsWith('{'),
        detail: `REST ${rest.status}; tool ${tool.text.slice(0, 120)}; resource ${resText.slice(0, 120)}`,
    };
}

await test('USE KEPT: the member\'s agent reads the private organism on all three', async () => {
    const d = await orgReadDoors(orMember);
    assert(d.rest && d.tool && d.resource, d.detail);
});

await test('REFUSED: an outsider\'s agent is refused on all three', async () => {
    const d = await orgReadDoors(orOutsider);
    assert(!d.rest && !d.tool && !d.resource, d.detail);
});

await test('SAME ANSWER: the operator\'s agent, not a member, gets one answer on all three', async () => {
    const d = await orgReadDoors(orOperator);
    assert(d.rest === d.tool && d.tool === d.resource, d.detail);
});

// ─── ROSTER-PRIVATE ───
console.log('\nROSTER-PRIVATE: who reads a private organism\'s member list');

await test('DECIDED (developer, 2026-11-14): a private organism\'s member list is for its active members only; the operator\'s agent is refused on GET /v1/organisms/:id/members, aimeat_organism_members and GET /v1/organisms/:id', async () => {
    const rest = await call('GET', `/v1/organisms/${orOrg}/members`, orOperator.token);
    const tool = await callTool(await openSession(BASE, orOperator.token, 'u2b-roster'), 'aimeat_organism_members', { organism_id: orOrg });
    const detail = await call('GET', `/v1/organisms/${orOrg}`, orOperator.token);
    assert(rest.status === 404, `REST members: ${show(rest)}`);
    assert(tool.isError && /Access denied/.test(tool.text), `tool: ${tool.text.slice(0, 200)}`);
    assert(detail.status === 404, `REST detail: ${show(detail)}`);
});

await test('USE KEPT: the member\'s agent reads the list on both; the outsider\'s agent on neither', async () => {
    const mRest = await call('GET', `/v1/organisms/${orOrg}/members`, orMember.token);
    const mTool = await callTool(await openSession(BASE, orMember.token, 'u2b-roster-m'), 'aimeat_organism_members', { organism_id: orOrg });
    assert(mRest.status === 200 && !mTool.isError, `member: REST ${show(mRest)} vs tool ${mTool.text.slice(0, 200)}`);
    const oRest = await call('GET', `/v1/organisms/${orOrg}/members`, orOutsider.token);
    const oTool = await callTool(await openSession(BASE, orOutsider.token, 'u2b-roster-o'), 'aimeat_organism_members', { organism_id: orOrg });
    assert(oRest.status === 404 && oTool.isError, `outsider: REST ${show(oRest)} vs tool ${oTool.text.slice(0, 200)}`);
});

// ─── ARCHIVED-LIST ───
console.log('\nARCHIVED-LIST: an archived organism in the owner\'s own list, as the owner\'s agent sees it');

let arOrg = '';
let arAgent!: McpAgent;
await test('Setup: alice\'s organism, archived; an agent of alice', async () => {
    arOrg = await organism(alice.token, `U2b archived ${stamp}`);
    const a = await call('POST', `/v1/organisms/${arOrg}/archive`, alice.token, { level: 'organism' });
    assert(a.status === 200, `archive: ${show(a)}`);
    arAgent = await makeAgent(BASE, alice, ['*'], N('arag'));
});

await test('SAME ANSWER: GET /v1/organisms?member=alice and aimeat_organism_list both list, or both leave out, the archived organism for alice\'s agent', async () => {
    const rest = await call('GET', `/v1/organisms?${q({ member: alice.name })}`, arAgent.token);
    const tool = await callTool(await openSession(BASE, arAgent.token, 'u2b-archived'), 'aimeat_organism_list', {});
    assert(rest.text.includes(arOrg) === tool.text.includes(arOrg), `REST lists it: ${rest.text.includes(arOrg)}; tool lists it: ${tool.text.includes(arOrg)}`);
});

// ─── WS-UPDATE ───
console.log('\nWS-UPDATE: an attached agent whose owner left changes a workspace\'s structure');

await test('SAME ANSWER: PUT /v1/organisms/:id/workspace and aimeat_workspace_update answer carol\'s attached agent alike after carol left', async () => {
    const rest = await call('PUT', `/v1/organisms/${roleOrg}/workspace`, carolAgent.token, { ws: bobWs, readme: `u2b ${stamp}` });
    const tool = await callTool(carolMcp, 'aimeat_workspace_update', { organism_id: roleOrg, ws: bobWs, readme: `u2b ${stamp}` });
    assert((rest.body.ok === true) === !tool.isError, `REST ${show(rest)} vs tool ${tool.text.slice(0, 200)}`);
});

// ─── MEMBER-LIST ───
console.log('\nMEMBER-LIST: the organisms a caller\'s owner is in, on GET /v1/organisms?member=<owner> and aimeat_organism_list');

let mlOrg = '';
await test('Setup: alice\'s private organism (alice\'s archived organism from ARCHIVED-LIST stays)', async () => {
    mlOrg = await organism(alice.token, `U2b member list ${stamp}`, { visibility: 'private' });
});

for (const [who, agent, owner] of [
    ['alice\'s agent', () => arAgent, () => alice.name],
    ['bob\'s agent', () => orMember, () => bob.name],
    ['the operator\'s agent', () => orOperator, () => op.name],
] as const) {
    await test(`SAME ANSWER: ${who} sees alice's private and archived organisms alike on REST (?member=its owner) and in aimeat_organism_list`, async () => {
        const rest = await call('GET', `/v1/organisms?${q({ member: owner() })}`, agent().token);
        const tool = await callTool(await openSession(BASE, agent().token, 'u2b-member-list'), 'aimeat_organism_list', {});
        assert(rest.status === 200 && !tool.isError, `REST ${show(rest)} vs tool ${tool.text.slice(0, 200)}`);
        for (const id of [mlOrg, arOrg]) {
            assert(rest.text.includes(id) === tool.text.includes(id), `${id}: REST lists it ${rest.text.includes(id)}, tool lists it ${tool.text.includes(id)}`);
        }
    });
}

await test('USE KEPT: alice in person lists her private and her archived organism on REST (the tool is an agent\'s surface)', async () => {
    const rest = await call('GET', `/v1/organisms?${q({ member: alice.name })}`, alice.token);
    assert(rest.status === 200 && rest.text.includes(mlOrg) && rest.text.includes(arOrg), show(rest));
});

// ─── FILES ───
console.log('\nFILES: the file list asks the classification reader');

const FILE = `${N('file')}-confidential.txt`;
const OPEN_FILE = `${N('file')}-open.txt`;
let bot!: McpAgent, botMcp!: McpSession;
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });
const fileKeys = async (token: string): Promise<string[]> => {
    const r = await call('GET', '/v1/memory/files', token);
    assert(r.status === 200, `files: ${show(r)}`);
    return (r.body.data.files as Body[]).map(f => f.key as string);
};

await test('Setup: classification on; alice\'s agent stores a Confidential and an unlabelled file; its clearance is Internal', async () => {
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${show(on)}`);
    await takeOffAudienceCaps(BASE, op.token);
    bot = await makeAgent(BASE, alice, ['*'], N('bot'));
    botMcp = await openSession(BASE, bot.token, 'u7 bot');
    for (const key of [FILE, OPEN_FILE]) {
        const up = await call('POST', '/v1/storage', bot.token, { key, data: Buffer.from(`notes ${key}`).toString('base64'), mime_type: 'text/plain', visibility: 'private' });
        assert(up.status === 201 || up.status === 200, `upload ${key}: ${show(up)}`);
    }
    const l = await call('PUT', '/v1/classification/label', alice.token, { kind: 'file', key: FILE, owner: bot.gaii, label: 'luottamuksellinen' });
    assert(l.status === 200 && l.body.data.applied === true, `label: ${show(l)}`);
    const c = await call('PATCH', `/v1/agents/${bot.name}/clearance`, alice.token, { clearance: 'sisainen' });
    assert(c.status === 200, `clearance: ${show(c)}`);
});

await test('REFUSED: the agent\'s download and its MCP storage resource list do not give the Confidential file', async () => {
    const dl = await call('GET', `/v1/memory/files/${encodeURIComponent(FILE)}`, bot.token);
    assert(dl.status === 404, `download: ${show(dl)}`);
    const res = await mcpRpc(botMcp, 'resources/list', {});
    assert(!JSON.stringify(res).includes(FILE), `MCP resource list: ${JSON.stringify(res).slice(0, 300)}`);
});

await test('REFUSED: GET /v1/memory/files does not list the Confidential file to the agent', async () => {
    assert(!(await fileKeys(bot.token)).includes(FILE), 'the list names the file the download refuses');
});

await test('USE KEPT: the agent lists its unlabelled file; alice in person lists both', async () => {
    assert((await fileKeys(bot.token)).includes(OPEN_FILE), 'the agent\'s unlabelled file');
    const mine = await fileKeys(alice.token);
    assert(mine.includes(FILE) && mine.includes(OPEN_FILE), `alice: ${JSON.stringify(mine)}`);
});

await test('Cleanup: classification off; the accounts deleted', async () => {
    const off = await setSwitch('off');
    assert(off.status === 200, `switch off: ${show(off)}`);
    const left: string[] = [];
    for (const who of [alice, bob, carol]) {
        const gone = await call('DELETE', `/v1/owners/${who.name}`, who.token);
        if (gone.body?.ok !== true) left.push(`${who.name}: ${gone.status}`);
    }
    assert(left.length === 0, `accounts not deleted: ${left.join(', ')}`);
});

// ─── unit 2b part 2, phase B (session cc-jouni-structure-u2b-2) ───
// One section per difference between an agent, app, task or operator tool and its REST route. A
// RECORDED DIFFERENCE asserts both answers as they are today and names the open question in its title.
console.log('\nunit 2b part 2, phase B: agent, app, task and operator tools against their routes');

let pbOpAgent!: McpAgent, pbOpMcp!: McpSession;
await test('Setup (phase B): the operator\'s agent holding operator:admin', async () => {
    pbOpAgent = await makeAgent(BASE, op, ['operator:admin'], N('pbop'));
    pbOpMcp = await openSession(BASE, pbOpAgent.token, 'u2b2 phase B operator');
});

await test('B6 USE KEPT: aimeat_admin_agents and GET /v1/admin/agents answer limit=1 alike', async () => {
    const tool = await callTool(pbOpMcp, 'aimeat_admin_agents', { limit: 1 });
    const rest = await call('GET', '/v1/admin/agents?limit=1', pbOpAgent.token);
    assert(!tool.isError && rest.status === 200, `tool: ${tool.text.slice(0, 200)} / route: ${show(rest)}`);
    assert(Array.isArray(tool.data) && tool.data.length === 1 && rest.body.data.agents.length === 1,
        `tool ${JSON.stringify(tool.data).slice(0, 120)} / route ${rest.body.data.agents.length}`);
});

await test('B6 DECIDED (developer approval 2026-11-14): limit=-1 lists every agent on the tool and the route alike', async () => {
    const tool = await callTool(pbOpMcp, 'aimeat_admin_agents', { limit: -1 });
    const rest = await call('GET', '/v1/admin/agents?limit=-1', pbOpAgent.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const all = rest.body.data.agents.length as number;
    assert(all === rest.body.data.total, `route lists ${all} of ${rest.body.data.total}`);
    assert(!tool.isError && Array.isArray(tool.data), `tool: ${tool.text.slice(0, 200)}`);
    assert(tool.data.length === all, `tool lists ${tool.data.length}, route ${all}`);
});

// The owners of the sections above are deleted by their cleanup, so phase B makes its own.
let pbAlice!: RegisteredOwner, pbBob!: RegisteredOwner;
let pbAliceAg!: McpAgent, pbAliceMcp!: McpSession, pbBobAg!: McpAgent, pbBobMcp!: McpSession;
let pbOpWide!: McpAgent, pbOpWideMcp!: McpSession;
await test('Setup (phase B): two owners, alice and bob, each with an agent holding every word; the operator\'s agent holding every word and operator:admin', async () => {
    pbAlice = await registerOwner(BASE, N('pbalice'));
    pbBob = await registerOwner(BASE, N('pbbob'));
    pbAliceAg = await makeAgent(BASE, pbAlice, ['*'], N('pbaliceag'));
    pbAliceMcp = await openSession(BASE, pbAliceAg.token, 'u2b2 phase B alice');
    pbBobAg = await makeAgent(BASE, pbBob, ['*'], N('pbbobag'));
    pbBobMcp = await openSession(BASE, pbBobAg.token, 'u2b2 phase B bob');
    // operator:admin sits outside every wildcard, so it is named.
    pbOpWide = await makeAgent(BASE, op, ['*', 'operator:admin'], N('pbopwide'));
    pbOpWideMcp = await openSession(BASE, pbOpWide.token, 'u2b2 phase B operator wide');
});

// B11: one chat instance, read by its owner's agent, another owner's agent and the operator's agent.
let pbInstance = '';
const instanceResource = async (s: McpSession, id: string): Promise<string> => {
    const r = await mcpRpc(s, 'resources/read', { uri: `aimeat://instances/${encodeURIComponent(id)}` });
    return JSON.stringify(r?.result?.contents ?? r);
};
await test('Setup (B11): alice registers a chat instance', async () => {
    const r = await call('POST', '/v1/chat-instances', pbAlice.token, { platform: 'claude', app_name: N('pbchat') });
    assert(r.status === 201, `register: ${show(r)}`);
    pbInstance = r.body.data.chat_instance.id;
});

await test('B11 USE KEPT: alice\'s agent reads her chat instance on the route, aimeat_instance_status and the resource', async () => {
    const rest = await call('GET', `/v1/chat-instances/${encodeURIComponent(pbInstance)}`, pbAliceAg.token);
    assert(rest.status === 200 && rest.body.data.chat_instance.id === pbInstance, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_instance_status', { instance_id: pbInstance });
    assert(!tool.isError && tool.data.id === pbInstance, `tool: ${tool.text.slice(0, 200)}`);
    assert((await instanceResource(pbAliceMcp, pbInstance)).includes(pbInstance), 'resource');
});

await test('B11 REFUSED: bob\'s agent is refused alice\'s chat instance on all three', async () => {
    const rest = await call('GET', `/v1/chat-instances/${encodeURIComponent(pbInstance)}`, pbBobAg.token);
    assert(rest.status === 404, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_instance_status', { instance_id: pbInstance });
    assert(tool.isError && tool.text === 'Access denied', `tool: ${tool.text.slice(0, 200)}`);
    assert((await instanceResource(pbBobMcp, pbInstance)).includes('ACCESS_DENIED'), 'resource');
});

await test('B11 FIXED: the operator\'s agent holding operator:admin reads alice\'s chat instance on the route, the tool and the resource alike', async () => {
    const rest = await call('GET', `/v1/chat-instances/${encodeURIComponent(pbInstance)}`, pbOpWide.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbOpWideMcp, 'aimeat_instance_status', { instance_id: pbInstance });
    assert(!tool.isError && tool.data.id === pbInstance, `tool: ${tool.text.slice(0, 200)}`);
    const res = await instanceResource(pbOpWideMcp, pbInstance);
    assert(res.includes(pbInstance) && !res.includes('ACCESS_DENIED'), `resource: ${res.slice(0, 200)}`);
});

// B13: one consent alice gave in person, read on GET /v1/consent/:id and the consent-record resource.
let pbConsent = '';
const consentResource = async (s: McpSession, id: string): Promise<string> => {
    const r = await mcpRpc(s, 'resources/read', { uri: `aimeat://consent/${encodeURIComponent(id)}` });
    return JSON.stringify(r?.result?.contents ?? r);
};
await test('Setup (B13): alice in person gives a consent', async () => {
    const r = await call('POST', '/v1/consent', pbAlice.token, { data_pattern: `${N('pbnotes')}.*`, recipient: pbBobAg.gaii, purpose: 'phase B parity' });
    assert(r.status === 201, `consent: ${show(r)}`);
    pbConsent = r.body.data.id ?? r.body.data.consent?.id;
    assert(typeof pbConsent === 'string' && pbConsent.length > 0, `consent id: ${show(r)}`);
});

await test('B13 USE KEPT: alice in person reads her consent on the route', async () => {
    const r = await call('GET', `/v1/consent/${encodeURIComponent(pbConsent)}`, pbAlice.token);
    assert(r.status === 200 && r.body.data.id === pbConsent, `route: ${show(r)}`);
});

await test('B13 REFUSED: bob\'s agent is refused alice\'s consent on the route and the resource', async () => {
    const r = await call('GET', `/v1/consent/${encodeURIComponent(pbConsent)}`, pbBobAg.token);
    assert(r.status === 403, `route: ${show(r)}`);
    assert((await consentResource(pbBobMcp, pbConsent)).includes('ACCESS_DENIED'), 'resource');
});

await test('B13 FIXED: the operator\'s agent holding operator:admin reads alice\'s consent on the route and the resource alike', async () => {
    const r = await call('GET', `/v1/consent/${encodeURIComponent(pbConsent)}`, pbOpWide.token);
    assert(r.status === 200 && r.body.data.id === pbConsent, `route: ${show(r)}`);
    const res = await consentResource(pbOpWideMcp, pbConsent);
    assert(res.includes(pbConsent) && !res.includes('ACCESS_DENIED'), `resource: ${res.slice(0, 200)}`);
});

await test('B13b DECIDED (developer approval 2026-11-14): alice\'s agent is refused the consent alice gave in person on the route and the resource, and the resource list does not name it', async () => {
    const r = await call('GET', `/v1/consent/${encodeURIComponent(pbConsent)}`, pbAliceAg.token);
    assert(r.status === 403, `route: ${show(r)}`);
    const res = await consentResource(pbAliceMcp, pbConsent);
    assert(res.includes('ACCESS_DENIED'), `resource: ${res.slice(0, 200)}`);
    const list = await mcpRpc(pbAliceMcp, 'resources/list', {});
    assert(!JSON.stringify(list).includes(pbConsent), 'the resource list names the consent');
});

await test('B13b USE KEPT: a consent alice\'s agent gives is read by that agent on the route and the resource', async () => {
    const g = await call('POST', '/v1/consent', pbAliceAg.token, { data_pattern: `${N('pbagnotes')}.*`, recipient: pbBobAg.gaii, purpose: 'phase B agent consent' });
    assert(g.status === 201, `grant: ${show(g)}`);
    const id = g.body.data.id ?? g.body.data.consent?.id;
    const r = await call('GET', `/v1/consent/${encodeURIComponent(id)}`, pbAliceAg.token);
    assert(r.status === 200, `route: ${show(r)}`);
    const res = await consentResource(pbAliceMcp, id);
    assert(res.includes(id) && !res.includes('ACCESS_DENIED'), `resource: ${res.slice(0, 200)}`);
});

// B16: alice's public, members and private records read by bob's agent on aimeat_memory_read_public
// and GET /v1/memory/:gaii/:key.
const PB_PUBLIC = `${N('pbmem')}.public`, PB_MEMBERS = `${N('pbmem')}.members`, PB_PRIVATE = `${N('pbmem')}.private`;
const publicRead = (key: string, token: string) => call('GET', `/v1/memory/${encodeURIComponent(pbAlice.ghii)}/${encodeURIComponent(key)}`, token);
await test('Setup (B16): alice in person writes a public, a members and a private record', async () => {
    for (const [key, visibility] of [[PB_PUBLIC, 'public'], [PB_MEMBERS, 'members'], [PB_PRIVATE, 'private']] as const) {
        const w = await call('POST', '/v1/memory', pbAlice.token, { key, value: { note: key }, visibility });
        assert(w.status === 201 || w.status === 200, `write ${key}: ${show(w)}`);
    }
});

await test('B16 USE KEPT: bob\'s agent reads alice\'s public record on the tool and the route alike', async () => {
    const rest = await publicRead(PB_PUBLIC, pbBobAg.token);
    assert(rest.status === 200 && rest.body.data.value.note === PB_PUBLIC, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_memory_read_public', { gaii: pbAlice.ghii, key: PB_PUBLIC });
    assert(!tool.isError && tool.data.value.note === PB_PUBLIC, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B16 USE KEPT: a key that does not exist is not found on both', async () => {
    const rest = await publicRead(`${PB_PUBLIC}.none`, pbBobAg.token);
    assert(rest.status === 404, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_memory_read_public', { gaii: pbAlice.ghii, key: `${PB_PUBLIC}.none` });
    assert(tool.isError && tool.text === 'Memory entry not found', `tool: ${tool.text.slice(0, 200)}`);
});

await test('B16 REFUSED: alice\'s private record is refused to bob\'s agent on both (the route with CONSENT_DENIED, the tool as not public)', async () => {
    const rest = await publicRead(PB_PRIVATE, pbBobAg.token);
    assert(rest.status === 403 && rest.body.error.code === 'CONSENT_DENIED', `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_memory_read_public', { gaii: pbAlice.ghii, key: PB_PRIVATE });
    assert(tool.isError && tool.text === 'Access denied: entry is not public', `tool: ${tool.text.slice(0, 200)}`);
});

await test('B16 RECORDED DIFFERENCE (by the tool\'s description: only public entries): alice\'s members record, the route gives it to bob\'s agent and the tool refuses it', async () => {
    const rest = await publicRead(PB_MEMBERS, pbBobAg.token);
    assert(rest.status === 200 && rest.body.data.value.note === PB_MEMBERS, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_memory_read_public', { gaii: pbAlice.ghii, key: PB_MEMBERS });
    assert(tool.isError && tool.text === 'Access denied: entry is not public', `tool: ${tool.text.slice(0, 200)}`);
});

// B17: aimeat_operator_ai_config against its REST twins, POST and GET /v1/ai/settings (the catalog
// names POST as the route the connector's copy of the tool calls).
let pbAiAg!: McpAgent, pbAiMcp!: McpSession;
await test('Setup (B17): alice\'s agent holding memory:write-reserved and memory:write-as-owner', async () => {
    pbAiAg = await makeAgent(BASE, pbAlice, ['*', 'memory:write-reserved', 'memory:write-as-owner'], N('pbaiag'));
    pbAiMcp = await openSession(BASE, pbAiAg.token, 'u2b2 phase B ai settings');
});

await test('B17 USE KEPT: that agent sets alice\'s daily budget on the route and on the tool (proposal, then the token)', async () => {
    const rest = await call('POST', '/v1/ai/settings', pbAiAg.token, { daily_budget_usd: 2 });
    assert(rest.status === 200, `route: ${show(rest)}`);
    const proposal = await callTool(pbAiMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 3 });
    assert(!proposal.isError && proposal.data.mode === 'proposal' && proposal.data.current.daily_budget_usd === 2, `proposal: ${proposal.text.slice(0, 300)}`);
    const applied = await callTool(pbAiMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 3, confirm_token: proposal.data.confirm_token });
    assert(!applied.isError && applied.data.mode === 'applied', `apply: ${applied.text.slice(0, 300)}`);
    const mine = await call('GET', '/v1/ai/settings', pbAlice.token);
    assert(mine.status === 200 && mine.body.data.daily_budget_usd === 3, `alice reads: ${show(mine)}`);
});

await test('B17 REFUSED: alice\'s agent without memory:write-reserved is refused the write on the route and the tool', async () => {
    const rest = await call('POST', '/v1/ai/settings', pbAliceAg.token, { daily_budget_usd: 4 });
    assert(rest.status === 403, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_operator_ai_config', { daily_budget_usd: 4 });
    assert(tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B17 DECIDED (developer approval 2026-11-14): the agent that may set the budget reads it on the tool and GET /v1/ai/settings alike', async () => {
    const tool = await callTool(pbAiMcp, 'aimeat_operator_ai_config', {});
    assert(!tool.isError && tool.data.current.daily_budget_usd === 3, `tool: ${tool.text.slice(0, 300)}`);
    const rest = await call('GET', '/v1/ai/settings', pbAiAg.token);
    assert(rest.status === 200 && rest.body.data.daily_budget_usd === 3, `route: ${show(rest)}`);
});

await test('B17 REFUSED: alice\'s agent without memory:write-reserved, and bob\'s agent, cannot read alice\'s budget on the route', async () => {
    const mine = await call('GET', '/v1/ai/settings', pbAliceAg.token);
    assert(mine.status === 403, `alice's agent without the word: ${show(mine)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_operator_ai_config', {});
    assert(tool.isError, `tool, without the word: ${tool.text.slice(0, 200)}`);
    const bob = await call('GET', '/v1/ai/settings', pbBobAg.token);
    assert(bob.status === 403 || (bob.status === 200 && bob.body.data.daily_budget_usd !== 3), `bob's agent: ${show(bob)}`);
});

// B10: alice's private capability, read by bob's agent and the operator's agent. The operator's pass
// into another person's account writes a line on that person's account feed (services/operator-override.ts).
let pbCap = '';
const capReadTrail = async (): Promise<number> => {
    const r = await call('GET', '/v1/account/events?limit=200', pbAlice.token);
    assert(r.status === 200, `account events: ${show(r)}`);
    return (r.body.data.events as Body[]).filter(e => e.kind === 'operator_acted' && e.data?.area === 'capability' && e.data?.action === 'read').length;
};
await test('Setup (B10): alice in person makes a private capability', async () => {
    const r = await call('POST', '/v1/capabilities', pbAlice.token, { name: N('pbcap'), summary: 'phase B parity', visibility: 'private' });
    assert(r.status === 201, `capability: ${show(r)}`);
    pbCap = r.body.data.id;
});

await test('B10 REFUSED: bob\'s agent is answered "not found" for alice\'s private capability on the get and invoke routes and tools', async () => {
    const get = await call('GET', `/v1/capabilities/${pbCap}`, pbBobAg.token);
    assert(get.status === 404, `route get: ${show(get)}`);
    const inv = await call('POST', `/v1/capabilities/${pbCap}/invoke`, pbBobAg.token, { input: {} });
    assert(inv.status === 404, `route invoke: ${show(inv)}`);
    const tget = await callTool(pbBobMcp, 'aimeat_capabilities_get', { id: pbCap });
    assert(tget.isError && tget.text.startsWith('Capability not found'), `tool get: ${tget.text.slice(0, 200)}`);
    const tinv = await callTool(pbBobMcp, 'aimeat_capabilities_invoke', { id: pbCap, input: {} });
    assert(tinv.isError && tinv.text.startsWith('Capability not found'), `tool invoke: ${tinv.text.slice(0, 200)}`);
});

await test('B10 FIXED: the operator\'s agent reads alice\'s private capability on the route and the tool, and each read writes one operator line on alice\'s account feed', async () => {
    const before = await capReadTrail();
    const rest = await call('GET', `/v1/capabilities/${pbCap}`, pbOpWide.token);
    assert(rest.status === 200 && rest.body.data.id === pbCap, `route: ${show(rest)}`);
    const afterRest = await capReadTrail();
    assert(afterRest === before + 1, `route trail: ${before} -> ${afterRest}`);
    const tool = await callTool(pbOpWideMcp, 'aimeat_capabilities_get', { id: pbCap });
    assert(!tool.isError && tool.data.id === pbCap, `tool: ${tool.text.slice(0, 200)}`);
    const afterTool = await capReadTrail();
    assert(afterTool === afterRest + 1, `tool trail: ${afterRest} -> ${afterTool}`);
});

// B9: forking alice's app (not open for forking) and her app the operator hid, on POST
// /v1/apps/:owner/:filename/fork and aimeat_app_fork.
const PB_APP = `${N('pbapp')}.html`, PB_HIDDEN = `${N('pbhid')}.html`;
const pbHtml = (t: string) => Buffer.from(`<!doctype html><html><head><title>${t}</title></head><body>${t}</body></html>`).toString('base64');
const forkRoute = (owner: string, filename: string, token: string, newName: string) =>
    call('POST', `/v1/apps/${owner}/${encodeURIComponent(filename)}/fork`, token, { new_filename: newName });
await test('Setup (B9): alice in person publishes two apps; the operator hides the second', async () => {
    for (const f of [PB_APP, PB_HIDDEN]) {
        const p = await call('POST', '/v1/apps', pbAlice.token, { filename: f, content: pbHtml(f), mime_type: 'text/html', description: 'phase B parity' });
        assert(p.status === 201 || p.status === 200, `publish ${f}: ${show(p)}`);
    }
    const hide = await call('POST', `/v1/admin/apps/${pbAlice.name}/${encodeURIComponent(PB_HIDDEN)}/moderate`, op.token, { hidden: true, reason: 'phase B parity' });
    assert(hide.status === 200, `hide: ${show(hide)}`);
});

await test('B9 REFUSED: bob\'s agent may not fork alice\'s app on the route or the tool, and her hidden app is not found on either', async () => {
    const rest = await forkRoute(pbAlice.name, PB_APP, pbBobAg.token, `${N('pbf1')}.html`);
    assert(rest.status === 403, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_fork', { owner: pbAlice.name, filename: PB_APP, new_filename: `${N('pbf2')}.html` });
    assert(tool.isError && tool.text.includes('not open for forking'), `tool: ${tool.text.slice(0, 200)}`);
    const hidRest = await forkRoute(pbAlice.name, PB_HIDDEN, pbBobAg.token, `${N('pbf3')}.html`);
    assert(hidRest.status === 404, `route, hidden: ${show(hidRest)}`);
    const hidTool = await callTool(pbBobMcp, 'aimeat_app_fork', { owner: pbAlice.name, filename: PB_HIDDEN, new_filename: `${N('pbf4')}.html` });
    assert(hidTool.isError && hidTool.text.includes('not found'), `tool, hidden: ${hidTool.text.slice(0, 200)}`);
});

await test('B9 USE KEPT: alice\'s agent forks her own app on the route and the tool', async () => {
    const rest = await forkRoute(pbAlice.name, PB_APP, pbAliceAg.token, `${N('pbf5')}.html`);
    assert(rest.status === 201 || rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_app_fork', { owner: pbAlice.name, filename: PB_APP, new_filename: `${N('pbf6')}.html` });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B9 FIXED: alice\'s agent forks her own app the operator hid on the route and the tool alike', async () => {
    const rest = await forkRoute(pbAlice.name, PB_HIDDEN, pbAliceAg.token, `${N('pbf7')}.html`);
    assert(rest.status === 201 || rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_app_fork', { owner: pbAlice.name, filename: PB_HIDDEN, new_filename: `${N('pbf8')}.html` });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B9 FIXED: the operator\'s agent forks alice\'s app that is not open for forking on the route and the tool alike', async () => {
    const rest = await forkRoute(pbAlice.name, PB_APP, pbOpWide.token, `${N('pbf9')}.html`);
    assert(rest.status === 201 || rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbOpWideMcp, 'aimeat_app_fork', { owner: pbAlice.name, filename: PB_APP, new_filename: `${N('pbfa')}.html` });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

// B7: "my apps" (own) and "apps I help build" (building) asked by alice's agent and by the anonymous
// credential this node mints in anonymous mode, on GET /v1/apps and aimeat_app_list.
let pbAnonToken = '', pbAnonMcp: McpSession | null = null;
await test('Setup (B7): the anonymous credential (POST /v1/auth/anonymous) and an MCP session with it', async () => {
    const a = await call('POST', '/v1/auth/anonymous', undefined, {});
    assert(a.status === 200 || a.status === 201, `anonymous token: ${show(a)}`);
    pbAnonToken = a.body.data.token;
    pbAnonMcp = await openSession(BASE, pbAnonToken, 'u2b2 phase B anonymous');
});

await test('B7 USE KEPT: alice\'s agent lists her own apps on the route and the tool alike', async () => {
    const rest = await call('GET', '/v1/apps?own=true&limit=200', pbAliceAg.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const restNames = (rest.body.data.apps as Body[]).map(a => a.filename as string).sort();
    const tool = await callTool(pbAliceMcp, 'aimeat_app_list', { own: true, limit: 200 });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
    const toolNames = (tool.data.apps as Body[]).map(a => a.filename as string).sort();
    assert(restNames.includes(PB_APP) && JSON.stringify(restNames) === JSON.stringify(toolNames), `route ${restNames} / tool ${toolNames}`);
});

await test('B7 FIXED: the anonymous credential is refused own and building on the route (401) and the tool (UNAUTHORIZED) alike', async () => {
    for (const ask of ['own', 'building'] as const) {
        const rest = await call('GET', `/v1/apps?${ask}=true`, pbAnonToken);
        assert(rest.status === 401, `route ${ask}: ${show(rest)}`);
        const tool = await callTool(pbAnonMcp!, 'aimeat_app_list', { [ask]: true });
        assert(tool.isError && tool.text.startsWith('UNAUTHORIZED'), `tool ${ask}: ${tool.text.slice(0, 200)}`);
    }
});

// B12: the tool manifest of alice's listed app and of her hidden app, read by bob's agent on
// aimeat_app_tools_get, the WebMCP listing GET /v1/apps/:owner/:filename/webmcp and the raw record.
const PB_TOOL = { name: 'summarise', description: 'Summarises a text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } };
const webmcp = (filename: string, token: string) => call('GET', `/v1/apps/${pbAlice.name}/${encodeURIComponent(filename)}/webmcp`, token);
await test('Setup (B12): alice\'s agent publishes a tool manifest for her listed app and for her hidden app', async () => {
    for (const f of [PB_APP, PB_HIDDEN]) {
        const out = await callTool(pbAliceMcp, 'aimeat_app_tools_publish', { app_id: f, tools: [PB_TOOL] });
        assert(!out.isError, `publish ${f}: ${out.text.slice(0, 300)}`);
    }
});

await test('B12 USE KEPT: bob\'s agent reads the listed app\'s tools on the tool and the WebMCP listing alike', async () => {
    const rest = await webmcp(PB_APP, pbBobAg.token);
    assert(rest.status === 200 && (rest.body.tools as Body[]).some(t => t.name === PB_TOOL.name), `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_tools_get', { owner: pbAlice.name, app_id: PB_APP });
    assert(!tool.isError && JSON.stringify(tool.data.manifest).includes(PB_TOOL.name), `tool: ${tool.text.slice(0, 200)}`);
});

const rawManifest = (token: string) => call('GET', `/v1/memory/${encodeURIComponent(pbAlice.ghii)}/${encodeURIComponent(`apps.${PB_HIDDEN}.tools`)}`, token);
await test('B12 DECIDED (developer approval 2026-11-14): the hidden app\'s manifest is not found for bob\'s agent on the listing, aimeat_app_tools_get, the raw record, aimeat_memory_read_public and the discover list', async () => {
    const rest = await webmcp(PB_HIDDEN, pbBobAg.token);
    assert(rest.status === 404 && rest.body.error.code === 'APP_NOT_FOUND', `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_tools_get', { owner: pbAlice.name, app_id: PB_HIDDEN });
    // The hint names the owner's other manifests, never the hidden one.
    assert(tool.isError && tool.text.startsWith('APP_TOOLS_NOT_FOUND') && !(tool.text.split('publishes')[1] ?? '').includes(PB_HIDDEN), `tool: ${tool.text.slice(0, 300)}`);
    const raw = await rawManifest(pbBobAg.token);
    assert(raw.status === 404, `raw record: ${show(raw)}`);
    const pub = await callTool(pbBobMcp, 'aimeat_memory_read_public', { gaii: pbAlice.ghii, key: `apps.${PB_HIDDEN}.tools` });
    assert(pub.isError && pub.text === 'Memory entry not found', `read_public: ${pub.text.slice(0, 200)}`);
    const disc = await call('GET', `/v1/memory/discover?${q({ prefix: 'apps.', owner: pbAlice.name, limit: '200' })}`, pbBobAg.token);
    assert(disc.status === 200 && !disc.text.includes(`apps.${PB_HIDDEN}.tools`) && disc.text.includes(`apps.${PB_APP}.tools`), `discover: ${show(disc)}`);
});

await test('B12 USE KEPT: alice\'s agent and the operator\'s agent still read the hidden app\'s manifest on the tool and the raw record', async () => {
    for (const [ag, s] of [[pbAliceAg, pbAliceMcp], [pbOpWide, pbOpWideMcp]] as const) {
        const tool = await callTool(s, 'aimeat_app_tools_get', { owner: pbAlice.name, app_id: PB_HIDDEN });
        assert(!tool.isError && JSON.stringify(tool.data.manifest).includes(PB_TOOL.name), `tool ${ag.name}: ${tool.text.slice(0, 200)}`);
        const raw = await rawManifest(ag.token);
        assert(raw.status === 200 && raw.text.includes(PB_TOOL.name), `raw ${ag.name}: ${show(raw)}`);
    }
});

// B14: a public tool manifest that does not parse, invoked on aimeat_app_tool_invoke and
// POST /v1/apps/:owner/:filename/webmcp/tools/:tool.
const PB_BROKEN = `${N('pbbroken')}.html`;
await test('Setup (B14): alice in person writes a public tool manifest that does not parse', async () => {
    const w = await call('POST', '/v1/memory', pbAlice.token, { key: `apps.${PB_BROKEN}.tools`, value: { tools: 'not a list' }, visibility: 'public' });
    assert(w.status === 201 || w.status === 200, `write: ${show(w)}`);
});

await test('B14 DECIDED (developer approval 2026-11-14): a manifest that does not parse is INVALID_TOOL_MANIFEST on the route (422) and the tool alike', async () => {
    const rest = await call('POST', `/v1/apps/${pbAlice.name}/${encodeURIComponent(PB_BROKEN)}/webmcp/tools/summarise`, pbBobAg.token, { input: {} });
    assert(rest.status === 422 && rest.body.error.code === 'INVALID_TOOL_MANIFEST', `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_tool_invoke', { owner: pbAlice.name, app: PB_BROKEN, tool: 'summarise', input: {} });
    assert(tool.isError && tool.text.startsWith('INVALID_TOOL_MANIFEST'), `tool: ${tool.text.slice(0, 200)}`);
});

// B15: the links of a knowledge package on GET /v1/knowledge/:id/links and aimeat_knowledge_links.
const PB_PKG_PUBLIC = N('pbpkgpub'), PB_PKG_PRIVATE = N('pbpkgpriv');
let pbReaderAg!: McpAgent, pbReaderMcp!: McpSession;
const pkgLinks = (id: string, token: string) => call('GET', `/v1/knowledge/${id}/links`, token);
await test('Setup (B15): alice in person writes a public and a private package manifest; her agent holding memory:read and memory:read-as-owner', async () => {
    for (const [id, visibility] of [[PB_PKG_PUBLIC, 'public'], [PB_PKG_PRIVATE, 'private']] as const) {
        const w = await call('POST', '/v1/memory', pbAlice.token, { key: `packages/${id}/manifest`, value: { name: id, content_type: 'notes', entries: [] }, visibility, tags: ['knowledge-package'] });
        assert(w.status === 201 || w.status === 200, `manifest ${id}: ${show(w)}`);
    }
    pbReaderAg = await makeAgent(BASE, pbAlice, ['memory:read', 'memory:read-as-owner'], N('pbreader'));
    pbReaderMcp = await openSession(BASE, pbReaderAg.token, 'u2b2 phase B reader');
});

await test('B15 USE KEPT: alice\'s agents read the links of her public package on the route and the tool; alice in person reads both packages\' on the route', async () => {
    for (const [ag, s] of [[pbAliceAg, pbAliceMcp], [pbReaderAg, pbReaderMcp]] as const) {
        const rest = await pkgLinks(PB_PKG_PUBLIC, ag.token);
        assert(rest.status === 200, `route ${ag.name}: ${show(rest)}`);
        const tool = await callTool(s, 'aimeat_knowledge_links', { package_id: PB_PKG_PUBLIC });
        assert(!tool.isError, `tool ${ag.name}: ${tool.text.slice(0, 200)}`);
    }
    for (const id of [PB_PKG_PUBLIC, PB_PKG_PRIVATE]) {
        const mine = await pkgLinks(id, pbAlice.token);
        assert(mine.status === 200, `alice ${id}: ${show(mine)}`);
    }
});

await test('B15 REFUSED: alice\'s private package is not found for bob\'s agent, and for her agent without memory:read-as-owner, on both', async () => {
    for (const [ag, s] of [[pbBobAg, pbBobMcp], [pbAliceAg, pbAliceMcp]] as const) {
        const rest = await pkgLinks(PB_PKG_PRIVATE, ag.token);
        assert(rest.status === 404, `route ${ag.name}: ${show(rest)}`);
        const tool = await callTool(s, 'aimeat_knowledge_links', { package_id: PB_PKG_PRIVATE });
        assert(tool.isError && tool.text.startsWith('Package not found'), `tool ${ag.name}: ${tool.text.slice(0, 200)}`);
    }
});

await test('B15 DECIDED (developer approval 2026-11-14): alice\'s public package gives bob\'s agent its links on the route and the tool alike', async () => {
    const rest = await pkgLinks(PB_PKG_PUBLIC, pbBobAg.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_knowledge_links', { package_id: PB_PKG_PUBLIC });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B15 DECIDED (developer approval 2026-11-14): alice\'s private package gives the links to her agent holding memory:read-as-owner on the route and the tool alike', async () => {
    const rest = await pkgLinks(PB_PKG_PRIVATE, pbReaderAg.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbReaderMcp, 'aimeat_knowledge_links', { package_id: PB_PKG_PRIVATE });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

// B3: alice's wallet while one of her agents has work in flight, read by another of her agents on
// GET /v1/wallet and aimeat_wallet_balance.
const PB_ACTION = N('pbaction');
let pbWorker!: McpAgent, pbWorkerMcp!: McpSession;
await test('Setup (B3): bob\'s agent offers an action with a pacing amount; alice\'s worker agent asks for it, so its cost is held in escrow', async () => {
    const publish = await call('POST', '/v1/actions', pbBobAg.token, {
        id: PB_ACTION, display_name: 'Phase B probe', description: 'Holds a cost in escrow for the wallet sections',
        input_schema: { type: 'object', properties: { text: { type: 'string' } } },
        output_schema: { type: 'object', properties: { result: { type: 'string' } } },
        pricing: { toll_morsels: 10 },
    });
    assert(publish.status === 201, `action: ${show(publish)}`);
    pbWorker = await makeAgent(BASE, pbAlice, ['*'], N('pbworker'));
    pbWorkerMcp = await openSession(BASE, pbWorker.token, 'u2b2 phase B worker');
    const mint = await call('POST', '/v1/admin/mint', op.token, { gaii: pbWorker.gaii, amount: 100 });
    assert(mint.status === 200, `mint: ${show(mint)}`);
    const work = await call('POST', '/v1/work', pbWorker.token, { action_id: PB_ACTION, provider_gaii: pbBobAg.gaii, input: { text: 'probe' }, ttl_hours: 24 });
    assert(work.status === 201, `work: ${show(work)}`);
});

await test('B3 USE KEPT: the worker agent sees the same balance and escrow on the route and the tool', async () => {
    const rest = await call('GET', '/v1/wallet', pbWorker.token);
    assert(rest.status === 200 && rest.body.data.in_escrow > 0, `route: ${show(rest)}`);
    const tool = await callTool(pbWorkerMcp, 'aimeat_wallet_balance', {});
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
    assert(tool.data.balance === rest.body.data.balance && tool.data.in_escrow === rest.body.data.in_escrow,
        `tool ${JSON.stringify(tool.data)} / route balance ${rest.body.data.balance} escrow ${rest.body.data.in_escrow}`);
});

await test('B3 FIXED: another of alice\'s agents sees the escrow of the shared wallet on the route and the tool alike', async () => {
    const rest = await call('GET', '/v1/wallet', pbAliceAg.token);
    assert(rest.status === 200 && rest.body.data.in_escrow > 0, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_wallet_balance', {});
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
    assert(tool.data.in_escrow === rest.body.data.in_escrow && tool.data.available === rest.body.data.available,
        `tool ${JSON.stringify(tool.data)} / route escrow ${rest.body.data.in_escrow} available ${rest.body.data.available}`);
});

// B18: alice's transactions on aimeat_wallet_transactions and GET /v1/wallet/transactions (the route the
// connector's copy of the tool calls, with `limit`).
await test('Setup (B18): the operator mints alice 25 single morsels, so her ledger holds more than either default page', async () => {
    for (let i = 0; i < 25; i++) {
        const mint = await call('POST', '/v1/admin/mint', op.token, { gaii: pbWorker.gaii, amount: 1 });
        assert(mint.status === 200, `mint ${i}: ${show(mint)}`);
    }
});

await test('B18 USE KEPT: the tool and the route list the same newest transactions for the worker agent', async () => {
    const rest = await call('GET', '/v1/wallet/transactions?per_page=10', pbWorker.token);
    assert(rest.status === 200 && rest.body.data.transactions.length === 10, `route: ${show(rest)}`);
    const tool = await callTool(pbWorkerMcp, 'aimeat_wallet_transactions', { limit: 10 });
    assert(!tool.isError && Array.isArray(tool.data) && tool.data.length === 10, `tool: ${tool.text.slice(0, 200)}`);
    const ids = (xs: Body[]) => xs.map(t => t.id as string).sort().join(',');
    assert(ids(tool.data) === ids(rest.body.data.transactions), 'the two pages hold different transactions');
});

await test('B18 DECIDED (developer approval 2026-11-14): limit=5 gives five on the tool and the route alike; each keeps its own default (tool 20, route 50)', async () => {
    const tool = await callTool(pbWorkerMcp, 'aimeat_wallet_transactions', {});
    assert(!tool.isError && tool.data.length === 20, `tool default: ${tool.data.length}`);
    const tool5 = await callTool(pbWorkerMcp, 'aimeat_wallet_transactions', { limit: 5 });
    assert(!tool5.isError && tool5.data.length === 5, `tool limit 5: ${tool5.data.length}`);
    const rest = await call('GET', '/v1/wallet/transactions', pbWorker.token);
    const total = rest.body.data.total as number;
    assert(rest.status === 200 && total > 25 && rest.body.data.transactions.length === Math.min(50, total), `route default: ${show(rest)}`);
    const rest5 = await call('GET', '/v1/wallet/transactions?limit=5', pbWorker.token);
    assert(rest5.status === 200 && rest5.body.data.transactions.length === 5, `route limit 5: ${rest5.body.data.transactions.length}`);
});

// B2: alice's agent reads its own message history, GET /v1/agents/:name/messages and aimeat_message_history.
await test('B2 USE KEPT: per_page=5 is answered on the route and the tool', async () => {
    const rest = await call('GET', `/v1/agents/${pbAliceAg.name}/messages?per_page=5`, pbAliceAg.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_message_history', { per_page: 5 });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B2 RECORDED DIFFERENCE (question: is a page past 100 clamped or refused): per_page=150, the route answers with at most 100 and the tool refuses the input', async () => {
    const rest = await call('GET', `/v1/agents/${pbAliceAg.name}/messages?per_page=150`, pbAliceAg.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_message_history', { per_page: 150 });
    assert(tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

// B4: an agent's profile, GET /v1/agents/:gaii and aimeat_agent_profile.
await test('B4 RECORDED DIFFERENCE (question: should reading a profile recompute and store the trust score): bob\'s agent reads alice\'s worker; the route recomputes and writes the score, the tool reads the stored one, and only the tool lists skills, only the route counts published actions', async () => {
    const before = await callTool(pbBobMcp, 'aimeat_agent_profile', { gaii: pbWorker.gaii });
    assert(!before.isError && before.data.gaii === pbWorker.gaii && Array.isArray(before.data.skills), `tool: ${before.text.slice(0, 200)}`);
    const rest = await call('GET', `/v1/agents/${encodeURIComponent(pbWorker.gaii)}`, pbBobAg.token);
    assert(rest.status === 200 && rest.body.data.gaii === pbWorker.gaii, `route: ${show(rest)}`);
    assert(typeof rest.body.data.trust?.score === 'number' && !('skills' in rest.body.data), `route shape: ${show(rest)}`);
    const after = await callTool(pbBobMcp, 'aimeat_agent_profile', { gaii: pbWorker.gaii });
    // A fresh agent's stored score is the default; the route's computed one differs, and the tool shows
    // that only after a route read has stored it.
    assert(before.data.trust_score !== rest.body.data.trust.score, `the tool's stored score before the route read: ${before.data.trust_score} / ${rest.body.data.trust.score}`);
    assert(after.data.trust_score === rest.body.data.trust.score, `the tool reads what the route stored: ${after.data.trust_score} / ${rest.body.data.trust.score}`);
});

await test('B4 USE KEPT: an agent that does not exist is not found on both', async () => {
    const missing = `nobody#${pbAlice.name}@${pbAlice.ghii.split('@')[1]}`;
    const rest = await call('GET', `/v1/agents/${encodeURIComponent(missing)}`, pbBobAg.token);
    assert(rest.status === 404, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_agent_profile', { gaii: missing });
    assert(tool.isError && tool.text === 'Agent not found', `tool: ${tool.text.slice(0, 200)}`);
});

// B5: the worker agent's own memory keys on the agent-memory resource list and GET /v1/memory.
await test('B5 USE KEPT: the worker agent\'s own records are listed alike on the resource and the route', async () => {
    for (const k of ['a', 'b', 'c']) {
        const w = await call('POST', '/v1/memory', pbWorker.token, { key: `${N('pbown')}.${k}`, value: { k }, visibility: 'private' });
        assert(w.status === 201 || w.status === 200, `write ${k}: ${show(w)}`);
    }
    const list = await mcpRpc(pbWorkerMcp, 'resources/list', {});
    const fromResource = ((list?.result?.resources ?? []) as Body[]).map(r => r.name as string).filter(n => n.startsWith(N('pbown'))).sort();
    const rest = await call('GET', `/v1/memory?${q({ prefix: N('pbown') })}`, pbWorker.token);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const entries = rest.body.data.items as Body[];
    const fromRoute = entries.map(e => e.key as string).sort();
    assert(fromResource.length === 3 && JSON.stringify(fromResource) === JSON.stringify(fromRoute), `resource ${fromResource} / route ${fromRoute} (${show(rest)})`);
});

// B8: one app read by GET /v1/apps/:owner/:filename (serves the app) and aimeat_app_get (its detail).
const PB_CODED = `${N('pbcode')}.html`, PB_CODE = 'pb-parity-code-42';
const appRoute = (filename: string, token: string, code?: string) =>
    call('GET', `/v1/apps/${pbAlice.name}/${encodeURIComponent(filename)}${code ? `?code=${encodeURIComponent(code)}` : ''}`, token);
await test('Setup (B8): alice in person publishes an app behind an access code', async () => {
    const p = await call('POST', '/v1/apps', pbAlice.token, { filename: PB_CODED, content: pbHtml(PB_CODED), mime_type: 'text/html', description: 'phase B parity', access_code: PB_CODE });
    assert(p.status === 201 || p.status === 200, `publish: ${show(p)}`);
});

await test('B8 USE KEPT: bob\'s agent opens alice\'s listed app on the route and reads its detail on the tool', async () => {
    const rest = await appRoute(PB_APP, pbBobAg.token);
    assert(rest.status === 200, `route: ${rest.status} ${rest.text.slice(0, 200)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_get', { owner: pbAlice.name, filename: PB_APP });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B8 REFUSED: alice\'s hidden app is not found for bob\'s agent on both; the operator\'s agent reads it on both', async () => {
    const rest = await appRoute(PB_HIDDEN, pbBobAg.token);
    assert(rest.status === 404, `route: ${show(rest)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_get', { owner: pbAlice.name, filename: PB_HIDDEN });
    assert(tool.isError && tool.text.includes('not found'), `tool: ${tool.text.slice(0, 200)}`);
    const opRest = await appRoute(PB_HIDDEN, pbOpWide.token);
    assert(opRest.status === 200, `operator, route: ${opRest.status} ${opRest.text.slice(0, 200)}`);
    const opTool = await callTool(pbOpWideMcp, 'aimeat_app_get', { owner: pbAlice.name, filename: PB_HIDDEN });
    assert(!opTool.isError, `operator, tool: ${opTool.text.slice(0, 200)}`);
});

await test('B8 RECORDED DIFFERENCE (question: should aimeat_app_get take the access code the route takes): bob\'s agent holding the code opens alice\'s coded app on the route, and the tool, which has no code, answers not found', async () => {
    const without = await appRoute(PB_CODED, pbBobAg.token);
    assert(without.status === 403, `route without the code: ${show(without)}`);
    const rest = await appRoute(PB_CODED, pbBobAg.token, PB_CODE);
    assert(rest.status === 200, `route with the code: ${rest.status} ${rest.text.slice(0, 200)}`);
    const tool = await callTool(pbBobMcp, 'aimeat_app_get', { owner: pbAlice.name, filename: PB_CODED });
    assert(tool.isError && tool.text.includes('not found'), `tool: ${tool.text.slice(0, 200)}`);
});

await test('B8 USE KEPT: alice\'s agent reads her coded app on the route and the tool without the code', async () => {
    const rest = await appRoute(PB_CODED, pbAliceAg.token);
    assert(rest.status === 200, `route: ${rest.status} ${rest.text.slice(0, 200)}`);
    const tool = await callTool(pbAliceMcp, 'aimeat_app_get', { owner: pbAlice.name, filename: PB_CODED });
    assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
});

await test('B7 USE KEPT: the anonymous credential lists the catalogue on the route and the tool', async () => {
    const rest = await call('GET', '/v1/apps', pbAnonToken);
    assert(rest.status === 200, `route: ${show(rest)}`);
    const tool = await callTool(pbAnonMcp!, 'aimeat_app_list', {});
    assert(!tool.isError && Array.isArray(tool.data.apps), `tool: ${tool.text.slice(0, 200)}`);
});

await test('Cleanup (phase B): alice\'s and bob\'s accounts deleted', async () => {
    const left: string[] = [];
    for (const who of [pbAlice, pbBob]) {
        if (!who) continue;
        const gone = await call('DELETE', `/v1/owners/${who.name}`, who.token);
        if (gone.body?.ok !== true) left.push(`${who.name}: ${gone.status}`);
    }
    assert(left.length === 0, `accounts not deleted: ${left.join(', ')}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

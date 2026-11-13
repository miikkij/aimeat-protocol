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
 *     JOIN-PRIVATE   joining a private organism with an open join policy (a question: the tool
 *                    answers it not found on purpose).
 *     BOARD-MEMBERS  an owner's agent holding social:members changes a shared board's reader list
 *                    (a question: REST takes the owner in person only, the tool admits the agent on
 *                    purpose).
 *   The operator (the suite's first account) turns classification on for the FILES section only and
 *   off again at its end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-tool-route-parity
 * @version-history
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

await test('DIFFERS TODAY (a question, not a defect): POST /v1/organisms/:id/join and aimeat_organism_join answer bob\'s agent alike', async () => {
    // Both agents hold social:write, the word both surfaces ask for a join, so neither answer is a scope refusal.
    const restAgent = await makeAgent(BASE, bob, ['organism:read', 'organism:write', 'social:write'], N('jprest'));
    const rest = await call('POST', `/v1/organisms/${jpOrg}/join`, restAgent.token, {});
    const toolAgent = await makeAgent(BASE, carol, ['organism:read', 'organism:write', 'social:write'], N('jptool'));
    const tool = await callTool(await openSession(BASE, toolAgent.token, 'u2b-join'), 'aimeat_organism_join', { organism_id: jpOrg });
    // The outcome is compared, not a status: a direct join and a join request are both an admission.
    assert((rest.body.ok === true) === !tool.isError, `REST ${show(rest)} vs tool ${tool.text.slice(0, 200)}`);
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

await test('DIFFERS TODAY (a question, not a defect): PATCH /v1/boards/:id/members and aimeat_board_members answer alice\'s agent alike', async () => {
    const add = `ext-${stamp}#someone@aimeat-fi-001-test`;
    const rest = await call('PATCH', `/v1/boards/${bmBoard}/members`, bmAgent.token, { add: [add] });
    const tool = await callTool(await openSession(BASE, bmAgent.token, 'u2b-board-members'), 'aimeat_board_members', { board_id: bmBoard, add: [add] });
    assert((rest.status === 200) === !tool.isError, `REST ${show(rest)} vs tool ${tool.text.slice(0, 200)}`);
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

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

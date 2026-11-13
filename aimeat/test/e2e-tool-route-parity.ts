/**
 * @file test/e2e-tool-route-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for seven places where an MCP tool and the REST route beside it answered the same
 *   caller differently (structure programme 2026-11, unit 7). Each section holds the refused case and
 *   the designed use of the same path. A section headed RECORDED states today's answer of a
 *   difference whose fix waits for the developer's decision; it changes when he decides.
 *     APPROVALS  POST /v1/organisms/:id/approvals: a caller that is not the person in person does not
 *                choose who may resolve its request (approverRole), as it does not lower `risk`; the
 *                person's own word stands, and an agent following a flow gate takes the gate's role.
 *     DISCOVER   aimeat_discover decides with the session's permissions, as GET /v1/discover does,
 *                never with a longer list on the agent's record.
 *     ROSTER     aimeat_organism_members names no agent when the roster is hidden from the caller,
 *                as GET /v1/organisms/:id/members does; a caller who sees the roster sees the agents.
 *     BARRED     GET /v1/organisms?member=<self> leaves out, for an agent, an organism that does not
 *                admit it, as aimeat_organism_list does; the owner and an admitted agent see it.
 *     WS-ROLE    RECORDED: an agent attached to an organism manages a workspace with its owner's
 *                creator role over MCP and is a plain member on REST.
 *     GROUPS     RECORDED: aimeat_group_list and aimeat_group_get show an agent its owner's sharing
 *                groups, which GET /v1/groups and GET /v1/groups/:id do not.
 *     FILES      GET /v1/memory/files lists to an agent only the files its classification reader
 *                shows, as the download beside it and the MCP storage resource do.
 *   The operator (the suite's first account) turns classification on for the FILES section only and
 *   off again at its end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-tool-route-parity
 * @version-history
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
console.log('\nWS-ROLE (RECORDED, decision open): an attached agent and its owner\'s role');

let roleOrg = '', bobWs = '';
let attached!: McpAgent, attachedMcp!: McpSession, sibling!: McpAgent;
await test('Setup: alice\'s organism; bob a member who creates a workspace; one of alice\'s agents attached, one not', async () => {
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
});

await test('RECORDED: the attached agent lists the members of bob\'s workspace over MCP (its owner\'s creator role)', async () => {
    const r = await callTool(attachedMcp, 'aimeat_workspace_members', { organism_id: roleOrg, ws: bobWs });
    assert(!r.isError, `MCP: ${r.text.slice(0, 300)}`);
});

await test('RECORDED: the same agent is refused the same list on REST (a plain member there)', async () => {
    const r = await call('GET', `/v1/organisms/${roleOrg}/workspace-access?${q({ ws: bobWs })}`, attached.token);
    assert(r.status === 403, `REST: ${show(r)}`);
});

await test('RECORDED: alice\'s agent that is not attached reads the same list on REST (its owner\'s role)', async () => {
    const r = await call('GET', `/v1/organisms/${roleOrg}/workspace-access?${q({ ws: bobWs })}`, sibling.token);
    assert(r.status === 200, `REST, not attached: ${show(r)}`);
});

// ─── GROUPS ───
console.log('\nGROUPS (RECORDED, decision open): the owner\'s sharing groups and the owner\'s agent');

let groupId = '';
let reader!: McpAgent, readerMcp!: McpSession;
await test('Setup: alice in person makes a sharing group; her agent holds memory:read', async () => {
    const g = await call('POST', '/v1/groups', alice.token, { name: N('group') });
    assert(g.status === 201, `group: ${show(g)}`);
    groupId = g.body.data.group.id;
    reader = await makeAgent(BASE, alice, ['memory:read'], N('reader'));
    readerMcp = await openSession(BASE, reader.token, 'u7 reader');
});

await test('RECORDED: aimeat_group_list and aimeat_group_get show the agent its owner\'s group', async () => {
    const list = await callTool(readerMcp, 'aimeat_group_list', {});
    assert(!list.isError && list.text.includes(groupId), `list: ${list.text.slice(0, 300)}`);
    const one = await callTool(readerMcp, 'aimeat_group_get', { group_id: groupId });
    assert(!one.isError && one.text.includes(groupId), `get: ${one.text.slice(0, 300)}`);
});

await test('RECORDED: GET /v1/groups leaves the group out for the agent, and GET /v1/groups/:id answers 403', async () => {
    const list = await call('GET', '/v1/groups', reader.token);
    assert(list.status === 200 && !list.text.includes(groupId), `list: ${show(list)}`);
    const one = await call('GET', `/v1/groups/${groupId}`, reader.token);
    assert(one.status === 403, `get: ${show(one)}`);
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

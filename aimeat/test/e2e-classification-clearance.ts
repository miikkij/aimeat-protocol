/**
 * @file test/e2e-classification-clearance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for an agent's clearance (plan doc-mvdipuyqraas, L2): the highest classification
 *   an agent may read. Asserted over REST and the node MCP, with classification on for every owner:
 *     - an agent whose clearance is Internal no longer reads a Confidential memory record (list,
 *       search, read, MCP read), a Confidential file, a workspace record that is Confidential only
 *       through its workspace's label, or a board post that is Confidential only through its board's
 *       label; each was read before (positive control), and the owner still reads them all;
 *     - what was kept from the agent is counted in the owner's classification log as refused, with
 *       the purpose `clearance`, not listed;
 *     - the refusals: an agent cannot change its own clearance (403, REST and MCP), an agent with
 *       agent:permissions cannot raise another agent's or remove it (403 PERSON_REQUIRED), another
 *       owner cannot set it (403), an agent without agent:permissions cannot set it (403);
 *     - an agent with agent:permissions lowers another agent's clearance, over REST and through
 *       aimeat_operator_agent_configure (propose, then confirm); the owner in person raises it;
 *     - the node's classification.agent_clearance_default gives a new agent its clearance.
 *   The operator (the suite's first account) turns classification on for every owner and sets the
 *   start value back and the switch off at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=classification-clearance
 * @version-history
 *   v1.0.1 — 2026-10-18 — The setup takes the default audience caps off, which a new node carries from
 *     plan doc-mvdipuyqraas L5.1; the suite tests the clearance, not the caps.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2.1-L2.4).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
/** One request. `method` is always written out by the caller, so a refusal test names what it refuses. */
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });
const setStart = (value: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.agent_clearance_default', value }] });
const setLabelAs = (token: string, target: Record<string, string>, label: string) => call('PUT', '/v1/classification/label', token, { ...target, label });
const clearanceOf = async (name: string): Promise<string | null | undefined> => {
    const r = await call('GET', '/v1/agents', alice.token);
    assert(r.status === 200, `agents list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.agents as Body[]).find(a => a.name === name)?.clearance;
};

console.log('\n=== An agent\'s clearance: the highest classification it may read (plan doc-mvdipuyqraas, L2) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner;
let bot!: McpAgent, helper!: McpAgent, plain!: McpAgent;
let botMcp!: McpSession, helperMcp!: McpSession;
let orgId = '', ws = '', boardId = '';
const SECRET = `clr.secret.${stamp}`;
const INTERNAL = `clr.internal.${stamp}`;
const FILE = `clr-${stamp}.txt`;
const WORD = `clearanceword${stamp}`;
const MANIFEST = { manifestVersion: '1', name: 'Plans', kind: 'project',
    objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' }] };

const memoryKeys = async (token: string): Promise<string[]> => {
    const r = await call('GET', `/v1/memory?${q({ prefix: 'clr.' })}`, token);
    assert(r.status === 200, `memory list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const list = (r.body.data.memories ?? r.body.data.items ?? r.body.data.records ?? []) as Body[];
    return list.map(m => m.key as string);
};
const searchKeys = async (token: string): Promise<string[]> => {
    const r = await call('GET', `/v1/memory/search?${q({ q: WORD })}`, token);
    assert(r.status === 200, `memory search: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return ((r.body.data.results ?? r.body.data.memories ?? []) as Body[]).map(m => (m.key ?? m.memory?.key) as string);
};
const records = async (token: string): Promise<string[]> => {
    const r = await call('GET', `/v1/organisms/${orgId}/workspace/records?${q({ ws, space: 'item' })}`, token);
    assert(r.status === 200, `records: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.records as Body[]).map(x => x.id as string);
};
const posts = async (token: string): Promise<number> => {
    const r = await call('GET', `/v1/boards/${boardId}/posts`, token);
    assert(r.status === 200, `posts: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.posts as Body[]).length;
};

await test('Setup: classification on for everyone; alice\'s agent keeps a Confidential and an Internal record and a Confidential file; a Confidential workspace and board hold public content', async () => {
    op = await registerOwner(BASE, `clrop${stamp}`);
    alice = await registerOwner(BASE, `clralice${stamp}`);
    bob = await registerOwner(BASE, `clrbob${stamp}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    // The suite keeps public content in classified containers; a new node's default caps would refuse it.
    await takeOffAudienceCaps(BASE, op.token);
    bot = await makeAgent(BASE, alice, ['*'], `clrbot${stamp % 100000}`);
    helper = await makeAgent(BASE, alice, ['*', 'agent:permissions'], `clrhelp${stamp % 100000}`);
    plain = await makeAgent(BASE, alice, ['*'], `clrplain${stamp % 100000}`);
    botMcp = await openSession(BASE, bot.token, 'clearance bot');
    helperMcp = await openSession(BASE, helper.token, 'clearance helper');
    assert(await clearanceOf(bot.name) === null, `a new agent has no limit by default: ${await clearanceOf(bot.name)}`);

    for (const [key, label] of [[SECRET, 'luottamuksellinen'], [INTERNAL, 'sisainen']] as const) {
        const w = await call('POST', '/v1/memory', bot.token, { key, value: { note: `${WORD} ${label}` }, visibility: 'private' });
        assert(w.status === 201 || w.status === 200, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const l = await setLabelAs(alice.token, { kind: 'memory', key, owner: bot.gaii }, label);
        assert(l.status === 200 && l.body.data.applied === true, `label ${key}: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    }
    const up = await call('POST', '/v1/storage', bot.token, { key: FILE, data: Buffer.from('confidential notes').toString('base64'), mime_type: 'text/plain', visibility: 'private' });
    assert(up.status === 201 || up.status === 200, `upload: ${up.status} ${JSON.stringify(up.body?.error)}`);
    const fl = await setLabelAs(alice.token, { kind: 'file', key: FILE, owner: bot.gaii }, 'luottamuksellinen');
    assert(fl.status === 200 && fl.body.data.applied === true, `file label: ${fl.status} ${JSON.stringify(fl.body?.error ?? fl.body?.data)}`);

    const o = await call('POST', '/v1/organisms', alice.token, { name: `Clearance ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Plans', manifest: MANIFEST });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const p = await call('POST', `/v1/organisms/${orgId}/workspace/records/publish`, alice.token, { ws, namespace: 'shared.items', records: [{ id: 'r1', value: { name: 'record r1' } }] });
    assert(p.status === 200 && p.body.data.published === 1, `publish: ${p.status} ${JSON.stringify(p.body?.data ?? p.body?.error)}`);
    const own = await setLabelAs(alice.token, { kind: 'memory', key: `organism.${orgId}.w.${ws}.shared.items.r1` }, 'julkinen');
    assert(own.status === 200, `record public: ${own.status} ${JSON.stringify(own.body?.error)}`);
    const wl = await setLabelAs(alice.token, { kind: 'workspace', organism_id: orgId, ws }, 'luottamuksellinen');
    assert(wl.status === 200 && wl.body.data.applied === true, `workspace label: ${wl.status} ${JSON.stringify(wl.body?.error ?? wl.body?.data)}`);

    const b = await call('POST', '/v1/boards', alice.token, { name: `Clearance board ${stamp}`, visibility: 'shared' });
    assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
    boardId = b.body.data.id;
    const bp = await call('POST', `/v1/boards/${boardId}/posts`, alice.token, { title: 'Plan', body: 'The plan for the quarter.' });
    assert(bp.status === 201, `post: ${bp.status} ${JSON.stringify(bp.body?.error)}`);
    const bl = await setLabelAs(alice.token, { kind: 'board', board_id: boardId }, 'luottamuksellinen');
    assert(bl.status === 200 && bl.body.data.applied === true, `board label: ${bl.status} ${JSON.stringify(bl.body?.error ?? bl.body?.data)}`);
});

// ─── 1. Before: the agent reads everything ───
console.log('\nPositive control: with no clearance the agent reads every item');

await test('POSITIVE CONTROL: with no limit the agent lists, searches and reads the Confidential record, the file, the workspace record and the board post', async () => {
    assert((await memoryKeys(bot.token)).includes(SECRET), 'list');
    assert((await searchKeys(bot.token)).includes(SECRET), 'search');
    const one = await call('GET', `/v1/memory/${encodeURIComponent(SECRET)}`, bot.token);
    assert(one.status === 200, `read: ${one.status}`);
    const file = await call('GET', `/v1/storage/${encodeURIComponent(FILE)}?mode=handle`, bot.token);
    assert(file.status === 200, `file: ${file.status} ${JSON.stringify(file.body?.error)}`);
    assert((await records(bot.token)).includes('r1'), 'workspace record');
    assert(await posts(bot.token) === 1, 'board post');
    const wsMcp = await callTool(botMcp, 'aimeat_workspace_read', { organism_id: orgId, ws, ids: ['r1'] });
    assert(!wsMcp.isError && wsMcp.text.includes('record r1'), `node MCP workspace read: ${wsMcp.text.slice(0, 300)}`);
    const boardMcp = await callTool(botMcp, 'aimeat_board_read', { board_id: boardId });
    assert(!boardMcp.isError && boardMcp.text.includes('The plan for the quarter'), `node MCP board read: ${boardMcp.text.slice(0, 300)}`);
});

// ─── 2. The owner sets Internal ───
console.log('\nThe owner sets the agent\'s clearance to Internal');

await test('The owner in person sets the clearance to Internal; the agent list says so', async () => {
    const r = await call('PATCH', `/v1/agents/${bot.name}/clearance`, alice.token, { clearance: 'sisainen' });
    assert(r.status === 200 && r.body.data.clearance === 'sisainen' && r.body.data.clearance_label?.name?.en === 'Internal' && r.body.data.changed === true,
        `set: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(await clearanceOf(bot.name) === 'sisainen', 'the list carries it');
});

await test('READER: the Confidential record is gone from the agent\'s list, search, read and MCP read; the Internal one stays', async () => {
    const keys = await memoryKeys(bot.token);
    assert(!keys.includes(SECRET) && keys.includes(INTERNAL), `list: ${JSON.stringify(keys)}`);
    const found = await searchKeys(bot.token);
    assert(!found.includes(SECRET) && found.includes(INTERNAL), `search: ${JSON.stringify(found)}`);
    const one = await call('GET', `/v1/memory/${encodeURIComponent(SECRET)}`, bot.token);
    assert(one.status === 404, `read: ${one.status}`);
    const mcp = await callTool(botMcp, 'aimeat_memory_read', { key: SECRET });
    assert(mcp.isError || !mcp.text.includes(WORD), `node MCP read: ${mcp.text.slice(0, 300)}`);
    const ok = await callTool(botMcp, 'aimeat_memory_read', { key: INTERNAL });
    assert(!ok.isError && ok.text.includes(WORD), `node MCP read of the Internal record: ${ok.text.slice(0, 300)}`);
});

await test('READER: the Confidential file does not download; the workspace record and the board post, Confidential through their container, are not shown', async () => {
    const file = await call('GET', `/v1/storage/${encodeURIComponent(FILE)}?mode=handle`, bot.token);
    assert(file.status === 404, `file: ${file.status}`);
    assert(!(await records(bot.token)).includes('r1'), 'the workspace record still shows');
    assert(await posts(bot.token) === 0, 'the board post still shows');
    const mcp = await callTool(botMcp, 'aimeat_board_read', { board_id: boardId });
    assert(!mcp.isError && !mcp.text.includes('The plan for the quarter'), `node MCP board read: ${mcp.text.slice(0, 300)}`);
    const ws2 = await callTool(botMcp, 'aimeat_workspace_read', { organism_id: orgId, ws, ids: ['r1'] });
    // The workspace's manifest is Confidential through the same label, so the whole workspace reads
    // as absent to this agent: either an empty answer or "no manifest", never the record.
    assert(!ws2.text.includes('record r1') && (!ws2.isError || /No manifest/.test(ws2.text)), `node MCP workspace read: ${ws2.text.slice(0, 300)}`);
});

await test('The owner still reads all of it, and her log counts what was kept from the agent as refused for its clearance', async () => {
    assert((await records(alice.token)).includes('r1'), 'the owner reads the record');
    assert(await posts(alice.token) === 1, 'the owner reads the post');
    const log = await call('GET', `/v1/classification/audit?${q({ level: 'owner', action: 'refused' })}`, alice.token);
    assert(log.status === 200, `audit: ${log.status} ${JSON.stringify(log.body?.error)}`);
    const rows = (log.body.data.rows as Body[]).filter(r => String(r.purpose ?? '').includes('clearance'));
    assert(rows.some(r => r.key === SECRET), `a refused row for the record: ${JSON.stringify(log.body.data.rows).slice(0, 600)}`);
    assert(rows.some(r => r.key === FILE), `a refused row for the file: ${JSON.stringify(rows).slice(0, 600)}`);
});

// ─── 3. Who may change it ───
console.log('\nWho may change it: never the agent itself, an agent only lower, the owner in person any way');

await test('DENIAL: the agent cannot raise or remove its own clearance, over REST (403) or MCP; it stays Internal', async () => {
    const rest = await call('PATCH', `/v1/agents/${bot.name}/clearance`, bot.token, { clearance: null });
    assert(rest.status === 403, `REST, its own: ${rest.status} ${JSON.stringify(rest.body?.error)}`);
    const raise = await call('PATCH', `/v1/agents/${helper.name}/clearance`, helper.token, { clearance: 'luottamuksellinen' });
    assert(raise.status === 403 && raise.body?.error?.code === 'ACCESS_DENIED', `REST, the helper its own: ${raise.status} ${JSON.stringify(raise.body?.error)}`);
    const mcp = await callTool(botMcp, 'aimeat_operator_agent_configure', { agent_name: bot.name, clearance: 'erittain-luottamuksellinen' });
    assert(mcp.isError, `node MCP, its own: ${mcp.text.slice(0, 300)}`);
    assert(await clearanceOf(bot.name) === 'sisainen', 'unchanged');
});

await test('DENIAL: an agent with agent:permissions cannot raise another agent\'s clearance or remove it (403 PERSON_REQUIRED); one without it cannot set it (403)', async () => {
    const raise = await call('PATCH', `/v1/agents/${bot.name}/clearance`, helper.token, { clearance: 'luottamuksellinen' });
    assert(raise.status === 403 && raise.body?.error?.code === 'PERSON_REQUIRED', `raise: ${raise.status} ${JSON.stringify(raise.body?.error)}`);
    const remove = await call('PATCH', `/v1/agents/${bot.name}/clearance`, helper.token, { clearance: null });
    assert(remove.status === 403 && remove.body?.error?.code === 'PERSON_REQUIRED', `remove: ${remove.status} ${JSON.stringify(remove.body?.error)}`);
    const noWord = await call('PATCH', `/v1/agents/${bot.name}/clearance`, plain.token, { clearance: 'julkinen' });
    assert(noWord.status === 403, `without agent:permissions: ${noWord.status} ${JSON.stringify(noWord.body?.error)}`);
    assert(await clearanceOf(bot.name) === 'sisainen', 'unchanged');
});

await test('DENIAL: another owner cannot set an agent\'s clearance (403)', async () => {
    const r = await call('PATCH', `/v1/agents/${encodeURIComponent(bot.gaii)}/clearance`, bob.token, { clearance: null });
    assert(r.status === 403, `bob: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(await clearanceOf(bot.name) === 'sisainen', 'unchanged');
});

await test('An agent with agent:permissions lowers another agent\'s clearance over REST, and through aimeat_operator_agent_configure (propose, then confirm)', async () => {
    const r = await call('PATCH', `/v1/agents/${plain.name}/clearance`, helper.token, { clearance: 'luottamuksellinen' });
    assert(r.status === 200 && r.body.data.clearance === 'luottamuksellinen' && r.body.data.from === null, `REST: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    const proposal = await callTool(helperMcp, 'aimeat_operator_agent_configure', { agent_name: bot.name, clearance: 'julkinen' });
    assert(!proposal.isError && proposal.data?.mode === 'proposal' && typeof proposal.data?.confirm_token === 'string'
        && proposal.data?.diff?.clearance?.to === 'julkinen', `propose: ${proposal.text.slice(0, 300)}`);
    assert(await clearanceOf(bot.name) === 'sisainen', 'a proposal changes nothing');
    const applied = await callTool(helperMcp, 'aimeat_operator_agent_configure', { agent_name: bot.name, clearance: 'julkinen', confirm_token: proposal.data.confirm_token });
    assert(!applied.isError && applied.data?.mode === 'applied' && applied.data?.current?.clearance === 'julkinen', `confirm: ${applied.text.slice(0, 300)}`);
    assert(await clearanceOf(bot.name) === 'julkinen', 'lowered');
    const raiseMcp = await callTool(helperMcp, 'aimeat_operator_agent_configure', { agent_name: bot.name, clearance: 'sisainen' });
    assert(raiseMcp.isError && raiseMcp.text.includes('PERSON_REQUIRED'), `node MCP raise: ${raiseMcp.text.slice(0, 300)}`);
});

await test('The owner in person raises it again and removes it; the agent reads the Confidential record once more', async () => {
    const up = await call('PATCH', `/v1/agents/${bot.name}/clearance`, alice.token, { clearance: 'luottamuksellinen' });
    assert(up.status === 200 && up.body.data.clearance === 'luottamuksellinen', `raise: ${up.status} ${JSON.stringify(up.body?.data ?? up.body?.error)}`);
    assert((await memoryKeys(bot.token)).includes(SECRET), 'the agent reads it at Confidential');
    const none = await call('PATCH', `/v1/agents/${bot.name}/clearance`, alice.token, { clearance: null });
    assert(none.status === 200 && none.body.data.clearance === null, `remove: ${none.status} ${JSON.stringify(none.body?.data ?? none.body?.error)}`);
    const bad = await call('PATCH', `/v1/agents/${bot.name}/clearance`, alice.token, { clearance: 'salainen' });
    assert(bad.status === 400 && bad.body?.error?.code === 'INVALID_INPUT', `an unknown classification: ${bad.status} ${JSON.stringify(bad.body?.error)}`);
});

// ─── 4. The node's start value ───
console.log('\nThe node setting gives a new agent its clearance');

await test('A new agent takes classification.agent_clearance_default; an existing one keeps its own', async () => {
    const set = await setStart('sisainen');
    assert(set.status === 200, `start value: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const fresh = await makeAgent(BASE, alice, ['*'], `clrnew${stamp % 100000}`);
    assert(await clearanceOf(fresh.name) === 'sisainen', `the new agent: ${await clearanceOf(fresh.name)}`);
    assert(await clearanceOf(bot.name) === null, 'the existing agent keeps no limit');
    const bad = await setStart('Not An Id');
    assert(bad.status !== 200 || (bad.body?.data?.errors ?? []).length > 0, `a value that is not a classification id is refused: ${bad.status} ${JSON.stringify(bad.body?.data ?? bad.body?.error)}`);
});

await test('Cleanup: the start value back to none, the switch off', async () => {
    const s = await setStart('');
    assert(s.status === 200, `start value: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const r = await setSwitch('off');
    assert(r.status === 200, `switch off: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

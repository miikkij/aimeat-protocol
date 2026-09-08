/**
 * @file test/e2e-mcp-groups-shares.ts
 * @description Seven of the eight sharing-group tools on the node's own MCP door at /v1/mcp, none of
 *   which had ever been called by a suite.
 *
 *   WHY THIS SUITE EXISTS. A sharing group is the boundary of who reads the owner's memory, and the
 *   share beside it is what that audience actually reaches. test/e2e-sharing-groups.ts drives the
 *   REST half of both and nothing drove the agent half, so the two consequences of that were
 *   assertions nobody had written: the scope words on this door (consent:groups for the audience,
 *   share:manage for the key space) delete the tool from an agent that lacks them, and a share made
 *   by an agent has to be the same share the human's own door would have made — same owner, same
 *   pattern, same reader, same refusals.
 *
 *   THE PROOF IS A READ, not a record. A share is only worth what it opens, so the middle of this
 *   suite writes a private key, has the OTHER owner read it because the group says they may, and
 *   then revokes over MCP and watches the same read turn into a 403. A share tool that wrote a row
 *   nothing consulted would pass every assertion about the row and fail that one.
 * @structure
 *   - Phase 1: fixtures (three owners, their agents, one REST-seeded group, one private key)
 *   - Phase 2: the scope fence — which of the seven tools each agent is handed
 *   - Phase 3: the audience (group_list, group_get, group_add_member, group_remove_member)
 *   - Phase 4: the key space (share_create, share_list both directions, the read it opens,
 *     share_revoke and the read closing again)
 *   - Phase 5: the refusals a share must make
 *
 *   WHAT IT FOUND. Every refusal these eight tools make renders the message and drops the error
 *   CODE, while the REST twins and the neighbouring MCP files both carry it. The block above test 18
 *   states it and the three assertions there match a human sentence because there is nothing else to
 *   match. Pinned as it behaves, not as it should.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-groups-shares
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: the seven uncalled tools of src/mcp/sharing-groups.ts, against the
 *     REST twins in src/routes/sharing-groups.ts.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string; ghii: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'GroupShareTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner, ghii: `${owner}@${NODE_ID}` };
    }
}

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `gs${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return tok.body.data.token as string;
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-groups-shares', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the sharing-group and share tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const alice = await makeOwner('gsalice');   // owns the group, the share and the key
const bob = await makeOwner('gsbob');       // the member the group was made for
const carol = await makeOwner('gscarol');   // in the group for one test, and outside it otherwise

const GROUP_SCOPES = ['consent:groups', 'share:manage', 'memory:read'];
const aliceAgent = await makeAgent(alice, GROUP_SCOPES);
const bobAgent = await makeAgent(bob, GROUP_SCOPES);
const carolAgent = await makeAgent(carol, GROUP_SCOPES);
const narrowAgent = await makeAgent(alice, ['memory:read']);

const SHARED_KEY = 'deliveries.mcpshare.batch1';
const PRIVATE_KEY = 'deliveries.private.notshared';

let groupId = '';
let shareId = '';

console.log('\nPhase 1 — fixtures, seeded through the REST doors');

await test('1. Alice creates a group with Bob in it, through POST /v1/groups', async () => {
    const r = await json('/v1/groups', {
        method: 'POST', headers: authed(alice.token),
        body: JSON.stringify({
            name: 'MCP delivery crew',
            description: 'The audience this suite reads back through the MCP tools',
            members: [{ identifier: bob.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }],
        }),
    });
    assert(r.status === 201, `create group ${r.status}: ${JSON.stringify(r.body)}`);
    groupId = r.body.data.group.id;
    assert(r.body.data.group.members.length === 1, `one member seeded, got ${r.body.data.group.members.length}`);
});

await test('2. Alice writes two private keys: one this suite will share, one it never will', async () => {
    for (const key of [SHARED_KEY, PRIVATE_KEY]) {
        const w = await json('/v1/memory', {
            method: 'POST', headers: authed(alice.token),
            body: JSON.stringify({ key, value: { note: `written for ${key}` }, visibility: 'private' }),
        });
        assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }
});

await test('3. Before any share, Bob cannot read Alice\'s private key (403)', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(SHARED_KEY)}`, {
        headers: authed(bob.token),
    });
    assert(r.status === 403, `a private key with no share must be refused, got ${r.status}`);
});

console.log('\nPhase 2 — the scope fence decides which tools exist');

const GATED_TOOLS = [
    'aimeat_group_add_member', 'aimeat_group_remove_member', 'aimeat_share_create', 'aimeat_share_revoke',
];
const UNGATED_TOOLS = ['aimeat_group_list', 'aimeat_group_get', 'aimeat_share_list'];

const aliceSession = await openSession(aliceAgent);
const bobSession = await openSession(bobAgent);
const carolSession = await openSession(carolAgent);

await test('4. An agent holding consent:groups and share:manage is handed all seven', async () => {
    const names = await toolNames(aliceSession);
    for (const t of [...GATED_TOOLS, ...UNGATED_TOOLS]) assert(names.includes(t), `${t} must be offered`);
});

await test('5. …an agent holding neither word keeps the reads and loses the four writes', async () => {
    const names = await toolNames(await openSession(narrowAgent));
    for (const t of GATED_TOOLS) {
        assert(!names.includes(t), `${t} changes who reads the owner's memory and must be gone without its word`);
    }
    for (const t of UNGATED_TOOLS) {
        assert(names.includes(t), `${t} is not scope-gated on REST either, so gating it here would be stricter than REST`);
    }
});

await test('6. The REST door behind them refuses an unauthenticated read with 401', async () => {
    const res = await fetch(`${BASE}/v1/groups`);
    assert(res.status === 401, `expected 401 without a token, got ${res.status}`);
});

console.log('\nPhase 3 — the audience');

await test('7. aimeat_group_list shows the owner\'s group to their agent, with its member count', async () => {
    const out = await callTool(aliceSession, 'aimeat_group_list', {});
    assert(!out.isError, `group_list refused: ${out.text.slice(0, 200)}`);
    const g = (out.data as any[]).find((x) => x.id === groupId);
    assert(g?.name === 'MCP delivery crew', `the group must be in the agent's list: ${out.text.slice(0, 200)}`);
    assert(g.owner_gaii === alice.ghii, `the group belongs to the agent's OWNER, not the agent: ${g.owner_gaii}`);
    assert(g.member_count === 1, `member count: ${g.member_count}`);
});

await test('8. …and shows a MEMBER the group they were put in', async () => {
    const out = await callTool(bobSession, 'aimeat_group_list', {});
    assert(!out.isError, `group_list refused for the member: ${out.text.slice(0, 200)}`);
    assert((out.data as any[]).some((x) => x.id === groupId), 'a member must see the group they belong to');

    const outsider = await callTool(carolSession, 'aimeat_group_list', {});
    assert(!outsider.isError && !(outsider.data as any[]).some((x) => x.id === groupId),
        'somebody outside the group must not see it in their list');
});

await test('9. aimeat_group_get names the members, and refuses an outsider', async () => {
    const out = await callTool(aliceSession, 'aimeat_group_get', { group_id: groupId });
    assert(!out.isError, `group_get refused: ${out.text.slice(0, 200)}`);
    assert(out.data.members.some((m: any) => m.identifier === bob.ghii),
        `the member must be named: ${JSON.stringify(out.data.members)}`);

    const denied = await callTool(carolSession, 'aimeat_group_get', { group_id: groupId });
    assert(denied.isError, `an outsider must be refused, got ${denied.text.slice(0, 200)}`);
});

await test('10. aimeat_group_add_member adds Carol, and the REST door sees the same two members', async () => {
    const out = await callTool(aliceSession, 'aimeat_group_add_member', {
        group_id: groupId, identifier: carol.ghii, identifier_type: 'ghii',
        permissions: { read: true, write: false },
    });
    assert(!out.isError, `add_member refused: ${out.text.slice(0, 300)}`);
    assert(out.data.added === true && out.data.member.identifier === carol.ghii,
        `the answer names who was added: ${JSON.stringify(out.data)}`);

    const rest = await json(`/v1/groups/${groupId}`, { headers: authed(alice.token) });
    assert(rest.status === 200 && rest.body.data.group.members.length === 2,
        `REST must show the member MCP added, got ${rest.body.data.group?.members?.length}`);
    assert(rest.body.data.group.members.some((m: any) => m.identifier === carol.ghii), 'Carol is in the group');
});

await test('11. …Carol can now read the group, and a stranger\'s agent cannot add to it', async () => {
    const carolSees = await callTool(carolSession, 'aimeat_group_get', { group_id: groupId });
    assert(!carolSees.isError, `a new member must be able to read the group: ${carolSees.text.slice(0, 200)}`);

    const notMine = await callTool(bobSession, 'aimeat_group_add_member', {
        group_id: groupId, identifier: `${carol.owner}2@${NODE_ID}`, identifier_type: 'ghii',
    });
    assert(notMine.isError, `a member is not an owner and must not add to somebody else's group: ${notMine.text.slice(0, 200)}`);
});

await test('12. aimeat_group_remove_member takes Carol out again, on both doors', async () => {
    const out = await callTool(aliceSession, 'aimeat_group_remove_member', { group_id: groupId, identifier: carol.ghii });
    assert(!out.isError, `remove_member refused: ${out.text.slice(0, 300)}`);
    assert(out.data.removed === true && out.data.identifier === carol.ghii, `the answer: ${JSON.stringify(out.data)}`);

    const rest = await json(`/v1/groups/${groupId}`, { headers: authed(alice.token) });
    assert(rest.body.data.group.members.length === 1, `back to one member, got ${rest.body.data.group.members.length}`);

    const carolGone = await callTool(carolSession, 'aimeat_group_get', { group_id: groupId });
    assert(carolGone.isError, 'a removed member must stop being able to read the group');
});

console.log('\nPhase 4 — the key space, and what it opens');

await test('13. aimeat_share_create hands the group a key space, and REST lists the same share', async () => {
    const out = await callTool(aliceSession, 'aimeat_share_create', {
        group_id: groupId, key_pattern: 'deliveries.mcpshare.**',
        note: 'The pattern this suite proves a read through',
    });
    assert(!out.isError, `share_create refused: ${out.text.slice(0, 300)}`);
    shareId = out.data.share.id;
    assert(out.data.share.owner_gaii === alice.ghii,
        `the share belongs to the agent's OWNER, never to the agent: ${out.data.share.owner_gaii}`);
    assert(out.data.share.key_pattern === 'deliveries.mcpshare.**', `pattern: ${out.data.share.key_pattern}`);

    const rest = await json('/v1/shares', { headers: authed(alice.token) });
    assert(rest.status === 200 && rest.body.data.shares.some((s: any) => s.id === shareId),
        `the human's own door must list the share the agent made: ${JSON.stringify(rest.body.data)}`);
});

await test('14. aimeat_share_list reads it outgoing for the owner and incoming for the member', async () => {
    const out = await callTool(aliceSession, 'aimeat_share_list', { direction: 'outgoing' });
    assert(!out.isError, `share_list refused: ${out.text.slice(0, 200)}`);
    assert(out.data.direction === 'outgoing' && out.data.shares.some((s: any) => s.id === shareId),
        `the owner's own shares: ${JSON.stringify(out.data)}`);

    const incoming = await callTool(bobSession, 'aimeat_share_list', { direction: 'incoming' });
    assert(!incoming.isError, `incoming share_list refused: ${incoming.text.slice(0, 200)}`);
    assert(incoming.data.shares.some((s: any) => s.id === shareId),
        `what has been shared WITH the member's owner: ${JSON.stringify(incoming.data)}`);

    const outsider = await callTool(carolSession, 'aimeat_share_list', { direction: 'incoming' });
    assert(!outsider.isError && !outsider.data.shares.some((s: any) => s.id === shareId),
        'somebody who was removed from the group reads nothing incoming from it');
});

await test('15. THE SHARE IS WORTH A READ: Bob now reads the private key the pattern covers', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(SHARED_KEY)}`, {
        headers: authed(bob.token),
    });
    assert(r.status === 200, `the covered key must open for the group, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.visibility === 'private',
        `and it stays private — sharing something never changes what it is: ${r.body.data.visibility}`);
});

await test('16. …and only that key: a private key outside the pattern is still refused (403)', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(PRIVATE_KEY)}`, {
        headers: authed(bob.token),
    });
    assert(r.status === 403, `a key the pattern does not cover must stay shut, got ${r.status}`);
});

await test('17. aimeat_share_revoke withdraws it, and the same read turns back into a 403', async () => {
    const out = await callTool(aliceSession, 'aimeat_share_revoke', { share_id: shareId });
    assert(!out.isError, `share_revoke refused: ${out.text.slice(0, 300)}`);
    assert(out.data.revoked === true && out.data.share.id === shareId, `the answer: ${JSON.stringify(out.data)}`);

    const r = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(SHARED_KEY)}`, {
        headers: authed(bob.token),
    });
    assert(r.status === 403, `revoking must stop the read at once, got ${r.status}`);

    const rest = await json('/v1/shares', { headers: authed(alice.token) });
    assert(!rest.body.data.shares.some((s: any) => s.id === shareId), 'the revoked share is gone from the owner\'s list');
});

console.log('\nPhase 5 — the refusals a share must make');

// FOUND 2026-09-08, PINNED HERE AS IT BEHAVES TODAY, NOT AS IT SHOULD.
//
// Every refusal in this phase carries its CODE in front of the sentence, `CODE: message`, the way
// the REST doors put it in the envelope and the sibling tools (mcp/packages.ts, mcp/exchange.ts)
// answer. Asserted as a hole first, 2026-09-08: the eight tools rendered `message` alone, so an
// agent told no could only match prose written for a person. Fixed in mcp/sharing-groups.ts v1.1.0.
await test('18. A pattern with no key space behind it is refused rather than trimmed', async () => {
    const wide = await callTool(aliceSession, 'aimeat_share_create', { group_id: groupId, key_pattern: '**' });
    assert(wide.isError && wide.text.startsWith('PATTERN_TOO_BROAD:') && wide.text.includes('must name a key space'),
        `the whole namespace is not a share, and the refusal names its code: ${wide.text.slice(0, 200)}`);
});

await test('19. A pattern reaching the node\'s own reserved keys is refused', async () => {
    const reserved = await callTool(aliceSession, 'aimeat_share_create', { group_id: groupId, key_pattern: 'openrouter.**' });
    assert(reserved.isError && reserved.text.startsWith('RESERVED_KEY:') && reserved.text.includes('managed by the node on your behalf'),
        `server-trusted config is not an owner's to hand out, and the refusal names its code: ${reserved.text.slice(0, 200)}`);
});

await test('20. Another owner\'s group is reported missing, not forbidden, when a share is aimed at it', async () => {
    const notMine = await callTool(bobSession, 'aimeat_share_create', { group_id: groupId, key_pattern: 'deliveries.bob.**' });
    // "Not found" rather than "forbidden" is the assertion that matters: whether a stranger's group
    // exists is not something an outsider gets to learn by asking.
    assert(notMine.isError && notMine.text.startsWith('NOT_FOUND:') && notMine.text.includes('Sharing group not found'),
        `whether a stranger's group exists is not learnable by asking: ${notMine.text.slice(0, 200)}`);
});

await test('21. Revoking a share that is not the caller\'s is refused, and it is still live afterwards', async () => {
    const second = await callTool(aliceSession, 'aimeat_share_create', {
        group_id: groupId, key_pattern: 'deliveries.mcpshare.**',
    });
    assert(!second.isError, `re-creating the share for this test: ${second.text.slice(0, 200)}`);
    const liveId = second.data.share.id;

    const notMine = await callTool(bobSession, 'aimeat_share_revoke', { share_id: liveId });
    assert(notMine.isError && notMine.text.startsWith('NOT_FOUND:') && notMine.text.includes('Share not found'),
        `a reader must not be able to revoke the share that admits them: ${notMine.text.slice(0, 200)}`);

    const r = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(SHARED_KEY)}`, {
        headers: authed(bob.token),
    });
    assert(r.status === 200, `the refused revoke must have changed nothing, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

/**
 * @file test/e2e-mcp-dm-datapackage.ts
 * @description Two MCP modules whose refusal arms nothing had ever driven: the federated inbox in
 *   src/mcp/dm-messages.ts and the data-package pair in src/mcp/core-datapackage.ts.
 *
 *   WHY THIS SUITE EXISTS. test/e2e-agent-dm.ts drives the DM capability through its REST doors and
 *   never through the tools, and every refusal in dm-messages.ts lives in the tool handler rather
 *   than in the service: the self-send guard, the body-or-attachment rule, the operator-only
 *   audience on a broadcast, and the attachment view that turns a stored key into an openable `ref`.
 *   A tool that answered `delivered` for a message nobody could receive is exactly the fault this
 *   module's own history records, and it was found by a person a day later rather than by a suite.
 *
 *   The data-package tools had the same gap from the other side. test/e2e-datapackage-slice1.ts
 *   proves the REST door and the extension road; the two tools were called by nothing, so their
 *   caps, their validation report and the recipes they hand a target program were unasserted.
 *
 *   ONE FINDING, FIXED THE SAME DAY. aimeat_datapackage_publish declares an 8 MB one-call cap and
 *   answers PAYLOAD_TOO_LARGE past it, but /v1/mcp was parsed at the ordinary `jsonBodyLimitMb`
 *   (5 MB by default), so the express parser refused the request first and the tool's own message
 *   was unreachable through this door. server.ts parses /v1/mcp at the large limit now; test 22
 *   asserts the tool's own answer.
 *
 *   HOW IT IS BUILT. Every fixture is seeded through the REST doors other suites keep green
 *   (POST /v1/ghii, /v1/agents, /v1/messages, /v1/groups), the tool is driven against that seed, and
 *   the record is read back through its REST twin.
 * @structure
 *   - Phase 1: fixtures (sender owner + agent, a recipient owner, a scope-less agent)
 *   - Phase 2: the scope fence and an anonymous caller on the same door
 *   - Phase 3: aimeat_dm_send — the two refusals, the first-contact echo, the group address
 *   - Phase 4: aimeat_dm_send_as_owner, aimeat_dm_ask
 *   - Phase 5: attachments — upload, send, and the view aimeat_dm_thread renders
 *   - Phase 6: aimeat_dm_broadcast — to[], group_id, and the operator-only audience
 *   - Phase 7: aimeat_dm_inbox
 *   - Phase 8: aimeat_datapackage_publish / _export, both refusal arms and the REST twins
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-dm-datapackage
 * @version-history
 *   v1.1.0 — 2026-09-08 — Test 22 asserts the tool's own cap now that /v1/mcp admits it.
 *   v1.0.0 — 2026-09-08 — Initial: seven DM tools with their refusal arms, both data-package tools,
 *     and the body-limit finding pinned on test 22.
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
            body: JSON.stringify({ username: owner, display_name: owner, password: 'DmPackageTest1234' }),
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
async function makeAgent(
    ownerCtx: { token: string; owner: string }, scopes: string[],
): Promise<{ token: string; gaii: string; name: string }> {
    const name = `dm${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
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
    return { token: tok.body.data.token as string, gaii, name };
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
        clientInfo: { name: 'e2e-mcp-dm-datapackage', version: '1.0.0' },
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

console.log('═══ E2E: the DM and data-package tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const PKG = `dmpkg-${STAMP}`;
const ATTACH_KEY = `dm-attach-${STAMP}.md`;

let senderOwner: Awaited<ReturnType<typeof makeOwner>>;
let recipientOwner: Awaited<ReturnType<typeof makeOwner>>;
let bot: Awaited<ReturnType<typeof makeAgent>>;
let mute: Awaited<ReturnType<typeof makeAgent>>;
let botSession: McpSession;
let muteSession: McpSession;
let groupId = '';
let attachmentConversation = '';

console.log('\nPhase 1 — fixtures');

await test('1. A sender owner with a fully worded agent, a recipient owner, and a scope-less agent', async () => {
    senderOwner = await makeOwner('dmsend');
    recipientOwner = await makeOwner('dmrecv');
    bot = await makeAgent(senderOwner, [
        'messages:send', 'messages:read', 'messages:send-as-owner', 'storage:write', 'storage:read',
    ]);
    mute = await makeAgent(senderOwner, ['memory:read']);
    assert(bot.gaii.endsWith(`@${NODE_ID}`), `agent gaii: ${bot.gaii}`);
});

await test('2. Two MCP sessions open on /v1/mcp', async () => {
    botSession = await openSession(bot.token);
    muteSession = await openSession(mute.token);
    assert(typeof botSession.sessionId === 'string' && botSession.sessionId.length > 0, 'the sender session got no id');
});

console.log('\nPhase 2 — the scope fence, and the same door to an anonymous caller');

await test('3. An agent with no message word is handed none of the DM tools', async () => {
    const names = await toolNames(muteSession);
    for (const gated of ['aimeat_dm_send', 'aimeat_dm_broadcast', 'aimeat_dm_ask', 'aimeat_dm_inbox',
        'aimeat_dm_thread', 'aimeat_dm_send_as_owner', 'aimeat_datapackage_publish', 'aimeat_datapackage_export']) {
        assert(!names.includes(gated), `${gated} was offered to an agent holding only memory:read`);
    }
});

await test('4. …and the agent that holds them IS handed them, which is what makes test 3 mean something', async () => {
    const names = await toolNames(botSession);
    for (const t of ['aimeat_dm_send', 'aimeat_dm_broadcast', 'aimeat_dm_ask', 'aimeat_dm_inbox',
        'aimeat_dm_thread', 'aimeat_dm_send_as_owner', 'aimeat_datapackage_publish', 'aimeat_datapackage_export']) {
        assert(names.includes(t), `${t} missing from the sender's surface`);
    }
});

await test('5. The REST twin refuses an anonymous send (401)', async () => {
    const anon = await json('/v1/messages', {
        method: 'POST', body: JSON.stringify({ to: recipientOwner.ghii, body: 'from nobody' }),
    });
    assert(anon.status === 401, `an anonymous caller reached the send door: ${anon.status} ${JSON.stringify(anon.body)}`);
});

console.log('\nPhase 3 — aimeat_dm_send');

await test('6. A message to yourself is refused before anything is written', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send', { to: bot.gaii, body: 'talking to myself' });
    assert(r.isError, `a self-send succeeded: ${r.text}`);
    assert(/Cannot send a message to yourself/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('7. A message with neither body nor attachment is refused', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send', { to: recipientOwner.ghii, body: '   ' });
    assert(r.isError, `an empty message was sent: ${r.text}`);
    assert(/body or at least one attachment/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('8. The first message to a stranger says it is waiting behind their contact gate', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send', {
        to: recipientOwner.ghii, subject: `First contact ${STAMP}`, body: 'The scraper finished; here is what it found.',
    });
    assert(!r.isError, `send refused: ${r.text}`);
    assert(r.data.recipient === recipientOwner.ghii, `recipient: ${r.data.recipient}`);
    // `delivered` and "they have read nothing yet" are both true of a first message; the tool has to
    // say which, or the sender waits for an answer to something sitting in a request queue.
    assert(r.data.awaiting_approval === true, `awaiting_approval missing: ${r.text.slice(0, 400)}`);
    assert(typeof r.data.delivery_note === 'string' && r.data.delivery_note.includes('contact requests'),
        `delivery_note: ${r.data.delivery_note}`);

    // The REST twin's view of the same state: the recipient holds it as a request, not as inbox mail.
    const reqs = await json('/v1/messages/requests', { headers: authed(recipientOwner.token) });
    assert(reqs.status === 200, `GET /v1/messages/requests ${reqs.status}`);
    const pending = (reqs.body.data.requests ?? []).find((x: any) => x.contactId === bot.gaii);
    assert(pending !== undefined, `no pending request from ${bot.gaii}: ${JSON.stringify(reqs.body.data.requests)}`);
});

await test('9. The recipient accepts, and a second message is delivered outright', async () => {
    const acc = await json(`/v1/messages/requests/${encodeURIComponent(bot.gaii)}/accept`, {
        method: 'POST', headers: authed(recipientOwner.token),
    });
    assert(acc.status === 200, `accept ${acc.status}: ${JSON.stringify(acc.body)}`);

    const r = await callTool(botSession, 'aimeat_dm_send', { to: recipientOwner.ghii, body: `Second word ${STAMP}` });
    assert(!r.isError, `send refused: ${r.text}`);
    assert(r.data.awaiting_approval === undefined, `still gated after an accept: ${r.text.slice(0, 300)}`);

    const inbox = await json('/v1/messages/inbox', { headers: authed(recipientOwner.token) });
    const landed = (inbox.body.data.messages ?? []).find((m: any) => m.id === r.data.message_id);
    assert(landed !== undefined, `the message is not in the recipient's inbox: ${r.data.message_id}`);
    assert(landed.senderGhii === bot.gaii, `the sender on the stored copy is ${landed.senderGhii}`);
});

await test('10. support@operators opens a GROUP thread rather than a message to a person', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send', {
        to: 'support@operators', subject: `Core doors report ${STAMP}`,
        body: 'The export answered with an empty schema and no error.',
    });
    assert(!r.isError, `support send refused: ${r.text}`);
    assert(r.data.addressed_to === 'support@operators', `addressed_to: ${r.text.slice(0, 400)}`);
    assert(typeof r.data.conversation_id === 'string' && r.data.conversation_id.length > 0,
        `no conversation id: ${r.text.slice(0, 300)}`);
    assert(Array.isArray(r.data.participants) && r.data.participants.includes(bot.gaii),
        `the sender must be in its own thread: ${JSON.stringify(r.data.participants)}`);
    assert(typeof r.data.reply_with === 'string' && r.data.reply_with.includes('conversation_id'),
        `the answer must say how to continue the thread: ${r.data.reply_with}`);

    // The same thread through the tool that reads it back: an agent that cannot re-read what it
    // reported cannot tell "not delivered" from "delivered and invisible to me".
    const thread = await callTool(botSession, 'aimeat_dm_thread', { conversation_id: r.data.conversation_id });
    assert(!thread.isError, `dm_thread refused: ${thread.text}`);
    const mine = (thread.data.messages ?? []).find((m: any) => m.id === r.data.message_id);
    assert(mine !== undefined, `the agent cannot read its own support message: ${thread.text.slice(0, 400)}`);
});

console.log('\nPhase 4 — send_as_owner and ask');

await test('11. aimeat_dm_send_as_owner refuses an empty message too', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send_as_owner', { to: recipientOwner.ghii, body: '' });
    assert(r.isError, `an empty delegated message was sent: ${r.text}`);
    assert(/body or at least one attachment/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('12. …and a real one is sent AS THE OWNER, never as the agent', async () => {
    const r = await callTool(botSession, 'aimeat_dm_send_as_owner', {
        to: recipientOwner.ghii, subject: `On behalf ${STAMP}`, body: 'Answering for my owner, with their permission.',
    });
    assert(!r.isError, `send_as_owner refused: ${r.text}`);
    assert(r.data.sent_as === senderOwner.ghii, `sent_as: ${r.data.sent_as}`);

    // Server-derived, never client-supplied: the stored copy carries the OWNER as the sender. The
    // owner is a new correspondent even though the agent has been accepted, so the copy is in the
    // recipient's contact requests rather than their inbox.
    const reqs = await json('/v1/messages/requests', { headers: authed(recipientOwner.token) });
    const inbox = await json('/v1/messages/inbox', { headers: authed(recipientOwner.token) });
    const senders: string[] = [
        ...(inbox.body.data.messages ?? []).map((m: any) => m.senderGhii),
        ...(reqs.body.data.requests ?? []).map((x: any) => x.contactId),
    ];
    assert(senders.includes(senderOwner.ghii),
        `the delegated message does not carry the owner's identity: ${JSON.stringify(senders)}`);

    // …and on the owner's side it is the OWNER's own thread, not one tagged as their agent's. That
    // tag is what an inbox renders as "sent by your agent", and a delegated reply is not that.
    const convs = await json('/v1/messages/conversations', { headers: authed(senderOwner.token) });
    const own = (convs.body.data.conversations ?? [])
        .find((c: any) => c.peerGhii === recipientOwner.ghii && c.viaAgent === undefined);
    assert(own !== undefined,
        `the owner does not hold the delegated thread as their own: ${JSON.stringify((convs.body.data.conversations ?? []).map((c: any) => [c.peerGhii, c.viaAgent]))}`);
});

await test('13. aimeat_dm_ask refuses a question addressed to yourself', async () => {
    const r = await callTool(botSession, 'aimeat_dm_ask', {
        to: bot.gaii,
        questions: [{ id: 'q1', header: 'Which', prompt: 'Which one?', options: [{ id: 'a', label: 'A' }] }],
    });
    assert(r.isError, `a self-addressed question was sent: ${r.text}`);
    assert(/Cannot send a message to yourself/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('14. …and a real question reaches the recipient with its options intact', async () => {
    const r = await callTool(botSession, 'aimeat_dm_ask', {
        to: recipientOwner.ghii,
        body: 'One decision before I carry on.',
        questions: [{
            id: 'q1', header: 'Format', prompt: 'CSV or JSON?',
            options: [{ id: 'csv', label: 'CSV' }, { id: 'json', label: 'JSON' }],
        }],
    });
    assert(!r.isError, `dm_ask refused: ${r.text}`);
    assert(r.data.questions === 1, `questions: ${r.text.slice(0, 300)}`);

    const inbox = await json('/v1/messages/inbox', { headers: authed(recipientOwner.token) });
    const asked = (inbox.body.data.messages ?? []).find((m: any) => m.id === r.data.message_id);
    assert(asked !== undefined, `the question is not in the recipient's inbox: ${r.data.message_id}`);
    assert(asked.interactive?.questions?.[0]?.options?.length === 2,
        `the options did not survive the send: ${JSON.stringify(asked.interactive)}`);
});

console.log('\nPhase 5 — attachments, and the view a thread renders');

await test('15. A file uploaded over MCP travels as an attachment reference', async () => {
    const payload = `# Report ${STAMP}\n\nOne line the recipient can open.\n`;
    const up = await callTool(botSession, 'aimeat_storage_upload', {
        key: ATTACH_KEY, data_base64: Buffer.from(payload, 'utf8').toString('base64'),
        mime_type: 'text/markdown', visibility: 'owner',
    });
    assert(!up.isError, `storage_upload refused: ${up.text}`);

    const r = await callTool(botSession, 'aimeat_dm_send', {
        to: recipientOwner.ghii, body: 'The report is attached.',
        attachments: [{
            storage_key: ATTACH_KEY, mime: 'text/markdown', kind: 'file',
            size: Buffer.byteLength(payload, 'utf8'), name: 'report.md',
        }],
    });
    assert(!r.isError, `attachment send refused: ${r.text}`);
    assert(r.data.attachments === 1, `attachment count: ${r.text.slice(0, 300)}`);
    attachmentConversation = r.data.conversation_id;
});

await test('16. aimeat_dm_thread renders the attachment as something openable, not a bare key', async () => {
    const r = await callTool(botSession, 'aimeat_dm_thread', { conversation_id: attachmentConversation });
    assert(!r.isError, `dm_thread refused: ${r.text}`);
    const withFile = (r.data.messages ?? []).find((m: any) => (m.attachments ?? []).length > 0);
    assert(withFile !== undefined, `no message in the thread carries an attachment: ${r.text.slice(0, 400)}`);
    const a = withFile.attachments[0];
    assert(a.storage_key === ATTACH_KEY, `storage_key: ${a.storage_key}`);
    assert(a.mime === 'text/markdown' && a.kind === 'file' && a.name === 'report.md',
        `the descriptor lost a field: ${JSON.stringify(a)}`);
    // The point of the view: a key alone is unopenable, because storage is addressed by (owner, key).
    assert(typeof a.ref === 'string' && a.ref.includes(ATTACH_KEY), `ref: ${a.ref}`);
    assert(typeof a.origin_ref === 'string' && a.origin_ref.includes(a.owner_ghii),
        `origin_ref must name the sender's copy: ${a.origin_ref}`);
    assert(typeof a.note === 'string' && a.note.includes('aimeat_storage_download'),
        `the note must name the tool that opens it: ${a.note}`);
    assert(a.expired === false, `expired: ${a.expired}`);
});

console.log('\nPhase 6 — aimeat_dm_broadcast');

await test('17. A broadcast to a named list reports what landed and what did not', async () => {
    const ghost = `nobody${STAMP}@${NODE_ID}`;
    const r = await callTool(botSession, 'aimeat_dm_broadcast', {
        to: [recipientOwner.ghii, ghost], subject: `Weekly ${STAMP}`, body: 'One thing changed this week.',
    });
    assert(!r.isError, `broadcast refused: ${r.text}`);
    assert(r.data.recipients === 2, `recipients: ${r.text.slice(0, 300)}`);
    assert(r.data.sent === 1, `sent: ${r.data.sent}`);
    const refused = (r.data.failed ?? []).find((f: any) => f.recipient === ghost);
    assert(refused !== undefined, `the unknown recipient was counted away: ${JSON.stringify(r.data.failed)}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('refused'),
        `a partial send must read as partial: ${r.data.note}`);
    assert(typeof r.data.broadcast_id === 'string' && r.data.broadcast_id.length > 0, 'no broadcast id');

    const seen = await json('/v1/messages/inbox', { headers: authed(recipientOwner.token) });
    assert((seen.body.data.messages ?? []).some((m: any) => /One thing changed this week/.test(m.body ?? '')),
        'the one good copy never arrived');
});

await test('18. A broadcast can address a Share Group instead of a list', async () => {
    const g = await json('/v1/groups', {
        method: 'POST', headers: authed(senderOwner.token),
        body: JSON.stringify({
            name: `Broadcast audience ${STAMP}`,
            description: 'The audience this suite reads back through the broadcast tool',
            members: [{ identifier: recipientOwner.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }],
        }),
    });
    assert(g.status === 201, `create group ${g.status}: ${JSON.stringify(g.body)}`);
    groupId = g.body.data.group.id;

    const r = await callTool(botSession, 'aimeat_dm_broadcast', {
        group_id: groupId, subject: `Group note ${STAMP}`, body: `Addressed to the group ${STAMP}.`,
    });
    assert(!r.isError, `group broadcast refused: ${r.text}`);
    assert(r.data.sent === 1, `sent: ${r.text.slice(0, 300)}`);
    assert((r.data.failed ?? []).length === 0, `failed: ${JSON.stringify(r.data.failed)}`);

    const seen = await json('/v1/messages/inbox', { headers: authed(recipientOwner.token) });
    assert((seen.body.data.messages ?? []).some((m: any) => (m.body ?? '').includes(`Addressed to the group ${STAMP}`)),
        'the group copy never arrived');
});

await test('19. A node-wide audience is refused: this tool passes isOperator false, and an agent is not one', async () => {
    const r = await callTool(botSession, 'aimeat_dm_broadcast', {
        audience: 'node-users', subject: 'Everyone', body: 'Reaching every human on this node.',
    });
    assert(r.isError, `an agent broadcast to the whole node: ${r.text}`);
    assert(r.data.code === 'FORBIDDEN', `code: ${r.text.slice(0, 300)}`);
    assert(/operator-only/.test(r.data.error ?? r.text), `the refusal must say why: ${r.text.slice(0, 300)}`);
});

await test('20. A broadcast with nothing in it is refused before any recipient is resolved', async () => {
    const r = await callTool(botSession, 'aimeat_dm_broadcast', { to: [recipientOwner.ghii], body: '  ' });
    assert(r.isError, `an empty broadcast was sent: ${r.text}`);
    assert(/body, an attachment, or questions/.test(r.text), `wrong refusal: ${r.text}`);
});

console.log('\nPhase 7 — aimeat_dm_inbox');

await test('21. aimeat_dm_inbox shows what was addressed to the AGENT, and not its own sends', async () => {
    const send = await json('/v1/messages', {
        method: 'POST', headers: authed(recipientOwner.token),
        body: JSON.stringify({ to: bot.gaii, body: `A human writing to the agent ${STAMP}` }),
    });
    assert(send.status === 201, `human→agent send ${send.status}: ${JSON.stringify(send.body)}`);

    const r = await callTool(botSession, 'aimeat_dm_inbox', { per_page: 50 });
    assert(!r.isError, `dm_inbox refused: ${r.text}`);
    const arrived = (r.data.messages ?? []).find((m: any) => (m.body ?? '').includes(`A human writing to the agent ${STAMP}`));
    assert(arrived !== undefined, `the agent does not see its own mail: ${r.text.slice(0, 400)}`);
    assert(arrived.from === recipientOwner.ghii, `from: ${arrived.from}`);
    assert(typeof r.data.total === 'number' && r.data.total >= 1, `total: ${r.data.total}`);
    assert(!(r.data.messages ?? []).some((m: any) => m.from === bot.gaii),
        'an inbox holds what arrived, not what the agent itself sent');
});

console.log('\nPhase 8 — the data-package pair');

await test('22. The 8 MB cap on aimeat_datapackage_publish answers with its own advice', async () => {
    // core-datapackage.ts answers PAYLOAD_TOO_LARGE past 8 MB of rows, naming publishing in
    // periods and moving production into an extension. Until 2026-09-08 /v1/mcp was parsed at
    // config.jsonBodyLimitMb (5 MB), so express refused first and that advice was unreachable;
    // server.ts now parses /v1/mcp at the large limit like the file doors it fronts.
    const filler = 'x'.repeat(64 * 1024);
    const rows = Array.from({ length: 136 }, (_, i) => ({ id: i, blob: filler }));   // ~8.5 MB of JSON
    const r = await callTool(botSession, 'aimeat_datapackage_publish',
        { name: `${PKG}-huge`, changes: 'Too much in one call.', resources: [{ name: 'rows', rows }] });
    assert(r.isError, `an 8.5 MB publish went through: ${r.text.slice(0, 200)}`);
    assert(r.text.includes('PAYLOAD_TOO_LARGE'), `the tool's own cap answers: ${r.text.slice(0, 200)}`);
    assert(r.text.includes('periods'), `and carries the advice: ${r.text.slice(0, 300)}`);

    // Refuse before you write: nothing was published under that name.
    const gone = await json(`/v1/datapackages/${encodeURIComponent(senderOwner.owner)}/${PKG}-huge`);
    assert(gone.status === 404, `a refused publish left a package: ${gone.status}`);
});

await test('23. aimeat_datapackage_publish writes a version, and the REST twin reads its rows back', async () => {
    const r = await callTool(botSession, 'aimeat_datapackage_publish', {
        name: PKG,
        changes: 'First cut of the shortage table.',
        title: 'Shortages, weekly',
        license: 'CC-BY-4.0',
        sources: [{ url: 'https://example.test/register', title: 'The register' }],
        resources: [{
            name: 'rows',
            rows: [
                { vnr: '001000', name: 'Laake 0', packages: 3 },
                { vnr: '001001', name: 'Laake 1', packages: 6 },
            ],
        }],
    });
    assert(!r.isError, `publish refused: ${r.text}`);
    assert(typeof r.data.package_id === 'string' && r.data.package_id.length > 0, `package_id: ${r.text.slice(0, 300)}`);
    assert(/^sha256:[a-f0-9]{64}$/.test(r.data.content_hash ?? ''), `content_hash: ${r.data.content_hash}`);
    assert(r.data.schema_source === 'inferred', `nobody declared the types, so: ${r.data.schema_source}`);
    assert(r.data.unchanged === false, `a first publish is not unchanged: ${r.data.unchanged}`);

    // The REST twin, on the address the tool just handed out.
    const rows = await json(`/v1/datapackages/${encodeURIComponent(senderOwner.owner)}/${PKG}/rows/rows?limit=10`);
    assert(rows.status === 200, `GET rows ${rows.status}: ${JSON.stringify(rows.body).slice(0, 200)}`);
    assert(rows.body.data.rows.length === 2, `rows: ${JSON.stringify(rows.body.data.rows)}`);
    assert(rows.body.data.rows[0].vnr === '001000',
        `the zero-padded key was re-sniffed into a number: ${JSON.stringify(rows.body.data.rows[0])}`);
});

await test('24. Publishing the SAME content again is reported as no change', async () => {
    // `changes` is part of the content identity (services/datapackage/contract.ts contentHashOf), so
    // a re-publish that says something different is a NEW version by design. This is the
    // deterministic-producer case: the same run, the same words.
    const r = await callTool(botSession, 'aimeat_datapackage_publish', {
        name: PKG, changes: 'First cut of the shortage table.',
        title: 'Shortages, weekly',
        license: 'CC-BY-4.0',
        sources: [{ url: 'https://example.test/register', title: 'The register' }],
        resources: [{
            name: 'rows',
            rows: [
                { vnr: '001000', name: 'Laake 0', packages: 3 },
                { vnr: '001001', name: 'Laake 1', packages: 6 },
            ],
        }],
    });
    assert(!r.isError, `republish refused: ${r.text}`);
    assert(r.data.unchanged === true, `unchanged: ${r.text.slice(0, 300)}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('no change'),
        `the note must say it plainly: ${r.data.note}`);
});

await test('25. A cell that cannot be what the schema says refuses with COORDINATES, and writes nothing', async () => {
    const r = await callTool(botSession, 'aimeat_datapackage_publish', {
        name: `${PKG}-bad`,
        changes: 'A run whose upstream sent a word where a number belongs.',
        resources: [{
            name: 'rows',
            rows: [{ vnr: '001000', packages: 3 }, { vnr: '001001', packages: 'not a number' }],
            schema: { fields: [{ name: 'vnr', type: 'string' }, { name: 'packages', type: 'integer' }] },
        }],
    });
    assert(r.isError, `an invalid table was published: ${r.text}`);
    assert(r.data.published === false, `published: ${r.text.slice(0, 300)}`);
    assert(Array.isArray(r.data.issues) && r.data.issues.length > 0, `no issues listed: ${r.text.slice(0, 400)}`);
    assert(typeof r.data.issues_total === 'number' && r.data.issues_total >= 1, `issues_total: ${r.data.issues_total}`);
    assert(JSON.stringify(r.data.issues).includes('packages'),
        `the issue must name the column: ${JSON.stringify(r.data.issues).slice(0, 300)}`);

    const gone = await json(`/v1/datapackages/${encodeURIComponent(senderOwner.owner)}/${PKG}-bad`);
    assert(gone.status === 404, `a refused publish left a package: ${gone.status}`);
});

await test('26. aimeat_datapackage_export hands out the permanent address and the recipes for it', async () => {
    const r = await callTool(botSession, 'aimeat_datapackage_export', {
        ref: `pkg:${senderOwner.owner}/${PKG}`, resource: 'rows',
    });
    assert(!r.isError, `export refused: ${r.text}`);
    assert(r.data.format === 'url', `format: ${r.data.format}`);
    assert(typeof r.data.url === 'string' && r.data.url.endsWith('.csv'), `url: ${r.data.url}`);
    assert(r.data.rows === 2, `rows: ${r.data.rows}`);
    assert(Array.isArray(r.data.schema?.fields) && r.data.schema.fields.length === 3,
        `the Table Schema is the answer to "what columns": ${JSON.stringify(r.data.schema)}`);
    assert(typeof r.data.recipes?.duckdb === 'string' && r.data.recipes.duckdb.includes(r.data.url),
        `the duckdb recipe must carry the address: ${r.data.recipes?.duckdb}`);
    assert(typeof r.data.recipes?.pandas === 'string' && r.data.recipes.pandas.includes('dtype='),
        `pandas without dtype re-sniffs the types: ${r.data.recipes?.pandas}`);

    // The address is public and needs no session: that is what makes it worth handing on.
    const fetched = await fetch(r.data.url);
    assert(fetched.status === 200, `the permanent CSV address answered ${fetched.status}`);
    assert((await fetched.text()).includes('001000'), 'the CSV at that address is not this table');
});

await test('27. …and the inline formats return a WINDOW, saying so', async () => {
    const asJson = await callTool(botSession, 'aimeat_datapackage_export', {
        ref: `pkg:${senderOwner.owner}/${PKG}`, resource: 'rows', format: 'json', limit: 1,
    });
    assert(!asJson.isError, `json export refused: ${asJson.text}`);
    assert(asJson.data.rows.length === 1 && asJson.data.total === 2, `returned: ${asJson.text.slice(0, 300)}`);
    assert(asJson.data.truncated === true, `truncated: ${asJson.data.truncated}`);
    assert(typeof asJson.data.note === 'string' && asJson.data.note.includes('WINDOW'),
        `the note must say it is a window: ${asJson.data.note}`);

    const asCsv = await callTool(botSession, 'aimeat_datapackage_export', {
        ref: `pkg:${senderOwner.owner}/${PKG}`, resource: 'rows', format: 'csv',
    });
    assert(!asCsv.isError, `csv export refused: ${asCsv.text}`);
    assert(typeof asCsv.data.csv === 'string' && asCsv.data.csv.includes('001000'), `csv: ${asCsv.text.slice(0, 200)}`);
    assert(asCsv.data.truncated === false, `a whole small table is not truncated: ${asCsv.data.truncated}`);
});

await test('28. An unknown package and an unknown resource each refuse, and the second names what is there', async () => {
    const noPkg = await callTool(botSession, 'aimeat_datapackage_export', {
        ref: `pkg:${senderOwner.owner}/no-such-${STAMP}`, resource: 'rows',
    });
    assert(noPkg.isError && noPkg.data.code === 'NOT_FOUND', `unknown package: ${noPkg.text.slice(0, 300)}`);

    const noRes = await callTool(botSession, 'aimeat_datapackage_export', {
        ref: `pkg:${senderOwner.owner}/${PKG}`, resource: 'not-a-resource',
    });
    assert(noRes.isError && noRes.data.code === 'NOT_FOUND', `unknown resource: ${noRes.text.slice(0, 300)}`);
    assert(Array.isArray(noRes.data.available) && noRes.data.available.includes('rows'),
        `the refusal must name what the package does have: ${JSON.stringify(noRes.data.available)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

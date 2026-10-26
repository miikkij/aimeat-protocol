/**
 * @file test/e2e-message-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Acknowledgement marks on a single direct message (services/message-reactions.ts), on two
 *   whole nodes A and B booted in this process and peered with messaging on.
 *
 *   WHAT IT ASSERTS
 *     - The designed uses: a person marks a message on one node and the other party's thread carries
 *       the mark; the same mark twice changes nothing; a word is a mark too; one's own mark comes back
 *       off; a mark crosses to the other node and back; an agent marks in its owner's name with
 *       messages:send-as-owner, over REST and over MCP; the agent that wrote a message is woken with
 *       `dm.reaction` naming the symbol and the reactor, and never the reactor's private palette.
 *     - The refusals: a person holding no copy, and an agent that is not a party, get 404; as_owner
 *       without messages:send-as-owner is 403 SCOPE_DENIED; an empty or 33-character symbol is 400;
 *       taking back a mark one did not give is 404; a peer that signs a mark for a person of another
 *       node, or for a message its reactor is not a party of, is refused 403 and nothing is written.
 *
 *   The nodes follow the run's backend (test/helpers/own-node-db.ts), on ports of their own (blocks
 *   32200 and 32300).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-message-reactions
 * @version-history
 *   2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import * as ed from '@noble/ed25519';
import { audienceProof } from '../src/services/signed-node-request.js';
import { sign } from '../src/auth/keypair.js';
import { onDeliveryEvent, offDeliveryEvent, type DeliveryEvent } from '../src/services/event-bus.js';
import { reactionPayload } from '../src/services/message-reactions.js';
import { bootNode, setupOperator, addPeer, auth, sleep, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const A_ID = `aimeat-react-a-${stamp}`;
const B_ID = `aimeat-react-b-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

type Person = { name: string; ghii: string; token: string };
let A!: NodeState;
let B!: NodeState;
let alice!: Person;   // on A
let carol!: Person;   // on A, alice's contact
let dave!: Person;    // on A, a stranger to both
let bob!: Person;     // on B
let agent!: { gaii: string; token: string; key: string };        // alice's agent: messages:send and send-as-owner
let narrowAgent!: { gaii: string; token: string; key: string };  // alice's agent: messages:send only

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* not a frame */ } }
    return out;
}

/** OAuth path A (the agent's signature) and an MCP session on `node`, as e2e-group-chat does. Returns a tool caller. */
async function connectMcp(node: NodeState, gaii: string, privKey: string) {
    const reg = await node.json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'reactions-e2e' }) });
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + node.nodeId + timestamp);
    const pkce = mcpPkce(node.baseUrl);
    const authz = await node.json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii, signature, timestamp, ...authorizeParams(pkce) })}`);
    assert(typeof authz.body.code === 'string', `authorize: ${JSON.stringify(authz.body)}`);
    const tok = await node.json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret, ...tokenParams(pkce) }) });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange: ${JSON.stringify(tok.body)}`);
    let sessionId = '';
    let nextId = 1;
    const headers = () => ({
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    });
    const rpc = async (method: string, params: Record<string, unknown>) => {
        const id = nextId++;
        const res = await fetch(`${node.baseUrl}/v1/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'reactions-e2e', version: '1.0.0' } });
    await fetch(`${node.baseUrl}/v1/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const text = body.result?.content?.[0]?.text ?? '';
        let data: any = {};
        try { data = JSON.parse(text); } catch { /* an error text */ }
        return { ok: body.error === undefined && body.result?.isError !== true, text, data };
    };
}

async function createAgent(node: NodeState, owner: Person, agentName: string, scopes: string[]): Promise<{ gaii: string; token: string; key: string }> {
    const r = await node.json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name: agentName, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(r.status === 201, `create agent ${agentName}: ${r.status} ${JSON.stringify(r.body)}`);
    const gaii = r.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(r.body.data.private_key, gaii + timestamp);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token, key: r.body.data.private_key };
}

async function send(node: NodeState, from: { token: string }, to: string, body: string, path = '/v1/messages'): Promise<{ id: string; conversationId: string }> {
    const r = await node.json(path, { method: 'POST', headers: auth(from.token), body: JSON.stringify({ to, body }) });
    assert(r.status === 201, `send ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    const d = r.body.data;
    return { id: d.message?.id ?? d.message_id, conversationId: d.message?.conversationId ?? d.conversation_id };
}

async function react(node: NodeState, who: { token: string }, id: string, reaction: string, extra: Record<string, unknown> = {}) {
    return node.json(`/v1/messages/${encodeURIComponent(id)}/reactions`, { method: 'POST', headers: auth(who.token), body: JSON.stringify({ reaction, ...extra }) });
}
async function unreact(node: NodeState, who: { token: string }, id: string, reaction: string) {
    return node.json(`/v1/messages/${encodeURIComponent(id)}/reactions?reaction=${encodeURIComponent(reaction)}`, { method: 'DELETE', headers: auth(who.token) });
}

/** The marks on one message as `who` reads its own copy in the thread. */
async function marksSeenBy(node: NodeState, who: Person, conversationId: string, id: string): Promise<Array<{ reaction: string; by: string[] }>> {
    const r = await node.json(`/v1/messages/conversations/${encodeURIComponent(conversationId)}`, { headers: auth(who.token) });
    assert(r.status === 200, `thread: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.messages.find((m: any) => m.id === id)?.reactions ?? [];
}

/** Signs a mark as B and posts it to A, as a peer would. */
async function markFromB(messageId: string, reactor: string, reaction: string) {
    const payload = reactionPayload(B_ID, messageId, { reaction, reactorGhii: reactor, removed: false }, new Date().toISOString());
    const signed = JSON.stringify(payload);
    return A.json('/v1/federation/message/reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-source-node': B_ID },
        body: JSON.stringify({ ...payload, signature: await sign(B.nodeKey.privateKey, signed), ...await audienceProof(B.nodeKey.privateKey, signed, A.nodeId) }),
    });
}

console.log('\n=== A mark on one direct message ===\n');

const servers: Server[] = [];
try {
    await test('A and B boot, peer with messaging on, and people and agents are made', async () => {
        A = await bootNode(suitePort(32200, RUNNER_BASE), A_ID);
        servers.push(A.server);
        B = await bootNode(suitePort(32300, RUNNER_BASE), B_ID);
        servers.push(B.server);
        await setupOperator(A, `reacta${stamp}`);
        await setupOperator(B, `reactb${stamp}`);
        await addPeer(A, B_ID, B.baseUrl, B.nodeKey.publicKey, { allow_messaging: true });
        await addPeer(B, A_ID, A.baseUrl, A.nodeKey.publicKey, { allow_messaging: true });
        const reg = async (node: NodeState, n: string): Promise<Person> => {
            const o = await registerOwner(node.baseUrl, `${n}${stamp}`);
            return { name: o.name, ghii: o.ghii, token: o.token };
        };
        alice = await reg(A, 'rxalice'); carol = await reg(A, 'rxcarol'); dave = await reg(A, 'rxdave');
        bob = await reg(B, 'rxbob');
        agent = await createAgent(A, alice, 'rxhelper', ['messages:send', 'messages:send-as-owner', 'messages:read']);
        narrowAgent = await createAgent(A, alice, 'rxnarrow', ['messages:send', 'messages:read']);
    });

    console.log('\nThe designed uses');

    let local = { id: '', conversationId: '' };
    await test('a person marks a message and the other party\'s thread carries the mark', async () => {
        local = await send(A, alice, carol.ghii, 'Report is ready.');
        const r = await react(A, carol, local.id, '✓');
        assert(r.status === 201 && r.body.data.changed === true, `react: ${r.status} ${JSON.stringify(r.body)}`);
        const seen = await marksSeenBy(A, alice, local.conversationId, local.id);
        assert(seen.length === 1 && seen[0].reaction === '✓' && seen[0].by[0] === carol.ghii, `alice sees ${JSON.stringify(seen)}`);
    });

    await test('the same mark twice changes nothing; a word is a mark too', async () => {
        const again = await react(A, carol, local.id, ' ✓ ');
        assert(again.status === 200 && again.body.data.changed === false, `again: ${again.status} ${JSON.stringify(again.body)}`);
        const word = await react(A, alice, local.id, 'thanks');
        assert(word.status === 201, `word: ${word.status}`);
        const seen = await marksSeenBy(A, carol, local.conversationId, local.id);
        assert(JSON.stringify(seen.map(s => [s.reaction, s.by.length])) === JSON.stringify([['✓', 1], ['thanks', 1]]), `carol sees ${JSON.stringify(seen)}`);
    });

    await test('one\'s own mark comes back off, and only one\'s own', async () => {
        const off = await unreact(A, carol, local.id, '✓');
        assert(off.status === 200 && off.body.data.removed === true, `unreact: ${off.status} ${JSON.stringify(off.body)}`);
        const seen = await marksSeenBy(A, alice, local.conversationId, local.id);
        assert(seen.every(s => s.reaction !== '✓'), `the mark is gone: ${JSON.stringify(seen)}`);
    });

    let cross = { id: '', conversationId: '' };
    await test('a mark crosses to the other node and back', async () => {
        cross = await send(A, alice, bob.ghii, 'Hello across nodes.');
        const accepted = await B.json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, { method: 'POST', headers: auth(bob.token) });
        assert(accepted.status === 200, `accept: ${accepted.status}`);
        const r = await react(B, bob, cross.id, '👍');
        assert(r.status === 201, `bob reacts on B: ${r.status} ${JSON.stringify(r.body)}`);
        const onA = await marksSeenBy(A, alice, cross.conversationId, cross.id);
        assert(onA.some(s => s.reaction === '👍' && s.by.includes(bob.ghii)), `A has bob's mark: ${JSON.stringify(onA)}`);
        const back = await react(A, alice, cross.id, '❤️');
        assert(back.status === 201, `alice reacts on A: ${back.status}`);
        const onB = await marksSeenBy(B, bob, cross.conversationId, cross.id);
        assert(onB.some(s => s.reaction === '❤️' && s.by.includes(alice.ghii)), `B has alice's mark: ${JSON.stringify(onB)}`);
        const undo = await unreact(B, bob, cross.id, '👍');
        assert(undo.status === 200, `bob takes it back: ${undo.status}`);
        const after = await marksSeenBy(A, alice, cross.conversationId, cross.id);
        assert(!after.some(s => s.reaction === '👍'), `A dropped bob's mark: ${JSON.stringify(after)}`);
    });

    await test('an agent marks in its owner\'s name with messages:send-as-owner', async () => {
        const r = await react(A, agent, local.id, '👀', { as_owner: true });
        assert(r.status === 201, `as_owner: ${r.status} ${JSON.stringify(r.body)}`);
        const seen = await marksSeenBy(A, carol, local.conversationId, local.id);
        assert(seen.some(s => s.reaction === '👀' && s.by.includes(alice.ghii)), `the mark is alice's: ${JSON.stringify(seen)}`);
    });

    await test('the agent that wrote a message is woken with dm.reaction, the symbol and who gave it', async () => {
        const sent = await send(A, agent, carol.ghii, 'Draft attached, please confirm.', '/v1/messages/as-owner');
        const heard: DeliveryEvent[] = [];
        const listen = (e: DeliveryEvent) => { if (e.kind === 'dm.reaction') heard.push(e); };
        onDeliveryEvent(listen);
        try {
            const r = await react(A, carol, sent.id, '✓');
            assert(r.status === 201, `react: ${r.status}`);
            await sleep(50);
        } finally { offDeliveryEvent(listen); }
        const e = heard.find(x => x.target === agent.gaii);
        const payload = e?.payload as Record<string, unknown> | undefined;
        assert(!!e && payload?.reaction === '✓' && payload?.reactorGhii === carol.ghii && payload?.messageId === sent.id, `wake-up: ${JSON.stringify(heard)}`);
        // The reactor's palette is private memory: the node does not put it in another principal's wake-up.
        assert(!('meaning' in (payload ?? {})), `the wake-up carries palette text: ${JSON.stringify(payload)}`);
    });

    await test('over MCP, aimeat_dm_react gives and takes back a mark in the owner\'s name', async () => {
        const call = await connectMcp(A, agent.gaii, agent.key);
        const given = await call('aimeat_dm_react', { message_id: local.id, reaction: '🙏', as_owner: true });
        assert(given.ok && given.data.changed === true, `give: ${given.text}`);
        const seen = await marksSeenBy(A, carol, local.conversationId, local.id);
        assert(seen.some(s => s.reaction === '🙏' && s.by.includes(alice.ghii)), `carol sees it: ${JSON.stringify(seen)}`);
        const back = await call('aimeat_dm_react', { message_id: local.id, reaction: '🙏', as_owner: true, remove: true });
        assert(back.ok && back.data.removed === true, `take back: ${back.text}`);
    });

    console.log('\nThe refusals');

    await test('REFUSED: over MCP, as_owner without messages:send-as-owner names the missing permission', async () => {
        const call = await connectMcp(A, narrowAgent.gaii, narrowAgent.key);
        const r = await call('aimeat_dm_react', { message_id: local.id, reaction: '✓', as_owner: true });
        assert(!r.ok && r.text.startsWith('SCOPE_DENIED'), `refused: ${r.text}`);
    });

    await test('REFUSED: another person cannot take back someone\'s mark', async () => {
        const given = await react(A, carol, local.id, '✓');
        assert(given.status === 201, `carol gives: ${given.status}`);
        const other = await unreact(A, dave, local.id, '✓');
        assert(other.status === 404, `dave takes carol's mark: ${other.status}`);
        const seen = await marksSeenBy(A, alice, local.conversationId, local.id);
        assert(seen.some(s => s.reaction === '✓' && s.by.includes(carol.ghii)), `the mark stays: ${JSON.stringify(seen)}`);
    });

    await test('REFUSED: a person holding no copy, and an agent that is not a party, get 404', async () => {
        const stranger = await react(A, dave, local.id, '✓');
        assert(stranger.status === 404, `stranger: ${stranger.status}`);
        const notParty = await react(A, narrowAgent, local.id, '✓');
        assert(notParty.status === 404, `agent as itself: ${notParty.status}`);
    });

    await test('REFUSED: as_owner without messages:send-as-owner is 403 SCOPE_DENIED', async () => {
        const r = await react(A, narrowAgent, local.id, '✓', { as_owner: true });
        assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `as_owner: ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('REFUSED: DELETE /v1/messages/:id/reactions with as_owner and no messages:send-as-owner is 403', async () => {
        const r = await A.json(`/v1/messages/${encodeURIComponent(local.id)}/reactions?reaction=${encodeURIComponent('👀')}&as_owner=true`, {
            method: 'DELETE', headers: auth(narrowAgent.token),
        });
        assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `delete as_owner: ${r.status} ${JSON.stringify(r.body)}`);
        const seen = await marksSeenBy(A, carol, local.conversationId, local.id);
        assert(seen.some(s => s.reaction === '👀' && s.by.includes(alice.ghii)), `alice's mark stays: ${JSON.stringify(seen)}`);
    });

    await test('REFUSED: an empty or a 33-character symbol is 400; taking back a mark not given is 404', async () => {
        assert((await react(A, alice, local.id, '   ')).status === 400, 'empty');
        assert((await react(A, alice, local.id, 'x'.repeat(33))).status === 400, 'too long');
        assert((await unreact(A, alice, local.id, '🙏')).status === 404, 'not given');
    });

    await test('REFUSED: a peer signing a mark for a person of another node is 403, and nothing is written', async () => {
        const r = await markFromB(local.id, carol.ghii, '🔥');
        assert(r.status === 403, `forged reactor: ${r.status} ${JSON.stringify(r.body)}`);
        const seen = await marksSeenBy(A, alice, local.conversationId, local.id);
        assert(!seen.some(s => s.reaction === '🔥'), `written anyway: ${JSON.stringify(seen)}`);
    });

    await test('REFUSED: a peer signing a mark on a message its reactor is not a party of is 403', async () => {
        const r = await markFromB(local.id, bob.ghii, '🔥');
        assert(r.status === 403, `not a party: ${r.status} ${JSON.stringify(r.body)}`);
        const seen = await marksSeenBy(A, alice, local.conversationId, local.id);
        assert(!seen.some(s => s.reaction === '🔥'), `written anyway: ${JSON.stringify(seen)}`);
    });
} finally {
    for (const s of servers) { try { s.close(); } catch { /* closing */ } }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

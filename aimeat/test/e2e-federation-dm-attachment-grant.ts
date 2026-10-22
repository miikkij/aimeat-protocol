/**
 * @file test/e2e-federation-dm-attachment-grant.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A direct-message attachment crosses to another node, and to another person on the same
 *   node, as the file that was SENT and as nothing else (secaudit 2026-10 wave 3, v81 and v82).
 *
 *   WHAT IT ASSERTS, on two whole nodes A and B booted in this process and peered with messaging on:
 *     - The designed uses keep working: a person on A sends a file to a stranger on B, who accepts
 *       later and receives a copy of exactly that file; a repeated grant for the same message (a
 *       recipient node's retry) still returns the same bytes; an attachment held by the sender's agent
 *       (POST /v1/messages/as-owner) is copied across nodes (it answered 404 before, because the
 *       grant read the owner's storage); an attachment stored before the version stamp still crosses
 *       while its file is unchanged; and on one node a request accepted later copies the unchanged file.
 *     - v81: a peer that delivers an inbound message to a local person naming that person's own
 *       private storage key, and then asks for a grant for it, is refused 403 with no download link,
 *       and the answer is the same for a key that does not exist (no existence oracle).
 *     - v82: a file the sender rewrites under the attached key after the send never reaches the
 *       recipient: the origin answers 409 FILE_CHANGED to a later grant, a cross-node or same-node
 *       request accepted after the rewrite ends the attachment as expired, and the older attachment
 *       without a stamp is refused once its file is written after the send.
 *
 *   The nodes follow the run's backend (test/helpers/own-node-db.ts), and take ports of their own
 *   below the range the system hands out (test/helpers/free-port.ts, blocks 32000 and 32100).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-dm-attachment-grant
 * @version-history
 *   2026-10-22 — Initial (secaudit 2026-10 wave 3, v81 and v82).
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { audienceProof } from '../src/services/signed-node-request.js';
import { sign } from '../src/auth/keypair.js';
import { bootNode, setupOperator, addPeer, auth, sleep, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const A_ID = `aimeat-dmatt-a-${stamp}`;
const B_ID = `aimeat-dmatt-b-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let A!: NodeState;
let B!: NodeState;
type Person = { name: string; ghii: string; token: string };
let snd!: Person;      // the sender, on A
let vic!: Person;      // a person on A whose private file a peer tries to read
let p2!: Person;       // a stranger on A (same-node, unchanged)
let p3!: Person;       // a stranger on A (same-node, changed)
let rcv!: Person;      // the recipient on B
let rcv2!: Person;     // a second stranger on B (changed before accept)

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function upload(node: NodeState, token: string, key: string, text: string, visibility = 'private'): Promise<void> {
    const r = await node.json('/v1/storage', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ key, data: b64(text), mime_type: 'text/plain', visibility }),
    });
    assert(r.status === 201, `upload ${key}: ${r.status} ${JSON.stringify(r.body)}`);
}

async function sendDm(token: string, to: string, key: string, size: number, path = '/v1/messages'): Promise<{ id: string; conversationId: string }> {
    const r = await A.json(path, {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ to, body: `file ${key}`, attachments: [{ storage_key: key, mime: 'text/plain', size, kind: 'file', name: key }] }),
    });
    assert(r.status === 201, `send ${key}: ${r.status} ${JSON.stringify(r.body)}`);
    const d = r.body.data;
    return { id: d.message?.id ?? d.message_id, conversationId: d.message?.conversationId ?? d.conversation_id };
}

async function accept(node: NodeState, who: Person, sender: string): Promise<void> {
    const r = await node.json(`/v1/messages/requests/${encodeURIComponent(sender)}/accept`, { method: 'POST', headers: auth(who.token) });
    assert(r.status === 200, `accept on ${node.nodeId}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** The recipient's copy of the attachment, waited for until it is no longer a held reference. */
async function attachmentOf(node: NodeState, mailbox: string, id: string, settle = true): Promise<any> {
    let att: any;
    for (let i = 0; i < 30; i++) {
        att = (await node.storage.getDirectMessage(id, mailbox))?.attachments?.[0];
        if (!settle || att?.mode === 'duplicate' || att?.expired) break;
        await sleep(100);
    }
    return att;
}

async function bytesAt(node: NodeState, owner: string, key: string | undefined): Promise<string | null> {
    if (!key) return null;
    const f = await node.storage.getStorageFile(owner, key);
    return f ? f.data.toString('utf8') : null;
}

/** Does `owner` on `node` hold a file with exactly these bytes, under any key? */
async function holdsBytes(node: NodeState, owner: string, text: string): Promise<boolean> {
    for (const f of await node.storage.listStorageFiles(owner)) {
        if (f.size !== Buffer.byteLength(text)) continue;
        if ((await bytesAt(node, owner, f.key)) === text) return true;
    }
    return false;
}

/** A grant asked of A, signed by B's own node key, as B's duplicator asks for it. */
async function grantAsB(p: { message_id: string; conversation_id: string; storage_key: string; owner_ghii: string; recipient_ghii: string }) {
    const payload = {
        source_node: B.nodeId, message_id: p.message_id, conversation_id: p.conversation_id, storage_key: p.storage_key,
        owner_ghii: p.owner_ghii, recipient_ghii: p.recipient_ghii, timestamp: new Date().toISOString(),
    };
    const signed = JSON.stringify(payload);
    return A.json('/v1/federation/storage/grant', {
        method: 'POST', headers: { 'x-source-node': B.nodeId },
        body: JSON.stringify({ ...payload, signature: await sign(B.nodeKey.privateKey, signed), ...await audienceProof(B.nodeKey.privateKey, signed, A.nodeId) }),
    });
}

async function download(url: string): Promise<{ status: number; text: string }> {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
}

console.log('\n=== A direct-message attachment crosses as the file that was sent ===\n');

const servers: Server[] = [];
try {
    await test('A and B boot with keys of their own and hold each other as active peers with messaging on', async () => {
        A = await bootNode(suitePort(32000, RUNNER_BASE), A_ID);
        servers.push(A.server);
        B = await bootNode(suitePort(32100, RUNNER_BASE), B_ID);
        servers.push(B.server);
        assert(A.nodeKey.publicKey !== B.nodeKey.publicKey, 'A and B hold the same node key');
        await setupOperator(A, `dmatta${stamp}`);
        await setupOperator(B, `dmattb${stamp}`);
        await addPeer(A, B_ID, B.baseUrl, B.nodeKey.publicKey, { allow_messaging: true });
        await addPeer(B, A_ID, A.baseUrl, A.nodeKey.publicKey, { allow_messaging: true });
        const reg = async (node: NodeState, n: string): Promise<Person> => {
            const o = await registerOwner(node.baseUrl, `${n}${stamp}`);
            return { name: o.name, ghii: o.ghii, token: o.token };
        };
        snd = await reg(A, 'dmsnd'); vic = await reg(A, 'dmvic'); p2 = await reg(A, 'dmptwo'); p3 = await reg(A, 'dmpthree');
        rcv = await reg(B, 'dmrcv'); rcv2 = await reg(B, 'dmrcvtwo');
    });

    console.log('\nThe designed uses');

    let first = { id: '', conversationId: '' };
    const K1 = `dmatt/report-${stamp}.txt`;
    const V1 = `V1-the-attached-report-${stamp}`;
    await test('a file sent to a stranger on B is copied as that file once the stranger accepts', async () => {
        await upload(A, snd.token, K1, V1);
        first = await sendDm(snd.token, rcv.ghii, K1, Buffer.byteLength(V1));
        const held = await attachmentOf(B, rcv.ghii, first.id, false);
        assert(held?.mode === 'reference', `a first contact is held as reference, got ${JSON.stringify(held)}`);
        await accept(B, rcv, snd.ghii);
        const att = await attachmentOf(B, rcv.ghii, first.id);
        assert(att?.mode === 'duplicate' && !att.expired, `accepted copy: ${JSON.stringify(att)}`);
        assert(await bytesAt(B, rcv.ghii, att.localKey) === V1, 'the recipient holds the bytes that were sent');
    });

    await test('the sender\'s copy records the version that was sent, read from the stored file', async () => {
        const stamped = (await A.storage.getDirectMessage(first.id, snd.ghii))?.attachments?.[0];
        const meta = await A.storage.getStorageFileMeta(snd.ghii, K1);
        assert(typeof stamped?.version === 'string' && stamped.version === meta?.createdAt, `version ${stamped?.version} vs file ${meta?.createdAt}`);
    });

    await test('a repeated grant for the same message (a retry) returns the same bytes', async () => {
        const r = await grantAsB({ message_id: first.id, conversation_id: first.conversationId, storage_key: K1, owner_ghii: snd.ghii, recipient_ghii: rcv.ghii });
        assert(r.status === 200 && typeof r.body.data?.download_url === 'string', `grant: ${r.status} ${JSON.stringify(r.body)}`);
        const dl = await download(r.body.data.download_url);
        assert(dl.status === 200 && dl.text === V1, `download: ${dl.status} ${dl.text}`);
    });

    await test('a file held by the sender\'s agent and sent in the sender\'s name crosses to B', async () => {
        const reg = await A.json('/v1/agents', {
            method: 'POST', headers: auth(snd.token),
            body: JSON.stringify({ name: `dmbot${stamp}`.toLowerCase(), owner: snd.name, capabilities: ['memory'], scopes: ['messages:send', 'messages:send-as-owner', 'storage:write', 'storage:read'] }),
        });
        assert(reg.status === 201, `agent: ${reg.status} ${JSON.stringify(reg.body)}`);
        const gaii = reg.body.data.agent.gaii as string;
        const ts = new Date().toISOString();
        const tok = await A.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }) });
        assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body)}`);
        const agentToken = tok.body.data.token as string;
        const key = `dmatt/agent-made-${stamp}.txt`;
        const text = `AGENT-MADE-${stamp}`;
        await upload(A, agentToken, key, text);
        const sent = await sendDm(agentToken, rcv.ghii, key, Buffer.byteLength(text), '/v1/messages/as-owner');
        const att = await attachmentOf(B, rcv.ghii, sent.id);
        assert(att?.mode === 'duplicate', `the agent-held file was copied to B, got ${JSON.stringify(att)}`);
        assert(await bytesAt(B, rcv.ghii, att.localKey) === text, 'the recipient holds the agent-made bytes');
    });

    const K4 = `dmatt/legacy-${stamp}.txt`;
    const L1 = `LEGACY-UNCHANGED-${stamp}`;
    let legacy = { id: '', conversationId: '' };
    await test('an attachment stored before the version stamp still crosses while its file is unchanged', async () => {
        await upload(A, snd.token, K4, L1);
        legacy = await sendDm(snd.token, rcv.ghii, K4, Buffer.byteLength(L1));
        const copy = await A.storage.getDirectMessage(legacy.id, snd.ghii);
        // The shape a message written before 2026-10-22 has: no version on its attachment.
        await A.storage.updateMessageAttachments(legacy.id, snd.ghii, (copy?.attachments ?? []).map(({ version: _v, ...a }) => a));
        const r = await grantAsB({ message_id: legacy.id, conversation_id: legacy.conversationId, storage_key: K4, owner_ghii: snd.ghii, recipient_ghii: rcv.ghii });
        assert(r.status === 200, `legacy grant: ${r.status} ${JSON.stringify(r.body)}`);
        const dl = await download(r.body.data.download_url);
        assert(dl.text === L1, `legacy download: ${dl.text}`);
    });

    await test('on one node, a request accepted later copies the unchanged file', async () => {
        const key = `dmatt/local-${stamp}.txt`;
        const text = `LOCAL-UNCHANGED-${stamp}`;
        await upload(A, snd.token, key, text);
        const sent = await sendDm(snd.token, p2.ghii, key, Buffer.byteLength(text));
        await accept(A, p2, snd.ghii);
        const att = await attachmentOf(A, p2.ghii, sent.id);
        assert(att?.mode === 'duplicate', `same-node accept: ${JSON.stringify(att)}`);
        assert(await bytesAt(A, p2.ghii, att.localKey) === text, 'the local recipient holds the sent bytes');
    });

    console.log('\nv81: a planted inbound message is no grant');

    const VKEY = `private/diary-${stamp}.txt`;
    const VTEXT = `VICTIM-PRIVATE-${stamp}`;
    const NOKEY = `private/nothing-${stamp}`;
    let planted = { id: '', conversationId: '' };
    await test('B delivers an inbound message to a person on A that names that person\'s own private key', async () => {
        await upload(A, vic.token, VKEY, VTEXT);
        planted = { id: randomUUID(), conversationId: randomUUID() };
        const message = {
            id: planted.id, conversationId: planted.conversationId, senderGhii: `mallory@${B.nodeId}`,
            recipientGhii: vic.ghii, deliveryGhii: vic.ghii, body: 'hello',
            attachments: [
                { id: 'a1', storageKey: VKEY, mime: 'text/plain', size: Buffer.byteLength(VTEXT), kind: 'file', inline: false, mode: 'reference', ownerGhii: 'x', originNodeId: 'x' },
                // A key nobody holds: the probe that told a peer whether a key exists (404 against 200).
                { id: 'a2', storageKey: NOKEY, mime: 'text/plain', size: 1, kind: 'file', inline: false, mode: 'reference', ownerGhii: 'x', originNodeId: 'x' },
            ],
            createdAt: new Date().toISOString(),
        };
        const payload = { source_node: B.nodeId, message, timestamp: new Date().toISOString() };
        const signed = JSON.stringify(payload);
        const r = await A.json('/v1/federation/message', {
            method: 'POST', headers: { 'x-source-node': B.nodeId },
            body: JSON.stringify({ ...payload, signature: await sign(B.nodeKey.privateKey, signed), ...await audienceProof(B.nodeKey.privateKey, signed, A.nodeId) }),
        });
        assert(r.status === 200, `the message itself is accepted as a request: ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('REFUSED: a grant for that inbound copy gets 403 and no download link', async () => {
        const r = await grantAsB({ message_id: planted.id, conversation_id: planted.conversationId, storage_key: VKEY, owner_ghii: vic.ghii, recipient_ghii: vic.ghii });
        assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `expected 403 FORBIDDEN, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(!r.body.data?.download_url, 'no download capability may be issued');
        assert(await bytesAt(A, vic.ghii, VKEY) === VTEXT, 'the victim\'s file is untouched');
    });

    await test('REFUSED: the same grant for a key that does not exist answers the same, so nothing is learned', async () => {
        const r = await grantAsB({ message_id: planted.id, conversation_id: planted.conversationId, storage_key: NOKEY, owner_ghii: vic.ghii, recipient_ghii: vic.ghii });
        assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `expected the same 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('REFUSED: naming B\'s recipient on a real sent message does not open another file of the sender', async () => {
        const r = await grantAsB({ message_id: first.id, conversation_id: first.conversationId, storage_key: VKEY, owner_ghii: snd.ghii, recipient_ghii: rcv.ghii });
        assert(r.status === 403 && !r.body.data?.download_url, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nv82: only the version that was sent');

    await test('REFUSED: after the sender rewrites the attached key, a grant answers 409 FILE_CHANGED and no link', async () => {
        await sleep(5);
        await upload(A, snd.token, K1, `V2-PRIVATE-NEVER-SENT-${stamp}`);
        const r = await grantAsB({ message_id: first.id, conversation_id: first.conversationId, storage_key: K1, owner_ghii: snd.ghii, recipient_ghii: rcv.ghii });
        assert(r.status === 409 && r.body.error?.code === 'FILE_CHANGED', `expected 409 FILE_CHANGED, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(!r.body.data?.download_url, 'no download capability for the later version');
    });

    await test('REFUSED: an attachment without a stamp is refused once its file is written after the send', async () => {
        await sleep(5);
        await upload(A, snd.token, K4, `LEGACY-REWRITTEN-${stamp}`);
        const r = await grantAsB({ message_id: legacy.id, conversation_id: legacy.conversationId, storage_key: K4, owner_ghii: snd.ghii, recipient_ghii: rcv.ghii });
        assert(r.status === 409 && r.body.error?.code === 'FILE_CHANGED', `expected 409 FILE_CHANGED, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('REFUSED: a stranger on B who accepts after the sender rewrote the key gets an ended attachment, not the new bytes', async () => {
        const key = `dmatt/cross-changed-${stamp}.txt`;
        const sentText = `X1-SENT-${stamp}`;
        const later = `X2-LATER-PRIVATE-${stamp}`;
        await upload(A, snd.token, key, sentText);
        const sent = await sendDm(snd.token, rcv2.ghii, key, Buffer.byteLength(sentText));
        await sleep(5);
        await upload(A, snd.token, key, later);
        await accept(B, rcv2, snd.ghii);
        const att = await attachmentOf(B, rcv2.ghii, sent.id);
        assert(att?.mode !== 'duplicate' && !att?.localKey, `the later file was copied: ${JSON.stringify(att)}`);
        assert(att?.expired === true, `the attachment ends as expired, got ${JSON.stringify(att)}`);
        assert(!await holdsBytes(B, rcv2.ghii, later), 'the later bytes reached the recipient\'s storage');
    });

    await test('REFUSED: on one node, a request accepted after the sender rewrote the key gets an ended attachment', async () => {
        const key = `dmatt/local-changed-${stamp}.txt`;
        const sentText = `W1-SENT-${stamp}`;
        const later = `W2-LATER-PRIVATE-${stamp}`;
        await upload(A, snd.token, key, sentText, 'public');
        const sent = await sendDm(snd.token, p3.ghii, key, Buffer.byteLength(sentText));
        await sleep(5);
        await upload(A, snd.token, key, later);
        await accept(A, p3, snd.ghii);
        const att = await attachmentOf(A, p3.ghii, sent.id);
        assert(att?.mode !== 'duplicate' && !att?.localKey, `the later file was copied: ${JSON.stringify(att)}`);
        assert(att?.expired === true, `the attachment ends as expired, got ${JSON.stringify(att)}`);
        assert(!await holdsBytes(A, p3.ghii, later), 'the later bytes reached the recipient\'s storage');
    });
} finally {
    for (const s of servers) { try { s.close(); } catch { /* closing */ } }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

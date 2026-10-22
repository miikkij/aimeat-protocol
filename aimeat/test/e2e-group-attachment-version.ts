/**
 * @file test/e2e-group-attachment-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A file sent into a group thread reaches the participants as the version that was sent,
 *   or not at all (secaudit 2026-10 wave 3, v82, the group send).
 *
 *   A direct send records the sent file's createdAt on each attachment (DirectMessageAttachment.version),
 *   and a copy made later serves that version or nothing (services/attachment-duplication.ts
 *   isSentVersion). A group send recorded no version, so a copy made later fell back to "any file of the
 *   account under that key not written after the send", which an older file of the sender's agent
 *   under the same key also is.
 *
 *   WHAT IT ASSERTS, on one node booted in this process, a person writing to support@operators (a group
 *   thread whose participant is the operator):
 *     - kept: the operator's copy is made at once, as before; each copy records the version that was
 *       sent; a copy made later of an unchanged file holds the bytes that were sent;
 *     - refused: a copy made later, after the sender rewrote the file under the attached key, ends the
 *       attachment and holds nothing of the new bytes; after the sender removed the file, an older file
 *       of the sender's agent under the same key is not delivered in its place.
 *
 *   "A copy made later" is the operator's copy set back to a held reference, as a full storage quota
 *   leaves it, and copied again by the duplication step the retry sweep runs.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-group-attachment-version
 * @version-history
 *   v1.0.1 -- 2026-10-22 -- REFUSED: the person's agent without messages:send cannot send a file into
 *     the group (403), and the operator holds nothing of it (check:denial-coverage).
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10 wave 3, v82).
 */
import type { Server } from 'node:http';
import { bootNode, setupOperator, auth, sleep, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { duplicateMessageAttachments } from '../src/services/attachment-duplication.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const NODE = `aimeat-grpatt-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let N!: NodeState;
let snd!: { name: string; ghii: string; token: string };
let bot!: McpAgent;
let op = '';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function upload(token: string, key: string, text: string): Promise<void> {
    const r = await N.json('/v1/storage', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, data: b64(text), mime_type: 'text/plain', visibility: 'private' }) });
    assert(r.status === 201, `upload ${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

/** One message to support@operators with one attachment; its id. */
async function sendToSupport(key: string, size: number): Promise<string> {
    const r = await N.json('/v1/messages', {
        method: 'POST', headers: auth(snd.token),
        body: JSON.stringify({ to: 'support@operators', subject: `file ${key}`, body: `file ${key}`, attachments: [{ storage_key: key, mime: 'text/plain', size, kind: 'file', name: key }] }),
    });
    assert(r.status === 201 && typeof r.body.data?.message_id === 'string', `group send ${key}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    return r.body.data.message_id as string;
}

async function bytesAt(owner: string, key: string | undefined): Promise<string | null> {
    if (!key) return null;
    const f = await N.storage.getStorageFile(owner, key);
    return f ? f.data.toString('utf8') : null;
}

/** Does `owner` hold a file with exactly these bytes, under any key? */
async function holdsBytes(owner: string, text: string): Promise<boolean> {
    for (const f of await N.storage.listStorageFiles(owner)) {
        if (f.size === Buffer.byteLength(text) && (await bytesAt(owner, f.key)) === text) return true;
    }
    return false;
}

/** The operator's copy set back to a held reference, then copied again as the retry sweep copies it. */
async function copyLater(id: string, before?: () => Promise<void>): Promise<any> {
    const copy = await N.storage.getDirectMessage(id, op);
    assert(!!copy?.attachments?.length, `the operator has a copy of ${id}`);
    for (const a of copy!.attachments!) if (a.localKey) await N.storage.deleteStorageFile(op, a.localKey);
    await N.storage.updateMessageAttachments(id, op, copy!.attachments!.map(({ localKey: _k, ...a }) => ({ ...a, mode: 'reference' as const })));
    if (before) await before();
    const held = await N.storage.getDirectMessage(id, op);
    const dup = await duplicateMessageAttachments({ config: N.config, storage: N.storage, peers: new Map() }, op, held!);
    if (dup.changed) await N.storage.updateMessageAttachments(id, op, dup.attachments);
    return dup.attachments[0];
}

console.log('\n=== A group message attachment is the version that was sent ===\n');

const servers: Server[] = [];
try {
    await test('Setup: one node with an operator, a person, and the person\'s agent that keeps files', async () => {
        N = await bootNode(suitePort(31800, RUNNER_BASE), NODE);
        servers.push(N.server);
        await setupOperator(N, `grpop${stamp}`);
        op = N.ownerGhii;
        const reg = await registerOwner(N.baseUrl, `grpsnd${stamp}`);
        snd = { name: reg.name, ghii: reg.ghii, token: reg.token };
        bot = await makeAgent(N.baseUrl, snd, ['storage:write', 'storage:read'], `grpbot${stamp}`);
        assert(!!op && !!snd.token && !!bot.token, 'the operator, the person and the agent are signed in');
    });

    console.log('\nThe uses kept');

    const K1 = `grp/report-${stamp}.txt`;
    const V1 = `G1-SENT-${stamp}`;
    let m1 = '';
    await test('KEPT: a file sent into the group is copied to the operator at once', async () => {
        await upload(snd.token, K1, V1);
        m1 = await sendToSupport(K1, Buffer.byteLength(V1));
        const att = (await N.storage.getDirectMessage(m1, op))?.attachments?.[0];
        assert(att?.mode === 'duplicate' && !att.expired, `the operator's copy: ${JSON.stringify(att)}`);
        assert(await bytesAt(op, att.localKey) === V1, 'the operator holds the bytes that were sent');
    });

    await test('every copy of the group message records the version that was sent, read from the stored file', async () => {
        const meta = await N.storage.getStorageFileMeta(snd.ghii, K1);
        for (const mailbox of [snd.ghii, op]) {
            const att = (await N.storage.getDirectMessage(m1, mailbox))?.attachments?.[0];
            assert(typeof att?.version === 'string' && att.version === meta?.createdAt, `${mailbox}: version ${att?.version} vs file ${meta?.createdAt}`);
        }
    });

    await test('KEPT: a copy made later of the unchanged file holds the bytes that were sent', async () => {
        const att = await copyLater(m1);
        assert(att?.mode === 'duplicate' && !att.expired, `copied later: ${JSON.stringify(att)}`);
        assert(await bytesAt(op, att.localKey) === V1, 'the later copy holds the sent bytes');
    });

    console.log('\nThe refusals');

    await test('REFUSED: a copy made after the sender rewrote the attached key ends the attachment, and the new bytes go nowhere', async () => {
        const key = `grp/rewritten-${stamp}.txt`;
        const sent = `G2-SENT-${stamp}`;
        const later = `G2-LATER-PRIVATE-${stamp}`;
        await upload(snd.token, key, sent);
        const id = await sendToSupport(key, Buffer.byteLength(sent));
        const att = await copyLater(id, async () => { await sleep(5); await upload(snd.token, key, later); });
        assert(att?.mode !== 'duplicate' && !att?.localKey && att?.expired === true, `the rewritten file was copied: ${JSON.stringify(att)}`);
        assert(!await holdsBytes(op, later), 'the later bytes reached the operator\'s storage');
    });

    await test('REFUSED: after the sender removed the sent file, an older file of the sender\'s agent under the same key is not delivered in its place', async () => {
        const key = `grp/shadowed-${stamp}.txt`;
        const agentOld = `G3-AGENT-OLDER-${stamp}`;
        const sent = `G3-SENT-${stamp}`;
        await upload(bot.token, key, agentOld);
        await sleep(5);
        await upload(snd.token, key, sent);
        await sleep(5);
        const id = await sendToSupport(key, Buffer.byteLength(sent));
        const att = await copyLater(id, async () => {
            const del = await N.json(`/v1/storage/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth(snd.token) });
            assert(del.status === 200, `delete ${del.status} ${JSON.stringify(del.body?.error)}`);
        });
        assert(!await holdsBytes(op, agentOld), `the agent's older file reached the operator: ${JSON.stringify(att)}`);
        assert(att?.mode !== 'duplicate' && att?.expired === true, `the attachment ends: ${JSON.stringify(att)}`);
    });

    await test('REFUSED: the person\'s agent without messages:send cannot send a file into the group (403), and the operator holds nothing of it', async () => {
        const key = `grp/agent-send-${stamp}.txt`;
        const text = `G4-AGENT-SEND-${stamp}`;
        await upload(bot.token, key, text);
        const r = await N.json('/v1/messages', {
            method: 'POST', headers: auth(bot.token),
            body: JSON.stringify({ to: 'support@operators', subject: `file ${key}`, body: `file ${key}`, attachments: [{ storage_key: key, mime: 'text/plain', size: Buffer.byteLength(text), kind: 'file', name: key }] }),
        });
        assert(r.status === 403, `the agent's group send: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
        assert(!await holdsBytes(op, text), 'the agent\'s file reached the operator\'s storage');
    });
} finally {
    for (const srv of servers) { try { srv.close(); } catch { /* closing */ } }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-ai-provenance-rest-declare.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: the REST routes an agent writes messages, posts and task completions through take
 *   the same `ai_provenance` declaration the MCP tools take (aiprov D5), and the reading side gets the
 *   record (D6), a refused send leaves no record behind (D11), one hash rule covers a question message
 *   (D14), and the public feed does not copy a private completion message (D7).
 *
 *   Until 2026-10-08 every one of these REST bodies stripped `ai_provenance`, so a connector or fleet
 *   agent's declaration vanished and the write was stamped from the principal alone. What it proves:
 *     - POST /v1/messages: a declaration is recorded and named in the answer; without provenance:write
 *       it is 403 SCOPE_DENIED; the receiving agent reads the record on its inbox although
 *       /v1/provenance/:id is 404 for it; a send to an unknown recipient leaves no record; a question
 *       message hashes the body with the questions.
 *     - POST /v1/messages/broadcast, POST /v1/boards/:id/posts and the replies route, POST
 *       /v1/agents/:name/messages, POST /v1/agents/:name/tasks/:id/complete: declared → recorded;
 *       no scope → 403 and nothing written (the task stays active); malformed → 400 where the route
 *       validates the block itself.
 *     - A completed task with a public deliverable reaches the public feed without its message.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ai-provenance-rest-declare
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov D5, D6, D7, D11, D14).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 1_000_000;
const ownerAName = `rdeclarea${stamp}`;
const ownerBName = `rdeclareb${stamp}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}
async function registerAgent(ownerToken: string, owner: string, name: string, scopes: string[]) {
    const r = await json('/v1/agents', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], scopes }) });
    assert(r.status === 201, `agent ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const gaii = r.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(r.body.data.private_key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { name, gaii, token: tok.body.data.token as string };
}

const DECLARED = { level: 'ai-generated', human_involvement: 'light-review', model: 'stub/rest-declare' };
const PRIVILEGED = ['messages:send', 'messages:read', 'social:read', 'social:write', 'memory:read', 'memory:write', 'provenance:write'];
const UNPRIVILEGED = PRIVILEGED.filter(s => s !== 'provenance:write');

let ownerA = '', ownerB = '';
let declarer: Awaited<ReturnType<typeof registerAgent>>;
let mute: Awaited<ReturnType<typeof registerAgent>>;
let reader: Awaited<ReturnType<typeof registerAgent>>;

console.log('\n=== REST provenance declarations (aiprov D5) ===\n');

await test('Setup: two owners, a declaring agent, an agent without provenance:write, and another owner\'s reader', async () => {
    ownerA = await registerOwner(ownerAName);
    ownerB = await registerOwner(ownerBName);
    declarer = await registerAgent(ownerA, ownerAName, 'declarer', PRIVILEGED);
    mute = await registerAgent(ownerA, ownerAName, 'mute', UNPRIVILEGED);
    reader = await registerAgent(ownerB, ownerBName, 'reader', ['messages:send', 'messages:read']);
    assert(declarer.gaii !== mute.gaii && reader.gaii.endsWith(`${ownerBName}@${NODE_ID}`), `identities: ${declarer.gaii} ${mute.gaii} ${reader.gaii}`);
});

console.log('\nPOST /v1/messages');

let declaredMessageRecord = '';
await test('A declaration is recorded and named in the answer', async () => {
    const r = await post('/v1/messages', declarer.token, { to: reader.gaii, body: `Declared hello ${stamp}`, ai_provenance: DECLARED });
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const rec = r.body.data.ai_provenance?.record;
    assert(rec?.level === 'ai-generated' && rec?.humanInvolvement === 'light-review' && rec?.generator?.model === 'stub/rest-declare',
        `the declaration was not recorded: ${JSON.stringify(r.body.data.ai_provenance)}`);
    assert(r.body.data.ai_provenance_id === r.body.data.ai_provenance.id && r.body.data.message?.aiProvenanceId === r.body.data.ai_provenance_id,
        `the message and the answer name the same record: ${JSON.stringify({ id: r.body.data.ai_provenance_id, msg: r.body.data.message?.aiProvenanceId })}`);
    declaredMessageRecord = r.body.data.ai_provenance_id;
});

await test('CROSS-SCOPE → refused: a declaration without provenance:write is 403 SCOPE_DENIED', async () => {
    const r = await post('/v1/messages', mute.token, { to: reader.gaii, body: `Not mine to declare ${stamp}`, ai_provenance: { level: 'original', human_involvement: 'full-human' } });
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED' && String(r.body?.error?.message).includes('provenance:write'),
        `expected 403 SCOPE_DENIED naming provenance:write, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    // POSITIVE CONTROL: the same agent saying nothing is stamped model-written by the node.
    const ok = await post('/v1/messages', mute.token, { to: reader.gaii, body: `Undeclared hello ${stamp}` });
    assert(ok.status === 201 && ok.body.data.ai_provenance?.record?.level === 'ai-generated',
        `an agent that declared nothing is recorded as model-written: ${ok.status} ${JSON.stringify(ok.body.data?.ai_provenance ?? ok.body?.error)}`);
});

await test('The receiving agent reads the record on its inbox, though /v1/provenance/:id is not its to resolve (D6)', async () => {
    const inbox = await json('/v1/messages/agent-inbox', { headers: auth(reader.token) });
    assert(inbox.status === 200, `inbox ${inbox.status}: ${JSON.stringify(inbox.body?.error)}`);
    const m = (inbox.body.data.messages ?? []).find((x: any) => x.aiProvenanceId === declaredMessageRecord);
    assert(!!m, `the declared message is in the reader's inbox: ${JSON.stringify((inbox.body.data.messages ?? []).map((x: any) => x.aiProvenanceId))}`);
    assert(m.ai_provenance?.id === declaredMessageRecord && m.ai_provenance.record?.generator?.model === 'stub/rest-declare',
        `the inbox embeds the record: ${JSON.stringify(m.ai_provenance)}`);
    const direct = await json(`/v1/provenance/${declaredMessageRecord}`, { headers: auth(reader.token) });
    assert(direct.status === 404, `a private message's record does not resolve for its recipient: ${direct.status}`);
});

await test('A send refused for an unknown recipient leaves no record behind (D11)', async () => {
    const body = `To nobody at all ${stamp}`;
    const r = await post('/v1/messages', mute.token, { to: `ghost#nobody${stamp}@${NODE_ID}`, body });
    assert(r.status === 404, `expected 404 for an unknown recipient, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    // The owner reads their own private records by hash, so a record minted for this send would show.
    const byHash = await json(`/v1/provenance/by-hash/${sha256(body)}`, { headers: auth(ownerA) });
    assert(byHash.status === 200 && byHash.body.data.count === 0,
        `a refused send left a record: ${JSON.stringify(byHash.body?.data ?? byHash.body?.error)}`);
});

await test('A question message hashes the body WITH the questions, the rule aimeat_dm_ask uses (D14)', async () => {
    const body = `Which one ${stamp}?`;
    // Every field given, in the schema's key order, so the stored questions serialise as sent.
    const questions = [{ id: 'q1', header: 'Pick', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiSelect: false, allowOther: true, required: false }];
    const r = await post('/v1/messages', declarer.token, { to: reader.gaii, body, interactive: { role: 'questions', v: 1, questions } });
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const hash = r.body.data.ai_provenance?.record?.attestation?.contentHash;
    assert(hash === `sha256:${sha256(`${body}\n\n${JSON.stringify(questions)}`)}`, `the record hashes body + questions: ${hash}`);
    assert(hash !== `sha256:${sha256(body)}`, 'the questions are not left out of the hash');
});

console.log('\nPOST /v1/messages/broadcast');

await test('A broadcast records the declaration on every copy; without the scope it is 403', async () => {
    const ok = await post('/v1/messages/broadcast', declarer.token, { to: [reader.gaii], body: `Broadcast ${stamp}`, ai_provenance: DECLARED });
    assert(ok.status === 201 && ok.body.data.ai_provenance?.record?.generator?.model === 'stub/rest-declare',
        `broadcast ${ok.status}: ${JSON.stringify(ok.body.data?.ai_provenance ?? ok.body?.error)}`);
    const refused = await post('/v1/messages/broadcast', mute.token, { to: [reader.gaii], body: `Broadcast refused ${stamp}`, ai_provenance: DECLARED });
    assert(refused.status === 403 && refused.body?.error?.code === 'SCOPE_DENIED', `expected 403, got ${refused.status} ${JSON.stringify(refused.body?.error)}`);
});

console.log('\nPOST /v1/boards/:id/posts and replies');

let boardId = '';
let postId = '';
await test('A board post and a reply record the declaration and name it', async () => {
    const b = await post('/v1/boards', declarer.token, { name: `rdeclare${stamp}`, visibility: 'shared', description: 'aiprov D5' });
    assert(b.status === 201, `board ${b.status}: ${JSON.stringify(b.body?.error)}`);
    boardId = b.body.data.id;
    const p = await post(`/v1/boards/${boardId}/posts`, declarer.token, { title: 'Declared', body: `A model wrote this post ${stamp}`, ai_provenance: DECLARED });
    assert(p.status === 201 && p.body.data.ai_provenance?.record?.generator?.model === 'stub/rest-declare',
        `post ${p.status}: ${JSON.stringify(p.body.data?.ai_provenance ?? p.body?.error)}`);
    postId = p.body.data.id;
    const rp = await post(`/v1/boards/${boardId}/posts/${postId}/replies`, declarer.token, { body: `A model wrote this reply ${stamp}`, ai_provenance: DECLARED });
    assert(rp.status === 201 && rp.body.data.ai_provenance?.record?.level === 'ai-generated',
        `reply ${rp.status}: ${JSON.stringify(rp.body.data?.ai_provenance ?? rp.body?.error)}`);
});

await test('CROSS-SCOPE → refused: a post and a reply without provenance:write are 403, and nothing is written', async () => {
    const p = await post(`/v1/boards/${boardId}/posts`, mute.token, { title: 'Refused', body: `Not mine ${stamp}`, ai_provenance: DECLARED });
    assert(p.status === 403 && p.body?.error?.code === 'SCOPE_DENIED', `post: expected 403, got ${p.status} ${JSON.stringify(p.body?.error)}`);
    const rp = await post(`/v1/boards/${boardId}/posts/${postId}/replies`, mute.token, { body: `Not mine either ${stamp}`, ai_provenance: DECLARED });
    assert(rp.status === 403 && rp.body?.error?.code === 'SCOPE_DENIED', `reply: expected 403, got ${rp.status} ${JSON.stringify(rp.body?.error)}`);
    const posts = await json(`/v1/boards/${boardId}/posts`, { headers: auth(declarer.token) });
    assert(!(posts.body.data.posts ?? []).some((x: any) => x.title === 'Refused'), 'the refused post was written');
});

console.log('\nPOST /v1/agents/:name/messages');

await test('An agent message records the declaration; no scope → 403; a malformed block → 400', async () => {
    const ok = await post(`/v1/agents/${declarer.name}/messages`, declarer.token, { content: `To my owner ${stamp}`, direction: 'outbound', ai_provenance: DECLARED });
    assert(ok.status === 201 && ok.body.data.message?.ai_provenance?.record?.generator?.model === 'stub/rest-declare',
        `send ${ok.status}: ${JSON.stringify(ok.body.data?.message?.ai_provenance ?? ok.body?.error)}`);
    const refused = await post(`/v1/agents/${mute.name}/messages`, mute.token, { content: `Not mine ${stamp}`, direction: 'outbound', ai_provenance: DECLARED });
    assert(refused.status === 403 && refused.body?.error?.code === 'SCOPE_DENIED', `expected 403, got ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    const bad = await post(`/v1/agents/${declarer.name}/messages`, declarer.token, { content: 'x', direction: 'outbound', ai_provenance: { level: 'mostly-human' } });
    assert(bad.status === 400 && bad.body?.error?.code === 'INVALID_PROVENANCE', `expected 400 INVALID_PROVENANCE, got ${bad.status} ${JSON.stringify(bad.body?.error)}`);
});

console.log('\nPOST /v1/agents/:name/tasks/:id/complete');

async function activeTask(agentName: string, title: string): Promise<string> {
    const c = await post(`/v1/agents/${agentName}/tasks`, ownerA, {
        title, description: 'aiprov D5', status: 'queued',
        todos: [{ id: 't-1', order: 1, title: 'Do it', environment: 'agent', verification: 'done' }],
    });
    assert(c.status === 201, `task ${c.status}: ${JSON.stringify(c.body?.error)}`);
    const id = c.body.data.task.id as string;
    const s = await post(`/v1/agents/${agentName}/tasks/${id}/start`, ownerA, {});
    assert(s.status === 200, `start ${s.status}: ${JSON.stringify(s.body?.error)}`);
    return id;
}

await test('CROSS-SCOPE → refused: completing with a declaration without provenance:write is 403 and the task stays active', async () => {
    const id = await activeTask(mute.name, 'Refused completion');
    const r = await post(`/v1/agents/${mute.name}/tasks/${id}/complete`, mute.token, { message: 'Done.', ai_provenance: DECLARED });
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `expected 403, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    const t = await json(`/v1/agents/${mute.name}/tasks/${id}`, { headers: auth(ownerA) });
    assert(t.body.data.task.status === 'active', `the task moved: ${t.body.data.task.status}`);
});

await test('A completion records the declaration; the public feed carries no completion message (D7)', async () => {
    const key = `rdeclare.deliverable.${stamp}`;
    const w = await post('/v1/memory', declarer.token, { key, value: { report: 'public result' }, visibility: 'public' });
    assert(w.status === 201, `deliverable ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const id = await activeTask(declarer.name, `Declared completion ${stamp}`);
    const secret = `Private completion notes ${stamp}`;
    const r = await post(`/v1/agents/${declarer.name}/tasks/${id}/complete`, declarer.token, { message: secret, deliverable_key: key, ai_provenance: DECLARED });
    assert(r.status === 200 && r.body.data.task.status === 'done', `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.ai_provenance?.record?.generator?.model === 'stub/rest-declare', `the completion's record: ${JSON.stringify(r.body.data.ai_provenance)}`);
    // The feed entry is written after the answer, and the feed caches per (category, limit) for ten
    // seconds, so each look asks for a different limit.
    let item: any;
    for (let i = 0; i < 20 && !item; i++) {
        await new Promise(res => setTimeout(res, 250));
        const feed = await json(`/v1/public/activity-feed?category=agents&limit=${100 + i}`);
        item = (feed.body.data?.items ?? []).find((x: any) => String(x.summary).includes(`Declared completion ${stamp}`));
    }
    assert(!!item, 'the public deliverable reached the feed');
    assert(!JSON.stringify(item).includes(secret), `the private completion message was copied to the public feed: ${JSON.stringify(item)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

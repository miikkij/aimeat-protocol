/**
 * @file test/e2e-audience-boards-skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the organisation level on boards and skills (plan doc-mvcn6c7e4e5q, V3.5 and
 *   V3.9): a board or a user skill at `organism:<id>` is read by the active members of that organism
 *   and their agents, as services/audience.ts decides, and by nobody else.
 *
 *   Owner A makes an organism, B joins it, C does not. A board and a skill at organism:<id>:
 *   B and B's agent read, post and list; C, C's agent and an anonymous caller are refused. A naming
 *   an organism A is not in is 400 NOT_ORGANISM_MEMBER and nothing is created or changed. Once B
 *   leaves, B is refused: the decision is the live membership. Such a board is not in the public
 *   board catalogue, and such a skill is not in the public agent-skills index.
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.5 and V3.9).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=audience-boards-skills
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** An agent of `ownerToken`'s account, signed in with its key. */
async function mkAgent(ownerToken: string, owner: string, name: string): Promise<string> {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['boards'], model: 'gpt-4o' }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const skillMd = (name: string) => `---\nname: ${name}\ndescription: An organisation skill used by the audience E2E.\n---\n\n# ${name}\n\nSteps for the organisation.\n`;

console.log('\n=== AIMEAT Organisation level on boards and skills E2E ===\n');
const stamp = Date.now();
let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let agentB = '', agentC = '';
let orgId = '', foreignOrgId = '';
let boardId = '', postId = '', privateBoardId = '';
const skillName = `aud-skill-${stamp}`;
const plainSkill = `aud-plain-${stamp}`;
const refusedSkill = `aud-refused-${stamp}`;

await test('Setup: A makes an organism, B joins it, C does not; C makes one of their own', async () => {
    for (const [slot, label] of [['A', 'a'], ['B', 'b'], ['C', 'c']] as const) {
        const o = await registerOwner(BASE, `aud${label}${stamp}`);
        const v = { name: o.name, token: o.token };
        if (slot === 'A') A = v; else if (slot === 'B') B = v; else C = v;
    }
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Aud Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body)}`);
    orgId = org.body.data.organism.id;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(j.status === 201 && j.body.data.status === 'joined', `join ${j.status}: ${JSON.stringify(j.body)}`);
    const other = await json('/v1/organisms', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ name: `Aud Other ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(other.status === 201, `foreign organism ${other.status}`);
    foreignOrgId = other.body.data.organism.id;
    agentB = await mkAgent(B.token, B.name, `aud-agent-b-${stamp}`);
    agentC = await mkAgent(C.token, C.name, `aud-agent-c-${stamp}`);
});

// ── Boards (V3.5) ──

await test('B1. A creates a board at organism:<id>; it is stored at that level and never federated', async () => {
    const r = await json('/v1/boards', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Aud Board ${stamp}`, visibility: `organism:${orgId}`, federate: true }) });
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
    boardId = r.body.data.id;
    assert(r.body.data.visibility === `organism:${orgId}`, `visibility ${r.body.data.visibility}`);
    assert(r.body.data.federate === false, `federate ${r.body.data.federate}`);
    const p = await json(`/v1/boards/${boardId}/posts`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'For members', body: 'Only the organisation reads this.' }) });
    assert(p.status === 201, `A posts ${p.status}: ${JSON.stringify(p.body)}`);
    postId = p.body.data.id;
});

await test('B2. B (a member) and B\'s agent read the posts, the single post and the replies, and B can post and reply', async () => {
    for (const [who, tok] of [['B', B.token], ['B agent', agentB]] as const) {
        const list = await json(`/v1/boards/${boardId}/posts`, { headers: auth(tok) });
        assert(list.status === 200, `${who} posts ${list.status}: ${JSON.stringify(list.body)}`);
        assert(list.body.data.posts.some((x: any) => x.id === postId), `${who} does not see the post`);
        const one = await json(`/v1/boards/${boardId}/posts/${postId}`, { headers: auth(tok) });
        assert(one.status === 200, `${who} single post ${one.status}`);
        const replies = await json(`/v1/boards/${boardId}/posts/${postId}/replies`, { headers: auth(tok) });
        assert(replies.status === 200, `${who} replies ${replies.status}`);
    }
    const p = await json(`/v1/boards/${boardId}/posts`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ title: 'From B', body: 'A member posts.' }) });
    assert(p.status === 201, `B posts ${p.status}: ${JSON.stringify(p.body)}`);
    const rep = await json(`/v1/boards/${boardId}/posts/${postId}/replies`, { method: 'POST', headers: auth(agentB), body: JSON.stringify({ body: 'A member\'s agent replies.' }) });
    assert(rep.status === 201, `B agent replies ${rep.status}: ${JSON.stringify(rep.body)}`);
});

await test('B3. C (not a member) and C\'s agent are refused on every read and write, with the code', async () => {
    for (const [who, tok] of [['C', C.token], ['C agent', agentC]] as const) {
        const list = await json(`/v1/boards/${boardId}/posts`, { headers: auth(tok) });
        assert(list.status === 403 && list.body.error?.code === 'ACCESS_DENIED', `${who} posts: ${list.status} ${JSON.stringify(list.body.error)}`);
        const one = await json(`/v1/boards/${boardId}/posts/${postId}`, { headers: auth(tok) });
        assert(one.status === 403 && one.body.error?.code === 'ACCESS_DENIED', `${who} single post: ${one.status} ${JSON.stringify(one.body.error)}`);
        const replies = await json(`/v1/boards/${boardId}/posts/${postId}/replies`, { headers: auth(tok) });
        assert(replies.status === 403 && replies.body.error?.code === 'ACCESS_DENIED', `${who} replies: ${replies.status}`);
        const post = await json(`/v1/boards/${boardId}/posts`, { method: 'POST', headers: auth(tok), body: JSON.stringify({ title: 'Outsider', body: 'Should not land.' }) });
        assert(post.status === 403 && post.body.error?.code === 'ACCESS_DENIED', `${who} posting: ${post.status} ${JSON.stringify(post.body.error)}`);
        const react = await json(`/v1/boards/${boardId}/posts/${postId}/react`, { method: 'POST', headers: auth(tok), body: JSON.stringify({ reaction: 'thanks' }) });
        // A board the caller cannot see answers a reaction as a missing post does (services/board-write.ts).
        assert(react.status === 404 && react.body.error?.code === 'NOT_FOUND', `${who} reacting: ${react.status}`);
        const sub = await json(`/v1/boards/${boardId}/subscribe`, { method: 'POST', headers: auth(tok), body: JSON.stringify({}) });
        assert(sub.status === 403 && sub.body.error?.code === 'ACCESS_DENIED', `${who} subscribing: ${sub.status} ${JSON.stringify(sub.body.error)}`);
    }
    const after = await json(`/v1/boards/${boardId}/posts`, { headers: auth(A.token) });
    assert(!after.body.data.posts.some((x: any) => x.title === 'Outsider'), 'an outsider post landed');
});

await test('B4. An anonymous caller is refused (401 AUTH_REQUIRED) on the posts and the single post', async () => {
    const list = await json(`/v1/boards/${boardId}/posts`);
    assert(list.status === 401 && list.body.error?.code === 'AUTH_REQUIRED', `anon posts: ${list.status} ${JSON.stringify(list.body.error)}`);
    const one = await json(`/v1/boards/${boardId}/posts/${postId}`);
    assert(one.status === 401, `anon single post: ${one.status}`);
});

await test('B5. GET /v1/boards lists the board to A, B and B\'s agent, and not to C, C\'s agent or anonymous', async () => {
    for (const [who, tok, expect] of [['A', A.token, true], ['B', B.token, true], ['B agent', agentB, true], ['C', C.token, false], ['C agent', agentC, false], ['anon', '', false]] as const) {
        const r = await json('/v1/boards', { headers: tok ? auth(tok) : {} });
        assert(r.status === 200, `${who} list ${r.status}`);
        const has = r.body.data.boards.some((b: any) => b.id === boardId);
        assert(has === expect, `${who} ${expect ? 'misses' : 'sees'} the organisation board`);
    }
});

await test('B6. The organisation board is not in the public board catalogue', async () => {
    const r = await json('/v1/catalogue/boards');
    assert(r.status === 200, `catalogue ${r.status}`);
    assert(boardId && !r.body.data.boards.some((b: any) => b.id === boardId), 'the organisation board is in /v1/catalogue/boards');
});

await test('B7. A naming an organism A is not in: create is 400 NOT_ORGANISM_MEMBER and nothing is created', async () => {
    const name = `Aud Refused ${stamp}`;
    const r = await json('/v1/boards', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name, visibility: `organism:${foreignOrgId}` }) });
    assert(r.status === 400 && r.body.error?.code === 'NOT_ORGANISM_MEMBER', `create: ${r.status} ${JSON.stringify(r.body.error)}`);
    const mine = await json('/v1/boards', { headers: auth(A.token) });
    assert(!mine.body.data.boards.some((b: any) => b.name === name), 'a refused board was created');
    const unknown = await json('/v1/boards', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name, visibility: 'organism:does-not-exist' }) });
    assert(unknown.status === 400 && unknown.body.error?.code === 'NOT_ORGANISM_MEMBER', `unknown organism: ${unknown.status} ${JSON.stringify(unknown.body.error)}`);
});

await test('B8. PATCH visibility to organism:<id>: A\'s own organism is accepted, a foreign one is 400 and leaves the board as it was', async () => {
    const mk = await json('/v1/boards', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Aud Private ${stamp}`, visibility: 'private' }) });
    assert(mk.status === 201, `private board ${mk.status}`);
    privateBoardId = mk.body.data.id;
    const bad = await json(`/v1/boards/${privateBoardId}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${foreignOrgId}` }) });
    assert(bad.status === 400 && bad.body.error?.code === 'NOT_ORGANISM_MEMBER', `foreign PATCH: ${bad.status} ${JSON.stringify(bad.body.error)}`);
    const stillPrivate = await json(`/v1/boards/${privateBoardId}/posts`, { headers: auth(B.token) });
    assert(stillPrivate.status === 403, `B reads the private board after a refused PATCH: ${stillPrivate.status}`);
    const fed = await json(`/v1/boards/${privateBoardId}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${orgId}`, federate: true }) });
    assert(fed.status === 400, `an organisation board federated: ${fed.status}`);
    const ok = await json(`/v1/boards/${privateBoardId}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${orgId}` }) });
    assert(ok.status === 200 && ok.body.data.visibility === `organism:${orgId}` && ok.body.data.federate === false, `own PATCH: ${ok.status} ${JSON.stringify(ok.body)}`);
    const nowB = await json(`/v1/boards/${privateBoardId}/posts`, { headers: auth(B.token) });
    assert(nowB.status === 200, `B reads after the move: ${nowB.status}`);
    const nowC = await json(`/v1/boards/${privateBoardId}/posts`, { headers: auth(C.token) });
    assert(nowC.status === 403, `C reads after the move: ${nowC.status}`);
});

// ── Skills (V3.9) ──

await test('S1. A publishes a user skill at organism:<id>; the answer says so', async () => {
    const r = await json('/v1/skills', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ skill_md: skillMd(skillName), visibility: `organism:${orgId}` }) });
    assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.skill.visibility === `organism:${orgId}`, `visibility ${r.body.data.skill.visibility}`);
});

await test('S2. B and B\'s agent read the skill (200, with its body)', async () => {
    for (const [who, tok] of [['B', B.token], ['B agent', agentB]] as const) {
        const r = await json(`/v1/skills/${skillName}?scope=user&owner=${A.name}`, { headers: auth(tok) });
        assert(r.status === 200, `${who} ${r.status}: ${JSON.stringify(r.body)}`);
        assert(String(r.body.data.skill.fileContents['SKILL.md'] ?? '').includes('Steps for the organisation'), `${who} got no body`);
    }
});

await test('S3. C, C\'s agent and an anonymous caller are refused (403 FORBIDDEN), on the read and the ZIP', async () => {
    for (const [who, headers] of [['C', auth(C.token)], ['C agent', auth(agentC)], ['anon', {}]] as const) {
        const r = await json(`/v1/skills/${skillName}?scope=user&owner=${A.name}`, { headers });
        assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `${who}: ${r.status} ${JSON.stringify(r.body.error)}`);
        const z = await fetch(`${BASE}/v1/skills/${skillName}/zip?scope=user&owner=${A.name}`, { headers });
        assert(z.status === 403, `${who} zip: ${z.status}`);
    }
});

await test('S4. The skill is not in the public agent-skills index', async () => {
    const r = await json('/.well-known/agent-skills/index.json');
    assert(r.status === 200, `index ${r.status}`);
    const text = JSON.stringify(r.body);
    assert(!text.includes(skillName), 'the organisation skill is in /.well-known/agent-skills/index.json');
    const owner = await json(`/v1/skills/${skillName}?scope=user&owner=${A.name}`, { headers: auth(A.token) });
    assert(owner.status === 200 && owner.body.data.skill.visibility === `organism:${orgId}`, 'the skill exists at the organisation level');
});

await test('S5. A naming an organism A is not in: publish is 400 NOT_ORGANISM_MEMBER and nothing is stored', async () => {
    const r = await json('/v1/skills', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ skill_md: skillMd(refusedSkill), visibility: `organism:${foreignOrgId}` }) });
    assert(r.status === 400 && r.body.error?.code === 'NOT_ORGANISM_MEMBER', `publish: ${r.status} ${JSON.stringify(r.body.error)}`);
    const g = await json(`/v1/skills/${refusedSkill}?scope=user&owner=${A.name}`, { headers: auth(A.token) });
    assert(g.status === 404, `the refused skill exists: ${g.status}`);
});

await test('S6. PATCH visibility: own organism accepted, a foreign one 400 and the skill unchanged', async () => {
    const p = await json('/v1/skills', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ skill_md: skillMd(plainSkill), visibility: 'owner' }) });
    assert(p.status === 201, `publish plain ${p.status}`);
    const bad = await json(`/v1/skills/${plainSkill}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${foreignOrgId}` }) });
    assert(bad.status === 400 && bad.body.error?.code === 'NOT_ORGANISM_MEMBER', `foreign PATCH: ${bad.status} ${JSON.stringify(bad.body.error)}`);
    const still = await json(`/v1/skills/${plainSkill}?scope=user&owner=${A.name}`, { headers: auth(A.token) });
    assert(still.body.data.skill.visibility === 'owner', `changed by a refused PATCH: ${still.body.data.skill.visibility}`);
    const ok = await json(`/v1/skills/${plainSkill}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${orgId}` }) });
    assert(ok.status === 200 && ok.body.data.skill.visibility === `organism:${orgId}`, `own PATCH: ${ok.status} ${JSON.stringify(ok.body)}`);
    const b = await json(`/v1/skills/${plainSkill}?scope=user&owner=${A.name}`, { headers: auth(B.token) });
    assert(b.status === 200, `B after PATCH: ${b.status}`);
    const back = await json(`/v1/skills/${plainSkill}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'owner' }) });
    assert(back.status === 200 && back.body.data.skill.visibility === 'owner', `back to owner: ${JSON.stringify(back.body.data?.skill?.visibility)}`);
    const b2 = await json(`/v1/skills/${plainSkill}?scope=user&owner=${A.name}`, { headers: auth(B.token) });
    assert(b2.status === 403, `B still reads after the skill went back to owner: ${b2.status}`);
});

await test('S7. A board or a skill at the organisation level follows the live membership: once B leaves, B is refused', async () => {
    const l = await json(`/v1/organisms/${orgId}/leave`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(l.status === 200, `leave ${l.status}: ${JSON.stringify(l.body)}`);
    const board = await json(`/v1/boards/${boardId}/posts`, { headers: auth(B.token) });
    assert(board.status === 403, `B reads the board after leaving: ${board.status}`);
    const skill = await json(`/v1/skills/${skillName}?scope=user&owner=${A.name}`, { headers: auth(agentB) });
    assert(skill.status === 403, `B's agent reads the skill after B left: ${skill.status}`);
});

await test('Cleanup', async () => {
    for (const id of [boardId, privateBoardId]) if (id) await json(`/v1/boards/${id}`, { method: 'DELETE', headers: auth(A.token) });
    for (const n of [skillName, plainSkill]) await json(`/v1/skills/${n}`, { method: 'DELETE', headers: auth(A.token) });
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(A.token) });
    if (foreignOrgId) await json(`/v1/organisms/${foreignOrgId}`, { method: 'DELETE', headers: auth(C.token) });
    for (const o of [B, C, A]) if (o.name) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: auth(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file e2e-publish-gate-shared.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish gate on what is shared with other people (plan doc-mvcn6c7e4e5q,
 *   V4): organisms, boards, user skills, cortex libraries and workspace shares. For each kind:
 *     - gate off (the code default): an agent without publish:public makes it public at once;
 *     - gate agents-and-apps: the same agent gets 202 with a publish request, the target is not public
 *       (anonymous, or another account for a cortex, cannot read or open it), and the owner's approval
 *       makes it public;
 *     - a target changed after the request is not published by its approval (409 OUTDATED);
 *     - an agent holding publish:public, and the owner in person, make it public at once;
 *     - the MCP tool of the same door answers publish_request in its text, not as an error;
 *     - refusals: another owner changing A's organism (403) or A's cortex visibility (403).
 * @version-history
 *   2026-10-31 — An organisation board asked to public with federate true keeps its level and is not
 *     federated (secaudit 2026-10-31 inv-13).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-gate-shared

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();
const tag = stamp.toString(36);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

console.log('\n=== AIMEAT Publish Gate (organisms, boards, skills, cortexes, workspace shares) E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;

const WORDS = ['organism:read', 'organism:write', 'social:read', 'social:write', 'memory:read', 'memory:write', 'cortex:write', 'catalogue:read'];
const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
const approve = (id: string) => call(`/v1/publish-requests/${id}/decision`, { token: A.token, method: 'POST', body: { decision: 'approve' } });

/** A publish request answer: 202, the request waiting for the owner. */
function asked(r: { status: number; body: Body }, what: string): Body {
    assert(r.status === 202, `${what}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const pr = r.body.data?.publish_request ?? r.body.publish_request;
    assert(pr && pr.status === 'awaiting_owner' && typeof pr.request_id === 'string' && String(pr.approve_url).includes('tab=notifications'),
        `${what}: no request ${JSON.stringify(pr)}`);
    return pr;
}

// ── Fixtures ──
const skillMd = (name: string, line = 'Lead with the conclusion.') => `---
name: ${name}
description: How to write a short brief for this team. Use when asked to draft a brief.
---

# Brief

${line}
`;
const cortexManifest = (name: string, visibility: 'public' | 'private', version = '1.0.0') => `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: ${A.name}
  visibility: ${visibility}
spec:
  version: "${version}"
  components:
    - type: lib
      name: helper
      filename: helper.js
      exports: [hello]
      api_surface: hello()
`;
const cortexLibs = { 'helper.js': 'export function hello() { return "hi"; }' };
const cortexInstall = (token: string, name: string, visibility: 'public' | 'private') =>
    call('/v1/cortex', { token, method: 'POST', body: { manifest: cortexManifest(name, visibility), libs: cortexLibs } });
/** A cortex as another account reads it: 200 only when it is public. */
const otherReadsCortex = (name: string) => call(`/v1/cortex/${encodeURIComponent(name)}`, { token: B.token });
const anonBoards = async (): Promise<string[]> => ((await call('/v1/boards')).body.data?.boards as Body[] ?? []).map(b => b.id as string);
const anonSkill = (name: string) => call(`/v1/skills/${name}?scope=user&owner=${encodeURIComponent(A.name)}`);

// The workspace a share opens: an organism of A's, one document space, published pages.
let orgId = '';
let ws = '';
const pages: string[] = [];
const anonPage = (id: string) => call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${id}`);
const share = (token: string, body: Body) => call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token, method: 'PUT', body });

await test('Setup: an operator, owner A with two agents and a workspace of published pages, owner B', async () => {
    op = await registerOwner(BASE, `pgsop${stamp}`);
    A = await registerOwner(BASE, `pgsa${stamp}`);
    B = await registerOwner(BASE, `pgsb${stamp}`);
    asker = await makeAgent(BASE, A, WORDS);
    publisher = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
    const o = await call('/v1/organisms', { token: A.token, body: { name: `Shares ${tag}`, description: 'x', visibility: 'private' } });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: {
        name: 'Pages',
        manifest: { manifestVersion: '1', name: 'Pages', kind: 'project', objectTypes: [
            { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
        ] },
    } });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
    ws = w.body.data.ws;
    for (const n of [1, 2, 3, 4]) {
        const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: `Page ${n}`, markdown: `# Page ${n} ${tag}` } } });
        assert(d.status === 200, `draft ${n}: ${d.status} ${JSON.stringify(d.body.error)}`);
        const p = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id: d.body.data.id } });
        assert(p.status === 200, `publish ${n}: ${p.status} ${JSON.stringify(p.body.error)}`);
        pages.push(d.body.data.id as string);
    }
});

await test('Gate off (the code default): the agent without publish:public makes each kind public at once', async () => {
    const o = await call('/v1/organisms', { token: asker.token, body: { name: `Off org ${tag}`, visibility: 'public' } });
    assert(o.status === 201 && o.body.data.organism.visibility === 'public' && !o.body.data.publish_request, `organism: ${o.status} ${JSON.stringify(o.body.error ?? o.body.data?.organism?.visibility)}`);
    assert((await call(`/v1/organisms/${o.body.data.organism.id}`)).status === 200, 'anonymous reads the public organism');
    const b = await call('/v1/boards', { token: asker.token, body: { name: `Off board ${tag}`, visibility: 'public' } });
    assert(b.status === 201 && b.body.data.visibility === 'public', `board: ${b.status} ${JSON.stringify(b.body.error)}`);
    assert((await anonBoards()).includes(b.body.data.id), 'anonymous lists the public board');
    const s = await call('/v1/skills', { token: asker.token, body: { skill_md: skillMd(`pgs-off-${tag}`), visibility: 'public' } });
    assert(s.status === 201 && s.body.data.skill.visibility === 'public', `skill: ${s.status} ${JSON.stringify(s.body.error)}`);
    assert((await anonSkill(`pgs-off-${tag}`)).status === 200, 'anonymous reads the public skill');
    const c = await cortexInstall(asker.token, `pgs-off-${tag}`, 'public');
    assert(c.status === 201 && c.body.data.visibility === 'public', `cortex: ${c.status} ${JSON.stringify(c.body.error)}`);
    assert((await otherReadsCortex(`pgs-off-${tag}`)).status === 200, 'another account reads the public cortex');
    const sh = await share(asker.token, { docs: { [`pages/${pages[0]}`]: true } });
    assert(sh.status === 200 && !sh.body.data.publish_request, `share: ${sh.status} ${JSON.stringify(sh.body.error)}`);
    assert((await anonPage(pages[0])).status === 200, 'anonymous opens the shared page');
});

await test('Gate agents-and-apps is set', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body.error)}`);
});

console.log('\nOrganisms');

await test('Organism: a public create (and the default) is made private with a request; approval makes it public', async () => {
    const r = await call('/v1/organisms', { token: asker.token, body: { name: `Asked org ${tag}`, visibility: 'public' } });
    const pr = asked(r, 'create');
    const id = r.body.data.organism.id as string;
    assert(r.body.data.organism.visibility === 'private', `stored as ${r.body.data.organism.visibility}`);
    assert((await call(`/v1/organisms/${id}`)).status === 404, 'anonymous does not see the waiting organism');
    const d = await approve(pr.request_id);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert((await call(`/v1/organisms/${id}`)).status === 200, 'anonymous sees the approved organism');
    const dflt = await call('/v1/organisms', { token: asker.token, body: { name: `Default org ${tag}` } });
    asked(dflt, 'create with the default visibility');
    assert(dflt.body.data.organism.visibility === 'private', `default stored as ${dflt.body.data.organism.visibility}`);
});

await test('Organism: PUT keeps the level and applies the rest; an organism edited since is not published (409 OUTDATED)', async () => {
    const c = await call('/v1/organisms', { token: asker.token, body: { name: `Put org ${tag}`, visibility: 'private' } });
    assert(c.status === 201, `create private: ${c.status}`);
    const id = c.body.data.organism.id as string;
    const u = await call(`/v1/organisms/${id}`, { token: asker.token, method: 'PUT', body: { visibility: 'public', description: 'new words' } });
    const pr = asked(u, 'put');
    assert(u.body.data.organism.visibility === 'private' && u.body.data.organism.description === 'new words', `put stored ${JSON.stringify(u.body.data.organism)}`);
    const edit = await call(`/v1/organisms/${id}`, { token: A.token, method: 'PUT', body: { description: 'edited again' } });
    assert(edit.status === 200, `owner edit: ${edit.status}`);
    const d = await approve(pr.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await call(`/v1/organisms/${id}`)).status === 404, 'still private');
    const other = await call(`/v1/organisms/${id}`, { token: B.token, method: 'PUT', body: { visibility: 'public' } });
    assert(other.status === 403, `another owner changes A's organism: ${other.status}`);
});

await test('Organism: the agent with publish:public and the owner in person create it public at once', async () => {
    const p = await call('/v1/organisms', { token: publisher.token, body: { name: `Pub org ${tag}`, visibility: 'public' } });
    assert(p.status === 201 && p.body.data.organism.visibility === 'public', `publisher: ${p.status} ${JSON.stringify(p.body.error)}`);
    const o = await call('/v1/organisms', { token: A.token, body: { name: `Own org ${tag}`, visibility: 'public' } });
    assert(o.status === 201 && o.body.data.organism.visibility === 'public', `owner: ${o.status}`);
});

console.log('\nBoards');

await test('Board: a public create is made private with a request; approval makes it public', async () => {
    const r = await call('/v1/boards', { token: asker.token, body: { name: `Asked board ${tag}`, visibility: 'public' } });
    const pr = asked(r, 'create');
    assert(r.body.data.visibility === 'private', `stored as ${r.body.data.visibility}`);
    assert(!(await anonBoards()).includes(r.body.data.id), 'anonymous does not list the waiting board');
    const d = await approve(pr.request_id);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert((await anonBoards()).includes(r.body.data.id), 'anonymous lists the approved board');
});

await test('Board: PATCH visibility keeps the level; a board given another level since is not published (409 OUTDATED)', async () => {
    const c = await call('/v1/boards', { token: asker.token, body: { name: `Patch board ${tag}`, visibility: 'private' } });
    assert(c.status === 201, `create private: ${c.status}`);
    const id = c.body.data.id as string;
    const p = await call(`/v1/boards/${id}/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'public' } });
    const pr = asked(p, 'patch');
    assert(p.body.data.visibility === 'private', `patch stored ${p.body.data.visibility}`);
    const shared = await call(`/v1/boards/${id}/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'shared' } });
    assert(shared.status === 200 && shared.body.data.visibility === 'shared', `to shared: ${shared.status}`);
    const d = await approve(pr.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(!(await anonBoards()).includes(id), 'still not public');
});

await test('Board: an organisation board asked to public with federate true keeps its level and stays unfederated', async () => {
    const o = await call('/v1/organisms', { token: asker.token, body: { name: `Board org ${tag}`, visibility: 'private' } });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
    const level = `organism:${o.body.data.organism.id}`;
    const c = await call('/v1/boards', { token: asker.token, body: { name: `Org board ${tag}`, visibility: level } });
    assert(c.status === 201 && c.body.data.visibility === level, `create: ${c.status} ${JSON.stringify(c.body.error ?? c.body.data)}`);
    const id = c.body.data.id as string;
    const p = await call(`/v1/boards/${id}/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'public', federate: true } });
    asked(p, 'patch');
    assert(p.body.data.visibility === level, `patch stored ${p.body.data.visibility}`);
    assert(p.body.data.federate === false, `an organisation board was stored federated: ${JSON.stringify(p.body.data)}`);
    const list = await call('/v1/boards', { token: asker.token });
    const row = (list.body.data?.boards as Body[] ?? []).find(b => b.id === id);
    assert(row && row.federate === false, `listed as ${JSON.stringify(row)}`);
});

await test('Board: the agent with publish:public and the owner in person create it public at once', async () => {
    const p = await call('/v1/boards', { token: publisher.token, body: { name: `Pub board ${tag}`, visibility: 'public' } });
    assert(p.status === 201 && p.body.data.visibility === 'public', `publisher: ${p.status} ${JSON.stringify(p.body.error)}`);
    const o = await call('/v1/boards', { token: A.token, body: { name: `Own board ${tag}`, visibility: 'public' } });
    assert(o.status === 201 && o.body.data.visibility === 'public', `owner: ${o.status} ${JSON.stringify(o.body.error)}`);
});

console.log('\nSkills');

await test('Skill: a public publish keeps the skill at owner with a request; approval makes it public', async () => {
    const name = `pgs-ask-${tag}`;
    const r = await call('/v1/skills', { token: asker.token, body: { skill_md: skillMd(name), visibility: 'public' } });
    const pr = asked(r, 'publish');
    assert(r.body.data.skill.visibility === 'owner', `stored as ${r.body.data.skill.visibility}`);
    assert((await anonSkill(name)).status !== 200, 'anonymous does not read the waiting skill');
    const d = await approve(pr.request_id);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert((await anonSkill(name)).status === 200, 'anonymous reads the approved skill');
});

await test('Skill: PATCH keeps the level; a skill republished since is not published (409 OUTDATED)', async () => {
    const name = `pgs-patch-${tag}`;
    const c = await call('/v1/skills', { token: asker.token, body: { skill_md: skillMd(name) } });
    assert(c.status === 201 && c.body.data.skill.visibility === 'owner', `publish: ${c.status}`);
    const p = await call(`/v1/skills/${name}`, { token: asker.token, method: 'PATCH', body: { visibility: 'public' } });
    const pr = asked(p, 'patch');
    assert(p.body.data.skill.visibility === 'owner', `patch stored ${p.body.data.skill.visibility}`);
    const again = await call('/v1/skills', { token: asker.token, body: { skill_md: skillMd(name, 'Something else entirely.') } });
    assert(again.status === 201, `republish: ${again.status}`);
    const d = await approve(pr.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonSkill(name)).status !== 200, 'still not public');
});

await test('Skill: the agent with publish:public and the owner in person publish it public at once', async () => {
    const p = await call('/v1/skills', { token: publisher.token, body: { skill_md: skillMd(`pgs-pub-${tag}`), visibility: 'public' } });
    assert(p.status === 201 && p.body.data.skill.visibility === 'public', `publisher: ${p.status} ${JSON.stringify(p.body.error)}`);
    const o = await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(`pgs-own-${tag}`), visibility: 'public' } });
    assert(o.status === 201 && o.body.data.skill.visibility === 'public', `owner: ${o.status}`);
});

console.log('\nCortex libraries');

await test('Cortex: a manifest asking for public installs private with a request; approval makes it public', async () => {
    const name = `pgs-cx-ask-${tag}`;
    const r = await cortexInstall(asker.token, name, 'public');
    const pr = asked(r, 'install');
    assert(r.body.data.visibility === 'private', `stored as ${r.body.data.visibility}`);
    assert((await otherReadsCortex(name)).status === 404, 'another account does not see the waiting cortex');
    const d = await approve(pr.request_id);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert((await otherReadsCortex(name)).status === 200, 'another account sees the approved cortex');
});

await test('Cortex: the visibility switch keeps the level; a cortex redeployed since is not published (409 OUTDATED)', async () => {
    const name = `pgs-cx-vis-${tag}`;
    const c = await cortexInstall(asker.token, name, 'private');
    assert(c.status === 201 && c.body.data.visibility === 'private', `install private: ${c.status} ${JSON.stringify(c.body.error)}`);
    const v = await call(`/v1/cortex/${name}/visibility`, { token: asker.token, method: 'POST', body: { visibility: 'public' } });
    const pr = asked(v, 'visibility');
    assert(v.body.data.visibility === 'private', `switch stored ${v.body.data.visibility}`);
    const up = await call(`/v1/cortex/${name}`, { token: asker.token, method: 'PUT', body: { manifest: cortexManifest(name, 'private', '1.0.1'), libs: cortexLibs } });
    assert(up.status === 200 && up.body.data.action === 'updated', `redeploy: ${up.status} ${JSON.stringify(up.body.error ?? up.body.data?.action)}`);
    const d = await approve(pr.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await otherReadsCortex(name)).status === 404, 'still private');
    const other = await call(`/v1/cortex/${name}/visibility`, { token: B.token, method: 'POST', body: { visibility: 'public' } });
    assert(other.status === 403, `another owner switches A's cortex: ${other.status}`);
});

await test('Cortex: PUT under a new name asks too; the agent with publish:public and the owner in person install it public at once', async () => {
    const fresh = `pgs-cx-put-${tag}`;
    const put = await call(`/v1/cortex/${fresh}`, { token: asker.token, method: 'PUT', body: { manifest: cortexManifest(fresh, 'public'), libs: cortexLibs } });
    asked(put, 'put create');
    assert(put.body.data.visibility === 'private', `put stored ${put.body.data.visibility}`);
    const p = await cortexInstall(publisher.token, `pgs-cx-pub-${tag}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public', `publisher: ${p.status} ${JSON.stringify(p.body.error)}`);
    const o = await cortexInstall(A.token, `pgs-cx-own-${tag}`, 'public');
    assert(o.status === 201 && o.body.data.visibility === 'public', `owner: ${o.status} ${JSON.stringify(o.body.error)}`);
});

console.log('\nWorkspace shares');

await test('Share: a page shared under open access waits for the owner; approval opens it', async () => {
    const r = await share(asker.token, { docs: { [`pages/${pages[1]}`]: true } });
    const pr = asked(r, 'share');
    assert(r.body.data.share.docs[`pages/${pages[1]}`] !== true, `stored ${JSON.stringify(r.body.data.share.docs)}`);
    assert((await anonPage(pages[1])).status === 404, 'anonymous does not open the waiting page');
    const d = await approve(pr.request_id);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert((await anonPage(pages[1])).status === 200, 'anonymous opens the approved page');
});

await test('Share: access set to open keeps the level; a share changed since is not opened (409 OUTDATED)', async () => {
    const acc = await share(A.token, { access: 'account' });
    assert(acc.status === 200 && acc.body.data.share.access === 'account', `owner narrows: ${acc.status}`);
    assert((await anonPage(pages[1])).status === 401, 'anonymous is asked to sign in');
    const r = await share(asker.token, { access: 'open' });
    const pr = asked(r, 'open the access');
    assert(r.body.data.share.access === 'account', `stored access ${r.body.data.share.access}`);
    const edit = await share(A.token, { docs: { [`pages/${pages[0]}`]: false } });
    assert(edit.status === 200, `owner edit: ${edit.status}`);
    const d = await approve(pr.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonPage(pages[1])).status === 401, 'still sign-in only');
});

await test('Share: the owner in person and the agent with publish:public open it at once', async () => {
    const own = await share(A.token, { access: 'open' });
    assert(own.status === 200 && own.body.data.share.access === 'open', `owner: ${own.status}`);
    assert((await anonPage(pages[1])).status === 200, 'open again');
    const back = await share(A.token, { access: 'account' });
    assert(back.status === 200, `owner narrows: ${back.status}`);
    const pub = await share(publisher.token, { access: 'open' });
    assert(pub.status === 200 && pub.body.data.share.access === 'open' && !pub.body.data.publish_request, `publisher: ${pub.status} ${JSON.stringify(pub.body.error)}`);
    assert((await anonPage(pages[1])).status === 200, 'open by the publisher');
});

console.log('\nMCP');

await test('MCP: each gated tool answers publish_request in its text, not as an error', async () => {
    const s = await openSession(BASE, asker.token);
    const org = await callTool(s, 'aimeat_organism_create', { name: `Mcp org ${tag}`, visibility: 'public' });
    assert(!org.isError && org.text.includes('publish_request') && org.data?.organism?.visibility === 'private', `organism_create: ${org.text.slice(0, 300)}`);
    const upd = await callTool(s, 'aimeat_organism_update', { organism_id: org.data.organism.id, visibility: 'public' });
    assert(!upd.isError && upd.text.includes('publish_request'), `organism_update: ${upd.text.slice(0, 300)}`);
    const board = await callTool(s, 'aimeat_board_create', { name: `Mcp board ${tag}`, visibility: 'public' });
    assert(!board.isError && board.text.includes('publish_request') && board.data?.visibility === 'private', `board_create: ${board.text.slice(0, 300)}`);
    const skill = await callTool(s, 'aimeat_skill_publish', { skill_md: skillMd(`pgs-mcp-${tag}`), visibility: 'public' });
    assert(!skill.isError && skill.text.includes('publish_request') && skill.data?.skill?.visibility === 'owner', `skill_publish: ${skill.text.slice(0, 300)}`);
    const plain = await callTool(s, 'aimeat_skill_publish', { skill_md: skillMd(`pgs-mcp2-${tag}`) });
    assert(!plain.isError, `skill_publish private: ${plain.text.slice(0, 200)}`);
    const supd = await callTool(s, 'aimeat_skill_update', { name: `pgs-mcp2-${tag}`, visibility: 'public' });
    assert(!supd.isError && supd.text.includes('publish_request'), `skill_update: ${supd.text.slice(0, 300)}`);
    const cx = await callTool(s, 'aimeat_cortex_install', { manifest: cortexManifest(`pgs-cx-mcp-${tag}`, 'public'), libs: cortexLibs });
    assert(!cx.isError && cx.text.includes('publish_request') && cx.data?.visibility === 'private', `cortex_install: ${cx.text.slice(0, 300)}`);
    const sh = await callTool(s, 'aimeat_workspace_share', { organism_id: orgId, ws, space: 'pages', id: pages[3], shared: true });
    assert(!sh.isError && sh.text.includes('publish_request'), `workspace_share: ${sh.text.slice(0, 300)}`);
    assert((await anonPage(pages[3])).status === 404, 'the page the tool asked about is not open');
});

await test('Cleanup: the gate back to off', async () => {
    const g = await setGate('off');
    assert(g.status === 200, `gate off: ${g.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);

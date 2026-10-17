/**
 * @file e2e-exposure-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the exposure report (plan doc-mvcn6c7e4e5q, V6.1-V6.3): what of a person someone
 *   outside can read, and how to close each. Owner A makes one exposed thing of each kind it can make
 *   over REST (a public and a members memory record, a public file, a listed app, an app with no code
 *   taken off the lists, an open workspace share, a public organism, a public board, a public skill)
 *   and private ones beside them (a private record and file, an app behind an access code, a private
 *   board). Asserted:
 *     - GET /v1/exposure/mine lists every exposed thing at its level and none of the private ones;
 *     - A's own agent with memory:read reads A's report, over REST and over MCP (aimeat_exposure_report);
 *     - owner B's report and B's agent's report list nothing of A's;
 *     - closing one with what `how_to_close` names takes it off the report;
 *     - the refusals: anonymous 401, B's agent without memory:read 403 (REST) and refused (MCP),
 *       GET /v1/admin/exposure 403 for a non-operator and numbers only for the operator.
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.3).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-exposure-report

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n=== AIMEAT Exposure Report E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let aAgent = '', bAgent = '', bAgentNoRead = '';
let privateOrg = '', publicOrg = '', ws = '', docId = '', publicBoard = '', privateBoard = '';

const K = {
    pubMem: `exp.pub.${stamp}`, memMem: `exp.members.${stamp}`, privMem: `exp.private.${stamp}`,
    pubFile: `exp/pub-${stamp}.txt`, privFile: `exp/private-${stamp}.txt`,
    listedApp: `exp-listed-${stamp}.html`, unlistedApp: `exp-unlisted-${stamp}.html`, codedApp: `exp-coded-${stamp}.html`,
    skill: `exp-skill-${stamp}`,
};

/** A's report, as `token` reads it. */
async function report(token: string): Promise<Body> {
    const r = await call('/v1/exposure/mine', { token });
    assert(r.status === 200, `report ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}
const find = (rep: Body, kind: string, id: string) => (rep.items as Body[]).find(i => i.kind === kind && i.id === id);

await test('Setup: an operator, owner A with one exposed thing of each kind and private ones, owner B, and agents', async () => {
    // The first account of a fresh node is its operator.
    op = await registerOwner(BASE, `expop${stamp}`);
    A = await registerOwner(BASE, `expa${stamp}`);
    B = await registerOwner(BASE, `expb${stamp}`);
    aAgent = (await makeAgent(BASE, A, ['memory:read'])).token;
    bAgent = (await makeAgent(BASE, B, ['memory:read'])).token;
    bAgentNoRead = (await makeAgent(BASE, B, ['social:read'])).token;

    for (const [key, visibility] of [[K.pubMem, 'public'], [K.memMem, 'members'], [K.privMem, 'private']] as const) {
        const m = await call('/v1/memory', { token: A.token, body: { key, value: { note: key }, visibility } });
        assert(m.status === 201, `memory ${key}: ${m.status} ${JSON.stringify(m.body.error)}`);
    }
    for (const [key, visibility] of [[K.pubFile, 'public'], [K.privFile, 'private']] as const) {
        const f = await call('/v1/storage', { token: A.token, body: { key, data: b64(`file ${key}`), mime_type: 'text/plain', visibility } });
        assert(f.status === 201, `file ${key}: ${f.status} ${JSON.stringify(f.body.error)}`);
    }
    const html = (t: string) => b64(`<!DOCTYPE html><html><head><title>${t}</title></head><body>${t}</body></html>`);
    for (const [filename, extra] of [[K.listedApp, {}], [K.unlistedApp, {}], [K.codedApp, { access_code: 'kood1234' }]] as const) {
        const a = await call('/v1/apps', { token: A.token, body: { filename, content: html(filename), mime_type: 'text/html', description: 'Exposure fixture', ...extra } });
        assert(a.status === 201, `app ${filename}: ${a.status} ${JSON.stringify(a.body.error)}`);
    }
    const park = await call(`/v1/apps/${K.unlistedApp}`, { token: A.token, method: 'PATCH', body: { parked: true } });
    assert(park.status === 200, `park: ${park.status} ${JSON.stringify(park.body.error)}`);

    const po = await call('/v1/organisms', { token: A.token, body: { name: `Exposed ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' } });
    assert(po.status === 201, `public organism: ${po.status} ${JSON.stringify(po.body.error)}`);
    publicOrg = po.body.data.organism.id;
    const o = await call('/v1/organisms', { token: A.token, body: { name: `Closed ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' } });
    assert(o.status === 201, `private organism: ${o.status} ${JSON.stringify(o.body.error)}`);
    privateOrg = o.body.data.organism.id;
    const w = await call(`/v1/organisms/${privateOrg}/workspaces`, { token: A.token, body: {
        name: 'Julkaisut',
        manifest: { manifestVersion: '1', name: 'Julkaisut', kind: 'project', objectTypes: [
            { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
        ] },
    } });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
    ws = w.body.data.ws;
    const d = await call(`/v1/organisms/${privateOrg}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: `Shared page ${stamp}`, markdown: '# Shared\n\nAnyone with the link reads this.' } } });
    assert(d.status === 200, `draft: ${d.status} ${JSON.stringify(d.body.error)}`);
    docId = d.body.data.id;
    const p = await call(`/v1/organisms/${privateOrg}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id: docId } });
    assert(p.status === 200, `publish: ${p.status} ${JSON.stringify(p.body.error)}`);
    const s = await call(`/v1/organisms/${privateOrg}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { docs: { [`pages/${docId}`]: true } } });
    assert(s.status === 200, `share: ${s.status} ${JSON.stringify(s.body.error)}`);

    for (const [visibility, set] of [['public', (id: string) => { publicBoard = id; }], ['private', (id: string) => { privateBoard = id; }]] as const) {
        const bd = await call('/v1/boards', { token: A.token, body: { name: `Exposure ${visibility} ${stamp}`, visibility } });
        assert(bd.status === 201, `board ${visibility}: ${bd.status} ${JSON.stringify(bd.body.error)}`);
        set(bd.body.data.id);
    }
    const md = `---\nname: ${K.skill}\ndescription: A public skill the exposure report must list. Use for nothing.\nlicense: MIT\n---\n\n# Public\n`;
    const sk = await call('/v1/skills', { token: A.token, body: { skill_md: md, visibility: 'public' } });
    assert(sk.status === 201, `skill: ${sk.status} ${JSON.stringify(sk.body.error)}`);
});

await test('A\'s report lists every exposed thing at its level', async () => {
    const rep = await report(A.token);
    assert(rep.owner === A.ghii, `owner ${rep.owner}`);
    const listedAt = (kind: string, id: string, level: string) => {
        const it = find(rep, kind, id);
        assert(it !== undefined, `${kind} ${id} is missing: ${JSON.stringify((rep.items as Body[]).map(i => `${i.kind}:${i.id}`))}`);
        assert(it.level === level, `${kind} ${id} level ${it.level}, expected ${level}`);
        assert(typeof it.how_to_close === 'string' && it.how_to_close.length > 20, `${kind} ${id} has no how_to_close`);
    };
    listedAt('memory', K.pubMem, 'public');
    listedAt('memory', K.memMem, 'signed-in');
    listedAt('file', K.pubFile, 'public');
    listedAt('app', K.listedApp, 'public');
    listedAt('app', K.unlistedApp, 'link');
    listedAt('workspace_share', `${privateOrg}/${ws}/pages/${docId}`, 'link');
    listedAt('organism', publicOrg, 'public');
    listedAt('board', publicBoard, 'public');
    listedAt('skill', K.skill, 'public');
    assert(find(rep, 'memory', K.pubMem)!.url?.includes('/v1/memory/'), 'a public record carries the address it is read at');
    assert(find(rep, 'workspace_share', `${privateOrg}/${ws}/pages/${docId}`)!.how_to_close.includes('aimeat_workspace_share'), 'the share names its tool');
    assert(rep.counts.by_level.public >= 6 && rep.counts.by_level.link >= 2 && rep.counts.by_level['signed-in'] >= 1, `counts ${JSON.stringify(rep.counts.by_level)}`);
    assert(Array.isArray(rep.notes) && rep.notes.length > 0, 'the report says what it does not count');
    assert(Array.isArray(rep.failed) && rep.failed.length === 0, `failed kinds: ${JSON.stringify(rep.failed)}`);
});

await test('A\'s report lists none of the private things', async () => {
    const rep = await report(A.token);
    for (const [kind, id] of [['memory', K.privMem], ['file', K.privFile], ['app', K.codedApp], ['organism', privateOrg], ['board', privateBoard]]) {
        assert(!find(rep, kind, id), `${kind} ${id} is private and was listed`);
    }
});

await test('A\'s own agent with memory:read reads A\'s report, over REST and over MCP', async () => {
    const rep = await report(aAgent);
    assert(rep.owner === A.ghii && find(rep, 'memory', K.pubMem), `agent report ${rep.owner}`);
    const session = await openSession(BASE, aAgent, 'e2e-exposure');
    const r = await callTool(session, 'aimeat_exposure_report');
    assert(r.offered && !r.isError, `the MCP tool refused: ${r.text.slice(0, 300)}`);
    assert(r.data.owner === A.ghii, `MCP owner ${r.data.owner}`);
    assert((r.data.items as Body[]).some(i => i.kind === 'skill' && i.id === K.skill), 'the MCP report lacks the public skill');
});

await test('B\'s report, and B\'s agent\'s, list nothing of A\'s', async () => {
    const aIds = new Set([K.pubMem, K.memMem, K.pubFile, K.listedApp, K.unlistedApp, publicOrg, publicBoard, K.skill, `${privateOrg}/${ws}/pages/${docId}`]);
    for (const token of [B.token, bAgent]) {
        const rep = await report(token);
        assert(rep.owner === B.ghii, `B's report is about ${rep.owner}`);
        const leaked = (rep.items as Body[]).filter(i => aIds.has(i.id));
        assert(leaked.length === 0, `B's report lists A's things: ${JSON.stringify(leaked)}`);
    }
});

await test('Closing one with what how_to_close names takes it off the report', async () => {
    const before = find(await report(A.token), 'memory', K.pubMem);
    assert(before?.how_to_close.includes('"visibility":"private"'), `how_to_close: ${before?.how_to_close}`);
    const c = await call(`/v1/memory/${encodeURIComponent(K.pubMem)}`, { token: A.token, method: 'PATCH', body: { patch: {}, visibility: 'private' } });
    assert(c.status === 200, `close: ${c.status} ${JSON.stringify(c.body.error)}`);
    assert(!find(await report(A.token), 'memory', K.pubMem), 'the closed record is still listed');
});

await test('Refused: anonymous 401, another owner\'s agent without memory:read 403 and refused over MCP', async () => {
    const anon = await call('/v1/exposure/mine');
    assert(anon.status === 401, `anonymous: ${anon.status}`);
    const noRead = await call('/v1/exposure/mine', { token: bAgentNoRead });
    assert(noRead.status === 403, `an agent without memory:read: ${noRead.status} ${JSON.stringify(noRead.body.error)}`);
    const session = await openSession(BASE, bAgentNoRead, 'e2e-exposure-noread');
    const r = await callTool(session, 'aimeat_exposure_report');
    assert(r.isError, `the MCP tool answered an agent without memory:read: ${r.text.slice(0, 200)}`);
});

await test('The node-wide numbers: a non-operator gets 403, the operator gets counts and no item', async () => {
    const refused = await call('/v1/admin/exposure', { token: A.token });
    assert(refused.status === 403, `a non-operator read the node-wide report: ${refused.status}`);
    const anon = await call('/v1/admin/exposure');
    assert(anon.status === 401, `anonymous: ${anon.status}`);
    const r = await call('/v1/admin/exposure', { token: op.token });
    assert(r.status === 200, `operator: ${r.status} ${JSON.stringify(r.body.error)}`);
    const data = r.body.data;
    assert(data.owners >= 3, `owners read: ${data.owners}`);
    assert(data.counts.total >= 8, `node total ${data.counts.total}`);
    assert(!('items' in data), 'the node-wide report carries items');
    const aRow = (data.top_owners as Body[]).find(o => o.owner === A.name);
    assert(aRow && aRow.total >= 8, `A is not among the top accounts: ${JSON.stringify(data.top_owners)}`);
    assert(!JSON.stringify(data).includes(K.memMem), 'an item key reached the node-wide report');
});

await test('Cleanup', async () => {
    const statuses: number[] = [];
    for (const org of [privateOrg, publicOrg]) statuses.push((await call(`/v1/organisms/${org}`, { token: A.token, method: 'DELETE' })).status);
    for (const o of [A, B, op]) statuses.push((await call(`/v1/owners/${o.name}`, { token: o.token, method: 'DELETE' })).status);
    assert(statuses.every(s => s === 200), `cleanup statuses ${statuses.join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

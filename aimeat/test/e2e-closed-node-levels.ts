/**
 * @file e2e-closed-node-levels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for two rulings of 2026-10-18 (plan doc-mvcn6c7e4e5q).
 *
 *   V1.6, the closed node. On a node set to show its content to signed-in accounts only
 *   (visibility.content_access signed-in), a new write or change that asks for public is stored at
 *   the kind's signed-in level and the answer carries the warning PUBLIC_IS_SIGNED_IN_HERE.
 *   Asserted, per kind: memory records (POST, PATCH, bulk, MCP aimeat_memory_write), stored files
 *   (POST /v1/storage inline and presigned, the visibility PATCH), user skills (POST and PATCH),
 *   packages, knowledge packages and an entry, data packages (the public default), and workspace
 *   shares (open becomes account). A signed-in account of another owner reads what was stored; content
 *   made public before the node was closed keeps its level; after the node opens again, what was
 *   lowered stays at the signed-in level (anonymous is refused) and an open node is unchanged. A
 *   non-operator setting the config gets 403.
 *
 *   The new-app feed. The public activity feed announces an app only when it is really public:
 *   listed, open to anyone and with no access code. An unlisted or signed-in-only new app, and an
 *   unlisted fork, are not announced; making the app public announces it once.
 * @version-history
 *   v1.1.0 — 2026-10-21 — The owner's agent without storage:read reads the owner's members data package on
 *     the closed node, and gets 403 on a private one (secaudit 2026-10 v41, capability-loss review).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V1.6 and the new-app feed ruling).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-closed-node-levels

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40712';
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
const show = (r: { status: number; body: Body }) => `${r.status} ${JSON.stringify(r.body.error ?? r.body.data ?? r.body).slice(0, 300)}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const WARNING = 'PUBLIC_IS_SIGNED_IN_HERE';
/** True when the answer's `warnings` carry the closed node's warning. */
const warned = (data: Body | undefined): boolean => Array.isArray(data?.warnings) && (data!.warnings as Body[]).some(w => w.code === WARNING && typeof w.message === 'string');

console.log('\n=== AIMEAT Closed Node Levels and the New-App Feed E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let agent!: Awaited<ReturnType<typeof makeAgent>>;

async function setConfig(path: string, value: string | boolean): Promise<void> {
    const r = await call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path, value }] } });
    assert(r.status === 200, `set ${path}=${String(value)}: ${show(r)}`);
}
const CODE_DEFAULTS: Record<string, string | boolean> = {
    'visibility.content_access': 'open',
    'visibility.publish_gate': 'off',
    'apps.default_listing': 'listed',
    'apps.default_access': 'anyone',
    'apps.default_access_code': false,
};
const readMemory = (token: string | undefined, ns: string, key: string) =>
    call(`/v1/memory/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, token ? { token } : {});
const readFile = (token: string | undefined, owner: string, key: string) =>
    call(`/v1/pub/${encodeURIComponent(owner)}/${key}`, token ? { token } : {});
const readSkill = (token: string | undefined, name: string) =>
    call(`/v1/skills/${name}?scope=user&owner=${encodeURIComponent(A.name)}`, token ? { token } : {});
const readPackage = (token: string | undefined, group: string) =>
    call(`/v1/packages/${encodeURIComponent(group)}`, token ? { token } : {});
const readKnowledge = (token: string | undefined, id: string) => call(`/v1/knowledge/${id}`, token ? { token } : {});
const readData = (token: string | undefined, name: string) => call(`/v1/datapackages/${A.name}/${name}`, token ? { token } : {});

const skillMd = (name: string) => `---
name: ${name}
description: How to write a short brief for this team. Use when asked to draft a brief.
---

# Brief

Lead with the conclusion.
`;
const component = (id: string) => ({ id, type: 'memory', label: id, content: JSON.stringify({ entries: [{ key: `cn.${id}`, value: { n: 1 } }] }), dependencies: [] });
const createPkg = (token: string, name: string, visibility?: string) => call('/v1/packages', {
    token, method: 'POST', body: { name, description: 'closed node fixture', category: 'other', components: [component(name)], ...(visibility ? { visibility } : {}) },
});
const importKnowledge = (token: string, name: string, audience: string, entries: Array<{ key: string; visibility: string }>) => call('/v1/knowledge/import', {
    token, method: 'POST',
    body: {
        package: {
            type: 'knowledge-package', name, version: '1.0.0', content_type: 'idea', tags: [`cn${tag}`], language: 'en', maturity: 'draft',
            synthesis: { level: 'original', description: 'test' }, references: [], links: [],
            entries: entries.map(e => ({ ...e, title: e.key })),
            sharing: { catalog_listed: audience === 'public', allow_clone: false, toll_morsels: 0, audience },
        },
        entry_data: Object.fromEntries(entries.map(e => [e.key, { title: e.key, description: `body of ${e.key}` }])),
    },
});
const publishData = (token: string, name: string, visibility?: string) => call('/v1/datapackages', {
    token, method: 'POST', body: { name, changes: 'a version', resources: [{ name: 'items', rows: [{ id: 1, label: 'one' }] }], ...(visibility ? { visibility } : {}) },
});

// A workspace with published pages, for the share.
let orgId = '';
const pagesOf: Record<string, string[]> = {};
async function workspaceWithPage(n: number): Promise<string> {
    const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: {
        name: `Pages ${n}`,
        manifest: { manifestVersion: '1', name: `Pages ${n}`, kind: 'project', objectTypes: [
            { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
        ] },
    } });
    assert(w.status === 201, `workspace ${n}: ${show(w)}`);
    const ws = w.body.data.ws as string;
    pagesOf[ws] = [];
    for (const p of [1, 2]) {
        const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: `Page ${p}`, markdown: `# Page ${p} ${tag}` } } });
        assert(d.status === 200, `draft: ${show(d)}`);
        const pub = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id: d.body.data.id } });
        assert(pub.status === 200, `publish: ${show(pub)}`);
        pagesOf[ws].push(d.body.data.id as string);
    }
    return ws;
}
const share = (ws: string, body: Body) => call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body });
const readPage = (token: string | undefined, ws: string, id: string) =>
    call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${id}`, token ? { token } : {});

// Made public while the node was open.
const pre = { mem: `cn.pre.${tag}`, file: `cn/pre-${tag}.txt`, skill: `cn-pre-${tag}`, pkg: '', data: `cnpre${tag}`, ws: '' };

await test('Setup: the operator (first account), owners A and B, an agent of A; content made public while the node is open', async () => {
    op = await registerOwner(BASE, `cnop${stamp}`);
    A = await registerOwner(BASE, `cna${stamp}`);
    B = await registerOwner(BASE, `cnb${stamp}`);
    agent = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'storage:write']);
    for (const [path, value] of Object.entries(CODE_DEFAULTS)) await setConfig(path, value);

    const m = await call('/v1/memory', { token: A.token, body: { key: pre.mem, value: { n: 0 }, visibility: 'public' } });
    assert(m.status === 201 && m.body.data.visibility === 'public', `pre record: ${show(m)}`);
    const f = await call('/v1/storage', { token: A.token, body: { key: pre.file, data: b64('pre'), mime_type: 'text/plain', visibility: 'public' } });
    assert(f.status === 201 && f.body.data.visibility === 'public', `pre file: ${show(f)}`);
    const s = await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(pre.skill), visibility: 'public' } });
    assert(s.status === 201 && s.body.data.skill.visibility === 'public', `pre skill: ${show(s)}`);
    const p = await createPkg(A.token, `cnprepkg${tag}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public', `pre package: ${show(p)}`);
    pre.pkg = p.body.data.packageGroupId;
    const d = await publishData(A.token, pre.data);
    assert(d.status === 201 && !warned(d.body.data), `pre data package: ${show(d)}`);
    const o = await call('/v1/organisms', { token: A.token, body: { name: `Closed ${tag}`, visibility: 'private' } });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id;
    pre.ws = await workspaceWithPage(0);
    const sh = await share(pre.ws, { docs: { [`pages/${pagesOf[pre.ws][0]}`]: true } });
    assert(sh.status === 200 && sh.body.data.share.access === 'open' && !warned(sh.body.data), `pre share: ${show(sh)}`);
});

await test('A non-operator cannot close the node (403 on PUT /v1/admin/config)', async () => {
    const r = await call('/v1/admin/config', { token: A.token, method: 'PUT', body: { changes: [{ path: 'visibility.content_access', value: 'signed-in' }] } });
    assert(r.status === 403, `owner A sets the config: ${show(r)}`);
});

await test('The operator closes the node: anonymous reads nothing', async () => {
    await setConfig('visibility.content_access', 'signed-in');
    assert((await readMemory(undefined, A.ghii, pre.mem)).status === 401, 'anonymous read on a closed node');
});

console.log('\nMemory records');
const memKey = `cn.mem.${tag}`;
await test('POST /v1/memory public is stored as members with the warning; owner B reads it', async () => {
    const w = await call('/v1/memory', { token: A.token, body: { key: memKey, value: { n: 1 }, visibility: 'public' } });
    assert(w.status === 201 && w.body.data.visibility === 'members' && warned(w.body.data) && !w.body.data.publish_request, `write: ${show(w)}`);
    const r = await readMemory(B.token, A.ghii, memKey);
    assert(r.status === 200 && r.body.data.visibility === 'members', `owner B reads: ${show(r)}`);
});

await test('PATCH /v1/memory/:key public on a private record: members with the warning', async () => {
    const key = `cn.patch.${tag}`;
    assert((await call('/v1/memory', { token: A.token, body: { key, value: { n: 1 }, visibility: 'private' } })).status === 201, 'create');
    const p = await call(`/v1/memory/${encodeURIComponent(key)}`, { token: A.token, method: 'PATCH', body: { patch: { m: 1 }, visibility: 'public' } });
    assert(p.status === 200 && p.body.data.visibility === 'members' && warned(p.body.data), `patch: ${show(p)}`);
});

await test('POST /v1/memory/bulk public: members, and the warning names the key', async () => {
    const key = `cn.bulk.${tag}`;
    const r = await call('/v1/memory/bulk', { token: A.token, body: { entries: [{ key, value: { n: 2 }, visibility: 'public' }] } });
    assert(r.status === 200 && (r.body.data.warnings as Body[] | undefined)?.some(w => w.key === key && w.code === WARNING), `bulk: ${show(r)}`);
    const rec = await readMemory(A.token, A.ghii, key);
    assert(rec.status === 200 && rec.body.data.visibility === 'members', `stored: ${show(rec)}`);
});

await test('MCP aimeat_memory_write public: members, the warning in the result text, not an error', async () => {
    const s = await openSession(BASE, agent.token);
    const t = await callTool(s, 'aimeat_memory_write', { key: `cn.mcp.${tag}`, value: { n: 3 }, visibility: 'public' });
    assert(!t.isError, `MCP: ${t.text.slice(0, 300)}`);
    const out = JSON.parse(t.text) as Body;
    assert(out.visibility === 'members' && warned(out), `MCP answer: ${t.text.slice(0, 300)}`);
});

await test('A record public before the node closed keeps public when written public again, with no warning', async () => {
    const w = await call('/v1/memory', { token: A.token, body: { key: pre.mem, value: { n: 'again' }, visibility: 'public' } });
    assert(w.status === 200 && w.body.data.visibility === 'public' && !warned(w.body.data), `rewrite: ${show(w)}`);
});

console.log('\nStored files');
const fileKey = `cn/file-${tag}.txt`;
await test('POST /v1/storage public: members with the warning; owner B reads it', async () => {
    const f = await call('/v1/storage', { token: A.token, body: { key: fileKey, data: b64('closed'), mime_type: 'text/plain', visibility: 'public' } });
    assert(f.status === 201 && f.body.data.visibility === 'members' && warned(f.body.data), `upload: ${show(f)}`);
    assert((await readFile(B.token, A.ghii, fileKey)).status === 200, 'owner B reads the file');
});

const presignedKey = `cn/pre-signed-${tag}.txt`;
await test('A presigned mint asked public answers the warning and the bytes land at members', async () => {
    const m = await call('/v1/storage', { token: A.token, body: { key: presignedKey, mode: 'presigned', mime_type: 'text/plain', visibility: 'public' } });
    assert(m.status === 200 && typeof m.body.data.upload_url === 'string' && warned(m.body.data), `mint: ${show(m)}`);
    const put = await fetch(m.body.data.upload_url as string, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'presigned bytes', signal: AbortSignal.timeout(60_000) });
    assert(put.status < 300, `PUT: ${put.status}`);
    assert((await readFile(B.token, A.ghii, presignedKey)).status === 200, 'owner B reads the landed file');
});

await test('PATCH /v1/storage/{key}/visibility public: members with the warning; a file public before stays public', async () => {
    const key = `cn/priv-${tag}.txt`;
    assert((await call('/v1/storage', { token: A.token, body: { key, data: b64('p'), mime_type: 'text/plain', visibility: 'private' } })).status === 201, 'private file');
    const p = await call(`/v1/storage/${key}/visibility`, { token: A.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 200 && p.body.data.visibility === 'members' && warned(p.body.data), `patch: ${show(p)}`);
    const keep = await call(`/v1/storage/${pre.file}/visibility`, { token: A.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(keep.status === 200 && keep.body.data.visibility === 'public' && !warned(keep.body.data), `pre file: ${show(keep)}`);
});

console.log('\nUser skills');
const skillName = `cn-skill-${tag}`;
await test('POST /v1/skills public: members with the warning; owner B reads it; a skill public before stays public', async () => {
    const s = await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(skillName), visibility: 'public' } });
    assert(s.status === 201 && s.body.data.skill.visibility === 'members' && warned(s.body.data), `publish: ${show(s)}`);
    assert((await readSkill(B.token, skillName)).status === 200, 'owner B reads the skill');
    const again = await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(pre.skill), visibility: 'public' } });
    assert(again.status === 201 && again.body.data.skill.visibility === 'public' && !warned(again.body.data), `pre skill: ${show(again)}`);
});

await test('PATCH /v1/skills/:name public: members with the warning', async () => {
    const name = `cn-skill2-${tag}`;
    assert((await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(name) } })).status === 201, 'owner-level skill');
    const p = await call(`/v1/skills/${name}`, { token: A.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 200 && p.body.data.skill.visibility === 'members' && warned(p.body.data), `patch: ${show(p)}`);
});

console.log('\nPackages, knowledge packages, data packages');
let pkgGroup = '';
await test('POST /v1/packages public: members with the warning; owner B reads it', async () => {
    const p = await createPkg(A.token, `cnpkg${tag}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'members' && warned(p.body.data) && !p.body.data.publish_request, `create: ${show(p)}`);
    pkgGroup = p.body.data.packageGroupId;
    assert((await readPackage(B.token, pkgGroup)).status === 200, 'owner B reads the package');
});

let kId = '';
await test('POST /v1/knowledge/import listed with a public entry: audience members, unlisted, the warning; owner B reads it', async () => {
    const k = await importKnowledge(A.token, `Closed Knowledge ${tag}`, 'public', [{ key: 'open', visibility: 'public' }, { key: 'note', visibility: 'private' }]);
    assert(k.status === 201 && k.body.data.audience === 'members' && k.body.data.catalog_listed === false && warned(k.body.data), `import: ${show(k)}`);
    kId = k.body.data.package_id;
    assert((await readKnowledge(B.token, kId)).status === 200, 'owner B reads the knowledge package');
});

await test('PATCH a knowledge entry public: members with the warning', async () => {
    const p = await call(`/v1/knowledge/${kId}/entries/note/visibility`, { token: A.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 200 && p.body.data.visibility === 'members' && warned(p.body.data), `entry: ${show(p)}`);
});

const dataName = `cndata${tag}`;
await test('POST /v1/datapackages with the public default: the warning; owner B reads it', async () => {
    const d = await publishData(A.token, dataName);
    assert((d.status === 201 || d.status === 200) && warned(d.body.data) && !d.body.data.publish_request, `publish: ${show(d)}`);
    assert((await readData(B.token, dataName)).status === 200, 'owner B reads the data package');
});

// secaudit 2026-10 v41 and its capability-loss review: on a closed node every package is stored at
// members, and the owner's own agent without storage:read keeps reading them; only a private one asks the word.
await test('A\'s agent without storage:read reads A\'s members data package (descriptor, rows, feed); A\'s private one answers 403 naming storage:read', async () => {
    assert((await readData(agent.token, dataName)).status === 200, 'the agent reads the descriptor');
    const rows = await call(`/v1/datapackages/${A.name}/${dataName}/rows/items`, { token: agent.token });
    assert(rows.status === 200 && rows.body.data.total === 1, `rows: ${show(rows)}`);
    const feed = await call(`/v1/odata/${A.name}/${dataName}/items`, { token: agent.token });
    assert(feed.status === 200, `feed: ${show(feed)}`);
    const priv = `cnpriv${tag}`;
    const p = await publishData(A.token, priv, 'private');
    assert(p.status === 201, `private publish: ${show(p)}`);
    const refused = await call(`/v1/datapackages/${A.name}/${priv}/rows/items`, { token: agent.token });
    assert(refused.status === 403 && refused.body.error?.code === 'SCOPE_DENIED', `private: ${show(refused)}`);
});

console.log('\nWorkspace shares');
let closedWs = '';
await test('A first share with no access (the open default) is stored as account with the warning; owner B reads the page', async () => {
    closedWs = await workspaceWithPage(1);
    const s = await share(closedWs, { docs: { [`pages/${pagesOf[closedWs][0]}`]: true } });
    assert(s.status === 200 && s.body.data.share.access === 'account' && warned(s.body.data), `share: ${show(s)}`);
    assert((await readPage(B.token, closedWs, pagesOf[closedWs][0])).status === 200, 'owner B reads the shared page');
});

await test('A share open before the node closed stays open when another page is shared, with no warning', async () => {
    const s = await share(pre.ws, { docs: { [`pages/${pagesOf[pre.ws][1]}`]: true } });
    assert(s.status === 200 && s.body.data.share.access === 'open' && !warned(s.body.data), `share: ${show(s)}`);
});

await test('The operator opens the node: what was lowered stays at the signed-in level, what was public before is public', async () => {
    await setConfig('visibility.content_access', 'open');
    assert((await readMemory(undefined, A.ghii, memKey)).status !== 200, 'the lowered record is not public');
    assert((await readMemory(undefined, A.ghii, pre.mem)).status === 200, 'the pre record is public');
    assert((await readFile(undefined, A.ghii, fileKey)).status !== 200, 'the lowered file is not public');
    assert((await readFile(undefined, A.ghii, presignedKey)).status !== 200, 'the presigned file is not public');
    assert((await readFile(undefined, A.ghii, pre.file)).status === 200, 'the pre file is public');
    assert((await readSkill(undefined, skillName)).status !== 200, 'the lowered skill is not public');
    assert((await readSkill(undefined, pre.skill)).status === 200, 'the pre skill is public');
    assert((await readPackage(undefined, pkgGroup)).status !== 200, 'the lowered package is not public');
    assert((await readPackage(undefined, pre.pkg)).status === 200, 'the pre package is public');
    assert((await readKnowledge(undefined, kId)).status !== 200, 'the lowered knowledge package is not public');
    assert((await readData(undefined, dataName)).status !== 200, 'the lowered data package is not public');
    assert((await readData(undefined, pre.data)).status === 200, 'the pre data package is public');
    assert((await readPage(undefined, closedWs, pagesOf[closedWs][0])).status !== 200, 'the account share is not open');
    assert((await readPage(undefined, pre.ws, pagesOf[pre.ws][0])).status === 200, 'the pre share is open');
});

await test('An open node is unchanged: public is public, with no warning', async () => {
    const w = await call('/v1/memory', { token: A.token, body: { key: `cn.open.${tag}`, value: { n: 9 }, visibility: 'public' } });
    assert(w.status === 201 && w.body.data.visibility === 'public' && !warned(w.body.data), `write: ${show(w)}`);
    const p = await createPkg(A.token, `cnopenpkg${tag}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public' && !warned(p.body.data), `package: ${show(p)}`);
});

// ── The new-app feed ────────────────────────────────────────────────────────────────────────────
console.log('\nThe new-app feed');

// The feed answer is cached for ten seconds per category and limit, so each read asks a limit of its own.
let feedLimit = 200;
async function feedEntries(filename: string): Promise<Body[]> {
    const r = await call(`/v1/public/activity-feed?category=apps&limit=${feedLimit--}`);
    assert(r.status === 200, `feed: ${show(r)}`);
    return (r.body.data.items as Body[]).filter(i => String(i.link ?? '').includes(`/${encodeURIComponent(filename)}`));
}
/** The feed entries for an app, after the fire-and-forget write had time to land. */
async function settledFeed(filename: string, expect: number): Promise<Body[]> {
    let last: Body[] = [];
    for (let i = 0; i < 10; i++) {
        last = await feedEntries(filename);
        if (last.length >= expect) break;
        await new Promise(r => setTimeout(r, 300));
    }
    return last;
}
const publishApp = (filename: string) => call('/v1/apps', { token: A.token, body: {
    filename, content: b64(`<!DOCTYPE html><html><head><title>${filename}</title></head><body>${filename}</body></html>`), mime_type: 'text/html', description: 'Feed fixture',
} });
const patchApp = (filename: string, body: Body) => call(`/v1/apps/${encodeURIComponent(filename)}`, { token: A.token, method: 'PATCH', body });

await test('A new public app is announced', async () => {
    const f = `cn-public-${tag}.html`;
    assert((await publishApp(f)).status === 201, 'publish');
    assert((await settledFeed(f, 1)).length === 1, 'one feed entry');
});

await test('An unlisted new app is not announced; listing it announces it once, and listing it again does not repeat it', async () => {
    await setConfig('apps.default_listing', 'unlisted');
    const f = `cn-unlisted-${tag}.html`;
    const p = await publishApp(f);
    assert(p.status === 201, `publish: ${show(p)}`);
    await setConfig('apps.default_listing', 'listed');
    assert((await settledFeed(f, 1)).length === 0, 'the unlisted app is not in the feed');
    const l = await patchApp(f, { listing: 'listed' });
    assert(l.status === 200 && l.body.data.listing === 'listed', `list: ${show(l)}`);
    assert((await settledFeed(f, 1)).length === 1, 'announced once when listed');
    assert((await patchApp(f, { listing: 'unlisted' })).status === 200, 'unlist');
    assert((await patchApp(f, { listing: 'listed' })).status === 200, 'list again');
    assert((await settledFeed(f, 2)).length === 1, 'still announced once');
});

await test('A signed-in-only new app is not announced; opening it to anyone announces it once', async () => {
    await setConfig('apps.default_access', 'signed-in');
    const f = `cn-signedin-${tag}.html`;
    assert((await publishApp(f)).status === 201, 'publish');
    await setConfig('apps.default_access', 'anyone');
    assert((await settledFeed(f, 1)).length === 0, 'the signed-in app is not in the feed');
    const o = await patchApp(f, { open_to: 'anyone' });
    assert(o.status === 200, `open: ${show(o)}`);
    assert((await settledFeed(f, 1)).length === 1, 'announced once when opened to anyone');
});

await test('An app with an access code is not announced; an update of it is not either', async () => {
    const f = `cn-code-${tag}.html`;
    assert((await publishApp(f)).status === 201, 'publish');
    assert((await settledFeed(f, 1)).length === 1, 'the public app is announced');
    assert((await patchApp(f, { access_code: `code${tag}` })).status === 200, 'set a code');
    assert((await publishApp(f)).status === 201, 'update');
    assert((await settledFeed(f, 2)).length === 1, 'the update of a coded app is not announced');
});

await test('An unlisted fork is not announced', async () => {
    const source = `cn-public-${tag}.html`;
    await setConfig('apps.default_listing', 'unlisted');
    const forkName = `cn-fork-${tag}.html`;
    const f = await call(`/v1/apps/${encodeURIComponent(A.name)}/${encodeURIComponent(source)}/fork`, { token: A.token, body: { new_filename: forkName } });
    await setConfig('apps.default_listing', 'listed');
    assert(f.status === 201 || f.status === 200, `fork: ${show(f)}`);
    assert((await settledFeed(forkName, 1)).length === 0, 'the unlisted fork is not in the feed');
});

await test('Cleanup: every setting back to its code default', async () => {
    for (const [path, value] of Object.entries(CODE_DEFAULTS)) await setConfig(path, value);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);

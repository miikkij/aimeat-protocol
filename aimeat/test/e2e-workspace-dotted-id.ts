/**
 * @file e2e-workspace-dotted-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One record whose id holds a dot made a shared workspace's index unreadable for every
 *   member: the index split the key on its first dot, so `v1.2.draft` became record `v1` with the role
 *   `2.draft`, a slot with neither a published nor a draft record, and reading it answered 500
 *   (secaudit2026oct31w2 round 10, f-2026-10-23-dotted-id-breaks-index).
 *
 *   The index now reads a record's role from the end of its key, as the write guard and the export
 *   do, and a slot with nothing in it is left out. A record with a dot in its id lists under its whole
 *   id and is read by it, so records written before the fix stay readable without a migration.
 *
 *   FIRST FAIL. On the tree before the fix the "Refused:" test fails (the index answers 500 for the
 *   owner and for a member). The "Usage:" tests pass on both trees, apart from the index read, which
 *   the dotted record breaks on the old tree.
 *
 *   Round 10b: every other reader of a workspace key reads a dotted id the same way (recordAt and
 *   spaceRowAt in services/workspace/record-key.ts): the GET /workspace read, the workspace list's
 *   counts, the activity log, the overview, content search, the dangling-reference scan, the append-
 *   only write guard, the share's AI label in the member read, the public share and the member records
 *   read, and the labels' cap on a space shared whole. Each "Refused:" test of that section fails on
 *   the tree before round 10b; each "Usage:" test there passes on both trees.
 * @version-history
 *   2026-11-01 — The write side: a memory write of a dotted record key in a declared space is stored,
 *     and an undeclared space is still refused (secaudit2026oct31w2 round 10b).
 *   2026-11-01 — The readers outside the index: a second and a third workspace with plain and dotted
 *     ids, one Refused and one Usage test per reader (secaudit2026oct31w2 round 10b).
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-dotted-id
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

const stamp = Date.now().toString(36);
const WS = `wsdot${stamp}`;
const NS = 'notes';
let owner = { name: '', token: '' };
let member = { name: '', token: '' };
let orgId = '';
const root = () => `organism.${orgId}.w.${WS}`;

console.log('\n=== Workspace index with a dotted record id ===\n');

await test('Setup: an owner, a member, an organism and a workspace with a records space', async () => {
    owner = await registerOwner(BASE, `wsdo${stamp}`);
    member = await registerOwner(BASE, `wsdm${stamp}`);
    const o = await post('/v1/organisms', owner.token, { name: 'Dotted', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const join = await post(`/v1/organisms/${orgId}/join`, member.token, {});
    assert(join.status === 200 || join.status === 201, `join ${join.status}: ${JSON.stringify(join.body?.error)}`);
    const reg = await post('/v1/memory', owner.token, { key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Dotted', createdAt: new Date().toISOString(), createdBy: owner.name }] }, visibility: 'private' });
    assert(reg.status === 201, `registry ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Dotted', kind: 'project', status: 'active',
        objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true }],
    };
    const m = await post('/v1/memory', owner.token, { key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body?.error)}`);
    const g = await post(`/v1/organisms/${orgId}/workspace-access/grant`, owner.token, { ws: WS, grantee: member.name, role: 'contributor' });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
});

await test('Usage: plain records are written, one published, and the index lists both', async () => {
    for (const id of ['plain', 'pub']) {
        const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, owner.token, { ws: WS, space: 'note', id, value: { title: `Note ${id}` } });
        assert(w.status === 200, `draft ${id} ${w.status}: ${JSON.stringify(w.body?.error)}`);
    }
    const p = await post(`/v1/organisms/${orgId}/publish`, owner.token, { ws: WS, namespace: NS, id: 'pub' });
    assert(p.status === 200, `publish ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const notes = r.body.data.index.note as any[];
    const byId = Object.fromEntries(notes.map(n => [n.id, n]));
    assert(byId.plain && byId.plain.published === false && byId.plain.has_draft === true, `plain: ${JSON.stringify(byId.plain)}`);
    assert(byId.pub && byId.pub.published === true && byId.pub.title === 'Note pub', `pub: ${JSON.stringify(byId.pub)}`);
    assert(r.body.data.counts.note === 2, `count ${r.body.data.counts.note}`);
});

await test('Refused: a record id with a dot no longer makes the index unreadable, for the owner or a member', async () => {
    const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, owner.token, { ws: WS, space: 'note', id: 'v1.2', value: { title: 'Dotted' } });
    assert(w.status === 200, `the dotted draft is written as before: ${w.status} ${JSON.stringify(w.body?.error)}`);
    for (const [who, token] of [['owner', owner.token], ['member', member.token]] as const) {
        const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(token) });
        assert(r.status === 200, `${who} index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    }
});

await test('Usage: the dotted record lists under its whole id beside the others, and is read by it', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    const ids = (r.body.data.index.note as any[]).map(n => n.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['plain', 'pub', 'v1.2']), `ids ${JSON.stringify(ids)}`);
    const one = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&ids=v1.2&space=note`, { headers: auth(owner.token) });
    assert(one.status === 200, `read by id ${one.status}: ${JSON.stringify(one.body?.error)}`);
    const item = (one.body.data.items as any[])[0];
    assert(item && item.id === 'v1.2' && item.value?.title === 'Dotted', `item ${JSON.stringify(one.body.data)}`);
});

await test('Usage: a history row with nothing current makes no empty entry', async () => {
    // A `.version.N` row alone, as an old publish can leave behind, is history, not a record.
    const v = await post('/v1/memory', owner.token, { key: `${root()}.${NS}.oldonly.version.1`, value: { title: 'history' }, visibility: 'private' });
    assert(v.status === 201 || v.status === 422 || v.status === 403, `version row ${v.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = (r.body.data.index.note as any[]).map(n => n.id);
    assert(!ids.includes('oldonly'), `a history row alone is not listed: ${JSON.stringify(ids)}`);
});

// ─── Round 10b: the readers outside the index ───
// A second workspace holds records and pages with plain ids and with dotted ids that share their first
// part (`v1.2`, `v1.3`), so a reader that splits on the first dot either drops them or merges them.
console.log('\nThe readers outside the index (secaudit2026oct31w2 round 10b)');

const WS2 = `wsdot2${stamp}`;
const root2 = () => `organism.${orgId}.w.${WS2}`;
const WORD = 'quokkadotted';
let agent = { gaii: '', token: '' };
const get = (path: string, token?: string) => json(path, token ? { headers: auth(token) } : {});
const put = (path: string, token: string, body: unknown) => json(path, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
const draftAndPublish = async (token: string, space: string, ns: string, id: string, value: Record<string, unknown>) => {
    const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, token, { ws: WS2, space, id, value });
    assert(w.status === 200, `draft ${space}/${id} ${w.status}: ${JSON.stringify(w.body?.error)}`);
    return post(`/v1/organisms/${orgId}/publish`, owner.token, { ws: WS2, namespace: ns, id });
};
const published = async (space: string, ns: string, id: string, value: Record<string, unknown>, token = owner.token) => {
    const p = await draftAndPublish(token, space, ns, id, value);
    assert(p.status === 200, `publish ${space}/${id} ${p.status}: ${JSON.stringify(p.body?.error)}`);
};

const WS3 = `wsdot3${stamp}`;
await test('Setup 10b: a second workspace with a records space, a document space and an append-only log, plain and dotted ids', async () => {
    const at = new Date().toISOString();
    const r = await post('/v1/memory', owner.token, { key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [
        { id: WS, name: 'Dotted', createdAt: at, createdBy: owner.name },
        { id: WS2, name: 'Dotted two', createdAt: at, createdBy: owner.name },
        { id: WS3, name: 'Dotted three', createdAt: at, createdBy: owner.name },
    ] }, visibility: 'private' });
    assert(r.status === 201 || r.status === 200, `registry ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Dotted two', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true },
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'pages', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document', versioned: true },
            { name: 'log', schemaRef: 'schema:log@1', namespace: 'logs', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true, create_only: true },
        ],
    };
    const m = await post('/v1/memory', owner.token, { key: `${root2()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body?.error)}`);
    const g = await post(`/v1/organisms/${orgId}/workspace-access/grant`, owner.token, { ws: WS2, grantee: member.name, role: 'contributor' });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    await published('note', 'notes', 'plain', { title: 'Plain note', body: `${WORD} plain` });
    await published('note', 'notes', 'v1.2', { title: 'Dotted note two', body: `${WORD} dotted` });
    await published('note', 'notes', 'v1.3', { title: 'Dotted note three' });
    await published('note', 'notes', 'refs', { title: 'Refers', parent_id: 'v1.2' });
    await published('page', 'pages', 'intro', { title: 'Intro page', markdown: '# Intro' });
    await published('page', 'pages', 'p1.2', { title: 'Dotted page two', markdown: '# Two' });
    await published('page', 'pages', 'p1.3', { title: 'Dotted page three', markdown: '# Three' });
    const a = await makeAgent(BASE, owner, ['memory:read', 'memory:write', 'organism:read', 'organism:write']);
    agent = { gaii: a.gaii, token: a.token };
    // The agent writes two pages with no declaration, so the node records them as model-written.
    await published('page', 'pages', 'ai1', { title: 'Agent page', markdown: '# Agent' }, agent.token);
    await published('page', 'pages', 'ai.1', { title: 'Agent dotted page', markdown: '# Agent dotted' }, agent.token);
});

const idsOf = (rows: any[] | undefined) => (rows ?? []).map(r => r.id).sort();

await test('Usage: plain records and pages are read, logged, listed in the overview, searched and resolved as before', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token);
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const notes = idsOf(r.body.data.objects?.note);
    const pages = idsOf(r.body.data.objects?.page);
    assert(['plain', 'refs'].every(id => notes.includes(id)) && ['intro', 'ai1'].every(id => pages.includes(id)), `read ${JSON.stringify({ notes, pages })}`);
    const act = await get(`/v1/organisms/${orgId}/workspace/activity?ws=${WS2}`, owner.token);
    const plainEvents = (act.body.data.events as any[]).filter(e => e.instance === 'plain' || e.instance === 'intro');
    assert(plainEvents.some(e => e.namespace === 'notes' && e.type === 'note') && plainEvents.some(e => e.namespace === 'pages' && e.type === 'page'), `events ${JSON.stringify(plainEvents)}`);
    const ov = await get(`/v1/organisms/${orgId}/workspace/overview?ws=${WS2}&format=md`, owner.token);
    assert(String(ov.body._raw ?? '').includes('Plain note') && String(ov.body._raw ?? '').includes('Intro page'), 'overview without the plain entries');
    const s = await get(`/v1/organisms/${orgId}/search?q=${WORD}&ws=${WS2}`, owner.token);
    assert(s.status === 200 && idsOf(s.body.data.results).includes('plain'), `search ${s.status} ${JSON.stringify(s.body?.data?.results ?? s.body?.error)}`);
    const d = await get(`/v1/organisms/${orgId}/workspace/dangling-refs?ws=${WS2}`, owner.token);
    assert(d.status === 200 && !(d.body.data.findings as any[]).some(f => ['plain', 'intro'].includes(f.refId)), `dangling ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
});

await test('Refused: a dotted record and a dotted page are no longer missing from the GET /workspace read', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token);
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const notes = idsOf(r.body.data.objects?.note);
    const pages = idsOf(r.body.data.objects?.page);
    assert(JSON.stringify(notes) === JSON.stringify(['plain', 'refs', 'v1.2', 'v1.3']), `notes ${JSON.stringify(notes)}`);
    assert(JSON.stringify(pages) === JSON.stringify(['ai.1', 'ai1', 'intro', 'p1.2', 'p1.3']), `pages ${JSON.stringify(pages)}`);
});

await test('Refused: the workspace list counts each dotted record and page once under its whole id', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspaces?include=enrichment`, owner.token);
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const w = (r.body.data.workspaces as any[]).find(x => x.id === WS2);
    assert(w?.enrichment?.recs === 4 && w.enrichment.docs === 5, `counts ${JSON.stringify(w?.enrichment && { recs: w.enrichment.recs, docs: w.enrichment.docs })}`);
});

await test('Refused: the activity log names a dotted record by its own space and whole id', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace/activity?ws=${WS2}`, owner.token);
    assert(r.status === 200, `activity ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const events = r.body.data.events as any[];
    const dotted = events.filter(e => e.instance === 'v1.2');
    assert(dotted.length > 0 && dotted.every(e => e.namespace === 'notes' && e.type === 'note'), `events of v1.2: ${JSON.stringify(dotted)}`);
    assert(!events.some(e => String(e.namespace).startsWith('notes.') || String(e.namespace).startsWith('pages.')), `a space made of an id: ${JSON.stringify(events.map(e => e.namespace))}`);
});

await test('Refused: the workspace overview lists a dotted record and its title', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace/overview?ws=${WS2}&format=md`, owner.token);
    assert(r.status === 200, `overview ${r.status}`);
    const md = String(r.body._raw ?? '');
    assert(md.includes('Dotted note two') && md.includes('Dotted page two'), `overview: ${md.slice(0, 600)}`);
});

await test('Refused: content search names a dotted record by its whole id', async () => {
    const r = await get(`/v1/organisms/${orgId}/search?q=${WORD}&ws=${WS2}`, owner.token);
    assert(r.status === 200, `search ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = idsOf(r.body.data.results);
    assert(ids.includes('v1.2') && ids.includes('plain') && !ids.includes('v1'), `search ids ${JSON.stringify(ids)}`);
});

await test('Refused: a reference to a dotted record is not reported as dangling', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace/dangling-refs?ws=${WS2}`, owner.token);
    assert(r.status === 200, `dangling ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const refs = (r.body.data.findings as any[]).map(f => f.refId);
    assert(!refs.includes('v1.2'), `findings ${JSON.stringify(r.body.data.findings)}`);
});

await test('Refused: a dotted record in an append-only space cannot be published over', async () => {
    await published('log', 'logs', 'e1.2', { title: 'Entry one' });
    const again = await draftAndPublish(owner.token, 'log', 'logs', 'e1.2', { title: 'Entry one, rewritten' });
    assert(again.status === 409 && again.body?.error?.code === 'WRITE_CONFLICT', `second publish ${again.status}: ${JSON.stringify(again.body?.error ?? again.body?.data)}`);
    const r = await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token);
    const entry = (r.body.data.objects?.log as any[] | undefined)?.find(e => e.id === 'e1.2');
    assert(entry?.title === 'Entry one', `the entry after: ${JSON.stringify(entry)}`);
});

await test('Usage: a plain record in the append-only space is refused a second publish as before', async () => {
    await published('log', 'logs', 'e1', { title: 'Plain entry' });
    const again = await draftAndPublish(owner.token, 'log', 'logs', 'e1', { title: 'Plain entry, rewritten' });
    assert(again.status === 409 && again.body?.error?.code === 'WRITE_CONFLICT', `second publish ${again.status}: ${JSON.stringify(again.body?.error ?? again.body?.data)}`);
});

await test('Usage: a plain record in the append-only space cannot be deleted, as before', async () => {
    const r = await post(`/v1/organisms/${orgId}/workspace/records/delete`, owner.token, { ws: WS2, namespace: 'logs', ids: ['e1'] });
    assert(r.status === 409, `delete ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
});

await test('Refused: a dotted record in the append-only space cannot be deleted', async () => {
    const r = await post(`/v1/organisms/${orgId}/workspace/records/delete`, owner.token, { ws: WS2, namespace: 'logs', ids: ['e1.2'] });
    assert(r.status === 409, `delete ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    const read = await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token);
    assert((read.body.data.objects?.log as any[] | undefined)?.some(e => e.id === 'e1.2'), 'the entry is gone');
});

// A member's change to the section index waits for approval, unless it only takes away pages that
// no longer exist (housekeeping). A dotted page that exists must not read as gone.
const sectionsUrl = `/v1/organisms/${orgId}/workspace/sections/page?ws=${WS2}`;
const section = (documents: string[]) => ({ sections: [{ id: 'sec-one', name: 'One', parentId: null, documents }] });
await test('Usage: a member who takes an existing plain page out of a section waits for approval, as before', async () => {
    const own = await put(sectionsUrl, owner.token, section(['intro', 'p1.2']));
    assert(own.status === 200, `the owner files both pages: ${own.status} ${JSON.stringify(own.body?.error ?? own.body?.data)}`);
    const r = await put(sectionsUrl, member.token, section(['p1.2']));
    assert(r.status === 202 && r.body.data.status === 'pending_approval', `the member takes intro out: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
});

await test('Refused: a member who takes an existing dotted page out of a section waits for approval too', async () => {
    const r = await put(sectionsUrl, member.token, section(['intro']));
    assert(r.status === 202 && r.body.data.status === 'pending_approval', `the member takes p1.2 out: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    const now = ((await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token)).body.data.sections?.page as any[] | undefined)?.find(s => s.id === 'sec-one');
    assert(now?.documents?.includes('p1.2'), `the section after: ${JSON.stringify(now)}`);
});

const pageOf = async (id: string) => ((await get(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, owner.token)).body.data.objects?.page as any[] | undefined)?.find(p => p.id === id);
await test('Usage: a plain agent-written page the share opens on its own owes the AI label in the member read', async () => {
    const s = await put(`/v1/organisms/${orgId}/workspace/share?ws=${WS2}`, owner.token, { docs: { 'page/ai1': true, 'page/ai.1': true } });
    assert(s.status === 200, `share ${s.status}: ${JSON.stringify(s.body?.error)}`);
    const plain = await pageOf('ai1');
    assert(plain?._aiProvenance?.disclosure?.required === true, `the plain page: ${JSON.stringify(plain?._aiProvenance?.disclosure ?? plain)}`);
});

await test('Refused: a dotted agent-written page the share opens on its own owes the AI label in the member read', async () => {
    const dotted = await pageOf('ai.1');
    assert(dotted?._aiProvenance?.disclosure?.required === true, `the dotted page: ${JSON.stringify(dotted?._aiProvenance?.disclosure ?? dotted)}`);
});

const SHARE2 = { spaces: { note: true }, docs: { 'page/intro': true, 'page/p1.2': true } };
await test('Usage: the public share and the member read serve the plain records and pages they open', async () => {
    const s = await put(`/v1/organisms/${orgId}/workspace/share?ws=${WS2}`, owner.token, SHARE2);
    assert(s.status === 200, `share ${s.status}: ${JSON.stringify(s.body?.error)}`);
    const recs = idsOf((await get(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS2}`)).body?.data?.records);
    assert(['plain', 'refs'].every(id => recs.includes(id)), `public records ${JSON.stringify(recs)}`);
    const docs = idsOf((await get(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS2}`)).body?.data?.documents);
    assert(docs.includes('intro') && !docs.includes('p1.3'), `public documents ${JSON.stringify(docs)}`);
    const one = await get(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS2}&type=page&id=intro`);
    assert(one.status === 200 && one.body.data.document?.id === 'intro', `one page ${one.status}`);
    const mem = idsOf((await get(`/v1/organisms/${orgId}/workspace/records?ws=${WS2}&space=note`, member.token)).body?.data?.records);
    assert(['plain', 'refs'].every(id => mem.includes(id)), `member records ${JSON.stringify(mem)}`);
});

await test('Refused: the public share serves the dotted records and pages it opens', async () => {
    const recs = await get(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS2}`);
    assert(recs.status === 200, `public records ${recs.status}: ${JSON.stringify(recs.body?.error)}`);
    const recIds = idsOf(recs.body.data.records);
    assert(JSON.stringify(recIds) === JSON.stringify(['plain', 'refs', 'v1.2', 'v1.3']), `public records ${JSON.stringify(recIds)}`);
    const docs = await get(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS2}`);
    assert(docs.status === 200, `public documents ${docs.status}: ${JSON.stringify(docs.body?.error)}`);
    const docIds = idsOf(docs.body.data.documents);
    assert(docIds.includes('intro') && docIds.includes('p1.2') && !docIds.includes('p1.3'), `public documents ${JSON.stringify(docIds)}`);
});

await test('Refused: the member read of published records carries the dotted records', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspace/records?ws=${WS2}&space=note`, member.token);
    assert(r.status === 200, `member records ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = idsOf(r.body.data.records);
    assert(JSON.stringify(ids) === JSON.stringify(['plain', 'refs', 'v1.2', 'v1.3']), `member records ${JSON.stringify(ids)}`);
});

// The published pages of a space are held to their own labels when the space is shared whole.
// Two spaces, so the plain case and the dotted case do not share a share setting.
const CONF = 'luottamuksellinen';
let policyBefore: any = null;
const label = (key: string) => put('/v1/classification/label', owner.token, { kind: 'memory', key: `organism.${orgId}.w.${WS3}.${key}`, label: CONF });
await test('Setup 10b: a third workspace with two record spaces; the operator caps Confidential at signed-in and turns classification on', async () => {
    const m = await post('/v1/memory', owner.token, { key: `organism.${orgId}.w.${WS3}.meta.manifest`, value: {
        manifestVersion: '1.0', id: orgId, name: 'Dotted three', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'item', schemaRef: 'schema:item@1', namespace: 'items', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'thing', schemaRef: 'schema:thing@1', namespace: 'things', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        ],
    }, visibility: 'private' });
    assert(m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body?.error)}`);
    for (const [ns, records] of [['items', [{ id: 'r.1', value: { name: 'secret' } }, { id: 'r2', value: { name: 'plain' } }]], ['things', [{ id: 't1', value: { name: 'secret' } }, { id: 't2', value: { name: 'plain' } }]]] as const) {
        const p = await post(`/v1/organisms/${orgId}/workspace/records/publish`, owner.token, { ws: WS3, namespace: ns, records });
        assert(p.status === 200 && p.body.data.published === 2, `publish ${ns} ${p.status}: ${JSON.stringify(p.body?.data ?? p.body?.error)}`);
    }
    // The suite's first account is the operator.
    const now = await get('/v1/classification/policy?level=node', owner.token);
    assert(now.status === 200, `node policy ${now.status}: ${JSON.stringify(now.body?.error)}`);
    policyBefore = now.body.data.effective;
    const labels = (policyBefore.labels as any[]).map(l => (l.id === CONF ? { ...l, maxAudience: 'signed-in' } : { ...l, maxAudience: null }));
    const pol = await put('/v1/classification/policy', owner.token, { level: 'node', policy: { ...policyBefore, labels } });
    assert(pol.status === 200 && pol.body.data.applied === true, `policy ${pol.status}: ${JSON.stringify(pol.body?.error ?? pol.body?.data)}`);
    const on = await put('/v1/admin/config', owner.token, { changes: [{ path: 'classification.mode', value: 'all' }] });
    assert(on.status === 200, `classification on ${on.status}: ${JSON.stringify(on.body?.error)}`);
});

await test('Usage: the workspace list counts the records of a workspace whose ids share no first part', async () => {
    const r = await get(`/v1/organisms/${orgId}/workspaces?include=enrichment`, owner.token);
    const w = (r.body?.data?.workspaces as any[] | undefined)?.find(x => x.id === WS3);
    assert(w?.enrichment?.recs === 4 && w.enrichment.docs === 0, `counts ${r.status} ${JSON.stringify(w?.enrichment ?? r.body?.error)}`);
});

await test('Usage: a Confidential plain record stops its space from being opened to the link, naming it, as before', async () => {
    const l = await label('things.t1');
    assert(l.status === 200 && l.body.data.applied === true, `label ${l.status}: ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    const space = await put(`/v1/organisms/${orgId}/workspace/share?ws=${WS3}`, owner.token, { spaces: { thing: true }, access: 'open' });
    assert(space.status === 409 && space.body?.error?.code === 'LABEL_CAPS_AUDIENCE' && String(space.body.error.message).includes('thing/t1') && !String(space.body.error.message).includes('thing/t2'),
        `share the space open: ${space.status} ${JSON.stringify(space.body?.error ?? space.body?.data)}`);
});

await test('Refused: a Confidential dotted record stops its space from being opened to the link, naming it', async () => {
    const l = await label('items.r.1');
    assert(l.status === 200 && l.body.data.applied === true, `label ${l.status}: ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    const space = await put(`/v1/organisms/${orgId}/workspace/share?ws=${WS3}`, owner.token, { spaces: { item: true }, access: 'open' });
    assert(space.status === 409 && space.body?.error?.code === 'LABEL_CAPS_AUDIENCE' && String(space.body.error.message).includes('item/r.1'),
        `share the space open: ${space.status} ${JSON.stringify(space.body?.error ?? space.body?.data)}`);
});

await test('Cleanup 10b: classification off and the node policy restored', async () => {
    const off = await put('/v1/admin/config', owner.token, { changes: [{ path: 'classification.mode', value: 'off' }] });
    assert(off.status === 200, `classification off ${off.status}: ${JSON.stringify(off.body?.error)}`);
    if (policyBefore) {
        const back = await put('/v1/classification/policy', owner.token, { level: 'node', policy: policyBefore });
        assert(back.status === 200, `restore ${back.status}: ${JSON.stringify(back.body?.error)}`);
    }
});

// Round 10b, the write side: a memory write of a workspace record key is checked against the
// manifest's spaces (undeclaredSpaceForKey). The key's parser takes the last part before the role as
// the id, so a dotted id put its first parts into the namespace and was refused as UNDECLARED_SPACE.
await test('Usage: a memory write of a plain record key in a declared space is stored, as before', async () => {
    const w = await post('/v1/memory', owner.token, { key: `${root()}.${NS}.direct.draft`, value: { title: 'Direct' }, visibility: 'private' });
    assert(w.status === 201, `plain key ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('Refused: a memory write of a dotted record key in a declared space is no longer refused as UNDECLARED_SPACE', async () => {
    const w = await post('/v1/memory', owner.token, { key: `${root()}.${NS}.d1.5.draft`, value: { title: 'Direct dotted' }, visibility: 'private' });
    assert(w.status === 201, `dotted key ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    const ids = (r.body.data.index.note as any[]).map(n => n.id);
    assert(ids.includes('d1.5'), `the index lists it under its whole id: ${JSON.stringify(ids)}`);
});

await test('Usage: a memory write into a space the manifest does not declare is still refused', async () => {
    const w = await post('/v1/memory', owner.token, { key: `${root()}.undeclared.x1.draft`, value: { title: 'Nowhere' }, visibility: 'private' });
    assert(w.status === 422 && w.body?.error?.code === 'UNDECLARED_SPACE', `undeclared ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

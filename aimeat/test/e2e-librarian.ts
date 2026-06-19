/**
 * @file e2e-librarian.ts
 * @description E2E for the Tier-1 "librarian" full-text search (GET /v1/librarian/search?q=).
 *   Covers: query validation, fan-across — one query finding content in TWO different organisms +
 *   personal notebook memory, ranked hits with snippets + organism annotation, synchronous
 *   freshness (a just-written record is immediately findable — FTS index stays in sync), no-match
 *   empty result, and the implicit auth scope (another owner's search never returns A's content).
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: fan-across librarian retrieval over searchText() FTS.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=librarian

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `librarian${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Librarian', password: 'Librarian1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Librarian', password: 'Librarian1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Create an organism with one records-workspace and put a single record into it. */
async function makeOrgWithRecord(token: string, ownerName: string, orgName: string, recordId: string, value: object) {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: orgName, description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    const orgId = o.body.data.organism.id as string;
    const WS = 'ws-lib1';
    const root = `organism.${orgId}.w.${WS}`;
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: ownerName }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    const r = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root}.shared.tasks.${recordId}.latest`, value, visibility: 'private' }) });
    assert(r.status === 201 || r.status === 200, `record ${r.status}: ${JSON.stringify(r.body.error)}`);
    return { orgId, root };
}

console.log('\n=== AIMEAT Librarian Search E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let org1 = '', org2 = '';

// A unique marker shared by content in BOTH organisms — proves fan-across.
const MARKER = 'xyzzylibrarianmarker';

await test('Setup: A creates two organisms (each with a record carrying the shared marker) + a personal note; B is a separate owner', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    ({ orgId: org1 } = await makeOrgWithRecord(A.token, A.name, 'Alpha Org', 't1', { id: 't1', title: `Alpha ${MARKER} pineapple`, status: 'open' }));
    ({ orgId: org2 } = await makeOrgWithRecord(A.token, A.name, 'Beta Org', 't2', { id: 't2', title: 'Beta plan', note: `Remember the ${MARKER} blueberry jam.` }));
    // Personal notebook inbox note (not in any organism) also carries the marker.
    const note = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'notebook.inbox.n1', value: { text: `A loose thought about ${MARKER} and quokkas.` }, visibility: 'private' }) });
    assert(note.status === 201 || note.status === 200, `note ${note.status}: ${JSON.stringify(note.body.error)}`);
});

await test('1. Missing q is rejected (400)', async () => {
    const r = await json('/v1/librarian/search', { headers: auth(A.token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('2. Fan-across: one query finds content in BOTH organisms + the personal note', async () => {
    const r = await json(`/v1/librarian/search?q=${MARKER}`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}: ${JSON.stringify(r.body.error)}`);
    const hits = r.body.data.hits || [];
    const orgs = new Set(hits.map((h: any) => h.organismId).filter(Boolean));
    assert(orgs.has(org1), `expected a hit in org1, got organisms ${[...orgs].join(',')}`);
    assert(orgs.has(org2), `expected a hit in org2, got organisms ${[...orgs].join(',')}`);
    const personal = hits.find((h: any) => h.key === 'notebook.inbox.n1');
    assert(!!personal, 'expected the personal notebook note among hits');
});

await test('3. Hits carry a score, a snippet and organism annotation', async () => {
    const r = await json(`/v1/librarian/search?q=blueberry`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.hits || []).find((h: any) => h.organismId === org2);
    assert(!!hit, 'expected the org2 record');
    assert(typeof hit.score === 'number', 'hit has a numeric score');
    assert(/blueberry/i.test(hit.snippet), `snippet should contain the term, got "${hit.snippet}"`);
    assert(hit.workspaceId === 'ws-lib1', `expected workspace annotation, got ${hit.workspaceId}`);
});

await test('4. Synchronous freshness: a just-written record is immediately findable', async () => {
    const term = `freshterm${Date.now()}`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'notebook.inbox.fresh', value: { text: `instant ${term} capture` }, visibility: 'private' }) });
    assert(w.status === 201 || w.status === 200, `write ${w.status}`);
    const r = await json(`/v1/librarian/search?q=${term}`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.hits || []).find((h: any) => h.key === 'notebook.inbox.fresh');
    assert(!!hit, 'just-written record must be findable with no indexing lag');
});

await test('5. No-match query returns an empty result set', async () => {
    const r = await json(`/v1/librarian/search?q=zzzznomatchqqq`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    assert((r.body.data.hits || []).length === 0, `expected empty, got ${r.body.data.total}`);
});

await test('6. Auth scope: another owner (B) does not get A\'s private content', async () => {
    const r = await json(`/v1/librarian/search?q=${MARKER}`, { headers: auth(B.token) });
    assert(r.status === 200, `search ${r.status}`);
    assert((r.body.data.hits || []).length === 0, `B must not see A's content, got ${r.body.data.total} hits`);
});

await test('7. Classify without an OpenRouter key is rejected cleanly (400 NO_OPENROUTER_KEY)', async () => {
    const r = await json('/v1/librarian/classify', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: 'a note to file somewhere' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'NO_OPENROUTER_KEY', `expected NO_OPENROUTER_KEY, got ${JSON.stringify(r.body.error)}`);
});

await test('8. Materialize flow (API path): a document filed into a new workspace is found by the librarian', async () => {
    // Replicates what the client materializeDocument() orchestrates: new workspace (registry +
    // manifest with a document space) + a document instance, then the librarian finds it.
    const WS = 'ws-materialized';
    const root = `organism.${org1}.w.${WS}`;
    const reg = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${org1}.meta.workspaces`, value: { workspaces: [{ id: 'ws-lib1', name: 'Coordination' }, { id: WS, name: 'Notebook', createdAt: new Date().toISOString() }] }, visibility: 'private' }) });
    assert(reg.status === 200 || reg.status === 201, `registry ${reg.status}`);
    const manifest = { manifestVersion: '1.0', id: org1, name: 'Notebook', kind: 'project', status: 'active', objectTypes: [
        { name: 'Pages', namespace: 'pages', schemaRef: 'schema:document@1', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 200 || mr.status === 201, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    const docTerm = 'qwopdocterm';
    const doc = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root}.pages.doc-1.latest`, value: { id: 'doc-1', title: `Filed ${docTerm} note`, markdown: `# Filed\n\nThis ${docTerm} document was materialized from a note.` }, visibility: 'private' }) });
    assert(doc.status === 200 || doc.status === 201, `doc ${doc.status}: ${JSON.stringify(doc.body.error)}`);

    const r = await json(`/v1/librarian/search?q=${docTerm}`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.hits || []).find((h: any) => h.organismId === org1 && h.workspaceId === WS);
    assert(!!hit, `expected the materialized document among hits, got ${JSON.stringify((r.body.data.hits || []).map((h: any) => h.key))}`);
    assert(hit.space === 'pages', `expected space=pages, got ${hit.space}`);
});

await test('9. Partial term matches (prefix/substring): "qwopdoc" finds the "qwopdocterm" document', async () => {
    const r = await json(`/v1/librarian/search?q=qwopdoc`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.hits || []).find((h: any) => h.workspaceId === 'ws-materialized');
    assert(!!hit, `partial term must match the full word, got ${JSON.stringify((r.body.data.hits || []).map((h: any) => h.key))}`);
});

await test('10. Public scope finds another user\'s public knowledge package — with producer + kind', async () => {
    const term = 'zubpublicterm';
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'packages/zub-pkg/manifest', value: { name: `Public ${term} digest`, content_type: 'news' }, visibility: 'public', tags: ['knowledge-package', 'news'] }) });
    assert(w.status === 201 || w.status === 200, `pkg ${w.status}: ${JSON.stringify(w.body.error)}`);
    const r = await json(`/v1/librarian/search?q=${term}&scope=public`, { headers: auth(B.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.hits || []).find((h: any) => h.packageId === 'zub-pkg');
    assert(!!hit, `B must find A's public knowledge package, got ${JSON.stringify((r.body.data.hits || []).map((h: any) => h.key))}`);
    assert(hit.kind === 'knowledge', `kind should be knowledge, got ${hit.kind}`);
    assert(typeof hit.producer === 'string' && hit.producer.includes(A.name), `producer should be A, got ${hit.producer}`);
    assert(/Public .*digest/.test(hit.title), `title should be the package name, got ${hit.title}`);
});

await test('11. Own scope does NOT return another user\'s public content', async () => {
    const r = await json(`/v1/librarian/search?q=zubpublicterm&scope=own`, { headers: auth(B.token) });
    assert(r.status === 200, `search ${r.status}`);
    assert((r.body.data.hits || []).length === 0, `own scope must not see A's content, got ${r.body.data.total}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-organism-overview.ts
 * @description E2E tests for the OKF-style structure overview routes:
 *   GET /v1/organisms/:id/overview (whole organism, shallow) and
 *   GET /v1/organisms/:id/workspace/overview?ws= (one workspace, deep).
 *   Seeds an organism + a workspace (records space + document space) + content via REST as the owner,
 *   then asserts the generated Markdown carries the OKF frontmatter, space breakdown, per-space counts
 *   with ids/titles, totals, the format=md raw mode, and the membership gate (a non-member is denied).
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial creation (organism + workspace structure overview).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-overview

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, ct };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register an owner and return { name, token }. */
async function setupOwner(label: string) {
    const name = `ovw${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Overview', password: 'Ovw12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Structure Overview E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wsoverview';
const root = () => `organism.${orgId}.w.${WS}`;
const auth = () => ({ Authorization: `Bearer ${A.token}` });

await test('Setup two owners', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

await test('Create organism + seed workspace (records + document spaces) + schema + content', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Overview Org', description: 'An organism for the overview test', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString() }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.readme`, value: '# Main\nThe primary workspace for the overview test.', visibility: 'private' }) });

    // Two published note records (bare-key writes — the overview surfaces .latest ?? bare).
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.notes.n1`, value: { id: 'n1', title: 'First note' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.notes.n2`, value: { id: 'n2', title: 'Second note' }, visibility: 'private' }) });
    // One document.
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.pages.doc-1`, value: { id: 'doc-1', title: 'Welcome page', markdown: '# Welcome\nhello' }, visibility: 'private' }) });
});

await test('Workspace overview: frontmatter + space breakdown + ids/titles + totals', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);
    const md = r.body.data.markdown as string;
    assert(r.body.data.readable === true, 'readable');
    assert(md.includes('okf_type: workspace-structure-overview'), 'OKF frontmatter type');
    assert(md.includes(`workspace_id: ${WS}`), 'frontmatter ws id');
    assert(md.includes('## note (records) — 2'), `note space header with count 2:\n${md}`);
    assert(md.includes('## page (document) — 1'), `page space header with count 1:\n${md}`);
    assert(md.includes('First note') && md.includes('`n1`'), 'record title + id present');
    assert(md.includes('Welcome page') && md.includes('`doc-1`'), 'document title + id present');
    assert(md.includes('2 records') && md.includes('1 documents'), 'totals line');
});

await test('Workspace overview format=md returns raw text/markdown', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}&format=md`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.ct.includes('markdown'), `content-type markdown, got ${r.ct}`);
    assert(typeof r.body._raw === 'string' && r.body._raw.startsWith('---'), 'raw markdown starts with frontmatter');
});

await test('Organism overview: lists the workspace with breakdown + totals', async () => {
    const r = await json(`/v1/organisms/${orgId}/overview`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);
    const md = r.body.data.markdown as string;
    assert(md.includes('okf_type: organism-structure-overview'), 'OKF frontmatter type');
    assert(md.includes('Overview Org — structure overview'), 'org title heading');
    assert(md.includes('1 workspaces') && md.includes('2 records') && md.includes('1 documents'), `org totals: ${md}`);
    assert(md.includes(`## Main  ·  \`${WS}\``), `workspace section heading with id: ${md}`);
    // Composed at the SAME fidelity as the workspace overview — per-space headings + item ids/titles,
    // not a count-only breakdown (the org view must be navigable to a record id).
    assert(md.includes('### note (records) — 2') && md.includes('### page (document) — 1'), `per-space headings: ${md}`);
    assert(md.includes('First note') && md.includes('`n1`'), `record item (title + id) in org overview: ${md}`);
    assert(md.includes('Welcome page') && md.includes('`doc-1`'), `document item (title + id) in org overview: ${md}`);
    assert(r.body.data.workspaces === 1, 'workspaces count in envelope');
});

await test('Workspace overview missing ?ws → 400', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/overview`, { headers: auth() });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('Membership gate: a non-member is denied both overviews (403)', async () => {
    const bh = { Authorization: `Bearer ${B.token}` };
    const o = await json(`/v1/organisms/${orgId}/overview`, { headers: bh });
    assert(o.status === 403, `organism overview for non-member should be 403, got ${o.status}`);
    const w = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, { headers: bh });
    assert(w.status === 403, `workspace overview for non-member should be 403, got ${w.status}`);
});

await test('Unknown organism → 404', async () => {
    const r = await json('/v1/organisms/no-such-org/overview', { headers: auth() });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth() }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.token}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

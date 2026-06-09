/**
 * @file e2e-workspace-public-sharing.ts
 * @description E2E tests for document-space public sharing: the meta.share record + GET/PUT
 *   /v1/organisms/:id/workspace/share and the NO-AUTH public read endpoints
 *   (/workspace/public/documents + /public/document, JSON and ?format=md). Verifies that only
 *   PUBLISHED docs the share meta marks public are served, that drafts never leak, that per-doc
 *   overrides win over the space flag, and that the share write is creator/admin-gated.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: slice 1 (backend) of the workspace public-sharing plan.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-workspace-public-sharing

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
/** Raw fetch that returns status + text (for ?format=md / no-auth markdown). */
async function raw(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, opts);
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', text: await res.text() };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register owner + an owner JWT (no agent needed — sharing is owner/member-driven). */
async function setupOwner(label: string) {
    const ownerName = `wsshare${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Share', password: 'WsShare1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts) }) });
    return { ownerName, ownerToken: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Public Sharing E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
await test('Setup owner A (creator) + owner B (outsider)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

let orgId = '';
const WS = 'ws1';
const root = () => `organism.${orgId}.w.${WS}`;
const AH = () => ({ Authorization: `Bearer ${A.ownerToken}` });

await test('Seed organism + workspace (registry + manifest with a document space) + two published pages + one draft', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: AH(), body: JSON.stringify({ name: 'Share Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Handbook', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Handbook', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);

    // Two PUBLISHED pages (.latest) and one DRAFT-only page (.draft, must never be served publicly).
    const pub = async (id: string, title: string, markdown: string) =>
        json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.pages.${id}.latest`, value: { id, title, markdown }, visibility: 'private' }) });
    await pub('intro', 'Introduction', '# Introduction\n\nWelcome to the handbook.');
    await pub('rules', 'House Rules', '# House Rules\n\nBe kind.');
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.pages.secret.draft`, value: { id: 'secret', title: 'Secret Draft', markdown: '# Secret\n\nNot published.' }, visibility: 'private' }) });
});

// ── Before sharing: nothing is public ──
await test('1. public documents 404 before anything is shared (no disclosure)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('2. GET share returns the empty default for a member (owner A)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { headers: AH() });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.share.public === false, 'public=false by default');
});

await test('3. share write is gated: owner B (not a member/creator) gets 403', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: JSON.stringify({ spaces: { page: true } }) });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);
});

// ── Make the whole 'page' space public ──
await test('4. owner A makes the page space public (PUT share)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ spaces: { page: true } }) });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);
    assert(r.body.data.share.spaces.page === true, 'space flag set');
});

await test('5. public documents (NO AUTH) returns the two published pages, NOT the draft', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(r.status === 200, `status ${r.status}`);
    const ids = (r.body.data.documents || []).map((d: any) => d.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['intro', 'rules']), `expected intro+rules, got ${JSON.stringify(ids)}`);
    assert(!ids.includes('secret'), 'draft-only page must never be served');
});

await test('6. ?format=md returns concatenated markdown with both titles', async () => {
    const r = await raw(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}&format=md`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.contentType.includes('text/markdown'), `content-type ${r.contentType}`);
    assert(r.text.includes('## Introduction') && r.text.includes('## House Rules'), 'both page titles present');
    assert(r.text.includes('Welcome to the handbook') && !r.text.includes('Not published'), 'published body present, draft absent');
});

await test('7. single public document (NO AUTH) returns one page; ?format=md returns its markdown', async () => {
    const j = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=page&id=intro`);
    assert(j.status === 200 && j.body.data.document.title === 'Introduction', `single doc json: ${JSON.stringify(j.body)}`);
    const m = await raw(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=page&id=intro&format=md`);
    assert(m.status === 200 && m.contentType.includes('text/markdown') && m.text.includes('# Introduction'), `single doc md: ${m.status} ${m.contentType}`);
});

// ── Per-doc override beats the space flag ──
await test('8. a per-doc override (rules:false) excludes that doc even though the space is public', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ docs: { 'page/rules': false } }) });
    assert(put.status === 200, `put ${put.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    const ids = (r.body.data.documents || []).map((d: any) => d.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['intro']), `rules must be excluded, got ${JSON.stringify(ids)}`);
    // and the excluded doc 404s individually
    const one = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=page&id=rules`);
    assert(one.status === 404, `excluded doc must 404, got ${one.status}`);
});

await test('9. merge semantics: a later PUT with only docs keeps the earlier spaces flag', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { headers: AH() });
    assert(r.body.data.share.spaces.page === true, 'space flag survived the docs-only PUT');
    assert(r.body.data.share.docs['page/rules'] === false, 'doc override persisted');
});

// ── Per-doc opt-in while the space is private ──
await test('10. turning the space off but a single doc on serves only that doc', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ spaces: { page: false }, docs: { 'page/rules': true, 'page/intro': false } }) });
    assert(put.status === 200, `put ${put.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    const ids = (r.body.data.documents || []).map((d: any) => d.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['rules']), `only rules should show, got ${JSON.stringify(ids)}`);
});

await test('11. unknown ws / unknown org → 404 (no disclosure)', async () => {
    const a = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=nope`);
    const b = await json(`/v1/organisms/no-such-org/workspace/public/documents?ws=${WS}`);
    assert(a.status === 404 && b.status === 404, `expected 404/404, got ${a.status}/${b.status}`);
});

await test('12. PUT validation: a non-boolean spaces map is rejected (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ spaces: { page: 'yes' } }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: AH() }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

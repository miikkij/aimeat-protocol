/**
 * @file e2e-workspace-public-sharing.ts
 * @description E2E tests for document-space public sharing: the meta.share record + GET/PUT
 *   /v1/organisms/:id/workspace/share and the NO-AUTH public read endpoints
 *   (/workspace/public/documents + /public/document, JSON and ?format=md). Verifies that only
 *   PUBLISHED docs the share meta marks public are served, that drafts never leak, that per-doc
 *   overrides win over the space flag, and that the share write is creator/admin-gated.
 * @version-history
 *   v1.2.0 — 2026-08-16 — August 2026 test-quality audit (e2e-workspace-public-sharing:103): the
 *     share write has TWO gates — active membership, then creator/admin — and only a NON-MEMBER was
 *     ever refused, so the second one was covered by nothing. This organism is join_policy 'open', so
 *     the case that matters is somebody who simply joins: test 3b has owner B join and then be
 *     refused 403, with the public documents endpoint read back at 404. Measured with the
 *     creator/admin block deleted: the plain member publishes the whole workspace (200, spaces.page
 *     true) — every member's documents on the anonymous internet — while e2e-workspace-public-records
 *     and e2e-signage-agent-faced stay green, because they repeat the same non-member shape.
 *   v1.1.0 — 2026-07-10 — TARGET-025 share access modes: password mode (unlock → X-Share-Token,
 *     wrong password generic 401, per-IP rate limit 429, member bypass), account mode
 *     (anon → 401 SHARE_ACCOUNT_REQUIRED, any authenticated account → 200), hash redaction
 *     (has_password only — the scrypt hash never appears in any response), PUT validation.
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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
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

// Test 3 refuses a NON-MEMBER, who is stopped by the first of the route's two gates. The second one
// — creator/admin — was exercised by nothing, and this organism is join_policy 'open': anyone on the
// node can join. A plain member publishing the workspace would put every member's documents on the
// anonymous internet, which is the one act this gate exists to reserve.
await test('3b. A plain MEMBER (not creator/admin) cannot publish the workspace → 403', async () => {
    const join = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: JSON.stringify({}) });
    assert(join.status === 200 || join.status === 201, `B joins the open organism: ${join.status} ${JSON.stringify(join.body?.error)}`);

    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: JSON.stringify({ spaces: { page: true } }),
    });
    assert(r.status === 403, `a plain member must be refused, got ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);

    // …and nothing became public on the way.
    const pub = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(pub.status === 404, `nothing may be public after the refusal, got ${pub.status}`);
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

// ── TARGET-025: access modes (open / password / account) ──
const SHARE_PW = 'sesame-4242';

await test('13. PUT validation: bad access value → 400; access password without a password → 400', async () => {
    const bad = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'vip' }) });
    assert(bad.status === 400, `bad access expected 400, got ${bad.status}`);
    const noPw = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'password' }) });
    assert(noPw.status === 400, `password mode without password expected 400, got ${noPw.status}`);
    const shortPw = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'password', password: 'ab' }) });
    assert(shortPw.status === 400, `too-short password expected 400, got ${shortPw.status}`);
});

await test('14. set access password + password; response/GET carry has_password, NEVER the hash', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'password', password: SHARE_PW }) });
    assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body.error || put.body)}`);
    assert(put.body.data.share.access === 'password' && put.body.data.share.has_password === true, `redacted share state: ${JSON.stringify(put.body.data.share)}`);
    const get = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { headers: AH() });
    assert(get.body.data.share.access === 'password' && get.body.data.share.has_password === true, 'GET reflects access + has_password');
    const dumped = JSON.stringify(put.body) + JSON.stringify(get.body);
    assert(!dumped.includes('passwordHash') && !dumped.includes('v2:'), 'the scrypt hash must never appear in any response');
});

await test('15. password mode: anonymous public reads → 401 SHARE_PASSWORD_REQUIRED (list, single, md)', async () => {
    const list = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(list.status === 401 && list.body.error.code === 'SHARE_PASSWORD_REQUIRED', `list: ${list.status} ${JSON.stringify(list.body.error)}`);
    const one = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=page&id=rules`);
    assert(one.status === 401 && one.body.error.code === 'SHARE_PASSWORD_REQUIRED', `single: ${one.status}`);
    const md = await raw(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}&format=md`);
    assert(md.status === 401, `md: ${md.status}`);
});

await test('16. unlock with the wrong password → generic 401 INVALID_PASSWORD', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share/unlock`, { method: 'POST', body: JSON.stringify({ ws: WS, password: 'wrong-password' }) });
    assert(r.status === 401 && r.body.error.code === 'INVALID_PASSWORD', `${r.status} ${JSON.stringify(r.body.error)}`);
});

let shareToken = '';
await test('17. unlock with the right password → share token; X-Share-Token opens the reads', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share/unlock`, { method: 'POST', body: JSON.stringify({ ws: WS, password: SHARE_PW }) });
    assert(r.status === 200 && typeof r.body.data.share_token === 'string', `unlock: ${r.status} ${JSON.stringify(r.body.error || {})}`);
    shareToken = r.body.data.share_token;
    const list = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`, { headers: { 'X-Share-Token': shareToken } });
    assert(list.status === 200, `tokened list: ${list.status}`);
    const ids = (list.body.data.documents || []).map((d: any) => d.id);
    assert(JSON.stringify(ids) === JSON.stringify(['rules']), `share flags still apply under token, got ${JSON.stringify(ids)}`);
    const md = await raw(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=page&id=rules&format=md`, { headers: { 'X-Share-Token': shareToken } });
    assert(md.status === 200 && md.text.includes('# House Rules'), `tokened md: ${md.status}`);
});

await test('18. a tampered/garbage token does not open the reads', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`, { headers: { 'X-Share-Token': shareToken.slice(0, -4) + 'AAAA' } });
    assert(r.status === 401 && r.body.error.code === 'SHARE_PASSWORD_REQUIRED', `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('19. an authenticated org member (creator A) passes the password gate without a token', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`, { headers: AH() });
    assert(r.status === 200, `member read: ${r.status}`);
});

await test('20. unlock brute force hits the per-IP rate limit (429)', async () => {
    let got429 = false;
    for (let i = 0; i < 12; i++) {
        const r = await json(`/v1/organisms/${orgId}/workspace/share/unlock`, { method: 'POST', body: JSON.stringify({ ws: WS, password: `nope-${i}` }) });
        if (r.status === 429) { got429 = true; break; }
        assert(r.status === 401, `attempt ${i}: expected 401/429, got ${r.status}`);
    }
    assert(got429, 'expected a 429 within 12 rapid attempts (limit 10 / 15 min per IP)');
});

await test('21. account mode: anonymous → 401 SHARE_ACCOUNT_REQUIRED; any signed-in account (non-member B) → 200', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'account' }) });
    assert(put.status === 200 && put.body.data.share.access === 'account', `put ${put.status}`);
    const anon = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(anon.status === 401 && anon.body.error.code === 'SHARE_ACCOUNT_REQUIRED', `anon: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const b = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`, { headers: { Authorization: `Bearer ${B.ownerToken}` } });
    assert(b.status === 200, `signed-in non-member: ${b.status}`);
});

await test('22. back to open + password cleared: anonymous reads work again, has_password=false', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'open', password: null }) });
    assert(put.status === 200 && put.body.data.share.access === 'open' && put.body.data.share.has_password === false, `put: ${JSON.stringify(put.body.data?.share)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/public/documents?ws=${WS}`);
    assert(r.status === 200, `open read: ${r.status}`);
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: AH() }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

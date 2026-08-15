/**
 * @file e2e-organism-workspace-access.ts
 * @description E2E for per-workspace access control. An organism member can SEE the workspace list
 *   (discovery) but cannot read a workspace's CONTENT until its creator approves an access request,
 *   which creates a consent grant. Covers: discovery, denied-before-approval, request, list-requests,
 *   approve → read, and deny → revoke.
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial: workspace access request/approve/consent flow.
 *   v1.1.0 — 2026-07-15 — Org-admin auto-access: a promoted admin (D) reads + writes a workspace they
 *     did not create, with no per-workspace grant; a plain member (B) still cannot (regression guard).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-workspace-access

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
    const name = `wsacc${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'WS Access', password: 'WsAcc1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Workspace Access E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let C: Awaited<ReturnType<typeof setupOwner>> | undefined;
let D: Awaited<ReturnType<typeof setupOwner>> | undefined;
let orgId = '';
const WS = 'ws-acc1';
const root = () => `organism.${orgId}.w.${WS}`;

await test('Setup owners A (creator) + B (member)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

await test('A creates an OPEN organism', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Access Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
});

await test('A creates a workspace (registry w/ createdBy + manifest + schema)', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
});

await test('B joins the organism', async () => {
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
});

await test('1. B can DISCOVER the workspace (list) but access is "none"', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspaces`, { headers: auth(B.token) });
    assert(r.status === 200, `list ${r.status}`);
    const ws = (r.body.data.workspaces || []).find((w: any) => w.id === WS);
    assert(ws && ws.name === 'Coordination', 'workspace listed for the member');
    assert(ws.created_by === A.name, 'shows the creator');
    assert(ws.access === 'none', `access should be none, got ${ws?.access}`);
});

await test('2. B CANNOT read the workspace content yet (manifest hidden)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(B.token) });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.data.manifest === null, 'manifest must be hidden before approval');
});

await test('3. B requests access', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, message: 'let me in' }) });
    assert(r.status === 201, `request ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.workspace_creator === A.name, 'request routes to the creator');
});

await test('4. A sees the pending request', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS}`, { headers: auth(A.token) });
    assert(r.status === 200, `list-requests ${r.status}`);
    const req = (r.body.data.requests || []).find((x: any) => x.requester === B.name);
    assert(req && req.status === 'pending', 'B request is pending');
});

await test('5. B (not the creator) cannot list requests', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS}`, { headers: auth(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('6. A approves the request', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access/decision`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, requester: B.name, decision: 'approve' }) });
    assert(r.status === 200 && r.body.data.status === 'approved', `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('7. B can now READ the workspace content', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(B.token) });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.data.manifest && r.body.data.manifest.name === 'Coordination', 'manifest readable after approval');
    const l = await json(`/v1/organisms/${orgId}/workspaces`, { headers: auth(B.token) });
    assert((l.body.data.workspaces || []).find((w: any) => w.id === WS)?.access === 'granted', 'access now granted');
});

await test('8. A denies (revokes) → B loses read access', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access/decision`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, requester: B.name, decision: 'deny' }) });
    assert(r.status === 200 && r.body.data.status === 'denied', `deny ${r.status}`);
    const read = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(B.token) });
    assert(read.body.data.manifest === null, 'manifest hidden again after deny');
});

await test('8b. the denial is written down — the request does not read as pending again', async () => {
    // The status used to be computed from the grant table, which has two values while the flow has
    // four: no grant is what "never asked" looks like, so a denied request returned to this panel as
    // pending for good. Denying it a second time changed nothing, because there was nothing to change.
    const r = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS}`, { headers: auth(A.token) });
    assert(r.status === 200, `list-requests ${r.status}`);
    const req = (r.body.data.requests || []).find((x: any) => x.requester === B.name);
    assert(!!req, 'the request record disappeared entirely');
    assert(req.status === 'denied', `expected denied, got "${req.status}"`);
});

await test('9. notifications: A got the request, B got the approval', async () => {
    const an = await json('/v1/notifications', { headers: auth(A.token) });
    assert(an.status === 200, `notif ${an.status}`);
    assert((an.body.data.notifications || []).some((n: any) => n.type === 'workspace_access_request'), 'A has a request notification');
    const bn = await json('/v1/notifications', { headers: auth(B.token) });
    assert((bn.body.data.notifications || []).some((n: any) => n.type === 'workspace_access_approved'), 'B has an approval notification');
    assert(bn.body.data.unread >= 1, 'B has unread');
});

await test('10. mark read clears the unread count', async () => {
    const r = await json('/v1/notifications/read', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ all: true }) });
    assert(r.status === 200, `read ${r.status}`);
    const bn = await json('/v1/notifications', { headers: auth(B.token) });
    assert(bn.body.data.unread === 0, `B unread should be 0, got ${bn.body.data.unread}`);
});

// ─── Phase 1b: ORG-ADMIN auto-access. An organism admin/creator has automatic read+write access to
//     EVERY workspace under the organism — no per-workspace grant. D joins, A promotes D to admin, and
//     D then reads + writes workspace WS (created by A) with no access request. A plain member (B, whose
//     access was revoked in test 8) still cannot — the admin bypass keys on role, not membership alone. ───
await test('10a. Plain member B (revoked in test 8) still cannot read WS — baseline', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(B.token) });
    assert(r.body.data.manifest === null, 'revoked member B must NOT read WS (regression guard for the admin bypass)');
});

await test('10b. D joins as a plain member — cannot read WS yet', async () => {
    D = await setupOwner('d');
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(D.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(D.token) });
    assert(r.body.data.manifest === null, 'plain member D must NOT read WS before promotion');
});

await test('10c. A promotes D to admin', async () => {
    const r = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ target_ghii: D!.name }) });
    assert(r.status === 200 && r.body.data.role === 'admin', `promote ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('10d. Admin D auto-READS WS content (no access request, no grant)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(D!.token) });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.data.manifest && r.body.data.manifest.name === 'Coordination', 'admin reads the manifest with no access request');
});

await test('10e. Admin D discovery list shows WS access "granted"', async () => {
    const l = await json(`/v1/organisms/${orgId}/workspaces`, { headers: auth(D!.token) });
    assert(l.status === 200, `list ${l.status}`);
    assert((l.body.data.workspaces || []).find((w: any) => w.id === WS)?.access === 'granted', 'admin sees access=granted');
});

await test('10f. Admin D auto-WRITES a record into WS (no contributor grant)', async () => {
    const key = `${root()}.shared.tasks.admin-${Date.now()}.draft`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(D!.token), body: JSON.stringify({ key, value: { title: 'admin-authored task' }, visibility: 'private' }) });
    assert(w.status === 201 || w.status === 200, `admin write ${w.status}: ${JSON.stringify(w.body.error)}`);
});

// ─── Phase 2: workspace-scoped FILE visibility. A file BOUND to this workspace (visibility:'workspace',
//     workspace_ref="org/ws") is readable by exactly the people who can read the workspace — the creator
//     and members WITH access — via GET /v1/pub, and nobody else. Same canReadWorkspace gate as the
//     manifest read above, now applied to storage files (files reached parity with memory). ───
const A_GHII = `${A.name}@${NODE_ID}`;
const wsFileKey = `wsfile-${Date.now()}`;
const wsFileB64 = Buffer.from('workspace-only bytes').toString('base64');
const pubUrl = () => `${BASE}/v1/pub/${encodeURIComponent(A_GHII)}/${encodeURIComponent(wsFileKey)}`;

await test('11. A uploads a workspace-visibility file bound to this org/ws', async () => {
    const r = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: wsFileKey, data: wsFileB64, mime_type: 'text/plain', visibility: 'workspace', workspace_ref: `${orgId}/${WS}` }) });
    assert(r.status === 201, `upload ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.visibility === 'workspace', `visibility ${r.body.data.visibility}`);
});

await test('12. A (creator) reads the workspace file via /v1/pub → 200 (not public)', async () => {
    const res = await fetch(pubUrl(), { headers: auth(A.token) });
    assert(res.status === 200, `creator expected 200, got ${res.status}`);
});

await test('13. Anonymous cannot read the workspace file → 404 (never public)', async () => {
    const res = await fetch(pubUrl());
    assert(res.status === 404, `anon expected 404, got ${res.status}`);
});

await test('14. Member B WITHOUT workspace access cannot read the file → 403', async () => {
    // B's access was revoked in test 8: a member who cannot read the workspace cannot read its files.
    const res = await fetch(pubUrl(), { headers: auth(B.token) });
    assert(res.status === 403, `revoked member expected 403, got ${res.status}`);
});

await test('15. A re-approves B → B (member WITH access) reads the file → 200', async () => {
    const ap = await json(`/v1/organisms/${orgId}/workspace-access/decision`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, requester: B.name, decision: 'approve' }) });
    assert(ap.status === 200, `approve ${ap.status}: ${JSON.stringify(ap.body.error)}`);
    const res = await fetch(pubUrl(), { headers: auth(B.token) });
    assert(res.status === 200, `member with access expected 200, got ${res.status}`);
});

await test('16. A non-member (fresh owner C) cannot read the workspace file → 403', async () => {
    C = await setupOwner('c');
    const res = await fetch(pubUrl(), { headers: auth(C.token) });
    assert(res.status === 403, `non-member expected 403, got ${res.status}`);
});

await test('17. A file bound to MULTIPLE workspaces is readable via ANY one the caller can read', async () => {
    // Bound to a workspace B canNOT read (bogus) AND the real WS (B has access from test 15). The loop
    // in authorizeRead allows if the caller can read ANY binding — so B reads it via the WS binding.
    const multiKey = `wsfile-multi-${Date.now()}`;
    const up = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: multiKey, data: wsFileB64, mime_type: 'text/plain', visibility: 'workspace', workspace_refs: [`${orgId}/ws-does-not-exist`, `${orgId}/${WS}`] }) });
    assert(up.status === 201, `multi upload ${up.status}: ${JSON.stringify(up.body.error)}`);
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(A_GHII)}/${encodeURIComponent(multiKey)}`, { headers: auth(B.token) });
    assert(res.status === 200, `member of one of the bound workspaces expected 200, got ${res.status}`);
    // C (member of NEITHER) is still denied.
    if (C) {
        const cres = await fetch(`${BASE}/v1/pub/${encodeURIComponent(A_GHII)}/${encodeURIComponent(multiKey)}`, { headers: auth(C.token) });
        assert(cres.status === 403, `non-member expected 403 on multi-bound file, got ${cres.status}`);
    }
});

await test('18. removing a member closes the question they left open', async () => {
    // B asks again, so there is a genuinely pending request at the moment the membership ends. An open
    // request outlives the roster: it is a record in B's own namespace, and the reviewer's panel read
    // "no grant" as "waiting for you", so an ejected member kept asking from outside the organism.
    const revoke = await json(`/v1/organisms/${orgId}/workspace-access/decision`, {
        method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, requester: B.name, decision: 'deny' }),
    });
    assert(revoke.body.ok === true, `revoke before re-request: ${revoke.status}`);
    const again = await json(`/v1/organisms/${orgId}/workspace-access`, {
        method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, message: 'let me back in' }),
    });
    assert(again.status === 201, `re-request ${again.status}: ${JSON.stringify(again.body.error)}`);
    const before = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS}`, { headers: auth(A.token) });
    assert((before.body.data.requests || []).find((x: any) => x.requester === B.name)?.status === 'pending',
        're-request should read as pending before the removal');

    const rm = await json(`/v1/organisms/${orgId}/members/${B.name}`, { method: 'DELETE', headers: auth(A.token) });
    assert(rm.body.ok === true, `remove B: ${rm.status} ${JSON.stringify(rm.body.error)}`);

    const after = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS}`, { headers: auth(A.token) });
    const req = (after.body.data.requests || []).find((x: any) => x.requester === B.name);
    assert(!!req, 'the request record vanished instead of being resolved');
    assert(req.status === 'withdrawn', `expected withdrawn, got "${req.status}"`);
});

await test('Cleanup A + B + C + D', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: auth(B.token) });
    if (C) await json(`/v1/owners/${C.name}`, { method: 'DELETE', headers: auth(C.token) });
    if (D) await json(`/v1/owners/${D.name}`, { method: 'DELETE', headers: auth(D.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

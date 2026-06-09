/**
 * @file e2e-organism-membership.ts
 * @description E2E for organism-level membership management on an approval_required organism:
 *   join request → creator/admin notification → review (approve/reject) → requester notification,
 *   and creator/admin revoking (removing) a member → removed-member notification. Also covers the
 *   guardrails: the creator cannot be removed, and a non-admin cannot review or remove.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: join-request notify + review + remove-member (revoke) flow.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-membership

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
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `orgmem${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Member', password: 'OrgMem1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hasNotif = async (token: string, type: string) => {
    const r = await json('/v1/notifications', { headers: auth(token) });
    return r.status === 200 && (r.body.data.notifications || []).some((n: any) => n.type === type);
};

console.log('\n=== AIMEAT Organism Membership E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;   // creator
let B: Awaited<ReturnType<typeof setupOwner>>;   // member who joins then is removed
let C: Awaited<ReturnType<typeof setupOwner>>;   // member whose request is rejected
let orgId = '';

await test('Setup owners A (creator) + B + C', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
});

await test('A creates an approval_required organism', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Membership Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
});

await test('1. B requests to join → pending (202)', async () => {
    const r = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ message: 'let me in' }) });
    assert(r.status === 202, `join ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.status === 'pending', `expected pending, got ${r.body.data.status}`);
});

await test('2. A (creator) gets an organism_join_request notification', async () => {
    assert(await hasNotif(A.token, 'organism_join_request'), 'A should have a join-request notification');
});

await test('3. B (non-admin) cannot list join requests (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/join-requests`, { headers: auth(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

let bRequestId = '';
await test('4. A sees B pending in join-requests', async () => {
    const r = await json(`/v1/organisms/${orgId}/join-requests`, { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    const req = (r.body.data.join_requests || []).find((x: any) => x.ghii === B.name);
    assert(req && req.status === 'pending', 'B request is pending');
    bRequestId = req.id;
});

await test('5. A approves B → B becomes an active member', async () => {
    const r = await json(`/v1/organisms/${orgId}/join-requests/${bRequestId}/review`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ decision: 'approved' }) });
    assert(r.status === 200 && r.body.data.decision === 'approved', `review ${r.status}: ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === B.name && x.status === 'active'), 'B is an active member');
});

await test('6. B gets an organism_join_approved notification', async () => {
    assert(await hasNotif(B.token, 'organism_join_approved'), 'B should have an approval notification');
});

await test('7. C requests, A rejects → C is NOT a member, C notified', async () => {
    const jr = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(jr.status === 202, `C join ${jr.status}`);
    const list = await json(`/v1/organisms/${orgId}/join-requests`, { headers: auth(A.token) });
    const creq = (list.body.data.join_requests || []).find((x: any) => x.ghii === C.name);
    assert(!!creq, 'C request present');
    const rev = await json(`/v1/organisms/${orgId}/join-requests/${creq.id}/review`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ decision: 'rejected' }) });
    assert(rev.status === 200 && rev.body.data.decision === 'rejected', `reject ${rev.status}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert(!(m.body.data.members || []).some((x: any) => x.ghii === C.name), 'C must not be a member after rejection');
    assert(await hasNotif(C.token, 'organism_join_rejected'), 'C should have a rejection notification');
});

await test('8. B (non-admin) cannot remove a member (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/members/${encodeURIComponent(A.name)}`, { method: 'DELETE', headers: auth(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('9. A cannot remove the creator (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}/members/${encodeURIComponent(A.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('10. A removes (revokes) B → B no longer a member, B notified', async () => {
    const r = await json(`/v1/organisms/${orgId}/members/${encodeURIComponent(B.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.removed === B.name, `remove ${r.status}: ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert(!(m.body.data.members || []).some((x: any) => x.ghii === B.name), 'B must no longer be a member');
    assert(await hasNotif(B.token, 'organism_member_removed'), 'B should have a removal notification');
});

await test('11. Removing a non-member returns 404', async () => {
    const r = await json(`/v1/organisms/${orgId}/members/${encodeURIComponent(B.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

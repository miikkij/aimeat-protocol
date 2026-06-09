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
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Member', password: 'OrgMem1234' }) });
    // Registration is rate-limited per IP; creating several owners in a row can trip it.
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Member', password: 'OrgMem1234' }) });
    }
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

// ─── Phase A extras: invitations, transfer, ban/unban, agent attach ───
// Reuse owners A (creator), B, C from above — no new registrations (the /v1/ghii
// endpoint is rate-limited per IP and A/B/C already consumed the window).
let org2 = '';

await test('12. A creates an invite_only organism', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Invite Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    org2 = o.body.data.organism.id;
});

await test('13. B cannot join an invite_only organism (403 INVITE_ONLY)', async () => {
    const r = await json(`/v1/organisms/${org2}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(r.status === 403 && r.body.error?.code === 'INVITE_ONLY', `expected 403 INVITE_ONLY, got ${r.status} ${r.body.error?.code}`);
});

await test('14. A invites B → invitation created + B notified', async () => {
    const r = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: B.name }) });
    assert(r.status === 201 && r.body.data.status === 'invited', `invite ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = await json(`/v1/organisms/${org2}/invitations`, { headers: auth(A.token) });
    assert((list.body.data.invitations || []).some((m: any) => m.ghii === B.name && m.invitedBy === A.name), 'A sees the outgoing invitation with invitedBy');
    assert(await hasNotif(B.token, 'organism_invitation'), 'B should have an invitation notification');
});

await test('15. B sees the invitation in /invitations/mine', async () => {
    const r = await json('/v1/organisms/invitations/mine', { headers: auth(B.token) });
    assert(r.status === 200, `mine ${r.status}`);
    assert((r.body.data.invitations || []).some((x: any) => x.organism.id === org2), 'B sees org2 in their invitations');
});

await test('16. B accepts → becomes an active member; inviter notified', async () => {
    const r = await json(`/v1/organisms/${org2}/invitations/accept`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(r.status === 200 && r.body.data.status === 'joined', `accept ${r.status}: ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${org2}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === B.name && x.status === 'active'), 'B is active member');
    assert(await hasNotif(A.token, 'organism_invitation_accepted'), 'A should be notified of acceptance');
});

await test('17. A invites C, C declines → C is not a member', async () => {
    const inv = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: C.name }) });
    assert(inv.status === 201, `invite C ${inv.status}`);
    const dec = await json(`/v1/organisms/${org2}/invitations/decline`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(dec.status === 200 && dec.body.data.status === 'declined', `decline ${dec.status}`);
    const m = await json(`/v1/organisms/${org2}/members`, { headers: auth(A.token) });
    assert(!(m.body.data.members || []).some((x: any) => x.ghii === C.name), 'C must not be a member after declining');
});

await test('18. A removes + BANS B → B is blocked, notified', async () => {
    const r = await json(`/v1/organisms/${org2}/members/${encodeURIComponent(B.name)}?ban=1`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.banned === true, `ban ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(await hasNotif(B.token, 'organism_member_banned'), 'B should have a ban notification');
    const banned = await json(`/v1/organisms/${org2}/members?status=banned`, { headers: auth(A.token) });
    assert((banned.body.data.members || []).some((x: any) => x.ghii === B.name), 'B shows in banned list');
});

await test('19. Banned B cannot re-join or be re-invited', async () => {
    const j = await json(`/v1/organisms/${org2}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 403 && j.body.error?.code === 'BANNED', `join should be BANNED, got ${j.status} ${j.body.error?.code}`);
    const inv = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: B.name }) });
    assert(inv.status === 409 && inv.body.error?.code === 'BANNED', `invite should be 409 BANNED, got ${inv.status} ${inv.body.error?.code}`);
});

await test('20. A lifts the ban → B can be invited again and accepts', async () => {
    const unban = await json(`/v1/organisms/${org2}/members/${encodeURIComponent(B.name)}/unban`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(unban.status === 200 && unban.body.data.unbanned === B.name, `unban ${unban.status}: ${JSON.stringify(unban.body.error)}`);
    const inv = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: B.name }) });
    assert(inv.status === 201, `re-invite after unban ${inv.status}: ${JSON.stringify(inv.body.error)}`);
    const acc = await json(`/v1/organisms/${org2}/invitations/accept`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(acc.status === 200, `re-accept ${acc.status}`);
});

await test('21. A transfers ownership to B → B creator, A demoted to admin', async () => {
    const r = await json(`/v1/organisms/${org2}/transfer`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.name }) });
    assert(r.status === 200 && r.body.data.creator === B.name, `transfer ${r.status}: ${JSON.stringify(r.body.error)}`);
    const org = await json(`/v1/organisms/${org2}`, { headers: auth(B.token) });
    assert(org.body.data.organism.creatorGhii === B.name, 'creatorGhii is now B');
    assert((org.body.data.organism.admins || []).includes(A.name), 'A is now an admin');
    assert(await hasNotif(B.token, 'organism_ownership_transferred'), 'B should be notified of the transfer');
});

await test('22. Old creator A can no longer transfer; new creator B can attach + detach an agent', async () => {
    const denied = await json(`/v1/organisms/${org2}/transfer`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: A.name }) });
    assert(denied.status === 403, `A (no longer creator) should be 403, got ${denied.status}`);
    const gaii = `helper#${B.name}@${NODE_ID}`;
    const att = await json(`/v1/organisms/${org2}/agents`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ agent_gaii: gaii }) });
    assert(att.status === 201 && att.body.data.attached === gaii, `attach ${att.status}: ${JSON.stringify(att.body.error)}`);
    const org = await json(`/v1/organisms/${org2}`, { headers: auth(B.token) });
    assert((org.body.data.organism.agentGaiis || []).includes(gaii), 'agentGaiis includes the attached agent');
    const det = await json(`/v1/organisms/${org2}/agents/${encodeURIComponent(gaii)}`, { method: 'DELETE', headers: auth(B.token) });
    assert(det.status === 200 && det.body.data.detached === gaii, `detach ${det.status}`);
});

await test('23. Cannot attach an agent you do not own', async () => {
    const r = await json(`/v1/organisms/${org2}/agents`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ agent_gaii: `bot#${C.name}@${NODE_ID}` }) });
    assert(r.status === 403, `expected 403 (not owner), got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

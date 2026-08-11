/**
 * @file e2e-organism-membership.ts
 * @description E2E for organism-level membership management on an approval_required organism:
 *   join request → creator/admin notification → review (approve/reject) → requester notification,
 *   and creator/admin revoking (removing) a member → removed-member notification. Also covers the
 *   guardrails: the creator cannot be removed, and a non-admin cannot review or remove.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: join-request notify + review + remove-member (revoke) flow.
 *   v1.1.0 — 2026-07-10 — Tests 25-27: invitee normalization/validation (nonexistent → 404, remote
 *     identity → 400, UPPERCASE/@node/whitespace forms land on the real lowercase owner).
 *   v1.2.0 — 2026-07-23 — Test 28: an owner in 20+ organisms gets ALL of them in /tab mine (regression for
 *     the member-scoped page cap that dropped the owner's oldest organisms into Discover).
 *   v1.3.0 — 2026-08-11 — Tests 29-34 (H-29): removing, banning and leaving detach the departing
 *     person's agents from organism.agentGaiis and revoke their workspace-role consents. The agent
 *     token is driven for real, because an ejected member kept the whole organism through it.
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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
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

await test('0b. GET /v1/organisms/tab folds my orgs (+counts) + public + prefs', async () => {
    const { status, body } = await json('/v1/organisms/tab', { headers: auth(A.token) });
    assert(status === 200, `tab status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    // mine — A's org present, with the include=counts workspace_count field
    assert(Array.isArray(d.mine) && d.mine.some((o: any) => o.id === orgId), `A's org in mine: ${JSON.stringify(d.mine?.map((o: any) => o.id))}`);
    assert(d.mine.every((o: any) => typeof o.workspace_count === 'number'), 'mine carries workspace_count (include=counts)');
    // mine mirrors GET /v1/organisms?member=A&include=counts (the folded read)
    const single = await json(`/v1/organisms?member=${encodeURIComponent(A.name)}&include=counts`, { headers: auth(A.token) });
    assert(d.mine.length === single.body.data.organisms.length, `mine count matches /v1/organisms?member: ${d.mine.length} vs ${single.body.data.organisms.length}`);
    // public + prefs partitions
    assert(Array.isArray(d.public), 'public is an array');
    assert(d.uiPrefs === null || typeof d.uiPrefs === 'object', 'uiPrefs is null or an object');
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

// ── ?member= privacy + implicit-agent enumeration (the "agent can't find its home" report) ──

let org3 = '';
await test('24. ?member= lists private organisms ONLY for the member themself', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ name: 'B Private Home', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`);
    org3 = o.body.data.organism.id;
    // The member themself (their agents authenticate as the same owner) sees it:
    const self = await json(`/v1/organisms?member=${B.name}`, { headers: auth(B.token) });
    assert((self.body.data.organisms || []).some((x: any) => x.id === org3), 'self sees own private organism');
    // Unauthenticated and a DIFFERENT owner must not be able to enumerate B's private memberships:
    const anon = await json(`/v1/organisms?member=${B.name}`);
    assert(!(anon.body.data.organisms || []).some((x: any) => x.id === org3), 'anonymous must not see B\'s private organism');
    const other = await json(`/v1/organisms?member=${B.name}`, { headers: auth(C.token) });   // C = plain owner
    assert(!(other.body.data.organisms || []).some((x: any) => x.id === org3), 'another owner must not see B\'s private organism');
    // A is this node's FIRST registered owner → an operator, and operators MAY enumerate memberships:
    const op = await json(`/v1/organisms?member=${B.name}`, { headers: auth(A.token) });
    assert((op.body.data.organisms || []).some((x: any) => x.id === org3), 'an operator may enumerate memberships');
});

// ── Invitee normalization + validation (unnormalized invites landed on an identity nobody
// authenticates as → the invitation and its notification were permanently invisible) ──

await test('25. Inviting a nonexistent owner is refused (404 OWNER_NOT_FOUND), not silently accepted', async () => {
    const r = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ invitee: `no-such-owner-${Date.now()}` }) });
    assert(r.status === 404 && r.body.error?.code === 'OWNER_NOT_FOUND', `expected 404 OWNER_NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

await test('26. Inviting a remote identity is refused (400)', async () => {
    const r = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ invitee: `${C.name}@some-other-node` }) });
    assert(r.status === 400, `expected 400, got ${r.status} ${r.body.error?.code}`);
});

await test('27. Invitee is normalized (UPPERCASE + @node-id + whitespace) → invitation visible to the real owner', async () => {
    const raw = ` ${C.name.toUpperCase()}@${NODE_ID} `;
    const r = await json(`/v1/organisms/${org2}/invitations`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ invitee: raw }) });
    assert(r.status === 201 && r.body.data.invitation?.ghii === C.name, `invite ${r.status}: ghii=${r.body.data?.invitation?.ghii}`);
    const mine = await json('/v1/organisms/invitations/mine', { headers: auth(C.token) });
    assert((mine.body.data.invitations || []).some((x: any) => x.organism.id === org2), 'C sees the normalized invitation in /invitations/mine');
    const dec = await json(`/v1/organisms/${org2}/invitations/decline`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(dec.status === 200, `decline (cleanup) ${dec.status}`);
});

await test('25. members route lists each member\'s agents for an ACTIVE member (implicit access enumerable)', async () => {
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ name: 'homefinder', owner: B.name, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const r = await json(`/v1/organisms/${org3}/members`, { headers: auth(B.token) });
    assert(r.status === 200 && r.body.data.agents_included === true, `agents_included: ${JSON.stringify(r.body.data)}`);
    const me = (r.body.data.members || []).find((m: any) => String(m.ghii).split('@')[0] === B.name);
    assert(me && Array.isArray(me.agents) && me.agents.some((a: any) => a.gaii === gaii), `member row carries the owner's agents: ${JSON.stringify(me?.agents)}`);
});

await test('26. agent rosters are NOT exposed to non-members', async () => {
    const r = await json(`/v1/organisms/${org2}/members`, { headers: auth(C.token) });   // C is not a member of org2
    assert(r.status === 200, `members ${r.status}`);
    assert(r.body.data.agents_included !== true && (r.body.data.members || []).every((m: any) => m.agents === undefined), 'non-member sees the legacy shape without agents');
});

// ── Regression: the owner's OWN organism list must not be page-capped. Ordered createdAt DESC and
// sliced to a 20-item page, the owner's OLDEST organisms silently dropped out of "My Organisms" (and,
// being public, resurfaced under Discover) once the owner belonged to more than one page. ──
await test('28. Owner in 20+ organisms: /tab mine returns ALL of them (no 20-item page cap)', async () => {
    const D = await setupOwner('d');
    const N = 22;   // > one 20-item page
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
        const o = await json('/v1/organisms', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ name: `Cap Org ${i}`, type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
        assert(o.status === 201, `org ${i} ${o.status}: ${JSON.stringify(o.body.error)}`);
        ids.push(o.body.data.organism.id);
    }
    // The first-created org has the oldest createdAt → last in DESC order → the one a 20-cap drops.
    const oldest = ids[0];
    const tab = await json('/v1/organisms/tab', { headers: auth(D.token) });
    assert(tab.status === 200, `tab ${tab.status}: ${JSON.stringify(tab.body)}`);
    const mineIds = new Set((tab.body.data.mine || []).map((o: any) => o.id));
    assert(mineIds.size >= N, `mine should hold all ${N} organisms, got ${mineIds.size} (page cap not removed?)`);
    assert(mineIds.has(oldest), 'the oldest organism must still be in mine (not dropped past the page cap)');
    // The plain member-filtered list (GET /v1/organisms?member=self) must agree — no cap there either.
    const list = await json(`/v1/organisms?member=${encodeURIComponent(D.name)}`, { headers: auth(D.token) });
    assert((list.body.data.organisms || []).some((o: any) => o.id === oldest), 'oldest present in ?member= list too');
});

// ─── H-29: ending a membership ends the access that used to outlive it ───
// Deleting the membership row and pruning members[]/admins[] left two live grants behind: the
// departing person's agents stayed on organism.agentGaiis, where every membership gate reads them as
// members in their own right, and the workspace-role consents granted to them are owned by each
// workspace's CREATOR, so nothing about the removal reached them. An ejected person kept the whole
// organism through their own agent's token.

let org4 = '';
const WS4 = 'ws-eject';

/** Device-authorize an agent for `who` and return its GAII + bearer token (RFC 8628, three calls). */
async function agentFor(who: { name: string; token: string }, agentName: string) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: who.name }) });
    assert(da.status === 200 || da.status === 201, `device-authorize ${da.status}: ${JSON.stringify(da.body.error)}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read'], owner_token: who.token }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(!!t.body.token && !!t.body.gaii, `device-token ${t.status}: ${JSON.stringify(t.body)}`);
    return { gaii: t.body.gaii as string, token: t.body.token as string };
}

/** Is `owner` on the workspace roster? Read as the workspace creator, whose consents ARE the roster. */
async function onWsRoster(creatorToken: string, orgIdArg: string, ws: string, owner: string) {
    const r = await json(`/v1/organisms/${orgIdArg}/workspace-access?ws=${ws}`, { headers: auth(creatorToken) });
    assert(r.status === 200, `roster ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.members || []).some((m: any) => m.owner === owner);
}

async function attachedAgents(readerToken: string, orgIdArg: string): Promise<string[]> {
    const r = await json(`/v1/organisms/${orgIdArg}`, { headers: auth(readerToken) });
    assert(r.status === 200, `organism ${r.status}`);
    return (r.body.data.organism.agentGaiis || []) as string[];
}

let cAgent: { gaii: string; token: string };

await test('29. Setup: A opens an organism with a workspace, C joins, gets a contributor grant, attaches an agent', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Eject Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    org4 = o.body.data.organism.id;

    const reg = await json('/v1/memory', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ key: `organism.${org4}.meta.workspaces`, value: { workspaces: [{ id: WS4, name: 'Eject WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }),
    });
    assert(reg.status === 200 || reg.status === 201, `registry ${reg.status}`);
    const manifest = { manifestVersion: '1.0', id: org4, name: 'Eject WS', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${org4}.w.${WS4}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 200 || mr.status === 201, `manifest ${mr.status}`);

    const j = await json(`/v1/organisms/${org4}/join`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `C join ${j.status}: ${JSON.stringify(j.body.error)}`);

    const g = await json(`/v1/organisms/${org4}/workspace-access/grant`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS4, grantee: C.name, role: 'contributor' }) });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body.error)}`);

    cAgent = await agentFor(C, 'ejecttest');
    const att = await json(`/v1/organisms/${org4}/agents`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ agent_gaii: cAgent.gaii }) });
    assert(att.status === 201, `attach ${att.status}: ${JSON.stringify(att.body.error)}`);
});

await test('30. Baseline: C\'s agent passes the organism gate and C is on the workspace roster', async () => {
    const r = await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(cAgent.token) });
    assert(r.status === 200, `agent read ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(await onWsRoster(A.token, org4, WS4, C.name), 'C holds a workspace grant before removal');
});

await test('31. A removes C → C\'s agent token is refused (403) and the agent is detached', async () => {
    const rm = await json(`/v1/organisms/${org4}/members/${encodeURIComponent(C.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(rm.status === 200, `remove ${rm.status}: ${JSON.stringify(rm.body.error)}`);
    const r = await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(cAgent.token) });
    assert(r.status === 403, `a removed member's agent must be refused, got ${r.status}`);
    assert(!(await attachedAgents(A.token, org4)).includes(cAgent.gaii), 'the agent is off organism.agentGaiis');
});

await test('32. C\'s workspace-role consent went with the membership', async () => {
    assert(!(await onWsRoster(A.token, org4, WS4, C.name)), 'a removed member holds no workspace grant');
});

await test('33. Leaving does the same: C re-joins, re-attaches, leaves → agent detached, grant gone', async () => {
    const j = await json(`/v1/organisms/${org4}/join`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `re-join ${j.status}: ${JSON.stringify(j.body.error)}`);
    const g = await json(`/v1/organisms/${org4}/workspace-access/grant`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS4, grantee: C.name, role: 'viewer' }) });
    assert(g.status === 200, `re-grant ${g.status}: ${JSON.stringify(g.body.error)}`);
    const att = await json(`/v1/organisms/${org4}/agents`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ agent_gaii: cAgent.gaii }) });
    assert(att.status === 201, `re-attach ${att.status}: ${JSON.stringify(att.body.error)}`);
    assert((await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(cAgent.token) })).status === 200, 'agent reads again while C is a member');

    const left = await json(`/v1/organisms/${org4}/leave`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(left.status === 200 && left.body.data.left === true, `leave ${left.status}: ${JSON.stringify(left.body.error)}`);
    const r = await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(cAgent.token) });
    assert(r.status === 403, `a leaver's agent must be refused, got ${r.status}`);
    assert(!(await attachedAgents(A.token, org4)).includes(cAgent.gaii), 'the agent is off organism.agentGaiis after leaving');
    assert(!(await onWsRoster(A.token, org4, WS4, C.name)), 'a leaver holds no workspace grant');
});

await test('34. Banning ejects the same way, and B\'s own agent is untouched by C\'s removal', async () => {
    // B is a different owner in the same organism: their agent must survive C being ejected.
    const j = await json(`/v1/organisms/${org4}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `B join ${j.status}: ${JSON.stringify(j.body.error)}`);
    const bAgent = await agentFor(B, 'bystander');
    const attB = await json(`/v1/organisms/${org4}/agents`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ agent_gaii: bAgent.gaii }) });
    assert(attB.status === 201, `B attach ${attB.status}: ${JSON.stringify(attB.body.error)}`);

    const rj = await json(`/v1/organisms/${org4}/join`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(rj.status === 200 || rj.status === 201, `C re-join ${rj.status}`);
    const attC = await json(`/v1/organisms/${org4}/agents`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ agent_gaii: cAgent.gaii }) });
    assert(attC.status === 201, `C re-attach ${attC.status}: ${JSON.stringify(attC.body.error)}`);

    const ban = await json(`/v1/organisms/${org4}/members/${encodeURIComponent(C.name)}?ban=1`, { method: 'DELETE', headers: auth(A.token) });
    assert(ban.status === 200 && ban.body.data.banned === true, `ban ${ban.status}: ${JSON.stringify(ban.body.error)}`);
    const gaiis = await attachedAgents(A.token, org4);
    assert(!gaiis.includes(cAgent.gaii), 'a banned member\'s agent is detached');
    assert(gaiis.includes(bAgent.gaii), 'another member\'s agent is left alone');
    assert((await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(cAgent.token) })).status === 403, 'the banned member\'s agent is refused');
    assert((await json(`/v1/organisms/${org4}/workspaces`, { headers: auth(bAgent.token) })).status === 200, 'the bystander agent still reads');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

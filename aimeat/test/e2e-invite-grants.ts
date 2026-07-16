/**
 * @file e2e-invite-grants.ts
 * @description E2E for the rich name-invite + direct-add flows: invite-time org role + workspace
 *   grants (applied on accept), pending-invite edit (PATCH) + cancel (DELETE), DIRECT member add
 *   (active immediately, grants applied, notified), and the admin-wide ?all=1 workspace-access
 *   roster. Covers the guardrails: non-admin edits → 403, unknown workspace → 404, direct add of
 *   an existing member → 409, and the plain no-fields invite regression.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: invite-with-grants / direct-add / edit / cancel / all=1.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=invite-grants

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
    const name = `invgr${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Invite Grants', password: 'InvGr1234' }) });
    // Registration is rate-limited per IP; creating several owners in a row can trip it.
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Invite Grants', password: 'InvGr1234' }) });
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

console.log('\n=== AIMEAT Invite Grants + Direct Add E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;   // creator (owns WS1 + WS2)
let B: Awaited<ReturnType<typeof setupOwner>>;   // invited with grants, edited, accepts
let C: Awaited<ReturnType<typeof setupOwner>>;   // cancel target, then DIRECT-added as admin
let D: Awaited<ReturnType<typeof setupOwner>>;   // pending invite upgraded by a direct add
let orgId = '';
const WS1 = 'ws-grants1';
const WS2 = 'ws-grants2';

await test('Setup owners A (creator) + B + C + D', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c'); D = await setupOwner('d');
});

await test('A creates an invite_only organism with two workspaces', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Grants Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const reg = await json('/v1/memory', {
        method: 'POST', headers: auth(A.token), body: JSON.stringify({
            key: `organism.${orgId}.meta.workspaces`,
            value: { workspaces: [
                { id: WS1, name: 'Grants One', createdAt: new Date().toISOString(), createdBy: A.name },
                { id: WS2, name: 'Grants Two', createdAt: new Date().toISOString(), createdBy: A.name },
            ] },
            visibility: 'private',
        }),
    });
    assert(reg.status === 200 || reg.status === 201, `registry ${reg.status}`);
    for (const ws of [WS1, WS2]) {
        const manifest = { manifestVersion: '1.0', id: orgId, name: ws, kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
        const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.w.${ws}.meta.manifest`, value: manifest, visibility: 'private' }) });
        assert(mr.status === 200 || mr.status === 201, `manifest ${ws} ${mr.status}`);
    }
});

// ── Invite with role + workspace grants ──

await test('1. A invites B as admin with WS1 contributor + WS2 viewer', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ invitee: B.name, role: 'admin', workspaces: [{ ws: WS1, role: 'contributor' }, { ws: WS2, role: 'viewer' }] }),
    });
    assert(r.status === 201 && r.body.data.status === 'invited', `invite ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.invitation.role === 'admin', `role should be admin, got ${r.body.data.invitation.role}`);
    assert((r.body.data.invitation.invitedWorkspaces || []).length === 2, 'carries both ws grants');
    assert(await hasNotif(B.token, 'organism_invitation'), 'B should have an invitation notification');
});

await test('2. Invitation list + /mine show the pending role and grants', async () => {
    const list = await json(`/v1/organisms/${orgId}/invitations`, { headers: auth(A.token) });
    const row = (list.body.data.invitations || []).find((m: any) => m.ghii === B.name);
    assert(row && row.role === 'admin' && (row.invitedWorkspaces || []).length === 2, `list row: ${JSON.stringify(row)}`);
    const mine = await json('/v1/organisms/invitations/mine', { headers: auth(B.token) });
    const m = (mine.body.data.invitations || []).find((x: any) => x.organism.id === orgId);
    assert(m && m.membership.role === 'admin', 'B sees the invited-as role');
});

await test('3. Inviting with an unknown workspace is refused (404 WORKSPACE_NOT_FOUND)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ invitee: C.name, workspaces: [{ ws: 'no-such-ws', role: 'viewer' }] }),
    });
    assert(r.status === 404 && r.body.error?.code === 'WORKSPACE_NOT_FOUND', `expected 404 WORKSPACE_NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

// ── Edit a pending invitation ──

await test('4. A edits the pending invite → role member, WS1 viewer only', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/${encodeURIComponent(B.name)}`, {
        method: 'PATCH', headers: auth(A.token),
        body: JSON.stringify({ role: 'member', workspaces: [{ ws: WS1, role: 'viewer' }] }),
    });
    assert(r.status === 200, `patch ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.invitation.role === 'member', 'role edited to member');
    assert((r.body.data.invitation.invitedWorkspaces || []).length === 1 && r.body.data.invitation.invitedWorkspaces[0].ws === WS1, 'grants replaced');
});

await test('5. A non-admin cannot edit or cancel a pending invite (403)', async () => {
    const p = await json(`/v1/organisms/${orgId}/invitations/${encodeURIComponent(B.name)}`, { method: 'PATCH', headers: auth(C.token), body: JSON.stringify({ role: 'admin' }) });
    assert(p.status === 403, `patch expected 403, got ${p.status}`);
    const d = await json(`/v1/organisms/${orgId}/invitations/${encodeURIComponent(B.name)}`, { method: 'DELETE', headers: auth(C.token) });
    assert(d.status === 403, `delete expected 403, got ${d.status}`);
});

// ── Accept applies the (edited) rights ──

await test('6. B accepts → member role + WS1 viewer grant applied', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/accept`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(r.status === 200 && r.body.data.status === 'joined', `accept ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert((r.body.data.workspaces || []).includes(WS1), `accept response lists granted ws: ${JSON.stringify(r.body.data.workspaces)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    const row = (m.body.data.members || []).find((x: any) => x.ghii === B.name);
    assert(row && row.status === 'active' && row.role === 'member', `B active member: ${JSON.stringify(row)}`);
    const acc = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS1}`, { headers: auth(A.token) });
    const wsRow = (acc.body.data.members || []).find((x: any) => x.owner === B.name);
    assert(wsRow && wsRow.role === 'viewer' && wsRow.source === 'invite', `WS1 roster has B as viewer via invite: ${JSON.stringify(wsRow)}`);
    const acc2 = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS2}`, { headers: auth(A.token) });
    assert(!(acc2.body.data.members || []).some((x: any) => x.owner === B.name), 'WS2 grant was removed by the PATCH — must NOT be applied');
});

// ── Cancel a pending invitation ──

await test('7. A invites C then cancels → C cannot accept (404), C notified', async () => {
    const inv = await json(`/v1/organisms/${orgId}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: C.name }) });
    assert(inv.status === 201, `invite C ${inv.status}`);
    const del = await json(`/v1/organisms/${orgId}/invitations/${encodeURIComponent(C.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200 && del.body.data.status === 'cancelled', `cancel ${del.status}: ${JSON.stringify(del.body.error)}`);
    const acc = await json(`/v1/organisms/${orgId}/invitations/accept`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(acc.status === 404, `accept after cancel expected 404, got ${acc.status}`);
    assert(await hasNotif(C.token, 'organism_invitation_cancelled'), 'C should have a cancellation notification');
    const again = await json(`/v1/organisms/${orgId}/invitations/${encodeURIComponent(C.name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(again.status === 404, `second cancel expected 404, got ${again.status}`);
});

// ── Direct add ──

await test('8. A DIRECT-adds C as admin with WS2 contributor → active immediately, notified', async () => {
    const r = await json(`/v1/organisms/${orgId}/members`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ ghii: C.name, role: 'admin', workspaces: [{ ws: WS2, role: 'contributor' }] }),
    });
    assert(r.status === 201 && r.body.data.status === 'added', `add ${r.status}: ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    const row = (m.body.data.members || []).find((x: any) => x.ghii === C.name);
    assert(row && row.status === 'active' && row.role === 'admin', `C active admin: ${JSON.stringify(row)}`);
    const org = await json(`/v1/organisms/${orgId}`, { headers: auth(A.token) });
    assert((org.body.data.organism.admins || []).includes(C.name), 'organism.admins includes C');
    const acc = await json(`/v1/organisms/${orgId}/workspace-access?ws=${WS2}`, { headers: auth(A.token) });
    const wsRow = (acc.body.data.members || []).find((x: any) => x.owner === C.name);
    assert(wsRow && wsRow.role === 'contributor', `WS2 roster has C as contributor: ${JSON.stringify(wsRow)}`);
    assert(await hasNotif(C.token, 'organism_member_added'), 'C should have an added notification');
});

await test('9. Direct-adding an existing member is refused (409 ALREADY_MEMBER)', async () => {
    const r = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ghii: C.name }) });
    assert(r.status === 409 && r.body.error?.code === 'ALREADY_MEMBER', `expected 409 ALREADY_MEMBER, got ${r.status} ${r.body.error?.code}`);
});

await test('10. A member (B, non-admin) cannot direct-add (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ghii: D.name }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('11. A pending invite is upgraded in place by a direct add', async () => {
    const inv = await json(`/v1/organisms/${orgId}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: D.name, role: 'member' }) });
    assert(inv.status === 201, `invite D ${inv.status}`);
    const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ghii: D.name, role: 'member', workspaces: [{ ws: WS1, role: 'viewer' }] }) });
    assert(add.status === 201, `add over pending ${add.status}: ${JSON.stringify(add.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    const rows = (m.body.data.members || []).filter((x: any) => x.ghii === D.name);
    assert(rows.length === 1 && rows[0].status === 'active', `exactly one ACTIVE membership row for D: ${JSON.stringify(rows)}`);
    const pend = await json(`/v1/organisms/${orgId}/invitations`, { headers: auth(A.token) });
    assert(!(pend.body.data.invitations || []).some((x: any) => x.ghii === D.name), 'no pending invitation left for D');
});

// ── Plain invite regression + ?all=1 rosters ──

await test('12. Plain invite without role/workspaces still works (regression)', async () => {
    const org2 = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Plain Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org2.status === 201, `org2 ${org2.status}`);
    const id2 = org2.body.data.organism.id;
    const inv = await json(`/v1/organisms/${id2}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: B.name }) });
    assert(inv.status === 201 && inv.body.data.invitation.role === 'member', `plain invite ${inv.status}: role=${inv.body.data?.invitation?.role}`);
    const acc = await json(`/v1/organisms/${id2}/invitations/accept`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(acc.status === 200 && acc.body.data.status === 'joined', `plain accept ${acc.status}`);
});

await test('13. ?all=1 rosters ALL workspaces for an org admin who owns none', async () => {
    // C is an org admin but created neither workspace — the admin-wide all=1 must still list both.
    const r = await json(`/v1/organisms/${orgId}/workspace-access?all=1`, { headers: auth(C.token) });
    assert(r.status === 200, `all=1 ${r.status}: ${JSON.stringify(r.body.error)}`);
    const ids = (r.body.data.workspaces || []).map((w: any) => w.ws);
    assert(ids.includes(WS1) && ids.includes(WS2), `admin sees both rosters, got ${JSON.stringify(ids)}`);
    const ws1 = (r.body.data.workspaces || []).find((w: any) => w.ws === WS1);
    assert((ws1.members || []).some((x: any) => x.owner === B.name), 'WS1 roster carries B');
});

await test('14. ?all=1 stays scoped to owned workspaces for a plain member', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access?all=1`, { headers: auth(B.token) });
    assert(r.status === 200, `all=1 member ${r.status}`);
    assert((r.body.data.workspaces || []).length === 0, `plain member (owns no ws) sees none, got ${JSON.stringify(r.body.data.workspaces)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

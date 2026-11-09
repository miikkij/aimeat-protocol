/**
 * @file e2e-workspace-grant-invite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for what a direct workspace-role grant does about the grantee's organism
 *   membership (services/invitations.ts membershipAfterGrant). A role is read only by an active member
 *   of the organism, so a grant to an account outside it used to answer 200 and open nothing.
 *   Covers: the grant to an outsider sends the organism invitation and says so; a second grant says
 *   the invitation is pending; the role works after the person accepts; a grant to a member says
 *   member and sends nothing; a workspace creator who is not an organism admin cannot invite
 *   (needs_admin, no invitation made); an unknown account is refused by name; and the MCP grant
 *   tool gives the same answer.
 * @version-history
 *   2026-11-09 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-grant-invite

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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
const post = (t: string, path: string, body: unknown) => json(path, { method: 'POST', headers: auth(t), body: JSON.stringify(body) });
const invitationsFor = async (token: string) => {
    const r = await json('/v1/notifications', { headers: auth(token) });
    return r.status === 200 ? (r.body.data.notifications || []).filter((n: any) => n.type === 'organism_invitation').length : -1;
};
const MANIFEST = (name: string) => ({
    manifestVersion: '1', name, kind: 'project',
    objectTypes: [{ name: 'task', namespace: 'shared.tasks', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:task@1' }],
});
const SCHEMAS = { 'shared.tasks': { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } };

console.log('\n=== AIMEAT workspace grant invites an outsider E2E ===\n');

type Owner = Awaited<ReturnType<typeof registerOwner>>;
let alice: Owner;   // creates the organism and its first workspace
let bob: Owner;     // outside the organism; granted a role by alice
let carol: Owner;   // a plain member who creates a workspace of her own
let dave: Owner;    // outside the organism; granted a role by carol
let orgId = '';
let ws1 = '';
let ws2 = '';
const stamp = Date.now().toString(36);

await test('Setup: four owners; alice makes an invite-only organism and a workspace', async () => {
    alice = await registerOwner(BASE, `wgia${stamp}`);
    bob = await registerOwner(BASE, `wgib${stamp}`);
    carol = await registerOwner(BASE, `wgic${stamp}`);
    dave = await registerOwner(BASE, `wgid${stamp}`);
    const o = await post(alice.token, '/v1/organisms', { name: `Grant invite ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const w = await post(alice.token, `/v1/organisms/${orgId}/workspaces`, { name: 'Table', manifest: MANIFEST('Table'), schemas: SCHEMAS });
    ws1 = w.body.data?.ws;
    assert((w.status === 200 || w.status === 201) && !!ws1, `workspace ${w.status}: ${JSON.stringify(w.body.error ?? w.body.data)}`);
});

await test('1. A grant to an account outside the organism invites it and says so', async () => {
    const g = await post(alice.token, `/v1/organisms/${orgId}/workspace-access/grant`, { ws: ws1, grantee: bob.name, role: 'viewer' });
    assert(g.status === 200 && g.body.data.role === 'viewer', `grant ${g.status}: ${JSON.stringify(g.body)}`);
    assert(g.body.data.organism_member === false && g.body.data.invitation === 'sent', `standing: ${JSON.stringify(g.body.data)}`);
    assert((await invitationsFor(bob.token)) === 1, 'bob has one organism invitation');
    const list = await json(`/v1/organisms/${orgId}/invitations`, { headers: auth(alice.token) });
    const row = (list.body.data.invitations || []).find((m: any) => m.ghii === bob.name);
    assert(!!row && (row.invitedWorkspaces || []).some((x: any) => x.ws === ws1 && x.role === 'viewer'), `the invitation carries the role: ${JSON.stringify(row)}`);
});

await test('2. Before he accepts, bob still reads nothing', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${ws1}`, { headers: auth(bob.token) });
    assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
});

await test('3. A second grant says the invitation is pending and sends no second one', async () => {
    const g = await post(alice.token, `/v1/organisms/${orgId}/workspace-access/grant`, { ws: ws1, grantee: bob.name, role: 'contributor' });
    assert(g.status === 200 && g.body.data.organism_member === false && g.body.data.invitation === 'pending', `standing: ${JSON.stringify(g.body.data)}`);
    assert((await invitationsFor(bob.token)) === 1, 'still one invitation');
});

await test('4. After bob accepts, the role works', async () => {
    const acc = await post(bob.token, `/v1/organisms/${orgId}/invitations/accept`, {});
    assert(acc.status === 200 && acc.body.data.status === 'joined', `accept ${acc.status}: ${JSON.stringify(acc.body)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${ws1}`, { headers: auth(bob.token) });
    assert(r.status === 200 && r.body.data?.manifest?.name === 'Table', `bob reads the workspace: ${r.status} ${JSON.stringify(r.body.error ?? Object.keys(r.body.data ?? {}))}`);
});

await test('5. A grant to a member says member and invites nobody', async () => {
    const g = await post(alice.token, `/v1/organisms/${orgId}/workspace-access/grant`, { ws: ws1, grantee: bob.name, role: 'viewer' });
    assert(g.status === 200 && g.body.data.organism_member === true && g.body.data.invitation === null, `standing: ${JSON.stringify(g.body.data)}`);
    assert((await invitationsFor(bob.token)) === 1, 'no new invitation');
});

await test('6. A workspace creator who is not an organism admin cannot invite: needs_admin, nothing sent', async () => {
    const add = await post(alice.token, `/v1/organisms/${orgId}/members`, { ghii: carol.name });
    assert(add.status === 201, `direct add ${add.status}: ${JSON.stringify(add.body.error)}`);
    const w = await post(carol.token, `/v1/organisms/${orgId}/workspaces`, { name: 'Carol', manifest: MANIFEST('Carol'), schemas: SCHEMAS });
    ws2 = w.body.data?.ws;
    assert((w.status === 200 || w.status === 201) && !!ws2, `carol's workspace ${w.status}: ${JSON.stringify(w.body.error ?? w.body.data)}`);
    const g = await post(carol.token, `/v1/organisms/${orgId}/workspace-access/grant`, { ws: ws2, grantee: dave.name, role: 'viewer' });
    assert(g.status === 200 && g.body.data.organism_member === false && g.body.data.invitation === 'needs_admin', `standing: ${JSON.stringify(g.body)}`);
    assert((await invitationsFor(dave.token)) === 0, 'dave got no organism invitation');
    const list = await json(`/v1/organisms/${orgId}/invitations`, { headers: auth(alice.token) });
    assert(!(list.body.data.invitations || []).some((m: any) => m.ghii === dave.name), 'no pending invitation for dave');
});

await test('7. An account that does not exist is named as the refusal', async () => {
    const g = await post(alice.token, `/v1/organisms/${orgId}/workspace-access/grant`, { ws: ws1, grantee: `nobody${stamp}`, role: 'viewer' });
    assert(g.status === 200 && g.body.data.organism_member === false && g.body.data.invitation === 'refused' && g.body.data.invitation_refusal === 'OWNER_NOT_FOUND', `standing: ${JSON.stringify(g.body)}`);
});

await test('8. The MCP grant tool gives the same answer and sends the invitation', async () => {
    const agent = await makeAgent(BASE, alice, ['organism:read', 'organism:write', 'organism:invite']);
    const s = await openSession(BASE, agent.token);
    const r = await callTool(s, 'aimeat_workspace_member_grant', { organism_id: orgId, ws: ws1, grantee: dave.name, role: 'viewer' });
    assert(!r.isError && r.offered !== false, `tool refused: ${r.text}`);
    const d = (r.data ?? {}) as any;
    assert(d.granted === 1 && d.organism_member === false && d.invitation === 'sent', `answer: ${r.text}`);
    assert((await invitationsFor(dave.token)) === 1, 'dave has the invitation');
    const again = await callTool(s, 'aimeat_workspace_member_grant', { organism_id: orgId, ws: ws1, grantee: bob.name, role: 'viewer' });
    assert(((again.data ?? {}) as any).organism_member === true, `a member reads as member: ${again.text}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

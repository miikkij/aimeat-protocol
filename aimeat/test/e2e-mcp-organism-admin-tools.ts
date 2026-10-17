/**
 * @file test/e2e-mcp-organism-admin-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism membership, invitation and ownership tools of the node MCP endpoint,
 *   each called once by the caller it is written for and once by a caller its own handler must
 *   refuse.
 *
 *   WHY THIS SUITE EXISTS. The handlers in src/mcp/organisms-name-invites.ts decide who may act with
 *   code of their own (inviteAdminGate, the owner test of owner_add and owner_remove), and the
 *   services they call take the caller as already authorized (createNameInvitation,
 *   updateNameInvitation, cancelNameInvitation, addOrganismOwner, removeOrganismOwner). No suite
 *   called these tools, so a removed check stayed green everywhere. The scope word is a permission
 *   of the AGENT and not a role in the organism, so a plain member's agent holding organism:invite is
 *   offered all of them: that agent is the refusal case here, and the assertion is that the HANDLER
 *   refuses it (the tool is offered, and the call answers isError) and that nothing changed when read
 *   back over REST.
 *
 *   The operator repair tools (src/mcp/core-admin.ts) are the same shape one level up: the word
 *   operator:organism-repair is checked at registration, and the handler asks again whether the
 *   account behind the agent runs the node. A non-operator's agent holding the word is the refusal.
 * @structure
 *   - Setup: operator OP (first owner), creator A, plain members M and N, outsiders X and Y;
 *     A's organism (invite only) with a published record; agents with exactly the words each case needs
 *   - Invitations: invite, invitations, invitation_update, invitation_cancel, invitation_respond
 *   - Members and owners: member_remove, owner_add, owner_remove
 *   - Content: organism_search, organism_export, organism_import
 *   - Operator repair: admin_organism_ownership, admin_organism_owner_add
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-organism-admin-tools
 * @version-history
 *   v1.1.0 — 2026-10-17 — aimeat_organism_invitations misses only organism:read, a one-press word, so
 *     it is listed for an agent without it (permission ask, mcp/permission-ask-gate.ts) and the call
 *     is refused SCOPE_DENIED with the allow address.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F06a-01, W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const auth = (o: { token: string }): Record<string, string> => ({ Authorization: `Bearer ${o.token}` });
const TAG = Date.now().toString(36).slice(-5);

/** The words a member-management agent holds: the scope filter offers every tool of this suite. */
const ORG_WORDS = ['organism:read', 'organism:write', 'organism:invite'];

let OP!: RegisteredOwner, A!: RegisteredOwner, M!: RegisteredOwner, N!: RegisteredOwner;
let X!: RegisteredOwner, Y!: RegisteredOwner;
let aS!: McpSession, mS!: McpSession, nS!: McpSession, xS!: McpSession, yS!: McpSession;
let opRepairS!: McpSession, mRepairS!: McpSession, xReadlessS!: McpSession;
let orgId = '';
let WS = '';
const NS = 'shared.notes';
const NEEDLE = `zebracorn${TAG}`;

/** The pending invitations of A's organism, read over REST with the creator's own session. */
async function pendingInvites(): Promise<any[]> {
    const r = await json(`/v1/organisms/${orgId}/invitations`, { headers: auth(A) });
    assert(r.status === 200, `invitations read: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.invitations as any[];
}

/** The active members of A's organism, read over REST with the creator's session. */
async function activeMembers(): Promise<string[]> {
    const r = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A) });
    assert(r.status === 200, `members read: ${r.status}`);
    return (r.body.data.members as any[]).map((m) => String(m.ghii));
}

/** The organism's owners, read through the operator repair read (asserted on its own below). */
async function ownersOf(): Promise<string[]> {
    const r = await callTool(opRepairS, 'aimeat_admin_organism_ownership', { organism_id: orgId });
    assert(!r.isError, `ownership read: ${r.text}`);
    return (r.data.owners as string[]).map(String);
}

const has = (list: string[], name: string): boolean => list.some((g) => g === name || g.startsWith(`${name}@`));

console.log('\n=== MCP organism admin tools: called and refused ===\n');

await test('Setup: six owners, the organism, a published record, and the agents', async () => {
    OP = await registerOwner(BASE, `oaop${TAG}`);
    A = await registerOwner(BASE, `oacr${TAG}`);
    M = await registerOwner(BASE, `oamm${TAG}`);
    N = await registerOwner(BASE, `oamn${TAG}`);
    X = await registerOwner(BASE, `oaox${TAG}`);
    Y = await registerOwner(BASE, `oaoy${TAG}`);
    assert(OP.roles.includes('operator') && !A.roles.includes('operator') && !M.roles.includes('operator'),
        `only the first owner runs the node: ${JSON.stringify([OP.roles, A.roles, M.roles])}`);

    const o = await json('/v1/organisms', {
        method: 'POST', headers: auth(A),
        body: JSON.stringify({ name: `Admin tools ${TAG}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    for (const p of [M, N]) {
        const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ghii: p.name }) });
        assert(add.status === 201, `add ${p.name}: ${add.status} ${JSON.stringify(add.body?.error)}`);
    }

    // A registered workspace (the organism export carries only those) and one published record
    // holding a word nothing else on the node holds, so the search and the export have something of
    // this organism's own to find.
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: auth(A),
        body: JSON.stringify({ name: 'Adm', manifest: { objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: NS, backing: 'memory', writeRole: 'member', versioned: true, mode: 'records' },
        ] } }),
    });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    WS = w.body.data.ws;
    const root = `organism.${orgId}.w.${WS}`;
    const d = await json('/v1/memory', { method: 'POST', headers: auth(A), body: JSON.stringify({ key: `${root}.${NS}.n1.draft`, value: { id: 'n1', title: `About ${NEEDLE}`, body: `The ${NEEDLE} note.` }, visibility: 'private' }) });
    assert(d.status === 201, `draft: ${d.status} ${JSON.stringify(d.body?.error)}`);
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ws: WS, namespace: NS, id: 'n1' }) });
    assert(pub.status === 200, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);

    aS = await openSession(BASE, (await makeAgent(BASE, A, ORG_WORDS)).token, 'adm-a');
    mS = await openSession(BASE, (await makeAgent(BASE, M, ORG_WORDS)).token, 'adm-m');
    nS = await openSession(BASE, (await makeAgent(BASE, N, ORG_WORDS)).token, 'adm-n');
    xS = await openSession(BASE, (await makeAgent(BASE, X, ORG_WORDS)).token, 'adm-x');
    yS = await openSession(BASE, (await makeAgent(BASE, Y, ORG_WORDS)).token, 'adm-y');
    xReadlessS = await openSession(BASE, (await makeAgent(BASE, X, ['memory:read'])).token, 'adm-x-readless');
    opRepairS = await openSession(BASE, (await makeAgent(BASE, OP, ['operator:organism-repair'])).token, 'adm-op');
    mRepairS = await openSession(BASE, (await makeAgent(BASE, M, ['operator:organism-repair'])).token, 'adm-m-repair');
});

await test('The plain member\'s agent is offered the admin tools: the scope filter is not what refuses it', async () => {
    const names = await toolNames(mS);
    for (const t of ['aimeat_organism_invite', 'aimeat_organism_invitation_update', 'aimeat_organism_invitation_cancel',
        'aimeat_organism_member_remove', 'aimeat_organism_owner_add', 'aimeat_organism_owner_remove']) {
        assert(names.includes(t), `the member's agent holding organism:invite was not offered ${t}`);
    }
    const repair = await toolNames(mRepairS);
    assert(repair.includes('aimeat_admin_organism_owner_add') && repair.includes('aimeat_admin_organism_ownership'),
        'a non-operator\'s agent holding operator:organism-repair is offered the repair tools; the handler refuses it');
});

// ── Invitations ──────────────────────────────────────────────────────────────────────────────

await test('aimeat_organism_invite: a plain member\'s agent is refused by the handler, and no invitation exists', async () => {
    const r = await callTool(mS, 'aimeat_organism_invite', { organism_id: orgId, invitee: X.name });
    assert(r.offered && r.isError, `the member invited: ${r.text}`);
    assert(/creator or an admin/.test(r.text), `the refusal names who may: ${r.text}`);
    assert(!has((await pendingInvites()).map((m) => m.ghii), X.name), 'an invitation for X exists after the refusal');
});

await test('aimeat_organism_invite: the creator\'s agent invites X, and the invitation is pending', async () => {
    const r = await callTool(aS, 'aimeat_organism_invite', { organism_id: orgId, invitee: X.name, role: 'member' });
    assert(!r.isError, `the creator's invite: ${r.text}`);
    assert(r.data.status === 'invited' && has([r.data.invitee], X.name), `answer: ${r.text}`);
    const row = (await pendingInvites()).find((m) => has([m.ghii], X.name));
    assert(row && row.role === 'member', `pending invitation for X: ${JSON.stringify(row)}`);
});

await test('aimeat_organism_invitations: X\'s agent lists the invitation; an agent of X without organism:read is refused the tool with the allow address', async () => {
    const r = await callTool(xS, 'aimeat_organism_invitations', {});
    assert(!r.isError && Array.isArray(r.data), `list: ${r.text}`);
    assert(r.data.some((i: any) => i.organism_id === orgId && i.role === 'member'), `X's invitation is listed: ${r.text}`);
    const refused = await callTool(xReadlessS, 'aimeat_organism_invitations', {});
    // Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
    assert(refused.isError && refused.offered && /^SCOPE_DENIED/.test(refused.text) && refused.text.includes('/v1/allow?'),
        `an agent without organism:read read the invitations: ${refused.text}`);
    // The list is the caller's own: M has none, and M's agent does not see X's.
    const theirs = await callTool(mS, 'aimeat_organism_invitations', {});
    assert(!theirs.isError && !theirs.data.some((i: any) => i.organism_id === orgId), `M's agent sees X's invitation: ${theirs.text}`);
});

await test('aimeat_organism_invitation_update: a plain member\'s agent is refused, and the role stays', async () => {
    const r = await callTool(mS, 'aimeat_organism_invitation_update', { organism_id: orgId, invitee: X.name, role: 'admin' });
    assert(r.offered && r.isError && /creator or an admin/.test(r.text), `the member changed the invitation: ${r.text}`);
    const row = (await pendingInvites()).find((m) => has([m.ghii], X.name));
    assert(row?.role === 'member', `the role changed after the refusal: ${JSON.stringify(row)}`);
});

await test('aimeat_organism_invitation_update: the creator\'s agent changes the role', async () => {
    const r = await callTool(aS, 'aimeat_organism_invitation_update', { organism_id: orgId, invitee: X.name, role: 'admin' });
    assert(!r.isError && r.data.status === 'updated' && r.data.role === 'admin', `update: ${r.text}`);
    const row = (await pendingInvites()).find((m) => has([m.ghii], X.name));
    assert(row?.role === 'admin', `the role read back: ${JSON.stringify(row)}`);
});

await test('aimeat_organism_invitation_cancel: a plain member\'s agent is refused, and the invitation stays', async () => {
    const r = await callTool(mS, 'aimeat_organism_invitation_cancel', { organism_id: orgId, invitee: X.name });
    assert(r.offered && r.isError && /creator or an admin/.test(r.text), `the member cancelled: ${r.text}`);
    assert(has((await pendingInvites()).map((m) => m.ghii), X.name), 'the invitation is gone after the refusal');
});

await test('aimeat_organism_invitation_cancel: the creator\'s agent cancels, and X has nothing pending', async () => {
    const r = await callTool(aS, 'aimeat_organism_invitation_cancel', { organism_id: orgId, invitee: X.name });
    assert(!r.isError && r.data.status === 'cancelled', `cancel: ${r.text}`);
    assert(!has((await pendingInvites()).map((m) => m.ghii), X.name), 'the invitation is still pending');
    const mine = await callTool(xS, 'aimeat_organism_invitations', {});
    assert(!mine.data.some((i: any) => i.organism_id === orgId), `X still lists it: ${mine.text}`);
});

await test('aimeat_organism_invitation_respond: with no pending invitation it is refused; with one, the agent declines it', async () => {
    const none = await callTool(yS, 'aimeat_organism_invitation_respond', { organism_id: orgId, decision: 'decline' });
    assert(none.isError && /no pending invitation/i.test(none.text), `Y answered an invitation nobody sent: ${none.text}`);
    const inv = await callTool(aS, 'aimeat_organism_invite', { organism_id: orgId, invitee: Y.name });
    assert(!inv.isError, `invite Y: ${inv.text}`);
    const r = await callTool(yS, 'aimeat_organism_invitation_respond', { organism_id: orgId, decision: 'decline' });
    assert(!r.isError && r.data.status === 'declined', `decline: ${r.text}`);
    assert(!has((await pendingInvites()).map((m) => m.ghii), Y.name), 'the declined invitation is still pending');
    assert(!has(await activeMembers(), Y.name), 'Y became a member by declining');
});

// ── Members and owners ───────────────────────────────────────────────────────────────────────

await test('aimeat_organism_member_remove: a plain member\'s agent is refused, and N stays', async () => {
    const r = await callTool(mS, 'aimeat_organism_member_remove', { organism_id: orgId, ghii: N.name });
    assert(r.offered && r.isError && /creator or an admin/.test(r.text), `the member removed N: ${r.text}`);
    assert(has(await activeMembers(), N.name), 'N is gone after the refusal');
});

await test('aimeat_organism_owner_add: a plain member\'s agent is refused, and the owners stay', async () => {
    const before = await ownersOf();
    const r = await callTool(mS, 'aimeat_organism_owner_add', { organism_id: orgId, ghii: M.name });
    assert(r.offered && r.isError && /Only an owner can add an owner/.test(r.text), `the member made itself an owner: ${r.text}`);
    const after = await ownersOf();
    assert(!has(after, M.name) && after.length === before.length, `owners changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
});

await test('aimeat_organism_owner_add: the creator\'s agent adds M as an owner', async () => {
    const r = await callTool(aS, 'aimeat_organism_owner_add', { organism_id: orgId, ghii: M.name });
    assert(!r.isError, `owner add: ${r.text}`);
    assert(has((r.data.owners as string[]).map(String), M.name), `answer: ${r.text}`);
    assert(has(await ownersOf(), M.name), 'M is not an owner when read back');
});

await test('aimeat_organism_owner_remove: a plain member\'s agent is refused, and M stays an owner', async () => {
    const r = await callTool(nS, 'aimeat_organism_owner_remove', { organism_id: orgId, ghii: M.name });
    assert(r.offered && r.isError && /Only an owner can remove an owner/.test(r.text), `the member removed an owner: ${r.text}`);
    assert(has(await ownersOf(), M.name), 'M lost ownership after the refusal');
});

await test('aimeat_organism_owner_remove: the creator\'s agent removes M as an owner', async () => {
    const r = await callTool(aS, 'aimeat_organism_owner_remove', { organism_id: orgId, ghii: M.name });
    assert(!r.isError, `owner remove: ${r.text}`);
    const owners = await ownersOf();
    assert(!has(owners, M.name) && has(owners, A.name), `owners read back: ${JSON.stringify(owners)}`);
});

await test('aimeat_organism_member_remove: the creator\'s agent removes N', async () => {
    const r = await callTool(aS, 'aimeat_organism_member_remove', { organism_id: orgId, ghii: N.name });
    assert(!r.isError && r.data.status === 'removed', `remove: ${r.text}`);
    assert(!has(await activeMembers(), N.name), 'N is still an active member');
});

// ── Content ──────────────────────────────────────────────────────────────────────────────────

await test('aimeat_organism_search: an outsider\'s agent is refused; the creator\'s agent finds the record', async () => {
    const refused = await callTool(xS, 'aimeat_organism_search', { organism_id: orgId, q: NEEDLE });
    assert(refused.offered && refused.isError && /Not an active member/.test(refused.text), `the outsider searched: ${refused.text}`);
    const r = await callTool(aS, 'aimeat_organism_search', { organism_id: orgId, q: NEEDLE });
    assert(!r.isError && Array.isArray(r.data.results), `search: ${r.text}`);
    assert(r.data.results.length >= 1 && JSON.stringify(r.data.results).includes(NEEDLE), `the record was not found: ${r.text}`);
});

let exportedZip = '';
await test('aimeat_organism_export: an outsider\'s agent is refused; the creator\'s agent gets a ZIP', async () => {
    const refused = await callTool(xS, 'aimeat_organism_export', { organism_id: orgId });
    assert(refused.offered && refused.isError && /active member/.test(refused.text), `the outsider exported: ${refused.text}`);
    assert(!refused.text.includes(NEEDLE), 'the refusal carried content');
    const r = await callTool(aS, 'aimeat_organism_export', { organism_id: orgId });
    assert(!r.isError && typeof r.data.zip_base64 === 'string' && r.data.size_bytes > 0, `export: ${r.text.slice(0, 300)}`);
    const zip = Buffer.from(r.data.zip_base64, 'base64');
    assert(zip.subarray(0, 2).toString('latin1') === 'PK', 'the export is not a ZIP');
    exportedZip = r.data.zip_base64;
    // `workspaces` is how many workspaces the bundle carries; the organism has the one made above.
    assert(r.data.workspaces === 1, `workspaces in the bundle: ${JSON.stringify(r.data.workspaces)}`);
    assert(zip.toString('latin1').includes(WS), 'the workspace id is not in the bundle');
});

await test('aimeat_organism_import: a ZIP the safety check refuses is quarantined; the exported bundle imports', async () => {
    const hostile = await callTool(aS, 'aimeat_organism_import', { zip_base64: Buffer.from('this is not an archive').toString('base64') });
    assert(hostile.isError && /quarantined/.test(hostile.text) && /NOT_A_ZIP/.test(hostile.text), `a non-ZIP was not quarantined: ${hostile.text}`);
    const r = await callTool(aS, 'aimeat_organism_import', { zip_base64: exportedZip });
    assert(!r.isError, `import: ${r.text.slice(0, 300)}`);
    const newId = r.data.organism_id;
    assert(typeof newId === 'string' && newId !== orgId, `the import names a new organism: ${r.text.slice(0, 300)}`);
    assert(Array.isArray(r.data.workspaces) && r.data.workspaces.length === 1 && r.data.workspaces[0].from === WS,
        `the workspace came along: ${JSON.stringify(r.data.workspaces)}`);
    const got = await json(`/v1/organisms/${newId}`, { headers: auth(A) });
    assert(got.status === 200, `the imported organism reads back: ${got.status}`);
});

// ── Operator repair ──────────────────────────────────────────────────────────────────────────

await test('aimeat_admin_organism_ownership: a non-operator\'s agent holding the word is refused; the operator\'s agent reads the owners', async () => {
    const refused = await callTool(mRepairS, 'aimeat_admin_organism_ownership', { organism_id: orgId });
    assert(refused.offered && refused.isError && /operator/.test(refused.text), `a non-operator read the ownership: ${refused.text}`);
    assert(!refused.text.includes(A.name), 'the refusal carried the owners');
    const r = await callTool(opRepairS, 'aimeat_admin_organism_ownership', { organism_id: orgId });
    assert(!r.isError && r.data.id === orgId, `ownership: ${r.text}`);
    assert(has(r.data.owners, A.name) && Array.isArray(r.data.members) && r.data.members.some((m: any) => has([m.ghii], M.name)),
        `owners and members: ${r.text}`);
});

await test('aimeat_admin_organism_owner_add: a non-operator\'s agent holding the word is refused; the operator\'s agent seats X as an owner', async () => {
    const refused = await callTool(mRepairS, 'aimeat_admin_organism_owner_add', { organism_id: orgId, ghii: M.name });
    assert(refused.offered && refused.isError && /operator/.test(refused.text), `a non-operator installed an owner: ${refused.text}`);
    assert(!has(await ownersOf(), M.name), 'M became an owner through the refused repair');
    const r = await callTool(opRepairS, 'aimeat_admin_organism_owner_add', { organism_id: orgId, ghii: X.name });
    assert(!r.isError, `repair: ${r.text}`);
    assert(r.data.membership_created === true && has(r.data.owners, X.name), `answer: ${r.text}`);
    assert(has(await ownersOf(), X.name) && has(await activeMembers(), X.name), 'X is not an owner and member when read back');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

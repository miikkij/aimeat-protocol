/**
 * @file e2e-organism-membership-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every refusal on src/routes/organisms/membership.ts, and the handlers the existing
 *   membership suite never reaches: the roster-privacy arm of the members listing, the join-request
 *   review guards, admin promote and demote, unban, transfer, the additive owner pair (including the
 *   last-owner refusal), the shared creator/admin gate behind the invitation routes, the direct
 *   member add, invitation edit/cancel/list, accept and decline, and agent attach/detach. Sister
 *   suite to test/e2e-organism-membership.ts, which drives the happy paths; nothing here repeats one.
 * @structure
 *   Phase 0  setup: six owners, two organisms, one agent
 *   Phase 1  GET members: 404 and the members_hidden arm
 *   Phase 2  join requests: listing and review
 *   Phase 3  admins: promote and demote
 *   Phase 4  member removal and unban
 *   Phase 5  transfer, and the additive owner pair
 *   Phase 6  invitations: the shared admin gate, edit, cancel, list, accept, decline
 *   Phase 7  direct member add
 *   Phase 8  agent attach and detach
 *   Phase 9  401 on every door
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-organism-membership-doors
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Every route here is requireAuth() + requireRole('agent') except
 *     the members listing (optionalAuth), and requireRole('agent') admits an owner session, so the
 *     suite drives them with owner tokens — which is also what a person's browser sends.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Owner { name: string; token: string }

/** An owner through POST /v1/owners — that door carries no registration rate limit. */
async function setupOwner(label: string): Promise<Owner> {
    const name = `orgdoor${label}${Date.now().toString(36)}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `owner ${label} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner ${label} token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}

const MISSING = 'org-does-not-exist-0000';

console.log('\n=== AIMEAT Organism Membership Doors E2E ===\n');

// ─── Phase 0 — setup ───
console.log('Phase 0 — setup');

let Z: Owner;    // registered first, so the node's operator role lands on nobody the suite measures
let CR: Owner;   // creator
let M: Owner;    // member, promoted and demoted along the way
let W: Owner;    // a second plain member, so the hidden roster has something to hide
let X: Owner;    // outsider, invited and directly added later
let Y: Owner;    // never a member of anything, and never an admin
let org = '';    // open-join organism: the roster, admin, owner and invitation doors
let org2 = '';   // approval_required organism: the join-request doors
let mAgent = '';

await test('Setup: six owners', async () => {
    // The FIRST real owner on a node is made an operator, and an operator sees every roster
    // (organism-privacy.ts canSeeMembers returns true for one). Z absorbs that so the roster-privacy
    // assertions below measure the tier and not the caller's role.
    Z = await setupOwner('z');
    CR = await setupOwner('cr');
    M = await setupOwner('m');
    W = await setupOwner('w');
    X = await setupOwner('x');
    Y = await setupOwner('y');
    assert(Z.name !== CR.name, 'six distinct owners');
});

await test('Setup: an open organism with two members, and an approval_required one', async () => {
    const o = await json('/v1/organisms', {
        method: 'POST', headers: auth(CR.token),
        body: JSON.stringify({ name: 'Doors Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    org = o.body.data.organism.id;

    for (const who of [M, W]) {
        const j = await json(`/v1/organisms/${org}/join`, { method: 'POST', headers: auth(who.token), body: '{}' });
        // 201 and not 202: an `open` join policy seats the person at once (crud.ts:341); the 202
        // pending answer belongs to the approval_required organism created below.
        assert(j.status === 201, `${who.name} join ${j.status}: ${JSON.stringify(j.body.error)}`);
    }

    const o2 = await json('/v1/organisms', {
        method: 'POST', headers: auth(CR.token),
        body: JSON.stringify({ name: 'Doors Org Two', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }),
    });
    assert(o2.status === 201, `org2 ${o2.status}: ${JSON.stringify(o2.body.error)}`);
    org2 = o2.body.data.organism.id;
});

await test('Setup: M owns an agent', async () => {
    const a = await json('/v1/agents', {
        method: 'POST', headers: auth(M.token),
        body: JSON.stringify({ name: 'mhelper', owner: M.name, capabilities: ['memory'] }),
    });
    assert(a.status === 201, `agent ${a.status}: ${JSON.stringify(a.body.error)}`);
    mAgent = a.body.data.agent.gaii as string;
});

// ─── Phase 1 — GET members ───
console.log('Phase 1 — the members listing');

await test('1. Members of an organism that does not exist → 404 NOT_FOUND', async () => {
    const r = await json(`/v1/organisms/${MISSING}/members`, { headers: auth(CR.token) });
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `expected 404 NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

await test('2. The creator sees the whole roster, with each member\'s agents', async () => {
    const r = await json(`/v1/organisms/${org}/members`, { headers: auth(CR.token) });
    assert(r.status === 200, `members ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.agents_included === true, `an active member sees agents: ${JSON.stringify(r.body.data.agents_included)}`);
    assert(r.body.data.total === 3, `creator + two members: total ${r.body.data.total}`);
    const mine = (r.body.data.members || []).find((m: any) => m.ghii === M.name);
    assert(mine?.agents?.some((a: any) => a.gaii === mAgent), `M's row carries M's agent: ${JSON.stringify(mine?.agents)}`);
});

await test('3. Below the visibility tier the roster shrinks but the TRUE total stays', async () => {
    const set = await json(`/v1/organisms/${org}`, {
        method: 'PUT', headers: auth(CR.token), body: JSON.stringify({ member_visibility: 'admins' }),
    });
    assert(set.status === 200, `member_visibility ${set.status}: ${JSON.stringify(set.body.error)}`);

    // A plain member is below 'admins': they keep the accountability rows and their own, no more.
    const asMember = await json(`/v1/organisms/${org}/members`, { headers: auth(M.token) });
    assert(asMember.status === 200, `members as M ${asMember.status}`);
    assert(asMember.body.data.members_hidden === true, `members_hidden for a plain member: ${JSON.stringify(asMember.body.data.members_hidden)}`);
    assert(asMember.body.data.total === 3, `the true total survives the redaction: ${asMember.body.data.total}`);
    const shown = (asMember.body.data.members || []).map((m: any) => m.ghii);
    assert(shown.includes(CR.name), `the creator stays visible (accountability): ${JSON.stringify(shown)}`);
    assert(shown.includes(M.name), `the caller always sees their own row: ${JSON.stringify(shown)}`);
    assert(!shown.includes(W.name), `another plain member is hidden: ${JSON.stringify(shown)}`);
    assert(asMember.body.data.agents_included === undefined, 'the redacted shape carries no agent rosters');

    // A signed-in NON-member has no row of their own, so they see only the accountability rows.
    const asOutsider = await json(`/v1/organisms/${org}/members`, { headers: auth(Y.token) });
    assert(asOutsider.status === 200, `members as Y ${asOutsider.status}`);
    assert(asOutsider.body.data.members_hidden === true, 'members_hidden for an outsider');
    const outsiderSees = (asOutsider.body.data.members || []).map((m: any) => m.ghii);
    assert(outsiderSees.length === 1 && outsiderSees[0] === CR.name, `an outsider sees the creator alone: ${JSON.stringify(outsiderSees)}`);

    // …and the creator is above every tier.
    const asCreator = await json(`/v1/organisms/${org}/members`, { headers: auth(CR.token) });
    assert(asCreator.body.data.members_hidden === undefined, 'the creator is never redacted');

    const restore = await json(`/v1/organisms/${org}`, {
        method: 'PUT', headers: auth(CR.token), body: JSON.stringify({ member_visibility: 'authenticated' }),
    });
    assert(restore.status === 200, `restore ${restore.status}`);
});

// ─── Phase 2 — join requests ───
console.log('Phase 2 — join requests');

let xRequestId = '';

await test('4. Join-requests listing: 404 for a missing organism, 403 for a non-admin', async () => {
    const r404 = await json(`/v1/organisms/${MISSING}/join-requests`, { headers: auth(CR.token) });
    assert(r404.status === 404 && r404.body.error?.code === 'NOT_FOUND', `expected 404, got ${r404.status} ${r404.body.error?.code}`);
    const r403 = await json(`/v1/organisms/${org2}/join-requests`, { headers: auth(M.token) });
    assert(r403.status === 403 && r403.body.error?.code === 'ACCESS_DENIED', `expected 403, got ${r403.status} ${r403.body.error?.code}`);
    assert(/admins/i.test(r403.body.error?.message ?? ''), `message names the rule: ${r403.body.error?.message}`);
});

await test('5. X asks to join the approval_required organism', async () => {
    const r = await json(`/v1/organisms/${org2}/join`, { method: 'POST', headers: auth(X.token), body: JSON.stringify({ message: 'please' }) });
    assert(r.status === 202 && r.body.data.status === 'pending', `join ${r.status}: ${JSON.stringify(r.body)}`);
    const list = await json(`/v1/organisms/${org2}/join-requests`, { headers: auth(CR.token) });
    assert(list.status === 200, `list ${list.status}`);
    const req = (list.body.data.join_requests || []).find((q: any) => q.ghii === X.name);
    assert(!!req, `X's request is listed: ${JSON.stringify(list.body.data.join_requests)}`);
    xRequestId = req.id;
});

await test('6. Review refusals: bad decision, missing organism, non-admin, unknown request', async () => {
    const url = `/v1/organisms/${org2}/join-requests/${xRequestId}/review`;
    const bad = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ decision: 'maybe' }) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `bad decision: ${bad.status} ${bad.body.error?.code}`);
    const none = await json(url, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(none.status === 400 && none.body.error?.code === 'INVALID_INPUT', `no decision: ${none.status} ${none.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/join-requests/${xRequestId}/review`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ decision: 'approved' }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonAdmin = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ decision: 'approved' }) });
    assert(nonAdmin.status === 403 && nonAdmin.body.error?.code === 'ACCESS_DENIED', `non-admin: ${nonAdmin.status} ${nonAdmin.body.error?.code}`);
    const unknownReq = await json(`/v1/organisms/${org2}/join-requests/no-such-request/review`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ decision: 'approved' }) });
    assert(unknownReq.status === 404 && unknownReq.body.error?.code === 'NOT_FOUND', `unknown request: ${unknownReq.status} ${unknownReq.body.error?.code}`);
    // Still pending after five refusals: not one of them wrote.
    const list = await json(`/v1/organisms/${org2}/join-requests`, { headers: auth(CR.token) });
    assert((list.body.data.join_requests || []).some((q: any) => q.id === xRequestId), 'the request is untouched');
});

await test('7. A reviewed request cannot be reviewed twice → 409 ALREADY_REVIEWED', async () => {
    const url = `/v1/organisms/${org2}/join-requests/${xRequestId}/review`;
    const ok = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ decision: 'rejected' }) });
    assert(ok.status === 200 && ok.body.data.decision === 'rejected', `review ${ok.status}: ${JSON.stringify(ok.body.error)}`);
    const again = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ decision: 'approved' }) });
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_REVIEWED', `expected 409 ALREADY_REVIEWED, got ${again.status} ${again.body.error?.code}`);
    const members = await json(`/v1/organisms/${org2}/members`, { headers: auth(CR.token) });
    assert(!(members.body.data.members || []).some((m: any) => m.ghii === X.name), 'a rejected requester is not a member');
});

// ─── Phase 3 — admins ───
console.log('Phase 3 — admins');

await test('8. POST admins refusals: no target, missing organism, non-admin, not a member', async () => {
    const url = `/v1/organisms/${org}/admins`;
    const noTarget = await json(url, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noTarget.status === 400 && noTarget.body.error?.code === 'INVALID_INPUT', `no target: ${noTarget.status} ${noTarget.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/admins`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ target_ghii: M.name }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonAdmin = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ target_ghii: W.name }) });
    assert(nonAdmin.status === 403 && nonAdmin.body.error?.code === 'ACCESS_DENIED', `non-admin: ${nonAdmin.status} ${nonAdmin.body.error?.code}`);
    const notMember = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ target_ghii: Y.name }) });
    assert(notMember.status === 404 && notMember.body.error?.code === 'NOT_MEMBER', `not a member: ${notMember.status} ${notMember.body.error?.code}`);
});

await test('9. Promoting a member, and refusing to promote them twice → 409 ALREADY_ADMIN', async () => {
    const url = `/v1/organisms/${org}/admins`;
    const ok = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ target_ghii: M.name }) });
    assert(ok.status === 200 && ok.body.data.promoted === M.name && ok.body.data.role === 'admin', `promote ${ok.status}: ${JSON.stringify(ok.body)}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert((read.body.data.organism.admins || []).includes(M.name), `admins carries M: ${JSON.stringify(read.body.data.organism.admins)}`);
    const again = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ target_ghii: M.name }) });
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_ADMIN', `expected 409 ALREADY_ADMIN, got ${again.status} ${again.body.error?.code}`);
});

await test('10. DELETE admins: 404 for a missing organism, 403 for an admin who is not an owner', async () => {
    const missingOrg = await json(`/v1/organisms/${MISSING}/admins/${encodeURIComponent(W.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    // M is an admin now and still may not demote: this door is the OWNER'S, not an admin's.
    const byAdmin = await json(`/v1/organisms/${org}/admins/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(M.token) });
    assert(byAdmin.status === 403 && byAdmin.body.error?.code === 'ACCESS_DENIED', `an admin may not demote: ${byAdmin.status} ${byAdmin.body.error?.code}`);
    assert(/owner/i.test(byAdmin.body.error?.message ?? ''), `message names the owner rule: ${byAdmin.body.error?.message}`);
});

await test('11. The creator cannot be demoted → 400 CANNOT_DEMOTE_CREATOR', async () => {
    const r = await json(`/v1/organisms/${org}/admins/${encodeURIComponent(CR.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(r.status === 400 && r.body.error?.code === 'CANNOT_DEMOTE_CREATOR', `expected 400 CANNOT_DEMOTE_CREATOR, got ${r.status} ${r.body.error?.code}`);
});

await test('12. Demoting somebody with no membership row → 404, and demoting M → 200', async () => {
    const noRow = await json(`/v1/organisms/${org}/admins/${encodeURIComponent(Y.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(noRow.status === 404 && noRow.body.error?.code === 'NOT_FOUND', `no membership: ${noRow.status} ${noRow.body.error?.code}`);
    const ok = await json(`/v1/organisms/${org}/admins/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(ok.status === 200 && ok.body.data.demoted === M.name && ok.body.data.role === 'member', `demote ${ok.status}: ${JSON.stringify(ok.body)}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert(!(read.body.data.organism.admins || []).includes(M.name), `admins no longer carries M: ${JSON.stringify(read.body.data.organism.admins)}`);
    const members = await json(`/v1/organisms/${org}/members`, { headers: auth(CR.token) });
    assert((members.body.data.members || []).some((m: any) => m.ghii === M.name && m.status === 'active'), 'a demoted admin stays an active member');
});

// ─── Phase 4 — removal and unban ───
console.log('Phase 4 — removal and unban');

await test('13. Removing a member of an organism that does not exist → 404', async () => {
    const r = await json(`/v1/organisms/${MISSING}/members/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `expected 404 NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

await test('14. Unban refusals: missing organism, non-admin, and a member who is not blocked', async () => {
    const missingOrg = await json(`/v1/organisms/${MISSING}/members/${encodeURIComponent(M.name)}/unban`, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonAdmin = await json(`/v1/organisms/${org}/members/${encodeURIComponent(M.name)}/unban`, { method: 'POST', headers: auth(Y.token), body: '{}' });
    assert(nonAdmin.status === 403 && nonAdmin.body.error?.code === 'ACCESS_DENIED', `non-admin: ${nonAdmin.status} ${nonAdmin.body.error?.code}`);
    const notBanned = await json(`/v1/organisms/${org}/members/${encodeURIComponent(M.name)}/unban`, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(notBanned.status === 404 && notBanned.body.error?.code === 'NOT_BANNED', `not blocked: ${notBanned.status} ${notBanned.body.error?.code}`);
    const noRow = await json(`/v1/organisms/${org}/members/${encodeURIComponent(Y.name)}/unban`, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noRow.status === 404 && noRow.body.error?.code === 'NOT_BANNED', `no membership row at all: ${noRow.status} ${noRow.body.error?.code}`);
});

// ─── Phase 5 — transfer and the additive owner pair ───
console.log('Phase 5 — transfer and owners');

await test('15. Transfer refusals: no "to", missing organism, non-owner, and handing it to yourself', async () => {
    const url = `/v1/organisms/${org}/transfer`;
    const noTo = await json(url, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noTo.status === 400 && noTo.body.error?.code === 'INVALID_INPUT', `no "to": ${noTo.status} ${noTo.body.error?.code}`);
    const notString = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ to: 42 }) });
    assert(notString.status === 400 && notString.body.error?.code === 'INVALID_INPUT', `non-string "to": ${notString.status} ${notString.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/transfer`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ to: M.name }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonOwner = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ to: M.name }) });
    assert(nonOwner.status === 403 && nonOwner.body.error?.code === 'ACCESS_DENIED', `non-owner: ${nonOwner.status} ${nonOwner.body.error?.code}`);
    const toSelf = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ to: CR.name }) });
    assert(toSelf.status === 400 && toSelf.body.error?.code === 'INVALID_INPUT', `to self: ${toSelf.status} ${toSelf.body.error?.code}`);
    const toStranger = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ to: Y.name }) });
    assert(toStranger.status === 404 && toStranger.body.error?.code === 'NOT_MEMBER', `to a non-member: ${toStranger.status} ${toStranger.body.error?.code}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert(read.body.data.organism.creatorGhii === CR.name, `six refusals moved nothing: creator is ${read.body.data.organism.creatorGhii}`);
});

await test('16. POST owners refusals: no ghii, missing organism, non-owner, not a member', async () => {
    const url = `/v1/organisms/${org}/owners`;
    const noGhii = await json(url, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noGhii.status === 400 && noGhii.body.error?.code === 'INVALID_INPUT', `no ghii: ${noGhii.status} ${noGhii.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/owners`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: M.name }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonOwner = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ ghii: W.name }) });
    assert(nonOwner.status === 403 && nonOwner.body.error?.code === 'ACCESS_DENIED', `non-owner: ${nonOwner.status} ${nonOwner.body.error?.code}`);
    const notMember = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: Y.name }) });
    assert(notMember.status === 404 && notMember.body.error?.code === 'NOT_MEMBER', `not a member: ${notMember.status} ${notMember.body.error?.code}`);
    const noSuchOwner = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: 'nobody-of-that-name' }) });
    assert(noSuchOwner.status === 404 && noSuchOwner.body.error?.code === 'NOT_FOUND', `no such owner: ${noSuchOwner.status} ${noSuchOwner.body.error?.code}`);
});

await test('17. Adding a second owner costs the first nothing', async () => {
    const r = await json(`/v1/organisms/${org}/owners`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: M.name }) });
    assert(r.status === 200, `add owner ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.added === M.name, `added: ${r.body.data.added}`);
    assert((r.body.data.owners || []).includes(CR.name) && (r.body.data.owners || []).includes(M.name),
        `both own it now: ${JSON.stringify(r.body.data.owners)}`);
    const again = await json(`/v1/organisms/${org}/owners`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: M.name }) });
    assert(again.status === 400 && again.body.error?.code === 'ALREADY_OWNER', `expected 400 ALREADY_OWNER, got ${again.status} ${again.body.error?.code}`);
});

await test('18. DELETE owners refusals: missing organism, non-owner, and somebody who owns nothing', async () => {
    const missingOrg = await json(`/v1/organisms/${MISSING}/owners/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonOwner = await json(`/v1/organisms/${org}/owners/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(W.token) });
    assert(nonOwner.status === 403 && nonOwner.body.error?.code === 'ACCESS_DENIED', `non-owner: ${nonOwner.status} ${nonOwner.body.error?.code}`);
    const notAnOwner = await json(`/v1/organisms/${org}/owners/${encodeURIComponent(W.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(notAnOwner.status === 400 && notAnOwner.body.error?.code === 'NOT_OWNER', `not an owner: ${notAnOwner.status} ${notAnOwner.body.error?.code}`);
});

await test('19. An owner steps down and keeps a seat as admin; the LAST owner cannot leave', async () => {
    const step = await json(`/v1/organisms/${org}/owners/${encodeURIComponent(M.name)}`, { method: 'DELETE', headers: auth(M.token) });
    assert(step.status === 200 && step.body.data.removed === M.name, `step down ${step.status}: ${JSON.stringify(step.body.error)}`);
    assert(JSON.stringify(step.body.data.owners) === JSON.stringify([CR.name]), `one owner left: ${JSON.stringify(step.body.data.owners)}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert((read.body.data.organism.admins || []).includes(M.name), `the departing owner stays an admin: ${JSON.stringify(read.body.data.organism.admins)}`);

    const last = await json(`/v1/organisms/${org}/owners/${encodeURIComponent(CR.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(last.status === 400 && last.body.error?.code === 'LAST_OWNER', `expected 400 LAST_OWNER, got ${last.status} ${last.body.error?.code}`);
    const still = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert(still.body.data.organism.creatorGhii === CR.name, 'the refusal left the owner in place');
});

// ─── Phase 6 — invitations ───
console.log('Phase 6 — invitations');

await test('20. The shared creator/admin gate: 404 for a missing organism, 403 for an outsider', async () => {
    // requireInviteAdmin is the one gate behind invite, direct-add, edit and cancel. Driven here
    // through POST /invitations; the sibling routes share the function, not a copy of it.
    const missingOrg = await json(`/v1/organisms/${MISSING}/invitations`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ invitee: X.name }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const outsider = await json(`/v1/organisms/${org}/invitations`, { method: 'POST', headers: auth(Y.token), body: JSON.stringify({ invitee: X.name }) });
    assert(outsider.status === 403 && outsider.body.error?.code === 'ACCESS_DENIED', `outsider: ${outsider.status} ${outsider.body.error?.code}`);
    const plainMember = await json(`/v1/organisms/${org}/invitations`, { method: 'POST', headers: auth(W.token), body: JSON.stringify({ invitee: X.name }) });
    assert(plainMember.status === 403 && plainMember.body.error?.code === 'ACCESS_DENIED', `a plain member is not an admin: ${plainMember.status} ${plainMember.body.error?.code}`);
});

await test('21. Inviting with no invitee → 400, and the check runs BEFORE the admin gate', async () => {
    const noInvitee = await json(`/v1/organisms/${org}/invitations`, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noInvitee.status === 400 && noInvitee.body.error?.code === 'INVALID_INPUT', `no invitee: ${noInvitee.status} ${noInvitee.body.error?.code}`);
    const notString = await json(`/v1/organisms/${org}/invitations`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ invitee: [] }) });
    assert(notString.status === 400 && notString.body.error?.code === 'INVALID_INPUT', `non-string invitee: ${notString.status} ${notString.body.error?.code}`);
});

await test('22. The invitation listing: 404 for a missing organism, 403 for a non-admin, and the row', async () => {
    const inv = await json(`/v1/organisms/${org}/invitations`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ invitee: X.name }) });
    assert(inv.status === 201 && inv.body.data.status === 'invited', `invite ${inv.status}: ${JSON.stringify(inv.body.error)}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/invitations`, { headers: auth(CR.token) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const nonAdmin = await json(`/v1/organisms/${org}/invitations`, { headers: auth(W.token) });
    assert(nonAdmin.status === 403 && nonAdmin.body.error?.code === 'ACCESS_DENIED', `non-admin: ${nonAdmin.status} ${nonAdmin.body.error?.code}`);
    const list = await json(`/v1/organisms/${org}/invitations`, { headers: auth(CR.token) });
    assert(list.status === 200 && (list.body.data.invitations || []).some((m: any) => m.ghii === X.name), `X is listed: ${JSON.stringify(list.body.data.invitations)}`);
});

await test('23. PATCH an invitation: nothing to change → 400, no invitation → 404, role → 200', async () => {
    const url = `/v1/organisms/${org}/invitations/${encodeURIComponent(X.name)}`;
    const nothing = await json(url, { method: 'PATCH', headers: auth(CR.token), body: '{}' });
    assert(nothing.status === 400 && nothing.body.error?.code === 'INVALID_INPUT', `nothing to change: ${nothing.status} ${nothing.body.error?.code}`);
    const outsider = await json(url, { method: 'PATCH', headers: auth(Y.token), body: JSON.stringify({ role: 'admin' }) });
    assert(outsider.status === 403 && outsider.body.error?.code === 'ACCESS_DENIED', `the shared gate refuses an outsider: ${outsider.status} ${outsider.body.error?.code}`);
    const noInvite = await json(`/v1/organisms/${org}/invitations/${encodeURIComponent(Y.name)}`, { method: 'PATCH', headers: auth(CR.token), body: JSON.stringify({ role: 'admin' }) });
    assert(noInvite.status === 404 && noInvite.body.error?.code === 'NO_INVITATION', `no pending invitation: ${noInvite.status} ${noInvite.body.error?.code}`);
    const ok = await json(url, { method: 'PATCH', headers: auth(CR.token), body: JSON.stringify({ role: 'admin' }) });
    assert(ok.status === 200 && ok.body.data.invitation?.role === 'admin', `patch ${ok.status}: ${JSON.stringify(ok.body)}`);
});

await test('24. Accept refusals: a missing organism, and no invitation of your own', async () => {
    const missingOrg = await json(`/v1/organisms/${MISSING}/invitations/accept`, { method: 'POST', headers: auth(X.token), body: '{}' });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const uninvited = await json(`/v1/organisms/${org}/invitations/accept`, { method: 'POST', headers: auth(Y.token), body: '{}' });
    assert(uninvited.status === 404 && uninvited.body.error?.code === 'NO_INVITATION', `uninvited: ${uninvited.status} ${uninvited.body.error?.code}`);
    // An ACTIVE member is not an invitee either: the row exists, its status is wrong.
    const alreadyIn = await json(`/v1/organisms/${org}/invitations/accept`, { method: 'POST', headers: auth(W.token), body: '{}' });
    assert(alreadyIn.status === 404 && alreadyIn.body.error?.code === 'NO_INVITATION', `an active member: ${alreadyIn.status} ${alreadyIn.body.error?.code}`);
});

await test('25. Decline refusals: nobody with a pending invitation may decline one → 404', async () => {
    const uninvited = await json(`/v1/organisms/${org}/invitations/decline`, { method: 'POST', headers: auth(Y.token), body: '{}' });
    assert(uninvited.status === 404 && uninvited.body.error?.code === 'NO_INVITATION', `uninvited: ${uninvited.status} ${uninvited.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/invitations/decline`, { method: 'POST', headers: auth(X.token), body: '{}' });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NO_INVITATION', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
});

await test('26. DELETE an invitation: missing organism, outsider, none pending, then the cancel', async () => {
    const url = `/v1/organisms/${org}/invitations/${encodeURIComponent(X.name)}`;
    const missingOrg = await json(`/v1/organisms/${MISSING}/invitations/${encodeURIComponent(X.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const outsider = await json(url, { method: 'DELETE', headers: auth(Y.token) });
    assert(outsider.status === 403 && outsider.body.error?.code === 'ACCESS_DENIED', `outsider: ${outsider.status} ${outsider.body.error?.code}`);
    const noneP = await json(`/v1/organisms/${org}/invitations/${encodeURIComponent(Y.name)}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(noneP.status === 404 && noneP.body.error?.code === 'NO_INVITATION', `none pending: ${noneP.status} ${noneP.body.error?.code}`);
    const ok = await json(url, { method: 'DELETE', headers: auth(CR.token) });
    assert(ok.status === 200 && ok.body.data.status === 'cancelled', `cancel ${ok.status}: ${JSON.stringify(ok.body.error)}`);
    const list = await json(`/v1/organisms/${org}/invitations`, { headers: auth(CR.token) });
    assert(!(list.body.data.invitations || []).some((m: any) => m.ghii === X.name), 'the cancelled invitation is gone');
});

// ─── Phase 7 — direct member add ───
console.log('Phase 7 — direct member add');

await test('27. POST members refusals: no ghii, a name nobody has, and the outsider gate', async () => {
    const url = `/v1/organisms/${org}/members`;
    const noGhii = await json(url, { method: 'POST', headers: auth(CR.token), body: '{}' });
    assert(noGhii.status === 400 && noGhii.body.error?.code === 'INVALID_INPUT', `no ghii: ${noGhii.status} ${noGhii.body.error?.code}`);
    const notString = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: 7 }) });
    assert(notString.status === 400 && notString.body.error?.code === 'INVALID_INPUT', `non-string ghii: ${notString.status} ${notString.body.error?.code}`);
    const outsider = await json(url, { method: 'POST', headers: auth(Y.token), body: JSON.stringify({ ghii: X.name }) });
    assert(outsider.status === 403 && outsider.body.error?.code === 'ACCESS_DENIED', `outsider: ${outsider.status} ${outsider.body.error?.code}`);
    const noSuchOwner = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: 'nobody-of-that-name' }) });
    assert(noSuchOwner.status === 404 && noSuchOwner.body.error?.code === 'OWNER_NOT_FOUND', `no such owner: ${noSuchOwner.status} ${noSuchOwner.body.error?.code}`);
    const remote = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: `${X.name}@some-other-node` }) });
    assert(remote.status === 400 && remote.body.error?.code === 'INVALID_INPUT', `a remote identity: ${remote.status} ${remote.body.error?.code}`);
});

await test('28. A direct add lands as an ACTIVE member with no accept round trip', async () => {
    const r = await json(`/v1/organisms/${org}/members`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: X.name, role: 'member' }) });
    assert(r.status === 201 && r.body.data.status === 'added', `add ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.member?.status === 'active', `the row is active immediately: ${JSON.stringify(r.body.data.member)}`);
    const members = await json(`/v1/organisms/${org}/members`, { headers: auth(CR.token) });
    assert((members.body.data.members || []).some((m: any) => m.ghii === X.name && m.status === 'active'), 'X is on the roster');
    const again = await json(`/v1/organisms/${org}/members`, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ ghii: X.name }) });
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_MEMBER', `expected 409 ALREADY_MEMBER, got ${again.status} ${again.body.error?.code}`);
});

// ─── Phase 8 — agent attach and detach ───
console.log('Phase 8 — agent attach and detach');

await test('29. Attach refusals: no gaii, an agent you do not own, and a missing organism', async () => {
    const url = `/v1/organisms/${org}/agents`;
    const noGaii = await json(url, { method: 'POST', headers: auth(M.token), body: '{}' });
    assert(noGaii.status === 400 && noGaii.body.error?.code === 'INVALID_INPUT', `no gaii: ${noGaii.status} ${noGaii.body.error?.code}`);
    const notString = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: 12 }) });
    assert(notString.status === 400 && notString.body.error?.code === 'INVALID_INPUT', `non-string gaii: ${notString.status} ${notString.body.error?.code}`);
    const notMine = await json(url, { method: 'POST', headers: auth(CR.token), body: JSON.stringify({ agent_gaii: mAgent }) });
    assert(notMine.status === 403 && notMine.body.error?.code === 'ACCESS_DENIED', `somebody else's agent: ${notMine.status} ${notMine.body.error?.code}`);
    const notAnAgent = await json(url, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: `${M.name}@${NODE_ID}` }) });
    assert(notAnAgent.status === 403 && notAnAgent.body.error?.code === 'ACCESS_DENIED', `a GHII is not an agent: ${notAnAgent.status} ${notAnAgent.body.error?.code}`);
    const missingOrg = await json(`/v1/organisms/${MISSING}/agents`, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: mAgent }) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
});

await test('30. A non-member cannot attach even their OWN agent → 403 NOT_MEMBER', async () => {
    const r = await json(`/v1/organisms/${org}/agents`, {
        method: 'POST', headers: auth(Y.token), body: JSON.stringify({ agent_gaii: `helper#${Y.name}@${NODE_ID}` }),
    });
    assert(r.status === 403 && r.body.error?.code === 'NOT_MEMBER', `expected 403 NOT_MEMBER, got ${r.status} ${r.body.error?.code}`);
});

await test('31. A member attaches their agent, and the same agent twice → 409 ALREADY_ATTACHED', async () => {
    const r = await json(`/v1/organisms/${org}/agents`, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: mAgent }) });
    assert(r.status === 201 && r.body.data.attached === mAgent, `attach ${r.status}: ${JSON.stringify(r.body.error)}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert((read.body.data.organism.agentGaiis || []).includes(mAgent), `agentGaiis carries it: ${JSON.stringify(read.body.data.organism.agentGaiis)}`);
    const again = await json(`/v1/organisms/${org}/agents`, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: mAgent }) });
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_ATTACHED', `expected 409 ALREADY_ATTACHED, got ${again.status} ${again.body.error?.code}`);
});

await test('32. Detach refusals: missing organism, neither the agent\'s owner nor an admin, not attached', async () => {
    const enc = encodeURIComponent(mAgent);
    const missingOrg = await json(`/v1/organisms/${MISSING}/agents/${enc}`, { method: 'DELETE', headers: auth(M.token) });
    assert(missingOrg.status === 404 && missingOrg.body.error?.code === 'NOT_FOUND', `missing organism: ${missingOrg.status} ${missingOrg.body.error?.code}`);
    const stranger = await json(`/v1/organisms/${org}/agents/${enc}`, { method: 'DELETE', headers: auth(Y.token) });
    assert(stranger.status === 403 && stranger.body.error?.code === 'ACCESS_DENIED', `a stranger: ${stranger.status} ${stranger.body.error?.code}`);
    const plainMember = await json(`/v1/organisms/${org}/agents/${enc}`, { method: 'DELETE', headers: auth(W.token) });
    assert(plainMember.status === 403 && plainMember.body.error?.code === 'ACCESS_DENIED', `a plain member is neither: ${plainMember.status} ${plainMember.body.error?.code}`);
    const notAttached = await json(`/v1/organisms/${org}/agents/${encodeURIComponent(`ghost#${M.name}@${NODE_ID}`)}`, { method: 'DELETE', headers: auth(M.token) });
    assert(notAttached.status === 404 && notAttached.body.error?.code === 'NOT_FOUND', `not attached: ${notAttached.status} ${notAttached.body.error?.code}`);
    const still = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert((still.body.data.organism.agentGaiis || []).includes(mAgent), 'four refusals detached nothing');
});

await test('33. The agent\'s owner detaches it, and an organism admin may detach it too', async () => {
    const enc = encodeURIComponent(mAgent);
    const byOwner = await json(`/v1/organisms/${org}/agents/${enc}`, { method: 'DELETE', headers: auth(M.token) });
    assert(byOwner.status === 200 && byOwner.body.data.detached === mAgent, `owner detach ${byOwner.status}: ${JSON.stringify(byOwner.body.error)}`);
    const read = await json(`/v1/organisms/${org}`, { headers: auth(CR.token) });
    assert(!(read.body.data.organism.agentGaiis || []).includes(mAgent), 'agentGaiis no longer carries it');

    const reattach = await json(`/v1/organisms/${org}/agents`, { method: 'POST', headers: auth(M.token), body: JSON.stringify({ agent_gaii: mAgent }) });
    assert(reattach.status === 201, `re-attach ${reattach.status}: ${JSON.stringify(reattach.body.error)}`);
    const byAdmin = await json(`/v1/organisms/${org}/agents/${enc}`, { method: 'DELETE', headers: auth(CR.token) });
    assert(byAdmin.status === 200 && byAdmin.body.data.detached === mAgent, `admin detach ${byAdmin.status}: ${JSON.stringify(byAdmin.body.error)}`);
});

// ─── Phase 9 — no credential ───
console.log('Phase 9 — 401');

await test('34. Every membership door refuses an unauthenticated caller with 401', async () => {
    const who = encodeURIComponent(M.name);
    const calls: Array<[string, RequestInit]> = [
        [`/v1/organisms/${org}/join-requests`, {}],
        [`/v1/organisms/${org}/join-requests/${xRequestId}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }],
        [`/v1/organisms/${org}/admins`, { method: 'POST', body: JSON.stringify({ target_ghii: M.name }) }],
        [`/v1/organisms/${org}/admins/${who}`, { method: 'DELETE' }],
        [`/v1/organisms/${org}/members/${who}`, { method: 'DELETE' }],
        [`/v1/organisms/${org}/members/${who}/unban`, { method: 'POST', body: '{}' }],
        [`/v1/organisms/${org}/transfer`, { method: 'POST', body: JSON.stringify({ to: M.name }) }],
        [`/v1/organisms/${org}/owners`, { method: 'POST', body: JSON.stringify({ ghii: M.name }) }],
        [`/v1/organisms/${org}/owners/${who}`, { method: 'DELETE' }],
        [`/v1/organisms/${org}/invitations`, { method: 'POST', body: JSON.stringify({ invitee: X.name }) }],
        [`/v1/organisms/${org}/invitations`, {}],
        [`/v1/organisms/${org}/invitations/${who}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }],
        [`/v1/organisms/${org}/invitations/${who}`, { method: 'DELETE' }],
        ['/v1/organisms/invitations/mine', {}],
        [`/v1/organisms/${org}/invitations/accept`, { method: 'POST', body: '{}' }],
        [`/v1/organisms/${org}/invitations/decline`, { method: 'POST', body: '{}' }],
        [`/v1/organisms/${org}/members`, { method: 'POST', body: JSON.stringify({ ghii: X.name }) }],
        [`/v1/organisms/${org}/agents`, { method: 'POST', body: JSON.stringify({ agent_gaii: mAgent }) }],
        [`/v1/organisms/${org}/agents/${encodeURIComponent(mAgent)}`, { method: 'DELETE' }],
    ];
    for (const [path, opts] of calls) {
        const r = await json(path, opts);
        assert(r.status === 401, `${opts.method ?? 'GET'} ${path} must be 401, got ${r.status}`);
    }
});

await test('35. The members listing is the one door that answers an unauthenticated caller', async () => {
    const r = await json(`/v1/organisms/${org}/members`);
    assert(r.status === 200, `an anonymous caller reads the listing, got ${r.status}`);
    assert(typeof r.body.data.total === 'number', `it carries a total: ${JSON.stringify(r.body.data)}`);
    assert(r.body.data.agents_included !== true, 'and never the agent rosters');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

/**
 * @file e2e-organism-member-visibility.ts
 * @description E2E for organism member-ROSTER privacy (memberVisibility). Proves the world-readable
 *   roster leak is closed: with the default tier the anonymous internet gets NO roster (only the
 *   accountability rows), a signed-in outsider DOES, and the tighter tiers ('members'/'admins')
 *   shrink it further — across GET /:id (members[]/agentGaiis + your_membership + members_hidden),
 *   GET /:id/members (accountability rows + true total), and GET /organisms list. Creator always
 *   sees the full roster; member_count never lies. Attribution is out of scope by design.
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial (privacy fix: rosters were world-readable via detail/list/members).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-member-visibility

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function mkOwner(label: string) {
    const name = `mvis${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'MVis1234!' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'MVis1234!' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tk.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Member-Visibility E2E ===\n');
let creator = '', creatorTok = '', memberName = '', memberTok = '', outsiderName = '', outsiderTok = '', orgId = '';

await test('Setup: creator + a joined member + an unrelated outsider on an open org', async () => {
    const c = await mkOwner('c'); creator = c.name; creatorTok = c.token;
    const m = await mkOwner('m'); memberName = m.name; memberTok = m.token;
    const o = await mkOwner('o'); outsiderName = o.name; outsiderTok = o.token;
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ name: 'Vis Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = org.body.data.organism.id;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: JSON.stringify({}) });
    assert(j.status === 200 || j.status === 201, `join ${j.status}`);
});

await test('1. DEFAULT tier (authenticated): ANON gets NO roster, but member_count + accountability survive', async () => {
    // detail
    const d = await json(`/v1/organisms/${orgId}`);
    assert(d.status === 200, `detail ${d.status}`);
    assert(d.body.data.members_hidden === true, `members_hidden: ${JSON.stringify(d.body.data.members_hidden)}`);
    assert(Array.isArray(d.body.data.organism.members) && d.body.data.organism.members.length === 0, `anon members[]: ${JSON.stringify(d.body.data.organism.members)}`);
    assert(d.body.data.organism.agentGaiis.length === 0, 'anon agentGaiis[] redacted');
    assert(d.body.data.member_count === 2, `member_count stays: ${d.body.data.member_count}`);
    assert(d.body.data.organism.creatorGhii === creator, 'creator still shown (accountability)');
    // members listing: only accountability rows, but true total
    const m = await json(`/v1/organisms/${orgId}/members`);
    assert(m.body.data.members_hidden === true && m.body.data.total === 2, `anon members total: ${JSON.stringify(m.body.data)}`);
    assert(m.body.data.members.every((x: any) => x.role === 'creator' || x.role === 'admin'), `anon sees only creator/admin: ${JSON.stringify(m.body.data.members.map((x: any) => x.role))}`);
    assert(!m.body.data.members.some((x: any) => x.ghii === memberName), 'anon does NOT see the plain member');
});

await test('2. DEFAULT tier: a signed-in OUTSIDER DOES see the full roster', async () => {
    const d = await json(`/v1/organisms/${orgId}`, { headers: auth(outsiderTok) });
    assert(d.body.data.members_hidden === false, `authed hidden: ${d.body.data.members_hidden}`);
    assert(d.body.data.organism.members.includes(memberName), `authed sees member: ${JSON.stringify(d.body.data.organism.members)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(outsiderTok) });
    assert(m.body.data.members.some((x: any) => x.ghii === memberName), 'authed members listing shows the member');
});

await test('3. Tighten to "members": an outsider is now blind; the member still sees the roster', async () => {
    const up = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ member_visibility: 'members' }) });
    assert(up.status === 200, `update ${up.status}: ${JSON.stringify(up.body)}`);
    const outsider = await json(`/v1/organisms/${orgId}/members`, { headers: auth(outsiderTok) });
    assert(outsider.body.data.members_hidden === true && !outsider.body.data.members.some((x: any) => x.ghii === memberName), `outsider blind: ${JSON.stringify(outsider.body.data)}`);
    const member = await json(`/v1/organisms/${orgId}/members`, { headers: auth(memberTok) });
    assert(!member.body.data.members_hidden && member.body.data.members.some((x: any) => x.ghii === memberName), `member sees roster: ${JSON.stringify(member.body.data)}`);
    // the member's own detail answers your_membership even under redaction
    const md = await json(`/v1/organisms/${orgId}`, { headers: auth(memberTok) });
    assert(md.body.data.your_membership?.status === 'active', `your_membership: ${JSON.stringify(md.body.data.your_membership)}`);

    // THE OTHER DOOR THAT SERVES THE SAME ROSTER. GET /v1/organisms/:id is a separate handler with
    // its own canSeeMembers call, and after the default-tier test at the top nothing looks at its
    // roster again: test 3 and test 4 call detail as the MEMBER and read only your_membership, and
    // the outsider never calls detail after the tier is tightened at all. Replace the detail
    // handler's `canSeeMembers(...)` with `!!detailCaller.ownerName` — anon still hidden, a signed-in
    // outsider still sees the roster under the default tier — and 9 of 9 pass while any signed-in
    // stranger reads the complete member list and agentGaiis of a members-tier organism.
    const od = await json(`/v1/organisms/${orgId}`, { headers: auth(outsiderTok) });
    assert(od.status === 200, `outsider detail ${od.status}`);
    assert(od.body.data.members_hidden === true,
        `the outsider's DETAIL still exposes the roster: members_hidden=${od.body.data.members_hidden}`);
    assert(!(od.body.data.organism.members ?? []).includes(memberName),
        `the member leaked through detail: ${JSON.stringify(od.body.data.organism.members)}`);
    assert((od.body.data.organism.agentGaiis ?? []).length === 0,
        `and their agent GAIIs with them: ${JSON.stringify(od.body.data.organism.agentGaiis)}`);
    // The count survives — hiding who is in it is not the same as hiding that it has members.
    assert(od.body.data.member_count >= 2, `member_count stays: ${od.body.data.member_count}`);
});

await test('4. Tighten to "admins": a plain member sees only self+creator (no OTHER member leaks); creator sees all', async () => {
    // Add a SECOND plain member so "member cannot see other members" is testable (not degenerate).
    const m2 = await mkOwner('m2');
    await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(m2.token), body: JSON.stringify({}) });
    await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ member_visibility: 'admins' }) });
    const member = await json(`/v1/organisms/${orgId}/members`, { headers: auth(memberTok) });
    assert(member.body.data.members_hidden === true, `hidden under admins: ${JSON.stringify(member.body.data.members_hidden)}`);
    // member1 must NOT see member2 (the real blindness guarantee); may see self + creator (accountability).
    assert(!member.body.data.members.some((x: any) => x.ghii === m2.name), `member1 does NOT see member2: ${JSON.stringify(member.body.data.members.map((x: any) => x.ghii))}`);
    assert(member.body.data.members.some((x: any) => x.ghii === creator), 'member1 still sees the creator (accountability)');
    // the member still confirms their OWN membership via your_membership even under redaction
    const md = await json(`/v1/organisms/${orgId}`, { headers: auth(memberTok) });
    assert(md.body.data.your_membership?.status === 'active', 'member still knows they belong');
    const creatorView = await json(`/v1/organisms/${orgId}/members`, { headers: auth(creatorTok) });
    assert(!creatorView.body.data.members_hidden && creatorView.body.data.members.some((x: any) => x.ghii === m2.name), `creator sees all incl. m2: ${JSON.stringify(creatorView.body.data.members.map((x: any) => x.ghii))}`);
    await json(`/v1/owners/${m2.name}`, { method: 'DELETE', headers: auth(m2.token) });
});

await test('5. Opt back to "public": the roster is world-readable again (deliberate choice)', async () => {
    await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ member_visibility: 'public' }) });
    const anon = await json(`/v1/organisms/${orgId}/members`);
    assert(anon.body.data.members?.some((x: any) => x.ghii === memberName) && !anon.body.data.members_hidden, `public anon roster: ${JSON.stringify(anon.body.data)}`);
});

await test('6. list GET /organisms redacts per-item for anon but keeps member_count', async () => {
    // set back to default so the list redacts for anon
    await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ member_visibility: 'authenticated' }) });
    const anon = await json('/v1/organisms?per_page=100');
    const row = (anon.body.data.organisms || []).find((o: any) => o.id === orgId);
    assert(row, 'org present in anon list');
    // Roster redacted for anon, but member_count (a count, not identities) still present + truthy.
    assert(row.members.length === 0 && row.members_hidden === true && typeof row.member_count === 'number' && row.member_count >= 2,
      `anon list row: ${JSON.stringify({ members: row.members, hidden: row.members_hidden, count: row.member_count })}`);
});

await test('7. failure: an invalid member_visibility value is rejected (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ member_visibility: 'everyone' }) });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('Cleanup', async () => {
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(creatorTok) });
    await json(`/v1/owners/${memberName}`, { method: 'DELETE', headers: auth(memberTok) });
    await json(`/v1/owners/${outsiderName}`, { method: 'DELETE', headers: auth(outsiderTok) });
    await json(`/v1/owners/${creator}`, { method: 'DELETE', headers: auth(creatorTok) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

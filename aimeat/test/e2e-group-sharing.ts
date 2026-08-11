/**
 * @file test/e2e-group-sharing.ts
 * @description Proof that a sharing group actually shares something.
 *
 *   WHY THIS FILE EXISTS. test/e2e-sharing-groups.ts has 17 assertions and every one of them is
 *   about MANAGING a group: create, list, add a member, change permissions, remove, delete. Not one
 *   reads or writes a memory record. The words "group_id" and "visibility" do not appear in it. So
 *   the feature had a fully tested management API and no test that it affected access at all, and
 *   the half nobody asked about was broken on both backends while the UI offered it: Profile >
 *   Memory lists every group by name in its visibility selector, so a person could pick "Group:
 *   Colleagues", get a 200 back, and share nothing with anyone.
 *
 *   Measured on 2026-08-11 before the fix, on postgres-kysely and sqlite:
 *     - sqlite never stored groupId at all (INSERT and UPDATE both omitted the column), so every
 *       group-visible record on a sqlite node was unreadable by every member, permanently
 *     - neither backend wrote groupId on an UPDATE, so a record created private could never become
 *       group-visible, and a record MOVED between groups kept the old audience and never gained
 *       the new one — the write answering 200 both times
 *     - the cross-owner read door passed the raw JWT `sub`, which for a human owner session is the
 *       bare account name rather than the GHII, so no membership could ever match it (violating
 *       decision d-resolve-identity; the storage-file twin GET /v1/pub had already fixed this)
 *
 *   Each test below names the principal type separately, because the agent path worked on postgres
 *   while the human path did not, and a suite that tested only one of them would have looked green.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-group-sharing
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial. Written before the fix, and failing, per the test-first rule.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
// Read from the node's own registration response rather than guessing: the owner signature is over
// `owner + nodeId + timestamp`, so a wrong id fails as an opaque 'Invalid signature'.
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(subject: string, priv: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    // Agents sign `gaii + timestamp`; owners sign `owner + nodeId + timestamp`. Different messages.
    const signature = await signMsg(priv, isAgent ? subject + timestamp : subject + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(isAgent ? { gaii: subject, timestamp, signature } : { owner: subject, timestamp, signature }),
    });
    assert(body.ok === true, `token for ${subject}: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

interface Party {
    /** Bare account name. */
    name: string;
    /** `name@node` — what a group member identifier looks like for a human. */
    ghii: string;
    /** Human owner session. Its JWT `sub` is the BARE name, which is the whole point of defect 4. */
    ownerToken: string;
    gaii: string;
    agentToken: string;
}

async function makeParty(name: string): Promise<Party> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
    const ownerToken = await getToken(name, reg.body.data.private_key, false);

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        // Explicit scopes rather than the '*' wildcard, so the read being allowed is the sharing
        // decision and not a scope that satisfies every gate.
        body: JSON.stringify({ name: `${name}bot`, owner: name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
    });
    assert(ag.status === 201, `register agent for ${name}: ${ag.status} ${JSON.stringify(ag.body)}`);
    const gaii = ag.body.data.agent.gaii as string;
    return { name, ghii: `${name}@${NODE_ID}`, ownerToken, gaii, agentToken: await getToken(gaii, ag.body.data.private_key, true) };
}

/** The cross-owner read door. `token` null = anonymous (no Authorization header at all). */
async function readForeign(token: string | null, ownerGaii: string, key: string) {
    return json(`/v1/memory/${encodeURIComponent(ownerGaii)}/${encodeURIComponent(key)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
}
/** True when the read succeeded AND actually carried the value (a 200 with a null value is a miss). */
function gotValue(r: { status: number; body: { data?: { value?: unknown } } }): boolean {
    return r.status === 200 && r.body?.data?.value !== undefined && r.body?.data?.value !== null;
}

const stamp = Date.now() % 1000000;
let A: Party, B: Party, C: Party;
let groupId = '', otherGroupId = '';

async function createGroup(owner: Party, name: string, members: { identifier: string; identifier_type: 'gaii' | 'ghii' }[]) {
    const r = await json('/v1/groups', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.ownerToken}` },
        body: JSON.stringify({
            name,
            members: members.map(m => ({ ...m, permissions: { read: true, write: false } })),
            default_permissions: { read: true, write: false },
        }),
    });
    assert(r.status === 201, `create group ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.group.id as string;
}

/** A writes `key` under their own GHII, visible to `gid`. Returns the write response. */
async function writeShared(key: string, value: unknown, gid: string) {
    return json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
        body: JSON.stringify({ key, value, visibility: 'group', group_id: gid }),
    });
}

async function main() {
    console.log('\n=== Sharing groups actually share (cross-owner read) E2E ===\n');
    console.log('Setup');

    await test('register three owners, each with an agent', async () => {
        A = await makeParty(`grpa${stamp}`);
        B = await makeParty(`grpb${stamp}`);
        C = await makeParty(`grpc${stamp}`);
        assert(!!A.gaii && !!B.gaii && !!C.gaii, 'every party has an agent');
    });

    await test('A creates a group with B as a member, added by GHII', async () => {
        groupId = await createGroup(A, 'e2e share group', [{ identifier: B.ghii, identifier_type: 'ghii' }]);
        otherGroupId = await createGroup(A, 'e2e other group', []);
        assert(!!groupId && !!otherGroupId && groupId !== otherGroupId, 'two distinct groups exist');
    });

    // ── 1. A record born group-visible ───────────────────────────────────────
    console.log('\nPhase 1: a record created group-visible');
    const BORN = `grpshare.born.${stamp}`;

    await test('A writes the record with visibility group', async () => {
        const w = await writeShared(BORN, { secret: 'born-v1' }, groupId);
        assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data.owner_gaii === A.ghii, `lands under A's GHII, got ${w.body.data.owner_gaii}`);
    });

    await test("the member's AGENT reads it", async () => {
        const r = await readForeign(B.agentToken, A.ghii, BORN);
        assert(gotValue(r), `expected 200 with a value, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    });

    await test('the member READS IT AS A HUMAN owner session (defect 4)', async () => {
        // An owner JWT's `sub` is the bare account name. The read door must resolve it to the GHII
        // before matching membership, exactly as GET /v1/pub does for storage files.
        const r = await readForeign(B.ownerToken, A.ghii, BORN);
        assert(gotValue(r), `expected 200 with a value, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    });

    await test('a non-member is refused, as both principal types', async () => {
        const asAgent = await readForeign(C.agentToken, A.ghii, BORN);
        const asHuman = await readForeign(C.ownerToken, A.ghii, BORN);
        assert(asAgent.status === 403, `non-member agent: expected 403, got ${asAgent.status}`);
        assert(asHuman.status === 403, `non-member human: expected 403, got ${asHuman.status}`);
        assert(!gotValue(asAgent) && !gotValue(asHuman), 'and neither carries the value');
    });

    await test('an anonymous caller is refused', async () => {
        const r = await readForeign(null, A.ghii, BORN);
        assert(r.status !== 200 || !gotValue(r), `anonymous must not read a group record, got ${r.status}`);
    });

    // ── 2. A record shared AFTER it was created ──────────────────────────────
    console.log('\nPhase 2: a record shared after creation (defect 2)');
    const LATER = `grpshare.later.${stamp}`;

    await test('A writes it private first, then re-writes it to the group (POST)', async () => {
        const first = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key: LATER, value: { secret: 'later-v1' }, visibility: 'private' }),
        });
        assert(first.status === 201, `first write: ${first.status}`);
        const second = await writeShared(LATER, { secret: 'later-v2' }, groupId);
        assert(second.status === 200, `re-write: ${second.status} ${JSON.stringify(second.body)}`);
        assert(second.body.data.visibility === 'group', `re-write reports group, got ${second.body.data.visibility}`);
    });

    await test('the member can now read it (agent)', async () => {
        const r = await readForeign(B.agentToken, A.ghii, LATER);
        assert(gotValue(r), `expected 200 with a value, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('the member can now read it (human owner session)', async () => {
        const r = await readForeign(B.ownerToken, A.ghii, LATER);
        assert(gotValue(r), `expected 200 with a value, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    const LATER_PUT = `grpshare.laterput.${stamp}`;
    await test('the same via PUT with a version, not just POST', async () => {
        const first = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key: LATER_PUT, value: { secret: 'put-v1' }, visibility: 'private' }),
        });
        assert(first.status === 201, `first write: ${first.status}`);
        const cur = await json(`/v1/memory/${encodeURIComponent(LATER_PUT)}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        const put = await json(`/v1/memory/${encodeURIComponent(LATER_PUT)}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ value: { secret: 'put-v2' }, visibility: 'group', group_id: groupId, version: cur.body.data.version }),
        });
        assert(put.status === 200, `PUT: ${put.status} ${JSON.stringify(put.body)}`);
        const r = await readForeign(B.agentToken, A.ghii, LATER_PUT);
        assert(gotValue(r), `member reads after PUT: got ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    // ── 3. Moving a record between groups ────────────────────────────────────
    console.log('\nPhase 3: moving a record to a different group (defect 3)');
    const MOVED = `grpshare.moved.${stamp}`;

    await test('A writes it to group 1, then moves it to group 2 (B is in group 1 only)', async () => {
        const w = await writeShared(MOVED, { secret: 'moved-v1' }, groupId);
        assert(w.status === 201, `write: ${w.status}`);
        const before = await readForeign(B.agentToken, A.ghii, MOVED);
        assert(gotValue(before), `B reads while in the owning group: ${before.status}`);
        const move = await writeShared(MOVED, { secret: 'moved-v2' }, otherGroupId);
        assert(move.status === 200, `move: ${move.status}`);
    });

    await test('THE OLD AUDIENCE LOSES ACCESS — the move actually took effect', async () => {
        // The defect: the update path never wrote groupId, so the record stayed bound to group 1.
        // The owner saw a 200 and a group name and believed the audience had changed.
        const r = await readForeign(B.agentToken, A.ghii, MOVED);
        assert(r.status === 403, `expected 403 after the move, got ${r.status}`);
        assert(!gotValue(r), 'and the value is not served');
    });

    await test('the new audience gains access', async () => {
        const add = await json(`/v1/groups/${otherGroupId}/members`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ identifier: C.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }),
        });
        assert(add.status === 200 || add.status === 201, `add C to group 2: ${add.status}`);
        const r = await readForeign(C.agentToken, A.ghii, MOVED);
        assert(gotValue(r), `C reads the moved record: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    // ── 4. Removing a member ends access ─────────────────────────────────────
    console.log('\nPhase 4: removing a member ends access');

    await test('B still reads the born-shared record before removal', async () => {
        const r = await readForeign(B.agentToken, A.ghii, BORN);
        assert(gotValue(r), `precondition: B reads BORN, got ${r.status}`);
    });

    await test('after removal B is refused, as both principal types', async () => {
        const del = await json(`/v1/groups/${groupId}/members/${encodeURIComponent(B.ghii)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` },
        });
        assert(del.status === 200, `remove member: ${del.status} ${JSON.stringify(del.body)}`);
        const asAgent = await readForeign(B.agentToken, A.ghii, BORN);
        const asHuman = await readForeign(B.ownerToken, A.ghii, BORN);
        assert(asAgent.status === 403, `removed agent: expected 403, got ${asAgent.status}`);
        assert(asHuman.status === 403, `removed human: expected 403, got ${asHuman.status}`);
    });

    // ── 5. A share is a READ share ───────────────────────────────────────────
    console.log('\nPhase 5: a share never grants a cross-owner write');

    await test("a member writing the shared key lands in their OWN namespace, not A's", async () => {
        // Memory is keyed by its writer. This is what makes cross-owner write structurally
        // impossible, and it must stay true whatever the group's member permissions say.
        const gid = await createGroup(A, 'e2e write group', [{ identifier: B.ghii, identifier_type: 'ghii' }]);
        const key = `grpshare.write.${stamp}`;
        const mine = await writeShared(key, { by: 'A' }, gid);
        assert(mine.status === 201, `A writes: ${mine.status}`);
        const theirs = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${B.ownerToken}` },
            body: JSON.stringify({ key, value: { by: 'B' }, visibility: 'private' }),
        });
        assert(theirs.status === 201, `B writes the same key name: ${theirs.status}`);
        assert(theirs.body.data.owner_gaii === B.ghii, `B's write lands under B, got ${theirs.body.data.owner_gaii}`);
        const aCopy = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(aCopy.body?.data?.value?.by === 'A', `A's record is untouched, got ${JSON.stringify(aCopy.body?.data?.value)}`);
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log('\nCleanup');
    for (const p of [A, B, C]) {
        await test(`cascade-delete ${p.name}`, async () => {
            const d = await json(`/v1/owners/${p.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${p.ownerToken}` } });
            assert(d.status === 200 || d.status === 204, `delete ${p.name}: ${d.status}`);
        });
    }

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });

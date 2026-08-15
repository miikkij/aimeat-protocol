/**
 * @file test/e2e-key-space-shares.ts
 * @description Sharing a KEY SPACE with a group, rather than marking one record at a time.
 *
 *   WHY THIS EXISTS. Until now a share was a field on the record: `visibility:'group'` plus one
 *   `groupId`. That shape cannot express the thing every real use has: "everything under
 *   deliveries.<contract>.* belongs to this subscriber". It forced one group per record, made the
 *   writer responsible for remembering the group on every write, and left no way to hand someone a
 *   space that does not exist yet. A subscription writes tomorrow's record tomorrow, and the reader
 *   has to be able to read it without anyone touching the share again.
 *
 *   So a share is its own fact now: (owner, group, key pattern). The record stays `private`. These
 *   tests are the contract:
 *     - a pattern shared once covers keys written LATER, with no second act
 *     - a record can be in several shares at once, which one groupId could never do
 *     - the pattern is a boundary: a sibling space is refused
 *     - revoking the share, or the membership, ends it immediately
 *     - both directions are discoverable: what I share, and what is shared with me
 *     - a principal may not share a key space it could not write itself
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-key-space-shares
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, written before the table existed.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
async function signMsg(priv: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'))).toString('base64');
}
async function getToken(subject: string, priv: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, isAgent ? subject + timestamp : subject + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(isAgent ? { gaii: subject, timestamp, signature } : { owner: subject, timestamp, signature }),
    });
    assert(body.ok === true, `token for ${subject}: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

interface Party { name: string; ghii: string; ownerToken: string; gaii: string; agentToken: string }

async function makeParty(name: string, agentScopes: string[]): Promise<Party> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
    const ownerToken = await getToken(name, reg.body.data.private_key, false);
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `${name}bot`, owner: name, capabilities: ['memory'], scopes: agentScopes }),
    });
    assert(ag.status === 201, `agent for ${name}: ${ag.status} ${JSON.stringify(ag.body)}`);
    const gaii = ag.body.data.agent.gaii as string;
    return { name, ghii: `${name}@${NODE_ID}`, ownerToken, gaii, agentToken: await getToken(gaii, ag.body.data.private_key, true) };
}

async function readForeign(token: string | null, ownerGaii: string, key: string) {
    return json(`/v1/memory/${encodeURIComponent(ownerGaii)}/${encodeURIComponent(key)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
}
function gotValue(r: { status: number; body: { data?: { value?: unknown } } }): boolean {
    return r.status === 200 && r.body?.data?.value !== undefined && r.body?.data?.value !== null;
}

const stamp = Date.now() % 1000000;
let A: Party, B: Party, C: Party;
let g1 = '', g2 = '', share1 = '';

/** A writes one of their own records. PRIVATE — the share is what makes it readable, not the tier. */
async function writePrivate(key: string, value: unknown) {
    return json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
        body: JSON.stringify({ key, value, visibility: 'private' }),
    });
}
async function createGroup(owner: Party, name: string, memberGhiis: string[]) {
    const r = await json('/v1/groups', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.ownerToken}` },
        body: JSON.stringify({
            name,
            members: memberGhiis.map(identifier => ({ identifier, identifier_type: 'ghii', permissions: { read: true, write: false } })),
        }),
    });
    assert(r.status === 201, `create group ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.group.id as string;
}

const SPACE = `deliveries.sub${stamp}`;
const OTHER_SPACE = `deliveries.other${stamp}`;

async function main() {
    console.log('\n=== Key-space shares (a pattern, not a record) E2E ===\n');
    console.log('Setup');

    await test('three owners; A\'s agent carries share:manage, B\'s does not', async () => {
        A = await makeParty(`ksa${stamp}`, ['memory:read', 'memory:write', 'share:manage']);
        B = await makeParty(`ksb${stamp}`, ['memory:read', 'memory:write']);
        C = await makeParty(`ksc${stamp}`, ['memory:read', 'memory:write']);
        g1 = await createGroup(A, 'subscribers', [B.ghii]);
        g2 = await createGroup(A, 'second audience', [C.ghii]);
    });

    // ── 1. A pattern, shared once ────────────────────────────────────────────
    console.log('\nPhase 1: one share covers a whole key space');

    await test('A shares the key space with group 1', async () => {
        // `**` is the whole subtree, `*` is one segment — the same meaning these have in consent
        // patterns, deliberately, so one wildcard does not mean two things on one node.
        const r = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${SPACE}.**`, note: 'morning briefing subscription' }),
        });
        assert(r.status === 201, `create share: ${r.status} ${JSON.stringify(r.body)}`);
        share1 = r.body.data.share.id;
        assert(!!share1, 'the share has an id');
        assert(r.body.data.share.key_pattern === `${SPACE}.**`, `pattern echoed: ${r.body.data.share.key_pattern}`);
    });

    await test('a PRIVATE record inside the space is readable by the member', async () => {
        const w = await writePrivate(`${SPACE}.day1`, { text: 'day one' });
        assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data.visibility === 'private', `stays private, got ${w.body.data.visibility}`);
        const r = await readForeign(B.ownerToken, A.ghii, `${SPACE}.day1`);
        assert(gotValue(r), `member reads: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test("the member's AGENT reads it too", async () => {
        const r = await readForeign(B.agentToken, A.ghii, `${SPACE}.day1`);
        assert(gotValue(r), `member agent reads: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('A KEY WRITTEN LATER is covered with no second act — the point of a pattern', async () => {
        const w = await writePrivate(`${SPACE}.day2`, { text: 'day two' });
        assert(w.status === 201, `write day2: ${w.status}`);
        const r = await readForeign(B.ownerToken, A.ghii, `${SPACE}.day2`);
        assert(gotValue(r), `member reads a key that did not exist when the share was made: ${r.status}`);
    });

    await test('a nested key under the space is covered by `**`', async () => {
        await writePrivate(`${SPACE}.week1.mon`, { text: 'nested' });
        const r = await readForeign(B.ownerToken, A.ghii, `${SPACE}.week1.mon`);
        assert(gotValue(r), `nested key: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('`*` is ONE segment, not the subtree — the narrower wildcard stays narrow', async () => {
        const narrowGroup = await createGroup(A, 'narrow', [C.ghii]);
        const NARROW = `narrow${stamp}`;
        const s = await json(`/v1/groups/${narrowGroup}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${NARROW}.*` }),
        });
        assert(s.status === 201, `narrow share: ${s.status} ${JSON.stringify(s.body)}`);
        await writePrivate(`${NARROW}.one`, { t: 1 });
        await writePrivate(`${NARROW}.one.deeper`, { t: 2 });
        const flat = await readForeign(C.ownerToken, A.ghii, `${NARROW}.one`);
        const deep = await readForeign(C.ownerToken, A.ghii, `${NARROW}.one.deeper`);
        assert(gotValue(flat), `one segment is covered: ${flat.status}`);
        assert(deep.status === 403, `a deeper key is NOT covered by '*', got ${deep.status}`);
    });

    await test('THE PATTERN IS A BOUNDARY: a sibling space is refused', async () => {
        await writePrivate(`${OTHER_SPACE}.day1`, { text: 'not yours' });
        const r = await readForeign(B.ownerToken, A.ghii, `${OTHER_SPACE}.day1`);
        assert(r.status === 403, `sibling space must be refused, got ${r.status}`);
        assert(!gotValue(r), 'and carries no value');
    });

    await test('a non-member reads nothing in the shared space', async () => {
        const asHuman = await readForeign(C.ownerToken, A.ghii, `${SPACE}.day1`);
        const asAgent = await readForeign(C.agentToken, A.ghii, `${SPACE}.day1`);
        const anon = await readForeign(null, A.ghii, `${SPACE}.day1`);
        assert(asHuman.status === 403 && asAgent.status === 403, `non-member: ${asHuman.status}/${asAgent.status}`);
        assert(!gotValue(anon), 'anonymous reads nothing');
    });

    // ── 2. Several shares over the same record ───────────────────────────────
    console.log('\nPhase 2: one record, two audiences (impossible with a single groupId)');

    await test('A shares the SAME space with a second group', async () => {
        const r = await json(`/v1/groups/${g2}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${SPACE}.**` }),
        });
        assert(r.status === 201, `second share: ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('both audiences read the same record', async () => {
        const b = await readForeign(B.ownerToken, A.ghii, `${SPACE}.day1`);
        const c = await readForeign(C.ownerToken, A.ghii, `${SPACE}.day1`);
        assert(gotValue(b), `group 1 member: ${b.status}`);
        assert(gotValue(c), `group 2 member: ${c.status}`);
    });

    // ── 3. Discoverability, both directions ──────────────────────────────────
    console.log('\nPhase 3: both directions are discoverable');

    await test('A sees what they have shared, and to whom', async () => {
        const r = await json('/v1/shares', { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(r.status === 200, `list own shares: ${r.status} ${JSON.stringify(r.body)}`);
        const mine = r.body.data.shares as { key_pattern: string; group_id: string }[];
        assert(mine.length >= 2, `expected both shares, got ${mine.length}`);
        assert(mine.some(s => s.key_pattern === `${SPACE}.**` && s.group_id === g1), 'the group-1 share is listed');
    });

    await test('B SEES WHAT IS SHARED WITH THEM without being told the key', async () => {
        // The half that made the old feature unusable: a reader had to be handed the owner GHII and
        // the exact key out of band, because nothing on the node would tell them.
        const r = await json('/v1/shares/incoming', { headers: { Authorization: `Bearer ${B.ownerToken}` } });
        assert(r.status === 200, `incoming: ${r.status} ${JSON.stringify(r.body)}`);
        const incoming = r.body.data.shares as { key_pattern: string; owner_gaii: string }[];
        assert(incoming.some(s => s.owner_gaii === A.ghii && s.key_pattern === `${SPACE}.**`),
            `expected A's share, got ${JSON.stringify(incoming)}`);
    });

    await test("B's incoming list does NOT include the group they are not in", async () => {
        const r = await json('/v1/shares/incoming', { headers: { Authorization: `Bearer ${B.ownerToken}` } });
        const incoming = r.body.data.shares as { group_id: string }[];
        assert(!incoming.some(s => s.group_id === g2), 'group 2 is not B\'s');
    });

    await test("an agent sees its owner's incoming shares", async () => {
        const r = await json('/v1/shares/incoming', { headers: { Authorization: `Bearer ${B.agentToken}` } });
        assert(r.status === 200, `agent incoming: ${r.status}`);
        assert((r.body.data.shares as unknown[]).length >= 1, 'the agent sees what its owner was given');
    });

    // ── 4. Ending it ─────────────────────────────────────────────────────────
    console.log('\nPhase 4: revoking the share, and the membership');

    await test('revoking the share ends the reads it granted', async () => {
        const d = await json(`/v1/shares/${share1}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(d.status === 200, `revoke: ${d.status} ${JSON.stringify(d.body)}`);
        const r = await readForeign(B.ownerToken, A.ghii, `${SPACE}.day1`);
        assert(r.status === 403, `after revoke: expected 403, got ${r.status}`);
    });

    await test('the OTHER audience is untouched by that revocation', async () => {
        const c = await readForeign(C.ownerToken, A.ghii, `${SPACE}.day1`);
        assert(gotValue(c), `group 2 still reads: ${c.status}`);
    });

    await test('an EXPIRED share ends the reads too, without anyone revoking it', async () => {
        // Revocation was proved; expiry was not. `expires_at` is a first-class field on the create
        // route and isLive() is the only thing that ends a timed grant, so deleting the
        // `if (!isLive(share, now)) continue;` in isKeyShared and the `.filter(s => isLive(s, now))`
        // in listIncomingShares leaves every test in this file green while an expired share grants
        // cross-owner reads forever. Nobody had ever set one.
        const gx = await createGroup(A, 'timed group', [B.ghii]);
        const key = `${SPACE}.timed`;
        const w = await writePrivate(key, { text: 'timed' });
        assert(w.status === 201, `write: ${w.status}`);

        // Live first, so the expiry below is the thing that ends it and not a share that never worked.
        const live = await json(`/v1/groups/${gx}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${SPACE}.**`, expires_at: new Date(Date.now() + 3600_000).toISOString() }),
        });
        assert(live.status === 201, `timed share: ${live.status} ${JSON.stringify(live.body)}`);
        assert(gotValue(await readForeign(B.ownerToken, A.ghii, key)), 'a share with a future expiry reads');
        await json(`/v1/shares/${live.body.data.share.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });

        // And one whose clock has already run out grants nothing.
        const past = await json(`/v1/groups/${gx}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${SPACE}.**`, expires_at: new Date(Date.now() - 60_000).toISOString() }),
        });
        assert(past.status === 201, `expired share created: ${past.status} ${JSON.stringify(past.body)}`);
        const r = await readForeign(B.ownerToken, A.ghii, key);
        assert(r.status === 403, `an expired share still granted the read: ${r.status}`);

        // It must not be advertised either — the incoming list is how a member learns what they hold.
        const incoming = await json('/v1/shares/incoming', { headers: { Authorization: `Bearer ${B.ownerToken}` } });
        const rows = (incoming.body.data?.shares ?? incoming.body.data?.items ?? []) as any[];
        assert(!rows.some(s => s.id === past.body.data.share.id),
            `an expired share is listed as incoming: ${JSON.stringify(rows.map(s => s.id))}`);
    });

    await test('removing the member ends it too, with the share left in place', async () => {
        const del = await json(`/v1/groups/${g2}/members/${encodeURIComponent(C.ghii)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` },
        });
        assert(del.status === 200, `remove member: ${del.status}`);
        const c = await readForeign(C.ownerToken, A.ghii, `${SPACE}.day1`);
        assert(c.status === 403, `after removal: expected 403, got ${c.status}`);
    });

    await test('a stranger cannot revoke a share they do not own', async () => {
        const r = await json(`/v1/groups/${g2}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: `${SPACE}.**` }),
        });
        const id = r.body.data.share.id;
        const d = await json(`/v1/shares/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } });
        assert(d.status === 403 || d.status === 404, `stranger revoke must fail, got ${d.status}`);
    });

    // ── 5. Who may make one ──────────────────────────────────────────────────
    console.log('\nPhase 5: making a share is its own permission');

    await test("A's agent WITH share:manage can share its owner's space", async () => {
        const r = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.agentToken}` },
            body: JSON.stringify({ key_pattern: `agentmade${stamp}.*` }),
        });
        assert(r.status === 201, `agent share: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.share.owner_gaii === A.ghii, `lands under the OWNER, got ${r.body.data.share.owner_gaii}`);
    });

    await test("B's agent WITHOUT share:manage is refused", async () => {
        const gb = await createGroup(B, 'b group', [C.ghii]);
        const r = await json(`/v1/groups/${gb}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${B.agentToken}` },
            body: JSON.stringify({ key_pattern: `nope${stamp}.*` }),
        });
        assert(r.status === 403, `expected 403 without the scope, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('nobody can share into a group they do not own', async () => {
        const r = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${B.ownerToken}` },
            body: JSON.stringify({ key_pattern: `hijack${stamp}.*` }),
        });
        assert(r.status === 403 || r.status === 404, `sharing into A's group must fail, got ${r.status}`);
    });

    await test('a reserved key space cannot be shared', async () => {
        // openrouter.* holds the URL a decrypted AI key is sent to. Sharing it would hand another
        // account the owner's server-trusted config, which no share may ever do.
        const r = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.agentToken}` },
            body: JSON.stringify({ key_pattern: 'openrouter.*' }),
        });
        assert(r.status === 403, `reserved space must be refused, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('a pattern that matches everything is refused', async () => {
        const r = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({ key_pattern: '*' }),
        });
        assert(r.status === 400 || r.status === 403, `"*" must be refused, got ${r.status}`);
    });

    // ── 5b. A hosted app, which is the principal a subscription button actually runs as ──
    console.log('\nPhase 5b: a hosted app with an app-grant');

    await test('an APP-GRANT token with share:manage can create a share; without it, cannot', async () => {
        // This is the path a "Subscribe" button in a published app takes. It matters that it works
        // WITH the permission and fails WITHOUT it, because the whole subscription flow hangs on
        // whether the app can hand the buyer access itself or has to ask an agent to do it.
        const FILENAME = `ks-share-app-${stamp}.html`;
        const REDIRECT = 'http://localhost:9911/callback';
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
            body: JSON.stringify({
                filename: FILENAME, content: Buffer.from('<!DOCTYPE html><html><body>s</body></html>', 'utf8').toString('base64'),
                name: 'Share App', description: 'share flow', category: 'utility',
            }),
        });
        assert(pub.status === 201, `publish app: ${pub.status} ${JSON.stringify(pub.body)}`);

        const mint = async (scope: string) => {
            const verifier = createHash('sha256').update(`v${scope}${stamp}`).digest('base64url');
            const challenge = createHash('sha256').update(verifier).digest('base64url');
            const q = new URLSearchParams({
                app: `${A.name}/${FILENAME}`, response_type: 'code', scope,
                redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
            });
            const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
            const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
            const con = await json('/v1/app-grants/authorize-consent', {
                method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
                body: JSON.stringify({ request_id: rid }),
            });
            const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
            const tok = await json('/v1/app-grants/token', {
                method: 'POST',
                body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
            });
            assert(tok.body.ok === true, `token exchange (${scope}): ${JSON.stringify(tok.body.error)}`);
            return tok.body.data.access_token as string;
        };

        const withScope = await mint('memory:read memory:write share:manage');
        const granted = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${withScope}` },
            body: JSON.stringify({ key_pattern: `appmade${stamp}.**` }),
        });
        assert(granted.status === 201, `app WITH share:manage: expected 201, got ${granted.status} ${JSON.stringify(granted.body)}`);
        assert(granted.body.data.share.owner_gaii === A.ghii, `lands under the owner, got ${granted.body.data.share.owner_gaii}`);

        const withoutScope = await mint('memory:read memory:write');
        const refused = await json(`/v1/groups/${g1}/shares`, {
            method: 'POST', headers: { Authorization: `Bearer ${withoutScope}` },
            body: JSON.stringify({ key_pattern: `appdenied${stamp}.**` }),
        });
        assert(refused.status === 403, `app WITHOUT share:manage: expected 403, got ${refused.status} ${JSON.stringify(refused.body)}`);

        // The boundary an app builder needs to know: it can hand out access to a key space, but the
        // AUDIENCE stays the owner's to define. Creating a group and admitting people to it are
        // owner-role acts, and an app-grant carries roles ['app'], so those two still go through
        // the owner or an agent acting for them.
        const groupAttempt = await json('/v1/groups', {
            method: 'POST', headers: { Authorization: `Bearer ${withScope}` },
            body: JSON.stringify({ name: 'app-made group', members: [] }),
        });
        assert(groupAttempt.status === 403, `an app must not create a group, got ${groupAttempt.status}`);
        const memberAttempt = await json(`/v1/groups/${g1}/members`, {
            method: 'POST', headers: { Authorization: `Bearer ${withScope}` },
            body: JSON.stringify({ identifier: C.ghii, identifier_type: 'ghii' }),
        });
        assert(memberAttempt.status === 403, `an app must not admit a member, got ${memberAttempt.status}`);
    });

    // ── 6. Still a read share ────────────────────────────────────────────────
    console.log('\nPhase 6: a share never grants a write');

    await test("a member writing inside the shared space lands in their OWN namespace", async () => {
        const key = `${SPACE}.day1`;
        const theirs = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${C.ownerToken}` },
            body: JSON.stringify({ key, value: { by: 'C' }, visibility: 'private' }),
        });
        assert(theirs.status === 201, `C writes: ${theirs.status}`);
        assert(theirs.body.data.owner_gaii === C.ghii, `lands under C, got ${theirs.body.data.owner_gaii}`);
        const aCopy = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(aCopy.body?.data?.value?.text === 'day one', `A's record untouched: ${JSON.stringify(aCopy.body?.data?.value)}`);
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

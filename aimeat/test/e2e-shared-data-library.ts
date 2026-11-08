/**
 * @file e2e-shared-data-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for shared data in one place (WP11; design canvas "Jaettu data"): the library by the
 *   reader's reach (GET /v1/catalogue/knowledge?reach=public|shared|own|party), the owner's "Data you
 *   share" (GET /v1/datapackages/shared and aimeat_dataproduct action "shared") and the operator's
 *   list in the compliance report (data_intermediation.shared_data). Every listing is
 *   services/datapackage/visible.ts visiblePackages, so each assertion here is also "a list never names
 *   what the reader could not open".
 *
 *   The cast: the operator; A with a public, a members, an organism and a private package, the private
 *   one shared by name with an outside party; B, a member of A's organism; C, an account outside it; a
 *   second party of A that holds no share. Asserted: signed out sees the public package only; B's
 *   "Shared with you" lists the members and the organism package and never the private one, C's lists
 *   the members package only; A's own reach lists all four and B's own lists none of A's; the party
 *   key lists exactly its one share, the other party nothing; a withdrawn package leaves every list;
 *   the shared view counts and names A's share and refuses an app and B reads only B's; the operator's
 *   list is in the compliance report and an owner gets 403. Each fails on the code before WP11: the
 *   reaches, the view and shared_data did not exist.
 * @version-history
 *   2026-11-08 — A share pinned to an earlier version: the party's row carries that version's facts
 *     (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-02 — Initial (WP11).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=shared-data-library

import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; basic?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined;
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const stamp = Date.now() % 10_000_000;

console.log('\n=== AIMEAT shared data library E2E ===\n');
let op = { name: '', token: '' };
let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let node = '', orgId = '', shareId = '';
const PUB = `sdlpub${stamp}`, MEM = `sdlmem${stamp}`, ORG = `sdlorg${stamp}`, PRIV = `sdlpriv${stamp}`;
const partyKeys: Record<string, string> = {};
const publish = (name: string, visibility: string) => call('/v1/datapackages', {
    token: A.token, body: { name, title: `Title ${name}`, changes: 'First.', visibility, provenance: { license: 'CC-BY-4.0' }, resources: [{ name: 'rows', rows: [{ id: 1 }, { id: 2 }] }] },
});
/** The data packages one reach lists for one reader, by name. */
const listed = async (reach: string, auth: { token?: string; basic?: string } = {}) => {
    const r = await call(`/v1/catalogue/knowledge?reach=${reach}&kind=data&limit=50`, auth);
    return { r, names: (r.body.data?.packages ?? []).map((p: Body) => p.datapackage?.name as string) };
};

await test('setup: the operator, A with four packages, B in A\'s organism, C outside it, two parties of A', async () => {
    const o = await setupOperator(BASE, ADMIN_PW, `sdlop${stamp}`);
    op = { name: o.name, token: o.token };
    const a = await registerOwner(BASE, `sdla${stamp}`);
    A = { name: a.name, token: a.token };
    node = a.ghii.split('@')[1]!;
    B = await registerOwner(BASE, `sdlb${stamp}`).then(x => ({ name: x.name, token: x.token }));
    C = await registerOwner(BASE, `sdlc${stamp}`).then(x => ({ name: x.name, token: x.token }));
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Sdl Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' } });
    orgId = org.body.data?.id ?? org.body.data?.organism?.id;
    assert(orgId, `organism: ${show(org)}`);
    const j = await call(`/v1/organisms/${orgId}/join`, { token: B.token, body: {} });
    assert(j.status === 200 || j.status === 201, `B joins: ${show(j)}`);
    for (const [name, vis] of [[PUB, 'public'], [MEM, 'members'], [ORG, `organism:${orgId}`], [PRIV, 'private']] as const) {
        const p = await publish(name, vis);
        assert(p.status === 201, `${name}: ${show(p)}`);
    }
    for (const party of ['reader', 'other']) {
        const r = await call('/v1/parties', { token: A.token, body: { name: party, kind: 'program' } });
        assert(r.status === 201, `party ${party}: ${show(r)}`);
        partyKeys[party] = r.body.data.key;
    }
    const share = await call('/v1/consent', { token: A.token, body: { recipient: `party:${A.name}/reader@${node}`, data_pattern: `datapkg:${PRIV}`, purpose: 'Report' } });
    assert(share.status === 201, `share: ${show(share)}`);
    shareId = share.body.data.id;
});

await test('signed out: the public reach lists the public package and none of the other three', async () => {
    const { r, names } = await listed('public');
    assert(r.status === 200 && names.includes(PUB), `public: ${show(r)}`);
    for (const n of [MEM, ORG, PRIV]) assert(!names.includes(n), `${n} is not public: ${JSON.stringify(names)}`);
    const item = r.body.data.packages.find((p: Body) => p.datapackage?.name === PUB);
    assert(item.kind === 'data' && item.datapackage.owner === A.name && item.datapackage.license === 'CC-BY-4.0' && item.datapackage.tables === 1 && item.datapackage.rows === 2, `the row's facts: ${JSON.stringify(item.datapackage)}`);
    assert(typeof r.body.data.counts?.data === 'number', `counts: ${JSON.stringify(r.body.data.counts)}`);
});

await test('signed out: shared and own need a sign-in (401), and a reach that does not exist is 400', async () => {
    for (const reach of ['shared', 'own']) {
        const r = await call(`/v1/catalogue/knowledge?reach=${reach}`);
        assert(r.status === 401, `${reach}: ${show(r)}`);
    }
    const bad = await call('/v1/catalogue/knowledge?reach=everything');
    assert(bad.status === 400, `bad reach: ${show(bad)}`);
});

await test('B, an organism member: "Shared with you" lists the members and the organism package, never the private one', async () => {
    const { r, names } = await listed('shared', { token: B.token });
    assert(r.status === 200 && names.includes(MEM) && names.includes(ORG), `B shared: ${show(r)}`);
    assert(!names.includes(PRIV) && !names.includes(PUB), `no private, no public: ${JSON.stringify(names)}`);
    const org = r.body.data.packages.find((p: Body) => p.datapackage?.name === ORG);
    assert(org.why?.kind === 'organism' && org.why.organism_id === orgId && org.why.by === A.name, `why: ${JSON.stringify(org.why)}`);
    const mem = r.body.data.packages.find((p: Body) => p.datapackage?.name === MEM);
    assert(mem.why?.kind === 'members', `why members: ${JSON.stringify(mem.why)}`);
});

await test('C, outside the organism: the members package only; a private package is listed to nobody but its owner', async () => {
    const { r, names } = await listed('shared', { token: C.token });
    assert(r.status === 200 && names.includes(MEM) && !names.includes(ORG) && !names.includes(PRIV), `C shared: ${JSON.stringify(names)}`);
    for (const who of [B, C]) {
        for (const reach of ['public', 'shared', 'own']) {
            const l = await listed(reach, { token: who.token });
            assert(!l.names.includes(PRIV), `${who.name} ${reach} lists the private package: ${JSON.stringify(l.names)}`);
        }
    }
});

await test('A\'s own reach lists all four with reads; B\'s own lists none of A\'s', async () => {
    const own = await listed('own', { token: A.token });
    for (const n of [PUB, MEM, ORG, PRIV]) assert(own.names.includes(n), `A own misses ${n}: ${JSON.stringify(own.names)}`);
    assert(own.r.body.data.packages.every((p: Body) => p.why?.kind === 'own' && typeof p.why.reads_30d === 'number'), 'own rows carry reads');
    const bOwn = await listed('own', { token: B.token });
    assert(bOwn.r.status === 200 && bOwn.names.length === 0, `B own: ${JSON.stringify(bOwn.names)}`);
    const counts = await call('/v1/catalogue/knowledge?reaches=1', { token: B.token });
    assert(typeof counts.body.data?.reaches?.shared === 'number' && counts.body.data.reaches.shared >= 2 && typeof counts.body.data.reaches.public === 'number', `reaches: ${JSON.stringify(counts.body.data?.reaches)}`);
});

await test('a party key: the reach "party" lists exactly its one share; the other party lists nothing', async () => {
    const reader = await listed('party', { basic: `${A.name}/reader:${partyKeys.reader}` });
    assert(reader.r.status === 200 && reader.names.length === 1 && reader.names[0] === PRIV, `reader: ${show(reader.r)}`);
    const row = reader.r.body.data.packages[0];
    assert(row.why?.kind === 'share' && row.why.share_id === shareId && typeof row.why.expires === 'string', `why: ${JSON.stringify(row.why)}`);
    assert(reader.r.body.data.party?.name === 'reader' && !reader.r.text.includes(partyKeys.reader), 'the party is named, its key is not');
    const other = await listed('party', { basic: `${A.name}/other:${partyKeys.other}` });
    assert(other.r.status === 200 && other.names.length === 0, `other: ${show(other.r)}`);
    const noKey = await call('/v1/catalogue/knowledge?reach=party');
    assert(noKey.status === 401, `no key: ${show(noKey)}`);
    const wrong = await call('/v1/catalogue/knowledge?reach=party', { basic: `${A.name}/reader:nope` });
    assert(wrong.status === 401, `wrong key: ${show(wrong)}`);
    const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/reader`, client_secret: partyKeys.reader } });
    assert(tok.status === 200, `token: ${show(tok)}`);
    const byToken = await listed('party', { token: tok.body.access_token });
    assert(byToken.names.length === 1 && byToken.names[0] === PRIV, `by token: ${show(byToken.r)}`);
});

await test('the shared view: A\'s counts, rows and the share to the party; B reads only B\'s; an app is refused', async () => {
    const v = await call('/v1/datapackages/shared', { token: A.token });
    assert(v.status === 200, `view: ${show(v)}`);
    const d = v.body.data;
    assert(d.counts.all === 4 && d.counts.public === 1 && d.counts.named === 1, `counts: ${JSON.stringify(d.counts)}`);
    const priv = d.packages.find((p: Body) => p.name === PRIV);
    assert(priv.audience === 'private' && priv.shares.length === 1 && priv.shares[0].party === 'reader' && priv.filters.includes('named'), `private row: ${JSON.stringify(priv)}`);
    assert(d.people.some((s: Body) => s.id === shareId && s.package === PRIV), `people: ${JSON.stringify(d.people)}`);
    const org = d.packages.find((p: Body) => p.name === ORG);
    assert(org.audience === `organism:${orgId}` && typeof org.organism_name === 'string', `organism row: ${JSON.stringify(org)}`);
    const bv = await call('/v1/datapackages/shared', { token: B.token });
    assert(bv.status === 200 && bv.body.data.packages.length === 0 && bv.body.data.people.length === 0, `B's view: ${show(bv)}`);
    const unauth = await call('/v1/datapackages/shared');
    assert(unauth.status === 401, `signed out: ${show(unauth)}`);
});

await test('the same view over MCP: aimeat_dataproduct action "shared"; an agent without storage:read is refused', async () => {
    const agent = await makeAgent(BASE, A, ['storage:read']);
    const s = await openSession(BASE, agent.token, 'sdl-mcp');
    const out = await callTool(s, 'aimeat_dataproduct', { action: 'shared' });
    assert(!out.isError && out.data?.counts?.all === 4 && out.data.packages.some((p: Body) => p.name === PRIV), `tool: ${out.text.slice(0, 300)}`);
    const weak = await makeAgent(BASE, A, ['memory:read']);
    const w = await call('/v1/datapackages/shared', { token: weak.token });
    assert(w.status === 403, `an agent without storage:read: ${show(w)}`);
});

await test('the operator\'s list is in the compliance report; an owner is refused with 403', async () => {
    const r = await call('/v1/admin/compliance/report', { token: op.token });
    assert(r.status === 200, `report: ${show(r)}`);
    const sd = r.body.data?.data_intermediation?.shared_data;
    assert(sd && Array.isArray(sd.rows), `shared_data: ${JSON.stringify(sd)?.slice(0, 300)}`);
    const names = sd.rows.map((x: Body) => x.name);
    for (const n of [PUB, MEM, ORG, PRIV]) assert(names.includes(`${A.name}/${n}`), `operator list misses ${n}: ${JSON.stringify(names)}`);
    const priv = sd.rows.find((x: Body) => x.name === `${A.name}/${PRIV}`);
    assert(priv.named_shares === 1 && !Object.values(priv).includes('reader') && !JSON.stringify(sd).includes(`party:${A.name}/reader`), `a named share is counted, not named: ${JSON.stringify(priv)}`);
    const org = sd.rows.find((x: Body) => x.name === `${A.name}/${ORG}`);
    assert(org.open_organism === true, `the open organism is flagged: ${JSON.stringify(org)}`);
    const owner = await call('/v1/admin/compliance/report', { token: A.token });
    assert(owner.status === 403, `an owner: ${show(owner)}`);
    const mine = await call('/v1/compliance/report/mine', { token: A.token });
    assert(mine.status !== 200 || mine.body.data?.data_intermediation?.shared_data === undefined, 'the owner\'s slice carries no node-wide list');
});

await test('a withdrawn package leaves every list', async () => {
    const w = await call(`/v1/datapackages/${A.name}/${MEM}`, { token: A.token, method: 'DELETE' });
    assert(w.status === 200, `withdraw: ${show(w)}`);
    const shared = await listed('shared', { token: C.token });
    assert(!shared.names.includes(MEM), `C still lists it: ${JSON.stringify(shared.names)}`);
    const own = await listed('own', { token: A.token });
    assert(!own.names.includes(MEM), `A's own still lists it: ${JSON.stringify(own.names)}`);
});

// secaudit2026nov08 round 14 (datapackage:visible:party-listing-reader-omits-share-limits): the party's
// row is built through the reader the read builds from the same share, so a share pinned to an earlier
// version shows that version's facts, never the newest version's description, tables and row counts.
const PIN = `sdlpin${stamp}`;
await test('a share pinned to an earlier version: the party\'s row carries that version\'s facts, and the read serves that version', async () => {
    const pub = (title: string, description: string, resources: unknown[]) => call('/v1/datapackages', {
        token: A.token, body: { name: PIN, title, description, changes: title, visibility: 'private', resources },
    });
    const p1 = await pub('Pinned first', 'The first quarter.', [{ name: 'rows', rows: [{ id: 1 }, { id: 2 }] }]);
    assert(p1.status === 201, `v1: ${show(p1)}`);
    const v1 = String(p1.body.data.content_hash);
    const party = await call('/v1/parties', { token: A.token, body: { name: 'pinned', kind: 'program' } });
    assert(party.status === 201, `party: ${show(party)}`);
    const key = String(party.body.data.key);
    const share = await call('/v1/consent', { token: A.token, body: {
        recipient: `party:${A.name}/pinned@${node}`, data_pattern: `datapkg:${PIN}`, purpose: 'The first quarter only', metadata: { pinned_version: v1 },
    } });
    assert(share.status === 201, `pinned share: ${show(share)}`);
    const p2 = await pub('Pinned second', 'The second quarter.', [
        { name: 'rows', rows: [{ id: 1, extra: 'x' }, { id: 2, extra: 'y' }, { id: 3, extra: 'z' }] },
        { name: 'more', rows: [{ a: 1 }] },
    ]);
    assert(p2.status === 201 && p2.body.data.content_hash !== v1, `v2: ${show(p2)}`);
    const bareHash = (h: unknown) => String(h ?? '').replace(/^sha256:/, '');
    const l = await listed('party', { basic: `${A.name}/pinned:${key}` });
    assert(l.r.status === 200 && l.names.length === 1 && l.names[0] === PIN, `the pinned party lists its one share: ${show(l.r)}`);
    const row = l.r.body.data.packages[0].datapackage;
    assert(bareHash(row.content_hash) === bareHash(v1), `the row names the pinned version: ${JSON.stringify(row)}`);
    assert(row.tables === 1 && row.rows === 2 && row.title === 'Pinned first' && row.description === 'The first quarter.', `the row carries v1's facts: ${JSON.stringify(row)}`);
    assert(!l.r.text.includes('The second quarter.') && !l.r.text.includes('Pinned second'), `no fact of v2 in the listing: ${show(l.r)}`);
    const read = await call(`/v1/datapackages/${A.name}/${PIN}`, { basic: `${A.name}/pinned:${key}` });
    assert(read.status === 200 && read.text.includes(bareHash(v1)), `the read through the same share serves v1: ${show(read)}`);
});

await test('cleanup', async () => {
    for (const n of [PUB, ORG, PRIV, PIN]) await call(`/v1/datapackages/${A.name}/${n}`, { token: A.token, method: 'DELETE' });
    if (orgId) await call(`/v1/organisms/${orgId}`, { token: A.token, method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

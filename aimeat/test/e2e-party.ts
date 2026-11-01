/**
 * @file e2e-party.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the outside party (plan doc-mvwxcas3dom3, D2; lead decisions L1, L2, L3): a
 *   person or a program with no account here, made by an owner, reading only what the owner shares.
 *   Owner A and owner B, an operator, and agents of A with and without party:manage.
 *   D2.7 create, list, get, stop, resume, delete; the key is shown once and the list holds no key or
 *     hash; party:manage is required of an agent (none, '*' and the word itself); MCP aimeat_party.
 *   Cross-owner: B cannot see, stop or delete A's party, cannot share to it, and B's party key cannot
 *     read A's package.
 *   D2.8 a party never passes the members or organism audience: a members and an organism package of
 *     A answer 403 NOT_SHARED to A's own party.
 *   L2 a party token is never a node session: memory, storage, agents, organisms and consent all
 *     answer 401 to it.
 *   D2.1 Basic parse edge cases (no slash, no colon, unknown owner, wrong key: 401) and the failed key
 *     counter.
 *   D2.9 the operator stops a party; the owner cannot resume it; the Security overview counts it.
 *   Invariant 19: deleting a party ends its token at once; a name made again inherits no share.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=party
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2).
 */
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
interface Answer { status: number; body: Body; text: string; headers: Headers }
async function call(path: string, opts: { token?: string; basic?: string; auth?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.auth ?? (opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined);
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text, headers: res.headers };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const stamp = Date.now() % 10_000_000;

console.log('\n=== AIMEAT outside party E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' }, OP = { name: '', token: '' };
let node = '';
const PKG = `pty${stamp}`;
const MEMBERS_PKG = `ptym${stamp}`;
const ORG_PKG = `ptyo${stamp}`;
const BPKG = `ptyb${stamp}`;
let mattiKey = '';
const publish = (token: string, name: string, visibility: string) => call('/v1/datapackages', {
    token, body: { name, changes: 'first', visibility, resources: [{ name: 'items', rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] }] },
});
const share = (token: string, owner: string, party: string, pkg: string, extra: Body = {}) => call('/v1/consent', {
    token, body: { recipient: `party:${owner}/${party}@${node}`, data_pattern: `datapkg:${pkg}`, purpose: 'Budget report', ...extra },
});

await test('Setup: owners A and B, an operator, A has private, members and organism packages, B has one', async () => {
    const a = await registerOwner(BASE, `ptya${stamp}`);
    const b = await registerOwner(BASE, `ptyb${stamp}`);
    const op = await setupOperator(BASE, ADMIN_PW, `ptyop${stamp}`);
    A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token }; OP = { name: op.name, token: op.token };
    node = a.ghii.split('@')[1]!;
    assert((await publish(A.token, PKG, 'private')).status === 201, 'private package');
    assert((await publish(A.token, MEMBERS_PKG, 'members')).status === 201, 'members package');
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Pty Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    const o = await publish(A.token, ORG_PKG, `organism:${org.body.data.organism.id}`);
    assert(o.status === 201, `organism package: ${show(o)}`);
    assert((await publish(B.token, BPKG, 'private')).status === 201, 'B package');
});

await test('D2.7 A makes a party: 201, the key once; the list holds neither key nor hash', async () => {
    const r = await call('/v1/parties', { token: A.token, body: { name: 'matti', kind: 'program', display_name: 'Matti Power BI' } });
    assert(r.status === 201, `create: ${show(r)}`);
    mattiKey = r.body.data.key;
    assert(typeof mattiKey === 'string' && mattiKey.length >= 40, 'a key is answered');
    assert(r.body.data.party.party_ref === `party:${A.name}/matti@${node}`, `party_ref: ${r.body.data.party.party_ref}`);
    const list = await call('/v1/parties', { token: A.token });
    assert(list.status === 200 && list.body.data.total === 1, `list: ${show(list)}`);
    assert(!list.text.includes(mattiKey), 'the list does not carry the key');
    assert(!/"hash"/.test(list.text), 'the list does not carry a key hash');
    const again = await call('/v1/parties', { token: A.token, body: { name: 'matti' } });
    assert(again.status === 409 && codeOf(again) === 'PARTY_EXISTS', `duplicate: ${show(again)}`);
    for (const bad of ['Bad Name', 'me', 'token', 'x'.repeat(41)]) {
        const r2 = await call('/v1/parties', { token: A.token, body: { name: bad } });
        assert(r2.status === 400, `name "${bad}": ${show(r2)}`);
    }
});

await test('D2.7 an agent needs party:manage: none 403, "*" 403, the word itself 200', async () => {
    const none = await makeAgent(BASE, A, ['memory:read', 'consent:manage']);
    const star = await makeAgent(BASE, A, ['*']);
    const has = await makeAgent(BASE, A, ['party:manage', 'consent:manage']);
    for (const ag of [none, star]) {
        const l = await call('/v1/parties', { token: ag.token });
        assert(l.status === 403, `list without the word: ${show(l)}`);
        const c = await call('/v1/parties', { token: ag.token, body: { name: `agent-${ag.name}` } });
        assert(c.status === 403, `create without the word: ${show(c)}`);
        const s = await share(ag.token, A.name, 'matti', PKG);
        assert(s.status === 403 && codeOf(s) === 'SCOPE_DENIED', `share without the word: ${show(s)}`);
    }
    const ok = await call('/v1/parties', { token: has.token });
    assert(ok.status === 200 && ok.body.data.total >= 1, `list with the word: ${show(ok)}`);
    const made = await call('/v1/parties', { token: has.token, body: { name: 'by-agent' } });
    assert(made.status === 201, `create with the word: ${show(made)}`);
    assert(made.body.data.party.created_by === has.gaii, `created_by: ${made.body.data.party.created_by}`);
});

await test('D2.7 MCP aimeat_party: the agent with party:manage lists and makes; one without is refused', async () => {
    const has = await makeAgent(BASE, A, ['party:manage']);
    const s = await openSession(BASE, has.token, 'party-mcp');
    const made = await callTool(s, 'aimeat_party', { action: 'create', name: 'mcp-party' });
    assert(!made.isError && made.data?.key, `create over MCP: ${made.text?.slice(0, 300)}`);
    const list = await callTool(s, 'aimeat_party', { action: 'list' });
    assert(!list.isError && (list.data?.parties ?? []).some((p: Body) => p.name === 'mcp-party'), `list over MCP: ${list.text?.slice(0, 300)}`);
    const without = await makeAgent(BASE, A, ['memory:read']);
    const s2 = await openSession(BASE, without.token, 'party-mcp-none');
    const refused = await callTool(s2, 'aimeat_party', { action: 'list' });
    assert(refused.isError, `an agent without party:manage is refused: ${refused.text?.slice(0, 300)}`);
});

await test('Cross-owner: B cannot see, stop, delete or share to A\'s party', async () => {
    assert((await call('/v1/parties/matti', { token: B.token })).status === 404, 'B reads no matti');
    assert((await call('/v1/parties/matti/stop', { token: B.token, body: {} })).status === 404, 'B stops no matti');
    assert((await call('/v1/parties/matti', { token: B.token, method: 'DELETE' })).status === 404, 'B deletes no matti');
    const s = await share(B.token, A.name, 'matti', BPKG);
    assert(s.status === 403 && codeOf(s) === 'FORBIDDEN', `B shares to A's party: ${show(s)}`);
    const still = await call('/v1/parties/matti', { token: A.token });
    assert(still.status === 200 && still.body.data.party.status === 'active', 'A\'s party is untouched');
});

await test('Cross-owner: B\'s party key does not read A\'s package', async () => {
    const bp = await call('/v1/parties', { token: B.token, body: { name: 'bp' } });
    assert(bp.status === 201, `B party: ${show(bp)}`);
    assert((await share(B.token, B.name, 'bp', BPKG)).status === 201, 'B shares its own package');
    const own = await call(`/v1/datapackages/${B.name}/${BPKG}`, { basic: `${B.name}/bp:${bp.body.data.key}` });
    assert(own.status === 200, `B's party reads B's package: ${show(own)}`);
    const theirs = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${B.name}/bp:${bp.body.data.key}` });
    assert(theirs.status === 403 && codeOf(theirs) === 'NOT_SHARED', `B's party on A's package: ${show(theirs)}`);
    const asA = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/bp:${bp.body.data.key}` });
    assert(asA.status === 401, `B's key named as A's party: ${show(asA)}`);
});

await test('D2.8 a party never passes the members or organism audience without a share', async () => {
    assert((await share(A.token, A.name, 'matti', PKG)).status === 201, 'share of the private package');
    const own = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/matti:${mattiKey}` });
    assert(own.status === 200, `the shared package: ${show(own)}`);
    for (const pkg of [MEMBERS_PKG, ORG_PKG]) {
        const r = await call(`/v1/datapackages/${A.name}/${pkg}`, { basic: `${A.name}/matti:${mattiKey}` });
        assert(r.status === 403 && codeOf(r) === 'NOT_SHARED', `${pkg}: ${show(r)}`);
        const od = await call(`/v1/odata/${A.name}/${pkg}`, { basic: `${A.name}/matti:${mattiKey}` });
        assert(od.status === 403, `${pkg} OData: ${show(od)}`);
    }
});

await test('L2 a party token is not a node session: five representative routes answer 401', async () => {
    const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/matti`, client_secret: mattiKey } });
    assert(tok.status === 200 && String(tok.body.access_token).startsWith('aimeat_party_'), `token: ${show(tok)}`);
    const t = tok.body.access_token as string;
    for (const path of ['/v1/memory', '/v1/storage', '/v1/agents', '/v1/organisms', '/v1/consent']) {
        const r = await call(path, { token: t });
        assert(r.status === 401, `${path} with a party token: ${show(r)}`);
    }
    const write = await call('/v1/memory', { token: t, body: { key: 'x.y', value: 1 } });
    assert(write.status === 401, `memory write with a party token: ${show(write)}`);
    const del = await call(`/v1/datapackages/${A.name}/${PKG}`, { token: t, method: 'DELETE' });
    assert(del.status === 401, `withdraw with a party token: ${show(del)}`);
    const read = await call(`/v1/datapackages/${A.name}/${PKG}`, { token: t });
    assert(read.status === 200, `the shared read with the token: ${show(read)}`);
    const basicElsewhere = await call('/v1/memory', { basic: `${A.name}/matti:${mattiKey}` });
    assert(basicElsewhere.status === 401, `Basic on memory: ${show(basicElsewhere)}`);
});

await test('D2.1 Basic edge cases answer 401, and a wrong key is counted', async () => {
    const before = (await call('/v1/parties/matti', { token: A.token })).body.data.party.failed_attempts as number;
    const path = `/v1/datapackages/${A.name}/${PKG}`;
    const cases: Array<[string, Parameters<typeof call>[1]]> = [
        ['no slash', { basic: `${A.name}matti:${mattiKey}` }],
        ['no colon', { basic: `${A.name}/matti` }],
        ['unknown owner', { basic: `nosuchowner${stamp}/matti:${mattiKey}` }],
        ['unknown party', { basic: `${A.name}/nobody:${mattiKey}` }],
        ['wrong key', { basic: `${A.name}/matti:${mattiKey}x` }],
        ['bad base64', { auth: 'Basic !!!' }],
        ['forged token', { token: 'aimeat_party_eyJhbGciOiJFZERTQSJ9.eyJ0eXAiOiJwYXJ0eSJ9.AAAA' }],
    ];
    for (const [label, opts] of cases) {
        const r = await call(path, opts);
        assert(r.status === 401, `${label}: ${show(r)}`);
    }
    const od = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/matti:wrong` });
    assert(od.status === 401 && /Basic realm="aimeat"/.test(od.headers.get('www-authenticate') ?? ''), `OData challenge: ${od.status} ${od.headers.get('www-authenticate')}`);
    const after = (await call('/v1/parties/matti', { token: A.token })).body.data.party.failed_attempts as number;
    assert(after >= before + 2, `failed_attempts ${before} -> ${after}`);
});

await test('D2.9 the operator stops a party; the owner cannot resume it; B cannot use the operator route', async () => {
    const notOp = await call(`/v1/admin/parties/${A.name}/matti/stop`, { token: B.token, body: {} });
    assert(notOp.status === 403, `B on the operator route: ${show(notOp)}`);
    const stop = await call(`/v1/admin/parties/${A.name}/matti/stop`, { token: OP.token, body: { reason: 'scraping' } });
    assert(stop.status === 200 && stop.body.data.party.stopped_by === 'operator', `operator stop: ${show(stop)}`);
    const r = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/matti:${mattiKey}` });
    assert(r.status === 403 && codeOf(r) === 'PARTY_STOPPED', `a stopped party reads: ${show(r)}`);
    const resume = await call('/v1/parties/matti/resume', { token: A.token, body: {} });
    assert(resume.status === 409 && codeOf(resume) === 'STOPPED_BY_OPERATOR', `owner resume: ${show(resume)}`);
    const sec = await call('/v1/admin/security/overview', { token: OP.token });
    assert(sec.status === 200 && sec.body.data.parties.stopped_by_operator >= 1 && sec.body.data.parties.total >= 2, `overview: ${JSON.stringify(sec.body.data?.parties)}`);
    assert(sec.body.data.parties.refused_reads_7d >= 1, `refused reads counted: ${JSON.stringify(sec.body.data.parties)}`);
    const back = await call(`/v1/admin/parties/${A.name}/matti/resume`, { token: OP.token, body: {} });
    assert(back.status === 200 && back.body.data.party.status === 'active', `operator resume: ${show(back)}`);
    const ownerStop = await call('/v1/parties/matti/stop', { token: A.token, body: {} });
    assert(ownerStop.status === 200 && ownerStop.body.data.party.status === 'stopped', `owner stop: ${show(ownerStop)}`);
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/matti:${mattiKey}` })).status === 403, 'owner-stopped party refused');
    assert((await call('/v1/parties/matti/resume', { token: A.token, body: {} })).status === 200, 'owner resumes');
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/matti:${mattiKey}` })).status === 200, 'resumed party reads');
});

await test('Invariant 19: deleting a party ends its token at once; the name made again inherits no share', async () => {
    const made = await call('/v1/parties', { token: A.token, body: { name: 'reuse' } });
    assert(made.status === 201, `make: ${show(made)}`);
    const granted = await share(A.token, A.name, 'reuse', PKG);
    assert(granted.status === 201, `share: ${show(granted)}`);
    const tok = (await call('/v1/parties/token', { basic: `${A.name}/reuse:${made.body.data.key}`, body: { grant_type: 'client_credentials' } })).body.access_token as string;
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { token: tok })).status === 200, 'reads before the delete');
    const del = await call('/v1/parties/reuse', { token: A.token, method: 'DELETE' });
    assert(del.status === 200 && del.body.data.shares_ended === 1, `delete: ${show(del)}`);
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { token: tok })).status === 401, 'the token is dead');
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/reuse:${made.body.data.key}` })).status === 401, 'the key is dead');
    const ended = await call(`/v1/consent/${granted.body.data.id}`, { token: A.token });
    assert(ended.body.data?.status === 'revoked' && ended.body.data?.metadata?.endedReason === 'party-deleted', `the share ended: ${show(ended)}`);
    const again = await call('/v1/parties', { token: A.token, body: { name: 'reuse' } });
    assert(again.status === 201 && again.body.data.party.uid !== made.body.data.party.uid, 'a new uid');
    const r = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/reuse:${again.body.data.key}` });
    assert(r.status === 403 && codeOf(r) === 'NOT_SHARED', `the new party inherits nothing: ${show(r)}`);
    const got = await call('/v1/parties/reuse', { token: A.token });
    assert((got.body.data.party.shares ?? []).length === 0, `no shares on the new party: ${show(got)}`);
});

await test('Every party endpoint refuses the caller it is not for', async () => {
    const ag = await makeAgent(BASE, A, ['memory:read', 'consent:manage', 'storage:read']);
    const t = ag.token;
    const r1 = await call('/v1/parties', { token: t, method: 'POST', body: { name: 'refused' } });
    assert(r1.status === 403, `POST /v1/parties: ${show(r1)}`);
    const r2 = await call('/v1/parties/share', { token: t, method: 'POST', body: { name: 'refused', package: PKG, purpose: 'x' } });
    assert(r2.status === 403, `POST /v1/parties/share: ${show(r2)}`);
    const r3 = await call('/v1/parties/matti', { token: t, method: 'PATCH', body: { display_name: 'x' } });
    assert(r3.status === 403, `PATCH /v1/parties/matti: ${show(r3)}`);
    const r4 = await call('/v1/parties/matti/keys', { token: t, method: 'POST', body: {} });
    assert(r4.status === 403, `POST keys: ${show(r4)}`);
    const r5 = await call('/v1/parties/matti/keys/pk_000000000000', { token: t, method: 'DELETE' });
    assert(r5.status === 403, `DELETE key: ${show(r5)}`);
    const r6 = await call('/v1/parties/matti/stop', { token: t, method: 'POST', body: {} });
    assert(r6.status === 403, `POST stop: ${show(r6)}`);
    const r7 = await call('/v1/parties/matti/resume', { token: t, method: 'POST', body: {} });
    assert(r7.status === 403, `POST resume: ${show(r7)}`);
    const r8 = await call('/v1/parties/matti/reads', { token: t, method: 'GET' });
    assert(r8.status === 403, `GET reads: ${show(r8)}`);
    // B, never the first account on the node, so never its operator (A may be, on a fresh node).
    const r9 = await call(`/v1/admin/parties/${A.name}/matti/stop`, { token: B.token, method: 'POST', body: {} });
    assert(r9.status === 403, `admin stop by an owner: ${show(r9)}`);
    const r10 = await call(`/v1/admin/parties/${A.name}/matti/resume`, { token: B.token, method: 'POST', body: {} });
    assert(r10.status === 403, `admin resume by an owner: ${show(r10)}`);
    const r10b = await call(`/v1/admin/parties/${A.name}/matti/stop`, { token: t, method: 'POST', body: {} });
    assert(r10b.status === 403, `admin stop by an agent: ${show(r10b)}`);
    // The party's own endpoints take a party credential only: the owner's session is not one.
    const r11 = await call('/v1/parties/me/keys/rotate', { token: A.token, method: 'POST', body: {} });
    assert(r11.status === 401, `rotate with an owner session: ${show(r11)}`);
    const r12 = await call('/v1/parties/me/shares/x/accept', { token: A.token, method: 'POST', body: {} });
    assert(r12.status === 401, `accept with an owner session: ${show(r12)}`);
    const r13 = await call('/v1/parties/me/shares/x/decline', { token: A.token, method: 'POST', body: {} });
    assert(r13.status === 401, `decline with an owner session: ${show(r13)}`);
    // And B's party is no party of A's share.
    const bk = (await call('/v1/parties', { token: B.token, method: 'POST', body: { name: 'bq' } })).body.data.key as string;
    const r14 = await call('/v1/parties/me/shares/x/accept', { basic: `${B.name}/bq:${bk}`, method: 'POST', body: {} });
    assert(r14.status === 404, `B's party accepts an unknown share: ${show(r14)}`);
});

await test('The parties record is service-owned: no memory route writes or deletes it', async () => {
    const w = await call('/v1/memory', { token: A.token, body: { key: 'parties', value: { parties: [] } } });
    assert(w.status === 403 || w.status === 400, `write parties: ${show(w)}`);
    const d = await call('/v1/memory/parties', { token: A.token, method: 'DELETE' });
    assert(d.status === 403 || d.status === 400, `delete parties: ${show(d)}`);
    assert((await call('/v1/parties/matti', { token: A.token })).status === 200, 'matti is still there');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

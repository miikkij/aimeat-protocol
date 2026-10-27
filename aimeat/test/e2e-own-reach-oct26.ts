/**
 * @file test/e2e-own-reach-oct26.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the round-8 fixes of group memory-b (secaudit2026oct26). Each section holds the
 *   attack, which a fix refuses or answers as the main route does, beside the legitimate use of the
 *   same path, which answers the same before and after:
 *     - ROWS: a row's classification label hides the row on the page read and in its kept revisions,
 *       as it does on the single read; a reader the label admits sees all three.
 *     - MEMBERS: a private organism's roster answers 404 to a caller who is not its member, as its
 *       detail does; members, the operator and a public organism's outsiders read as before.
 *     - CREDENTIALS: no word-start query on a credential record's stored value finds it; the record is
 *       still found by its key, and an ordinary record by its value.
 *     - ANCHORS: personal-node anchors sent together leave an owner within personal_nodes.max_per_owner
 *       (the race shows on PostgreSQL); anchors one after another, a delete and a re-anchor work as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-own-reach-oct26
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26, round 8, group memory-b).
 */
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 1_000_000;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body;
    try { parsed = JSON.parse(text) as Body; } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

/** An app-grant bearer of `owner` holding `scopes`, through the real flow (as e2e-mcp-proxy.ts does). */
async function appGrant(owner: RegisteredOwner, scopes: string[]): Promise<string> {
    const filename = `reach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`;
    const redirect = 'http://localhost:9933/callback';
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const pub = await call('POST', '/v1/apps', owner.token, {
        filename, name: 'Reach probe', description: 'app-grant probe', category: 'tool',
        content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>', 'utf8').toString('base64'),
    });
    assert(pub.status === 201, `publish probe app: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const q = new URLSearchParams({
        app: `${owner.name}/${filename}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: redirect, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
    });
    const authorize = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authorize.status === 302, `authorize: ${authorize.status}`);
    const requestId = decodeURIComponent(/req=([^&]+)/.exec(authorize.headers.get('location') ?? '')?.[1] ?? '');
    const consent = await call('POST', '/v1/app-grants/authorize-consent', owner.token, { request_id: requestId });
    assert(consent.status === 200, `consent: ${consent.status} ${JSON.stringify(consent.body?.error)}`);
    const code = new URL(consent.body.data.redirect_url as string).searchParams.get('code') ?? '';
    const tok = await call('POST', '/v1/app-grants/token', undefined, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    assert(tok.status === 200, `app token: ${tok.status} ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.access_token as string;
}

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '', ws = '';

console.log('\n=== Round 8, group memory-b: the side routes answer what the main route answers ===\n');

await test('Setup: the operator turns classification on; alice keeps a private organism with a row space; bob is its contributor', async () => {
    op = await registerOwner(BASE, `orop${stamp}`);
    alice = await registerOwner(BASE, `oralice${stamp}`);
    bob = await registerOwner(BASE, `orbob${stamp}`);
    carol = await registerOwner(BASE, `orcarol${stamp}`);
    const on = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'all' }] });
    assert(on.status === 200, `classification on: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Own reach ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Log', manifest: { objectTypes: [
        { name: 'log', schemaRef: 'schema:log@1', namespace: 'ops.log', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['stream'] },
    ] } });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const add = await call('POST', `/v1/organisms/${orgId}/members`, alice.token, { ghii: bob.name });
    assert(add.status === 201, `add bob: ${add.status} ${JSON.stringify(add.body?.error)}`);
    const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws, grantee: bob.name, role: 'contributor' });
    assert(g.status === 200, `contributor grant: ${g.status} ${JSON.stringify(g.body?.error)}`);
});

// ─── ROWS (row-service.ts:revision-label-address-surrogate-id) ───
console.log('\nROWS: a row\'s own label hides it on every read of the row');

const rows = (suffix = '') => `/v1/organisms/${orgId}/workspace/rows/log${suffix}?ws=${ws}`;
const rowIds = async (token: string): Promise<string[]> => {
    const r = await call('GET', rows(), token);
    assert(r.status === 200, `page read: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.rows as Body[]).map(x => x.rowId as string);
};
const revisionBodies = async (token: string, rowId: string): Promise<string[]> => {
    const r = await call('GET', rows(`/${rowId}/revisions`), token);
    assert(r.status === 200, `revisions: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.revisions as Body[]).map(v => String(v.body?.msg));
};

await test('Setup: alice writes row r1 and labels it for herself only; bob writes over it, so alice\'s content is a kept revision', async () => {
    const policy = await call('PUT', '/v1/classification/policy', alice.token, { level: 'organism', organism_id: orgId, policy: {
        enabled: true,
        labels: [{ id: 'johto', rank: 25, name: { en: 'Board only', fi: 'Hallitus', es: 'Junta' }, aiVisibility: 'hidden', audience: { people: [alice.name] } }],
    } });
    assert(policy.status === 200 && policy.body.data.applied === true, `organism policy: ${policy.status} ${JSON.stringify(policy.body?.error ?? policy.body?.data)}`);
    const a = await call('POST', rows(), alice.token, { row_id: 'r1', body: { stream: 's', msg: 'alice original' } });
    assert(a.status === 200, `alice appends: ${a.status} ${JSON.stringify(a.body?.error)}`);
    const b2 = await call('POST', rows(), alice.token, { row_id: 'r2', body: { stream: 's', msg: 'unlabelled' } });
    assert(b2.status === 200, `alice appends r2: ${b2.status}`);
    // POSITIVE CONTROL: before the label bob reads both rows.
    const before = await rowIds(bob.token);
    assert(before.includes('r1') && before.includes('r2'), `bob reads before the label: ${JSON.stringify(before)}`);
    const set = await call('PUT', '/v1/classification/label', alice.token, { kind: 'row', organism_id: orgId, ws, space: 'log', row_id: 'r1', label: 'johto' });
    assert(set.status === 200 && set.body.data.applied === true, `row label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const over = await call('POST', rows(), bob.token, { row_id: 'r1', body: { stream: 's', msg: 'bob replaced' } });
    assert(over.status === 200, `bob writes over r1: ${over.status} ${JSON.stringify(over.body?.error)}`);
});

await test('the single read hides the labelled row from bob (the control the other reads must match)', async () => {
    const r = await call('GET', rows('/r1'), bob.token);
    assert(r.status === 404, `bob read the labelled row: ${r.status}`);
});

await test('ATTACK: the page read leaves the labelled row out for bob', async () => {
    const ids = await rowIds(bob.token);
    assert(!ids.includes('r1'), `bob's page read listed the labelled row: ${JSON.stringify(ids)}`);
    assert(ids.includes('r2'), `bob lost the unlabelled row: ${JSON.stringify(ids)}`);
});

await test('ATTACK: the kept revisions of the labelled row are not shown to bob', async () => {
    const bodies = await revisionBodies(bob.token, 'r1');
    assert(!bodies.includes('alice original'), `bob read alice's earlier content through the revisions: ${JSON.stringify(bodies)}`);
});

await test('USE: alice, whom the label admits, reads the row on the single read, the page read and its revisions', async () => {
    const one = await call('GET', rows('/r1'), alice.token);
    assert(one.status === 200 && one.body.data.row.body.msg === 'bob replaced', `alice single read: ${one.status} ${JSON.stringify(one.body?.data?.row?.body)}`);
    const ids = await rowIds(alice.token);
    assert(ids.includes('r1') && ids.includes('r2'), `alice page read: ${JSON.stringify(ids)}`);
    const bodies = await revisionBodies(alice.token, 'r1');
    assert(bodies.includes('alice original'), `alice revisions: ${JSON.stringify(bodies)}`);
});

// ─── MEMBERS (organisms/membership.ts:GET-members:private-organism-without-visibility-gate) ───
console.log('\nMEMBERS: a private organism\'s roster answers as its detail does');

await test('the detail of the private organism is 404 to carol and to a caller with no token (the control)', async () => {
    assert((await call('GET', `/v1/organisms/${orgId}`, carol.token)).status === 404, 'carol read the detail');
    assert((await call('GET', `/v1/organisms/${orgId}`)).status === 404, 'no token read the detail');
});

await test('ATTACK: the roster of the private organism is 404 to carol and to a caller with no token', async () => {
    const c = await call('GET', `/v1/organisms/${orgId}/members`, carol.token);
    assert(c.status === 404, `carol read the roster: ${c.status} ${JSON.stringify(c.body?.data?.members?.map?.((m: Body) => m.ghii))}`);
    const n = await call('GET', `/v1/organisms/${orgId}/members`);
    assert(n.status === 404, `no token read the roster: ${n.status} ${JSON.stringify(n.body?.data?.members?.map?.((m: Body) => m.ghii))}`);
});

await test('USE: alice, bob and the operator read the roster as before', async () => {
    for (const [who, token] of [['alice', alice.token], ['bob', bob.token], ['the operator', op.token]] as const) {
        const r = await call('GET', `/v1/organisms/${orgId}/members`, token);
        const names = (r.body?.data?.members as Body[] | undefined)?.map(m => m.ghii) ?? [];
        assert(r.status === 200 && names.includes(alice.name) && names.includes(bob.name), `${who}: ${r.status} ${JSON.stringify(names)}`);
    }
});

await test('USE: a public organism shows its creator and admins to an outsider with no token, as before', async () => {
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Own reach public ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `public organism: ${o.status}`);
    const r = await call('GET', `/v1/organisms/${o.body.data.organism.id}/members`);
    const names = (r.body?.data?.members as Body[] | undefined)?.map(m => m.ghii) ?? [];
    assert(r.status === 200 && names.includes(alice.name), `outsider on a public organism: ${r.status} ${JSON.stringify(names)}`);
});

// ─── CREDENTIALS (search-text.ts:searchableValue:secret-record-values-indexed) ───
console.log('\nCREDENTIALS: a credential record is found by its key, never by its value');

/** A one-character word-start query: hex digits that start no word of the record's key or tags. */
const PROBES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'b', 'c', 'd', 'e', 'f'];
let reader = '';
const discoverKeys = async (token: string, q: string): Promise<string> => {
    const r = await call('GET', `/v1/discover?q=${encodeURIComponent(q)}&scope=own&per_page=100`, token);
    assert(r.status === 200, `discover ${q}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return JSON.stringify(r.body.data.entries);
};

await test('Setup: alice stores an AI provider key in person; an app of hers holds memory:read', async () => {
    const p = await call('PUT', '/v1/ai/providers/mykeyholder', alice.token, { title: 'Mine', type: 'anthropic', capabilities: { text: { enabled: true, model: 'claude-opus-5-5' } } });
    assert(p.status === 200 || p.status === 201, `provider: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const k = await call('PUT', '/v1/ai/providers/mykeyholder/key', alice.token, { api_key: 'sk-ant-own-reach-key' });
    assert(k.status === 200, `key: ${k.status} ${JSON.stringify(k.body?.error)}`);
    const n = await call('POST', '/v1/memory', alice.token, { key: 'notes.reach', value: { text: 'zucchini harvest' }, visibility: 'private' });
    assert(n.status === 201 || n.status === 200, `note: ${n.status} ${JSON.stringify(n.body?.error)}`);
    reader = await appGrant(alice, ['memory:read']);
});

await test('ATTACK: no word-start query on the stored value finds the credential record', async () => {
    const hits: string[] = [];
    // The provider's own settings record carries the same id in its key; only the key record is the credential.
    for (const q of PROBES) if ((await discoverKeys(reader, q)).includes('apikey.provider.mykeyholder')) hits.push(q);
    assert(hits.length === 0, `the credential record answered value probes ${JSON.stringify(hits)}`);
});

await test('USE: the credential record is found by its key, and an ordinary record by its value', async () => {
    assert((await discoverKeys(reader, 'mykeyholder')).includes('apikey.provider.mykeyholder'), 'the credential record is not found by its key');
    assert((await discoverKeys(reader, 'zucchini')).includes('notes.reach'), 'the ordinary record is not found by its value');
});

// ─── ANCHORS (personal-anchor-per-owner-cap-check-then-create-race) ───
console.log('\nANCHORS: anchors sent together hold the per-owner limit');

const anchor = (owner: RegisteredOwner, id: string) => call('POST', '/v1/personal/anchor', owner.token, {
    node_id: id, owner_name: owner.name, public_key: 'test-key-base64', agent_gaiis: [], visibility: 'private',
});
const anchoredBy = async (name: string): Promise<string[]> => {
    const r = await call('GET', '/v1/personal/nodes', op.token);
    assert(r.status === 200, `node list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const nodes = (r.body.data.nodes ?? r.body.data.personal_nodes ?? r.body.data) as Body[];
    return nodes.filter(n => n.owner_name === name).map(n => n.node_id as string);
};

await test('ATTACK: six anchors sent together leave carol with no more than the limit of three', async () => {
    const answers = await Promise.all([1, 2, 3, 4, 5, 6].map(i => anchor(carol, `personal-race${stamp}-${i}`)));
    const mine = await anchoredBy(carol.name);
    assert(mine.length <= 3, `carol holds ${mine.length} anchors: ${JSON.stringify(answers.map(a => a.status))}`);
    const refused = answers.filter(a => a.status === 409);
    assert(refused.every(a => a.body?.error?.code === 'PERSONAL_NODE_LIMIT'), `refusals: ${JSON.stringify(refused.map(a => a.body?.error?.code))}`);
    for (const id of mine) await call('DELETE', `/v1/personal/anchor/${id}`, carol.token);
});

await test('USE: anchors one after another up to the limit, then a delete frees a slot for the next', async () => {
    for (const i of [1, 2, 3]) {
        const r = await anchor(bob, `personal-seq${stamp}-${i}`);
        assert(r.status === 201, `anchor ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
    const fourth = await anchor(bob, `personal-seq${stamp}-4`);
    assert(fourth.status === 409 && fourth.body?.error?.code === 'PERSONAL_NODE_LIMIT', `the fourth: ${fourth.status}`);
    const del = await call('DELETE', `/v1/personal/anchor/personal-seq${stamp}-1`, bob.token);
    assert(del.status === 200, `delete: ${del.status} ${JSON.stringify(del.body?.error)}`);
    const again = await anchor(bob, `personal-seq${stamp}-4`);
    assert(again.status === 201, `after the delete: ${again.status} ${JSON.stringify(again.body?.error)}`);
    assert((await anchoredBy(bob.name)).length === 3, 'bob holds three');
});

await test('Cleanup: the operator turns classification off', async () => {
    const r = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'off' }] });
    assert(r.status === 200, `classification off: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file e2e-workspace-member-records.ts
 * @description E2E tests for the AUTHENTICATED member read of a workspace's published records:
 *   GET /v1/organisms/:id/workspace/records (the members-only analogue of the public records read).
 *   Verifies: anon → 401; the creator reads ALL published records with no share meta (never public);
 *   drafts never leak; ?space= filters; a cross-owner non-member → 404 (no disclosure); a workspace
 *   role grant opens access; the public endpoint still 404s (content stays non-public); and the
 *   organism:read scope gate — an agent token without it → 403, with it (same owner) → 200.
 * @version-history
 *   v1.0.0 — 2026-07-18 — Initial: gated member read (Experience Center B-levels read through it).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-workspace-member-records

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const ownerName = `wsmem${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Mem', password: 'WsMem1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts) }) });
    return { ownerName, ownerToken: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): mint an agent token for `owner` carrying exactly `scopes`. */
async function mintAgentToken(owner: { ownerName: string; ownerToken: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.ownerName }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.ownerToken }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}

console.log('\n=== AIMEAT Workspace Member Records E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
await test('Setup owner A (creator) + owner B (outsider)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

let orgId = '';
const WS = 'wsb1';
const root = () => `organism.${orgId}.w.${WS}`;
const AH = () => ({ Authorization: `Bearer ${A.ownerToken}` });
const BH = () => ({ Authorization: `Bearer ${B.ownerToken}` });
const path = (q = '') => `/v1/organisms/${orgId}/workspace/records?ws=${WS}${q}`;

await test('Seed organism + NON-shared workspace + published records + a draft', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: AH(), body: JSON.stringify({ name: 'Biz Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Business', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Business', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);

    const pub = async (ns: string, id: string, value: unknown) =>
        json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.${ns}.${id}.latest`, value, visibility: 'private' }) });
    await pub('shared.items', 'alpha', { id: 'alpha', title: 'Alpha', order: 0 });
    await pub('shared.items', 'beta', { id: 'beta', title: 'Beta', order: 1 });
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.items.secret.draft`, value: { id: 'secret', title: 'Secret Draft' }, visibility: 'private' }) });
    await pub('shared.notes', 'n1', { id: 'n1', title: 'Note One' });
});

await test('1. anonymous → 401 (member read requires auth)', async () => {
    const r = await json(path());
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('2. creator A reads ALL published records with NO share meta — drafts never served', async () => {
    const r = await json(path(), { headers: AH() });
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body?.error)}`);
    const ids = (r.body.data.records || []).map((x: any) => x.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['alpha', 'beta', 'n1']), `expected alpha+beta+n1, got ${JSON.stringify(ids)}`);
    assert(!ids.includes('secret'), 'draft-only record must never be served');
    const alpha = (r.body.data.records || []).find((x: any) => x.id === 'alpha');
    assert(alpha && alpha.type === 'item' && alpha.value.title === 'Alpha', `full value returned: ${JSON.stringify(alpha)}`);
});

await test('3. ?space= filters to one records space', async () => {
    const r = await json(path('&space=item'), { headers: AH() });
    assert(r.status === 200, `status ${r.status}`);
    const rows = r.body.data.records || [];
    assert(rows.length === 2 && rows.every((x: any) => x.type === 'item'), `item filter: ${JSON.stringify(rows.map((x: any) => x.id))}`);
});

await test('4. cross-owner: authenticated NON-member B → 404 (no disclosure)', async () => {
    const r = await json(path(), { headers: BH() });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('5. the public no-auth endpoint still 404s — the content is never public', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('6. after a workspace role grant (viewer), B reads the records', async () => {
    const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: AH(), body: JSON.stringify({ ws: WS, grantee: B.ownerName, role: 'viewer' }) });
    assert(g.status === 200, `grant ${g.status} ${JSON.stringify(g.body?.error)}`);
    const r = await json(path(), { headers: BH() });
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body?.error)}`);
    const ids = (r.body.data.records || []).map((x: any) => x.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['alpha', 'beta', 'n1']), `granted member sees records, got ${JSON.stringify(ids)}`);
});

await test("7. scope gate: A's agent WITHOUT organism:read → 403; WITH it → 200 (same owner)", async () => {
    const bare = await mintAgentToken(A, `wsmemnoscope${Date.now()}`, ['memory:read']);
    const denied = await json(path(), { headers: { Authorization: `Bearer ${bare}` } });
    assert(denied.status === 403, `no-scope agent: expected 403, got ${denied.status}`);
    const scoped = await mintAgentToken(A, `wsmemscoped${Date.now()}`, ['organism:read']);
    const ok = await json(path(), { headers: { Authorization: `Bearer ${scoped}` } });
    assert(ok.status === 200, `scoped same-owner agent: expected 200, got ${ok.status} ${JSON.stringify(ok.body?.error)}`);
});

await test("8. cross-scope + cross-owner: B's agent WITH organism:read but NO grant to a fresh ws → 404", async () => {
    // A second, ungranted workspace under the same organism: scope alone must never open content.
    const WS2 = 'wsb2';
    const root2 = `organism.${orgId}.w.${WS2}`;
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Business', createdAt: new Date().toISOString(), createdBy: A.ownerName }, { id: WS2, name: 'Inner', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Inner', kind: 'project', status: 'active',
        objectTypes: [{ name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }],
    };
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root2}.meta.manifest`, value: manifest, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root2}.shared.items.only.latest`, value: { id: 'only', title: 'Inner Only' }, visibility: 'private' }) });
    const scopedB = await mintAgentToken(B, `wsmemcross${Date.now()}`, ['organism:read']);
    const r = await json(`/v1/organisms/${orgId}/workspace/records?ws=${WS2}`, { headers: { Authorization: `Bearer ${scopedB}` } });
    assert(r.status === 404, `cross-owner scoped agent on ungranted ws: expected 404, got ${r.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

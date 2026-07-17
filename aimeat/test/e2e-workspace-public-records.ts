/**
 * @file e2e-workspace-public-records.ts
 * @description E2E tests for records-space public sharing: the NO-AUTH read
 *   GET /v1/organisms/:id/workspace/public/records, gated by the SAME meta.share
 *   (public/spaces/docs) as the public documents path. Verifies that only PUBLISHED (.latest)
 *   records the share marks public are served, that drafts never leak, that ?space= filters to one
 *   records space, that a per-record override beats the space flag, and that the share access mode
 *   (account) still gates the anonymous read.
 * @version-history
 *   v1.0.0 — 2026-07-17 — Initial: the records analogue of e2e-workspace-public-sharing (the generic
 *     anonymous read for public record spaces — Experience Center curriculum reads through it).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-workspace-public-records

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
    const ownerName = `wsrec${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Rec', password: 'WsRec1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts) }) });
    return { ownerName, ownerToken: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Public Records E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
await test('Setup owner A (creator) + owner B (outsider)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

let orgId = '';
const WS = 'ws1';
const root = () => `organism.${orgId}.w.${WS}`;
const AH = () => ({ Authorization: `Bearer ${A.ownerToken}` });

await test('Seed organism + workspace (records space) + two published records + one draft', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: AH(), body: JSON.stringify({ name: 'Rec Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Curriculum', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Curriculum', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);

    // Two PUBLISHED items (.latest) + one DRAFT-only item (must never be served) + one published note (other space).
    const pub = async (ns: string, id: string, value: unknown) =>
        json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.${ns}.${id}.latest`, value, visibility: 'private' }) });
    await pub('shared.items', 'alpha', { id: 'alpha', title: 'Alpha', order: 0 });
    await pub('shared.items', 'beta', { id: 'beta', title: 'Beta', order: 1 });
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.items.secret.draft`, value: { id: 'secret', title: 'Secret Draft' }, visibility: 'private' }) });
    await pub('shared.notes', 'n1', { id: 'n1', title: 'Note One' });
});

await test('1. public records 404 before anything is shared (no disclosure)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('2. share write is gated: owner B (not a member) gets 403', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: { Authorization: `Bearer ${B.ownerToken}` }, body: JSON.stringify({ spaces: { item: true } }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('3. owner A makes the item space public (PUT share)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ spaces: { item: true } }) });
    assert(r.status === 200 && r.body.data.share.spaces.item === true, `status ${r.status}`);
});

await test('4. public records (NO AUTH) returns the two published items, NOT the draft', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`);
    assert(r.status === 200, `status ${r.status}`);
    const ids = (r.body.data.records || []).map((x: any) => x.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['alpha', 'beta']), `expected alpha+beta, got ${JSON.stringify(ids)}`);
    assert(!ids.includes('secret'), 'draft-only record must never be served');
    const alpha = (r.body.data.records || []).find((x: any) => x.id === 'alpha');
    assert(alpha && alpha.type === 'item' && alpha.value.title === 'Alpha', `full value returned: ${JSON.stringify(alpha)}`);
});

await test('5. ?space= filters to one records space (note space is not public → filtered space still 200 for item)', async () => {
    const item = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}&space=item`);
    assert(item.status === 200 && (item.body.data.records || []).every((x: any) => x.type === 'item'), `item filter: ${item.status}`);
    // the note space is not marked public → filtering to it 404s (no disclosure)
    const note = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}&space=note`);
    assert(note.status === 404, `note space not public → 404, got ${note.status}`);
});

await test('6. a per-record override (item/beta:false) excludes it even though the space is public', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ docs: { 'item/beta': false } }) });
    assert(put.status === 200, `put ${put.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`);
    const ids = (r.body.data.records || []).map((x: any) => x.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['alpha']), `beta must be excluded, got ${JSON.stringify(ids)}`);
});

await test('7. account access mode: anonymous → 401 SHARE_ACCOUNT_REQUIRED; a member (creator A) → 200', async () => {
    const put = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'account' }) });
    assert(put.status === 200 && put.body.data.share.access === 'account', `put ${put.status}`);
    const anon = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`);
    assert(anon.status === 401 && anon.body.error.code === 'SHARE_ACCOUNT_REQUIRED', `anon: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const member = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=${WS}`, { headers: AH() });
    assert(member.status === 200, `member read: ${member.status}`);
    // back to open for a clean end state
    await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ access: 'open' }) });
});

await test('8. unknown ws / unknown org → 404 (no disclosure)', async () => {
    const a = await json(`/v1/organisms/${orgId}/workspace/public/records?ws=nope`);
    const b = await json(`/v1/organisms/no-such-org/workspace/public/records?ws=${WS}`);
    assert(a.status === 404 && b.status === 404, `expected 404/404, got ${a.status}/${b.status}`);
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: AH() }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file e2e-workspace-record-files.ts
 * @description E2E for services/record-files.ts: a file linked from a workspace record opens to that
 *   workspace's members. An agent uploads a private file and links it in a record; once the record
 *   lands, a member with access reads the file over /v1/pub and somebody outside the workspace does
 *   not. Covered on the three code paths a record reaches a workspace by: the draft write
 *   (POST /workspace/drafts, the route aimeat_workspace_write shares), the single publish
 *   (POST /publish), and the draft-less batch publish (POST /workspace/records/publish, which
 *   ctx.workspace.publishRecords runs). And the refusals: an agent does not open its owner's private
 *   file by linking it, nobody opens another person's file, and a public file is never narrowed.
 *   Jouni ruled on 2026-10-30: a file in the workspace may be seen by the workspace's members.
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial. Tests 2, 4 and 6 are red before the change (403 for the member).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-record-files

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
import { ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `recfile${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Record files', password: 'RecFile1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'RecFile1234');
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const pubPath = (owner: string, key: string) => `/v1/pub/${encodeURIComponent(owner)}/${key.split('/').map(encodeURIComponent).join('/')}`;
const readAs = async (token: string, owner: string, key: string) => (await fetch(`${BASE}${pubPath(owner, key)}`, { headers: auth(token) })).status;
const visibilityOf = async (token: string, key: string) =>
    (await fetch(`${BASE}/v1/storage/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD', headers: auth(token) })).headers.get('x-aimeat-visibility');
const ZIP_B64 = Buffer.from('PK\u0003\u0004 a zip that travels by link').toString('base64');

console.log('\n=== AIMEAT Workspace Record Files E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;   // the workspace's creator
let B!: Awaited<ReturnType<typeof setupOwner>>;   // a member with access
let C!: Awaited<ReturnType<typeof setupOwner>>;   // outside the organism
let agentGaii = '', agentToken = '';
let orgId = '';
const WS = 'ws-files';
const NS = 'shared.attachments';
const root = () => `organism.${orgId}.w.${WS}`;
const stamp = Date.now();

async function upload(token: string, key: string, visibility: string) {
    const r = await json('/v1/storage', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, data: ZIP_B64, mime_type: 'application/zip', visibility }) });
    assert(r.status === 201, `upload ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
}
async function writeDraft(token: string, id: string, link: string) {
    return json(`/v1/organisms/${orgId}/workspace/drafts`, {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ ws: WS, space: 'attachment', id, value: { title: id, files: [{ name: 'paketti.zip', url: link }] } }),
    });
}

await test('Setup: A with an agent, B a member with access, C outside, one records space', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `recagent${stamp}`, owner: A.name, capabilities: ['storage', 'social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    agentGaii = ag.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(ag.body.data.private_key, agentGaii + ts) }) });
    assert(tok.status === 200, `agent token ${tok.status}`);
    agentToken = tok.body.data.token;

    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Record files', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Files', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Files', kind: 'project', status: 'active', objectTypes: [{ name: 'attachment', schemaRef: 'schema:attachment@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);

    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}`);
    const rq = await json(`/v1/organisms/${orgId}/workspace-access`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, message: 'files' }) });
    assert(rq.status === 201, `request ${rq.status}`);
    const ap = await json(`/v1/organisms/${orgId}/workspace-access/decision`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, requester: B.name, decision: 'approve' }) });
    assert(ap.status === 200, `approve ${ap.status}`);
});

const KEY1 = `liitteet/${stamp}/eka.zip`;
await test('1. baseline: the agent\'s private upload is closed to the member', async () => {
    await upload(agentToken, KEY1, 'private');
    assert(await readAs(agentToken, agentGaii, KEY1) === 200, 'the uploader reads its own file');
    assert(await readAs(B.token, agentGaii, KEY1) === 403, 'the member is refused before any record links it');
});

await test('2. the agent writes a draft record linking it: the member reads it, C does not', async () => {
    const w = await writeDraft(agentToken, `rec-${stamp}-1`, `https://example.invalid${pubPath(agentGaii, KEY1)}?v=1`);
    assert(w.status === 200, `draft ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(await visibilityOf(agentToken, KEY1) === 'workspace', `bound to the workspace, got ${await visibilityOf(agentToken, KEY1)}`);
    assert(await readAs(B.token, agentGaii, KEY1) === 200, 'a member with access reads the linked file');
    assert(await readAs(C.token, agentGaii, KEY1) === 403, 'somebody outside the organism is still refused');
});

const OWNER_KEY = `omat/${stamp}/owner.zip`;
await test('3. the agent links its OWNER\'s private file: it stays private', async () => {
    await upload(A.token, OWNER_KEY, 'private');
    const w = await writeDraft(agentToken, `rec-${stamp}-2`, pubPath(A.ghii, OWNER_KEY));
    assert(w.status === 200, `draft ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(await visibilityOf(A.token, OWNER_KEY) === 'private', `an agent must not open its owner's file, got ${await visibilityOf(A.token, OWNER_KEY)}`);
    assert(await readAs(B.token, A.ghii, OWNER_KEY) === 403, 'the member is still refused');
});

await test('4. the owner publishes that record: the owner\'s own file opens to the members', async () => {
    const p = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, namespace: NS, id: `rec-${stamp}-2` }) });
    assert(p.status === 200 || p.status === 201, `publish ${p.status}: ${JSON.stringify(p.body.error)}`);
    assert(await visibilityOf(A.token, OWNER_KEY) === 'workspace', `bound by the person's publish, got ${await visibilityOf(A.token, OWNER_KEY)}`);
    assert(await readAs(B.token, A.ghii, OWNER_KEY) === 200, 'the member reads it');
    assert(await readAs(C.token, A.ghii, OWNER_KEY) === 403, 'C is still refused');
});

const B_KEY = `b/${stamp}/oma.zip`;
await test('5. nobody opens another person\'s file: the agent links B\'s private file, it stays private', async () => {
    await upload(B.token, B_KEY, 'private');
    const w = await writeDraft(agentToken, `rec-${stamp}-3`, pubPath(B.ghii, B_KEY));
    assert(w.status === 200, `draft ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(await visibilityOf(B.token, B_KEY) === 'private', `another person's file is untouched, got ${await visibilityOf(B.token, B_KEY)}`);
});

const KEY2 = `liitteet/${stamp}/toka.zip`;
await test('6. the draft-less batch publish (ctx.workspace.publishRecords) opens the agent\'s file', async () => {
    await upload(agentToken, KEY2, 'private');
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, {
        method: 'POST', headers: auth(agentToken),
        body: JSON.stringify({ ws: WS, namespace: NS, records: [{ id: `rec-${stamp}-4`, value: { title: 'batch', files: [{ url: pubPath(agentGaii, KEY2) }] } }] }),
    });
    assert(r.status === 200, `batch publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(await readAs(B.token, agentGaii, KEY2) === 200, 'a member with access reads the linked file');
    assert(await readAs(C.token, agentGaii, KEY2) === 403, 'C is still refused');
});

const PUB_KEY = `julkiset/${stamp}/auki.zip`;
await test('7. a public file linked in a record stays public (never narrowed)', async () => {
    await upload(agentToken, PUB_KEY, 'public');
    const w = await writeDraft(agentToken, `rec-${stamp}-5`, pubPath(agentGaii, PUB_KEY));
    assert(w.status === 200, `draft ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(await visibilityOf(agentToken, PUB_KEY) === 'public', `public stays public, got ${await visibilityOf(agentToken, PUB_KEY)}`);
    assert(await readAs(C.token, agentGaii, PUB_KEY) === 200, 'C reads a public file as before');
});

console.log(`\nWorkspace record files E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
process.exit(failed > 0 ? 1 : 0);

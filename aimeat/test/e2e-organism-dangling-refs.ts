/**
 * @file e2e-organism-dangling-refs.ts
 * @description E2E for the referential-integrity scan (GET /v1/organisms/:id/workspace/dangling-refs).
 *   Covers: structured reference fields (must_read, born_from.docs, parent_id) that point to a missing
 *   id are flagged as dangling; a document prose mention of a missing id is flagged (kind:'mention')
 *   while a fenced ``` placeholder and an existing id are NOT flagged (no false positives); the
 *   membership gate (non-member 403); and registry-driven multi-workspace enumeration.
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial (TARGET-023): dangling-reference scan.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-dangling-refs

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
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `orgdangl${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Dangling', password: 'OrgDangling1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Dangling', password: 'OrgDangling1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Dangling-Refs E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-dangling1';
const root = () => `organism.${orgId}.w.${WS}`;
type Finding = { ws: string; space: string; instance: string; field: string; kind: string; refId: string; state: string };
let findings: Finding[] = [];
const has = (f: Partial<Finding>) => findings.some(x =>
    (f.instance === undefined || x.instance === f.instance) &&
    (f.field === undefined || x.field === f.field) &&
    (f.refId === undefined || x.refId === f.refId) &&
    (f.state === undefined || x.state === f.state) &&
    (f.kind === undefined || x.kind === f.kind));

await test('Setup A (creator) + B (non-member); A builds a workspace with dangling refs', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Dangling Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Room', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    // A records space (room.target) and a document space (room.design).
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Room', kind: 'project', status: 'active', objectTypes: [
        { name: 'target', schemaRef: 'schema:none-target@1', namespace: 'room.target', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
        { name: 'design', schemaRef: 'schema:none-design@1', namespace: 'room.design', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'document' },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);

    // TARGET-1: must_read → doc-present (exists, OK) + doc-gone (missing); born_from.docs → doc-gone;
    // parent_id → TARGET-missing (missing scalar). Three dangling structured refs expected.
    const t1 = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.room.target.TARGET-1.latest`, value: {
        id: 'TARGET-1', title: 'One', must_read: ['doc-present', 'doc-gone'], refs: [],
        born_from: { docs: ['doc-gone'], drops: [], intent: null, proposal: null },
        parent_id: 'TARGET-missing', target_id: null, card_id: null, release_id: null,
    }, visibility: 'private' }) });
    assert(t1.status === 201 || t1.status === 200, `t1 ${t1.status}: ${JSON.stringify(t1.body.error)}`);
    // doc-present: a real document → any reference to it must resolve.
    const dp = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.room.design.doc-present.latest`, value: { id: 'doc-present', title: 'Present doc', markdown: '# Present\nNothing dangling here.' }, visibility: 'private' }) });
    assert(dp.status === 201 || dp.status === 200, `doc-present ${dp.status}`);
    // doc-prose: prose mentions doc-gone (dangling → flag) + doc-present (exists → skip); a fenced
    // ``` block holds the placeholder doc-idt (must be stripped → NOT flagged); app-dev is an unknown
    // prefix (not a workspace id → skip).
    const pr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.room.design.doc-prose.latest`, value: { id: 'doc-prose', title: 'Prose doc',
        markdown: '# Prose\nThis references doc-gone in prose, and doc-present which exists.\n\n```\n{ id, must_read: [doc-idt] }\n```\n\nNote: app-dev is not an id.' }, visibility: 'private' }) });
    assert(pr.status === 201 || pr.status === 200, `doc-prose ${pr.status}`);

    const r = await json(`/v1/organisms/${orgId}/workspace/dangling-refs?ws=${WS}`, { headers: auth(A.token) });
    assert(r.status === 200, `scan ${r.status}: ${JSON.stringify(r.body.error)}`);
    findings = (r.body.data.findings || []) as Finding[];
    assert(Array.isArray(findings) && findings.length > 0, `expected findings, got ${JSON.stringify(r.body.data)}`);
    assert((r.body.data.scannedWorkspaces || []).includes(WS), 'scannedWorkspaces should include the workspace');
});

await test('1. Structured must_read → missing id is flagged (dangling, kind ref)', async () => {
    assert(has({ instance: 'TARGET-1', field: 'must_read', refId: 'doc-gone', state: 'dangling', kind: 'ref' }),
        `missing must_read finding: ${JSON.stringify(findings)}`);
});

await test('2. Nested born_from.docs → missing id is flagged', async () => {
    assert(has({ instance: 'TARGET-1', field: 'born_from.docs', refId: 'doc-gone', state: 'dangling', kind: 'ref' }),
        `missing born_from.docs finding: ${JSON.stringify(findings)}`);
});

await test('3. Scalar parent_id → missing id is flagged', async () => {
    assert(has({ instance: 'TARGET-1', field: 'parent_id', refId: 'TARGET-missing', state: 'dangling', kind: 'ref' }),
        `missing parent_id finding: ${JSON.stringify(findings)}`);
});

await test('4. Document prose mention of a missing id is flagged (kind mention)', async () => {
    assert(has({ instance: 'doc-prose', field: 'markdown', refId: 'doc-gone', state: 'dangling', kind: 'mention' }),
        `missing prose finding: ${JSON.stringify(findings)}`);
});

await test('5. No false positive for an EXISTING id (doc-present never flagged)', async () => {
    assert(!has({ refId: 'doc-present' }), `doc-present must not be flagged: ${JSON.stringify(findings.filter(f => f.refId === 'doc-present'))}`);
});

await test('6. Fenced ``` placeholder (doc-idt) is stripped, not flagged', async () => {
    assert(!has({ refId: 'doc-idt' }), `doc-idt (in a code fence) must not be flagged: ${JSON.stringify(findings.filter(f => f.refId === 'doc-idt'))}`);
});

await test('7. Unknown-prefix token (app-dev) is not treated as an id', async () => {
    assert(!has({ refId: 'app-dev' }), `app-dev must not be flagged: ${JSON.stringify(findings.filter(f => f.refId === 'app-dev'))}`);
});

await test('8. Registry-driven scan (no ?ws) finds the same dangling refs', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/dangling-refs`, { headers: auth(A.token) });
    assert(r.status === 200, `scan ${r.status}`);
    const all = (r.body.data.findings || []) as Finding[];
    assert(all.some(f => f.instance === 'TARGET-1' && f.refId === 'doc-gone'), `registry scan should surface the dangling ref, got ${JSON.stringify(all)}`);
});

await test('9. A non-member cannot scan (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/dangling-refs?ws=${WS}`, { headers: auth(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

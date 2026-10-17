/**
 * @file test/e2e-audience-memory-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the `organism:<id>` visibility on memory records and stored files (plan
 *   doc-mvcn6c7e4e5q, V3.2 + V3.3). Owner A creates an organism, B joins it, C does not. A writes a
 *   record and uploads a file visible to the organism. B, B's agent and A's own agent read both; C,
 *   C's agent and an anonymous caller are refused. A write naming an organism A is not a member of is
 *   refused with 400 and stores nothing, on POST /v1/memory, PATCH /v1/memory/:key, the bulk write,
 *   POST /v1/storage (inline and presigned) and the chunked init. PATCH /v1/storage/{key}/visibility
 *   moves a file to the organism and back, and to members. A member who leaves loses the read.
 * @structure Setup · 1-6 memory · 7-12 files · 13-15 PATCH a file · 16 leaving · Cleanup
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-audience-memory-files
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.2 + V3.3).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < 6) { await sleep(Number(res.headers.get('Retry-After') || '2') * 1000 + 300); continue; }
        return { status: res.status, body };
    }
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function agentOf(ownerTok: string, owner: string, name: string): Promise<{ gaii: string; token: string }> {
    const r = await json('/v1/agents', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name, owner, capabilities: ['memory', 'storage'], model: 'gpt-4o' }) });
    assert(r.status === 201, `agent ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    const gaii = r.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(r.body.data.private_key, 'base64'));
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }) });
    assert(t.body.ok === true, `token ${name}: ${JSON.stringify(t.body.error)}`);
    return { gaii, token: t.body.data.token };
}

const stamp = Date.now();
const A = { name: `audA${stamp}`, token: '' }, B = { name: `audB${stamp}`, token: '' }, C = { name: `audC${stamp}`, token: '' };
let aAgent = { gaii: '', token: '' }, bAgent = { gaii: '', token: '' }, cAgent = { gaii: '', token: '' };
let orgId = '', otherOrgId = '', aGhii = '';
const recKey = `aud.rec.${stamp}`;
const fileKey = `aud-file-${stamp}.txt`;
const patchFileKey = `aud-patch-${stamp}.txt`;
const content = Buffer.from('organism audience file').toString('base64');
const readRec = (tok?: string) => json(`/v1/memory/${encodeURIComponent(aGhii)}/${encodeURIComponent(recKey)}`, tok ? { headers: auth(tok) } : {});
const readFile = (key: string, tok?: string) => json(`/v1/pub/${encodeURIComponent(aGhii)}/${key}`, tok ? { headers: auth(tok) } : {});

console.log('\n=== AIMEAT organism:<id> visibility on memory and files E2E ===\n');

await test('Setup: A creates an organism, B joins, C creates another; an agent each', async () => {
    // The registration answers with the stored name (lower case); agents are registered under it.
    for (const o of [A, B, C]) { const r = await registerOwner(BASE, o.name); o.name = r.name; o.token = r.token; }
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Aud Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status} ${JSON.stringify(org.body)}`);
    orgId = org.body.data.organism.id;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(j.status === 201 && j.body.data.membership?.status === 'active', `join ${j.status} ${JSON.stringify(j.body)}`);
    const other = await json('/v1/organisms', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ name: `Aud Other ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(other.status === 201, `other org ${other.status}`);
    otherOrgId = other.body.data.organism.id;
    assert(typeof otherOrgId === 'string' && otherOrgId !== orgId, `other org id ${otherOrgId}`);
    aAgent = await agentOf(A.token, A.name, 'aud-a');
    bAgent = await agentOf(B.token, B.name, 'aud-b');
    cAgent = await agentOf(C.token, C.name, 'aud-c');
});

// ─── Memory records (V3.2) ───

await test('1. A writes a record visible to the organism (201, visibility kept, zone dmz)', async () => {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: recKey, value: { note: 'for the organism' }, visibility: `organism:${orgId}` }) });
    assert(w.status === 201, `write ${w.status} ${JSON.stringify(w.body)}`);
    assert(w.body.data.visibility === `organism:${orgId}`, `visibility ${w.body.data.visibility}`);
    assert(w.body.data.zone === 'dmz', `zone ${w.body.data.zone}`);
    aGhii = w.body.data.owner_gaii;
});

await test('2. B (a member) and B\'s agent read it; A\'s own agent reads it', async () => {
    const b = await readRec(B.token);
    assert(b.status === 200 && b.body.data.value?.note === 'for the organism', `B ${b.status} ${JSON.stringify(b.body)}`);
    const ba = await readRec(bAgent.token);
    assert(ba.status === 200, `B's agent ${ba.status} ${JSON.stringify(ba.body)}`);
    const aa = await readRec(aAgent.token);
    assert(aa.status === 200, `A's agent ${aa.status} ${JSON.stringify(aa.body)}`);
});

await test('3. C (not a member) and C\'s agent are refused with 403 NOT_ORGANISM_MEMBER', async () => {
    const c = await readRec(C.token);
    assert(c.status === 403 && c.body.error?.code === 'NOT_ORGANISM_MEMBER', `C ${c.status} ${JSON.stringify(c.body)}`);
    const ca = await readRec(cAgent.token);
    assert(ca.status === 403 && ca.body.error?.code === 'NOT_ORGANISM_MEMBER', `C's agent ${ca.status} ${JSON.stringify(ca.body)}`);
});

await test('4. Anonymous gets 404, as for a members record', async () => {
    const anon = await readRec();
    assert(anon.status === 404, `anonymous ${anon.status} ${JSON.stringify(anon.body)}`);
});

await test('5. A naming an organism A is not in: 400 NOT_ORGANISM_MEMBER and nothing stored (POST, PATCH, bulk)', async () => {
    const k = `aud.refused.${stamp}`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: k, value: 1, visibility: `organism:${otherOrgId}` }) });
    assert(w.status === 400 && w.body.error?.code === 'NOT_ORGANISM_MEMBER', `POST ${w.status} ${JSON.stringify(w.body)}`);
    const own = await json(`/v1/memory/${encodeURIComponent(k)}`, { headers: auth(A.token) });
    assert(own.status === 404, `stored anyway: ${own.status} ${JSON.stringify(own.body)}`);
    const p = await json(`/v1/memory/${encodeURIComponent(k)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ patch: { a: 1 }, visibility: `organism:${otherOrgId}` }) });
    assert(p.status === 400 && p.body.error?.code === 'NOT_ORGANISM_MEMBER', `PATCH ${p.status} ${JSON.stringify(p.body)}`);
    const again = await json(`/v1/memory/${encodeURIComponent(k)}`, { headers: auth(A.token) });
    assert(again.status === 404, `PATCH stored anyway: ${again.status}`);
    const bulk = await json('/v1/memory/bulk', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ entries: [{ key: k, value: 1, visibility: `organism:${otherOrgId}` }] }) });
    assert(bulk.status === 200, `bulk ${bulk.status} ${JSON.stringify(bulk.body)}`);
    assert((bulk.body.data.failed ?? []).some((f: any) => f.key === k && String(f.reason).startsWith('NOT_ORGANISM_MEMBER')), `bulk entry not refused: ${JSON.stringify(bulk.body.data)}`);
    const third = await json(`/v1/memory/${encodeURIComponent(k)}`, { headers: auth(A.token) });
    assert(third.status === 404, `bulk stored anyway: ${third.status}`);
});

await test('6. A malformed organism id is 400 on POST /v1/memory', async () => {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `aud.bad.${stamp}`, value: 1, visibility: 'organism:' }) });
    assert(w.status === 400, `bad id ${w.status} ${JSON.stringify(w.body)}`);
});

// ─── Stored files (V3.3) ───

await test('7. A uploads a file visible to the organism (201)', async () => {
    const u = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: fileKey, data: content, mime_type: 'text/plain', visibility: `organism:${orgId}` }) });
    assert(u.status === 201, `upload ${u.status} ${JSON.stringify(u.body)}`);
    assert(u.body.data.visibility === `organism:${orgId}`, `visibility ${u.body.data.visibility}`);
    assert(u.body.data.owner_gaii === aGhii, `owner ${u.body.data.owner_gaii} vs ${aGhii}`);
});

await test('8. B and B\'s agent read the file through /v1/pub (200, the bytes)', async () => {
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(aGhii)}/${fileKey}`, { headers: auth(B.token) });
    assert(res.status === 200, `B ${res.status}`);
    assert((await res.text()) === 'organism audience file', 'B got other bytes');
    const ba = await readFile(fileKey, bAgent.token);
    assert(ba.status === 200, `B's agent ${ba.status} ${JSON.stringify(ba.body)}`);
});

await test('9. C and C\'s agent get 403 NOT_ORGANISM_MEMBER; anonymous gets 404', async () => {
    const c = await readFile(fileKey, C.token);
    assert(c.status === 403 && c.body.error?.code === 'NOT_ORGANISM_MEMBER', `C ${c.status} ${JSON.stringify(c.body)}`);
    const ca = await readFile(fileKey, cAgent.token);
    assert(ca.status === 403 && ca.body.error?.code === 'NOT_ORGANISM_MEMBER', `C's agent ${ca.status} ${JSON.stringify(ca.body)}`);
    const anon = await readFile(fileKey);
    assert(anon.status === 404, `anonymous ${anon.status}`);
});

await test('10. Upload naming an organism A is not in: 400, nothing stored', async () => {
    const k = `aud-refused-${stamp}.txt`;
    const u = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: k, data: content, mime_type: 'text/plain', visibility: `organism:${otherOrgId}` }) });
    assert(u.status === 400 && u.body.error?.code === 'NOT_ORGANISM_MEMBER', `upload ${u.status} ${JSON.stringify(u.body)}`);
    const own = await json(`/v1/storage/${k}`, { headers: auth(A.token) });
    assert(own.status === 404, `stored anyway: ${own.status}`);
});

await test('11. Presigned and chunked uploads refuse the same organism before any byte (400)', async () => {
    const p = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `aud-pre-${stamp}.txt`, mode: 'presigned', mime_type: 'text/plain', visibility: `organism:${otherOrgId}` }) });
    assert(p.status === 400 && p.body.error?.code === 'NOT_ORGANISM_MEMBER' && !p.body.data?.upload_url, `presigned ${p.status} ${JSON.stringify(p.body)}`);
    const c = await json('/v1/storage/upload/init', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `aud-chunk-${stamp}.bin`, mime_type: 'application/octet-stream', chunk_size: 1024, visibility: `organism:${otherOrgId}` }) });
    assert(c.status === 400 && c.body.error?.code === 'NOT_ORGANISM_MEMBER', `chunked ${c.status} ${JSON.stringify(c.body)}`);
});

await test('12. A presigned upload to A\'s own organism lands with that visibility and B reads it', async () => {
    const k = `aud-pre-ok-${stamp}.txt`;
    const p = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: k, mode: 'presigned', mime_type: 'text/plain', visibility: `organism:${orgId}` }) });
    assert(p.status === 200 && p.body.data.upload_url, `mint ${p.status} ${JSON.stringify(p.body)}`);
    const put = await fetch(p.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'presigned organism bytes' });
    assert(put.status === 200, `PUT ${put.status} ${await put.text()}`);
    const b = await readFile(k, B.token);
    assert(b.status === 200, `B ${b.status}`);
    const c = await readFile(k, C.token);
    assert(c.status === 403, `C ${c.status}`);
});

// ─── PATCH /v1/storage/{key}/visibility ───

await test('13. A private file is refused to B (403); PATCH to the organism admits B', async () => {
    const u = await json('/v1/storage', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: patchFileKey, data: content, mime_type: 'text/plain' }) });
    assert(u.status === 201, `upload ${u.status}`);
    const before = await readFile(patchFileKey, B.token);
    assert(before.status === 403, `B before ${before.status}`);
    const p = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${orgId}` }) });
    assert(p.status === 200 && p.body.data.visibility === `organism:${orgId}`, `PATCH ${p.status} ${JSON.stringify(p.body)}`);
    const after = await readFile(patchFileKey, B.token);
    assert(after.status === 200, `B after ${after.status}`);
    const c = await readFile(patchFileKey, C.token);
    assert(c.status === 403, `C ${c.status}`);
});

await test('14. PATCH back to private refuses B again; PATCH to members admits C', async () => {
    const p = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'private' }) });
    assert(p.status === 200 && p.body.data.visibility === 'private', `PATCH ${p.status}`);
    const b = await readFile(patchFileKey, B.token);
    assert(b.status === 403, `B after private ${b.status}`);
    const m = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'members' }) });
    assert(m.status === 200 && m.body.data.visibility === 'members', `PATCH members ${m.status} ${JSON.stringify(m.body)}`);
    const c = await readFile(patchFileKey, C.token);
    assert(c.status === 200, `C on members ${c.status}`);
});

await test('15. PATCH to an organism A is not in, or to an unknown word: 400 and the file keeps its visibility', async () => {
    const p = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${otherOrgId}` }) });
    assert(p.status === 400 && p.body.error?.code === 'NOT_ORGANISM_MEMBER', `PATCH ${p.status} ${JSON.stringify(p.body)}`);
    const q = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'everyone' }) });
    assert(q.status === 400, `unknown word ${q.status}`);
    const list = await json('/v1/storage', { headers: auth(A.token) });
    const f = (list.body.data.files ?? []).find((x: any) => x.key === patchFileKey);
    assert(f?.visibility === 'members', `file visibility now ${f?.visibility}`);
    // Another owner cannot change A's file: it is looked up in the caller's own namespace.
    const other = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', headers: auth(C.token), body: JSON.stringify({ visibility: 'public' }) });
    assert(other.status === 404, `C changed A's file: ${other.status}`);
    // Nobody signed in changes a visibility at all.
    const anon = await json(`/v1/storage/${patchFileKey}/visibility`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });
    assert(anon.status === 401, `anonymous PATCH ${anon.status}`);
});

await test('16. B leaves the organism and loses the read of the record and the file', async () => {
    const l = await json(`/v1/organisms/${orgId}/leave`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(l.status === 200, `leave ${l.status} ${JSON.stringify(l.body)}`);
    const r = await readRec(B.token);
    assert(r.status === 403, `B record after leaving ${r.status}`);
    const f = await readFile(fileKey, B.token);
    assert(f.status === 403, `B file after leaving ${f.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/memory/${encodeURIComponent(recKey)}`, { method: 'DELETE', headers: auth(A.token) });
    for (const k of [fileKey, patchFileKey, `aud-pre-ok-${stamp}.txt`]) await json(`/v1/storage/${k}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/organisms/${otherOrgId}`, { method: 'DELETE', headers: auth(C.token) });
    for (const o of [A, B, C]) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: auth(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

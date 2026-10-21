/**
 * @file e2e-publish-gate-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish gate on stored files and on the memory routes the first gate left
 *   open (plan doc-mvcn6c7e4e5q, V4): POST /v1/memory/bulk, POST /v1/memory/import and
 *   POST /v1/memory/copy. Asserted, with the gate at agents-and-apps:
 *     - a stored file made public by an agent without publish:public is stored private and answers 202
 *       with a request of kind 'file', on every upload route (POST /v1/storage inline and presigned,
 *       POST /v1/memory/files inline and presigned, the chunked upload, aimeat_storage_upload) and
 *       on both visibility PATCH routes; anonymous cannot read it at /v1/pub;
 *     - the owner approves: the file is public and anonymous reads it; a file uploaded again after the
 *       request is not published by its approval (409 OUTDATED);
 *     - an agent holding publish:public, and the owner in person, make a file public at once;
 *     - an app grant without publish:public gets a private file and a request (the road
 *       AIMEAT.assets.upload takes); with the word, a public file;
 *     - bulk and import: each entry that raises its record to public lands private and gets its own
 *       request, listed per entry, and the answer is 202; an entry already public stays public with
 *       no request; approval publishes; a record written again is 409 OUTDATED;
 *     - copy: a copy made public lands private and answers 202 with a request; approval publishes;
 *     - gate off (the code default): the same agent's uploads, bulk and copy are public at once;
 *     - a refusal: the asker cannot decide its own request (403 OWN_REQUEST).
 * @version-history
 *   v1.1.0 — 2026-10-20 — A presigned upload URL does not outlive its agent: deleted (or registered
 *     again under the released name) after the mint, the PUT is refused 401 and nothing is stored; an
 *     agent that lost publish:public after the mint gets a private file and a request (202), as its
 *     inline write does (secaudit 2026-10, PUT-v1-upload:no-live-principal-recheck).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: stored files and the memory batch routes).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-gate-files

import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
/** PUT raw bytes (a presigned URL or a chunk). */
async function putBytes(url: string, bytes: Buffer, token?: string): Promise<{ status: number; body: Body }> {
    const res = await fetch(url.startsWith('http') ? url : BASE + url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n=== AIMEAT Publish Gate (stored files, memory bulk/import/copy) E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;
const WORDS = ['memory:read', 'memory:write', 'storage:read', 'storage:write'];

const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
/** The file as a stranger reads it: 200 only when it is public. */
const anonFile = (owner: string, key: string) => call(`/v1/pub/${encodeURIComponent(owner)}/${key}`);
/** The record as a stranger reads it: 200 only when it is public. */
const anonRecord = (owner: string, key: string) => call(`/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`);
const approve = (id: string, token = A.token) => call(`/v1/publish-requests/${id}/decision`, { token, method: 'POST', body: { decision: 'approve' } });
const upload = (token: string, key: string, visibility: string, text = key) =>
    call('/v1/storage', { token, body: { key, data: b64(text), mime_type: 'text/plain', visibility } });

await test('Setup: an operator, owner A with an agent without publish:public and one with it', async () => {
    op = await registerOwner(BASE, `pgfop${stamp}`);
    A = await registerOwner(BASE, `pgfa${stamp}`);
    asker = await makeAgent(BASE, A, WORDS);
    publisher = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
});

await test('Gate off (the code default): the agent\'s public upload, bulk entry and copy are public at once', async () => {
    const key = `pgf-off-${stamp}.txt`;
    const u = await upload(asker.token, key, 'public');
    assert(u.status === 201 && u.body.data.visibility === 'public' && !u.body.data.publish_request, `upload: ${u.status} ${JSON.stringify(u.body.error ?? u.body.data?.visibility)}`);
    assert((await anonFile(asker.gaii, key)).status === 200, 'anonymous reads the public file');
    const bk = `pgf.off.bulk.${stamp}`;
    const b = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [{ key: bk, value: { n: 1 }, visibility: 'public' }] } });
    assert(b.status === 200 && b.body.data.created === 1 && !b.body.data.publish_requests, `bulk: ${b.status} ${JSON.stringify(b.body.data ?? b.body.error)}`);
    assert((await anonRecord(asker.gaii, bk)).status === 200, 'anonymous reads the bulk record');
    const src = `pgf.off.src.${stamp}`;
    assert((await call('/v1/memory', { token: publisher.token, body: { key: src, value: { n: 2 }, visibility: 'public' } })).status === 201, 'copy source');
    const c = await call('/v1/memory/copy', { token: asker.token, body: { source_gaii: publisher.gaii, key: src, visibility: 'public' } });
    assert(c.status === 200 && c.body.data.visibility === 'public' && !c.body.data.publish_request, `copy: ${c.status} ${JSON.stringify(c.body.error ?? c.body.data)}`);
    assert((await anonRecord(asker.gaii, src)).status === 200, 'anonymous reads the copy');
});

let firstRequest = '';
const askedKey = `pgf-asked-${stamp}.txt`;
await test('Gate agents-and-apps: POST /v1/storage public answers 202 with a file request, the file is private', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body.error)}`);
    const u = await upload(asker.token, askedKey, 'public');
    assert(u.status === 202, `upload: ${u.status} ${JSON.stringify(u.body.error ?? u.body.data)}`);
    assert(u.body.data.visibility === 'private', `stored as ${u.body.data.visibility}`);
    const pr = u.body.data.publish_request;
    assert(pr && pr.kind === 'file' && pr.status === 'awaiting_owner' && typeof pr.approve_url === 'string', `request: ${JSON.stringify(pr)}`);
    firstRequest = pr.request_id;
    assert((await anonFile(asker.gaii, askedKey)).status !== 200, 'anonymous does not read the waiting file');
    const l = await call('/v1/publish-requests', { token: A.token });
    assert((l.body.data.requests as Body[]).some(r => r.id === firstRequest && r.kind === 'file'), 'the owner lists the file request');
});

await test('The asker cannot decide its own request (403 OWN_REQUEST)', async () => {
    const own = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: asker.token, method: 'POST', body: { decision: 'approve' } });
    assert(own.status === 403 && own.body.error.code === 'OWN_REQUEST', `own: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('The owner approves: the file is public and anonymous reads it', async () => {
    const d = await approve(firstRequest);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    const r = await anonFile(asker.gaii, askedKey);
    assert(r.status === 200, `anonymous read after approval: ${r.status}`);
});

await test('A file uploaded again after the request is not published by its approval (409 OUTDATED)', async () => {
    const key = `pgf-changed-${stamp}.txt`;
    const u = await upload(asker.token, key, 'public', 'benign');
    assert(u.status === 202, `upload: ${u.status}`);
    const again = await upload(asker.token, key, 'private', 'something else entirely');
    assert(again.status === 201 && !again.body.data.publish_request, `upload again: ${again.status}`);
    const d = await approve(u.body.data.publish_request.request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonFile(asker.gaii, key)).status !== 200, 'still not public');
});

await test('PATCH /v1/storage/{key}/visibility asks the same way; approval publishes', async () => {
    const key = `pgf-patch-${stamp}.txt`;
    assert((await upload(asker.token, key, 'private')).status === 201, 'private upload');
    const p = await call(`/v1/storage/${key}/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 202 && p.body.data.visibility === 'private' && p.body.data.publish_request?.kind === 'file', `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
    assert((await anonFile(asker.gaii, key)).status !== 200, 'not public while waiting');
    const d = await approve(p.body.data.publish_request.request_id);
    assert(d.status === 200, `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonFile(asker.gaii, key)).status === 200, 'public after approval');
});

await test('POST /v1/memory/files and its visibility PATCH ask the same way', async () => {
    const key = `pgf-mf-${stamp}.txt`;
    const u = await call('/v1/memory/files', { token: asker.token, body: { key, content: b64('memory file'), mime_type: 'text/plain', visibility: 'public' } });
    assert(u.status === 202 && u.body.data.visibility === 'private' && u.body.data.publish_request, `upload: ${u.status} ${JSON.stringify(u.body.error ?? u.body.data)}`);
    const key2 = `pgf-mf2-${stamp}.txt`;
    assert((await call('/v1/memory/files', { token: asker.token, body: { key: key2, content: b64('x'), mime_type: 'text/plain' } })).status === 201, 'private upload');
    const p = await call(`/v1/memory/files/${key2}/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 202 && p.body.data.visibility === 'private' && p.body.data.publish_request, `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
    assert((await anonFile(asker.gaii, key2)).status !== 200, 'not public while waiting');
});

await test('A presigned upload (both mint routes) asked as public lands private and answers 202 with the request', async () => {
    for (const [path, body] of [
        ['/v1/storage', { key: `pgf-pre-${stamp}.txt`, mode: 'presigned', mime_type: 'text/plain', visibility: 'public' }],
        ['/v1/memory/files', { key: `pgf-pre2-${stamp}.txt`, mode: 'presigned', mime_type: 'text/plain', visibility: 'public' }],
    ] as const) {
        const m = await call(path, { token: asker.token, body });
        assert(m.status === 200 && typeof m.body.data.upload_url === 'string', `${path} mint: ${m.status} ${JSON.stringify(m.body.error)}`);
        const put = await putBytes(m.body.data.upload_url, Buffer.from('presigned bytes'));
        assert(put.status === 202 && put.body.visibility === 'private' && put.body.publish_request?.kind === 'file', `${path} put: ${put.status} ${JSON.stringify(put.body)}`);
        assert((await anonFile(asker.gaii, body.key)).status !== 200, `${path}: not public while waiting`);
    }
});

await test('The chunked upload asked as public lands private and answers 202 with the request', async () => {
    const key = `pgf-chunked-${stamp}.txt`;
    const bytes = Buffer.from('chunked bytes');
    const init = await call('/v1/storage/upload/init', { token: asker.token, body: { key, mime_type: 'text/plain', chunk_size: 1024, total_chunks: 1, visibility: 'public' } });
    assert(init.status === 201, `init: ${init.status} ${JSON.stringify(init.body.error)}`);
    const id = init.body.data.upload_id as string;
    const c = await putBytes(`/v1/storage/upload/${id}/0`, bytes, asker.token);
    assert(c.status === 200, `chunk: ${c.status} ${JSON.stringify(c.body)}`);
    const done = await call(`/v1/storage/upload/${id}/complete`, { token: asker.token, body: {} });
    assert(done.status === 202 && done.body.data.visibility === 'private' && done.body.data.publish_request, `complete: ${done.status} ${JSON.stringify(done.body.error ?? done.body.data)}`);
    assert((await anonFile(asker.gaii, key)).status !== 200, 'not public while waiting');
});

await test('MCP: aimeat_storage_upload answers publish_request and stores the file private', async () => {
    const s = await openSession(BASE, asker.token);
    const key = `pgf-mcp-${stamp}.txt`;
    const w = await callTool(s, 'aimeat_storage_upload', { key, data_base64: b64('mcp bytes'), mime_type: 'text/plain', visibility: 'public' });
    assert(!w.isError && w.text.includes('publish_request') && w.text.includes('approve_url'), `upload: ${w.text.slice(0, 300)}`);
    assert((await anonFile(asker.gaii, key)).status !== 200, 'not public while waiting');
});

await test('An agent holding publish:public, and the owner in person, make a file public at once', async () => {
    const pk = `pgf-pub-${stamp}.txt`;
    const p = await upload(publisher.token, pk, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public', `publisher: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.visibility)}`);
    const ok = `pgf-owner-${stamp}.txt`;
    const o = await upload(A.token, ok, 'public');
    assert(o.status === 201 && o.body.data.visibility === 'public', `owner: ${o.status} ${JSON.stringify(o.body.error ?? o.body.data?.visibility)}`);
    assert((await anonFile(o.body.data.owner_gaii, ok)).status === 200, 'anonymous reads the owner\'s file');
});

// An app grant: authorize with PKCE, the owner consents, the code is exchanged (as e2e-publish-gate.ts).
const REDIRECT = 'http://localhost:9911/callback';
async function appGrant(owner: { name: string; token: string }, filename: string, scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /\/v1\/app-grant\?req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(m, `authorize: ${res.status} ${res.headers.get('location')}`);
    const c = await call('/v1/app-grants/authorize-consent', { token: owner.token, body: { request_id: decodeURIComponent(m[1]) } });
    assert(c.status === 200, `consent: ${c.status} ${JSON.stringify(c.body.error)}`);
    const code = new URL(c.body.data.redirect_url).searchParams.get('code');
    const t = await call('/v1/app-grants/token', { body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT } });
    assert(t.status === 200, `token: ${t.status} ${JSON.stringify(t.body.error)}`);
    return t.body.data.access_token as string;
}

await test('An app grant without publish:public (AIMEAT.assets.upload) gets a private file and a request; with it, a public file', async () => {
    for (const f of [`pgf-ask-${stamp}.html`, `pgf-pub-${stamp}.html`]) {
        const a = await call('/v1/apps', { token: A.token, body: { filename: f, content: b64(`<!DOCTYPE html><html><body>${f}</body></html>`), mime_type: 'text/html', description: 'Publish gate fixture' } });
        assert(a.status === 201, `app ${f}: ${a.status} ${JSON.stringify(a.body.error)}`);
    }
    const narrow = await appGrant(A, `pgf-ask-${stamp}.html`, 'storage:write');
    const key = `pgf-app/images/hero-${stamp}.txt`;
    const w = await upload(narrow, key, 'public');
    assert(w.status === 202 && w.body.data.visibility === 'private' && w.body.data.publish_request?.kind === 'file', `app without the word: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
    assert((await anonFile(w.body.data.owner_gaii, key)).status !== 200, 'the asset is not public while waiting');
    const d = await approve(w.body.data.publish_request.request_id);
    assert(d.status === 200, `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonFile(w.body.data.owner_gaii, key)).status === 200, 'the asset is public after approval');
    const wide = await appGrant(A, `pgf-pub-${stamp}.html`, 'storage:write publish:public');
    const p = await upload(wide, `pgf-app/images/wide-${stamp}.txt`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public', `app with the word: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.visibility)}`);
});

await test('POST /v1/memory/bulk: each entry raised to public lands private with its own request (202); approval publishes', async () => {
    const already = `pgf.bulk.already.${stamp}`;
    const w = await call('/v1/memory', { token: publisher.token, body: { key: already, value: { n: 0 }, visibility: 'public' } });
    assert(w.status === 201, `seed: ${w.status}`);
    const k1 = `pgf.bulk.a.${stamp}`, k2 = `pgf.bulk.b.${stamp}`, k3 = `pgf.bulk.c.${stamp}`;
    const b = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [
        { key: k1, value: { n: 1 }, visibility: 'public' },
        { key: k2, value: { n: 2 }, visibility: 'public' },
        { key: k3, value: { n: 3 }, visibility: 'private' },
    ] } });
    assert(b.status === 202 && b.body.data.created === 3, `bulk: ${b.status} ${JSON.stringify(b.body.error ?? b.body.data)}`);
    const reqs = b.body.data.publish_requests as Body[];
    assert(reqs.length === 2 && reqs.every(r => r.kind === 'memory' && r.status === 'awaiting_owner') && reqs.map(r => r.key).sort().join() === [k1, k2].sort().join(),
        `requests per entry: ${JSON.stringify(reqs)}`);
    assert((await anonRecord(asker.gaii, k1)).status !== 200, 'not public while waiting');
    const d = await approve(reqs.find(r => r.key === k1)!.request_id);
    assert(d.status === 200, `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonRecord(asker.gaii, k1)).status === 200, 'public after approval');
    // The publisher's record already public: kept public, nothing asked (it writes as itself).
    const keep = await call('/v1/memory/bulk', { token: publisher.token, body: { entries: [{ key: already, value: { n: 0.5 }, visibility: 'public' }] } });
    assert(keep.status === 200 && !keep.body.data.publish_requests, `publisher keeps public: ${keep.status}`);
    // A record the asker made public through approval stays public when it writes it again as public.
    const again = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [{ key: k1, value: { n: 1.5 }, visibility: 'public' }] } });
    assert(again.status === 200 && !again.body.data.publish_requests, `already public: ${again.status} ${JSON.stringify(again.body.data)}`);
    assert((await anonRecord(asker.gaii, k1)).status === 200, 'still public');
});

await test('A bulk entry written again after its request is not published by the approval (409 OUTDATED)', async () => {
    const key = `pgf.bulk.changed.${stamp}`;
    const b = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [{ key, value: { n: 'benign' }, visibility: 'public' }] } });
    assert(b.status === 202, `bulk: ${b.status}`);
    const again = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [{ key, value: { n: 'other' }, visibility: 'private' }] } });
    assert(again.status === 200, `rewrite: ${again.status}`);
    const d = await approve(b.body.data.publish_requests[0].request_id);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
});

await test('POST /v1/memory/import asks per entry the same way', async () => {
    const k1 = `pgf.import.a.${stamp}`, k2 = `pgf.import.b.${stamp}`;
    const i = await call('/v1/memory/import', { token: asker.token, body: { mode: 'overwrite', entries: [
        { key: k1, value: { n: 1 }, visibility: 'public' },
        { key: k2, value: { n: 2 } },
    ] } });
    assert(i.status === 202 && i.body.data.created === 2, `import: ${i.status} ${JSON.stringify(i.body.error ?? i.body.data)}`);
    const reqs = i.body.data.publish_requests as Body[];
    assert(reqs.length === 1 && reqs[0].key === k1 && reqs[0].kind === 'memory', `requests: ${JSON.stringify(reqs)}`);
    assert((await anonRecord(asker.gaii, k1)).status !== 200, 'not public while waiting');
    assert((await approve(reqs[0].request_id)).status === 200, 'approve');
    assert((await anonRecord(asker.gaii, k1)).status === 200, 'public after approval');
});

await test('POST /v1/memory/copy made public lands private and answers 202 with a request; approval publishes', async () => {
    const src = `pgf.copy.src.${stamp}`;
    assert((await call('/v1/memory', { token: publisher.token, body: { key: src, value: { n: 'shared' }, visibility: 'public' } })).status === 201, 'source');
    const c = await call('/v1/memory/copy', { token: asker.token, body: { source_gaii: publisher.gaii, key: src, visibility: 'public' } });
    assert(c.status === 202 && c.body.data.visibility === 'private' && c.body.data.publish_request?.kind === 'memory', `copy: ${c.status} ${JSON.stringify(c.body.error ?? c.body.data)}`);
    assert((await anonRecord(asker.gaii, src)).status !== 200, 'the copy is not public while waiting');
    assert((await approve(c.body.data.publish_request.request_id)).status === 200, 'approve');
    assert((await anonRecord(asker.gaii, src)).status === 200, 'the copy is public after approval');
    const direct = await call('/v1/memory/copy', { token: publisher.token, body: { source_gaii: asker.gaii, key: src, visibility: 'public' } });
    assert(direct.status === 200 && direct.body.data.visibility === 'public', `publisher copies public at once: ${direct.status} ${JSON.stringify(direct.body.error ?? direct.body.data)}`);
});

await test('The owner in person bulk-writes public at once', async () => {
    const key = `pgf.bulk.owner.${stamp}`;
    const b = await call('/v1/memory/bulk', { token: A.token, body: { entries: [{ key, value: { n: 1 }, visibility: 'public' }] } });
    assert(b.status === 200 && !b.body.data.publish_requests, `owner bulk: ${b.status} ${JSON.stringify(b.body.error ?? b.body.data)}`);
});

// ── A presigned URL does not outlive its agent or the permission it was minted with ──
// secaudit 2026-10, PUT-v1-upload:no-live-principal-recheck. The PUT verified the signed token alone:
// an agent the owner deleted wrote through a URL it minted earlier, under its deleted GAII, as public;
// and an agent that lost publish:public after the mint still made the file public.
const mintPublic = (token: string, key: string) =>
    call('/v1/storage', { token, body: { key, mode: 'presigned', mime_type: 'text/plain', visibility: 'public' } });

await test('Control: an agent that still holds publish:public PUTs a public presigned upload, stored public (200)', async () => {
    const key = `pgf-live-${stamp}.txt`;
    const m = await mintPublic(publisher.token, key);
    assert(m.status === 200, `mint: ${m.status} ${JSON.stringify(m.body.error)}`);
    const put = await putBytes(m.body.data.upload_url, Buffer.from('still allowed'));
    assert(put.status === 200 && put.body.visibility === 'public' && !put.body.publish_request, `put: ${put.status} ${JSON.stringify(put.body)}`);
    assert((await anonFile(publisher.gaii, key)).status === 200, 'anonymous reads it');
});

await test('An agent deleted after the mint: the PUT is refused 401 and nothing is stored', async () => {
    const doomed = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
    const key = `pgf-gone-${stamp}.txt`;
    const m = await mintPublic(doomed.token, key);
    assert(m.status === 200, `mint: ${m.status} ${JSON.stringify(m.body.error)}`);
    const del = await call(`/v1/agents/${doomed.name}`, { token: A.token, method: 'DELETE' });
    assert(del.status === 200, `delete: ${del.status} ${JSON.stringify(del.body.error)}`);
    const put = await putBytes(m.body.data.upload_url, Buffer.from('written after the delete'));
    assert(put.status === 401 && put.body.error === 'TOKEN_INVALID', `put: ${put.status} ${JSON.stringify(put.body)}`);
    assert(/no longer exists/i.test(String(put.body.message)), `the refusal says why: ${put.body.message}`);
    assert((await anonFile(doomed.gaii, key)).status === 404, 'nothing is served at the public address');
    // The owner reads everything their agents hold, so this is the read that would find the file.
    const own = await call(`/v1/pub/${encodeURIComponent(doomed.gaii)}/${key}`, { token: A.token });
    assert(own.status === 404, `nothing is stored under the deleted agent: ${own.status}`);
});

await test('An agent re-registered under the deleted name is a new principal: the old URL stays refused', async () => {
    const name = `pgfre${stamp.toString(36).slice(-5)}`;
    const first = await makeAgent(BASE, A, [...WORDS, 'publish:public'], name);
    const m = await mintPublic(first.token, `pgf-reborn-${stamp}.txt`);
    assert(m.status === 200, `mint: ${m.status}`);
    assert((await call(`/v1/agents/${name}`, { token: A.token, method: 'DELETE' })).status === 200, 'delete');
    await new Promise(r => setTimeout(r, 5));
    await makeAgent(BASE, A, [...WORDS, 'publish:public'], name);
    const put = await putBytes(m.body.data.upload_url, Buffer.from('the old URL of a released name'));
    assert(put.status === 401, `put: ${put.status} ${JSON.stringify(put.body)}`);
});

await test('An agent that lost publish:public after the mint: the PUT stores it private with a request (202)', async () => {
    const narrowed = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
    const key = `pgf-narrowed-${stamp}.txt`;
    const m = await mintPublic(narrowed.token, key);
    assert(m.status === 200, `mint: ${m.status} ${JSON.stringify(m.body.error)}`);
    const p = await call(`/v1/agents/${narrowed.name}/scopes`, { token: A.token, method: 'PATCH', body: { scopes: WORDS } });
    assert(p.status === 200, `narrow: ${p.status} ${JSON.stringify(p.body.error)}`);
    const put = await putBytes(m.body.data.upload_url, Buffer.from('written after the narrowing'));
    assert(put.status === 202 && put.body.visibility === 'private' && put.body.publish_request?.kind === 'file', `put: ${put.status} ${JSON.stringify(put.body)}`);
    assert((await anonFile(narrowed.gaii, key)).status !== 200, 'anonymous does not read it');
});

await test('Control: the owner in person PUTs a public presigned upload, stored public at once', async () => {
    const key = `pgf-owner-pre-${stamp}.txt`;
    const m = await mintPublic(A.token, key);
    assert(m.status === 200, `mint: ${m.status} ${JSON.stringify(m.body.error)}`);
    const put = await putBytes(m.body.data.upload_url, Buffer.from('the owner in person'));
    assert(put.status === 200 && put.body.visibility === 'public', `put: ${put.status} ${JSON.stringify(put.body)}`);
});

await test('Cleanup: the gate back to off', async () => {
    const g = await setGate('off');
    assert(g.status === 200, `gate off: ${g.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);

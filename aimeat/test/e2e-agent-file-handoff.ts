/**
 * @file test/e2e-agent-file-handoff.ts
 * @description E2E for handing a FILE to an agent — the path that turns "here is a PDF, read it" into
 *   something an agent can actually do. Storage is keyed by (owner, key), and every agent-facing read
 *   used to be namespaced to the caller, so a document its owner uploaded answered "not found" while
 *   being perfectly readable by policy. This suite locks the whole chain:
 *
 *     1. visibility:'owner' + GET /v1/pub/{owner}/{key} with the AGENT's token → bytes, unchanged
 *     2. ?mode=handle on the same route → a presigned URL instead of the bytes
 *     3. a DM attachment exposes a `ref` the agent can open
 *     4. a TASK carries file attachments, and task detail hands the agent a presigned download_url
 *     5. the refusals: private stays private, a foreign agent is refused, a file the creator cannot
 *        read cannot be attached, and an anonymous caller gets nothing
 *
 *   Binary integrity is asserted with sha256 over a payload containing non-UTF8 bytes — a JSON/UTF-8
 *   round trip silently replaces those, which is exactly how "the download works" hides corruption.
 * @usage cd aimeat && pnpm exec node --import tsx test/run-e2e-ci.ts --test=agent-file-handoff
 * @version-history
 *   v1.0.0 -- 2026-07-26 -- Initial: file handoff to agents (owner-visibility read, DM ref, task files).
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(subject: string, priv: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? subject + timestamp : subject + NODE_ID + timestamp;
    const signature = await signMsg(priv, message);
    const payload = isAgent ? { gaii: subject, timestamp, signature } : { owner: subject, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// A payload with bytes no UTF-8 round trip survives — the only honest way to prove a binary read.
const fileBytes = Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'ascii'),
    randomBytes(4096),
    Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x81]),
    Buffer.from('\n%%EOF\n', 'ascii'),
]);
const fileB64 = fileBytes.toString('base64');
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');
const EXPECT = sha(fileBytes);

const stamp = Date.now();
const ownerName = `fhown${stamp}`;
const otherName = `fhoth${stamp}`;
const AGENT = 'fh-reader';
const KEY_OWNER_VIS = 'handoff/invoice-owner.pdf';
const KEY_PRIVATE = 'handoff/invoice-private.pdf';
const OTHER_KEY = 'handoff/secret.pdf';

let ownerToken = '', ownerGhii = '', agentGaii = '', agentToken = '';
let otherToken = '', otherGhii = '', otherAgentToken = '';

console.log('\n=== AIMEAT Agent File Handoff E2E ===\n');
console.log('Setup');

await test('register owner + agent, and a second owner with an agent', async () => {
    const o = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(o.status === 201, `owner: ${o.status} ${JSON.stringify(o.body)}`);
    ownerToken = await getToken(ownerName, o.body.data.private_key, false);
    ownerGhii = `${ownerName}@${NODE_ID}`;

    const a = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: AGENT, owner: ownerName, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(a.status === 201, `agent: ${a.status} ${JSON.stringify(a.body)}`);
    agentGaii = a.body.data.agent.gaii;
    agentToken = await getToken(agentGaii, a.body.data.private_key, true);

    const o2 = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherName, public_key: 'placeholder' }) });
    assert(o2.status === 201, `owner2: ${o2.status}`);
    otherToken = await getToken(otherName, o2.body.data.private_key, false);
    otherGhii = `${otherName}@${NODE_ID}`;
    const a2 = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
        body: JSON.stringify({ name: 'fh-outsider', owner: otherName, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(a2.status === 201, `agent2: ${a2.status}`);
    otherAgentToken = await getToken(a2.body.data.agent.gaii, a2.body.data.private_key, true);
});

await test('owner uploads the document twice: default private, and visibility:"owner"', async () => {
    const p = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: KEY_PRIVATE, data: fileB64, mime_type: 'application/pdf' }),
    });
    assert(p.status === 201, `private: ${p.status} ${JSON.stringify(p.body)}`);
    assert(p.body.data.visibility === 'private', `visibility ${p.body.data.visibility}`);

    const w = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: KEY_OWNER_VIS, data: fileB64, mime_type: 'application/pdf', visibility: 'owner' }),
    });
    assert(w.status === 201, `owner-vis: ${w.status} ${JSON.stringify(w.body)}`);
    assert(w.body.data.visibility === 'owner', `visibility ${w.body.data.visibility}`);
});

await test('second owner uploads a private file of their own', async () => {
    const r = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
        body: JSON.stringify({ key: OTHER_KEY, data: fileB64, mime_type: 'application/pdf' }),
    });
    assert(r.status === 201, `other upload: ${r.status}`);
});

// ─── Phase 1: reading a file the agent does not own ───
console.log('\nPhase 1 — Agent reads its owner\'s document');

await test('1. /v1/storage is own-namespace only, and the 404 names the alternative', async () => {
    const r = await json(`/v1/storage/${KEY_OWNER_VIS}`, { headers: { Authorization: `Bearer ${agentToken}` } });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(String(r.body?.error?.message ?? '').includes('/v1/pub/'), `404 should point at /v1/pub: ${JSON.stringify(r.body?.error)}`);
});

await test('2. GET /v1/pub/{owner}/{key} with the agent token → 200 and byte-identical', async () => {
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_OWNER_VIS}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.headers.get('content-type') === 'application/pdf', `ct: ${res.headers.get('content-type')}`);
    const got = Buffer.from(await res.arrayBuffer());
    assert(got.length === fileBytes.length, `size ${got.length} != ${fileBytes.length}`);
    assert(sha(got) === EXPECT, 'sha256 mismatch — the bytes were altered in transit');
});

await test('3. ?mode=handle returns a presigned URL that fetches the same bytes', async () => {
    const h = await json(`/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_OWNER_VIS}?mode=handle`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(h.status === 200, `handle: ${h.status} ${JSON.stringify(h.body)}`);
    assert(h.body.data?.ref === `${ownerGhii}/${KEY_OWNER_VIS}`, `ref: ${h.body.data?.ref}`);
    assert(h.body.data?.mime_type === 'application/pdf', `mime: ${h.body.data?.mime_type}`);
    // A foreign handle deliberately expires sooner than an own-file handle.
    assert(h.body.data?.expires_in_seconds === 900, `ttl: ${h.body.data?.expires_in_seconds}`);
    const url = h.body.data?.download_url as string;
    assert(typeof url === 'string' && url.includes('/v1/download/'), `download_url: ${url}`);
    const dl = await fetch(url);
    assert(dl.status === 200, `presigned download: ${dl.status}`);
    assert(sha(Buffer.from(await dl.arrayBuffer())) === EXPECT, 'sha256 mismatch on presigned download');
});

// ─── Phase 2: the refusals ───
console.log('\nPhase 2 — What must stay refused');

await test('4. the PRIVATE copy is refused to the same agent → 403', async () => {
    const r = await json(`/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_PRIVATE}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('5. a FOREIGN owner\'s agent cannot read the visibility:"owner" file', async () => {
    const r = await json(`/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_OWNER_VIS}`, {
        headers: { Authorization: `Bearer ${otherAgentToken}` },
    });
    assert(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
});

await test('6. no bearer token → not readable, and no handle either', async () => {
    const bytes = await json(`/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_OWNER_VIS}`);
    assert(bytes.status === 403 || bytes.status === 404, `bytes: expected 403/404, got ${bytes.status}`);
    const handle = await json(`/v1/pub/${encodeURIComponent(ownerGhii)}/${KEY_OWNER_VIS}?mode=handle`);
    assert(handle.status === 403 || handle.status === 404, `handle: expected 403/404, got ${handle.status}`);
});

// ─── Phase 3: a DM carries the reference ───
console.log('\nPhase 3 — DM attachment carries an openable ref');

await test('7. owner DMs its own agent with the document attached', async () => {
    const r = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            to: agentGaii,
            body: 'Read this invoice and report the total.',
            attachments: [{ storage_key: KEY_OWNER_VIS, mime: 'application/pdf', size: fileBytes.length, kind: 'file', name: 'invoice.pdf' }],
        }),
    });
    assert(r.status === 201 || r.status === 200, `send: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('8. the agent inbox exposes owner + key, and the bytes resolve from them', async () => {
    const r = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${agentToken}` } });
    assert(r.status === 200, `inbox: ${r.status} ${JSON.stringify(r.body)}`);
    const msg = (r.body.data?.messages ?? [])[0];
    assert(!!msg, 'no message in the agent inbox');
    const att = msg.attachments?.[0];
    assert(!!att, `no attachment: ${JSON.stringify(msg)}`);
    const owner = att.ownerGhii ?? att.owner_ghii;
    const key = att.storageKey ?? att.storage_key;
    assert(!!owner && !!key, `attachment lacks owner/key: ${JSON.stringify(att)}`);

    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(owner)}/${key}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(res.status === 200, `attachment read: ${res.status}`);
    assert(sha(Buffer.from(await res.arrayBuffer())) === EXPECT, 'sha256 mismatch on DM attachment');
});

// ─── Phase 4: a task carries the file ───
console.log('\nPhase 4 — Task attachments');

let taskId = '';

await test('9. owner creates a task with the document attached', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Read the invoice', description: 'Extract the total and report it.',
            status: 'queued', todos: [],
            resources: { files: [{ ref: `${ownerGhii}/${KEY_OWNER_VIS}`, name: 'invoice.pdf' }] },
        }),
    });
    assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
    taskId = r.body.data?.task?.id;
    assert(!!taskId, 'no task id');
    const files = r.body.data?.task?.resources?.files;
    assert(Array.isArray(files) && files.length === 1, `attachment not stored: ${JSON.stringify(r.body.data?.task?.resources)}`);
    // mime + size come from the stored file, never from the request body.
    assert(files[0].mime === 'application/pdf', `mime: ${files[0].mime}`);
    assert(files[0].size === fileBytes.length, `size: ${files[0].size}`);
});

await test('10. the assigned agent reads the task and gets a working download_url', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${agentToken}` } });
    assert(r.status === 200, `task get: ${r.status} ${JSON.stringify(r.body)}`);
    const file = r.body.data?.task?.resources?.files?.[0];
    assert(!!file, `no attachment on the task: ${JSON.stringify(r.body.data?.task?.resources)}`);
    assert(file.access === 'granted', `access: ${file.access} (${file.reason})`);
    assert(file.name === 'invoice.pdf', `name: ${file.name}`);
    const url = file.download_url as string;
    assert(typeof url === 'string' && url.includes('/v1/download/'), `download_url: ${url}`);
    const dl = await fetch(url);
    assert(dl.status === 200, `download: ${dl.status}`);
    assert(sha(Buffer.from(await dl.arrayBuffer())) === EXPECT, 'sha256 mismatch on task attachment');
});

await test('11. attaching a file the creator cannot read → 403, nothing stored', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Should not exist', description: 'x', status: 'queued', todos: [],
            resources: { files: [{ ref: `${otherGhii}/${OTHER_KEY}` }] },
        }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'FILE_ACCESS_DENIED', `code: ${r.body?.error?.code}`);
});

await test('12. attaching a non-existent reference → 400 FILE_NOT_FOUND', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Should not exist', description: 'x', status: 'queued', todos: [],
            resources: { files: [{ ref: `${ownerGhii}/handoff/nope.pdf` }] },
        }),
    });
    assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'FILE_NOT_FOUND', `code: ${r.body?.error?.code}`);
});

await test('13. revoking access flips the task attachment to denied on the NEXT read', async () => {
    // The reference stays; the permission is re-checked per read. Flip the file back to private and
    // the same agent, same task, must stop getting a URL.
    const patch = await json(`/v1/storage/${encodeURIComponent(KEY_OWNER_VIS)}/visibility`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ visibility: 'private' }),
    });
    assert(patch.status === 200, `visibility patch: ${patch.status} ${JSON.stringify(patch.body)}`);

    const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${agentToken}` } });
    assert(r.status === 200, `task get: ${r.status}`);
    const file = r.body.data?.task?.resources?.files?.[0];
    assert(file?.access === 'denied', `expected denied, got ${file?.access}`);
    assert(!file?.download_url, 'a denied attachment must not carry a download_url');

    // Restore for any later assertions / reruns against a shared server.
    await json(`/v1/storage/${encodeURIComponent(KEY_OWNER_VIS)}/visibility`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ visibility: 'owner' }),
    });
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('cascade-delete both owners', async () => {
    const a = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(a.status === 200, `owner1: ${a.status} ${JSON.stringify(a.body)}`);
    const b = await json(`/v1/owners/${encodeURIComponent(otherName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherToken}` } });
    assert(b.status === 200, `owner2: ${b.status} ${JSON.stringify(b.body)}`);
});

console.log(`\n${'═'.repeat(52)}`);
console.log(`Agent File Handoff E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(52));
process.exit(failed > 0 ? 1 : 0);

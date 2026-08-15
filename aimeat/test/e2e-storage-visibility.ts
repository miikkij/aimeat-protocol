/**
 * @file test/e2e-storage-visibility.ts
 * @description T-5: end-to-end coverage of /v1/storage visibility — who may download whose file,
 *   and what the transport says about it: private/owner/group/public reads, presigned URLs, byte
 *   ranges, HEAD metadata, chunked uploads, and the audit trail for denied reads.
 * @structure Phases 1-11, each a numbered `test()` against a live node on E2E_BASE.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=storage-visibility
 * @version-history
 *   v1.3.0 — 2026-08-15 — Phase 12: DELETE /v1/storage, which had no coverage at all. The one that
 *     had to fail first is 54: reading a foreign file through /v1/pub must not make it deletable.
 *     Same removeStorageFile() the new aimeat_storage_delete tool calls.
 *   v1.2.0 — 2026-08-11 — Phase 11: the headers every download path sends (August 2026 audit H-26).
 *     An uploaded text/html file comes back as an attachment, an uploaded image does not, and both
 *     carry nosniff and a file-only CSP, on /v1/pub, /v1/storage, HEAD, ranges and presigned URLs.
 *   v1.1.0 — 2026-08-01 — Content-type assertions compare the BASE type: sniffedContentType() now
 *     appends `; charset=utf-8` to text served from bytes that pass a strict UTF-8 decode.
 *   v1.0.0 — earlier — T-5 suite.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

/** Like json() but returns raw response for binary/range tests */
async function rawFetch(path: string, opts: RequestInit = {}, retries = 5): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, opts);
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return res;
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `stowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';

// Agent A (owned by ownerName)
let agentAToken = '';
let agentAPrivKey = '';
let agentAGaii = '';

// Agent B (same owner)
let agentBToken = '';
let agentBPrivKey = '';
let agentBGaii = '';

// Owner 2 + Agent C (different owner)
const owner2Name = `stowner2-${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';
let agentCToken = '';
let agentCPrivKey = '';
let agentCGaii = '';

// Test file data
const testContent = 'Hello, AIMEAT Storage! This is a test file with known content for range tests.';
const testContentB64 = Buffer.from(testContent).toString('base64');
const privateKey = `priv-file-${Date.now()}`;
const ownerKey = `owner-file-${Date.now()}`;
const publicKey = `pub-file-${Date.now()}`;
const deleteKey = `del-file-${Date.now()}`;

console.log('\n=== AIMEAT Storage Visibility E2E Test ===\n');

// ─── Setup ───
console.log('Setup — Owners & Agents');

await test('Register owner 1', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent-A (owner 1)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'st-agent-a', owner: ownerName, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentAGaii = body.data.agent.gaii;
    agentAPrivKey = body.data.private_key;
    agentAToken = await getToken(agentAGaii, agentAPrivKey, true);
});

await test('Register agent-B (owner 1)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'st-agent-b', owner: ownerName, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentBGaii = body.data.agent.gaii;
    agentBPrivKey = body.data.private_key;
    agentBToken = await getToken(agentBGaii, agentBPrivKey, true);
});

await test('Register owner 2 + agent-C', async () => {
    const { status: os, body: oBody } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(os === 201, `owner2 status ${os}: ${JSON.stringify(oBody)}`);
    owner2PrivKey = oBody.data.private_key;
    owner2Token = await getToken(owner2Name, owner2PrivKey, false);

    const { status: as2, body: aBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'st-agent-c', owner: owner2Name, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(as2 === 201, `agentC status ${as2}: ${JSON.stringify(aBody)}`);
    agentCGaii = aBody.data.agent.gaii;
    agentCPrivKey = aBody.data.private_key;
    agentCToken = await getToken(agentCGaii, agentCPrivKey, true);
});

// ─── Phase 1: Private Visibility (default) ───
console.log('\nPhase 1 — Private Visibility');

await test('1. Upload private file (agent-A)', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: privateKey, data: testContentB64, mime_type: 'text/plain' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'private', `visibility: ${body.data.visibility}`);
    assert(body.data.key === privateKey, `key: ${body.data.key}`);
    assert(body.data.size === Buffer.from(testContent).length, `size: ${body.data.size}`);
});

await test('2. Download own file (agent-A)', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(privateKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    const data = await res.text();
    assert(data === testContent, `data mismatch: got ${data.length} bytes`);
    // Base type only: sniffedContentType() appends `; charset=utf-8` when the stored bytes pass a
    // strict UTF-8 decode, which this ASCII fixture does.
    assert(res.headers.get('content-type')?.startsWith('text/plain'), `ct: ${res.headers.get('content-type')}`);
});

await test('3. Agent-B cannot access A\'s private file', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(privateKey)}`, {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    // Storage lookup is by ownerGaii — agent-B has different GAII → 404
    assert(status === 404, `expected 404, got ${status}`);
});

await test('4. Agent-C cannot access A\'s private file', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(privateKey)}`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('5. List files (agent-A) includes uploaded file', async () => {
    const { body } = await json('/v1/storage', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(body.ok === true, 'ok');
    const keys = body.data.files.map((f: any) => f.key);
    assert(keys.includes(privateKey), `missing ${privateKey} in ${keys}`);
});

await test('6. List files (agent-B) does NOT include A\'s file', async () => {
    const { body } = await json('/v1/storage', {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(body.ok === true, 'ok');
    const keys = body.data.files.map((f: any) => f.key);
    assert(!keys.includes(privateKey), `unexpectedly found ${privateKey}`);
});

// ─── Phase 2: Owner-Scoped Visibility ───
console.log('\nPhase 2 — Owner-Scoped Visibility');

await test('7. Upload owner-visible file (agent-A)', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: ownerKey, data: testContentB64, mime_type: 'text/plain', visibility: 'owner' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'owner', `visibility: ${body.data.visibility}`);
});

await test('8. Same-owner agent-B cannot download (storage scoped by GAII)', async () => {
    // Current implementation: getStorageFile looks up by ownerGaii only,
    // so even same-owner agents get 404 (visibility not enforced at download layer)
    const { status } = await json(`/v1/storage/${encodeURIComponent(ownerKey)}`, {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 404, `expected 404 (storage scoped by GAII), got ${status}`);
});

await test('9. Cross-owner agent-C cannot access owner-scoped file', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(ownerKey)}`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 3: Public Visibility ───
console.log('\nPhase 3 — Public Visibility');

await test('10. Upload public file (agent-A)', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: publicKey, data: testContentB64, mime_type: 'text/plain', visibility: 'public' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'public', `visibility: ${body.data.visibility}`);
});

await test('11. Other agent cannot download public file (storage scoped by GAII)', async () => {
    // Current implementation: getStorageFile looks up by ownerGaii only,
    // so public visibility is stored as metadata but not enforced at download layer
    const { status } = await json(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 404, `expected 404 (storage scoped by GAII), got ${status}`);
});

await test('12. Unauthenticated access denied', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(publicKey)}`);
    assert(status === 401, `expected 401, got ${status}`);
});

// ─── Phase 4: Range Downloads ───
console.log('\nPhase 4 — Range Downloads');

await test('13. Full download (no Range header)', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    const data = await res.text();
    assert(data === testContent, `data mismatch: expected ${testContent.length} bytes, got ${data.length}`);
});

await test('14. Range: bytes=0-9 → 206 partial content', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            Range: 'bytes=0-9',
        },
    });
    assert(res.status === 206, `expected 206, got ${res.status}`);
    const data = await res.arrayBuffer();
    assert(data.byteLength === 10, `expected 10 bytes, got ${data.byteLength}`);
    const text = new TextDecoder().decode(data);
    assert(text === testContent.slice(0, 10), `range data mismatch: "${text}"`);

    const contentRange = res.headers.get('content-range');
    assert(contentRange === `bytes 0-9/${testContent.length}`, `Content-Range: ${contentRange}`);
});

await test('15. Range: bytes=5- → 206 from byte 5 to end', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            Range: 'bytes=5-',
        },
    });
    assert(res.status === 206, `expected 206, got ${res.status}`);
    const data = await res.arrayBuffer();
    const expected = testContent.slice(5);
    assert(data.byteLength === expected.length, `expected ${expected.length} bytes, got ${data.byteLength}`);

    const contentRange = res.headers.get('content-range');
    assert(contentRange === `bytes 5-${testContent.length - 1}/${testContent.length}`, `Content-Range: ${contentRange}`);
});

await test('16. An unknown range UNIT is ignored and the full representation is sent', async () => {
    // RFC 9110 §14.2 says MUST on this, and it is not a covering fallback: the same response
    // carries `Accept-Ranges: bytes`, so the client has been told which unit works. Distinct from
    // a malformed `bytes=` header, which is a 416 (test 16d) — there the client is speaking the
    // right unit and got the syntax wrong, and a 200 would hide that.
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            Range: 'characters=0-5',
        },
    });
    assert(res.status === 200, `expected 200 (unknown unit ignored), got ${res.status}`);
    assert(res.headers.get('accept-ranges') === 'bytes', `Accept-Ranges: ${res.headers.get('accept-ranges')}`);
    const data = await res.text();
    assert(data === testContent, 'full content returned on an unknown range unit');
});

// ── TARGET-063 A1: the five answers the old parser got wrong ──
// Proof that these are new: the previous implementation was `/bytes=(\d+)-(\d*)/`, which needs a
// digit before the dash. `bytes=-8` never matched it and fell through to 200 + the whole file; the
// three out-of-bounds cases DID match and produced a 206 whose Content-Range described bytes that
// were never sent.

await test('16a. Accept-Ranges: bytes is advertised on the full download', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('accept-ranges') === 'bytes', 'a range reader decides from this header alone');
});

await test('16b. Range: bytes=-8 → 206 with the LAST eight bytes (the Parquet footer probe)', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}`, Range: 'bytes=-8' },
    });
    assert(res.status === 206, `expected 206, got ${res.status} — a 200 here IS the silent fallback`);
    const text = await res.text();
    assert(text === testContent.slice(-8), `suffix data mismatch: "${text}"`);
    const cr = res.headers.get('content-range');
    assert(cr === `bytes ${testContent.length - 8}-${testContent.length - 1}/${testContent.length}`, `Content-Range: ${cr}`);
});

await test('16c. Range: bytes=-5000 (longer than the file) → 206 with the whole file', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}`, Range: 'bytes=-5000' },
    });
    assert(res.status === 206, `expected 206, got ${res.status}`);
    const text = await res.text();
    assert(text === testContent, 'a suffix larger than the representation means all of it');
    const cr = res.headers.get('content-range');
    assert(cr === `bytes 0-${testContent.length - 1}/${testContent.length}`, `Content-Range: ${cr}`);
});

await test('16d. An unsatisfiable byte range → 416 + Content-Range, never a quiet 200', async () => {
    for (const bad of ['bytes=9999-10000', 'bytes=50-10', 'bytes=abc', 'bytes=-0']) {
        const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
            headers: { Authorization: `Bearer ${agentAToken}`, Range: bad },
        });
        assert(res.status === 416, `${bad}: expected 416, got ${res.status}`);
        const cr = res.headers.get('content-range');
        assert(cr === `bytes */${testContent.length}`, `${bad}: Content-Range: ${cr}`);
        assert(res.headers.get('accept-ranges') === 'bytes', `${bad}: 416 must still say which unit works`);
    }
});

await test('16e. A multi-range request is refused, not partly served', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}`, Range: 'bytes=0-9, 20-29' },
    });
    assert(res.status === 416, `expected 416, got ${res.status} — the old path answered 206 with only the first range`);
});

// ── The door a data package is actually read through: anonymous GET /v1/pub ──

await test('16f. GET /v1/pub advertises Accept-Ranges to an anonymous reader', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(publicKey)}`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('accept-ranges') === 'bytes', 'no header = DuckDB concludes there are no ranges');
    // A browser fetch() cannot see Content-Range without this, so a 206 would arrive with no geometry.
    const expose = res.headers.get('access-control-expose-headers') ?? '';
    assert(/content-range/i.test(expose), `Access-Control-Expose-Headers: ${expose}`);
});

await test('16g. GET /v1/pub serves a byte range to an anonymous reader (206, not 200)', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(publicKey)}`, {
        headers: { Range: 'bytes=0-9' },
    });
    assert(res.status === 206, `expected 206, got ${res.status} — this door had NO range handling at all`);
    const text = await res.text();
    assert(text === testContent.slice(0, 10), `range data mismatch: "${text}"`);
    assert(res.headers.get('access-control-allow-origin') === '*', 'a 206 must carry the CORS headers too');
});

await test('16h. GET /v1/pub serves a suffix range and refuses an unsatisfiable one', async () => {
    const url = `/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(publicKey)}`;
    const suffix = await rawFetch(url, { headers: { Range: 'bytes=-8' } });
    assert(suffix.status === 206, `suffix: expected 206, got ${suffix.status}`);
    assert(await suffix.text() === testContent.slice(-8), 'suffix data mismatch on /v1/pub');

    const bad = await rawFetch(url, { headers: { Range: 'bytes=9999-' } });
    assert(bad.status === 416, `unsatisfiable: expected 416, got ${bad.status}`);
    assert(bad.headers.get('content-range') === `bytes */${testContent.length}`, `Content-Range: ${bad.headers.get('content-range')}`);
});

await test('16i. HEAD carries Accept-Ranges, which is what a reader probes with first', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        method: 'HEAD', headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('accept-ranges') === 'bytes', 'HEAD must answer the same as GET');
    assert(res.headers.get('content-length') === String(testContent.length), `Content-Length: ${res.headers.get('content-length')}`);
});

// ─── Phase 5: HEAD Metadata ───
console.log('\nPhase 5 — HEAD Metadata');

await test('17. HEAD returns metadata headers', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('content-type')?.startsWith('text/plain'), `ct: ${res.headers.get('content-type')}`);
    assert(res.headers.get('content-length') === String(testContent.length), `cl: ${res.headers.get('content-length')}`);
    assert(res.headers.get('x-aimeat-visibility') === 'public', `vis: ${res.headers.get('x-aimeat-visibility')}`);
    assert(res.headers.get('x-aimeat-created') !== null, 'x-aimeat-created present');
});

await test('18. HEAD for non-existent file → 404', async () => {
    const res = await rawFetch('/v1/storage/nonexistent-file-xyz', {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
});

// ─── Phase 6: Deletion ───
console.log('\nPhase 6 — Deletion');

// Upload a file specifically for delete tests
await test('Upload file for deletion tests', async () => {
    const { status } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: deleteKey, data: testContentB64, mime_type: 'text/plain' }),
    });
    assert(status === 201, `status ${status}`);
});

await test('19. Delete own file (agent-A)', async () => {
    const { status, body } = await json(`/v1/storage/${encodeURIComponent(deleteKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, `deleted: ${body.data.deleted}`);
    assert(body.data.key === deleteKey, `key: ${body.data.key}`);
});

await test('20. Delete already-deleted file → 404', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(deleteKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('21. Agent-B cannot delete A\'s file', async () => {
    // Agent-B tries to delete agent-A's private file — different GAII → 404
    const { status } = await json(`/v1/storage/${encodeURIComponent(privateKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('22. Download after delete → 404', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(deleteKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 7: Quota & Overage ───
console.log('\nPhase 7 — Quota & Overage');

await test('23. Upload exceeding 10MB single-file limit → 413', async () => {
    // Create a base64 string representing >10MB of data
    const bigData = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41).toString('base64');
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: 'too-big', data: bigData, mime_type: 'application/octet-stream' }),
    });
    assert(status === 413, `expected 413, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'QUOTA_EXCEEDED', `code: ${body.error?.code}`);
});

await test('24. Upload valid file with correct MIME type', async () => {
    const jsonData = JSON.stringify({ test: true });
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            key: 'test.json',
            data: Buffer.from(jsonData).toString('base64'),
            mime_type: 'application/json',
        }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.data.mime_type === 'application/json', `mime: ${body.data.mime_type}`);
});

// ─── Phase 8: Chunked Upload ───
console.log('\nPhase 8 — Chunked Upload');

let uploadId = '';

await test('25. Initiate chunked upload', async () => {
    const { status, body } = await json('/v1/storage/upload/init', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            key: 'chunked-file.bin',
            mime_type: 'application/octet-stream',
            visibility: 'private',
            chunk_size: 1024,
            total_chunks: 2,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.upload_id, 'upload_id present');
    uploadId = body.data.upload_id;
});

await test('26. Upload chunk 0', async () => {
    const chunk0 = Buffer.alloc(512, 0x41); // 512 bytes of 'A'
    const res = await rawFetch(`/v1/storage/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Content-Type': 'application/octet-stream',
        },
        body: chunk0,
    });
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.data.received === true, 'chunk received');
    assert(body.data.chunk_index === 0, `chunk_index: ${body.data.chunk_index}`);
});

await test('27. Upload chunk 1', async () => {
    const chunk1 = Buffer.alloc(512, 0x42); // 512 bytes of 'B'
    const res = await rawFetch(`/v1/storage/upload/${uploadId}/1`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Content-Type': 'application/octet-stream',
        },
        body: chunk1,
    });
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.data.received === true, 'chunk received');
});

await test('28. Complete chunked upload', async () => {
    const { status, body } = await json(`/v1/storage/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.key === 'chunked-file.bin', `key: ${body.data.key}`);
    assert(body.data.size === 1024, `size: ${body.data.size}`);
    assert(body.data.chunks_assembled === 2, `chunks: ${body.data.chunks_assembled}`);
});

await test('29. Download assembled chunked file', async () => {
    const res = await rawFetch('/v1/storage/chunked-file.bin', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    assert(data.length === 1024, `expected 1024 bytes, got ${data.length}`);
    // First 512 bytes should be 'A' (0x41), next 512 should be 'B' (0x42)
    assert(data[0] === 0x41, `first byte: ${data[0]}`);
    assert(data[511] === 0x41, `byte 511: ${data[511]}`);
    assert(data[512] === 0x42, `byte 512: ${data[512]}`);
    assert(data[1023] === 0x42, `last byte: ${data[1023]}`);
});

// Test chunked upload abort
let abortUploadId = '';

await test('30. Initiate + abort chunked upload', async () => {
    const { status, body } = await json('/v1/storage/upload/init', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            key: 'abort-file.bin',
            mime_type: 'application/octet-stream',
            chunk_size: 1024,
            total_chunks: 1,
        }),
    });
    assert(status === 201, `init status ${status}`);
    abortUploadId = body.data.upload_id;

    const { status: delStatus, body: delBody } = await json(`/v1/storage/upload/${abortUploadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(delStatus === 200, `abort status ${delStatus}: ${JSON.stringify(delBody)}`);
    assert(delBody.data.aborted === true, 'aborted');
});

await test('31. Completing aborted upload → 404', async () => {
    const { status } = await json(`/v1/storage/upload/${abortUploadId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 9: Error Paths ───
console.log('\nPhase 9 — Error Paths');

await test('32. Upload without key → 400', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ data: testContentB64 }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('33. Upload without data → 400', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: 'no-data' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('34. Download non-existent file → 404', async () => {
    const { status } = await json('/v1/storage/does-not-exist', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('35. Upload without auth → 401', async () => {
    const { status } = await json('/v1/storage', {
        method: 'POST',
        body: JSON.stringify({ key: 'noauth', data: testContentB64 }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

// ─── Phase 10: Group Visibility + Audit Parity (storage ↔ memory) ───
// Cross-owner/group file reads flow through GET /v1/pub/:gaii/{key}. These verify the
// access-guard parity fix: group files are membership-checked, authenticated-but-denied
// returns 403 (matching memory), and the consent-audit log records ONLY denials (allowed
// reads — presigned + public — are no longer audited; see consent-audit-buffer.ts).
console.log('\nPhase 10 — Group Visibility & Audit Parity');

const groupFileKey = `group-file-${Date.now()}`;
let sharingGroupId = '';
let agentDToken = '';
let agentDGaii = '';

await test('36. Register agent-D (owner 2, non-member)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'st-agent-d', owner: owner2Name, capabilities: ['storage'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentDGaii = body.data.agent.gaii;
    agentDToken = await getToken(agentDGaii, body.data.private_key, true);
});

await test('37. Owner-1 creates a sharing group with agent-C as a read member', async () => {
    const { status, body } = await json('/v1/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'storage-share-group',
            members: [{ identifier: agentCGaii, identifier_type: 'gaii', permissions: { read: true, write: false } }],
            default_permissions: { read: true, write: false },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    sharingGroupId = body.data.group.id;
    assert(typeof sharingGroupId === 'string' && sharingGroupId.length > 0, 'got group id');
});

await test('38. Agent-A uploads a group-visibility file', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            key: groupFileKey, data: testContentB64, mime_type: 'text/plain',
            visibility: 'group', group_id: sharingGroupId,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.visibility === 'group', `visibility: ${body.data.visibility}`);
});

await test('39. Group member (agent-C) downloads the group file → 200', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(groupFileKey)}`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const data = await res.text();
    assert(data === testContent, `data mismatch: got ${data.length} bytes`);
});

await test('40. Non-member (agent-D) downloads the group file → 403, denial is audited', async () => {
    // Pre-fix this returned 404 — file.groupId was never threaded into the consent check,
    // so visibility:'group' resolved to missing_group_id for everyone (members included).
    const { status } = await json(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(groupFileKey)}`, {
        headers: { Authorization: `Bearer ${agentDToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);

    // The DENIAL is recorded in the file owner's consent-audit log (allowed:false). The audit
    // endpoint merges the not-yet-flushed buffer, so it shows up immediately.
    const { status: aStatus, body: aBody } = await json('/v1/consent/audit?days=1', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(aStatus === 200, `audit status ${aStatus}: ${JSON.stringify(aBody)}`);
    const found = (aBody.data?.entries as any[]).some(e => e.memory_key === `storage:${groupFileKey}` && e.allowed === false);
    assert(found, `no denial audit entry for storage:${groupFileKey}`);
});

await test('41. Presigned download (allowed read) is NOT audited', async () => {
    const { status: hStatus, body: hBody } = await json(`/v1/storage/${encodeURIComponent(privateKey)}?mode=handle`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(hStatus === 200, `handle status ${hStatus}: ${JSON.stringify(hBody)}`);
    const downloadUrl = hBody.data?.download_url as string;
    assert(typeof downloadUrl === 'string' && downloadUrl.includes('/v1/download/'), `download_url: ${downloadUrl}`);

    const dlRes = await fetch(downloadUrl);
    assert(dlRes.status === 200, `presigned download status ${dlRes.status}`);

    // Allowed reads are no longer audited — there must be NO entry for this key.
    const { status: aStatus, body: aBody } = await json('/v1/consent/audit?days=1', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(aStatus === 200, `audit status ${aStatus}: ${JSON.stringify(aBody)}`);
    const found = (aBody.data?.entries as any[]).some(e => e.memory_key === `storage:${privateKey}`);
    assert(!found, `unexpected audit entry for allowed read storage:${privateKey}`);
});

await test('42. Public file download (allowed read) is NOT audited', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(publicKey)}`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);

    const { body } = await json('/v1/consent/audit?days=1', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    const found = (body.data?.entries as any[]).some(e => e.memory_key === `storage:${publicKey}`);
    assert(!found, `unexpected audit entry for allowed public read storage:${publicKey}`);
});

// ─── Phase 11: Download Headers (August 2026 audit H-26) ───
// A stored file's Content-Type is whatever the UPLOADER declared, and GET /v1/pub serves a public
// file to anyone, from the apex origin, with no auth. So uploaded text/html or image/svg+xml was a
// page running next to the portal's own session until the transport started refusing to render it.
// What must hold on EVERY path that carries bytes: nosniff, a file-only CSP, and a disposition that
// is `inline` only for the types a browser cannot run script from.
console.log('\nPhase 11 — Download Headers');

const htmlKey = `hardening-${Date.now()}.html`;
const pngKey = `hardening-${Date.now()}.png`;
const svgKey = `hardening-${Date.now()}.svg`;
const htmlBody = '<script>alert(document.cookie)</script>';

/** The header set every file response carries; `expected` is what this type is allowed to do. */
function assertFileHeaders(res: Response, expected: 'inline' | 'attachment', label: string) {
    assert(res.headers.get('x-content-type-options') === 'nosniff',
        `${label}: X-Content-Type-Options is ${res.headers.get('x-content-type-options') ?? '(none)'}`);
    const cd = res.headers.get('content-disposition') ?? '';
    assert(cd.startsWith(expected), `${label}: Content-Disposition "${cd || '(none)'}" should start with ${expected}`);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert(csp.startsWith("default-src 'none'"), `${label}: CSP "${csp || '(none)'}" should be the file policy`);
    // `sandbox` strips the origin from anything that gets rendered anyway. It belongs on the types
    // we refuse to show, and NOT on the ones we do: it has broken image and PDF documents before.
    const sandboxed = /(^|;)\s*sandbox\s*(;|$)/.test(csp);
    assert(sandboxed === (expected === 'attachment'), `${label}: sandbox=${sandboxed} on an ${expected} response`);
}

await test('43. Upload public html, png and svg files (agent-A)', async () => {
    for (const [key, mime, body] of [
        [htmlKey, 'text/html', htmlBody],
        [pngKey, 'image/png', 'not-really-a-png'],
        [svgKey, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'],
    ] as const) {
        const { status } = await json('/v1/storage', {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentAToken}` },
            body: JSON.stringify({
                key, mime_type: mime, visibility: 'public',
                data: Buffer.from(body).toString('base64'),
            }),
        });
        assert(status === 201, `${key} status ${status}`);
    }
});

await test('44. Anonymous /v1/pub of an uploaded text/html file → attachment, nosniff, sandboxed', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(htmlKey)}`);
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'attachment', 'pub html');
    // The bytes are still served intact — this is a transport decision, not a content filter.
    assert((await res.text()) === htmlBody, 'body unchanged');
    assert((res.headers.get('content-disposition') ?? '').includes(`filename="${htmlKey}"`),
        `filename missing: ${res.headers.get('content-disposition')}`);
});

await test('45. Anonymous /v1/pub of an image → inline, and still nosniff', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(pngKey)}`);
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'inline', 'pub png');
});

await test('46. Anonymous /v1/pub of an SVG → attachment (an SVG is a scriptable document)', async () => {
    const res = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(svgKey)}`);
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'attachment', 'pub svg');
});

await test('47. Owner download of the same html file → attachment', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(htmlKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'attachment', 'storage html');
});

await test('48. An unknown type (application/octet-stream) is an attachment', async () => {
    // The default when an upload declares no type, so it is the one that must not be inline.
    const res = await rawFetch('/v1/storage/chunked-file.bin', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'attachment', 'storage octet-stream');
});

await test('49. HEAD answers with the same headers as the GET', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(pngKey)}`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assertFileHeaders(res, 'inline', 'HEAD png');
});

await test('50. A byte range carries the headers too', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(htmlKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}`, Range: 'bytes=0-3' },
    });
    assert(res.status === 206, `expected 206, got ${res.status}`);
    assertFileHeaders(res, 'attachment', 'range html');
});

await test('51. Presigned /v1/download carries them as well', async () => {
    const { status, body } = await json(`/v1/storage/${encodeURIComponent(htmlKey)}?mode=handle`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 200, `handle status ${status}: ${JSON.stringify(body)}`);
    const res = await fetch(body.data.download_url as string);
    assert(res.status === 200, `download status ${res.status}`);
    assertFileHeaders(res, 'attachment', 'presigned html');
});

// ─── Phase 12: Delete ───
// The capability had one door and no tool, and no test at all: nothing here asserted that DELETE
// removes the bytes, that it refuses a key in someone else's namespace, or that a caller cannot
// reach a foreign file through the permission that lets it READ one. `aimeat_storage_delete` and
// the route now run the same removeStorageFile(), so these assertions cover both.
console.log('\nPhase 12 — Delete');

const deletableKey = `delete-me-${Date.now()}`;

await test('52. Agent-A uploads a file to delete', async () => {
    const { status, body } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ key: deletableKey, data: testContentB64, mime_type: 'text/plain', visibility: 'public' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('53. Another owner\'s agent cannot delete it, and the file survives', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentDToken}` },
    });
    // 404, not 403: the lookup is namespaced to the caller, so the file is not there to refuse.
    assert(status === 404, `expected 404 for a foreign key, got ${status}`);
    const still = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(deletableKey)}`);
    assert(still.status === 200, `the file must still be readable, got ${still.status}`);
});

await test('54. Reading a foreign file does not imply deleting it (agent-D reads, then cannot remove)', async () => {
    // Agent-D may read this public file through /v1/pub. That permission must not carry a delete.
    const read = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(deletableKey)}`, {
        headers: { Authorization: `Bearer ${agentDToken}` },
    });
    assert(read.status === 200, `agent-D can read it: ${read.status}`);
    const { status } = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentDToken}` },
    });
    assert(status === 404, `reading it must not make it deletable, got ${status}`);
});

await test('55. Delete without auth → 401', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, { method: 'DELETE' });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('56. The owner\'s own agent deletes it → 200, and says what it removed', async () => {
    const { status, body } = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true && body.data.key === deletableKey, `envelope: ${JSON.stringify(body.data)}`);
    // The size and type are read BEFORE the row goes, which is the only reason they can be reported.
    assert(body.data.size === testContent.length, `size ${body.data.size}, expected ${testContent.length}`);
    assert(String(body.data.mime_type).startsWith('text/plain'), `mime ${body.data.mime_type}`);
});

await test('57. The bytes are gone from both doors', async () => {
    const own = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(own.status === 404, `own namespace after delete: ${own.status}`);
    const pub = await rawFetch(`/v1/pub/${encodeURIComponent(agentAGaii)}/${encodeURIComponent(deletableKey)}`);
    assert(pub.status === 404, `public URL after delete: ${pub.status}`);
});

await test('58. Deleting the same key again → 404 (the second call claims nothing)', async () => {
    const { status } = await json(`/v1/storage/${encodeURIComponent(deletableKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('59. Deleting a key that never existed → 404, and the message names the reason', async () => {
    const { status, body } = await json(`/v1/storage/${encodeURIComponent('no-such-file-' + Date.now())}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(String(body.error?.message).includes('your namespace'), `message should name the namespace: ${body.error?.message}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner 1', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('Cascade-delete owner 2', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(owner2Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Storage Visibility E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);

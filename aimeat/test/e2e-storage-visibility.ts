// T-5: Storage Visibility E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-storage-visibility.ts

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
    assert(res.headers.get('content-type') === 'text/plain', `ct: ${res.headers.get('content-type')}`);
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

await test('16. Non-matching Range header falls through to full download', async () => {
    // The server regex only matches bytes=(\d+)-(\d*), so a malformed range skips range handling
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            Range: 'characters=0-5',
        },
    });
    assert(res.status === 200, `expected 200 (fallthrough), got ${res.status}`);
    const data = await res.text();
    assert(data === testContent, 'full content returned on malformed range');
});

// ─── Phase 5: HEAD Metadata ───
console.log('\nPhase 5 — HEAD Metadata');

await test('17. HEAD returns metadata headers', async () => {
    const res = await rawFetch(`/v1/storage/${encodeURIComponent(publicKey)}`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'text/plain', `ct: ${res.headers.get('content-type')}`);
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

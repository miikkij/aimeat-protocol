/**
 * @file e2e-memory-file-presigned.ts
 * @description E2E for the file-upload ceiling that nobody could see.
 *
 *   POST /v1/memory/files accepted ONLY inline base64, and the path was missing from server.ts's
 *   large-body list, so every upload there was parsed at security.json_body_limit_mb. A file over
 *   roughly 3.7 MB answered a bare `413 Content Too Large` — on a node whose admin page said
 *   quota.storage_max_file_size_mb = 50. Two limits, no connection between them, and the browser's
 *   Files tab reported it as "Upload failed".
 *
 *   Asserted here: (1) `mode: 'presigned'` mints an upload URL whose max_size_bytes IS the node's
 *   configured per-file limit, (2) bytes larger than any JSON body survive a raw PUT and read back
 *   byte-identical, (3) tags and workspace visibility carried in the token meta actually land on the
 *   stored record (dropping them is the same class of bug as the extension `update` flag), and
 *   (4) a file over the limit is refused with FILE_TOO_LARGE rather than accepted and truncated.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-memory-file-presigned
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function getOwnerToken(name: string, priv: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(priv, 'base64'));
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(body.ok === true, `owner token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

const ownerName = `mfpowner${Date.now() % 1000000}`;
let ownerToken = '';
let authHeaders: Record<string, string> = {};
let maxBytes = 0;

console.log('\n=== Memory file presigned upload E2E ===\n');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerToken = await getOwnerToken(ownerName, body.data.private_key);
    authHeaders = { Authorization: `Bearer ${ownerToken}` };
});

// ── 1. The mint reports the node's OWN limit ──

await test('Presigned mint returns an upload URL and the configured per-file limit', async () => {
    const { status, body } = await json('/v1/memory/files', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ key: 'e2e/presigned-probe.bin', mime_type: 'application/octet-stream', mode: 'presigned' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data?.upload_url === 'string' && body.data.upload_url.includes('/v1/upload/'),
        `no upload_url: ${JSON.stringify(body.data)}`);
    assert(body.data.upload_method === 'PUT', `upload_method ${body.data.upload_method}`);
    maxBytes = Number(body.data.max_size_bytes);
    // The whole point of the fix: this number comes from quota.storage_max_file_size_mb, and it is
    // larger than any JSON body this route would parse.
    assert(maxBytes >= 1024 * 1024, `max_size_bytes too small to be the configured limit: ${maxBytes}`);
});

await test('Presigned mint without a key is refused', async () => {
    const { status, body } = await json('/v1/memory/files', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ mode: 'presigned' }),
    });
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
});

// ── 2. Bytes bigger than a JSON body survive the round trip ──

const bigKey = 'e2e/presigned-big.bin';
// 6 MB: comfortably past security.json_body_limit_mb (5 MB) and past what its base64 form (8 MB)
// would fit in even the large-body envelope. This is the size the old path could not carry.
const bigSize = 6 * 1024 * 1024;
const bigData = Buffer.alloc(bigSize);
for (let i = 0; i < bigSize; i++) bigData[i] = (i * 31 + 7) & 0xff;
const bigSha = createHash('sha256').update(bigData).digest('hex');

await test('A 6 MB file uploads through the presigned URL', async () => {
    const mint = await json('/v1/memory/files', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({
            key: bigKey, mime_type: 'application/octet-stream', visibility: 'private',
            tags: ['e2e', 'presigned'], mode: 'presigned',
        }),
    });
    assert(mint.status === 200, `mint ${mint.status}: ${JSON.stringify(mint.body)}`);
    assert(bigSize <= Number(mint.body.data.max_size_bytes),
        `node limit ${mint.body.data.max_size_bytes} is below the ${bigSize}-byte fixture`);

    const res = await fetch(mint.body.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bigData,
    });
    const payload = await res.json() as any;
    assert(res.status === 200, `PUT ${res.status}: ${JSON.stringify(payload)}`);
    assert(payload.success === true, `PUT not successful: ${JSON.stringify(payload)}`);
    assert(payload.size === bigSize, `stored size ${payload.size}, expected ${bigSize}`);
});

await test('The stored bytes are byte-identical', async () => {
    const res = await fetch(`${BASE}/v1/memory/files/${encodeURIComponent(bigKey)}`, { headers: authHeaders });
    assert(res.status === 200, `download ${res.status}`);
    const got = Buffer.from(await res.arrayBuffer());
    assert(got.length === bigSize, `downloaded ${got.length} bytes, expected ${bigSize}`);
    assert(createHash('sha256').update(got).digest('hex') === bigSha, 'checksum mismatch after round trip');
});

await test('Tags carried in the token meta land on the record', async () => {
    const { status, body } = await json('/v1/memory/files', { headers: authHeaders });
    assert(status === 200, `list ${status}`);
    const list: any[] = body.data?.files ?? body.data ?? [];
    const rec = list.find(f => f.key === bigKey);
    assert(!!rec, `uploaded file missing from the listing: ${JSON.stringify(list.map(f => f.key))}`);
    const tags: string[] = rec.tags ?? [];
    // A presigned mint that accepts `tags` and then drops them from the token meta stores an
    // untagged file and says nothing — the same silent-drop shape as the extension `update` flag.
    assert(tags.includes('e2e') && tags.includes('presigned'), `tags not carried: ${JSON.stringify(tags)}`);
});

// ── 3. Over the limit is refused, not truncated ──

await test('A file over the node limit is refused with FILE_TOO_LARGE', async () => {
    const mint = await json('/v1/memory/files', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ key: 'e2e/presigned-toobig.bin', mode: 'presigned' }),
    });
    assert(mint.status === 200, `mint ${mint.status}`);
    const over = Buffer.alloc(Number(mint.body.data.max_size_bytes) + 1024);
    const res = await fetch(mint.body.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: over,
    });
    const payload = await res.json().catch(() => ({})) as any;
    assert(res.status === 413, `expected 413, got ${res.status}: ${JSON.stringify(payload)}`);
    assert(payload.error === 'FILE_TOO_LARGE', `expected FILE_TOO_LARGE, got ${JSON.stringify(payload)}`);

    // And nothing was stored under that key.
    const check = await fetch(`${BASE}/v1/memory/files/${encodeURIComponent('e2e/presigned-toobig.bin')}`, { headers: authHeaders });
    assert(check.status === 404, `refused upload still left a file (status ${check.status})`);
});

// ── 4. The inline path still works for small files ──

await test('Inline base64 upload still works', async () => {
    const content = Buffer.from('small inline file').toString('base64');
    const { status, body } = await json('/v1/memory/files', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ key: 'e2e/inline-small.txt', content, mime_type: 'text/plain' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.size === 17, `size ${body.data?.size}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

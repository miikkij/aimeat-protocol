/**
 * @file e2e-upload.ts
 * @description E2E tests for presigned upload URL mechanism.
 *   Tests the full flow: request upload URL via REST, then PUT file to it.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial creation
 *   v1.1.0 -- 2026-05-29 -- Add Phase 3.5 regression tests for inline-upload
 *     base64 validation (POST /v1/apps with raw HTML / malformed input must 400).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `uploadtest${Date.now() % 100000}`;
const agentName = 'uploadagent';

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerToken}` } };
}

function agentAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
}

// ── Setup ──

let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentPrivKey = '';
let agentToken = '';

console.log('\n=== Presigned Upload E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register test owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got private key');
});

await test('Get owner token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register test agent', async () => {
    const { status, body } = await json('/v1/agents', authed({
        method: 'POST',
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
            scopes: ['*'],
            model: 'test-model',
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentGaii === 'string', 'got agent gaii');
});

await test('Get agent token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ── Phase 1: App Upload ──
console.log('\nPhase 1: App presigned upload');

let appUploadUrl = '';

await test('POST /v1/apps with mode=presigned returns upload_url', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'upload-test.html',
            name: 'Upload Test App',
            description: 'Testing presigned upload',
            mode: 'presigned',
        }),
    }));
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.upload_url, 'Should have upload_url');
    assert(body.data?.upload_method === 'PUT', 'upload_method should be PUT');
    assert(body.data?.content_type === 'text/html', 'content_type should be text/html');
    assert(body.data?.max_size_bytes > 0, 'max_size_bytes should be positive');
    assert(body.data?.expires_in_seconds === 3600, 'expires_in_seconds should be 3600');
    appUploadUrl = body.data.upload_url;
});

await test('PUT file to upload_url succeeds', async () => {
    assert(appUploadUrl.length > 0, 'upload URL should be set from previous test');
    const htmlContent = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Upload Test</h1></body></html>';
    const res = await fetch(appUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: htmlContent,
    });
    const result = await res.json() as any;
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(result)}`);
    assert(result.success === true, `success should be true, got: ${JSON.stringify(result)}`);
    assert(result.type === 'app', 'type should be app');
    assert(result.filename === 'upload-test.html', `filename mismatch: ${result.filename}`);
    assert(result.version_number === 1, `version_number should be 1, got ${result.version_number}`);
    assert(result.size > 0, 'size should be positive');
});

await test('Token is single-use (second PUT fails with 409)', async () => {
    const res = await fetch(appUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<html>second try</html>',
    });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    const result = await res.json() as any;
    assert(result.error === 'TOKEN_USED', `error should be TOKEN_USED, got ${result.error}`);
});

await test('Upload second version via presigned URL', async () => {
    const { body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'upload-test.html',
            name: 'Upload Test App v2',
            mode: 'presigned',
        }),
    }));
    const url = body.data?.upload_url;
    assert(!!url, 'Should get upload_url for v2');

    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<html><body>Version 2</body></html>',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const result = await res.json() as any;
    assert(result.version_number === 2, `version_number should be 2, got ${result.version_number}`);
    assert(result.is_update === true, 'is_update should be true');
});

// ── Phase 2: Storage Upload ──
console.log('\nPhase 2: Storage presigned upload');

let storageUploadUrl = '';

await test('POST /v1/storage with mode=presigned returns upload_url', async () => {
    const { status, body } = await json('/v1/storage', agentAuthed({
        method: 'POST',
        body: JSON.stringify({
            key: 'test/presigned-file.txt',
            mime_type: 'text/plain',
            visibility: 'public',
            mode: 'presigned',
        }),
    }));
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.upload_url, 'Should have upload_url');
    assert(body.data?.upload_method === 'PUT', 'upload_method should be PUT');
    storageUploadUrl = body.data.upload_url;
});

await test('PUT file to storage upload_url succeeds', async () => {
    const content = 'Hello from presigned upload test!\nLine 2.';
    const res = await fetch(storageUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const result = await res.json() as any;
    assert(result.success === true, 'success should be true');
    assert(result.type === 'storage', 'type should be storage');
    assert(result.key === 'test/presigned-file.txt', `key should match, got ${result.key}`);
});

// ── Phase 3: Error cases ──
console.log('\nPhase 3: Error cases');

await test('Empty body returns 400', async () => {
    const { body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: 'empty-test.html', name: 'Empty', mode: 'presigned' }),
    }));
    const url = body.data?.upload_url;
    assert(!!url, 'Should get upload_url');

    const res = await fetch(url, { method: 'PUT' });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const result = await res.json() as any;
    assert(result.error === 'EMPTY_BODY', `error should be EMPTY_BODY, got ${result.error}`);
});

await test('Invalid token returns 401', async () => {
    const res = await fetch(`${BASE}/v1/upload/not-a-valid-token`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<html>test</html>',
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    const result = await res.json() as any;
    assert(result.error === 'TOKEN_INVALID', `error should be TOKEN_INVALID, got ${result.error}`);
});

// ── Phase 3.5: Inline-upload base64 validation ──
// Regression: Buffer.from(str, 'base64') is permissive and silently drops
// characters outside the base64 alphabet. Raw HTML POSTed as `content`
// used to succeed with a tiny garbage buffer (e.g. size: 14 for a ~1.2 KB
// HTML body) because most of the source got stripped. These tests pin the
// upload boundary so any future regression is caught immediately.
console.log('\nPhase 3.5: Inline-upload base64 validation');

await test('POST /v1/apps with raw HTML in content -> 400 INVALID_INPUT', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'raw-html-test.html',
            name: 'Raw HTML test',
            content: '<!doctype html><html><body><h1>this is not base64</h1></body></html>',
        }),
    }));
    assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INVALID_INPUT', `Expected INVALID_INPUT, got ${body.error?.code}`);
    assert(/base64/i.test(body.error?.message ?? ''), `Expected base64-related message, got ${body.error?.message}`);
});

await test('POST /v1/apps with valid base64 content -> success, size matches raw bytes', async () => {
    const html = '<!doctype html><html lang="en"><body><h1>Hello</h1><p>Inline base64 upload smoke test.</p></body></html>';
    const content_b64 = Buffer.from(html, 'utf8').toString('base64');
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'valid-b64-test.html',
            name: 'Valid base64 test',
            content: content_b64,
        }),
    }));
    assert(status === 200 || status === 201, `Expected 2xx success, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.size === html.length, `Expected size ${html.length} (round-trip from base64), got ${body.data?.size}`);
});

await test('POST /v1/apps with malformed base64 (random non-alphabet chars) -> 400', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'malformed-test.html',
            name: 'Malformed base64',
            content: 'this contains ###spaces$$$ and@@@symbols!!! not base64',
        }),
    }));
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_INPUT', `Expected INVALID_INPUT, got ${body.error?.code}`);
});

// ── Phase 4: Cleanup ──
console.log('\nPhase 4: Cleanup');

await test('Delete test owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, authed({ method: 'DELETE' }));
    assert(status === 200 || status === 204, `Expected 2xx, got ${status}`);
});

// ── Summary ──
console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

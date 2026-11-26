/**
 * @file e2e-upload.ts
 * @description E2E tests for presigned upload URL mechanism.
 *   Tests the full flow: request upload URL via REST, then PUT file to it.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial creation
 *   v1.1.0 -- 2026-05-29 -- Add Phase 3.5 regression tests for inline-upload
 *     base64 validation (POST /v1/apps with raw HTML / malformed input must 400).
 *   v1.2.0 -- 2026-11-15 -- The uploaded bytes are read back, and a second owner's presigned upload
 *     under the same file name leaves the first owner's app unchanged. The E2E report of 2026-11-15
 *     proposed deleting this suite as covered elsewhere; five of its cases are not (the single-use
 *     token, metadata carried forward, strict base64, the empty body and the bad token), so it stays.
 *   v1.3.0 -- 2026-11-15 -- Audit M045 (an unheld address answers 410 TOKEN_EXPIRED), M046 (the
 *     storage PUT asks the shared writer again, bytes read back) and L122 (the delete cascade is read).
 *   v1.4.0 -- 2026-11-26 -- A file over 4 MiB: an inline POST /v1/storage whose base64 passes 4 MiB
 *     characters stores it (it answered 500 on aimeat.io), and the served AIMEAT.storage.upload sends
 *     a File in one PUT and answers the fields the inline upload answers.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner, ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
    const owner = await registerOwner(BASE, ownerName);
    ownerPrivKey = owner.privateKey;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got private key');
});

await test('Get owner token', async () => {
    const { body } = await ownerSignIn(BASE, ownerName);
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
    // The bytes are read back, not only the answer (E2E report of 2026-11-15, 3.2): the node serves
    // exactly what was PUT, and version 1 still serves its own.
    const served = await (await fetch(`${BASE}/v1/apps/${ownerName}/upload-test.html`)).text();
    assert(served.includes('Version 2'), `the node serves the uploaded version 2, got ${served.slice(0, 120)}`);
    const first = await (await fetch(`${BASE}/v1/apps/${ownerName}/upload-test.html?version=1`)).text();
    assert(first.includes('<h1>Upload Test</h1>'), `version 1 still serves its own bytes, got ${first.slice(0, 120)}`);
});

await test('Another owner cannot publish over this app through a presigned upload', async () => {
    // A second owner asking for an upload under the same file name gets an upload of their OWN app
    // (or a refusal), never a version of the first owner's: the first owner's app is unchanged.
    const other = await registerOwner(BASE, `${ownerName}x`);
    const { status, body } = await json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${other.token}` },
        body: JSON.stringify({ filename: 'upload-test.html', name: 'Not yours', mode: 'presigned' }),
    });
    if (status === 200 && body.data?.upload_url) {
        const put = await fetch(body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<html><body>intruder</body></html>' });
        await put.text();
    }
    const served = await (await fetch(`${BASE}/v1/apps/${ownerName}/upload-test.html`)).text();
    assert(served.includes('Version 2') && !served.includes('intruder'), `the first owner's app is unchanged, got ${served.slice(0, 120)}`);
    // The same second owner is refused the first owner's account itself, and the app stays served.
    const del = await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${other.token}` } });
    assert(del.status === 403 && del.body?.error?.code === 'ACCESS_DENIED', `another owner cannot delete this account: expected 403 ACCESS_DENIED, got ${del.status} ${JSON.stringify(del.body?.error)}`);
    const still = await fetch(`${BASE}/v1/apps/${ownerName}/upload-test.html`);
    assert(still.status === 200, `the first owner's app is still served after the refused delete, got ${still.status}`);
});

// A presigned UPDATE that omits metadata must never blank what the live app declares:
// the v2 publish above sent only filename+name, so v1's description must survive.
await test('Presigned update without description keeps the existing one', async () => {
    const { status, body } = await json('/v1/apps?limit=200', authed());
    assert(status === 200, `list status ${status}`);
    const app = (body.data?.apps ?? []).find((a: any) => a.filename === 'upload-test.html');
    assert(!!app, 'upload-test.html should be listed');
    assert(app.manifest?.description === 'Testing presigned upload',
        `description should carry forward, got "${app.manifest?.description}"`);
});

await test('Presigned update carries category, tags and icon forward', async () => {
    // v1 with full metadata
    const p1 = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: 'carry-test.html', name: 'Carry Test', description: 'Carry me',
            category: 'game', tags: ['alpha', 'beta'], icon: '🧪', mode: 'presigned',
        }),
    }));
    const put1 = await fetch(p1.body.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<html><body>v1</body></html>',
    });
    assert(put1.status === 200, `v1 PUT status ${put1.status}`);
    // v2 with NO metadata beyond filename+name
    const p2 = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: 'carry-test.html', name: 'Carry Test', mode: 'presigned' }),
    }));
    const put2 = await fetch(p2.body.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<html><body>v2</body></html>',
    });
    assert(put2.status === 200, `v2 PUT status ${put2.status}`);
    const { body } = await json('/v1/apps?limit=200', authed());
    const app = (body.data?.apps ?? []).find((a: any) => a.filename === 'carry-test.html');
    assert(!!app, 'carry-test.html should be listed');
    const m = app.manifest ?? {};
    assert(app.version_number === 2, `should be v2, got ${app.version_number}`);
    assert(m.description === 'Carry me', `description lost: "${m.description}"`);
    assert(m.category === 'game', `category lost: "${m.category}"`);
    assert(Array.isArray(m.tags) && m.tags.join(',') === 'alpha,beta', `tags lost: ${JSON.stringify(m.tags)}`);
    assert(m.icon === '🧪', `icon lost: "${m.icon}"`);
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
    // Fields only the shared writer's record gives, then the bytes read back through GET /v1/storage.
    assert(result.owner_gaii === agentGaii, `owner_gaii is the uploading agent, got ${result.owner_gaii}`);
    assert(result.embed_url === `/v1/pub/${encodeURIComponent(agentGaii)}/test/presigned-file.txt`, `embed_url: ${result.embed_url}`);
    const back = await fetch(`${BASE}/v1/storage/test/presigned-file.txt`, agentAuthed());
    assert(back.status === 200 && (await back.text()) === content, `the stored bytes read back, got ${back.status}`);
});

await test('The storage PUT asks the shared writer again: a group deleted after the mint refuses the upload', async () => {
    // The mint checks the group exists; the PUT must ask again (services/stored-files/write.ts),
    // so a route that stored the record itself would land a file bound to a group that is gone.
    const g = await json('/v1/groups', authed({ method: 'POST', body: JSON.stringify({ name: 'upload-gone-group', members: [] }) }));
    assert(g.status === 201, `create group: ${g.status} ${JSON.stringify(g.body?.error)}`);
    const gid = g.body.data.group.id;
    const mint = await json('/v1/storage', agentAuthed({
        method: 'POST',
        body: JSON.stringify({ key: 'test/group-gone.txt', mime_type: 'text/plain', visibility: 'group', group_id: gid, mode: 'presigned' }),
    }));
    assert(mint.status === 200 && !!mint.body.data?.upload_url, `mint: ${mint.status} ${JSON.stringify(mint.body?.error)}`);
    const del = await json(`/v1/groups/${gid}`, authed({ method: 'DELETE' }));
    assert(del.status === 200, `delete group: ${del.status}`);
    const res = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'bound to nobody' });
    const out = await res.json() as any;
    assert(res.status === 400 && out.error === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${res.status} ${JSON.stringify(out)}`);
    const back = await fetch(`${BASE}/v1/storage/test/group-gone.txt`, agentAuthed());
    assert(back.status === 404, `nothing was stored, got ${back.status}`);
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

await test('An upload address the node no longer holds returns 410 TOKEN_EXPIRED', async () => {
    // A handle is kept only until its token expires, so this is the answer an expired URL gets.
    const res = await fetch(`${BASE}/v1/upload/u_${'A'.repeat(16)}`, {
        method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<html>late</html>',
    });
    const result = await res.json() as any;
    assert(res.status === 410 && result.error === 'TOKEN_EXPIRED', `expected 410 TOKEN_EXPIRED, got ${res.status} ${result.error}`);
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
            description: 'Inline base64 upload smoke test app.',
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

// ── Phase 3.6: a file over 4 MiB, inline and through the served SDK ──
// On aimeat.io an inline POST /v1/storage whose base64 passed 4,194,304 characters answered 500: the
// check was one regular expression over the whole text (utils/base64.ts). AIMEAT.storage.upload(File)
// sent that JSON; it now sends the raw bytes in one PUT to a presigned address.
console.log('\nPhase 3.6: A file over 4 MiB');

/** 4.5 MiB of bytes that are not all alike, so a byte lost or moved is seen when they are read back. */
const BIG = Buffer.alloc(Math.round(4.5 * 1024 * 1024));
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 7 + (i >> 11)) & 0xff;
const sameBytes = async (key: string): Promise<boolean> => {
    const back = await fetch(`${BASE}/v1/storage/${key}`, authed());
    return back.status === 200 && Buffer.from(await back.arrayBuffer()).equals(BIG);
};
let inlineBig: Record<string, unknown> = {};

await test('An inline POST /v1/storage with over 4 MiB characters of base64 stores the file', async () => {
    const data = BIG.toString('base64');
    assert(data.length > 4 * 1024 * 1024, `the base64 is over 4 MiB characters, got ${data.length}`);
    const { status, body } = await json('/v1/storage', authed({
        method: 'POST',
        body: JSON.stringify({ key: 'big/inline.bin', data, mime_type: 'application/zip', visibility: 'private' }),
    }));
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    assert(body.data?.size === BIG.length, `size ${body.data?.size}`);
    inlineBig = body.data;
    assert(await sameBytes('big/inline.bin'), 'the stored bytes read back the same');
});

await test('The served AIMEAT.storage.upload sends a File over 4 MiB in one PUT and answers the inline fields', async () => {
    const vm = await import('node:vm');
    const code = await (await fetch(`${BASE}/v1/libs/aimeat-storage.js`)).text();
    const sent: Array<{ url: string; method: string; bytes: number }> = [];
    // The node itself, through a recorder: the SDK's authed calls and its PUT both go to it.
    const nodeFetch = async (url: string, init: RequestInit = {}) => {
        const body = init.body as unknown;
        sent.push({ url, method: init.method ?? 'GET', bytes: body instanceof Blob ? body.size : typeof body === 'string' ? body.length : 0 });
        return fetch(url, init);
    };
    const session = {
        jwt: ownerToken,
        fetch: async (path: string, opts: RequestInit = {}) => {
            const r = await nodeFetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` } });
            return { ...(await r.json() as object), status: r.status };
        },
    };
    const page: Record<string, unknown> = {
        document: { querySelector: () => null },
        location: { protocol: 'http:', origin: BASE, href: `${BASE}/` },
        fetch: nodeFetch, Blob, File, Response, console, setTimeout, clearTimeout,
    };
    page.window = page;
    page.self = page;
    page.AIMEAT = { auth: { getSession: () => session } };
    vm.runInContext(code, vm.createContext(page));
    const storage = (page.AIMEAT as { storage: { upload: (f: unknown, o?: unknown) => Promise<Record<string, unknown>> } }).storage;

    const out = await storage.upload(new File([BIG], 'sdk.bin', { type: 'application/zip' }), { key: 'big/sdk.bin', visibility: 'private' });
    const puts = sent.filter((s) => s.method === 'PUT');
    assert(puts.length === 1 && puts[0].url.includes('/v1/upload/') && puts[0].bytes === BIG.length,
        `one PUT of the raw bytes to an upload address, got ${JSON.stringify(sent)}`);
    assert(!sent.some((s) => s.method === 'POST' && s.bytes > 4096), `no JSON body carried the file, got ${JSON.stringify(sent)}`);
    assert(out.key === 'big/sdk.bin' && out.size === BIG.length && out.federate === false && typeof out.created_at === 'string',
        `the inline answer's fields, got ${JSON.stringify(out)}`);
    const inlineKeys = Object.keys(inlineBig).sort().join(',');
    assert(Object.keys(out).sort().join(',') === inlineKeys, `the same fields as the inline answer: ${Object.keys(out).sort()} vs ${inlineKeys}`);
    assert(await sameBytes('big/sdk.bin'), 'the stored bytes read back the same');
});

// ── Phase 4: Cleanup ──
console.log('\nPhase 4: Cleanup');

await test('Delete test owner (cascade)', async () => {
    const appUrl = `${BASE}/v1/apps/${ownerName}/upload-test.html`;
    const fileUrl = `${BASE}/v1/pub/${encodeURIComponent(agentGaii)}/test/presigned-file.txt`;
    const before = [(await fetch(appUrl)).status, (await fetch(fileUrl)).status];
    assert(before[0] === 200 && before[1] === 200, `app and public file are served before the delete, got ${before}`);
    const { status } = await json(`/v1/owners/${ownerName}`, authed({ method: 'DELETE' }));
    assert(status === 200 || status === 204, `Expected 2xx, got ${status}`);
    // The cascade: the uploaded app and the agent's public file go with the account.
    const after = [(await fetch(appUrl)).status, (await fetch(fileUrl)).status];
    assert(after[0] === 404 && after[1] === 404, `app and file are gone after the delete, got ${after}`);
});

// ── Summary ──
console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

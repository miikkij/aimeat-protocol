/**
 * @file test/e2e-extension-fetch-base64.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An installed extension reads a binary answer intact with
 *   `ctx.fetch(url, { responseType: 'base64' })`, end to end over HTTP: install, activate, invoke,
 *   and the refusals.
 *     - a 48 128-byte binary file (the size of a Metsähallitus Garmin `.img` boundary) comes back
 *       byte for byte as `base64`, with `text` empty;
 *     - the same file read as text is not the same bytes, which is what the option exists for;
 *     - `gunzip: true` with `responseType: 'base64'` answers the inflated bytes;
 *     - `responseType: 'arraybuffer'` is refused by name rather than ignored;
 *     - an answer past the 4 MB ceiling is refused with RESPONSE_TOO_LARGE as text is;
 *     - signed out, the action is refused (401).
 *   FIRST FAIL: against the tree before this change `responseType` is ignored, so `base64` is
 *   absent and `arraybuffer` is accepted without a word.
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (jussil riistakartta, support thread 1ac0a199).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-fetch-base64

import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const MB = 1024 * 1024;

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
async function setupOwner(label: string) {
    const name = `exb64${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext Base64', password: 'ExtBase6412345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'ExtBase6412345');
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Extension ctx.fetch responseType base64 E2E ===\n');

// ─── A far side for ctx.fetch: a binary map file, the same gzipped, and one too large ───
// Far from the node's port, as e2e-extension-fetch-gunzip keeps its far side.
const FAR_PORT = Number(new URL(BASE).port || '40251') + 241;
/** Every byte value, many times over: invalid UTF-8 at almost every position. */
const IMG = Buffer.from(Array.from({ length: 48_128 }, (_, i) => (i * 7 + (i >> 8)) & 0xff));
const IMG_GZ = gzipSync(IMG);
const HUGE = Buffer.alloc(5 * MB, 0xff);
const far = http.createServer((req, res) => {
    if (req.url === '/parkano.img') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(IMG); return; }
    if (req.url === '/parkano.img.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(IMG_GZ); return; }
    if (req.url === '/huge.img') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(HUGE); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not here');
});
await new Promise<void>(r => far.listen(FAR_PORT, () => r()));

const EXT = `exb64${Date.now()}`;
const SCRIPTS = {
    pull: `export default async function(ctx, input){
        var opts = { gunzip: input.gunzip === true };
        if (input.responseType !== undefined) opts.responseType = input.responseType;
        var r = await ctx.fetch('http://localhost:' + input.port + '/' + input.file, opts);
        return { status: r.status, text: r.text, base64: r.base64 === undefined ? null : r.base64 };
    }`,
};
const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'extension base64 e2e', author: 'e2e' },
    capabilities: ['network'],
    network: { hosts: ['localhost'] },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
});

let A!: Awaited<ReturnType<typeof setupOwner>>;
const invoke = (input: Record<string, unknown>) =>
    json(`/v1/ext/${EXT}/pull`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ port: FAR_PORT, ...input }) });

await test('Setup: an owner and an extension with network on localhost', async () => {
    A = await setupOwner('a');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}`);
});

await test('responseType base64: the 48 128-byte file comes back byte for byte, text empty', async () => {
    const r = await invoke({ file: 'parkano.img', responseType: 'base64' });
    // HOLE: before this change responseType was ignored and base64 was absent.
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(typeof r.body.data.base64 === 'string', `base64: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    assert(Buffer.from(r.body.data.base64, 'base64').equals(IMG), 'the bytes differ from the file');
    assert(r.body.data.text === '', `text: ${JSON.stringify(r.body.data.text).slice(0, 80)}`);
});

await test('Without the option the same file is text, and its bytes are lost', async () => {
    const r = await invoke({ file: 'parkano.img' });
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.base64 === null, 'base64 present without the option');
    assert(!Buffer.from(r.body.data.text, 'utf8').equals(IMG), 'text kept the bytes, so the test proves nothing');
});

await test('gunzip with responseType base64 answers the inflated bytes', async () => {
    const r = await invoke({ file: 'parkano.img.gz', responseType: 'base64', gunzip: true });
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(Buffer.from(r.body.data.base64, 'base64').equals(IMG), 'the inflated bytes differ from the file');
});

await test('responseType arraybuffer is refused by name, not ignored', async () => {
    const r = await invoke({ file: 'parkano.img', responseType: 'arraybuffer' });
    assert(r.status !== 200, `expected a refusal, got 200: ${JSON.stringify(r.body).slice(0, 200)}`);
    const text = JSON.stringify(r.body);
    assert(/responseType/.test(text) && /'text' or 'base64'/.test(text), `refusal: ${text.slice(0, 400)}`);
});

await test('An answer past the 4 MB ceiling is refused with RESPONSE_TOO_LARGE', async () => {
    const r = await invoke({ file: 'huge.img', responseType: 'base64' });
    assert(r.status !== 200, 'expected a refusal, got 200');
    const text = JSON.stringify(r.body);
    assert(/RESPONSE_TOO_LARGE/.test(text) && /4 MB/.test(text), `refusal: ${text.slice(0, 400)}`);
});

await test('Signed out, the action is refused', async () => {
    const anon = await json(`/v1/ext/${EXT}/pull`, { method: 'POST', body: JSON.stringify({ port: FAR_PORT, file: 'parkano.img', responseType: 'base64' }) });
    assert(anon.status === 401, `signed out: expected 401, got ${anon.status}: ${JSON.stringify(anon.body?.error)}`);
});

far.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

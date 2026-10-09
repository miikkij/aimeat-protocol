/**
 * @file test/e2e-extension-fetch-gunzip.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An installed extension reads a gzipped answer under the ceiling its manifest
 *   declared, end to end over HTTP: install, activate, invoke, and the refusals.
 *     - `limits: { fetch_max_mb: 8 }` installs, and the record shows `limits.fetchMaxBytes`;
 *     - `ctx.fetch(url, { gunzip: true })` on a 1 MB `.xml.gz` that inflates to 6 MB answers the
 *       XML text, and the same call on an extension without the limit fails with RESPONSE_TOO_LARGE
 *       naming 4 MB;
 *     - a gzip bomb (48 MB of zeros, under 50 kB on the wire) fails with RESPONSE_TOO_LARGE naming
 *       8 MB, once inflated;
 *     - a plain answer under `gunzip: true` is read as it is;
 *     - `fetch_max_mb: -1` is refused at install (400) naming the field, and 999 is clamped to 32 MB.
 *   FIRST FAIL: against the tree before this change the 8 MB manifest installs with the limit
 *   dropped, so the guide fails with 4 MB on both extensions, and the gzip bytes are read as text.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-tv-opas-ilmaisstreameille-ja-oma-tv-kalenteri).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-fetch-gunzip

import http from 'node:http';
import { gzipSync } from 'node:zlib';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function setupOwner(label: string) {
    const name = `exgz${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext Gunzip', password: 'ExtGunzip12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Extension ctx.fetch gunzip and limits.fetch_max_mb E2E ===\n');

// ─── A far side for ctx.fetch: a gzipped guide, a gzip bomb, a plain document ───
// Far from the node's port, as e2e-extension-rows keeps its far side: neighbouring sessions run suites.
const FAR_PORT = Number(new URL(BASE).port || '40251') + 240;
const PROGRAMME = '<programme start="20261009180000 +0300" stop="20261009190000 +0300" channel="YLE.TV1.fi"><title lang="fi">Uutiset</title><desc lang="fi">Päivän uutiset ja sää.</desc></programme>\n';
const PROGRAMMES = Math.ceil((6 * MB) / Buffer.byteLength(PROGRAMME));
const GUIDE_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n' + PROGRAMME.repeat(PROGRAMMES) + '</tv>\n';
const GUIDE_GZ = gzipSync(Buffer.from(GUIDE_XML));
const BOMB_GZ = gzipSync(Buffer.alloc(48 * MB));
const far = http.createServer((req, res) => {
    if (req.url === '/guide.xml.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(GUIDE_GZ); return; }
    if (req.url === '/bomb.xml.gz') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(BOMB_GZ); return; }
    res.writeHead(404, { 'Content-Type': 'application/xml' }); res.end('<tv/>');
});
await new Promise<void>(r => far.listen(FAR_PORT, () => r()));

const STAMP = Date.now();
const EXT_WIDE = `exgzwide${STAMP}`;   // limits.fetch_max_mb: 8
const EXT_PLAIN = `exgzplain${STAMP}`; // no limit: the 4 MB default

const SCRIPTS = {
    pull: `export default async function(ctx, input){
        var r = await ctx.fetch('http://localhost:' + input.port + '/' + input.file, { gunzip: input.gunzip !== false });
        return { status: r.status, length: r.text.length, head: r.text.slice(0, 5), programmes: (r.text.match(/<programme /g) || []).length };
    }`,
};
const manifestFor = (name: string, extra: Record<string, unknown>) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'extension gunzip e2e', author: 'e2e' },
    capabilities: ['network'],
    network: { hosts: ['localhost'] },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
    ...extra,
});

let A!: Awaited<ReturnType<typeof setupOwner>>;
const invoke = (ext: string, input: Record<string, unknown>) =>
    json(`/v1/ext/${ext}/pull`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ port: FAR_PORT, ...input }) });

await test('Setup: an owner and two extensions, one with limits.fetch_max_mb: 8 and one without', async () => {
    A = await setupOwner('a');
    for (const [name, extra] of [[EXT_WIDE, { limits: { fetch_max_mb: 8 } }], [EXT_PLAIN, {}]] as const) {
        const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifestFor(name, extra), scripts: SCRIPTS }) });
        assert(inst.status === 201, `install ${name} ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(A.token) });
        assert(act.status === 200, `activate ${name} ${act.status}`);
    }
});

await test('The record shows the ceiling in bytes, and none when the manifest named none', async () => {
    const wide = await json(`/v1/extensions/${EXT_WIDE}`, { headers: auth(A.token) });
    const limits = wide.body.data?.extension?.limits ?? wide.body.data?.limits;
    // HOLE: before this change the manifest's limit was dropped and the record had no fetchMaxBytes.
    assert(limits?.fetchMaxBytes === 8 * MB, `fetchMaxBytes: ${JSON.stringify(limits)}`);
    const plain = await json(`/v1/extensions/${EXT_PLAIN}`, { headers: auth(A.token) });
    const plainLimits = plain.body.data?.extension?.limits ?? plain.body.data?.limits;
    assert(plainLimits && !('fetchMaxBytes' in plainLimits), `plain fetchMaxBytes: ${JSON.stringify(plainLimits)}`);
});

await test('gunzip: a 1 MB .xml.gz that inflates to 6 MB is read whole under the 8 MB ceiling', async () => {
    const r = await invoke(EXT_WIDE, { file: 'guide.xml.gz' });
    // HOLE: before this change the gzip bytes were read as text (head is not "<?xml") and 6 MB was refused.
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.head === '<?xml', `head: ${JSON.stringify(r.body.data.head)}`);
    assert(r.body.data.length === GUIDE_XML.length, `length ${r.body.data.length}, expected ${GUIDE_XML.length}`);
    assert(r.body.data.programmes === PROGRAMMES, `programmes ${r.body.data.programmes}, expected ${PROGRAMMES}`);
});

await test('The same guide on the extension without the limit is refused once inflated, naming 4 MB', async () => {
    const r = await invoke(EXT_PLAIN, { file: 'guide.xml.gz' });
    assert(r.status !== 200, `expected a refusal, got 200: ${JSON.stringify(r.body).slice(0, 200)}`);
    const text = JSON.stringify(r.body);
    assert(/RESPONSE_TOO_LARGE/.test(text) && /4 MB/.test(text) && /once inflated/.test(text), `refusal: ${text.slice(0, 400)}`);
});

await test('A gzip bomb is refused at the 8 MB ceiling however small it was on the wire', async () => {
    const r = await invoke(EXT_WIDE, { file: 'bomb.xml.gz' });
    assert(r.status !== 200, `expected a refusal, got 200`);
    const text = JSON.stringify(r.body);
    assert(/RESPONSE_TOO_LARGE/.test(text) && /8 MB/.test(text) && /once inflated/.test(text), `refusal: ${text.slice(0, 400)}`);
});

await test('A plain answer under gunzip: true is read as it is, status and all', async () => {
    const r = await invoke(EXT_WIDE, { file: 'missing.xml.gz' });
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.status === 404 && r.body.data.head === '<tv/>', `plain: ${JSON.stringify(r.body.data)}`);
});

await test('Without the flag the gzip bytes are not inflated', async () => {
    const r = await invoke(EXT_WIDE, { file: 'guide.xml.gz', gunzip: false });
    assert(r.status === 200, `pull ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.head !== '<?xml' && r.body.data.programmes === 0, `raw: ${JSON.stringify(r.body.data)}`);
});

await test('Install: fetch_max_mb -1 is refused naming the field; 999 is clamped to 32 MB', async () => {
    const bad = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifestFor(`exgzbad${STAMP}`, { limits: { fetch_max_mb: -1 } }), scripts: SCRIPTS }) });
    assert(bad.status === 400 && /limits\.fetch_max_mb/.test(JSON.stringify(bad.body)), `bad: ${bad.status} ${JSON.stringify(bad.body?.error)}`);
    const name = `exgzbig${STAMP}`;
    const big = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifestFor(name, { limits: { fetch_max_mb: 999 } }), scripts: SCRIPTS }) });
    assert(big.status === 201, `big install ${big.status}: ${JSON.stringify(big.body?.error)}`);
    const rec = await json(`/v1/extensions/${name}`, { headers: auth(A.token) });
    const limits = rec.body.data?.extension?.limits ?? rec.body.data?.limits;
    assert(limits?.fetchMaxBytes === 32 * MB, `clamped: ${JSON.stringify(limits)}`);
});

far.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

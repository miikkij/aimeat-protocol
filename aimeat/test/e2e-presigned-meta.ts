/**
 * @file e2e-presigned-meta.ts
 * @description E2E for two classes of bug that both shipped silently.
 *
 *   1. PRESIGNED OPTION DROP. A tool accepts an option, destructures it, then mints the upload
 *      token with a hand-written `meta` that forgets it — so the option is accepted and ignored.
 *      `aimeat_extension_install({ update: true })` did exactly this: `meta: {}`, and the PUT then
 *      failed ALREADY_EXISTS with nothing pointing at the dropped flag. Asserted here end to end:
 *      a presigned extension upload with update:true UPSERTS (preserving ext: memory and lifecycle),
 *      without it still 409s, and activate:true activates.
 *
 *   2. SANDBOX CAPABILITY GAPS. QuickJS has no crypto.subtle, so an author hand-rolls a hash while
 *      the browser side uses SHA-256 and the two silently disagree about what is up to date. The
 *      sandbox now ships ctx.hash()/ctx.now(), and install warns when a script reaches past them.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-presigned-meta
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `pmowner${Date.now() % 1000000}`;
const EXT = `pmext${Date.now() % 100000}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
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

/** Minimal stored+deflated ZIP writer — avoids adding a dev dependency just to build a fixture. */
function makeZip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [], centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.from(content, 'utf8');
        const comp = deflateRawSync(raw);
        const crc = crc32(raw) >>> 0;
        const lf = Buffer.alloc(30);
        lf.writeUInt32LE(0x04034b50, 0); lf.writeUInt16LE(20, 4); lf.writeUInt16LE(0, 6);
        lf.writeUInt16LE(8, 8); lf.writeUInt16LE(0, 10); lf.writeUInt16LE(0, 12);
        lf.writeUInt32LE(crc, 14); lf.writeUInt32LE(comp.length, 18); lf.writeUInt32LE(raw.length, 22);
        lf.writeUInt16LE(nameBuf.length, 26); lf.writeUInt16LE(0, 28);
        const local = Buffer.concat([lf, nameBuf, comp]);
        locals.push(local);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
        cd.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([cd, nameBuf]));
        offset += local.length;
    }
    const cdBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
    end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, cdBuf, end]);
}

const manifest = (version: string) => `metadata:
  name: ${EXT}
  version: "${version}"
  description: "Presigned meta round-trip fixture"
  author: ${owner}
actions:
  - id: ping
    method: POST
    path: /ping
    script: ping.js
    description: Echo back a hash + the run timestamp
    input: { type: object }
    output: { type: object }
`;
const PING_JS = `export default async function (ctx, input) {
  return { hash: ctx.hash(String(input && input.s || '')), now: ctx.now(), twice: ctx.hash('x') === ctx.hash('x') };
}`;
/** Reaches for things the sandbox does not have / that are non-deterministic — must warn. */
const UNSAFE_JS = `export default async function (ctx, input) {
  const d = Date.now();
  const r = Math.random();
  return { d, r, sub: typeof crypto.subtle };
}`;

let ownerToken = '';

/** Ask for a presigned extension upload URL through REST (same token mint the MCP tool uses). */
async function presignedExtensionUrl(opts: { update?: boolean; activate?: boolean }): Promise<string> {
    const r = await json('/v1/extensions', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ mode: 'presigned', ...opts }),
    });
    assert(r.status === 200 && r.body.data?.upload_url, `presigned mint: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.upload_url as string;
}

async function putZip(url: string, zip: Buffer) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(zip) });
    const body = await res.json() as any;
    return { status: res.status, body };
}

async function main() {
    console.log('\n=== Presigned meta + sandbox capabilities E2E ===\n');
    console.log('Setup');

    await test('register owner', async () => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register: ${reg.status}`);
        if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
        ownerToken = await getOwnerToken(owner, reg.body.data.private_key);
    });

    console.log('\nPhase 1: sandbox primitives (ctx.hash / ctx.now)');

    await test('install + activate the fixture extension', async () => {
        const r = await json('/v1/extensions', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ manifest: manifest('1.0.0'), scripts: { 'ping.js': PING_JS } }),
        });
        assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
        const a = await json(`/v1/extensions/${EXT}/activate`, {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(a.status === 200, `activate: ${a.status} ${JSON.stringify(a.body)}`);
    });

    await test('ctx.hash is available, stable, and 16 hex chars', async () => {
        const r = await json(`/v1/ext/${EXT}/ping`, {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ s: 'hello' }),
        });
        assert(r.status === 200 && r.body.ok, `invoke: ${r.status} ${JSON.stringify(r.body)}`);
        const d = r.body.data;
        assert(/^[0-9a-f]{16}$/.test(d.hash), `expected 16 hex chars, got ${d.hash}`);
        assert(d.twice === true, 'the same input hashes identically within a run');
    });

    await test('ctx.hash matches the PUBLISHED reference implementation byte for byte', async () => {
        // The whole point of shipping ctx.hash: a browser app must be able to compute the SAME
        // value. Recompute it here with the exported reference source and compare.
        const { EXT_HASH_REFERENCE_JS } = await import('../src/services/extension-runtime.js');
        const aimeatHash = new Function(`${EXT_HASH_REFERENCE_JS}; return aimeatHash;`)() as (s: string) => string;
        const r = await json(`/v1/ext/${EXT}/ping`, {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ s: 'lattice-cell-inputs' }),
        });
        assert(r.body.data.hash === aimeatHash('lattice-cell-inputs'),
            `sandbox ${r.body.data.hash} !== reference ${aimeatHash('lattice-cell-inputs')}`);
    });

    await test('ctx.now returns one ISO timestamp for the run', async () => {
        const r = await json(`/v1/ext/${EXT}/ping`, {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ s: 'x' }),
        });
        assert(!Number.isNaN(Date.parse(r.body.data.now)), `ctx.now not an ISO timestamp: ${r.body.data.now}`);
    });

    console.log('\nPhase 2: install warns about sandbox-unavailable / non-deterministic APIs');

    await test('installing a script using crypto.subtle / Date.now / Math.random warns', async () => {
        const name = `${EXT}unsafe`;
        const r = await json('/v1/extensions', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                manifest: manifest('1.0.0').replace(`name: ${EXT}`, `name: ${name}`),
                scripts: { 'ping.js': UNSAFE_JS },
            }),
        });
        assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
        const w: string[] = r.body.data.warnings ?? [];
        assert(w.length >= 3, `expected warnings, got ${JSON.stringify(w)}`);
        assert(w.some(x => x.includes('crypto.subtle')), 'warns about crypto.subtle');
        assert(w.some(x => x.includes('ctx.now()')), 'points Date.now at ctx.now()');
        assert(w.some(x => x.includes('Math.random')), 'warns about Math.random');
    });

    await test('a clean script installs with no warnings', async () => {
        const name = `${EXT}clean`;
        const r = await json('/v1/extensions', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                manifest: manifest('1.0.0').replace(`name: ${EXT}`, `name: ${name}`),
                scripts: { 'ping.js': PING_JS },
            }),
        });
        assert(r.status === 201, `install: ${r.status}`);
        assert(r.body.data.warnings === undefined, `expected no warnings, got ${JSON.stringify(r.body.data.warnings)}`);
    });

    console.log('\nPhase 3: the presigned token carries update / activate');

    await test('presigned upload WITHOUT update still refuses an existing name (409)', async () => {
        const url = await presignedExtensionUrl({});
        const r = await putZip(url, makeZip({ 'manifest.yaml': manifest('2.0.0'), 'scripts/ping.js': PING_JS }));
        assert(r.status === 409, `expected 409, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(String(r.body.message).includes('update:true'), 'the 409 tells you how to upsert');
    });

    await test('presigned upload WITH update:true upserts in place', async () => {
        const url = await presignedExtensionUrl({ update: true });
        const r = await putZip(url, makeZip({ 'manifest.yaml': manifest('2.0.0'), 'scripts/ping.js': PING_JS }));
        assert(r.status === 200 && r.body.success, `expected upsert, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.updated === true, 'reported as an update');
        assert(r.body.version === '2.0.0', `new version applied, got ${r.body.version}`);
    });

    await test('the upsert PRESERVED the active status (that is why it beats delete+reinstall)', async () => {
        const g = await json(`/v1/extensions/${EXT}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(g.body.data.extension.status === 'active', `expected still active, got ${g.body.data.extension.status}`);
    });

    await test('presigned upload with activate:true activates a fresh install', async () => {
        const name = `${EXT}act`;
        const url = await presignedExtensionUrl({ activate: true });
        const r = await putZip(url, makeZip({
            'manifest.yaml': manifest('1.0.0').replace(`name: ${EXT}`, `name: ${name}`),
            'scripts/ping.js': PING_JS,
        }));
        assert(r.status === 200 && r.body.success, `install: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.status === 'active', `expected active on arrival, got ${r.body.status}`);
    });

    await test('a ZIP upload surfaces the same sandbox warnings as the inline path', async () => {
        const name = `${EXT}zipwarn`;
        const url = await presignedExtensionUrl({});
        const r = await putZip(url, makeZip({
            'manifest.yaml': manifest('1.0.0').replace(`name: ${EXT}`, `name: ${name}`),
            'scripts/ping.js': UNSAFE_JS,
        }));
        assert(r.status === 200, `install: ${r.status} ${JSON.stringify(r.body)}`);
        assert(Array.isArray(r.body.warnings) && r.body.warnings.length >= 3,
            `ZIP path must warn too, got ${JSON.stringify(r.body.warnings)}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

await main();

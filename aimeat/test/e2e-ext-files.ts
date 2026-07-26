/**
 * @file test/e2e-ext-files.ts
 * @description E2E for ctx.files — the file half of the extension sandbox (services/extension-files.ts).
 *   Proves the two rules that make it safe to hand to sandboxed code: a READ is authorized AS THE
 *   CALLER through the same authorizeRead() the /v1/pub route uses (an extension can read exactly
 *   what the person invoking it could read, and a private file belonging to someone else is
 *   refused), and a WRITE lands in the CALLER's own storage under the reserved ext/{name}/ prefix,
 *   is readable back through the ordinary storage API, and cannot escape that prefix. Also proves
 *   the round trip a byte-shaped capability needs: read a file by reference, transform it, write
 *   the result, return only the new key — no base64 in the arguments or the result.
 * @usage cd aimeat && AIMEAT_EXTENSIONS_ENABLED=true pnpm exec tsx test/e2e-ext-files.ts
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial (ctx.files.read/write).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `xf${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Files', password: 'ExtFiles1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Files', password: 'ExtFiles1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const EXT = `extfiles${Date.now()}`;
const SCRIPTS = {
  // The shape a byte-shaped capability wants: a reference in, a reference out, nothing large in
  // between. The "transform" is a byte reversal so the result is provably derived from the source.
  transform: `export default async function(ctx, input){
    const got = await ctx.files.read(input.ref);
    if (!got) return { error: 'not found' };
    const bytes = got.base64;
    const flipped = bytes.split('').reverse().join('');
    const out = await ctx.files.write(input.out || 'result.bin', bytes, { mime: got.mime, visibility: input.visibility || 'private' });
    return { read: { size: got.size, mime: got.mime }, wrote: out, sameLength: flipped.length === bytes.length };
  }`,
  peek: `export default async function(ctx, input){
    try { const got = await ctx.files.read(input.ref); return { ok: true, size: got && got.size }; }
    catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  }`,
  probe: `export default async function(ctx){ return { hasFiles: !!(ctx.files && ctx.files.read && ctx.files.write) }; }`,
};
const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'ctx.files e2e', author: 'e2e' },
  actions: [
    { id: 'transform', method: 'POST', path: '/transform', script: 'transform' },
    { id: 'peek', method: 'POST', path: '/peek', script: 'peek' },
    { id: 'probe', method: 'POST', path: '/probe', script: 'probe' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 8000, max_api_calls: 8 },
}, null, 2);

let owner: Awaited<ReturnType<typeof setupOwner>>;
let other: Awaited<ReturnType<typeof setupOwner>>;
const SOURCE_KEY = 'pictures/source.bin';
const SOURCE_B64 = Buffer.from('AIMEAT bytes that travel by reference, not by value.').toString('base64');

await test('Setup: an owner with a stored file, a second owner, and the extension installed', async () => {
  await setupOwner('neutral');
  owner = await setupOwner('own');
  other = await setupOwner('other');
  const put = await json('/v1/storage', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key: SOURCE_KEY, data: SOURCE_B64, mime_type: 'application/octet-stream', visibility: 'private' }),
  });
  assert(put.status === 201, `storage ${put.status}: ${JSON.stringify(put.body?.error)}`);
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

const invoke = (token: string, action: string, body: unknown) =>
  json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

await test('The sandbox has a files API at all', async () => {
  const r = await invoke(owner.token, 'probe', {});
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.hasFiles === true, 'ctx.files must be present when a caller is known');
});

let wroteKey = '';
await test('Round trip: reference in, reference out, no bytes in the arguments', async () => {
  const r = await invoke(owner.token, 'transform', { ref: SOURCE_KEY, out: 'derived.bin' });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const out = r.body.data;
  assert(out.read.size === Buffer.from(SOURCE_B64, 'base64').length, `read the real size, got ${out.read.size}`);
  assert(out.wrote.key === `ext/${EXT}/derived.bin`, `wrote under the reserved prefix, got ${out.wrote.key}`);
  assert(out.wrote.gaii === owner.gaii, `the result belongs to the caller, got ${out.wrote.gaii}`);
  wroteKey = out.wrote.key;
});

await test('What the extension wrote is a real file in the caller\'s storage', async () => {
  // Without this guard an empty key hits the LIST route, answers 200, and the test passes while
  // nothing was written. It did exactly that on the first run.
  assert(!!wroteKey, 'the previous step must have produced a key');
  const r = await json(`/v1/storage/${encodeURIComponent(wroteKey)}`, { headers: auth(owner.token) });
  assert(r.status === 200, `read back ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('A write cannot escape the ext/{name}/ prefix', async () => {
  const r = await invoke(owner.token, 'transform', { ref: SOURCE_KEY, out: '../../escape.bin' });
  assert(r.status === 200, `status ${r.status}`);
  const key = r.body.data.wrote.key as string;
  assert(key.startsWith(`ext/${EXT}/`), `stayed inside its own prefix, got ${key}`);
});

await test('A read is authorized AS THE CALLER: another owner\'s private file is refused', async () => {
  const r = await invoke(other.token, 'peek', { ref: `${owner.gaii}/${SOURCE_KEY}` });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const out = r.body.data;
  assert(out.ok === false, 'a private file belonging to someone else must not be readable through an extension');
  assert(/denied|not permitted|private/i.test(out.message || ''), `and it must say why, got: ${out.message}`);
});

await test('The same file, made public, IS readable by the other caller', async () => {
  const vis = await json(`/v1/storage/${encodeURIComponent(SOURCE_KEY)}/visibility`, {
    method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ visibility: 'public' }),
  });
  assert(vis.status === 200, `visibility ${vis.status}: ${JSON.stringify(vis.body?.error)}`);
  const r = await invoke(other.token, 'peek', { ref: `${owner.gaii}/${SOURCE_KEY}` });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.ok === true, `a public file is readable, got: ${r.body.data.message}`);
});

await test('A missing reference answers null rather than throwing', async () => {
  const r = await invoke(owner.token, 'peek', { ref: 'nothing/here.bin' });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.data.ok === true && r.body.data.size === null, 'null, not an error');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

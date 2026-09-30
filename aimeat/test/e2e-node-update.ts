/**
 * @file e2e-node-update.ts
 * @description E2E for GET /v1/admin/node-update, the read behind the operator's new-version notice
 *   in the header and the aimeat_admin_node_update MCP tool.
 *
 *   A STUB REGISTRY, NOT npm. The suite serves the three reads the check makes (the latest version,
 *   the release date, the newer change log) from a server of its own on 127.0.0.1 and points the node
 *   at it with the node.update_check_source setting. The E2E node runs in dev mode, which lets
 *   safeFetch reach localhost. Every answer is decided here, so the assertions do not depend on what
 *   npm holds today, and the failure and the switched-off paths can be asserted at all.
 *
 *   WHAT IS NEW IS A DIFF. The stub's change log carries one entry this node already has (the newest
 *   of its own public/changelog.json) and one it does not; only the second may come back.
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=node-update

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 300));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function ownerToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${short(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(tok.body.ok === true, `token ${name}: ${short(tok.body.error)}`);
    return tok.body.data.token as string;
}

// ── The stub registry ──

const current = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }).version;
const newer = `${Number(current.split('.')[0]) + 1}.0.0`;
const RELEASED = '2026-10-01T09:30:00.000Z';
const localNewest = (JSON.parse(readFileSync(join(ROOT, 'public', 'changelog.json'), 'utf-8')) as { entries: any[] }).entries[0];
const NEW_ENTRY = { date: '2026-10-01', kind: 'feature', title: { en: `Stub entry only ${newer} has`, fi: 'Vain uudessa' }, body: 'Written by the E2E stub.' };

const stub = { latest: newer, fail: false, hits: 0 };
const server: Server = createServer((req, res) => {
    stub.hits++;
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (stub.fail) return send(500, { error: 'stub down' });
    const url = req.url ?? '';
    if (url === '/aimeat/latest') return send(200, { name: 'aimeat', version: stub.latest });
    if (url.startsWith('/-/v1/search')) return send(200, { objects: [{ package: { name: 'aimeat', version: stub.latest, date: RELEASED } }] });
    if (url === '/aimeat') return send(200, { time: { [stub.latest]: RELEASED } });
    if (url === `/aimeat@${stub.latest}/dist/public/changelog.json`) return send(200, { entries: [NEW_ENTRY, localNewest] });
    return send(404, { error: 'not here' });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const SOURCE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

console.log('\n=== AIMEAT Node Update Check E2E ===\n');

const stamp = Date.now();
let opToken = '';
let otherToken = '';
const setConfig = (path: string, value: unknown) => json('/v1/admin/config', {
    method: 'PUT', headers: auth(opToken), body: JSON.stringify({ changes: [{ path, value }] }),
});

await test('Setup: an operator, a second owner who is not one, and the node pointed at the stub', async () => {
    opToken = await ownerToken(`nuop${stamp}`);
    otherToken = await ownerToken(`nuother${stamp}`);
    const r = await setConfig('node.update_check_source', SOURCE);
    assert(r.status === 200, `set source: ${r.status} ${short(r.body)}`);
});

await test('Without a session the check answers 401', async () => {
    const r = await json('/v1/admin/node-update');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('An owner who is not an operator gets 403 and the registry is not asked', async () => {
    const before = stub.hits;
    const r = await json('/v1/admin/node-update?refresh=true', { headers: auth(otherToken) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    assert(stub.hits === before, `the registry was asked ${stub.hits - before} time(s) for a refused caller`);
});

await test('A newer version: the version, the date, only what is new, and the prompt', async () => {
    const r = await json('/v1/admin/node-update?refresh=true', { headers: auth(opToken) });
    assert(r.status === 200, `status ${r.status}: ${short(r.body.error)}`);
    const d = r.body.data;
    assert(d.enabled === true, `enabled: ${d.enabled}`);
    assert(d.current === current, `current ${d.current}, package.json says ${current}`);
    assert(d.latest === newer && d.updateAvailable === true, `latest ${d.latest}, updateAvailable ${d.updateAvailable}`);
    assert(d.releasedAt === RELEASED, `releasedAt: ${d.releasedAt}`);
    assert(Array.isArray(d.whatsNew) && d.whatsNew.length === 1, `whatsNew should hold only the new entry: ${short(d.whatsNew)}`);
    assert(d.whatsNew[0].title.en === NEW_ENTRY.title.en, `whatsNew[0]: ${short(d.whatsNew[0])}`);
    assert(d.error === null, `error: ${d.error}`);
    assert(['npm', 'npx', 'source', 'docker', 'desktop', 'unknown'].includes(d.install?.method), `install.method: ${d.install?.method}`);
    assert(d.setting === 'node.update_check', `setting: ${d.setting}`);
    assert(typeof d.prompt === 'string' && d.prompt.includes(`from version ${current} to ${newer}`), 'the prompt names both versions');
    assert(d.prompt.includes('/v1/build') && d.prompt.includes('aimeat_admin_node_update'), 'the prompt says how to check the result, with and without MCP');
});

await test('The same version on npm: no update and no prompt', async () => {
    stub.latest = current;
    const r = await json('/v1/admin/node-update?refresh=true', { headers: auth(opToken) });
    stub.latest = newer;
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.updateAvailable === false && r.body.data.latest === current, `data: ${short(r.body.data)}`);
    assert(r.body.data.prompt === null && r.body.data.whatsNew === null, `prompt/whatsNew should be null: ${short(r.body.data)}`);
});

await test('The registry failing: 200 with the reason, and no notice', async () => {
    stub.fail = true;
    const r = await json('/v1/admin/node-update?refresh=true', { headers: auth(opToken) });
    stub.fail = false;
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.updateAvailable === false, `updateAvailable: ${r.body.data.updateAvailable}`);
    assert(typeof r.body.data.error === 'string' && r.body.data.error.length > 0, `error: ${r.body.data.error}`);
});

await test('Switched off: enabled false, and the registry is not asked even with refresh', async () => {
    const off = await setConfig('node.update_check', false);
    assert(off.status === 200, `switch off: ${off.status} ${short(off.body)}`);
    const before = stub.hits;
    const r = await json('/v1/admin/node-update?refresh=true', { headers: auth(opToken) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.enabled === false && r.body.data.updateAvailable === false, `data: ${short(r.body.data)}`);
    assert(stub.hits === before, `the registry was asked ${stub.hits - before} time(s) with the check off`);
});

await test('Cleanup: both settings back to their defaults', async () => {
    for (const path of ['node.update_check', 'node.update_check_source']) {
        const r = await json(`/v1/admin/config/${encodeURIComponent(path)}`, { method: 'DELETE', headers: auth(opToken) });
        assert(r.status === 200, `reset ${path}: ${r.status} ${short(r.body)}`);
    }
});

await new Promise<void>(resolve => server.close(() => resolve()));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

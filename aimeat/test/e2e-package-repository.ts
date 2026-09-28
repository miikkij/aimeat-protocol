/**
 * @file e2e-package-repository.ts
 * @description A package repository and a customer node, both real, in one process (install packages,
 *   phase 3). The repository serves a PRIVATE package only to the node it is entitled to, on that
 *   node's signed request; the customer pulls it, installs it managed, and the update check brings
 *   a newer version in by itself; when the entitlement's updates end, the install stays and gets
 *   nothing newer.
 * @structure
 *   - Setup: boot R (repository) and C (customer), an owner each, each the other's active peer
 *   - Phase 1: before the entitlement: not listed, not served, not pulled
 *   - Phase 2: the entitlement: listed, pulled, installed managed with auto-update on
 *   - Phase 3: refusals: a forged signature, an unsigned read, the repository role off
 *   - Phase 4: a newer version arrives and is applied by the update check
 *   - Phase 5: auto-update off reports instead of updating; the updates end
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-repository
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface NodeState {
    server: Server; config: AimeatConfig; baseUrl: string; nodeId: string; adminPw: string;
    ownerName: string; ownerToken: string;
    json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
}

function makeJson(baseUrl: string) {
    return async (path: string, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

async function bootNode(port: number, nodeId: string, repository: boolean): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';

    const { config } = loadConfig({});
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://127.0.0.1:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    config.packagesEnabled = true;
    config.packageFederationEnabled = true;
    config.packageCreateRole = 'owner';
    config.packageRepository = repository;

    const { app } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    return { server, config, baseUrl: `http://127.0.0.1:${port}`, nodeId, adminPw, ownerName: '', ownerToken: '', json: makeJson(`http://127.0.0.1:${port}`) };
}

async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    node.ownerName = ownerName;
    node.ownerToken = tok.body.token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function peer(from: NodeState, to: NodeState): Promise<void> {
    const card = await to.json('/.well-known/aimeat');
    const key = card.body.data?.public_key;
    assert(typeof key === 'string' && key.length > 0, `${to.nodeId} publishes a key`);
    const add = await from.json('/v1/federation/peers', {
        method: 'POST', headers: auth(from.ownerToken), body: JSON.stringify({ node_id: to.nodeId, url: to.baseUrl, public_key: key }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);
    const act = await from.json(`/v1/federation/peers/${encodeURIComponent(to.nodeId)}`, {
        method: 'PUT', headers: auth(from.ownerToken), body: JSON.stringify({ status: 'active', share_catalogue: true }),
    });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body)}`);
}

console.log('\n=== AIMEAT Package Repository E2E ===\n');

let R: NodeState;
let C: NodeState;
const ts = Date.now() % 1000000;
const PKG = `repopack${ts}`;
let groupOnR = '';
let localGroup = '';
let instanceId = '';

const component = (v: string) => ({ id: 'csm-core', type: 'csm', label: 'Core', content: JSON.stringify({ fields: ['a'], v }), dependencies: [] });

async function publishVersion(v: string, status = 'published'): Promise<string> {
    await new Promise((r) => setTimeout(r, 1100));
    const r = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/versions`, {
        method: 'POST', headers: auth(R.ownerToken),
        body: JSON.stringify({ changelog: v, status, visibility: 'private', components: [component(v)] }),
    });
    assert(r.status === 201, `version ${v}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.version as string;
}

console.log('Setup');

await test('Boot R (repository) and C (customer), an owner each, each the other\'s active peer', async () => {
    // 40731-40732: clear of the 4025x-4029x band thirty-odd suites hardcode, and of 40701/40702.
    R = await bootNode(40731, `aimeat-test-001-repo${ts}`, true);
    C = await bootNode(40732, `aimeat-test-001-cust${ts}`, false);
    await setupOwner(R, `repo${ts}`);
    await setupOwner(C, `cust${ts}`);
    await peer(C, R);
    await peer(R, C);
    assert(R.config.packageRepository === true && C.config.packageRepository === false, 'R holds the repository role and C does not');
});

await test('R publishes a private package', async () => {
    const r = await R.json('/v1/packages', {
        method: 'POST', headers: auth(R.ownerToken),
        body: JSON.stringify({ name: PKG, description: 'Sold to customers', category: 'utility', visibility: 'private', components: [component('v1')] }),
    });
    assert(r.status === 201 && r.body.data.status === 'published' && r.body.data.visibility === 'private', `publish: ${r.status} ${JSON.stringify(r.body)}`);
    groupOnR = r.body.data.packageGroupId;
    localGroup = `${PKG}::${C.ownerName}`;
});

console.log('\nPhase 1 — Before the entitlement');

await test('C\'s listing of R does not carry the private package', async () => {
    const r = await C.json(`/v1/federation/peers/${encodeURIComponent(R.nodeId)}/packages`, { headers: auth(C.ownerToken) });
    assert(r.status === 200, `listing: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(r.body.data.packages as any[]).some((p) => p.group_id === groupOnR), 'not listed');
});

await test('C cannot pull it', async () => {
    const r = await C.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId }),
    });
    assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 2 — The entitlement');

await test('A stranger cannot grant entitlements to R\'s package; R\'s author can', async () => {
    const other = await C.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(C.ownerToken), body: JSON.stringify({}),
    });
    assert(other.status === 404, `on C there is no such package: ${other.status}`);
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ note: 'order 1' }),
    });
    assert(g.status === 200 && g.body.data.entitlement.updatesUntil === null && g.body.data.repository_role === true, `grant: ${g.status} ${JSON.stringify(g.body)}`);
    const list = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements`, { headers: auth(R.ownerToken) });
    assert(list.body.data.entitlements.length === 1 && list.body.data.entitlements[0].nodeId === C.nodeId, `list: ${JSON.stringify(list.body)}`);
});

await test('C\'s listing now carries it, with updates running', async () => {
    const r = await C.json(`/v1/federation/peers/${encodeURIComponent(R.nodeId)}/packages`, { headers: auth(C.ownerToken) });
    const row = (r.body.data.packages as any[]).find((p) => p.group_id === groupOnR);
    assert(!!row && row.visibility === 'private' && row.updates_until === null, `row: ${JSON.stringify(row)}`);
});

await test('C pulls it and installs it managed, with auto-update on', async () => {
    const pull = await C.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId }),
    });
    assert(pull.status === 201 && pull.body.data.applied === true, `pull: ${pull.status} ${JSON.stringify(pull.body)}`);
    const inst = await C.json(`/v1/packages/${encodeURIComponent(localGroup)}/install`, {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ label: 'Bought', mode: 'managed' }),
    });
    assert(inst.status === 201 && inst.body.data.mode === 'managed' && inst.body.data.autoUpdate === true, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    instanceId = inst.body.data.id;
});

console.log('\nPhase 3 — Refusals');

await test('An unsigned read of the private package answers 404', async () => {
    const res = await fetch(`${R.baseUrl}/v1/packages/${encodeURIComponent(groupOnR)}/export`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test('A request naming C but signed with another key answers 401', async () => {
    const forged = await generateKeyPair();
    const timestamp = new Date().toISOString();
    const signature = await sign(forged.privateKey, JSON.stringify({ source_node: C.nodeId, timestamp, purpose: 'package', group_id: groupOnR }));
    const res = await fetch(`${R.baseUrl}/v1/packages/${encodeURIComponent(groupOnR)}/export`, {
        headers: { 'x-source-node': C.nodeId, 'x-timestamp': timestamp, 'x-signature': signature },
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
});

await test('With the repository role off, even the entitled node is not served', async () => {
    R.config.packageRepository = false;
    try {
        const r = await C.json('/v1/federation/packages/pull', {
            method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId }),
        });
        assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
    } finally {
        R.config.packageRepository = true;
    }
});

console.log('\nPhase 4 — A newer version');

let v2 = '';
await test('R publishes v2; C\'s update check pulls it and updates the managed install', async () => {
    v2 = await publishVersion('v2');
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    assert(r.status === 200, `check: ${r.status} ${JSON.stringify(r.body)}`);
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    assert(o?.pulled === true && o?.result === 'updated', `outcome: ${JSON.stringify(o)}`);
    const inst = await C.json(`/v1/instances/${instanceId}`, { headers: auth(C.ownerToken) });
    assert(inst.body.data.packageVersion === o.latest, `the install is on the newest local version: ${inst.body.data.packageVersion} vs ${o.latest}`);
});

await test('A second check finds nothing new', async () => {
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    assert(o?.pulled === false && o?.result === 'current', `outcome: ${JSON.stringify(o)}`);
});

console.log('\nPhase 5 — Auto-update off, then the updates end');

await test('With auto-update off, a newer version is reported ready and the install stays', async () => {
    const off = await C.json(`/v1/instances/${instanceId}`, { method: 'PATCH', headers: auth(C.ownerToken), body: JSON.stringify({ auto_update: false }) });
    assert(off.status === 200 && off.body.data.autoUpdate === false, `patch: ${off.status} ${JSON.stringify(off.body)}`);
    const before = (await C.json(`/v1/instances/${instanceId}`, { headers: auth(C.ownerToken) })).body.data.packageVersion;
    await publishVersion('v3');
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    assert(o?.pulled === true && o?.result === 'current' && o?.version === before && o?.latest !== before, `outcome: ${JSON.stringify(o)}`);
});

await test('When the updates end, a version made after it is not served, and the install stays', async () => {
    const until = new Date().toISOString();
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ updates_until: until }),
    });
    assert(g.status === 200 && g.body.data.entitlement.updatesUntil === until, `end: ${g.status} ${JSON.stringify(g.body)}`);
    await publishVersion('v4');
    const on = await C.json(`/v1/instances/${instanceId}`, { method: 'PATCH', headers: auth(C.ownerToken), body: JSON.stringify({ auto_update: true }) });
    assert(on.status === 200, `patch: ${on.status}`);
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    // v4 is past the end, so nothing new is pulled; the v3 that C already holds from before the end
    // is still its own, and auto-update applies it.
    assert(o?.pulled === false, `nothing past the end is pulled: ${JSON.stringify(o)}`);
    const listing = await C.json(`/v1/federation/peers/${encodeURIComponent(R.nodeId)}/packages`, { headers: auth(C.ownerToken) });
    const row = (listing.body.data.packages as any[]).find((p) => p.group_id === groupOnR);
    assert(row.updates_until === until && row.version !== undefined, `the listing shows the end: ${JSON.stringify(row)}`);
    const direct = await C.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId, version: '' }),
    });
    assert(direct.status === 200 && direct.body.data.applied === false, `a pull after the end brings nothing newer: ${direct.status} ${JSON.stringify(direct.body)}`);
    void v2;
});

console.log('\nPhase 6 — Release channels');

let v4 = '';
let v5 = '';
await test('A new grant runs the updates again; the stable channel takes the newest published version', async () => {
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ note: 'order 2' }),
    });
    assert(g.status === 200 && g.body.data.entitlement.updatesUntil === null && g.body.data.entitlement.channel === 'stable', `regrant: ${g.status} ${JSON.stringify(g.body)}`);
    const versions = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/versions`, { headers: auth(R.ownerToken) });
    v4 = (versions.body.data.versions as any[]).find((x) => x.changelog === 'v4')?.version;
    assert(!!v4, `v4 on R: ${JSON.stringify(versions.body)}`);
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    assert(o?.pulled === true && o?.result === 'updated', `v4 arrives: ${JSON.stringify(o)}`);
});

await test('A beta version is not served on the stable channel, and naming it answers not found', async () => {
    v5 = await publishVersion('v5', 'beta');
    const listing = await C.json(`/v1/federation/peers/${encodeURIComponent(R.nodeId)}/packages`, { headers: auth(C.ownerToken) });
    const row = (listing.body.data.packages as any[]).find((p) => p.group_id === groupOnR);
    assert(row?.version === v4 && row?.channel === 'stable', `stable lists v4: ${JSON.stringify(row)}`);
    const direct = await C.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId, version: v5 }),
    });
    assert(direct.status === 404 && direct.body.error?.code === 'NOT_FOUND', `v5 on stable: ${direct.status} ${JSON.stringify(direct.body)}`);
});

await test('An unknown channel is refused', async () => {
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ channel: 'nightly' }),
    });
    assert(g.status === 400 && g.body.error?.code === 'INVALID_INPUT', `nightly: ${g.status} ${JSON.stringify(g.body)}`);
});

await test('On the beta channel, the beta version is listed, pulled and applied', async () => {
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ channel: 'beta' }),
    });
    assert(g.status === 200 && g.body.data.entitlement.channel === 'beta', `beta grant: ${g.status} ${JSON.stringify(g.body)}`);
    const listing = await C.json(`/v1/federation/peers/${encodeURIComponent(R.nodeId)}/packages`, { headers: auth(C.ownerToken) });
    const row = (listing.body.data.packages as any[]).find((p) => p.group_id === groupOnR);
    assert(row?.version === v5 && row?.channel === 'beta', `beta lists v5: ${JSON.stringify(row)}`);
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    assert(o?.pulled === true && o?.result === 'updated', `v5 arrives: ${JSON.stringify(o)}`);
});

await test('Revoking the entitlement stops the listing and the pull', async () => {
    const del = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, { method: 'DELETE', headers: auth(R.ownerToken) });
    assert(del.status === 200, `revoke: ${del.status} ${JSON.stringify(del.body)}`);
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    const o = (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
    // A revoked node holds no entitlement at all, so the repository answers as for a stranger: 404.
    assert(o?.result === 'error' && String(o?.detail).startsWith('NOT_FOUND'), `a revoked node gets nothing: ${JSON.stringify(o)}`);
    const inst = await C.json(`/v1/instances/${instanceId}`, { headers: auth(C.ownerToken) });
    assert(inst.status === 200 && inst.body.data.status === 'installed', 'and the install stays');
});

console.log('\nCleanup');
// Close and exit without awaiting: C fetched R over keep-alive (see e2e-federation-packages.ts).
try { R!.server.close(); C!.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

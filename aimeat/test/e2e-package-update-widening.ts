/**
 * @file e2e-package-update-widening.ts
 * @description The daily package update check does not install a version that can do more than the
 *   owner approved (package sale design, T7; src/services/packages/peer/package-upstream-refresh.ts,
 *   the `widenedItems` branch of refreshOne).
 *
 *   WHY THIS SUITE. That branch is the only check between a package author's new version and an
 *   unattended install on the customer's node: the job calls updateInstanceToLatest as the owner in
 *   person, and the code-install refusal returns early for that caller. Before this suite no test
 *   published a wider version to an install with auto-update on, so the branch could be removed or
 *   fed the wrong approved list with every suite green (QA audit F08c-03).
 *
 *   WHAT IT PROVES, on two real nodes in one process (R the repository, C the customer):
 *   - positive control: a version that adds no capability is applied by the check;
 *   - a version that adds an extension with network access is NOT applied: the outcome is
 *     `needs_owner`, the install stays on its version, the route (notify off) sends no notification,
 *     and the daily job (the real core handler, notify on) tells the owner exactly once over two runs;
 *   - the owner's own update applies it and records the new approval, after which the check is quiet.
 * @structure
 *   - Setup: boot R and C, an owner each, active peers; R's private package, entitled to C, installed
 *     managed on C with auto-update on
 *   - Phase 1: a version that adds nothing moves the install
 *   - Phase 2: a version that adds an extension waits for the owner
 *   - Phase 3: the owner applies it
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-update-widening
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F08c-03).
 */

import { randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import type { Server } from 'node:http';
import { suitePort } from './helpers/free-port.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Scheduler { triggerNow(id: string): Promise<unknown> }
interface NodeState {
    server: Server; config: AimeatConfig; storage: Storage; scheduler: Scheduler; baseUrl: string; nodeId: string; adminPw: string;
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

    const { app, storage, scheduler } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    return {
        server, config, storage, scheduler: scheduler as unknown as Scheduler, baseUrl: `http://127.0.0.1:${port}`, nodeId, adminPw,
        ownerName: '', ownerToken: '', json: makeJson(`http://127.0.0.1:${port}`),
    };
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

console.log('\n=== AIMEAT Package update that widens what the package can do E2E ===\n');

let R: NodeState;
let C: NodeState;
const ts = Date.now() % 1000000;
const PKG = `widenpack${ts}`;
const EXT = `widenext${ts}`;
let groupOnR = '';
let localGroup = '';
let instanceId = '';

const csm = (v: string) => ({ id: 'csm-core', type: 'csm', label: 'Core', content: JSON.stringify({ fields: ['a'], v }), dependencies: [] });
const EXT_MANIFEST = [
    'metadata:',
    `  name: ${EXT}`,
    '  version: 1.0.0',
    '  description: Calls out and keeps a key',
    '  author: e2e',
    'actions:',
    '  - id: ping',
    '    method: POST',
    '    path: /ping',
    '    script: ping',
    'config:',
    '  apiKey:',
    '    type: secret',
    '    description: The service key',
].join('\n');
const extension = () => ({
    id: EXT, type: 'extension', label: EXT, dependencies: [],
    content: JSON.stringify({ manifest: EXT_MANIFEST, scripts: { ping: 'export default async function(ctx){ const r = await ctx.fetch("https://example.com/"); return { status: r.status }; }' } }),
});

async function publishVersion(changelog: string, components: unknown[]): Promise<void> {
    // Versions are stamped to the second; a second apart keeps them ordered.
    await new Promise((r) => setTimeout(r, 1100));
    const r = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/versions`, {
        method: 'POST', headers: auth(R.ownerToken),
        body: JSON.stringify({ changelog, status: 'published', visibility: 'private', components }),
    });
    assert(r.status === 201, `version ${changelog}: ${r.status} ${JSON.stringify(r.body)}`);
}

async function installedVersion(): Promise<string> {
    const inst = await C.json(`/v1/instances/${instanceId}`, { headers: auth(C.ownerToken) });
    assert(inst.status === 200, `read the install: ${inst.status} ${JSON.stringify(inst.body)}`);
    return inst.body.data.packageVersion as string;
}

async function checkByRoute(): Promise<any> {
    const r = await C.json('/v1/instances/check-updates', { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    assert(r.status === 200, `check: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data.outcomes as any[]).find((x) => x.instance_id === instanceId);
}

async function approvalNotices(): Promise<number> {
    const notes = await C.storage.listMemory(`${C.ownerName}@${C.nodeId}`, { prefix: 'notif.' });
    return notes.filter(r => (r.value as { type?: string } | undefined)?.type === 'package_update_needs_approval').length;
}

console.log('Setup');

await test('Boot R (repository) and C (customer); R\'s private package is installed managed on C with auto-update on', async () => {
    R = await bootNode(suitePort(32300, BASE), `aimeat-test-001-wrepo${ts}`, true);
    C = await bootNode(suitePort(32400, BASE), `aimeat-test-001-wcust${ts}`, false);
    await setupOwner(R, `wrepo${ts}`);
    await setupOwner(C, `wcust${ts}`);
    await peer(C, R);
    await peer(R, C);
    const pub = await R.json('/v1/packages', {
        method: 'POST', headers: auth(R.ownerToken),
        body: JSON.stringify({ name: PKG, description: 'Sold to customers', category: 'utility', visibility: 'private', components: [csm('v1')] }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    groupOnR = pub.body.data.packageGroupId;
    localGroup = `${PKG}::${C.ownerName}`;
    const g = await R.json(`/v1/packages/${encodeURIComponent(groupOnR)}/entitlements/${C.nodeId}`, {
        method: 'PUT', headers: auth(R.ownerToken), body: JSON.stringify({ note: 'order 1' }),
    });
    assert(g.status === 200, `grant: ${g.status} ${JSON.stringify(g.body)}`);
    const pull = await C.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ group_id: groupOnR, node_id: R.nodeId }),
    });
    assert(pull.status === 201 && pull.body.data.applied === true, `pull: ${pull.status} ${JSON.stringify(pull.body)}`);
    const inst = await C.json(`/v1/packages/${encodeURIComponent(localGroup)}/install`, {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ label: 'Bought', mode: 'managed' }),
    });
    assert(inst.status === 201 && inst.body.data.autoUpdate === true, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    instanceId = inst.body.data.id;
});

console.log('\nPhase 1 — A version that adds nothing');

await test('Positive control: a version that adds no capability is pulled and applied by the check', async () => {
    const before = await installedVersion();
    await publishVersion('v2, same parts', [csm('v2')]);
    const o = await checkByRoute();
    assert(o?.pulled === true && o?.result === 'updated', `outcome: ${JSON.stringify(o)}`);
    const after = await installedVersion();
    assert(after === o.latest && after !== before, `the install moved to the newest version: ${before} -> ${after}, latest ${o.latest}`);
});

console.log('\nPhase 2 — A version that adds an extension');

let heldAt = '';
let widerVersion = '';
await test('The check holds back a version that adds an extension with network access: needs_owner, the install stays, no notice from the route', async () => {
    heldAt = await installedVersion();
    await publishVersion('v3, adds an extension', [csm('v3'), extension()]);
    const o = await checkByRoute();
    widerVersion = o?.latest ?? '';
    assert(o?.pulled === true && o?.result === 'needs_owner', `outcome: ${JSON.stringify(o)}`);
    assert(o.version === heldAt && o.latest !== heldAt, `the outcome says the install stays: ${JSON.stringify(o)}`);
    assert(typeof o.detail === 'string' && o.detail.includes(`extension:${EXT}`), `the detail names what the version adds: ${o.detail}`);
    assert(await installedVersion() === heldAt, 'the install did not move');
    // The route answers the person who asked, so it sends nothing.
    assert(await approvalNotices() === 0, `no notice from the route: ${await approvalNotices()}`);
});

await test('The daily job (the real core handler, notify on) holds it too, and tells the owner exactly once over two runs', async () => {
    await C.scheduler.triggerNow('core:package-upstream-check');
    assert(await installedVersion() === heldAt, 'the first daily run did not move the install');
    assert(await approvalNotices() === 1, `told once after the first run: ${await approvalNotices()}`);
    await C.scheduler.triggerNow('core:package-upstream-check');
    assert(await installedVersion() === heldAt, 'the second daily run did not move the install');
    assert(await approvalNotices() === 1, `still told once after the second run: ${await approvalNotices()}`);
    const notes = await C.storage.listMemory(`${C.ownerName}@${C.nodeId}`, { prefix: 'notif.' });
    const note = notes.map(r => r.value as any).find(v => v?.type === 'package_update_needs_approval');
    assert(String(note?.actions?.[0]?.endpoint) === `/v1/instances/${instanceId}/update`, `the notice carries the Update action: ${JSON.stringify(note?.actions)}`);
});

console.log('\nPhase 3 — The owner applies it');

await test('The owner\'s own update applies the wider version and records the new approval; the next check is quiet', async () => {
    const up = await C.json(`/v1/instances/${instanceId}/update`, { method: 'POST', headers: auth(C.ownerToken), body: '{}' });
    assert(up.status === 200, `the owner's update: ${up.status} ${JSON.stringify(up.body)}`);
    const inst = await C.json(`/v1/instances/${instanceId}`, { headers: auth(C.ownerToken) });
    assert(inst.body.data.packageVersion === widerVersion, `on the wider version: ${inst.body.data.packageVersion} vs ${widerVersion}`);
    assert((inst.body.data.approval?.items ?? []).some((i: string) => i === `extension:${EXT}:network`),
        `the approval covers the extension's network access: ${JSON.stringify(inst.body.data.approval)}`);
    const o = await checkByRoute();
    assert(o?.result === 'current', `nothing left to do: ${JSON.stringify(o)}`);
});

console.log('\nCleanup');
// Close and exit without awaiting: C fetched R over keep-alive (see e2e-federation-packages.ts).
try { R!.server.close(); C!.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', () => r()));
process.exit(failed > 0 ? 1 : 0);

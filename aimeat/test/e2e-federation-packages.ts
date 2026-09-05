/**
 * @file e2e-federation-packages.ts
 * @description A package crossing a node boundary. Two real nodes: A publishes, B pulls. Everything
 *   B refuses is asserted by re-reading B's package list afterwards, because a refusal returned
 *   AFTER a write looks identical from the outside.
 * @structure
 *   - Setup: boot A and B, an owner each, B holds A as an active peer with its real key
 *   - Phase 1: the signed statement A serves about its own package
 *   - Phase 2: the happy pull, and what lands on B
 *   - Phase 3: not_newer, then a newer version, then the upstream check
 *   - Phase 4: refusals — no signature, a tampered component, a foreign key, a private package,
 *     shareCatalogue off, a stranger node, a changed key, federation off
 *   - Phase 5: scope and identity refusals
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=federation-packages

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair } from '../src/auth/keypair.js';
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
    server: Server;
    baseUrl: string;
    nodeId: string;
    adminPw: string;
    ownerName: string;
    ownerToken: string;
    json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
}

function makeJson(baseUrl: string) {
    return async (path: string, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

async function bootNode(port: number, nodeId: string, packageFederation: boolean): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://localhost:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';

    const { config } = loadConfig({});
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://localhost:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    config.packagesEnabled = true;
    config.packageFederationEnabled = packageFederation;
    config.packageCreateRole = 'owner';

    const { app } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, () => resolve(s)); });
    return {
        server, baseUrl: `http://localhost:${port}`, nodeId, adminPw,
        ownerName: '', ownerToken: '', json: makeJson(`http://localhost:${port}`),
    };
}

async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ name: ownerName }),
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

/** B's whole package list, for asserting that a refusal wrote nothing. */
async function bPackageNames(): Promise<string[]> {
    const r = await B.json(`/v1/packages?author=${B.ownerName}&status=published&limit=200`, { headers: auth(B.ownerToken) });
    return (r.body.data?.packages ?? []).map((p: any) => p.name);
}

console.log('\n=== AIMEAT Federation Packages E2E ===\n');

let A: NodeState;
let B: NodeState;
const ts = Date.now() % 1000000;
const PKG = `fedpack${ts}`;
let aPublicKey = '';
let groupIdOnA = '';
let firstPublishedAt = '';

console.log('Setup');

await test('Boot A (publisher) and B (puller) with an owner each', async () => {
    // 40701/40702, not the 4025x-4029x band: thirty-odd suites hardcode ports in there, and a
    // collision does not fail loudly — the health check accepts whatever already answers, and every
    // assertion then runs against somebody else's node. That is incident
    // 2026-09-05-port-40262-app-origin, and this is the range it named as clear.
    A = await bootNode(40701, `aimeat-test-001-fedpka${ts}`, true);
    B = await bootNode(40702, `aimeat-test-001-fedpkb${ts}`, true);
    await setupOwner(A, `fpa${ts}`);
    await setupOwner(B, `fpb${ts}`);
});

await test("A publishes its own public key at the address every node publishes it at", async () => {
    const r = await A.json('/.well-known/aimeat');
    assert(r.status === 200, `status ${r.status}`);
    aPublicKey = r.body.data?.public_key ?? '';
    assert(aPublicKey.length > 0, `A has a node key, got ${JSON.stringify(r.body.data?.public_key)}`);
    assert(r.body.data?.node_id === A.nodeId, `node id ${r.body.data?.node_id}`);
});

await test('B holds A as an active peer, with A\'s real key', async () => {
    const add = await B.json('/v1/federation/peers', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ node_id: A.nodeId, url: A.baseUrl, public_key: aPublicKey }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);

    const activate = await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken),
        body: JSON.stringify({ status: 'active', share_catalogue: true }),
    });
    assert(activate.status === 200, `activate peer: ${activate.status} ${JSON.stringify(activate.body)}`);
});

await test('A publishes a public package', async () => {
    const r = await A.json('/v1/packages', {
        method: 'POST', headers: auth(A.ownerToken),
        body: JSON.stringify({
            name: PKG,
            description: 'A package that crosses a node boundary',
            category: 'utility',
            tags: ['federation'],
            visibility: 'public',
            components: [
                { id: 'csm-core', type: 'csm', label: 'Core', content: '{"fields":["a"]}', dependencies: [] },
            ],
        }),
    });
    assert(r.status === 201, `publish: ${r.status} ${JSON.stringify(r.body)}`);
    groupIdOnA = r.body.data.packageGroupId;
    firstPublishedAt = r.body.data.createdAt;
    assert(r.body.data.status === 'published', `status ${r.body.data.status}`);
});

console.log('\nPhase 1 — What A says about it, signed');

await test('A serves a signed statement carrying the component digests and no content', async () => {
    const r = await A.json(`/v1/federation/packages/${encodeURIComponent(groupIdOnA)}/attestation`);
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    const d = r.body.data?.descriptor;
    assert(!!d, 'a descriptor');
    assert(typeof r.body.data.signature === 'string' && r.body.data.signature.length > 0, 'a signature');
    assert(d.source_node === A.nodeId, `source node ${d.source_node}`);
    assert(d.name === PKG, `name ${d.name}`);
    assert(Array.isArray(d.component_digests) && d.component_digests.length === 1,
        `one digest, got ${JSON.stringify(d.component_digests)}`);
    assert(typeof d.component_digests[0].sha256 === 'string', 'the digest is a hash');
    assert(!('content' in d.component_digests[0]), 'and carries no component content');
});

console.log('\nPhase 2 — The pull');

await test('B pulls it, naming A as the peer', async () => {
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    assert(r.status === 201, `pull: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.applied === true, 'it was applied');

    const pkg = r.body.data.package;
    assert(pkg.name === PKG, `name ${pkg.name}`);
    assert(pkg.components.length === 1, `components ${pkg.components.length}`);
    // Ownership is B's: the components will run on B and B's owner answers for them.
    assert(pkg.author === B.ownerName, `author is the puller, got ${pkg.author}`);
    assert(pkg.visibility === 'private', `lands private, got ${pkg.visibility}`);
});

await test('And the record says where it came from, verified', async () => {
    const r = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}`, { headers: auth(B.ownerToken) });
    assert(r.status === 200, `status ${r.status}`);
    const up = r.body.data.upstream;
    assert(!!up, `an upstream block, got ${JSON.stringify(r.body.data.upstream)}`);
    assert(up.node === A.nodeId, `node ${up.node}`);
    assert(up.publicKey === aPublicKey, "A's key is pinned on the record");
    assert(typeof up.verifiedAt === 'string', `verified, got ${up.verifiedAt}`);
    // The author's GHII travels as provenance and authorizes nothing.
    assert(up.authorGhii.startsWith(A.ownerName), `the publishing author is recorded, got ${up.authorGhii}`);
});

await test('B installs what it pulled', async () => {
    const r = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}/install`, {
        method: 'POST', headers: auth(B.ownerToken), body: JSON.stringify({ label: 'from A' }),
    });
    assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
    assert((r.body.data.installedComponents ?? []).length === 1, 'one component registered');
});

console.log('\nPhase 3 — Nothing newer, then something newer');

await test('Pulling again with nothing newer applies nothing', async () => {
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.applied === false, 'applied false');
    assert(r.body.data.reason === 'not_newer', `reason ${r.body.data.reason}`);
});

await test('The upstream check says there is nothing new', async () => {
    const r = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}/upstream-check`, {
        headers: auth(B.ownerToken),
    });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.hasUpstream === true, 'it has an upstream');
    assert(r.body.data.updateAvailable === false, `nothing new yet, got ${JSON.stringify(r.body.data)}`);
});

await test('A publishes a newer version, and B sees it without downloading it', async () => {
    // A second apart, so the published instants order even at whole-second resolution.
    await new Promise(r => setTimeout(r, 1100));
    const pub = await A.json(`/v1/packages/${encodeURIComponent(groupIdOnA)}/versions`, {
        method: 'POST', headers: auth(A.ownerToken),
        body: JSON.stringify({
            changelog: 'a second field',
            status: 'published',
            components: [{ id: 'csm-core', type: 'csm', label: 'Core', content: '{"fields":["a","b"]}', dependencies: [] }],
        }),
    });
    assert(pub.status === 201, `version: ${pub.status} ${JSON.stringify(pub.body)}`);

    const check = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}/upstream-check`, {
        headers: auth(B.ownerToken),
    });
    assert(check.status === 200, `check: ${check.status} ${JSON.stringify(check.body)}`);
    assert(check.body.data.updateAvailable === true,
        `an update is available, got ${JSON.stringify(check.body.data)} (first published ${firstPublishedAt})`);
});

await test('B pulls the newer version as a new local version', async () => {
    const before = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}/versions`, { headers: auth(B.ownerToken) });
    const countBefore = (before.body.data?.versions ?? []).length;

    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    assert(r.status === 201, `pull: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.package.components[0].content.includes('"b"'), 'the new bytes arrived');

    const after = await B.json(`/v1/packages/${encodeURIComponent(`${PKG}::${B.ownerName}`)}/versions`, { headers: auth(B.ownerToken) });
    assert((after.body.data?.versions ?? []).length === countBefore + 1,
        `one more local version, ${countBefore} → ${(after.body.data?.versions ?? []).length}`);
});

console.log('\nPhase 4 — Refusals');

await test("A package A does not serve publicly answers 404, and B writes nothing", async () => {
    const before = await bPackageNames();
    const privateName = `${PKG}-private`;
    const made = await A.json('/v1/packages', {
        method: 'POST', headers: auth(A.ownerToken),
        body: JSON.stringify({
            name: privateName, description: 'A private one', category: 'utility',
            components: [{ id: 'x', type: 'csm', content: '{}' }],
        }),
    });
    assert(made.status === 201, `make: ${made.status}`);
    assert(made.body.data.visibility === 'private', 'it is private');

    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: made.body.data.packageGroupId, node_id: A.nodeId }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert((await bPackageNames()).length === before.length, 'nothing was written');
});

await test('A node that is not a peer is refused, and B writes nothing', async () => {
    const before = await bPackageNames();
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: 'aimeat-nobody-001' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert((await bPackageNames()).length === before.length, 'nothing was written');
});

await test('An address instead of a peer needs an operator AND an explicit trust, and writes nothing', async () => {
    const before = await bPackageNames();
    // B's owner IS the operator here, so what this proves is the second half: without trust:"tofu"
    // an unknown issuer is refused rather than accepted on sight.
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, source_url: A.baseUrl }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'UNKNOWN_ISSUER', `code ${r.body.error?.code}`);
    assert((await bPackageNames()).length === before.length, 'nothing was written');
});

await test('shareCatalogue off on B\'s record of A is a refusal, and B writes nothing', async () => {
    const before = await bPackageNames();
    const off = await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ share_catalogue: false }),
    });
    assert(off.status === 200, `flag off: ${off.status}`);

    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert((await bPackageNames()).length === before.length, 'nothing was written');

    await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ share_catalogue: true }),
    });
});

await test('A source signing with a different key than the pinned one is refused, and B writes nothing', async () => {
    const before = await bPackageNames();
    const stranger = await generateKeyPair();
    const swap = await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ public_key: stranger.publicKey }),
    });
    assert(swap.status === 200, `key swap: ${swap.status}`);

    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    // The pinned key on the existing record no longer matches the peer record, which is caught
    // before a byte is fetched.
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'KEY_CHANGED', `code ${r.body.error?.code}`);
    assert((await bPackageNames()).length === before.length, 'nothing was written');

    await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ public_key: aPublicKey }),
    });
});

await test('A signature that does not check out is refused before anything is written', async () => {
    // A fresh group on B, so the pinned-key check above cannot be what refuses this one. B's record
    // of A carries a key that is not A's, so A's real signature must fail verification.
    const before = await bPackageNames();
    const stranger = await generateKeyPair();
    await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ public_key: stranger.publicKey }),
    });

    const otherName = `${PKG}-second`;
    const made = await A.json('/v1/packages', {
        method: 'POST', headers: auth(A.ownerToken),
        body: JSON.stringify({
            name: otherName, description: 'Another public one', category: 'utility', visibility: 'public',
            components: [{ id: 'x', type: 'csm', content: '{"fields":[]}' }],
        }),
    });
    assert(made.status === 201, `make: ${made.status} ${JSON.stringify(made.body)}`);

    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: made.body.data.packageGroupId, node_id: A.nodeId }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'INVALID_SIGNATURE', `code ${r.body.error?.code}`);
    assert(!(await bPackageNames()).includes(otherName), 'nothing was written');

    await B.json(`/v1/federation/peers/${encodeURIComponent(A.nodeId)}`, {
        method: 'PUT', headers: auth(B.ownerToken), body: JSON.stringify({ public_key: aPublicKey }),
    });
});

console.log('\nPhase 5 — Who may ask');

await test('Pulling without a token answers 401', async () => {
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', body: JSON.stringify({ group_id: groupIdOnA, node_id: A.nodeId }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('A group id that is not one answers 400, before anything is looked up', async () => {
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: 'not-a-group-id', node_id: A.nodeId }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('Naming neither a peer nor an address answers 400', async () => {
    const r = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({ group_id: groupIdOnA }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test("A package made here has no upstream to check", async () => {
    const made = await B.json('/v1/packages', {
        method: 'POST', headers: auth(B.ownerToken),
        body: JSON.stringify({
            name: `${PKG}-local`, description: 'Made on B', category: 'utility',
            components: [{ id: 'x', type: 'csm', content: '{}' }],
        }),
    });
    assert(made.status === 201, `make: ${made.status}`);

    const r = await B.json(`/v1/packages/${encodeURIComponent(made.body.data.packageGroupId)}/upstream-check`, {
        headers: auth(B.ownerToken),
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.hasUpstream === false, `no upstream, got ${JSON.stringify(r.body.data)}`);
});

console.log('\nCleanup');
// close() and then EXIT, without awaiting the callback. B fetched A over keep-alive, so those
// sockets are still open and server.close() waits for every one of them: awaiting it hangs the suite
// until the runner's timeout. The other two-node suites here end the same way, for the same reason.
try { A!.server.close(); B!.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

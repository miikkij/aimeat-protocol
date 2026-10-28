/**
 * @file test/e2e-federation-peer-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an admitted peer still may not do here, each one sent correctly signed by a
 *   genuinely active peer and read back, and the package repository doors refusing a request that is
 *   unsigned, signed for another node or sent twice.
 *
 *   QA audit 2026-10-16: S6-02 (a member peer's replicate wrote into any namespace, and its conflict
 *   copy landed outside the replica prefix), S6-03 (a broadcast took any sender name), S6-04 (the key
 *   exchange handed the agent roster out in both directions), S6-09 (the service summary took the
 *   x-source-node header as its whole credential; the resolve route gave out a private peer's
 *   address), S10-02 (the four writing /v1/federation doors in routes/package-sales.ts had their
 *   refusals tested outside the guard tier only).
 *
 *   Node V boots IN-PROCESS on 28393 with the package repository role on. Peer M is a member (a
 *   keypair: nothing needs it to answer), peer P a contact link (private), and a node:http fake peer
 *   records the key exchange V sends out.
 * @structure Setup · 1 replicate namespaces · 2 broadcast sender · 3 key exchange roster · 4 service
 *   summary and resolve · 5 package repository doors
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-peer-limits
 * @version-history
 *   2026-10-22 — R2 gives the person's sign-in consent for M before the push-home replicate, and R2a
 *     shows the same replicate without it is 403 CONSENT_REQUIRED with nothing stored (secaudit
 *     2026-10 wave 3, v71; test change approved by the developer on 2026-10-22).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S6-02, S6-03, S6-04, S6-09, S10-02).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { audienceProof, deliveryProof, signedGetHeaders, SERVICE_SUMMARY_PURPOSE } from '../src/services/signed-node-request.js';
import { bodyDigest, SALE_PURPOSE, CLAIM_PURPOSE } from '../src/services/packages/sale/package-sale-auth.js';
import { performKeyExchange } from '../src/services/federation-helpers.js';
import { bootNode, setupOperator, addPeer, startFakePeer, seen, auth, type NodeState } from './helpers/federation-two-node.js';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const ts = Date.now();
const V_NODE = 'aimeat-test-001-peerlimv';
const M_NODE = 'aimeat-peer-001-peerlimm';
const P_NODE = 'aimeat-peer-001-peerlimp';
const THIRD_NODE = 'aimeat-peer-001-elsewhere';
const FAKE_NODE = 'aimeat-peer-001-peerlimf';
let V: NodeState;
let mKeys: { publicKey: string; privateKey: string };
let fake: { server: import('node:http').Server; url: string };

/** The paths whose message signs no send time of its own, so they carry the delivery proof. */
const DELIVERY_PATHS = new Set(['/v1/federation/replicate', '/v1/federation/message/receipt', '/v1/federation/catalogue-sync']);

/** Post as peer M, signed over the payload, with the proof a node of this version adds. */
async function asM(path: string, payload: Record<string, unknown>) {
    const signed = JSON.stringify(payload);
    const proof = DELIVERY_PATHS.has(path)
        ? await deliveryProof(mKeys.privateKey, signed, V_NODE)
        : await audienceProof(mKeys.privateKey, signed, V_NODE);
    return V.json(path, {
        method: 'POST', headers: { 'x-source-node': M_NODE },
        body: JSON.stringify({ ...payload, signature: await sign(mKeys.privateKey, signed), ...proof }),
    });
}

/** A replicate body in the seven fields the route verifies, in its order. */
const replicateBody = (gaii: string, key: string, timestamp = new Date().toISOString()) => ({
    source_node: M_NODE, gaii, key, value: { from: 'peer M' }, visibility: 'public', version: 1, timestamp,
});

/** Headers of a signed node request (services/signed-node-request.ts) for a sale or claim door. */
async function nodeRequestHeaders(
    method: string, path: string, body: unknown, purpose: string,
    opts: { audience?: string; privateKey?: string; sourceNode?: string } = {},
): Promise<Record<string, string>> {
    const sourceNode = opts.sourceNode ?? M_NODE;
    const audience = opts.audience ?? V_NODE;
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(16).toString('hex');   // the shape newNonce() gives (request-nonce.ts)
    const message = JSON.stringify({
        source_node: sourceNode, timestamp, purpose, method: method.toUpperCase(), path, body_sha256: bodyDigest(body), audience, nonce,
    });
    return {
        'x-source-node': sourceNode, 'x-timestamp': timestamp, 'x-audience': audience, 'x-nonce': nonce,
        'x-signature': await sign(opts.privateKey ?? mKeys.privateKey, message),
    };
}

console.log('\n=== Federation: what an admitted peer still may not do ===\n');

console.log('Setup');
await test('Boot V (package repository on), an operator with an agent, member peer M, contact peer P, a fake peer', async () => {
    V = await bootNode(28393, V_NODE, { packageFederationEnabled: true, packageRepository: true });
    await setupOperator(V, `plv${ts}`);
    const agent = await V.json('/v1/agents', {
        method: 'POST', headers: auth(V.ownerToken),
        body: JSON.stringify({ name: `roster${ts}`, owner: V.ownerName, capabilities: ['memory'], scopes: ['memory:read'] }),
    });
    assert(agent.status === 201, `create agent: ${agent.status} ${JSON.stringify(agent.body)}`);
    mKeys = await generateKeyPair();
    await addPeer(V, M_NODE, 'http://localhost:49981', mKeys.publicKey);
    const pKeys = await generateKeyPair();
    await addPeer(V, P_NODE, 'http://localhost:49982', pKeys.publicKey, { tier: 'contact' });
    const rows = (await V.json('/v1/federation/peers', { headers: auth(V.ownerToken) })).body.data.peers as any[];
    const m = rows.find(p => p.node_id === M_NODE);
    const p = rows.find(r => r.node_id === P_NODE);
    assert(m?.tier === 'member' && m.replicate_memory === true && m.allow_broadcast === true, `M is a member that replicates and broadcasts: ${JSON.stringify(m)}`);
    assert(p?.peer_mode === 'private', `P is a private contact link: ${JSON.stringify(p)}`);
    fake = await startFakePeer();
});

// ── 1. Replicate namespaces (S6-02) ──
console.log('\nPhase 1 — a replicate lands only under a person or agent of M or of V');

await test('R1. A replicate under one of M\'s own agents is stored, under the replica prefix', async () => {
    const gaii = `bot#someone@${M_NODE}`;
    const r = await asM('/v1/federation/replicate', replicateBody(gaii, 'shared-pref'));
    assert(r.status === 200 && r.body.data?.key === `replica:${M_NODE}:shared-pref`, `replicate: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!!(await V.storage.getMemory(gaii, `replica:${M_NODE}:shared-pref`)), 'the replica is stored');
});

await test('R2a. REFUSED — a replicate into V\'s own person who gave M no sign-in consent, and nothing is stored', async () => {
    const r = await asM('/v1/federation/replicate', replicateBody(V.ownerGhii, 'home-pref-unconsented'));
    assert(r.status === 403 && r.body.error?.code === 'CONSENT_REQUIRED', `expected 403 CONSENT_REQUIRED, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(await V.storage.getMemory(V.ownerGhii, `replica:${M_NODE}:home-pref-unconsented`)), 'nothing is stored under the person');
});

await test('R2. A replicate into V\'s own person (the push-home case) is stored', async () => {
    // The person lets M sign them in first, the consent push-home's visitor session needs (secaudit
    // 2026-10 wave 3, v71; the developer's ruling of 2026-10-22).
    const consent = await V.json('/v1/consent', {
        method: 'POST', headers: auth(V.ownerToken),
        body: JSON.stringify({ data_pattern: '_identity', recipient: `node:${M_NODE}`, scope: 'auth', purpose: 'federation_login' }),
    });
    assert(consent.status === 201, `the person's sign-in consent for M: ${consent.status} ${JSON.stringify(consent.body?.error)}`);
    const r = await asM('/v1/federation/replicate', replicateBody(V.ownerGhii, 'home-pref'));
    assert(r.status === 200, `push-home replicate: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('R3. REFUSED — a system namespace (package-entitlements), and nothing is written there', async () => {
    const r = await asM('/v1/federation/replicate', replicateBody('package-entitlements', 'entitlements.planted'));
    assert(r.status === 403 && r.body.error?.code === 'NAMESPACE_NOT_ALLOWED', `expected 403 NAMESPACE_NOT_ALLOWED, got ${r.status} ${JSON.stringify(r.body)}`);
    const rows = await V.storage.listMemory('package-entitlements', {});
    assert(rows.length === 0, `nothing may land in package-entitlements: ${JSON.stringify(rows.map(x => x.key))}`);
});

await test('R4. REFUSED — a person of a third node, and a person V does not have', async () => {
    const third = await asM('/v1/federation/replicate', replicateBody(`someone@${THIRD_NODE}`, 'third-pref'));
    assert(third.status === 403 && third.body.error?.code === 'NAMESPACE_NOT_ALLOWED', `third node: ${third.status} ${JSON.stringify(third.body)}`);
    const ghost = await asM('/v1/federation/replicate', replicateBody(`ghost${ts}@${V_NODE}`, 'ghost-pref'));
    assert(ghost.status === 403 && ghost.body.error?.code === 'NAMESPACE_NOT_ALLOWED', `unknown local person: ${ghost.status} ${JSON.stringify(ghost.body)}`);
    assert(!(await V.storage.getMemory(`ghost${ts}@${V_NODE}`, `replica:${M_NODE}:ghost-pref`)), 'nothing is stored for the unknown person');
});

await test('R5. A newer replicate keeps the earlier value under the replica prefix, never beside the key family', async () => {
    const gaii = `bot#someone@${M_NODE}`;
    const key = `tracked-response.probe-${ts}`;
    const first = await asM('/v1/federation/replicate', replicateBody(gaii, key, new Date(Date.now() - 60_000).toISOString()));
    assert(first.status === 200, `first: ${first.status} ${JSON.stringify(first.body)}`);
    const second = await asM('/v1/federation/replicate', replicateBody(gaii, key, new Date().toISOString()));
    assert(second.status === 200 && second.body.data?.conflict === true, `second: ${second.status} ${JSON.stringify(second.body)}`);
    const all = await V.storage.listMemory(gaii, {});
    const conflicts = all.filter(m => m.key.includes('._conflict_'));
    assert(conflicts.length === 1 && conflicts[0].key.startsWith(`replica:${M_NODE}:${key}._conflict_`),
        `the conflict copy stays under the replica prefix: ${JSON.stringify(conflicts.map(m => m.key))}`);
    assert(!all.some(m => m.key.startsWith('tracked-response.')), `no key of the tracked-response family exists: ${JSON.stringify(all.map(m => m.key))}`);
});

// ── 2. Broadcast sender (S6-03) ──
console.log('\nPhase 2 — a broadcast speaks for M\'s own people only');

const inboxBodies = async (): Promise<string[]> =>
    ((await V.json('/v1/messages/inbox', { headers: auth(V.ownerToken) })).body.data?.messages ?? []).map((m: any) => m.body);

await test('B1. REFUSED — a broadcast that names V\'s operator as its sender, and no inbox copy is written', async () => {
    const forged = `forged announcement ${ts}`;
    const r = await asM('/v1/federation/broadcast', {
        source_node: M_NODE, broadcast: { senderGhii: V.ownerGhii, body: forged, broadcastId: randomUUID() }, timestamp: new Date().toISOString(),
    });
    assert(r.status === 403 && r.body.error?.code === 'SENDER_NOT_OF_PEER', `expected 403 SENDER_NOT_OF_PEER, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(await inboxBodies()).includes(forged), 'the forged announcement must not land in the inbox');
});

await test('B2. A broadcast from a person of M is delivered (the positive control)', async () => {
    const honest = `announcement from M ${ts}`;
    const r = await asM('/v1/federation/broadcast', {
        source_node: M_NODE, broadcast: { senderGhii: `op@${M_NODE}`, body: honest, broadcastId: randomUUID() }, timestamp: new Date().toISOString(),
    });
    assert(r.status === 200 && r.body.data?.delivered >= 1, `broadcast: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await inboxBodies()).includes(honest), 'the announcement lands in the inbox');
});

// ── 3. Key exchange roster (S6-04) ──
console.log('\nPhase 3 — no key exchange carries the agent roster, either way');

await test('K1. An unsigned key exchange from member peer M answers the node key and no agent keys', async () => {
    const r = await V.json('/v1/federation/key-exchange', {
        method: 'POST', headers: { 'x-source-node': M_NODE },
        body: JSON.stringify({ node_id: M_NODE, node_url: 'http://localhost:49981', node_public_key: mKeys.publicKey, agent_keys: [{ gaii: `x#y@${M_NODE}`, public_key: 'k' }], timestamp: new Date().toISOString() }),
    });
    assert(r.status === 200, `key-exchange: ${r.status} ${JSON.stringify(r.body)}`);
    assert(Array.isArray(r.body.data.agent_keys) && r.body.data.agent_keys.length === 0, `no roster may cross to a member either: ${JSON.stringify(r.body.data.agent_keys)}`);
    assert(r.body.data.node_public_key === V.nodeKey.publicKey, 'the node key is what crosses');
});

await test('K2. The key exchange V sends out carries no agent keys', async () => {
    seen.length = 0;
    await performKeyExchange(fake.url, V.config, V.storage, FAKE_NODE);
    const sent = seen.find(s => s.path === '/v1/federation/key-exchange');
    assert(!!sent, `the exchange reached the fake peer: ${JSON.stringify(seen.map(s => s.path))}`);
    assert(sent!.body.node_public_key === V.nodeKey.publicKey, 'the node key is sent');
    assert(Array.isArray(sent!.body.agent_keys) && sent!.body.agent_keys.length === 0, `no roster in the outbound body: ${JSON.stringify(sent!.body.agent_keys)}`);
});

// ── 4. Service summary and resolve (S6-09) ──
console.log('\nPhase 4 — the service summary answers a signed request once; resolve names no private peer');

await test('S1. An active peer that names itself in a header but does not sign is refused (401)', async () => {
    const r = await V.json('/v1/federation/service-summary', { headers: { 'x-source-node': M_NODE } });
    assert(r.status === 401 && r.body.error?.code === 'UNAUTHORIZED', `expected 401, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('S2. Signed as M for V it is answered, and the same request again is refused (401 REPLAYED)', async () => {
    const headers = await signedGetHeaders(mKeys.privateKey, M_NODE, V_NODE, { purpose: SERVICE_SUMMARY_PURPOSE });
    const r = await V.json('/v1/federation/service-summary', { headers });
    assert(r.status === 200 && typeof r.body.data?.summary_hash === 'string', `signed summary: ${r.status} ${JSON.stringify(r.body)}`);
    const again = await V.json('/v1/federation/service-summary', { headers });
    assert(again.status === 401 && again.body.error?.code === 'REPLAYED', `replay: ${again.status} ${JSON.stringify(again.body)}`);
});

await test('S3. REFUSED — signed for another node (401 WRONG_AUDIENCE), and signed with another key (401)', async () => {
    const elsewhere = await V.json('/v1/federation/service-summary', { headers: await signedGetHeaders(mKeys.privateKey, M_NODE, THIRD_NODE, { purpose: SERVICE_SUMMARY_PURPOSE }) });
    assert(elsewhere.status === 401 && elsewhere.body.error?.code === 'WRONG_AUDIENCE', `other audience: ${elsewhere.status} ${JSON.stringify(elsewhere.body)}`);
    const other = await generateKeyPair();
    const forged = await V.json('/v1/federation/service-summary', { headers: await signedGetHeaders(other.privateKey, M_NODE, V_NODE, { purpose: SERVICE_SUMMARY_PURPOSE }) });
    assert(forged.status === 401 && forged.body.error?.code === 'UNAUTHORIZED', `other key: ${forged.status} ${JSON.stringify(forged.body)}`);
});

await test('S4. Resolve names a listed peer, and neither names nor asks the private contact peer', async () => {
    const listed = await V.json(`/v1/federation/resolve/${encodeURIComponent(`someone@${M_NODE}`)}`);
    assert(listed.status === 200 && listed.body.data?.node_url === 'http://localhost:49981', `listed peer: ${listed.status} ${JSON.stringify(listed.body)}`);
    const hidden = await V.json(`/v1/federation/resolve/${encodeURIComponent(`someone@${P_NODE}`)}`);
    assert(hidden.status === 404 && !JSON.stringify(hidden.body).includes('49982'), `the contact peer's address must not be given out: ${hidden.status} ${JSON.stringify(hidden.body)}`);
});

// ── 5. Package repository doors (S10-02) ──
console.log('\nPhase 5 — the package repository doors refuse unsigned, misaddressed and repeated requests');

const GROUP = `grp-peerlim-${ts}`;
const saleDoors: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
    { method: 'PUT', path: `/v1/federation/package-sales/${GROUP}/claims`, body: { note: 'probe' } },
    { method: 'PUT', path: `/v1/federation/package-sales/${GROUP}/entitlements/${THIRD_NODE}`, body: { note: 'probe' } },
    { method: 'DELETE', path: `/v1/federation/package-sales/${GROUP}/entitlements/${THIRD_NODE}` },
    { method: 'GET', path: `/v1/federation/package-sales/${GROUP}/config-needs` },
    { method: 'GET', path: `/v1/federation/package-sales/${GROUP}/offer` },
];

await test('P1. Every sale door refuses an unsigned request (401), and so do the claim door and the package listing', async () => {
    for (const d of saleDoors) {
        const r = await V.json(d.path, { method: d.method, ...(d.body ? { body: JSON.stringify(d.body) } : {}) });
        assert(r.status === 401 && r.body.error?.code === 'UNAUTHORIZED', `${d.method} ${d.path}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const claim = await V.json(`/v1/federation/package-claims/${GROUP}`, { method: 'POST', body: JSON.stringify({ code: 'x', node_id: M_NODE, public_key: mKeys.publicKey }) });
    assert(claim.status === 401 && claim.body.error?.code === 'UNAUTHORIZED', `claim: ${claim.status} ${JSON.stringify(claim.body)}`);
    const listing = await V.json('/v1/federation/packages');
    assert(listing.status === 401, `listing: ${listing.status} ${JSON.stringify(listing.body)}`);
});

await test('P2. A sale request signed for another node is refused (401) on every sale door', async () => {
    for (const d of saleDoors) {
        const headers = await nodeRequestHeaders(d.method, d.path, d.method === 'PUT' ? d.body : undefined, SALE_PURPOSE, { audience: THIRD_NODE });
        const r = await V.json(d.path, { method: d.method, headers, ...(d.body ? { body: JSON.stringify(d.body) } : {}) });
        assert(r.status === 401 && r.body.error?.code === 'UNAUTHORIZED', `${d.method} ${d.path}: ${r.status} ${JSON.stringify(r.body)}`);
    }
});

await test('P3. A signed sale request sent twice is refused the second time (401 REPLAYED), and M is no seller the first time', async () => {
    for (const d of saleDoors.filter(x => x.method !== 'GET')) {
        const headers = await nodeRequestHeaders(d.method, d.path, d.method === 'PUT' ? d.body : undefined, SALE_PURPOSE);
        const init = { method: d.method, headers, ...(d.body ? { body: JSON.stringify(d.body) } : {}) };
        const first = await V.json(d.path, init);
        assert(first.status === 403 && first.body.error?.code === 'NOT_A_SELLER', `${d.method} ${d.path} first: ${first.status} ${JSON.stringify(first.body)}`);
        const again = await V.json(d.path, init);
        assert(again.status === 401 && again.body.error?.code === 'REPLAYED', `${d.method} ${d.path} again: ${again.status} ${JSON.stringify(again.body)}`);
    }
});

await test('P4. A claim signed with the key it names is heard once, and refused the second time (401 REPLAYED)', async () => {
    const path = `/v1/federation/package-claims/${GROUP}`;
    const claimer = await generateKeyPair();
    const body = { code: 'not-a-code', node_id: 'aimeat-peer-001-claimer', url: 'http://localhost:49983', public_key: claimer.publicKey };
    const headers = await nodeRequestHeaders('POST', path, body, CLAIM_PURPOSE, { privateKey: claimer.privateKey, sourceNode: body.node_id });
    const first = await V.json(path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert(first.status === 404 && first.body.error?.code === 'CLAIM_NOT_FOUND', `first: ${first.status} ${JSON.stringify(first.body)}`);
    const again = await V.json(path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert(again.status === 401 && again.body.error?.code === 'REPLAYED', `again: ${again.status} ${JSON.stringify(again.body)}`);
});

await new Promise<void>(resolve => V.server.close(() => resolve()));
await new Promise<void>(resolve => fake.server.close(() => resolve()));

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

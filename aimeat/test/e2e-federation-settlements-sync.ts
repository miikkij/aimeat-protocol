/**
 * @file test/e2e-federation-settlements-sync.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation money-and-sync half, driven end to end: signed inbound settlements,
 *   operator-driven outbound ones, cross-node routing and GAII resolution, cross-node template
 *   sharing, and the four sync services behind them.
 *
 *   WHY THIS SUITE EXISTS. Six modules were dark in the sweep. federation-settlements.ts (216
 *   uncovered lines) has no caller in any suite, because its inbound door needs a peer holding a
 *   private key the suite can sign with. federation-sync/templates.ts (149) was dark for a simpler
 *   reason: `packageFederationEnabled` is off on the shared test node, so both of its template
 *   routes answer 403 before doing anything. routing.ts (166), memory-replication.ts (156),
 *   catalogue-sync.ts (219) and sync-scheduler.ts (136) all need a second node that really answers.
 *
 *   SO THIS SUITE OWNS ITS WORLD. Two AIMEAT nodes boot IN-PROCESS — A on 40322 (the node under
 *   test) and B on 40323 (a real peer that serves template listings and a memory inventory) — both
 *   with `packageFederationEnabled = true`, which no other suite turns on. Beside them a node:http
 *   fake peer on an ephemeral loopback port holds an Ed25519 keypair the suite controls, so a
 *   settlement can be SIGNED as that peer and the 200 is proof the verification ran rather than
 *   proof it was skipped. The same fake answers the outbound doors (catalogue-sync, replicate,
 *   work/request, agents) with a switchable status, so a peer 500 is a real 500 over a real socket.
 *
 *   The four services are then called DIRECTLY, with the suite's own PeerInfo objects and A's
 *   storage. That is deliberate: syncCatalogueToPeer and replicateMemoryToPeer have no HTTP door of
 *   their own on this node, and the queue methods (enqueue/dequeue/markSent/markFailed) are only
 *   reachable through drainSyncQueue.
 *
 *   Two node ids mean two node keys: since 2026-09-03 the key path carries the node id
 *   ($HOME/.aimeat/nodes/<nodeId>/node-key.json), so A and B sign as themselves and B refusing A's
 *   signature would be a real refusal. The comment in federation-multinode.ts:158-163 about three
 *   nodes sharing one identity predates that change.
 *
 *   The world itself (booting a node, the operator, the peer calls, the fake peer) lives in
 *   test/helpers/federation-two-node.ts, so the next federation suite that needs two nodes does not
 *   copy it.
 *
 * @structure Phase 1 boot (A, B, the fake peer) · 2 owners, an agent, peers · 3 inbound settlement:
 *   the credit, the ledger row, the replay, every refusal, the signed route manifest · 4 outbound
 *   settlement: peer 200, peer 500, unreachable peer, a plain owner refused · 5 routing: refusals,
 *   direct relay, multi-hop, resolve, cross-node work · 6 templates: B serves, A syncs, and B's
 *   refusals on both signed doors · 7 the services: catalogue sync, memory replication, the
 *   replication queue and the scheduler · 8 cleanup.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-federation-settlements-sync.ts
 *   E2E_STACKS=1 adds the stack to every failure, for the ones that come from inside the node.
 * @version-history
 *   v1.1.0 — 2026-09-08 — The debounce test asserts the flush drains its own enqueues (fixed the
 *     same day) instead of pinning the race.
 *   v1.0.0 — 2026-09-08 — Written to cover the settlement, routing, template and sync-service paths.
 */

import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { buildHopSigningMessage } from '../src/types/route-manifest.js';
import type { RouteHop } from '../src/types/route-manifest.js';
import type { PeerInfo } from '../src/services/federation.js';
import {
    syncCatalogueToPeer, syncCatalogueToAllPeers, enqueueCatalogueSync, getPeerSyncState,
} from '../src/services/catalogue-sync.js';
import {
    replicateMemoryToPeer, replicateMemoryToAllPeers, enqueueMemoryReplication, isEligibleForReplication,
} from '../src/services/memory-replication.js';
import { drainSyncQueue, startSyncScheduler, notifyCatalogueChange } from '../src/services/sync-scheduler.js';
import {
    bootNode, setupOperator, addPeer, startFakePeer, modes, seen, auth, sleep,
    type NodeState,
} from './helpers/federation-two-node.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
        // The stack, on request. A failure here is usually a peer answering something the assertion
        // did not expect, and the message says that on its own; a failure INSIDE the node under test
        // says nothing without the frames, and hunting one without them cost a round on 2026-09-08.
        if (process.env.E2E_STACKS === '1') console.error((err as Error).stack);
    }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

// ─── State ───
const stamp = Date.now().toString(36);
const A_PORT = 40322;
const B_PORT = 40323;
const A_ID = 'aimeat-test-001-seta';
const B_ID = 'aimeat-test-001-setb';
const FAKE_ID = `aimeat-fake-set-${stamp}`;
const DEAD_ID = `aimeat-dead-set-${stamp}`;
const SSRF_ID = `aimeat-ssrf-set-${stamp}`;
const HOP1_ID = `aimeat-hop1-set-${stamp}`;
const HOP2_ID = `aimeat-hop2-set-${stamp}`;
const DEAD_URL = 'http://127.0.0.1:1';
const SSRF_URL = 'http://10.0.0.1:9';

let A: NodeState;
let B: NodeState;
let fake: { server: Server; url: string } | null = null;
let P: { publicKey: string; privateKey: string };
let hop1: { publicKey: string; privateKey: string };
let hop2: { publicKey: string; privateKey: string };
let plainOwnerToken = '';
let agentGaii = '';
let agentToken = '';

/** The settlement payload, in the field order federation-settlements.ts rebuilds it in. */
function settlementBytes(b: Record<string, unknown>): string {
    return JSON.stringify({
        from_node: b.from_node, to_node: b.to_node, gaii: b.gaii, amount: b.amount,
        tracking_code: b.tracking_code, reason: b.reason, timestamp: b.timestamp,
    });
}
async function signedSettlement(body: Record<string, unknown>, priv = P.privateKey): Promise<string> {
    return JSON.stringify({ ...body, signature: await sign(priv, settlementBytes(body)) });
}
function peerInfo(nodeId: string, url: string, publicKey: string, over: Partial<PeerInfo> = {}): PeerInfo {
    const now = new Date().toISOString();
    return {
        nodeId, url, publicKey, status: 'active', addedAt: now, lastSeen: now,
        shareCatalogue: true, replicateMemory: true, allowRouting: true, allowMessaging: true,
        allowBroadcast: true, allowSettlement: true, peerMode: 'federation',
        allowFederatedAuth: false, federationAuthScopes: [], tier: 'member', ...over,
    };
}

console.log('\n=== Federation settlements, routing, templates and the sync services ===\n');

async function run(): Promise<void> {
    // ─── Phase 1: Boot ───
    console.log('Phase 1 — Boot two nodes and a peer that holds a key we control');

    await test('A on 40322 and B on 40323 boot with package federation on', async () => {
        // packageFederationEnabled is the one switch that made templates.ts dark everywhere else:
        // both routes it guards answer 403 before reading anything when it is off, and off is the
        // shipped default.
        A = await bootNode(A_PORT, A_ID, { packageFederationEnabled: true });
        B = await bootNode(B_PORT, B_ID, { packageFederationEnabled: true });
        assert(A.config.packageFederationEnabled && B.config.packageFederationEnabled, 'package federation must be on for the template routes');
        assert(A.nodeKey.publicKey !== B.nodeKey.publicKey,
            'A and B must hold DIFFERENT node keys, or every signature test below proves nothing. '
            + `Both published ${A.nodeKey.publicKey.slice(0, 12)}…`);
    });

    await test('the fake peer answers on loopback', async () => {
        fake = await startFakePeer();
        P = await generateKeyPair();
        hop1 = await generateKeyPair();
        hop2 = await generateKeyPair();
        const probe = await fetch(`${fake.url}/v1/ping`);
        assert(probe.status === 200, `the fake peer must be up, got ${probe.status}`);
    });

    // ─── Phase 2: Owners, an agent, and the peer graph ───
    console.log('\nPhase 2 — Owners, an agent, peers');

    await test('operators on A and B, plus a plain owner on A', async () => {
        await setupOperator(A, `seta${stamp}`);
        await setupOperator(B, `setb${stamp}`);
        // A second owner on A that is NOT an operator: POST /v1/owners grants the operator role only
        // to the first real owner, and the admin setup door always grants it.
        const name = `plain${stamp}`;
        const reg = await A.json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
        assert(reg.status === 201, `plain owner: ${reg.status} ${JSON.stringify(reg.body)}`);
        const timestamp = new Date().toISOString();
        const signature = await sign(reg.body.data.private_key, name + A_ID + timestamp);
        const tok = await A.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
        assert(tok.body.ok === true, `plain owner token: ${JSON.stringify(tok.body)}`);
        plainOwnerToken = tok.body.data.token;
        assert(!(tok.body.data.roles ?? []).includes('operator'), `the second owner must not be an operator: ${JSON.stringify(tok.body.data.roles)}`);
    });

    await test('an agent on A, with a token of its own', async () => {
        const reg = await A.json('/v1/agents', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ name: `setagent${stamp}`.toLowerCase(), owner: A.ownerName, capabilities: ['memory'] }),
        });
        assert(reg.status === 201, `agent register: ${reg.status} ${JSON.stringify(reg.body)}`);
        agentGaii = reg.body.data.agent.gaii;
        const timestamp = new Date().toISOString();
        const signature = await sign(reg.body.data.private_key, agentGaii + timestamp);
        const tok = await A.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp, signature }) });
        assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body)}`);
        agentToken = tok.body.data.token;
    });

    await test('A\'s peer list, in the order the relay loop walks it', async () => {
        // INSERTION ORDER IS PART OF WHAT IS BEING TESTED. The multi-hop relay iterates
        // peers.values(), so a peer nothing answers at, then one the SSRF check refuses, then the
        // one that answers, walks the three branches of that loop in a single request.
        await addPeer(A, DEAD_ID, DEAD_URL, (await generateKeyPair()).publicKey);
        await addPeer(A, SSRF_ID, SSRF_URL, (await generateKeyPair()).publicKey);
        await addPeer(A, FAKE_ID, fake!.url, P.publicKey);
        await addPeer(A, B_ID, B.baseUrl, B.nodeKey.publicKey, { allow_routing: false });
        await addPeer(A, HOP1_ID, DEAD_URL, hop1.publicKey);
        await addPeer(A, HOP2_ID, DEAD_URL, hop2.publicKey);
        const list = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
        assert(list.body.data.peers.length === 6, `six peers on A: ${JSON.stringify(list.body.data.peers.map((p: any) => p.node_id))}`);
    });

    await test('B knows A, and a peer B refuses memory replication to', async () => {
        await addPeer(B, A_ID, A.baseUrl, A.nodeKey.publicKey);
        await addPeer(B, HOP1_ID, DEAD_URL, hop1.publicKey, { replicate_memory: false });
        const list = await B.json('/v1/federation/peers', { headers: auth(B.ownerToken) });
        const a = list.body.data.peers.find((p: any) => p.node_id === A_ID);
        assert(a?.public_key === A.nodeKey.publicKey,
            `B must hold A's OWN node key, or every signature test below verifies against the wrong one: ${a?.public_key}`);
        const barred = list.body.data.peers.find((p: any) => p.node_id === HOP1_ID);
        assert(barred?.replicate_memory === false, `the barred peer must really be barred: ${JSON.stringify(barred)}`);
    });

    // ─── Phase 3: Inbound settlement ───
    console.log('\nPhase 3 — POST /v1/federation/settle, signed as the peer');

    let balanceBefore = 0;
    const TC_OK = `tc-ok-${stamp}`;

    await test('the owner\'s balance is read before anything moves', async () => {
        const w = await A.json('/v1/wallet', { headers: auth(A.ownerToken) });
        assert(w.status === 200, `wallet: ${w.status} ${JSON.stringify(w.body)}`);
        balanceBefore = w.body.data.balance;
    });

    await test('a signed settlement from an active peer is applied', async () => {
        const body = {
            from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 250,
            tracking_code: TC_OK, reason: 'work-settled', timestamp: new Date().toISOString(),
        };
        const { status, body: res } = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(body) });
        assert(status === 200, `status ${status}: ${JSON.stringify(res)}`);
        assert(res.data.settled === true && res.data.amount === 250, `payload: ${JSON.stringify(res.data)}`);
        assert(res.data.relay_distribution === null, `no manifest means no relay distribution: ${JSON.stringify(res.data.relay_distribution)}`);
    });

    await test('…and the balance really rose, with a federation_settlement row behind it', async () => {
        const w = await A.json('/v1/wallet', { headers: auth(A.ownerToken) });
        assert(w.body.data.balance === balanceBefore + 250,
            `balance ${balanceBefore} → ${w.body.data.balance}, expected +250`);
        const tx = await A.json('/v1/wallet/transactions?type=federation_settlement', { headers: auth(A.ownerToken) });
        const row = tx.body.data.transactions.find((t: any) => t.tracking_code === `settle:${TC_OK}`);
        assert(!!row, `no settlement row for ${TC_OK}: ${JSON.stringify(tx.body.data.transactions)}`);
        assert(row.amount === 250 && row.counterparty_gaii === FAKE_ID, `row: ${JSON.stringify(row)}`);
    });

    await test('the same tracking code a second time is a 409, and credits nothing', async () => {
        const body = {
            from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 250,
            tracking_code: TC_OK, reason: 'work-settled', timestamp: new Date().toISOString(),
        };
        const { status, body: res } = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(body) });
        assert(status === 409 && res.error?.code === 'CONFLICT', `expected 409 CONFLICT, got ${status}: ${JSON.stringify(res)}`);
        const w = await A.json('/v1/wallet', { headers: auth(A.ownerToken) });
        assert(w.body.data.balance === balanceBefore + 250, `a replay must not credit again, balance is ${w.body.data.balance}`);
    });

    await test('missing fields, a foreign to_node and a non-positive amount are all 400', async () => {
        const base = { from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 10, tracking_code: `tc-400-${stamp}`, reason: 'x', timestamp: new Date().toISOString() };
        const noGaii: Record<string, unknown> = { ...base };
        delete noGaii.gaii;
        const missing = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(noGaii) });
        assert(missing.status === 400 && missing.body.error?.code === 'INVALID_INPUT', `missing gaii: ${missing.status} ${JSON.stringify(missing.body)}`);

        const wrongNode = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement({ ...base, to_node: 'aimeat-somewhere-else' }) });
        assert(wrongNode.status === 400, `foreign to_node: ${wrongNode.status} ${JSON.stringify(wrongNode.body)}`);
        assert(String(wrongNode.body.error?.message).includes('aimeat-somewhere-else'), `the refusal names both nodes: ${wrongNode.body.error?.message}`);

        const zero = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement({ ...base, amount: 0 }) });
        assert(zero.status === 400 && String(zero.body.error?.message).includes('positive'), `amount 0: ${zero.status} ${JSON.stringify(zero.body)}`);
        const negative = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement({ ...base, amount: -5 }) });
        assert(negative.status === 400, `amount -5: ${negative.status}`);
    });

    await test('a node that is not an active peer here is refused before the signature is looked at', async () => {
        const body = { from_node: `aimeat-stranger-${stamp}`, to_node: A_ID, gaii: A.ownerGhii, amount: 10, tracking_code: `tc-stranger-${stamp}`, reason: 'x', timestamp: new Date().toISOString() };
        const { status, body: res } = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(body) });
        assert(status === 403 && res.error?.code === 'FORBIDDEN', `expected 403 FORBIDDEN, got ${status}: ${JSON.stringify(res)}`);
    });

    await test('a settlement signed with the wrong key is a 401', async () => {
        const other = await generateKeyPair();
        const body = { from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 10, tracking_code: `tc-badsig-${stamp}`, reason: 'x', timestamp: new Date().toISOString() };
        const { status, body: res } = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(body, other.privateKey) });
        assert(status === 401 && res.error?.code === 'UNAUTHORIZED', `expected 401, got ${status}: ${JSON.stringify(res)}`);
        const after = await A.json('/v1/wallet', { headers: auth(A.ownerToken) });
        assert(after.body.data.balance === balanceBefore + 250, `a refused signature must credit nothing, balance is ${after.body.data.balance}`);
    });

    await test('a GAII this node does not host is a 404', async () => {
        const body = { from_node: FAKE_ID, to_node: A_ID, gaii: `nobody${stamp}@${A_ID}`, amount: 10, tracking_code: `tc-404-${stamp}`, reason: 'x', timestamp: new Date().toISOString() };
        const { status, body: res } = await A.json('/v1/federation/settle', { method: 'POST', body: await signedSettlement(body) });
        assert(status === 404 && res.error?.code === 'NOT_FOUND', `expected 404, got ${status}: ${JSON.stringify(res)}`);
    });

    await test('a settlement carrying a signed, contiguous route manifest distributes the relay fee', async () => {
        const t1 = new Date(Date.now() - 2000).toISOString();
        const t2 = new Date(Date.now() - 1000).toISOString();
        const sig1 = await sign(hop1.privateKey, buildHopSigningMessage(HOP1_ID, t1, HOP2_ID, ''));
        const sig2 = await sign(hop2.privateKey, buildHopSigningMessage(HOP2_ID, t2, null, sig1));
        const hops: RouteHop[] = [
            { node_id: HOP1_ID, received_at: t1, forwarded_to: HOP2_ID, signature: sig1 },
            { node_id: HOP2_ID, received_at: t2, forwarded_to: null, signature: sig2 },
        ];
        const body = { from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 200, tracking_code: `tc-hops-${stamp}`, reason: 'relayed', timestamp: new Date().toISOString() };
        const signed = JSON.parse(await signedSettlement(body));
        const { status, body: res } = await A.json('/v1/federation/settle', {
            method: 'POST', body: JSON.stringify({ ...signed, route_manifest: { origin: HOP1_ID, hops } }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(res)}`);
        const dist = res.data.relay_distribution;
        assert(dist !== null, `a verified manifest must produce a distribution: ${JSON.stringify(res.data)}`);
        // 10 % network fee of 200 = 20; origin 25 %, destination 25 %, the one forwarding hop takes
        // the 50 % relay pool.
        assert(dist.total_fee === 20 && dist.origin_share === 5 && dist.destination_share === 5,
            `fee split: ${JSON.stringify(dist)}`);
        assert(dist.relay_shares.length === 1 && dist.relay_shares[0].node_id === HOP1_ID && dist.relay_shares[0].amount === 10,
            `only the forwarding hop takes a share: ${JSON.stringify(dist.relay_shares)}`);
        // TODAY'S BEHAVIOUR, PINNED RATHER THAN ASSERTED AS RIGHT: the credit loop looks the relay
        // up with storage.getAgent(share.node_id), and share.node_id is a NODE id while getAgent
        // takes a GAII. No relay is ever paid. See the report that came with this suite.
        const relayRows = await A.storage.getTransactions(A.ownerGhii, 1000);
        assert(!relayRows.some(r => r.type === 'relay_fee'),
            'a relay_fee row appeared: the node-id/GAII mismatch in the credit loop may have been fixed, '
            + 'in which case this assertion is the thing to update rather than the code');
    });

    await test('a manifest whose chain is not contiguous distributes nothing, and the settlement still lands', async () => {
        const t1 = new Date(Date.now() - 2000).toISOString();
        const t2 = new Date(Date.now() - 1000).toISOString();
        const sig1 = await sign(hop1.privateKey, buildHopSigningMessage(HOP1_ID, t1, 'aimeat-not-the-next-hop', ''));
        const sig2 = await sign(hop2.privateKey, buildHopSigningMessage(HOP2_ID, t2, null, sig1));
        const hops: RouteHop[] = [
            { node_id: HOP1_ID, received_at: t1, forwarded_to: 'aimeat-not-the-next-hop', signature: sig1 },
            { node_id: HOP2_ID, received_at: t2, forwarded_to: null, signature: sig2 },
        ];
        const body = { from_node: FAKE_ID, to_node: A_ID, gaii: A.ownerGhii, amount: 200, tracking_code: `tc-broken-${stamp}`, reason: 'relayed', timestamp: new Date().toISOString() };
        const signed = JSON.parse(await signedSettlement(body));
        const { status, body: res } = await A.json('/v1/federation/settle', {
            method: 'POST', body: JSON.stringify({ ...signed, route_manifest: { origin: HOP1_ID, hops } }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(res)}`);
        assert(res.data.relay_distribution === null,
            `a broken chain must pay no relay: ${JSON.stringify(res.data.relay_distribution)}`);
    });

    // ─── Phase 4: Outbound settlement ───
    console.log('\nPhase 4 — POST /v1/federation/settle/outbound');

    await test('the operator sends a settlement the peer accepts', async () => {
        modes.settle = 'ok';
        const { status, body } = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: FAKE_ID, gaii: 'someone@elsewhere', amount: 7, tracking_code: `out-ok-${stamp}` }),
        });
        assert(status === 200 && body.data.sent === true, `status ${status}: ${JSON.stringify(body)}`);
        const arrived = seen.filter(s => s.path === '/v1/federation/settle').pop();
        assert(arrived?.body?.from_node === A_ID, `the peer must be told who sent it: ${JSON.stringify(arrived?.body)}`);
        assert(typeof arrived?.body?.signature === 'string' && arrived.body.signature.length > 0,
            `an outbound settlement is signed with this node's key: ${JSON.stringify(arrived?.body)}`);
        assert(arrived?.body?.reason === 'operator_settlement', `the default reason: ${arrived?.body?.reason}`);
    });

    await test('a peer that refuses the settlement is reported with the peer\'s own status', async () => {
        modes.settle = 'fail';
        const { status, body } = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: FAKE_ID, gaii: 'someone@elsewhere', amount: 7, tracking_code: `out-fail-${stamp}`, reason: 'retry' }),
        });
        assert(status === 500 && body.error?.code === 'FEDERATION_ERROR', `status ${status}: ${JSON.stringify(body)}`);
        modes.settle = 'ok';
    });

    await test('a peer nothing answers at is a 502, not a hang', async () => {
        const { status, body } = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: DEAD_ID, gaii: 'someone@elsewhere', amount: 7, tracking_code: `out-dead-${stamp}` }),
        });
        assert(status === 502 && body.error?.code === 'FEDERATION_ERROR', `status ${status}: ${JSON.stringify(body)}`);
    });

    await test('an unknown target and a missing field are refused before anything leaves', async () => {
        const before = seen.length;
        const unknown = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: `aimeat-nobody-${stamp}`, gaii: 'x@y', amount: 1, tracking_code: 'tc' }),
        });
        assert(unknown.status === 404 && unknown.body.error?.code === 'FEDERATION_ERROR', `unknown target: ${unknown.status} ${JSON.stringify(unknown.body)}`);
        const noAmount = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: FAKE_ID, gaii: 'x@y', tracking_code: 'tc' }),
        });
        assert(noAmount.status === 400, `missing amount: ${noAmount.status}`);
        const badAmount = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: FAKE_ID, gaii: 'x@y', amount: 'lots', tracking_code: 'tc' }),
        });
        assert(badAmount.status === 400, `non-numeric amount: ${badAmount.status}`);
        assert(seen.length === before, `no refusal may reach the peer, ${seen.length - before} request(s) arrived`);
    });

    await test('a plain owner may not send a settlement in this node\'s name', async () => {
        const { status } = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(plainOwnerToken),
            body: JSON.stringify({ target_node: FAKE_ID, gaii: 'x@y', amount: 1, tracking_code: `out-403-${stamp}` }),
        });
        assert(status === 403, `a non-operator owner must be refused, got ${status}`);
    });

    // ─── Phase 5: Routing ───
    console.log('\nPhase 5 — /v1/federation/route, /resolve and cross-node work');

    await test('the relay refuses a call with no credential and one missing its target', async () => {
        const anon = await A.json('/v1/federation/route', { method: 'POST', body: JSON.stringify({ target_node: FAKE_ID, path: '/v1/ping' }) });
        assert(anon.status === 401, `unauthenticated: ${anon.status}`);
        const noTarget = await A.json('/v1/federation/route', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ path: '/v1/ping' }) });
        assert(noTarget.status === 400 && noTarget.body.error?.code === 'INVALID_INPUT', `no target: ${noTarget.status} ${JSON.stringify(noTarget.body)}`);
        const noPath = await A.json('/v1/federation/route', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: FAKE_ID }) });
        assert(noPath.status === 400, `no path: ${noPath.status}`);
    });

    await test('a hop budget of zero and a path this node already appears in are both refused', async () => {
        const spent = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: FAKE_ID, path: '/v1/ping', max_hops: 0 }),
        });
        assert(spent.status === 400 && String(spent.body.error?.message).includes('hops'), `hops 0: ${spent.status} ${JSON.stringify(spent.body)}`);
        const loop = await A.json('/v1/federation/route', {
            method: 'POST', headers: { ...auth(A.ownerToken), 'X-Relay-Path': A_ID },
            body: JSON.stringify({ target_node: FAKE_ID, path: '/v1/ping' }),
        });
        assert(loop.status === 400 && String(loop.body.error?.message).includes('loop'), `loop: ${loop.status} ${JSON.stringify(loop.body)}`);
    });

    await test('a peer whose address the SSRF check refuses is a 400, and one nothing answers at a 502', async () => {
        const blocked = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: SSRF_ID, path: '/v1/ping' }),
        });
        assert(blocked.status === 400 && blocked.body.error?.code === 'INVALID_URL', `ssrf: ${blocked.status} ${JSON.stringify(blocked.body)}`);
        const dead = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: DEAD_ID, path: '/v1/ping' }),
        });
        assert(dead.status === 502 && dead.body.error?.code === 'FEDERATION_ERROR', `dead: ${dead.status} ${JSON.stringify(dead.body)}`);
    });

    await test('a peer this node has stopped routing to is a policy refusal, not a network one', async () => {
        const { status, body } = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: B_ID, path: '/v1/ping' }),
        });
        assert(status === 403 && body.error?.code === 'POLICY_DENIED', `expected 403 POLICY_DENIED, got ${status}: ${JSON.stringify(body)}`);
    });

    await test('a direct peer is relayed to, and the answer comes back inside a signed manifest', async () => {
        const { status, body } = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: FAKE_ID, method: 'GET', path: '/v1/nodeinfo' }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.routed_to === FAKE_ID && body.data.routed_via === A_ID, `routing: ${JSON.stringify(body.data)}`);
        assert(body.data.response_data?.data?.echo === '/v1/nodeinfo', `the peer's own answer: ${JSON.stringify(body.data.response_data)}`);
        const hops = body.data.route_manifest?.hops ?? [];
        assert(hops.length === 1 && hops[0].node_id === A_ID && hops[0].forwarded_to === FAKE_ID,
            `one hop, this node's: ${JSON.stringify(hops)}`);
        assert(typeof hops[0].signature === 'string' && hops[0].signature.length > 0, `the hop is signed: ${JSON.stringify(hops[0])}`);
        const arrived = seen[seen.length - 1];
        assert(arrived.path === '/v1/nodeinfo' && arrived.method === 'GET', `the peer saw the real call: ${JSON.stringify(arrived)}`);
    });

    await test('a target that is nobody\'s peer walks the relay list and finds the one that answers', async () => {
        // The peers are walked in insertion order: the dead one throws, the SSRF one is refused
        // before the socket, the fake one answers. All three branches of the loop in one request.
        const { status, body } = await A.json('/v1/federation/route', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: `aimeat-far-away-${stamp}`, method: 'POST', path: '/v1/ping', body: { hello: 1 } }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.routed_via === FAKE_ID, `relayed via the peer that answers: ${JSON.stringify(body.data)}`);
        assert(body.data.relay_path.includes(A_ID) && body.data.relay_path.includes(FAKE_ID), `relay path: ${JSON.stringify(body.data.relay_path)}`);
    });

    await test('…and with every peer already in the relay path there is no route left', async () => {
        const everyone = [DEAD_ID, SSRF_ID, FAKE_ID, B_ID, HOP1_ID, HOP2_ID].join(',');
        const { status, body } = await A.json('/v1/federation/route', {
            method: 'POST', headers: { ...auth(A.ownerToken), 'X-Relay-Path': everyone },
            body: JSON.stringify({ target_node: `aimeat-far-away-${stamp}`, path: '/v1/ping' }),
        });
        assert(status === 404 && body.error?.code === 'FEDERATION_ERROR', `expected 404, got ${status}: ${JSON.stringify(body)}`);
        assert(String(body.error?.message).includes('No route'), `message: ${body.error?.message}`);
    });

    await test('resolve finds a local agent, a node-hinted GAII, a peer that answers, and nothing', async () => {
        const local = await A.json(`/v1/federation/resolve/${encodeURIComponent(agentGaii)}`);
        assert(local.status === 200 && local.body.data.local === true && local.body.data.node_id === A_ID,
            `local agent: ${local.status} ${JSON.stringify(local.body.data)}`);

        const hinted = await A.json(`/v1/federation/resolve/${encodeURIComponent(`bot#someone@${B_ID}`)}`);
        assert(hinted.status === 200 && hinted.body.data.node_id === B_ID && hinted.body.data.local === false,
            `node hint: ${hinted.status} ${JSON.stringify(hinted.body.data)}`);
        assert(hinted.body.data.node_url === B.baseUrl, `the hint carries the peer's address: ${hinted.body.data.node_url}`);

        // No '@' means no hint, so the resolver broadcasts: the dead peer throws, the SSRF one is
        // skipped, the fake one answers 200 for any agent it is asked about.
        const broadcast = await A.json(`/v1/federation/resolve/${encodeURIComponent('ghost-no-at-sign')}`);
        assert(broadcast.status === 200 && broadcast.body.data.node_id === FAKE_ID,
            `broadcast: ${broadcast.status} ${JSON.stringify(broadcast.body.data)}`);

        // B is reached over a real socket and 404s for an agent it does not have; the fake peer is
        // never asked, because a node hint that names an active peer answers first.
        const miss = await B.json(`/v1/federation/resolve/${encodeURIComponent('nobody-at-all')}`);
        assert(miss.status === 404 && miss.body.error?.code === 'NOT_FOUND', `miss: ${miss.status} ${JSON.stringify(miss.body)}`);
    });

    await test('an agent submits cross-node work, and the request that arrives is signed', async () => {
        const { status, body } = await A.json('/v1/federation/cross-node/work', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ target_node: FAKE_ID, action_id: 'act-1', provider_gaii: 'provider@elsewhere', input: { q: 'hello' } }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.routed_to === FAKE_ID, `routed_to: ${JSON.stringify(body.data)}`);
        const arrived = seen.filter(s => s.path === '/v1/work/request').pop();
        assert(arrived?.body?.origin_node === A_ID && arrived?.body?.cross_node_requester === agentGaii,
            `the peer is told who asked: ${JSON.stringify(arrived?.body)}`);
        assert(typeof arrived?.body?.signature === 'string' && arrived.body.signature.length > 0,
            `cross-node work is signed with this node's key: ${JSON.stringify(arrived?.body)}`);
    });

    await test('cross-node work refuses a missing field and an unknown target', async () => {
        const missing = await A.json('/v1/federation/cross-node/work', {
            method: 'POST', headers: auth(agentToken), body: JSON.stringify({ target_node: FAKE_ID, action_id: 'act-1' }),
        });
        assert(missing.status === 400 && missing.body.error?.code === 'INVALID_INPUT', `missing input: ${missing.status}`);
        const unknown = await A.json('/v1/federation/cross-node/work', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ target_node: `aimeat-nobody-${stamp}`, action_id: 'a', provider_gaii: 'p@q', input: {} }),
        });
        assert(unknown.status === 404, `unknown target: ${unknown.status}`);
        const blocked = await A.json('/v1/federation/cross-node/work', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ target_node: SSRF_ID, action_id: 'a', provider_gaii: 'p@q', input: {} }),
        });
        assert(blocked.status === 400 && blocked.body.error?.code === 'INVALID_URL', `ssrf target: ${blocked.status} ${JSON.stringify(blocked.body)}`);
    });

    // ─── Phase 6: Templates and the peer memory inventory ───
    console.log('\nPhase 6 — Cross-node template sharing and POST /v1/federation/memory/list');

    const listingTitle = `Shared template ${stamp}`;

    await test('B holds a listed template and some memory of its own', async () => {
        const now = new Date().toISOString();
        await B.storage.createTemplateListing({
            id: randomUUID(), packageGroupId: `pkg-${stamp}`, packageName: `pkg-${stamp}`, packageAuthor: B.ownerName,
            publishedBy: B.ownerName, publishedByGhii: B.ownerGhii, title: listingTitle,
            description: 'A template B is willing to share across the federation',
            screenshots: [], category: 'tools', tags: ['test'], featured: false,
            installCount: 0, rating: 0, reviewCount: 0, status: 'listed', createdAt: now, updatedAt: now,
        });
        for (const key of ['setnote.one', 'setnote.two']) {
            await B.storage.setMemory({
                key, ownerGaii: B.ownerGhii, value: { note: key }, visibility: 'public',
                tags: ['fed'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
        }
        const listed = await B.storage.listTemplateListings({ status: 'listed', limit: 100, offset: 0 });
        assert(listed.listings.some(l => l.title === listingTitle), 'the listing must be on B before A asks for it');
        assert((await B.storage.listMemory(B.ownerGhii, {})).length >= 2, 'B must hold the two records the inventory door will serve');
    });

    await test('A syncs templates and gets B\'s listing, with every other peer reported per peer', async () => {
        const { status, body } = await A.json('/v1/federation/templates/sync', { method: 'POST', headers: auth(A.ownerToken), body: '{}' });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const results: { node: string; templates: number; error?: string }[] = body.data.syncResults;
        const fromB = results.find(r => r.node === B_ID);
        // A count, not the listing itself: B also seeds its own bundled templates, and pinning the
        // number would break the day one is added. What B actually serves is asserted below, on the
        // signed GET, where the listing can be looked at by title.
        assert((fromB?.templates ?? 0) >= 1, `B's listings must arrive: ${JSON.stringify(results)}`);
        assert(!fromB?.error, `B must not error: ${fromB?.error}`);
        const fromFake = results.find(r => r.node === FAKE_ID);
        assert(fromFake?.error === 'HTTP 404', `a peer that refuses is named with its status: ${JSON.stringify(fromFake)}`);
        const fromSsrf = results.find(r => r.node === SSRF_ID);
        assert(!!fromSsrf?.error, `a peer the URL check refuses is named too: ${JSON.stringify(fromSsrf)}`);
        const fromDead = results.find(r => r.node === DEAD_ID);
        assert(!!fromDead?.error, `an unreachable peer is named: ${JSON.stringify(fromDead)}`);
    });

    await test('a plain owner may not start a template sync', async () => {
        const { status } = await A.json('/v1/federation/templates/sync', { method: 'POST', headers: auth(plainOwnerToken), body: '{}' });
        assert(status === 403, `expected 403, got ${status}`);
    });

    await test('B\'s template door refuses an unnamed, unsigned, stale or wrongly signed caller', async () => {
        const url = '/v1/federation/templates?limit=100';
        const noName = await B.json(url);
        assert(noName.status === 400 && noName.body.error?.code === 'INVALID_INPUT', `no x-source-node: ${noName.status} ${JSON.stringify(noName.body)}`);

        const noSig = await B.json(url, { headers: { 'x-source-node': A_ID } });
        assert(noSig.status === 401 && noSig.body.error?.code === 'UNAUTHORIZED', `no signature: ${noSig.status} ${JSON.stringify(noSig.body)}`);

        const staleTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const stale = await B.json(url, {
            headers: {
                'x-source-node': A_ID, 'x-timestamp': staleTs,
                'x-signature': await sign(A.nodeKey.privateKey, JSON.stringify({ source_node: A_ID, timestamp: staleTs })),
            },
        });
        assert(stale.status === 400 && stale.body.error?.code === 'STALE_TIMESTAMP', `stale: ${stale.status} ${JSON.stringify(stale.body)}`);

        const ts = new Date().toISOString();
        const wrongKey = await generateKeyPair();
        const forged = await B.json(url, {
            headers: {
                'x-source-node': A_ID, 'x-timestamp': ts,
                'x-signature': await sign(wrongKey.privateKey, JSON.stringify({ source_node: A_ID, timestamp: ts })),
            },
        });
        assert(forged.status === 401 && forged.body.error?.code === 'UNAUTHORIZED', `forged: ${forged.status} ${JSON.stringify(forged.body)}`);

        const stranger = await B.json(url, { headers: { 'x-source-node': `aimeat-stranger-${stamp}` } });
        assert(stranger.status === 403, `a node that is not a peer: ${stranger.status} ${JSON.stringify(stranger.body)}`);
    });

    await test('…and serves the listing to a peer that proves who it is', async () => {
        const ts = new Date().toISOString();
        const { status, body } = await B.json('/v1/federation/templates?limit=5&category=tools&tags=test&offset=0', {
            headers: {
                'x-source-node': A_ID, 'x-timestamp': ts,
                'x-signature': await sign(A.nodeKey.privateKey, JSON.stringify({ source_node: A_ID, timestamp: ts })),
            },
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const t = body.data.templates.find((x: any) => x.title === listingTitle);
        assert(!!t, `the listing must be served: ${JSON.stringify(body.data.templates)}`);
        assert(t.sourceNode === B_ID && t.category === 'tools', `enrichment: ${JSON.stringify(t)}`);
        assert(t.componentCount === 0 && t.sizeMb === 0,
            `a listing with no published package is served with empty component figures: ${JSON.stringify(t)}`);
    });

    await test('the memory inventory door refuses a missing field, a barred peer and every bad signature', async () => {
        const ts = () => new Date().toISOString();
        const missing = await B.json('/v1/federation/memory/list', { method: 'POST', body: JSON.stringify({ requesting_node: A_ID }) });
        assert(missing.status === 400 && missing.body.error?.code === 'INVALID_INPUT', `missing gaii: ${missing.status} ${JSON.stringify(missing.body)}`);

        const barred = await B.json('/v1/federation/memory/list', {
            method: 'POST', body: JSON.stringify({ requesting_node: HOP1_ID, gaii: B.ownerGhii, timestamp: ts(), signature: 'x' }),
        });
        assert(barred.status === 403 && barred.body.error?.code === 'POLICY_DENIED',
            `a peer with replication switched off: ${barred.status} ${JSON.stringify(barred.body)}`);

        const unsigned = await B.json('/v1/federation/memory/list', {
            method: 'POST', body: JSON.stringify({ requesting_node: A_ID, gaii: B.ownerGhii, timestamp: ts() }),
        });
        assert(unsigned.status === 401, `unsigned: ${unsigned.status} ${JSON.stringify(unsigned.body)}`);

        const staleTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const stale = await B.json('/v1/federation/memory/list', {
            method: 'POST',
            body: JSON.stringify({
                requesting_node: A_ID, gaii: B.ownerGhii, timestamp: staleTs,
                signature: await sign(A.nodeKey.privateKey, JSON.stringify({ requesting_node: A_ID, gaii: B.ownerGhii, timestamp: staleTs })),
            }),
        });
        assert(stale.status === 401 && String(stale.body.error?.message).includes('stale'), `stale: ${stale.status} ${JSON.stringify(stale.body)}`);

        const t = ts();
        const wrongKey = await generateKeyPair();
        const forged = await B.json('/v1/federation/memory/list', {
            method: 'POST',
            body: JSON.stringify({
                requesting_node: A_ID, gaii: B.ownerGhii, timestamp: t,
                signature: await sign(wrongKey.privateKey, JSON.stringify({ requesting_node: A_ID, gaii: B.ownerGhii, timestamp: t })),
            }),
        });
        assert(forged.status === 401 && String(forged.body.error?.message).includes('Invalid'), `forged: ${forged.status} ${JSON.stringify(forged.body)}`);
    });

    await test('…and hands the inventory to a peer that signs for it', async () => {
        const timestamp = new Date().toISOString();
        const signature = await sign(A.nodeKey.privateKey, JSON.stringify({ requesting_node: A_ID, gaii: B.ownerGhii, timestamp }));
        const { status, body } = await B.json('/v1/federation/memory/list', {
            method: 'POST', body: JSON.stringify({ requesting_node: A_ID, gaii: B.ownerGhii, timestamp, signature }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const keys = body.data.entries.map((e: any) => e.key);
        assert(keys.includes('setnote.one') && keys.includes('setnote.two'), `entries: ${JSON.stringify(keys)}`);
        assert(body.data.total === body.data.entries.length, `total matches: ${body.data.total} vs ${body.data.entries.length}`);
        const one = body.data.entries.find((e: any) => e.key === 'setnote.one');
        assert(one.visibility === 'public' && one.version === 1, `the inventory carries metadata, never values: ${JSON.stringify(one)}`);
        assert(!('value' in one), `a key inventory must not carry values: ${JSON.stringify(one)}`);
    });

    // ─── Phase 7: The services, called directly ───
    console.log('\nPhase 7 — Catalogue sync, memory replication, the queue and the scheduler');

    const fakePeer = () => peerInfo(FAKE_ID, fake!.url, P.publicKey);
    const ssrfPeer = () => peerInfo(SSRF_ID, SSRF_URL, P.publicKey);

    await test('a CSM marked federable and an action tagged with it give the delta filter rows', async () => {
        const now = new Date().toISOString();
        await A.storage.createCsm({
            name: `setcsm${stamp}`, definition: { service: { type: 'directory' } }, jsonSchemaKey: `csm.setcsm${stamp}`,
            serviceType: 'directory', registeredBy: A.ownerName, registeredAt: now, updatedAt: now, federate: true,
        });
        await A.storage.createAction({
            id: `act-${stamp}`, providerGaii: agentGaii, displayName: 'Federable action',
            description: 'Tagged with the CSM so the catalogue delta has something to send',
            category: 'directory', inputSchema: {}, outputSchema: {},
            pricing: { baseMorsels: 1 }, tags: [`csm:setcsm${stamp}`], createdAt: now, updatedAt: now,
        });
        const csms = await A.storage.listCsms();
        assert(csms.some(c => c.federate === true), 'a federable CSM must exist');
    });

    await test('a peer this node does not share its catalogue with is a no-op, not a push', async () => {
        const before = seen.length;
        const result = await syncCatalogueToPeer(peerInfo(FAKE_ID, fake!.url, P.publicKey, { shareCatalogue: false }), A.config, A.storage);
        assert(result.success === true && result.entries_sent === 0, `result: ${JSON.stringify(result)}`);
        assert(seen.length === before, `nothing may leave, ${seen.length - before} request(s) arrived`);
    });

    await test('the first catalogue sync is full, signed, and carries the federable action', async () => {
        modes.catalogue = 'ok';
        const result = await syncCatalogueToPeer(fakePeer(), A.config, A.storage);
        assert(result.success === true, `result: ${JSON.stringify(result)}`);
        assert(result.incremental === false, 'the first sync to a peer is a full one');
        assert(result.entries_sent >= 1, `the federable action must be sent: ${result.entries_sent}`);
        assert(result.catalogue_hash.length > 0, `a catalogue hash is computed: "${result.catalogue_hash}"`);
        const arrived = seen.filter(s => s.path === '/v1/federation/catalogue-sync').pop();
        assert(arrived?.body?.source_node === A_ID, `source: ${JSON.stringify(arrived?.body?.source_node)}`);
        assert(typeof arrived?.body?.signature === 'string' && arrived.body.signature.length > 0, 'the payload is signed');
        assert(arrived?.body?.since_timestamp === null, `a full sync names no since_timestamp: ${arrived?.body?.since_timestamp}`);
    });

    await test('the second sync is incremental, and a peer asking for a resync clears the state', async () => {
        modes.catalogue = 'resync';
        const results = await syncCatalogueToAllPeers(A.config, A.storage, new Map([[FAKE_ID, fakePeer()]]));
        assert(results.length === 1 && results[0].success === true, `results: ${JSON.stringify(results)}`);
        assert(results[0].incremental === true, 'the second sync to the same peer is a delta');
        assert(results[0].resync_required === true, `the peer asked for a resync: ${JSON.stringify(results[0])}`);
        // resetPeerSyncState was called on the way out, so the next sync is a full one again.
        assert(getPeerSyncState(FAKE_ID).lastSyncAt === null,
            `a resync request must clear the tracked state: ${JSON.stringify(getPeerSyncState(FAKE_ID))}`);
        modes.catalogue = 'ok';
    });

    await test('a peer answering non-2xx and a peer the SSRF check refuses are both failures with a reason', async () => {
        modes.catalogue = 'fail';
        const broken = await syncCatalogueToPeer(fakePeer(), A.config, A.storage);
        assert(broken.success === false && String(broken.error).includes('HTTP 500'), `peer 500: ${JSON.stringify(broken)}`);
        modes.catalogue = 'ok';
        const blocked = await syncCatalogueToPeer(ssrfPeer(), A.config, A.storage);
        assert(blocked.success === false && String(blocked.error).includes('SSRF blocked'), `ssrf: ${JSON.stringify(blocked)}`);
        assert(getPeerSyncState(SSRF_ID).consecutiveFailures >= 1, 'a failure is counted against the peer');
        assert(await syncCatalogueToAllPeers(A.config, A.storage, new Map()).then(r => r.length === 0),
            'no active peers means no results at all');
    });

    const REP_KEY = 'setfed.shared';

    await test('a public record with an active federation consent replicates; without either it does not', async () => {
        const now = new Date().toISOString();
        await A.storage.setMemory({
            key: REP_KEY, ownerGaii: agentGaii, value: { shared: true }, visibility: 'public',
            tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        await A.storage.setMemory({
            key: 'setfed.private', ownerGaii: agentGaii, value: { shared: false }, visibility: 'private',
            tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });

        const missing = await replicateMemoryToPeer(fakePeer(), agentGaii, 'setfed.nothing-here', A.config, A.storage);
        assert(missing.success === false && missing.error === 'Memory entry not found', `absent key: ${JSON.stringify(missing)}`);

        const noConsent = await replicateMemoryToPeer(fakePeer(), agentGaii, REP_KEY, A.config, A.storage);
        assert(noConsent.success === false && String(noConsent.error).includes('not eligible'),
            `public is not enough without a consent: ${JSON.stringify(noConsent)}`);

        await A.storage.createConsent({
            id: randomUUID(), ownerGaii: agentGaii, dataPattern: 'setfed.*', recipient: '*',
            purpose: 'federation replication', scope: 'federation', expires: null, status: 'active',
            grantedAt: now, revokedAt: null,
        });
        const eligible = await isEligibleForReplication(A.storage, agentGaii, REP_KEY);
        assert(eligible.eligible === true && !!eligible.consentId, `eligibility: ${JSON.stringify(eligible)}`);
        const stillPrivate = await isEligibleForReplication(A.storage, agentGaii, 'setfed.private');
        assert(stillPrivate.eligible === false, 'a private record stays ineligible even under a matching consent');

        modes.replicate = 'ok';
        const ok = await replicateMemoryToPeer(fakePeer(), agentGaii, REP_KEY, A.config, A.storage);
        assert(ok.success === true, `replication: ${JSON.stringify(ok)}`);
        const arrived = seen.filter(s => s.path === '/v1/federation/replicate').pop();
        assert(arrived?.body?.gaii === agentGaii && arrived?.body?.key === REP_KEY, `payload: ${JSON.stringify(arrived?.body)}`);
        assert(arrived?.body?.consent_ref === eligible.consentId, `the consent travels with the record: ${JSON.stringify(arrived?.body?.consent_ref)}`);
        assert(typeof arrived?.body?.signature === 'string' && arrived.body.signature.length > 0, 'the replication is signed');
    });

    await test('a peer with replication switched off, a blocked address and a peer 500 each refuse with a reason', async () => {
        const off = await replicateMemoryToPeer(peerInfo(FAKE_ID, fake!.url, P.publicKey, { replicateMemory: false }), agentGaii, REP_KEY, A.config, A.storage);
        assert(off.success === false && String(off.error).includes('disabled'), `replication off: ${JSON.stringify(off)}`);
        const blocked = await replicateMemoryToPeer(ssrfPeer(), agentGaii, REP_KEY, A.config, A.storage);
        assert(blocked.success === false && String(blocked.error).includes('SSRF blocked'), `ssrf: ${JSON.stringify(blocked)}`);
        modes.replicate = 'fail';
        const broken = await replicateMemoryToPeer(fakePeer(), agentGaii, REP_KEY, A.config, A.storage);
        assert(broken.success === false && String(broken.error).includes('HTTP 500'), `peer 500: ${JSON.stringify(broken)}`);
        modes.replicate = 'ok';
    });

    await test('the whole-node replication cycle sends what is eligible and counts what is not', async () => {
        // A KEY THIS PEER HAS NOT SEEN. The cycle skips anything already replicated to that peer
        // and unchanged since, and REP_KEY was pushed by hand above — so reusing it would measure
        // the skip rather than the send. This one is written now, and one that no consent covers
        // beside it, so both counters have something to count.
        const now = new Date().toISOString();
        await A.storage.setMemory({
            key: 'setfed.cycle', ownerGaii: agentGaii, value: { cycle: true }, visibility: 'public',
            tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        await A.storage.setMemory({
            key: 'setother.uncovered', ownerGaii: agentGaii, value: { covered: false }, visibility: 'public',
            tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        const results = await replicateMemoryToAllPeers(A.config, A.storage, new Map([[FAKE_ID, fakePeer()]]));
        assert(results.length === 1, `one peer, one result: ${JSON.stringify(results)}`);
        const r = results[0];
        assert(r.peer_node_id === FAKE_ID, `peer: ${r.peer_node_id}`);
        assert(r.entries_sent >= 1, `the eligible record must be sent: ${JSON.stringify(r)}`);
        assert(r.consent_denied >= 1, `the record no consent covers must be counted, not sent: ${JSON.stringify(r)}`);
        assert(r.entries_failed === 0 && r.success === true, `nothing may fail against a peer that answers: ${JSON.stringify(r)}`);
        assert((await replicateMemoryToAllPeers(A.config, A.storage, new Map())).length === 0, 'no active peers means no cycle');
    });

    await test('the replication queue takes a job, hands it back for its peer, and is marked sent', async () => {
        const peers = new Map([[FAKE_ID, fakePeer()]]);
        const id = await enqueueCatalogueSync(FAKE_ID, A.config, A.storage);
        assert(typeof id === 'string' && id.length > 0, `enqueue returns an id: ${id}`);
        const queued = await A.storage.dequeueReplication(FAKE_ID, 10);
        assert(queued.some(e => e.id === id && e.type === 'catalogue_sync' && e.status === 'pending'),
            `the job must come back for its own peer: ${JSON.stringify(queued)}`);
        assert((await A.storage.dequeueReplication(`aimeat-someone-else-${stamp}`, 10)).length === 0,
            'a job is handed only to the peer it names');

        modes.catalogue = 'ok';
        await drainSyncQueue(A.config, A.storage, peers);
        const afterDrain = await A.storage.dequeueReplication(FAKE_ID, 10);
        assert(!afterDrain.some(e => e.id === id), `a drained job leaves the pending list: ${JSON.stringify(afterDrain)}`);
    });

    await test('a job whose sync fails is marked failed and stays out of the pending list', async () => {
        const peers = new Map([[SSRF_ID, ssrfPeer()]]);
        const id = await enqueueCatalogueSync(SSRF_ID, A.config, A.storage);
        await drainSyncQueue(A.config, A.storage, peers);
        const pending = await A.storage.dequeueReplication(SSRF_ID, 10);
        assert(!pending.some(e => e.id === id),
            `a failed job must not sit in the pending list waiting to be retried forever: ${JSON.stringify(pending)}`);
        const size = await A.storage.replicationQueueSize();
        assert(size >= 2, `both jobs are still on the queue as rows, sent and failed: ${size}`);
    });

    await test('a memory write enqueues for replication in instant mode, and never in bulk', async () => {
        const peers = new Map([[FAKE_ID, fakePeer()]]);
        const bulk = { ...A.config, syncMode: 'bulk' as const };
        const before = await A.storage.replicationQueueSize();
        await enqueueMemoryReplication(agentGaii, REP_KEY, bulk, A.storage, peers);
        assert(await A.storage.replicationQueueSize() === before, 'bulk mode queues nothing on a write');

        const instant = { ...A.config, syncMode: 'instant' as const };
        await enqueueMemoryReplication(agentGaii, 'setfed.private', instant, A.storage, peers);
        assert(await A.storage.replicationQueueSize() === before, 'an ineligible record queues nothing either');

        await enqueueMemoryReplication(agentGaii, REP_KEY, instant, A.storage, peers);
        const queued = await A.storage.dequeueReplication(FAKE_ID, 10);
        assert(queued.some(e => e.type === 'memory_replicate' && (e.payload as any)?.key === REP_KEY),
            `an eligible record queues one memory_replicate job: ${JSON.stringify(queued)}`);

        await enqueueMemoryReplication(agentGaii, REP_KEY, instant, A.storage, new Map());
        assert((await A.storage.dequeueReplication(FAKE_ID, 10)).length === queued.length, 'no active peers means no job');

        await drainSyncQueue(A.config, A.storage, peers);
        assert(!(await A.storage.dequeueReplication(FAKE_ID, 10)).some(e => e.type === 'memory_replicate'),
            'the drain marks memory jobs sent as well as catalogue ones');
    });

    await test('a catalogue change debounces into a queued, drained sync — and does nothing in bulk mode', async () => {
        const peers = new Map([[FAKE_ID, fakePeer()]]);
        const before = await A.storage.replicationQueueSize();
        notifyCatalogueChange({ ...A.config, syncMode: 'bulk' as const }, A.storage, peers);
        await sleep(120);
        assert(await A.storage.replicationQueueSize() === before, 'bulk mode does not react to a catalogue change');

        notifyCatalogueChange({ ...A.config, syncMode: 'instant' as const, syncBatchDelayMs: 40 }, A.storage, peers);
        notifyCatalogueChange({ ...A.config, syncMode: 'instant' as const, syncBatchDelayMs: 40 }, A.storage, peers);
        await sleep(400);
        assert(await A.storage.replicationQueueSize() > before,
            'the debounce window must fire once and queue a sync');

        // The flush waits for its enqueues before it drains (fixed 2026-09-08 in sync-scheduler.ts):
        // until then the drain could reach the queue before the row it was meant to carry was in
        // it, and the job sat pending until the next drain, measured on every run of this suite.
        assert(!(await A.storage.dequeueReplication(FAKE_ID, 10)).some(e => e.type === 'catalogue_sync'),
            'the flush itself drained what the debounce queued; nothing is left pending for the next drain');
    });

    await test('the scheduler starts and stops without leaving a timer behind', async () => {
        const handle = startSyncScheduler({ ...A.config, syncIntervalHours: 6 }, A.storage, new Map([[FAKE_ID, fakePeer()]]));
        assert(typeof handle.stop === 'function', 'the scheduler hands back a way to stop it');
        handle.stop();
    });

    // ─── Phase 8: Cleanup ───
    console.log('\nPhase 8 — Cleanup');

    await test('the peers on both nodes are de-peered', async () => {
        for (const id of [DEAD_ID, SSRF_ID, FAKE_ID, B_ID, HOP1_ID, HOP2_ID]) {
            const del = await A.json(`/v1/federation/peers/${id}`, { method: 'DELETE', headers: auth(A.ownerToken) });
            assert(del.status === 200, `delete ${id} on A: ${del.status} ${JSON.stringify(del.body)}`);
        }
        for (const id of [A_ID, HOP1_ID]) {
            const del = await B.json(`/v1/federation/peers/${id}`, { method: 'DELETE', headers: auth(B.ownerToken) });
            assert(del.status === 200, `delete ${id} on B: ${del.status} ${JSON.stringify(del.body)}`);
        }
        // DELETE opens a de-peering grace period rather than dropping the row: work already in
        // flight has to be able to land. So the check is that not one of them is active any more.
        const left = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
        const stillActive = left.body.data.peers.filter((p: any) => p.status === 'active');
        assert(stillActive.length === 0, `no peer may still be active: ${JSON.stringify(stillActive.map((p: any) => p.node_id))}`);
    });
}

try {
    await run();
} catch (err) {
    failed++;
    console.error('Suite crashed:', err);
} finally {
    try { fake?.server.close(); } catch { /* the peer may already be down */ }
    try { A!.server.close(); } catch { /* A may never have booted */ }
    try { B!.server.close(); } catch { /* B may never have booted */ }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Federation settlements + sync E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
await new Promise<void>(r => process.stdout.write('', () => r()));
process.exit(failed > 0 ? 1 : 0);

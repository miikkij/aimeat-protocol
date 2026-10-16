/**
 * @file test/e2e-federation-two-real-nodes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Work and settlement between TWO REAL NODES, with no stand-in on either end (QA audit
 *   F14b-01, F18-01, F18-03).
 *
 *   WHY. Every cross-node work test sent to a node:http fake that answered 201, and the outbound
 *   heartbeat, memory replication and catalogue sync were received only by that fake, which accepts any
 *   body. So nothing proved that what one node sends, another node accepts. Here node A and node B are
 *   whole AIMEAT nodes booted in this process (test/helpers/federation-two-node.ts), each with its own
 *   node id, its own Ed25519 node key and its own database, talking over real loopback sockets. Each
 *   holds the other as an active member peer with routing, settlement, catalogue and replication on.
 *
 *   WHAT IT ASSERTS:
 *     - Settlement works: A's operator sends a signed settlement to B, B verifies A's signature and
 *       credits its owner with a ledger row naming A, and the same tracking code a second time is
 *       refused by B and reported by A with B's status.
 *     - Cross-node work is refused today, and says so: work asked on A of a provider on B (POST
 *       /v1/work/request by a person, POST /v1/federation/cross-node/work by an agent) reaches B, B
 *       refuses it because a forwarding node holds no credential of B's, A answers PEER_REFUSED with
 *       B's status, the 1-morsel routing fee comes back with a ledger line, and B holds no work item.
 *       The feature list's "Cross-node work and settlement" row states this limit.
 *     - The three outbound senders are accepted by a real receiver: catalogue sync lands A's federable
 *       action in B's catalogue, memory replication lands a replica of A's record on B, and a
 *       heartbeat cycle (runHeartbeatCycle) is accepted by B, which stamps when it last saw A, while
 *       a dead peer goes degraded after 3 failed cycles and offline after 10, and a de-peered peer
 *       past its grace is purged.
 *
 *   The two nodes run on the in-memory SQLite provider whatever the runner's backend is: what is under
 *   test is what crosses the wire, and the storage of both is the same code either way.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-two-real-nodes
 * @version-history
 *   2026-10-16 — Initial (QA audit F14b-01, F18-01, F18-03).
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { sign, generateKeyPair } from '../src/auth/keypair.js';
import type { PeerInfo } from '../src/services/federation.js';
import { runHeartbeatCycle } from '../src/services/federation.js';
import { syncCatalogueToPeer } from '../src/services/catalogue-sync.js';
import { replicateMemoryToPeer } from '../src/services/memory-replication.js';
import { bootNode, setupOperator, addPeer, auth, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const A_ID = `aimeat-real-a-${stamp}`;
const B_ID = `aimeat-real-b-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let A!: NodeState;
let B!: NodeState;
let personToken = '';      // a person on A who is not the operator
let personGhii = '';
let agentGaii = '';        // an agent on A
let agentToken = '';
let providerGaii = '';     // an agent on B, the provider work is asked of

function peerInfo(n: NodeState, over: Partial<PeerInfo> = {}): PeerInfo {
    const now = new Date().toISOString();
    return {
        nodeId: n.nodeId, url: n.baseUrl, publicKey: n.nodeKey.publicKey, status: 'active', addedAt: now, lastSeen: now,
        shareCatalogue: true, replicateMemory: true, allowRouting: true, allowMessaging: true, allowBroadcast: true,
        allowSettlement: true, peerMode: 'federation', allowFederatedAuth: false, federationAuthScopes: [], tier: 'member', ...over,
    };
}
async function walletOf(node: NodeState, token: string): Promise<number> {
    const w = await node.json('/v1/wallet', { headers: auth(token) });
    assert(w.status === 200, `wallet ${w.status}`);
    return w.body.data.balance as number;
}
async function linesOf(node: NodeState, token: string, type: string): Promise<any[]> {
    const r = await node.json(`/v1/wallet/transactions?type=${type}&per_page=200`, { headers: auth(token) });
    return r.body.data.transactions as any[];
}

console.log('\n=== Federation between two real nodes ===\n');

const servers: Server[] = [];
try {
    await test('A and B boot with node keys of their own, and each holds the other as an active member peer', async () => {
        A = await bootNode(suitePort(31500, RUNNER_BASE), A_ID);
        servers.push(A.server);
        B = await bootNode(suitePort(31600, RUNNER_BASE), B_ID);
        servers.push(B.server);
        assert(A.nodeKey.publicKey !== B.nodeKey.publicKey, 'A and B hold the same node key; no signature test below would mean anything');
        await setupOperator(A, `reala${stamp}`);
        await setupOperator(B, `realb${stamp}`);
        const tune = { allow_routing: true, allow_settlement: true, share_catalogue: true, replicate_memory: true, tier: 'member' };
        await addPeer(A, B_ID, B.baseUrl, B.nodeKey.publicKey, tune);
        await addPeer(B, A_ID, A.baseUrl, A.nodeKey.publicKey, tune);
    });

    await test('a person and an agent on A, and a provider agent on B', async () => {
        const p = await registerOwner(A.baseUrl, `realp${stamp}`);
        personToken = p.token;
        personGhii = `realp${stamp}@${A_ID}`;
        const reg = await A.json('/v1/agents', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ name: `ra${stamp}`.toLowerCase(), owner: A.ownerName, capabilities: ['memory'], scopes: ['memory:read', 'memory:write', 'work:request'] }) });
        assert(reg.status === 201, `agent on A ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
        agentGaii = reg.body.data.agent.gaii;
        const ts = new Date().toISOString();
        const tok = await A.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(reg.body.data.private_key, agentGaii + ts) }) });
        assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body?.error)}`);
        agentToken = tok.body.data.token;
        const prov = await B.json('/v1/agents', { method: 'POST', headers: auth(B.ownerToken), body: JSON.stringify({ name: `rb${stamp}`.toLowerCase(), owner: B.ownerName, capabilities: ['social'] }) });
        assert(prov.status === 201, `agent on B ${prov.status}: ${JSON.stringify(prov.body?.error)}`);
        providerGaii = prov.body.data.agent.gaii;
    });

    // ─── Settlement: the path that works between two real nodes ───
    console.log('\nSettlement A → B');

    const TC = `real-settle-${stamp}`;
    await test('A\'s operator settles with B: B verifies A\'s signature and credits its owner, with a ledger row naming A', async () => {
        const before = await walletOf(B, B.ownerToken);
        const r = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: B_ID, gaii: B.ownerGhii, amount: 7, tracking_code: TC }),
        });
        assert(r.status === 200 && r.body.data?.sent === true, `outbound ${r.status}: ${JSON.stringify(r.body)}`);
        const after = await walletOf(B, B.ownerToken);
        assert(after === before + 7, `B's owner balance ${before} → ${after}, expected +7`);
        const rows = (await linesOf(B, B.ownerToken, 'federation_settlement')).filter(t => t.tracking_code === `settle:${TC}`);
        assert(rows.length === 1 && rows[0].amount === 7 && rows[0].counterparty_gaii === A_ID, `ledger: ${JSON.stringify(rows)}`);
    });

    await test('the same settlement a second time is refused by B, and A reports B\'s status; nothing more is credited', async () => {
        const before = await walletOf(B, B.ownerToken);
        const r = await A.json('/v1/federation/settle/outbound', {
            method: 'POST', headers: auth(A.ownerToken),
            body: JSON.stringify({ target_node: B_ID, gaii: B.ownerGhii, amount: 7, tracking_code: TC }),
        });
        // B answers the replay 409, and A passes B's status on with its own error code.
        assert(r.status === 409 && r.body.ok === false && r.body.error?.code === 'FEDERATION_ERROR', `replay: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await walletOf(B, B.ownerToken) === before, 'the replay credited B again');
    });

    // ─── Cross-node work: refused today, honestly ───
    console.log('\nCross-node work A → B');

    await test('work a person on A asks of a provider on B: B refuses it, A says PEER_REFUSED, the fee comes back, B holds nothing', async () => {
        const before = await walletOf(A, personToken);
        const r = await A.json('/v1/work/request', {
            method: 'POST', headers: auth(personToken),
            body: JSON.stringify({ action_id: 'real-act', provider_gaii: providerGaii, input: { q: 'hello' } }),
        });
        assert(r.body.ok === false && r.body.error?.code === 'PEER_REFUSED', `answer: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.details?.routed_to === B_ID && r.body.error?.details?.peer_status === 401, `details: ${JSON.stringify(r.body.error?.details)}`);
        assert(await walletOf(A, personToken) === before, 'the routing fee was kept');
        const fee = (await linesOf(A, personToken, 'routing_fee')).filter(t => t.tracking_code === `route:${B_ID}`);
        const back = (await linesOf(A, personToken, 'routing_fee_return')).filter(t => t.tracking_code === `route:${B_ID}`);
        assert(fee.length === 1 && back.length === 1, `one fee taken and given back: ${JSON.stringify({ fee, back })}`);
        const onB = await B.storage.listWorkByProvider(providerGaii);
        assert(onB.length === 0, `B holds a work item: ${JSON.stringify(onB)}`);
        const onA = await A.storage.listWorkByRequester(personGhii);
        assert(onA.length === 0, `A holds a work item and escrow: ${JSON.stringify(onA)}`);
    });

    await test('an agent\'s cross-node work to B: the signed request reaches B, B refuses it, A answers PEER_REFUSED and gives the fee back', async () => {
        // The agent holds no balance; the fee is its owner's (morsels pace the person, CLAUDE.md).
        const before = await walletOf(A, A.ownerToken);
        const r = await A.json('/v1/federation/cross-node/work', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ target_node: B_ID, action_id: 'real-act', provider_gaii: providerGaii, input: { q: 'hi' } }),
        });
        assert(r.body.ok === false && r.body.error?.code === 'PEER_REFUSED' && r.body.error?.details?.routed_to === B_ID, `answer: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await walletOf(A, A.ownerToken) === before, 'the routing fee was kept');
        const onB = await B.storage.listWorkByProvider(providerGaii);
        assert(onB.length === 0, `B holds a work item: ${JSON.stringify(onB)}`);
    });

    // ─── The three outbound senders, received by a real node ───
    console.log('\nCatalogue sync, memory replication and the heartbeat, received by B');

    await test('catalogue sync: A\'s federable action lands in B\'s catalogue, tagged as federated from A', async () => {
        const now = new Date().toISOString();
        const csm = `realcsm${stamp}`;
        await A.storage.createCsm({ name: csm, definition: { service: { type: 'directory' } }, jsonSchemaKey: `csm.${csm}`, serviceType: 'directory', registeredBy: A.ownerName, registeredAt: now, updatedAt: now, federate: true });
        await A.storage.createAction({
            id: `realact-${stamp}`, providerGaii: agentGaii, displayName: 'Federable action', description: 'Crosses to B',
            category: 'directory', inputSchema: {}, outputSchema: {}, pricing: { tollMorsels: 1 }, tags: [`csm:${csm}`], createdAt: now, updatedAt: now,
        });
        const result = await syncCatalogueToPeer(peerInfo(B), A.config, A.storage);
        assert(result.success === true && result.entries_sent >= 1, `sync: ${JSON.stringify(result)}`);
        const onB = (await B.storage.listActions()).filter(a => (a.tags ?? []).includes(`federated:${A_ID}`));
        // B names a federated action by its source: the id and the display name carry A's node id.
        assert(onB.some(a => a.id === `${A_ID}:realact-${stamp}` && a.displayName === `[${A_ID}] Federable action` && a.providerGaii === agentGaii),
            `B's catalogue: ${JSON.stringify(onB.map(a => ({ id: a.id, name: a.displayName, provider: a.providerGaii })))}`);
    });

    await test('memory replication: a public record of A with a federation consent becomes a replica on B', async () => {
        const now = new Date().toISOString();
        await A.storage.setMemory({ key: 'realfed.shared', ownerGaii: agentGaii, value: { shared: 'yes' }, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
        await A.storage.createConsent({ id: randomUUID(), ownerGaii: agentGaii, dataPattern: 'realfed.*', recipient: '*', purpose: 'federation replication', scope: 'federation', expires: null, status: 'active', grantedAt: now, revokedAt: null });
        const r = await replicateMemoryToPeer(peerInfo(B), agentGaii, 'realfed.shared', A.config, A.storage);
        assert(r.success === true, `replication: ${JSON.stringify(r)}`);
        const replica = await B.storage.getMemory(agentGaii, `replica:${A_ID}:realfed.shared`);
        assert((replica?.value as { shared?: string } | undefined)?.shared === 'yes', `the replica on B: ${JSON.stringify(replica)}`);
    });

    await test('a heartbeat cycle reaches B, which accepts the signed ping and stamps when it last saw A', async () => {
        const seenByB = async () => (await B.storage.listFederationPeers()).find(p => p.nodeId === A_ID)?.lastSeen ?? '';
        const before = await seenByB();
        await new Promise(r => setTimeout(r, 20));
        const peers = new Map<string, PeerInfo>([[B_ID, peerInfo(B, { lastSeen: '2026-01-01T00:00:00.000Z' })]]);
        await runHeartbeatCycle(A.config, A.storage, peers, undefined, { everyPeer: true });
        const b = peers.get(B_ID)!;
        assert(b.status === 'active' && b.lastSeen > '2026-01-02', `A's view of B after the ping: ${JSON.stringify({ status: b.status, lastSeen: b.lastSeen })}`);
        // B saves the stamp without waiting for the write, so give it a moment.
        let after = await seenByB();
        for (let i = 0; i < 50 && !(after > before); i++) { await new Promise(r => setTimeout(r, 20)); after = await seenByB(); }
        assert(after > before, `B did not stamp A as seen: ${before} → ${after}`);
    });

    await test('a peer nothing answers at goes degraded after 3 failed cycles and offline after 10; a de-peered peer past its grace is purged', async () => {
        const dead = { ...peerInfo(B), nodeId: `aimeat-dead-${stamp}`, url: 'http://127.0.0.1:1' };
        const gone = { ...peerInfo(B), nodeId: `aimeat-gone-${stamp}`, status: 'depeering' as const, depeerGraceEnd: new Date(Date.now() - 1000).toISOString() };
        const peers = new Map<string, PeerInfo>([[dead.nodeId, dead], [gone.nodeId, gone as PeerInfo]]);
        // The dead peer's status after each cycle, and whether the de-peered one is still there.
        const statuses: string[] = [];
        let goneAfterFirst = true;
        for (let i = 1; i <= 10; i++) {
            await runHeartbeatCycle(A.config, A.storage, peers, undefined, { everyPeer: true });
            statuses.push(peers.get(dead.nodeId)!.status);
            if (i === 1) goneAfterFirst = !peers.has(gone.nodeId);
        }
        assert(goneAfterFirst, 'the de-peered peer past its grace was not purged by the first cycle');
        assert(JSON.stringify(statuses) === JSON.stringify(['active', 'active', 'degraded', 'degraded', 'degraded', 'degraded', 'degraded', 'degraded', 'degraded', 'offline']),
            `the dead peer after each cycle: ${JSON.stringify(statuses)}`);
    });
} finally {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
    void generateKeyPair;
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

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
 *       refuses it because a forwarding node holds no credential of B's, A answers 502 PEER_REFUSED
 *       with B's status (401) in details.peer_status, the 1-morsel routing fee comes back with a ledger line, and B holds no work item.
 *       The feature list's "Cross-node work and settlement" row states this limit.
 *     - The three outbound senders are accepted by a real receiver: catalogue sync lands A's federable
 *       action in B's catalogue, memory replication lands a replica of A's record on B, and a
 *       heartbeat cycle (runHeartbeatCycle) is accepted by B, which stamps when it last saw A, while
 *       a dead peer goes degraded after 3 failed cycles and offline after 10, and a de-peered peer
 *       past its grace is purged.
 *     - A replica does not outlive its retention bound or its source: B serves A's replica to
 *       anyone, B's retention sweep removes it once it is past the cache TTL although it sits under
 *       a principal of A, a record A deletes is taken back and stops being served at once, an
 *       unsigned retraction is refused, and a retraction signed by another peer removes nothing.
 *
 *   The two nodes run on the in-memory SQLite provider whatever the runner's backend is: what is under
 *   test is what crosses the wire, and the storage of both is the same code either way.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-two-real-nodes
 * @version-history
 *   2026-10-20 — The replica's retention and its retraction: B's cleanup cycle removes an aged replica
 *     that sits under a principal of A, POST /v1/federation/retract removes it at once when A deletes
 *     the record, an unsigned retraction is refused and one peer cannot take back another peer's copy
 *     (secaudit 2026-10, replica retention).
 *   2026-10-16 — Both directions of the window: B answers the unsigned service summary request from A
 *     while A's signed heartbeat names 4.0.2, and refuses it once A names 4.0.3 and from a peer of
 *     unknown version; a peer of unknown version that refuses the unsigned request is asked again
 *     signed and gets the signed form from then on (decision 2026-10-16).
 *   2026-10-16 — A's refusal is HTTP 502 with B's 401 in details.peer_status, on POST /v1/work/request and
 *     POST /v1/federation/cross-node/work; new: aimeat_action_execute over MCP names B, B's status and
 *     B's answer (decision 2026-10-16).
 *   2026-10-16 — The service summary request in the 4.0.4 window: unsigned to a peer on 4.0.2 and to one
 *     of unknown version, signed to a peer on 4.0.3, and B (a real node on this code) takes the signed
 *     one and refuses the unsigned one (decision 2026-10-16).
 *   2026-10-16 — Initial (QA audit F14b-01, F18-01, F18-03).
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServiceSummary } from '../src/utils/service-summary.js';
import { serviceSummaryForm, UNSIGNED_SERVICE_SUMMARY_REMOVED_IN } from '../src/config-federation.js';
import { audienceProof } from '../src/services/signed-node-request.js';
import { getSoftwareVersion, versionAtLeast } from '../src/utils/version.js';
import { sign, generateKeyPair } from '../src/auth/keypair.js';
import type { PeerInfo } from '../src/services/federation.js';
import { runHeartbeatCycle } from '../src/services/federation.js';
import { syncCatalogueToPeer } from '../src/services/catalogue-sync.js';
import { replicateMemoryToPeer, retractMemoryFromPeer } from '../src/services/memory-replication.js';
import { runCleanupCycle } from '../src/services/cache-cleanup.js';
import { bootNode, setupOperator, addPeer, auth, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { openSession, callTool } from './helpers/mcp-session.js';

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
        // 502, never B's 401: a client that signs out on any 401 would end its own session (decision 2026-10-16).
        assert(r.status === 502 && r.body.ok === false && r.body.error?.code === 'PEER_REFUSED', `answer: ${r.status} ${JSON.stringify(r.body)}`);
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
        assert(r.status === 502 && r.body.ok === false && r.body.error?.code === 'PEER_REFUSED' && r.body.error?.details?.routed_to === B_ID, `answer: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.details?.peer_status === 401, `B's own status is in details: ${JSON.stringify(r.body.error?.details)}`);
        assert(await walletOf(A, A.ownerToken) === before, 'the routing fee was kept');
        const onB = await B.storage.listWorkByProvider(providerGaii);
        assert(onB.length === 0, `B holds a work item: ${JSON.stringify(onB)}`);
    });

    await test('the same work asked over MCP (aimeat_action_execute): the tool says B refused it, with B\'s status and B\'s answer', async () => {
        const before = await walletOf(A, A.ownerToken);
        const s = await openSession(A.baseUrl, agentToken, 'e2e-two-real-nodes');
        const r = await callTool(s, 'aimeat_action_execute', { action_id: 'real-act', provider_gaii: providerGaii, input: { q: 'mcp' } });
        assert(r.isError && r.offered, `the tool must refuse: ${r.text}`);
        assert(r.text.startsWith('PEER_REFUSED: '), `the code comes first: ${r.text}`);
        assert(r.text.includes(`The other node (${B_ID}) refused it with HTTP 401`), `names B and B's status: ${r.text}`);
        assert(/and answered: [A-Z_]+/.test(r.text), `carries B's own answer: ${r.text}`);
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

    // ─── The replica's retention and its retraction (secaudit 2026-10) ───
    console.log('\nWhat happens to the replica on B when it ages, and when A takes it back');

    const REPLICA_KEY = `replica:${A_ID}:realfed.shared`;
    const replicaPath = `/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(REPLICA_KEY)}`;
    /** Put the record back on A and replicate it to B, so the next case has a copy to act on. */
    async function replicateAgain(value: unknown): Promise<void> {
        const now = new Date().toISOString();
        await A.storage.setMemory({ key: 'realfed.shared', ownerGaii: agentGaii, value, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
        const r = await replicateMemoryToPeer(peerInfo(B), agentGaii, 'realfed.shared', A.config, A.storage);
        assert(r.success === true, `replication: ${JSON.stringify(r)}`);
        assert(!!await B.storage.getMemory(agentGaii, REPLICA_KEY), 'the replica is not on B');
    }

    await test('B serves the replica to anyone, and its retention sweep removes it once it is past the cache TTL', async () => {
        const open = await B.json(replicaPath);
        assert(open.status === 200, `B does not serve the replica: ${open.status} ${JSON.stringify(open.body)}`);

        // Age it past the 168 h cache TTL. It sits under A's agent principal, which is in no agents
        // table on B, so the sweep that walked storage.listAgents() visited none of these rows and
        // the TTL never applied (secaudit 2026-10).
        const stored = await B.storage.getMemory(agentGaii, REPLICA_KEY);
        assert(!!stored, 'the replica is not on B');
        await B.storage.setMemory({ ...stored!, updatedAt: new Date(Date.now() - 30 * 24 * 3600_000).toISOString() });

        const swept = await runCleanupCycle(B.config, B.storage);
        assert(swept.replicaRemoved >= 1, `the sweep removed no replica: ${JSON.stringify(swept)}`);
        assert(!await B.storage.getMemory(agentGaii, REPLICA_KEY), 'the aged replica is still on B');
        const gone = await B.json(replicaPath);
        assert(gone.status === 404, `B still serves the aged replica: ${gone.status} ${JSON.stringify(gone.body)}`);
    });

    await test('a record A deletes is taken back from B, and the copy stops being served at once', async () => {
        await replicateAgain({ shared: 'again' });

        await A.storage.deleteMemory(agentGaii, 'realfed.shared');
        const r = await retractMemoryFromPeer(peerInfo(B), agentGaii, 'realfed.shared', 'deleted', A.config, A.storage);
        assert(r.success === true, `retraction: ${JSON.stringify(r)}`);
        assert(!await B.storage.getMemory(agentGaii, REPLICA_KEY), 'the replica outlived the record it copied');
        const gone = await B.json(replicaPath);
        assert(gone.status === 404, `B still serves the replica of a deleted record: ${gone.status} ${JSON.stringify(gone.body)}`);
    });

    await test('B refuses an unsigned retraction, and one peer cannot take back another peer\'s replica', async () => {
        await replicateAgain({ shared: 'third' });

        const unsigned = await B.json('/v1/federation/retract', {
            method: 'POST',
            body: JSON.stringify({ source_node: A_ID, gaii: agentGaii, key: 'realfed.shared', reason: 'deleted', timestamp: new Date().toISOString() }),
        });
        assert(unsigned.status === 401 && unsigned.body.error?.code === 'UNAUTHORIZED', `unsigned retraction: ${unsigned.status} ${JSON.stringify(unsigned.body)}`);
        assert(!!await B.storage.getMemory(agentGaii, REPLICA_KEY), 'an unsigned retraction removed the replica');

        // A third peer, with a key this suite holds, signs a well-formed retraction naming A's
        // record. The replica key is built from the node id the signature proved, so it reaches
        // nothing of A's (security DNA invariant 5).
        const other = `aimeat-other-${stamp}`;
        const kp = await generateKeyPair();
        await addPeer(B, other, 'http://127.0.0.1:1', kp.publicKey, { replicate_memory: true, tier: 'member' });
        const payload = { source_node: other, gaii: agentGaii, key: 'realfed.shared', reason: 'deleted', timestamp: new Date().toISOString() };
        const signedPayload = JSON.stringify(payload);
        const r = await B.json('/v1/federation/retract', {
            method: 'POST',
            body: JSON.stringify({
                ...payload,
                signature: await sign(kp.privateKey, signedPayload),
                ...await audienceProof(kp.privateKey, signedPayload, B_ID),
            }),
        });
        assert(r.status === 200 && r.body.data?.removed === 0, `another peer's retraction: ${r.status} ${JSON.stringify(r.body)}`);
        assert(!!await B.storage.getMemory(agentGaii, REPLICA_KEY), 'another peer took back A\'s replica');
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

    // THE ONE-RELEASE WINDOW FOR THE SIGNED SERVICE SUMMARY (decision 2026-10-16). Node 4.0.4 sends the
    // older form (x-source-node alone) to a peer whose signed heartbeat named 4.0.2 or older and to a
    // peer of unknown version, and the signed form to a newer one; from 4.0.5 every peer gets the signed
    // form. The expectation follows the version this node runs, so the test stays true past the window.
    const windowOpen = !versionAtLeast(getSoftwareVersion(), UNSIGNED_SERVICE_SUMMARY_REMOVED_IN);

    await test('the service summary request: unsigned to a peer on 4.0.2 and to one of unknown version, signed to a peer on 4.0.3', async () => {
        const seen = new Map<string, IncomingHttpHeaders>();
        const fake = createServer((req, res) => {
            const [, tag, ...rest] = (req.url ?? '').split('/');
            const path = '/' + rest.join('/');
            res.setHeader('Content-Type', 'application/json');
            if (path === '/v1/federation/ping') { res.end(JSON.stringify({ ok: true, data: { pong: true, service_summary_hash: `h-${tag}-${stamp}` } })); return; }
            if (path === '/v1/federation/service-summary') {
                seen.set(tag, req.headers);
                res.end(JSON.stringify({ ok: true, data: { actions: [], agents: [], boards: [], csms: [] } }));
                return;
            }
            res.statusCode = 404; res.end('{}');
        });
        await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
        servers.push(fake);
        const port = (fake.address() as AddressInfo).port;
        const peerAt = (tag: string, softwareVersion: string | null): PeerInfo =>
            ({ ...peerInfo(B), nodeId: `aimeat-${tag}-${stamp}`, url: `http://127.0.0.1:${port}/${tag}`, softwareVersion });
        const cases: Array<[string, string | null]> = [['old', '4.0.2'], ['unknown', null], ['new', '4.0.3']];
        const peers = new Map<string, PeerInfo>(cases.map(([tag, v]) => [`aimeat-${tag}-${stamp}`, peerAt(tag, v)]));
        const directory = new Map<string, ServiceSummary>();
        await runHeartbeatCycle(A.config, A.storage, peers, directory, { everyPeer: true });
        for (const [tag, v] of cases) {
            const h = seen.get(tag);
            assert(!!h, `no service summary request reached the ${tag} peer`);
            assert(h!['x-source-node'] === A_ID, `the ${tag} peer is told the sending node: ${JSON.stringify(h)}`);
            const expectSigned = windowOpen ? tag === 'new' : true;
            assert(serviceSummaryForm(v).form === (expectSigned ? 'signed' : 'unsigned'), `serviceSummaryForm disagrees for the ${tag} peer`);
            if (expectSigned) {
                assert(typeof h!['x-signature'] === 'string' && h!['x-audience'] === `aimeat-${tag}-${stamp}`,
                    `the ${tag} peer gets the signed form, for it: ${JSON.stringify(h)}`);
            } else {
                assert(h!['x-signature'] === undefined && h!['x-timestamp'] === undefined && h!['x-audience'] === undefined,
                    `the ${tag} peer gets the unsigned form: ${JSON.stringify(h)}`);
            }
            assert(directory.has(`aimeat-${tag}-${stamp}`), `the ${tag} peer's summary is in the network directory`);
        }
    });

    await test('a peer of unknown version that refuses the unsigned request is asked again signed, and gets the signed form from then on', async () => {
        const asked: Array<'signed' | 'unsigned'> = [];
        let round = 0;
        const strict = createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            if ((req.url ?? '').endsWith('/v1/federation/ping')) { round++; res.end(JSON.stringify({ ok: true, data: { pong: true, service_summary_hash: `strict-${round}-${stamp}` } })); return; }
            if ((req.url ?? '').endsWith('/v1/federation/service-summary')) {
                const signed = typeof req.headers['x-signature'] === 'string';
                asked.push(signed ? 'signed' : 'unsigned');
                if (!signed) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED' } })); return; }
                res.end(JSON.stringify({ ok: true, data: { actions: [], agents: [], boards: [], csms: [] } }));
                return;
            }
            res.statusCode = 404; res.end('{}');
        });
        await new Promise<void>(r => strict.listen(0, '127.0.0.1', () => r()));
        servers.push(strict);
        const id = `aimeat-strict-${stamp}`;
        const peers = new Map<string, PeerInfo>([[id, { ...peerInfo(B), nodeId: id, url: `http://127.0.0.1:${(strict.address() as AddressInfo).port}`, softwareVersion: null }]]);
        const directory = new Map<string, ServiceSummary>();
        await runHeartbeatCycle(A.config, A.storage, peers, directory, { everyPeer: true });
        const first = windowOpen ? ['unsigned', 'signed'] : ['signed'];
        assert(JSON.stringify(asked) === JSON.stringify(first), `first round: ${JSON.stringify(asked)}, expected ${JSON.stringify(first)}`);
        assert(directory.has(id), 'the summary taken on the signed retry is in the directory');
        await runHeartbeatCycle(A.config, A.storage, peers, directory, { everyPeer: true });
        assert(JSON.stringify(asked.slice(first.length)) === JSON.stringify(['signed']),
            `the next round goes signed at once: ${JSON.stringify(asked)}`);
    });

    await test('B, a node on this code, takes A\'s request when A does not know B\'s version (the signed retry)', async () => {
        const directory = new Map<string, ServiceSummary>();
        await runHeartbeatCycle(A.config, A.storage, new Map([[B_ID, peerInfo(B, { softwareVersion: null })]]), directory, { everyPeer: true });
        assert(directory.has(B_ID), 'B is not in A\'s directory after one round');
    });

    // THE RECEIVING SIDE OF THE WINDOW. The version B goes by is the one A names in its own signed
    // heartbeat, sent here by hand so it can name 4.0.2; never anything the summary request says.
    const pingBAs = async (softwareVersion: string): Promise<void> => {
        const payload = { node_id: A_ID, timestamp: new Date().toISOString(), version: 'v1', software_version: softwareVersion, stats: { uptime_hours: 1 } };
        const signed = JSON.stringify(payload);
        const r = await B.json('/v1/federation/ping', {
            method: 'POST',
            body: JSON.stringify({ ...payload, signature: await sign(A.nodeKey.privateKey, signed), ...await audienceProof(A.nodeKey.privateKey, signed, B_ID) }),
        });
        assert(r.status === 200, `signed heartbeat to B: ${r.status} ${JSON.stringify(r.body)}`);
    };
    const unsignedFrom = (nodeId: string, extra: Record<string, string> = {}) =>
        B.json('/v1/federation/service-summary', { headers: { 'x-source-node': nodeId, ...extra } });

    await test('B answers A\'s unsigned service summary request while A\'s signed heartbeat names 4.0.2, and refuses it once A names 4.0.3', async () => {
        await pingBAs('4.0.2');
        const old = await unsignedFrom(A_ID);
        if (windowOpen) assert(old.status === 200 && old.body.ok === true, `an old peer is answered unsigned in the window: ${old.status} ${JSON.stringify(old.body)}`);
        else assert(old.status === 401, `after the window an old peer is refused unsigned: ${old.status}`);
        await pingBAs('4.0.3');
        const fresh = await unsignedFrom(A_ID);
        assert(fresh.status === 401 && fresh.body.error?.code === 'UNAUTHORIZED', `a peer on 4.0.3 is refused unsigned: ${fresh.status} ${JSON.stringify(fresh.body)}`);
    });

    await test('B refuses the unsigned request from a peer whose version it has not heard, whatever the request says about itself', async () => {
        const quiet = `aimeat-quiet-${stamp}`;
        const key = await generateKeyPair();
        await addPeer(B, quiet, 'http://127.0.0.1:1', key.publicKey, { allow_routing: true, share_catalogue: true, tier: 'member' });
        const r = await unsignedFrom(quiet, { 'x-software-version': '4.0.2', 'user-agent': 'aimeat/4.0.2' });
        assert(r.status === 401 && r.body.error?.code === 'UNAUTHORIZED', `unknown version is refused unsigned: ${r.status} ${JSON.stringify(r.body)}`);
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

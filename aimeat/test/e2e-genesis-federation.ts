/**
 * @file test/e2e-genesis-federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-federation "genesis" end to end: the operator's peering CRUD, the aggregated
 *   cross-catalogue and its four filters, the signed ingest door and its four refusals, cross-genesis
 *   memory read in both directions, prefix subscriptions, network stats, organism reputation, and the
 *   background sync service driven by hand.
 *
 *   WHY IT HAD NEVER BEEN TESTED. A genesis peer is another FEDERATION, not another node, so every
 *   one of these paths needs a second world that answers four doors and signs with a key this node
 *   pinned. Nothing stood one up, so 525 of 765 lines in src/routes/federation-genesis.ts and 322 of
 *   466 in src/services/genesis-sync.ts had never been executed: half of genesis-sync's functions,
 *   the whole of genesis-memory-cache.ts, and the four matches* predicates in federation-helpers.ts.
 *   test/helpers/fake-genesis-peer.ts is that second world, on loopback inside this process.
 *
 *   IT BOOTS ITS OWN NODE IN PROCESS on :40321 with its own SQLite file in a temp directory, the
 *   pattern of e2e-mail-connections. 40321 rather than 40320 because e2e-setup-and-verification.ts
 *   already defaults its second node to 40320.
 *
 *   CROSS-FEDERATION IS OFF AT BOOT AND ON AFTERWARDS. The node's own genesis sync scheduler fires
 *   its first cycle 30 seconds after start, which would reach the fake federation in the middle of
 *   the assertions and move the very memory they read. So the node boots with the flag off, which
 *   starts no scheduler and changes no route, and the flag is turned on afterwards for the sync
 *   service this suite constructs and calls itself.
 * @structure Phase 0 boot (env, node, fake federation, operator, agent, a CSM and an action) ·
 *   1 peering CRUD and the ceiling · 2 the pending list and approval · 3 signed ingest and its
 *   refusals · 4 the cross-catalogue's four sources and its filters · 5 prefix subscriptions ·
 *   6 cross-genesis memory read outbound, with the cache · 7 the same door answering a peer, behind
 *   consent · 8 network stats and organism reputation · 9 the sync service · 10 suspend, delete,
 *   the 404s and the denials
 * @usage cd aimeat && node --import tsx test/e2e-genesis-federation.ts
 * @version-history
 *   v1.1.0 — 2026-09-08 — The prune, the cross-catalogue id and stop() tests assert the fixes made
 *     the same day instead of pinning the defects.
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = parseInt(process.env.E2E_GENESIS_PORT ?? '40321', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-genesis-e2e-'));

// Every one of these is read by loadConfig below, so they are set BEFORE it is called.
// AIMEAT_DEV_MODE is what lets validateOutboundUrl pass loopback, so the fake federation is
// reachable and the request that arrives is the request the node actually built.
Object.assign(process.env, {
    AIMEAT_PORT: String(PORT),
    AIMEAT_NODE_ID: 'aimeat-local-001-dev',
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ANONYMOUS_MODE: 'true',
    AIMEAT_LOG_LEVEL: 'error',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
    AIMEAT_STORAGE: 'sqlite',
    AIMEAT_DB: 'sqlite',
    AIMEAT_DB_PATH: join(TMP, 'genesis.db'),
    AIMEAT_SQLITE_PATH: join(TMP, 'genesis.db'),
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    // Off at boot: see the header. Turned on below, after the server is up.
    AIMEAT_CROSS_FEDERATION_ENABLED: 'false',
    AIMEAT_GENESIS_MEMORY_CACHE: 'true',
    AIMEAT_FEDERATION_TIMEOUT_MS: '4000',
    AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
    AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url'),
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '200',
    AIMEAT_LOGIN_RATE_LIMIT_MAX: '200',
    AIMEAT_RL_GLOBAL: '10000',
    AIMEAT_RL_AUTH: '1000',
    AIMEAT_RL_MEMORY: '1000',
    AIMEAT_RL_WORK: '1000',
});

const { createServer: createNode } = await import('../src/server.js');
const { loadConfig } = await import('../src/config.js');
const { createGenesisSyncService } = await import('../src/services/genesis-sync.js');
const { startFakeGenesisPeer } = await import('./helpers/fake-genesis-peer.js');
type GenesisSyncService = import('../src/services/genesis-sync.js').GenesisSyncService;
type FakeGenesisPeer = import('./helpers/fake-genesis-peer.js').FakeGenesisPeer;

const { config } = loadConfig({});
config.port = PORT;
const NODE_ID = config.nodeId;
const { app, storage } = await createNode(config);
await (storage as { ready?: Promise<unknown> }).ready;
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

// The node is up and its background scheduler was never started. From here the flag is on, which is
// what createGenesisSyncService below requires; no mounted route reads it.
config.crossFederationEnabled = true;
config.genesisMemoryCache = true;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register an owner and return a token for it. The FIRST owner on a fresh node is the operator. */
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

/** An agent of `ownerName` holding exactly these scopes, with its GAII and a token. */
async function registerAgent(ownerName: string, ownerToken: string, name: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner: ownerName, display_name: name, capabilities: ['memory'], scopes }),
    });
    assert(created.status === 201, `agent ${name}: ${created.status} ${JSON.stringify(created.body?.error)}`);
    const gaii = created.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(created.body.data.private_key as string, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

/** The keys of every genesis memory record filed under one peer, straight from the store. */
async function genesisKeys(peerNodeId: string): Promise<string[]> {
    const rows = await storage.listMemory('__genesis__', { prefix: `genesis:${peerNodeId}:` });
    return rows.map(r => r.key).sort();
}

// ─── State ───
const stamp = Date.now().toString(36);
const operatorName = `genop${stamp}`;
const strangerName = `genstranger${stamp}`;
const REMOTE_NODE = `aimeat-remote-001-${stamp}`;
const PROBE_KEY = 'peer.kelp.note';
const AGENT_KEY = 'note.shared';
const FEDERATED_SOURCE = `aimeat-fedtag-001-${stamp}`;

let operatorToken = '';
let strangerToken = '';
let agentGaii = '';
let agentToken = '';
let narrowAgentToken = '';
let peerId = '';
let csmName = '';
let organismId = '';
let peer: FakeGenesisPeer | null = null;
let syncService: GenesisSyncService | null = null;
const fillerPeerIds: string[] = [];

async function cleanup(): Promise<void> {
    try { syncService?.stop(); } catch { /* the service may never have been built */ }
    try { server.close(); } catch { /* already down */ }
    if (peer) { await peer.close(); peer = null; }
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows may still hold the file */ }
}

console.log('\n=== Genesis federation: peering, catalogue, cross-genesis memory and sync ===\n');

async function run(): Promise<void> {
    // ─── Phase 0: Setup ───
    console.log('Phase 0 — Setup');

    await test('the first owner is the node operator, and a second owner is not', async () => {
        operatorToken = await registerOwner(operatorName);
        const roles = JSON.parse(Buffer.from(operatorToken.split('.')[1], 'base64url').toString()).roles ?? [];
        assert(roles.includes('operator'),
            `the genesis routes are operator-only and this owner is not one (${JSON.stringify(roles)})`);
        strangerToken = await registerOwner(strangerName);
        const strangerRoles = JSON.parse(Buffer.from(strangerToken.split('.')[1], 'base64url').toString()).roles ?? [];
        assert(!strangerRoles.includes('operator'), `the second owner must not be an operator: ${JSON.stringify(strangerRoles)}`);
    });

    await test('an agent holding memory, consent and publish rights, and one holding almost none', async () => {
        const full = await registerAgent(operatorName, operatorToken, 'genesisbot',
            ['memory:read', 'memory:write', 'consent:manage', 'work:publish']);
        agentGaii = full.gaii;
        agentToken = full.token;
        const narrow = await registerAgent(operatorName, operatorToken, 'genesisnarrow', ['memory:write']);
        narrowAgentToken = narrow.token;
        assert(agentGaii.startsWith('genesisbot#') && agentToken.length > 0 && narrowAgentToken.length > 0,
            `both agents must exist and hold a token: ${agentGaii}`);
    });

    await test('another federation answers on loopback', async () => {
        peer = await startFakeGenesisPeer(REMOTE_NODE);
        const probe = await fetch(`${peer.url}/v1/nothing`);
        assert(probe.status === 404, `the fake federation must be up and answering, got ${probe.status}`);
    });

    await test('a federable CSM and a federated-tagged action exist locally', async () => {
        const tmpl = await fetch(`${BASE}/v1/csm/templates/hobby-directory`);
        assert(tmpl.status === 200, `template fetch ${tmpl.status}`);
        csmName = `Kelp Directory ${stamp}`;
        const yaml = (await tmpl.text()).replace('"Harrastehakemisto"', JSON.stringify(csmName));
        const reg = await json('/v1/csm', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ yaml, federate: true }),
        });
        assert(reg.status === 201, `csm: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
        assert(reg.body.data.csm.federate === true, `the CSM must be federable: ${JSON.stringify(reg.body.data.csm)}`);

        // An action is published by an external principal, never by the owner session, so this one
        // comes from the agent minted above.
        const act = await json('/v1/actions', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({
                id: `genesis-scraper-${stamp}`,
                display_name: 'Genesis Remote Scraper',
                description: 'Reads a remote page and returns its text',
                category: 'data',
                input_schema: { type: 'object', properties: { url: { type: 'string' } } },
                output_schema: { type: 'object', properties: { content: { type: 'string' } } },
                pricing: { base_morsels: 0 },
                tags: [`federated:${FEDERATED_SOURCE}`, 'kelp'],
            }),
        });
        assert(act.status === 201, `action: ${act.status} ${JSON.stringify(act.body?.error)}`);
    });

    // ─── Phase 1: Peering CRUD ───
    console.log('\nPhase 1 — Genesis peering');

    await test('POST /v1/federation/genesis-peer — a peering is requested and starts pending', async () => {
        const { status, body } = await json('/v1/federation/genesis-peer', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ genesisNodeId: REMOTE_NODE, genesisUrl: peer!.url, publicKey: peer!.publicKey }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.peer.status === 'pending', `a fresh peering is pending: ${body.data.peer.status}`);
        assert(body.data.peer.genesisNodeId === REMOTE_NODE, `node id: ${body.data.peer.genesisNodeId}`);
        assert(body.data.semantic['schema:memberOf'] === 'aimeat:CrossFederation',
            `the answer carries the cross-federation annotation: ${JSON.stringify(body.data.semantic)}`);
        peerId = body.data.peer.id;
    });

    await test('a second peering with the SAME genesis node is refused', async () => {
        const { status, body } = await json('/v1/federation/genesis-peer', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ genesisNodeId: REMOTE_NODE, genesisUrl: peer!.url, publicKey: peer!.publicKey }),
        });
        assert(status === 409, `status ${status}: ${JSON.stringify(body)}`);
        assert(String(body.error?.message ?? '').includes('Peering already exists'),
            `message: ${JSON.stringify(body.error)}`);
    });

    await test('the request is refused without genesisNodeId, genesisUrl or publicKey', async () => {
        for (const partial of [{}, { genesisNodeId: 'x' }, { genesisNodeId: 'x', genesisUrl: 'http://127.0.0.1:1' }]) {
            const { status, body } = await json('/v1/federation/genesis-peer', {
                method: 'POST', headers: auth(operatorToken), body: JSON.stringify(partial),
            });
            assert(status === 400 && body.error?.code === 'VALIDATION_ERROR',
                `${JSON.stringify(partial)} → ${status} ${JSON.stringify(body.error)}`);
        }
    });

    await test('the eleventh peering hits the ceiling of ten', async () => {
        assert(config.maxGenesisPeers === 10, `this assertion is written against a ceiling of 10, config says ${config.maxGenesisPeers}`);
        for (let i = 0; i < 9; i++) {
            const { status, body } = await json('/v1/federation/genesis-peer', {
                method: 'POST', headers: auth(operatorToken),
                body: JSON.stringify({ genesisNodeId: `aimeat-filler-${i}-${stamp}`, genesisUrl: `http://127.0.0.1:${9000 + i}`, publicKey: 'ZmlsbGVy' }),
            });
            assert(status === 201, `filler ${i}: ${status} ${JSON.stringify(body?.error)}`);
            fillerPeerIds.push(body.data.peer.id);
        }
        const over = await json('/v1/federation/genesis-peer', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ genesisNodeId: `aimeat-eleventh-${stamp}`, genesisUrl: 'http://127.0.0.1:9099', publicKey: 'ZWxldmVudGg=' }),
        });
        assert(over.status === 409, `the eleventh must be refused, got ${over.status}: ${JSON.stringify(over.body)}`);
        assert(String(over.body.error?.message ?? '').includes('Maximum genesis peers reached'),
            `message: ${JSON.stringify(over.body.error)}`);
    });

    await test('the fillers are removed again, and one of them twice is a 404', async () => {
        for (const id of fillerPeerIds) {
            const { status, body } = await json(`/v1/federation/genesis-peer/${id}`, { method: 'DELETE', headers: auth(operatorToken) });
            assert(status === 200 && body.data.removed === true, `delete ${id}: ${status} ${JSON.stringify(body)}`);
        }
        const again = await json(`/v1/federation/genesis-peer/${fillerPeerIds[0]}`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(again.status === 404 && again.body.error?.code === 'NOT_FOUND', `second delete: ${again.status} ${JSON.stringify(again.body)}`);
    });

    // ─── Phase 2: The pending list and approval ───
    console.log('\nPhase 2 — Listing and approval');

    await test('GET /v1/federation/genesis-peers?status=pending shows the one that is left', async () => {
        const pending = await json('/v1/federation/genesis-peers?status=pending', { headers: auth(operatorToken) });
        assert(pending.status === 200, `status ${pending.status}: ${JSON.stringify(pending.body)}`);
        assert(pending.body.data.total === 1, `exactly one peering is pending, got ${pending.body.data.total}`);
        assert(pending.body.data.peers[0].genesisNodeId === REMOTE_NODE, `node id: ${pending.body.data.peers[0].genesisNodeId}`);
        const active = await json('/v1/federation/genesis-peers?status=active', { headers: auth(operatorToken) });
        assert(active.body.data.total === 0, `nothing is active yet, got ${active.body.data.total}`);
    });

    await test('the ingest door refuses a peer that is registered but NOT active', async () => {
        const payload = { source_node: REMOTE_NODE, entries: [], csms: [], catalogue_hash: 'h0' };
        const signature = await peer!.sign(JSON.stringify(payload));
        const { status, body } = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify({ ...payload, signature }),
        });
        assert(status === 403 && body.error?.code === 'FORBIDDEN',
            `a pending peering must not be able to write into the catalogue: ${status} ${JSON.stringify(body)}`);
    });

    await test('PUT /v1/federation/genesis-peer/:id/approve makes it active', async () => {
        const { status, body } = await json(`/v1/federation/genesis-peer/${peerId}/approve`, {
            method: 'PUT', headers: auth(operatorToken),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.peer.status === 'active', `status: ${body.data.peer.status}`);
    });

    // ─── Phase 3: Signed catalogue ingest ───
    console.log('\nPhase 3 — Signed catalogue ingest');

    const INGEST_ENTRIES = [
        { id: 'remote-kelp-1', type: 'action', display_name: 'Kelp Harvest Report', description: 'Weekly kelp yield', category: 'data', location: 'Turku' },
        { id: 'remote-tide-1', type: 'action', display_name: 'Tide Table', description: 'Tides for the week', category: 'data', location: 'Bergen' },
    ];
    const INGEST_CSMS = [{ name: 'remote-weather-csm', service_type: 'weather' }];
    const INGEST_HASH = 'remote-catalogue-hash-ingest';

    await test('POST /v1/federation/genesis-catalogue-ingest stores a signed catalogue as __genesis__ memory', async () => {
        // The key ORDER is the contract: the node rebuilds the payload as
        // {source_node, entries, csms, catalogue_hash} and verifies that exact string.
        const payload = { source_node: REMOTE_NODE, entries: INGEST_ENTRIES, csms: INGEST_CSMS, catalogue_hash: INGEST_HASH };
        const signature = await peer!.sign(JSON.stringify(payload));
        const { status, body } = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify({ ...payload, signature }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.stored === 3, `two entries and one CSM were stored, got ${body.data.stored}`);
        assert(body.data.catalogue_hash === INGEST_HASH, `hash: ${body.data.catalogue_hash}`);

        const keys = await genesisKeys(REMOTE_NODE);
        assert(keys.join(',') === [`genesis:${REMOTE_NODE}:remote-kelp-1`, `genesis:${REMOTE_NODE}:remote-tide-1`, `genesis:${REMOTE_NODE}:remote-weather-csm`].sort().join(','),
            `the keys are addressed by peer and entry id, got ${JSON.stringify(keys)}`);
        const one = await storage.getMemory('__genesis__', `genesis:${REMOTE_NODE}:remote-kelp-1`);
        assert(one?.visibility === 'public', `an ingested entry is public: ${one?.visibility}`);
        assert((one?.value as any)?.source_genesis === REMOTE_NODE, `it records which federation sent it: ${JSON.stringify(one?.value)}`);
        assert(one?.tags.includes('genesis') && one.tags.includes(`genesis:${REMOTE_NODE}`), `tags: ${JSON.stringify(one?.tags)}`);
    });

    await test('…and the peering now carries the sync stamp the ingest left', async () => {
        const list = await json('/v1/federation/genesis-peers', { headers: auth(operatorToken) });
        const row = list.body.data.peers.find((p: any) => p.genesisNodeId === REMOTE_NODE);
        assert(row?.catalogueHash === INGEST_HASH, `catalogue hash on the peering: ${JSON.stringify(row?.catalogueHash)}`);
    });

    await test('ingest refuses: no source_node, an unknown one, no signature, a wrong signature', async () => {
        const payload = { source_node: REMOTE_NODE, entries: INGEST_ENTRIES, csms: INGEST_CSMS, catalogue_hash: INGEST_HASH };
        const good = await peer!.sign(JSON.stringify(payload));

        const noSource = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify({ entries: [], csms: [], catalogue_hash: 'x', signature: good }),
        });
        assert(noSource.status === 400 && noSource.body.error?.code === 'INVALID_INPUT',
            `no source_node: ${noSource.status} ${JSON.stringify(noSource.body.error)}`);

        const unknown = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify({ ...payload, source_node: `aimeat-nobody-${stamp}`, signature: good }),
        });
        assert(unknown.status === 403 && unknown.body.error?.code === 'FORBIDDEN',
            `unknown source_node: ${unknown.status} ${JSON.stringify(unknown.body.error)}`);

        // The July F-series audit: this gate read `if (signature && ...)`, so omitting the field
        // skipped verification and wrote straight into the catalogue this node serves publicly.
        const unsigned = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify(payload),
        });
        assert(unsigned.status === 401 && unsigned.body.error?.code === 'UNAUTHORIZED',
            `no signature: ${unsigned.status} ${JSON.stringify(unsigned.body.error)}`);

        const tamperedSig = await peer!.sign(JSON.stringify({ ...payload, catalogue_hash: 'something-else' }));
        const wrong = await json('/v1/federation/genesis-catalogue-ingest', {
            method: 'POST', body: JSON.stringify({ ...payload, signature: tamperedSig }),
        });
        assert(wrong.status === 401 && wrong.body.error?.code === 'UNAUTHORIZED',
            `wrong signature: ${wrong.status} ${JSON.stringify(wrong.body.error)}`);

        const keys = await genesisKeys(REMOTE_NODE);
        assert(keys.length === 3, `not one refusal may have written anything, the store still holds ${keys.length} entries`);
    });

    // ─── Phase 4: The cross-catalogue ───
    console.log('\nPhase 4 — The cross-catalogue');

    await test('GET /v1/federation/cross-catalogue aggregates local, federated and genesis', async () => {
        const { status, body } = await json('/v1/federation/cross-catalogue');
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const types = new Set(body.data.entries.map((e: any) => e.source_type));
        assert(types.has('local') && types.has('federated') && types.has('genesis'),
            `all three sources must appear, got ${JSON.stringify([...types])}`);
        assert(body.data.total === body.data.entries.length, `total: ${body.data.total} vs ${body.data.entries.length}`);
        assert(typeof body.data.catalogue_hash === 'string' && body.data.catalogue_hash.length > 0,
            `a catalogue hash is computed: ${JSON.stringify(body.data.catalogue_hash)}`);
        const peerRow = body.data.genesis_peers.find((p: any) => p.node_id === REMOTE_NODE);
        assert(peerRow?.status === 'active', `the active peering is summarised: ${JSON.stringify(body.data.genesis_peers)}`);
    });

    await test('?source=genesis returns exactly the ingested entries', async () => {
        const { body } = await json('/v1/federation/cross-catalogue?source=genesis');
        assert(body.data.entries.length === 3, `three genesis entries, got ${body.data.entries.length}`);
        assert(body.data.entries.every((e: any) => e.source_type === 'genesis'), 'every entry is a genesis entry');
        // The `id` is the memory key, which carries the federation, and the remote entry's own id
        // is kept as remote_id. Until 2026-09-08 the stored value was spread over the handler's
        // fields, so two federations sending the same entry id were indistinguishable here.
        const kelp = body.data.entries.find((e: any) => e.id === `genesis:${REMOTE_NODE}:remote-kelp-1`);
        assert(kelp?.remote_id === 'remote-kelp-1', `the remote id survives as remote_id: ${JSON.stringify(kelp)}`);
        assert(kelp?.source_genesis === REMOTE_NODE, `the entry names its federation: ${JSON.stringify(kelp)}`);
        assert(kelp?.source_type === 'genesis' && typeof kelp.ingested_at === 'string', `shape: ${JSON.stringify(kelp)}`);
        assert(body.data.filters.source === 'genesis', `the filter is echoed: ${JSON.stringify(body.data.filters)}`);
    });

    await test('?source=local returns the federable CSM and nothing else', async () => {
        const { body } = await json('/v1/federation/cross-catalogue?source=local');
        assert(body.data.entries.every((e: any) => e.source_type === 'local'), 'every entry is local');
        const mine = body.data.entries.find((e: any) => e.name === csmName);
        assert(mine?.type === 'csm' && mine.federated === true, `the federable CSM is listed: ${JSON.stringify(mine)}`);
    });

    await test('?source=federated returns the federated:*-tagged action, sourced to the tag', async () => {
        const { body } = await json('/v1/federation/cross-catalogue?source=federated');
        const mine = body.data.entries.find((e: any) => e.display_name === 'Genesis Remote Scraper');
        assert(!!mine, `the tagged action is listed: ${JSON.stringify(body.data.entries)}`);
        assert(mine.source_node === FEDERATED_SOURCE, `the source node comes from the tag, got ${mine.source_node}`);
        assert(mine.source_type === 'federated' && mine.pricing.base_morsels === 0, `shape: ${JSON.stringify(mine)}`);
    });

    await test('?source=network answers with the network directory, which is empty on a lone node', async () => {
        const { status, body } = await json('/v1/federation/cross-catalogue?source=network');
        assert(status === 200, `status ${status}`);
        assert(body.data.entries.every((e: any) => e.source_type === 'network'), `only network entries: ${JSON.stringify(body.data.entries)}`);
        assert(body.data.filters.source === 'network', `filter: ${JSON.stringify(body.data.filters)}`);
    });

    await test('?keyword= reaches all three matchers, and misses when nothing matches', async () => {
        // matchesGenesisKeyword — display_name on an ingested entry.
        const genesis = await json('/v1/federation/cross-catalogue?source=genesis&keyword=kelp');
        assert(genesis.body.data.entries.length === 1 && genesis.body.data.entries[0].display_name === 'Kelp Harvest Report',
            `genesis keyword: ${JSON.stringify(genesis.body.data.entries)}`);
        // matchesActionKeyword — displayName on the federated action.
        const federated = await json('/v1/federation/cross-catalogue?source=federated&keyword=scraper');
        assert(federated.body.data.entries.some((e: any) => e.display_name === 'Genesis Remote Scraper'),
            `action keyword: ${JSON.stringify(federated.body.data.entries)}`);
        // matchesKeyword — the CSM's own name.
        const local = await json(`/v1/federation/cross-catalogue?source=local&keyword=${encodeURIComponent(`Kelp Directory ${stamp}`)}`);
        assert(local.body.data.entries.some((e: any) => e.name === csmName), `csm keyword: ${JSON.stringify(local.body.data.entries)}`);
        const none = await json('/v1/federation/cross-catalogue?keyword=notathinganywhere');
        assert(none.body.data.entries.length === 0, `a keyword nothing carries returns nothing, got ${none.body.data.entries.length}`);
    });

    await test('?location= filters the genesis entries by where they say they are', async () => {
        const bergen = await json('/v1/federation/cross-catalogue?source=genesis&location=bergen');
        assert(bergen.body.data.entries.length === 1 && bergen.body.data.entries[0].display_name === 'Tide Table',
            `location: ${JSON.stringify(bergen.body.data.entries)}`);
        const nowhere = await json('/v1/federation/cross-catalogue?source=genesis&location=atlantis');
        assert(nowhere.body.data.entries.length === 0, `an unknown location returns nothing, got ${nowhere.body.data.entries.length}`);
    });

    await test('?service_type= filters a genesis entry on either of the two names it may carry', async () => {
        const weather = await json('/v1/federation/cross-catalogue?source=genesis&service_type=weather');
        assert(weather.body.data.entries.length === 1 && weather.body.data.entries[0].name === 'remote-weather-csm',
            `service_type on the CSM entry: ${JSON.stringify(weather.body.data.entries)}`);
        const data = await json('/v1/federation/cross-catalogue?source=genesis&service_type=data');
        assert(data.body.data.entries.length === 2, `category counts as the service type too, got ${data.body.data.entries.length}`);
    });

    await test('the cross-catalogue is public: no credential is needed', async () => {
        const { status } = await json('/v1/federation/cross-catalogue');
        assert(status === 200, `an anonymous read must work, got ${status}`);
    });

    // ─── Phase 5: Prefix subscriptions ───
    console.log('\nPhase 5 — Prefix subscriptions');

    await test('PUT then GET /v1/federation/genesis-peer/:id/subscriptions round-trips the prefixes', async () => {
        const put = await json(`/v1/federation/genesis-peer/${peerId}/subscriptions`, {
            method: 'PUT', headers: auth(operatorToken), body: JSON.stringify({ prefixes: ['note.'] }),
        });
        assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body)}`);
        assert(put.body.data.subscribed_prefixes.join(',') === 'note.', `put echo: ${JSON.stringify(put.body.data)}`);
        assert(put.body.data.peer_node_id === REMOTE_NODE, `peer node id: ${put.body.data.peer_node_id}`);

        const get = await json(`/v1/federation/genesis-peer/${peerId}/subscriptions`, { headers: auth(operatorToken) });
        assert(get.status === 200 && get.body.data.subscribed_prefixes.join(',') === 'note.',
            `get: ${get.status} ${JSON.stringify(get.body.data)}`);
    });

    await test('the subscription record is filed under __genesis__ and hidden from the catalogue', async () => {
        const rec = await storage.getMemory('__genesis__', `genesis:${REMOTE_NODE}:subscriptions`);
        assert(!!rec, 'the subscription is a memory record like everything else here');
        assert((rec!.value as any).prefixes.join(',') === 'note.', `value: ${JSON.stringify(rec!.value)}`);
        const cat = await json('/v1/federation/cross-catalogue?source=genesis');
        assert(cat.body.data.entries.length === 3,
            `the catalogue skips the :subscriptions key, so it is still three entries, got ${cat.body.data.entries.length}`);
    });

    await test('a subscription list that is not an array is refused, and an unknown peering is a 404', async () => {
        const bad = await json(`/v1/federation/genesis-peer/${peerId}/subscriptions`, {
            method: 'PUT', headers: auth(operatorToken), body: JSON.stringify({ prefixes: 'note.' }),
        });
        assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `not an array: ${bad.status} ${JSON.stringify(bad.body.error)}`);
        const ghost = randomUUID();
        const putGhost = await json(`/v1/federation/genesis-peer/${ghost}/subscriptions`, {
            method: 'PUT', headers: auth(operatorToken), body: JSON.stringify({ prefixes: [] }),
        });
        assert(putGhost.status === 404, `put on an unknown peering: ${putGhost.status}`);
        const getGhost = await json(`/v1/federation/genesis-peer/${ghost}/subscriptions`, { headers: auth(operatorToken) });
        assert(getGhost.status === 404, `get on an unknown peering: ${getGhost.status}`);
    });

    // ─── Phase 6: Cross-genesis memory read, outbound ───
    console.log('\nPhase 6 — Cross-genesis memory read (outbound)');

    await test('POST /v1/federation/genesis-memory-read fans out to the peer federation', async () => {
        peer!.memoryResults = [{
            key: PROBE_KEY,
            gaii: `kelp@${REMOTE_NODE}`,
            value: { depth_m: 12, note: 'kelp bed' },
            visibility: 'public',
            version: 1,
            source_node: REMOTE_NODE,
        }];
        const { status, body } = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ key: PROBE_KEY, target_scope: 'genesis' }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.from_cache === false, `the first read is not a cache hit: ${JSON.stringify(body.data)}`);
        assert(body.data.peers_queried === 1, `one federation was asked, got ${body.data.peers_queried}`);
        assert(body.data.total === 1 && body.data.results[0].key === PROBE_KEY, `results: ${JSON.stringify(body.data.results)}`);
        assert(body.data.results[0].source_genesis === REMOTE_NODE,
            `the answer is stamped with which federation gave it: ${JSON.stringify(body.data.results[0])}`);
        const asked = peer!.seen('GET', '/v1/federation/genesis-memory-read');
        assert(asked.length === 1 && asked[0].query.key === PROBE_KEY,
            `the far end was asked for the key by name: ${JSON.stringify(asked.map(a => a.query))}`);
    });

    await test('…and the second read is answered from the local cache without touching the peer', async () => {
        const { status, body } = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ key: PROBE_KEY, target_scope: 'genesis' }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.from_cache === true, `the second read must be a cache hit: ${JSON.stringify(body.data)}`);
        assert(body.data.peers_queried === 0 && body.data.results[0].cached === true, `shape: ${JSON.stringify(body.data)}`);
        assert(peer!.count('GET', '/v1/federation/genesis-memory-read') === 1,
            `the fake federation must still have been asked exactly once, got ${peer!.count('GET', '/v1/federation/genesis-memory-read')}`);
        // The cache is filed under the prefix the answering side refuses to re-export, which is the
        // whole reason genesis-memory-cache.ts exists as one module.
        const cached = await storage.getMemory('__genesis__', `genesis:${REMOTE_NODE}:${PROBE_KEY}`);
        assert(!!cached, `the cached answer is stored under genesis:{peer}:{key}, found nothing`);
    });

    await test('the read is refused with no target, and with a scope other than genesis', async () => {
        const noTarget = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ target_scope: 'genesis' }),
        });
        assert(noTarget.status === 400 && noTarget.body.error?.code === 'INVALID_INPUT',
            `no target: ${noTarget.status} ${JSON.stringify(noTarget.body.error)}`);
        const wrongScope = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ key: PROBE_KEY, target_scope: 'wrong' }),
        });
        assert(wrongScope.status === 400 && wrongScope.body.error?.code === 'INVALID_INPUT',
            `wrong scope: ${wrongScope.status} ${JSON.stringify(wrongScope.body.error)}`);
    });

    await test('reaching across the federation needs memory:read, and a credential at all', async () => {
        // v1.3.0, 2026-09-04: this door had requireAuth alone, so any principal carrying the account
        // name could make this node fan out one outbound request per active genesis peer.
        const narrow = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(narrowAgentToken),
            body: JSON.stringify({ key: PROBE_KEY, target_scope: 'genesis' }),
        });
        assert(narrow.status === 403, `an agent without memory:read must be refused, got ${narrow.status}: ${JSON.stringify(narrow.body)}`);
        const anon = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', body: JSON.stringify({ key: PROBE_KEY, target_scope: 'genesis' }),
        });
        assert(anon.status === 401, `anonymous: ${anon.status}`);
    });

    // ─── Phase 7: The same door, answering a peer ───
    console.log('\nPhase 7 — Cross-genesis memory read (answering)');

    await test('a public record with no federation consent is NOT handed to a peer', async () => {
        const write = await json('/v1/memory', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ key: AGENT_KEY, value: { kelp: 'notes', n: 3 }, visibility: 'public' }),
        });
        assert(write.status === 201, `write: ${write.status} ${JSON.stringify(write.body?.error)}`);
        const { status, body } = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&key=${encodeURIComponent(AGENT_KEY)}`);
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.total === 0,
            `without a federation consent the record stays home, got ${JSON.stringify(body.data.results)}`);
    });

    await test('…and with one, the same request returns it', async () => {
        const grant = await json('/v1/consent', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ data_pattern: 'note.*', recipient: '*', purpose: 'cross-federation reads', scope: 'federation' }),
        });
        assert(grant.status === 201, `consent: ${grant.status} ${JSON.stringify(grant.body?.error)}`);

        const { body } = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&key=${encodeURIComponent(AGENT_KEY)}`);
        assert(body.data.total === 1, `the consented record is returned, got ${JSON.stringify(body.data)}`);
        const row = body.data.results[0];
        assert(row.key === AGENT_KEY && row.gaii === agentGaii && row.visibility === 'public', `shape: ${JSON.stringify(row)}`);
        assert(row.source_node === NODE_ID, `it names this node as the source, got ${row.source_node}`);
        assert(row.value.kelp === 'notes' && row.value.n === 3, `value: ${JSON.stringify(row.value)}`);
    });

    await test('a prefix read for one identity, and one across every identity, both answer', async () => {
        const one = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&prefix=note.`);
        assert(one.body.data.total === 1 && one.body.data.results[0].key === AGENT_KEY,
            `prefix for one identity: ${JSON.stringify(one.body.data)}`);
        const all = await json('/v1/federation/genesis-memory-read?prefix=note.');
        assert(all.body.data.results.some((r: any) => r.key === AGENT_KEY),
            `prefix across every identity: ${JSON.stringify(all.body.data)}`);
        assert(all.body.data.results.every((r: any) => !r.key.startsWith('genesis:')),
            `a cached or replicated copy is never re-exported: ${JSON.stringify(all.body.data.results.map((r: any) => r.key))}`);
    });

    await test('a private record is never handed over, and a request naming nothing is refused', async () => {
        const priv = await json('/v1/memory', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ key: 'note.private', value: { secret: true }, visibility: 'private' }),
        });
        assert(priv.status === 201, `private write: ${priv.status}`);
        const keyed = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&key=note.private`);
        assert(keyed.body.data.total === 0, `a private record must not cross: ${JSON.stringify(keyed.body.data)}`);
        const prefixed = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&prefix=note.`);
        assert(prefixed.body.data.results.every((r: any) => r.key !== 'note.private'),
            `nor through a prefix: ${JSON.stringify(prefixed.body.data.results.map((r: any) => r.key))}`);
        const empty = await json('/v1/federation/genesis-memory-read');
        assert(empty.status === 400 && empty.body.error?.code === 'INVALID_INPUT', `no argument: ${empty.status} ${JSON.stringify(empty.body.error)}`);
    });

    // ─── Phase 8: Stats and reputation ───
    console.log('\nPhase 8 — Network stats and organism reputation');

    await test('GET /v1/federation/network-stats counts the federation this node can reach', async () => {
        const { status, body } = await json('/v1/federation/network-stats');
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const s = body.data.stats;
        assert(s.localNode === NODE_ID, `local node: ${s.localNode}`);
        assert(s.totalGenesisPeers === 1 && s.activeGenesisPeers === 1, `peers: ${JSON.stringify(s)}`);
        assert(s.networkReach === 2, `reach is the active peers plus self, got ${s.networkReach}`);
        assert(s.localOwners >= 2 && s.localAgents >= 2, `local counts: ${JSON.stringify(s)}`);
    });

    await test('GET /v1/organisms/:id/reputation scores a real organism and 404s on a made-up one', async () => {
        const org = await json('/v1/organisms', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ name: `Kelp Circle ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }),
        });
        assert(org.status === 201, `organism: ${org.status} ${JSON.stringify(org.body?.error)}`);
        organismId = org.body.data.organism.id;

        const { status, body } = await json(`/v1/organisms/${organismId}/reputation`);
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(typeof body.data.reputation.score === 'number', `score: ${JSON.stringify(body.data.reputation)}`);
        assert(body.data.semantic['schema:ratingValue'] === body.data.reputation.score,
            `the rating annotation carries the score: ${JSON.stringify(body.data.semantic)}`);

        const ghost = await json(`/v1/organisms/${randomUUID()}/reputation`);
        assert(ghost.status === 404 && ghost.body.error?.code === 'NOT_FOUND', `unknown organism: ${ghost.status} ${JSON.stringify(ghost.body.error)}`);
    });

    // ─── Phase 9: The sync service ───
    console.log('\nPhase 9 — Genesis sync');

    await test('the sync service is built, and refuses to exist when cross-federation is off', async () => {
        config.crossFederationEnabled = false;
        assert(createGenesisSyncService(config, storage) === null, 'with the flag off there is no service');
        config.crossFederationEnabled = true;
        syncService = createGenesisSyncService(config, storage);
        assert(syncService !== null, 'with the flag on there is one');
    });

    await test('syncNow pulls the peer catalogue, stores it, and prunes what is no longer there', async () => {
        const before = await genesisKeys(REMOTE_NODE);
        assert(before.length === 5,
            `three ingested entries, one subscription record and one cached answer, got ${before.length}: ${JSON.stringify(before)}`);

        peer!.catalogueEntries = [{ id: 'sync-a', name: 'A' }, { id: 'sync-b', name: 'B' }, { id: 'sync-c', name: 'C' }];
        peer!.catalogueHash = 'remote-hash-run-a';
        const result = await syncService!.syncNow();

        assert(result.peersChecked === 1 && result.peersUpdated === 1 && result.peersFailed === 0, `tally: ${JSON.stringify(result)}`);
        assert(result.entriesFetched === 3 && result.entriesStored === 3, `fetched/stored: ${JSON.stringify(result)}`);
        // The three ingested entries are pruned; the subscription record and the cached answer share
        // the prefix and are not catalogue entries, so they stay (fixed 2026-09-08, see below).
        assert(result.entriesRemoved === 3,
            `the three catalogue entries not in the remote catalogue are pruned, got ${result.entriesRemoved}`);
        const after = await genesisKeys(REMOTE_NODE);
        assert(after.join(',') === ['sync-a', 'sync-b', 'sync-c', 'subscriptions', PROBE_KEY].map(i => `genesis:${REMOTE_NODE}:${i}`).sort().join(','),
            `the remote catalogue, the subscription record and the cache survive: ${JSON.stringify(after)}`);
        assert(peer!.count('GET', '/v1/federation/cross-catalogue') === 1, 'the peer catalogue was pulled once');
        assert(peer!.count('POST', '/v1/federation/genesis-catalogue-ingest') === 1, 'and the local catalogue was pushed back once');
    });

    await test('the prune leaves the operator\'s prefix subscriptions and the memory cache alone', async () => {
        // storeGenesisEntries prunes every catalogue key under `genesis:{peer}:` that the remote
        // catalogue did not name, and three different things live under that one prefix: the
        // ingested entries (which the prune is for), the operator's subscription record written by
        // PUT .../subscriptions, and the cross-genesis memory cache written by
        // genesis-memory-cache.ts. Until 2026-09-08 the prune took all three, so a subscription set
        // through the operator route survived exactly until the next sync, and syncSubscribedMemory,
        // which reads that record LATER IN THE SAME CYCLE, could never see one the operator set.
        // Fixed in services/genesis-sync.ts; this asserts the fix.
        const subs = await json(`/v1/federation/genesis-peer/${peerId}/subscriptions`, { headers: auth(operatorToken) });
        assert(subs.body.data.subscribed_prefixes.join(',') === 'note.',
            `the subscription set in phase 5 survives a sync: ${JSON.stringify(subs.body.data.subscribed_prefixes)}`);
        const cachedKeys = await genesisKeys(REMOTE_NODE);
        assert(cachedKeys.includes(`genesis:${REMOTE_NODE}:${PROBE_KEY}`),
            `and so does the cached peer answer: ${JSON.stringify(cachedKeys)}`);
    });

    await test('a shorter remote catalogue prunes the rest', async () => {
        peer!.catalogueEntries = [{ id: 'sync-a', name: 'A' }];
        const result = await syncService!.syncNow();
        assert(result.entriesFetched === 1 && result.entriesStored === 1 && result.entriesRemoved === 2,
            `one kept, two pruned: ${JSON.stringify(result)}`);
        const after = await genesisKeys(REMOTE_NODE);
        assert(after.join(',') === ['sync-a', 'subscriptions', PROBE_KEY].map(i => `genesis:${REMOTE_NODE}:${i}`).sort().join(','),
            `survivors: ${JSON.stringify(after)}`);
    });

    await test('a subscribed prefix pushes consented public memory to the peer federation', async () => {
        // The record syncSubscribedMemory reads is the operator's own, set through
        // PUT .../subscriptions in phase 5 and still standing after two syncs.
        const before = peer!.count('POST', '/v1/federation/replicate');
        const result = await syncService!.syncNow();
        assert(result.memorySubscriptionsSent === 1,
            `one consented public record under note. is pushed, got ${result.memorySubscriptionsSent}`);
        const sent = peer!.seen('POST', '/v1/federation/replicate');
        assert(sent.length === before + 1, `one replicate call: ${sent.length} vs ${before}`);
        const body = sent[sent.length - 1].body as any;
        assert(body.gaii === agentGaii && body.key === AGENT_KEY, `the pushed record: ${JSON.stringify(body)}`);
        assert(body.source_node === NODE_ID && body.source_genesis === NODE_ID, `provenance: ${JSON.stringify(body)}`);
        assert(typeof body.signature === 'string' && body.signature.length > 0,
            `the push must be signed with this node's key, got ${JSON.stringify(body.signature)}`);
        assert(body.value.kelp === 'notes', `value: ${JSON.stringify(body.value)}`);
    });

    await test('a peer that answers 404 on ingest is a graceful degradation, not a failure', async () => {
        peer!.ingestStatus = 404;
        const result = await syncService!.syncNow();
        assert(result.peersUpdated === 1 && result.peersFailed === 0,
            `a missing ingest door does not fail the sync: ${JSON.stringify(result)}`);
        peer!.ingestStatus = 500;
        const broken = await syncService!.syncNow();
        assert(broken.peersUpdated === 1 && broken.peersFailed === 0,
            `nor does a broken one, the pull half already succeeded: ${JSON.stringify(broken)}`);
        peer!.ingestStatus = 200;
    });

    await test('a peer nothing answers at, and one whose address is blocked, are both counted failed', async () => {
        const dead = await json('/v1/federation/genesis-peer', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ genesisNodeId: `aimeat-dead-${stamp}`, genesisUrl: 'http://127.0.0.1:1', publicKey: 'ZGVhZA==' }),
        });
        assert(dead.status === 201, `dead peering: ${dead.status}`);
        // 169.254.169.254 is the cloud metadata address: validateOutboundUrl refuses it whatever
        // AIMEAT_ALLOW_PRIVATE_EGRESS says, so this one never reaches a socket at all.
        const blocked = await json('/v1/federation/genesis-peer', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ genesisNodeId: `aimeat-blocked-${stamp}`, genesisUrl: 'http://169.254.169.254', publicKey: 'YmxvY2tlZA==' }),
        });
        assert(blocked.status === 201, `blocked peering: ${blocked.status}`);
        for (const id of [dead.body.data.peer.id, blocked.body.data.peer.id]) {
            const ok = await json(`/v1/federation/genesis-peer/${id}/approve`, { method: 'PUT', headers: auth(operatorToken) });
            assert(ok.status === 200, `approve ${id}: ${ok.status}`);
        }

        const result = await syncService!.syncNow();
        assert(result.peersChecked === 3, `three active federations: ${JSON.stringify(result)}`);
        assert(result.peersFailed === 2 && result.peersUpdated === 1,
            `two unreachable, one good: ${JSON.stringify(result)}`);

        for (const id of [dead.body.data.peer.id, blocked.body.data.peer.id]) {
            const del = await json(`/v1/federation/genesis-peer/${id}`, { method: 'DELETE', headers: auth(operatorToken) });
            assert(del.status === 200, `delete ${id}: ${del.status}`);
        }
    });

    await test('start() schedules, and stop() clears the recurring timer and the first one', async () => {
        // start() returns the INITIAL timer (a single sync 30 seconds after boot) and keeps the
        // recurring one to itself. Until 2026-09-08 stop() cleared only the recurring one, and
        // background-jobs.ts discards the returned handle, so the first sync could not be stopped;
        // it is why this suite never lets the node start its own scheduler. Fixed in
        // services/genesis-sync.ts: stop() clears both, which is what lets this process exit.
        const initial = syncService!.start();
        assert(typeof initial === 'object' && initial !== null, `start() hands back the initial timer: ${typeof initial}`);
        syncService!.stop();
        assert((initial as unknown as { _destroyed?: boolean })._destroyed === true,
            'stop() cleared the initial timer as well as the recurring one');
        syncService!.stop();
        const after = await syncService!.syncNow();
        assert(after.peersChecked >= 1, `a stopped service still syncs when asked: ${JSON.stringify(after)}`);
    });

    // ─── Phase 10: Suspension, removal, the 404s and the denials ───
    console.log('\nPhase 10 — Suspension, removal and the refusals');

    await test('PUT /v1/federation/genesis-peer/:id/suspend takes the federation out of the network', async () => {
        const { status, body } = await json(`/v1/federation/genesis-peer/${peerId}/suspend`, {
            method: 'PUT', headers: auth(operatorToken),
        });
        assert(status === 200 && body.data.peer.status === 'suspended', `suspend: ${status} ${JSON.stringify(body)}`);
        const stats = await json('/v1/federation/network-stats');
        assert(stats.body.data.stats.activeGenesisPeers === 0 && stats.body.data.stats.networkReach === 1,
            `a suspended federation is out of the reach count: ${JSON.stringify(stats.body.data.stats)}`);
        const read = await json('/v1/federation/genesis-memory-read', {
            method: 'POST', headers: auth(operatorToken),
            body: JSON.stringify({ key: 'anything', target_scope: 'genesis' }),
        });
        assert(read.body.data.total === 0 && read.body.data.peers_queried === 0,
            `and nothing is asked of it: ${JSON.stringify(read.body.data)}`);
    });

    await test('approve, suspend and delete all 404 on a peering that does not exist', async () => {
        const ghost = randomUUID();
        const approve = await json(`/v1/federation/genesis-peer/${ghost}/approve`, { method: 'PUT', headers: auth(operatorToken) });
        assert(approve.status === 404 && approve.body.error?.code === 'NOT_FOUND', `approve: ${approve.status}`);
        const suspend = await json(`/v1/federation/genesis-peer/${ghost}/suspend`, { method: 'PUT', headers: auth(operatorToken) });
        assert(suspend.status === 404 && suspend.body.error?.code === 'NOT_FOUND', `suspend: ${suspend.status}`);
        const del = await json(`/v1/federation/genesis-peer/${ghost}`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(del.status === 404 && del.body.error?.code === 'NOT_FOUND', `delete: ${del.status}`);
    });

    /** Every operator-only peering door, with a body where the route needs one. */
    const operatorDoors = (): Array<[string, string, unknown]> => [
        ['POST', '/v1/federation/genesis-peer', { genesisNodeId: 'x', genesisUrl: 'http://127.0.0.1:2', publicKey: 'eA==' }],
        ['GET', '/v1/federation/genesis-peers', undefined],
        ['PUT', `/v1/federation/genesis-peer/${peerId}/approve`, undefined],
        ['PUT', `/v1/federation/genesis-peer/${peerId}/suspend`, undefined],
        ['PUT', `/v1/federation/genesis-peer/${peerId}/subscriptions`, { prefixes: [] }],
        ['GET', `/v1/federation/genesis-peer/${peerId}/subscriptions`, undefined],
        ['DELETE', `/v1/federation/genesis-peer/${peerId}`, undefined],
    ];

    await test('an owner who is not the operator is refused on every peering door', async () => {
        for (const [method, path, body] of operatorDoors()) {
            const res = await json(path, { method, headers: auth(strangerToken), body: body ? JSON.stringify(body) : undefined });
            assert(res.status === 403, `${method} ${path} must refuse a non-operator, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
    });

    await test('…and every one of them refuses an anonymous caller first', async () => {
        for (const [method, path, body] of operatorDoors()) {
            const res = await json(path, { method, body: body ? JSON.stringify(body) : undefined });
            assert(res.status === 401, `${method} ${path} unauthenticated, got ${res.status}`);
        }
    });

    await test('DELETE /v1/federation/genesis-peer/:id removes the last peering', async () => {
        const { status, body } = await json(`/v1/federation/genesis-peer/${peerId}`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(status === 200 && body.data.removed === true, `delete: ${status} ${JSON.stringify(body)}`);
        const list = await json('/v1/federation/genesis-peers', { headers: auth(operatorToken) });
        assert(list.body.data.total === 0, `no peering is left, got ${list.body.data.total}`);
        const cat = await json('/v1/federation/cross-catalogue?source=genesis');
        assert(cat.body.data.genesis_peers.length === 0, `nor in the catalogue's peer summary: ${JSON.stringify(cat.body.data.genesis_peers)}`);
    });
}

try {
    await run();
} catch (err) {
    failed++;
    console.error('Suite crashed:', err);
} finally {
    await cleanup();
}

console.log(`\nGenesis federation E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
process.exit(failed > 0 ? 1 : 0);

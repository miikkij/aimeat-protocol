/**
 * @file test/e2e-federation-peer-bounds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bounds of what a linked or introducing node can do on this node, on two real nodes
 *   and a counting stand-in peer (secaudit2026oct26, round 8, federation group).
 *
 *   WHAT IT ASSERTS. Node H is the node under test, node P a real member peer of H, and F a stand-in
 *   peer on an ephemeral loopback port that counts the identity lookups it is asked.
 *     - Settlement: copies of one signed settlement that arrive together credit once (one 200, the
 *       rest 409 CONFLICT), and a single settlement credits once as before.
 *     - Resolve: an identity no node knows is asked of the peers once inside a short window, however
 *       many times it is resolved; a known identity and a node-hinted one resolve as before. An
 *       identity naming this node or a known unlisted peer asks nobody, and one with no known home
 *       reaches at most federation.resolve_max_peers peers.
 *     - Deactivated account: a member peer that holds a person's sign-in consent lists and writes
 *       their records while the account is active, is refused (403 ACCOUNT_DISABLED) while it is
 *       deactivated, and works again after reactivation with the consent untouched.
 *     - Invites: an invite that names no node does not silently replace a peer held under another key:
 *       it waits as a pending request, the operator is asked with Allow and Don't allow, the invite is
 *       used only on Allow, and the presenting node reads pending, then approved or rejected. An invite
 *       that names that node replaces it at once; an invite presented by another node is not used. A
 *       fresh node and an offline peer under its own key are admitted as before.
 *     - Introductions: a long message is stored bounded, a repeated introduction keeps one pending
 *       request, and the per-address hourly bound answers 429 with when to try again (0 is no limit).
 *       A request unanswered for 30 days expires (federation.peering_request_days, 0 never).
 *     - Own node id: no introduction, key exchange, approval or direct add makes a peer of this
 *       node's own id.
 *     - Replicas: a replica dated in the future is stored with the time it was received, an existing
 *       future-dated row is brought back to the present and then ages out, and an emergency removal
 *       of the peer removes its own people's replicas and turns a person's saved-home records into
 *       expiring copies, as the grace path does.
 *
 *   Nodes H and P boot in this process (test/helpers/federation-two-node.ts) in port blocks 30300 and
 *   30400 (test/helpers/free-port.ts).
 * @structure Setup · 1 settlement · 2 resolve · 3 deactivated account · 4 invites · 5 introductions ·
 *   6 own node id · 7 replicas
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-peer-bounds
 * @version-history
 *   v1.3.0 — 2026-10-29 — R4, R5: an identity that names this node or a known unlisted peer asks no
 *     peer, and one with no known home reaches at most federation.resolve_max_peers peers
 *     (secaudit2026oct26 round 8c, federation-03).
 *   v1.2.0 — 2026-10-29 — E1, E2: a peering request unanswered for federation.peering_request_days
 *     (30 by default, 0 never) is gone from the list, the decision and the status route
 *     (secaudit2026oct26 round 8c, federation-06).
 *   v1.1.0 — 2026-10-27 — A plain invite for a held id waits for the operator's one-press answer
 *     (V2, V2b, V2c) instead of a 409 (the coordinator's ruling).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26, round 8, federation group).
 */
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { audienceProof, deliveryProof } from '../src/services/signed-node-request.js';
import { buildHopSigningMessage } from '../src/types/route-manifest.js';
import { runCleanupCycle } from '../src/services/cache-cleanup.js';
import { bootNode, setupOperator, addPeer, auth, sleep, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const H_ID = `aimeat-bounds-h-${stamp}`;
const P_ID = `aimeat-bounds-p-${stamp}`;
const F_ID = `aimeat-bounds-f-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let H!: NodeState;
let P!: NodeState;
let pat!: RegisteredOwner;     // a person of H who lets P sign them in
let fake: { server: Server; url: string } | null = null;
const fakeAsked: string[] = [];
const KNOWN_ON_F = `known-${stamp}`;

/** Each signed request gets a timestamp of its own, so no two share a signature. */
let tick = 0;
const freshTs = () => new Date(Date.now() + tick++).toISOString();

/** A stand-in peer that counts identity lookups and knows one identity. */
function startCountingPeer(): Promise<{ server: Server; url: string }> {
    const server = http.createServer((req, res) => {
        const path = (req.url ?? '').split('?')[0];
        if (path.startsWith('/v1/agents/')) {
            const who = decodeURIComponent(path.slice('/v1/agents/'.length));
            fakeAsked.push(who);
            const known = who === KNOWN_ON_F;
            res.writeHead(known ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(known ? { ok: true, data: { agent: { gaii: who } } } : { ok: false, error: { code: 'NOT_FOUND' } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: {} }));
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
    });
}

/** POST /v1/federation/settle on H, signed by P as P's outbound route signs it. */
async function settlementBody(fields: { gaii: string; amount: number; tracking_code: string }, manifest = false): Promise<string> {
    const body = { from_node: P_ID, to_node: H_ID, gaii: fields.gaii, amount: fields.amount, tracking_code: fields.tracking_code, reason: 'work-settled', timestamp: freshTs() };
    const signature = await sign(P.nodeKey.privateKey, JSON.stringify(body));
    let route_manifest: unknown;
    if (manifest) {
        const received_at = new Date().toISOString();
        const hopSig = await sign(P.nodeKey.privateKey, buildHopSigningMessage(P_ID, received_at, H_ID, ''));
        route_manifest = { hops: [{ node_id: P_ID, received_at, forwarded_to: H_ID, signature: hopSig }] };
    }
    return JSON.stringify({ ...body, signature, ...(route_manifest ? { route_manifest } : {}) });
}

/** POST /v1/federation/memory/list on H, signed by P. */
async function listAsP(gaii: string) {
    const timestamp = freshTs();
    const signed = JSON.stringify({ requesting_node: P_ID, gaii, timestamp });
    return H.json('/v1/federation/memory/list', {
        method: 'POST',
        body: JSON.stringify({ requesting_node: P_ID, gaii, timestamp, signature: await sign(P.nodeKey.privateKey, signed), ...await audienceProof(P.nodeKey.privateKey, signed, H_ID) }),
    });
}

/** POST /v1/federation/replicate on H, signed by P, with P's delivery proof. `timestamp` is the record's own time. */
async function replicateAsP(gaii: string, key: string, timestamp = freshTs()) {
    const payload = { source_node: P_ID, gaii, key, value: { from: 'P', key }, visibility: 'public', version: 1, timestamp };
    const signed = JSON.stringify(payload);
    return H.json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({ ...payload, signature: await sign(P.nodeKey.privateKey, signed), ...await deliveryProof(P.nodeKey.privateKey, signed, H_ID) }),
    });
}

/** POST /v1/federation/peer/introduce on H, signed with `keys` for `nodeId`. */
async function introduce(nodeId: string, url: string, keys: { publicKey: string; privateKey: string }, extra: Record<string, unknown> = {}) {
    const timestamp = freshTs();
    const signed = `${nodeId}${url}${timestamp}`;
    return H.json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: nodeId, node_url: url, public_key: keys.publicKey, role: 'contributor',
            timestamp, signature: await sign(keys.privateKey, signed), ...await audienceProof(keys.privateKey, signed, H_ID), ...extra,
        }),
    });
}

async function mintInvite(extra: Record<string, unknown> = {}) {
    const r = await H.json('/v1/federation/link-invites', { method: 'POST', headers: auth(H.ownerToken), body: JSON.stringify({ tier: 'contact', ...extra }) });
    assert(r.status === 201, `mint an invite: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as { id: string; token: string };
}
async function inviteState(id: string): Promise<string | undefined> {
    const r = await H.json('/v1/federation/link-invites', { headers: auth(H.ownerToken) });
    return (r.body.data?.invites ?? []).find((i: any) => i.id === id)?.state;
}
async function peerRow(nodeId: string): Promise<any> {
    const r = await H.json('/v1/federation/peers', { headers: auth(H.ownerToken) });
    return (r.body.data?.peers ?? []).find((p: any) => p.node_id === nodeId);
}
async function requestsFrom(nodeId: string): Promise<any[]> {
    const r = await H.json('/v1/admin/peering/requests', { headers: auth(H.ownerToken) });
    return (r.body.data?.requests ?? []).filter((q: any) => q.from_node_id === nodeId);
}
async function balance(): Promise<number> {
    const w = await H.json('/v1/wallet', { headers: auth(H.ownerToken) });
    assert(w.status === 200, `wallet: ${w.status} ${JSON.stringify(w.body)}`);
    return w.body.data.balance;
}
async function settlementRows(trackingCode: string): Promise<any[]> {
    const tx = await H.json('/v1/wallet/transactions?type=federation_settlement', { headers: auth(H.ownerToken) });
    return (tx.body.data?.transactions ?? []).filter((t: any) => t.tracking_code === `settle:${trackingCode}`);
}

console.log('\n=== Federation: what a peer or an introducing node can do here, bounded ===\n');

const servers: Server[] = [];
try {
    console.log('Setup');
    await test('H and P boot; H holds P as an active member peer and the counting stand-in F as a listed peer', async () => {
        H = await bootNode(suitePort(30300, RUNNER_BASE), H_ID);
        servers.push(H.server);
        P = await bootNode(suitePort(30400, RUNNER_BASE), P_ID);
        servers.push(P.server);
        assert(H.nodeKey.publicKey !== P.nodeKey.publicKey, 'H and P hold the same node key; no signature below would mean anything');
        await setupOperator(H, `bndh${stamp}`);
        await setupOperator(P, `bndp${stamp}`);
        await addPeer(H, P_ID, P.baseUrl, P.nodeKey.publicKey, { tier: 'member', replicate_memory: true });
        await addPeer(P, H_ID, H.baseUrl, H.nodeKey.publicKey, { tier: 'member', replicate_memory: true });
        fake = await startCountingPeer();
        servers.push(fake.server);
        await addPeer(H, F_ID, fake.url, (await generateKeyPair()).publicKey);
        pat = await registerOwner(H.baseUrl, `pat${stamp}`);
    });

    // ── 1. Settlement ──
    console.log('\nPhase 1 — one signed settlement credits once');

    await test('S1. KEPT — a single signed settlement from P credits once, with one ledger row', async () => {
        const before = await balance();
        const tc = `tc-one-${stamp}`;
        const r = await H.json('/v1/federation/settle', { method: 'POST', body: await settlementBody({ gaii: H.ownerGhii, amount: 40, tracking_code: tc }) });
        assert(r.status === 200 && r.body.data?.settled === true, `settle: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await balance() === before + 40, 'the balance rose by the amount');
        assert((await settlementRows(tc)).length === 1, 'one ledger row');
        const again = await H.json('/v1/federation/settle', { method: 'POST', body: await settlementBody({ gaii: H.ownerGhii, amount: 40, tracking_code: tc }) });
        assert(again.status === 409 && again.body.error?.code === 'CONFLICT', `the same tracking code again: ${again.status} ${JSON.stringify(again.body)}`);
    });

    await test('S2. REFUSED — five copies of one signed settlement sent together credit once: one 200, four 409', async () => {
        const before = await balance();
        const tc = `tc-burst-${stamp}`;
        const body = await settlementBody({ gaii: H.ownerGhii, amount: 25, tracking_code: tc }, true);
        const answers = await Promise.all(Array.from({ length: 5 }, () => H.json('/v1/federation/settle', { method: 'POST', body })));
        const ok = answers.filter(a => a.status === 200).length;
        const conflict = answers.filter(a => a.status === 409 && a.body.error?.code === 'CONFLICT').length;
        const after = await balance();
        assert(after === before + 25, `credited ${(after - before) / 25} times, answers ${JSON.stringify(answers.map(a => a.status))}`);
        assert(ok === 1 && conflict === 4, `one 200 and four 409: ${JSON.stringify(answers.map(a => [a.status, a.body.error?.code]))}`);
        assert((await settlementRows(tc)).length === 1, 'one ledger row for the tracking code');
    });

    // ── 2. Resolve ──
    console.log('\nPhase 2 — an unknown identity is asked of the peers once');

    await test('R1. KEPT — a node-hinted identity answers without asking anyone, and a known identity on F resolves', async () => {
        const askedBefore = fakeAsked.length;
        const hinted = await H.json(`/v1/federation/resolve/${encodeURIComponent(`bot#someone@${P_ID}`)}`);
        assert(hinted.status === 200 && hinted.body.data?.node_id === P_ID && hinted.body.data?.node_url === P.baseUrl, `hint: ${hinted.status} ${JSON.stringify(hinted.body)}`);
        assert(fakeAsked.length === askedBefore, 'a hinted identity asks no peer');
        const known = await H.json(`/v1/federation/resolve/${encodeURIComponent(KNOWN_ON_F)}`);
        assert(known.status === 200 && known.body.data?.node_id === F_ID, `known on F: ${known.status} ${JSON.stringify(known.body)}`);
    });

    await test('R2. BOUNDED — an identity no node knows, resolved twice, is asked of F once', async () => {
        const who = `ghost-${stamp}`;
        const first = await H.json(`/v1/federation/resolve/${encodeURIComponent(who)}`);
        const second = await H.json(`/v1/federation/resolve/${encodeURIComponent(who)}`);
        assert(first.status === 404 && second.status === 404, `both are 404: ${first.status} ${second.status}`);
        const asked = fakeAsked.filter(a => a === who).length;
        assert(asked === 1, `F was asked ${asked} times for the same unknown identity`);
    });

    await test('R3. BOUNDED — four lookups of one new unknown identity at once ask F once', async () => {
        const who = `ghost-burst-${stamp}`;
        const answers = await Promise.all(Array.from({ length: 4 }, () => H.json(`/v1/federation/resolve/${encodeURIComponent(who)}`)));
        assert(answers.every(a => a.status === 404), `all 404: ${JSON.stringify(answers.map(a => a.status))}`);
        const asked = fakeAsked.filter(a => a === who).length;
        assert(asked === 1, `F was asked ${asked} times for one identity looked up together`);
    });

    await test('R4. BOUNDED — an identity that names H, or a peer H knows but does not list, asks no peer', async () => {
        const G_ID = `aimeat-bounds-g-${stamp}`;
        await addPeer(H, G_ID, 'http://localhost:49963', (await generateKeyPair()).publicKey, { peer_mode: 'private' });
        try {
            const own = `ghost-own-${stamp}@${H_ID}`;
            const hidden = `ghost-hidden-${stamp}@${G_ID}`;
            const a = await H.json(`/v1/federation/resolve/${encodeURIComponent(own)}`);
            const b = await H.json(`/v1/federation/resolve/${encodeURIComponent(hidden)}`);
            assert(a.status === 404 && b.status === 404, `both 404: ${a.status} ${b.status}`);
            assert(!JSON.stringify(b.body).includes('49963'), `the private peer's address is not given out: ${JSON.stringify(b.body)}`);
            assert(!fakeAsked.includes(own) && !fakeAsked.includes(hidden), `F was asked: ${JSON.stringify(fakeAsked.filter(w => w === own || w === hidden))}`);
        } finally {
            await H.json(`/v1/federation/peers/${G_ID}`, { method: 'DELETE', headers: auth(H.ownerToken) });
        }
    });

    await test('R5. BOUNDED — an identity with no known home reaches at most federation.resolve_max_peers peers; 0 is no limit', async () => {
        const cfg = H.config as unknown as Record<string, unknown>;
        const saved = cfg.federationResolveMaxPeers;
        try {
            // H lists P first and F second, so with 1 only P is asked.
            cfg.federationResolveMaxPeers = 1;
            const one = `ghost-capped-${stamp}`;
            const r = await H.json(`/v1/federation/resolve/${encodeURIComponent(one)}`);
            assert(r.status === 404, `capped: ${r.status} ${JSON.stringify(r.body)}`);
            assert(!fakeAsked.includes(one), 'F, the second listed peer, is not asked with the limit at 1');
            cfg.federationResolveMaxPeers = 0;
            const known = await H.json(`/v1/federation/resolve/${encodeURIComponent(KNOWN_ON_F)}`);
            assert(known.status === 200 && known.body.data?.node_id === F_ID, `0 is no limit, F answers: ${known.status} ${JSON.stringify(known.body)}`);
        } finally {
            cfg.federationResolveMaxPeers = saved;
        }
    });

    // ── 3. A deactivated account ──
    console.log('\nPhase 3 — a deactivated account is not acted for');

    await test('D1. KEPT — with the person\'s sign-in consent, P lists and writes their records', async () => {
        const c = await H.json('/v1/consent', {
            method: 'POST', headers: auth(pat.token),
            body: JSON.stringify({ data_pattern: '_identity', recipient: `node:${P_ID}`, scope: 'auth', purpose: 'federation_login' }),
        });
        assert(c.status === 201, `consent: ${c.status} ${JSON.stringify(c.body?.error)}`);
        const list = await listAsP(pat.ghii);
        assert(list.status === 200 && Array.isArray(list.body.data?.entries), `list: ${list.status} ${JSON.stringify(list.body)}`);
        const rep = await replicateAsP(pat.ghii, `pref-${stamp}`);
        assert(rep.status === 200, `replicate: ${rep.status} ${JSON.stringify(rep.body)}`);
    });

    await test('D2. REFUSED — after the operator deactivates the person, P neither lists nor writes: 403 ACCOUNT_DISABLED', async () => {
        const off = await H.json(`/v1/admin/owners/${pat.name}/disable`, { method: 'POST', headers: auth(H.ownerToken) });
        assert(off.status === 200, `disable: ${off.status} ${JSON.stringify(off.body)}`);
        const list = await listAsP(pat.ghii);
        assert(list.status === 403 && list.body.error?.code === 'ACCOUNT_DISABLED' && !list.body.data?.entries, `list while deactivated: ${list.status} ${JSON.stringify(list.body)}`);
        const rep = await replicateAsP(pat.ghii, `while-off-${stamp}`);
        assert(rep.status === 403 && rep.body.error?.code === 'ACCOUNT_DISABLED', `replicate while deactivated: ${rep.status} ${JSON.stringify(rep.body)}`);
        assert(!(await H.storage.getMemory(pat.ghii, `replica:${P_ID}:while-off-${stamp}`)), 'nothing is stored while deactivated');
    });

    await test('D3. KEPT — after reactivation P lists and writes again, with the consent untouched', async () => {
        const on = await H.json(`/v1/admin/owners/${pat.name}/enable`, { method: 'POST', headers: auth(H.ownerToken) });
        assert(on.status === 200, `enable: ${on.status} ${JSON.stringify(on.body)}`);
        const list = await listAsP(pat.ghii);
        assert(list.status === 200, `list after reactivation: ${list.status} ${JSON.stringify(list.body)}`);
        const rep = await replicateAsP(pat.ghii, `after-on-${stamp}`);
        assert(rep.status === 200, `replicate after reactivation: ${rep.status} ${JSON.stringify(rep.body)}`);
    });

    // ── 4. Invites ──
    console.log('\nPhase 4 — an invite replaces a held peer only when it names that node');

    const X_ID = `aimeat-bounds-x-${stamp}`;
    const X_URL = 'http://localhost:49961';
    let k1!: { publicKey: string; privateKey: string };
    let k2!: { publicKey: string; privateKey: string };

    await test('V1. KEPT — a fresh node presenting a plain invite is admitted at the invite\'s tier', async () => {
        const keys = await generateKeyPair();
        const inv = await mintInvite();
        const r = await introduce(`aimeat-bounds-fresh-${stamp}`, 'http://localhost:49962', keys, { invite_token: inv.token });
        assert(r.status === 200 && r.body.data?.tier === 'contact', `fresh node: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await inviteState(inv.id) === 'consumed', 'the invite is used');
    });

    let plainInvite!: { id: string; token: string };
    let replaceRequest = '';
    const replaceNotices = async () => {
        const n = await H.json('/v1/notifications', { headers: auth(H.ownerToken) });
        return ((n.body.data?.notifications ?? []) as any[]).filter(x => x.type === 'peer_replace_ask' && String(x.title).includes(X_ID));
    };
    const introStatus = async (id: string) => (await H.json(`/v1/federation/peer/introduce/${id}/status`)).body.data?.status;
    const decide = (id: string, decision: 'approve' | 'reject') => H.json(`/v1/admin/peering/requests/${id}/decision`, {
        method: 'POST', headers: auth(H.ownerToken), body: JSON.stringify({ decision }),
    });

    await test('V2. NOT SILENT — a plain invite for an offline peer held under another key waits for the operator: 202 pending, the peer and the invite unchanged, the operator asked', async () => {
        k1 = await generateKeyPair();
        k2 = await generateKeyPair();
        await addPeer(H, X_ID, X_URL, k1.publicKey);
        const off = await H.json(`/v1/federation/peers/${X_ID}`, { method: 'PUT', headers: auth(H.ownerToken), body: JSON.stringify({ status: 'offline' }) });
        assert(off.status === 200, `set offline: ${off.status} ${JSON.stringify(off.body)}`);
        plainInvite = await mintInvite({ label: 'rebuild' });
        const r = await introduce(X_ID, X_URL, k2, { invite_token: plainInvite.token });
        assert(r.status === 202 && r.body.data?.status === 'pending', `expected 202 pending, got ${r.status} ${JSON.stringify(r.body)}`);
        replaceRequest = r.body.data.request_id;
        const row = await peerRow(X_ID);
        assert(row?.public_key === k1.publicKey, `the held peer keeps its key until the operator decides: ${JSON.stringify(row)}`);
        assert(await inviteState(plainInvite.id) === 'open', 'the invite is not used before the operator decides');
        assert(await introStatus(replaceRequest) === 'pending', 'the presenting node sees pending');
        const asks = await replaceNotices();
        assert(asks.length === 1, `the operator gets one notice: ${JSON.stringify(asks.map(a => a.title))}`);
        const ids = (asks[0].actions ?? []).map((a: any) => a.id).sort();
        assert(JSON.stringify(ids) === JSON.stringify(['allow', 'deny']), `with Allow and Don't allow: ${JSON.stringify(asks[0].actions)}`);
        assert(String(asks[0].body).includes('different key'), `in plain words: ${asks[0].body}`);
        const again = await introduce(X_ID, X_URL, k2, { invite_token: plainInvite.token });
        assert(again.status === 202 && again.body.data?.request_id === replaceRequest, `the same invite again answers with its waiting request: ${JSON.stringify(again.body.data)}`);
    });

    await test('V2a. REFUSED — a person who is not an operator cannot answer it: 403, nothing replaced', async () => {
        const plain = await registerOwner(H.baseUrl, `plain${stamp}`);
        const r = await H.json(`/v1/admin/peering/requests/${replaceRequest}/decision`, {
            method: 'POST', headers: auth(plain.token), body: JSON.stringify({ decision: 'approve' }),
        });
        assert(r.status === 403, `a plain owner: ${r.status} ${JSON.stringify(r.body)}`);
        assert((await peerRow(X_ID))?.public_key === k1.publicKey, 'the held peer keeps its key');
        assert(await introStatus(replaceRequest) === 'pending', 'still pending');
    });

    await test('V2b. DON\'T ALLOW — the operator says no: the held peer and the invite stay, the presenting node reads rejected', async () => {
        const r = await decide(replaceRequest, 'reject');
        assert(r.status === 200 && r.body.data?.status === 'rejected', `reject: ${r.status} ${JSON.stringify(r.body)}`);
        assert((await peerRow(X_ID))?.public_key === k1.publicKey, 'the held peer keeps its key');
        assert(await inviteState(plainInvite.id) === 'open', 'the invite stays unused');
        assert(await introStatus(replaceRequest) === 'rejected', 'the presenting node reads rejected');
    });

    await test('V2c. ALLOW — the operator says yes with one press: the node takes the place under its new key and the invite is used', async () => {
        const r = await introduce(X_ID, X_URL, k2, { invite_token: plainInvite.token });
        assert(r.status === 202, `presented again: ${r.status} ${JSON.stringify(r.body)}`);
        const reqId = r.body.data.request_id;
        assert(reqId !== replaceRequest, 'a new question after the first was answered');
        const ok = await decide(reqId, 'approve');
        assert(ok.status === 200 && ok.body.data?.status === 'approved', `approve: ${ok.status} ${JSON.stringify(ok.body)}`);
        const row = await peerRow(X_ID);
        assert(row?.public_key === k2.publicKey && row.status === 'active' && row.tier === 'contact', `replaced at the invite's tier: ${JSON.stringify(row)}`);
        assert(await inviteState(plainInvite.id) === 'consumed', 'the invite is used on Allow');
        assert(await introStatus(reqId) === 'approved', 'the presenting node reads approved');
        const asks = await replaceNotices();
        assert(asks.length >= 2 && asks.every(a => !!a.answered && !(a.actions ?? []).length), `every question's notice shows its answer: ${JSON.stringify(asks.map(a => a.answered ?? null))}`);
    });

    let k3!: { publicKey: string; privateKey: string };
    await test('V3. KEPT — an invite that names the node replaces the held peer at once, which is the operator\'s decision for it', async () => {
        k3 = await generateKeyPair();
        const off = await H.json(`/v1/federation/peers/${X_ID}`, { method: 'PUT', headers: auth(H.ownerToken), body: JSON.stringify({ status: 'offline' }) });
        assert(off.status === 200, `set offline: ${off.status}`);
        const inv = await mintInvite({ node_id: X_ID });
        const r = await introduce(X_ID, X_URL, k3, { invite_token: inv.token });
        assert(r.status === 200, `named invite: ${r.status} ${JSON.stringify(r.body)}`);
        const row = await peerRow(X_ID);
        assert(row?.public_key === k3.publicKey && row.status === 'active', `the node is admitted under its new key: ${JSON.stringify(row)}`);
        const list = await H.json('/v1/federation/link-invites', { headers: auth(H.ownerToken) });
        const mine = (list.body.data?.invites ?? []).find((i: any) => i.id === inv.id);
        assert(mine?.node_id === X_ID && mine.consumed_by_node_id === X_ID, `the listing names the node: ${JSON.stringify(mine)}`);
    });

    await test('V4. NOT USED — an invite that names another node, presented by a fresh node, is a pending request and stays open', async () => {
        const inv = await mintInvite({ node_id: `aimeat-bounds-other-${stamp}` });
        const keys = await generateKeyPair();
        const r = await introduce(`aimeat-bounds-w-${stamp}`, 'http://localhost:49963', keys, { invite_token: inv.token });
        assert(r.status === 202 && r.body.data?.status === 'pending', `another node's invite: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await inviteState(inv.id) === 'open', 'the invite is not used by another node');
    });

    await test('V5. KEPT — an offline peer coming back under its own key with a plain invite is admitted', async () => {
        const off = await H.json(`/v1/federation/peers/${X_ID}`, { method: 'PUT', headers: auth(H.ownerToken), body: JSON.stringify({ status: 'offline' }) });
        assert(off.status === 200, `set offline: ${off.status}`);
        const inv = await mintInvite();
        const r = await introduce(X_ID, X_URL, k3, { invite_token: inv.token });
        assert(r.status === 200, `own key: ${r.status} ${JSON.stringify(r.body)}`);
        assert((await peerRow(X_ID))?.public_key === k3.publicKey, 'the same key');
    });

    // ── 5. Introductions ──
    console.log('\nPhase 5 — introductions are stored bounded');

    const N_ID = `aimeat-bounds-n-${stamp}`;
    let nKeys!: { publicKey: string; privateKey: string };

    await test('I1. BOUNDED — a long message is stored at most 10 000 characters, and a repeat keeps one pending request', async () => {
        nKeys = await generateKeyPair();
        const first = await introduce(N_ID, 'http://localhost:49964', nKeys, { message: 'Hello' });
        assert(first.status === 202, `introduce: ${first.status} ${JSON.stringify(first.body)}`);
        const again = await introduce(N_ID, 'http://localhost:49964', nKeys, { message: 'Hello again' });
        assert(again.status === 202 && again.body.data?.request_id === first.body.data?.request_id,
            `the repeat answers with the waiting request: ${again.status} ${JSON.stringify(again.body.data)} vs ${first.body.data?.request_id}`);
        const status = await H.json(`/v1/federation/peer/introduce/${first.body.data.request_id}/status`);
        assert(status.status === 200 && status.body.data?.status === 'pending', `the id the node polls still answers: ${status.status}`);
        const pending = (await requestsFrom(N_ID)).filter(q => q.status === 'pending');
        assert(pending.length === 1, `one pending request for one node and key: ${pending.length}`);
        const longOne = await introduce(`aimeat-bounds-long-${stamp}`, 'http://localhost:49965', await generateKeyPair(), { message: 'y'.repeat(100_000) });
        assert(longOne.status === 202, `long: ${longOne.status}`);
        const stored = (await requestsFrom(`aimeat-bounds-long-${stamp}`))[0];
        assert(typeof stored?.message === 'string' && stored.message.length <= 10_000 && stored.message.length > 0, `stored length ${stored?.message?.length}`);
    });

    await test('I2. KEPT — the operator approves the pending request as before', async () => {
        const pending = (await requestsFrom(N_ID)).find(q => q.status === 'pending');
        const r = await H.json(`/v1/admin/peering/requests/${pending.id}`, { method: 'PUT', headers: auth(H.ownerToken), body: JSON.stringify({ decision: 'approve' }) });
        assert(r.status === 200 && r.body.data?.status === 'approved', `approve: ${r.status} ${JSON.stringify(r.body)}`);
        assert((await peerRow(N_ID))?.status === 'approved', 'the peer is approved');
    });

    await test('I3. BOUNDED — past the per-address hourly bound a new request is 429 with when to try again; 0 is no limit', async () => {
        const cfg = H.config as unknown as Record<string, unknown>;
        const saved = cfg.federationIntroductionsPerHour;
        try {
            cfg.federationIntroductionsPerHour = 1;
            const a = await introduce(`aimeat-bounds-c1-${stamp}`, 'http://localhost:49966', await generateKeyPair());
            const b = await introduce(`aimeat-bounds-c2-${stamp}`, 'http://localhost:49967', await generateKeyPair());
            assert(b.status === 429 && b.body.error?.code === 'TOO_MANY_INTRODUCTIONS', `past the bound: ${a.status} then ${b.status} ${JSON.stringify(b.body)}`);
            assert(typeof b.body.error?.details?.retry_after_seconds === 'number', `says when to try again: ${JSON.stringify(b.body.error)}`);
            assert((await requestsFrom(`aimeat-bounds-c2-${stamp}`)).length === 0, 'nothing stored past the bound');
            cfg.federationIntroductionsPerHour = 0;
            const c = await introduce(`aimeat-bounds-c3-${stamp}`, 'http://localhost:49968', await generateKeyPair());
            assert(c.status === 202, `0 is no limit: ${c.status} ${JSON.stringify(c.body)}`);
        } finally {
            cfg.federationIntroductionsPerHour = saved;
        }
    });

    /** A pending request from `nodeId`, written as if it had arrived `daysAgo` days ago. */
    async function agedRequest(nodeId: string, daysAgo: number): Promise<string> {
        const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
        const id = `peer-req-aged-${nodeId}`;
        await H.storage.createPeeringRequest({ id, fromNodeUrl: 'http://localhost:49964', fromNodeId: nodeId, toNodeId: H_ID, targetUrl: 'http://localhost:49964', publicKey: (await generateKeyPair()).publicKey, message: '', status: 'pending', createdAt: at, updatedAt: at });
        return id;
    }

    await test('E1. EXPIRES — a peering request unanswered for 30 days is gone: not listed, not approvable, its status not found', async () => {
        const oldId = await agedRequest(`aimeat-bounds-old-${stamp}`, 31);
        const freshId = await agedRequest(`aimeat-bounds-new-${stamp}`, 29);
        const list = await H.json('/v1/admin/peering/requests', { headers: auth(H.ownerToken) });
        const ids = (list.body.data?.requests ?? []).map((q: any) => q.id);
        assert(!ids.includes(oldId), `the 31-day-old request is not listed: ${JSON.stringify(ids)}`);
        assert(ids.includes(freshId), 'a 29-day-old request is still listed');
        const ap = await H.json(`/v1/admin/peering/requests/${oldId}/decision`, { method: 'POST', headers: auth(H.ownerToken), body: JSON.stringify({ decision: 'approve' }) });
        assert(ap.status === 404, `approving it: ${ap.status} ${JSON.stringify(ap.body)}`);
        const st = await H.json(`/v1/federation/peer/introduce/${oldId}/status`);
        assert(st.status === 404, `its status: ${st.status} ${JSON.stringify(st.body)}`);
        assert(!(await H.storage.getPeeringRequest(oldId)), 'the row is deleted');
        const fresh = await H.json(`/v1/federation/peer/introduce/${freshId}/status`);
        assert(fresh.status === 200 && fresh.body.data?.status === 'pending', `the fresh one: ${fresh.status} ${JSON.stringify(fresh.body)}`);
    });

    await test('E2. KEPT — federation.peering_request_days 0 keeps an old request', async () => {
        // H runs on an in-memory database, where PUT /v1/admin/config answers READONLY_CONFIG, so the
        // value is set on the live config as I3 does.
        const cfg = H.config as unknown as Record<string, unknown>;
        const saved = cfg.federationPeeringRequestDays;
        cfg.federationPeeringRequestDays = 0;
        try {
            const oldId = await agedRequest(`aimeat-bounds-older-${stamp}`, 400);
            const list = await H.json('/v1/admin/peering/requests', { headers: auth(H.ownerToken) });
            assert((list.body.data?.requests ?? []).some((q: any) => q.id === oldId), 'with 0 a 400-day-old request stays');
            const st = await H.json(`/v1/federation/peer/introduce/${oldId}/status`);
            assert(st.status === 200 && st.body.data?.status === 'pending', `its status: ${st.status} ${JSON.stringify(st.body)}`);
        } finally {
            cfg.federationPeeringRequestDays = saved;
        }
    });

    // ── 6. Own node id ──
    console.log('\nPhase 6 — no peer under this node\'s own id');

    await test('O1. REFUSED — an introduction under H\'s own id, with an invite or without, is 400 SELF_NODE_ID', async () => {
        const keys = await generateKeyPair();
        const inv = await mintInvite();
        const r = await introduce(H_ID, 'http://localhost:49969', keys, { invite_token: inv.token });
        assert(r.status === 400 && r.body.error?.code === 'SELF_NODE_ID', `with an invite: ${r.status} ${JSON.stringify(r.body)}`);
        assert(await inviteState(inv.id) === 'open', 'the invite is not used');
        assert(!(await peerRow(H_ID)), 'no peer under the node\'s own id');
        const plain = await introduce(H_ID, 'http://localhost:49969', keys);
        assert(plain.status === 400 && plain.body.error?.code === 'SELF_NODE_ID', `without: ${plain.status} ${JSON.stringify(plain.body)}`);
        assert((await requestsFrom(H_ID)).length === 0, 'no request stored');
    });

    await test('O2. REFUSED — a key exchange, an approval and a direct add under H\'s own id make no peer', async () => {
        const keys = await generateKeyPair();
        const ke = await H.json('/v1/federation/key-exchange', {
            method: 'POST', body: JSON.stringify({ node_id: H_ID, node_url: 'http://localhost:49969', node_public_key: keys.publicKey, timestamp: new Date().toISOString() }),
        });
        assert(ke.status !== 200, `key exchange: ${ke.status} ${JSON.stringify(ke.body)}`);
        const now = new Date().toISOString();
        const reqId = `peer-req-self-${stamp}`;
        await H.storage.createPeeringRequest({ id: reqId, fromNodeUrl: 'http://localhost:49969', fromNodeId: H_ID, toNodeId: H_ID, targetUrl: 'http://localhost:49969', publicKey: keys.publicKey, message: '', status: 'pending', createdAt: now, updatedAt: now });
        const ap = await H.json(`/v1/admin/peering/requests/${reqId}`, { method: 'PUT', headers: auth(H.ownerToken), body: JSON.stringify({ decision: 'approve' }) });
        assert(ap.status === 400 && ap.body.error?.code === 'SELF_NODE_ID', `approval: ${ap.status} ${JSON.stringify(ap.body)}`);
        const add = await H.json('/v1/federation/peers', { method: 'POST', headers: auth(H.ownerToken), body: JSON.stringify({ node_id: H_ID, url: 'http://localhost:49969', public_key: keys.publicKey }) });
        assert(add.status === 400 && add.body.error?.code === 'SELF_NODE_ID', `direct add: ${add.status} ${JSON.stringify(add.body)}`);
        assert(!(await peerRow(H_ID)), 'no peer under the node\'s own id');
    });

    // ── 7. Replicas ──
    console.log('\nPhase 7 — a replica\'s life is this node\'s clock');

    const pPerson = `someone${stamp}@${P_ID}`;

    await test('Y1. KEPT — an honest replicate from P is stored with the record\'s own time', async () => {
        const recordTime = new Date(Date.now() - 3_600_000).toISOString();
        const r = await replicateAsP(pPerson, 'honest', recordTime);
        assert(r.status === 200, `replicate: ${r.status} ${JSON.stringify(r.body)}`);
        const row = await H.storage.getMemory(pPerson, `replica:${P_ID}:honest`);
        assert(row?.updatedAt && new Date(row.updatedAt).getTime() === new Date(recordTime).getTime(), `stored time ${row?.updatedAt}, record time ${recordTime}`);
    });

    await test('Y2. BOUNDED — a replicate dated a year ahead is stored with the time it arrived', async () => {
        const ahead = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString();
        const r = await replicateAsP(pPerson, 'future', ahead);
        assert(r.status === 200, `replicate: ${r.status} ${JSON.stringify(r.body)}`);
        const row = await H.storage.getMemory(pPerson, `replica:${P_ID}:future`);
        assert(!!row && new Date(row.updatedAt).getTime() <= Date.now() + 5 * 60_000, `stored ${row?.updatedAt}`);
    });

    await test('Y3. CLEARED — an emergency removal of P removes its people\'s replicas and turns the person\'s saved-home record into an expiring copy', async () => {
        const home = await replicateAsP(pat.ghii, `home-${stamp}`);
        assert(home.status === 200, `push-home stand-in: ${home.status} ${JSON.stringify(home.body)}`);
        const del = await H.json(`/v1/federation/peers/${P_ID}?emergency=true`, { method: 'DELETE', headers: auth(H.ownerToken) });
        assert(del.status === 200 && del.body.data?.emergency === true, `emergency removal: ${del.status} ${JSON.stringify(del.body)}`);
        assert(!(await H.storage.getMemory(pPerson, `replica:${P_ID}:honest`)), 'P\'s person\'s replica is gone');
        assert(!(await H.storage.getMemory(pPerson, `replica:${P_ID}:future`)), 'the future-dated replica is gone');
        const read = await H.json(`/v1/memory/${encodeURIComponent(pPerson)}/${encodeURIComponent(`replica:${P_ID}:honest`)}`);
        assert(read.status === 404, `nobody reads it: ${read.status}`);
        assert(!(await H.storage.getMemory(pat.ghii, `replica:${P_ID}:home-${stamp}`)), 'the person\'s replica key is converted');
        const kept = await H.storage.getMemory(pat.ghii, `expiring:${P_ID}:home-${stamp}`);
        assert(!!kept && new Date(kept.updatedAt).getTime() <= Date.now(), `the person keeps an expiring copy: ${JSON.stringify(kept?.key)}`);
    });

    await test('Y4. CLEARED — a future-dated replica stored before this change is brought to the present, then ages out', async () => {
        const owner = `old${stamp}@aimeat-bounds-gone-${stamp}`;
        const key = `replica:aimeat-bounds-gone-${stamp}:old-future`;
        const ahead = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString();
        await H.storage.setMemory({ key, ownerGaii: owner, value: { old: true }, visibility: 'public', tags: ['replica:x'], ttlHours: null, version: 1, createdAt: ahead, updatedAt: ahead });
        const shortTtl = { ...H.config, genesisMemoryCacheTtlHours: 0.0001 };
        await runCleanupCycle(shortTtl, H.storage);
        await sleep(800);
        await runCleanupCycle(shortTtl, H.storage);
        assert(!(await H.storage.getMemory(owner, key)), 'the future-dated row is removed once its time is this node\'s');
    });
} finally {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

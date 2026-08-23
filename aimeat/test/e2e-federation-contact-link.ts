/**
 * @file e2e-federation-contact-link.ts
 * @description The `contact` tier promises a customer one sentence: messages cross this link and
 *   nothing else does. This suite is that sentence, asserted one door at a time.
 *
 *   Every refusal below is sent with a CORRECTLY SIGNED, otherwise-valid payload from a genuinely
 *   active peer, because the interesting failure is not "an unsigned request is rejected" — that was
 *   already true — but "an entitled-looking peer is refused a capability its tier does not carry".
 *   And every refusal is followed by a read-back, because a 403 returned AFTER the effect looks
 *   identical from the outside to one returned before it.
 *
 *   The positive control runs FIRST and is not optional. A suite that only asserts 403s passes just
 *   as happily when the peer is broken, the signature helper is wrong, or the node is refusing
 *   everything for an unrelated reason, and it would then certify a link that cannot carry the one
 *   thing it exists for.
 *
 *   Node V (vendor) 40287. Peer C is a keypair, not a running server: nothing here needs it to
 *   answer, only to sign.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-contact-link.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

type Json = (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
interface NodeState { server: Server; baseUrl: string; nodeId: string; adminPw: string; ownerName: string; ownerGhii: string; ownerToken: string; json: Json }

function makeJson(baseUrl: string): Json {
    return async (path, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

async function bootNode(port: number, nodeId: string): Promise<NodeState> {
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
    config.packageFederationEnabled = true;   // so /templates answers rather than 403-ing on a config flag

    const { app } = await createServer(config);
    const server = await new Promise<Server>(resolve => { const s = app.listen(port, () => resolve(s)); });
    return { server, baseUrl: `http://localhost:${port}`, nodeId, adminPw, ownerName: '', ownerGhii: '', ownerToken: '', json: makeJson(`http://localhost:${port}`) };
}

async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }) });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }) });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    node.ownerName = ownerName;
    node.ownerGhii = `${ownerName}@${node.nodeId}`;
    node.ownerToken = tok.body.token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Federation Contact-Link E2E (messages only) ===\n');

let V: NodeState;
const ts = Date.now();
const C_NODE = 'aimeat-peer-001-contactc';
const C_URL = 'http://localhost:49997';   // a keypair, not a server: nothing here needs it to answer
let cKeys: { publicKey: string; privateKey: string };

/** Sign a body the way the route will canonicalise it, and post it as peer C. */
async function asPeer(path: string, payload: Record<string, unknown>, signOver?: string) {
    const signature = await sign(cKeys.privateKey, signOver ?? JSON.stringify(payload));
    return V.json(path, {
        method: 'POST',
        headers: { 'x-source-node': C_NODE },
        body: JSON.stringify({ ...payload, signature }),
    });
}

/** Every boolean permission the peer row carries, as V reports it. */
async function peerRow(): Promise<any> {
    const r = await V.json('/v1/federation/peers', { headers: auth(V.ownerToken) });
    return (r.body.data.peers as any[]).find(p => p.node_id === C_NODE);
}

console.log('Setup');
await test('Boot V, one operator, peer C admitted at tier contact', async () => {
    V = await bootNode(40287, 'aimeat-test-001-contactv');
    await setupOwner(V, `clv${ts}`);
    cKeys = await generateKeyPair();

    const add = await V.json('/v1/federation/peers', {
        method: 'POST', headers: auth(V.ownerToken),
        body: JSON.stringify({ node_id: C_NODE, url: C_URL, public_key: cKeys.publicKey }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);

    const demote = await V.json(`/v1/federation/peers/${C_NODE}`, {
        method: 'PUT', headers: auth(V.ownerToken),
        body: JSON.stringify({ status: 'active', tier: 'contact' }),
    });
    assert(demote.status === 200, `demote: ${demote.status} ${JSON.stringify(demote.body)}`);
    assert(demote.body.data.tier === 'contact', `tier is contact, got ${demote.body.data.tier}`);
});

// ── The positive control. Runs first, so a node refusing everything cannot pass this suite. ──
console.log('\nPhase 1 — the one thing a contact link IS for');

let deliveredMessageId = '';
await test('P1. A contact peer CAN deliver a direct message', async () => {
    deliveredMessageId = randomUUID();
    const message = {
        id: deliveredMessageId,
        conversationId: randomUUID(),
        subject: 'Hello from the floor',
        senderGhii: `someone@${C_NODE}`,
        recipientGhii: V.ownerGhii,
        deliveryGhii: V.ownerGhii,
        body: 'A message is the whole point of this link.',
        createdAt: new Date().toISOString(),
    };
    const r = await asPeer('/v1/federation/message', { source_node: C_NODE, message, timestamp: new Date().toISOString() });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.delivered === true, `delivered, got ${JSON.stringify(r.body.data)}`);
});

await test('P2. A contact peer CAN send a read receipt', async () => {
    const r = await asPeer('/v1/federation/message/receipt', {
        source_node: C_NODE, message_id: deliveredMessageId, kind: 'read', timestamp: new Date().toISOString(),
    });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── The promise. Each one signed correctly, each one read back. ──
console.log('\nPhase 2 — and nothing else crosses');

await test('R1. REFUSED — memory replication, and no replica is written', async () => {
    const key = `contact-probe-${ts}`;
    const payload = {
        source_node: C_NODE, gaii: V.ownerGhii, key, value: { smuggled: true },
        visibility: 'public', version: 1, timestamp: new Date().toISOString(),
    };
    const r = await asPeer('/v1/federation/replicate', payload);
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'POLICY_DENIED', `expected POLICY_DENIED, got ${r.body.error?.code}`);

    // Refuse before you write: the key must not exist, under either name.
    for (const probe of [key, `replica:${C_NODE}:${key}`]) {
        const read = await V.json(`/v1/memory/${encodeURIComponent(probe)}`, { headers: auth(V.ownerToken) });
        assert(read.status === 404, `${probe} must not exist, got ${read.status}`);
    }
});

await test('R2. REFUSED — catalogue sync, and no action is created', async () => {
    const actions = [{ id: 'smuggled', provider_gaii: `someone@${C_NODE}`, display_name: 'Smuggled action' }];
    const before = await V.json('/v1/catalogue/actions');
    const r = await asPeer('/v1/federation/catalogue-sync',
        { source_node: C_NODE, actions, since_timestamp: null, catalogue_hash: 'x' },
        JSON.stringify({ source_node: C_NODE, actions, since_timestamp: null, catalogue_hash: 'x' }));
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);

    const after = await V.json('/v1/catalogue/actions');
    const beforeN = (before.body.data?.actions ?? []).length;
    const afterN = (after.body.data?.actions ?? []).length;
    assert(afterN === beforeN, `catalogue grew from ${beforeN} to ${afterN}`);
});

await test('R3. REFUSED — reading the service summary', async () => {
    const r = await V.json('/v1/federation/service-summary', { headers: { 'x-source-node': C_NODE } });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('R4. REFUSED — listing a person\'s whole memory key inventory', async () => {
    const timestamp = new Date().toISOString();
    const r = await asPeer('/v1/federation/memory/list', { requesting_node: C_NODE, gaii: V.ownerGhii, timestamp },
        JSON.stringify({ requesting_node: C_NODE, gaii: V.ownerGhii, timestamp }));
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(!r.body.data?.entries, 'no inventory may come back with the refusal');
});

await test('R5. REFUSED — pulling the template catalogue', async () => {
    const r = await V.json('/v1/federation/templates', { headers: { 'x-source-node': C_NODE } });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('R6. REFUSED — pushing presence, and nobody\'s status is learned', async () => {
    const timestamp = new Date().toISOString();
    const updates = [{ ghii: `someone@${C_NODE}`, status: 'online' }];
    const signOver = `${C_NODE}|${timestamp}|${JSON.stringify(updates)}`;
    const r = await asPeer('/v1/federation/presence', { from_node_id: C_NODE, timestamp, updates }, signOver);
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('R7. REFUSED — broadcasting to every human on the node', async () => {
    const broadcast = { id: randomUUID(), senderGhii: `someone@${C_NODE}`, subject: 'Everyone', body: 'Reaching all of you.' };
    const timestamp = new Date().toISOString();
    const r = await asPeer('/v1/federation/broadcast', { source_node: C_NODE, broadcast, timestamp });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'POLICY_DENIED', `expected POLICY_DENIED, got ${r.body.error?.code}`);

    const inbox = await V.json('/v1/messages/inbox', { headers: auth(V.ownerToken) });
    const got = (inbox.body.data?.messages ?? []).find((m: any) => m.body === 'Reaching all of you.');
    assert(!got, 'the announcement must not have landed in anyone\'s inbox');
});

await test('R8. REFUSED — settling a balance, and the balance is byte-identical', async () => {
    const balanceOf = async () => {
        const r = await V.json('/v1/wallet/balance', { headers: auth(V.ownerToken) });
        return JSON.stringify(r.body.data);
    };
    const before = await balanceOf();

    const payload = {
        from_node: C_NODE, to_node: V.nodeId, gaii: V.ownerGhii, amount: 5000,
        tracking_code: `contact-probe-${ts}`, reason: 'smuggled', timestamp: new Date().toISOString(),
    };
    const signature = await sign(cKeys.privateKey, JSON.stringify(payload));
    const r = await V.json('/v1/federation/settle', {
        method: 'POST', headers: { 'x-source-node': C_NODE }, body: JSON.stringify({ ...payload, signature }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'POLICY_DENIED', `expected POLICY_DENIED, got ${r.body.error?.code}`);
    assert(await balanceOf() === before, 'the balance changed on a refused settlement');
});

await test('R9. An attachment download is MESSAGING, so the door opens — and the relationship still decides', async () => {
    // Deliberately not a POLICY_DENIED case. Attachments are part of a message, so a contact link
    // carries them and this door is gated by the same word. What refuses here is the authority check:
    // no message on this node matches that id, storage key and recipient. Asserting POLICY_DENIED
    // would have written down the opposite of the design and passed only while it was broken.
    const payload = {
        source_node: C_NODE, message_id: deliveredMessageId, conversation_id: randomUUID(),
        storage_key: 'anything', owner_ghii: V.ownerGhii, recipient_ghii: `someone@${C_NODE}`,
        timestamp: new Date().toISOString(),
    };
    const r = await asPeer('/v1/federation/storage/grant', payload);
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code !== 'POLICY_DENIED', 'a contact peer is entitled to this door; the relationship is what refuses');
    assert(!r.body.data?.download_url, 'no download capability may be issued');
});

await test('R10. A contact link is absent from the public directory, so it is nobody\'s customer list', async () => {
    const r = await V.json('/v1/federation/directory');
    assert(r.status === 200, `directory: ${r.status}`);
    const listed = (r.body.data.peers ?? []).map((p: any) => p.node_id);
    assert(!listed.includes(C_NODE), `contact peer must not be listed, got ${JSON.stringify(listed)}`);
});

// ── The tier itself: it must not drift upward by any door an operator or a peer can reach. ──
console.log('\nPhase 3 — the floor stays the floor');

await test('T1. An operator turning every flag on gets none of them', async () => {
    const r = await V.json(`/v1/federation/peers/${C_NODE}`, {
        method: 'PUT', headers: auth(V.ownerToken),
        body: JSON.stringify({
            share_catalogue: true, replicate_memory: true, allow_routing: true,
            allow_broadcast: true, allow_settlement: true, allow_federated_auth: true,
            peer_mode: 'federation',
        }),
    });
    assert(r.status === 200, `PUT: ${r.status} ${JSON.stringify(r.body)}`);

    const row = await peerRow();
    assert(row.tier === 'contact', `tier stayed contact, got ${row.tier}`);
    for (const flag of ['share_catalogue', 'replicate_memory', 'allow_routing', 'allow_broadcast', 'allow_settlement', 'allow_federated_auth']) {
        assert(row[flag] === false, `${flag} must stay false, got ${row[flag]}`);
    }
    assert(row.allow_messaging === true, `allow_messaging stays on, got ${row.allow_messaging}`);
    assert(row.peer_mode === 'private', `peer_mode stays private, got ${row.peer_mode}`);
});

await test('T2. REFUSED — promoting a contact link with one click', async () => {
    const r = await V.json(`/v1/federation/peers/${C_NODE}/promote`, {
        method: 'POST', headers: auth(V.ownerToken), body: JSON.stringify({ force: true }),
    });
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'TIER_NOT_PROMOTABLE', `got ${r.body.error?.code}`);
    assert((await peerRow()).tier === 'contact', 'the tier must be unchanged after a refused promotion');
});

await test('T3. A suspend advisory does not PROMOTE the least-trusted peer there is', async () => {
    const r = await V.json('/v1/federation/trust-advisory', {
        method: 'POST', headers: auth(V.ownerToken),
        body: JSON.stringify({ target_node: C_NODE, advisory_type: 'suspend', reason: 'probing the demotion path' }),
    });
    assert(r.status === 201, `advisory: ${r.status} ${JSON.stringify(r.body)}`);

    const row = await peerRow();
    assert(row.tier === 'contact', `a punishment must not raise the tier, got ${row.tier}`);
    assert(row.share_catalogue === false, 'and must not hand over catalogue read');
});

await test('T4. Messaging can still be turned OFF — a clamp holds a ceiling, not a floor', async () => {
    const off = await V.json(`/v1/federation/peers/${C_NODE}`, {
        method: 'PUT', headers: auth(V.ownerToken), body: JSON.stringify({ allow_messaging: false }),
    });
    assert(off.status === 200, `PUT: ${off.status}`);
    assert((await peerRow()).allow_messaging === false, 'the operator may always withdraw a capability');

    const message = {
        id: randomUUID(), conversationId: randomUUID(), senderGhii: `someone@${C_NODE}`,
        recipientGhii: V.ownerGhii, deliveryGhii: V.ownerGhii, body: 'After the link was muted.',
        createdAt: new Date().toISOString(),
    };
    const r = await asPeer('/v1/federation/message', { source_node: C_NODE, message, timestamp: new Date().toISOString() });
    assert(r.status === 403, `a muted link refuses messages too, got ${r.status}`);
    assert(r.body.error?.code === 'POLICY_DENIED', `expected POLICY_DENIED, got ${r.body.error?.code}`);

    // The attachment door is the same word, so muting closes it too — this is the POLICY_DENIED that
    // R9 could not assert, because there the capability was genuinely present.
    const grant = await asPeer('/v1/federation/storage/grant', {
        source_node: C_NODE, message_id: deliveredMessageId, conversation_id: randomUUID(),
        storage_key: 'anything', owner_ghii: V.ownerGhii, recipient_ghii: `someone@${C_NODE}`,
        timestamp: new Date().toISOString(),
    });
    assert(grant.status === 403 && grant.body.error?.code === 'POLICY_DENIED',
        `a muted link closes the attachment door, got ${grant.status} ${grant.body.error?.code}`);

    // Put it back, so the suite leaves the peer as it found it.
    await V.json(`/v1/federation/peers/${C_NODE}`, {
        method: 'PUT', headers: auth(V.ownerToken), body: JSON.stringify({ allow_messaging: true }),
    });
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
V!.server.close();
process.exit(failed > 0 ? 1 : 0);

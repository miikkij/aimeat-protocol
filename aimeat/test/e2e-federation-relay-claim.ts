/**
 * @file e2e-federation-relay-claim.ts
 * @description Can a receiving node refuse a relay it does not want? Until 2026-09-03 it could not.
 *
 *   Stage B measured the hole on 2026-09-02: demoting peer B on node A did not stop B relaying into
 *   A, because `allowRouting` was read only on the SENDER. This drives the receiving half against a
 *   real server: a signed relay claim is accepted, and every way of getting it wrong is refused with
 *   a sentence that names the LINK between the two nodes rather than the caller being relayed for.
 *
 *   THE RELAYING PEER IS A KEYPAIR, NOT A RUNNING NODE — the same shape e2e-federation-contact-link
 *   uses. Nothing here needs the peer to answer, only to sign, and building the claim by hand rather
 *   than calling buildRelayClaim() is deliberate: the test independently re-derives the wire format,
 *   so an encoder and a decoder that stopped agreeing would fail here instead of in production.
 *
 *   WHAT IS ASSERTED IS THE WHOLE ANSWER, not just the status. A gate that refuses with the wrong
 *   code teaches the relaying operator to look at their caller's permissions, which is the one place
 *   the problem is not.
 *
 *   Node R (receiver) 40293. Peers: relay-ok (permitted), relay-demoted (allowRouting false).
 * @version-history
 *   v1.3.0 — 2026-09-25 — One peer on its own setting, both ways round; the words the setting takes;
 *     and the federation answer naming who relays with a claim and who without, and when.
 *   v1.2.0 — 2026-09-24 — A re-spelled copy of a spent claim is refused as the same claim
 *     (audit A4-3).
 *   v1.1.0 — 2026-09-17 — A multi-hop hop is admitted to POST /v1/federation/route on its verified
 *     claim alone; a claim for another path, a claim on another owner door, and a request with
 *     neither are each refused.
 *   v1.0.0 — 2026-09-03 — Initial (wish-vastaanottaja-voi-kieltaytya-relaysta).
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-relay-claim.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
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

// 40293: free, and checked against every other suite before it was picked. A port two suites share
// makes a red run that reads exactly like a regression — e2e-sealed-config already holds 40291.
const PORT = 40293;
/** Its own file, and sqlite rather than memory: PUT /v1/admin/config refuses without persistence,
 *  and the strict setting has to be reachable at runtime for the test that turns it on. */
const DB_PATH = `./test/.relay-claim-${process.pid}.db`;
const NODE_ID = 'aimeat-test-001-relayrx';
const BASE = `http://127.0.0.1:${PORT}`;

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

let server!: Server;
let adminPw = '';
let ownerToken = '';
const auth = () => ({ Authorization: `Bearer ${ownerToken}` });

/** The two relaying nodes, as keypairs. Neither one runs. */
const OK_NODE = 'aimeat-test-001-relayok';
const DEMOTED_NODE = 'aimeat-test-001-relaybad';
let okKeys!: { publicKey: string; privateKey: string };
let demotedKeys!: { publicKey: string; privateKey: string };
/** A key the receiver has never pinned, for the "signed by a stranger" case. */
let strangerKeys!: { publicKey: string; privateKey: string };

/**
 * The wire format, written out by hand so the test does not inherit the implementation's opinion of
 * it. base64url of the exact JSON, plus a detached signature over those same bytes.
 */
async function claimHeaders(
    keys: { privateKey: string },
    over: { relay: string; aud?: string; method: string; path: string; caller?: string; iat?: number; exp?: number; jti?: string },
): Promise<Record<string, string>> {
    const iat = over.iat ?? Math.floor(Date.now() / 1000);
    const claim = {
        relay: over.relay,
        aud: over.aud ?? NODE_ID,
        method: over.method.toUpperCase(),
        path: over.path,
        caller: over.caller ?? 'someone@somewhere',
        iat,
        exp: over.exp ?? iat + 300,
        jti: over.jti ?? randomUUID(),
    };
    const raw = JSON.stringify(claim);
    return {
        'X-Relay-Claim': Buffer.from(raw, 'utf-8').toString('base64url'),
        'X-Relay-Signature': await sign(keys.privateKey, raw),
        'X-Forwarded-From': claim.relay,
    };
}

console.log('\n=== AIMEAT Federation Relay Claim E2E ===\n');

await test('Setup: a receiving node, an owner, and two peers — one permitted to relay, one demoted', async () => {
    adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = NODE_ID;
    process.env.AIMEAT_BASE_URL = BASE;
    process.env.AIMEAT_STORAGE = 'sqlite';
    process.env.AIMEAT_SQLITE_PATH = DB_PATH;
    const { config } = loadConfig({});
    config.port = PORT; config.nodeId = NODE_ID; config.baseUrl = BASE;
    config.devMode = true; config.testMode = true; config.adminPassword = adminPw; config.storageProvider = 'sqlite'; config.sqlitePath = DB_PATH;
    const { app } = await createServer(config);
    server = await new Promise<Server>(resolve => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ name: 'relayowner' }),
    });
    assert(reg.status === 200 && reg.body.ok, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': adminPw },
        body: JSON.stringify({ owner: 'relayowner', private_key: reg.body.private_key }),
    });
    assert(tok.body.ok, `token: ${JSON.stringify(tok.body)}`);
    ownerToken = tok.body.token;

    okKeys = await generateKeyPair();
    demotedKeys = await generateKeyPair();
    strangerKeys = await generateKeyPair();

    for (const [nodeId, keys] of [[OK_NODE, okKeys], [DEMOTED_NODE, demotedKeys]] as const) {
        const add = await json('/v1/federation/peers', {
            method: 'POST', headers: auth(),
            body: JSON.stringify({ node_id: nodeId, url: `https://${nodeId}.example`, public_key: keys.publicKey }),
        });
        assert(add.status === 201, `add ${nodeId}: ${add.status} ${JSON.stringify(add.body)}`);
        const up = await json(`/v1/federation/peers/${nodeId}`, {
            method: 'PUT', headers: auth(),
            body: JSON.stringify({ status: 'active', allow_routing: nodeId === OK_NODE }),
        });
        assert(up.status === 200, `activate ${nodeId}: ${up.status} ${JSON.stringify(up.body)}`);
    }
});

// ── The happy path, and the promise that nothing else changed ────────────────

await test('an ordinary request carrying no relay headers is untouched', async () => {
    const r = await json('/v1/health');
    assert(r.status === 200, `health without relay headers: ${r.status}`);
});

await test('a relay carrying a valid claim from a peer the receiver permits is accepted', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 200, `permitted relay: ${res.status} ${await res.text()}`);
});

// ── Replay ───────────────────────────────────────────────────────────────────

await test('the same claim replayed is refused, and the refusal says SPENT rather than invalid', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' });
    const first = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(first.status === 200, `first use: ${first.status}`);

    const second = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(second.status === 403, `replay: ${second.status}`);
    const body = await second.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_SPENT', `code: ${body.error.code}`);
    // The distinction matters to whoever has to fix it: "invalid" sends them to look at their
    // signing, "already used" sends them to look at why the same claim went out twice.
    assert(/already been used/i.test(body.error.message), `message: ${body.error.message}`);
});

await test('a re-spelled copy of a spent claim is the same claim, refused as SPENT (audit A4-3)', async () => {
    // Base64url decoding ignores padding and skips characters outside its alphabet, so one claim has
    // endless spellings that decode to the same signed bytes. The spend used to be keyed on the
    // spelling, which made each copy a fresh claim. It is keyed on the relay, aud and jti now.
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' });
    const first = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(first.status === 200, `first use: ${first.status}`);
    for (const respelt of [`${h['X-Relay-Claim']}=`, `${h['X-Relay-Claim']}==`, `${h['X-Relay-Claim']}!`]) {
        const again = await fetch(`${BASE}/v1/health`, { headers: { ...h, 'X-Relay-Claim': respelt } });
        assert(again.status === 403, `re-spelled as ...${respelt.slice(-3)}: ${again.status}`);
        const body = await again.json() as any;
        assert(body.error.code === 'RELAY_CLAIM_SPENT', `re-spelled as ...${respelt.slice(-3)}: ${body.error.code}`);
    }
});

// ── Wrong proof ──────────────────────────────────────────────────────────────

await test('a claim signed by a key the receiver has not pinned is refused', async () => {
    // The claim NAMES a peer the receiver knows and permits; only the signature is a stranger's.
    // Signing it with the stranger's own node id would be refused one step earlier, for a different
    // reason, and would not test this.
    const h = await claimHeaders(strangerKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 403, `stranger's key: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_UNSIGNED', `code: ${body.error.code}`);
});

await test('a claim for a different method than the request carries is refused', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'DELETE', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 403, `method mismatch: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_MISMATCH', `code: ${body.error.code}`);
});

await test('a claim for a different path than the request carries is refused', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/nodeinfo`, { headers: h });
    assert(res.status === 403, `path mismatch: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_MISMATCH', `code: ${body.error.code}`);
    assert(body.error.message.includes('/v1/health'), `the refusal names what was signed: ${body.error.message}`);
});

// ── A multi-hop hop authenticates with its claim, and only there ─────────────
//
// A peer forwarding a route holds no credential of this node, so from 2026-09-16 (when the relay
// stopped forwarding the caller's token) every hop was refused at the door and multi-hop answered
// "no route". The claim is the hop's credential now. These pin both halves: the hop gets in on the
// claim alone, and the claim opens that one door and nothing else.

await test('a hop to /v1/federation/route is admitted on its verified claim, with no token', async () => {
    // The relay path already names OK_NODE, so the handler has no peer left to try and answers
    // "no route" without touching the network. Reaching that answer is the proof the door opened.
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'POST', path: '/v1/federation/route', caller: 'alice@aimeat-test-001-relayok' });
    const res = await fetch(`${BASE}/v1/federation/route`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'X-Relay-Path': OK_NODE, 'X-Relay-Hops': '2' },
        body: JSON.stringify({ target_node: 'aimeat-test-001-nowhere', method: 'GET', path: '/v1/health' }),
    });
    const body = await res.json() as any;
    assert(res.status === 404, `claimed hop: ${res.status} ${JSON.stringify(body)}`);
    assert(body.error.code === 'FEDERATION_ERROR' && /No route/.test(body.error.message), `reached the handler: ${JSON.stringify(body.error)}`);
});

await test('without a claim, the route door still asks for an owner of this node → 401', async () => {
    const r = await json('/v1/federation/route', {
        method: 'POST', body: JSON.stringify({ target_node: DEMOTED_NODE, method: 'GET', path: '/v1/health' }),
    });
    assert(r.status === 401, `no claim, no token: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('a claim signed for another path does not open the route door', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'POST', path: '/v1/memory' });
    const res = await fetch(`${BASE}/v1/federation/route`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_node: DEMOTED_NODE, method: 'GET', path: '/v1/health' }),
    });
    assert(res.status === 403, `claim for another path: ${res.status}`);
    assert(((await res.json()) as any).error.code === 'RELAY_CLAIM_MISMATCH', 'refused by the gate for the path');
});

await test('a verified claim authenticates no other door → 401 on the peer list', async () => {
    // The claim verifies (right method, right path), so the gate lets the request on. The peer list
    // then asks for its own credential, and the claim is not one.
    const h = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/federation/peers' });
    const res = await fetch(`${BASE}/v1/federation/peers`, { headers: h });
    assert(res.status === 401, `claim on an owner door: ${res.status} ${await res.text()}`);
});

await test('a claim written for another node is refused here', async () => {
    const h = await claimHeaders(okKeys, { relay: OK_NODE, aud: 'aimeat-test-001-elsewhere', method: 'GET', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 403, `wrong audience: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_WRONG_NODE', `code: ${body.error.code}`);
});

await test('an expired claim is refused, and one with an over-long life is refused as too long', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health', iat: now - 600, exp: now - 300 });
    const a = await fetch(`${BASE}/v1/health`, { headers: expired });
    assert(a.status === 403 && (await a.json() as any).error.code === 'RELAY_CLAIM_EXPIRED', 'expired claim');

    const forever = await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health', iat: now, exp: now + 86_400 });
    const b = await fetch(`${BASE}/v1/health`, { headers: forever });
    assert(b.status === 403, `long-lived claim: ${b.status}`);
    const body = await b.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_TOO_LONG', `code: ${body.error.code}`);
});

await test('a claim from a node this receiver does not peer with at all is refused', async () => {
    const h = await claimHeaders(strangerKeys, { relay: 'aimeat-test-001-nobody', method: 'GET', path: '/v1/health' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 403, `unknown peer: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_PEER_UNKNOWN', `code: ${body.error.code}`);
});

// ── The whole point: a demoted peer ──────────────────────────────────────────

await test('a peer the receiver has demoted is refused, and the refusal names the relationship rather than the caller', async () => {
    const h = await claimHeaders(demotedKeys, { relay: DEMOTED_NODE, method: 'GET', path: '/v1/health', caller: 'alice@somewhere' });
    const res = await fetch(`${BASE}/v1/health`, { headers: h });
    assert(res.status === 403, `demoted peer: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_NOT_PERMITTED', `code: ${body.error.code}`);
    const msg = body.error.message as string;
    // The failure must not surface to a person as their own permissions problem. It says whose
    // relationship this is, and it says the caller cannot fix it.
    assert(msg.includes(DEMOTED_NODE), `names the relaying node: ${msg}`);
    assert(/between our two nodes/.test(msg), `names the link: ${msg}`);
    assert(!msg.includes('alice@somewhere'), `must not blame the caller: ${msg}`);
});

await test('demoting a peer takes effect on the receiver, which is what Stage B measured missing', async () => {
    // The permitted peer works…
    const before = await fetch(`${BASE}/v1/health`, { headers: await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' }) });
    assert(before.status === 200, `before demotion: ${before.status}`);

    // …the operator demotes it here, on the RECEIVING node…
    const demote = await json(`/v1/federation/peers/${OK_NODE}`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ allow_routing: false }),
    });
    assert(demote.status === 200, `demote: ${demote.status} ${JSON.stringify(demote.body)}`);

    // …and the same peer, signing correctly, is refused.
    const after = await fetch(`${BASE}/v1/health`, { headers: await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' }) });
    assert(after.status === 403, `after demotion: ${after.status}`);
    assert(((await after.json()) as any).error.code === 'RELAY_NOT_PERMITTED', 'refused for the relationship');

    // Put it back for the tests below.
    const restore = await json(`/v1/federation/peers/${OK_NODE}`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ allow_routing: true }),
    });
    assert(restore.status === 200, `restore: ${restore.status}`);
});

// ── A relay with no claim at all ─────────────────────────────────────────────

await test('a peer that has NEVER signed a claim still relays through, on the shipped setting', async () => {
    // This is the migration position, and it is the reason decision 3 is a question rather than an
    // answer: an old peer sends no claim, and refusing it would break the relay the day this node
    // updates. It is not protection, and the setting's own text says so.
    const res = await fetch(`${BASE}/v1/health`, { headers: { 'X-Forwarded-From': DEMOTED_NODE } });
    assert(res.status === 200, `unclaimed relay from a never-signed peer: ${res.status}`);
});

await test('a peer that HAS signed a claim may not go back to sending none', async () => {
    // OK_NODE presented a valid claim earlier, so the receiver recorded that it can sign. The
    // downgrade is what would otherwise make the permissive setting worth nothing against an
    // updated peer: sign once, then simply stop.
    const res = await fetch(`${BASE}/v1/health`, { headers: { 'X-Forwarded-From': OK_NODE } });
    assert(res.status === 403, `downgrade: ${res.status}`);
    const body = await res.json() as any;
    assert(body.error.code === 'RELAY_CLAIM_REQUIRED', `code: ${body.error.code}`);
    assert(/between our two nodes/.test(body.error.message), `names the link: ${body.error.message}`);
});

await test('on the strict setting, an unclaimed relay from ANY peer is refused', async () => {
    const on = await json('/v1/admin/config', {
        method: 'PUT', headers: auth(),
        body: JSON.stringify({ changes: [{ path: 'federation.relay_claim', value: 'required' }] }),
    });
    assert(on.status === 200, `set required: ${on.status} ${JSON.stringify(on.body)}`);

    const res = await fetch(`${BASE}/v1/health`, { headers: { 'X-Forwarded-From': DEMOTED_NODE } });
    assert(res.status === 403, `unclaimed relay under required: ${res.status}`);
    assert(((await res.json()) as any).error.code === 'RELAY_CLAIM_REQUIRED', 'refused for the missing claim');

    // A properly signed claim from a permitted peer still works under the strict setting.
    const ok = await fetch(`${BASE}/v1/health`, { headers: await claimHeaders(okKeys, { relay: OK_NODE, method: 'GET', path: '/v1/health' }) });
    assert(ok.status === 200, `signed relay under required: ${ok.status}`);

    // And ordinary, unrelayed traffic is untouched by the strict setting — the gate is about
    // relays, not about everyone.
    const plain = await json('/v1/health');
    assert(plain.status === 200, `plain request under required: ${plain.status}`);

    const off = await json('/v1/admin/config', {
        method: 'PUT', headers: auth(),
        body: JSON.stringify({ changes: [{ path: 'federation.relay_claim', value: 'optional' }] }),
    });
    assert(off.status === 200, `back to optional: ${off.status}`);
});

// ── One peer on its own setting ──────────────────────────────────────────────
//
// The node-wide default turns `required` in 3.20.0 and `optional` goes in 4.0.0. Until then an
// operator can keep one peer on its own answer, and the gate reads that peer's answer first.

const THIRD_NODE = 'aimeat-test-001-relaythird';
const setNode = (value: 'optional' | 'required') => json('/v1/admin/config', {
    method: 'PUT', headers: auth(), body: JSON.stringify({ changes: [{ path: 'federation.relay_claim', value }] }),
});
const setPeer = (nodeId: string, relay_claim: unknown) => json(`/v1/federation/peers/${nodeId}/relay-claim`, {
    method: 'PUT', headers: auth(), body: JSON.stringify({ relay_claim }),
});
const unclaimedFrom = (nodeId: string) => fetch(`${BASE}/v1/health`, { headers: { 'X-Forwarded-From': nodeId } });

await test('the node on required and one peer kept on optional: an unclaimed relay naming that peer passes, others are refused', async () => {
    assert((await setNode('required')).status === 200, 'node set to required');
    const kept = await setPeer(DEMOTED_NODE, 'optional');
    assert(kept.status === 200, `keep the peer on optional: ${kept.status} ${JSON.stringify(kept.body)}`);
    assert(kept.body.data.relay_claim.setting === 'optional' && kept.body.data.relay_claim.effective === 'optional',
        `the answer says what now applies: ${JSON.stringify(kept.body.data)}`);

    const through = await unclaimedFrom(DEMOTED_NODE);
    assert(through.status === 200, `the kept peer relays without a claim: ${through.status}`);
    const other = await unclaimedFrom('aimeat-test-001-nobody');
    assert(other.status === 403, `a name with no setting of its own follows the node: ${other.status}`);
    const signer = await unclaimedFrom(OK_NODE);
    assert(signer.status === 403, `a peer that has signed before may not stop: ${signer.status}`);

    assert((await setPeer(DEMOTED_NODE, 'node')).status === 200, 'back to the node\'s answer');
    const followed = await unclaimedFrom(DEMOTED_NODE);
    assert(followed.status === 403, `following the node again, it is refused: ${followed.status}`);
    assert((await setNode('optional')).status === 200, 'node back to optional');
});

await test('the node on optional and one peer kept on required: an unclaimed relay naming that peer is refused', async () => {
    const keys = await generateKeyPair();
    const add = await json('/v1/federation/peers', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ node_id: THIRD_NODE, url: `https://${THIRD_NODE}.example`, public_key: keys.publicKey }),
    });
    assert(add.status === 201, `add ${THIRD_NODE}: ${add.status}`);
    // The existing peer door takes the setting too, beside the other flags.
    const up = await json(`/v1/federation/peers/${THIRD_NODE}`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ status: 'active', relay_claim: 'required' }),
    });
    assert(up.status === 200 && up.body.data.relay_claim === 'required', `peer door: ${up.status} ${JSON.stringify(up.body)}`);

    const refused = await unclaimedFrom(THIRD_NODE);
    assert(refused.status === 403, `required for this peer alone: ${refused.status}`);
    assert(((await refused.json()) as any).error.code === 'RELAY_CLAIM_REQUIRED', 'refused for the missing claim');
    const others = await unclaimedFrom(DEMOTED_NODE);
    assert(others.status === 200, `another peer still follows the node's optional: ${others.status}`);
});

await test('a setting that is not one of the three words is refused, and nothing changes', async () => {
    const bad = await setPeer(THIRD_NODE, 'sometimes');
    assert(bad.status === 400 && bad.body.error.code === 'INVALID_INPUT', `a stray word: ${bad.status} ${JSON.stringify(bad.body)}`);
    const none = await json(`/v1/federation/peers/${THIRD_NODE}/relay-claim`, { method: 'PUT', headers: auth(), body: '{}' });
    assert(none.status === 400, `no value is not "follow the node": ${none.status}`);
    const onDoor = await json(`/v1/federation/peers/${THIRD_NODE}`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ relay_claim: 'maybe', allow_messaging: false }),
    });
    assert(onDoor.status === 400, `the peer door refuses it before writing anything: ${onDoor.status}`);
    const ov = await json('/v1/admin/federation/overview', { headers: auth() });
    const row = ov.body.data.roster.find((r: any) => r.node_id === THIRD_NODE);
    assert(row.relay_claim.setting === 'required', `still required: ${JSON.stringify(row.relay_claim)}`);
    const unknown = await setPeer('aimeat-test-001-notapeer', 'optional');
    assert(unknown.status === 404, `a node that is not a peer: ${unknown.status}`);
});

await test('the federation answer says which peers relay with a claim, which without, and when', async () => {
    const ov = await json('/v1/admin/federation/overview', { headers: auth() });
    assert(ov.status === 200, `overview: ${ov.status}`);
    const d = ov.body.data;
    const ok = d.roster.find((r: any) => r.node_id === OK_NODE);
    assert(ok.relay_claim.state === 'signs', `the signing peer: ${JSON.stringify(ok.relay_claim)}`);
    assert(typeof ok.relay_claim.first_signed_at === 'string' && typeof ok.relay_claim.last_claimed_at === 'string',
        `with when it first and last signed: ${JSON.stringify(ok.relay_claim)}`);
    const demoted = d.roster.find((r: any) => r.node_id === DEMOTED_NODE);
    assert(demoted.relay_claim.state === 'sends_none', `the peer that sends none: ${JSON.stringify(demoted.relay_claim)}`);
    assert(typeof demoted.relay_claim.last_unclaimed_at === 'string' && demoted.relay_claim.first_signed_at === null,
        `with when it last relayed without one: ${JSON.stringify(demoted.relay_claim)}`);
    assert(d.relay_claims.not_ready.includes(DEMOTED_NODE) && !d.relay_claims.not_ready.includes(OK_NODE),
        `not ready names the right peer: ${JSON.stringify(d.relay_claims)}`);
    assert(d.relay_claims.ready.includes(OK_NODE), `ready names the signer: ${JSON.stringify(d.relay_claims.ready)}`);
    assert(d.relay_claims.kept_required.includes(THIRD_NODE), `and the kept one: ${JSON.stringify(d.relay_claims)}`);
    assert(d.relay_claims.node_setting === 'optional', `the node's own answer: ${d.relay_claims.node_setting}`);
    assert(d.relay_claims.default_becomes_required_in === '3.20.0' && d.relay_claims.optional_removed_in === '4.0.0',
        `the two versions are named: ${JSON.stringify(d.relay_claims)}`);
});

// ── The sender's own policy is unchanged ─────────────────────────────────────

await test("the sender's own allow_routing still governs what this node relays OUTWARD", async () => {
    // Both directions are enforced now and neither replaced the other. This is the pre-existing
    // check on POST /v1/federation/route, asserted here so a later change to the receiving half
    // cannot quietly take the sending half with it.
    const r = await json('/v1/federation/route', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ target_node: DEMOTED_NODE, method: 'GET', path: '/v1/health' }),
    });
    assert(r.status === 403, `outward relay to a demoted target: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'POLICY_DENIED', `code: ${r.body.error.code}`);
});

await test('Cleanup', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const suffix of ['', '-wal', '-shm']) {
        const p = DB_PATH + suffix;
        // eslint-disable-next-line aimeat/no-silent-catch -- the suite's own scratch file
        if (existsSync(p)) { try { rmSync(p); } catch { /* the suite's own scratch file */ } }
    }
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

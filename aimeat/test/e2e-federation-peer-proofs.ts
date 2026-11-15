/**
 * @file test/e2e-federation-peer-proofs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a federation peer's signature proves and what it does not. A peer's catalogue
 *   sync lists only its own providers' actions (audit 2026-11 M130): an action naming a provider on
 *   this node or a third node is skipped and named in `rejected`, and the peer's own action in the
 *   same sync lands. A peer key is an Ed25519 public key (audit 2026-11 L056): text that is not one,
 *   32 bytes off the curve, and a small-order key a forged signature passes for are refused 400
 *   INVALID_PEER_KEY at peer registration, peer update, key exchange and introduction, while a
 *   generated key still registers, exchanges and introduces.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-peer-proofs
 * @version-history
 *   2026-11-15 — Initial (audit 2026-11 M130 and L056).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { audienceProof, deliveryProof } from '../src/services/signed-node-request.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now();

async function keypair(): Promise<{ priv: string; pub: string }> {
    const secret = ed.utils.randomSecretKey();
    return { priv: Buffer.from(secret).toString('base64'), pub: Buffer.from(await ed.getPublicKeyAsync(secret)).toString('base64') };
}
async function signText(priv: string, text: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(text), Buffer.from(priv, 'base64'))).toString('base64');
}

/** A small-order point (the identity, encoded): under ZIP-215 the signature R = identity, s = 0 verifies against it for any text. */
const smallOrderKey = Buffer.from([1, ...new Array(31).fill(0)]).toString('base64');
const forgedSignature = Buffer.from([1, ...new Array(63).fill(0)]).toString('base64');
/** 32 bytes that are not a point on the curve. */
const offCurveKey = Buffer.from('a'.repeat(32)).toString('base64');
const BAD_KEYS: Array<[string, string]> = [['not a key', 'deadbeef1234567890abcdef'], ['small-order', smallOrderKey], ['off the curve', offCurveKey]];

let opToken = '';
let opName = '';
let plainToken = '';
let plainName = '';
const peerId = `aimeat-proofs-peer-${stamp}`;
const peer = await keypair();
const op = () => ({ Authorization: `Bearer ${opToken}` });

async function peerRow(nodeId: string): Promise<any> {
    const r = await json('/v1/federation/peers', { headers: op() });
    return (r.body.data.peers as any[]).find(p => p.node_id === nodeId);
}

/** A catalogue sync from the peer, signed and with the delivery proof a node of this version sends. */
async function catalogueSync(actions: unknown[]) {
    const payload = { source_node: peerId, actions, since_timestamp: undefined, catalogue_hash: undefined };
    const signed = JSON.stringify(payload);
    return json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({ ...payload, signature: await signText(peer.priv, signed), ...await deliveryProof(peer.priv, signed, NODE_ID) }),
    });
}

const actionUrl = (provider: string, id: string) => `/v1/actions/${encodeURIComponent(provider)}/${encodeURIComponent(`${peerId}:${id}`)}`;

console.log('\n=== Federation peer proofs: catalogue provenance and peer keys ===\n');

await test('Setup: the operator, a plain owner, and an active peer under a generated key', async () => {
    opName = `proofop${stamp}`;
    const operator = await registerOwner(BASE, opName);
    opToken = operator.token;
    assert(operator.roles.includes('operator'), `the first owner on a cleared node is the operator: ${JSON.stringify(operator.roles)}`);
    plainName = `proofplain${stamp}`;
    const plain = await registerOwner(BASE, plainName);
    plainToken = plain.token;
    assert(!plain.roles.includes('operator'), `the second owner is not an operator: ${JSON.stringify(plain.roles)}`);

    const add = await json('/v1/federation/peers', { method: 'POST', headers: op(), body: JSON.stringify({ node_id: peerId, url: 'http://localhost:9988', public_key: peer.pub }) });
    assert(add.status === 201, `a generated key registers: ${add.status} ${JSON.stringify(add.body.error)}`);
    const act = await json(`/v1/federation/peers/${peerId}`, { method: 'PUT', headers: op(), body: JSON.stringify({ status: 'active' }) });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body.error)}`);
});

console.log('\nCatalogue sync lists only the peer\'s own providers (M130)');

await test('REFUSED: an action naming a provider on this node or a third node is skipped and named; the peer\'s own action lands', async () => {
    const local = `x#${opName}@${NODE_ID}`;
    const third = `remoteagent#remoteowner@aimeat-third-node-${stamp}`;
    const own = `remoteagent#remoteowner@${peerId}`;
    const actions = [
        { id: `local-${stamp}`, provider_gaii: local, display_name: 'Claims a local provider', category: 'misc', tags: [] },
        { id: `third-${stamp}`, provider_gaii: third, display_name: 'Claims a third node', category: 'misc', tags: [] },
        { id: `own-${stamp}`, provider_gaii: own, display_name: 'The peer\'s own action', category: 'misc', tags: [] },
    ];
    const r = await catalogueSync(actions);
    assert(r.status === 200 && r.body.ok === true, `the sync itself proceeds: ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.synced === 1, `only the peer's own action is synced: ${JSON.stringify(r.body.data)}`);
    const rejected = (r.body.data.rejected ?? []) as Array<{ id: string; provider_gaii: string; reason: string }>;
    assert(rejected.length === 2, `two actions are named as rejected: ${JSON.stringify(r.body.data.rejected)}`);
    for (const a of actions.slice(0, 2)) {
        const named = rejected.find(x => x.id === a.id);
        assert(!!named && named.provider_gaii === a.provider_gaii && named.reason.includes(peerId), `${a.id} is named with a reason that names the signing node: ${JSON.stringify(named)}`);
        const read = await json(actionUrl(a.provider_gaii, a.id));
        assert(read.status === 404, `${a.id} must not be stored under ${a.provider_gaii}: ${read.status}`);
    }
    const ownRead = await json(actionUrl(own, actions[2]!.id));
    assert(ownRead.status === 200 && ownRead.body.data.provider_gaii === own, `the peer's own action is stored: ${ownRead.status} ${JSON.stringify(ownRead.body.error)}`);
});

await test('A sync of the peer\'s own agents and people lands whole, and its answer carries no rejected list', async () => {
    const agent = `summarizer#remoteowner@${peerId}`;
    const person = `remoteowner@${peerId}`;
    const actions = [
        { id: `agent-${stamp}`, provider_gaii: agent, display_name: 'Remote Summarize', category: 'nlp', pricing: { base_morsels: 2 }, tags: ['nlp'] },
        { id: `person-${stamp}`, provider_gaii: person, display_name: 'Remote Review', category: 'misc', tags: [] },
    ];
    const r = await catalogueSync(actions);
    assert(r.status === 200 && r.body.data.synced === 2 && r.body.data.total_received === 2, `both land: ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
    assert(!('rejected' in r.body.data), `a sync with nothing skipped answers as before: ${JSON.stringify(r.body.data)}`);
    for (const a of actions) {
        const read = await json(actionUrl(a.provider_gaii, a.id));
        assert(read.status === 200, `${a.id} is stored: ${read.status}`);
    }
    const again = await catalogueSync([{ ...actions[0]!, display_name: 'Remote Summarize v2' }]);
    assert(again.status === 200 && again.body.data.updated === 1 && again.body.data.synced === 0, `an update of the peer's own action: ${JSON.stringify(again.body.data)}`);
});

console.log('\nA peer key is an Ed25519 public key (L056)');

// The designed uses first, so each one is shown on the code before the fix as well as after it.
await test('A key exchange with the key on file is accepted as before', async () => {
    const r = await json('/v1/federation/key-exchange', { method: 'POST', body: JSON.stringify({ node_id: peerId, node_public_key: peer.pub, capabilities: ['actions'] }) });
    assert(r.status === 200 && r.body.data.accepted === true, `key exchange: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
});

await test('An introduction under a generated key still lands as a request for the operator', async () => {
    const k = await keypair();
    const nodeId = `aimeat-goodintro-${stamp}`;
    const nodeUrl = 'http://localhost:9985';
    const timestamp = new Date().toISOString();
    const signed = `${nodeId}${nodeUrl}${timestamp}`;
    const r = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({ node_id: nodeId, node_url: nodeUrl, public_key: k.pub, role: 'contributor', timestamp, signature: await signText(k.priv, signed), ...await audienceProof(k.priv, signed, NODE_ID) }),
    });
    assert((r.status === 202 || r.status === 200) && typeof r.body.data?.request_id === 'string', `introduction: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
});

await test('A peer\'s key is changed to another generated key by the operator, and back', async () => {
    const other = await keypair();
    const set = await json(`/v1/federation/peers/${peerId}`, { method: 'PUT', headers: op(), body: JSON.stringify({ public_key: other.pub }) });
    assert(set.status === 200 && (await peerRow(peerId))?.public_key === other.pub, `set: ${set.status} ${JSON.stringify(set.body.error)}`);
    const back = await json(`/v1/federation/peers/${peerId}`, { method: 'PUT', headers: op(), body: JSON.stringify({ public_key: peer.pub }) });
    assert(back.status === 200 && (await peerRow(peerId))?.public_key === peer.pub, `back: ${back.status} ${JSON.stringify(back.body.error)}`);
});

await test('REFUSED: registering a peer under a key that is not an Ed25519 key, off the curve, or small-order is 400 and writes no row', async () => {
    for (const [label, key] of BAD_KEYS) {
        const nodeId = `aimeat-badkey-${label.replace(/\W+/g, '-')}-${stamp}`;
        const r = await json('/v1/federation/peers', { method: 'POST', headers: op(), body: JSON.stringify({ node_id: nodeId, url: 'http://localhost:9987', public_key: key }) });
        expectRefusal(r, 400, 'INVALID_PEER_KEY');
        assert(typeof r.body.error.message === 'string' && r.body.error.message.length > 20, `${label}: the refusal says why`);
        assert(!(await peerRow(nodeId)), `${label}: no peer row is written`);
    }
});

await test('REFUSED: updating a peer to such a key is 400, and the peer keeps its key', async () => {
    for (const [, key] of BAD_KEYS) {
        const r = await json(`/v1/federation/peers/${peerId}`, { method: 'PUT', headers: op(), body: JSON.stringify({ public_key: key }) });
        expectRefusal(r, 400, 'INVALID_PEER_KEY');
    }
    assert((await peerRow(peerId))?.public_key === peer.pub, 'the peer keeps its key');
});

await test('REFUSED: a key exchange presenting such a key is 400, and the peer keeps its key', async () => {
    for (const [, key] of BAD_KEYS) {
        const r = await json('/v1/federation/key-exchange', {
            method: 'POST', body: JSON.stringify({ node_id: peerId, node_public_key: key, timestamp: new Date().toISOString(), signature: forgedSignature }),
        });
        expectRefusal(r, 400, 'INVALID_PEER_KEY');
    }
    assert((await peerRow(peerId))?.public_key === peer.pub, 'the peer keeps its key');
});

await test('REFUSED: an introduction under a small-order key, whose forged signature and audience proof verify, is 400 and leaves no request', async () => {
    const nodeId = `aimeat-smallorder-${stamp}`;
    const r = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: nodeId, node_url: 'http://localhost:9986', public_key: smallOrderKey, role: 'contributor', timestamp: new Date().toISOString(),
            signature: forgedSignature, audience: NODE_ID, audience_signature: forgedSignature,
        }),
    });
    expectRefusal(r, 400, 'INVALID_PEER_KEY');
    const list = await json('/v1/admin/peering/requests', { headers: op() });
    const held = (list.body.data.requests as any[]).filter(q => q.from_node_id === nodeId);
    assert(held.length === 0, `no peering request is stored: ${JSON.stringify(held)}`);
});

await test('REFUSED: a plain owner cannot register a peer even under a valid key', async () => {
    const k = await keypair();
    const r = await json('/v1/federation/peers', {
        method: 'POST', headers: { Authorization: `Bearer ${plainToken}` },
        body: JSON.stringify({ node_id: `aimeat-plain-${stamp}`, url: 'http://localhost:9984', public_key: k.pub }),
    });
    expectRefusal(r, 403);
});

await test('Cleanup: the peer and both owners are removed', async () => {
    const del = await json(`/v1/federation/peers/${peerId}?emergency=true`, { method: 'DELETE', headers: op() });
    assert(del.status === 200, `remove peer: ${del.status} ${JSON.stringify(del.body.error)}`);
    for (const [name, token] of [[plainName, plainToken], [opName, opToken]]) {
        const r = await json(`/v1/owners/${name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        assert(r.status === 200, `delete ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
    }
});

finish();

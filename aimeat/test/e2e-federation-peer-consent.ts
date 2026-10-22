/**
 * @file test/e2e-federation-peer-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A linked peer acts for a person of this node only with that person's sign-in consent,
 *   on two real nodes (secaudit 2026-10 wave 3, v70 and v71).
 *
 *   WHY. POST /v1/federation/memory/list listed, and POST /v1/federation/replicate wrote into, any
 *   local person a signed member peer named in the body. Neither read a consent of that person. The
 *   two routes exist for a person of B who is signed in on A as a visitor (list-home, push-home), and
 *   B let that visitor sign in on A only after it found the person's sign-in consent for A. So the
 *   consent is the boundary on both routes now (services/federation-auth-consent.ts).
 *
 *   WHAT IT ASSERTS. Node B is the home node, node A the peer; each holds the other as an active
 *   member peer, and A accepts sign-ins from its peers.
 *     - Refused without the consent: A lists the key names of a person of B who never consented (403
 *       CONSENT_REQUIRED, no entries), of that person's agent, and of a third node's person (403
 *       NAMESPACE_NOT_ALLOWED); A replicates a record under that person or their agent (403, nothing
 *       stored).
 *     - Kept: the person gives the consent on the Access tab's route (POST /v1/consent), signs in on
 *       A with their home password, and on A lists their records at home (list-home) and saves a record
 *       home (push-home). A home user of A lists what B holds under their own identity (list-remote),
 *       and A replicates one of its own people. The person's agent is listed and written to on the
 *       owner's consent.
 *     - The consent ends it: revoked, the list and the replicate are refused again, and so is
 *       list-home through the visitor session that is still open; an ended consent is no consent;
 *       the consent for every server ('*') counts.
 *
 *   Nodes A and B boot in this process (test/helpers/federation-two-node.ts) on their own ports,
 *   blocks 30700 and 30800 (test/helpers/free-port.ts). A is booted with federated sign-in from
 *   all peers (AIMEAT_FEDERATION_AUTH_POLICY=all_peers), which the shipped default keeps off, and its
 *   peer record for B lets a visitor read and write (federation_auth_scopes), so the visitor can pull
 *   a record and push it home; the runner's own node keeps its defaults.
 *
 *   PURPOSE TIER (2026-10-22). Proved once: with the requesting node's own principals refused and the
 *   consent check answering "no" in both routes, list-home, push-home, the agent on the owner's
 *   consent, list-remote, A's own replicate, the ended-consent case (while it holds) and the '*'
 *   case went red, 7 of 15; the files were restored byte for byte. With the agent's owner's consent
 *   not read in the replicate, R2 went red alone.
 * @structure Setup · 1 refused without the consent · 2 the uses with the consent · 3 the consent ends
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federation-peer-consent
 * @version-history
 *   v1.1.0 — 2026-10-22 — A replicate into a person's agent needs the owner's consent (R2, and the
 *     owner's-consent case); the suite joins the purpose tier (the developer's ruling of 2026-10-22).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10 wave 3, v70 and v71).
 */
import type { Server } from 'node:http';
import { sign } from '../src/auth/keypair.js';
import { audienceProof, deliveryProof } from '../src/services/signed-node-request.js';
import { bootNode, setupOperator, addPeer, auth, sleep, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner, ownerSignIn, type RegisteredOwner } from './helpers/owner-login.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const A_ID = `aimeat-consent-a-${stamp}`;
const B_ID = `aimeat-consent-b-${stamp}`;
const THIRD_ID = 'aimeat-peer-001-elsewhere';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let A!: NodeState;
let B!: NodeState;
let alice!: RegisteredOwner;   // a person of B who gives A the sign-in consent
let bob!: RegisteredOwner;     // a person of B who never does
let bobAgent = '';
let aliceAgent = '';
let aliceConsentId = '';
let visitorToken = '';          // alice's visitor session on A

/** Each signed request gets a timestamp of its own, so no two share a signature. */
let tick = 0;
const freshTs = () => new Date(Date.now() + tick++).toISOString();

/** POST /v1/federation/memory/list on B, signed by A as A's own client signs it. */
async function listAsA(gaii: string) {
    const timestamp = freshTs();
    const signed = JSON.stringify({ requesting_node: A_ID, gaii, timestamp });
    return B.json('/v1/federation/memory/list', {
        method: 'POST',
        body: JSON.stringify({ requesting_node: A_ID, gaii, timestamp, signature: await sign(A.nodeKey.privateKey, signed), ...await audienceProof(A.nodeKey.privateKey, signed, B_ID) }),
    });
}

/** POST /v1/federation/replicate on B, signed by A over the seven fields, with A's delivery proof. */
async function replicateAsA(gaii: string, key: string) {
    const payload = { source_node: A_ID, gaii, key, value: { from: 'A' }, visibility: 'public', version: 1, timestamp: freshTs() };
    const signed = JSON.stringify(payload);
    return B.json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({ ...payload, signature: await sign(A.nodeKey.privateKey, signed), ...await deliveryProof(A.nodeKey.privateKey, signed, B_ID) }),
    });
}

/** A person of B gives A the sign-in consent, as the Access tab does. */
async function grantSignIn(person: RegisteredOwner, recipient: string, expires?: string): Promise<string> {
    const r = await B.json('/v1/consent', {
        method: 'POST', headers: auth(person.token),
        body: JSON.stringify({ data_pattern: '_identity', recipient, scope: 'auth', purpose: 'federation_login', ...(expires ? { expires } : {}) }),
    });
    assert(r.status === 201, `grant the sign-in consent: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data?.id ?? r.body.data?.consent?.id;
}
async function revoke(person: RegisteredOwner, id: string): Promise<void> {
    const r = await B.json(`/v1/consent/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(person.token) });
    assert(r.status === 200, `revoke the consent: ${r.status} ${JSON.stringify(r.body?.error)}`);
}
async function newAgent(person: RegisteredOwner, name: string): Promise<string> {
    const r = await B.json('/v1/agents', {
        method: 'POST', headers: auth(person.token),
        body: JSON.stringify({ name, owner: person.name, capabilities: ['memory'] }),
    });
    assert(r.status === 201, `create agent ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.agent.gaii;
}
async function writeOwn(person: RegisteredOwner, key: string, visibility = 'private'): Promise<void> {
    const r = await B.json('/v1/memory', { method: 'POST', headers: auth(person.token), body: JSON.stringify({ key, value: { note: key }, visibility }) });
    assert(r.status === 201, `write ${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}
const keysOf = (r: { body: any }) => ((r.body?.data?.entries ?? []) as Array<{ key: string }>).map(e => e.key);

console.log('\n=== Federation: a peer acts for a person here only with that person\'s sign-in consent ===\n');

const servers: Server[] = [];
try {
    console.log('Setup');
    await test('A (accepts sign-ins from its peers) and B boot, and each holds the other as an active member peer', async () => {
        A = await bootNode(suitePort(30700, RUNNER_BASE), A_ID, { federationAuthPolicy: 'all_peers' });
        servers.push(A.server);
        B = await bootNode(suitePort(30800, RUNNER_BASE), B_ID);
        servers.push(B.server);
        assert(A.nodeKey.publicKey !== B.nodeKey.publicKey, 'A and B hold the same node key; no signature below would mean anything');
        await setupOperator(A, `cona${stamp}`);
        await setupOperator(B, `conb${stamp}`);
        // A visitor from B may read and write here, so the visitor can pull a record and push it home.
        await addPeer(A, B_ID, B.baseUrl, B.nodeKey.publicKey, { tier: 'member', replicate_memory: true, federation_auth_scopes: ['memory:read', 'memory:write', 'catalogue:read'] });
        await addPeer(B, A_ID, A.baseUrl, A.nodeKey.publicKey, { tier: 'member', replicate_memory: true });
    });

    await test('two persons on B, each with a private record and an agent; neither holds a consent', async () => {
        alice = await registerOwner(B.baseUrl, `alice${stamp}`);
        bob = await registerOwner(B.baseUrl, `bob${stamp}`);
        await writeOwn(alice, 'health.alice-note');
        await writeOwn(bob, 'health.bob-note');
        aliceAgent = await newAgent(alice, `ab${stamp}`);
        bobAgent = await newAgent(bob, `bb${stamp}`);
        for (const p of [alice, bob]) {
            const c = await B.storage.listConsents(p.ghii, { status: 'active' });
            assert(!c.some(x => x.scope === 'auth'), `${p.ghii} must start with no sign-in consent: ${JSON.stringify(c)}`);
        }
    });

    // ── 1. Refused without the consent (v70, v71) ──
    console.log('\nPhase 1 — refused without the consent');

    await test('L1. REFUSED — A lists the key names of a person of B who never consented: 403 CONSENT_REQUIRED, no entries', async () => {
        const r = await listAsA(bob.ghii);
        assert(r.status === 403 && r.body.error?.code === 'CONSENT_REQUIRED', `expected 403 CONSENT_REQUIRED, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(!r.body.data?.entries, 'no inventory may come back with the refusal');
        assert(String(r.body.error?.message).includes('Sign-in from other AIMEAT servers'), `the refusal names the control that answers it: ${r.body.error?.message}`);
    });

    await test('L2. REFUSED — A lists that person\'s agent (the owner gave no consent) and a third node\'s person', async () => {
        const agent = await listAsA(bobAgent);
        assert(agent.status === 403 && agent.body.error?.code === 'CONSENT_REQUIRED', `agent: ${agent.status} ${JSON.stringify(agent.body)}`);
        const third = await listAsA(`someone@${THIRD_ID}`);
        assert(third.status === 403 && third.body.error?.code === 'NAMESPACE_NOT_ALLOWED', `third node: ${third.status} ${JSON.stringify(third.body)}`);
    });

    await test('R1. REFUSED — A replicates a public record under a person of B who never consented: 403, nothing stored', async () => {
        const r = await replicateAsA(bob.ghii, 'planted');
        assert(r.status === 403 && r.body.error?.code === 'CONSENT_REQUIRED', `expected 403 CONSENT_REQUIRED, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(!(await B.storage.getMemory(bob.ghii, `replica:${A_ID}:planted`)), 'nothing may be stored under the person');
        const read = await B.json(`/v1/memory/${encodeURIComponent(bob.ghii)}/${encodeURIComponent(`replica:${A_ID}:planted`)}`);
        assert(read.status === 404, `no one can read a planted record: ${read.status}`);
    });

    await test('R2. REFUSED — A replicates under that person\'s agent: 403, nothing stored', async () => {
        const r = await replicateAsA(bobAgent, 'planted-agent');
        assert(r.status === 403 && r.body.error?.code === 'CONSENT_REQUIRED', `expected 403 CONSENT_REQUIRED, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(!(await B.storage.getMemory(bobAgent, `replica:${A_ID}:planted-agent`)), 'nothing may be stored under the agent');
    });

    // ── 2. The uses, with the consent ──
    console.log('\nPhase 2 — the uses, with the consent');

    await test('the person gives A the sign-in consent and signs in on A with the home password', async () => {
        aliceConsentId = await grantSignIn(alice, `node:${A_ID}`);
        const r = await ownerSignIn(A.baseUrl, `${alice.name}@${B_ID}`, alice.password);
        assert(r.status === 200 && r.body.data?.federated === true, `federated sign-in: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
        visitorToken = r.body.data.token;
    });

    await test('list-home: on A, the visitor lists their own records at home, the private one included', async () => {
        const r = await A.json('/v1/memory/list-home', { method: 'POST', headers: auth(visitorToken), body: '{}' });
        assert(r.status === 200 && r.body.data?.source_node === B_ID, `list-home: ${r.status} ${JSON.stringify(r.body)}`);
        assert(keysOf(r).includes('health.alice-note'), `the visitor's own record is listed: ${JSON.stringify(keysOf(r))}`);
    });

    await test('push-home: on A, the visitor pulls a record from home and saves it back to their account on B', async () => {
        const key = `trip.notes-${stamp}`;
        await writeOwn(alice, key, 'public');
        const pull = await A.json('/v1/memory/pull', { method: 'POST', headers: auth(visitorToken), body: JSON.stringify({ key }) });
        assert(pull.status === 200 && pull.body.data?.pulled === true, `pull: ${pull.status} ${JSON.stringify(pull.body)}`);
        const r = await A.json('/v1/memory/push-home', { method: 'POST', headers: auth(visitorToken), body: JSON.stringify({ key }) });
        assert(r.status === 200 && r.body.data?.pushed === true, `push-home: ${r.status} ${JSON.stringify(r.body)}`);
        const stored = await B.storage.getMemory(alice.ghii, `replica:${A_ID}:${key}`);
        assert(stored?.value && (stored.value as any).note === key, `the record lands at home under the person: ${JSON.stringify(stored)}`);
    });

    await test('the person\'s agent is listed, and written to, on the owner\'s consent', async () => {
        const r = await listAsA(aliceAgent);
        assert(r.status === 200 && Array.isArray(r.body.data?.entries), `agent on the owner's consent: ${r.status} ${JSON.stringify(r.body)}`);
        const rep = await replicateAsA(aliceAgent, 'agent-pref');
        assert(rep.status === 200 && !!(await B.storage.getMemory(aliceAgent, `replica:${A_ID}:agent-pref`)), `replicate into the agent: ${rep.status} ${JSON.stringify(rep.body)}`);
    });

    await test('list-remote: a home user of A lists what B holds under their own identity on A', async () => {
        const r = await A.json('/v1/memory/list-remote', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ peer_node_id: B_ID }) });
        assert(r.status === 200 && Array.isArray(r.body.data?.entries), `list-remote: ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('A replicates one of its own people\'s records to B, as memory replication does', async () => {
        const own = `someone${stamp}@${A_ID}`;
        const r = await replicateAsA(own, 'shared-pref');
        assert(r.status === 200 && r.body.data?.key === `replica:${A_ID}:shared-pref`, `own principal: ${r.status} ${JSON.stringify(r.body)}`);
        const listed = await listAsA(own);
        assert(listed.status === 200 && keysOf(listed).includes(`replica:${A_ID}:shared-pref`), `A lists its own principal: ${listed.status} ${JSON.stringify(listed.body)}`);
    });

    // ── 3. The consent ends it ──
    console.log('\nPhase 3 — the consent ends it');

    await test('revoked: A\'s list and replicate are refused again, and so is list-home through the open visitor session', async () => {
        await revoke(alice, aliceConsentId);
        const list = await listAsA(alice.ghii);
        assert(list.status === 403 && list.body.error?.code === 'CONSENT_REQUIRED', `list after revoke: ${list.status} ${JSON.stringify(list.body)}`);
        const rep = await replicateAsA(alice.ghii, 'after-revoke');
        assert(rep.status === 403 && rep.body.error?.code === 'CONSENT_REQUIRED', `replicate after revoke: ${rep.status} ${JSON.stringify(rep.body)}`);
        assert(!(await B.storage.getMemory(alice.ghii, `replica:${A_ID}:after-revoke`)), 'nothing is stored after the revoke');
        const home = await A.json('/v1/memory/list-home', { method: 'POST', headers: auth(visitorToken), body: '{}' });
        assert(home.status === 403 && !home.body.data?.entries, `list-home after revoke: ${home.status} ${JSON.stringify(home.body)}`);
    });

    await test('an ended consent is no consent, before the expiry job has marked it', async () => {
        await grantSignIn(alice, `node:${A_ID}`, new Date(Date.now() + 1500).toISOString());
        const during = await listAsA(alice.ghii);
        assert(during.status === 200, `while it holds: ${during.status} ${JSON.stringify(during.body)}`);
        await sleep(2500);
        const after = await listAsA(alice.ghii);
        assert(after.status === 403 && after.body.error?.code === 'CONSENT_REQUIRED', `after its end: ${after.status} ${JSON.stringify(after.body)}`);
    });

    await test('the consent for every server (\'*\') counts for A', async () => {
        const id = await grantSignIn(bob, '*');
        const list = await listAsA(bob.ghii);
        assert(list.status === 200 && keysOf(list).includes('health.bob-note'), `list on '*': ${list.status} ${JSON.stringify(list.body)}`);
        const rep = await replicateAsA(bob.ghii, 'on-wildcard');
        assert(rep.status === 200, `replicate on '*': ${rep.status} ${JSON.stringify(rep.body)}`);
        await revoke(bob, id);
    });
} finally {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

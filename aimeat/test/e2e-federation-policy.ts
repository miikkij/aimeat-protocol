/**
 * @file e2e-federation-policy.ts
 * @description Phase B governance E2E: uptime/availability measurement, network-policy doc
 *   (author → sign → GET → cross-node pull + verify), promotion eligibility + operator vouch
 *   (incl. forced override), and advisory-driven demotion. Mixes a unit check of the availability
 *   helper with two in-process nodes (A = authoring genesis, P = puller/peer).
 *
 *   Nodes: A 40275 aimeat-test-001-pola; P 40276 aimeat-test-001-polp.
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial Phase B tests (uptime, policy distribution, promotion, demotion).
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-policy.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { recordHeartbeatOutcome } from '../src/services/federation-availability.js';
import type { PeerInfo } from '../src/services/federation.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface NodeState { server: Server; baseUrl: string; nodeId: string; adminPw: string; ownerToken: string; json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>; }

function makeJson(baseUrl: string) {
  return async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
  };
}

async function bootNode(port: number, nodeId: string, openJoin: boolean): Promise<NodeState> {
  const adminPw = randomBytes(16).toString('base64url');
  process.env.AIMEAT_PORT = String(port);
  process.env.AIMEAT_DEV_MODE = 'true';
  process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
  process.env.AIMEAT_NODE_ID = nodeId;
  process.env.AIMEAT_BASE_URL = `http://localhost:${port}`;
  process.env.AIMEAT_STORAGE = 'memory';
  const { config } = loadConfig({});
  config.port = port; config.nodeId = nodeId; config.baseUrl = `http://localhost:${port}`;
  config.devMode = true; config.testMode = true; config.adminPassword = adminPw; config.storageProvider = 'memory';
  config.federationOpenJoin = openJoin;
  const { app } = await createServer(config);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(port, () => resolve(s)); });
  return { server, baseUrl: `http://localhost:${port}`, nodeId, adminPw, ownerToken: '', json: makeJson(`http://localhost:${port}`) };
}
async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
  const reg = await node.json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }) });
  assert(reg.status === 200 && reg.body.ok, `register ${ownerName}: ${reg.status}`);
  const tok = await node.json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }) });
  assert(tok.body.ok, `token ${ownerName}`); node.ownerToken = tok.body.token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function introduce(node: NodeState, nodeId: string, url: string, keys: { publicKey: string; privateKey: string }) {
  const timestamp = new Date().toISOString();
  const signature = await sign(keys.privateKey, `${nodeId}${url}${timestamp}`);
  return node.json('/v1/federation/peer/introduce', { method: 'POST', body: JSON.stringify({ node_id: nodeId, node_url: url, public_key: keys.publicKey, role: 'contributor', signature, timestamp }) });
}

console.log('\n=== AIMEAT Federation Policy / Phase B E2E ===\n');

const ts = Date.now();
let A: NodeState;
let P: NodeState;

console.log('Phase 0 — Availability helper (unit)');
await test('0. recordHeartbeatOutcome label transitions', async () => {
  const opts = { windowDays: 30, permanentThreshold: 90, minSamples: 10 };
  const peer = { nodeId: 'x', url: 'http://x', addedAt: new Date().toISOString() } as unknown as PeerInfo;
  const now = new Date('2026-06-19T12:00:00Z');
  recordHeartbeatOutcome(peer, true, now, opts);
  assert(peer.availability === 'unknown', `below min samples → unknown, got ${peer.availability}`);
  for (let i = 0; i < 11; i++) recordHeartbeatOutcome(peer, true, now, opts);
  assert(peer.availability === 'permanent' && (peer.availabilityPct ?? 0) >= 90, `all ok → permanent, got ${peer.availability}/${peer.availabilityPct}`);
  for (let i = 0; i < 12; i++) recordHeartbeatOutcome(peer, false, now, opts);
  assert(peer.availability === 'temporary', `mixed below threshold → temporary, got ${peer.availability} (${peer.availabilityPct}%)`);
  assert((peer.heartbeatTotal ?? 0) === 24, `total counted, got ${peer.heartbeatTotal}`);
});

console.log('\nSetup nodes');
await test('Boot A (genesis author, open-join) + P (puller)', async () => {
  A = await bootNode(40275, 'aimeat-test-001-pola', true);
  P = await bootNode(40276, 'aimeat-test-001-polp', true);
  await setupOwner(A, `pola${ts}`);
  await setupOwner(P, `polp${ts}`);
});

console.log('\nPhase 1 — Policy author + sign + public GET');
await test('1. operator authors a permissive policy; GET returns it signed', async () => {
  const put = await A.json('/v1/federation/network-policy', { method: 'PUT', headers: auth(A.ownerToken), body: JSON.stringify({ promotion_criteria: { min_availability_pct: 0, min_days_active: 0, min_successful_work: 0 } }) });
  assert(put.body.ok && put.body.data.policy.policy_version >= 1, `author: ${JSON.stringify(put.body)}`);
  const get = await A.json('/v1/federation/network-policy');
  assert(get.body.data.policy.signature && get.body.data.policy.issued_by === A.nodeId, `GET signed doc: ${JSON.stringify(get.body.data.policy)}`);
});

console.log('\nPhase 2 — Promotion eligibility + vouch');
let bKeys: { publicKey: string; privateKey: string };
await test('2. visiting peer is eligible under the permissive policy', async () => {
  bKeys = await generateKeyPair();
  const r = await introduce(A, 'aimeat-peer-001-polb', 'http://localhost:49990', bKeys);
  assert(r.body.data?.tier === 'visiting', `introduce visiting: ${JSON.stringify(r.body)}`);
  const peers = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
  const b = peers.body.data.peers.find((p: any) => p.node_id === 'aimeat-peer-001-polb');
  assert(b?.promotion_eligible === true, `expected eligible, got ${JSON.stringify(b)}`);
});

await test('3. operator promotes the eligible visiting peer', async () => {
  const r = await A.json('/v1/federation/peers/aimeat-peer-001-polb/promote', { method: 'POST', headers: auth(A.ownerToken), body: '{}' });
  assert(r.body.ok && r.body.data.tier === 'member' && r.body.data.was_eligible === true, `promote: ${JSON.stringify(r.body)}`);
});

await test('4. strict policy makes a fresh peer ineligible → promote 409 → force succeeds', async () => {
  await A.json('/v1/federation/network-policy', { method: 'PUT', headers: auth(A.ownerToken), body: JSON.stringify({ promotion_criteria: { min_days_active: 7, min_availability_pct: 90, min_successful_work: 3 } }) });
  const cKeys = await generateKeyPair();
  await introduce(A, 'aimeat-peer-001-polc', 'http://localhost:49991', cKeys);
  const peers = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
  const c = peers.body.data.peers.find((p: any) => p.node_id === 'aimeat-peer-001-polc');
  assert(c?.promotion_eligible === false && (c.promotion_failing || []).length > 0, `expected ineligible, got ${JSON.stringify(c)}`);
  const reject = await A.json('/v1/federation/peers/aimeat-peer-001-polc/promote', { method: 'POST', headers: auth(A.ownerToken), body: '{}' });
  assert(reject.status === 409 && reject.body.error?.code === 'NOT_ELIGIBLE', `expected 409, got ${reject.status}: ${JSON.stringify(reject.body)}`);
  const forced = await A.json('/v1/federation/peers/aimeat-peer-001-polc/promote', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ force: true }) });
  assert(forced.body.ok && forced.body.data.tier === 'member' && forced.body.data.forced === true, `force: ${JSON.stringify(forced.body)}`);
});

console.log('\nPhase 3 — Advisory demotion');
await test('5. a suspend advisory demotes a member back to visiting', async () => {
  // aimeat-peer-001-polb is currently a member (promoted in test 3).
  const adv = await A.json('/v1/federation/trust-advisory', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ target_node: 'aimeat-peer-001-polb', advisory_type: 'suspend', reason: 'test' }) });
  assert(adv.status === 201, `advisory: ${adv.status} ${JSON.stringify(adv.body)}`);
  const peers = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
  const b = peers.body.data.peers.find((p: any) => p.node_id === 'aimeat-peer-001-polb');
  assert(b?.tier === 'visiting' && b.allow_routing === false, `expected demoted to visiting, got ${JSON.stringify(b)}`);
});

console.log('\nPhase 4 — Cross-node policy pull + verify');
await test('6. pull from an unknown issuer is rejected (403)', async () => {
  // P has no peer A yet → cannot verify A's signature.
  const r = await P.json('/v1/federation/network-policy/pull', { method: 'POST', headers: auth(P.ownerToken), body: JSON.stringify({ source_url: A.baseUrl }) });
  assert(r.status === 403 && r.body.error?.code === 'UNKNOWN_ISSUER', `expected 403 UNKNOWN_ISSUER, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('7. peer A↔P, then P pulls + applies A\'s signed policy', async () => {
  // Bidirectional peering to exchange node public keys.
  for (const [from, to] of [[A, P], [P, A]] as [NodeState, NodeState][]) {
    await from.json('/v1/federation/peers', { method: 'POST', headers: auth(from.ownerToken), body: JSON.stringify({ node_id: to.nodeId, url: to.baseUrl }) });
    await from.json(`/v1/federation/peers/${to.nodeId}`, { method: 'PUT', headers: auth(from.ownerToken), body: JSON.stringify({ status: 'active' }) });
  }
  // activate P→A performs key exchange, caching A's node public key on P (peerKeyCache).
  const act = await P.json('/v1/federation/peer/activate', { method: 'POST', headers: auth(P.ownerToken), body: JSON.stringify({ peer_node_id: A.nodeId }) });
  assert(act.body.ok && act.body.data.key_exchange === 'completed', `key exchange: ${JSON.stringify(act.body)}`);
  const pull = await P.json('/v1/federation/network-policy/pull', { method: 'POST', headers: auth(P.ownerToken), body: JSON.stringify({ source_url: A.baseUrl }) });
  assert(pull.body.ok && pull.body.data.applied === true, `pull applied: ${JSON.stringify(pull.body)}`);
  const again = await P.json('/v1/federation/network-policy/pull', { method: 'POST', headers: auth(P.ownerToken), body: JSON.stringify({ source_url: A.baseUrl }) });
  assert(again.body.data.applied === false && again.body.data.reason === 'not_newer', `second pull not_newer: ${JSON.stringify(again.body)}`);
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`Federation Policy E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
try { A!.server.close(); P!.server.close(); } catch { /* noop */ }
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

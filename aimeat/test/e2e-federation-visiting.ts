/**
 * @file e2e-federation-visiting.ts
 * @description E2E for the lightweight "visiting node" federation tier. Boots two host nodes —
 *   A with open-join ON, C with open-join OFF — and a virtual joiner B (a node keypair). Verifies:
 *   a signed introduce self-admits as an active `visiting` peer on A (restricted flags +
 *   `auto_approved` request); the visiting cap actually bites (A refuses to route work to B);
 *   the directory shows the tier; open-join OFF still returns a pending request; a direct-added
 *   peer defaults to `member`; and an operator PUT { tier:'member' } promotes (re-derives full flags).
 *
 *   Nodes: A 40273 aimeat-test-001-fedvisa (open join on); C 40274 aimeat-test-001-fedvisc (off).
 *   Virtual joiner B: aimeat-peer-001-visitb (keypair only; not a running server).
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial visiting-tier tests (auto-join, caps, directory, promotion).
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-visiting.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
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

interface NodeState { server: Server; baseUrl: string; nodeId: string; adminPw: string; ownerName: string; ownerToken: string; json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>; }

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
  config.port = port;
  config.nodeId = nodeId;
  config.baseUrl = `http://localhost:${port}`;
  config.devMode = true;
  config.testMode = true;
  config.adminPassword = adminPw;
  config.storageProvider = 'memory';
  config.federationOpenJoin = openJoin;

  const { app } = await createServer(config);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(port, () => resolve(s)); });
  return { server, baseUrl: `http://localhost:${port}`, nodeId, adminPw, ownerName: '', ownerToken: '', json: makeJson(`http://localhost:${port}`) };
}

async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
  const reg = await node.json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }) });
  assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const tok = await node.json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }) });
  assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
  node.ownerName = ownerName;
  node.ownerToken = tok.body.token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIntroduce(privKey: string, node_id: string, node_url: string, timestamp: string): Promise<string> {
  return sign(privKey, `${node_id}${node_url}${timestamp}`);
}

console.log('\n=== AIMEAT Federation Visiting-Tier E2E ===\n');

let A: NodeState;
let C: NodeState;
const ts = Date.now();
const B_NODE = 'aimeat-peer-001-visitb';
const B_URL = 'http://localhost:49998'; // virtual joiner; not running
let bKeys: { publicKey: string; privateKey: string };

console.log('Setup');
await test('Boot A (open-join ON) + C (open-join OFF) + operators', async () => {
  A = await bootNode(40273, 'aimeat-test-001-fedvisa', true);
  C = await bootNode(40274, 'aimeat-test-001-fedvisc', false);
  await setupOwner(A, `fva${ts}`);
  await setupOwner(C, `fvc${ts}`);
  bKeys = await generateKeyPair();
});

console.log('\nPhase 1 — Auto-join as visiting');
await test('1. signed introduce self-admits as active visiting peer on A', async () => {
  const timestamp = new Date().toISOString();
  const signature = await signIntroduce(bKeys.privateKey, B_NODE, B_URL, timestamp);
  const r = await A.json('/v1/federation/peer/introduce', {
    method: 'POST',
    body: JSON.stringify({ node_id: B_NODE, node_url: B_URL, public_key: bKeys.publicKey, role: 'contributor', signature, timestamp }),
  });
  assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.status === 'active' && r.body.data.tier === 'visiting', `expected active/visiting, got ${JSON.stringify(r.body.data)}`);
});

await test('2. peer is listed as visiting with restricted flags', async () => {
  const r = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
  const b = r.body.data.peers.find((p: any) => p.node_id === B_NODE);
  assert(b !== undefined, 'B present in peers list');
  assert(b.tier === 'visiting', `tier visiting, got ${b.tier}`);
  assert(b.allow_routing === false, `allow_routing false, got ${b.allow_routing}`);
  assert(b.replicate_memory === false, `replicate_memory false, got ${b.replicate_memory}`);
  assert(b.allow_federated_auth === false, `allow_federated_auth false, got ${b.allow_federated_auth}`);
  assert(b.share_catalogue === true, `share_catalogue true, got ${b.share_catalogue}`);
});

console.log('\nPhase 2 — Visiting cap bites (no work routed to a visiting provider)');
await test('3. A refuses to route work to the visiting peer B', async () => {
  // Requester is A's operator (owner). Provider lives on visiting node B → must be refused.
  const r = await A.json('/v1/work', {
    method: 'POST',
    headers: auth(A.ownerToken),
    body: JSON.stringify({ action_id: 'noop', provider_gaii: `prov#carol@${B_NODE}`, input: {} }),
  });
  assert(r.status === 403 && r.body.error?.code === 'POLICY_DENIED', `expected 403 POLICY_DENIED, got ${r.status}: ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 3 — Federation book + open-join OFF + member default');
await test('4. directory shows B with tier visiting', async () => {
  const r = await A.json('/v1/federation/directory');
  const b = (r.body.data.peers || []).find((p: any) => p.node_id === B_NODE);
  assert(b !== undefined && b.tier === 'visiting', `B visiting in directory, got ${JSON.stringify(b)}`);
});

await test('5. open-join OFF (node C) → introduce stays pending, no peer created', async () => {
  const timestamp = new Date().toISOString();
  const signature = await signIntroduce(bKeys.privateKey, B_NODE, B_URL, timestamp);
  const r = await C.json('/v1/federation/peer/introduce', {
    method: 'POST',
    body: JSON.stringify({ node_id: B_NODE, node_url: B_URL, public_key: bKeys.publicKey, role: 'contributor', signature, timestamp }),
  });
  assert(r.status === 202 && r.body.data.status === 'pending', `expected 202 pending, got ${r.status}: ${JSON.stringify(r.body)}`);
  const peers = await C.json('/v1/federation/peers', { headers: auth(C.ownerToken) });
  assert(!peers.body.data.peers.some((p: any) => p.node_id === B_NODE), 'no peer created on C');
});

await test('6. directly added peer defaults to member tier', async () => {
  const r = await A.json('/v1/federation/peers', { method: 'POST', headers: auth(A.ownerToken), body: JSON.stringify({ node_id: 'aimeat-test-001-direct', url: 'http://localhost:49997' }) });
  assert(r.status === 201, `add peer: ${r.status} ${JSON.stringify(r.body)}`);
  const list = await A.json('/v1/federation/peers', { headers: auth(A.ownerToken) });
  const d = list.body.data.peers.find((p: any) => p.node_id === 'aimeat-test-001-direct');
  assert(d?.tier === 'member', `direct peer tier member, got ${d?.tier}`);
});

console.log('\nPhase 4 — Promotion (local operator vouch)');
await test('7. PUT { tier:member } promotes B → full member flags', async () => {
  const r = await A.json(`/v1/federation/peers/${B_NODE}`, { method: 'PUT', headers: auth(A.ownerToken), body: JSON.stringify({ tier: 'member' }) });
  assert(r.body.ok === true && r.body.data.tier === 'member', `promote: ${JSON.stringify(r.body)}`);
  assert(r.body.data.allow_routing === true && r.body.data.replicate_memory === true, `member flags re-derived, got ${JSON.stringify(r.body.data)}`);
});

await test('8. visiting peer cannot be silently granted routing without promotion', async () => {
  // Re-add a fresh visiting peer, then try to flip allow_routing via PUT without changing tier.
  const timestamp = new Date().toISOString();
  const k = await generateKeyPair();
  const vNode = 'aimeat-peer-001-visitd';
  const signature = await signIntroduce(k.privateKey, vNode, 'http://localhost:49996', timestamp);
  await A.json('/v1/federation/peer/introduce', { method: 'POST', body: JSON.stringify({ node_id: vNode, node_url: 'http://localhost:49996', public_key: k.publicKey, role: 'contributor', signature, timestamp }) });
  const r = await A.json(`/v1/federation/peers/${vNode}`, { method: 'PUT', headers: auth(A.ownerToken), body: JSON.stringify({ allow_routing: true }) });
  assert(r.body.data.allow_routing === false, `routing must stay false for visiting, got ${r.body.data.allow_routing}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Federation Visiting E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
try { A!.server.close(); C!.server.close(); } catch { /* noop */ }
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

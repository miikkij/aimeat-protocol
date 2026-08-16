/**
 * @file e2e-presence.ts
 * @description E2E tests for the presence/availability feature. Boots one node and exercises:
 *   own config CRUD, viewer-scoped visibility rules (everyone / nobody / invisible→offline /
 *   contacts hides from a stranger), the batch endpoint, and the FEDERATION contract — a signed
 *   peer push to POST /v1/federation/presence is cached and served via GET /v1/presence/:ghii,
 *   an `unknown` update evicts it, and bad-signature / non-peer pushes are rejected. Also checks the
 *   push-side snapshot the flush loop would send (via the in-process tracker singleton).
 *
 *   Node: port 40272, aimeat-test-001-presence (memory storage, in-process — same pattern as the
 *   federation-* suites, so the test shares the server's PresenceTracker instance).
 * @version-history
 *   v1.1.0 — 2026-08-16 — August 2026 test-quality audit (e2e-presence:160): test 10 proved an
 *     everyone owner IS in the federation snapshot and nothing proved the other two settings stay
 *     out of it. 10b drives bob through everyone → contacts → nobody and reads the tracker after
 *     each, with bob broadcastable first (an owner who never PUT is absent from a dead tracker too)
 *     and alice asserted still present (so the absence is bob's setting, not an empty list).
 *     Measured with the visibility filter removed: a contacts-only owner's busy status is pushed.
 *   v1.0.0 — 2026-06-19 — Initial presence test suite (local visibility + federated receive/serve).
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-presence.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { presence, presenceSignString, type PresenceUpdate } from '../src/services/presence.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const PORT = 40272;
const NODE_ID = 'aimeat-test-001-presence';
const BASE = `http://localhost:${PORT}`;
const adminPw = randomBytes(16).toString('base64url');

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}

async function bootNode(): Promise<Server> {
  process.env.AIMEAT_PORT = String(PORT);
  process.env.AIMEAT_DEV_MODE = 'true';
  process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
  process.env.AIMEAT_NODE_ID = NODE_ID;
  process.env.AIMEAT_BASE_URL = BASE;
  process.env.AIMEAT_STORAGE = 'memory';

  const { config } = loadConfig({});
  config.port = PORT;
  config.nodeId = NODE_ID;
  config.baseUrl = BASE;
  config.devMode = true;
  config.testMode = true;
  config.adminPassword = adminPw;
  config.storageProvider = 'memory';

  const { app } = await createServer(config);
  return new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
}

async function setupOwner(name: string): Promise<{ ghii: string; token: string }> {
  const reg = await json('/v1/admin/setup/register', {
    method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ name }),
  });
  assert(reg.status === 200 && reg.body.ok === true, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const tok = await json('/v1/admin/setup/token', {
    method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ owner: name, private_key: reg.body.private_key }),
  });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { ghii: `${name}@${NODE_ID}`, token: tok.body.token };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Presence E2E ===\n');

let server: Server;
const ts = Date.now();
let alice: { ghii: string; token: string };
let bob: { ghii: string; token: string };

console.log('Setup');
await test('Boot node + register two owners', async () => {
  server = await bootNode();
  alice = await setupOwner(`pa${ts}`);
  bob = await setupOwner(`pb${ts}`);
});

console.log('\nPhase 1 — Own config CRUD');
await test('1. GET /v1/presence/me returns defaults (auto / available / everyone)', async () => {
  const { status, body } = await json('/v1/presence/me', { headers: auth(alice.token) });
  assert(status === 200 && body.ok === true, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.config.mode === 'auto', `mode ${body.data.config.mode}`);
  assert(body.data.config.visibility === 'everyone', `visibility ${body.data.config.visibility}`);
  // No SSE stream open in the test → auto status computes offline.
  assert(body.data.status === 'offline', `auto status with no stream should be offline, got ${body.data.status}`);
});

await test('2. PUT manual/busy is reflected in GET me', async () => {
  const put = await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ mode: 'manual', status: 'busy' }) });
  assert(put.status === 200 && put.body.data.status === 'busy', `put: ${JSON.stringify(put.body)}`);
  const me = await json('/v1/presence/me', { headers: auth(alice.token) });
  assert(me.body.data.config.mode === 'manual' && me.body.data.status === 'busy', `me: ${JSON.stringify(me.body.data)}`);
});

await test('3. PUT rejects an invalid status', async () => {
  const { status, body } = await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ status: 'banana' }) });
  assert(status === 400 && body.ok === false, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

console.log('\nPhase 2 — Viewer-scoped visibility');
await test('4. everyone: Bob sees Alice as busy', async () => {
  const { body } = await json(`/v1/presence/${encodeURIComponent(alice.ghii)}`, { headers: auth(bob.token) });
  assert(body.data.status === 'busy', `expected busy, got ${body.data.status}`);
});

await test('5. nobody: Bob sees unknown', async () => {
  await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ visibility: 'nobody' }) });
  const { body } = await json(`/v1/presence/${encodeURIComponent(alice.ghii)}`, { headers: auth(bob.token) });
  assert(body.data.status === 'unknown', `expected unknown, got ${body.data.status}`);
});

await test('6. owner still sees their own real status under nobody', async () => {
  const me = await json('/v1/presence/me', { headers: auth(alice.token) });
  assert(me.body.data.status === 'busy', `owner should see own busy, got ${me.body.data.status}`);
});

await test('7. invisible: Bob sees offline even with everyone visibility', async () => {
  await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ visibility: 'everyone', status: 'invisible' }) });
  const { body } = await json(`/v1/presence/${encodeURIComponent(alice.ghii)}`, { headers: auth(bob.token) });
  assert(body.data.status === 'offline', `expected offline, got ${body.data.status}`);
});

await test('8. contacts: hidden (unknown) from a stranger', async () => {
  await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ visibility: 'contacts', status: 'away' }) });
  const { body } = await json(`/v1/presence/${encodeURIComponent(alice.ghii)}`, { headers: auth(bob.token) });
  assert(body.data.status === 'unknown', `expected unknown for non-contact, got ${body.data.status}`);
});

console.log('\nPhase 3 — Batch endpoint');
await test('9. batch returns a map for multiple ids', async () => {
  await json('/v1/presence/me', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ visibility: 'everyone', mode: 'manual', status: 'available' }) });
  const ids = `${encodeURIComponent(alice.ghii)},${encodeURIComponent(bob.ghii)}`;
  const { body } = await json(`/v1/presence?ids=${ids}`, { headers: auth(bob.token) });
  assert(body.data.presence[alice.ghii]?.status === 'available', `alice in batch: ${JSON.stringify(body.data.presence)}`);
  assert(body.data.presence[bob.ghii] !== undefined, 'bob present in batch');
});

console.log('\nPhase 4 — Federation push-build (snapshot the flush loop would send)');
await test('10. getSnapshot() includes a local everyone owner', async () => {
  // Alice is manual/available/everyone → broadcastable; snapshot should carry her.
  const snap = presence.getSnapshot();
  const entry = snap.find(u => u.ghii === alice.ghii);
  assert(entry !== undefined && entry.status === 'available', `snapshot should include alice available, got ${JSON.stringify(snap)}`);
});

// Test 10 proves an 'everyone' owner IS in the snapshot; nothing proved the other two settings stay
// out of it, and the snapshot is what the flush loop pushes to peers. Bob has to be broadcastable
// FIRST or his absence proves nothing: getSnapshot reads lastBroadcast, which recompute() writes
// only on setConfig or markOnline/markOffline, so an owner who never PUT is missing from a dead
// tracker and a live one alike.
await test('10b. only an everyone owner leaves the node — contacts and nobody do not', async () => {
  const on = await json('/v1/presence/me', {
    method: 'PUT', headers: auth(bob.token),
    body: JSON.stringify({ mode: 'manual', status: 'busy', visibility: 'everyone' }),
  });
  assert(on.status === 200, `bob everyone: ${on.status} ${JSON.stringify(on.body)}`);
  assert(on.body.data.config.visibility === 'everyone', `visibility echoed: ${JSON.stringify(on.body.data.config)}`);
  const withBob = presence.getSnapshot().find(u => u.ghii === bob.ghii);
  assert(withBob !== undefined && withBob.status === 'busy',
    `an everyone owner must be in the snapshot: ${JSON.stringify(presence.getSnapshot())}`);

  for (const hidden of ['contacts', 'nobody'] as const) {
    const set = await json('/v1/presence/me', {
      method: 'PUT', headers: auth(bob.token), body: JSON.stringify({ visibility: hidden }),
    });
    assert(set.status === 200, `bob ${hidden}: ${set.status} ${JSON.stringify(set.body)}`);
    const snap = presence.getSnapshot();
    assert(snap.find(u => u.ghii === bob.ghii) === undefined,
      `a '${hidden}' owner must not be pushed to peers: ${JSON.stringify(snap)}`);
    // …and the snapshot is still alive, so the absence above is bob's setting and not an empty list.
    const alice0 = snap.find(u => u.ghii === alice.ghii);
    assert(alice0 !== undefined && alice0.status === 'available',
      `alice must still be in the snapshot while bob is ${hidden}: ${JSON.stringify(snap)}`);
  }
});

console.log('\nPhase 5 — Federation receive + serve');
const REMOTE_NODE = 'aimeat-peer-001-remote';
const remoteGhii = `carol@${REMOTE_NODE}`;
let peerKeys: { publicKey: string; privateKey: string };

async function pushPresence(updates: PresenceUpdate[], signWith: string, fromNode = REMOTE_NODE) {
  const timestamp = new Date().toISOString();
  const signature = await sign(signWith, presenceSignString(fromNode, timestamp, updates));
  return json('/v1/federation/presence', { method: 'POST', body: JSON.stringify({ from_node_id: fromNode, timestamp, updates, signature }) });
}

await test('11. add + activate a peer with a known key', async () => {
  peerKeys = await generateKeyPair();
  const add = await json('/v1/federation/peers', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ node_id: REMOTE_NODE, url: 'http://localhost:49999', public_key: peerKeys.publicKey }) });
  assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);
  const act = await json(`/v1/federation/peers/${REMOTE_NODE}`, { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ status: 'active' }) });
  assert(act.body.ok === true && act.body.data.status === 'active', `activate: ${JSON.stringify(act.body)}`);
});

await test('12. a signed push from the peer is cached + served', async () => {
  const updates: PresenceUpdate[] = [{ ghii: remoteGhii, status: 'available', since: new Date().toISOString() }];
  const push = await pushPresence(updates, peerKeys.privateKey);
  assert(push.status === 200 && push.body.data.accepted === true, `push: ${push.status} ${JSON.stringify(push.body)}`);
  const { body } = await json(`/v1/presence/${encodeURIComponent(remoteGhii)}`, { headers: auth(alice.token) });
  assert(body.data.status === 'available', `expected available from cache, got ${body.data.status}`);
});

await test('13. an unknown update evicts the cached remote', async () => {
  const updates: PresenceUpdate[] = [{ ghii: remoteGhii, status: 'unknown', since: null }];
  const push = await pushPresence(updates, peerKeys.privateKey);
  assert(push.status === 200, `evict push: ${push.status}`);
  const { body } = await json(`/v1/presence/${encodeURIComponent(remoteGhii)}`, { headers: auth(alice.token) });
  assert(body.data.status === 'unknown', `expected unknown after eviction, got ${body.data.status}`);
});

await test('14. a bad signature is rejected (401)', async () => {
  const other = await generateKeyPair();
  const updates: PresenceUpdate[] = [{ ghii: remoteGhii, status: 'available', since: null }];
  const push = await pushPresence(updates, other.privateKey); // wrong key
  assert(push.status === 401, `expected 401, got ${push.status}: ${JSON.stringify(push.body)}`);
});

await test('15. a push from a non-peer node is rejected (403)', async () => {
  const updates: PresenceUpdate[] = [{ ghii: 'x@aimeat-peer-001-stranger', status: 'available', since: null }];
  const push = await pushPresence(updates, peerKeys.privateKey, 'aimeat-peer-001-stranger');
  assert(push.status === 403, `expected 403, got ${push.status}: ${JSON.stringify(push.body)}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Presence E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
try { server!.close(); } catch { /* noop */ }
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

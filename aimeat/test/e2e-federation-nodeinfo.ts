/**
 * @file e2e-federation-nodeinfo.ts
 * @description Federation version/settings visibility (Phase 1 of the federation-book work).
 *   Verifies the node self-descriptor on /.well-known/aimeat (software_version + features_enabled +
 *   federation_settings) and that a peer's advertised software version (sent on the heartbeat ping)
 *   is stamped onto the peer record and surfaced via GET /v1/federation/peers.
 *
 *   Node: 40277 aimeat-test-001-nodeinfo.
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial node-info / version-visibility tests.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-nodeinfo.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const PORT = 40277, NODE_ID = 'aimeat-test-001-nodeinfo', BASE = `http://localhost:${PORT}`;
const adminPw = randomBytes(16).toString('base64url');
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let server: Server;
let ownerToken = '';

console.log('\n=== AIMEAT Federation Node-Info E2E ===\n');

await test('Boot node + register operator', async () => {
  process.env.AIMEAT_PORT = String(PORT); process.env.AIMEAT_DEV_MODE = 'true'; process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_ADMIN_PASSWORD = adminPw; process.env.AIMEAT_NODE_ID = NODE_ID; process.env.AIMEAT_BASE_URL = BASE; process.env.AIMEAT_STORAGE = 'memory';
  const { config } = loadConfig({});
  config.port = PORT; config.nodeId = NODE_ID; config.baseUrl = BASE; config.devMode = true; config.testMode = true; config.adminPassword = adminPw; config.storageProvider = 'memory';
  const { app } = await createServer(config);
  server = await new Promise<Server>(r => { const s = app.listen(PORT, () => r(s)); });
  const opName = `niop${Date.now()}`;
  const reg = await json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ name: opName }) });
  assert(reg.status === 200 && reg.body.ok, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
  const tok = await json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ owner: opName, private_key: reg.body.private_key }) });
  assert(tok.body.ok, `token: ${JSON.stringify(tok.body)}`);
  ownerToken = tok.body.token;
});

console.log('\nPhase 1 — Well-known descriptor');
await test('1. /.well-known/aimeat carries software_version + features_enabled + federation_settings', async () => {
  const r = await json('/.well-known/aimeat');
  const d = r.body.data;
  assert(typeof d.software_version === 'string' && d.software_version !== 'unknown' && d.software_version.length > 0, `software_version: ${d.software_version}`);
  assert(Array.isArray(d.features_enabled) && d.features_enabled.includes('federation'), `features_enabled: ${JSON.stringify(d.features_enabled)}`);
  assert(d.federation_settings && typeof d.federation_settings.open_join === 'boolean' && typeof d.federation_settings.auth_policy === 'string', `federation_settings: ${JSON.stringify(d.federation_settings)}`);
});

console.log('\nPhase 1 — Peer version stamped from heartbeat ping');
const PEER = 'aimeat-peer-001-niremote';
await test('2. add a peer + activate', async () => {
  const add = await json('/v1/federation/peers', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ node_id: PEER, url: 'http://localhost:49980' }) });
  assert(add.status === 201, `add: ${add.status} ${JSON.stringify(add.body)}`);
  const act = await json(`/v1/federation/peers/${PEER}`, { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ status: 'active' }) });
  assert(act.body.ok, `activate: ${JSON.stringify(act.body)}`);
});

await test('3. a ping advertising software_version stamps the peer record', async () => {
  const ping = await json('/v1/federation/ping', { method: 'POST', body: JSON.stringify({ node_id: PEER, software_version: '9.9.9', timestamp: new Date().toISOString() }) });
  assert(ping.body.ok === true || ping.body.data?.pong, `ping: ${JSON.stringify(ping.body)}`);
  const peers = await json('/v1/federation/peers', { headers: auth(ownerToken) });
  const p = peers.body.data.peers.find((x: any) => x.node_id === PEER);
  assert(p?.software_version === '9.9.9', `expected stamped version 9.9.9, got ${p?.software_version}`);
});

await test('4. directory exposes peer software_version too', async () => {
  const dir = await json('/v1/federation/directory');
  const p = (dir.body.data.peers || []).find((x: any) => x.node_id === PEER);
  assert(p?.software_version === '9.9.9', `directory version: ${JSON.stringify(p)}`);
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`Node-Info E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
try { server!.close(); } catch { /* noop */ }
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

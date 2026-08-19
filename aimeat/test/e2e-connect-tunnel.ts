// E2E Tests for the Connector Forward Tunnel — Phase 1 (agent → server)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-tunnel
//
// Covers: connect/handshake, forward GET+POST under scope, scope-enforcement
// invariant (rejected identically to a direct call), forward-proxy parity
// invariant (same status + envelope as direct HTTP), single-socket invariant
// (exactly one active connection after N calls + replacement on reconnect),
// malformed-frame rejection, heartbeat, reconnect, and upgrade auth (non-agent
// / invalid tokens rejected).

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}

async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getToken(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const signature = await signMsg(priv, message);
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

// ─── State ───
const ownerName = `tunowner${Date.now()}`;
let ownerToken = '';      // first owner → operator role (used for the stats route)
let fullAgentToken = '';  // scopes: '*'
let liteAgentToken = '';  // scopes: ['memory:read'] — for the scope-enforcement invariant

console.log('\n=== AIMEAT Connector Forward Tunnel E2E (Phase 1) ===\n');

// ─── Setup ───
console.log('Setup — Owner & Agents');
await test('Register owner (operator)', async () => {
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await getToken(ownerName, body.data.private_key, false);
});

await test('Register full-scope agent', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'fullbot', owner: ownerName, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  fullAgentToken = await getToken(body.data.agent.gaii, body.data.private_key, true);
});

await test('Register read-only agent', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'litebot', owner: ownerName, capabilities: ['memory'], scopes: ['memory:read'] }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  liteAgentToken = await getToken(body.data.agent.gaii, body.data.private_key, true);
});

// ─── Phase 1: Connect & handshake ───
console.log('\nPhase 1 — Connect & handshake');

await test('1. Connect → welcome handshake with protocol version + heartbeat hint', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  assert(t.welcome !== null, 'received welcome');
  const p = t.welcome!.payload as any;
  assert(p.protocol_version === '1.0', `protocol_version: ${p?.protocol_version}`);
  assert(typeof p.heartbeat_interval_ms === 'number', 'heartbeat_interval_ms present');
  assert(typeof p.reconnect_hint === 'object', 'reconnect_hint present');
  await t.close();
});

await test('2. Upgrade rejects an owner (non-agent) token', async () => {
  let errored = false;
  try { await TunnelClient.connect(BASE, ownerToken); } catch { errored = true; }
  assert(errored, 'owner token must be rejected at upgrade (403)');
});

await test('3. Upgrade rejects an invalid token', async () => {
  let errored = false;
  try { await TunnelClient.connect(BASE, 'not-a-jwt'); } catch { errored = true; }
  assert(errored, 'invalid token must be rejected at upgrade (401)');
});

// ─── Phase 2: Forward dispatch + parity ───
console.log('\nPhase 2 — Forward dispatch & parity');

await test('4. Forward GET executes under the agent scopes', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  const r = await t.request('GET', '/v1/memory');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.ok === true && r.body.protocol === 'aimeat', 'envelope returned over tunnel');
  await t.close();
});

await test('5. Forward-proxy parity — GET /v1/memory == direct HTTP', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  const viaTunnel = await t.request('GET', '/v1/memory');
  const direct = await json('/v1/memory', { headers: { Authorization: `Bearer ${fullAgentToken}` } });
  assert(viaTunnel.status === direct.status, `status parity: tunnel ${viaTunnel.status} vs direct ${direct.status}`);
  assert(viaTunnel.body.ok === direct.body.ok, 'ok parity');
  assert(JSON.stringify(viaTunnel.body.data) === JSON.stringify(direct.body.data), 'data envelope parity');
  await t.close();
});

await test('6. Forward POST writes a key; visible via direct read (round-trip)', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  const key = `tunnel.roundtrip.${Date.now()}`;
  const w = await t.request('POST', '/v1/memory', { body: { key, value: { via: 'tunnel' } } });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}: ${JSON.stringify(w.body)}`);
  const direct = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${fullAgentToken}` } });
  assert(direct.status === 200, `direct read status ${direct.status}`);
  assert(direct.body.data?.value?.via === 'tunnel', 'value written via tunnel is readable directly');
  await t.close();
});

await test('7. Scope-enforcement invariant — forward POST rejected identically to direct', async () => {
  const t = await TunnelClient.connect(BASE, liteAgentToken);
  const viaTunnel = await t.request('POST', '/v1/memory', { body: { key: 'denied.key', value: { x: 1 } } });
  const direct = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${liteAgentToken}` }, body: JSON.stringify({ key: 'denied.key', value: { x: 1 } }) });
  assert(viaTunnel.status === 403, `tunnel status ${viaTunnel.status} (expected 403)`);
  assert(direct.status === 403, `direct status ${direct.status} (expected 403)`);
  assert(viaTunnel.status === direct.status, 'status parity on scope denial');
  assert(viaTunnel.body.error?.code === direct.body.error?.code, `error code parity: ${viaTunnel.body.error?.code} vs ${direct.body.error?.code}`);
  assert(viaTunnel.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${viaTunnel.body.error?.code}`);
  await t.close();
});

// ─── Phase 3: Single-socket invariant ───
console.log('\nPhase 3 — Single-socket invariant');

async function activeConnections(): Promise<number> {
  const { status, body } = await json('/v1/connect/tunnel/stats', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(status === 200, `stats status ${status}: ${JSON.stringify(body)}`);
  return body.data.stats.activeConnections;
}

await test('8. Exactly one active connection after N forwarded calls', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  for (let i = 0; i < 8; i++) {
    const r = await t.request('GET', '/v1/memory');
    assert(r.status === 200, `call ${i} status ${r.status}`);
  }
  const active = await activeConnections();
  assert(active === 1, `expected exactly 1 active connection, got ${active}`);
  await t.close();
});

await test('9. A second socket for the same agent replaces the first (still one)', async () => {
  const a = await TunnelClient.connect(BASE, fullAgentToken);
  await a.request('GET', '/v1/memory');
  const b = await TunnelClient.connect(BASE, fullAgentToken);  // replaces a
  await b.request('GET', '/v1/memory');
  await sleep(150);  // let the replaced socket's close propagate
  const active = await activeConnections();
  assert(active === 1, `expected 1 after replacement, got ${active}`);
  await b.close();
});

// ─── Phase 4: Frames — malformed, heartbeat, reconnect ───
console.log('\nPhase 4 — Frame handling');

await test('10. Malformed (non-JSON) frame rejected with an error frame', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  t.sendRaw('this is not json');
  const err = await t.waitForError(1000);
  assert(err !== null, 'received an error frame');
  assert(err!.code === 'BAD_FRAME', `error code: ${err!.code}`);
  // Connection stays usable after a bad frame
  const r = await t.request('GET', '/v1/memory');
  assert(r.status === 200, `still usable after bad frame: ${r.status}`);
  await t.close();
});

await test('11. request frame missing a path rejected with an error frame', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  t.sendRaw(JSON.stringify({ type: 'request', id: 'x1', method: 'GET' }));
  const err = await t.waitForError(1000);
  assert(err !== null, 'received an error frame for bad request');
  assert(err!.code === 'BAD_REQUEST_FRAME', `error code: ${err!.code}`);
  await t.close();
});

await test('11a. SSRF guard — protocol-relative path to an off-host origin rejected', async () => {
  // `//evil.example/...` passes startsWith('/') but resolves off-loopback. The
  // manager must reject it (else it would fetch an arbitrary host WITH the
  // agent's bearer). No error frame leaks the target; it is a BAD_REQUEST_FRAME.
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  for (const p of ['//evil.example/v1/memory', '//169.254.169.254/latest/meta-data']) {
    t.sendRaw(JSON.stringify({ type: 'request', id: `ssrf-${p}`, method: 'GET', path: p }));
    const err = await t.waitForError(1000);
    assert(err !== null, `received an error frame for ${p}`);
    assert(err!.code === 'BAD_REQUEST_FRAME', `error code for ${p}: ${err!.code}`);
  }
  // Socket still usable for a legitimate on-host call afterwards.
  const ok = await t.request('GET', '/v1/memory');
  assert(ok.status === 200, `still usable after SSRF rejection: ${ok.status}`);
  await t.close();
});

await test('11b. Unsupported HTTP method rejected', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  t.sendRaw(JSON.stringify({ type: 'request', id: 'm1', method: 'CONNECT', path: '/v1/memory' }));
  const err = await t.waitForError(1000);
  assert(err !== null, 'received an error frame for bad method');
  assert(err!.code === 'BAD_REQUEST_FRAME', `error code: ${err!.code}`);
  await t.close();
});

await test('12. Heartbeat → heartbeat_ack', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  const ack = await t.heartbeat();
  assert(ack.type === 'heartbeat_ack', `got ${ack.type}`);
  await t.close();
});

await test('13. Reconnect after an abrupt drop; forward still works', async () => {
  const t1 = await TunnelClient.connect(BASE, fullAgentToken);
  await t1.request('GET', '/v1/memory');
  t1.drop();
  await sleep(150);
  const t2 = await TunnelClient.connect(BASE, fullAgentToken);
  assert(t2.welcome !== null, 'reconnect received welcome');
  const r = await t2.request('GET', '/v1/memory');
  assert(r.status === 200, `post-reconnect forward status ${r.status}`);
  const active = await activeConnections();
  assert(active === 1, `expected 1 active after reconnect, got ${active}`);
  await t2.close();
});

// ─── Phase 4: the ack dedup set is bounded ───
console.log('\nPhase 4 — In-session ack dedup is capped');

async function tunnelStats(): Promise<any> {
  const { status, body } = await json('/v1/connect/tunnel/stats', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(status === 200, `stats status ${status}: ${JSON.stringify(body)}`);
  return body.data.stats;
}

await test('13. A long-lived socket cannot grow its ack set without limit', async () => {
  // The dedup set used to hold every id acked on the socket and clear only on disconnect, so a
  // serve daemon that stays connected for a day grew it forever (memory trace 2026-08-19: this was
  // the node's largest growing structure). 700 acks on ONE socket must leave at most the window.
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  const before = await tunnelStats();
  for (let i = 0; i < 700; i++) t.ack(`fake-delivery-${i}-${Date.now()}`);
  await sleep(1500);   // frames are fire-and-forget; let the server drain them

  const after = await tunnelStats();
  assert(after.acksTotal - before.acksTotal >= 700, `server saw the acks (${before.acksTotal} → ${after.acksTotal})`);
  assert(typeof after.ackDedupEntries === 'number', 'stats report ackDedupEntries');
  // Old code: 700. The cap is 500, and one other socket may hold a few entries of its own.
  assert(after.ackDedupEntries <= 520, `ack dedup set must stay capped, got ${after.ackDedupEntries}`);
  await t.close();
});

await test('14. The dedup set is released when the socket closes', async () => {
  const t = await TunnelClient.connect(BASE, fullAgentToken);
  for (let i = 0; i < 50; i++) t.ack(`closing-${i}`);
  await sleep(800);
  await t.close();
  await sleep(500);
  const s = await tunnelStats();
  assert(s.ackDedupEntries === 0, `no entries remain once every socket is closed, got ${s.ackDedupEntries}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete owner', async () => {
  const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connector Forward Tunnel E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

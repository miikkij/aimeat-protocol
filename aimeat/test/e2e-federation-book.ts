/**
 * @file e2e-federation-book.ts
 * @description Federation book (Phase 2): node-card endpoint, primary assembly of the book from
 *   peers' node-cards, the opt-out (federationBookListed=false), and the leaf mirror flow
 *   (pull → signature-verify → version-gate → cache). Three in-process nodes:
 *   G (primary, no genesisUrl), P1 (leaf, listed), P2 (leaf, opted-out).
 *
 *   Ports: G 40278, P1 40279, P2 40280.
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial federation-book tests (node-card, assembly, opt-out, mirror).
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-federation-book.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
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

interface NodeState { server: Server; baseUrl: string; nodeId: string; adminPw: string; ownerToken: string; json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>; }
function makeJson(baseUrl: string) {
  return async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
  };
}
async function bootNode(port: number, nodeId: string, opts: { genesisUrl?: string; bookListed?: boolean }): Promise<NodeState> {
  const adminPw = randomBytes(16).toString('base64url');
  process.env.AIMEAT_PORT = String(port); process.env.AIMEAT_DEV_MODE = 'true'; process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_ADMIN_PASSWORD = adminPw; process.env.AIMEAT_NODE_ID = nodeId; process.env.AIMEAT_BASE_URL = `http://localhost:${port}`; process.env.AIMEAT_STORAGE = 'memory';
  const { config } = loadConfig({});
  config.port = port; config.nodeId = nodeId; config.baseUrl = `http://localhost:${port}`; config.devMode = true; config.testMode = true; config.adminPassword = adminPw; config.storageProvider = 'memory';
  config.genesisUrl = opts.genesisUrl ?? null;
  config.federationBookListed = opts.bookListed !== false;
  const { app } = await createServer(config);
  const server = await new Promise<Server>(r => { const s = app.listen(port, () => r(s)); });
  return { server, baseUrl: `http://localhost:${port}`, nodeId, adminPw, ownerToken: '', json: makeJson(`http://localhost:${port}`) };
}
async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
  const reg = await node.json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }) });
  assert(reg.status === 200 && reg.body.ok, `register ${ownerName}: ${reg.status}`);
  const tok = await node.json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }) });
  assert(tok.body.ok, `token ${ownerName}`); node.ownerToken = tok.body.token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function addActivePeer(from: NodeState, to: NodeState) {
  await from.json('/v1/federation/peers', { method: 'POST', headers: auth(from.ownerToken), body: JSON.stringify({ node_id: to.nodeId, url: to.baseUrl }) });
  await from.json(`/v1/federation/peers/${to.nodeId}`, { method: 'PUT', headers: auth(from.ownerToken), body: JSON.stringify({ status: 'active' }) });
}

console.log('\n=== AIMEAT Federation Book E2E ===\n');
const ts = Date.now();
let G: NodeState, P1: NodeState, P2: NodeState;

await test('Boot G (primary) + P1 (listed leaf) + P2 (opted-out leaf) + operators', async () => {
  G = await bootNode(40278, 'aimeat-test-001-bookg', {});
  P1 = await bootNode(40279, 'aimeat-test-001-bookp1', { genesisUrl: 'http://localhost:40278' });
  P2 = await bootNode(40280, 'aimeat-test-001-bookp2', { genesisUrl: 'http://localhost:40278', bookListed: false });
  await setupOwner(G, `gop${ts}`);
  await setupOwner(P1, `p1op${ts}`);
  await setupOwner(P2, `p2op${ts}`);
});

console.log('\nPhase 1 — Node card');
await test('1. G node-card lists its operator + version + settings + resources', async () => {
  const r = await G.json('/v1/federation/node-card');
  const c = r.body.data;
  assert(c.listed === true, `listed: ${JSON.stringify(c)}`);
  assert(typeof c.software_version === 'string' && c.software_version !== 'unknown', `version: ${c.software_version}`);
  assert(Array.isArray(c.operators) && c.operators.some((o: any) => o.ghii === `gop${ts}@${G.nodeId}`), `operators: ${JSON.stringify(c.operators)}`);
  assert(c.settings && typeof c.settings.open_join === 'boolean', `settings: ${JSON.stringify(c.settings)}`);
  assert(c.resources && typeof c.resources.actions === 'number', `resources: ${JSON.stringify(c.resources)}`);
  assert(typeof c.node_card_hash === 'string', 'has hash');
});

await test('2. opted-out node (P2) returns listed:false, no operators', async () => {
  const r = await P2.json('/v1/federation/node-card');
  assert(r.body.data.listed === false && !r.body.data.operators, `expected listed:false, got ${JSON.stringify(r.body.data)}`);
});

console.log('\nPhase 2 — Primary assembles the book');
await test('3. G peers P1+P2, rebuilds: book has G+P1, omits opted-out P2', async () => {
  await addActivePeer(G, P1);
  await addActivePeer(G, P2);
  const r = await G.json('/v1/federation/book/rebuild', { method: 'POST', headers: auth(G.ownerToken), body: '{}' });
  assert(r.body.ok, `rebuild: ${JSON.stringify(r.body)}`);
  const ids = r.body.data.book.nodes.map((n: any) => n.node_id).sort();
  assert(ids.includes(G.nodeId) && ids.includes(P1.nodeId), `book should include G+P1, got ${JSON.stringify(ids)}`);
  assert(!ids.includes(P2.nodeId), `book must omit opted-out P2, got ${JSON.stringify(ids)}`);
  const p1card = r.body.data.book.nodes.find((n: any) => n.node_id === P1.nodeId);
  assert(p1card?.operators?.some((o: any) => o.ghii === `p1op${ts}@${P1.nodeId}`), `P1 operator in book: ${JSON.stringify(p1card)}`);
});

await test('4. GET /book on G returns the signed book + is_primary true', async () => {
  const r = await G.json('/v1/federation/book');
  assert(r.body.data.is_primary === true, `is_primary: ${r.body.data.is_primary}`);
  assert(r.body.data.book.signature && r.body.data.book.issued_by === G.nodeId, `signed by G: ${JSON.stringify(r.body.data.book).slice(0, 200)}`);
});

console.log('\nPhase 3 — Leaf mirror (pull + verify)');
await test('5. P1 pull before knowing G key → 403 unknown issuer', async () => {
  const r = await P1.json('/v1/federation/book/pull', { method: 'POST', headers: auth(P1.ownerToken), body: JSON.stringify({ source_url: G.baseUrl }) });
  assert(r.status === 403 && r.body.error?.code === 'UNKNOWN_ISSUER', `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('6. P1 peers+key-exchanges G, then pulls + mirrors the book', async () => {
  await addActivePeer(P1, G);
  const act = await P1.json('/v1/federation/peer/activate', { method: 'POST', headers: auth(P1.ownerToken), body: JSON.stringify({ peer_node_id: G.nodeId }) });
  assert(act.body.ok && act.body.data.key_exchange === 'completed', `key exchange: ${JSON.stringify(act.body)}`);
  const pull = await P1.json('/v1/federation/book/pull', { method: 'POST', headers: auth(P1.ownerToken), body: JSON.stringify({ source_url: G.baseUrl }) });
  assert(pull.body.ok && pull.body.data.applied === true, `pull: ${JSON.stringify(pull.body)}`);
  // P1 now serves the mirrored book.
  const book = await P1.json('/v1/federation/book');
  const ids = book.body.data.book.nodes.map((n: any) => n.node_id);
  assert(ids.includes(G.nodeId) && ids.includes(P1.nodeId), `mirrored book on P1: ${JSON.stringify(ids)}`);
  assert(book.body.data.is_primary === false, `P1 is_primary should be false`);
  const again = await P1.json('/v1/federation/book/pull', { method: 'POST', headers: auth(P1.ownerToken), body: JSON.stringify({ source_url: G.baseUrl }) });
  assert(again.body.data.applied === false && again.body.data.reason === 'not_newer', `second pull not_newer: ${JSON.stringify(again.body)}`);
});

// Test 6 pulls G's GENUINE book from G's real node, so the signature check has never refused
// anything — and `book/pull` appears in no other file, `INVALID_SIGNATURE` in none at all. The book
// is the node directory: who exists in this federation and at which address. A document accepted
// without verification rewrites that list on every node that mirrors it.
await test('7. a book that is unsigned or tampered is refused, and the mirrored directory does not move', async () => {
  const genuine = (await G.json('/v1/federation/book')).body.data.book;
  assert(typeof genuine?.book_version === 'number', `G must serve a book: ${JSON.stringify(genuine)}`);

  let served: unknown = genuine;
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, node_id: 'stub', data: { book: served, is_primary: true } }));
  });
  await new Promise<void>(r => stub.listen(40281, r));
  const STUB = 'http://localhost:40281';
  const pullFromStub = () => P1.json('/v1/federation/book/pull', {
    method: 'POST', headers: auth(P1.ownerToken), body: JSON.stringify({ source_url: STUB }),
  });
  const nodeIds = async () => ((await P1.json('/v1/federation/book')).body.data.book.nodes ?? []).map((n: any) => n.node_id).sort();

  try {
    // POSITIVE CONTROL FIRST: the genuine book reaches the version gate, which proves the stub is
    // reachable, the issuer resolved to G's key, and the signature VERIFIED over the re-serialised
    // bytes — the check runs above the version comparison.
    served = genuine;
    const ok = await pullFromStub();
    assert(ok.status === 200, `control status ${ok.status}: ${JSON.stringify(ok.body)}`);
    assert(ok.body.data?.reason === 'not_newer',
      `the genuine book must reach the version gate: ${JSON.stringify(ok.body.data ?? ok.body)}`);

    const before = await nodeIds();

    // TAMPERED: a newer version with an extra node spliced in, G's original signature still attached.
    served = {
      ...genuine,
      book_version: genuine.book_version + 5,
      nodes: [...(genuine.nodes ?? []), { node_id: 'aimeat-impostor-001', url: 'http://localhost:49911', tier: 'member' }],
    };
    const tampered = await pullFromStub();
    assert(tampered.body?.data?.applied !== true,
      `a tampered book must not apply: ${JSON.stringify(tampered.body?.data ?? tampered.body)}`);

    // UNSIGNED: the same widened book with the signature stripped.
    const { signature: _drop, ...bare } = served as Record<string, unknown>;
    served = bare;
    const unsigned = await pullFromStub();
    assert(unsigned.body?.data?.applied !== true,
      `an unsigned book must not apply: ${JSON.stringify(unsigned.body?.data ?? unsigned.body)}`);

    const after = await nodeIds();
    assert(JSON.stringify(after) === JSON.stringify(before),
      `the refused pulls must not change the directory: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    assert(!after.includes('aimeat-impostor-001'), 'and the spliced node must not be in it');
  } finally {
    stub.close();
  }
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`Federation Book E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
try { G!.server.close(); P1!.server.close(); P2!.server.close(); } catch { /* noop */ }
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);

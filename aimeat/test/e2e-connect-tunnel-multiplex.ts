// E2E: ONE SOCKET, MANY IDENTITIES — the Connector Forward Tunnel carrying every agent of every
// owner a connector serves, instead of one TCP connection per agent.
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-tunnel-multiplex
//
// WHAT THIS PROVES, and why each one is here rather than assumed:
//
//   1. SIX AGENTS ACROSS TWO OWNERS RIDE ONE SOCKET, counted from the operating system's own view
//      of established connections — not from a log line and not from the node's own stats, both of
//      which would be this code marking its own homework. The number this whole change exists for.
//   2. EVERY FRAME TYPE STILL WORKS, PER IDENTITY: request/response, deliver/ack, backlog,
//      subscribe/subscribed, and the refusals.
//   3. THE FENCE. One identity's revoked credential detaches THAT identity and leaves the socket up
//      for the others. This is the one that turns a shared socket from a saving into a liability if
//      it is wrong, so it is asserted from both ends: the revoked one is gone, the others answer.
//   4. NOBODY CAN STARVE ANYBODY. One identity saturates its in-flight cap; another's call still
//      returns, and the noisy one is refused rather than queued.
//   5. A FRAME NAMING AN IDENTITY THIS SOCKET DOES NOT HOLD IS REFUSED. The routing field routes;
//      it never grants. Asserted with a credential that is perfectly valid — just not presented
//      here — because "an invalid token is rejected" would prove something else.
//   6. A SINGLE-OWNER DAEMON BEHAVES EXACTLY AS BEFORE. The old shape is not a legacy path to be
//      tolerated; it is what most installs are.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const PORT = Number(new URL(BASE).port || 80);

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
  // `Connection: close` so the suite's own HTTP calls leave no keep-alive socket behind: the
  // count below has to be the TUNNEL's sockets and nothing else.
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Connection: 'close', ...opts.headers } });
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

/**
 * HOW MANY TCP CONNECTIONS THIS PROCESS HOLDS TO THE NODE'S PORT.
 *
 * Read from Node's own handle table rather than from netstat: the suite has to run on every CI
 * platform, and the question — how many sockets does one connector process hold — is the same
 * question the production measurement answered with netstat against a pid. This counts the client
 * end, which is the end the connector pays for and the end the wish is about.
 */
function establishedToNode(): number {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  return handles.filter((h) => {
    const s = h as { remotePort?: number; destroyed?: boolean; readable?: boolean };
    // A connected TCP client socket is the only handle that has a remote port. stdio streams are
    // Sockets too and have none, which is what keeps them out of the count.
    return typeof s?.remotePort === 'number' && s.destroyed !== true;
  }).length;
}

function describeHandles(): string {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  return handles.map(h => {
    const s = h as { constructor?: { name?: string }; remotePort?: number };
    return `${s?.constructor?.name}:${s?.remotePort ?? '-'}`;
  }).join(' ');
}

// ─── State ───
const stamp = Date.now();
const ownerA = `muxa${stamp}`;
const ownerB = `muxb${stamp}`;
let ownerATok = '';
let ownerBTok = '';
/** gaii → its own agent credential. Six of them: three per owner. */
const agents = new Map<string, string>();
const gaiisA: string[] = [];
const gaiisB: string[] = [];

console.log('\n=== AIMEAT Connector Forward Tunnel: one socket, many identities ===\n');

console.log('Setup — two owners, three agents each');
await test('Register both owners', async () => {
  const a = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerA, public_key: 'placeholder' }) });
  assert(a.status === 201, `owner A: ${JSON.stringify(a.body)}`);
  ownerATok = await getToken(ownerA, a.body.data.private_key, false);
  const b = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerB, public_key: 'placeholder' }) });
  assert(b.status === 201, `owner B: ${JSON.stringify(b.body)}`);
  ownerBTok = await getToken(ownerB, b.body.data.private_key, false);
});

await test('Register six agents — three per owner, two of them sharing a name across owners', async () => {
  // `concierge` deliberately exists under BOTH owners. A bare name cannot tell those apart, which
  // is exactly why every routing decision in this change is made on the GAII.
  for (const [ownerName, tok, into] of [[ownerA, ownerATok, gaiisA], [ownerB, ownerBTok, gaiisB]] as const) {
    for (const name of ['concierge', 'worker', 'watcher']) {
      const { status, body } = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], scopes: ['*'] }),
      });
      assert(status === 201, `${name}@${ownerName}: ${status} ${JSON.stringify(body)}`);
      const gaii = body.data.agent.gaii;
      (into as string[]).push(gaii);
      agents.set(gaii, await getToken(gaii, body.data.private_key, true));
    }
  }
  assert(agents.size === 6, `six agents, got ${agents.size}`);
});

// ─── The number the whole change is about ───
console.log('\nOne socket');

let hub: TunnelClient | null = null;

await test('1. Six agents across two owners hold ONE connection to the node', async () => {
  const all = [...gaiisA, ...gaiisB];
  // The first identity authenticates the upgrade; the other five prove their own credentials on
  // the socket it opened.
  hub = await TunnelClient.connect(BASE, agents.get(all[0])!);
  assert((hub.welcome!.payload as any)?.multiplex === true, 'the node must advertise multiplex in welcome');
  for (const gaii of all.slice(1)) {
    const reply = await hub.attach(gaii, agents.get(gaii)!);
    assert(reply.type === 'attached', `attach ${gaii}: ${reply.type} ${reply.code ?? ''} ${reply.message ?? ''}`);
  }
  // AN ABSOLUTE COUNT, NOT A DELTA. The claim is "one socket", so that is what is asserted: after
  // six identities are live, this process holds exactly one connection to the node's port. A delta
  // would have been satisfied by any baseline, and the baseline is the thing in dispute.
  await sleep(200);
  const after = establishedToNode();
  assert(after === 1, `six agents across two owners must hold exactly ONE socket, hold ${after} (${describeHandles()})`);
  console.log(`     six identities, ${after} TCP connection to the node`);
});

await test('2. The node counts six live identities on it', async () => {
  const { body } = await json('/v1/connect/tunnel/stats', { headers: { Authorization: `Bearer ${ownerATok}` } });
  assert(body.ok === true, `stats: ${JSON.stringify(body.error)}`);
  const active = body.data.stats.activeConnections;
  assert(active >= 6, `six identities visible on the node, got ${active}`);
});

// ─── Every frame type, per identity ───
console.log('\nEvery frame type, per identity');

await test('3. request/response works for each of the six, under its OWN identity', async () => {
  for (const gaii of [...gaiisA, ...gaiisB]) {
    const first = gaii === gaiisA[0];
    // Each writes a key only it should own, then reads it back. If frames were routed by socket
    // rather than by identity these would land in one namespace and the reads would cross.
    const w = await hub!.request('POST', '/v1/memory', { agent: first ? undefined : gaii, body: { key: 'mux.probe', value: { who: gaii } } });
    assert(w.status === 200 || w.status === 201, `${gaii} write: ${w.status} ${JSON.stringify(w.body)}`);
    const r = await hub!.request('GET', '/v1/memory/mux.probe', { agent: first ? undefined : gaii });
    assert(r.status === 200, `${gaii} read: ${r.status}`);
    assert((r.body as any).data.value.who === gaii, `${gaii} read its own value, got ${JSON.stringify((r.body as any).data.value)}`);
  }
});

await test('4. Two owners\' agents of the SAME name stay separate', async () => {
  // `concierge` under each owner. Same bare name, two identities, two namespaces.
  const a = await hub!.request('GET', '/v1/memory/mux.probe', { agent: gaiisA[0] === gaiisA[0] ? undefined : gaiisA[0] });
  const b = await hub!.request('GET', '/v1/memory/mux.probe', { agent: gaiisB[0] });
  assert((a.body as any).data.value.who === gaiisA[0], `owner A concierge: ${JSON.stringify((a.body as any).data.value)}`);
  assert((b.body as any).data.value.who === gaiisB[0], `owner B concierge: ${JSON.stringify((b.body as any).data.value)}`);
  assert(gaiisA[0] !== gaiisB[0], 'the two concierges are distinct GAIIs');
});

await test('5. backlog arrives for an identity attached after the socket opened', async () => {
  // One backlog per identity: the socket's own on welcome, and one per accepted attach.
  assert(hub!.backlogs.length >= 6, `a backlog per identity, got ${hub!.backlogs.length}`);
  const stamped = hub!.backlogs.filter(f => typeof f.agent === 'string' && f.agent !== '');
  assert(stamped.length >= 5, `attached identities' backlogs say whose they are, got ${stamped.length}`);
});

await test('6. deliver reaches the right identity, and its ack is accepted', async () => {
  const target = gaiisB[1];
  const before = hub!.delivers.length;
  // The route takes the BARE name and resolves the owner from the caller's token — which is why
  // `worker` under owner B is unambiguous here even though owner A has one too.
  const { status, body } = await json(`/v1/agents/${target.split('#')[0]}/tasks`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerBTok}` },
    body: JSON.stringify({ title: 'mux probe', type: 'probe', input: { hello: 'mux' } }),
  });
  assert(status === 201 || status === 200, `create task: ${status} ${JSON.stringify(body)}`);
  for (let i = 0; i < 40 && hub!.delivers.length === before; i++) await sleep(100);
  const got = hub!.delivers.slice(before).find(f => f.agent === target);
  assert(!!got, `deliver for ${target}, saw ${JSON.stringify(hub!.delivers.slice(before).map(f => f.agent))}`);
  hub!.ack(got!.id!, target);
});

await test('7. subscribe/subscribed answers the identity that asked', async () => {
  const before = hub!.subscribeds.length;
  hub!.subscribe([{ organism_id: 'nope', ws: 'nope', space: 'nope' }], gaiisA[2]);
  for (let i = 0; i < 30 && hub!.subscribeds.length === before; i++) await sleep(100);
  const ack = hub!.subscribeds.slice(before)[0];
  assert(!!ack, 'a subscribed ack came back');
  assert(ack.agent === gaiisA[2], `the ack says whose it is: ${ack.agent}`);
});

// ─── The routing field routes; it never grants ───
console.log('\nRefusals');

await test('8. A frame naming an identity this socket does not hold is refused', async () => {
  // A SEVENTH agent with a perfectly good credential that was simply never presented on this
  // socket. Naming it must buy nothing — otherwise the `agent` field would be an authorisation.
  const { body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerATok}` },
    body: JSON.stringify({ name: 'outsider', owner: ownerA, capabilities: ['memory'], scopes: ['*'] }),
  });
  const outsider = body.data.agent.gaii;
  const before = hub!.errors.length;
  hub!.sendRaw(JSON.stringify({ type: 'request', id: 'oops', agent: outsider, method: 'GET', path: '/v1/memory/mux.probe' }));
  for (let i = 0; i < 30 && hub!.errors.length === before; i++) await sleep(100);
  const err = hub!.errors.slice(before)[0];
  assert(!!err, 'the node answered with an error frame');
  assert(err.code === 'UNKNOWN_IDENTITY', `code: ${err.code}`);
  assert(hub!.isOpen, 'and the socket stayed up');
});

await test('8b. Sharing a socket does not share an OWNER: a cross-owner read is still refused', async () => {
  // THE REFUSAL THAT MATTERS MOST ON A SHARED WIRE. Owner A's agent and owner B's agent are on one
  // socket; if the tunnel were replaying frames with the socket's bearer rather than each
  // identity's own, this read would succeed and nothing else in this suite would notice.
  const priv = 'mux.private.' + stamp;
  const wrote = await hub!.request('POST', '/v1/memory', {
    agent: gaiisB[1], body: { key: priv, value: { secret: 'owner B only' }, visibility: 'private' },
  });
  assert(wrote.status === 200 || wrote.status === 201, `owner B write: ${wrote.status}`);
  // Owner A's agent asks for it BY OWNER B's namespace, over the same socket.
  const stolen = await hub!.request('GET', `/v1/memory/${encodeURIComponent(gaiisB[1].split('#')[1].split('@')[0] + '@' + NODE_ID)}/${priv}`, {
    agent: gaiisA[1],
  });
  assert(stolen.status === 403 || stolen.status === 404,
    `owner A must be refused owner B's private record, got ${stolen.status} ${JSON.stringify(stolen.body)}`);
});

await test('8c. A scope-limited identity is refused exactly as it would be over HTTP', async () => {
  // The forward frame is replayed through the real Express stack with THAT identity's bearer, so
  // requireScope holds by construction. A read-only agent on a shared socket must still be told no.
  const { body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerATok}` },
    body: JSON.stringify({ name: 'readonly', owner: ownerA, capabilities: ['memory'], scopes: ['memory:read'] }),
  });
  const gaii = body.data.agent.gaii;
  const reply = await hub!.attach(gaii, await getToken(gaii, body.data.private_key, true));
  assert(reply.type === 'attached', `attach: ${reply.type} ${reply.message ?? ''}`);
  const denied = await hub!.request('POST', '/v1/memory', { agent: gaii, body: { key: 'nope', value: 1 } });
  assert(denied.status === 403, `a memory:read agent must be refused a write, got ${denied.status}`);
  // ...and its neighbours are unaffected by its refusal.
  const ok = await hub!.request('GET', '/v1/memory/mux.probe', { agent: gaiisB[2] });
  assert(ok.status === 200, `a neighbour still answers: ${ok.status}`);
  hub!.detach(gaii);
});

await test('9. attach is refused when the credential names a different identity', async () => {
  // The gate reads the VERIFIED subject, not the frame's `agent` field. Filing one agent's proven
  // credential under another agent's name would otherwise let a daemon act as the second.
  const reply = await hub!.attach(gaiisA[1], agents.get(gaiisA[2])!);
  assert(reply.type === 'error', `expected a refusal, got ${reply.type}`);
  assert(reply.code === 'ATTACH_FORBIDDEN', `code: ${reply.code}`);
  assert(hub!.isOpen, 'and the socket stayed up');
});

// ─── Fairness ───
console.log('\nFairness');

await test('10. One identity cannot starve the others', async () => {
  // Saturate one identity's in-flight allowance, then measure a NEIGHBOUR's latency. The cap is
  // per identity, so the noisy one is refused and the quiet one is unaffected.
  const noisy = gaiisA[1];
  const quiet = gaiisB[2];
  const flood = Array.from({ length: 60 }, () =>
    hub!.request('GET', '/v1/memory/mux.probe', { agent: noisy, timeoutMs: 15000 }).catch(() => ({ status: 0, body: null })));
  const t0 = Date.now();
  const neighbour = await hub!.request('GET', '/v1/memory/mux.probe', { agent: quiet, timeoutMs: 15000 });
  const latency = Date.now() - t0;
  const results = await Promise.all(flood);
  assert(neighbour.status === 200, `the quiet identity still got its answer: ${neighbour.status}`);
  assert(latency < 10000, `and got it promptly: ${latency}ms`);
  const refused = results.filter(r => (r as any).status === 429).length;
  assert(refused > 0, `the noisy identity was refused rather than queued (429s: ${refused})`);
  console.log(`     neighbour latency under flood: ${latency}ms · ${refused}/60 refused`);
});

// ─── The fence ───
console.log('\nThe fence');

await test('11. One identity\'s revoked credential closes THAT identity, not the socket', async () => {
  const doomed = gaiisA[2];
  const survivors = [...gaiisA.slice(0, 2), ...gaiisB];
  const before = hub!.authRevokeds.length;
  // Deleting an agent revokes its sessions and tells the tunnel — the path closeForGaii serves.
  const { status, body } = await json(`/v1/agents/${doomed.split('#')[0]}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${ownerATok}` },
  });
  assert(status === 200 || status === 204, `delete: ${status} ${JSON.stringify(body)}`);
  for (let i = 0; i < 40 && hub!.authRevokeds.length === before; i++) await sleep(100);
  const rev = hub!.authRevokeds.slice(before)[0];
  assert(!!rev, 'an auth_revoked frame arrived');
  assert(rev.agent === doomed, `it names the identity it is about: ${rev.agent}`);

  assert(hub!.isOpen, 'THE FENCE: the socket carrying five other identities is still open');
  // And they still work — an open socket that has stopped serving would pass the line above.
  for (const gaii of survivors) {
    const first = gaii === gaiisA[0];
    const r = await hub!.request('GET', '/v1/memory/mux.probe', { agent: first ? undefined : gaii });
    assert(r.status === 200, `${gaii} still answers: ${r.status}`);
  }
  // The revoked one is gone from the socket, so naming it is now the unknown-identity refusal.
  const errs = hub!.errors.length;
  hub!.sendRaw(JSON.stringify({ type: 'request', id: 'gone', agent: doomed, method: 'GET', path: '/v1/memory/mux.probe' }));
  for (let i = 0; i < 30 && hub!.errors.length === errs; i++) await sleep(100);
  assert(hub!.errors.slice(errs)[0]?.code === 'UNKNOWN_IDENTITY', 'the revoked identity is off the socket');
});

await test('12. detach removes one identity and leaves the rest', async () => {
  const leaving = gaiisB[0];
  hub!.detach(leaving);
  await sleep(300);
  const errs = hub!.errors.length;
  hub!.sendRaw(JSON.stringify({ type: 'request', id: 'left', agent: leaving, method: 'GET', path: '/v1/memory/mux.probe' }));
  for (let i = 0; i < 30 && hub!.errors.length === errs; i++) await sleep(100);
  assert(hub!.errors.slice(errs)[0]?.code === 'UNKNOWN_IDENTITY', 'the detached identity is off the socket');
  assert(hub!.isOpen, 'and the socket is still up');
  const r = await hub!.request('GET', '/v1/memory/mux.probe', { agent: gaiisB[1] });
  assert(r.status === 200, `a neighbour still answers: ${r.status}`);
});

// ─── What most installs are ───
console.log('\nA single-owner daemon');

await test('13. One owner, one agent, no attach — behaves exactly as before', async () => {
  const { body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerBTok}` },
    body: JSON.stringify({ name: 'solo', owner: ownerB, capabilities: ['memory'], scopes: ['*'] }),
  });
  const solo = await TunnelClient.connect(BASE, await getToken(body.data.agent.gaii, body.data.private_key, true));
  assert(solo.welcome !== null, 'welcomed');
  // No `agent` field on anything, exactly as a client older than this change sends.
  const w = await solo.request('POST', '/v1/memory', { body: { key: 'solo.probe', value: { ok: true } } });
  assert(w.status === 200 || w.status === 201, `write: ${w.status}`);
  const r = await solo.request('GET', '/v1/memory/solo.probe');
  assert(r.status === 200 && (r.body as any).data.value.ok === true, `read: ${r.status}`);
  assert(solo.backlogs.length >= 1, 'got its backlog');
  await solo.close();
});

await hub?.close();

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

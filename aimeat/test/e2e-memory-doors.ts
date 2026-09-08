/**
 * @file test/e2e-memory-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The memory doors the happy-path suites never open: every `?agent` refusal arm on
 *   the four batch routes (bulk, export, import, bulk-delete), the two cross-owner routes
 *   (discover, copy), and the per-key arms of src/routes/memory/key.ts — TTL expiry on read, the
 *   anonymous-namespace refusals on DELETE and PUT, the 413 size wall, the 422 schema lock, the
 *   CORS inheritance ladder and the deleted-items bin. e2e-memory-full.ts owns the owner-scope
 *   happy paths; nothing here repeats them.
 *
 * @structure
 *   - Phase 0: an operator owner, two of their agents, a second owner with an agent, an anonymous session
 *   - Phase 1: bulk.ts — the entry ceiling, the four ?agent arms, the import 400, the bundle ceiling
 *   - Phase 2: bulk.ts — GET /v1/memory/discover across owners (?prefix, ?owner, ?q)
 *   - Phase 3: bulk.ts — POST /v1/memory/copy: 400, 404, the copy, the version bump
 *   - Phase 4: key.ts — TTL expiry on read
 *   - Phase 5: key.ts — the anonymous namespace, ownership, 413 and 422
 *   - Phase 6: key.ts — the CORS ladder: node → GHII → agent → record, and both validators
 *   - Phase 7: key.ts — GET /v1/memory/deleted and restorable_until
 *
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=memory-doors
 *
 * @version-history
 *   v1.1.0 — 2026-09-08 — export with ?agent by an agent session asserts 403 (fixed in
 *     routes/memory/bulk.ts) instead of pinning the 200.
 *   v1.0.0 — 2026-09-08 — Initial suite
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, name + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(body.ok === true, `owner token for ${name}: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}

async function agentTokenFor(gaii: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii, timestamp, signature: await signMsg(privKey, gaii + timestamp) }),
  });
  assert(body.ok === true, `agent token for ${gaii}: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}

// ─── State ───
const ownerName = `memdoors${Date.now()}`;
let ownerToken = '';
let ownerGhii = '';

let agentGaii = '';
let agentToken = '';
let siblingGaii = '';

const strangerName = `memdoorsalt${Date.now()}`;
let strangerToken = '';
let strangerGhii = '';
let strangerAgentGaii = '';

let anonToken = '';

const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
const agentAuth = () => ({ Authorization: `Bearer ${agentToken}` });
const strangerAuth = () => ({ Authorization: `Bearer ${strangerToken}` });
const anonAuth = () => ({ Authorization: `Bearer ${anonToken}` });

const PUBLIC_KEY_NAME = `memdoors.shared.note${Date.now()}`;
// A prefix lock is matched by whole dot segments, so the pattern is the segment WITHOUT a trailing
// dot: `memdoorsschema123` covers `memdoorsschema123.record`. Registering `memdoorsschema123.`
// matches nothing and the write sails through, which is what the first draft of this suite did.
const SCHEMA_PREFIX = `memdoorsschema${Date.now()}`;

console.log('\n=== AIMEAT Memory Doors E2E ===\n');

// ─── Phase 0: principals ───
console.log('Phase 0 — Principals');

await test('register owner (operator) + token', async () => {
  const { status, body } = await json('/v1/admin/setup/register', {
    method: 'POST',
    headers: { 'X-Admin-Password': ADMIN_PW },
    body: JSON.stringify({ name: ownerName }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await ownerTokenFor(ownerName, body.private_key);
  ownerGhii = `${ownerName}@${NODE_ID}`;
});

await test('register two agents of that owner', async () => {
  for (const [name, into] of [['memdoorsone', 'first'], ['memdoorstwo', 'second']] as const) {
    const { status, body } = await json('/v1/agents', {
      method: 'POST', headers: ownerAuth(),
      body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'test' }),
    });
    assert(status === 201, `${name}: status ${status}: ${JSON.stringify(body)}`);
    if (into === 'first') {
      agentGaii = body.data.agent.gaii;
      agentToken = await agentTokenFor(agentGaii, body.data.private_key);
    } else {
      siblingGaii = body.data.agent.gaii;
    }
  }
  assert(agentGaii !== '' && siblingGaii !== '', 'both agents registered');
});

await test('register a second owner with an agent of their own', async () => {
  const reg = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
  strangerToken = await ownerTokenFor(strangerName, reg.body.data.private_key);
  strangerGhii = `${strangerName}@${NODE_ID}`;
  // A REAL agent of another owner. A name the node has never heard of would be refused by the
  // `!targetAgent` half of the same line and would prove nothing about the ownership check.
  const ag = await json('/v1/agents', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ name: 'memdoorsalien', owner: strangerName, capabilities: ['memory'], model: 'test' }),
  });
  assert(ag.status === 201, `stranger agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
  strangerAgentGaii = ag.body.data.agent.gaii;
});

await test('open an anonymous session (the shared identity)', async () => {
  const { status, body } = await json('/v1/auth/anonymous', { method: 'POST' });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  anonToken = body.data?.token;
  assert(typeof anonToken === 'string', 'anonymous token');
});

// ─── Phase 1: the batch doors and their ?agent arms ───
console.log('Phase 1 — Batch doors');

await test('POST /v1/memory/bulk refuses more than 1000 entries (400), and 1000 is not the failure', async () => {
  const over = await json('/v1/memory/bulk', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ entries: Array.from({ length: 1001 }, (_, i) => ({ key: `over.${i}`, value: i })) }),
  });
  assert(over.status === 400, `expected 400, got ${over.status}`);
  assert(/at most 1000/.test(over.body.error?.message ?? ''), `message names the ceiling: ${over.body.error?.message}`);
  // The control: the same shape one entry short of the wall is accepted, so the refusal above is
  // about the count and not about the request being malformed.
  const under = await json('/v1/memory/bulk', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ entries: [{ key: 'doors.bulk.control', value: { n: 1 } }] }),
  });
  assert(under.status === 200, `control: expected 200, got ${under.status}: ${JSON.stringify(under.body?.error)}`);
});

await test('bulk: an AGENT session may not name an agent at all (403 "only owner sessions")', async () => {
  // The agent branch has two halves and they refuse different people. This is the first: whoever is
  // holding an agent token is already writing as that agent, so naming a target is a role question
  // before it is an ownership one — even when the target is a sibling of the same owner.
  const { status, body } = await json('/v1/memory/bulk', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ agent: siblingGaii, entries: [{ key: 'doors.bulk.sib', value: 1 }] }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body?.data ?? body?.error)}`);
  assert(/only owner sessions/i.test(body.error?.message ?? ''), `message: ${body.error?.message}`);
});

await test('bulk: an OWNER session may not name ANOTHER owner\'s agent (403)', async () => {
  const { status, body } = await json('/v1/memory/bulk', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ agent: strangerAgentGaii, entries: [{ key: 'doors.bulk.alien', value: 1 }] }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body?.data ?? body?.error)}`);
  // The control: the same call naming their OWN agent goes through, so the refusal is about whose
  // agent it is rather than about the parameter being rejected outright.
  const mine = await json('/v1/memory/bulk', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ agent: siblingGaii, entries: [{ key: 'doors.bulk.own', value: 1 }] }),
  });
  assert(mine.status === 200, `own agent: expected 200, got ${mine.status}: ${JSON.stringify(mine.body?.error)}`);
});

await test('export: ?agent naming another owner\'s agent → 403; the caller\'s own sibling is allowed', async () => {
  const alien = await json(`/v1/memory/export?agent=${encodeURIComponent(strangerAgentGaii)}`, { headers: ownerAuth() });
  assert(alien.status === 403, `expected 403, got ${alien.status}: ${JSON.stringify(alien.body?.data)}`);
  assert(JSON.stringify(alien.body).indexOf('entries') === -1, 'the refusal carried an export anyway');

  // Naming a target agent is an owner-session door, the same rule as bulk, import and bulk-delete.
  // Until 2026-09-08 this door lacked that half, so an AGENT holding memory:read could export a
  // SIBLING agent's whole keyspace by naming it. Fixed in routes/memory/bulk.ts; asserted here.
  const sibling = await json(`/v1/memory/export?agent=${encodeURIComponent(siblingGaii)}`, { headers: agentAuth() });
  assert(sibling.status === 403, `sibling export by an agent session: expected 403, got ${sibling.status}`);
  assert(JSON.stringify(sibling.body).indexOf('entries') === -1, 'the refusal carried an export anyway');
  // The owner session still may.
  const byOwner = await json(`/v1/memory/export?agent=${encodeURIComponent(siblingGaii)}`, { headers: ownerAuth() });
  assert(byOwner.status === 200, `owner export of own agent: got ${byOwner.status}: ${JSON.stringify(byOwner.body?.error)}`);
  assert(Array.isArray(byOwner.body.data?.entries), 'the owner export returns entries');
});

await test('import: both ?agent arms refuse, and a body with no entries is a 400', async () => {
  const asAgent = await json('/v1/memory/import', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ agent: siblingGaii, entries: [{ key: 'doors.import.sib', value: 1 }] }),
  });
  assert(asAgent.status === 403, `agent session: expected 403, got ${asAgent.status}`);
  assert(/only owner sessions/i.test(asAgent.body.error?.message ?? ''), `message: ${asAgent.body.error?.message}`);

  const alien = await json('/v1/memory/import', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ agent: strangerAgentGaii, entries: [{ key: 'doors.import.alien', value: 1 }] }),
  });
  assert(alien.status === 403, `foreign agent: expected 403, got ${alien.status}`);

  const noEntries = await json('/v1/memory/import', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ mode: 'skip' }),
  });
  assert(noEntries.status === 400, `expected 400, got ${noEntries.status}`);
  assert(noEntries.body.error?.code === 'INVALID_INPUT', `code ${noEntries.body.error?.code}`);
});

await test('bulk-delete: both ?agent arms refuse, and nothing of the target\'s is removed', async () => {
  // Give the sibling something worth losing first, so a refusal that quietly deleted would show.
  const seed = await json('/v1/memory/bulk', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ agent: siblingGaii, entries: [{ key: 'doors.sib.keep', value: { n: 1 } }] }),
  });
  assert(seed.status === 200, `seed ${seed.status}`);

  const asAgent = await json('/v1/memory/bulk-delete', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ agent: siblingGaii, prefix: 'doors.sib.' }),
  });
  assert(asAgent.status === 403, `agent session: expected 403, got ${asAgent.status}`);

  const alien = await json('/v1/memory/bulk-delete', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ agent: strangerAgentGaii, prefix: 'doors.' }),
  });
  assert(alien.status === 403, `foreign agent: expected 403, got ${alien.status}`);

  const still = await json(`/v1/memory/doors.sib.keep?agent=${encodeURIComponent(siblingGaii)}`, { headers: ownerAuth() });
  assert(still.status === 200, `the refused bulk-delete removed it anyway: ${still.status}`);
});

await test('bundle refuses more than 500 items (400)', async () => {
  const { status, body } = await json('/v1/memory/bundle', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ items: Array.from({ length: 501 }, (_, i) => ({ kind: 'memory', key: `b.${i}` })) }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(/at most 500/.test(body.error?.message ?? ''), `message names the ceiling: ${body.error?.message}`);
});

await test('every batch door refuses an unauthenticated caller (401)', async () => {
  const doors: Array<[string, RequestInit]> = [
    ['/v1/memory/bulk', { method: 'POST', body: JSON.stringify({ entries: [{ key: 'x', value: 1 }] }) }],
    ['/v1/memory/export', {}],
    ['/v1/memory/import', { method: 'POST', body: JSON.stringify({ entries: [{ key: 'x', value: 1 }] }) }],
    ['/v1/memory/bulk-delete', { method: 'POST', body: JSON.stringify({ prefix: 'x.' }) }],
    ['/v1/memory/discover', {}],
    ['/v1/memory/copy', { method: 'POST', body: JSON.stringify({ source_gaii: 'a', key: 'b' }) }],
  ];
  for (const [path, opts] of doors) {
    const { status } = await json(path, opts);
    assert(status === 401, `${path}: expected 401, got ${status}`);
  }
});

// ─── Phase 2: discover ───
console.log('Phase 2 — GET /v1/memory/discover');

await test('the second owner publishes a public record for the rest of the node to find', async () => {
  const { status, body } = await json('/v1/memory', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ key: PUBLIC_KEY_NAME, value: { text: 'anyone may read this' }, visibility: 'public', tags: ['memdoorstag'] }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('discover lists another owner\'s public key and never the caller\'s own', async () => {
  const mine = `memdoors.mine.public${Date.now()}`;
  const own = await json('/v1/memory', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ key: mine, value: { text: 'mine' }, visibility: 'public' }),
  });
  assert(own.status === 201, `own public write ${own.status}`);

  const { status, body } = await json('/v1/memory/discover?limit=200', { headers: ownerAuth() });
  assert(status === 200, `status ${status}`);
  const items = body.data?.items ?? [];
  const found = items.find((i: { key: string }) => i.key === PUBLIC_KEY_NAME);
  assert(found !== undefined, `the other owner's public key is discoverable: ${items.length} items seen`);
  assert(found.owner_gaii === strangerGhii, `owner_gaii ${found.owner_gaii} === ${strangerGhii}`);
  assert(!items.some((i: { key: string }) => i.key === mine), 'discover returned the caller\'s own entry');
});

await test('discover narrows by ?prefix, by ?owner and by ?q', async () => {
  const byPrefix = await json('/v1/memory/discover?prefix=memdoors.shared.', { headers: ownerAuth() });
  assert((byPrefix.body.data?.items ?? []).every((i: { key: string }) => i.key.startsWith('memdoors.shared.')),
    'every ?prefix hit starts with the prefix');
  assert((byPrefix.body.data?.items ?? []).some((i: { key: string }) => i.key === PUBLIC_KEY_NAME), 'the key is in the prefix slice');

  const byOwner = await json(`/v1/memory/discover?owner=${encodeURIComponent(strangerGhii)}`, { headers: ownerAuth() });
  assert((byOwner.body.data?.items ?? []).length >= 1, 'the ?owner slice is not empty');
  assert((byOwner.body.data?.items ?? []).every((i: { owner_gaii: string }) => i.owner_gaii.startsWith(strangerName)),
    'every ?owner hit belongs to that owner');

  const byQ = await json(`/v1/memory/discover?q=${encodeURIComponent('shared.note')}`, { headers: ownerAuth() });
  assert((byQ.body.data?.items ?? []).some((i: { key: string }) => i.key === PUBLIC_KEY_NAME), 'the ?q text matched the key');
  const missQ = await json('/v1/memory/discover?q=nothingmatchesthisxyzzy', { headers: ownerAuth() });
  assert((missQ.body.data?.items ?? []).length === 0, `a ?q nothing matches is empty, got ${missQ.body.data?.total}`);
});

// ─── Phase 3: copy ───
console.log('Phase 3 — POST /v1/memory/copy');

await test('copy without source_gaii or key → 400', async () => {
  for (const payload of [{}, { key: PUBLIC_KEY_NAME }, { source_gaii: strangerGhii }]) {
    const { status, body } = await json('/v1/memory/copy', {
      method: 'POST', headers: agentAuth(), body: JSON.stringify(payload),
    });
    assert(status === 400, `${JSON.stringify(payload)}: expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_INPUT', `code ${body.error?.code}`);
  }
});

await test('copy of a record that is not public → 404, whether it exists or not', async () => {
  const priv = `memdoors.private.note${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: strangerAuth(),
    body: JSON.stringify({ key: priv, value: { text: 'not for you' }, visibility: 'private' }),
  });
  assert(w.status === 201, `private write ${w.status}`);

  const real = await json('/v1/memory/copy', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ source_gaii: strangerGhii, key: priv }),
  });
  assert(real.status === 404, `a private record: expected 404, got ${real.status}`);
  assert(JSON.stringify(real.body).indexOf('not for you') === -1, 'the refusal carried the value');

  const missing = await json('/v1/memory/copy', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ source_gaii: strangerGhii, key: 'never.written.at.all' }),
  });
  assert(missing.status === 404, `a missing record: expected 404, got ${missing.status}`);
});

await test('copy lands in the caller\'s own keyspace at version 1, and a second copy bumps to 2', async () => {
  const first = await json('/v1/memory/copy', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ source_gaii: strangerGhii, key: PUBLIC_KEY_NAME }),
  });
  assert(first.status === 200, `first copy ${first.status}: ${JSON.stringify(first.body?.error)}`);
  assert(first.body.data?.version === 1, `version ${first.body.data?.version}`);
  assert(first.body.data?.copied_from === strangerGhii, `copied_from ${first.body.data?.copied_from}`);

  const read = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY_NAME)}`, { headers: agentAuth() });
  assert(read.status === 200, `the copy is readable by the copier: ${read.status}`);
  assert(read.body.data?.value?.text === 'anyone may read this', `value ${JSON.stringify(read.body.data?.value)}`);
  // The copy is the copier's own, private by default — publishing somebody else's record is not
  // what copying it does.
  assert(read.body.data?.visibility === 'private', `visibility ${read.body.data?.visibility}`);

  const second = await json('/v1/memory/copy', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ source_gaii: strangerGhii, key: PUBLIC_KEY_NAME }),
  });
  assert(second.status === 200, `second copy ${second.status}`);
  assert(second.body.data?.version === 2, `the second copy bumps the version, got ${second.body.data?.version}`);
});

// ─── Phase 4: TTL ───
console.log('Phase 4 — TTL expiry on read');

await test('a record past its ttl_hours reads as 404 and is gone from the keyspace', async () => {
  // A fraction of an hour: 0.0003 h is about 1.1 s, which is the shortest wait that still proves
  // the arithmetic rather than a rounding accident.
  const key = `memdoors.ttl${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(),
    body: JSON.stringify({ key, value: { alive: true }, visibility: 'private', ttl_hours: 0.0003 }),
  });
  assert(w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);

  const fresh = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert(fresh.status === 200, `before the TTL it reads: ${fresh.status}`);

  await sleep(2000);

  const stale = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert(stale.status === 404, `after the TTL: expected 404, got ${stale.status}`);
  // The read DELETES it, so the listing must agree: a 404 that left the row behind would keep
  // charging the key ceiling for something no read can reach.
  const list = await json(`/v1/memory?prefix=${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert((list.body.data?.items ?? []).length === 0, `the expired row survived the read: ${JSON.stringify(list.body.data?.items)}`);
});

// ─── Phase 5: the per-key refusals ───
console.log('Phase 5 — Per-key refusals');

await test('the anonymous session may not DELETE outside anonymous.*', async () => {
  const { status, body } = await json('/v1/memory/doors.bulk.control', { method: 'DELETE', headers: anonAuth() });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body?.data)}`);
  assert(/anonymous\./.test(body.error?.message ?? ''), `message names the namespace: ${body.error?.message}`);
  const still = await json('/v1/memory/doors.bulk.control', { headers: agentAuth() });
  assert(still.status === 200, `the refused DELETE removed it anyway: ${still.status}`);
});

await test('the anonymous session may not PUT outside anonymous.*', async () => {
  const { status, body } = await json('/v1/memory/doors.bulk.control', {
    method: 'PUT', headers: anonAuth(), body: JSON.stringify({ value: { taken: true }, version: 1 }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body?.data)}`);
  assert(/anonymous\./.test(body.error?.message ?? ''), `message names the namespace: ${body.error?.message}`);
});

await test('the anonymous session CAN write its own namespace — so the two refusals are about the key', async () => {
  const key = `anonymous.memdoors${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: anonAuth(), body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }),
  });
  assert(w.status === 201, `anonymous write ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const p = await json(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: anonAuth(), body: JSON.stringify({ value: { n: 2 }, version: 1 }),
  });
  assert(p.status === 200, `anonymous PUT in its own namespace ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const d = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: anonAuth() });
  assert(d.status === 200, `anonymous DELETE in its own namespace ${d.status}`);
});

await test('a second owner\'s PUT never reaches somebody else\'s record', async () => {
  // WHAT THIS PINS. routes/memory/key.ts:312-315 answers 403 ACCESS_DENIED when the record found
  // is not the effective identity's — defense in depth behind a lookup that is already keyed by
  // identity. No HTTP path reaches it today: getMemory() is scoped by GAII, and the owner-scope
  // branch sets effectiveGaii to the namespace it found the record in, so the two can never differ.
  // So the observable refusal is a 404, and that is what this asserts. If it ever becomes a 403,
  // the lookup changed and somebody should read why.
  const key = `memdoors.notyours${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }),
  });
  assert(w.status === 201, `write ${w.status}`);

  const theirs = await json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true`, {
    method: 'PUT', headers: strangerAuth(), body: JSON.stringify({ value: { n: 99 }, version: 1 }),
  });
  assert(theirs.status === 404, `expected 404, got ${theirs.status}: ${JSON.stringify(theirs.body?.error)}`);
  const still = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert(still.body.data?.value?.n === 1, `the refused PUT changed the value to ${JSON.stringify(still.body.data?.value)}`);
});

await test('PUT of a value over the per-value cap → 413, and the cap is the one config names', async () => {
  const key = `memdoors.big${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ key, value: { small: true }, visibility: 'private' }),
  });
  assert(w.status === 201, `write ${w.status}`);

  const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: agentAuth(),
    body: JSON.stringify({ value: { blob: 'x'.repeat(2 * 1024 * 1024) }, version: 1 }),
  });
  assert(status === 413, `expected 413, got ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.error?.code === 'QUOTA_EXCEEDED', `code ${body.error?.code}`);
  // Read the cap out of the refusal rather than hardcoding it: it is an operator setting
  // (memoryMaxValueSizeKb, 1024 kB shipped) and a suite that pins the number breaks on a node that
  // set a different one.
  const cap = parseInt(/limit of (\d+) bytes/.exec(body.error?.message ?? '')?.[1] ?? '0', 10);
  assert(cap > 0, `the refusal names the cap: ${body.error?.message}`);
  const still = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert(still.body.data?.version === 1, `the refused PUT bumped the version to ${still.body.data?.version}`);
});

await test('PUT of a value the key\'s schema refuses → 422 SCHEMA_VALIDATION_FAILED', async () => {
  const lock = await json(`/v1/memory/${encodeURIComponent(SCHEMA_PREFIX)}/schema`, {
    method: 'PUT', headers: ownerAuth(),
    body: JSON.stringify({
      apply_to: 'prefix',
      schema_mode: 'open',
      schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    }),
  });
  assert(lock.status === 200, `schema lock ${lock.status}: ${JSON.stringify(lock.body?.error)}`);

  const key = `${SCHEMA_PREFIX}.record`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }),
  });
  assert(w.status === 201, `a conforming write is accepted: ${w.status} ${JSON.stringify(w.body?.error)}`);

  const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: agentAuth(), body: JSON.stringify({ value: { n: 'not a number' }, version: 1 }),
  });
  assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.error?.code === 'SCHEMA_VALIDATION_FAILED', `code ${body.error?.code}`);
  assert(Array.isArray(body.error?.details?.violations) && body.error.details.violations.length > 0,
    `the refusal says what was wrong: ${JSON.stringify(body.error?.details)}`);
  assert(typeof body.error?.details?.schema_url === 'string' && body.error.details.schema_url.includes('/schema'),
    `and where the rule lives: ${body.error?.details?.schema_url}`);

  const still = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: agentAuth() });
  assert(still.body.data?.value?.n === 1, `the refused PUT stored the bad value: ${JSON.stringify(still.body.data?.value)}`);
});

await test('PUT and DELETE without auth → 401', async () => {
  const put = await json('/v1/memory/doors.bulk.control', { method: 'PUT', body: JSON.stringify({ value: 1, version: 1 }) });
  assert(put.status === 401, `PUT: expected 401, got ${put.status}`);
  const del = await json('/v1/memory/doors.bulk.control', { method: 'DELETE' });
  assert(del.status === 401, `DELETE: expected 401, got ${del.status}`);
});

// ─── Phase 6: the CORS ladder ───
console.log('Phase 6 — CORS inheritance ladder');

const CORS_KEY = `memdoors.cors${Date.now()}`;

await test('a record with no origins of its own inherits from the node', async () => {
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ key: CORS_KEY, value: { n: 1 }, visibility: 'private' }),
  });
  assert(w.status === 201, `write ${w.status}`);
  const { status, body } = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.allowed_origins === null, `the record declares none: ${JSON.stringify(body.data?.allowed_origins)}`);
  assert(body.data?.inherited_from === 'node', `inherited_from ${body.data?.inherited_from}`);
  assert(Array.isArray(body.data?.effective), 'effective is a list');
});

await test('GHII origins take over from the node\'s', async () => {
  const put = await json(`/v1/admin/ghii/${encodeURIComponent(ownerGhii)}/cors`, {
    method: 'PUT', headers: ownerAuth(), body: JSON.stringify({ allowed_origins: ['https://ghii.example'] }),
  });
  assert(put.status === 200, `admin ghii cors ${put.status}: ${JSON.stringify(put.body?.error)}`);
  const { body } = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(body.data?.inherited_from === 'ghii', `inherited_from ${body.data?.inherited_from}`);
  assert(JSON.stringify(body.data?.effective) === JSON.stringify(['https://ghii.example']),
    `effective ${JSON.stringify(body.data?.effective)}`);
});

await test('the agent\'s own origins take over from the GHII\'s', async () => {
  const put = await json(`/v1/admin/agents/${encodeURIComponent(agentGaii)}/cors`, {
    method: 'PUT', headers: ownerAuth(), body: JSON.stringify({ allowed_origins: ['https://agent.example'] }),
  });
  assert(put.status === 200, `admin agent cors ${put.status}: ${JSON.stringify(put.body?.error)}`);
  const { body } = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(body.data?.inherited_from === 'agent', `inherited_from ${body.data?.inherited_from}`);
  assert(JSON.stringify(body.data?.effective) === JSON.stringify(['https://agent.example']),
    `effective ${JSON.stringify(body.data?.effective)}`);
});

await test('the record\'s own origins are the last word, and null hands the key back to the ladder', async () => {
  const set = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, {
    method: 'PUT', headers: agentAuth(), body: JSON.stringify({ allowed_origins: ['https://record.example', '*'] }),
  });
  assert(set.status === 200, `status ${set.status}: ${JSON.stringify(set.body?.error)}`);
  assert(JSON.stringify(set.body.data?.allowed_origins) === JSON.stringify(['https://record.example', '*']),
    `stored ${JSON.stringify(set.body.data?.allowed_origins)}`);

  const read = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(read.body.data?.inherited_from === 'none', `inherited_from ${read.body.data?.inherited_from}`);
  assert(JSON.stringify(read.body.data?.effective) === JSON.stringify(['https://record.example', '*']),
    `effective ${JSON.stringify(read.body.data?.effective)}`);

  const cleared = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, {
    method: 'PUT', headers: agentAuth(), body: JSON.stringify({ allowed_origins: null }),
  });
  assert(cleared.status === 200, `clear ${cleared.status}`);
  assert(cleared.body.data?.allowed_origins === null, `cleared to ${JSON.stringify(cleared.body.data?.allowed_origins)}`);
  const back = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(back.body.data?.inherited_from === 'agent', `back to the agent rung, got ${back.body.data?.inherited_from}`);
});

await test('PUT cors refuses a non-array and an origin that is not an http(s) URL (400 each)', async () => {
  const notArray = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, {
    method: 'PUT', headers: agentAuth(), body: JSON.stringify({ allowed_origins: 'https://one.example' }),
  });
  assert(notArray.status === 400, `non-array: expected 400, got ${notArray.status}`);
  assert(notArray.body.error?.code === 'INVALID_INPUT', `code ${notArray.body.error?.code}`);

  for (const bad of ['ftp://elsewhere.example', 'elsewhere.example', 42]) {
    const { status, body } = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, {
      method: 'PUT', headers: agentAuth(), body: JSON.stringify({ allowed_origins: [bad] }),
    });
    assert(status === 400, `${JSON.stringify(bad)}: expected 400, got ${status}`);
    assert(/Invalid origin/.test(body.error?.message ?? ''), `${JSON.stringify(bad)}: message ${body.error?.message}`);
  }
  const untouched = await json(`/v1/memory/cors/${encodeURIComponent(CORS_KEY)}`, { headers: agentAuth() });
  assert(untouched.body.data?.allowed_origins === null, 'a refused PUT wrote origins anyway');
});

await test('cors on a key the caller does not have → 404 on both doors', async () => {
  const get = await json('/v1/memory/cors/memdoors.no.such.key', { headers: agentAuth() });
  assert(get.status === 404, `GET: expected 404, got ${get.status}`);
  const put = await json('/v1/memory/cors/memdoors.no.such.key', {
    method: 'PUT', headers: agentAuth(), body: JSON.stringify({ allowed_origins: ['https://x.example'] }),
  });
  assert(put.status === 404, `PUT: expected 404, got ${put.status}`);
});

// ─── Phase 7: the bin ───
console.log('Phase 7 — GET /v1/memory/deleted');

await test('a deleted key appears in the bin with the day it stops being restorable', async () => {
  const key = `memdoors.binned${Date.now()}`;
  const w = await json('/v1/memory', {
    method: 'POST', headers: agentAuth(), body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }),
  });
  assert(w.status === 201, `write ${w.status}`);
  const d = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: agentAuth() });
  assert(d.status === 200, `delete ${d.status}`);

  const { status, body } = await json('/v1/memory/deleted', { headers: agentAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(typeof body.data?.grace_days === 'number', `grace_days ${body.data?.grace_days}`);
  const row = (body.data?.items ?? []).find((i: { key: string }) => i.key === key);
  assert(row !== undefined, `the deleted key is in the bin: ${JSON.stringify((body.data?.items ?? []).map((i: { key: string }) => i.key))}`);
  assert(typeof row.deleted_at === 'string', `deleted_at ${row.deleted_at}`);
  // What a person acts on is not the date it went but how long they have left, so the field has to
  // be the LATER of the two and not a copy of deleted_at.
  assert(typeof row.restorable_until === 'string', `restorable_until ${row.restorable_until}`);
  assert(new Date(row.restorable_until).getTime() > new Date(row.deleted_at).getTime(),
    `restorable_until ${row.restorable_until} must be after deleted_at ${row.deleted_at}`);

  const restored = await json(`/v1/memory/${encodeURIComponent(key)}/restore`, { method: 'POST', headers: agentAuth() });
  assert(restored.status === 200, `the bin's promise is keepable: restore ${restored.status}`);
});

await test('the bin route is not reached by a caller with no token (401)', async () => {
  // It is registered BEFORE /v1/memory/:key on purpose; a 404 saying "Memory key not found:
  // deleted" would mean the literal path had been swallowed as a key.
  const { status } = await json('/v1/memory/deleted');
  assert(status === 401, `expected 401, got ${status}`);
});

// ─── Cleanup ───
console.log('Cleanup');

await test('drop the schema lock and both owners', async () => {
  // The lock is node-wide, not per-owner, so a suite that leaves one behind changes what the next
  // one may write.
  const unlock = await json(`/v1/memory/${encodeURIComponent(SCHEMA_PREFIX)}/schema`, {
    method: 'DELETE', headers: ownerAuth(),
  });
  assert(unlock.status === 200, `schema delete ${unlock.status}: ${JSON.stringify(unlock.body?.error)}`);
  await json(`/v1/owners/${encodeURIComponent(strangerName)}`, { method: 'DELETE', headers: strangerAuth() });
  const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: ownerAuth() });
  assert(status === 200, `delete owner: ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);

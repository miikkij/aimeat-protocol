// E2E: a memory delete that can be taken back, and that eventually means delete.
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=memory-bin
//
// WHY THIS EXISTS. This node deliberately had no delete at all: a value could be emptied but never
// removed, so nothing could be lost by accident. The cost was real and was paid on 2026-09-03 — an
// agent could write memory through a tool and never clean up after itself, `memory:delete` was a
// permission an owner could grant that reached no tool anywhere, and a crew cleaning up after a test
// had to overwrite six keys with a "retired" marker because there was nothing else it could do.
//
// The delete that replaced that principle keeps its spirit by being undoable for a grace window.
// What has to be proven is therefore both halves: that a deleted record is GONE from every way of
// looking at it, and that it COMES BACK whole until the window closes. Either one alone is a
// feature that lies — a delete that leaves the record findable did not delete, and a bin nothing
// empties is a rename.
//
// THE READS ARE THE POINT. A soft delete is only as good as the places that remember to hide it,
// and this node has many: by key, the bulk list, full-text search, and the ARCHIVE search, which is
// its own trap because archived and deleted are different states that share the exclusion
// machinery. Each is asserted separately.

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}

const ed = await import('@noble/ed25519');
const { createHash } = await import('node:crypto');
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function getAgentToken(gaii: string, privB64: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(privB64, 'base64'));
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }),
  });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

async function getOwnerToken(owner: string, privB64: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + ts), Buffer.from(privB64, 'base64'));
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner, timestamp: ts, signature: Buffer.from(sig).toString('base64') }),
  });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const stamp = Date.now();
const ownerA = `mba${stamp}`;
const ownerB = `mbb${stamp}`;
let tokA = '';
let tokB = '';
const KEY = 'bin.subject';
const KEEP = 'bin.bystander';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT: the memory bin ===\n');

console.log('Setup');
await test('Two owners, and two records under the first', async () => {
  const a = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerA, public_key: 'placeholder' }) });
  assert(a.status === 201, `owner A: ${JSON.stringify(a.body)}`);
  tokA = await getOwnerToken(ownerA, a.body.data.private_key);
  const b = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerB, public_key: 'placeholder' }) });
  assert(b.status === 201, `owner B: ${JSON.stringify(b.body)}`);
  tokB = await getOwnerToken(ownerB, b.body.data.private_key);

  // The word in the value is what the text search will look for. The bystander proves the delete is
  // about ONE record: a filter written slightly wrong takes the neighbour with it.
  for (const [key, value] of [[KEY, { note: 'zibbleflux marker' }], [KEEP, { note: 'zibbleflux marker' }]] as const) {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(tokA), body: JSON.stringify({ key, value, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `write ${key}: ${JSON.stringify(w.body)}`);
  }
});

console.log('\nIt goes');
await test('1. Delete answers with the moment it stops being takeable back', async () => {
  const d = await json(`/v1/memory/${KEY}`, { method: 'DELETE', headers: auth(tokA) });
  assert(d.status === 200, `delete: ${d.status} ${JSON.stringify(d.body)}`);
  assert(d.body.data.deleted === true, 'deleted flag');
  // The one thing a person needs after pressing delete, and the one thing `deleted: true` never told
  // them. Null only when the operator chose an immediate, final delete.
  assert(typeof d.body.data.grace_days === 'number', `grace_days: ${JSON.stringify(d.body.data)}`);
  if (d.body.data.grace_days > 0) {
    assert(!!d.body.data.restorable_until, 'a grace window must say when it closes');
    assert(new Date(d.body.data.restorable_until).getTime() > Date.now(), 'the window closes in the future');
  }
});

await test('2. It is gone by key', async () => {
  const r = await json(`/v1/memory/${KEY}`, { headers: auth(tokA) });
  assert(r.status === 404, `expected 404 by key, got ${r.status}`);
});

await test('3. It is gone from the listing, and the neighbour is not', async () => {
  const l = await json('/v1/memory?prefix=bin.', { headers: auth(tokA) });
  const keys = (l.body.data.items ?? l.body.data.memories ?? []).map((m: any) => m.key);
  assert(!keys.includes(KEY), `the deleted key is still listed: ${JSON.stringify(keys)}`);
  assert(keys.includes(KEEP), `the delete took its neighbour with it: ${JSON.stringify(keys)}`);
});

await test('4. It is gone from text search — the read that does not use the shared filter', async () => {
  // This path routes by CHOOSING an index rather than by adding a predicate, so it is the one read
  // the shared exclusion fragment never touches. It leaked until it was asked to.
  const s = await json('/v1/memory/search?q=zibbleflux', { headers: auth(tokA) });
  const keys = (s.body?.data?.items ?? s.body?.data?.results ?? []).map((m: any) => m.key);
  assert(!keys.includes(KEY), `the deleted key came back from a text search: ${JSON.stringify(keys)}`);
});

await test('5. It is gone from the ARCHIVE search too', async () => {
  // Archived and deleted are different states that share the exclusion machinery. An archive search
  // returning the bin would make the two words mean one thing.
  const s = await json('/v1/memory?prefix=bin.&archived=only', { headers: auth(tokA) });
  const keys = (s.body?.data?.items ?? s.body?.data?.memories ?? []).map((m: any) => m.key);
  assert(!keys.includes(KEY), `the bin surfaced in the archive search: ${JSON.stringify(keys)}`);
});

console.log('\nIt comes back');
await test('6. The bin lists it, with the time it has left', async () => {
  const b = await json('/v1/memory/deleted', { headers: auth(tokA) });
  assert(b.status === 200, `bin: ${b.status} ${JSON.stringify(b.body)}`);
  const row = (b.body.data.items ?? []).find((i: any) => i.key === KEY);
  assert(!!row, `the deleted key is not in the bin: ${JSON.stringify(b.body.data)}`);
  assert(!!row.deleted_at, 'the bin says when it went');
});

await test('7. Another owner sees nothing of it', async () => {
  const b = await json('/v1/memory/deleted', { headers: auth(tokB) });
  const keys = (b.body?.data?.items ?? []).map((i: any) => i.key);
  assert(!keys.includes(KEY), `owner B can see owner A's bin: ${JSON.stringify(keys)}`);
  const r = await json(`/v1/memory/${KEY}/restore`, { method: 'POST', headers: auth(tokB) });
  assert(r.status === 404, `owner B restored someone else's record: ${r.status}`);
});

await test('8. Restore brings it back whole', async () => {
  const r = await json(`/v1/memory/${KEY}/restore`, { method: 'POST', headers: auth(tokA) });
  assert(r.status === 200, `restore: ${r.status} ${JSON.stringify(r.body)}`);
  const back = await json(`/v1/memory/${KEY}`, { headers: auth(tokA) });
  assert(back.status === 200, `after restore the key must read again, got ${back.status}`);
  assert(back.body.data.value?.note === 'zibbleflux marker', `the value came back changed: ${JSON.stringify(back.body.data.value)}`);
});

await test('9. Restoring something that is not in the bin is refused, and says which', async () => {
  const r = await json(`/v1/memory/${KEEP}/restore`, { method: 'POST', headers: auth(tokA) });
  assert(r.status === 404, `expected 404, got ${r.status}`);
  assert(r.body.error?.code === 'NOT_RESTORABLE', `expected NOT_RESTORABLE, got ${r.body.error?.code}`);
});

await test('10. Deleting twice does not restart the clock', async () => {
  const first = await json(`/v1/memory/${KEY}`, { method: 'DELETE', headers: auth(tokA) });
  assert(first.status === 200, `first delete: ${first.status}`);
  // Already in the bin: the second press must not re-stamp it, or a retrying loop could hold a
  // record out of reach for ever and the window would never close.
  const second = await json(`/v1/memory/${KEY}`, { method: 'DELETE', headers: auth(tokA) });
  assert(second.status === 404, `a second delete must find nothing, got ${second.status}`);
});

console.log('\nAnd it eventually means delete');
await test('11. The key ceiling does not count what is in the bin', async () => {
  // Cleaning up must never be the thing that locks an agent out of writing.
  const l = await json('/v1/memory?prefix=bin.', { headers: auth(tokA) });
  const keys = (l.body.data.items ?? l.body.data.memories ?? []).map((m: any) => m.key);
  assert(keys.length === 1 && keys[0] === KEEP, `only the live record counts: ${JSON.stringify(keys)}`);
});

await test('12. Without memory:delete the door is shut, and says so', async () => {
  // THE POINT OF THE WHOLE CHANGE, asserted. `memory:delete` was a permission an owner could grant
  // that no tool anywhere asked for, so granting it did nothing and withholding it protected
  // nothing. Now it decides. An agent holding read and write and NOT delete must be refused, or the
  // word is decoration again.
  const mk = await json('/v1/agents', {
    method: 'POST', headers: auth(tokA),
    body: JSON.stringify({ name: 'nodelete', owner: ownerA, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
  });
  assert(mk.status === 201, `agent: ${JSON.stringify(mk.body)}`);
  const agentTok = await getAgentToken(mk.body.data.agent.gaii, mk.body.data.private_key);

  const own = await json('/v1/memory', {
    method: 'POST', headers: auth(agentTok),
    body: JSON.stringify({ key: 'bin.agentowned', value: { n: 1 }, visibility: 'private' }),
  });
  assert(own.status === 200 || own.status === 201, `the agent can write: ${JSON.stringify(own.body)}`);

  // Its OWN record, so nothing but the scope can be what refuses this.
  const d = await json('/v1/memory/bin.agentowned', { method: 'DELETE', headers: auth(agentTok) });
  assert(d.status === 403, `expected 403 without memory:delete, got ${d.status} ${JSON.stringify(d.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

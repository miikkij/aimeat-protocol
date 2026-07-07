/**
 * @file e2e-write-guards.ts
 * @description E2E for TARGET-009 S1 workspace write guards: per-namespace manifest policies
 *   `create_only` (append-only spaces — publish over an existing record and record deletion are
 *   refused) and `requires_expected_version` (optimistic locking on publish). Also proves the
 *   backward-compat invariant: an unguarded namespace behaves exactly as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=write-guards
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial: create conflict, version mismatch/required, identical
 *     re-publish idempotence, direct-write protection, append-only delete refusal, free-space
 *     regression (doc-pyxoy49 S1/S3; the TARGET-005 overwrite incident is the reason).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

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
  const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function ownerToken(name: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
  assert(body.ok === true, `owner token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(prefix: string) {
  const name = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  assert(reg.status === 201, `register owner ${reg.status}: ${JSON.stringify(reg.body)}`);
  return { name, token: await ownerToken(name, reg.body.data.private_key) };
}

// ─── State ───
let A: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-guards';
const root = () => `organism.${orgId}.w.${WS}`;

async function draft(ns: string, id: string, value: unknown) {
  const r = await json('/v1/memory', {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ key: `${root()}.${ns}.${id}.draft`, value, visibility: 'private' }),
  });
  assert(r.status === 200 || r.status === 201, `draft write ${r.status}: ${JSON.stringify(r.body.error)}`);
}
async function publish(ns: string, id: string, expected?: number) {
  return json(`/v1/organisms/${orgId}/publish`, {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ namespace: ns, id, ws: WS, ...(expected !== undefined ? { expected_version: expected } : {}) }),
  });
}
const guardRule = (body: any): string =>
  String(body?.error?.details?.violations?.[0]?.schema_rule ?? body?.error?.detail?.violations?.[0]?.schema_rule ?? '');

async function run() {
  console.log('E2E: workspace write guards (TARGET-009 S1)');

  await test('setup: owner + organism + guarded manifest', async () => {
    A = await setupOwner('wg');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Write Guards Rig', description: 'e2e', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`);
    orgId = o.body.data.organism.id;
    const manifest = {
      manifestVersion: '1.0', id: orgId, name: 'Guards', kind: 'project', status: 'active',
      objectTypes: [
        { name: 'event', schemaRef: 'schema:event@1', writeRole: 'member', namespace: 'evt', backing: 'memory', cardinality: 'many', versioned: true, mode: 'records', create_only: true },
        { name: 'record', schemaRef: 'schema:record@1', writeRole: 'member', namespace: 'rec', backing: 'memory', cardinality: 'many', versioned: true, mode: 'records', requires_expected_version: true },
        { name: 'free', schemaRef: 'schema:free@1', writeRole: 'member', namespace: 'free', backing: 'memory', cardinality: 'many', versioned: true, mode: 'records' },
      ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 200 || mr.status === 201, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
  });

  await test('regression: an unguarded namespace publishes and re-publishes exactly as before', async () => {
    await draft('free', 'f1', { id: 'f1', note: 'one' });
    const p1 = await publish('free', 'f1');
    assert(p1.status === 200 && p1.body.data.version === 1, `free publish v1: ${p1.status} ${JSON.stringify(p1.body)}`);
    await draft('free', 'f1', { id: 'f1', note: 'two' });
    const p2 = await publish('free', 'f1');
    assert(p2.status === 200 && p2.body.data.version === 2, `free publish v2 (upsert unchanged): ${p2.status}`);
  });

  await test('create_only: first publish succeeds', async () => {
    await draft('evt', 'e1', { id: 'e1', kind: 'CREATED' });
    const p = await publish('evt', 'e1');
    assert(p.status === 200 && p.body.data.version === 1, `evt publish: ${p.status} ${JSON.stringify(p.body)}`);
  });

  await test('create_only: publish over an existing record returns 409 with the current version, nothing written', async () => {
    await draft('evt', 'e1', { id: 'e1', kind: 'TAMPERED' });
    const p = await publish('evt', 'e1');
    assert(p.status === 409, `expected 409, got ${p.status}: ${JSON.stringify(p.body)}`);
    assert(guardRule(p.body) === 'write_guard_conflict', `rule: ${guardRule(p.body)}`);
    assert(JSON.stringify(p.body).includes('current'), 'error should carry the current version');
    const read = await json(`/v1/memory/${encodeURIComponent(`${root()}.evt.e1.latest`)}`, { headers: auth(A.token) });
    assert(read.body?.data?.value?.kind === 'CREATED', 'the original event must be untouched');
  });

  await test('create_only: an identical re-publish stays idempotent (no conflict)', async () => {
    await draft('evt', 'e1', { id: 'e1', kind: 'CREATED' });
    const p = await publish('evt', 'e1');
    assert(p.status === 200 && p.body.data.skipped === true, `identical re-publish: ${p.status} ${JSON.stringify(p.body)}`);
  });

  await test('create_only: direct .latest write is refused on the memory API', async () => {
    const r = await json('/v1/memory', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ key: `${root()}.evt.e2.latest`, value: { id: 'e2', kind: 'SNEAKY' }, visibility: 'private' }),
    });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    assert(JSON.stringify(r.body).includes('write_guard_protected'), `body: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await test('create_only: deleting an existing record is refused (append-only)', async () => {
    const d = await json(`/v1/memory/${encodeURIComponent(`${root()}.evt.e1.latest`)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(d.status === 409, `expected 409, got ${d.status}: ${JSON.stringify(d.body)}`);
    const read = await json(`/v1/memory/${encodeURIComponent(`${root()}.evt.e1.latest`)}`, { headers: auth(A.token) });
    assert(read.status === 200, 'the event must still exist after the refused delete');
  });

  await test('requires_expected_version: create (no existing record) succeeds without expected_version', async () => {
    await draft('rec', 'r1', { id: 'r1', title: 'first' });
    const p = await publish('rec', 'r1');
    assert(p.status === 200 && p.body.data.version === 1, `rec create: ${p.status} ${JSON.stringify(p.body)}`);
  });

  await test('requires_expected_version: update WITHOUT expected_version returns 409 (version required)', async () => {
    await draft('rec', 'r1', { id: 'r1', title: 'second' });
    const p = await publish('rec', 'r1');
    assert(p.status === 409, `expected 409, got ${p.status}: ${JSON.stringify(p.body)}`);
    assert(guardRule(p.body) === 'write_guard_version_required', `rule: ${guardRule(p.body)}`);
  });

  await test('requires_expected_version: update with a STALE expected_version returns 409 mismatch, nothing written', async () => {
    const p = await publish('rec', 'r1', 7);
    assert(p.status === 409, `expected 409, got ${p.status}`);
    assert(guardRule(p.body) === 'write_guard_version_mismatch', `rule: ${guardRule(p.body)}`);
    const read = await json(`/v1/memory/${encodeURIComponent(`${root()}.rec.r1.latest`)}`, { headers: auth(A.token) });
    assert(read.body?.data?.value?.title === 'first', 'the record must be untouched after a mismatch');
  });

  await test('requires_expected_version: update with the CURRENT version succeeds', async () => {
    const p = await publish('rec', 'r1', 1);
    assert(p.status === 200 && p.body.data.version === 2, `rec update: ${p.status} ${JSON.stringify(p.body)}`);
    const read = await json(`/v1/memory/${encodeURIComponent(`${root()}.rec.r1.latest`)}`, { headers: auth(A.token) });
    assert(read.body?.data?.value?.title === 'second', 'the update must have landed');
  });

  await test('requires_expected_version: direct .latest write is refused too', async () => {
    const r = await json('/v1/memory', {
      method: 'POST', headers: auth(A.token),
      body: JSON.stringify({ key: `${root()}.rec.r1.latest`, value: { id: 'r1', title: 'bypass' }, visibility: 'private' }),
    });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    assert(JSON.stringify(r.body).includes('write_guard_protected'), `body: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await test('drafts are never guarded (the edit flow stays free)', async () => {
    await draft('evt', 'e1', { id: 'e1', kind: 'ANOTHER-DRAFT' });
    const d = await json(`/v1/memory/${encodeURIComponent(`${root()}.evt.e1.draft`)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(d.status === 200, `draft delete should pass: ${d.status}`);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) { process.exit(1); }
  console.log('✅ All tests passed!');
}

run().catch(err => { console.error('Suite crashed:', err); process.exit(1); });

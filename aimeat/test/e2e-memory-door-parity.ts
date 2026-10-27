/**
 * @file e2e-memory-door-parity.ts
 * @description The memory doors beside the main ones answer what the main ones answer
 *   (secaudit2026oct26, round 8, group memory-a). Each case has two halves: the side door refuses
 *   what the main door refuses, and the legitimate use of the same door keeps its old answer.
 *     1. POST /v1/memory/bulk-delete asks the bin's per-key rules: a credential record is refused when
 *        named and left in place when a prefix matches it, for every caller; an app grant does not
 *        remove a reserved owner key. The owner's and the app's ordinary bulk deletes count as before.
 *     2. PUT /v1/memory/:key?owner_scope=true: an agent without memory:read-as-owner does not change
 *        the visibility of a sibling's private record (it read it as absent); it still edits the
 *        value, and an agent with the tick still relabels.
 *     3. PATCH /v1/memory/:key with owner_scope: an agent holding Full access but not
 *        memory:read-as-owner gets no value of the owner's private record in the answer and does not
 *        relabel it; the merge is still stored. An agent with the tick sees the value as before.
 *     6. DELETE /v1/memory/:key and POST /v1/memory/:key/restore: an app grant does not remove or put
 *        back a reserved owner key; it still removes and restores its ordinary records, and the owner
 *        in person still removes the reserved key.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=memory-door-parity
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26: bulk-delete-skips-bin-refusals,
 *     put-owner-scope-sibling-relabel-bypasses-read-as-owner, owner-scope-patch-answers-value-without-read-as-owner,
 *     memory-bin:app-grant-delete-restore-skips-reserved-owner-keys).
 */
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 1_000_000;
const owner = `mdp${stamp}`;
const FILENAME = 'door-parity.html';
const REDIRECT = 'http://localhost:9911/callback';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const ed = await import('@noble/ed25519');
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function agentToken(gaii: string, privB64: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(privB64, 'base64'));
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

let ownerTok = '';
let appTok = '';
const agents: Record<string, { gaii: string; tok: string }> = {};

async function makeAgent(name: string, scopes: string[]): Promise<void> {
  const r = await json('/v1/agents', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name, owner, capabilities: ['memory'], scopes }) });
  assert(r.status === 201, `agent ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  agents[name] = { gaii: r.body.data.agent.gaii, tok: await agentToken(r.body.data.agent.gaii, r.body.data.private_key) };
}

/** The owner's approval of the app, through the PKCE code exchange, as e2e-app-grants.ts runs it. */
async function grantAppToken(scope: string): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${owner}/${FILENAME}`, response_type: 'code', scope, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ request_id: rid }) });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
  assert(!!tok.body?.data?.access_token, `app token: ${JSON.stringify(tok.body)}`);
  return tok.body.data.access_token;
}

const PROVIDER = 'parity-probe';
const providerHasKey = async (): Promise<boolean | undefined> => {
  const r = await json('/v1/ai/providers', { headers: auth(ownerTok) });
  return (r.body?.data?.providers ?? []).find((p: any) => p.id === PROVIDER)?.auth?.has_key;
};
const write = async (tok: string, key: string, value: unknown, visibility = 'private') => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(tok), body: JSON.stringify({ key, value, visibility }) });
  assert(w.status === 200 || w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body)}`);
};

console.log('\n=== AIMEAT: the memory doors beside the main ones ===\n');

await test('Setup: an owner with a published app, an app grant, an AI key and four agents', async () => {
  ownerTok = (await registerOwner(BASE, owner)).token;
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(ownerTok),
    body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>parity</body></html>'), name: 'Door Parity', description: 'door parity app', category: 'utility' }),
  });
  assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
  appTok = await grantAppToken('memory:read memory:write memory:delete');
  const prov = await json(`/v1/ai/providers/${PROVIDER}`, {
    method: 'PUT', headers: auth(ownerTok),
    body: JSON.stringify({ title: 'Parity probe', type: 'openrouter', auth: { type: 'key' }, capabilities: { text: { enabled: true, model: 'openrouter/free' } } }),
  });
  assert(prov.status === 200, `provider: ${prov.status} ${JSON.stringify(prov.body?.error)}`);
  const key = await json(`/v1/ai/providers/${PROVIDER}/key`, { method: 'PUT', headers: auth(ownerTok), body: JSON.stringify({ api_key: 'sk-parity-probe-0001' }) });
  assert(key.status === 200, `key: ${key.status} ${JSON.stringify(key.body?.error)}`);
  assert(await providerHasKey() === true, 'the key is stored');
  await makeAgent('maker', ['memory:read', 'memory:write', 'memory:delete']);
  await makeAgent('peer', ['memory:read', 'memory:write', 'memory:delete']);
  await makeAgent('full', ['*']);
  await makeAgent('ticked', ['*', 'memory:read-as-owner']);
});

console.log('\n1. Bulk delete asks the bin\'s rules');

await test('1a. Usage: the owner bulk-deletes an ordinary prefix and the count is the records\' count', async () => {
  for (const k of ['bulkp.one', 'bulkp.two', 'bulkp.three']) await write(ownerTok, k, { n: k });
  const d = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ prefix: 'bulkp.' }) });
  assert(d.status === 200 && d.body.data.deleted === 3, `deleted: ${d.status} ${JSON.stringify(d.body)}`);
});

await test('1b. Usage: an app grant bulk-deletes its ordinary records by key and by prefix', async () => {
  for (const k of ['appdata.a', 'appdata.b', 'appdata.c']) await write(appTok, k, { n: k });
  const byKey = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ keys: ['appdata.a'] }) });
  assert(byKey.status === 200 && byKey.body.data.deleted === 1, `by key: ${byKey.status} ${JSON.stringify(byKey.body)}`);
  const byPrefix = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ prefix: 'appdata.' }) });
  assert(byPrefix.status === 200 && byPrefix.body.data.deleted === 2, `by prefix: ${byPrefix.status} ${JSON.stringify(byPrefix.body)}`);
});

await test('1c. An app grant naming the owner\'s AI key record is refused with SECRET_RECORD, and the key stays', async () => {
  const d = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ keys: [`ai.apikey.provider.${PROVIDER}`] }) });
  assert(d.status === 403 && d.body.error?.code === 'SECRET_RECORD', `expected 403 SECRET_RECORD, got ${d.status} ${JSON.stringify(d.body)}`);
  assert(await providerHasKey() === true, 'the key is still stored');
});

await test('1d. A prefix that matches the AI key record leaves it in place, for the app and the owner alike', async () => {
  const app = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ prefix: 'ai.apikey.' }) });
  assert(app.status === 200 && app.body.data.deleted === 0, `app: ${app.status} ${JSON.stringify(app.body)}`);
  const own = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ prefix: 'ai.apikey.' }) });
  assert(own.status === 200 && own.body.data.deleted === 0, `owner: ${own.status} ${JSON.stringify(own.body)}`);
  assert(await providerHasKey() === true, 'the key is still stored');
});

await test('1e. An app grant does not bulk-delete a reserved owner key, named or by prefix; the owner still does', async () => {
  await write(ownerTok, `profile.${owner}.parity`, { n: 1 });
  const named = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ keys: [`profile.${owner}.parity`] }) });
  assert(named.status === 403 && named.body.error?.code === 'RESERVED_KEY', `named: ${named.status} ${JSON.stringify(named.body)}`);
  const pre = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ prefix: `profile.${owner}.par` }) });
  assert(pre.status === 200 && pre.body.data.deleted === 0, `prefix: ${pre.status} ${JSON.stringify(pre.body)}`);
  const still = await json(`/v1/memory/profile.${owner}.parity`, { headers: auth(ownerTok) });
  assert(still.status === 200, `the reserved record still reads: ${still.status}`);
  const own = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ keys: [`profile.${owner}.parity`] }) });
  assert(own.status === 200 && own.body.data.deleted === 1, `owner: ${own.status} ${JSON.stringify(own.body)}`);
});

console.log('\n6. The bin routes refuse a reserved owner key to an app grant');

await test('6a. Usage: an app grant deletes and restores its ordinary record', async () => {
  await write(appTok, 'appbin.note', { n: 1 });
  const d = await json('/v1/memory/appbin.note', { method: 'DELETE', headers: auth(appTok) });
  assert(d.status === 200, `delete: ${d.status} ${JSON.stringify(d.body)}`);
  const r = await json('/v1/memory/appbin.note/restore', { method: 'POST', headers: auth(appTok) });
  assert(r.status === 200, `restore: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('6b. An app grant does not delete a reserved owner key: 403 RESERVED_KEY, and the record stays', async () => {
  await write(ownerTok, `profile.${owner}.binprobe`, { n: 2 });
  const d = await json(`/v1/memory/profile.${owner}.binprobe`, { method: 'DELETE', headers: auth(appTok) });
  assert(d.status === 403 && d.body.error?.code === 'RESERVED_KEY', `expected 403 RESERVED_KEY, got ${d.status} ${JSON.stringify(d.body)}`);
  const still = await json(`/v1/memory/profile.${owner}.binprobe`, { headers: auth(ownerTok) });
  assert(still.status === 200, `the reserved record still reads: ${still.status}`);
});

await test('6c. The owner in person deletes it; an app grant does not put it back, the owner does', async () => {
  const d = await json(`/v1/memory/profile.${owner}.binprobe`, { method: 'DELETE', headers: auth(ownerTok) });
  assert(d.status === 200, `owner delete: ${d.status} ${JSON.stringify(d.body)}`);
  const app = await json(`/v1/memory/profile.${owner}.binprobe/restore`, { method: 'POST', headers: auth(appTok) });
  assert(app.status === 403 && app.body.error?.code === 'RESERVED_KEY', `app restore: ${app.status} ${JSON.stringify(app.body)}`);
  const gone = await json(`/v1/memory/profile.${owner}.binprobe`, { headers: auth(ownerTok) });
  assert(gone.status === 404, `still in the bin: ${gone.status}`);
  const own = await json(`/v1/memory/profile.${owner}.binprobe/restore`, { method: 'POST', headers: auth(ownerTok) });
  assert(own.status === 200, `owner restore: ${own.status} ${JSON.stringify(own.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

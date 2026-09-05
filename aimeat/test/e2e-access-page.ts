/**
 * @file e2e-access-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Access page reads and does. GET /v1/access/overview says who holds a key to
 *   the account and how far it reaches — the apps' grants with their rights, the tokens, the accounts
 *   connected elsewhere, the sign-in state and the open sessions grouped — for the owner and for an
 *   agent the owner ticked account:security for, and for nobody else. PATCH /v1/app-grants/:id keeps
 *   a subset of an app's rights and never widens them; the app's next refresh mints from the narrowed
 *   grant. DELETE /v1/auth/sessions/others ends every other device's session and keeps this one. One
 *   owner's keys never show in another owner's answer.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=access-page
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", direction A).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const stamp = Date.now() % 1000000;
const A = { name: `acowner${stamp}`, token: '', token2: '' };
const B = { name: `acguest${stamp}`, token: '' };
const password = 'AccessPage123!';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const FILENAME = 'access-demo.html';
const REDIRECT = 'http://localhost:9911/callback';

let grantId = '';
let appAccess = '';
let appRefresh = '';
let patId = '';
let agentWithWord = '';
let agentWithout = '';

// PKCE
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

async function register(who: { name: string }) {
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
  }
  assert(reg.body.ok === true, `registration ${who.name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
}

async function login(name: string): Promise<string> {
  const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password }) });
  assert(typeof r.body.data?.token === 'string', `login ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
  return r.body.data.token;
}

/** The full authorize → consent → token flow for the demo app; returns the token payload. */
async function grantAppToken(scope: string): Promise<any> {
  const q = new URLSearchParams({
    app: `${A.name}/${FILENAME}`, response_type: 'code', scope,
    redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
  });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ request_id: rid }) });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', {
    method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
  });
  assert(tok.status === 200, `app token: ${tok.status} ${JSON.stringify(tok.body.error)}`);
  return tok.body.data;
}

/** An agent under A with the given scopes, and ITS session JWT. */
async function agentToken(name: string, scopes: string[]): Promise<string> {
  const created = await json('/v1/agents', {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ name, owner: A.name, display_name: name, capabilities: [], scopes }),
  });
  assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  const gaii = created.body.data.agent.gaii as string;
  const key = created.body.data.private_key as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(key, gaii + ts) }) });
  assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
  return tok.body.data.token as string;
}

console.log(`\n=== Access page E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Two owners register; the first signs in twice (two devices)', async () => {
  await register(A);
  await register(B);
  A.token = await login(A.name);
  A.token2 = await login(A.name);
  B.token = await login(B.name);
  assert(A.token !== A.token2 && !!B.token, 'two distinct sessions for the owner, one for the guest');
});

await test('The owner publishes an app and grants it two rights; mints one token; has two agents', async () => {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>access</body></html>'), name: 'Access Demo', description: 'access demo app', category: 'utility' }),
  });
  assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
  const d = await grantAppToken('memory:read storage:read');
  grantId = d.grant_id; appAccess = d.access_token; appRefresh = d.refresh_token;
  assert(!!grantId && !!appAccess && !!appRefresh, 'grant, access and refresh present');

  const pat = await json('/v1/access/tokens', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ label: 'probe token', scopes: ['memory:read'], expires_in: 2592000 }) });
  assert(pat.status === 201, `token: ${pat.status} ${JSON.stringify(pat.body.error)}`);
  patId = pat.body.data.id;
  assert(typeof pat.body.data.expires_at === 'string', 'the token carries its expiry');

  agentWithWord = await agentToken('keyreader', ['memory:read', 'account:security']);
  agentWithout = await agentToken('plainbot', ['memory:read']);
});

await test('GET /v1/access/overview: every key in one answer, the sign-in state, the sessions grouped', async () => {
  const { status, body } = await json('/v1/access/overview', { headers: auth(A.token) });
  assert(status === 200, `overview ${status}: ${JSON.stringify(body.error)}`);
  const d = body.data;
  const g = d.appGrants.grants.find((x: any) => x.grant_id === grantId);
  assert(!!g, 'the app grant is listed');
  assert(g.scopes.includes('memory:read') && g.scopes.includes('storage:read'), `its rights: ${JSON.stringify(g.scopes)}`);
  assert(g.can_spend === false && g.scopes_fixed_at === null, `spend and fixed flags: ${JSON.stringify(g)}`);
  assert(d.accessTokens.tokens.some((t: any) => t.id === patId && typeof t.expires_at === 'string'), 'the token is listed with its expiry');
  assert(Array.isArray(d.base_package) && d.base_package.length === 8 && d.base_package.includes('app:write'), `base package: ${JSON.stringify(d.base_package)}`);
  assert(typeof d.access_ttl_seconds === 'number' && d.access_ttl_seconds > 0, 'access_ttl_seconds');
  const s = d.sign_in;
  assert(s.has_password === true, 'has_password');
  assert(s.managed_by === null, 'not organisation-managed');
  assert(typeof s.two_factor.enabled === 'boolean' && s.two_factor.enabled === false, 'two-step off');
  assert(typeof s.passkeys.available === 'boolean' && s.passkeys.count === 0 && Array.isArray(s.passkeys.passkeys), 'passkeys shape');
  assert(s.sessions.mine.total >= 2, `two devices signed in: ${s.sessions.mine.total}`);
  assert(typeof s.sessions.current_id === 'string' && s.sessions.mine.current !== null, 'the caller\'s session is marked current');
  assert(Array.isArray(s.sessions.mine.by_device) && s.sessions.mine.by_device.reduce((n: number, x: any) => n + x.count, 0) === s.sessions.mine.total, 'devices add up');
  assert(s.sessions.agents.total >= 2 && s.sessions.agents.distinct >= 2, `the two agents' sessions: ${JSON.stringify(s.sessions.agents)}`);
  assert(s.sessions.agents.by_agent.some((a: any) => a.name === 'keyreader'), 'an agent is named');
  assert(typeof s.sessions.expired_kept === 'number', 'expired_kept');
  assert(d.connections && typeof d.connections.enabled === 'boolean' && Array.isArray(d.connections.connections) && Array.isArray(d.connections.providers), `connections: ${JSON.stringify(d.connections).slice(0, 120)}`);
  assert(!JSON.stringify(d).includes('aimeat_pat_'), 'no raw token in the answer');
});

await test('The door refuses without a credential, and one owner never sees another\'s keys', async () => {
  const anon = await json('/v1/access/overview');
  assert(anon.status === 401, `no credential: ${anon.status}`);
  const { status, body } = await json('/v1/access/overview', { headers: auth(B.token) });
  assert(status === 200, `guest overview ${status}`);
  assert(!body.data.appGrants.grants.some((x: any) => x.grant_id === grantId), "the owner's grant is not in the guest's answer");
  assert(!body.data.accessTokens.tokens.some((x: any) => x.id === patId), "the owner's token is not in the guest's answer");
  assert(body.data.sign_in.sessions.mine.total >= 1, 'the guest sees their own session');
});

await test('An agent the owner ticked account:security for reads it; an agent without the word is refused', async () => {
  const yes = await json('/v1/access/overview', { headers: auth(agentWithWord) });
  assert(yes.status === 200, `account:security agent: ${yes.status} ${JSON.stringify(yes.body.error)}`);
  assert(yes.body.data.appGrants.grants.some((x: any) => x.grant_id === grantId), 'it sees the same grant');
  assert(yes.body.data.sign_in.sessions.current_id === null, 'a tool call is not one of the person\'s browser sessions');
  const no = await json('/v1/access/overview', { headers: auth(agentWithout) });
  assert(no.status === 403, `agent without the word: ${no.status}`);
});

await test('PATCH /v1/app-grants/:id keeps a subset, stamps the grant, and never widens', async () => {
  const r = await json(`/v1/app-grants/${grantId}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read'] }) });
  assert(r.status === 200, `narrow: ${r.status} ${JSON.stringify(r.body.error)}`);
  assert(JSON.stringify(r.body.data.scopes) === JSON.stringify(['memory:read']), `kept: ${JSON.stringify(r.body.data.scopes)}`);
  assert(JSON.stringify(r.body.data.removed) === JSON.stringify(['storage:read']), `removed: ${JSON.stringify(r.body.data.removed)}`);
  assert(typeof r.body.data.scopes_fixed_at === 'string', 'stamped');
  assert(typeof r.body.data.applies_within_seconds === 'number', 'says how long the old token lives');

  const ov = await json('/v1/access/overview', { headers: auth(A.token) });
  const g = ov.body.data.appGrants.grants.find((x: any) => x.grant_id === grantId);
  assert(JSON.stringify(g.scopes) === JSON.stringify(['memory:read']) && typeof g.scopes_fixed_at === 'string', `the overview shows the narrowed grant: ${JSON.stringify(g)}`);

  const widen = await json(`/v1/app-grants/${grantId}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read', 'memory:write'] }) });
  assert(widen.status === 400 && widen.body.error?.code === 'SCOPES_WIDEN', `widening refused: ${widen.status} ${widen.body.error?.code}`);
  const empty = await json(`/v1/app-grants/${grantId}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: [] }) });
  assert(empty.status === 400, `an empty list is refused: ${empty.status}`);
  const other = await json(`/v1/app-grants/${grantId}`, { method: 'PATCH', headers: auth(B.token), body: JSON.stringify({ scopes: ['memory:read'] }) });
  assert(other.status === 404, `another owner: ${other.status}`);
  const anon = await json(`/v1/app-grants/${grantId}`, { method: 'PATCH', body: JSON.stringify({ scopes: ['memory:read'] }) });
  assert(anon.status === 401, `no credential: ${anon.status}`);
});

await test('The app\'s next refresh mints from the narrowed grant, and the right it lost is refused', async () => {
  const r = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: appRefresh }) });
  assert(r.status === 200, `refresh: ${r.status} ${JSON.stringify(r.body.error)}`);
  assert(r.body.data.scope === 'memory:read', `refreshed scope: ${r.body.data.scope}`);
  appRefresh = r.body.data.refresh_token;
  const narrowed = r.body.data.access_token;
  const read = await json('/v1/memory?limit=1', { headers: auth(narrowed) });
  assert(read.status === 200, `the kept right still works: ${read.status}`);
  const files = await json('/v1/memory/files/x.txt', { headers: auth(narrowed) });
  assert(files.status === 403, `the removed right is refused: ${files.status}`);
});

await test('DELETE /v1/auth/sessions/others ends the other device and keeps this one', async () => {
  const before = await json('/v1/auth/sessions', { headers: auth(A.token2) });
  assert(before.status === 200, `the second device is signed in: ${before.status}`);
  assert(before.body.data.sessions.every((s: any) => new Date(s.expires_at).getTime() > Date.now()), 'the device list shows only open sessions');
  const r = await json('/v1/auth/sessions/others', { method: 'DELETE', headers: auth(A.token) });
  assert(r.status === 200, `others: ${r.status} ${JSON.stringify(r.body.error)}`);
  assert(r.body.data.revoked_sessions >= 1, `at least the second device: ${r.body.data.revoked_sessions}`);
  assert(typeof r.body.data.kept_session_id === 'string', 'says which one it kept');
  const gone = await json('/v1/auth/sessions', { headers: auth(A.token2) });
  assert(gone.status === 401, `the second device is signed out: ${gone.status}`);
  const still = await json('/v1/access/overview', { headers: auth(A.token) });
  assert(still.status === 200 && still.body.data.sign_in.sessions.mine.total === 1, `this device stays, alone: ${still.status} ${still.body.data?.sign_in?.sessions?.mine?.total}`);
  const agentStill = await json('/v1/access/overview', { headers: auth(agentWithWord) });
  assert(agentStill.status === 200, `the agents are not signed out by it: ${agentStill.status}`);
});

await test('Clean up: the grant and the token are revoked', async () => {
  const g = await json(`/v1/app-grants/${grantId}`, { method: 'DELETE', headers: auth(A.token) });
  assert(g.status === 200, `revoke grant ${g.status}`);
  const t = await json(`/v1/access/tokens/${patId}`, { method: 'DELETE', headers: auth(A.token) });
  assert(t.status === 200, `revoke token ${t.status}`);
  const ov = await json('/v1/access/overview', { headers: auth(A.token) });
  assert(!ov.body.data.appGrants.grants.some((x: any) => x.grant_id === grantId), 'the grant is gone from the answer');
});

console.log(`\n=== Access page: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);

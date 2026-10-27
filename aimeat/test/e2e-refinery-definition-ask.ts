/**
 * @file e2e-refinery-definition-ask.ts
 * @description Where a mail refinery reads and files mail waits for the owner's one-press answer when
 *   an app or an agent that may not run the refinery changes it (secaudit2026oct26,
 *   refinery/pipeline:loadDefinition:definition-writer-not-bound). The owner's schedule runs the
 *   definition `<prefix>.config` as the owner, so an app grant holding only memory:write, or an agent
 *   holding memory:write-as-owner without the four run permissions, pointed the owner's next batch at
 *   another mailbox and into a workspace of its choosing. Now such a write keeps the mailbox, the
 *   workspace, the spaces and keepText it had, stores the rest, and answers 202 with a request of kind
 *   refinery-definition; the owner's approval writes the asked fields. The owner in person, an agent
 *   holding the run permissions, and every change to the other fields write at once, as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=refinery-definition-ask
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26).
 */
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 1_000_000;
const FILENAME = 'refinery-probe.html';
const REDIRECT = 'http://localhost:9911/callback';
const KEY = 'mailref.config';

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

let owner!: Awaited<ReturnType<typeof registerOwner>>;
let narrow!: Awaited<ReturnType<typeof makeAgent>>;
let runner!: Awaited<ReturnType<typeof makeAgent>>;
let appTok = '';
let firstRequest = '';

const definition = (over: Record<string, unknown> = {}) => ({
  v: 2, connectionId: 'conn-a', provider: 'fake-mail', since: '2026-10-01', query: '',
  organismId: 'org-a', workspaceId: 'ws-a', spaces: { items: 'viesti', events: 'tapahtuma' },
  classes: ['receipt', 'invoice'], thresholds: { clear: 0.8, unclear: 0.5 }, keepText: false, ...over,
});
const stored = async () => (await json(`/v1/memory/${KEY}`, { headers: auth(owner.token) })).body.data?.value ?? {};

async function grantAppToken(scope: string): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${owner.name}/${FILENAME}`, response_type: 'code', scope, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: rid }) });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
  assert(!!tok.body?.data?.access_token, `app token: ${JSON.stringify(tok.body)}`);
  return tok.body.data.access_token;
}

console.log('\n=== AIMEAT: a mail refinery\'s destination asks the owner ===\n');

await test('Setup: the owner\'s definition, an app holding memory:write only, and two agents', async () => {
  owner = await registerOwner(BASE, `rda${stamp}`);
  const w = await json('/v1/memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ key: KEY, value: definition(), visibility: 'private' }) });
  assert(w.status === 201, `definition: ${w.status} ${JSON.stringify(w.body)}`);
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>probe</body></html>'), name: 'Refinery Probe', description: 'probe app', category: 'utility' }) });
  assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
  appTok = await grantAppToken('memory:read memory:write');
  narrow = await makeAgent(BASE, owner, ['memory:read', 'memory:write', 'memory:write-as-owner'], `rdanarrow${stamp}`);
  runner = await makeAgent(BASE, owner, ['*'], `rdarunner${stamp}`);
});

await test('An agent without the run permissions: its change of the workspace and keepText waits for the owner, the rest is saved', async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(narrow.token), body: JSON.stringify({ key: KEY, owner_scope: true, value: definition({ organismId: 'org-b', workspaceId: 'ws-b', keepText: true, thresholds: { clear: 0.9, unclear: 0.5 } }) }) });
  assert(w.status === 202 && w.body.data.publish_request?.kind === 'refinery-definition', `write: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
  assert(w.body.data.publish_request.status === 'awaiting_owner', `pending: ${JSON.stringify(w.body.data.publish_request)}`);
  firstRequest = w.body.data.publish_request.request_id;
  const v = await stored();
  assert(v.organismId === 'org-a' && v.workspaceId === 'ws-a' && v.keepText === false, `the destination is kept: ${JSON.stringify(v)}`);
  assert(v.thresholds?.clear === 0.9, `the rest is saved: ${JSON.stringify(v.thresholds)}`);
  const seen = await json(`/v1/publish-requests/${firstRequest}`, { headers: auth(narrow.token) });
  assert(seen.status === 200 && (seen.body.data.request?.state ?? seen.body.data.state) === 'awaiting_owner', `the agent sees it pending: ${seen.status} ${JSON.stringify(seen.body.data ?? seen.body.error)}`);
});

await test('An app holding memory:write only: a new mailbox through POST and a new workspace through PATCH both wait for the owner', async () => {
  const p = await json('/v1/memory', { method: 'POST', headers: auth(appTok), body: JSON.stringify({ key: KEY, value: definition({ connectionId: 'conn-b', thresholds: { clear: 0.9, unclear: 0.5 } }) }) });
  assert(p.status === 202 && p.body.data.publish_request?.kind === 'refinery-definition', `post: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
  const m = await json(`/v1/memory/${KEY}`, { method: 'PATCH', headers: auth(appTok), body: JSON.stringify({ patch: { workspaceId: 'ws-c' } }) });
  assert(m.status === 202 && m.body.data.publish_request?.kind === 'refinery-definition', `patch: ${m.status} ${JSON.stringify(m.body.error ?? m.body.data)}`);
  const v = await stored();
  assert(v.connectionId === 'conn-a' && v.workspaceId === 'ws-a', `the destination is kept: ${JSON.stringify(v)}`);
});

await test('Usage: the app changes the other fields at once', async () => {
  const m = await json(`/v1/memory/${KEY}`, { method: 'PATCH', headers: auth(appTok), body: JSON.stringify({ patch: { thresholds: { clear: 0.7 }, query: 'invoice' } }) });
  assert(m.status === 200 && !m.body.data.publish_request, `patch: ${m.status} ${JSON.stringify(m.body.error ?? m.body.data?.publish_request)}`);
  const v = await stored();
  assert(v.thresholds?.clear === 0.7 && v.query === 'invoice', `saved: ${JSON.stringify(v)}`);
});

await test('Usage: the owner in person and an agent holding the run permissions change the destination at once', async () => {
  const o = await json(`/v1/memory/${KEY}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ patch: { organismId: 'org-o' } }) });
  assert(o.status === 200 && !o.body.data.publish_request, `owner: ${o.status} ${JSON.stringify(o.body.error ?? o.body.data?.publish_request)}`);
  const r = await json(`/v1/memory/${KEY}`, { method: 'PATCH', headers: auth(runner.token), body: JSON.stringify({ owner_scope: true, patch: { workspaceId: 'ws-r' } }) });
  assert(r.status === 200 && !r.body.data.publish_request, `runner: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data?.publish_request)}`);
  const v = await stored();
  assert(v.organismId === 'org-o' && v.workspaceId === 'ws-r', `saved: ${JSON.stringify(v)}`);
});

await test('Usage: the owner allows the first request with one press, and the asked destination is written', async () => {
  const d = await json(`/v1/publish-requests/${firstRequest}/decision`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ decision: 'approve' }) });
  assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
  const v = await stored();
  assert(v.organismId === 'org-b' && v.workspaceId === 'ws-b' && v.keepText === true, `the asked destination: ${JSON.stringify(v)}`);
  assert(v.thresholds?.clear === 0.7, `the other fields stay: ${JSON.stringify(v.thresholds)}`);
});

await test('Another account neither reads nor decides the owner\'s request', async () => {
  const other = await registerOwner(BASE, `rdb${stamp}`);
  const r = await json(`/v1/publish-requests/${firstRequest}`, { headers: auth(other.token) });
  assert(r.status === 404 || r.status === 403, `read: ${r.status}`);
  const d = await json(`/v1/publish-requests/${firstRequest}/decision`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ decision: 'decline' }) });
  assert(d.status === 404 || d.status === 403, `decide: ${d.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

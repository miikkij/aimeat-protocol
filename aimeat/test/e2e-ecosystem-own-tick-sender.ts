/**
 * @file test/e2e-ecosystem-own-tick-sender.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two things an outside app (GEAI) gets from its owner, secaudit2026nov08 round 14:
 *   - Older item O5: a word outside every wildcard (receivers:manage, memory:read-as-owner, ...) is
 *     granted only when the owner names it. The pending list names those words (`own_tick_scopes`);
 *     an approval without `scopes` grants the request without them and names them in
 *     `held_back_scopes`; an approval that names them grants them; an app already holding such a word
 *     keeps it on a re-approval without `scopes`; an ordinary request is granted as before.
 *   - notification-create:ecosystem-sender-labelled-as-owner: the app's notification names the app
 *     (source kind `ecosystem`, its name before the title), the senders list carries the app, and the
 *     owner's mute of the app holds.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ecosystem-own-tick-sender
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { registerOwner } from './helpers/owner-login.js';
import { generateKeyPair } from '../src/auth/keypair.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}, token?: string): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= 5; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
    });
    const body = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : { _raw: await res.text() };
    if (res.status === 429 && attempt < 5) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

const stamp = Date.now().toString(36);
const owner = `ecotick${stamp}`;
let ownerToken = '';
const KEY = (await generateKeyPair()).publicKey;

async function hello(app: string, scopes: string[], displayName = app): Promise<{ deviceCode: string; userCode: string }> {
  const r = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner, app, display_name: displayName, public_key: KEY, scopes }) });
  assert(r.status === 200, `hello ${app}: ${r.status} ${JSON.stringify(r.body)}`);
  return { deviceCode: r.body.data.device_code, userCode: r.body.data.user_code };
}
async function approve(userCode: string, scopes?: string[]): Promise<any> {
  const r = await json(`/v1/ecosystem-apps/${userCode}/approve`, { method: 'POST', body: JSON.stringify({ action: 'approve', ...(scopes ? { scopes } : {}) }) }, ownerToken);
  assert(r.status === 200, `approve: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}
async function pickUp(deviceCode: string): Promise<{ token: string; scopes: string[]; geai: string }> {
  const r = await json('/v1/ecosystem-apps/token', { method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }) });
  assert(r.status === 200, `token: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.access_token, scopes: r.body.scopes, geai: r.body.geai };
}
async function storedScopes(app: string): Promise<string[]> {
  const r = await json('/v1/ecosystem-apps', {}, ownerToken);
  const row = (r.body.data.ecosystem_apps as any[]).find(a => a.app === app);
  assert(row, `app ${app} not listed`);
  return row.scopes;
}

console.log('\n=== Outside apps: own-tick words and the app as a sender ===\n');

await test('setup: an owner', async () => {
  ownerToken = (await registerOwner(BASE, owner)).token;
  assert(ownerToken, 'owner token');
});

console.log('\nO5 — words outside every wildcard need the owner\'s own tick');
const ASK = ['memory:read', 'receivers:manage', 'memory:read-as-owner'];

await test('the pending list names the own-tick words of a request', async () => {
  const { userCode } = await hello(`tickpend${stamp}`, ASK);
  const r = await json('/v1/ecosystem-apps/pending', {}, ownerToken);
  const row = (r.body.data.requests as any[]).find(x => x.user_code === userCode);
  assert(row, 'request listed');
  assert(JSON.stringify([...(row.own_tick_scopes ?? [])].sort()) === JSON.stringify(['memory:read-as-owner', 'receivers:manage']),
    `own_tick_scopes: ${JSON.stringify(row.own_tick_scopes)}`);
  assert(JSON.stringify(row.requested_scopes) === JSON.stringify(ASK), `requested_scopes unchanged: ${JSON.stringify(row.requested_scopes)}`);
});

await test('an approval without scopes does not grant the words the owner did not tick', async () => {
  const app = `tickbare${stamp}`;
  const { deviceCode, userCode } = await hello(app, ASK);
  const answer = await approve(userCode);
  const t = await pickUp(deviceCode);
  assert(!t.scopes.includes('receivers:manage') && !t.scopes.includes('memory:read-as-owner'), `token carries an unticked word: ${JSON.stringify(t.scopes)}`);
  assert(t.scopes.includes('memory:read'), `the ordinary word is granted: ${JSON.stringify(t.scopes)}`);
  const stored = await storedScopes(app);
  assert(!stored.includes('receivers:manage'), `stored scopes: ${JSON.stringify(stored)}`);
  assert(JSON.stringify([...(answer.held_back_scopes ?? [])].sort()) === JSON.stringify(['memory:read-as-owner', 'receivers:manage']),
    `held_back_scopes: ${JSON.stringify(answer.held_back_scopes)}`);
  const refused = await json('/v1/receivers', {}, t.token);
  assert(refused.status === 403 || refused.status === 404, `receivers list without the word: ${refused.status}`);
});

const KEPT = `tickkept${stamp}`;
await test('usage: an approval that names the word grants it', async () => {
  const { deviceCode, userCode } = await hello(KEPT, ASK);
  await approve(userCode, ['memory:read', 'receivers:manage']);
  const t = await pickUp(deviceCode);
  assert(JSON.stringify(t.scopes) === JSON.stringify(['memory:read', 'receivers:manage']), `token scopes: ${JSON.stringify(t.scopes)}`);
});

await test('usage: an app already holding the word keeps it on a re-approval without scopes', async () => {
  const { deviceCode, userCode } = await hello(KEPT, ASK);
  const answer = await approve(userCode);
  assert(answer.existing_app === true, 're-approval of the connected app');
  const t = await pickUp(deviceCode);
  assert(t.scopes.includes('receivers:manage'), `held word kept: ${JSON.stringify(t.scopes)}`);
  assert(!t.scopes.includes('memory:read-as-owner'), `a word never granted stays out: ${JSON.stringify(t.scopes)}`);
  assert((await storedScopes(KEPT)).includes('receivers:manage'), 'stored scopes keep the word');
});

await test('usage: an ordinary request is granted as asked when the body names no scopes', async () => {
  const app = `tickplain${stamp}`;
  const { deviceCode, userCode } = await hello(app, ['memory:read', 'memory:write']);
  const answer = await approve(userCode);
  const t = await pickUp(deviceCode);
  assert(JSON.stringify(t.scopes) === JSON.stringify(['memory:read', 'memory:write']), `token scopes: ${JSON.stringify(t.scopes)}`);
  assert((answer.held_back_scopes ?? []).length === 0, `nothing held back: ${JSON.stringify(answer.held_back_scopes)}`);
});

console.log('\nThe outside app is its own sender');
let appToken = '';
let appGeai = '';

await test('setup: an outside app approved with notifications:send', async () => {
  const { deviceCode, userCode } = await hello(`ticknote${stamp}`, ['notifications:send'], 'Help Desk');
  await approve(userCode, ['notifications:send']);
  const t = await pickUp(deviceCode);
  appToken = t.token; appGeai = t.geai;
  assert(appToken && appGeai.startsWith('eco:'), `geai ${appGeai}`);
});

await test('its notification names the app, not the owner', async () => {
  const r = await json('/v1/notifications', { method: 'POST', body: JSON.stringify({ title: 'Ticket closed' }) }, appToken);
  assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
  const list = await json('/v1/notifications?limit=20', {}, ownerToken);
  const row = (list.body.data.notifications ?? list.body.data.items ?? []).find((n: any) => String(n.title).endsWith('Ticket closed'));
  assert(row, `notification listed: ${JSON.stringify(list.body.data).slice(0, 300)}`);
  assert(row.source?.kind === 'ecosystem' && row.source?.id === appGeai, `source: ${JSON.stringify(row.source)}`);
  assert(row.title === 'Help Desk: Ticket closed', `title: ${row.title}`);
});

await test('the senders list carries the app, and the owner\'s mute of it holds', async () => {
  const s = await json('/v1/notifications/senders', {}, ownerToken);
  assert(s.status === 200, `senders: ${s.status}`);
  const row = (s.body.data.senders as any[]).find(x => x.kind === 'ecosystem' && x.id === appGeai);
  assert(row, `the app is a sender: ${JSON.stringify(s.body.data.senders)}`);
  const settings = s.body.data.settings;
  const put = await json('/v1/notifications/settings', { method: 'PUT', body: JSON.stringify({ ...settings, senders: { ...settings.senders, [row.key]: { muted: true } } }) }, ownerToken);
  assert(put.status === 200, `settings: ${put.status} ${JSON.stringify(put.body)}`);
  const r = await json('/v1/notifications', { method: 'POST', body: JSON.stringify({ title: 'Second ticket' }) }, appToken);
  assert(r.status === 201 && r.body.data.muted === true, `muted: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('usage: the owner\'s own notice is still the owner\'s', async () => {
  const r = await json('/v1/notifications', { method: 'POST', body: JSON.stringify({ title: 'Note to self' }) }, ownerToken);
  assert(r.status === 201 && r.body.data.created === true, `create: ${r.status} ${JSON.stringify(r.body)}`);
  const list = await json('/v1/notifications?limit=20', {}, ownerToken);
  const row = (list.body.data.notifications ?? list.body.data.items ?? []).find((n: any) => n.title === 'Note to self');
  assert(row?.source?.kind === 'owner', `source: ${JSON.stringify(row?.source)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

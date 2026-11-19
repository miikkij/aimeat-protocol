/**
 * @file test/e2e-ecosystem-apps-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside applications (ecosystem apps) connected to an account, from the chat:
 *   aimeat_ecosystem_app_list and aimeat_ecosystem_app_revoke, and the REST routes they share
 *   (GET /v1/ecosystem-apps, DELETE /v1/ecosystem-apps/:app). Holds:
 *     1. the owner's agent holding account:security lists the app over MCP and over REST;
 *     2. an agent without account:security is not offered the tools, and the REST list refuses it;
 *     3. another owner's agent sees none of this owner's apps and cannot remove one (NOT_FOUND);
 *     4. the revoke removes the app from the list and its token stops working at once;
 *     5. the owner in person lists and removes over REST as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-apps-mcp
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 2).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames } from './helpers/mcp-session.js';
import { generateKeyPair } from '../src/auth/keypair.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Connect the outside app `app` to `owner` (hello → approve → token) and return its token. */
async function connectApp(owner: { name: string; token: string }, app: string): Promise<string> {
  const keys = await generateKeyPair();
  const hello = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({ owner: owner.name, app, display_name: `Desk ${app}`, public_key: keys.publicKey, scopes: ['memory:read'] }),
  });
  assert(hello.status === 200 && hello.body.ok, `hello ${hello.status} ${JSON.stringify(hello.body?.error)}`);
  const ok = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
    method: 'POST', headers: auth(owner.token), body: JSON.stringify({ action: 'approve', scopes: ['memory:read'] }),
  });
  assert(ok.status === 200 && ok.body.data.status === 'approved', `approve ${ok.status} ${JSON.stringify(ok.body)}`);
  const tok = await json('/v1/ecosystem-apps/token', { method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: GRANT }) });
  assert(tok.status === 200 && typeof tok.body.access_token === 'string', `token ${tok.status} ${JSON.stringify(tok.body)}`);
  return tok.body.access_token as string;
}

console.log('\n=== Outside apps from the chat ===\n');

const stamp = Date.now() % 1000000;
const alice = await registerOwner(BASE, `ecomcpa${stamp}`);
const bob = await registerOwner(BASE, `ecomcpb${stamp}`);
const APP = 'helpdesk';
let appToken = '';

await test('Setup: an outside app connected to the account, and its token reads', async () => {
  appToken = await connectApp(alice, APP);
  const r = await json('/v1/memory', { headers: auth(appToken) });
  assert(r.status === 200, `the app reads with its token: ${r.status}`);
});

await test('1. The owner\'s agent with account:security lists the app over MCP and over REST', async () => {
  const agent = await makeAgent(BASE, alice, ['account:security']);
  const s = await openSession(BASE, agent.token, 'e2e-eco-list');
  const r = await callTool(s, 'aimeat_ecosystem_app_list', {});
  assert(!r.isError, `list: ${r.text.slice(0, 300)}`);
  const found = (r.data.ecosystem_apps ?? []).find((a: any) => a.app === APP);
  assert(!!found && found.display_name === `Desk ${APP}` && found.scopes.includes('memory:read'), `the app with its rights: ${JSON.stringify(r.data).slice(0, 300)}`);
  assert(r.data.total === 1, `one app, got ${r.data.total}`);
  const rest = await json('/v1/ecosystem-apps', { headers: auth(agent.token) });
  assert(rest.status === 200 && rest.body.data.ecosystem_apps.some((a: any) => a.app === APP), `REST list by the agent: ${rest.status}`);
});

await test('2. An agent without account:security is not offered the tools, and the REST list refuses it', async () => {
  const agent = await makeAgent(BASE, alice, ['memory:read', 'agent:read']);
  const s = await openSession(BASE, agent.token, 'e2e-eco-noscope');
  const names = await toolNames(s);
  assert(!names.includes('aimeat_ecosystem_app_list') && !names.includes('aimeat_ecosystem_app_revoke'), 'neither tool on the list');
  const r = await callTool(s, 'aimeat_ecosystem_app_revoke', { app: APP });
  assert(r.isError, `revoke without the word is refused: ${r.text.slice(0, 200)}`);
  const rest = await json('/v1/ecosystem-apps', { headers: auth(agent.token) });
  assert(rest.status === 403, `REST list without the word: ${rest.status}`);
  const del = await json(`/v1/ecosystem-apps/${APP}`, { method: 'DELETE', headers: auth(agent.token) });
  assert(del.status === 403, `REST delete without the word: ${del.status}`);
});

await test('3. Another owner\'s agent sees none of these apps and cannot remove one', async () => {
  const agent = await makeAgent(BASE, bob, ['account:security']);
  const s = await openSession(BASE, agent.token, 'e2e-eco-other');
  const r = await callTool(s, 'aimeat_ecosystem_app_list', {});
  assert(!r.isError && (r.data.ecosystem_apps ?? []).length === 0, `bob sees nothing: ${r.text.slice(0, 200)}`);
  const x = await callTool(s, 'aimeat_ecosystem_app_revoke', { app: APP });
  assert(x.isError && /^NOT_FOUND: /.test(x.text), `cross-owner revoke: ${x.text.slice(0, 200)}`);
  assert((await json('/v1/memory', { headers: auth(appToken) })).status === 200, 'alice\'s app still reads');
});

await test('4. The revoke removes the app, and its token stops working at once', async () => {
  const agent = await makeAgent(BASE, alice, ['account:security']);
  const s = await openSession(BASE, agent.token, 'e2e-eco-revoke');
  const r = await callTool(s, 'aimeat_ecosystem_app_revoke', { app: APP });
  assert(!r.isError && r.data.deleted === true && r.data.app === APP, `revoke: ${r.text.slice(0, 300)}`);
  assert(r.data.receivers_kept !== undefined, 'the answer names the webhooks that stay');
  const list = await callTool(s, 'aimeat_ecosystem_app_list', {});
  assert(!list.isError && (list.data.ecosystem_apps ?? []).length === 0, 'gone from the list');
  const read = await json('/v1/memory', { headers: auth(appToken) });
  assert(read.status === 401, `the app's token after the revoke: ${read.status}`);
  const again = await callTool(s, 'aimeat_ecosystem_app_revoke', { app: APP });
  assert(again.isError && /^NOT_FOUND: /.test(again.text), `a second revoke: ${again.text.slice(0, 200)}`);
});

await test('5. The owner in person still lists and removes over REST', async () => {
  await connectApp(alice, 'crmdesk');
  const list = await json('/v1/ecosystem-apps', { headers: auth(alice.token) });
  assert(list.status === 200 && list.body.data.ecosystem_apps.some((a: any) => a.app === 'crmdesk'), `owner list ${list.status}`);
  const del = await json('/v1/ecosystem-apps/crmdesk', { method: 'DELETE', headers: auth(alice.token) });
  assert(del.status === 200 && del.body.data.deleted === true, `owner delete ${del.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

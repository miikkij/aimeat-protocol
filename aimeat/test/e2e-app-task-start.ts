/**
 * @file test/e2e-app-task-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app the owner granted task:write may start a task that would otherwise wait for the
 *   owner in person (services/task/start-op.ts). The owner sees each such start, and may make an
 *   agent's tasks wait for them also when an app starts them. This suite holds the three things the
 *   2026-11-19 change promises:
 *     1. an app's start of a task the floor held writes an entry with event `task.started_by_app` in the
 *        owner's trail and sends the owner a `task_started_by_app` notification naming the app, the task
 *        and why it waited; a start that waited for nobody in person writes neither;
 *     2. with the agent's `task_start_app_waits` on, the app's start is refused like any other caller's
 *        and the task stays queued, while the owner in person still starts it;
 *     3. the app cannot switch the setting off, the agent cannot set its own, and another owner's
 *        notifications never carry the notice.
 *   The app's start without the setting stays as e2e-app-grants-tasks.ts holds it. Section 3 holds the
 *   same setting on MCP (aimeat_agent_task_start_set sets it and aimeat_agents_list reads it), the
 *   agent's refusal for its own over MCP, and the app's refusal to turn it off.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-task-start
 * @version-history
 *   v1.1.1 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); every test as it was.
 *   v1.1.0 — 2026-11-19 — Section 3: the setting over MCP, the agent's own over MCP, the app's off.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 2.1).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, finish, json, test } from './helpers/harness.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const FILENAME = 'task-starter.html';
const APP_NAME = 'Task Starter';
const REDIRECT = 'http://localhost:9922/callback';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(priv, 'base64'))).toString('base64');
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

interface Owner { name: string; token: string }
interface Agent { name: string; gaii: string; token: string }

async function newOwner(prefix: string): Promise<Owner> {
  const name = `${prefix}${Date.now() % 1000000}`;
  return { name, token: (await registerOwner(BASE, name)).token };
}
async function newAgent(owner: Owner, name: string, scopes: string[]): Promise<Agent> {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name, owner: owner.name, capabilities: ['tasks'], scopes }),
  });
  assert(status === 201, `agent ${name} ${status}: ${JSON.stringify(body)}`);
  const gaii = body.data.agent.gaii as string;
  return { name, gaii, token: await agentToken(gaii, body.data.private_key) };
}

const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

/** Publish the app for `owner` and run the app-grant flow for `scopes`; returns the app's token. */
async function grantApp(owner: Owner, scopes: string[]): Promise<string> {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>starter</body></html>'), name: APP_NAME, description: 'starts tasks', category: 'utility' }),
  });
  assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
  const q = new URLSearchParams({
    app: `${owner.name}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
  });
  const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  assert(authz.status === 302, `authorize: ${authz.status}`);
  const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: rid }) });
  assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', {
    method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
  });
  assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
  return tok.body.data.access_token;
}

async function createTask(token: string, agent: string, title: string) {
  return json(`/v1/agents/${agent}/tasks`, { method: 'POST', headers: auth(token), body: JSON.stringify({ title, description: title }) });
}
async function startTask(token: string, agent: string, taskId: string) {
  return json(`/v1/agents/${agent}/tasks/${taskId}/start`, { method: 'POST', headers: auth(token) });
}
async function setAppWaits(token: string, agent: string, value: unknown) {
  return json(`/v1/agents/${agent}/task-start`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ task_start_app_waits: value }) });
}
async function appNotices(token: string, taskId?: string): Promise<any[]> {
  const { body } = await json('/v1/notifications?limit=200', { headers: auth(token) });
  return (body?.data?.notifications ?? []).filter((n: any) => n.type === 'task_started_by_app' && (!taskId || String(n.link ?? '').includes(taskId)));
}
async function trailEvents(token: string, taskId: string): Promise<any[]> {
  const { body } = await json('/v1/build-with-you/trail?limit=500', { headers: auth(token) });
  return (body?.data?.entries ?? []).filter((e: any) => e.event === 'task.started_by_app' && e.target === taskId);
}
async function taskStatus(token: string, agent: string, taskId: string): Promise<string> {
  const { body } = await json(`/v1/agents/${agent}/tasks/${taskId}`, { headers: auth(token) });
  return body?.data?.task?.status;
}

console.log('\n=== An app starts a task that waits for the owner ===\n');

const owner = await newOwner('appstart');
const other = await newOwner('appstranger');
let buyer!: Agent, chat!: Agent, appToken = '';

console.log('Setup');
await test('An agent that can spend money, the owner\'s chat AI, and an app granted task:read and task:write', async () => {
  buyer = await newAgent(owner, 'buyer', ['task:read', 'task:write', 'commerce:buy']);
  chat = await newAgent(owner, 'chatai', ['task:read', 'task:write', 'agent:write']);
  await newAgent(owner, 'helper', ['task:read', 'task:write']);
  appToken = await grantApp(owner, ['task:read', 'task:write']);
  assert(!!buyer.token && !!chat.token && !!appToken, 'every token issued');
});

console.log('\n1. The owner sees each start');
let heldId = '';
await test('1a. The app starts a task the floor held: it runs, and the owner\'s trail names the app and the task', async () => {
  const r = await createTask(appToken, 'buyer', 'Buy the paper');
  assert(r.status === 201 && r.body.data.task.status === 'queued', `create ${r.status} ${r.body?.data?.task?.status}`);
  assert(r.body.data.start.waits_because === 'floor', `waits ${JSON.stringify(r.body.data.start)}`);
  heldId = r.body.data.task.id;
  const s = await startTask(appToken, 'buyer', heldId);
  assert(s.status === 200 && s.body.data.task.status === 'active', `start ${s.status} ${JSON.stringify(s.body?.error)}`);
  const events = await trailEvents(owner.token, heldId);
  assert(events.length === 1, `one trail entry, got ${events.length}`);
  assert(events[0].actorKind === 'app' && events[0].actorName === APP_NAME, `actor ${events[0].actorKind} ${events[0].actorName}`);
  assert(String(events[0].detail ?? '').includes(APP_NAME) && String(events[0].detail ?? '').includes('Buy the paper'),
    `detail names the app and the task: ${events[0].detail}`);
});

await test('1b. The owner gets a notification: which app, which task, why it waited, and where the setting is', async () => {
  const notices = await appNotices(owner.token, heldId);
  assert(notices.length === 1, `one notice, got ${notices.length}`);
  const n = notices[0];
  assert(n.i18n?.key === 'task_started_by_app', `key ${n.i18n?.key}`);
  assert(n.i18n?.vars?.app === APP_NAME && n.i18n?.vars?.title === 'Buy the paper', `vars ${JSON.stringify(n.i18n?.vars)}`);
  assert(String(n.title).includes(APP_NAME) && String(n.title).includes('Buy the paper'), `title ${n.title}`);
  assert(String(n.body).length > 0, 'a body that says why it waited');
  assert((n.actions ?? []).some((a: any) => a.kind === 'navigate' && String(a.link).includes('agent=buyer')), `settings button ${JSON.stringify(n.actions)}`);
});

await test('1c. A start of a task that waited for nobody in person writes no entry and no notification', async () => {
  const r = await createTask(appToken, 'helper', 'Sort the notes');
  assert(r.status === 201 && r.body.data.task.status === 'queued', `create ${r.status}`);
  const s = await startTask(appToken, 'helper', r.body.data.task.id);
  assert(s.status === 200, `start ${s.status}`);
  assert((await trailEvents(owner.token, r.body.data.task.id)).length === 0, 'no trail entry');
  assert((await appNotices(owner.token, r.body.data.task.id)).length === 0, 'no notice');
});

await test('1d. Another owner never gets the notice', async () => {
  assert((await appNotices(other.token)).length === 0, 'none for the other owner');
});

console.log('\n2. Wait for me also when an app starts it');
let waitId = '';
await test('2a. The owner turns the setting on, and the agent list says so', async () => {
  const set = await setAppWaits(owner.token, 'buyer', true);
  assert(set.status === 200 && set.body.data.task_start_app_waits === true, `set ${set.status} ${JSON.stringify(set.body)}`);
  const { body } = await json('/v1/agents', { headers: auth(owner.token) });
  const a = (body?.data?.agents ?? []).find((x: any) => x.name === 'buyer');
  assert(a?.task_start_app_waits === true, `list ${JSON.stringify(a?.task_start_app_waits)}`);
  // The setting sits beside task_start and does not change it.
  assert(a?.task_start === null, `task_start untouched: ${a?.task_start}`);
});

await test('2b. The app\'s start is refused and the task stays queued for the owner', async () => {
  const r = await createTask(appToken, 'buyer', 'Buy more paper');
  waitId = r.body.data.task.id;
  const s = await startTask(appToken, 'buyer', waitId);
  assert(s.status === 403 && s.body.error?.code === 'OWNER_MUST_START', `app ${s.status} ${s.body.error?.code}`);
  assert(await taskStatus(owner.token, 'buyer', waitId) === 'queued', 'still queued');
  assert((await trailEvents(owner.token, waitId)).length === 0, 'a refused start is no app start');
});

await test('2c. The owner in person still starts it', async () => {
  const s = await startTask(owner.token, 'buyer', waitId);
  assert(s.status === 200 && s.body.data.task.status === 'active', `owner ${s.status}`);
});

await test('2d. The owner\'s chat AI may set it over REST, and off again; the agent itself may not', async () => {
  const self = await setAppWaits(buyer.token, 'buyer', false);
  assert(self.status === 403, `agent itself ${self.status}`);
  const off = await setAppWaits(chat.token, 'buyer', false);
  assert(off.status === 200 && off.body.data.task_start_app_waits === false, `chat off ${off.status} ${JSON.stringify(off.body)}`);
  const on = await setAppWaits(chat.token, 'buyer', true);
  assert(on.status === 200 && on.body.data.task_start_app_waits === true, `chat on ${on.status}`);
});

await test('2e. A value that is not true or false is refused, and a body with neither field still is', async () => {
  const bad = await setAppWaits(owner.token, 'buyer', 'yes');
  // The contract's request check (VALIDATION_ERROR) or the service's own (INVALID_INPUT), whichever reads it first.
  assert(bad.status === 400 && ['VALIDATION_ERROR', 'INVALID_INPUT'].includes(bad.body.error?.code), `bad ${bad.status} ${bad.body.error?.code}`);
  const empty = await json('/v1/agents/buyer/task-start', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({}) });
  assert(empty.status === 400, `empty ${empty.status}`);
});

await test('2f. Another owner cannot change it', async () => {
  const x = await setAppWaits(other.token, encodeURIComponent(buyer.gaii), false);
  // The agent exists, so the answer is the ownership refusal, not a missing record.
  assert(x.status === 403, `cross-owner ${x.status}`);
  const { body } = await json('/v1/agents', { headers: auth(owner.token) });
  assert((body?.data?.agents ?? []).find((a: any) => a.name === 'buyer')?.task_start_app_waits === true, 'unchanged');
});

console.log('\n3. The same setting from the chat, and who may not change it');
let ai!: Agent;
/** buyer's task_start_app_waits as aimeat_agents_list reads it on `session`. */
async function appWaitsOverMcp(session: Awaited<ReturnType<typeof openSession>>): Promise<unknown> {
  const list = await callTool(session, 'aimeat_agents_list', {});
  assert(!list.isError, `aimeat_agents_list: ${list.text.slice(0, 200)}`);
  const agents = list.data?.agents ?? list.data?.structuredContent?.agents ?? [];
  return agents.find((a: any) => a.name === 'buyer')?.task_start_app_waits;
}

await test('3a. The owner\'s AI turns it off and on over MCP, and its agent list reads each value', async () => {
  ai = await newAgent(owner, 'mcpai', ['agent:read', 'agent:write']);
  const s = await openSession(BASE, ai.token, 'e2e-app-task-start');
  const off = await callTool(s, 'aimeat_agent_task_start_set', { target_agent_name: 'buyer', task_start_app_waits: false });
  assert(!off.isError && off.data.task_start_app_waits === false, `off ${off.text.slice(0, 300)}`);
  assert(await appWaitsOverMcp(s) === false, 'the list reads false');
  const on = await callTool(s, 'aimeat_agent_task_start_set', { target_agent_name: 'buyer', task_start_app_waits: true });
  assert(!on.isError && on.data.task_start_app_waits === true, `on ${on.text.slice(0, 300)}`);
  assert(await appWaitsOverMcp(s) === true, 'the list reads true');
  // task_start is left as it was: only the field the call named changes.
  assert(on.data.task_start === null, `task_start untouched: ${on.data.task_start}`);
});

await test('3b. An agent cannot set its own over MCP: ACCESS_DENIED, and its value stays unset', async () => {
  const s = await openSession(BASE, ai.token, 'e2e-app-task-start-self');
  const self = await callTool(s, 'aimeat_agent_task_start_set', { target_agent_name: 'mcpai', task_start_app_waits: true });
  assert(self.isError && self.offered && /^ACCESS_DENIED: /.test(self.text), `self ${self.text.slice(0, 300)}`);
  const { body } = await json('/v1/agents', { headers: auth(owner.token) });
  assert((body?.data?.agents ?? []).find((a: any) => a.name === 'mcpai')?.task_start_app_waits === false, 'mcpai unchanged');
});

await test('3c. The app cannot turn it off: refused, and the setting stays on', async () => {
  const off = await setAppWaits(appToken, 'buyer', false);
  assert(off.status === 403, `app off ${off.status} ${JSON.stringify(off.body?.error)}`);  const { body } = await json('/v1/agents', { headers: auth(owner.token) });
  assert((body?.data?.agents ?? []).find((a: any) => a.name === 'buyer')?.task_start_app_waits === true, 'still on');
  const s = await startTask(appToken, 'buyer', (await createTask(appToken, 'buyer', 'Buy the ink')).body.data.task.id);
  assert(s.status === 403 && s.body.error?.code === 'OWNER_MUST_START', `the app still waits: ${s.status} ${s.body.error?.code}`);
});

finish();

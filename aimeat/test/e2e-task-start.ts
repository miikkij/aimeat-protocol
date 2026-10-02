/**
 * @file test/e2e-task-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A task starts on its own or waits for the owner's OK (services/agent-task-rules.ts).
 *   Measured on freshly sold hosted places on 2026-10-01: every task a customer gave the concierge
 *   waited in `queued` for a Start press nobody had told them about. This suite holds the four
 *   things the fix promises:
 *     1. the choice lives on the agent (`task_start`) and on the task (`start`), the task's word wins;
 *     2. a task that waits tells the owner (the create answer, a notification with a Start button);
 *     3. the person's own AI can start a task that waits only because of the setting, over REST and
 *        over MCP, and never its own;
 *     4. the floor holds: an agent that can spend, send or delete as the owner, or a plan that says
 *        it will, waits for the owner in person whatever the setting.
 *   The wake on Start is held by e2e-connect-tunnel-delivery (test 8).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=task-start
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function signMsg(privB64: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function ownerToken(owner: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(priv, owner + NODE_ID + ts) }) });
  assert(body.ok === true, `owner token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(priv, gaii + ts) }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

interface Agent { name: string; gaii: string; priv: string; token: string }

async function newOwner(prefix: string): Promise<{ name: string; token: string }> {
  const name = `${prefix}${Date.now()}`;
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  assert(status === 201, `owner ${status}: ${JSON.stringify(body)}`);
  return { name, token: await ownerToken(name, body.data.private_key) };
}
async function newAgent(owner: { name: string; token: string }, name: string, scopes: string[], mode?: string): Promise<Agent> {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name, owner: owner.name, capabilities: ['tasks'], scopes, ...(mode ? { mode } : {}) }),
  });
  assert(status === 201, `agent ${name} ${status}: ${JSON.stringify(body)}`);
  const gaii = body.data.agent.gaii as string;
  return { name, gaii, priv: body.data.private_key, token: await agentToken(gaii, body.data.private_key) };
}
async function createTask(token: string, agent: string, title: string, extra: Record<string, unknown> = {}) {
  return json(`/v1/agents/${agent}/tasks`, { method: 'POST', headers: auth(token), body: JSON.stringify({ title, description: title, ...extra }) });
}
async function propose(agent: Agent, taskId: string, todos: Array<Record<string, unknown>>) {
  return json(`/v1/agents/${agent.name}/tasks/${taskId}/propose-todos`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ todos }) });
}
async function startTask(token: string, agent: string, taskId: string) {
  return json(`/v1/agents/${agent}/tasks/${taskId}/start`, { method: 'POST', headers: auth(token) });
}
async function setTaskStart(token: string, agent: string, value: unknown) {
  return json(`/v1/agents/${agent}/task-start`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ task_start: value }) });
}
async function noticesFor(token: string, taskId: string): Promise<any[]> {
  const { body } = await json('/v1/notifications?limit=200', { headers: auth(token) });
  return (body?.data?.notifications ?? []).filter((n: any) => String(n.link ?? '').includes(taskId));
}
async function listAgent(token: string, name: string): Promise<any> {
  const { body } = await json('/v1/agents', { headers: auth(token) });
  return (body?.data?.agents ?? []).find((a: any) => a.name === name);
}

console.log('\n=== AIMEAT Task Start E2E ===\n');

const owner = await newOwner('tstart');
const other = await newOwner('tstranger');
let worker!: Agent, chat!: Agent, taskOnly!: Agent, stranger!: Agent;

console.log('Setup');
await test('Agents: a worker, the owner\'s chat AI, a task-only agent, a buyer, and a stranger', async () => {
  worker = await newAgent(owner, 'worker', ['memory:read', 'task:read', 'task:write']);
  chat = await newAgent(owner, 'chatai', ['task:read', 'task:write', 'agent:write']);
  taskOnly = await newAgent(owner, 'taskonly', ['task:read', 'task:write']);
  const buyer = await newAgent(owner, 'buyer', ['task:read', 'commerce:buy']);
  stranger = await newAgent(other, 'stranger', ['task:read', 'task:write', 'agent:write']);
  assert([worker, chat, taskOnly, buyer, stranger].every(a => !!a.token), 'every agent has a token');
});

console.log('\n1. Where the choice lives');
await test('1a. An agent nobody has set waits (interactive), and the answer says why and who can start it', async () => {
  const r = await createTask(owner.token, 'worker', 'Default waits');
  assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.task.status === 'queued', `status ${r.body.data.task.status}`);
  // No word from the creator, so nothing is stamped: the agent's setting decides when the plan arrives.
  assert(r.body.data.task.startPolicy == null, `startPolicy ${r.body.data.task.startPolicy}`);
  assert(r.body.data.start.policy === 'confirm', `policy ${r.body.data.start.policy}`);
  const s = r.body.data.start;
  assert(s.starts === 'after_your_ok' && s.waits_because === 'setting' && s.who_can_start === 'owner_or_their_ai', `start ${JSON.stringify(s)}`);
  assert(typeof s.reason === 'string' && s.reason.length > 0, 'a reason the AI can read out');
});

await test('1b. The agent list shows the setting, what applies, and nothing holding it', async () => {
  const a = await listAgent(owner.token, 'worker');
  assert(a.task_start === null && a.task_start_effective === 'confirm', `worker ${JSON.stringify({ s: a.task_start, e: a.task_start_effective })}`);
  assert(Array.isArray(a.task_start_held_by) && a.task_start_held_by.length === 0, `held_by ${JSON.stringify(a.task_start_held_by)}`);
});

await test('1c. An agent cannot change how its own tasks start', async () => {
  const r = await setTaskStart(worker.token, 'worker', 'automatic');
  assert(r.status === 403, `own change ${r.status}: ${JSON.stringify(r.body)}`);
  const selfWithWrite = await setTaskStart(chat.token, 'chatai', 'automatic');
  assert(selfWithWrite.status === 403, `own change with agent:write ${selfWithWrite.status}`);
});

await test('1d. An agent without agent:write cannot change a sibling\'s; one from another account cannot either', async () => {
  const r = await setTaskStart(taskOnly.token, 'worker', 'automatic');
  assert(r.status === 403, `no agent:write ${r.status}`);
  const x = await json(`/v1/agents/${encodeURIComponent(worker.gaii)}/task-start`, { method: 'PATCH', headers: auth(stranger.token), body: JSON.stringify({ task_start: 'automatic' }) });
  // The agent exists, so the answer is the ownership refusal, not a missing record.
  assert(x.status === 403, `cross-owner ${x.status}`);
});

await test('1e. The owner\'s chat AI (agent:write) sets it; an owner-created task then starts on its own', async () => {
  const set = await setTaskStart(chat.token, 'worker', 'automatic');
  assert(set.status === 200 && set.body.data.task_start === 'automatic' && set.body.data.task_start_effective === 'automatic', `set ${set.status}: ${JSON.stringify(set.body)}`);
  const r = await createTask(owner.token, 'worker', 'Starts alone');
  assert(r.body.data.task.status === 'active', `status ${r.body.data.task.status}`);
  assert(r.body.data.start.starts === 'now', `start ${JSON.stringify(r.body.data.start)}`);
  const ev = await json(`/v1/agents/worker/tasks/${r.body.data.task.id}/events`, { headers: auth(owner.token) });
  assert((ev.body.data.events ?? []).some((e: any) => e.type === 'started'), 'a started event');
});

await test('1f. The task\'s own word wins: start=confirm waits on an automatic agent', async () => {
  const r = await createTask(owner.token, 'worker', 'Check with me first', { start: 'confirm' });
  assert(r.body.data.task.status === 'queued' && r.body.data.task.startPolicy === 'confirm', `task ${JSON.stringify(r.body.data.task.status)}`);
  const p = await propose(worker, r.body.data.task.id, [{ title: 'Step one' }]);
  assert(p.status === 200 && p.body.data.task.status === 'queued', `after the plan ${p.body?.data?.task?.status}`);
});

await test('1g. start=automatic: refused for an agent without agent:write and for an agent\'s own task; allowed for the chat AI', async () => {
  const off = await setTaskStart(owner.token, 'worker', 'confirm');
  assert(off.status === 200, `owner sets confirm ${off.status}`);
  const noWrite = await createTask(taskOnly.token, 'worker', 'Just do it A', { start: 'automatic' });
  assert(noWrite.status === 403, `task-only agent ${noWrite.status}`);
  const own = await createTask(chat.token, 'chatai', 'Just do it B', { start: 'automatic' });
  assert(own.status === 403, `own task ${own.status}`);
  const ok = await createTask(chat.token, 'worker', 'Just do it C', { start: 'automatic' });
  assert(ok.status === 201 && ok.body.data.task.status === 'active', `chat AI ${ok.status}: ${ok.body?.data?.task?.status}`);
});

console.log('\n2. The owner learns a task waits');
let waitingId = '';
await test('2a. A plan on a waiting task notifies the owner, with a Start button that runs their own session', async () => {
  const r = await createTask(owner.token, 'worker', 'Plan then notify');
  waitingId = r.body.data.task.id;
  const p = await propose(worker, waitingId, [{ title: 'Do the thing' }, { title: 'Report' }]);
  assert(p.body.data.task.status === 'queued', `queued ${p.body.data.task.status}`);
  let notices: any[] = [];
  for (let i = 0; i < 10 && notices.length === 0; i++) { notices = await noticesFor(owner.token, waitingId); if (!notices.length) await new Promise(res => setTimeout(res, 100)); }
  assert(notices.length === 1, `one notice, got ${notices.length}`);
  const n = notices[0];
  assert(n.type === 'task_waiting', `type ${n.type}`);
  const start = (n.actions ?? []).find((a: any) => a.id === 'start');
  assert(start && start.kind === 'api' && start.endpoint === `/v1/agents/worker/tasks/${waitingId}/start`, `start button ${JSON.stringify(start)}`);
  const go = await json(start.endpoint, { method: start.method, headers: auth(owner.token) });
  assert(go.status === 200 && go.body.data.task.status === 'active', `button press ${go.status}`);
});

console.log('\n3. The person\'s own AI starts a task on their word');
await test('3a. The chat AI starts a task that waits only because of the setting', async () => {
  const r = await createTask(owner.token, 'worker', 'Go ahead');
  await propose(worker, r.body.data.task.id, [{ title: 'Work' }]);
  const s = await startTask(chat.token, 'worker', r.body.data.task.id);
  assert(s.status === 200 && s.body.data.task.status === 'active', `chat start ${s.status}: ${JSON.stringify(s.body)}`);
  const ev = await json(`/v1/agents/worker/tasks/${r.body.data.task.id}/events`, { headers: auth(owner.token) });
  assert((ev.body.data.events ?? []).some((e: any) => e.type === 'started' && /chatai/.test(e.message)), 'the event says who started it');
});

await test('3b. An agent never starts its own task; another account\'s agent never starts this one', async () => {
  const r = await createTask(owner.token, 'worker', 'Not yours to start');
  const own = await startTask(worker.token, 'worker', r.body.data.task.id);
  assert(own.status === 403 && own.body.error?.code === 'OWNER_MUST_START', `own ${own.status} ${own.body.error?.code}`);
  const x = await startTask(stranger.token, 'worker', r.body.data.task.id);
  assert(x.status === 403, `cross-owner ${x.status}`);
});

console.log('\n4. What always waits');
await test('4a. An agent that can spend money waits whatever its setting, and the list says why', async () => {
  const set = await setTaskStart(owner.token, 'buyer', 'automatic');
  assert(set.status === 200 && (set.body.data.task_start_held_by ?? []).includes('commerce:buy'), `held_by ${JSON.stringify(set.body.data)}`);
  const r = await createTask(owner.token, 'buyer', 'Buy the thing', { start: 'automatic' });
  assert(r.status === 201 && r.body.data.task.status === 'queued', `status ${r.body.data?.task?.status}`);
  assert(r.body.data.start.waits_because === 'floor' && r.body.data.start.who_can_start === 'owner_in_person', `start ${JSON.stringify(r.body.data.start)}`);
  const chatTry = await startTask(chat.token, 'buyer', r.body.data.task.id);
  assert(chatTry.status === 403 && chatTry.body.error?.code === 'OWNER_MUST_START', `chat AI ${chatTry.status}`);
  const ownerGo = await startTask(owner.token, 'buyer', r.body.data.task.id);
  assert(ownerGo.status === 200, `owner ${ownerGo.status}`);
});

await test('4b. A plan that says it will delete sends a started task back to wait, and only the owner can start it', async () => {
  await setTaskStart(owner.token, 'worker', 'automatic');
  const r = await createTask(owner.token, 'worker', 'Clean up');
  const id = r.body.data.task.id;
  assert(r.body.data.task.status === 'active', `started ${r.body.data.task.status}`);
  const p = await propose(worker, id, [{ title: 'Delete the old records', effects: ['delete'] }]);
  assert(p.status === 200 && p.body.data.task.status === 'queued', `held back ${p.status}: ${p.body?.data?.task?.status}`);
  assert((p.body.data.task.todos ?? []).some((t: any) => (t.effects ?? []).includes('delete')), 'the effect is kept on the todo');
  const notices = await noticesFor(owner.token, id);
  assert(notices.some(n => n.type === 'task_waiting' && n.i18n?.key === 'task_waiting_held'), `held notice ${JSON.stringify(notices.map(n => n.i18n))}`);
  const chatTry = await startTask(chat.token, 'worker', id);
  assert(chatTry.status === 403, `chat AI ${chatTry.status}`);
  const ownerGo = await startTask(owner.token, 'worker', id);
  assert(ownerGo.status === 200 && ownerGo.body.data.task.status === 'active', `owner ${ownerGo.status}`);
});

await test('4c. A plan with no guarded effect on an automatic agent just goes on', async () => {
  const r = await createTask(owner.token, 'worker', 'Plain work');
  const p = await propose(worker, r.body.data.task.id, [{ title: 'Read and summarise' }]);
  assert(p.body.data.task.status === 'active', `stays active ${p.body.data.task.status}`);
  const notices = await noticesFor(owner.token, r.body.data.task.id);
  assert(notices.length === 0, 'no notice for work that just goes on');
});

await test('4e. A task-runner holding `*` still starts on its own (the floor reads named permissions)', async () => {
  // aimeat.io, 2026-10-02: 52 of the 53 task-runners of the busiest account hold `*`. Counting the
  // wildcard would stop the whole fleet; that is the owner's ruling to make, not a deploy's side effect.
  await newAgent(owner, 'starrunner', ['*'], 'task-runner');
  const r = await createTask(owner.token, 'starrunner', 'Nightly paper');
  assert(r.status === 201 && r.body.data.task.status === 'active', `status ${r.body.data?.task?.status}`);
  const a = await listAgent(owner.token, 'starrunner');
  assert(a.task_start_effective === 'automatic' && a.task_start_held_by.length === 0, `starrunner ${JSON.stringify(a.task_start_held_by)}`);
});

await test('4d. null goes back to the mode\'s answer', async () => {
  const r = await setTaskStart(owner.token, 'worker', null);
  assert(r.status === 200 && r.body.data.task_start === null && r.body.data.task_start_effective === 'confirm', `cleared ${JSON.stringify(r.body.data)}`);
  const bad = await setTaskStart(owner.token, 'worker', 'sometimes');
  assert(bad.status === 400, `bad value ${bad.status}`);
});

console.log('\n5. The same over MCP, as the person\'s chat AI');

interface McpSession { token: string; sessionId: string; nextId: number }
function parseSSE(text: string, id: number): any {
  for (const evt of text.split('\n\n')) {
    let data = '';
    for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
    if (!data) continue;
    try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
  }
  return {};
}
async function rpc(s: McpSession, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = s.nextId++;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}`,
      ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) s.sessionId = sid;
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json();
}
async function callTool(s: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const body = await rpc(s, 'tools/call', { name, arguments: args });
  return { isError: body?.result?.isError === true || body?.error !== undefined, text: body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body) };
}
async function mcpSessionFor(agent: Agent): Promise<McpSession> {
  const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'task start e2e', redirect_uris: [] }) });
  const ts = new Date().toISOString();
  const params = new URLSearchParams({
    response_type: 'code', client_id: client.body.client_id, gaii: agent.gaii,
    signature: await signMsg(agent.priv, agent.gaii + NODE_ID + ts), timestamp: ts,
  });
  const authz = await json(`/v1/mcp/authorize?${params}`);
  const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }) });
  assert(tok.status === 200, `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);
  const s: McpSession = { token: tok.body.access_token, sessionId: '', nextId: 1 };
  await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'task start e2e', version: '1.0.0' } });
  await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}`, 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return s;
}

let chatMcp!: McpSession;
await test('5a. The chat AI sets the worker to confirm, gives it a task, and is told it waits', async () => {
  chatMcp = await mcpSessionFor(chat);
  const set = await callTool(chatMcp, 'aimeat_agent_task_start_set', { target_agent_name: 'worker', task_start: 'confirm' });
  assert(!set.isError && JSON.parse(set.text).task_start === 'confirm', `set ${set.text}`);
  const self = await callTool(chatMcp, 'aimeat_agent_task_start_set', { target_agent_name: 'chatai', task_start: 'automatic' });
  assert(self.isError, 'its own setting is refused');
  const made = await callTool(chatMcp, 'aimeat_task_create', { target_agent: 'worker', title: 'Over MCP', description: 'Over MCP' });
  assert(!made.isError, `create ${made.text}`);
  const out = JSON.parse(made.text);
  assert(out.status === 'queued' && out.start?.starts === 'after_your_ok' && out.start?.who_can_start === 'owner_or_their_ai', `answer ${made.text}`);
  const p = await propose(worker, out.task_id, [{ title: 'Work' }]);
  assert(p.body.data.task.status === 'queued', `after the plan ${p.body.data.task.status}`);
  const go = await callTool(chatMcp, 'aimeat_task_start', { task_id: out.task_id });
  assert(!go.isError && JSON.parse(go.text).status === 'active', `start ${go.text}`);
});

await test('5b. Over MCP the chat AI cannot start a task the floor holds', async () => {
  const r = await createTask(owner.token, 'buyer', 'Buy again');
  const go = await callTool(chatMcp, 'aimeat_task_start', { task_id: r.body.data.task.id });
  assert(go.isError && /OWNER_MUST_START/.test(go.text), `refused ${go.text}`);
});

await test('5c. Over MCP the propose answer says go on or wait', async () => {
  const workerMcp = await mcpSessionFor(worker);
  const r = await createTask(owner.token, 'worker', 'Plan over MCP');
  const p = await callTool(workerMcp, 'aimeat_task_propose_todos', { task_id: r.body.data.task.id, todos: [{ title: 'One' }] });
  assert(!p.isError && JSON.parse(p.text).next === 'wait_for_owner', `next ${p.text}`);
});

console.log('\n6. Deleting shared records for good is its own permission (ruling B)');
await test('6a. memory:delete alone no longer deletes workspace records for good; memory:purge passes that check', async () => {
  const deleter = await newAgent(owner, 'deleter', ['memory:read', 'memory:delete']);
  const purger = await newAgent(owner, 'purger', ['memory:read', 'memory:purge']);
  const body = JSON.stringify({ namespace: 'shared.notes', ids: ['x'] });
  const refused = await json('/v1/organisms/no-such-organism/workspace/records/delete', { method: 'POST', headers: auth(deleter.token), body });
  assert(refused.status === 403, `memory:delete alone ${refused.status}`);
  // Past the permission check, the request meets the next one: the organism does not exist.
  const passed = await json('/v1/organisms/no-such-organism/workspace/records/delete', { method: 'POST', headers: auth(purger.token), body });
  assert(passed.status === 404, `memory:purge ${passed.status}: ${JSON.stringify(passed.body?.error)}`);
});

await test('6b. An agent holding memory:purge has every task wait, whatever its setting', async () => {
  const set = await setTaskStart(owner.token, 'purger', 'automatic');
  assert(set.status === 200 && set.body.data.task_start_held_by.includes('memory:purge'), `held_by ${JSON.stringify(set.body.data)}`);
  const r = await createTask(owner.token, 'purger', 'Tidy the workspace');
  assert(r.body.data.task.status === 'queued' && r.body.data.start.waits_because === 'floor', `start ${JSON.stringify(r.body.data.start)}`);
});

console.log('\n7. An agent with all permissions, and the narrowing (ruling C)');
let star!: Agent;
await test('7a. A fresh `*` agent is still being observed: its tasks start, and there is nothing to narrow yet', async () => {
  star = await newAgent(owner, 'star', ['*'], 'task-runner');
  const a = await listAgent(owner.token, 'star');
  assert(a.task_start_wildcard && a.task_start_wildcard.ready === false && a.task_start_wildcard.days_left === 14, `wildcard ${JSON.stringify(a.task_start_wildcard)}`);
  const n = await json('/v1/agents/star/scope-narrowing', { method: 'POST', headers: auth(owner.token) });
  assert(n.status === 409 && n.body.error?.code === 'NOTHING_RECORDED', `narrow ${n.status} ${n.body.error?.code}`);
  const r = await createTask(owner.token, 'star', 'Still starts');
  assert(r.body.data.task.status === 'active', `status ${r.body.data.task.status}`);
});

await test('7b. What it used is recorded, and the owner narrows it to that with one press', async () => {
  const wrote = await json('/v1/memory', { method: 'POST', headers: auth(star.token), body: JSON.stringify({ key: 'star.note', value: { ok: true } }) });
  assert(wrote.status === 201 || wrote.status === 200, `write ${wrote.status}`);
  const read = await json('/v1/memory?prefix=star.', { headers: auth(star.token) });
  assert(read.status === 200, `read ${read.status}`);
  const a = await listAgent(owner.token, 'star');
  const used = a.task_start_wildcard?.used ?? [];
  assert(used.includes('memory:write') && used.includes('memory:read'), `used ${JSON.stringify(used)}`);
  const other = await json('/v1/agents/star/scope-narrowing', { method: 'POST', headers: auth(chat.token) });
  assert(other.status === 403, `an agent without agent:permissions ${other.status}`);
  const n = await json('/v1/agents/star/scope-narrowing', { method: 'POST', headers: auth(owner.token) });
  assert(n.status === 200, `narrow ${n.status}: ${JSON.stringify(n.body)}`);
  const scopes: string[] = n.body.data.scopes;
  assert(!scopes.includes('*') && scopes.includes('memory:read') && scopes.includes('memory:write'), `scopes ${JSON.stringify(scopes)}`);
  const after = await listAgent(owner.token, 'star');
  assert(after.task_start_wildcard === null, `no longer all permissions ${JSON.stringify(after.task_start_wildcard)}`);
});

await test('7c. A permission it never used is refused after the narrowing, on a fresh token', async () => {
  const fresh = await agentToken(star.gaii, star.priv);
  const refused = await json('/v1/contacts', { headers: auth(fresh) });
  assert(refused.status === 403, `contacts after narrowing ${refused.status}`);
});

console.log('\nCleanup');
await test('Cascade-delete both owners', async () => {
  for (const o of [owner, other]) {
    const { status } = await json(`/v1/owners/${encodeURIComponent(o.name)}`, { method: 'DELETE', headers: auth(o.token) });
    assert(status === 200, `delete ${o.name}: ${status}`);
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Task Start E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-agent-stop.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner stops an agent, and starts it again (services/agent-stop.ts,
 *   services/agent-stop-rules.ts). Ruled by Jouni on 2026-10-11: work that is running finishes,
 *   scheduled runs are skipped while the agent is stopped, and tasks and messages it is given wait
 *   and are handled after it is started. Its key is not revoked. This suite holds each part:
 *     1. the state is written once, shown on the agent list, and a second press changes nothing;
 *     2. who may: the owner and a sibling with agent:write; never the agent itself, a sibling
 *        without the permission, or another account;
 *     3. what waits: a new task stays queued with reason `stopped` and nobody can start it, a
 *        scheduled run is skipped with outcome `stopped`, and the agent's own reads (task list,
 *        inbox, pending messages, handbook) hand it nothing new and say why;
 *     4. the runtime is not woken: no push over its connector socket for a new task or a message,
 *        and a backlog with only the work it is already doing;
 *     5. a start releases the tasks that would have started on their own, wakes the runtime and
 *        hands over what waited, and leaves a task that needs the owner's OK waiting;
 *     6. the same over MCP, as the person's chat AI.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-stop
 * @version-history
 *   v1.2.0 — 2026-10-11 — 4b and 5a hold what a live fleet found the day this shipped: a direct
 *     message that arrives during the stop is delivered at the start (once, and one from before the
 *     stop is not), and the released tasks arrive in the one backlog with no frame of their own.
 *   v1.1.0 — 2026-10-11 — 3f: the agent's handbook lists no waiting task, names no wait endpoint, and
 *     GET .../tasks/wait is gone (the long poll was removed).
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { registerOwner } from './helpers/owner-login.js';

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
async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(priv, gaii + ts) }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

interface Agent { name: string; gaii: string; priv: string; token: string }

async function newOwner(prefix: string): Promise<{ name: string; token: string }> {
  const name = `${prefix}${Date.now()}`;
  return { name, token: (await registerOwner(BASE, name)).token };
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
async function createTask(token: string, agent: string, title: string) {
  return json(`/v1/agents/${agent}/tasks`, { method: 'POST', headers: auth(token), body: JSON.stringify({ title, description: title }) });
}
const stop = (token: string, agent: string) => json(`/v1/agents/${encodeURIComponent(agent)}/stop`, { method: 'POST', headers: auth(token) });
const start = (token: string, agent: string) => json(`/v1/agents/${encodeURIComponent(agent)}/start`, { method: 'POST', headers: auth(token) });
async function listed(token: string, name: string): Promise<any> {
  const { body } = await json('/v1/agents', { headers: auth(token) });
  return (body?.data?.agents ?? []).find((a: any) => a.name === name);
}
async function taskOf(token: string, agent: string, id: string): Promise<any> {
  const { body } = await json(`/v1/agents/${agent}/tasks/${id}`, { headers: auth(token) });
  return body?.data?.task ?? body?.data;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

console.log('\n=== AIMEAT Agent Stop and Start E2E ===\n');

const owner = await newOwner('astop');
const other = await newOwner('astranger');
const ownerGhii = `${owner.name}@${NODE_ID}`;
let worker!: Agent, chat!: Agent, plain!: Agent, stranger!: Agent;
let runningId = '';
let dmBeforeStopId = '';
let dmWhileStoppedId = '';

console.log('Setup');
await test('Agents: a worker that starts its tasks on its own, the owner\'s chat AI, a plain agent, and a stranger', async () => {
  worker = await newAgent(owner, 'worker', ['memory:read', 'task:read', 'task:write', 'messages:read'], 'task-runner');
  chat = await newAgent(owner, 'chatai', ['task:read', 'task:write', 'agent:read', 'agent:write']);
  plain = await newAgent(owner, 'plain', ['task:read', 'task:write']);
  stranger = await newAgent(other, 'stranger', ['task:read', 'task:write', 'agent:write']);
  assert([worker, chat, plain, stranger].every(a => !!a.token), 'every agent has a token');
});

await test('Before the stop a task starts on its own: this one is the work in flight', async () => {
  const r = await createTask(owner.token, 'worker', 'Running before the stop');
  assert(r.status === 201 && r.body.data.task.status === 'active', `create ${r.status}: ${r.body?.data?.task?.status}`);
  runningId = r.body.data.task.id;
  const a = await listed(owner.token, 'worker');
  assert(a.stopped === false && a.stopped_at === null && a.stopped_by === null, `row before: ${JSON.stringify({ s: a.stopped, at: a.stopped_at, by: a.stopped_by })}`);
  // A direct message from before the stop. It was the agent's to hear when it arrived, so a start
  // must not send it again (test 5a).
  const dm = await json('/v1/messages', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ to: worker.gaii, body: 'Said before the stop', subject: 'Before' }) });
  assert(dm.status === 201, `dm before the stop ${dm.status}: ${JSON.stringify(dm.body)}`);
  dmBeforeStopId = dm.body.data.message.id;
  await sleep(15);
});

console.log('\n1. The state');
let stoppedAt = '';
await test('1a. The owner stops the worker: the answer says stopped, when and by whom', async () => {
  const r = await stop(owner.token, 'worker');
  assert(r.status === 200, `stop ${r.status}: ${JSON.stringify(r.body)}`);
  const d = r.body.data;
  assert(d.stopped === true && d.changed === true && d.released === 0, `answer ${JSON.stringify(d)}`);
  assert(d.stopped_by === ownerGhii, `stopped_by ${d.stopped_by}`);
  assert(typeof d.stopped_at === 'string' && !Number.isNaN(Date.parse(d.stopped_at)), `stopped_at ${d.stopped_at}`);
  assert(d.gaii === worker.gaii && d.name === 'worker', `which agent ${d.gaii}`);
  stoppedAt = d.stopped_at;
});

await test('1b. A second stop answers ok and changes nothing', async () => {
  const r = await stop(owner.token, 'worker');
  assert(r.status === 200 && r.body.data.changed === false, `second stop ${r.status}: ${JSON.stringify(r.body.data)}`);
  assert(r.body.data.stopped === true && r.body.data.stopped_at === stoppedAt, `stopped_at moved: ${r.body.data.stopped_at}`);
});

await test('1c. The agent list shows it stopped, and only it', async () => {
  const w = await listed(owner.token, 'worker');
  assert(w.stopped === true && w.stopped_at === stoppedAt && w.stopped_by === ownerGhii, `worker row ${JSON.stringify({ s: w.stopped, at: w.stopped_at, by: w.stopped_by })}`);
  const c = await listed(owner.token, 'chatai');
  assert(c.stopped === false && c.stopped_at === null, `chat row ${JSON.stringify({ s: c.stopped, at: c.stopped_at })}`);
  // A sibling reading the roster sees it too: that is how a runtime learns which of its agents to leave alone.
  const seenBySibling = await listed(chat.token, 'worker');
  assert(seenBySibling?.stopped === true, `sibling's view ${JSON.stringify(seenBySibling?.stopped)}`);
});

await test('1d. Its key still works: stopping revokes nothing', async () => {
  const fresh = await agentToken(worker.gaii, worker.priv);
  assert(typeof fresh === 'string' && fresh.length > 20, 'a new token from the same key');
  const r = await json('/v1/agents/worker/tasks?status=active', { headers: auth(fresh) });
  assert(r.status === 200, `own read ${r.status}`);
});

console.log('\n2. Who may stop and start');
await test('2a. An agent cannot stop or start itself, even with agent:write', async () => {
  const s = await stop(chat.token, 'chatai');
  assert(s.status === 403 && s.body.error?.code === 'ACCESS_DENIED', `self stop ${s.status} ${s.body.error?.code}`);
  // The stopped worker has no agent:write, and could not start itself if it had.
  const w = await start(worker.token, 'worker');
  assert(w.status === 403, `stopped agent starting itself ${w.status}`);
  assert((await listed(owner.token, 'worker')).stopped === true, 'still stopped');
});

await test('2b. A sibling without agent:write cannot start it', async () => {
  const r = await start(plain.token, 'worker');
  assert(r.status === 403, `plain start ${r.status}: ${JSON.stringify(r.body.error)}`);
  assert((await listed(owner.token, 'worker')).stopped === true, 'still stopped');
});

await test('2c. Another account cannot, by name or by full identity', async () => {
  const byName = await start(stranger.token, 'worker');
  assert(byName.status === 404, `by name ${byName.status}`);
  const byGaii = await start(stranger.token, worker.gaii);
  assert(byGaii.status === 403 && byGaii.body.error?.code === 'ACCESS_DENIED', `by identity ${byGaii.status} ${byGaii.body.error?.code}`);
  const otherOwner = await start(other.token, worker.gaii);
  assert(otherOwner.status === 403, `other owner ${otherOwner.status}`);
  assert((await listed(owner.token, 'worker')).stopped === true, 'still stopped');
});

await test('2d. No credential is refused, and an agent that does not exist is not found', async () => {
  const anon = await json('/v1/agents/worker/stop', { method: 'POST' });
  assert(anon.status === 401, `anonymous ${anon.status}`);
  const none = await stop(owner.token, 'nosuchagent');
  assert(none.status === 404 && none.body.error?.code === 'AGENT_NOT_FOUND', `missing ${none.status} ${none.body.error?.code}`);
});

console.log('\n3. What waits while it is stopped');
let waitingId = '';
await test('3a. A new task stays queued, and the answer says the agent is stopped', async () => {
  const r = await createTask(owner.token, 'worker', 'Given while stopped');
  assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.task.status === 'queued', `status ${r.body.data.task.status}`);
  const s = r.body.data.start;
  assert(s.waits_because === 'stopped' && s.starts === 'after_your_ok', `start ${JSON.stringify(s)}`);
  assert(s.who_can_start === null, `who_can_start ${s.who_can_start}`);
  assert(/stopped/.test(s.reason) && /start the agent/.test(s.reason), `reason: ${s.reason}`);
  waitingId = r.body.data.task.id;
});

await test('3b. Nobody can start that task: the owner and the chat AI both get AGENT_STOPPED', async () => {
  const byOwner = await json(`/v1/agents/worker/tasks/${waitingId}/start`, { method: 'POST', headers: auth(owner.token) });
  assert(byOwner.status === 409 && byOwner.body.error?.code === 'AGENT_STOPPED', `owner ${byOwner.status} ${byOwner.body.error?.code}`);
  const byChat = await json(`/v1/agents/worker/tasks/${waitingId}/start`, { method: 'POST', headers: auth(chat.token) });
  assert(byChat.status === 409 && byChat.body.error?.code === 'AGENT_STOPPED', `chat ${byChat.status} ${byChat.body.error?.code}`);
  assert((await taskOf(owner.token, 'worker', waitingId)).status === 'queued', 'still queued');
});

await test('3c. No "waiting for your OK" notice is sent for it: there is nothing to approve', async () => {
  const { body } = await json('/v1/notifications?limit=200', { headers: auth(owner.token) });
  const forTask = (body?.data?.notifications ?? []).filter((n: any) => String(n.link ?? '').includes(waitingId));
  assert(forTask.length === 0, `notices for the task: ${forTask.length}`);
});

await test('3d. The agent\'s own task list hands it no waiting task and says why; the owner\'s list is whole', async () => {
  const queued = await json('/v1/agents/worker/tasks?status=queued', { headers: auth(worker.token) });
  assert(queued.status === 200, `own queued ${queued.status}`);
  assert(queued.body.data.tasks.length === 0 && queued.body.data.agent_stopped === true, `own queued ${JSON.stringify({ n: queued.body.data.tasks.length, s: queued.body.data.agent_stopped })}`);
  const all = await json('/v1/agents/worker/tasks', { headers: auth(worker.token) });
  const ids = all.body.data.tasks.map((t: any) => t.id);
  assert(!ids.includes(waitingId) && all.body.data.agent_stopped === true, `own full list ${JSON.stringify(ids)}`);
  // Work it is doing is still its to finish.
  const active = await json('/v1/agents/worker/tasks?status=active', { headers: auth(worker.token) });
  assert(active.body.data.tasks.some((t: any) => t.id === runningId) && active.body.data.agent_stopped === true, 'the running task is listed');
  const asOwner = await json('/v1/agents/worker/tasks?status=queued', { headers: auth(owner.token) });
  assert(asOwner.body.data.tasks.some((t: any) => t.id === waitingId), 'the owner sees the waiting task');
  assert(asOwner.body.data.agent_stopped === undefined, `the owner's list carries no flag: ${asOwner.body.data.agent_stopped}`);
});

let messageId = '';
await test('3e. A message is stored and waits: the agent\'s own inbox and pending list are empty and say why', async () => {
  const sent = await json('/v1/agents/worker/messages', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ direction: 'inbound', content: 'Said while stopped' }) });
  assert(sent.status === 201, `send ${sent.status}: ${JSON.stringify(sent.body)}`);
  messageId = sent.body.data.message.id;
  const inbox = await json('/v1/agents/worker/inbox', { headers: auth(worker.token) });
  assert(inbox.status === 200, `own inbox ${inbox.status}`);
  const d = inbox.body.data;
  assert(d.agent_stopped === true && d.queued_tasks.length === 0 && d.pending_messages.length === 0, `own inbox ${JSON.stringify({ s: d.agent_stopped, q: d.queued_tasks.length, m: d.pending_messages.length })}`);
  assert(d.active_tasks.some((t: any) => t.id === runningId), 'own inbox still carries the running task');
  const pending = await json('/v1/agents/worker/messages/inbox', { headers: auth(worker.token) });
  assert(pending.body.data.messages.length === 0 && pending.body.data.agent_stopped === true, `own pending ${JSON.stringify(pending.body.data)}`);
  const asOwner = await json('/v1/agents/worker/inbox', { headers: auth(owner.token) });
  assert(asOwner.body.data.pending_messages.some((m: any) => m.id === messageId), 'the owner sees the waiting message');
  assert(asOwner.body.data.queued_tasks.some((t: any) => t.id === waitingId) && asOwner.body.data.agent_stopped === undefined, 'the owner sees the waiting task, and no flag');
});

await test('3f. The agent\'s handbook, its first read, lists no waiting task and says why', async () => {
  const own = await json('/v1/agents/me/handbook', { headers: auth(worker.token) });
  assert(own.status === 200, `own handbook ${own.status}`);
  const q = own.body.data.task_queue;
  assert(q.agent_stopped === true && q.queued.length === 0, `own handbook queue ${JSON.stringify({ s: q.agent_stopped, n: q.queued.length })}`);
  assert(q.active.some((t: any) => t.id === runningId), 'the running task is listed');
  // The long poll GET .../tasks/wait was removed on 2026-10-11 (it had answered 404 since it was
  // written): the handbook names no such endpoint, and the path is a task id nobody has.
  assert(q.endpoints.wait === undefined, `the handbook still names a wait endpoint: ${q.endpoints.wait}`);
  const gone = await json('/v1/agents/worker/tasks/wait?timeout=1', { headers: auth(worker.token) });
  assert(gone.status === 404, `tasks/wait ${gone.status}`);
});

let scheduleId = '';
await test('3g. A scheduled run is skipped with outcome stopped, and makes no task', async () => {
  const made = await json('/v1/agents/worker/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      kind: 'agent_task', cron: '0 7 * * *', timezone: 'Europe/Helsinki', display_name: 'Morning run', purpose: 'stop e2e',
      task_template: { title: 'STOP_OCCURRENCE', description: 'the scheduled run' },
    }),
  });
  assert(made.status === 201, `schedule ${made.status}: ${JSON.stringify(made.body)}`);
  scheduleId = made.body.data.schedule.id;
  const run = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(owner.token) });
  assert(run.status === 200 && run.body.data.outcome === 'stopped', `trigger ${run.status}: ${JSON.stringify(run.body.data)}`);
  assert(typeof run.body.data.reason === 'string' && /stopped/.test(run.body.data.reason), `reason ${run.body.data.reason}`);
  assert(run.body.data.task_id === undefined, 'no task id');
  const tasks = await json('/v1/agents/worker/tasks?per_page=100', { headers: auth(owner.token) });
  assert(!tasks.body.data.tasks.some((t: any) => t.title === 'STOP_OCCURRENCE'), 'no occurrence was made');
});

console.log('\n4. The runtime is not woken');
let tunnel!: TunnelClient;
let pushedWhileStoppedId = '';
await test('4a. On connect a stopped agent\'s backlog carries the work it is doing, and nothing that waits', async () => {
  tunnel = await TunnelClient.connect(BASE, worker.token);
  const bl = await tunnel.waitForBacklog(1500);
  assert(bl !== null, 'a backlog arrives');
  const tasks = ((bl!.payload as any).tasks ?? []) as any[];
  const messages = ((bl!.payload as any).messages ?? []) as any[];
  assert(tasks.some(t => t.id === runningId), 'the running task is in the backlog');
  assert(!tasks.some(t => t.id === waitingId), 'the waiting task is not');
  assert(messages.length === 0, `messages in the backlog: ${messages.length}`);
});

await test('4b. A new task, a new message and a direct message push nothing down the socket', async () => {
  const r = await createTask(owner.token, 'worker', 'Second while stopped');
  assert(r.status === 201 && r.body.data.task.status === 'queued', `create ${r.status}: ${r.body?.data?.task?.status}`);
  pushedWhileStoppedId = r.body.data.task.id;
  const sent = await json('/v1/agents/worker/messages', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ direction: 'inbound', content: 'Second message while stopped' }) });
  assert(sent.status === 201, `send ${sent.status}`);
  const dm = await json('/v1/messages', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ to: worker.gaii, body: 'Said in a direct message while stopped', subject: 'Stopped' }) });
  assert(dm.status === 201, `dm ${dm.status}: ${JSON.stringify(dm.body)}`);
  dmWhileStoppedId = dm.body.data.message.id;
  const d = await tunnel.waitForDeliver(700);
  assert(d === null, `a delivery reached a stopped agent: ${d?.kind}`);
});

console.log('\n5. Start');
await test('5a. The chat AI starts it: the direct message that waited is delivered, and the tasks cause no wake of their own', async () => {
  const r = await start(chat.token, 'worker');
  assert(r.status === 200, `start ${r.status}: ${JSON.stringify(r.body)}`);
  const d = r.body.data;
  assert(d.stopped === false && d.stopped_at === null && d.stopped_by === null && d.changed === true, `answer ${JSON.stringify(d)}`);
  assert(d.released === 2, `released ${d.released}`);
  // Every delivery frame the start causes. A direct message is never part of a backlog, so the one
  // that arrived while the agent was stopped is sent now, once, with the payload a live one has.
  // The released tasks arrive in the backlog (5b) and in no frame of their own: one start, one wake
  // for the tasks. On 2026-10-11 a live fleet measured a second wake that started a worker for nothing.
  const frames: any[] = [];
  for (let i = 0; i < 6; i++) {
    const f = await tunnel.waitForDeliver(500);
    if (!f) break;
    frames.push(f);
  }
  const dms = frames.filter(f => f.kind === 'dm.inbound');
  assert(dms.length === 1, `direct messages delivered on start: ${JSON.stringify(dms.map(f => f.payload?.id))}`);
  const p = dms[0].payload as any;
  assert(p.id === dmWhileStoppedId && dms[0].id === dmWhileStoppedId, `which message: ${p.id}`);
  assert(p.id !== dmBeforeStopId, 'the message from before the stop is not sent again');
  assert(p.senderGhii === ownerGhii && p.subject === 'Stopped' && typeof p.conversationId === 'string', `payload ${JSON.stringify(p)}`);
  assert(typeof p.preview === 'string' && p.preview.includes('while stopped') && typeof p.createdAt === 'string', `payload ${JSON.stringify(p)}`);
  const taskFrames = frames.filter(f => f.kind === 'task_assigned');
  assert(taskFrames.length === 0, `task frames beside the backlog: ${taskFrames.length}`);
});

await test('5b. One backlog follows the start: the released tasks as running, and the messages that waited', async () => {
  const bl = await tunnel.waitForBacklog(1500);
  assert(bl !== null, 'a backlog follows the start');
  const tasks = ((bl!.payload as any).tasks ?? []) as any[];
  for (const id of [waitingId, pushedWhileStoppedId]) {
    assert(tasks.find(t => t.id === id)?.status === 'active', `task ${id} in the backlog as active: ${tasks.find(t => t.id === id)?.status}`);
  }
  const messages = ((bl!.payload as any).messages ?? []) as any[];
  assert(messages.some(m => m.id === messageId), `the first waiting message is in it (${messages.length} messages)`);
  assert(messages.length === 2, `both waiting messages: ${messages.length}`);
  const second = await tunnel.waitForBacklog(600);
  assert(second === null, 'a second backlog arrived');
});

await test('5c. The released tasks are active, and the event says why they started', async () => {
  for (const id of [waitingId, pushedWhileStoppedId]) {
    assert((await taskOf(owner.token, 'worker', id)).status === 'active', `task ${id} is not active`);
  }
  const { body } = await json(`/v1/agents/worker/tasks/${waitingId}/events`, { headers: auth(owner.token) });
  const started = (body?.data?.events ?? []).filter((e: any) => e.type === 'started');
  assert(started.length === 1, `started events: ${started.length}`);
  assert(/when the agent was started/.test(started[0].message ?? ''), `event text: ${started[0].message}`);
});

await test('5d. The row and the agent\'s own reads are back to normal', async () => {
  const w = await listed(owner.token, 'worker');
  assert(w.stopped === false && w.stopped_at === null && w.stopped_by === null, `row ${JSON.stringify({ s: w.stopped, at: w.stopped_at, by: w.stopped_by })}`);
  const own = await json('/v1/agents/worker/tasks?status=active', { headers: auth(worker.token) });
  const activeIds = own.body.data.tasks.map((t: any) => t.id);
  assert(own.body.data.agent_stopped === undefined, `the flag is gone: ${own.body.data.agent_stopped}`);
  assert([runningId, waitingId, pushedWhileStoppedId].every(id => activeIds.includes(id)), `own active ${JSON.stringify(own.body.data.tasks.map((t: any) => t.title))}`);
  const pending = await json('/v1/agents/worker/messages/inbox', { headers: auth(worker.token) });
  assert(pending.body.data.messages.length === 2 && pending.body.data.agent_stopped === undefined, `own pending ${pending.body.data.messages.length}`);
});

await test('5e. A second start answers ok and changes nothing', async () => {
  const r = await start(owner.token, 'worker');
  assert(r.status === 200 && r.body.data.changed === false && r.body.data.released === 0, `second start ${JSON.stringify(r.body.data)}`);
});

await test('5f. A started agent is woken again: a new task is pushed, and the schedule runs', async () => {
  const r = await createTask(owner.token, 'worker', 'After the start');
  assert(r.status === 201 && r.body.data.task.status === 'active', `create ${r.status}: ${r.body?.data?.task?.status}`);
  const d = await tunnel.waitForDeliver(1000);
  assert(d?.kind === 'task_assigned' && (d.payload as any)?.id === r.body.data.task.id, `deliver ${d?.kind}`);
  const run = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(owner.token) });
  assert(run.body.data.outcome === 'created', `trigger after start: ${JSON.stringify(run.body.data)}`);
  await tunnel.close();
});

await test('5g. A task that needs the owner\'s OK for another reason goes on waiting after the start', async () => {
  const set = await json('/v1/agents/worker/task-start', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ task_start: 'confirm' }) });
  assert(set.status === 200, `task-start ${set.status}`);
  assert((await stop(owner.token, 'worker')).status === 200, 'stopped again');
  const made = await createTask(owner.token, 'worker', 'Needs an OK anyway');
  assert(made.body.data.task.status === 'queued' && made.body.data.start.waits_because === 'stopped', `create ${JSON.stringify(made.body.data.start)}`);
  const r = await start(owner.token, 'worker');
  assert(r.status === 200 && r.body.data.released === 0, `released ${r.body.data.released}`);
  assert((await taskOf(owner.token, 'worker', made.body.data.task.id)).status === 'queued', 'it still waits for the owner');
  // And now the owner can start it, because the agent is running.
  const ok = await json(`/v1/agents/worker/tasks/${made.body.data.task.id}/start`, { method: 'POST', headers: auth(owner.token) });
  assert(ok.status === 200, `owner start after the agent started ${ok.status}: ${JSON.stringify(ok.body.error)}`);
});

console.log('\n6. The same over MCP, as the person\'s chat AI');
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
  const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'agent stop e2e', redirect_uris: [] }) });
  const ts = new Date().toISOString();
  const pkce = mcpPkce(BASE);
  const params = new URLSearchParams({
    response_type: 'code', client_id: client.body.client_id, gaii: agent.gaii,
    signature: await signMsg(agent.priv, agent.gaii + NODE_ID + ts), timestamp: ts,
    ...authorizeParams(pkce),
  });
  const authz = await json(`/v1/mcp/authorize?${params}`);
  const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret, ...tokenParams(pkce) }) });
  assert(tok.status === 200, `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);
  const s: McpSession = { token: tok.body.access_token, sessionId: '', nextId: 1 };
  await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agent stop e2e', version: '1.0.0' } });
  await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}`, 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return s;
}

let chatMcp!: McpSession;
await test('6a. The chat AI stops the worker with aimeat_agent_stop, and the roster it reads says so', async () => {
  chatMcp = await mcpSessionFor(chat);
  const r = await callTool(chatMcp, 'aimeat_agent_stop', { target_agent_name: 'worker' });
  assert(!r.isError, `stop over MCP: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.stopped === true && d.changed === true && d.stopped_by === chat.gaii, `answer ${r.text}`);
  const roster = await callTool(chatMcp, 'aimeat_agents_list', {});
  const row = (JSON.parse(roster.text).agents ?? []).find((a: any) => a.name === 'worker');
  assert(row?.stopped === true && row?.stopped_by === chat.gaii, `roster row ${JSON.stringify({ s: row?.stopped, by: row?.stopped_by })}`);
});

await test('6b. Over MCP it cannot stop itself, and a task for the stopped worker is said to wait', async () => {
  const self = await callTool(chatMcp, 'aimeat_agent_stop', { target_agent_name: 'chatai' });
  assert(self.isError && /ACCESS_DENIED/.test(self.text), `self stop over MCP: ${self.text}`);
  const made = await callTool(chatMcp, 'aimeat_task_create', { target_agent: 'worker', title: 'Over MCP while stopped', description: 'Over MCP while stopped' });
  assert(!made.isError, `create over MCP: ${made.text}`);
  assert(/"waits_because":\s*"stopped"/.test(made.text), `the answer names the reason: ${made.text.slice(0, 400)}`);
});

await test('6c. An agent without agent:write is not offered the two tools', async () => {
  const plainMcp = await mcpSessionFor(plain);
  const list = await rpc(plainMcp, 'tools/list');
  const names = (list?.result?.tools ?? []).map((t: any) => t.name);
  assert(names.length > 0, 'the plain agent has tools');
  assert(!names.includes('aimeat_agent_stop') && !names.includes('aimeat_agent_start'), 'stop and start are not on its list');
  const r = await callTool(plainMcp, 'aimeat_agent_start', { target_agent_name: 'worker' });
  assert(r.isError, `a call anyway is refused: ${r.text.slice(0, 200)}`);
  assert((await listed(owner.token, 'worker')).stopped === true, 'still stopped');
});

await test('6d. The chat AI starts it with aimeat_agent_start', async () => {
  const r = await callTool(chatMcp, 'aimeat_agent_start', { target_agent_name: 'worker' });
  assert(!r.isError, `start over MCP: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.stopped === false && d.changed === true && typeof d.released === 'number', `answer ${r.text}`);
  assert((await listed(owner.token, 'worker')).stopped === false, 'running again');
});

console.log('\nCleanup');
await test('Cascade-delete both owners', async () => {
  await sleep(50);
  for (const o of [owner, other]) {
    const { status } = await json(`/v1/owners/${encodeURIComponent(o.name)}`, { method: 'DELETE', headers: auth(o.token) });
    assert(status === 200, `delete ${o.name}: ${status}`);
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Stop and Start E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

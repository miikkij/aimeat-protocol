/**
 * @file e2e-goals.ts
 * @description E2E for agent goals (services/goals/, routes/goals.ts): a goal given to an owner's agents,
 *   open work two agents race for (the first takes it, the second is told), a skill an agent lacks, the
 *   task a taken work becomes and its completion moving the goal on, a reaction that starts the next work
 *   for a named agent, the goal done when every work is, a person's choose step answered by the owner and
 *   refused to an agent that is not the person's own AI, an agent leaving the next work and the chain
 *   limit turning it into an approve step, a rejected result asked again with its reason, pause refusing
 *   a take, and the refusals: another owner, another owner's agent, no token, and a memory route writing
 *   the service-owned key; an agent without task:write on every write route and without task:read on
 *   the reads; and the four MCP tools driven by the owner's AI, with another owner's agent refused; a
 *   work the node's model does (against a local OpenAI-compatible stand-in), the spending limit
 *   holding it, and a goal the owner's AI proposes, which only the person approves.
 * @version-history
 *   v1.2.0 — 2026-10-25 — Tests 20 to 22: the node's model as a worker, its limit, and a proposal.
 *   v1.1.0 — 2026-10-25 — Tests 18 and 19: the scope refusal on every route, and the MCP tools.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=goals

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent as scopedAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson } from './helpers/fake-ai-provider.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function agentToken(gaii: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(privKey, 'base64'));
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

interface Agent { name: string; gaii: string; token: string }
async function makeAgent(ownerToken: string, owner: string, name: string, tags: string[], mode?: string): Promise<Agent> {
  const r = await json('/v1/agents', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], scopes: ['task:read', 'task:write', 'memory:read', 'memory:write'], ...(mode ? { mode } : {}) }) });
  assert(r.status === 201, `agent ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
  const gaii = r.body.data.agent.gaii;
  const token = await agentToken(gaii, r.body.data.private_key);
  const t = await json(`/v1/agents/${name}/tags`, { method: 'PATCH', headers: auth(ownerToken), body: JSON.stringify({ tags }) });
  assert(t.status === 200, `tags ${name}: ${t.status} ${JSON.stringify(t.body.error)}`);
  return { name, gaii, token };
}

async function readGoal(token: string, id: string) {
  const r = await json(`/v1/goals/${id}`, { headers: auth(token) });
  assert(r.status === 200, `read goal: ${r.status} ${JSON.stringify(r.body.error)}`);
  return r.body.data.goal;
}

/** Start a taken work's task as the owner (an interactive agent's task waits for it) and complete it as the agent. */
async function finish(ownerToken: string, agent: Agent, taskId: string, message: string) {
  const s = await json(`/v1/agents/${agent.name}/tasks/${taskId}/start`, { method: 'POST', headers: auth(ownerToken), body: '{}' });
  assert(s.status === 200, `start ${taskId}: ${s.status} ${JSON.stringify(s.body.error)}`);
  const c = await json(`/v1/agents/${agent.name}/tasks/${taskId}/complete`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ message }) });
  assert(c.status === 200, `complete ${taskId}: ${c.status} ${JSON.stringify(c.body.error)}`);
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

console.log('\n=== AIMEAT Agent Goals E2E ===\n');

const ownerA = `goalowner${Date.now()}`;
const ownerB = `goalother${Date.now()}`;
let tokenA = '';
let tokenB = '';
let ownerAObj: { name: string; token: string };
let aiSession: McpSession;
let ownAiToken = '';
let grok1: Agent; let grok2: Agent; let writer: Agent; let chat: Agent; let otherAgent: Agent;
let goalId = '';
let w1 = ''; let w2 = ''; let w3 = '';
let task1 = ''; let task2 = ''; let task3 = '';

await test('setup: two owners, three working agents, the owner\'s own AI, and another owner\'s agent', async () => {
  tokenA = (await registerOwner(BASE, ownerA)).token;
  ownerAObj = { name: ownerA, token: tokenA };
  tokenB = (await registerOwner(BASE, ownerB)).token;
  grok1 = await makeAgent(tokenA, ownerA, 'grok1', ['tutkimus']);
  grok2 = await makeAgent(tokenA, ownerA, 'grok2', ['tutkimus']);
  writer = await makeAgent(tokenA, ownerA, 'writer', ['kirjoittaminen']);
  chat = await makeAgent(tokenA, ownerA, 'chat', [], 'workstation');
  otherAgent = await makeAgent(tokenB, ownerB, 'grokx', ['tutkimus']);
  assert(otherAgent.gaii.includes(ownerB) && grok1.gaii.includes(ownerA), 'each agent belongs to its own owner');
});

console.log('\nOpen work, the race to take it, and the chain');

await test('1. the owner gives a goal: three open works for a skill, and a reaction for the writer', async () => {
  const r = await json('/v1/goals', {
    method: 'POST', headers: auth(tokenA),
    body: JSON.stringify({
      statement: 'Find out our three biggest competitors and write a comparison by Monday.',
      skills: ['tutkimus', 'kirjoittaminen'],
      works: [
        { title: 'Research competitor A', wants: ['tutkimus'] },
        { title: 'Research competitor B', wants: ['tutkimus'] },
        { title: 'Research competitor C', wants: ['tutkimus'] },
      ],
      reactions: [{ when: { wants: 'tutkimus' }, then: { title: 'Write the comparison', agent: 'writer' } }],
      reason: 'test',
    }),
  });
  assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
  const g = r.body.data.goal;
  goalId = g.id;
  assert(g.works.length === 3 && g.works.every((w: any) => w.status === 'open'), `three open works: ${JSON.stringify(g.works.map((w: any) => w.status))}`);
  [w1, w2, w3] = g.works.map((w: any) => w.id);
  assert(g.log.some((e: any) => e.kind === 'offered'), 'the open work was offered');
});

await test('2. an agent with the skill sees the three works as available', async () => {
  const r = await json('/v1/goals/available', { headers: auth(grok1.token) });
  assert(r.status === 200, `available: ${r.status}`);
  assert(r.body.data.works.filter((w: any) => w.goal_id === goalId).length === 3, `three: ${JSON.stringify(r.body.data.works)}`);
  const none = await json('/v1/goals/available', { headers: auth(writer.token) });
  assert(none.body.data.works.filter((w: any) => w.goal_id === goalId).length === 0, 'the writer, without the skill, sees none');
});

await test('3. the first agent to take a work gets the task; the second is told it is taken', async () => {
  const first = await json(`/v1/goals/${goalId}/works/${w1}/actions/claim`, { method: 'POST', headers: auth(grok1.token), body: '{}' });
  assert(first.status === 200, `grok1 claim: ${first.status} ${JSON.stringify(first.body.error)}`);
  task1 = first.body.data.task_id;
  assert(typeof task1 === 'string' && task1.length > 10, 'a task id');
  const second = await json(`/v1/goals/${goalId}/works/${w1}/actions/claim`, { method: 'POST', headers: auth(grok2.token), body: '{}' });
  assert(second.status === 409 && second.body.error.code === 'CONFLICT', `grok2 claim: ${second.status} ${JSON.stringify(second.body.error)}`);
});

await test('4. an agent without the skill may not take the work', async () => {
  const r = await json(`/v1/goals/${goalId}/works/${w2}/actions/claim`, { method: 'POST', headers: auth(writer.token), body: '{}' });
  assert(r.status === 403, `writer claim: ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('5. the task carries the goal, and a taken work names its task and taker', async () => {
  const t = await json(`/v1/agents/grok1/tasks/${task1}`, { headers: auth(tokenA) });
  assert(t.status === 200, `task: ${t.status}`);
  assert(String(t.body.data.task.description).includes('Find out our three biggest competitors'), 'the task describes the goal');
  const g = await readGoal(tokenA, goalId);
  const w = g.works.find((x: any) => x.id === w1);
  assert(w.status === 'claimed' && w.claimed_by === 'grok1' && w.task_id === task1, `work: ${JSON.stringify(w)}`);
});

await test('6. completing the three research tasks starts the writer\'s work by the reaction', async () => {
  const two = await json(`/v1/goals/${goalId}/works/${w2}/actions/claim`, { method: 'POST', headers: auth(grok2.token), body: '{}' });
  assert(two.status === 200, `grok2 claim w2: ${two.status} ${JSON.stringify(two.body.error)}`);
  task2 = two.body.data.task_id;
  const three = await json(`/v1/goals/${goalId}/works/${w3}/actions/claim`, { method: 'POST', headers: auth(grok1.token), body: '{}' });
  assert(three.status === 200, `grok1 claim w3: ${three.status} ${JSON.stringify(three.body.error)}`);
  task3 = three.body.data.task_id;
  await finish(tokenA, grok1, task1, 'Competitor A: six findings.');
  await finish(tokenA, grok2, task2, 'Competitor B: seven findings.');
  await finish(tokenA, grok1, task3, 'Competitor C: two product lines.');
  const g = await waitFor('the writer\'s work', async () => {
    const goal = await readGoal(tokenA, goalId);
    return goal.works.find((w: any) => w.agent === 'writer' && w.status === 'claimed') ? goal : null;
  });
  const writing = g.works.find((w: any) => w.agent === 'writer');
  assert(writing.hop === 1, `the next work is one hop on: ${writing.hop}`);
  assert(g.works.filter((w: any) => w.status === 'done').length === 3, 'three works done');
  assert(g.works.find((w: any) => w.id === w1).result.summary.includes('six findings'), 'the result is kept');
  const task = await json(`/v1/agents/writer/tasks/${writing.task_id}`, { headers: auth(tokenA) });
  assert(String(task.body.data.task.description).includes('six findings'), 'the writer\'s task carries the results it builds on');
});

await test('7. the writer finishing makes the goal done', async () => {
  const g0 = await readGoal(tokenA, goalId);
  const writing = g0.works.find((w: any) => w.agent === 'writer');
  await finish(tokenA, writer, writing.task_id, 'The comparison is written.');
  const g = await waitFor('the goal done', async () => { const goal = await readGoal(tokenA, goalId); return goal.status === 'done' ? goal : null; });
  assert(g.log.some((e: any) => e.kind === 'finished'), 'the log says it finished');
});

console.log('\nA person\'s step');

let stepGoal = ''; let stepWork = '';
await test('8. a choose step waits for the person and is listed as waiting', async () => {
  const r = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({
    statement: 'Pick the threads to post in today.',
    works: [{ title: 'Choose the threads', kind: 'human', human_kind: 'choose', multiple: true, options: [{ id: 't1', label: 'Thread one' }, { id: 't2', label: 'Thread two' }] }],
  }) });
  assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
  stepGoal = r.body.data.goal.id;
  stepWork = r.body.data.goal.works[0].id;
  const w = await json('/v1/goals/waiting', { headers: auth(tokenA) });
  assert(w.body.data.waiting.some((i: any) => i.goal_id === stepGoal && i.work.id === stepWork), 'listed as waiting');
});

await test('9. an agent that is not the person\'s own AI may not answer it', async () => {
  const r = await json(`/v1/goals/${stepGoal}/works/${stepWork}/answer`, { method: 'POST', headers: auth(grok1.token), body: JSON.stringify({ options: ['t1'] }) });
  assert(r.status === 403, `grok1 answer: ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('10. the person\'s own AI answers it for them, and an unknown option is refused first', async () => {
  const bad = await json(`/v1/goals/${stepGoal}/works/${stepWork}/answer`, { method: 'POST', headers: auth(chat.token), body: JSON.stringify({ options: ['t9'] }) });
  assert(bad.status === 400, `unknown option: ${bad.status}`);
  const r = await json(`/v1/goals/${stepGoal}/works/${stepWork}/answer`, { method: 'POST', headers: auth(chat.token), body: JSON.stringify({ options: ['t1', 't2'] }) });
  assert(r.status === 200, `chat answer: ${r.status} ${JSON.stringify(r.body.error)}`);
  const w = r.body.data.goal.works[0];
  assert(w.status === 'done' && JSON.stringify(w.result.answer.options) === '["t1","t2"]', `answered: ${JSON.stringify(w)}`);
  assert(r.body.data.goal.status === 'done', 'the goal of one step is done');
});

console.log('\nLeaving the next work, the chain limit, asking again');

let chainGoal = '';
await test('11. an agent leaves the next work; it may not hand work to itself', async () => {
  const r = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({
    statement: 'Research and then analyse.', limits: { hops: 1 }, done_kind: 'human', done_when: 'The owner approves',
    works: [{ title: 'Research', agent: 'grok1' }],
  }) });
  assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
  chainGoal = r.body.data.goal.id;
  const g = await waitFor('the named work taken', async () => { const goal = await readGoal(tokenA, chainGoal); return goal.works[0].status === 'claimed' ? goal : null; });
  await finish(tokenA, grok1, g.works[0].task_id, 'Report written.');
  const self = await json(`/v1/goals/${chainGoal}/works`, { method: 'POST', headers: auth(grok1.token), body: JSON.stringify({ action: 'leave', work: { title: 'Analyse', agent: 'grok1' } }) });
  assert(self.status === 400, `to itself: ${self.status}`);
  const left = await json(`/v1/goals/${chainGoal}/works`, { method: 'POST', headers: auth(grok1.token), body: JSON.stringify({ action: 'leave', work: { title: 'Analyse the report', agent: 'writer' } }) });
  assert(left.status === 201, `leave: ${left.status} ${JSON.stringify(left.body.error)}`);
  const next = left.body.data.goal.works.find((w: any) => w.title === 'Analyse the report');
  assert(next && next.hop === 1 && next.origin.agent === 'grok1', `one hop on: ${JSON.stringify(next)}`);
});

await test('12. past the chain limit the next work waits for the owner\'s yes, and the yes starts it', async () => {
  const g0 = await waitFor('the writer took it', async () => { const goal = await readGoal(tokenA, chainGoal); const w = goal.works.find((x: any) => x.title === 'Analyse the report'); return w?.status === 'claimed' ? goal : null; });
  const analysing = g0.works.find((w: any) => w.title === 'Analyse the report');
  await finish(tokenA, writer, analysing.task_id, 'Analysis done.');
  const left = await json(`/v1/goals/${chainGoal}/works`, { method: 'POST', headers: auth(writer.token), body: JSON.stringify({ action: 'leave', work: { title: 'Draft posts', agent: 'grok2' } }) });
  assert(left.status === 201, `leave: ${left.status} ${JSON.stringify(left.body.error)}`);
  const step = left.body.data.goal.works.find((w: any) => w.kind === 'human' && w.human_kind === 'approve' && w.held);
  assert(step && step.held.title === 'Draft posts', `an approve step holds it: ${JSON.stringify(left.body.data.goal.works.map((w: any) => [w.title, w.kind]))}`);
  assert(!left.body.data.goal.works.some((w: any) => w.title === 'Draft posts'), 'the work itself is not made yet');
  const yes = await json(`/v1/goals/${chainGoal}/works/${step.id}/answer`, { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ approve: true }) });
  assert(yes.status === 200, `approve: ${yes.status} ${JSON.stringify(yes.body.error)}`);
  assert(yes.body.data.goal.works.some((w: any) => w.title === 'Draft posts'), 'the held work starts');
});

await test('13. the owner asks a finished result again with a reason, and the new work carries it', async () => {
  const g = await readGoal(tokenA, chainGoal);
  const done = g.works.find((w: any) => w.title === 'Research');
  const noReason = await json(`/v1/goals/${chainGoal}/works/${done.id}/actions/reject`, { method: 'POST', headers: auth(tokenA), body: '{}' });
  assert(noReason.status === 400, `no reason: ${noReason.status}`);
  const r = await json(`/v1/goals/${chainGoal}/works/${done.id}/actions/reject`, { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ reason: 'The prices are from last year.' }) });
  assert(r.status === 200, `reject: ${r.status} ${JSON.stringify(r.body.error)}`);
  const retry = r.body.data.goal.works.find((w: any) => w.retry_of === done.id);
  assert(retry && retry.reason === 'The prices are from last year.', `retry: ${JSON.stringify(retry)}`);
  assert(r.body.data.goal.works.find((w: any) => w.id === done.id).status === 'declined', 'the old result is marked asked again');
});

await test('14. a paused goal refuses a take; resumed, it moves again', async () => {
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Paused test', works: [{ title: 'Open', wants: ['tutkimus'] }] }) });
  const id = c.body.data.goal.id; const wid = c.body.data.goal.works[0].id;
  const p = await json(`/v1/goals/${id}/actions/pause`, { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ reason: 'tomorrow' }) });
  assert(p.status === 200 && p.body.data.goal.status === 'paused', `pause: ${p.status}`);
  const take = await json(`/v1/goals/${id}/works/${wid}/actions/claim`, { method: 'POST', headers: auth(grok2.token), body: '{}' });
  assert(take.status === 409, `take while paused: ${take.status}`);
  const r = await json(`/v1/goals/${id}/actions/resume`, { method: 'POST', headers: auth(tokenA), body: '{}' });
  assert(r.status === 200 && r.body.data.goal.status === 'active', `resume: ${r.status}`);
  const s = await json(`/v1/goals/${id}/actions/stop`, { method: 'POST', headers: auth(tokenA), body: '{}' });
  assert(s.status === 200 && s.body.data.goal.status === 'stopped', `stop: ${s.status}`);
});

await test('15. the preview names what an update would end before it ends it', async () => {
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Preview test', agents: ['grok1', 'grok2'], works: [{ title: 'Taken', wants: ['tutkimus'] }] }) });
  const id = c.body.data.goal.id; const wid = c.body.data.goal.works[0].id;
  const take = await json(`/v1/goals/${id}/works/${wid}/actions/claim`, { method: 'POST', headers: auth(grok2.token), body: '{}' });
  assert(take.status === 200, `take: ${take.status} ${JSON.stringify(take.body.error)}`);
  const pv = await json(`/v1/goals/${id}`, { method: 'PATCH', headers: auth(tokenA), body: JSON.stringify({ agents: ['grok1'], preview: true }) });
  assert(pv.status === 200 && pv.body.data.preview.ends.some((e: any) => e.work === wid && e.agent === 'grok2'), `preview: ${JSON.stringify(pv.body)}`);
  const after = await readGoal(tokenA, id);
  assert(after.works[0].status === 'claimed', 'the preview changed nothing');
});

console.log('\nRefusals');

await test('16. another owner cannot read the goal, and another owner\'s agent cannot take its work', async () => {
  const r = await json(`/v1/goals/${goalId}`, { headers: auth(tokenB) });
  assert(r.status === 404, `owner B read: ${r.status}`);
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Cross-owner test', any_agent: true, works: [{ title: 'Open to any', wants: ['tutkimus'] }] }) });
  const id = c.body.data.goal.id; const wid = c.body.data.goal.works[0].id;
  const take = await json(`/v1/goals/${id}/works/${wid}/actions/claim`, { method: 'POST', headers: auth(otherAgent.token), body: '{}' });
  assert(take.status === 404, `owner B's agent take: ${take.status} ${JSON.stringify(take.body.error)}`);
  const list = await json('/v1/goals/available', { headers: auth(otherAgent.token) });
  assert(!list.body.data.works.some((w: any) => w.goal_id === id), 'owner B\'s agent does not see it');
});

await test('17. no token is refused, and no memory route writes a goal record', async () => {
  const r = await json('/v1/goals');
  assert(r.status === 401, `no token: ${r.status}`);
  const w = await json('/v1/memory', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ key: `agent-goals.${goalId}`, value: { type: 'aimeat.goal', status: 'active' } }) });
  assert(w.status === 403, `memory write of the goal: ${w.status} ${JSON.stringify(w.body.error)}`);
  const still = await readGoal(tokenA, goalId);
  assert(still.status === 'done', 'the goal is unchanged');
});

await test('18. an agent of the owner without task:write is refused by every write route, and one without task:read by the reads', async () => {
  const readOnly = await scopedAgent(BASE, ownerAObj, ['task:read']);
  const noTask = await scopedAgent(BASE, ownerAObj, ['memory:read']);
  const h = auth(readOnly.token);
  const create = await json('/v1/goals', { method: 'POST', headers: h, body: JSON.stringify({ statement: 'Not allowed' }) });
  assert(create.status === 403, `create without task:write: ${create.status}`);
  const patch = await json(`/v1/goals/${goalId}`, { method: 'PATCH', headers: h, body: JSON.stringify({ title: 'Not allowed' }) });
  assert(patch.status === 403, `update without task:write: ${patch.status}`);
  const del = await json(`/v1/goals/${goalId}`, { method: 'DELETE', headers: h });
  assert(del.status === 403, `delete without task:write: ${del.status}`);
  const pause = await json(`/v1/goals/${goalId}/actions/pause`, { method: 'POST', headers: h, body: '{}' });
  assert(pause.status === 403, `pause without task:write: ${pause.status}`);
  const material = await json(`/v1/goals/${goalId}/material`, { method: 'POST', headers: h, body: JSON.stringify({ kind: 'text', ref: 'x' }) });
  assert(material.status === 403, `material without task:write: ${material.status}`);
  const leave = await json(`/v1/goals/${goalId}/works`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'leave', title: 'x' }) });
  assert(leave.status === 403, `leave work without task:write: ${leave.status}`);
  const waiting = await json('/v1/goals/waiting', { headers: auth(noTask.token) });
  assert(waiting.status === 403, `waiting without task:read: ${waiting.status}`);
  const available = await json('/v1/goals/available', { headers: auth(noTask.token) });
  assert(available.status === 403, `available without task:read: ${available.status}`);
  const still = await readGoal(tokenA, goalId);
  assert(still.status === 'done' && still.title !== 'Not allowed', 'nothing changed');
});

await test('19. the four MCP tools: the owner\'s AI makes, reads, moves and answers a goal; another owner\'s agent is refused', async () => {
  // The owner's own AI in a conversation: a workstation agent. It writes the person's question when it
  // makes the goal, and answers it when the person tells it.
  const ai = await scopedAgent(BASE, ownerAObj, ['task:read', 'task:write']);
  const ws = await json(`/v1/agents/${ai.name}/mode`, { method: 'PATCH', headers: auth(tokenA), body: JSON.stringify({ mode: 'workstation' }) });
  assert(ws.status === 200, `workstation mode: ${ws.status} ${JSON.stringify(ws.body.error)}`);
  const s = await openSession(BASE, ai.token, 'e2e-goals');
  aiSession = s;
  ownAiToken = ai.token;
  const made = await callTool(s, 'aimeat_goal_set', { action: 'create', reason: 'MCP test', input: {
    statement: 'Tell the owner which day suits a meeting.',
    works: [{ title: 'Which day?', kind: 'human', human_kind: 'choose', options: [{ id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }] }, { title: 'Book it', wants: ['tutkimus'] }],
  } });
  assert(!made.isError, `aimeat_goal_set create: ${made.text}`);
  const id = made.data.goal?.id ?? made.data.data?.goal?.id;
  assert(typeof id === 'string', `a goal id: ${made.text.slice(0, 300)}`);
  const got = await callTool(s, 'aimeat_goal_get', { goal_id: id });
  assert(!got.isError && JSON.stringify(got.data).includes('Which day?'), `aimeat_goal_get: ${got.text.slice(0, 300)}`);
  const goal = got.data.goal ?? got.data.data?.goal;
  const step = goal.works.find((w: any) => w.kind === 'human');
  const open = goal.works.find((w: any) => w.kind === 'agent');
  const avail = await callTool(s, 'aimeat_goal_work', { action: 'available' });
  assert(!avail.isError, `aimeat_goal_work available: ${avail.text.slice(0, 300)}`);
  const answered = await callTool(s, 'aimeat_goal_answer', { goal_id: id, work_id: step.id, option: 'tue' });
  assert(!answered.isError, `aimeat_goal_answer: ${answered.text.slice(0, 300)}`);
  const after = await readGoal(tokenA, id);
  assert(after.works.find((w: any) => w.id === step.id).status === 'done', 'the step is answered');
  const other = await openSession(BASE, otherAgent.token, 'e2e-goals-other');
  const refused = await callTool(other, 'aimeat_goal_work', { action: 'claim', goal_id: id, work_id: open.id });
  assert(refused.isError, `another owner's agent may not take the work: ${refused.text.slice(0, 200)}`);
  const still = await readGoal(tokenA, id);
  assert(still.works.find((w: any) => w.id === open.id).status !== 'claimed', 'the work was not taken');
  // Once the same AI works in a goal, a question it leaves while working is the person's to answer.
  // The goal's fields at the top level, as REST takes them (the first goal above sent them in `input`).
  const g2 = await callTool(s, 'aimeat_goal_set', { action: 'create', reason: 'MCP test', statement: 'Work done by the AI itself.', works: [{ title: 'Do it', agent: ai.name }] });
  assert(!g2.isError, `aimeat_goal_set with top-level fields: ${g2.text.slice(0, 200)}`);
  const id2 = g2.data.goal?.id ?? g2.data.data?.goal?.id;
  const w0 = (await readGoal(tokenA, id2)).works[0];
  assert(w0.status === 'claimed' && w0.claimed_by === ai.name, `a work named for the AI is given to it: ${JSON.stringify(w0).slice(0, 200)}`);
  const left = await callTool(s, 'aimeat_goal_work', { action: 'leave', goal_id: id2, title: 'Is this right?', kind: 'human', human_kind: 'answer' });
  assert(!left.isError, `the AI leaves a question: ${left.text.slice(0, 200)}`);
  const q = (await readGoal(tokenA, id2)).works.find((w: any) => w.kind === 'human');
  const self = await callTool(s, 'aimeat_goal_answer', { goal_id: id2, work_id: q.id, text: 'Yes' });
  assert(self.isError && /FORBIDDEN/.test(self.text), `an agent working in the goal may not answer its own question: ${self.text.slice(0, 200)}`);
});

console.log('\nThe node\'s model, and a proposal');

// The owner's model calls go to a local OpenAI-compatible stand-in; nothing inside the node is mocked.
const provider = await startFakeAiProvider(0);
provider.setDefault('chat', chatJson('Kilpailija A on halvin, B nopein ja C laajin.'));

await test('20. a work for the node\'s model runs with the owner\'s key, and its answer and cost land in the goal', async () => {
  const s = await json('/v1/memory', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: provider.baseUrl, model: 'stub/test-model', daily_budget_usd: 5 } }) });
  assert(s.status === 201, `settings: ${s.status} ${JSON.stringify(s.body.error)}`);
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Vertaa kolmea kilpailijaa hinnan mukaan.', limits: { usd: 5 }, works: [{ title: 'Kirjoita vertailu', runner: 'model' }] }) });
  assert(c.status === 201, `create: ${c.status} ${JSON.stringify(c.body.error)}`);
  const id = c.body.data.goal.id; const wid = c.body.data.goal.works[0].id;
  const done = await waitFor('the model work to finish', async () => {
    const g = await readGoal(tokenA, id);
    const w = g.works.find((x: any) => x.id === wid);
    return w.status === 'done' || w.status === 'failed' ? g : null;
  }, 30_000);
  const w = done.works.find((x: any) => x.id === wid);
  assert(w.status === 'done' && w.claimed_by === 'model' && /halvin/.test(w.result?.summary ?? ''), `the work: ${JSON.stringify({ status: w.status, by: w.claimed_by, result: w.result, reason: w.reason })}`);
  const sent = provider.lastRequest('chat');
  assert(JSON.stringify(sent?.json ?? {}).includes('Vertaa kolmea kilpailijaa'), 'the model was told the goal');
  assert(done.status === 'done', `a goal whose only work is done is done: ${done.status}`);
  const kept = await json(`/v1/memory/goal-results.${id}`, { headers: auth(tokenA) });
  assert(kept.status === 200 && JSON.stringify(kept.body.data).includes('halvin'), `the whole answer is kept: ${kept.status}`);
  const temp = await json(`/v1/memory/goal-runs.${id}.${wid}`, { headers: auth(tokenA) });
  assert(temp.status === 404, `the job's temporary record is gone: ${temp.status}`);
});

await test('21. at the spending limit a model work waits for the owner and the model is not called', async () => {
  provider.reset();
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Kirjoita tiivistelmä ilman rahaa.', limits: { usd: 0 }, works: [{ title: 'Tiivistä', runner: 'model' }] }) });
  assert(c.status === 201, `create: ${c.status} ${JSON.stringify(c.body.error)}`);
  const g = await readGoal(tokenA, c.body.data.goal.id);
  assert(g.works[0].status === 'open' && g.log.some((e: any) => e.kind === 'limit'), `it waits at the limit: ${JSON.stringify({ status: g.works[0].status, log: g.log.map((e: any) => e.kind) })}`);
  await sleep(500);
  assert(provider.requestsFor('chat').length === 0, 'the model was not called');
  const bad = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'x', works: [{ title: 'y', runner: 'model', agent: 'grok1' }] }) });
  assert(bad.status === 400, `a model work naming an agent is refused: ${bad.status}`);
});

await test('22. the owner\'s AI proposes a goal; it waits, only the person approves it, and the AI may decline its own', async () => {
  const p = await callTool(aiSession, 'aimeat_goal_set', { action: 'propose', reason: 'Asked in chat', statement: 'Seuraa päivän MCP-uutisia.', works: [{ title: 'Kerää uutiset', runner: 'model' }] });
  assert(!p.isError, `propose: ${p.text.slice(0, 200)}`);
  const id = p.data.goal?.id ?? p.data.data?.goal?.id;
  const g = await readGoal(tokenA, id);
  assert(g.status === 'proposed' && g.works[0].status === 'open' && !g.works[0].claimed_by, `nothing moves in a proposal: ${JSON.stringify({ status: g.status, work: g.works[0].status })}`);
  const waiting = await json('/v1/goals/waiting', { headers: auth(tokenA) });
  assert(waiting.body.data.waiting.some((x: any) => x.kind === 'proposal' && x.goal_id === id), 'the proposal waits for the person');
  const self = await json(`/v1/goals/${id}/actions/approve`, { method: 'POST', headers: auth(ownAiToken), body: '{}' });
  assert(self.status === 403, `the AI may not approve its own proposal: ${self.status}`);
  const yes = await json(`/v1/goals/${id}/actions/approve`, { method: 'POST', headers: auth(tokenA), body: '{}' });
  assert(yes.status === 200 && yes.body.data.goal.status === 'active', `the person approves: ${yes.status} ${JSON.stringify(yes.body.error)}`);
  const p2 = await callTool(aiSession, 'aimeat_goal_set', { action: 'propose', statement: 'Toinen ehdotus.' });
  const id2 = p2.data.goal?.id ?? p2.data.data?.goal?.id;
  const no = await callTool(aiSession, 'aimeat_goal_set', { action: 'decline', goal_id: id2, reason: 'The person said no' });
  assert(!no.isError, `the AI declines its own proposal: ${no.text.slice(0, 200)}`);
  const gone = await json(`/v1/goals/${id2}`, { headers: auth(tokenA) });
  assert(gone.status === 404, `a declined proposal is gone: ${gone.status}`);
});

await test('23. a model work reads the record an agent\'s earlier work delivered, not only its one-line summary', async () => {
  // aimeat.io, 2026-10-25: web-researcher finished with "deliverable published to memory at …" and the
  // model wrote the summary without the research, because only that sentence reached its prompt.
  provider.reset();
  const c = await json('/v1/goals', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ statement: 'Tutki ja tiivistä.', limits: { usd: 5 }, works: [{ title: 'Tutki', agent: 'grok1' }, { title: 'Tiivistä', runner: 'model', after: ['#1'] }] }) });
  assert(c.status === 201, `create: ${c.status} ${JSON.stringify(c.body.error)}`);
  const id = c.body.data.goal.id;
  const research = await waitFor('the research task', async () => (await readGoal(tokenA, id)).works[0].task_id);
  const key = `crews.grok1.goal-test-${Date.now()}.latest_output`;
  const w = await json('/v1/memory', { method: 'POST', headers: auth(grok1.token), body: JSON.stringify({ key, value: 'TUTKIMUSTULOS: Kilpailija X on halvin.', visibility: 'owner' }) });
  assert(w.status === 201, `the agent writes its deliverable: ${w.status} ${JSON.stringify(w.body.error)}`);
  const s = await json(`/v1/agents/grok1/tasks/${research}/start`, { method: 'POST', headers: auth(tokenA), body: '{}' });
  assert(s.status === 200, `start: ${s.status}`);
  const done = await json(`/v1/agents/grok1/tasks/${research}/complete`, { method: 'POST', headers: auth(grok1.token), body: JSON.stringify({ message: `Crew finished; deliverable published to memory at ${key}.`, deliverable_key: key }) });
  assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body.error)}`);
  await waitFor('the model work to finish', async () => (await readGoal(tokenA, id)).works[1].status === 'done', 30_000);
  const sent = JSON.stringify(provider.lastRequest('chat')?.json ?? {});
  assert(sent.includes('TUTKIMUSTULOS: Kilpailija X on halvin.'), `the model was given the deliverable's text: ${sent.slice(0, 400)}`);
});

await provider.close();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

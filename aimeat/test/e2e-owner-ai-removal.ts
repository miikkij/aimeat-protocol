/**
 * @file test/e2e-owner-ai-removal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's own AI clears away what it set up, over REST and over MCP
 *   (services/agents/remove-agent.ts, services/agents/remove-task.ts, services/agent-task-rules.ts
 *   mayManageSiblingTasks, and the aimeat_skill_delete tool).
 *
 *   Measured on aimeat.io on 2026-11-12: the person's AI had proposed an agent, the person approved
 *   it, one waiting task of that agent kept announcing itself, and the person asked the AI to end
 *   it. The AI could stop the agent and nothing else: no tool removed an agent, read or removed
 *   another agent's task, or removed a skill, although each has a REST route. This suite holds
 *   what the fix promises:
 *     1. another agent of the same owner reads a sibling's task list with task:read and agent:write,
 *        and never without agent:write or from another account;
 *     2. it removes a sibling's task that is not active with task:write and agent:write; an active
 *        task is refused for it as for everybody;
 *     3. an agent removes an agent it registered (a proposal the owner approved) with agent:delete,
 *        and never one somebody else registered, itself, or another account's; the removed agent's
 *        credential stops working, and the schedule somebody else made for it is turned off;
 *     4. a schedule whose agent no longer exists gives it no task and fails with the reason, and a
 *        proposal that asks a permission holding every task of the agent says so;
 *     5. a skill is removed with aimeat_skill_delete, and only the caller's owner's own.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-ai-removal
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial (wish-the-owner-s-ai-can-remove-an-agent-end-its-task-and-delete-a).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
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
interface Owner { name: string; token: string }

async function newOwner(prefix: string): Promise<Owner> {
  const name = `${prefix}${Date.now()}`;
  return { name, token: (await registerOwner(BASE, name)).token };
}
async function newAgent(owner: Owner, name: string, scopes: string[]): Promise<Agent> {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name, owner: owner.name, capabilities: ['tasks'], scopes }),
  });
  assert(status === 201, `agent ${name} ${status}: ${JSON.stringify(body)}`);
  const gaii = body.data.agent.gaii as string;
  return { name, gaii, priv: body.data.private_key, token: await agentToken(gaii, body.data.private_key) };
}
async function createTask(token: string, agent: string, title: string) {
  return json(`/v1/agents/${agent}/tasks`, { method: 'POST', headers: auth(token), body: JSON.stringify({ title, description: title, status: 'queued' }) });
}
async function agentRow(token: string, name: string): Promise<any> {
  const { body } = await json('/v1/agents', { headers: auth(token) });
  return (body?.data?.agents ?? []).find((a: any) => a.name === name);
}
async function ownerTasks(token: string, agent: string): Promise<any[]> {
  const { body } = await json(`/v1/agents/${agent}/tasks?per_page=100`, { headers: auth(token) });
  return body?.data?.tasks ?? [];
}
const HELPER_DEF = {
  readme_md: '# Helper',
  process: 'sequential' as const,
  listen_for: ['tasks'],
  agents: [{ role: 'Reader', goal: 'read', backstory: 'You read.', allow_delegation: false, tools: ['memory'] }],
  tasks: [{ id: 'read', description: 'Read this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Reader' }],
};
/** `proposer` proposes an agent, the owner approves it: the new agent's registeredBy is the proposer. */
async function proposeAndApprove(proposer: Agent, owner: Owner, name: string): Promise<void> {
  const p = await json('/v1/agents/v2/agent-proposals', {
    method: 'POST', headers: auth(proposer.token),
    body: JSON.stringify({ name, purpose: 'Reads the morning notes and lists what is open.', scopes: ['memory:read'], mode: 'task-runner', run_mode: 'spawn', crew_def: HELPER_DEF }),
  });
  assert(p.status === 201, `propose ${name} ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const a = await json(`/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/approve`, { method: 'POST', headers: auth(owner.token) });
  assert(a.status === 200 && a.body.data.created === true, `approve ${name} ${a.status}: ${JSON.stringify(a.body?.error ?? a.body?.data)}`);
}

// ── MCP ──
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
  const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'owner ai removal e2e', redirect_uris: [] }) });
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
  await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'owner ai removal e2e', version: '1.0.0' } });
  await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}`, 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return s;
}

console.log('\n=== AIMEAT The Owner\'s AI Removes What It Set Up E2E ===\n');

const owner = await newOwner('oair');
const other = await newOwner('oairx');
let chat!: Agent, plain!: Agent, worker!: Agent, stranger!: Agent;
let chatMcp!: McpSession, plainMcp!: McpSession, strangerMcp!: McpSession;

console.log('Setup');
await test('Agents: the person\'s AI, a sibling without agent:write, a worker the owner registered, and another account\'s agent', async () => {
  chat = await newAgent(owner, 'chatai', ['task:read', 'task:write', 'agent:read', 'agent:write', 'agent:delete', 'memory:read', 'memory:write', 'exchange:write', 'exchange:invoke']);
  plain = await newAgent(owner, 'plain', ['task:read', 'task:write', 'memory:read', 'memory:write']);
  worker = await newAgent(owner, 'worker', ['memory:read', 'task:read', 'task:write']);
  stranger = await newAgent(other, 'stranger', ['task:read', 'task:write', 'agent:read', 'agent:write', 'agent:delete', 'memory:read', 'memory:write']);
  const set = await json('/v1/agents/worker/task-start', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ task_start: 'confirm' }) });
  assert(set.status === 200, `the worker waits for the owner's OK ${set.status}`);
  chatMcp = await mcpSessionFor(chat);
  plainMcp = await mcpSessionFor(plain);
  strangerMcp = await mcpSessionFor(stranger);
});

console.log('\n1. Another agent\'s task list');
let waitingId = '';
let secondId = '';
await test('1a. The person\'s AI reads the worker\'s waiting task over REST (task:read and agent:write)', async () => {
  const a = await createTask(owner.token, 'worker', 'Sort the inbox');
  const b = await createTask(owner.token, 'worker', 'Second waiting task');
  assert(a.status === 201 && b.status === 201, `tasks ${a.status} ${b.status}`);
  waitingId = a.body.data.task.id; secondId = b.body.data.task.id;
  assert(a.body.data.task.status === 'queued', `it waits: ${a.body.data.task.status}`);
  const r = await json('/v1/agents/worker/tasks?status=queued', { headers: auth(chat.token) });
  assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const ids = (r.body.data.tasks as any[]).map(t => t.id);
  assert(ids.includes(waitingId) && ids.includes(secondId), `both tasks are listed: ${JSON.stringify(ids)}`);
  const whole = await json('/v1/agents/worker/tasks', { headers: auth(chat.token) });
  assert(whole.status === 200 && (whole.body.data.tasks as any[]).some(t => t.id === waitingId), 'the unfiltered list too');
});

await test('1b. FAILURE: a sibling without agent:write is refused, and so is another account\'s agent naming it by full identity', async () => {
  const noWord = await json('/v1/agents/worker/tasks?status=queued', { headers: auth(plain.token) });
  assert(noWord.status === 403, `no agent:write ${noWord.status}`);
  const cross = await json(`/v1/agents/${encodeURIComponent(worker.gaii)}/tasks?status=queued`, { headers: auth(stranger.token) });
  assert(cross.status === 403, `another account ${cross.status}`);
  // By bare name the other account's agent reads inside its own account, where there is no such agent.
  const bare = await json('/v1/agents/worker/tasks?status=queued', { headers: auth(stranger.token) });
  assert(bare.status === 200 && (bare.body.data.tasks as any[]).length === 0, `bare name stays in its own account: ${bare.status} ${bare.body?.data?.tasks?.length}`);
});

await test('1c. Over MCP aimeat_task_list takes target_agent_name, and its own list is as before', async () => {
  const r = await callTool(chatMcp, 'aimeat_task_list', { target_agent_name: 'worker', status: 'queued' });
  assert(!r.isError, `list over MCP: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.agent === 'worker' && (d.tasks as any[]).some(t => t.id === waitingId && t.title === 'Sort the inbox'), `the worker's task: ${r.text.slice(0, 300)}`);
  const own = await callTool(chatMcp, 'aimeat_task_list', {});
  const mine = JSON.parse(own.text);
  assert(!own.isError && mine.agent === undefined && !(mine.tasks as any[]).some((t: any) => t.id === waitingId), 'its own list holds no task of the worker');
});

await test('1d. FAILURE over MCP: no agent:write is SCOPE_DENIED, an unknown agent is NOT_FOUND, another account finds nothing', async () => {
  const noWord = await callTool(plainMcp, 'aimeat_task_list', { target_agent_name: 'worker' });
  assert(noWord.isError && noWord.text.startsWith('SCOPE_DENIED'), `no agent:write: ${noWord.text.slice(0, 160)}`);
  const missing = await callTool(chatMcp, 'aimeat_task_list', { target_agent_name: 'nobody-here' });
  assert(missing.isError && missing.text.startsWith('NOT_FOUND'), `unknown agent: ${missing.text.slice(0, 160)}`);
  const cross = await callTool(strangerMcp, 'aimeat_task_list', { target_agent_name: 'worker' });
  assert(cross.isError && cross.text.startsWith('NOT_FOUND'), `another account: ${cross.text.slice(0, 160)}`);
});

console.log('\n2. Removing another agent\'s task');
await test('2a. FAILURE: a sibling without agent:write and another account\'s agent cannot remove it, and it is still there', async () => {
  const noWord = await json(`/v1/agents/worker/tasks/${waitingId}`, { method: 'DELETE', headers: auth(plain.token) });
  assert(noWord.status === 403, `no agent:write ${noWord.status}`);
  const cross = await json(`/v1/agents/worker/tasks/${waitingId}`, { method: 'DELETE', headers: auth(stranger.token) });
  assert(cross.status === 403, `another account ${cross.status}`);
  const overMcp = await callTool(plainMcp, 'aimeat_task_delete', { task_id: waitingId });
  assert(overMcp.isError && overMcp.text.startsWith('FORBIDDEN'), `no agent:write over MCP: ${overMcp.text.slice(0, 160)}`);
  const crossMcp = await callTool(strangerMcp, 'aimeat_task_delete', { task_id: waitingId });
  assert(crossMcp.isError && crossMcp.text.startsWith('FORBIDDEN'), `another account over MCP: ${crossMcp.text.slice(0, 160)}`);
  assert((await ownerTasks(owner.token, 'worker')).some(t => t.id === waitingId), 'the task is still there');
});

await test('2b. The person\'s AI removes the waiting task over REST, and the owner\'s list no longer has it', async () => {
  const r = await json(`/v1/agents/worker/tasks/${waitingId}`, { method: 'DELETE', headers: auth(chat.token) });
  assert(r.status === 200 && r.body.data.deleted === true, `delete ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const left = await ownerTasks(owner.token, 'worker');
  assert(!left.some(t => t.id === waitingId) && left.some(t => t.id === secondId), 'that task is gone and the other one stays');
  const again = await json(`/v1/agents/worker/tasks/${waitingId}`, { method: 'DELETE', headers: auth(chat.token) });
  assert(again.status === 404, `a second removal finds nothing ${again.status}`);
});

await test('2c. Over MCP aimeat_task_delete removes the other one and says what it was', async () => {
  const r = await callTool(chatMcp, 'aimeat_task_delete', { task_id: secondId });
  assert(!r.isError, `delete over MCP: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.deleted === true && d.agent === 'worker' && d.title === 'Second waiting task' && d.status_was === 'queued', `answer ${r.text}`);
  assert(!(await ownerTasks(owner.token, 'worker')).some(t => t.id === secondId), 'gone from the owner\'s list');
});

await test('2d. FAILURE: a running task is refused with INVALID_STATE for the person\'s AI, as for the owner', async () => {
  const t = await createTask(owner.token, 'worker', 'Already running');
  const id = t.body.data.task.id;
  const go = await json(`/v1/agents/worker/tasks/${id}/start`, { method: 'POST', headers: auth(owner.token) });
  assert(go.status === 200 && go.body.data.task.status === 'active', `started ${go.status}`);
  const r = await callTool(chatMcp, 'aimeat_task_delete', { task_id: id });
  assert(r.isError && r.text.startsWith('INVALID_STATE'), `over MCP: ${r.text.slice(0, 160)}`);
  const rest = await json(`/v1/agents/worker/tasks/${id}`, { method: 'DELETE', headers: auth(owner.token) });
  assert(rest.status === 409 && rest.body.error?.code === 'INVALID_STATE', `the owner ${rest.status}`);
});

console.log('\n3. Removing an agent');
let scheduleId = '';
let helperToken = '';
await test('3a. The person\'s AI proposes two agents, the owner approves them, and the owner gives one a schedule', async () => {
  await proposeAndApprove(chat, owner, 'helper');
  await proposeAndApprove(chat, owner, 'helper-two');
  const row = await agentRow(owner.token, 'helper');
  assert(!!row, 'the helper exists');
  const made = await json('/v1/agents/helper/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      kind: 'agent_task', cron: '0 7 * * *', timezone: 'Europe/Helsinki', display_name: 'Morning notes', purpose: 'removal e2e',
      task_template: { title: 'REMOVAL_OCCURRENCE', description: 'the scheduled run' },
    }),
  });
  assert(made.status === 201 && made.body.data.schedule.enabled !== false, `schedule ${made.status}: ${JSON.stringify(made.body?.error)}`);
  scheduleId = made.body.data.schedule.id;
  // A credential of the helper, to see that it stops working: the owner gives it a new key.
  const helperGaii = `helper#${owner.name}@${NODE_ID}`;
  const key = await json(`/v1/agents/${encodeURIComponent(helperGaii)}/rekey`, { method: 'POST', headers: auth(owner.token) });
  assert(key.status === 200 && !!key.body.data?.private_key, `rekey ${key.status}: ${JSON.stringify(key.body?.error)}`);
  helperToken = await agentToken(helperGaii, key.body.data.private_key);
  const alive = await json('/v1/agents/helper/tasks?status=queued', { headers: auth(helperToken) });
  assert(alive.status === 200, `the helper's credential works before the removal ${alive.status}`);
});

await test('3b. FAILURE: it cannot remove an agent the owner registered, or itself; a sibling without agent:delete and another account cannot remove the helper', async () => {
  const notMine = await json('/v1/agents/worker', { method: 'DELETE', headers: auth(chat.token) });
  assert(notMine.status === 403 && notMine.body.error?.code === 'ACCESS_DENIED', `the owner's worker ${notMine.status} ${notMine.body.error?.code}`);
  const self = await json('/v1/agents/chatai', { method: 'DELETE', headers: auth(chat.token) });
  assert(self.status === 403 && self.body.error?.code === 'ACCESS_DENIED', `itself ${self.status}`);
  const noWord = await json('/v1/agents/helper', { method: 'DELETE', headers: auth(plain.token) });
  assert(noWord.status === 403, `no agent:delete ${noWord.status}`);
  const cross = await json('/v1/agents/helper', { method: 'DELETE', headers: auth(stranger.token) });
  assert(cross.status === 404, `another account finds no such agent ${cross.status}`);
  const overMcp = await callTool(chatMcp, 'aimeat_agent_delete', { target_agent_name: 'worker' });
  assert(overMcp.isError && overMcp.text.startsWith('ACCESS_DENIED'), `the owner's worker over MCP: ${overMcp.text.slice(0, 160)}`);
  const selfMcp = await callTool(chatMcp, 'aimeat_agent_delete', { target_agent_name: 'chatai' });
  assert(selfMcp.isError && selfMcp.text.startsWith('ACCESS_DENIED'), `itself over MCP: ${selfMcp.text.slice(0, 160)}`);
  const plainTry = await callTool(plainMcp, 'aimeat_agent_delete', { target_agent_name: 'helper' });
  assert(plainTry.isError && plainTry.text.startsWith('SCOPE_DENIED'), `no agent:delete over MCP: ${plainTry.text.slice(0, 160)}`);
  const crossMcp = await callTool(strangerMcp, 'aimeat_agent_delete', { target_agent_name: 'helper' });
  assert(crossMcp.isError && crossMcp.text.startsWith('NOT_FOUND'), `another account over MCP: ${crossMcp.text.slice(0, 160)}`);
  assert(!!(await agentRow(owner.token, 'helper')) && !!(await agentRow(owner.token, 'worker')) && !!(await agentRow(owner.token, 'chatai')), 'all three still exist');
});

await test('3c. Over MCP aimeat_agent_delete removes the helper it proposed, and names the schedule it turned off', async () => {
  const r = await callTool(chatMcp, 'aimeat_agent_delete', { target_agent_name: 'helper' });
  assert(!r.isError, `delete over MCP: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.deleted === true && d.name === 'helper' && typeof d.sessions_revoked === 'number', `answer ${r.text.slice(0, 300)}`);
  assert(Array.isArray(d.schedules_turned_off) && d.schedules_turned_off.some((s: any) => s.id === scheduleId && s.display_name === 'Morning notes'), `the schedule is named: ${JSON.stringify(d.schedules_turned_off)}`);
  assert(!(await agentRow(owner.token, 'helper')), 'the helper is gone from the owner\'s list');
  const one = await json(`/v1/schedules/${scheduleId}`, { headers: auth(owner.token) });
  const row = one.body?.data?.schedule;
  assert(one.status === 200 && !!row && row.enabled === false, `the schedule is kept, turned off: ${one.status} ${JSON.stringify(row && { enabled: row.enabled })}`);
});

await test('3d. The removed agent\'s credential no longer works', async () => {
  assert(!!helperToken, 'the helper had a credential');
  const r = await json('/v1/agents/helper/tasks?status=queued', { headers: auth(helperToken) });
  assert(r.status === 401, `the old token is refused ${r.status}`);
});

await test('3e. Over REST the same agent removes the second helper', async () => {
  const r = await json('/v1/agents/helper-two', { method: 'DELETE', headers: auth(chat.token) });
  assert(r.status === 200 && r.body.data.deleted === true && Array.isArray(r.body.data.schedules_turned_off), `delete ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
  assert(!(await agentRow(owner.token, 'helper-two')), 'gone');
});

console.log('\n4. A schedule whose agent is gone');
await test('4a. Turned on again and run, the schedule fails with the reason and makes no task', async () => {
  const on = await json(`/v1/schedules/${scheduleId}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ enabled: true }) });
  assert(on.status === 200, `turn on ${on.status}: ${JSON.stringify(on.body?.error)}`);
  const run = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(owner.token) });
  assert(run.status === 200 && run.body.data.outcome === 'error', `trigger ${run.status}: ${JSON.stringify(run.body?.data ?? run.body?.error)}`);
  assert(/no longer exists/.test(String(run.body.data.reason)), `reason ${run.body.data.reason}`);
  assert(run.body.data.task_id === undefined, 'no task id');
});

console.log('\n4b. A proposal says when every task of the agent would wait');
await test('4b. A proposal asking exchange:write carries the warning TASKS_WAIT_FOR_OWNER; one asking exchange:invoke does not', async () => {
  const propose = (name: string, scopes: string[]) => json('/v1/agents/v2/agent-proposals', {
    method: 'POST', headers: auth(chat.token),
    body: JSON.stringify({ name, purpose: 'Reads the tasks each morning through an app\'s tools.', scopes, crew_def: HELPER_DEF, schedule: '0 7 * * *' }),
  });
  const held = await propose('held-helper', ['memory:read', 'exchange:write']);
  assert(held.status === 201, `propose ${held.status}: ${JSON.stringify(held.body?.error)}`);
  const w = (held.body.data.proposal.warnings ?? []) as any[];
  assert(w.some(x => x.code === 'TASKS_WAIT_FOR_OWNER' && /exchange:write/.test(x.message) && /exchange:invoke/.test(x.message)), `the warning names the permission and the lighter one: ${JSON.stringify(w)}`);
  const free = await propose('free-helper', ['memory:read', 'exchange:invoke']);
  assert(free.status === 201, `propose ${free.status}: ${JSON.stringify(free.body?.error)}`);
  assert(!((free.body.data.proposal.warnings ?? []) as any[]).some(x => x.code === 'TASKS_WAIT_FOR_OWNER'), 'exchange:invoke holds nothing, so no warning');
  for (const p of [held, free]) {
    const d = await json(`/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/decline`, { method: 'POST', headers: auth(owner.token) });
    assert(d.status === 200, `decline ${d.status}`);
  }
});

console.log('\n5. Removing a skill');
const SKILL = (name: string) => `---\nname: ${name}\ndescription: A skill made by the removal suite, to be removed again.\n---\n\n# ${name}\n\nNothing to do.\n`;
await test('5a. The person\'s AI publishes a skill, and another account cannot remove it by name', async () => {
  const pub = await callTool(chatMcp, 'aimeat_skill_publish', { skill_md: SKILL('removal-probe') });
  assert(!pub.isError, `publish: ${pub.text.slice(0, 200)}`);
  const cross = await callTool(strangerMcp, 'aimeat_skill_delete', { name: 'removal-probe' });
  assert(cross.isError && cross.text.startsWith('NOT_FOUND'), `another account: ${cross.text.slice(0, 160)}`);
  const node = await callTool(chatMcp, 'aimeat_skill_delete', { name: 'removal-probe', scope: 'node' });
  assert(node.isError && node.text.startsWith('FORBIDDEN'), `node scope is the operator's: ${node.text.slice(0, 160)}`);
  const ws = await callTool(chatMcp, 'aimeat_skill_delete', { name: 'removal-probe', scope: 'workspace' });
  assert(ws.isError && ws.text.startsWith('INVALID_INPUT'), `a workspace skill needs its workspace: ${ws.text.slice(0, 160)}`);
  const got = await callTool(chatMcp, 'aimeat_skill_get', { name: 'removal-probe', manifest_only: true });
  assert(!got.isError, `the skill is still there: ${got.text.slice(0, 160)}`);
});

await test('5b. aimeat_skill_delete removes it, and a second call finds nothing', async () => {
  const r = await callTool(chatMcp, 'aimeat_skill_delete', { name: 'removal-probe' });
  assert(!r.isError, `delete: ${r.text}`);
  const d = JSON.parse(r.text);
  assert(d.deleted === true && d.name === 'removal-probe' && d.scope === 'user', `answer ${r.text}`);
  const got = await callTool(chatMcp, 'aimeat_skill_get', { name: 'removal-probe', manifest_only: true });
  assert(got.isError, `the skill is gone: ${got.text.slice(0, 160)}`);
  const again = await callTool(chatMcp, 'aimeat_skill_delete', { name: 'removal-probe' });
  assert(again.isError && again.text.startsWith('NOT_FOUND'), `second call: ${again.text.slice(0, 160)}`);
});

console.log('\nCleanup');
await test('Cascade-delete both owners', async () => {
  await new Promise(r => setTimeout(r, 50));
  for (const o of [owner, other]) {
    const { status } = await json(`/v1/owners/${encodeURIComponent(o.name)}`, { method: 'DELETE', headers: auth(o.token) });
    assert(status === 200, `delete ${o.name}: ${status}`);
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`The Owner's AI Removes What It Set Up E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

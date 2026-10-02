/**
 * @file test/e2e-basic-agents-first-task.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent the basic-agents button made finishes its first task, through the real
 *   connector daemon, with the calls the crew runtime makes.
 *
 *   THE CASE. Measured 2026-10-02 on a hosted place (image from main 082689e72): the button made
 *   workflow-manager and the connector took it on, and its first task FAILED. The crew runtime sets
 *   the agent's tags on every start (aimeat_agent_tags_set, PATCH /v1/agents/:name/tags, agent:write),
 *   the template did not grant agent:write, and since aimeat-crewai 0.31.0 the daemon asks the node
 *   after each run which calls it refused and fails a run that has any. The crew did the work; the
 *   task ended as failed.
 *
 *   HOW THIS REPRODUCES IT. The real `aimeat connect serve` daemon takes the agents on, exactly as in
 *   e2e-connect-enrol-loopback. The test then makes the runtime's own node calls for each agent, in
 *   the runtime's order and through the same loopback endpoint the runtime uses
 *   (POST /local/call/<tool> with X-Aimeat-Agent), so each call goes over the agent's own tunnel
 *   with the credential it minted at enrolment:
 *     start-up (crewaimeat run_crew):  aimeat_agent_tags_set; aimeat_memory_write of
 *                                      agents.<name>.readme and of crews.runtime.<name>;
 *     the task (aimeat-crewai daemon):  aimeat_task_list; aimeat_task_propose_todos when it is still
 *                                      queued; aimeat_task_get; aimeat_memory_write of the result;
 *                                      aimeat_task_complete;
 *     after the run:                   GET /v1/agents/<name>/refusals?since=<run start>, the check
 *                                      that turns a refused call into a failed run.
 *   No model is called: what decides this case is which calls the node accepts, not what a model
 *   writes. Before the fix the first tags call answered SCOPE_DENIED and the refusal check found it.
 *
 *   THE FIX IS ON THE NODE, NOT IN THE TEMPLATES (Jouni, 2026-10-02). agent:write also lets an agent
 *   approve a new agent by itself, and the basic agents are kept without it on purpose, so an agent
 *   now sets its OWN tags with no scope (auth/self-or-scope.ts) and a sibling's still need it. An
 *   agent the button made before the fix holds the same scopes as one made after, so this suite
 *   covers both.
 *
 *   Pass criteria, each on the real daemon and the real node:
 *     - every basic agent holds memory:write and neither holds agent:write;
 *     - every start-up call of every basic agent answers ok;
 *     - workflow-manager's first task ends completed, with its result where the completion names it;
 *     - the node recorded no refusal for either agent since the run started;
 *     - the concierge setting workflow-manager's tags is still refused for agent:write;
 *     - an agent a chat proposed with NO scopes, once approved, holds memory:read and memory:write,
 *       reads its own definition, and finishes its first task with nothing refused (hosted defect
 *       2026-10-02, cc7364a8c: memory:write alone, and the agent never started);
 *     - narrowed back to memory:write, the owner's card names memory:read, and giving it lets the
 *       same read through with no restart of the connector.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=basic-agents-first-task
 * @version-history
 *   v1.1.0 — 2026-10-02 — An agent a chat proposed with no scopes, approved, and run to done; the
 *     owner's way out for one approved with memory:write alone.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { nodeEntryArgs } from './helpers/node-entry.js';

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
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** The same node on a loopback address that is not its base URL: the hosted shape. */
function otherLoopbackOf(base: string): string {
  const u = new URL(base);
  u.hostname = u.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
  return u.origin;
}
const LOOPBACK = otherLoopbackOf(BASE);

let daemonBase = '';
let daemonSecret = '';
async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const auth: Record<string, string> = base === daemonBase && daemonSecret ? { Authorization: `Bearer ${daemonSecret}` } : {};
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...auth, ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}

async function tokenFor(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
  const signature = Buffer.from(sig).toString('base64');
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json(BASE, '/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const t = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolveExit(true); });
  });
}

// ─── State ───
const stamp = Date.now();
const home = resolve(process.cwd(), `test/.tmp-basic-first-task-${stamp}`);
const ownerName = `basicfirst${stamp}`;
const firstAgent = 'first-runner';
let ownerToken = '';
let agentToken = '';
let daemon: ChildProcess | null = null;
let daemonOut = '';
const authOwner = () => ({ Authorization: `Bearer ${ownerToken}` });

const statusRows = async (): Promise<any[]> => (await json(daemonBase, '/local/status')).body?.data?.agents ?? [];
async function waitOnline(gaii: string, timeoutMs = 20_000): Promise<any> {
  const start = Date.now();
  let row: any;
  while (Date.now() - start < timeoutMs) {
    row = (await statusRows()).find(a => a.gaii === gaii);
    if (row?.tunnel_status === 'online') return row;
    await sleep(200);
  }
  return row;
}

/** One call as the runtime makes it: the daemon's loopback endpoint, the agent named in the header. */
async function runtimeCall(agent: string, tool: string, input: Record<string, unknown>): Promise<any> {
  const r = await json(daemonBase, `/local/call/${encodeURIComponent(tool)}`, {
    method: 'POST', headers: { 'X-Aimeat-Agent': agent }, body: JSON.stringify(input),
  });
  assert(r.status === 200 && r.body?.ok === true,
    `${agent} ${tool} was refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
  return r.body.data;
}

/** What the node refused this agent since `since`: the check aimeat-crewai 0.31.0 makes after each run. */
async function refusalsSince(agent: string, since: string): Promise<any[]> {
  const r = await json(BASE, `/v1/agents/${encodeURIComponent(agent)}/refusals?since=${encodeURIComponent(since)}`, { headers: authOwner() });
  assert(r.status === 200, `refusals ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return r.body.data.refusals as any[];
}

console.log('\n=== An agent the basic-agents button made finishes its first task ===\n');

await test('setup: an owner, one connected agent, and the connector daemon', async () => {
  const reg = await json(BASE, '/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(reg.status === 201, `owner ${reg.status}: ${JSON.stringify(reg.body)}`);
  ownerToken = await tokenFor(ownerName, reg.body.data.private_key, false);
  const ag = await json(BASE, '/v1/agents', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ name: firstAgent, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
  agentToken = await tokenFor(ag.body.data.agent.gaii, ag.body.data.private_key, true);

  mkdirSync(join(home, 'tokens'), { recursive: true });
  mkdirSync(join(home, 'agents', firstAgent), { recursive: true });
  writeFileSync(join(home, 'tokens', `${firstAgent}@${ownerName}.token`), agentToken, 'utf-8');
  writeFileSync(join(home, 'agents', firstAgent, 'config.yaml'),
    yamlStringify({ agent: firstAgent, owner: ownerName, node_url: LOOPBACK, primary: true }), 'utf-8');

  daemon = spawn('node', [...nodeEntryArgs(), 'connect', 'serve', '--http'], {
    cwd: process.cwd(), env: { ...process.env, AIMEAT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout?.on('data', (d) => { daemonOut += d.toString(); });
  daemon.stderr?.on('data', (d) => { daemonOut += d.toString(); });

  const file = join(home, 'serve.json');
  const start = Date.now();
  let disc: any = null;
  while (!disc && Date.now() - start < 30_000) {
    if (existsSync(file)) { try { disc = JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ } }
    if (!disc) await sleep(150);
  }
  assert(!!disc, `serve.json did not appear\n--- daemon output ---\n${daemonOut}`);
  daemonBase = `http://127.0.0.1:${disc.port}`;
  daemonSecret = disc.secret;
  const row = await waitOnline(`${firstAgent}#${ownerName}@${NODE_ID}`);
  assert(row?.tunnel_status === 'online', `the first agent should be online, got ${JSON.stringify(row)}\n--- daemon output ---\n${daemonOut}`);
});

await test('an agent acting in the owner\'s name cannot press the button itself', async () => {
  // Making agents is the account holder's act in person; this fence is why the basic agents are
  // also kept without agent:write.
  const r = await json(BASE, '/v1/agents/v2/basic-agents', { method: 'POST', headers: { Authorization: `Bearer ${agentToken}` } });
  assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

let basic: Array<{ name: string; tags: string[] }> = [];
await test('the button makes the basic agents and the connector takes each on', async () => {
  const r = await json(BASE, '/v1/agents/v2/basic-agents', { method: 'POST', headers: authOwner() });
  assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const enrolled = (r.body.data.enrolled as Array<{ name: string }>).map(e => e.name);
  assert(enrolled.includes('workflow-manager'), `workflow-manager should be enrolled, got ${JSON.stringify(enrolled)}`);
  const list = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  basic = enrolled.map(name => ({ name, tags: (list.find(a => a.name === name)?.tags ?? []) as string[] }));
  for (const { name } of basic) {
    const row = await waitOnline(`${name}#${ownerName}@${NODE_ID}`);
    assert(row?.tunnel_status === 'online', `${name} should be online, got ${JSON.stringify(row)}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
  }
});

await test('each holds memory:write, and neither holds agent:write', async () => {
  // agent:write would let them approve new agents by themselves (routes/agents/device-auth.ts), and
  // the concierge reads messages from strangers. The runtime's tags call works without it.
  const list = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  for (const { name } of basic) {
    const scopes = (list.find(a => a.name === name)?.default_scopes ?? []) as string[];
    assert(scopes.includes('memory:write'), `${name} should hold memory:write, holds ${JSON.stringify(scopes)}`);
    assert(!scopes.includes('agent:write') && !scopes.includes('*'), `${name} should not hold agent:write, holds ${JSON.stringify(scopes)}`);
  }
});

// The run's window opens before start-up, as in crewaimeat's run_once: a refusal met while the
// runtime pushes the agent's identity belongs to the first task it runs.
const runStart = new Date(Date.now() - 2000).toISOString();

await test('the runtime\'s start-up calls answer ok for every basic agent', async () => {
  assert(basic.length > 0, 'nothing was enrolled');
  for (const { name, tags } of basic) {
    await runtimeCall(name, 'aimeat_agent_tags_set', { target_agent_name: name, tags });
    await runtimeCall(name, 'aimeat_memory_write', { key: `agents.${name}.readme`, value: `# ${name}`, visibility: 'owner' });
    await runtimeCall(name, 'aimeat_memory_write', {
      key: `crews.runtime.${name}`, visibility: 'owner', tags: ['crew-runtime'],
      value: { loadedAt: new Date().toISOString(), ok: true, errors: [], runtime: 'crewaimeat e2e' },
    });
  }
});

const RESULT_KEY = 'agents.workflow-manager.results.first-task';
let taskId = '';
await test('workflow-manager finishes the first task its owner gives it', async () => {
  const created = await json(BASE, '/v1/agents/workflow-manager/tasks', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({
      title: 'First task', description: 'List what this account keeps.', status: 'queued',
      verification: { user_expects: '', technical_checks: [] }, todos: [],
    }),
  });
  assert(created.status === 201, `task create ${created.status}: ${JSON.stringify(created.body?.error)}`);
  taskId = created.body.data.task?.id ?? created.body.data.id;
  assert(!!taskId, `no task id in ${JSON.stringify(created.body.data)}`);

  // The daemon's poll: the task is in its list.
  const listed = await runtimeCall('workflow-manager', 'aimeat_task_list', {});
  const tasks = (listed.tasks ?? listed) as any[];
  const mine = tasks.find(t => t.id === taskId);
  assert(!!mine, `the task should be in the agent's own list, got ${JSON.stringify(tasks.map(t => t.id))}`);

  // PROPOSE when it still waits; a task-runner's task starts on the proposal.
  if (mine.status === 'queued') {
    await runtimeCall('workflow-manager', 'aimeat_task_propose_todos', {
      task_id: taskId, todos: [{ title: 'List what the account keeps', verification: 'A list is written' }],
    });
  }
  const got = await runtimeCall('workflow-manager', 'aimeat_task_get', { task_id: taskId });
  const status = (got.task ?? got).status;
  assert(status === 'active', `the task should be active before the crew runs, got ${status}`);

  // EXECUTE: the crew's result, then the completion that names it.
  await runtimeCall('workflow-manager', 'aimeat_memory_write', { key: RESULT_KEY, value: 'Nothing is kept yet.', visibility: 'owner' });
  await runtimeCall('workflow-manager', 'aimeat_task_complete', { task_id: taskId, message: 'Listed.', deliverable_key: RESULT_KEY });

  const after = await json(BASE, `/v1/agents/workflow-manager/tasks/${taskId}`, { headers: authOwner() });
  const final = after.body.data.task ?? after.body.data;
  assert(final.status === 'done', `the task should be done, got ${final.status}`);
});

await test('and the node refused neither agent anything, so the runtime reports the run as done', async () => {
  for (const { name } of basic) {
    const refused = await refusalsSince(name, runStart);
    assert(refused.length === 0, `${name} was refused: ${JSON.stringify(refused)}`);
  }
});

await test('another agent\'s tags still need agent:write: the concierge cannot retag workflow-manager', async () => {
  // The fence the ruling keeps. Its own record is the only one an agent writes without the word.
  const r = await json(daemonBase, '/local/call/aimeat_agent_tags_set', {
    method: 'POST', headers: { 'X-Aimeat-Agent': 'concierge' },
    body: JSON.stringify({ target_agent_name: 'workflow-manager', tags: ['taken.over'] }),
  });
  assert(r.body?.ok !== true && r.body?.error?.code === 'SCOPE_DENIED',
    `a sibling's tags must be refused, got ${r.status} ${JSON.stringify(r.body)}`);
  const list = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  const tags = (list.find(a => a.name === 'workflow-manager')?.tags ?? []) as string[];
  assert(!tags.includes('taken.over'), `workflow-manager's tags changed: ${JSON.stringify(tags)}`);
});

// ─── An agent a chat proposed, with the smallest scopes ───
//
// Measured 2026-10-02 on a hosted place (cc7364a8c): the chat proposed an agent with memory:write
// only, as the guidance then said, the owner approved it, and its runtime could not read its own
// definition (aimeat_memory_read of crews.registry.<name> needs memory:read). It exited on every
// wake and its first task stayed active. The basic agents above hold memory:read, so they could not
// show it.

const PROPOSED = 'tiny-proposed';
const PROPOSED_DEF = {
  readme_md: '# Tiny', tags: ['crew.proposed'], process: 'sequential' as const, listen_for: ['tasks'],
  agents: [{ role: 'Worker', goal: 'Do the job.', backstory: 'You do the job.', allow_delegation: false, tools: ['memory'] }],
  tasks: [{ id: 'work', description: 'Do this: {{ctx.prompt}}', expected_output: 'A short answer.', agent: 'Worker' }],
};
let proposedStart = '';

await test('a chat proposes an agent asking for NO scopes, and the owner approves it', async () => {
  const p = await json(BASE, '/v1/agents/v2/agent-proposals', {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ name: PROPOSED, purpose: 'Does one small job the owner asks for.', scopes: [], crew_def: PROPOSED_DEF }),
  });
  assert(p.status === 201, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const r = await json(BASE, `/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/approve`, { method: 'POST', headers: authOwner() });
  assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.attached === true, `expected attached, got ${JSON.stringify(r.body.data.attach_problem ?? r.body.data)}`);
  const row = await waitOnline(`${PROPOSED}#${ownerName}@${NODE_ID}`);
  assert(row?.tunnel_status === 'online', `${PROPOSED} should be online, got ${JSON.stringify(row)}`);
});

await test('whatever the proposal asked for, the approved agent holds the runtime\'s scopes', async () => {
  const list = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  const scopes = (list.find(a => a.name === PROPOSED)?.default_scopes ?? []) as string[];
  for (const s of ['memory:read', 'memory:write']) {
    assert(scopes.includes(s), `${PROPOSED} should hold ${s}, holds ${JSON.stringify(scopes)}`);
  }
});

await test('its runtime reads its own definition and makes its start-up calls', async () => {
  proposedStart = new Date(Date.now() - 2000).toISOString();
  // crewaimeat json_agent.load_def -> memory_tools.read_owner_key: the definition is in the owner's
  // namespace, so the read carries owner_scope.
  const def = await runtimeCall(PROPOSED, 'aimeat_memory_read', { key: `crews.registry.${PROPOSED}`, owner_scope: true });
  assert(JSON.stringify(def).includes('Do this: {{ctx.prompt}}'), `the definition should come back, got ${JSON.stringify(def).slice(0, 300)}`);
  await runtimeCall(PROPOSED, 'aimeat_agent_tags_set', { target_agent_name: PROPOSED, tags: PROPOSED_DEF.tags });
  await runtimeCall(PROPOSED, 'aimeat_memory_write', { key: `agents.${PROPOSED}.readme`, value: '# Tiny', visibility: 'owner' });
  await runtimeCall(PROPOSED, 'aimeat_memory_write', {
    key: `crews.runtime.${PROPOSED}`, visibility: 'owner', tags: ['crew-runtime'],
    value: { loadedAt: new Date().toISOString(), ok: true, errors: [], runtime: 'crewaimeat e2e' },
  });
});

await test('its first task ends done, and the node refused it nothing', async () => {
  const created = await json(BASE, `/v1/agents/${PROPOSED}/tasks`, {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ title: 'First task', description: 'Say hello.', status: 'queued', verification: { user_expects: '', technical_checks: [] }, todos: [] }),
  });
  assert(created.status === 201, `task create ${created.status}: ${JSON.stringify(created.body?.error)}`);
  const id = (created.body.data.task?.id ?? created.body.data.id) as string;
  const listed = await runtimeCall(PROPOSED, 'aimeat_task_list', {});
  const mine = ((listed.tasks ?? listed) as any[]).find(t => t.id === id);
  assert(!!mine, 'the task should be in the agent\'s own list');
  if (mine.status === 'queued') {
    await runtimeCall(PROPOSED, 'aimeat_task_propose_todos', { task_id: id, todos: [{ title: 'Say hello', verification: 'A greeting is written' }] });
  }
  const got = await runtimeCall(PROPOSED, 'aimeat_task_get', { task_id: id });
  assert((got.task ?? got).status === 'active', `the task should be active before the crew runs, got ${(got.task ?? got).status}`);
  const key = `agents.${PROPOSED}.results.first-task`;
  await runtimeCall(PROPOSED, 'aimeat_memory_write', { key, value: 'Hello.', visibility: 'owner' });
  await runtimeCall(PROPOSED, 'aimeat_task_complete', { task_id: id, message: 'Done.', deliverable_key: key });
  const after = await json(BASE, `/v1/agents/${PROPOSED}/tasks/${id}`, { headers: authOwner() });
  assert((after.body.data.task ?? after.body.data).status === 'done', `the task should be done, got ${(after.body.data.task ?? after.body.data).status}`);
  const refused = await refusalsSince(PROPOSED, proposedStart);
  assert(refused.length === 0, `${PROPOSED} was refused: ${JSON.stringify(refused)}`);
});

await test('an agent approved before the fix, with memory:write only: the owner sees memory:read missing, gives it, and the read goes through', async () => {
  // The owner narrows the agent back to what the hosted place's agent holds, so the runtime meets
  // the same refusal. The owner's card lists it; giving it is PATCH /v1/agents/:name/scopes, which
  // the card's dialog sends, and the connector mints a fresh credential on scopes_changed.
  const narrowed = await json(BASE, `/v1/agents/${PROPOSED}/scopes`, { method: 'PATCH', headers: authOwner(), body: JSON.stringify({ scopes: ['memory:write'] }) });
  assert(narrowed.status === 200, `narrow ${narrowed.status}: ${JSON.stringify(narrowed.body?.error)}`);
  const before = new Date(Date.now() - 2000).toISOString();
  const read = () => json(daemonBase, '/local/call/aimeat_memory_read', {
    method: 'POST', headers: { 'X-Aimeat-Agent': PROPOSED }, body: JSON.stringify({ key: `crews.registry.${PROPOSED}`, owner_scope: true }),
  });
  const refused = await read();
  assert(refused.body?.ok !== true && refused.body?.error?.code === 'SCOPE_DENIED', `memory:write only must be refused the read, got ${refused.status} ${JSON.stringify(refused.body)}`);
  const list = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  const onCard = (list.find(a => a.name === PROPOSED)?.refusals ?? []) as any[];
  assert(onCard.some(r => (r.needed ?? []).includes('memory:read')), `the owner's card should name memory:read, got ${JSON.stringify(onCard)}`);
  assert((await refusalsSince(PROPOSED, before)).length > 0, 'the runtime\'s refusal check sees it too');

  const given = await json(BASE, `/v1/agents/${PROPOSED}/scopes`, { method: 'PATCH', headers: authOwner(), body: JSON.stringify({ scopes: ['memory:write', 'memory:read'] }) });
  assert(given.status === 200, `grant ${given.status}: ${JSON.stringify(given.body?.error)}`);
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < 15_000) {
    last = await read();
    if (last.body?.ok === true) break;
    await sleep(300);
  }
  assert(last?.body?.ok === true, `after the grant the read should go through without a restart, got ${last?.status} ${JSON.stringify(last?.body?.error)}`);
  const after = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() })).body.data.agents as any[];
  assert(((after.find(a => a.name === PROPOSED)?.refusals ?? []) as any[]).length === 0, 'the card closes when the permission is given');
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('stop the daemon, delete the owner, remove the temp home', async () => {
  if (daemonBase) await json(daemonBase, '/local/shutdown', { method: 'POST' }).catch(() => null);
  if (daemon && !(await waitForExit(daemon))) daemon.kill('SIGKILL');
  const del = await json(BASE, `/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: authOwner() });
  assert(del.status === 200, `owner delete ${del.status}`);
  await sleep(300);
  rmSync(home, { recursive: true, force: true });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Basic Agents First Task E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

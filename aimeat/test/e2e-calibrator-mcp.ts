/**
 * @file test/e2e-calibrator-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's Prompt Calibrator from the chat: aimeat_calibrator, one action per
 *   /v1/calibrator route, over the service the routes run (services/calibrator/projects.ts). Holds:
 *     1. the owner's agent holding memory:read-as-owner and memory:write-as-owner works on the
 *        OWNER's projects: it lists the one the owner made on the page, sets its models, adds a
 *        version, runs a batch's results in, and the owner reads all of it back over REST;
 *     2. the same agent over REST, which the CLI dispatch calls, reads the project too;
 *     3. refusals: an agent with only memory:read-as-owner reads but its change is SCOPE_DENIED (and
 *        403 over REST); an agent with "*" is not offered the tool; another owner's agent with both
 *        words sees none of this owner's projects and gets NOT_FOUND for one.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=calibrator-mcp
 * @version-history
 *   v1.0.1 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); every test as it was.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpAgent, type McpSession } from './helpers/mcp-session.js';

import { BASE, assert, finish, json as request, test } from './helpers/harness.js';

/** The harness request, with the caller's token as a bearer header. */
function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = opts;
  return request(path, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string> | undefined) } });
}
const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const READ = 'memory:read-as-owner';
const WRITE = 'memory:write-as-owner';

console.log('\n=== The Prompt Calibrator from the chat ===\n');

let owner!: RegisteredOwner, other!: RegisteredOwner;
let helper!: McpAgent, reader!: McpAgent, wild!: McpAgent, stranger!: McpAgent;
let s!: McpSession;
let projectId = '';
let batchId = '';

await test('Setup: an owner with a project made on the page, and four agents', async () => {
  owner = await registerOwner(BASE, `calo${stamp}`);
  other = await registerOwner(BASE, `calx${stamp}`);
  const p = await json('/v1/calibrator', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `Summaries ${stamp}` }) });
  assert(p.status === 201, `project ${p.status} ${short(p.body?.error)}`);
  projectId = p.body.data.project.projectId;
  helper = await makeAgent(BASE, owner, [READ, WRITE]);
  reader = await makeAgent(BASE, owner, [READ]);
  wild = await makeAgent(BASE, owner, ['*']);
  stranger = await makeAgent(BASE, other, [READ, WRITE]);
  s = await openSession(BASE, helper.token, 'e2e-calibrator');
});

console.log('\n1. The agent works on the owner\'s projects');
await test('1a. list finds the project the owner made on the page', async () => {
  const r = await callTool(s, 'aimeat_calibrator', { action: 'list' });
  assert(!r.isError, `list: ${r.text.slice(0, 300)}`);
  assert((r.data.projects ?? []).some((p: any) => p.projectId === projectId), `the owner's project: ${short(r.data)}`);
  const t = await callTool(s, 'aimeat_calibrator', { action: 'templates' });
  assert(!t.isError && typeof t.data.analysisPromptTemplate === 'string', `templates: ${t.text.slice(0, 200)}`);
});

await test('1b. update, version_create, batch_create and batch_update land on the owner\'s records', async () => {
  const u = await callTool(s, 'aimeat_calibrator', {
    action: 'update', project_id: projectId,
    candidate_models: [{ id: 'cand-1', label: 'Model one', modelId: 'stub/one' }],
  });
  assert(!u.isError && u.data.project.candidateModels.length === 1, `update: ${u.text.slice(0, 300)}`);
  const v = await callTool(s, 'aimeat_calibrator', {
    action: 'version_create', project_id: projectId, prompt: 'Summarise the text in three bullets.', target_output: '- a\n- b\n- c',
  });
  assert(!v.isError && v.data.version.version === 1 && v.data.version.changelog === 'Initial version', `version: ${v.text.slice(0, 300)}`);
  const b = await callTool(s, 'aimeat_calibrator', { action: 'batch_create', project_id: projectId, version: 1 });
  assert(!b.isError && b.data.batch.models.length === 1 && b.data.batch.promptVersion === 1, `batch: ${b.text.slice(0, 300)}`);
  batchId = b.data.batch.batchId;
  const models = b.data.batch.models.map((m: any) => ({
    ...m, step2_analysis: { ...m.step2_analysis, status: 'done', overallScore: 0.75, dimensions: [{ name: 'bullet_count', description: 'three bullets', category: 'structure', pass: true }] },
  }));
  const bu = await callTool(s, 'aimeat_calibrator', { action: 'batch_update', project_id: projectId, batch_id: batchId, models, status: 'done' });
  assert(!bu.isError && bu.data.batch.status === 'done', `batch_update: ${bu.text.slice(0, 300)}`);
  const d = await callTool(s, 'aimeat_calibrator', { action: 'detail', project_id: projectId });
  assert(!d.isError && d.data.versions.length === 1 && d.data.batches[0]?.scores?.[0]?.overallScore === 0.75, `detail: ${short(d.data)}`);
  assert((d.data.dimensions as any[]).some((x) => x.name === 'bullet_count' && x.discoveredInBatch === batchId), `the dimension joined the project: ${short(d.data.dimensions)}`);
});

await test('1c. The owner reads the agent\'s work back on REST, under their own records', async () => {
  const v = await json(`/v1/calibrator/${projectId}/versions/1`, { token: owner.token });
  assert(v.status === 200 && v.body.data.version.prompt === 'Summarise the text in three bullets.', `version ${v.status} ${short(v.body)}`);
  const list = await json('/v1/calibrator', { token: owner.token });
  const mine = (list.body.data.projects as any[]).find((p) => p.projectId === projectId);
  assert(mine?.batchCount === 1 && mine.latestAvgScore === 0.75 && mine.modelCount === 1, `the owner's list: ${short(mine)}`);
});

await test('1d. The agent over REST (the CLI path) reads the project, and a wrong action field is refused', async () => {
  const r = await json(`/v1/calibrator/${projectId}`, { token: helper.token });
  assert(r.status === 200 && r.body.data.project.projectId === projectId, `REST ${r.status} ${short(r.body?.error)}`);
  const bad = await callTool(s, 'aimeat_calibrator', { action: 'list', prompt: 'x' });
  assert(bad.isError && /^INVALID_INPUT: /.test(bad.text), `extra field: ${bad.text.slice(0, 200)}`);
  const del = await callTool(s, 'aimeat_calibrator', { action: 'batch_delete', project_id: projectId, batch_id: batchId });
  assert(!del.isError && del.data.deleted === 1, `batch_delete: ${del.text.slice(0, 200)}`);
  const again = await callTool(s, 'aimeat_calibrator', { action: 'batch', project_id: projectId, batch_id: batchId });
  assert(again.isError && /^NOT_FOUND: /.test(again.text), `deleted batch: ${again.text.slice(0, 200)}`);
});

console.log('\n2. Refusals');
await test('2a. With memory:read-as-owner only, the agent reads but a change is SCOPE_DENIED, and REST refuses it', async () => {
  const t = await openSession(BASE, reader.token, 'e2e-calibrator-reader');
  const r = await callTool(t, 'aimeat_calibrator', { action: 'get', project_id: projectId });
  assert(!r.isError && r.data.project.projectId === projectId, `read: ${r.text.slice(0, 200)}`);
  const w = await callTool(t, 'aimeat_calibrator', { action: 'create', name: 'not allowed' });
  assert(w.isError && /^SCOPE_DENIED: /.test(w.text) && w.text.includes(WRITE), `write: ${w.text.slice(0, 300)}`);
  const rest = await json('/v1/calibrator', { method: 'POST', token: reader.token, body: JSON.stringify({ name: 'not allowed' }) });
  assert(rest.status === 403, `REST create: ${rest.status} ${short(rest.body?.error)}`);
  const list = await json('/v1/calibrator', { token: owner.token });
  assert(!(list.body.data.projects as any[]).some((p) => p.name === 'not allowed'), 'nothing was created');
});

await test('2b. An agent with "*" is not offered the tool, and REST refuses it', async () => {
  const t = await openSession(BASE, wild.token, 'e2e-calibrator-wild');
  assert(!(await toolNames(t)).includes('aimeat_calibrator'), 'not offered to a "*" agent');
  const rest = await json(`/v1/calibrator/${projectId}`, { token: wild.token });
  assert(rest.status === 403, `REST: ${rest.status}`);
});

await test('2c. Another owner\'s agent sees none of this owner\'s projects', async () => {
  const t = await openSession(BASE, stranger.token, 'e2e-calibrator-stranger');
  const list = await callTool(t, 'aimeat_calibrator', { action: 'list' });
  assert(!list.isError && !(list.data.projects as any[]).some((p) => p.projectId === projectId), `list: ${short(list.data)}`);
  const get = await callTool(t, 'aimeat_calibrator', { action: 'detail', project_id: projectId });
  assert(get.isError && /^NOT_FOUND: /.test(get.text), `detail: ${get.text.slice(0, 200)}`);
  const del = await callTool(t, 'aimeat_calibrator', { action: 'delete', project_id: projectId });
  assert(!del.isError && del.data.deleted === 0, `delete removes nothing of another owner's: ${del.text.slice(0, 200)}`);
  const still = await json(`/v1/calibrator/${projectId}`, { token: owner.token });
  assert(still.status === 200, `the owner's project is still there: ${still.status}`);
});

finish();

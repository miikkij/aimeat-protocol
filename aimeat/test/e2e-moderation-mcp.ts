/**
 * @file test/e2e-moderation-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The moderation review from the chat: aimeat_admin_flags, aimeat_admin_flag_review,
 *   aimeat_flag_appeal, aimeat_appeals and aimeat_appeal_review, each over the service function its
 *   REST route runs (services/moderation/review.ts). Holds:
 *     1. the operator's agent holding operator:admin lists the flags and decides one; an agent of the
 *        operator without the word, and an organism admin's agent, are not offered the two tools;
 *     2. an agent appeals a flag on content it made, once; another owner's agent is refused;
 *     3. the organism creator's own agent lists the appeals on the organism's content and overturns
 *        one, which dismisses the flag; another owner's agent may neither list nor decide it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=moderation-mcp
 * @version-history
 *   v1.0.1 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); every test as it was.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 3).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpAgent } from './helpers/mcp-session.js';
import { BASE, assert, finish, json as request, test } from './helpers/harness.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

/** The harness request (it waits out a 429), with the caller's token as a bearer header. */
function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = opts;
  return request(path, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string> | undefined) } });
}
const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

async function fileFlag(reporter: RegisteredOwner, targetType: string, targetId: string): Promise<string> {
  const r = await json('/v1/flags', {
    method: 'POST', token: reporter.token,
    body: JSON.stringify({ targetType, targetId, reason: 'inappropriate', description: 'raised by the moderation MCP suite' }),
  });
  assert(r.status === 201, `flag ${targetType}: ${r.status} ${short(r.body)}`);
  return r.body.data.id as string;
}

console.log('\n=== Moderation review from the chat ===\n');

let operator!: RegisteredOwner, creator!: RegisteredOwner, other!: RegisteredOwner, reporter!: RegisteredOwner;
let opAgent!: McpAgent, writer!: McpAgent, creatorAgent!: McpAgent, otherAgent!: McpAgent;
let orgId = '';
let flagOnAgentContent = '';
let flagOnOrgContent = '';
let flagForOperator = '';

await test('Setup: the operator, an organism creator, another owner, a reporter, their agents and three flags', async () => {
  operator = await registerOwner(BASE, `mmop${stamp}`);
  assert(operator.roles.includes('operator'), `the first owner is the operator: ${JSON.stringify(operator.roles)}`);
  creator = await registerOwner(BASE, `mmcr${stamp}`);
  other = await registerOwner(BASE, `mmot${stamp}`);
  reporter = await registerOwner(BASE, `mmrp${stamp}`);
  opAgent = await makeAgent(BASE, operator, ['operator:admin', 'social:read', 'social:write']);
  writer = await makeAgent(BASE, creator, ['memory:read', 'memory:write', 'social:write']);
  creatorAgent = await makeAgent(BASE, creator, ['social:read', 'social:write', 'organism:read']);
  otherAgent = await makeAgent(BASE, other, ['social:read', 'social:write', 'memory:read']);

  const key = `moderation.mcp.${stamp}`;
  const mem = await json('/v1/memory', { method: 'POST', token: writer.token, body: JSON.stringify({ key, value: { note: 'a note someone objected to' }, visibility: 'public' }) });
  assert(mem.status === 201, `agent memory ${mem.status} ${short(mem.body)}`);
  flagOnAgentContent = await fileFlag(reporter, 'memory', `${writer.gaii}::${key}`);

  const org = await json('/v1/organisms', { method: 'POST', token: creator.token, body: JSON.stringify({ name: `Moderation ${stamp}`, description: 'organism for the moderation MCP suite', type: 'community' }) });
  assert(org.status === 201, `organism ${org.status} ${short(org.body)}`);
  orgId = org.body.data.organism.id;
  const orgMem = await json('/v1/memory', { method: 'POST', token: creator.token, body: JSON.stringify({ key: `organism.${orgId}.notes`, value: { note: 'organism content' }, visibility: 'private' }) });
  assert(orgMem.status === 201, `organism memory ${orgMem.status} ${short(orgMem.body)}`);
  flagOnOrgContent = await fileFlag(reporter, 'memory', `${creator.name}@${NODE_ID}::organism.${orgId}.notes`);
  flagForOperator = await fileFlag(reporter, 'agent', otherAgent.gaii);
});

console.log('\n1. The operator\'s review');
await test('1a. The operator\'s agent lists the active flags and decides one', async () => {
  const s = await openSession(BASE, opAgent.token, 'e2e-moderation-op');
  const list = await callTool(s, 'aimeat_admin_flags', { status: 'active', per_page: 100 });
  assert(!list.isError, `list: ${list.text.slice(0, 300)}`);
  const ids = (list.data.flags ?? []).map((f: any) => f.id);
  assert(ids.includes(flagForOperator) && ids.includes(flagOnOrgContent), `the flags are listed: ${short(ids)}`);
  const r = await callTool(s, 'aimeat_admin_flag_review', { flag_id: flagForOperator, status: 'actioned' });
  assert(!r.isError && r.data.status === 'actioned' && r.data.reviewedBy === opAgent.gaii, `review: ${r.text.slice(0, 300)}`);
  const after = await json('/v1/flags?per_page=100', { token: operator.token });
  assert((after.body.data as any[]).find((f) => f.id === flagForOperator)?.status === 'actioned', 'REST reads the decision');
  const bad = await callTool(s, 'aimeat_admin_flag_review', { flag_id: 'flag-does-not-exist', status: 'dismissed' });
  assert(bad.isError && /^NOT_FOUND: /.test(bad.text), `unknown flag: ${bad.text.slice(0, 200)}`);
});

await test('1b. Without operator:admin the two tools are not offered, and the REST list refuses', async () => {
  for (const agent of [creatorAgent, await makeAgent(BASE, operator, ['social:read'])]) {
    const s = await openSession(BASE, agent.token, 'e2e-moderation-noop');
    const names = await toolNames(s);
    assert(!names.includes('aimeat_admin_flags') && !names.includes('aimeat_admin_flag_review'), `not offered to ${agent.name}`);
    const r = await callTool(s, 'aimeat_admin_flag_review', { flag_id: flagOnOrgContent, status: 'dismissed' });
    assert(r.isError, `refused: ${r.text.slice(0, 200)}`);
  }
  assert((await json('/v1/flags', { token: creatorAgent.token })).status === 403, 'GET /v1/flags refuses a plain agent');
});

console.log('\n2. An appeal from the chat');
let agentAppeal = '';
await test('2a. The agent appeals the flag on content it made, and a second appeal is refused', async () => {
  const s = await openSession(BASE, writer.token, 'e2e-moderation-appeal');
  const r = await callTool(s, 'aimeat_flag_appeal', { flag_id: flagOnAgentContent, reason: 'The note is a quote from a public report.' });
  assert(!r.isError && r.data.status === 'pending' && r.data.flagId === flagOnAgentContent, `appeal: ${r.text.slice(0, 300)}`);
  agentAppeal = r.data.id;
  const again = await callTool(s, 'aimeat_flag_appeal', { flag_id: flagOnAgentContent, reason: 'again' });
  assert(again.isError && /^ALREADY_APPEALED: /.test(again.text), `second: ${again.text.slice(0, 200)}`);
  const empty = await callTool(s, 'aimeat_flag_appeal', { flag_id: flagOnAgentContent, reason: '' });
  assert(empty.isError, `an empty reason is refused: ${empty.text.slice(0, 200)}`);
});

await test('2b. Another owner\'s agent cannot appeal it', async () => {
  const s = await openSession(BASE, otherAgent.token, 'e2e-moderation-appeal-other');
  const r = await callTool(s, 'aimeat_flag_appeal', { flag_id: flagOnOrgContent, reason: 'not mine' });
  assert(r.isError && /^ACCESS_DENIED: /.test(r.text), `other owner: ${r.text.slice(0, 200)}`);
});

console.log('\n3. The organism creator\'s agent decides an appeal');
let orgAppeal = '';
await test('3a. The creator appeals in person; the creator\'s agent lists it over MCP', async () => {
  const a = await json(`/v1/flags/${flagOnOrgContent}/appeal`, { method: 'POST', token: creator.token, body: JSON.stringify({ reason: 'These are our own minutes.' }) });
  assert(a.status === 201, `appeal ${a.status} ${short(a.body)}`);
  orgAppeal = a.body.data.id;
  const s = await openSession(BASE, creatorAgent.token, 'e2e-moderation-appeals');
  const list = await callTool(s, 'aimeat_appeals', { status: 'pending' });
  assert(!list.isError, `list: ${list.text.slice(0, 300)}`);
  const ids = (list.data.appeals ?? []).map((x: any) => x.id);
  assert(ids.includes(orgAppeal) && !ids.includes(agentAppeal), `the organism's appeal only: ${short(ids)}`);
});

await test('3b. Another owner\'s agent may neither list nor decide it', async () => {
  const s = await openSession(BASE, otherAgent.token, 'e2e-moderation-appeals-other');
  const list = await callTool(s, 'aimeat_appeals', {});
  assert(list.isError && /^FORBIDDEN: /.test(list.text), `list: ${list.text.slice(0, 200)}`);
  const r = await callTool(s, 'aimeat_appeal_review', { appeal_id: orgAppeal, decision: 'overturned' });
  assert(r.isError && /^FORBIDDEN: /.test(r.text), `review: ${r.text.slice(0, 200)}`);
});

await test('3c. The creator\'s agent overturns it: the appeal is decided and the flag dismissed', async () => {
  const s = await openSession(BASE, creatorAgent.token, 'e2e-moderation-review');
  const r = await callTool(s, 'aimeat_appeal_review', { appeal_id: orgAppeal, decision: 'overturned', note: 'Our own minutes.' });
  assert(!r.isError && r.data.status === 'overturned' && r.data.reviewNote === 'Our own minutes.', `review: ${r.text.slice(0, 300)}`);
  const flags = await json('/v1/flags?per_page=100', { token: operator.token });
  assert((flags.body.data as any[]).find((f) => f.id === flagOnOrgContent)?.status === 'dismissed', 'the flag is dismissed');
  const again = await callTool(s, 'aimeat_appeal_review', { appeal_id: orgAppeal, decision: 'upheld' });
  assert(again.isError && /^ALREADY_REVIEWED: /.test(again.text), `second: ${again.text.slice(0, 200)}`);
});

finish();

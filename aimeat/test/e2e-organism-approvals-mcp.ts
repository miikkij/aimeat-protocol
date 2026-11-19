/**
 * @file test/e2e-organism-approvals-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's approval requests from the chat: aimeat_organism_approval_request and
 *   aimeat_organism_approvals, over the service POST and GET /v1/organisms/:id/approvals run
 *   (services/organism/approvals.ts). Holds:
 *     1. the creator's agent files a request for an action the policy always gates: it waits, and
 *        the actor is the agent;
 *     2. the agent and a member's agent read it in the inbox; after the creator resolves it in
 *        person over REST, the inbox says approved;
 *     3. an outsider's agent is refused both tools (ACCESS_DENIED), a publish is refused here
 *        (INVALID_INPUT), and an agent without organism:write is refused the request (SCOPE_DENIED).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-approvals-mcp
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 1).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = opts;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}
const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

console.log('\n=== Organism approvals from the chat ===\n');

let creator!: RegisteredOwner, member!: RegisteredOwner, outsider!: RegisteredOwner;
let creatorAgent!: McpAgent, memberAgent!: McpAgent, outsiderAgent!: McpAgent;
let orgId = '';
let approvalId = '';

await test('Setup: an organism, its creator, a member, an outsider and their agents', async () => {
  creator = await registerOwner(BASE, `oacr${stamp}`);
  member = await registerOwner(BASE, `oamb${stamp}`);
  outsider = await registerOwner(BASE, `oaout${stamp}`);
  const org = await json('/v1/organisms', { method: 'POST', token: creator.token, body: JSON.stringify({ name: `Approvals ${stamp}`, description: 'organism for the approvals MCP suite', type: 'project', join_policy: 'open' }) });
  assert(org.status === 201, `organism ${org.status} ${short(org.body)}`);
  orgId = org.body.data.organism.id;
  const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', token: member.token, body: '{}' });
  assert(j.status === 201, `member joins ${j.status} ${short(j.body)}`);
  creatorAgent = await makeAgent(BASE, creator, ['organism:read', 'organism:write']);
  memberAgent = await makeAgent(BASE, member, ['organism:read']);
  outsiderAgent = await makeAgent(BASE, outsider, ['organism:read', 'organism:write']);
});

await test('1. The creator\'s agent asks for approval of an action the policy always gates: it waits', async () => {
  const s = await openSession(BASE, creatorAgent.token, 'e2e-approvals-request');
  const r = await callTool(s, 'aimeat_organism_approval_request', {
    organism_id: orgId, action: 'data-egress', arguments: { what: 'the customer list to the partner' },
    prompt: 'May I send the customer list to the partner?', risk: 'low',
  });
  assert(!r.isError, `request: ${r.text.slice(0, 300)}`);
  assert(r.data.gated === true && r.data.approval.status === 'pending', `it waits: ${short(r.data)}`);
  assert(r.data.approval.actor === creatorAgent.gaii, `the actor is the agent: ${r.data.approval.actor}`);
  assert(r.data.approval.arguments?.what === 'the customer list to the partner', 'the arguments are kept');
  approvalId = r.data.approval.id;
});

await test('2a. The agent and a member\'s agent read it in the inbox', async () => {
  for (const agent of [creatorAgent, memberAgent]) {
    const s = await openSession(BASE, agent.token, 'e2e-approvals-inbox');
    const r = await callTool(s, 'aimeat_organism_approvals', { organism_id: orgId, status: 'pending' });
    assert(!r.isError, `inbox for ${agent.name}: ${r.text.slice(0, 300)}`);
    assert((r.data.approvals ?? []).some((a: any) => a.id === approvalId), `${agent.name} sees it: ${short(r.data)}`);
  }
});

await test('2b. The creator resolves it in person, and the inbox says approved', async () => {
  const d = await json(`/v1/organisms/${orgId}/approvals/${approvalId}`, { method: 'POST', token: creator.token, body: JSON.stringify({ decision: 'approve', note: 'Yes, this once.' }) });
  assert(d.status === 200, `resolve ${d.status} ${short(d.body)}`);
  const s = await openSession(BASE, creatorAgent.token, 'e2e-approvals-after');
  const r = await callTool(s, 'aimeat_organism_approvals', { organism_id: orgId, status: 'approved' });
  assert(!r.isError && (r.data.approvals ?? []).some((a: any) => a.id === approvalId && a.status === 'approved'), `approved: ${short(r.data)}`);
});

await test('3a. An outsider\'s agent is refused both tools', async () => {
  const s = await openSession(BASE, outsiderAgent.token, 'e2e-approvals-outsider');
  const req = await callTool(s, 'aimeat_organism_approval_request', { organism_id: orgId, action: 'data-egress' });
  assert(req.isError && req.offered && /^ACCESS_DENIED: /.test(req.text), `request: ${req.text.slice(0, 200)}`);
  const list = await callTool(s, 'aimeat_organism_approvals', { organism_id: orgId });
  assert(list.isError && /^ACCESS_DENIED: /.test(list.text), `list: ${list.text.slice(0, 200)}`);
  const missing = await callTool(s, 'aimeat_organism_approvals', { organism_id: 'no-such-organism' });
  assert(missing.isError && /^NOT_FOUND: /.test(missing.text), `unknown organism: ${missing.text.slice(0, 200)}`);
});

await test('3b. A publish is asked through the publish route, never here', async () => {
  const s = await openSession(BASE, creatorAgent.token, 'e2e-approvals-publish');
  const r = await callTool(s, 'aimeat_organism_approval_request', { organism_id: orgId, action: 'publish', arguments: { namespace: 'x', instance: 'y' } });
  assert(r.isError && /^INVALID_INPUT: /.test(r.text), `publish: ${r.text.slice(0, 200)}`);
});

await test('3c. An agent without organism:write is refused the request with SCOPE_DENIED, and files nothing', async () => {
  const s = await openSession(BASE, memberAgent.token, 'e2e-approvals-noscope');
  assert((await toolNames(s)).includes('aimeat_organism_approvals'), 'the read tool is offered');
  const r = await callTool(s, 'aimeat_organism_approval_request', { organism_id: orgId, action: 'data-egress' });
  // organism:write is a word the owner allows with one press, so the tool stays listed and the call
  // answers SCOPE_DENIED with the address where the owner allows it (mcp/scope-denied-answer.ts).
  assert(r.isError && /^SCOPE_DENIED: /.test(r.text), `refused: ${r.text.slice(0, 200)}`);
  const inbox = await json(`/v1/organisms/${orgId}/approvals`, { token: creator.token });
  assert(inbox.status === 200 && inbox.body.data.total === 1, `still one request: ${short(inbox.body.data)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

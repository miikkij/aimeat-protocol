/**
 * @file test/e2e-mcp-v2-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ten Agent v2 tools over the node MCP endpoint, each called and each refused:
 *   turns (aimeat_v2_message_send, _message_list), delivery targets (aimeat_v2_push_set, _push_list,
 *   _push_delete) and task handles (aimeat_v2_task_create, _task_list, _task_get, _task_status,
 *   _task_cancel).
 *
 *   WHY THIS SUITE EXISTS. test/e2e-mcp-v2.ts checks which tools each /v2/mcp surface LISTS; no suite
 *   CALLED these ten. Their handlers call services/agent-v2-messaging-ops.ts and agent-v2-tasks-ops.ts,
 *   which hold four decisions a REST suite of the A2A routes does not reach through MCP: a turn or a
 *   task stays inside one account, a delivery target is its own principal's (only the account holder
 *   names another), a task's status is the assignee's testimony, and only its creator cancels it. Each
 *   tool gets a call that succeeds, read back over the REST route where one exists, and the refusal
 *   that matters for it. The tools are registered on /v1/mcp too (src/mcp/register-all.ts), which is
 *   the endpoint this suite drives.
 * @structure
 *   - Phase 1: fixtures (alice with a lead, a worker and a bare agent; bob with an agent)
 *   - Phase 2: turns · Phase 3: delivery targets · Phase 4: task handles
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-v2-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
        return { status: res.status, body: parsed };
    }
}

const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const stamp = Date.now().toString(36).slice(-6);
const text = (t: string) => [{ kind: 'text', text: t }];

console.log('\n=== Agent v2 tools over MCP (QA audit W27) ===\n');

let alice: RegisteredOwner;
let bob: RegisteredOwner;
let lead: McpAgent;
let worker: McpAgent;
let bare: McpAgent;
let bobAgent: McpAgent;
let leadMcp: McpSession;
let workerMcp: McpSession;
let bareMcp: McpSession;
let bobMcp: McpSession;

await test('Phase 1: alice with a lead, a worker and a bare agent; bob with an agent', async () => {
    await registerOwner(BASE, `opv2t${stamp}`);
    alice = await registerOwner(BASE, `alv2t${stamp}`);
    bob = await registerOwner(BASE, `bov2t${stamp}`);
    const words = ['messages:send', 'messages:read', 'task:write', 'task:read', 'agent:write'];
    lead = await makeAgent(BASE, alice, words, `ld${stamp}`);
    worker = await makeAgent(BASE, alice, words, `wk${stamp}`);
    bare = await makeAgent(BASE, alice, ['memory:read'], `br${stamp}`);
    bobAgent = await makeAgent(BASE, bob, words, `bb${stamp}`);
    leadMcp = await openSession(BASE, lead.token, 'v2-lead');
    workerMcp = await openSession(BASE, worker.token, 'v2-worker');
    bareMcp = await openSession(BASE, bare.token, 'v2-bare');
    bobMcp = await openSession(BASE, bobAgent.token, 'v2-bob');
});

// ── Phase 2: turns ────────────────────────────────────────────────────────────────────────────────
let contextId = '';
let messageId = '';

await test('2a. message send: the lead sends the worker a turn, and REST reads it back by its context', async () => {
    const r = await callTool(leadMcp, 'aimeat_v2_message_send', { to: worker.gaii, parts: text(`hello ${stamp}`) });
    assert(!r.isError && typeof r.data.message?.messageId === 'string', `send: ${r.text.slice(0, 300)}`);
    messageId = r.data.message.messageId;
    contextId = r.data.message.contextId;
    const back = await rest('GET', `/v1/agents/v2/messages?context_id=${encodeURIComponent(contextId)}`, alice.token);
    assert(back.status === 200 && (back.body.data.messages as any[]).some((m) => m.messageId === messageId), `REST read: ${back.status} ${short(back.body.data)}`);
});

await test('2b. message send: a turn to another account\'s agent and a turn with no parts are refused', async () => {
    const theirs = await callTool(leadMcp, 'aimeat_v2_message_send', { to: bobAgent.gaii, parts: text('across accounts') });
    assert(theirs.isError, `a turn to bob's agent: ${theirs.text.slice(0, 200)}`);
    const empty = await callTool(leadMcp, 'aimeat_v2_message_send', { to: worker.gaii, parts: [] });
    assert(empty.isError, `a turn with no parts: ${empty.text.slice(0, 200)}`);
    const bobs = await rest('GET', '/v1/agents/v2/messages', bob.token);
    assert(bobs.status === 200 && !JSON.stringify(bobs.body.data).includes('across accounts'), 'the refused turn reached bob\'s account');
});

await test('2c. message list: the worker reads the exchange; bob\'s agent reads nothing of it; not offered without messages:read', async () => {
    const r = await callTool(workerMcp, 'aimeat_v2_message_list', { context_id: contextId });
    assert(!r.isError && r.text.includes(messageId), `worker's list: ${r.text.slice(0, 300)}`);
    const theirs = await callTool(bobMcp, 'aimeat_v2_message_list', { context_id: contextId });
    assert(!theirs.isError && !theirs.text.includes(messageId), `bob's agent read alice's turn: ${theirs.text.slice(0, 300)}`);
    const plain = await callTool(bareMcp, 'aimeat_v2_message_list', {});
    assert(plain.isError && !plain.offered, `offered without messages:read: ${plain.text.slice(0, 200)}`);
});

// ── Phase 3: delivery targets ─────────────────────────────────────────────────────────────────────
let pushId = '';

await test('3a. push set: the lead registers its own target; REST lists it for the account holder', async () => {
    const r = await callTool(leadMcp, 'aimeat_v2_push_set', { url: `https://push.example.test/lead-${stamp}`, token: `tok-${stamp}` });
    assert(!r.isError && r.data.created === true && typeof r.data.push_config?.id === 'string', `push set: ${r.text.slice(0, 300)}`);
    pushId = r.data.push_config.id;
    const listed = await rest('GET', '/v1/agents/v2/push-config', alice.token);
    assert(listed.status === 200 && JSON.stringify(listed.body.data).includes(pushId), `REST list: ${listed.status} ${short(listed.body.data)}`);
});

await test('3b. push set: an agent registering a target for another principal is refused (ACCESS_DENIED)', async () => {
    const r = await callTool(leadMcp, 'aimeat_v2_push_set', { url: `https://push.example.test/for-worker-${stamp}`, principal: worker.gaii });
    assert(r.isError && r.text.includes('ACCESS_DENIED'), `for the worker: ${r.text.slice(0, 200)}`);
});

await test('3c. push list: the lead sees its target, the worker does not; not offered without messages:read', async () => {
    const own = await callTool(leadMcp, 'aimeat_v2_push_list', {});
    assert(!own.isError && own.text.includes(pushId), `lead's list: ${own.text.slice(0, 300)}`);
    const other = await callTool(workerMcp, 'aimeat_v2_push_list', { principal: lead.gaii });
    assert(!other.isError && !other.text.includes(pushId), `the worker read the lead's target: ${other.text.slice(0, 300)}`);
    const plain = await callTool(bareMcp, 'aimeat_v2_push_list', {});
    assert(plain.isError && !plain.offered, `offered without messages:read: ${plain.text.slice(0, 200)}`);
});

await test('3d. push delete: the worker may not delete the lead\'s target; the lead may, once', async () => {
    const theirs = await callTool(workerMcp, 'aimeat_v2_push_delete', { id: pushId });
    assert(theirs.isError && theirs.text.includes('ACCESS_DENIED'), `the worker's delete: ${theirs.text.slice(0, 200)}`);
    const own = await callTool(leadMcp, 'aimeat_v2_push_delete', { id: pushId });
    assert(!own.isError && own.data.deleted === pushId, `the lead's delete: ${own.text.slice(0, 300)}`);
    const again = await callTool(leadMcp, 'aimeat_v2_push_delete', { id: pushId });
    assert(again.isError && again.text.includes('NOT_FOUND'), `a second delete: ${again.text.slice(0, 200)}`);
    const listed = await rest('GET', '/v1/agents/v2/push-config', alice.token);
    assert(!JSON.stringify(listed.body.data).includes(pushId), 'the target is still listed');
});

// ── Phase 4: task handles ─────────────────────────────────────────────────────────────────────────
let taskId = '';

await test('4a. task create: the lead asks the worker; REST reads the task as working', async () => {
    const r = await callTool(leadMcp, 'aimeat_v2_task_create', { assigned_to: worker.gaii, input: text(`count the rows ${stamp}`) });
    assert(!r.isError && typeof r.data.task?.taskId === 'string' && r.data.task.status === 'working', `create: ${r.text.slice(0, 300)}`);
    taskId = r.data.task.taskId;
    const back = await rest('GET', `/v1/agents/v2/tasks/${taskId}`, alice.token);
    assert(back.status === 200 && back.body.data.task.assignedTo === worker.gaii, `REST read: ${back.status} ${short(back.body.data)}`);
});

await test('4b. task create: a task for another account\'s agent is refused; not offered without task:write', async () => {
    const theirs = await callTool(leadMcp, 'aimeat_v2_task_create', { assigned_to: bobAgent.gaii, input: text('across accounts') });
    assert(theirs.isError, `a task for bob's agent: ${theirs.text.slice(0, 200)}`);
    const plain = await callTool(bareMcp, 'aimeat_v2_task_create', { assigned_to: worker.gaii, input: text('x') });
    assert(plain.isError && !plain.offered, `offered without task:write: ${plain.text.slice(0, 200)}`);
});

await test('4c. task list: the lead finds what it asked for; an unknown status filter is refused (INVALID_STATUS)', async () => {
    const r = await callTool(leadMcp, 'aimeat_v2_task_list', { created_by: lead.gaii });
    assert(!r.isError && r.text.includes(taskId), `list: ${r.text.slice(0, 300)}`);
    const bad = await callTool(leadMcp, 'aimeat_v2_task_list', { status: 'finished' });
    assert(bad.isError && bad.text.includes('INVALID_STATUS'), `status finished: ${bad.text.slice(0, 200)}`);
});

await test('4d. task get: the worker reads it; bob\'s agent gets NOT_FOUND', async () => {
    const r = await callTool(workerMcp, 'aimeat_v2_task_get', { task_id: taskId });
    assert(!r.isError && r.data.task?.taskId === taskId && r.data.task.terminal === false, `get: ${r.text.slice(0, 300)}`);
    const theirs = await callTool(bobMcp, 'aimeat_v2_task_get', { task_id: taskId });
    assert(theirs.isError && theirs.text.includes('NOT_FOUND'), `bob's agent: ${theirs.text.slice(0, 200)}`);
});

await test('4e. task status: the creator may not report it (ACCESS_DENIED); the assignee completes it; a settled task does not move', async () => {
    const creator = await callTool(leadMcp, 'aimeat_v2_task_status', { task_id: taskId, status: 'completed', result: text('claimed by the creator') });
    assert(creator.isError && creator.text.includes('ACCESS_DENIED'), `the creator's report: ${creator.text.slice(0, 200)}`);
    const done = await callTool(workerMcp, 'aimeat_v2_task_status', { task_id: taskId, status: 'completed', result: text('42 rows') });
    assert(!done.isError && done.data.task?.status === 'completed', `the worker's report: ${done.text.slice(0, 300)}`);
    const back = await rest('GET', `/v1/agents/v2/tasks/${taskId}`, alice.token);
    assert(back.body.data.task.status === 'completed' && JSON.stringify(back.body.data.task.result).includes('42 rows'), `REST read: ${short(back.body.data.task)}`);
    const again = await callTool(workerMcp, 'aimeat_v2_task_status', { task_id: taskId, status: 'failed', error: { code: 'X', message: 'late' } });
    assert(again.isError && again.text.includes('TASK_SETTLED'), `a settled task moved: ${again.text.slice(0, 200)}`);
});

await test('4f. task cancel: the assignee may not cancel (ACCESS_DENIED); the creator cancels; a cancelled task does not move', async () => {
    const made = await callTool(leadMcp, 'aimeat_v2_task_create', { assigned_to: worker.gaii, input: text(`to be cancelled ${stamp}`) });
    assert(!made.isError, `second task: ${made.text.slice(0, 200)}`);
    const id = made.data.task.taskId as string;
    const assignee = await callTool(workerMcp, 'aimeat_v2_task_cancel', { task_id: id, reason: 'not mine to stop' });
    assert(assignee.isError && assignee.text.includes('ACCESS_DENIED'), `the assignee's cancel: ${assignee.text.slice(0, 200)}`);
    const own = await callTool(leadMcp, 'aimeat_v2_task_cancel', { task_id: id, reason: 'no longer needed' });
    assert(!own.isError && own.data.task?.status === 'cancelled', `the creator's cancel: ${own.text.slice(0, 300)}`);
    const back = await rest('GET', `/v1/agents/v2/tasks/${id}`, alice.token);
    assert(back.body.data.task.status === 'cancelled', `REST read: ${short(back.body.data.task)}`);
    const again = await callTool(leadMcp, 'aimeat_v2_task_cancel', { task_id: id });
    assert(again.isError && again.text.includes('TASK_SETTLED'), `a second cancel: ${again.text.slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

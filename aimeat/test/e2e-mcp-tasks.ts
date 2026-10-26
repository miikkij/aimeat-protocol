/**
 * @file test/e2e-mcp-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP Tasks extension on the 2026-07-28 code path (mcp/tasks-extension.ts). The
 *   operator sets mcp.task_after_ms to 0 for the run, so every tool call of a client that declares
 *   the extension answers with a task, and restores the setting at the end.
 *
 *   HAPPY PATH: server/discover advertises io.modelcontextprotocol/tasks; a tools/call answers
 *   resultType "task" with a UUID task id, status, ttlMs and pollIntervalMs, and a tasks/get made at
 *   once resolves (the task is durable before the handle); polling reaches `completed` with the
 *   tool's own result, and the write it made is readable; a tool call whose input the SDK refuses
 *   still completes, with isError in the result (the spec keeps `failed` for JSON-RPC errors);
 *   tasks/update and tasks/cancel acknowledge, and a cancel after the end leaves `completed`. A call
 *   that does not declare the extension, and a declaring call that finishes under a 10 s threshold,
 *   answer with the plain result. FAILURE MODES: tasks/get without the capability (-32021), another
 *   owner's agent asking for the task id (-32602 not found, its own namespace), a task record written
 *   through memory by the agent or by the owner in person (refused: the prefix is service-owned, so
 *   nothing can put a forged result into tasks/get), and an unknown id (-32602) on get and cancel.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-tasks
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-mcp-tasks-laajennus-pitkille-ty-kalukutsuille).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PASSWORD = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
const MODERN = '2026-07-28';
const TASKS = 'io.modelcontextprotocol/tasks';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

interface Answer { status: number; body: any }

let rpcId = 0;
/** One modern POST. `tasks` puts the extension in the per-request client capabilities. */
async function modern(token: string, method: string, params: Record<string, unknown>, tasks: boolean): Promise<Answer> {
    const name = typeof params.name === 'string' ? params.name : typeof params.taskId === 'string' ? params.taskId : undefined;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`,
            'MCP-Protocol-Version': MODERN,
            'Mcp-Method': method,
            ...(name ? { 'Mcp-Name': name } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: { ...params, _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientCapabilities': tasks ? { extensions: { [TASKS]: {} } } : {},
            'io.modelcontextprotocol/clientInfo': { name: 'e2e-mcp-tasks', version: '1.0.0' },
        } } }),
    });
    const text = await res.text();
    const dataLine = text.split('\n').find(l => l.startsWith('data:'));
    let body: any;
    try { body = JSON.parse(dataLine ? dataLine.slice(5) : text); } catch { body = { _raw: text.slice(0, 300) }; }
    return { status: res.status, body };
}

async function setTaskAfter(operatorToken: string, value: number): Promise<number | undefined> {
    const read = await fetch(`${BASE}/v1/admin/config`, { headers: { Authorization: `Bearer ${operatorToken}` } });
    const before = (await read.json())?.data?.schema?.['mcp.task_after_ms']?.value;
    const res = await fetch(`${BASE}/v1/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ changes: [{ path: 'mcp.task_after_ms', value }] }),
    });
    assert(res.status === 200, `PUT mcp.task_after_ms=${value} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return before;
}

/** Poll tasks/get until a terminal status, honouring pollIntervalMs but never longer than `limitMs`. */
async function pollToEnd(token: string, taskId: string, limitMs = 20_000): Promise<any> {
    const end = Date.now() + limitMs;
    for (;;) {
        const r = await modern(token, 'tasks/get', { taskId }, true);
        const t = r.body?.result;
        assert(t, `tasks/get answered no result: ${JSON.stringify(r.body).slice(0, 300)}`);
        if (['completed', 'failed', 'cancelled'].includes(t.status)) return t;
        assert(Date.now() < end, `task ${taskId} still ${t.status} after ${limitMs} ms`);
        await new Promise(r2 => setTimeout(r2, Math.min(250, t.pollIntervalMs ?? 250)));
    }
}

console.log('\n=== MCP Tasks extension (2026-07-28) E2E ===\n');

let operator = { name: '', token: '' };
let agent: McpAgent;
let bobAgent: McpAgent;
let original: number | undefined;
let aliceToken = '';
let taskId = '';
const key = `tasks/probe-${Date.now().toString(36)}`;

await test('Setup: an operator answers every declaring call with a task, an agent for two owners', async () => {
    operator = await setupOperator(BASE, ADMIN_PASSWORD, `tasksop${Date.now().toString(36)}`);
    const alice = await registerOwner(BASE, `tasks${Date.now().toString(36)}a`);
    const bob = await registerOwner(BASE, `tasks${Date.now().toString(36)}b`);
    aliceToken = alice.token;
    agent = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);
    bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write']);
    original = await setTaskAfter(operator.token, 0);
});

await test('server/discover advertises the Tasks extension', async () => {
    const r = await modern(agent.token, 'server/discover', {}, true);
    assert(r.status === 200, `discover ${r.status}`);
    assert(r.body.result?.capabilities?.extensions?.[TASKS] !== undefined, `extensions: ${JSON.stringify(r.body.result?.capabilities?.extensions)}`);
});

await test('a declaring tools/call answers with a task handle, and tasks/get resolves at once', async () => {
    const r = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_write', arguments: { key, value: { from: 'e2e-mcp-tasks' } } }, true);
    const t = r.body?.result;
    assert(r.status === 200 && t, `tools/call ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(t.resultType === 'task', `resultType ${t.resultType}`);
    assert(UUID.test(t.taskId), `taskId ${t.taskId}`);
    assert(['working', 'completed'].includes(t.status), `status ${t.status}`);
    assert(t.ttlMs === 3_600_000 && typeof t.pollIntervalMs === 'number', `ttlMs ${t.ttlMs}, pollIntervalMs ${t.pollIntervalMs}`);
    assert(typeof t.createdAt === 'string' && typeof t.lastUpdatedAt === 'string', 'createdAt and lastUpdatedAt');
    assert(t.content === undefined, 'a task handle carries no tool content');
    taskId = t.taskId;
    const now = await modern(agent.token, 'tasks/get', { taskId }, true);
    assert(now.body?.result?.taskId === taskId, `the first tasks/get did not resolve: ${JSON.stringify(now.body).slice(0, 300)}`);
    assert(now.body.result.resultType === 'complete', `tasks/get resultType ${now.body.result.resultType}`);
});

await test('polling reaches completed with the tool\'s own result, and the write is there', async () => {
    const t = await pollToEnd(agent.token, taskId);
    assert(t.status === 'completed', `status ${t.status}: ${JSON.stringify(t).slice(0, 300)}`);
    assert(t.result?.isError !== true, `the tool failed: ${JSON.stringify(t.result).slice(0, 300)}`);
    assert(String(t.result?.content?.[0]?.text ?? '').includes('"written": true'), `result: ${JSON.stringify(t.result).slice(0, 300)}`);
    assert(t.tool === undefined, 'the record\'s own field stays off the wire');
    const read = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_read', arguments: { key } }, false);
    assert(String(read.body?.result?.content?.[0]?.text ?? '').includes('e2e-mcp-tasks'), `read back: ${JSON.stringify(read.body).slice(0, 300)}`);
});

await test('a tool call the SDK refuses still completes, with isError in the result', async () => {
    const r = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_write', arguments: { value: 'no key' } }, true);
    assert(r.body?.result?.resultType === 'task', `resultType ${r.body?.result?.resultType}`);
    const t = await pollToEnd(agent.token, r.body.result.taskId);
    assert(t.status === 'completed' && t.result?.isError === true, `status ${t.status}, isError ${t.result?.isError}`);
});

await test('tasks/update and tasks/cancel acknowledge; a cancel after the end leaves completed', async () => {
    const u = await modern(agent.token, 'tasks/update', { taskId, inputResponses: { nothing: { action: 'accept' } } }, true);
    assert(u.body?.result?.resultType === 'complete' && !u.body.error, `update: ${JSON.stringify(u.body).slice(0, 200)}`);
    const c = await modern(agent.token, 'tasks/cancel', { taskId }, true);
    assert(c.body?.result?.resultType === 'complete' && !c.body.error, `cancel: ${JSON.stringify(c.body).slice(0, 200)}`);
    const after = await modern(agent.token, 'tasks/get', { taskId }, true);
    assert(after.body?.result?.status === 'completed', `status after cancel ${after.body?.result?.status}`);
});

await test('a call that does not declare the extension answers with the plain result', async () => {
    const r = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_read', arguments: { key } }, false);
    assert(r.body?.result?.resultType !== 'task', 'a non-declaring client got a task');
    assert(Array.isArray(r.body?.result?.content), `no content: ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('FAILURE: tasks/get without the capability answers -32021', async () => {
    const r = await modern(agent.token, 'tasks/get', { taskId }, false);
    assert(r.body?.error?.code === -32021, `error ${JSON.stringify(r.body?.error)}`);
    assert(r.body.error.data?.requiredCapabilities?.extensions?.[TASKS] !== undefined, 'the error names the extension');
});

await test('FAILURE: another owner\'s agent finds no such task', async () => {
    const r = await modern(bobAgent.token, 'tasks/get', { taskId }, true);
    assert(r.body?.error?.code === -32602, `bob's agent: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(r.body.result === undefined, 'no task state reached another principal');
});

await test('FAILURE: nobody writes a task record through memory, the owner in person included', async () => {
    const forged = { taskId, status: 'completed', createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), ttlMs: 3_600_000, result: { content: [{ type: 'text', text: 'forged' }] } };
    const viaMcp = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_write', arguments: { key: `mcp.tasks.${taskId}`, value: forged } }, false);
    assert(viaMcp.body?.result?.isError === true, `the agent wrote its own task record: ${JSON.stringify(viaMcp.body).slice(0, 300)}`);
    const viaRest = await fetch(`${BASE}/v1/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({ key: `mcp.tasks.${taskId}`, value: forged }),
    });
    assert(viaRest.status === 403, `the owner wrote a task record over REST: ${viaRest.status}`);
    const t = await modern(agent.token, 'tasks/get', { taskId }, true);
    assert(!JSON.stringify(t.body).includes('forged'), 'a forged result reached tasks/get');
});

await test('FAILURE: an unknown task id answers -32602 on get and cancel', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const g = await modern(agent.token, 'tasks/get', { taskId: unknown }, true);
    assert(g.body?.error?.code === -32602, `get: ${JSON.stringify(g.body?.error)}`);
    const c = await modern(agent.token, 'tasks/cancel', { taskId: unknown }, true);
    assert(c.body?.error?.code === -32602, `cancel: ${JSON.stringify(c.body?.error)}`);
});

await test('with a 10 s threshold a fast declaring call answers with its own result', async () => {
    await setTaskAfter(operator.token, 10_000);
    const r = await modern(agent.token, 'tools/call', { name: 'aimeat_memory_read', arguments: { key } }, true);
    assert(r.body?.result?.resultType !== 'task', 'a fast call became a task');
    assert(String(r.body?.result?.content?.[0]?.text ?? '').includes('e2e-mcp-tasks'), `result: ${JSON.stringify(r.body).slice(0, 200)}`);
});

if (operator.token) await setTaskAfter(operator.token, typeof original === 'number' ? original : 10_000).catch(() => undefined);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

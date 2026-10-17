/**
 * @file test/e2e-mcp-crew-schedule-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Seven tools no E2E suite had called, each called and each refused over the node MCP
 *   endpoint: an agent's first crew definition, its runtime menu and its model choice
 *   (aimeat_crew_seed, aimeat_crew_menu, aimeat_crew_llm_set), a schedule cancelled and an agent's own
 *   cron reported (aimeat_schedule_delete, aimeat_schedule_report_internal), and a workflow step that
 *   waits for the owner (aimeat_workflow_pending_inputs, aimeat_workflow_answer).
 *
 *   WHY THIS SUITE EXISTS. Each handler decides something a REST suite does not reach through MCP.
 *   crew_seed refuses a second "first" definition (ALREADY_DEFINED), which is what keeps it from
 *   becoming a way around crew_publish's runtime check; the crew tools refuse another owner's agent;
 *   crew_llm_set refuses a choice outside its vocabulary; schedule_delete refuses another owner's
 *   schedule; workflow_answer validates the picks against the question pinned at ask time and
 *   answers only within the caller's own account. The tunnel harness (test/helpers/tunnel-harness.ts)
 *   stands in for the agent's runtime, as in e2e-mcp-crew.ts, so the seed and the menu reach a real
 *   `invoke` round trip rather than an AGENT_OFFLINE refusal.
 * @structure
 *   - Phase 1: fixtures (alice with a builder agent, a runtime agent on the tunnel and a bare agent;
 *     bob with an agent)
 *   - Phase 2: crew · Phase 3: schedules · Phase 4: a workflow step waiting for the owner
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-crew-schedule-tools
 * @version-history
 *   v1.1.0 — 2026-10-17 — 2d, 2f, 3d, 4b: memory:read, memory:write and workflow:read are one-press,
 *     so the tools stay listed for the bare agent (permission ask, mcp/permission-ask-gate.ts) and
 *     each call is refused SCOPE_DENIED with the allow address instead of "not offered".
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { TunnelClient } from './helpers/tunnel-harness.js';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-6);

console.log('\n=== Crew, schedule and workflow-input tools over MCP (QA audit W27) ===\n');

let alice: RegisteredOwner;
let bob: RegisteredOwner;
/** The agent that builds: memory, tasks and workflows. */
let builder: McpAgent;
/** The agent whose runtime the tunnel harness plays. */
let runner: McpAgent;
let bare: McpAgent;
let bobAgent: McpAgent;
let builderMcp: McpSession;
let bareMcp: McpSession;
let bobMcp: McpSession;
let tunnel: TunnelClient | null = null;

/** The runtime stand-in: a clean validation verdict, and a menu with one tool and one profile. */
function runtimeReply(f: any): { ok: boolean; result: unknown } {
    if (f.capability === 'crew.validate') return { ok: true, result: { errors: [] } };
    if (f.capability === 'crew.menu') {
        return { ok: true, result: { tools: [{ id: 'web', description: 'Search the web' }], features: ['json-crew'], llm: { profiles: ['default'], models: [{ id: 'test/model' }] } } };
    }
    return { ok: false, result: { code: 'UNSUPPORTED', message: `no ${f.capability}` } };
}

// ── Phase 1: fixtures ─────────────────────────────────────────────────────────────────────────────
await test('Phase 1: alice with a builder, a runtime agent on the tunnel and a bare agent; bob with an agent', async () => {
    await registerOwner(BASE, `opcst${stamp}`);
    alice = await registerOwner(BASE, `alcst${stamp}`);
    bob = await registerOwner(BASE, `bocst${stamp}`);
    builder = await makeAgent(BASE, alice, ['memory:read', 'memory:write', 'task:write', 'workflow:read', 'workflow:write'], `bd${stamp}`);
    runner = await makeAgent(BASE, alice, ['*'], `rn${stamp}`);
    bare = await makeAgent(BASE, alice, ['agent:read'], `br${stamp}`);
    bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write', 'workflow:read', 'workflow:write'], `bb${stamp}`);
    builderMcp = await openSession(BASE, builder.token, 'cst-builder');
    bareMcp = await openSession(BASE, bare.token, 'cst-bare');
    bobMcp = await openSession(BASE, bobAgent.token, 'cst-bob');
    tunnel = await TunnelClient.connect(BASE, runner.token);
    await tunnel.waitForBacklog(1000);
    tunnel.onInvoke(runtimeReply);
});

// ── Phase 2: crew ─────────────────────────────────────────────────────────────────────────────────
const doc = () => ({
    agent_name: runner.name,
    agents: [{ name: 'r', role: 'Researcher', goal: 'Find', backstory: 'Reads', tools: ['web'], allow_delegation: false }],
    tasks: [{ id: 'research', description: 'Do this: {{ctx.prompt}}', expected_output: 'A brief', agent: 'r', context: [], async: false }],
});

await test('2a. crew seed: the builder gives the runtime agent its first definition, validated by that runtime', async () => {
    const r = await callTool(builderMcp, 'aimeat_crew_seed', { target_agent_name: runner.name, doc: doc() });
    assert(!r.isError && r.data.seeded === true && r.data.revision === 1, `seed: ${r.text.slice(0, 300)}`);
    assert(r.data.validated_by === runner.gaii, `validated by: ${r.data.validated_by}`);
    const live = await rest('GET', `/v1/memory/${encodeURIComponent(runner.gaii)}/crews.registry.${runner.name}`, alice.token);
    assert(live.status === 200 && live.body.data?.value?.doc?.agent_name === runner.name, `the definition in the agent's namespace: ${live.status} ${short(live.body.error)}`);
});

await test('2b. crew seed: a second first definition is refused (ALREADY_DEFINED), and so is another owner\'s agent', async () => {
    const again = await callTool(builderMcp, 'aimeat_crew_seed', { target_agent_name: runner.name, doc: { ...doc(), tags: ['second'] } });
    assert(again.isError && again.data?.error?.code === 'ALREADY_DEFINED', `second seed: ${again.text.slice(0, 300)}`);
    const theirs = await callTool(builderMcp, 'aimeat_crew_seed', { target_agent_name: bobAgent.gaii, doc: doc() });
    assert(theirs.isError && theirs.data?.error?.code === 'ACCESS_DENIED', `bob's agent: ${theirs.text.slice(0, 300)}`);
});

await test('2c. crew menu: the runtime answers for itself (source runtime, its tool and profile)', async () => {
    const r = await callTool(builderMcp, 'aimeat_crew_menu', { target_agent_name: runner.name });
    assert(!r.isError && r.data.source === 'runtime', `menu: ${r.text.slice(0, 300)}`);
    assert((r.data.tools as any[]).some((t) => t.id === 'web') && (r.data.profiles as string[]).includes('default'), `menu content: ${r.text.slice(0, 300)}`);
});

// Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
// The bare agent's refusals in 2d, 2f, 3d and 4b are that answer (memory:read, memory:write, workflow:read are one-press).
const refusedWithAllow = (r: { isError: boolean; offered: boolean; text: string }) =>
    r.isError && r.offered && /^SCOPE_DENIED/.test(r.text) && r.text.includes('/v1/allow?');

await test('2d. crew menu: an agent that does not exist and another owner\'s agent are refused; refused with the allow address without memory:read', async () => {
    const none = await callTool(builderMcp, 'aimeat_crew_menu', { target_agent_name: `nobody${stamp}` });
    assert(none.isError && none.data?.error?.code === 'AGENT_NOT_FOUND', `no such agent: ${none.text.slice(0, 200)}`);
    const theirs = await callTool(builderMcp, 'aimeat_crew_menu', { target_agent_name: bobAgent.gaii });
    assert(theirs.isError && theirs.data?.error?.code === 'ACCESS_DENIED', `bob's agent: ${theirs.text.slice(0, 200)}`);
    const plain = await callTool(bareMcp, 'aimeat_crew_menu', { target_agent_name: runner.name });
    assert(refusedWithAllow(plain), `answered without memory:read: ${plain.text.slice(0, 200)}`);
});

await test('2e. crew llm set: the builder chooses the node for the runtime agent; the record is the owner\'s and the menu shows it', async () => {
    const r = await callTool(builderMcp, 'aimeat_crew_llm_set', { target_agent_name: runner.name, choice: { kind: 'node' } });
    assert(!r.isError && r.data.scope === 'agent' && typeof r.data.key === 'string' && r.data.cleared === false, `llm set: ${r.text.slice(0, 300)}`);
    const rec = await rest('GET', `/v1/memory/${encodeURIComponent(r.data.key)}`, alice.token);
    assert(rec.status === 200 && rec.body.data?.value?.kind === 'node', `the owner's record: ${rec.status} ${short(rec.body.data ?? rec.body.error)}`);
    const menu = await callTool(builderMcp, 'aimeat_crew_menu', { target_agent_name: runner.name });
    assert(!menu.isError && menu.data.choice?.scope === 'agent' && menu.data.choice?.value?.kind === 'node',
        `menu choice: ${short(menu.data.choice)}`);
});

await test('2f. crew llm set: a choice outside the vocabulary and another owner\'s agent are refused; refused with the allow address without memory:write', async () => {
    const bad = await callTool(builderMcp, 'aimeat_crew_llm_set', { target_agent_name: runner.name, choice: { kind: 'telepathy' } });
    assert(bad.isError, `kind telepathy: ${bad.text.slice(0, 200)}`);
    const theirs = await callTool(builderMcp, 'aimeat_crew_llm_set', { target_agent_name: bobAgent.gaii, choice: { kind: 'node' } });
    assert(theirs.isError && theirs.data?.error?.code === 'ACCESS_DENIED', `bob's agent: ${theirs.text.slice(0, 200)}`);
    const plain = await callTool(bareMcp, 'aimeat_crew_llm_set', { choice: { kind: 'node' } });
    assert(refusedWithAllow(plain), `answered without memory:write: ${plain.text.slice(0, 200)}`);
});

await test('2g. teardown of the runtime stand-in', async () => {
    await tunnel?.close();
    tunnel = null;
});

// ── Phase 3: schedules ────────────────────────────────────────────────────────────────────────────
let scheduleId = '';
let bobScheduleId = '';

const makeSchedule = async (s: McpSession, title: string): Promise<string> => {
    const r = await callTool(s, 'aimeat_schedule_create', {
        kind: 'agent_task', cron: '0 7 * * *', timezone: 'Europe/Helsinki', display_name: title,
        task_title: title, task_description: 'A fixture for the delete tool.',
    });
    assert(!r.isError && r.data.created === true && typeof r.data.schedule_id === 'string', `schedule create: ${r.text.slice(0, 300)}`);
    return r.data.schedule_id;
};

await test('3a. schedule delete: the builder cancels its own schedule, and GET /v1/schedules no longer lists it', async () => {
    scheduleId = await makeSchedule(builderMcp, `Parity delete ${stamp}`);
    const before = await rest('GET', '/v1/schedules', alice.token);
    assert(before.status === 200 && JSON.stringify(before.body.data).includes(scheduleId), `listed before: ${before.status}`);
    const r = await callTool(builderMcp, 'aimeat_schedule_delete', { schedule_id: scheduleId });
    assert(!r.isError && r.data.deleted === scheduleId, `delete: ${r.text.slice(0, 300)}`);
    const after = await rest('GET', '/v1/schedules', alice.token);
    assert(after.status === 200 && !JSON.stringify(after.body.data).includes(scheduleId), 'still listed after the delete');
});

await test('3b. schedule delete: another owner\'s schedule is refused and stays; a deleted one is NOT_FOUND', async () => {
    const bobWriter = await makeAgent(BASE, bob, ['task:write', 'memory:write'], `bw${stamp}`);
    bobScheduleId = await makeSchedule(await openSession(BASE, bobWriter.token, 'cst-bob-writer'), `Bob's ${stamp}`);
    const theirs = await callTool(builderMcp, 'aimeat_schedule_delete', { schedule_id: bobScheduleId });
    assert(theirs.isError && /FORBIDDEN|NOT_FOUND/.test(theirs.text), `bob's schedule: ${theirs.text.slice(0, 200)}`);
    const bobs = await rest('GET', '/v1/schedules', bob.token);
    assert(JSON.stringify(bobs.body.data).includes(bobScheduleId), 'bob\'s schedule was deleted by alice\'s agent');
    const gone = await callTool(builderMcp, 'aimeat_schedule_delete', { schedule_id: scheduleId });
    assert(gone.isError && gone.text.includes('NOT_FOUND'), `a second delete: ${gone.text.slice(0, 200)}`);
});

await test('3c. schedule report internal: the builder reports its own cron; the mirror is a memory record the owner reads', async () => {
    const r = await callTool(builderMcp, 'aimeat_schedule_report_internal', { entries: [{ name: `nightly-${stamp}`, cron: '0 3 * * *', status: 'active' }] });
    assert(!r.isError && r.data.reported === true && r.data.count === 1, `report: ${r.text.slice(0, 300)}`);
    const rec = await rest('GET', `/v1/memory/${encodeURIComponent(builder.gaii)}/${encodeURIComponent(r.data.key)}`, alice.token);
    assert(rec.status === 200 && JSON.stringify(rec.body.data?.value).includes(`nightly-${stamp}`), `the mirror: ${rec.status} ${short(rec.body.data ?? rec.body.error)}`);
});

await test('3d. schedule report internal: an entry without a name is refused; refused with the allow address without memory:write', async () => {
    const bad = await callTool(builderMcp, 'aimeat_schedule_report_internal', { entries: [{ cron: '0 3 * * *' }] });
    assert(bad.offered && bad.isError, `an entry with no name: ${bad.text.slice(0, 200)}`);
    const plain = await callTool(bareMcp, 'aimeat_schedule_report_internal', { entries: [{ name: 'x' }] });
    assert(refusedWithAllow(plain), `answered without memory:write: ${plain.text.slice(0, 200)}`);
});

// ── Phase 4: a workflow step waiting for the owner ────────────────────────────────────────────────
const WF = `gate-${stamp}`;
let runId = '';

await test('4a. fixture: alice saves a one-step workflow that asks her, and starts it', async () => {
    const put = await rest('PUT', `/v1/workflows/${WF}`, alice.token, {
        title: { en_US: 'Ask the owner' }, description: { en_US: 'One human-input step' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{
            id: 'gate', description: { en_US: 'Owner approval' }, required_to_function: 'none',
            action: {
                kind: 'human-input',
                question: { header: 'Approval', prompt: 'Go ahead?', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] },
                answer_to_key: `gate.decision.${stamp}`,
            },
        }],
    });
    assert(put.status === 200, `save: ${put.status} ${short(put.body.error)}`);
    const run = await rest('POST', `/v1/workflows/${WF}/run`, alice.token, { mode: 'full' });
    assert(run.status === 200 && typeof run.body.data?.runId === 'string', `run: ${run.status} ${short(run.body)}`);
    runId = run.body.data.runId;
    let state = '';
    for (let i = 0; i < 20 && state !== 'waiting-human'; i++) {
        const r = await rest('GET', `/v1/workflows/${WF}/runs/${runId}`, alice.token);
        state = r.body.data?.steps?.gate?.state ?? '';
        if (state !== 'waiting-human') await sleep(300);
    }
    assert(state === 'waiting-human', `the gate did not park: ${state}`);
});

await test('4b. pending inputs: the builder lists alice\'s parked question; bob\'s agent does not see it', async () => {
    const r = await callTool(builderMcp, 'aimeat_workflow_pending_inputs', {});
    const hit = (r.data.inputs as any[] | undefined)?.find((i) => i.run_id === runId && i.step_id === 'gate');
    assert(!r.isError && hit && (hit.question?.options ?? []).length === 2 && typeof hit.deadline === 'string', `pending: ${r.text.slice(0, 300)}`);
    const theirs = await callTool(bobMcp, 'aimeat_workflow_pending_inputs', {});
    assert(!theirs.isError && !theirs.text.includes(runId), `bob's agent saw alice's question: ${theirs.text.slice(0, 300)}`);
    const plain = await callTool(bareMcp, 'aimeat_workflow_pending_inputs', {});
    assert(refusedWithAllow(plain), `answered without workflow:read: ${plain.text.slice(0, 200)}`);
});

await test('4c. workflow answer: a pick outside the question and bob\'s agent are refused; nothing is answered', async () => {
    const bad = await callTool(builderMcp, 'aimeat_workflow_answer', { workflow_id: WF, run_id: runId, step_id: 'gate', picks: ['maybe'] });
    assert(bad.isError, `pick maybe: ${bad.text.slice(0, 200)}`);
    const theirs = await callTool(bobMcp, 'aimeat_workflow_answer', { workflow_id: WF, run_id: runId, step_id: 'gate', picks: ['approve'] });
    assert(theirs.isError, `bob's agent answered alice's run: ${theirs.text.slice(0, 200)}`);
    const r = await rest('GET', `/v1/workflows/${WF}/runs/${runId}`, alice.token);
    assert(r.body.data.steps.gate.state === 'waiting-human', `the step moved: ${r.body.data.steps.gate.state}`);
});

await test('4d. workflow answer: the builder relays alice\'s decision; the step is answered and a second answer is refused', async () => {
    const r = await callTool(builderMcp, 'aimeat_workflow_answer', { workflow_id: WF, run_id: runId, step_id: 'gate', picks: ['approve'] });
    assert(!r.isError && r.data.answered === 'gate', `answer: ${r.text.slice(0, 300)}`);
    const run = await rest('GET', `/v1/workflows/${WF}/runs/${runId}`, alice.token);
    assert(run.body.data.steps.gate.human?.answer?.pick === 'approve', `the pinned answer: ${short(run.body.data.steps.gate.human)}`);
    const again = await callTool(builderMcp, 'aimeat_workflow_answer', { workflow_id: WF, run_id: runId, step_id: 'gate', picks: ['reject'] });
    assert(again.isError, `a second answer: ${again.text.slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

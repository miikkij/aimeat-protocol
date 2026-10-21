/**
 * @file test/e2e-purpose-agent-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: agents work for the owner. An agent puts the owner's extension on a clock and
 *   the run does its work; an agent schedules a task for another agent and the task lands in that
 *   agent's queue; an agent saves and runs a workflow and the run finishes with its result where the
 *   owner reads it; the owner's chat AI delegates a task to a task runner, which finds it on the list
 *   it polls, starts on its own and reports the result back. AIMEAT-PURPOSE.md uses 3 and 6,
 *   invariant 20.
 *
 *   WHY IT EXISTS. The October 2026 audit's second wave stopped agents' existing schedules, made
 *   app-agent work wait, and asked every workflow step its principal again; each change was right for
 *   its hole, and the suites stayed green because none of them asserted that an agent with the right
 *   permissions still gets its work done. Each test here names the use and fails when it is gone.
 *
 *   FAIL FIRST, 2026-10-21, both backends: with services/schedule-fire-refusal.ts refusing every
 *   agent-made schedule at its fire, tests 2 and 3 are red; with services/agent-task-rules.ts holding
 *   a task runner's tasks for the owner's OK, test 5 is red; restored byte for byte. Test 4's use is
 *   proved by e2e-workflow-extension-step 13a to 13c in the same tier.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-agent-work
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, installExtension, json, sleep } from './helpers/purpose-kit.js';

const h = harness('Purpose: agents work for the owner');
const STAMP = Date.now().toString(36);
const EXT = `purposework${STAMP}`;
const SCRIPTS = {
    // Writes a file under the owner, the artefact a scheduled run exists to produce, and says so.
    tally: `export default async function (ctx, input) {
        var out = await ctx.files.write(input.key, input.b64, { mime: 'text/plain', visibility: 'private' });
        return { rows: 1, wrote: out.key };
    }`,
};
const MANIFEST = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'Tallies the day for its owner.', author: 'purpose' },
    actions: [{ id: 'tally', method: 'POST', path: '/tally', script: 'tally' }],
    limits: { timeout_ms: 8000, max_api_calls: 3 },
}, null, 2);
const tallyInput = (key: string) => ({ key, b64: Buffer.from(`tally ${key}\n`).toString('base64') });

const owner = await registerOwner(BASE, `purposework${STAMP}`);
const ownerFile = (key: string) => json(`/v1/storage/${encodeURIComponent(`ext/${EXT}/${key}`)}`, { headers: auth(owner.token) });

// Each agent holds the words its work names, nothing more.
const planner = await makeAgent(BASE, owner, ['task:read', 'task:write', 'ext:invoke']);
// A step whose success signal reads the owner's record costs memory:read-as-owner, as its own route does.
const flow = await makeAgent(BASE, owner, ['workflow:read', 'workflow:write', 'ext:invoke', 'memory:read', 'memory:read-as-owner']);
const chat = await makeAgent(BASE, owner, ['task:read', 'task:write', 'memory:read']);
const runner = await makeAgent(BASE, owner, ['task:read', 'task:write', 'memory:read', 'memory:write']);
const stranger = await makeAgent(BASE, await registerOwner(BASE, `purposestr${STAMP}`), ['task:read', 'task:write']);

await h.test('1. Setup: the owner\'s extension, and a task runner of the owner', async () => {
    await installExtension(owner.token, EXT, MANIFEST, SCRIPTS);
    const mode = await json(`/v1/agents/${runner.name}/mode`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ mode: 'task-runner' }) });
    assert(mode.status === 200 && mode.body.data.mode === 'task-runner', `runner mode: ${mode.status} ${JSON.stringify(mode.body?.error)}`);
});

await h.test("2. AN AGENT'S SCHEDULE: an agent puts the owner's extension on a clock, and the run writes the owner's file", async () => {
    const mk = await json('/v1/schedules', {
        method: 'POST', headers: auth(planner.token),
        body: JSON.stringify({ kind: 'extension', cron: '0 6 * * *', display_name: 'Morning tally', extension_name: EXT, action_id: 'tally', input: tallyInput('morning.txt') }),
    });
    assert(mk.status === 201, `the agent makes the schedule: ${mk.status} ${JSON.stringify(mk.body?.error)}`);
    const fired = await json(`/v1/schedules/${mk.body.data.schedule.id}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
    const s = fired.body?.data?.schedule;
    assert(fired.status === 200 && s?.lastRunResult === 'success', `the run: ${fired.status} ${s?.lastRunResult} ${s?.lastRunError ?? JSON.stringify(fired.body?.error)}`);
    const file = await ownerFile('morning.txt');
    assert(file.status === 200 && String(file.body._raw).startsWith('tally morning.txt'), `the owner's file: ${file.status}`);
});

await h.test("3. An agent schedules a task for another agent, and each run puts the task in that agent's queue", async () => {
    const title = `PURPOSE_WEEKLY_${STAMP}`;
    const mk = await json('/v1/schedules', {
        method: 'POST', headers: auth(planner.token),
        body: JSON.stringify({ kind: 'agent_task', agent_name: runner.name, cron: '0 7 * * 1', display_name: title, task_template: { title, description: 'the weekly review' } }),
    });
    assert(mk.status === 201, `the agent makes the schedule: ${mk.status} ${JSON.stringify(mk.body?.error)}`);
    const fired = await json(`/v1/schedules/${mk.body.data.schedule.id}/trigger`, { method: 'POST', headers: auth(owner.token) });
    assert(fired.status === 200 && fired.body.data.outcome === 'created', `the run: ${fired.status} ${JSON.stringify(fired.body?.data ?? fired.body?.error)}`);
    const queue = await json(`/v1/agents/${runner.name}/tasks`, { headers: auth(runner.token) });
    assert((queue.body?.data?.tasks ?? []).some((t: any) => t.title === title), `the runner's queue: ${JSON.stringify((queue.body?.data?.tasks ?? []).map((t: any) => t.title))}`);
});

await h.test("4. AN AGENT'S WORKFLOW: an agent saves and runs a workflow, the run finishes, and the owner reads its result", async () => {
    const resultKey = `purpose.${STAMP}.flow-result`;
    const def = {
        title: { en_US: 'Evening tally' }, description: { en_US: 'one extension step' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{
            id: 'tally', description: { en_US: 'Tally the evening' }, required_to_function: 'none',
            success_signal: { kind: 'deterministic', key: resultKey, op: 'json_field', path: 'rows', min: 1 },
            action: { kind: 'extension', extension: EXT, action: 'tally', input: tallyInput('evening.txt'), result_to_key: resultKey },
        }],
    };
    const wf = `purpose-evening-${STAMP}`;
    const save = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(flow.token), body: JSON.stringify(def) });
    assert(save.status === 200, `the agent saves it: ${save.status} ${JSON.stringify(save.body?.data?.errors ?? save.body?.error)}`);
    const started = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(flow.token), body: JSON.stringify({ mode: 'full' }) });
    assert(started.status === 200, `the agent runs it: ${started.status} ${JSON.stringify(started.body?.error)}`);
    const runId = started.body.data.run?.runId ?? started.body.data.runId;
    let run: any = null;
    for (let i = 0; i < 40; i++) {
        run = (await json(`/v1/workflows/${wf}/runs/${runId}`, { headers: auth(owner.token) })).body.data;
        run = run?.run ?? run;
        if (run && !['running', 'waiting-step'].includes(run.status)) break;
        await sleep(250);
    }
    assert(run?.status === 'done' && run.steps.tally.state === 'green', `the run: ${run?.status} ${run?.steps?.tally?.state} ${run?.reason ?? ''}`);
    const result = await json(`/v1/memory/${encodeURIComponent(resultKey)}`, { headers: auth(owner.token) });
    assert(result.status === 200 && result.body.data.value.rows === 1, `the owner reads the result: ${result.status}`);
    assert((await ownerFile('evening.txt')).status === 200, 'and the file the step wrote');
});

await h.test('5. DELEGATION: the chat AI gives the task runner a task over MCP; it starts on its own, the runner finds it and reports back', async () => {
    const session = await openSession(BASE, chat.token, 'purpose-chat');
    const made = await callTool(session, 'aimeat_task_create', { target_agent: runner.name, title: `Summarise the week ${STAMP}`, description: 'three lines' });
    const task = { id: made.data?.task_id as string, status: made.data?.status as string };
    assert(!made.isError && typeof task.id === 'string', `delegate: ${made.text.slice(0, 300)}`);
    assert(task.status === 'active', `a task runner's task starts on its own: ${task.status} ${made.text.slice(0, 300)}`);
    // The list the runner polls (python/aimeat-crewai daemon: GET /v1/agents/<name>/tasks?status=active).
    const polled = await json(`/v1/agents/${runner.name}/tasks?status=active`, { headers: auth(runner.token) });
    assert((polled.body?.data?.tasks ?? []).some((t: any) => t.id === task.id), `the runner finds it: ${polled.status} ${JSON.stringify(polled.body?.error)}`);
    const done = await json(`/v1/agents/${runner.name}/tasks/${task.id}/complete`, {
        method: 'POST', headers: auth(runner.token), body: JSON.stringify({ message: 'Three lines written' }),
    });
    assert(done.status === 200 && done.body.data.task.status === 'done', `the runner completes it: ${done.status} ${JSON.stringify(done.body?.error)}`);
    // The delegator reads back the task it created (aimeat_task_get answers the creator, 2026-08-15).
    const seen = await callTool(session, 'aimeat_task_get', { task_id: task.id });
    const back = seen.data?.task ?? seen.data;
    assert(!seen.isError && back?.status === 'done', `the chat AI sees it done: ${seen.text.slice(0, 300)}`);
    // The runner works for its own owner: another account's agent cannot hand it work.
    const foreign = await json(`/v1/agents/${encodeURIComponent(runner.gaii)}/tasks`, {
        method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ title: 'not yours', description: 'x' }),
    });
    assert(foreign.status === 403, `another account's agent delegated to the runner: ${foreign.status} ${JSON.stringify(foreign.body?.error)}`);
});

h.finish();

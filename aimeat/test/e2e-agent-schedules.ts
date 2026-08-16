/**
 * @file test/e2e-agent-schedules.ts
 * @description The schedule surface end to end: create, list, trigger, constraints, authorization,
 *   pause/resume/cancel, cross-agent targeting and the calendar occurrence projection.
 * @structure Ten phases, in the order a schedule lives: create, list, trigger, constraints, failure,
 *   authorization, lifecycle, agent budget defaults, cross-agent targeting, occurrences.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-agent-schedules
 * @version-history
 *   v1.1.0 — 2026-08-11 — 4e/4f: the length cut on description/purpose and cron validation on EDIT.
 *     Both moved into services/schedule-write.ts with the August 2026 audit step 8, where the MCP
 *     schedule tools now call them too; neither had a test on this door either.
 *   v1.0.0 — 2026-06-03 — Initial
 */

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature } : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
async function registerOwnerAndAgent(prefix: string, agentName: string) {
    const ownerName = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `owner reg: ${JSON.stringify(reg.body)}`);
    const ownerToken = await getToken(ownerName, reg.body.data.private_key, false);
    const ar = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory', 'actions'] }),
    });
    assert(ar.status === 201, `agent reg: ${JSON.stringify(ar.body)}`);
    return { ownerName, ownerToken, agentName, agentGaii: ar.body.data.agent.gaii };
}
async function registerAgent(ownerName: string, ownerToken: string, agentName: string) {
    const ar = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory', 'actions'] }),
    });
    assert(ar.status === 201, `agent reg: ${JSON.stringify(ar.body)}`);
    const gaii = ar.body.data.agent.gaii;
    const token = await getToken(gaii, ar.body.data.private_key, true);
    return { agentName, gaii, token };
}

console.log('\n=== AIMEAT Agent Schedules E2E Test ===\n');

const o1 = await registerOwnerAndAgent('schedowner', 'schedbot');
const o2 = await registerOwnerAndAgent('schedother', 'otherbot');
const auth1 = { Authorization: `Bearer ${o1.ownerToken}` };
const auth2 = { Authorization: `Bearer ${o2.ownerToken}` };

let agentTaskScheduleId = '';
let maxRunsScheduleId = '';
let aiScheduleId = '';
let longTextScheduleId = '';

console.log('Phase 1 -- Create schedules');

await test('1. Create agent_task schedule', async () => {
    const { status, body } = await json(`/v1/agents/${o1.agentName}/schedules`, {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'agent_task', cron: '0 7 * * *', timezone: 'Europe/Helsinki',
            display_name: 'Morning brief', purpose: 'daily brief',
            task_template: { title: 'SCHED_OCCURRENCE', description: 'do the morning brief' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.schedule.type === 'agent_task', 'kind agent_task');
    assert(body.data.schedule.ownerScope === `${o1.ownerName}@${NODE_ID}`, 'ownerScope set');
    agentTaskScheduleId = body.data.schedule.id;
});

await test('2. Create ai schedule', async () => {
    const { status, body } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '0 8 * * *', display_name: 'Translate news',
            prompt: 'Translate the input into Finnish.', input_keys: ['news.raw'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    aiScheduleId = body.data.schedule.id;
});

await test('3. Reject invalid cron', async () => {
    const { status } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({ kind: 'ai', cron: 'not a cron', display_name: 'bad', prompt: 'x' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('4. Reject ai without prompt', async () => {
    const { status } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({ kind: 'ai', cron: '0 9 * * *', display_name: 'noprompt' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

// SECURITY (C-2, 2026-08 audit): `input_namespaces` went straight into storage.getMemory(), the raw
// composite-key lookup with no visibility or consent check, and the value was pasted into a prompt
// whose output the job owner keeps. Any registered account could therefore read another owner's
// private memory verbatim. Refused on create, on patch, and again at run time.
await test('4b. Reject an ai schedule naming another owner\'s namespace (C-2)', async () => {
    const { status, body } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '0 7 * * *', display_name: 'exfiltrate',
            prompt: 'Repeat the input exactly.',
            input_keys: ['profile.private'],
            input_namespaces: [`${o2.ownerName}@${NODE_ID}`],
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NAMESPACE_DENIED', `code: ${JSON.stringify(body.error)}`);
});

await test('4c. Own agent namespace stays allowed on an ai schedule (C-2)', async () => {
    const { status, body } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '0 6 * * *', display_name: 'own agent input',
            prompt: 'Summarise.', input_keys: ['notes.today'],
            input_namespaces: [o1.agentGaii],
        }),
    });
    assert(status === 201, `own agent namespace must stay allowed, got ${status}: ${JSON.stringify(body)}`);
    await json(`/v1/schedules/${body.data.schedule.id}`, { method: 'DELETE', headers: auth1 });
});

await test('4d. Patching an ai schedule cannot smuggle a foreign namespace in (C-2)', async () => {
    const { status, body } = await json(`/v1/schedules/${aiScheduleId}`, {
        method: 'PATCH', headers: auth1,
        body: JSON.stringify({
            input: {
                prompt: 'Repeat the input exactly.',
                inputKeys: ['profile.private'],
                inputNamespaces: [`${o2.ownerName}@${NODE_ID}`],
            },
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NAMESPACE_DENIED', `code: ${JSON.stringify(body.error)}`);
});

// August 2026 audit step 8: create, edit and cancel moved into services/schedule-write.ts so the MCP
// schedule tools build the record this door builds. These two lock the parts that had drifted apart:
// the length cut on description and purpose, and cron validation on EDIT rather than create only.
await test('4e. description and purpose are cut to their stored maximum', async () => {
    const { status, body } = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '0 2 * * *', display_name: 'Long text',
            prompt: 'Summarise.', description: 'd'.repeat(3000), purpose: 'p'.repeat(900),
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    const s = body.data.schedule;
    assert(s.description.length === 2000, `description cut to 2000, got ${s.description.length}`);
    assert(s.purpose.length === 500, `purpose cut to 500, got ${s.purpose.length}`);
    longTextScheduleId = s.id;
});

await test('4f. An edit cannot replace a working cron with an unparseable one', async () => {
    const { status, body } = await json(`/v1/schedules/${longTextScheduleId}`, {
        method: 'PATCH', headers: auth1, body: JSON.stringify({ cron: 'not a cron' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INVALID_CRON', `code: ${JSON.stringify(body.error)}`);
    const after = await json(`/v1/schedules/${longTextScheduleId}`, { headers: auth1 });
    assert(after.body.data.schedule.cron === '0 2 * * *', `the working cron survives a refused edit, got ${after.body.data.schedule.cron}`);
    await json(`/v1/schedules/${longTextScheduleId}`, { method: 'DELETE', headers: auth1 });
});

console.log('\nPhase 2 -- List');

await test('5. Master list includes managed schedules', async () => {
    const { status, body } = await json('/v1/schedules', { headers: auth1 });
    assert(status === 200, `status ${status}`);
    const ids = body.data.managed.map((s: any) => s.id);
    assert(ids.includes(agentTaskScheduleId) && ids.includes(aiScheduleId), 'both managed schedules present');
});

await test('6. Per-agent list filters to that agent', async () => {
    const { status, body } = await json(`/v1/agents/${o1.agentName}/schedules`, { headers: auth1 });
    assert(status === 200, `status ${status}`);
    const ids = body.data.managed.map((s: any) => s.id);
    assert(ids.includes(agentTaskScheduleId), 'agent_task schedule present in agent view');
});

await test('6b. GET /v1/scheduler/tab folds schedule aggregate + agent names', async () => {
    const { status, body } = await json('/v1/scheduler/tab', { headers: auth1 });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    // schedules mirror GET /v1/schedules
    const single = await json('/v1/schedules', { headers: auth1 });
    const compIds = d.schedules.managed.map((s: any) => s.id).sort();
    const singleIds = single.body.data.managed.map((s: any) => s.id).sort();
    assert(JSON.stringify(compIds) === JSON.stringify(singleIds), 'managed schedules match /v1/schedules');
    assert(compIds.includes(agentTaskScheduleId) && compIds.includes(aiScheduleId), 'both managed schedules present in composite');
    assert(Array.isArray(d.schedules.extensions) && Array.isArray(d.schedules.agentInternal), 'extensions + agentInternal are arrays');
    // agents = the owner's agent names (create-schedule dropdown)
    assert(Array.isArray(d.agents) && d.agents.some((a: any) => a.name === o1.agentName), 'agent list includes the test agent');
    assert(d.agents.every((a: any) => typeof a.name === 'string'), 'agents carry names');
});

console.log('\nPhase 3 -- Trigger + agent_task materialization');

async function listOccurrences(status?: string): Promise<any[]> {
    const q = status ? `?status=${status}&per_page=100` : '?per_page=100';
    const { body } = await json(`/v1/agents/${o1.agentName}/tasks${q}`, { headers: auth1 });
    return (body.data.tasks || []).filter((t: any) => t.title === 'SCHED_OCCURRENCE');
}
async function countOccurrences(): Promise<number> {
    return (await listOccurrences('queued')).length;
}

await test('7. Trigger agent_task → materializes a queued task (outcome=created)', async () => {
    const before = await countOccurrences();
    const { status, body } = await json(`/v1/schedules/${agentTaskScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    assert(status === 200, `trigger status ${status}`);
    assert(body.data.outcome === 'created', `expected outcome=created, got ${body.data.outcome}`);
    assert(typeof body.data.task_id === 'string', 'trigger returns the created task_id');
    const after = await countOccurrences();
    assert(after === before + 1, `expected +1 occurrence (before ${before}, after ${after})`);
});

await test('8. A pending (queued) occurrence makes the next trigger busy (no duplicate)', async () => {
    const before = await countOccurrences();
    const { body } = await json(`/v1/schedules/${agentTaskScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    assert(body.data.outcome === 'busy', `expected outcome=busy, got ${body.data.outcome}`);
    assert(typeof body.data.reason === 'string', 'busy outcome carries a reason');
    const after = await countOccurrences();
    assert(after === before, `expected no new occurrence (before ${before}, after ${after})`);
});

await test('8b. A paused occurrence does NOT block a manual run (the Run-now fix)', async () => {
    // Drive the pending occurrence to paused: queued -> active -> paused.
    const queued = await listOccurrences('queued');
    assert(queued.length >= 1, 'have a queued occurrence to pause');
    const occ = queued[0];
    let r = await json(`/v1/agents/${o1.agentName}/tasks/${occ.id}/start`, { method: 'POST', headers: auth1 });
    assert(r.status === 200, `start occurrence: ${r.status}`);
    r = await json(`/v1/agents/${o1.agentName}/tasks/${occ.id}/pause`, { method: 'POST', headers: auth1 });
    assert(r.status === 200, `pause occurrence: ${r.status}`);
    // The only occurrence is now paused (owner set aside). A manual run must
    // create a fresh occurrence instead of silently skipping.
    const before = await countOccurrences();
    const { body } = await json(`/v1/schedules/${agentTaskScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    assert(body.data.outcome === 'created', `paused must not block; expected created, got ${body.data.outcome}`);
    const after = await countOccurrences();
    assert(after === before + 1, `expected +1 occurrence (before ${before}, after ${after})`);
});

await test('8c. An archived occurrence does NOT block a manual run', async () => {
    // Archive the queued occurrence from 8b so the only occurrences are
    // paused + archived — both set aside; the trigger must still create one.
    const queued = await listOccurrences('queued');
    assert(queued.length >= 1, 'have a queued occurrence to archive');
    const occ = queued[0];
    const tr = await json(`/v1/agents/${o1.agentName}/tasks/${occ.id}/triage`, {
        method: 'PATCH', headers: auth1, body: JSON.stringify({ triage: 'archived' }),
    });
    assert(tr.status === 200, `archive triage: ${tr.status}`);
    const { body } = await json(`/v1/schedules/${agentTaskScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    assert(body.data.outcome === 'created', `archived must not block; expected created, got ${body.data.outcome}`);
});

console.log('\nPhase 4 -- max_runs constraint auto-disable');

await test('9. Create agent_task schedule with max_runs=1', async () => {
    const { status, body } = await json(`/v1/agents/${o1.agentName}/schedules`, {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'agent_task', cron: '0 6 * * *', display_name: 'Capped',
            task_template: { title: 'CAPPED_OCCURRENCE' },
            constraints: [{ type: 'max_runs', enabled: true, params: { limit: 1 } }],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    maxRunsScheduleId = body.data.schedule.id;
});

await test('10. After one run, max_runs auto-disables the schedule', async () => {
    await json(`/v1/schedules/${maxRunsScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    const { body } = await json(`/v1/schedules/${maxRunsScheduleId}`, { headers: auth1 });
    assert(body.data.schedule.enabled === false, `expected disabled after max_runs, got enabled=${body.data.schedule.enabled}`);
    assert((body.data.schedule.runCount ?? 0) >= 1, 'runCount advanced');
});

console.log('\nPhase 5 -- ai failure mode (no OpenRouter key)');

await test('11. Triggering ai schedule without key records an error run', async () => {
    await json(`/v1/schedules/${aiScheduleId}/trigger`, { method: 'POST', headers: auth1 });
    const { body } = await json(`/v1/schedules/${aiScheduleId}`, { headers: auth1 });
    assert(body.data.schedule.lastRunResult === 'error', `expected error result, got ${body.data.schedule.lastRunResult}`);
    assert(Array.isArray(body.data.runs) && body.data.runs.length > 0, 'has execution log entries');
});

console.log('\nPhase 6 -- Authorization');

await test('12. Cross-owner cannot delete another owner\'s schedule', async () => {
    const { status } = await json(`/v1/schedules/${agentTaskScheduleId}`, { method: 'DELETE', headers: auth2 });
    assert(status === 403 || status === 404, `expected 403/404, got ${status}`);
});

await test('12b. Cross-owner cannot TRIGGER another owner\'s schedule — the one that spends', async () => {
    // Cross-owner is proved for DELETE (12), the list (13), the occurrences projection (24) and
    // targeting (20) — never for the trigger, which is the operation that costs money. Delete the
    // canManageSchedule guard in triggerScheduleRecord and owner 2 fires owner 1's `ai` schedules and
    // charges the AI spend to owner 1; every trigger in this suite is fired by its own owner or by the
    // creating sibling agent, so tests 7, 8, 8b, 8c, 10, 11 and 18 all stay green.
    const before = await countOccurrences();
    const { status, body } = await json(`/v1/schedules/${agentTaskScheduleId}/trigger`, { method: 'POST', headers: auth2 });
    assert(status === 403 || status === 404, `another owner fired this schedule: ${status} ${JSON.stringify(body?.data ?? body?.error)}`);
    assert(await countOccurrences() === before, 'and it materialised an occurrence anyway');

    // The AI schedule is the sharper case: firing it spends the owner's budget.
    const ai = await json(`/v1/schedules/${aiScheduleId}/trigger`, { method: 'POST', headers: auth2 });
    assert(ai.status === 403 || ai.status === 404, `another owner fired an AI schedule: ${ai.status}`);
});

await test('13. Cross-owner master list does not leak the schedule', async () => {
    const { body } = await json('/v1/schedules', { headers: auth2 });
    const ids = (body.data.managed || []).map((s: any) => s.id);
    assert(!ids.includes(agentTaskScheduleId), 'other owner schedule not visible');
});

console.log('\nPhase 7 -- Pause / resume / cancel');

await test('14. Pause (enabled=false) then resume', async () => {
    let r = await json(`/v1/schedules/${aiScheduleId}`, { method: 'PATCH', headers: auth1, body: JSON.stringify({ enabled: false }) });
    assert(r.status === 200 && r.body.data.schedule.enabled === false, 'paused');
    r = await json(`/v1/schedules/${aiScheduleId}`, { method: 'PATCH', headers: auth1, body: JSON.stringify({ enabled: true }) });
    assert(r.status === 200 && r.body.data.schedule.enabled === true, 'resumed');
});

await test('15. Delete schedule', async () => {
    const { status } = await json(`/v1/schedules/${aiScheduleId}`, { method: 'DELETE', headers: auth1 });
    assert(status === 200, `delete status ${status}`);
    const { status: getStatus } = await json(`/v1/schedules/${aiScheduleId}`, { headers: auth1 });
    assert(getStatus === 404, `expected 404 after delete, got ${getStatus}`);
});

console.log('\nPhase 8 -- Agent budget defaults');

await test('16. Owner sets agent schedule-constraint defaults', async () => {
    const { status, body } = await json(`/v1/agents/${o1.agentName}/schedule-constraints`, {
        method: 'PATCH', headers: auth1,
        body: JSON.stringify({ daily_spend_limit: 2, constraints: [{ type: 'max_runs', enabled: true, params: { limit: 5 } }] }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.daily_spend_limit === 2, 'daily_spend_limit saved');
});

console.log('\nPhase 9 -- Cross-agent targeting (sibling agent token, no token-borrowing)');

let sibling: { agentName: string; gaii: string; token: string };
await test('17. Register a sibling agent under owner 1', async () => {
    sibling = await registerAgent(o1.ownerName, o1.ownerToken, 'schedsibling');
    assert(!!sibling.token, 'got sibling agent token');
});

await test('18. Sibling token schedules schedbot via path → targets schedbot, fires into schedbot queue', async () => {
    const create = await json(`/v1/agents/${o1.agentName}/schedules`, {
        method: 'POST', headers: { Authorization: `Bearer ${sibling.token}` },
        body: JSON.stringify({
            kind: 'agent_task', cron: '0 5 * * *', display_name: 'Cross-agent dispatch',
            task_template: { title: 'XAGENT_OCCURRENCE', description: 'created by sibling, must run in schedbot queue' },
        }),
    });
    assert(create.status === 201, `status ${create.status}: ${JSON.stringify(create.body)}`);
    const sched = create.body.data.schedule;
    assert(sched.agentName === o1.agentName, `target should be ${o1.agentName} (path), got ${sched.agentName}`);
    assert(sched.agentGaii === o1.agentGaii, 'agentGaii resolves to the target agent (same owner)');
    assert(sched.createdByAgent === true, 'createdByAgent true (creating agent can manage it)');
    assert(sched.createdBy === sibling.gaii, `createdBy records the real creator (${sibling.gaii}), got ${sched.createdBy}`);
    // The creating sibling can trigger its OWN cross-agent schedule (canManage), and the
    // occurrence must land in the TARGET's (schedbot) queue — not the creator's.
    const trig = await json(`/v1/schedules/${sched.id}/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${sibling.token}` } });
    assert(trig.status === 200, `sibling trigger status ${trig.status}`);
    const tasks = await json(`/v1/agents/${o1.agentName}/tasks?status=queued&per_page=100`, { headers: auth1 });
    const found = (tasks.body.data.tasks || []).filter((t: any) => t.title === 'XAGENT_OCCURRENCE').length;
    assert(found >= 1, `expected occurrence in ${o1.agentName} queue, found ${found}`);
});

await test('19. target_agent body alias targets the sibling on the /v1/schedules root', async () => {
    const { status, body } = await json('/v1/schedules', {
        method: 'POST', headers: { Authorization: `Bearer ${sibling.token}` },
        body: JSON.stringify({
            kind: 'agent_task', cron: '0 4 * * *', display_name: 'Alias target',
            target_agent: o1.agentName, task_template: { title: 'ALIAS_OCCURRENCE' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.schedule.agentName === o1.agentName, `alias target should be ${o1.agentName}, got ${body.data.schedule.agentName}`);
});

await test('20. Cross-owner target is rejected (sibling cannot schedule another owner\'s agent)', async () => {
    const { status } = await json(`/v1/agents/${o2.agentName}/schedules`, {
        method: 'POST', headers: { Authorization: `Bearer ${sibling.token}` },
        body: JSON.stringify({ kind: 'agent_task', cron: '0 3 * * *', display_name: 'x', task_template: { title: 'x' } }),
    });
    assert(status === 404 || status === 403, `expected 404/403 cross-owner, got ${status}`);
});

console.log('\nPhase 10 -- Occurrences projection (calendar)');

function occUrl(from: Date, to: Date): string {
    return `/v1/schedules/occurrences?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

await test('21. Occurrences projects the enabled daily schedule into the window', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 4 * 86400000);
    const { status, body } = await json(occUrl(from, to), { headers: auth1 });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.occurrences), 'occurrences array present');
    const mine = body.data.occurrences.filter((o: any) => o.scheduleId === agentTaskScheduleId);
    assert(mine.length >= 3, `expected the daily "0 7 * * *" schedule to project ≥3 fires in 4 days, got ${mine.length}`);
    for (const o of mine) {
        const at = new Date(o.at).getTime();
        assert(at >= from.getTime() && at <= to.getTime(), `occurrence ${o.at} within [from,to]`);
    }
});

await test('22. Occurrences excludes disabled schedules', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86400000);
    const { body } = await json(occUrl(from, to), { headers: auth1 });
    const ids = new Set(body.data.occurrences.map((o: any) => o.scheduleId));
    assert(!ids.has(maxRunsScheduleId), 'the max_runs auto-disabled schedule is not projected');
});

await test('23. Occurrences rejects an inverted range (to <= from)', async () => {
    const from = new Date();
    const to = new Date(from.getTime() - 86400000);
    const { status } = await json(occUrl(from, to), { headers: auth1 });
    assert(status === 400, `expected 400 for inverted range, got ${status}`);
});

await test('24. Occurrences is owner-scoped (cross-owner cannot see the schedule)', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86400000);
    const { body } = await json(occUrl(from, to), { headers: auth2 });
    const ids = new Set((body.data.occurrences || []).map((o: any) => o.scheduleId));
    assert(!ids.has(agentTaskScheduleId), "another owner's schedule is not projected for auth2");
});

await test('25. Occurrences requires auth', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 86400000);
    const { status } = await json(occUrl(from, to));
    assert(status === 401, `expected 401 without auth, got ${status}`);
});

await test('26. High-frequency crons are summarized in `frequent`, not enumerated in `occurrences`', async () => {
    // A "*/5 * * * *" cron (288 fires/day) must NOT flood the grid: it belongs in
    // the `frequent` cadence summary, and must be absent from `occurrences`.
    const mk = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '*/5 * * * *', display_name: 'Frequent poll',
            prompt: 'poll', input_keys: ['x'],
        }),
    });
    assert(mk.status === 201, `create status ${mk.status}: ${JSON.stringify(mk.body)}`);
    const freqId = mk.body.data.schedule.id;

    const from = new Date();
    const to = new Date(from.getTime() + 2 * 86400000);
    const { status, body } = await json(occUrl(from, to), { headers: auth1 });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.frequent), '`frequent` array present');

    const inOcc = body.data.occurrences.some((o: any) => o.scheduleId === freqId);
    assert(!inOcc, 'high-frequency schedule must NOT be enumerated into occurrences');

    const summary = body.data.frequent.find((f: any) => f.scheduleId === freqId);
    assert(summary, 'high-frequency schedule appears in `frequent`');
    assert(summary.intervalMinutes === 5, `intervalMinutes 5, got ${summary.intervalMinutes}`);
    assert(summary.approxPerDay >= 200, `approxPerDay ~288, got ${summary.approxPerDay}`);

    // The daily schedule stays in occurrences (not misclassified as frequent).
    const dailyStillEnumerated = body.data.occurrences.some((o: any) => o.scheduleId === agentTaskScheduleId);
    assert(dailyStillEnumerated, 'daily "0 7 * * *" schedule stays in occurrences');
    const dailyNotFrequent = !body.data.frequent.some((f: any) => f.scheduleId === agentTaskScheduleId);
    assert(dailyNotFrequent, 'daily schedule must not be classified frequent');
});

console.log('\nCleanup');
await test('Cascade-delete owner 1', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(o1.ownerName)}`, { method: 'DELETE', headers: auth1 });
    assert(status === 200, `status ${status}`);
});
await test('Cascade-delete owner 2', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(o2.ownerName)}`, { method: 'DELETE', headers: auth2 });
    assert(status === 200, `status ${status}`);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Schedules E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

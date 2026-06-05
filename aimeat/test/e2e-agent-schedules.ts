// E2E Tests for Agent/Profile Schedules
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-agent-schedules

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
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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

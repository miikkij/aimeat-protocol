/**
 * @file test/e2e-agent-schedules.ts
 * @description The schedule surface end to end: create, list, trigger, constraints, authorization,
 *   pause/resume/cancel, cross-agent targeting and the calendar occurrence projection.
 * @structure Ten phases, in the order a schedule lives: create, list, trigger, constraints, failure,
 *   authorization, lifecycle, agent budget defaults, cross-agent targeting, occurrences.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-agent-schedules
 * @version-history
 *   2026-10-21 — 45 and 46 (capability-loss review): a narrowed maker's refusal tells the owner where to
 *     allow the word and runs again after; an app's agent_task schedule from before 2026-10-05 still runs.
 *   2026-10-20 — Phase 13 (secaudit 2026-10, runAgentTaskJob:fires-without-asking-maker): an
 *     agent_task schedule whose maker the owner deleted, or narrowed to drop task:write, puts no task
 *     in the target's queue and the run log says why; a live maker's schedule still does.
 *   2026-10-20 — Phase 12 (secaudit 2026-10): who manages whose schedule, by the caller's KIND —
 *     an ecosystem app manages only what it made, an agent manages no app-made schedule, and a
 *     sibling agent still manages an agent-made one; and an `ai` schedule's output_visibility is
 *     refused at create and at edit when it names an organism the owner is not a member of.
 *   2026-10-19 — 11b: a one-shot (max_runs 1) whose run fails is turned off, keeps lastRunError and
 *     shows no nextRunAt (wish a-failed-one-shot-schedule-does-not-wait-a-year).
 *   2026-10-16 — 20b: a sibling without ai:use is refused editing and running another agent's ai
 *     schedule (403 SCOPE_DENIED), pausing it needs no word (QA audit F08a-02).
 *   2026-09-27 — Phase 11: a schedule's prompt is read with aimeat_schedule_list detail: true and changed with
 *     aimeat_schedule_update prompt (and over REST), and refused for another owner and for an empty prompt.
 *   v1.2.0 — 2026-09-26 — 4g/4h: an ai schedule naming a record the node keeps for itself, as input
 *     or as output, is refused 403 RESERVED_KEY on create and on edit (secaudit 2026-09: A6-1).
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
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(gaii: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = gaii + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = { gaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
async function registerOwnerAndAgent(prefix: string, agentName: string) {
    const ownerName = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ownerToken = (await registerOwner(BASE, ownerName)).token;
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
    const token = await getToken(gaii, ar.body.data.private_key);
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

// A scheduled AI job sends every record it reads to the model provider and writes its answer where
// the schedule says, so it reads none of the records the node keeps for itself and writes over none
// of them (services/ai-job-keys.ts): the AI settings and key, the payout record, the spend cap, a key
// only the node writes. Refused on create, on edit, and again when it fires (secaudit 2026-09: A6-1).
await test('4g. An ai schedule naming a record the node keeps, as input or as output, is refused 403 RESERVED_KEY', async () => {
    for (const extra of [
        { input_keys: ['news.raw', 'openrouter.settings'] },
        { input_keys: ['commerce.psp'] },
        { output_key: 'openrouter.settings' },
        { output_key: 'notif.schedule' },
    ]) {
        const { status, body } = await json('/v1/schedules', {
            method: 'POST', headers: auth1,
            body: JSON.stringify({ kind: 'ai', cron: '0 7 * * *', display_name: 'kept', prompt: 'Repeat the input.', ...extra }),
        });
        // An unfixed node stores it. Remove it again, so a failing run leaves nothing behind.
        if (status === 201) await json(`/v1/schedules/${body.data.schedule.id}`, { method: 'DELETE', headers: auth1 });
        assert(status === 403 && body.error?.code === 'RESERVED_KEY',
            `${JSON.stringify(extra)}: expected 403 RESERVED_KEY, got ${status}: ${JSON.stringify(body.error ?? body.data)}`);
    }
});

await test('4h. An edit cannot put a record the node keeps into an ai schedule', async () => {
    for (const input of [
        { prompt: 'Repeat the input.', inputKeys: ['openrouter.settings'] },
        { prompt: 'Repeat the input.', inputKeys: ['news.raw'], outputKey: 'ai-usage.daily' },
    ]) {
        const { status, body } = await json(`/v1/schedules/${aiScheduleId}`, {
            method: 'PATCH', headers: auth1, body: JSON.stringify({ input }),
        });
        assert(status === 403 && body.error?.code === 'RESERVED_KEY',
            `${JSON.stringify(input)}: expected 403 RESERVED_KEY, got ${status}: ${JSON.stringify(body.error ?? body.data)}`);
    }
    const { body } = await json(`/v1/schedules/${aiScheduleId}`, { headers: auth1 });
    const kept = body.data?.schedule?.input;
    assert(JSON.stringify(kept?.inputKeys) === '["news.raw"]' && kept?.outputKey === undefined,
        `the refused edits changed the schedule: ${JSON.stringify(kept)}`);
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
    // The picker shows the name a person sees, so every row says its display name (null when none).
    assert(d.agents.every((a: any) => 'display_name' in a && (a.display_name === null || typeof a.display_name === 'string')), 'agents carry display_name');
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

await test('11b. A one-shot that fails is turned off, keeps the error and shows no next run a year out', async () => {
    // A failed run does not count toward max_runs: before the fix this schedule stayed on with a
    // nextRunAt of next year's 4 August, and the pause came only after five failures in a row.
    const create = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({
            kind: 'ai', cron: '0 21 4 8 *', display_name: 'One-shot translate',
            prompt: 'Translate the input into Finnish.', input_keys: ['news.raw'],
            constraints: [{ type: 'max_runs', enabled: true, params: { limit: 1 } }],
        }),
    });
    assert(create.status === 201, `status ${create.status}: ${JSON.stringify(create.body)}`);
    const id = create.body.data.schedule.id;
    await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth1 });
    const { body } = await json(`/v1/schedules/${id}`, { headers: auth1 });
    const s = body.data.schedule;
    assert(s.lastRunResult === 'error', `expected an error run (no AI key), got ${s.lastRunResult}`);
    assert(typeof s.lastRunError === 'string' && s.lastRunError.length > 0, 'lastRunError kept');
    assert(s.enabled === false, `a failed one-shot must not stay on, got enabled=${s.enabled} nextRunAt=${s.nextRunAt}`);
    assert(!s.nextRunAt, `a schedule that is off has no next run, got ${s.nextRunAt}`);
    assert((s.runCount ?? 0) === 0, `a failed run is not counted, got runCount=${s.runCount}`);
    await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth1 });
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

// QA audit F08a-02: a sibling manages an agent-made schedule (decision 2026-10-12, Q4), and editing or
// running it asks the word for what it drives, as creating it does. The schedule fires as its maker,
// so a sibling without ai:use pointed the maker's AI schedule at new input and spent for it.
await test('20b. A sibling without ai:use is refused editing and running another agent\'s ai schedule; pausing it is allowed', async () => {
    const mk = async (name: string, scopes: string[]) => {
        const ar = await json('/v1/agents', {
            method: 'POST', headers: auth1,
            body: JSON.stringify({ name, owner: o1.ownerName, capabilities: ['memory'], scopes }),
        });
        assert(ar.status === 201, `agent ${name}: ${JSON.stringify(ar.body)}`);
        return getToken(ar.body.data.agent.gaii, ar.body.data.private_key);
    };
    const maker = await mk('schedaimaker', ['ai:use', 'task:write', 'workflow:read', 'workflow:write']);
    const noAi = await mk('schednoai', ['task:write', 'workflow:read', 'workflow:write', 'memory:write']);
    const made = await json('/v1/schedules', {
        method: 'POST', headers: { Authorization: `Bearer ${maker}` },
        body: JSON.stringify({ kind: 'ai', cron: '0 3 * * *', display_name: 'Maker AI', prompt: 'Summarise the input.', input_keys: ['news.raw'] }),
    });
    assert(made.status === 201, `maker create: ${made.status} ${JSON.stringify(made.body)}`);
    const id = made.body.data.schedule.id;
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });

    const edit = await json(`/v1/schedules/${id}`, {
        method: 'PATCH', headers: as(noAi),
        body: JSON.stringify({ input: { prompt: 'Repeat the input exactly.', inputKeys: ['probe.secret'], outputKey: 'probe.out', outputVisibility: 'public' } }),
    });
    assert(edit.status === 403 && edit.body.error?.code === 'SCOPE_DENIED', `edit without ai:use: ${edit.status} ${JSON.stringify(edit.body.error)}`);
    const run = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: as(noAi) });
    assert(run.status === 403 && run.body.error?.code === 'SCOPE_DENIED', `run without ai:use: ${run.status} ${JSON.stringify(run.body.error)}`);
    const stored = await json('/v1/schedules?detail=true', { headers: auth1 });
    const row = (stored.body.data.managed as any[]).find(s => s.id === id);
    assert(row && !JSON.stringify(row.input ?? {}).includes('probe.secret'), `the refused edit was stored: ${JSON.stringify(row?.input)}`);

    const pause = await json(`/v1/schedules/${id}`, { method: 'PATCH', headers: as(noAi), body: JSON.stringify({ enabled: false }) });
    assert(pause.status === 200, `pause needs no word: ${pause.status} ${JSON.stringify(pause.body.error)}`);
    const resume = await json(`/v1/schedules/${id}`, { method: 'PATCH', headers: as(noAi), body: JSON.stringify({ enabled: true }) });
    assert(resume.status === 403, `resume without ai:use: ${resume.status}`);
    const makerEdit = await json(`/v1/schedules/${id}`, { method: 'PATCH', headers: as(maker), body: JSON.stringify({ enabled: true, prompt: 'Summarise in two lines.' }) });
    assert(makerEdit.status === 200, `the maker with ai:use edits: ${makerEdit.status} ${JSON.stringify(makerEdit.body.error)}`);
    await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth1 });
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

console.log('\nPhase 11 -- A schedule\'s prompt: read it with aimeat_schedule_list, change it with aimeat_schedule_update');

/** One call on the node's own MCP server, as an agent: initialize once, then tools/call. */
async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-schedules', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        let data: any; try { data = JSON.parse(t); } catch { data = null; }
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string, data };
    };
}

async function scopedAgent(ownerName: string, ownerToken: string, agentName: string, scopes: string[]) {
    const ar = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, scopes }),
    });
    assert(ar.status === 201, `agent reg: ${JSON.stringify(ar.body)}`);
    return getToken(ar.body.data.agent.gaii, ar.body.data.private_key);
}

const promptAgent = await scopedAgent(o1.ownerName, o1.ownerToken, 'promptbot', ['task:write', 'workflow:read', 'workflow:write', 'ai:use']);
const otherPromptAgent = await scopedAgent(o2.ownerName, o2.ownerToken, 'otherprompt', ['task:write', 'workflow:read', 'workflow:write', 'ai:use']);
const call = await mcpSession(promptAgent);
const callOther = await mcpSession(otherPromptAgent);
let promptAiId = '';
let promptTaskId = '';

await test('30. aimeat_schedule_list with detail: true returns each schedule\'s prompt; without it, none', async () => {
    const ai = await call('aimeat_schedule_create', { kind: 'ai', cron: '0 6 * * *', display_name: 'Prompt AI', prompt: 'Summarise the input in three lines.', input_keys: ['notes.today'] });
    assert(!ai.isError, `create ai: ${ai.text}`);
    promptAiId = ai.data.schedule_id;
    const task = await call('aimeat_schedule_create', { kind: 'agent_task', cron: '0 5 * * *', display_name: 'Prompt task', task_title: 'Morning', task_description: 'Read the inbox and list what waits.' });
    assert(!task.isError, `create agent_task: ${task.text}`);
    promptTaskId = task.data.schedule_id;
    const plain = await call('aimeat_schedule_list', {});
    const p = (plain.data?.schedules ?? []).find((s: any) => s.id === promptAiId);
    assert(p && p.prompt === undefined, `no prompt without detail: ${JSON.stringify(p)}`);
    const full = await call('aimeat_schedule_list', { detail: true });
    const a = (full.data?.schedules ?? []).find((s: any) => s.id === promptAiId);
    const t = (full.data?.schedules ?? []).find((s: any) => s.id === promptTaskId);
    assert(a?.prompt === 'Summarise the input in three lines.', `ai prompt: ${JSON.stringify(a)}`);
    assert(t?.prompt === 'Read the inbox and list what waits.' && t?.task_title === 'Morning', `agent_task prompt: ${JSON.stringify(t)}`);
});

await test('31. aimeat_schedule_update sets a new prompt, and the stored schedule carries it', async () => {
    const up = await call('aimeat_schedule_update', { schedule_id: promptAiId, prompt: 'Summarise the input in one line.' });
    assert(!up.isError, `update ai: ${up.text}`);
    const ai = await json(`/v1/schedules/${promptAiId}`, { headers: auth1 });
    assert(ai.body.data.schedule.input.prompt === 'Summarise the input in one line.', `stored: ${JSON.stringify(ai.body.data.schedule.input)}`);
    assert(JSON.stringify(ai.body.data.schedule.input.inputKeys) === '["notes.today"]', 'the rest of the input is kept');
    const up2 = await call('aimeat_schedule_update', { schedule_id: promptTaskId, prompt: 'List what waits, oldest first.' });
    assert(!up2.isError, `update agent_task: ${up2.text}`);
    const task = await json(`/v1/schedules/${promptTaskId}`, { headers: auth1 });
    const tmpl = task.body.data.schedule.input.taskTemplate;
    assert(tmpl.description === 'List what waits, oldest first.' && tmpl.title === 'Morning', `stored template: ${JSON.stringify(tmpl)}`);
});

await test('32. The REST twin: GET /v1/schedules?detail=true names the prompt, PATCH takes it', async () => {
    const list = await json('/v1/schedules?detail=true', { headers: auth1 });
    const row = (list.body.data.managed ?? []).find((s: any) => s.id === promptAiId);
    assert(row?.prompt === 'Summarise the input in one line.', `detail list: ${JSON.stringify(row).slice(0, 300)}`);
    const patch = await json(`/v1/schedules/${promptAiId}`, { method: 'PATCH', headers: auth1, body: JSON.stringify({ prompt: 'Back to three lines.' }) });
    assert(patch.status === 200 && patch.body.data.schedule.input.prompt === 'Back to three lines.', `PATCH: ${patch.status} ${JSON.stringify(patch.body).slice(0, 300)}`);
});

await test('33. A prompt change is refused for another owner\'s schedule, for an empty prompt, and for a kind that has none', async () => {
    const other = await callOther('aimeat_schedule_update', { schedule_id: promptAiId, prompt: 'hijack' });
    assert(other.isError && /FORBIDDEN|NOT_FOUND/.test(other.text), `cross-owner: ${other.text}`);
    const stored = await json(`/v1/schedules/${promptAiId}`, { headers: auth1 });
    assert(stored.body.data.schedule.input.prompt === 'Back to three lines.', 'the prompt is untouched');
    const empty = await call('aimeat_schedule_update', { schedule_id: promptAiId, prompt: '   ' });
    assert(empty.isError && empty.text.startsWith('INVALID_INPUT'), `empty: ${empty.text}`);
    const wf = await json('/v1/schedules', { method: 'POST', headers: auth1, body: JSON.stringify({ kind: 'workflow', cron: '0 2 * * *', display_name: 'wf', workflow_id: 'nope' }) });
    if (wf.status === 201) {
        const r = await json(`/v1/schedules/${wf.body.data.schedule.id}`, { method: 'PATCH', headers: auth1, body: JSON.stringify({ prompt: 'x' }) });
        assert(r.status === 400 && r.body?.error?.code === 'NO_PROMPT', `workflow kind: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
});

console.log('\nPhase 12 -- Who manages whose schedule, and who an ai schedule\'s answer may be shown to');

// secaudit 2026-10, canManageSchedule:createdByAgent-admits-ecosystem-and-app-made. `createdByAgent`
// is set from `!isOwnerSession`, so it is true for a schedule made by an agent, by an app grant AND
// by an ecosystem app. canManageSchedule read it as "an agent made this" and its fallback as "the
// caller is an agent", so a connected ecosystem app deleted the owner's agents' schedules and an
// agent edited an app's. The ruling (Q4, 2026-10-12): the owner manages everything, an agent
// manages what AGENTS of that owner made, an app manages only its own grant's.
const REDIRECT = 'http://localhost:9913/schedules-callback';

/** An app-grant token for a freshly published app of `owner`, with the scopes named. */
async function appGrantToken(ownerToken: string, ownerName: string, filename: string, scope: string): Promise<string> {
    const html = `<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="${scope}"></head><body>sched</body></html>`;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            filename, content: Buffer.from(html).toString('base64'),
            name: `Sched ${filename}`, description: 'schedule manage-rule e2e probe', category: 'utility',
        }),
    });
    assert(pub.status === 201, `publish ${filename}: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${ownerName}/${filename}`, response_type: 'code', scope,
        redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!m, `consent redirect expected, got ${res.status}`);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
    });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.access_token as string;
}

/** A connected ecosystem app (GEAI) of `owner`, through hello → approve → token, and its credential. */
async function ecosystemToken(ownerToken: string, ownerName: string, app: string, scopes: string[]): Promise<string> {
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({
            owner: ownerName, app, display_name: `Eco ${app}`,
            public_key: Buffer.from(`${app}-verification-key`).toString('base64'),
            scopes, manifest: { app, scopes, capabilities: [{ id: 'noop' }] },
        }),
    });
    assert(hello.body.ok === true, `eco hello: ${JSON.stringify(hello.body.error)}`);
    const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ action: 'approve', scopes }),
    });
    assert(approve.status === 200, `eco approve: ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST',
        body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(typeof tok.body.access_token === 'string', `eco token: ${JSON.stringify(tok.body)}`);
    return tok.body.access_token as string;
}

const ECO_SCOPES = ['memory:read', 'memory:write', 'task:write', 'workflow:read', 'workflow:write'];
const MANAGE_SCOPES = ['task:write', 'workflow:read', 'workflow:write', 'memory:write'];

await test('40. An ecosystem app is refused an agent-made schedule and keeps its own', async () => {
    const ecoToken = await ecosystemToken(o1.ownerToken, o1.ownerName, 'schedeco', ECO_SCOPES);
    const agentToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedecoagent', MANAGE_SCOPES);
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });
    const task = { kind: 'agent_task', cron: '0 2 * * *', target_agent: o1.agentName, task_template: { title: 'ECO_RULE' } };

    const byAgent = await json('/v1/schedules', { method: 'POST', headers: as(agentToken), body: JSON.stringify({ ...task, display_name: 'Agent made' }) });
    assert(byAgent.status === 201, `agent create: ${byAgent.status} ${JSON.stringify(byAgent.body?.error)}`);
    const agentMade = byAgent.body.data.schedule.id;

    const byEco = await json('/v1/schedules', { method: 'POST', headers: as(ecoToken), body: JSON.stringify({ ...task, display_name: 'Eco made' }) });
    assert(byEco.status === 201, `eco create: ${byEco.status} ${JSON.stringify(byEco.body?.error)}`);
    const ecoMade = byEco.body.data.schedule.id;

    // The refusal: the ecosystem app reaches neither the agent's edit nor its delete.
    const ecoEdit = await json(`/v1/schedules/${agentMade}`, { method: 'PATCH', headers: as(ecoToken), body: JSON.stringify({ cron: '0 1 * * *' }) });
    assert(ecoEdit.status === 403 && ecoEdit.body.error?.code === 'FORBIDDEN', `eco edited an agent's schedule: ${ecoEdit.status} ${JSON.stringify(ecoEdit.body?.error)}`);
    const ecoDelete = await json(`/v1/schedules/${agentMade}`, { method: 'DELETE', headers: as(ecoToken) });
    assert(ecoDelete.status === 403 && ecoDelete.body.error?.code === 'FORBIDDEN', `eco deleted an agent's schedule: ${ecoDelete.status} ${JSON.stringify(ecoDelete.body?.error)}`);
    const still = await json(`/v1/schedules/${agentMade}`, { headers: auth1 });
    assert(still.status === 200, `the agent's schedule is gone anyway: ${still.status}`);

    // The positive control: it still manages the one it made itself.
    const ownEdit = await json(`/v1/schedules/${ecoMade}`, { method: 'PATCH', headers: as(ecoToken), body: JSON.stringify({ display_name: 'Eco made, renamed' }) });
    assert(ownEdit.status === 200, `eco cannot edit its own schedule: ${ownEdit.status} ${JSON.stringify(ownEdit.body?.error)}`);
    const ownDelete = await json(`/v1/schedules/${ecoMade}`, { method: 'DELETE', headers: as(ecoToken) });
    assert(ownDelete.status === 200, `eco cannot delete its own schedule: ${ownDelete.status} ${JSON.stringify(ownDelete.body?.error)}`);

    // And an agent does not manage what the ecosystem app made, either.
    const second = await json('/v1/schedules', { method: 'POST', headers: as(ecoToken), body: JSON.stringify({ ...task, display_name: 'Eco made again' }) });
    assert(second.status === 201, `eco create 2: ${second.status}`);
    const agentOnEco = await json(`/v1/schedules/${second.body.data.schedule.id}`, { method: 'DELETE', headers: as(agentToken) });
    assert(agentOnEco.status === 403, `an agent deleted an ecosystem app's schedule: ${agentOnEco.status}`);
    await json(`/v1/schedules/${second.body.data.schedule.id}`, { method: 'DELETE', headers: auth1 });
    await json(`/v1/schedules/${agentMade}`, { method: 'DELETE', headers: auth1 });
});

await test('41. An agent is refused an app-made schedule, and a sibling agent still manages an agent-made one', async () => {
    const appToken = await appGrantToken(o1.ownerToken, o1.ownerName, 'sched-grant.html', 'task:write workflow:write memory:write');
    const agentToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedappagent', MANAGE_SCOPES);
    const siblingToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedappsib', MANAGE_SCOPES);
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });
    const task = { kind: 'agent_task', cron: '0 2 * * *', target_agent: o1.agentName, task_template: { title: 'APP_RULE' } };

    const byApp = await json('/v1/schedules', { method: 'POST', headers: as(appToken), body: JSON.stringify({ ...task, display_name: 'App made' }) });
    assert(byApp.status === 201, `app create: ${byApp.status} ${JSON.stringify(byApp.body?.error)}`);
    const appMade = byApp.body.data.schedule.id;
    assert(typeof byApp.body.data.schedule.createdByApp === 'string', `the app's schedule records no grant: ${JSON.stringify(byApp.body.data.schedule)}`);

    // The refusal: an app grant is limited to its own purpose, so the owner's agents do not reach it.
    const edit = await json(`/v1/schedules/${appMade}`, { method: 'PATCH', headers: as(agentToken), body: JSON.stringify({ display_name: 'taken over' }) });
    assert(edit.status === 403 && edit.body.error?.code === 'FORBIDDEN', `an agent edited an app's schedule: ${edit.status} ${JSON.stringify(edit.body?.error)}`);
    const del = await json(`/v1/schedules/${appMade}`, { method: 'DELETE', headers: as(agentToken) });
    assert(del.status === 403 && del.body.error?.code === 'FORBIDDEN', `an agent deleted an app's schedule: ${del.status}`);
    const kept = await json(`/v1/schedules/${appMade}`, { headers: auth1 });
    assert(kept.status === 200 && kept.body.data.schedule.displayName === 'App made', `the app's schedule was changed: ${JSON.stringify(kept.body.data?.schedule?.displayName)}`);

    // The positive control: Q4 (2026-10-12) still holds between agents of the same owner.
    const byAgent = await json('/v1/schedules', { method: 'POST', headers: as(agentToken), body: JSON.stringify({ ...task, display_name: 'Agent made, for a sibling' }) });
    assert(byAgent.status === 201, `agent create: ${byAgent.status} ${JSON.stringify(byAgent.body?.error)}`);
    const agentMade = byAgent.body.data.schedule.id;
    const sibEdit = await json(`/v1/schedules/${agentMade}`, { method: 'PATCH', headers: as(siblingToken), body: JSON.stringify({ display_name: 'Sibling renamed it' }) });
    assert(sibEdit.status === 200, `a sibling agent cannot edit an agent-made schedule: ${sibEdit.status} ${JSON.stringify(sibEdit.body?.error)}`);
    const sibDelete = await json(`/v1/schedules/${agentMade}`, { method: 'DELETE', headers: as(siblingToken) });
    assert(sibDelete.status === 200, `a sibling agent cannot delete an agent-made schedule: ${sibDelete.status}`);

    // And the owner still manages the app's, as they manage everything they own.
    const ownerDelete = await json(`/v1/schedules/${appMade}`, { method: 'DELETE', headers: auth1 });
    assert(ownerDelete.status === 200, `the owner cannot delete the app's schedule: ${ownerDelete.status}`);
});

// secaudit2026oct22, aimeat_schedule_list:createdByAgent-filter-without-word. The MCP list kept every
// schedule with createdByAgent set, which an app grant and an ecosystem app also set, so an agent
// without workflow:read read their prompts while GET /v1/schedules refused it.
await test('41b. aimeat_schedule_list shows an agent its own and its siblings\' schedules, and the app-made ones only with workflow:read', async () => {
    const appToken = await appGrantToken(o1.ownerToken, o1.ownerName, 'sched-list-grant.html', 'task:write workflow:write memory:write');
    const ecoToken = await ecosystemToken(o1.ownerToken, o1.ownerName, 'schedlisteco', ECO_SCOPES);
    const sibToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedlistsib', MANAGE_SCOPES);
    const narrowToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedlistnarrow', ['task:write']);
    const wideToken = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedlistwide', ['task:write', 'workflow:read']);
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });
    const task = (title: string) => ({ kind: 'agent_task', cron: '0 2 * * *', target_agent: o1.agentName, display_name: title, task_template: { title, description: `${title} prompt` } });
    const made = async (t: string, title: string) => {
        const r = await json('/v1/schedules', { method: 'POST', headers: as(t), body: JSON.stringify(task(title)) });
        assert(r.status === 201, `create ${title}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        return r.body.data.schedule.id as string;
    };
    const appMade = await made(appToken, 'LIST_APP');
    const ecoMade = await made(ecoToken, 'LIST_ECO');
    const sibMade = await made(sibToken, 'LIST_SIB');

    const rest = await json('/v1/schedules?detail=true', { headers: as(narrowToken) });
    assert(rest.status === 403, `REST twin without workflow:read: ${rest.status}`);
    const narrow = await (await mcpSession(narrowToken))('aimeat_schedule_list', { detail: true });
    assert(!narrow.isError, `narrow list: ${narrow.text}`);
    const narrowIds = (narrow.data?.schedules ?? []).map((s: any) => s.id);
    assert(!narrowIds.includes(appMade), 'an agent without workflow:read listed an app-made schedule');
    assert(!narrowIds.includes(ecoMade), 'an agent without workflow:read listed an ecosystem-app-made schedule');
    assert(narrowIds.includes(sibMade), 'a sibling agent\'s schedule is no longer listed');

    const wide = await (await mcpSession(wideToken))('aimeat_schedule_list', { detail: true });
    const wideIds = (wide.data?.schedules ?? []).map((s: any) => s.id);
    assert(wideIds.includes(appMade) && wideIds.includes(ecoMade) && wideIds.includes(sibMade), `with workflow:read the owner-wide list: ${JSON.stringify(wideIds)}`);

    for (const id of [appMade, ecoMade, sibMade]) await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth1 });
});

// secaudit 2026-10, runAiJob:raw-setMemory-unvalidated-outputVisibility. The create door stored any
// string as outputVisibility and the edit door replaced the input wholesale, so a schedule carried
// `organism:<id>` for an organism the owner is not a member of and the fire wrote the model's answer
// at that audience. The same write by hand is refused 400 NOT_ORGANISM_MEMBER.
await test('42. An ai schedule may not be pointed at an organism the owner is not in, at create or at edit', async () => {
    const foreign = await json('/v1/organisms', {
        method: 'POST', headers: auth2,
        body: JSON.stringify({ name: `SchedForeign${Date.now()}`, description: 'owner 1 is not a member' }),
    });
    assert(foreign.status === 201, `organism: ${foreign.status} ${JSON.stringify(foreign.body?.error)}`);
    const orgId = (foreign.body.data.organism ?? foreign.body.data).id as string;
    assert(!!orgId, `no organism id: ${JSON.stringify(foreign.body.data)}`);

    const maker = await scopedAgent(o1.ownerName, o1.ownerToken, 'schedvisbot', ['ai:use', 'task:write', 'workflow:read', 'workflow:write']);
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });
    const base = { kind: 'ai', cron: '0 9 * * *', prompt: 'Summarise the input.', input_keys: ['news.raw'] };

    // The owner's own hand is refused the same audience, which is the rule this schedule walked around.
    const direct = await json('/v1/memory', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({ key: `sched.vis.probe.${Date.now()}`, value: 'x', visibility: `organism:${orgId}` }),
    });
    assert(direct.status === 400 && direct.body.error?.code === 'NOT_ORGANISM_MEMBER',
        `the direct write was allowed: ${direct.status} ${JSON.stringify(direct.body?.error)}`);

    const refusedCreate = await json('/v1/schedules', {
        method: 'POST', headers: as(maker),
        body: JSON.stringify({ ...base, display_name: 'Foreign audience', output_key: 'sched.vis.out', output_visibility: `organism:${orgId}` }),
    });
    assert(refusedCreate.status === 400 && refusedCreate.body.error?.code === 'NOT_ORGANISM_MEMBER',
        `create at a foreign organism: ${refusedCreate.status} ${JSON.stringify(refusedCreate.body?.error)}`);

    const nonsense = await json('/v1/schedules', {
        method: 'POST', headers: as(maker),
        body: JSON.stringify({ ...base, display_name: 'Nonsense audience', output_visibility: 'everyone-on-earth' }),
    });
    assert(nonsense.status === 400 && nonsense.body.error?.code === 'INVALID_AI_JOB',
        `a word that is not a visibility: ${nonsense.status} ${JSON.stringify(nonsense.body?.error)}`);

    // The positive control: an ordinary visibility is stored and the schedule works.
    const good = await json('/v1/schedules', {
        method: 'POST', headers: as(maker),
        body: JSON.stringify({ ...base, display_name: 'Own audience', output_key: 'sched.vis.out', output_visibility: 'owner' }),
    });
    assert(good.status === 201, `an ordinary visibility was refused: ${good.status} ${JSON.stringify(good.body?.error)}`);
    const id = good.body.data.schedule.id;
    assert(good.body.data.schedule.input.outputVisibility === 'owner', `stored: ${JSON.stringify(good.body.data.schedule.input)}`);

    // The edit asks the same question, because an edit replaces the input wholesale.
    const refusedEdit = await json(`/v1/schedules/${id}`, {
        method: 'PATCH', headers: as(maker),
        body: JSON.stringify({ input: { prompt: 'Summarise the input.', inputKeys: ['news.raw'], outputKey: 'sched.vis.out', outputVisibility: `organism:${orgId}` } }),
    });
    assert(refusedEdit.status === 400 && refusedEdit.body.error?.code === 'NOT_ORGANISM_MEMBER',
        `edit to a foreign organism: ${refusedEdit.status} ${JSON.stringify(refusedEdit.body?.error)}`);
    const stored = await json(`/v1/schedules/${id}`, { headers: auth1 });
    assert(stored.body.data.schedule.input.outputVisibility === 'owner',
        `the refused edit was stored: ${JSON.stringify(stored.body.data.schedule.input)}`);

    // …and an edit that names an ordinary visibility still goes through.
    const okEdit = await json(`/v1/schedules/${id}`, {
        method: 'PATCH', headers: as(maker),
        body: JSON.stringify({ input: { prompt: 'Summarise in one line.', inputKeys: ['news.raw'], outputKey: 'sched.vis.out', outputVisibility: 'private' } }),
    });
    assert(okEdit.status === 200, `an ordinary edit was refused: ${okEdit.status} ${JSON.stringify(okEdit.body?.error)}`);
    await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth1 });
});

console.log('\nPhase 13 -- An agent_task schedule fires as its maker, asked at every fire');

// secaudit 2026-10, runAgentTaskJob:fires-without-asking-maker. services/schedule-actor.ts states the
// rule: a schedule acts as its maker, the maker is looked up again at every fire, and a maker that is
// gone does not fire. The ai kind asked; agent_task did not, so an agent the owner had deleted kept
// putting its work orders into a sibling's queue, presented as the owner's. The fire now asks, and a
// maker that is gone or no longer holds task:write puts no task in the queue; the run log says why.

const V65_TARGET = 'v65target';
async function v65Tasks(title: string): Promise<any[]> {
    const { body } = await json(`/v1/agents/${V65_TARGET}/tasks?per_page=100`, { headers: auth1 });
    return (body.data.tasks || []).filter((t: any) => t.title === title);
}
async function v65Schedule(makerToken: string, title: string): Promise<string> {
    const made = await json('/v1/schedules', {
        method: 'POST', headers: { Authorization: `Bearer ${makerToken}` },
        body: JSON.stringify({
            kind: 'agent_task', agent_name: V65_TARGET, cron: '0 0 1 1 *', display_name: title,
            task_template: { title, description: 'written by the maker agent' },
        }),
    });
    assert(made.status === 201, `maker create: ${made.status} ${JSON.stringify(made.body?.error)}`);
    return made.body.data.schedule.id;
}
/** Run the schedule now as the owner in person, and read back what the run log kept. */
async function v65Fire(id: string) {
    const run = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth1 });
    assert(run.status === 200, `trigger ${run.status}: ${JSON.stringify(run.body?.error)}`);
    const got = await json(`/v1/schedules/${id}`, { headers: auth1 });
    return { outcome: run.body.data.outcome as string, schedule: got.body.data.schedule, runs: got.body.data.runs as any[] };
}

await test('43. Control: a live maker\'s agent_task schedule puts its task in the sibling\'s queue', async () => {
    const t = await json('/v1/agents', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({ name: V65_TARGET, owner: o1.ownerName, capabilities: ['memory'] }),
    });
    assert(t.status === 201, `target agent: ${t.status} ${JSON.stringify(t.body?.error)}`);
    const maker = await scopedAgent(o1.ownerName, o1.ownerToken, 'v65live', ['task:write', 'workflow:read']);
    const id = await v65Schedule(maker, 'V65_LIVE_MAKER');
    const fired = await v65Fire(id);
    assert(fired.outcome === 'created', `a live maker's schedule runs: ${fired.outcome} ${fired.schedule?.lastRunError ?? ''}`);
    assert((await v65Tasks('V65_LIVE_MAKER')).length === 1, 'the task is in the target\'s queue');
});

await test('44. A deleted maker\'s schedule puts no task in the queue, and the run log names the maker as gone', async () => {
    const maker = await scopedAgent(o1.ownerName, o1.ownerToken, 'v65gone', ['task:write', 'workflow:read']);
    const id = await v65Schedule(maker, 'V65_DELETED_MAKER');
    const del = await json('/v1/agents/v65gone', { method: 'DELETE', headers: auth1 });
    assert(del.status === 200, `owner deletes the maker: ${del.status} ${JSON.stringify(del.body?.error)}`);

    const fired = await v65Fire(id);
    assert(fired.outcome === 'error', `the fire must be refused, got outcome ${fired.outcome}`);
    assert((await v65Tasks('V65_DELETED_MAKER')).length === 0, 'a deleted maker\'s work order reached the queue');
    assert(fired.schedule.lastRunResult === 'error', `lastRunResult ${fired.schedule.lastRunResult}`);
    assert(/no longer connected/.test(fired.schedule.lastRunError ?? ''), `the reason names the maker as gone: ${fired.schedule.lastRunError}`);
    assert(JSON.stringify(fired.runs ?? []).includes('no longer connected'), 'the run log the owner reads carries the reason');
});

await test('45. A maker the owner narrowed to drop task:write puts no task in the queue', async () => {
    const maker = await scopedAgent(o1.ownerName, o1.ownerToken, 'v65narrow', ['task:write', 'workflow:read']);
    const id = await v65Schedule(maker, 'V65_NARROWED_MAKER');
    const narrow = await json('/v1/agents/v65narrow/scopes', { method: 'PATCH', headers: auth1, body: JSON.stringify({ scopes: ['workflow:read'] }) });
    assert(narrow.status === 200, `owner narrows the maker: ${narrow.status} ${JSON.stringify(narrow.body?.error)}`);

    const fired = await v65Fire(id);
    assert(fired.outcome === 'error', `the fire must be refused, got outcome ${fired.outcome}`);
    assert((await v65Tasks('V65_NARROWED_MAKER')).length === 0, 'a narrowed maker\'s work order reached the queue');
    assert(/task:write/.test(fired.schedule.lastRunError ?? ''), `the reason names the missing permission: ${fired.schedule.lastRunError}`);

    // KEPT (capability-loss review, 2026-10-21): the owner is told where to allow it. task:write is a
    // powerful word, so the answer is the agent's page with its own tick, not one press
    // (services/permission-ask.ts); the bell carries the same question.
    assert((fired.schedule.lastRunError ?? '').includes('/v1/profile?tab=agents&agent=v65narrow'), `the run log carries the agent's page: ${fired.schedule.lastRunError}`);
    let ask: any;
    for (let i = 0; i < 50 && !ask; i++) {
        const n = await json('/v1/notifications', { headers: auth1 });
        ask = (n.body?.data?.notifications ?? []).find((x: any) => x.type === 'agent_permission_ask'
            && String(x.link ?? '').includes('agent=v65narrow'));
        if (!ask) await sleep(100);
    }
    assert(!!ask, 'no permission question for the refused agent in the bell');
    const allowed = await json('/v1/agents/v65narrow/scopes', { method: 'PATCH', headers: auth1, body: JSON.stringify({ scopes: ['task:write', 'workflow:read'] }) });
    assert(allowed.status === 200, `owner allows it again: ${allowed.status}`);
    const again = await v65Fire(id);
    assert(again.outcome === 'created', `after the owner allows it, the schedule runs: ${again.outcome} ${again.schedule?.lastRunError ?? ''}`);
    assert((await v65Tasks('V65_NARROWED_MAKER')).length === 1, 'and its task is in the queue');
});

await test('46. KEPT: an app\'s agent_task schedule from before 2026-10-05 (no grant recorded) still runs as the account', async () => {
    const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
    const dbUrl = serverDbUrl();
    const sqlitePath = pinnedSqlitePath();
    assert((provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl), `backend "${provider}" is not reachable from this process`);
    const storage = await createStorage({ provider, sqlitePath, dbUrl });
    const made = await json('/v1/schedules', {
        method: 'POST', headers: auth1,
        body: JSON.stringify({ kind: 'agent_task', agent_name: V65_TARGET, cron: '0 0 1 1 *', display_name: 'V65_OLD_APP', task_template: { title: 'V65_OLD_APP' } }),
    });
    assert(made.status === 201, `owner create: ${made.status}`);
    const id = made.body.data.schedule.id as string;
    // Nothing over HTTP writes the pre-2026-10-05 shape: the owner's identity as the maker, not in person, no grant.
    await storage.updateScheduledJob(id, { createdByAgent: true });
    const fired = await v65Fire(id);
    assert(fired.outcome === 'created', `an old app schedule must keep firing: ${fired.outcome} ${fired.schedule?.lastRunError ?? ''}`);
    assert((await v65Tasks('V65_OLD_APP')).length === 1, 'its task is in the queue');
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

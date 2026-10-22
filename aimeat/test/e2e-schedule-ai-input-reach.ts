/**
 * @file test/e2e-schedule-ai-input-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a scheduled AI job may hand its model of the owner's data: the records the
 *   schedule's maker may read (secaudit 2026-10 wave 3, r49 the scheduled variant).
 *
 *   THE REFUSALS. An agent holding ai:use but not memory:read-as-owner set up an `ai` schedule whose
 *   input named its owner's private record (the default namespace) or a sibling agent's private record
 *   (input_namespaces), and read the record back in the answer when the schedule fired. Now:
 *     - create (REST and MCP) and edit (REST) answer 403 SCOPE_DENIED naming memory:read-as-owner and
 *       where the owner gives it, when the named record exists at that moment;
 *     - the fire is refused with the same words when the record was written or made private after the
 *       schedule was saved, and the model provider hears nothing.
 *
 *   THE USES KEPT, each asserted: the owner in person over their own and their agents' private records;
 *   an agent holding memory:read-as-owner over the same; an agent over its own private record and over
 *   the owner's records at visibility owner and public; and an agent's schedule stored before the
 *   update, which the once-only step keeps reading as before until its input changes (a pause and a
 *   resume keep it, a new prompt ends it).
 *
 *   WHY IN PROCESS. The node is booted in this process (test/helpers/federation-two-node.ts bootNode),
 *   so a schedule can be stored the way one stored before the update was, and the once-only step can be
 *   run as the node's first start with the rule runs it. The owner's AI is a loopback stand-in that
 *   echoes the prompt back as the answer, so what reached the model is in the answer.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-schedule-ai-input-reach
 * @version-history
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10 wave 3, r49 the scheduled variant).
 */
import type { Server } from 'node:http';
import { bootNode, setupOperator, auth, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';
import { AI_SCHEDULE_READ_KEEP_KEY, keepAiScheduleReadsOnce } from '../src/services/schedule-ai-read.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const NODE = `aimeat-schedreach-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let N!: NodeState;
let fake!: FakeAiProvider;
type Person = { name: string; ghii: string; token: string };
let o!: Person;
let a!: McpAgent;   // ai:use, no memory:read-as-owner
let r!: McpAgent;   // ai:use and memory:read-as-owner
let s!: McpAgent;   // a sibling holding a private record

const post = (path: string, token: string, body: unknown) => N.json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const patch = (path: string, token: string, body: unknown) => N.json(path, { method: 'PATCH', headers: auth(token), body: JSON.stringify(body) });

const SECRET = `OWNER-PRIVATE-${stamp}`, SHARED = `OWNER-SHARED-${stamp}`, PUBLIC = `OWNER-PUBLIC-${stamp}`;
const SIB = `SIBLING-PRIVATE-${stamp}`, OWN = `AGENT-OWN-${stamp}`, LATER = `OWNER-LATER-${stamp}`, FLIP = `OWNER-FLIP-${stamp}`;

/** Create an ai schedule as `token`; the answer as the route gives it. */
const createAi = (token: string, name: string, extra: Record<string, unknown>) => post('/v1/schedules', token, {
    kind: 'ai', cron: '0 4 1 1 *', display_name: name, prompt: 'Repeat the input verbatim.', output_key: `sr.out.${name}`, ...extra,
});

/** Run a schedule now as `token`; the stored schedule after the run. */
async function fire(token: string, id: string): Promise<any> {
    const t = await post(`/v1/schedules/${id}/trigger`, token, {});
    assert(t.status === 200, `trigger ${id}: ${t.status} ${JSON.stringify(t.body?.error)}`);
    return t.body.data.schedule;
}

/** The answer a schedule wrote, read by the owner, as text; null when there is none. */
async function answer(name: string): Promise<string | null> {
    const rec = await N.json(`/v1/memory/${encodeURIComponent(`sr.out.${name}`)}`, { headers: auth(o.token) });
    return rec.status === 200 ? JSON.stringify(rec.body.data.value) : null;
}

const chats = () => fake.requestsFor('chat').length;
const sawInChats = (text: string) => fake.requestsFor('chat').some(q => JSON.stringify(q.json ?? q.body).includes(text));

console.log('\n=== A scheduled AI job reads what its maker may read ===\n');

const servers: Server[] = [];
try {
    await test('Setup: an owner with private, owner-visible and public records; agents with and without memory:read-as-owner; a sibling with a private record', async () => {
        fake = await startFakeAiProvider(0);
        fake.setDefault('chat', (req) => chatJson(((req.json?.messages as Array<{ content: unknown }>) ?? [])
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')));
        N = await bootNode(suitePort(31700, RUNNER_BASE), NODE);
        servers.push(N.server);
        await setupOperator(N, `srop${stamp}`);
        const reg = await registerOwner(N.baseUrl, `srowner${stamp}`);
        o = { name: reg.name, ghii: reg.ghii, token: reg.token };
        const settings = await post('/v1/memory', o.token, { key: 'openrouter.settings', visibility: 'private',
            value: { provider: 'custom', baseUrl: fake.baseUrl, model: 'stub/sched-model', daily_budget_usd: 50 } });
        assert(settings.status === 201, `settings ${settings.status} ${JSON.stringify(settings.body?.error)}`);
        for (const [key, value, visibility] of [['sr.secret', SECRET, 'private'], ['sr.shared', SHARED, 'owner'], ['sr.public', PUBLIC, 'public'], ['sr.flip', FLIP, 'owner']]) {
            const w = await post('/v1/memory', o.token, { key, value, visibility });
            assert(w.status === 201, `owner write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        }
        const base = ['ai:use', 'memory:read', 'memory:write', 'task:write', 'workflow:read', 'workflow:write'];
        a = await makeAgent(N.baseUrl, o, base, `sra${stamp}`);
        r = await makeAgent(N.baseUrl, o, [...base, 'memory:read-as-owner'], `srr${stamp}`);
        s = await makeAgent(N.baseUrl, o, ['memory:write'], `srs${stamp}`);
        const sw = await post('/v1/memory', s.token, { key: 'sr.sib', value: SIB, visibility: 'private' });
        assert(sw.status === 201, `sibling write ${sw.status}`);
        const aw = await post('/v1/memory', a.token, { key: 'sr.own', value: OWN, visibility: 'private' });
        assert(aw.status === 201, `agent write ${aw.status}`);
        // The boundary this rests on: the agent's own memory read is refused the owner's private record.
        const direct = await N.json('/v1/memory/sr.secret?owner_scope=true', { headers: auth(a.token) });
        assert(direct.status === 404, `the agent's direct read of the owner's private record answers 404, got ${direct.status}`);
    });

    console.log('\nThe refusals');

    await test('REFUSED: an agent without memory:read-as-owner creates an ai schedule over its owner\'s private record (REST)', async () => {
        const res = await createAi(a.token, 'c1', { input_keys: ['sr.secret'] });
        if (res.status === 201) await N.json(`/v1/schedules/${res.body.data.schedule.id}`, { method: 'DELETE', headers: auth(o.token) });
        assert(res.status === 403 && res.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${res.status} ${JSON.stringify(res.body?.error)}`);
        assert(/memory:read-as-owner/.test(res.body.error.message) && /Profile/.test(res.body.error.message), `the refusal names the permission and where it is given: ${res.body.error.message}`);
        assert(!JSON.stringify(res.body).includes(SECRET), 'the refusal carries no content');
    });

    await test('REFUSED: the same agent names a sibling agent\'s private record through input_namespaces (REST)', async () => {
        const res = await createAi(a.token, 'c2', { input_keys: ['sr.sib'], input_namespaces: [s.gaii] });
        if (res.status === 201) await N.json(`/v1/schedules/${res.body.data.schedule.id}`, { method: 'DELETE', headers: auth(o.token) });
        assert(res.status === 403 && res.body.error?.code === 'SCOPE_DENIED' && /memory:read-as-owner/.test(res.body.error.message),
            `expected 403 SCOPE_DENIED naming memory:read-as-owner, got ${res.status} ${JSON.stringify(res.body?.error)}`);
    });

    await test('REFUSED: the same agent over MCP (aimeat_schedule_create) names its owner\'s private record', async () => {
        const session = await openSession(N.baseUrl, a.token, 'sched-reach');
        const out = await callTool(session, 'aimeat_schedule_create', { kind: 'ai', cron: '0 4 1 1 *', display_name: 'mcp1', prompt: 'Repeat.', input_keys: ['sr.secret'], output_key: 'sr.out.mcp1' });
        if (!out.isError && out.data?.schedule_id) await N.json(`/v1/schedules/${out.data.schedule_id}`, { method: 'DELETE', headers: auth(o.token) });
        assert(out.isError && /SCOPE_DENIED/.test(out.text) && /memory:read-as-owner/.test(out.text), `expected a refusal naming memory:read-as-owner: ${out.text}`);
    });

    let editId = '';
    await test('REFUSED: an edit cannot point the agent\'s schedule at its owner\'s private record (REST)', async () => {
        const made = await createAi(a.token, 'e1', { input_keys: ['sr.shared'] });
        assert(made.status === 201, `create over an owner-visible record: ${made.status} ${JSON.stringify(made.body?.error)}`);
        editId = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${editId}`, a.token, { input: { prompt: 'Repeat.', inputKeys: ['sr.secret'], outputKey: 'sr.out.e1' } });
        assert(res.status === 403 && res.body.error?.code === 'SCOPE_DENIED' && /memory:read-as-owner/.test(res.body.error.message),
            `expected 403 SCOPE_DENIED naming memory:read-as-owner, got ${res.status} ${JSON.stringify(res.body?.error)}`);
        const stored = await N.json(`/v1/schedules/${editId}`, { headers: auth(o.token) });
        assert(JSON.stringify(stored.body.data.schedule.input.inputKeys) === '["sr.shared"]', `the refused edit was stored: ${JSON.stringify(stored.body.data.schedule.input)}`);
    });

    await test('REFUSED at the fire: a record written private after the schedule was saved, and the model hears nothing', async () => {
        const made = await createAi(a.token, 'f1', { input_keys: ['sr.later'] });
        assert(made.status === 201, `create over a key nobody holds yet: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const w = await post('/v1/memory', o.token, { key: 'sr.later', value: LATER, visibility: 'private' });
        assert(w.status === 201, `owner write ${w.status}`);
        const before = chats();
        const run = await fire(a.token, made.body.data.schedule.id);
        assert(run.lastRunResult === 'error' && /memory:read-as-owner/.test(run.lastRunError ?? ''), `the fire is refused naming the permission: ${run.lastRunResult} ${run.lastRunError ?? ''}`);
        assert(chats() === before && !sawInChats(LATER), 'the model provider heard the private record');
        assert((await answer('f1')) === null, 'an answer was stored');
    });

    await test('REFUSED at the fire: an owner-visible record the owner made private after the schedule was saved', async () => {
        const made = await createAi(a.token, 'f2', { input_keys: ['sr.flip'] });
        assert(made.status === 201, `create over an owner-visible record: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const w = await post('/v1/memory', o.token, { key: 'sr.flip', value: FLIP, visibility: 'private' });
        assert(w.status === 200, `owner rewrite ${w.status} ${JSON.stringify(w.body?.error)}`);
        const run = await fire(a.token, made.body.data.schedule.id);
        assert(run.lastRunResult === 'error' && /memory:read-as-owner/.test(run.lastRunError ?? ''), `the fire is refused: ${run.lastRunResult} ${run.lastRunError ?? ''}`);
        assert(!sawInChats(FLIP), 'the model provider heard the record made private');
    });

    console.log('\nThe uses kept');

    await test('KEPT: the agent schedules over its own private record and its owner\'s records at visibility owner and public', async () => {
        const made = await createAi(a.token, 'k1', { input_keys: ['sr.own', 'sr.shared', 'sr.public'], input_namespaces: [a.gaii] });
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const run = await fire(a.token, made.body.data.schedule.id);
        assert(run.lastRunResult === 'success', `the run completes: ${run.lastRunError ?? ''}`);
        const text = await answer('k1');
        assert(!!text && text.includes(OWN) && text.includes(SHARED) && text.includes(PUBLIC), `the answer holds all three: ${text}`);
    });

    await test('KEPT: an agent holding memory:read-as-owner schedules over the owner\'s and a sibling\'s private records', async () => {
        const made = await createAi(r.token, 'k2', { input_keys: ['sr.secret', 'sr.sib'], input_namespaces: ['', s.gaii] });
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const run = await fire(r.token, made.body.data.schedule.id);
        assert(run.lastRunResult === 'success', `the run completes: ${run.lastRunError ?? ''}`);
        const text = await answer('k2');
        assert(!!text && text.includes(SECRET) && text.includes(SIB), `the answer holds both: ${text}`);
    });

    await test('KEPT: the owner in person schedules over their own and their agents\' private records', async () => {
        const made = await createAi(o.token, 'k3', { input_keys: ['sr.secret', 'sr.sib', 'sr.own'], input_namespaces: ['', s.gaii, a.gaii] });
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const run = await fire(o.token, made.body.data.schedule.id);
        assert(run.lastRunResult === 'success', `the run completes: ${run.lastRunError ?? ''}`);
        const text = await answer('k3');
        assert(!!text && text.includes(SECRET) && text.includes(SIB) && text.includes(OWN), `the answer holds all three: ${text}`);
    });

    await test('KEPT: an agent\'s schedule stored before the update keeps reading as before once the once-only step has run', async () => {
        // A schedule as one stood before the update: made by the agent, its input naming the owner's
        // private record (nothing refused that at create then).
        const made = await createAi(a.token, 'k4', { input_keys: ['sr.shared'] });
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const id = made.body.data.schedule.id as string;
        await N.storage.updateScheduledJob(id, { input: { ...made.body.data.schedule.input, inputKeys: ['sr.secret'] } });

        // This node's own first start ran the step on an empty list, so the stored schedule is not on it.
        const without = await fire(a.token, id);
        assert(without.lastRunResult === 'error' && /memory:read-as-owner/.test(without.lastRunError ?? ''), `without the step it is refused: ${without.lastRunResult} ${without.lastRunError ?? ''}`);

        // The node's first start with the rule, run here: the step's record is taken away and the step runs.
        await N.storage.deleteMemory(`system@${NODE}`, AI_SCHEDULE_READ_KEEP_KEY, `system@${NODE}`);
        const step = await keepAiScheduleReadsOnce(N.storage, { nodeId: NODE });
        assert(step.ran && step.ids.includes(id), `the step keeps the stored schedule: ${JSON.stringify(step)}`);
        const kept = await fire(a.token, id);
        assert(kept.lastRunResult === 'success', `the kept schedule runs: ${kept.lastRunResult} ${kept.lastRunError ?? ''}`);
        assert((await answer('k4'))?.includes(SECRET), 'and reads as it did');

        // A pause and a resume change nothing it reads: still kept.
        assert((await patch(`/v1/schedules/${id}`, a.token, { enabled: false })).status === 200, 'pause');
        assert((await patch(`/v1/schedules/${id}`, a.token, { enabled: true })).status === 200, 'resume');
        const resumed = await fire(a.token, id);
        assert(resumed.lastRunResult === 'success', `still kept after a pause and a resume: ${resumed.lastRunError ?? ''}`);

        // A new prompt is a new instruction: from then on it reads what its maker may read.
        const edit = await patch(`/v1/schedules/${id}`, a.token, { prompt: 'Repeat the input verbatim, twice.' });
        assert(edit.status === 200, `the maker edits the prompt: ${edit.status} ${JSON.stringify(edit.body?.error)}`);
        const changed = await fire(a.token, id);
        assert(changed.lastRunResult === 'error' && /memory:read-as-owner/.test(changed.lastRunError ?? ''), `a changed schedule reads with its maker's reach: ${changed.lastRunResult} ${changed.lastRunError ?? ''}`);
    });

    await test('the step runs once, and lists no schedule the owner made in person', async () => {
        const step = await keepAiScheduleReadsOnce(N.storage, { nodeId: NODE });
        assert(!step.ran, 'the step runs once');
        const rec = await N.storage.getMemory(`system@${NODE}`, AI_SCHEDULE_READ_KEEP_KEY);
        const kept = ((rec?.value as { kept?: Array<{ id: string }> })?.kept ?? []).map(k => k.id);
        const all = await N.storage.listScheduledJobs({ type: 'ai' });
        const ownerMade = all.filter(j => !j.createdByAgent).map(j => j.id);
        assert(ownerMade.length > 0 && ownerMade.every(id => !kept.includes(id)), `an owner schedule was listed: ${JSON.stringify(kept)}`);
    });
} finally {
    for (const srv of servers) { try { srv.close(); } catch { /* closing */ } }
    try { await fake?.close(); } catch { /* closing */ }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

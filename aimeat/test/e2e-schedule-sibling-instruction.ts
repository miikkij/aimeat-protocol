/**
 * @file test/e2e-schedule-sibling-instruction.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A sibling agent changes the instruction of another agent's `ai` schedule (secaudit2026oct26,
 *   schedule-write.ts:updateScheduleRecord:sibling-edit-fires-under-maker-reach).
 *
 *   THE HOLD. Agent R holds memory:read-as-owner and made an ai schedule over its owner's private
 *   record, answer at visibility owner. Agent A does not hold the word. A may still edit R's schedule
 *   (decision 2026-10-12 Q4), but the next fire no longer reads the private record into A's prompt
 *   until the owner allows it with one press: the edit answers `approval_request` (pending), the owner
 *   gets the question, each fire meanwhile is skipped and the model hears nothing. Allow: the next fire
 *   runs A's instruction. Don't allow: the next fire runs the instruction the schedule had. A hears the
 *   answer either way. An agent holding the word may answer for the owner.
 *
 *   THE USES KEPT, each asserted: R edits its own schedule and it fires at once; a sibling holding the
 *   word edits it and it fires at once; the owner edits it and it fires at once; A pauses and renames it
 *   with no question; A edits a schedule of a maker that does not hold the word either, and it fires at
 *   once.
 *
 *   WHY IN PROCESS. As test/e2e-schedule-ai-input-reach.ts: the owner's AI is a loopback stand-in that
 *   echoes the prompt back, so what reached the model is in the answer.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-schedule-sibling-instruction
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import type { Server } from 'node:http';
import { bootNode, setupOperator, auth, type NodeState } from './helpers/federation-two-node.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const NODE = `aimeat-schedsib-${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_STACKS === '1') console.error((err as Error).stack); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let N!: NodeState;
let fake!: FakeAiProvider;
let o!: { name: string; ghii: string; token: string };
let r!: McpAgent;   // the maker: memory:read-as-owner
let a!: McpAgent;   // the editor: no memory:read-as-owner
let w!: McpAgent;   // a sibling holding memory:read-as-owner
let n!: McpAgent;   // a maker without memory:read-as-owner

const post = (path: string, token: string, body: unknown) => N.json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const patch = (path: string, token: string, body: unknown) => N.json(path, { method: 'PATCH', headers: auth(token), body: JSON.stringify(body) });
const SECRET = `OWNER-PRIVATE-${stamp}`, SHARED = `OWNER-SHARED-${stamp}`;

const createAi = (token: string, name: string, keys: string[]) => post('/v1/schedules', token, {
    kind: 'ai', cron: '0 4 1 1 *', display_name: name, prompt: `ORIGINAL ${name}. Repeat the input verbatim.`,
    input_keys: keys, output_key: `ss.out.${name}`, output_visibility: 'owner',
});

/** Run a schedule now as the owner; the trigger's data. */
async function fire(id: string): Promise<any> {
    const t = await post(`/v1/schedules/${id}/trigger`, o.token, {});
    assert(t.status === 200, `trigger ${id}: ${t.status} ${JSON.stringify(t.body?.error)}`);
    return t.body.data;
}
async function answer(name: string): Promise<string | null> {
    const rec = await N.json(`/v1/memory/${encodeURIComponent(`ss.out.${name}`)}`, { headers: auth(o.token) });
    return rec.status === 200 ? JSON.stringify(rec.body.data.value) : null;
}
const stored = async (id: string) => (await N.json(`/v1/schedules/${id}`, { headers: auth(o.token) })).body.data.schedule;
const chats = () => fake.requestsFor('chat').length;
const sawInChats = (text: string) => fake.requestsFor('chat').some(q => JSON.stringify(q.json ?? q.body).includes(text));

console.log('\n=== A sibling\'s instruction to another agent\'s ai schedule ===\n');

const servers: Server[] = [];
try {
    await test('Setup: an owner with a private and an owner-visible record; a maker with memory:read-as-owner, an editor without it, a sibling with it, a maker without it', async () => {
        fake = await startFakeAiProvider(0);
        fake.setDefault('chat', (req) => chatJson(((req.json?.messages as Array<{ content: unknown }>) ?? [])
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')));
        N = await bootNode(suitePort(31900, RUNNER_BASE), NODE);
        servers.push(N.server);
        await setupOperator(N, `ssop${stamp}`);
        const reg = await registerOwner(N.baseUrl, `ssowner${stamp}`);
        o = { name: reg.name, ghii: reg.ghii, token: reg.token };
        const settings = await post('/v1/memory', o.token, { key: 'openrouter.settings', visibility: 'private',
            value: { provider: 'custom', baseUrl: fake.baseUrl, model: 'stub/sched-model', daily_budget_usd: 50 } });
        assert(settings.status === 201, `settings ${settings.status}`);
        for (const [key, value, visibility] of [['ss.secret', SECRET, 'private'], ['ss.shared', SHARED, 'owner']]) {
            const wr = await post('/v1/memory', o.token, { key, value, visibility });
            assert(wr.status === 201, `owner write ${key}: ${wr.status}`);
        }
        const base = ['ai:use', 'memory:read', 'memory:write', 'task:write', 'workflow:read', 'workflow:write'];
        r = await makeAgent(N.baseUrl, o, [...base, 'memory:read-as-owner'], `ssr${stamp}`);
        a = await makeAgent(N.baseUrl, o, base, `ssa${stamp}`);
        w = await makeAgent(N.baseUrl, o, [...base, 'memory:read-as-owner'], `ssw${stamp}`);
        n = await makeAgent(N.baseUrl, o, base, `ssn${stamp}`);
        const direct = await N.json('/v1/memory/ss.secret?owner_scope=true', { headers: auth(a.token) });
        assert(direct.status === 404, `the editor's own read of the owner's private record is refused, got ${direct.status}`);
    });

    console.log('\nThe hold');

    let heldId = '';
    let requestId = '';
    await test('HELD: the editor changes the prompt of the maker\'s schedule; the edit is stored and answers a pending approval', async () => {
        const made = await createAi(r.token, 'h1', ['ss.secret']);
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        heldId = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${heldId}`, a.token, { prompt: `EDITED-BY-A ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200, `the edit is allowed: ${res.status} ${JSON.stringify(res.body?.error)}`);
        const ask = res.body.data.approval_request;
        assert(!!ask && ask.status === 'awaiting_owner' && typeof ask.request_id === 'string', `the edit answers a pending approval: ${JSON.stringify(res.body.data)}`);
        requestId = ask.request_id;
        assert((await stored(heldId)).input.prompt.includes('EDITED-BY-A'), 'the edit is stored');
        const seen = await N.json(`/v1/publish-requests/${requestId}`, { headers: auth(a.token) });
        assert(seen.status === 200 && seen.body.data.request.state === 'awaiting_owner', `the editor reads it pending: ${seen.status} ${JSON.stringify(seen.body?.data ?? seen.body?.error)}`);
        const n = await N.json('/v1/notifications', { headers: auth(o.token) });
        const notice = (n.body?.data?.notifications ?? []).find((x: any) => x.i18n?.key === 'approval_schedule_instruction');
        assert(!!notice && notice.i18n.vars.schedule === 'h1' && notice.i18n.vars.maker === r.name
            && (notice.actions ?? []).map((x: any) => x.id).sort().join(',') === 'allow,deny', `the owner's notice: ${JSON.stringify(notice)}`);
    });

    await test('HELD: the fire waits, says why, and the model hears nothing', async () => {
        const before = chats();
        const out = await fire(heldId);
        assert(out.outcome === 'stopped' && /Waiting for the owner/.test(out.reason ?? ''), `the fire waits: ${out.outcome} ${out.reason ?? ''}`);
        assert(chats() === before && !sawInChats(SECRET), 'the model heard the private record');
        assert((await answer('h1')) === null, 'an answer was stored');
    });

    await test('HELD: the editor cannot answer its own question', async () => {
        const res = await post(`/v1/publish-requests/${requestId}/decision`, a.token, { decision: 'approve' });
        assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test('ALLOWED: a sibling holding memory:read-as-owner allows it for the owner; the next fire runs the new instruction', async () => {
        const res = await post(`/v1/publish-requests/${requestId}/decision`, w.token, { decision: 'approve' });
        assert(res.status === 200, `approve: ${res.status} ${JSON.stringify(res.body?.error)}`);
        const out = await fire(heldId);
        assert(out.outcome === 'ran', `the fire runs: ${JSON.stringify(out.outcome ?? out)}`);
        const text = await answer('h1');
        assert(!!text && text.includes('EDITED-BY-A') && text.includes(SECRET), `the answer follows the allowed instruction: ${text}`);
    });

    await test('DECLINED: the owner does not allow a second edit; the next fire runs the instruction the schedule had', async () => {
        const res = await patch(`/v1/schedules/${heldId}`, a.token, { prompt: `SECOND-EDIT ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200 && res.body.data.approval_request?.status === 'awaiting_owner', `held again: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
        const id = res.body.data.approval_request.request_id;
        const no = await post(`/v1/publish-requests/${id}/decision`, o.token, { decision: 'decline' });
        assert(no.status === 200, `decline: ${no.status} ${JSON.stringify(no.body?.error)}`);
        const out = await fire(heldId);
        assert(out.outcome === 'ran', `the fire runs: ${JSON.stringify(out.outcome ?? out)}`);
        const text = await answer('h1');
        assert(!!text && text.includes('EDITED-BY-A') && !text.includes('SECOND-EDIT'), `the earlier instruction ran: ${text}`);
        assert(!(await stored(heldId)).input.prompt.includes('SECOND-EDIT'), 'the instruction that was not allowed is gone from the schedule');
        const seen = await N.json(`/v1/publish-requests/${id}`, { headers: auth(a.token) });
        assert(seen.body.data.request.state === 'declined', `the editor reads the answer: ${JSON.stringify(seen.body.data)}`);
    });

    await test('HELD over MCP: aimeat_schedule_update answers the pending approval too', async () => {
        const session = await openSession(N.baseUrl, a.token, 'sched-sib');
        const out = await callTool(session, 'aimeat_schedule_update', { schedule_id: heldId, prompt: `MCP-EDIT ${stamp}. Repeat.` });
        assert(!out.isError && /awaiting_owner/.test(out.text), `the tool answers the pending approval: ${out.text}`);
    });

    console.log('\nThe uses kept');

    await test('KEPT: the maker edits its own schedule and it fires at once', async () => {
        const made = await createAi(r.token, 'k1', ['ss.secret']);
        const id = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${id}`, r.token, { prompt: `MAKER-EDIT ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200 && !res.body.data.approval_request, `no question: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
        assert((await fire(id)).outcome === 'ran', 'the fire runs');
        assert(((await answer('k1')) ?? '').includes(SECRET), 'the answer holds the record');
    });

    await test('KEPT: a sibling holding memory:read-as-owner edits the maker\'s schedule and it fires at once', async () => {
        const made = await createAi(r.token, 'k2', ['ss.secret']);
        const id = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${id}`, w.token, { prompt: `SIBLING-EDIT ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200 && !res.body.data.approval_request, `no question: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
        assert((await fire(id)).outcome === 'ran', 'the fire runs');
    });

    await test('KEPT: the owner edits the maker\'s schedule and it fires at once', async () => {
        const made = await createAi(r.token, 'k3', ['ss.secret']);
        const id = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${id}`, o.token, { prompt: `OWNER-EDIT ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200 && !res.body.data.approval_request, `no question: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
        assert((await fire(id)).outcome === 'ran', 'the fire runs');
    });

    await test('KEPT: the editor pauses and renames the maker\'s schedule with no question', async () => {
        const made = await createAi(r.token, 'k4', ['ss.secret']);
        const id = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${id}`, a.token, { enabled: false, display_name: 'renamed' });
        assert(res.status === 200 && !res.body.data.approval_request, `no question: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
    });

    await test('KEPT: the editor edits a schedule of a maker that does not hold memory:read-as-owner either, and it fires at once', async () => {
        const made = await createAi(n.token, 'k5', ['ss.shared']);
        assert(made.status === 201, `create: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const id = made.body.data.schedule.id;
        const res = await patch(`/v1/schedules/${id}`, a.token, { prompt: `PEER-EDIT ${stamp}. Repeat the input verbatim.` });
        assert(res.status === 200 && !res.body.data.approval_request, `no question: ${JSON.stringify(res.body?.data ?? res.body?.error)}`);
        assert((await fire(id)).outcome === 'ran', 'the fire runs');
        assert(((await answer('k5')) ?? '').includes('PEER-EDIT'), 'the answer follows the edit');
    });
} finally {
    for (const srv of servers) { try { srv.close(); } catch { /* closing */ } }
    try { await fake?.close(); } catch { /* closing */ }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);

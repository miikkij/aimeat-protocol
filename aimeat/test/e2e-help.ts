/**
 * @file test/e2e-help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ask someone who knows (src/services/help/, routes/help/, mcp/help.ts): a member asks, the
 *   question reaches the helper whose topics match as a direct message thread marked as a question, the
 *   helper's AI drafts and the helper approves, the asker marks it solved with thanks, the helper gets
 *   morsels once, and the kept answer is found by the next person. Also: the AI answering on its own in
 *   the helper's auto topics, a pass that nobody sees, the shared list, the owner's choices that an AI
 *   cannot raise, an audience limited to shared places, the operator's report, and the feature switched
 *   off.
 *
 *   What it holds: help:ask and help:answer are outside the wildcard; a member who is neither asker nor
 *   helper of a question gets NOT_FOUND for its thread; a second "solved" credits nothing; an AI never
 *   sends an answer when its owner chose drafts.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=help
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness('Ask someone who knows');
const STAMP = Date.now().toString(36);
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

const op = await setupOperator(BASE, ADMIN_PW, `hop${STAMP}`);
const alice = await registerOwner(BASE, `hqalice${STAMP}`);
const bob = await registerOwner(BASE, `hqbob${STAMP}`);
const carol = await registerOwner(BASE, `hqcarol${STAMP}`);
const dave = await registerOwner(BASE, `hqdave${STAMP}`);
const bobAgent = await makeAgent(BASE, bob, ['help:answer'], `hqbobai${STAMP}`);
const bobWild = await makeAgent(BASE, bob, ['*'], `hqbobwild${STAMP}`);
const aliceAgent = await makeAgent(BASE, alice, ['help:ask'], `hqaliceai${STAMP}`);
const opAgent = await makeAgent(BASE, op, ['operator:admin'], `hqopai${STAMP}`);

const send = (method: string, token: string, path: string, body?: unknown) =>
    json(path, { method, headers: auth(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = (token: string, path: string, body: unknown = {}) => send('POST', token, path, body);
const put = (token: string, path: string, body: unknown = {}) => send('PUT', token, path, body);
const get = (token: string, path: string) => send('GET', token, path);
const err = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body)}`.slice(0, 500);
const balance = async (o: { name: string; token: string }) => {
    const r = await get(o.token, '/v1/wallet');
    return Number(r.body?.data?.balance ?? 0);
};
const config = (changes: Array<{ path: string; value: unknown }>) => put(op.token, '/v1/admin/config', { changes });

let entraId = '';
let entraConv = '';

await h.test('1. a member who never chose may ask and does not receive questions; an agent needs its own word', async () => {
    const me = await get(dave.token, '/v1/help/me');
    assert(me.status === 200 && me.body.data.participant.asker === true && me.body.data.participant.helper === false, `defaults ${err(me)}`);
    assert(me.body.data.chosen === false, 'no row yet');
    const wild = await put(bobWild.token, '/v1/help/me', { helper: true });
    assert(wild.status === 403, `a wildcard agent is refused ${err(wild)}`);
});

await h.test('2. bob chooses to help with Entra and PostgreSQL; carol only for members of her shared places', async () => {
    const b = await put(bob.token, '/v1/help/me', { helper: true, topics: ['Entra', 'PostgreSQL', 'entra'], ai_mode: 'draft', cap_per_week: 10 });
    assert(b.status === 200 && b.body.data.participant.topics.length === 2, `topics de-duplicated ${err(b)}`);
    const c = await put(carol.token, '/v1/help/me', { helper: true, topics: ['PostgreSQL', 'Entra'], audience: 'organisms' });
    assert(c.status === 200, `carol ${err(c)}`);
    const raise = await put(bobAgent.token, '/v1/help/me', { ai_mode: 'auto', auto_topics: ['PostgreSQL'] });
    assert(raise.status === 403 && raise.body.error.code === 'PERSON_REQUIRED', `an AI cannot raise its own level ${err(raise)}`);
});

await h.test('3. find: bob matches Entra; carol does not, because alice shares no place with her', async () => {
    const f = await post(alice.token, '/v1/help/find', { question: 'How do I get a partner to sign in with Entra?', topics: ['Entra'] });
    assert(f.status === 200, `find ${err(f)}`);
    const names = f.body.data.helpers.map((x: any) => x.ghii);
    assert(names.includes(bob.ghii) && !names.includes(carol.ghii), `helpers ${JSON.stringify(names)}`);
});

await h.test('4. alice asks; the question reaches bob as a thread marked as a question; dave cannot read it', async () => {
    const a = await post(alice.token, '/v1/help/questions', {
        question: 'How do I get a partner to sign in with Entra?', tried: 'Added them as a guest.', topics: ['Entra'],
    });
    assert(a.status === 201 && a.body.data.sent_to.length === 1 && a.body.data.sent_to[0].ghii === bob.ghii, `ask ${err(a)}`);
    entraId = a.body.data.question.id;
    entraConv = a.body.data.question.conversation_ids[0];
    const convs = await get(bob.token, '/v1/messages/conversations');
    const row = (convs.body.data.conversations ?? convs.body.data ?? []).find((c: any) => c.conversationId === entraConv);
    assert(row && row.openedKind === 'help-question', `the thread is marked as a question ${JSON.stringify(row ?? convs.body).slice(0, 300)}`);
    const view = await get(bob.token, `/v1/help/threads/${entraConv}`);
    assert(view.status === 200 && view.body.data.role === 'helper' && view.body.data.why.includes('Entra'), `helper view ${err(view)}`);
    const stranger = await get(dave.token, `/v1/help/threads/${entraConv}`);
    assert(stranger.status === 404, `a stranger gets nothing ${err(stranger)}`);
});

await h.test('5. bob\'s AI in draft mode writes a draft; bob approves it; alice reads the answer', async () => {
    const d = await post(bobAgent.token, `/v1/help/questions/${entraId}/respond`, { answer: 'Invite them through B2B collaboration first.' });
    assert(d.status === 200 && d.body.data.outcome === 'drafted', `drafted ${err(d)}`);
    const inbox = await get(bob.token, '/v1/help/inbox');
    const item = inbox.body.data.asked_of_me.find((x: any) => x.question_id === entraId);
    assert(item?.draft?.answer?.includes('B2B'), `the draft waits ${err(inbox)}`);
    const notByAi = await post(bobAgent.token, `/v1/help/questions/${entraId}/respond`, { action: 'approve' });
    assert(notByAi.status === 403, `an AI does not approve its own draft ${err(notByAi)}`);
    const ok = await post(bob.token, `/v1/help/questions/${entraId}/respond`, { action: 'approve', keep_allowed: true });
    assert(ok.status === 200 && ok.body.data.outcome === 'answered', `approved ${err(ok)}`);
    const mine = await get(alice.token, '/v1/help/inbox');
    const q = mine.body.data.mine.find((x: any) => x.id === entraId);
    assert(q?.state === 'answered' && q.answers[0]?.by_ai === true, `alice sees the answer, written by an AI ${JSON.stringify(q)}`);
});

await h.test('6. alice marks it solved and keeps the answer; bob gets 7 morsels once', async () => {
    const before = await balance(bob);
    const s = await post(alice.token, `/v1/help/questions/${entraId}/close`, { action: 'solved', thanks: 'Thank you, it worked.', keep: true });
    assert(s.status === 200 && s.body.data.kept === true && s.body.data.reward_morsels === 7, `solved ${err(s)}`);
    const again = await post(alice.token, `/v1/help/questions/${entraId}/close`, { action: 'solved' });
    assert(again.status === 409, `a second solved is refused ${err(again)}`);
    const after = await balance(bob);
    assert(after - before === 7, `bob got 7 once: ${before} -> ${after}`);
});

await h.test('7. the next person finds the kept answer without asking anyone', async () => {
    const f = await post(dave.token, '/v1/help/find', { question: 'partner Entra sign in', topics: ['Entra'] });
    assert(f.status === 200 && f.body.data.kept.some((k: any) => k.id === entraId && k.answer.includes('B2B')), `kept answer found ${err(f)}`);
});

await h.test('8. in his auto topics bob\'s AI answers on its own; elsewhere it still drafts', async () => {
    const set = await put(bob.token, '/v1/help/me', { ai_mode: 'auto', auto_topics: ['PostgreSQL'] });
    assert(set.status === 200 && set.body.data.participant.aiMode === 'auto', `auto ${err(set)}`);
    const a = await post(alice.token, '/v1/help/questions', { question: 'Which PostgreSQL index fits a text search?', topics: ['PostgreSQL'] });
    assert(a.status === 201 && a.body.data.sent_to[0]?.ghii === bob.ghii, `ask ${err(a)}`);
    const r = await post(bobAgent.token, `/v1/help/questions/${a.body.data.question.id}/respond`, { answer: 'A GIN index on a tsvector column.' });
    assert(r.status === 200 && r.body.data.outcome === 'answered', `sent on its own ${err(r)}`);
});

await h.test('8b. an inflected word in the question finds its topic (Finnish "Entralla" finds "Entra")', async () => {
    const f = await post(dave.token, '/v1/help/find', { question: 'Miten kumppani kirjautuu Entralla?' });
    assert(f.status === 200 && f.body.data.helpers.some((x: any) => x.ghii === bob.ghii), `inflected match ${err(f)}`);
});

await h.test('9a. a helper at his weekly limit gets no more questions', async () => {
    await put(bob.token, '/v1/help/me', { cap_per_week: 2 });
    const a = await post(alice.token, '/v1/help/questions', { question: 'Entra group sync?', topics: ['Entra'] });
    assert(a.status === 201 && a.body.data.nobody_found === true, `limit reached ${err(a)}`);
    await put(bob.token, '/v1/help/me', { cap_per_week: 10 });
});

await h.test('9. bob passes; nobody else matches; alice never learns who passed', async () => {
    const a = await post(alice.token, '/v1/help/questions', { question: 'Entra conditional access for guests?', topics: ['Entra'] });
    assert(a.status === 201 && a.body.data.sent_to[0]?.ghii === bob.ghii, `ask ${err(a)}`);
    const id = a.body.data.question.id;
    const p = await post(bob.token, `/v1/help/questions/${id}/respond`, { action: 'pass' });
    assert(p.status === 200 && p.body.data.outcome === 'passed', `passed ${err(p)}`);
    const mine = await get(alice.token, '/v1/help/inbox');
    const q = mine.body.data.mine.find((x: any) => x.id === id);
    assert(q && !JSON.stringify(q).includes('passed') && q.answers.length === 0, `no passer shown ${JSON.stringify(q)}`);
});

await h.test('10. nobody matches a topic: nothing is sent; on the shared list carol takes it', async () => {
    const none = await post(alice.token, '/v1/help/questions', { question: 'Reverse charge VAT for a Swedish client?', topics: ['VAT'] });
    assert(none.status === 201 && none.body.data.nobody_found === true && none.body.data.sent_to.length === 0, `nobody ${err(none)}`);
    const board = await post(alice.token, '/v1/help/questions', { question: 'Reverse charge VAT for a Swedish client?', topics: ['VAT'], to_board: true });
    assert(board.status === 201, `to the shared list ${err(board)}`);
    const id = board.body.data.question.id;
    const list = await get(carol.token, '/v1/help/inbox');
    assert(list.body.data.board.some((x: any) => x.question_id === id), `carol sees it ${err(list)}`);
    const take = await post(carol.token, `/v1/help/questions/${id}/respond`, { action: 'take' });
    assert(take.status === 200 && typeof take.body.data.conversation_id === 'string', `taken ${err(take)}`);
    const twice = await post(bob.token, `/v1/help/questions/${id}/respond`, { action: 'take' });
    // Once taken, the question is no longer on the shared list: a second taker finds nothing there.
    assert(twice.status === 404, `taken once ${err(twice)}`);
});

await h.test('11. alice\'s AI asks only when she allowed it; MCP and REST agree', async () => {
    const session = await openSession(BASE, aliceAgent.token, 'help-alice');
    const f = await callTool(session, 'aimeat_help_find', { question: 'Entra', topics: ['Entra'] });
    assert(!f.isError && Array.isArray(f.data.helpers), `find over MCP ${JSON.stringify(f.data).slice(0, 300)}`);
    const off = await put(alice.token, '/v1/help/me', { ai_may_send: false, agents_may_ask: false });
    assert(off.status === 200, `alice says no ${err(off)}`);
    const refused = await callTool(session, 'aimeat_help_ask', { question: 'Entra guest question', topics: ['Entra'] });
    assert(refused.isError && String(refused.data._text ?? JSON.stringify(refused.data)).includes('AI_MAY_NOT_ASK'), `refused ${JSON.stringify(refused.data)}`);
    const inbox = await callTool(session, 'aimeat_help_inbox', {});
    assert(!inbox.isError && Array.isArray(inbox.data.mine), `inbox over MCP ${JSON.stringify(inbox.data).slice(0, 200)}`);
    const bobSession = await openSession(BASE, bobAgent.token, 'help-bob');
    const prof = await callTool(bobSession, 'aimeat_help_profile_set', { status: 'busy' });
    assert(!prof.isError && prof.data.participant.status === 'busy', `bob's AI may lower his availability ${JSON.stringify(prof.data).slice(0, 200)}`);
    const resp = await callTool(bobSession, 'aimeat_help_respond', { question_id: 'hq_nonexistent', action: 'pass' });
    assert(resp.isError, 'an unknown question is refused');
    const close = await callTool(session, 'aimeat_help_close', { question_id: 'hq_nonexistent' });
    assert(close.isError, 'an unknown question cannot be closed');
    await put(bob.token, '/v1/help/me', { status: 'available' });
});

await h.test('12. the operator makes the report\'s figures; a member is refused; the operator\'s AI writes it after a dry run', async () => {
    const no = await get(alice.token, '/v1/admin/help/reports?make=monthly');
    assert(no.status === 403, `a member is refused ${err(no)}`);
    const empty = await get(op.token, '/v1/admin/help/reports');
    assert(empty.status === 200 && empty.body.data.report === null, `no report yet is an empty answer, not an error ${err(empty)}`);
    const r = await get(op.token, '/v1/admin/help/reports?make=weekly');
    assert(r.status === 200 && typeof r.body.data.prompt === 'string' && r.body.data.report.figures, `figures ${err(r)}`);
    assert(!JSON.stringify(r.body.data.report).includes(alice.name), 'no names in the report');
    const id = r.body.data.report.id;
    const session = await openSession(BASE, opAgent.token, 'help-op');
    const data = await callTool(session, 'aimeat_help_report_data', { id });
    assert(!data.isError && data.data.report.id === id, `report data over MCP ${JSON.stringify(data.data).slice(0, 200)}`);
    const dry = await callTool(session, 'aimeat_help_report_write', { id, text: '# Report\n\nSummary.', suggestions: [{ title: 'Add a checklist', why: 'Repeats.' }], dry_run: true });
    assert(!dry.isError && dry.data.stored === false, `dry run ${JSON.stringify(dry.data).slice(0, 200)}`);
    const stored = await callTool(session, 'aimeat_help_report_write', { id, text: '# Report\n\nSummary.', suggestions: [{ title: 'Add a checklist', why: 'Repeats.' }] });
    assert(!stored.isError && stored.data.stored === true, `stored ${JSON.stringify(stored.data).slice(0, 200)}`);
    const reject = await post(op.token, `/v1/admin/help/reports/${id}`, { decisions: [{ n: 1, decision: 'reject' }] });
    assert(reject.status === 200 && reject.body.data.report.suggestions[0].status === 'rejected', `rejected ${err(reject)}`);
});

await h.test('12b. every door refuses an agent holding only "*" and a member at the operator\'s doors', async () => {
    // One statement per door, with the method beside its path: scripts/lib/route-refusals.ts reads
    // the nearest method word in the same statement as the door's method.
    const w = bobWild.token;
    const refused = (door: string, r: { status: number; body: any }) => assert(r.status === 403, `${door} refuses: ${err(r)}`);
    refused('GET me', await get(w, '/v1/help/me'));
    refused('PUT me', await send('PUT', w, '/v1/help/me', { status: 'busy' }));
    refused('POST find', await send('POST', w, '/v1/help/find', { question: 'Entra' }));
    refused('POST questions', await send('POST', w, '/v1/help/questions', { question: 'Entra?' }));
    refused('GET inbox', await get(w, '/v1/help/inbox'));
    refused('GET thread', await get(w, `/v1/help/threads/${entraConv}`));
    refused('POST respond', await send('POST', w, `/v1/help/questions/${entraId}/respond`, { action: 'pass' }));
    refused('POST close', await send('POST', w, `/v1/help/questions/${entraId}/close`, { action: 'cancel' }));
    refused('GET status (member)', await get(alice.token, '/v1/admin/help/status'));
    refused('GET reports (member)', await get(alice.token, '/v1/admin/help/reports'));
    refused('POST report (member)', await send('POST', alice.token, '/v1/admin/help/reports/2026-10', { text: 'x' }));
});

await h.test('13. switched off by the operator, nobody asks or reads and the skill is not taught; switched on again, it works', async () => {
    const SKILL = 'aimeat-ask-someone-who-knows';
    const session = await openSession(BASE, aliceAgent.token, 'help-skill');
    const book = await callTool(session, 'aimeat_handbook_get', {});
    assert(JSON.stringify(book.data).includes(SKILL), 'the handbook names the skill while the feature is on');
    const off = await config([{ path: 'help.enabled', value: false }]);
    assert(off.status === 200, `off ${err(off)}`);
    const refused = await post(alice.token, '/v1/help/questions', { question: 'Anything?' });
    assert(refused.status === 403 && refused.body.error.code === 'HELP_DISABLED', `refused ${err(refused)}`);
    const bookOff = await callTool(session, 'aimeat_handbook_get', {});
    assert(!JSON.stringify(bookOff.data).includes(SKILL), 'the handbook leaves the skill out while the feature is off');
    const skillOff = await callTool(session, 'aimeat_skill_get', { name: SKILL, body_only: true });
    assert(skillOff.isError && JSON.stringify(skillOff.data).includes('switched off'), `the skill says the feature is off ${JSON.stringify(skillOff.data).slice(0, 200)}`);
    const on = await config([{ path: 'help.enabled', value: true }]);
    assert(on.status === 200, `on ${err(on)}`);
    const me = await get(alice.token, '/v1/help/me');
    assert(me.status === 200, `back on ${err(me)}`);
    const skillOn = await callTool(session, 'aimeat_skill_get', { name: SKILL, body_only: true });
    assert(!skillOn.isError && String(skillOn.data.skill.fileContents['SKILL.md']).includes('Find first'), 'the skill reads again');
});

h.finish();

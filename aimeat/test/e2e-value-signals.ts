/**
 * @file test/e2e-value-signals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value report, driven the way a person's AI drives it: an agent makes a record, the
 *   person corrects it and someone else opens it, and the person's own report says so
 *   (aimeat_usage_report report=value, GET /v1/usage/summary); a goal carries the baseline the AI asked
 *   (aimeat_goal_set baseline); the organism's report is for its creator and admins only (GET
 *   /v1/organisms/:id/value, a member and an outsider refused); the operator's value and rhythm reports
 *   are node-wide and refuse a named person (GET /v1/admin/usage/summary). A report subscription
 *   (`reports.sub.<id>`) sends its report as a notification once, and a member who is not the
 *   organism's creator or an admin sends nothing for the organism (core:report-subscriptions). The
 *   organism is measured from its own workspace rows (`reports.measure.<organism>.<id>`, the report's
 *   `measures`), a broken or unplaceable measure says why, and a member reads no measure.
 *   A member reads, and subscribes to, the report of a workspace they may read, and of no other.
 * @structure v01..v14 in order; each later test reads what the earlier ones made.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=value-signals
 * @version-history
 *   v1.3.0 — 2026-11-20 — v14: a member's workspace report.
 *   v1.2.0 — 2026-11-20 — v12 and v13: an organism's own measures.
 *   v1.1.0 — 2026-11-20 — v10 and v11: report subscriptions, the send and the refusal (phase 4).
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession, type McpAgent } from './helpers/mcp-session.js';
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';

const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const stamp = Date.now().toString(36).slice(-5);

console.log('\n=== Value signals E2E (made, corrected, opened; goal baseline; organism and node reports) ===\n');

let operator!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, outsider!: RegisteredOwner;
let writer!: McpAgent, writerAi!: McpSession, aliceAi!: McpSession;
let teamId = '';

await test('v01 an agent makes a record, the person corrects it and opens it', async () => {
    operator = await setupOperator(BASE, ADMIN_PW, `vop${stamp}`);
    alice = await registerOwner(BASE, `valice${stamp}`);
    bob = await registerOwner(BASE, `vbob${stamp}`);
    outsider = await registerOwner(BASE, `vout${stamp}`);
    writer = await makeAgent(BASE, alice, ['memory:read', 'memory:write', 'wallet:read', 'task:write']);
    writerAi = await openSession(BASE, writer.token, 'writer-ai');
    const made = await callTool(writerAi, 'aimeat_memory_write', { key: 'report.november', value: { text: 'Sales grew in November.' } });
    assert(!made.isError, `the agent writes: ${made.text.slice(0, 200)}`);
    // The person corrects the agent's record in its namespace, then opens it.
    const fixed = await json('/v1/memory', {
        method: 'POST', headers: auth(alice.token),
        body: JSON.stringify({ key: 'report.november', value: { text: 'Sales grew by 12 % in November, mostly in the north.' }, agent: writer.gaii }),
    });
    assert(fixed.status === 200 || fixed.status === 201, `the person corrects: ${fixed.status} ${JSON.stringify(fixed.body).slice(0, 200)}`);
    const opened = await json(`/v1/memory/${encodeURIComponent('report.november')}?agent=${encodeURIComponent(writer.gaii)}`, { headers: auth(alice.token) });
    assert(opened.status === 200, `the person opens it: ${opened.status}`);
});

await test('v02 the person\'s value report counts the result, the correction and the use, per agent', async () => {
    const r = await callTool(writerAi, 'aimeat_usage_report', { report: 'value' });
    assert(!r.isError, `report: ${r.text.slice(0, 200)}`);
    const v = r.data;
    assert(v.report === 'value' && v.scope === 'own', `shape: ${JSON.stringify({ report: v.report, scope: v.scope })}`);
    assert(v.signals.produced >= 1 && v.signals.corrected >= 1 && v.signals.used >= 1, `signals: ${JSON.stringify(v.signals)}`);
    assert(v.by_producer.some((p: any) => p.producer === writer.gaii && p.produced >= 1), `per agent: ${JSON.stringify(v.by_producer)}`);
    assert(v.rules.rejection_window_days === 14 && Array.isArray(v.rules.read_endpoints), 'the report says what it rests on');
    const rest = await json('/v1/usage/summary?report=value', { headers: auth(alice.token) });
    assert(rest.status === 200 && rest.body.data.signals.produced === v.signals.produced, `REST says the same: ${rest.status}`);
});

await test('v03 another person reading the same report sees only their own numbers', async () => {
    const r = await json('/v1/usage/summary?report=value', { headers: auth(bob.token) });
    assert(r.status === 200, `bob reads his own: ${r.status}`);
    assert(r.body.data.signals.produced === 0 && (r.body.data.by_producer ?? []).length === 0, `bob sees nothing of alice: ${JSON.stringify(r.body.data.signals)}`);
});

await test('v04 a goal carries the baseline its AI asked for, and a bad one is refused', async () => {
    const made = await callTool(writerAi, 'aimeat_goal_set', {
        action: 'propose', statement: 'A customer report on the first day of every month.',
        baseline: { minutes: 180, per: 'result', note: 'about three hours by hand' },
    });
    assert(!made.isError, `propose: ${made.text.slice(0, 200)}`);
    const id = made.data.goal?.id ?? made.data.id;
    const got = await json(`/v1/goals/${id}`, { headers: auth(alice.token) });
    const baseline = got.body.data.goal?.baseline ?? got.body.data.baseline;
    assert(baseline?.minutes === 180 && baseline?.per === 'result', `baseline: ${JSON.stringify(got.body.data).slice(0, 300)}`);
    const bad = await callTool(writerAi, 'aimeat_goal_set', { action: 'propose', statement: 'x', baseline: { minutes: -5, per: 'year' } });
    assert(bad.isError, 'a negative baseline in years is refused');
    const report = await callTool(writerAi, 'aimeat_usage_report', { report: 'value' });
    assert(report.data.goals.some((g: any) => g.goal_id === id && g.baseline?.minutes === 180), `the report lists the goal: ${JSON.stringify(report.data.goals).slice(0, 300)}`);
});

await test('v05 the organism\'s report is for its creator; a member and an outsider are refused', async () => {
    aliceAi = await openSession(BASE, (await makeAgent(BASE, alice, ['organism:write', 'organism:read', 'organism:invite', 'memory:read', 'memory:write'])).token, 'alice-ai');
    const made = await callTool(aliceAi, 'aimeat_team_setup', { dry_run: false, teams: [{ name: `Myynti ${stamp}`, members: [bob.name] }] });
    assert(!made.isError, `team: ${made.text.slice(0, 200)}`);
    teamId = made.data.teams[0].organism_id;
    const accept = await json(`/v1/organisms/${teamId}/invitations/accept`, { method: 'POST', headers: auth(bob.token) });
    assert(accept.status === 200, `bob joins: ${accept.status}`);
    const asLead = await json(`/v1/organisms/${teamId}/value`, { headers: auth(alice.token) });
    assert(asLead.status === 200 && asLead.body.data.scope === 'organism' && asLead.body.data.by_producer === undefined, `lead: ${asLead.status} ${JSON.stringify(asLead.body.data ?? asLead.body).slice(0, 200)}`);
    const asMember = await json(`/v1/organisms/${teamId}/value`, { headers: auth(bob.token) });
    assert(asMember.status === 403 && asMember.body?.error?.code === 'ACCESS_DENIED', `a member is refused: ${asMember.status} ${JSON.stringify(asMember.body).slice(0, 160)}`);
    const asOutsider = await json(`/v1/organisms/${teamId}/value`, { headers: auth(outsider.token) });
    expectRefusal(asOutsider, 403, 'ACCESS_DENIED');
    const bad = await json(`/v1/organisms/${teamId}/value?from=yesterday`, { headers: auth(alice.token) });
    expectRefusal(bad, 400, 'INVALID_INPUT');
});

await test('v06 the operator reads the node\'s value and rhythm, never one person\'s', async () => {
    const value = await json('/v1/admin/usage/summary?report=value', { headers: auth(operator.token) });
    assert(value.status === 200 && value.body.data.scope === 'node' && value.body.data.by_producer === undefined, `node value: ${value.status} ${JSON.stringify(value.body).slice(0, 200)}`);
    assert(typeof value.body.data.hidden_groups === 'number', 'a small feature is left out and counted');
    const rhythm = await json('/v1/admin/usage/summary?report=rhythm', { headers: auth(operator.token) });
    assert(rhythm.status === 200 && Array.isArray(rhythm.body.data.features) && rhythm.body.data.rhythm, `rhythm: ${rhythm.status} ${JSON.stringify(rhythm.body).slice(0, 200)}`);
    const named = await json(`/v1/admin/usage/summary?report=value&owner=${alice.name}`, { headers: auth(operator.token) });
    expectRefusal(named, 400, 'INVALID_INPUT');
});

await test('v07 a person who is not the operator does not read the node\'s report', async () => {
    const r = await json('/v1/admin/usage/summary?report=value', { headers: auth(alice.token) });
    expectRefusal(r, 403);
});

await test('v08 the person reads what data of theirs passed through, without the data', async () => {
    const r = await callTool(writerAi, 'aimeat_usage_report', { report: 'data' });
    assert(!r.isError, `report: ${r.text.slice(0, 200)}`);
    const d = r.data;
    assert(d.report === 'data' && d.scope === 'own' && d.total.count >= 2, `total: ${JSON.stringify(d.total)}`);
    assert(d.by_source.some((s: any) => s.key === 'agent') && d.by_source.some((s: any) => s.key === 'person'), `sources: ${JSON.stringify(d.by_source)}`);
    assert(!JSON.stringify(d).includes('report.november') && !JSON.stringify(d).includes('Sales grew'), 'no key and no content in the report');
});

await test('v09 the operator\'s data report hides a group with fewer than five owners behind it', async () => {
    const r = await json('/v1/admin/usage/summary?report=data', { headers: auth(operator.token) });
    assert(r.status === 200 && r.body.data.scope === 'node', `node data: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const d = r.body.data;
    assert(typeof d.hidden_groups === 'number' && d.high_labels && d.rules.min_owners === 5, `rules: ${JSON.stringify({ h: d.hidden_groups, r: d.rules })}`);
    for (const list of [d.by_kind, d.by_source, d.by_direction, d.by_size, d.by_level, d.by_class]) {
        assert(list.every((g: any) => g.owners >= 5), `a group under five owners is shown: ${JSON.stringify(list)}`);
    }
});

const runSubscriptions = () => json('/v1/admin/scheduler/jobs/core:report-subscriptions/trigger', { method: 'POST', headers: auth(operator.token) });
const record = async (who: RegisteredOwner, key: string) =>
    (await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(who.token) })).body?.data?.value ?? {};
const reportsTo = async (who: RegisteredOwner) =>
    (((await json('/v1/notifications', { headers: auth(who.token) })).body?.data?.notifications ?? []) as any[])
        .filter(n => n.i18n?.key === 'report_subscription');

await test('v10 the person\'s AI saves a report subscription, and the report arrives as a notification', async () => {
    const key = 'reports.sub.my-ai-work';
    // The subscription is the person's record: the AI writes it under the owner (handbook "A report that comes by itself").
    const secretary = await openSession(BASE, (await makeAgent(BASE, alice, ['memory:read', 'memory:write', 'memory:write-as-owner'])).token, 'alice-secretary');
    const saved = await callTool(secretary, 'aimeat_memory_write', {
        key, owner_scope: true, value: { name: 'My AI work', scope: 'own', cadence: 'cron', cron: '* * * * *', contents: ['value', 'data'] },
    });
    assert(!saved.isError, `the AI saves it: ${saved.text.slice(0, 200)}`);
    const run = await runSubscriptions();
    assert(run.status === 200, `the job runs: ${run.status} ${JSON.stringify(run.body).slice(0, 200)}`);
    const got = await reportsTo(alice);
    assert(got.length === 1 && Number(got[0].i18n.vars.made) >= 1, `one report with what AI made: ${JSON.stringify(got).slice(0, 300)}`);
    assert(typeof (await record(alice, key)).lastSentAt === 'string', 'the record says when it went out');
    await runSubscriptions();
    assert((await reportsTo(alice)).length === 1, 'the same minute sends it once');
});

await test('v11 a member who is not the organism\'s creator or an admin sends nothing for the organism', async () => {
    const key = 'reports.sub.team-month';
    const w = await json('/v1/memory', {
        method: 'POST', headers: auth(bob.token),
        body: JSON.stringify({ key, value: { name: 'Team month', scope: 'organism', orgId: teamId, recipients: 'members', cadence: 'cron', cron: '* * * * *', contents: ['value'] } }),
    });
    assert(w.status === 200 || w.status === 201, `bob writes the record: ${w.status}`);
    const before = (await reportsTo(alice)).length;
    const run = await runSubscriptions();
    assert(run.status === 200, `the job runs: ${run.status}`);
    assert((await record(bob, key)).lastSkip === 'not-organism-owner', `the record says why: ${JSON.stringify(await record(bob, key))}`);
    assert((await reportsTo(bob)).length === 0 && (await reportsTo(alice)).length === before, 'no member receives the organism\'s report');
});

const manifestOf = (name: string) => ({
    manifestVersion: '1', id: teamId, name, kind: 'workspace', status: 'active',
    objectTypes: [{ name: 'offer', schemaRef: 'schema:offer@1', namespace: 'sales.offer', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['status'] }],
});
const putRows = async (who: RegisteredOwner, ws: string, rows: Array<Record<string, unknown>>) => {
    const m = await json('/v1/memory', {
        method: 'POST', headers: auth(who.token),
        body: JSON.stringify({ key: `organism.${teamId}.w.${ws}.meta.manifest`, value: manifestOf(ws), visibility: 'private' }),
    });
    assert(m.status === 200 || m.status === 201, `manifest ${ws}: ${m.status} ${JSON.stringify(m.body).slice(0, 200)}`);
    const r = await json(`/v1/organisms/${teamId}/workspace/rows/offer?ws=${ws}`, { method: 'POST', headers: auth(who.token), body: JSON.stringify({ rows: rows.map(body => ({ body })) }) });
    assert(r.status === 200 && r.body.data.written === rows.length, `rows ${ws}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
};
const measure = (who: RegisteredOwner, id: string, value: Record<string, unknown>) => json('/v1/memory', {
    method: 'POST', headers: auth(who.token), body: JSON.stringify({ key: `reports.measure.${teamId}.${id}`, value }),
});

await test('v12 the organism is measured from its own rows: how many offers went out, and their mean', async () => {
    await putRows(alice, 'deals', [
        { status: 'sent', amount: 1000 }, { status: 'sent', amount: 3000 }, { status: 'sent', amount: 2000 }, { status: 'draft', amount: 9000 },
    ]);
    await measure(alice, 'offers-sent', { name: 'Offers sent', wsId: 'deals', space: 'offer', op: 'count', where: [{ field: 'status', value: 'sent' }], per: 'week', unit: 'offers' });
    await measure(alice, 'mean-offer', { name: 'Mean offer', wsId: 'deals', space: 'offer', op: 'avg', field: 'amount', where: [{ field: 'status', value: 'sent' }] });
    await measure(alice, 'broken', { name: 'Broken', wsId: 'deals', space: 'offer', op: 'sum' });
    const r = await json(`/v1/organisms/${teamId}/value`, { headers: auth(alice.token) });
    assert(r.status === 200, `report: ${r.status}`);
    const byId = Object.fromEntries((r.body.data.measures as any[]).map(m => [m.id, m]));
    assert(byId['offers-sent']?.value === 3 && byId['offers-sent'].series?.length >= 1, `count: ${JSON.stringify(byId['offers-sent'])}`);
    assert(byId['offers-sent'].ws_name === 'deals', `with the workspace's own name: ${JSON.stringify(byId['offers-sent'])}`);
    assert(byId['mean-offer']?.value === 2000, `mean: ${JSON.stringify(byId['mean-offer'])}`);
    assert(byId.broken?.problem === 'invalid' && byId.broken.value === null, `a measure without its field says so: ${JSON.stringify(byId.broken)}`);
});

await test('v13 a measure of a space the workspace does not have says so, and a member reads no measure', async () => {
    await measure(alice, 'no-space', { name: 'Calls', wsId: 'deals', space: 'call', op: 'count' });
    const r = await json(`/v1/organisms/${teamId}/value`, { headers: auth(alice.token) });
    const byId = Object.fromEntries((r.body.data.measures as any[]).map(m => [m.id, m]));
    assert(byId['no-space']?.problem === 'no-space' && byId['no-space'].value === null, `a missing space: ${JSON.stringify(byId['no-space'])}`);
    // bob keeps a measure of his own; as a member he is refused the organism's report, measures and all.
    const w = await measure(bob, 'mine', { name: 'Mine', wsId: 'deals', space: 'offer', op: 'count' });
    assert(w.status === 200 || w.status === 201, `bob writes his record: ${w.status}`);
    expectRefusal(await json(`/v1/organisms/${teamId}/value`, { headers: auth(bob.token) }), 403, 'ACCESS_DENIED');
});

await test('v14 a member reads the report of a workspace they may read, and of no other', async () => {
    const m = await json('/v1/memory', {
        method: 'POST', headers: auth(alice.token),
        body: JSON.stringify({ key: `organism.${teamId}.w.open.meta.manifest`, value: manifestOf('open'), visibility: `organism:${teamId}` }),
    });
    assert(m.status === 200 || m.status === 201, `an organism-wide workspace: ${m.status} ${JSON.stringify(m.body).slice(0, 200)}`);
    const open = await json(`/v1/organisms/${teamId}/value?ws=open`, { headers: auth(bob.token) });
    assert(open.status === 200 && open.body.data.scope === 'organism', `bob reads the open workspace's report: ${open.status} ${JSON.stringify(open.body).slice(0, 200)}`);
    expectRefusal(await json(`/v1/organisms/${teamId}/value?ws=deals`, { headers: auth(bob.token) }), 403, 'ACCESS_DENIED');
    expectRefusal(await json(`/v1/organisms/${teamId}/value?ws=open`, { headers: auth(outsider.token) }), 403, 'ACCESS_DENIED');
    // The same rule at the send: bob's report of the private workspace is skipped and says why.
    const key = 'reports.sub.deals-week';
    await json('/v1/memory', {
        method: 'POST', headers: auth(bob.token),
        body: JSON.stringify({ key, value: { name: 'Deals week', scope: 'workspace', orgId: teamId, wsId: 'deals', cadence: 'cron', cron: '* * * * *', contents: ['value'] } }),
    });
    await runSubscriptions();
    assert((await record(bob, key)).lastSkip === 'no-workspace-read', `the record says why: ${JSON.stringify(await record(bob, key))}`);
});

await test('v15 a directive reaches a member\'s AI with the organism and the workspace; the creators see counts only', async () => {
    const put = (who: RegisteredOwner, key: string, value: Record<string, unknown>) =>
        json('/v1/memory', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ key, value }) });
    const org = await put(alice, `organism.${teamId}.meta.directive`, {
        text: 'Add each offer you send to the Offers space.', ask: 'ask-once-remember', suggest: { cadence: 'weekly', contents: ['value'] },
    });
    assert(org.status === 200 || org.status === 201, `the creator writes the directive: ${org.status} ${JSON.stringify(org.body).slice(0, 200)}`);
    const ws = await put(alice, `organism.${teamId}.w.open.meta.directive`, { text: 'In this workspace, mark won deals as won.', ask: 'every-use' });
    assert(ws.status === 200 || ws.status === 201, `and one for a workspace: ${ws.status}`);
    // A member may not write it: the namespace rule keeps meta.* for the creators.
    expectRefusal(await put(bob, `organism.${teamId}.meta.directive`, { text: 'Send me everything.' }), 403);

    const seen = await json(`/v1/organisms/${teamId}`, { headers: auth(bob.token) });
    const d = seen.body.data.organism_directive;
    assert(d?.items?.length === 1 && d.items[0].text === 'Add each offer you send to the Offers space.' && d.items[0].ask === 'ask-once-remember',
        `the member's AI gets the organism's directive: ${JSON.stringify(seen.body.data).slice(0, 300)}`);
    assert(typeof d.rule === 'string' && /no right/.test(d.rule) && d.answer_key === `directive.answer.${teamId}` && d.your_answer === null, `with the rule and where the answer goes: ${JSON.stringify(d)}`);
    assert(seen.body.data.organism_directive_summary === undefined, 'a member does not see the counts');
    const inWs = await json(`/v1/organisms/${teamId}/workspace/index?ws=open`, { headers: auth(bob.token) });
    const wd = inWs.body.data?.organism_directive;
    assert(inWs.status === 200 && wd?.items?.map((i: any) => i.level).join() === 'organism,workspace'
        && wd.answer_key === `directive.answer.${teamId}.open`, `the workspace adds its own: ${inWs.status} ${JSON.stringify(wd).slice(0, 300)}`);

    const answered = await put(bob, `directive.answer.${teamId}`, { answer: 'scheduled', subscription: 'reports.sub.team-month', at: new Date().toISOString() });
    assert(answered.status === 200 || answered.status === 201, `the member's answer is his own record: ${answered.status}`);
    const lead = await json(`/v1/organisms/${teamId}`, { headers: auth(alice.token) });
    const s = lead.body.data.organism_directive_summary;
    assert(s?.answers?.scheduled === 1 && s.answers.declined === 0 && s.review_due === false, `the creator sees a count: ${JSON.stringify(s)}`);
    assert(!JSON.stringify(s).includes(bob.name), 'and never who answered');
    expectRefusal(await json(`/v1/organisms/${teamId}`, { headers: auth(outsider.token) }), 404);
});

finish();

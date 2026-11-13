/**
 * @file test/e2e-compliance-lia.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the balancing test of an app (the legitimate interests assessment of GDPR
 *   art. 6(1)(f)), over REST and the node MCP. The acceptance terms of the developer's specification
 *   of 2026-11-13, one test each, and the refusals:
 *     - a demo only its user sees is published: no question, no gap, with legitimate interests in
 *       its register too;
 *     - an app shared with an organism, employment data, legitimate interests: the gap list names the
 *       missing test, and the publish, the data map write and the register write point to the draft;
 *     - the draft: the purpose and basis, the data and the server's safeguards are filled, and no
 *       yes or no is answered without evidence;
 *     - health data on legitimate interests: no test is drafted or stored (409), the person is
 *       pointed to another basis;
 *     - an agent saves the test (its answers marked `ai`) and asks for approval: nothing is approved,
 *       an agent may not allow it, the owner in person allows it, and the test names both; a test
 *       changed after the question is not approved by the old question;
 *     - the approved test is in the operator's report, its Excel workbook and PDF download, the
 *       organism's privacy contact hears of it, and a wider reach opens it again;
 *     - a trial: a shared app with no regulated data is asked no test while the trial runs;
 *     - another owner reads and approves nothing (404), an agent without the words is refused (403),
 *       and a deleted app takes its tests and trial mark.
 *   The trial that ended is in test/unit/compliance-lia.test.ts: it needs the clock moved.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-compliance-lia
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body; type: string; bytes: Buffer }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(90_000),
    });
    const type = res.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, bytes, body: type.includes('json') ? JSON.parse(bytes.toString('utf8')) as Body : {} };
}
const kindsOf = (b: Body): string[] => ((b?.data?.gaps ?? []) as Body[]).map(g => g.kind as string);
const err = (r: { status: number; body: Body }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 300)}`;

console.log('\n=== The balancing test of an app (legitimate interests) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner;
let orgId = '';
let aliceMcp!: McpSession, aliceBareMcp!: McpSession;
let aliceAgentToken = '', aliceAgentGaii = '', aliceOtherAgentToken = '';
const tag = stamp % 1000000;
const DEMO = `liademo${tag}.html`;
const TEAM = `liateam${tag}.html`;
const TRIAL = `liatrial${tag}.html`;
const HEALTH = `liahealth${tag}.html`;
const html = (title: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="aimeat-scopes" content="memory:read memory:write"><title>${title}</title></head><body>${title}</body></html>`;
const publish = (owner: RegisteredOwner, filename: string, name: string) =>
    call('POST', '/v1/apps', owner.token, { filename, content: Buffer.from(html(name)).toString('base64'), mime_type: 'text/html', name, description: 'E2E' });
const q = (app: string) => `scope=app&app=${app}`;
const row = (over: Record<string, unknown> = {}) => ({
    what: 'usage.*', holds: 'how each person uses AI tools', kind: 'metrics', usedFor: 'calculation-and-reporting', where: 'owner-memory-private', owner: 'person',
    readers: 'owner-only', writers: ['the-app-for-the-person'], shape: 'one-per-thing', keptFor: 'rolling-window', lossRisk: 'recomputable', personalData: 'yes', why: 'Kept with the person.', domains: [], ...over,
});
const SHARED = { where: 'organism-workspace', owner: 'organism', readers: 'organism-members' };
const putMap = (owner: RegisteredOwner, app: string, rows: unknown[]) => call('PUT', `/v1/datamap/apps/${owner.name}/${app}`, owner.token, {
    spec: 'aimeat.datamap/2', what: 'A view of AI use.', usedFor: 'Seeing how AI tools are used.', form: 'group', arrangement: 'One record per person.', machinery: [], leaves: [], held: rows, elsewhere: [],
});
const register = (over: Record<string, unknown> = {}) => ({
    id: 'usage', title: 'AI use of the team', type: 'personal', purpose: 'employee', purposeText: 'Follow how the team uses AI tools.',
    legalBasis: ['legitimate-interests'], retentionMonths: 12, reviewedAt: new Date().toISOString(), ...over,
});
const putRegister = (owner: RegisteredOwner, app: string, over: Record<string, unknown> = {}) =>
    call('PUT', `/v1/compliance/docs/registers?${q(app)}`, owner.token, { items: [register(over)] });
const liaGaps = (kinds: string[]) => kinds.filter(k => k.startsWith('lia-') || k === 'legitimate-interests-special-category' || k === 'app-trial-expired');

await test('Setup: an operator, alice with an organism bob belongs to, her agents, and four apps', async () => {
    op = await registerOwner(BASE, `liaop${stamp}`);
    alice = await registerOwner(BASE, `liaalice${stamp}`);
    bob = await registerOwner(BASE, `liabob${stamp}`);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Lia Team ${stamp}`, type: 'project', join_policy: 'open' });
    assert(o.status === 201, `organism: ${err(o)}`);
    orgId = o.body.data.organism.id;
    const j = await call('POST', `/v1/organisms/${orgId}/join`, bob.token, {});
    assert(j.status === 201, `bob joins: ${err(j)}`);
    const agent = await makeAgent(BASE, alice, ['compliance:read', 'compliance:write'], `liaa${stamp % 100000}`);
    aliceAgentToken = agent.token;
    aliceAgentGaii = agent.gaii;
    aliceMcp = await openSession(BASE, agent.token, 'balancing test');
    const bare = await makeAgent(BASE, alice, ['*'], `liab${stamp % 100000}`);
    aliceOtherAgentToken = bare.token;
    aliceBareMcp = await openSession(BASE, bare.token, 'balancing test, no words');
});

// ─── Acceptance 1 ───
await test('DEMO: an app only its user sees is published with no question and no gap, with legitimate interests in its register too', async () => {
    const p = await publish(alice, DEMO, 'Demo');
    assert(p.status === 201, `publish: ${err(p)}`);
    assert(p.body.data.next_steps && !('balancing_test' in p.body.data.next_steps), `the publish says nothing of a test: ${JSON.stringify(p.body.data.next_steps?.balancing_test)}`);
    const m = await putMap(alice, DEMO, [row()]);
    assert(m.status === 200 && !('balancing_test' in m.body.data), `the map write says nothing: ${err(m)}`);
    const r = await putRegister(alice, DEMO);
    assert(r.status === 200 && r.body.data.stored === true && !('balancing_test' in r.body.data), `the register write says nothing: ${err(r)}`);
    const g = await call('GET', `/v1/compliance/gaps?${q(DEMO)}`, alice.token);
    assert(g.status === 200 && liaGaps(kindsOf(g.body)).length === 0, `no balancing test gap: ${kindsOf(g.body)}`);
    const d = await call('GET', `/v1/compliance/lia/draft?app=${DEMO}`, alice.token);
    assert(d.status === 200 && d.body.data.needed === false && d.body.data.items.length === 0, `no draft: ${err(d)}`);
    assert(d.body.data.not_needed?.[0]?.reason === 'only-its-user', `the reason is named: ${JSON.stringify(d.body.data.not_needed)}`);
    const again = await publish(alice, DEMO, 'Demo');
    assert(again.status === 201 && !('balancing_test' in (again.body.data.next_steps ?? {})), `a second version says nothing either: ${err(again)}`);
});

// ─── Acceptance 2 ───
await test('SHARED: employment data shared with an organism on legitimate interests: the gap names the missing test and three answers point to the draft', async () => {
    assert((await publish(alice, TEAM, 'Team AI use')).status === 201, 'publish');
    const quiet = await putMap(alice, TEAM, [row({ ...SHARED, domains: ['employment'] })]);
    assert(quiet.status === 200 && !('balancing_test' in quiet.body.data), `POSITIVE CONTROL, no register yet, so no basis and no test: ${err(quiet)}`);
    const r = await putRegister(alice, TEAM, { containers: [{ kind: 'organism', organism_id: orgId }] });
    assert(r.status === 200 && r.body.data.balancing_test?.state === 'missing', `the register write points to the draft: ${err(r)}`);
    assert(String(r.body.data.balancing_test.draft?.tool).includes('lia_draft') && String(r.body.data.balancing_test.url).includes(`/v1/appcat?app=${alice.name}/${TEAM}`), `it names the draft and the app's page: ${JSON.stringify(r.body.data.balancing_test)}`);
    const g = await call('GET', `/v1/compliance/gaps?${q(TEAM)}`, alice.token);
    const gap = (g.body.data.gaps as Body[]).find(x => x.kind === 'lia-missing');
    assert(gap && gap.evidence.register === 'usage' && gap.evidence.domains.includes('employment'), `lia-missing: ${kindsOf(g.body)}`);
    assert(String(gap.detail).includes('employment privacy law'), `the employment reminder rides along: ${gap.detail}`);
    const m = await putMap(alice, TEAM, [row({ ...SHARED, domains: ['employment'] })]);
    assert(m.body.data.balancing_test?.state === 'missing', `the map write points to the draft: ${err(m)}`);
    const p = await publish(alice, TEAM, 'Team AI use');
    assert(p.status === 201 && String(p.body.data.next_steps?.balancing_test).includes('lia_draft') && String(p.body.data.next_steps.balancing_test).includes('Not blocking'), `the publish points to the draft and does not block: ${JSON.stringify(p.body.data.next_steps?.balancing_test)}`);
});

// ─── Acceptance 3 ───
let liaId = '';
let questionIds: string[] = [];
await test('DRAFT: the purpose and basis, the data and the safeguards are filled; no yes or no is answered without evidence', async () => {
    const d = await call('GET', `/v1/compliance/lia/draft?app=${TEAM}&lang=fi`, alice.token);
    assert(d.status === 200 && d.body.data.needed === true && d.body.data.items.length === 1, `draft: ${err(d)}`);
    const it = d.body.data.items[0];
    liaId = it.id;
    assert(it.stored === false && it.status === 'draft' && it.registerId === 'usage', `a draft of the register: ${JSON.stringify({ stored: it.stored, status: it.status })}`);
    // Section 1: the purpose and the basis, from the register.
    assert(it.facts.purposeText === 'Follow how the team uses AI tools.' && it.facts.legalBasis.join() === 'legitimate-interests', `section 1: ${JSON.stringify(it.facts.legalBasis)}`);
    // Section 4: the data, the regulated data, the people, who sees it.
    assert(it.facts.dataCategories.length === 1 && it.facts.domains.join() === 'employment' && it.facts.subjects.length >= 1 && it.facts.reach === 'shared', `section 4: ${JSON.stringify(it.facts)}`);
    // Section 5: the server's own safeguards.
    assert(it.facts.nodeSafeguards.length >= 3 && it.facts.nodeSafeguards.every((s: Body) => s.text), `section 5: ${it.facts.nodeSafeguards.length}`);
    assert(it.facts.reminders.length === 1, `the employment reminder: ${JSON.stringify(it.facts.reminders)}`);
    // The only answer is the one the app shows: employees are in a dependent position.
    assert(JSON.stringify(it.answers) === JSON.stringify({ 'balance-dependent': 'yes' }), `only evidence is answered: ${JSON.stringify(it.answers)}`);
    assert(it.answerSources['answers.balance-dependent'] === 'evidence', `marked as evidence: ${JSON.stringify(it.answerSources)}`);
    assert(it.outcome === undefined && it.unfinished.outcome === true, 'the outcome is never prefilled');
    questionIds = (d.body.data.questions as Body[]).flatMap(s => (s.questions as Body[]).map(x => x.id as string));
    assert(questionIds.length === 17 && it.unfinished.unanswered.length === 16, `17 questions, 16 open: ${questionIds.length}, ${it.unfinished.unanswered.length}`);
    assert(d.body.data.questions[0].title.includes('käsittelyperuste'), `the questions are in the language asked: ${d.body.data.questions[0].title}`);
    const stored = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(stored.body.data.items.length === 0, 'POSITIVE CONTROL, a draft is stored nowhere');
});

// ─── Acceptance 4 ───
await test('HEALTH: health data on legitimate interests gets no test: no draft, a refused write (409), and a pointer to another basis', async () => {
    assert((await publish(alice, HEALTH, 'Wellbeing')).status === 201, 'publish');
    const m0 = await putMap(alice, HEALTH, [row({ ...SHARED, holds: 'sick leave notes', domains: ['health'] })]);
    assert(m0.status === 200, `map: ${err(m0)}`);
    const r = await putRegister(alice, HEALTH, { id: 'leave', title: 'Sick leave' });
    assert(r.status === 200 && r.body.data.balancing_test?.state === 'choose-another-basis' && !r.body.data.balancing_test.draft, `the register write points to another basis: ${err(r)}`);
    const d = await call('GET', `/v1/compliance/lia/draft?app=${HEALTH}`, alice.token);
    assert(d.status === 200 && d.body.data.needed === false && d.body.data.items.length === 0 && d.body.data.not_allowed?.length === 1, `no draft: ${err(d)}`);
    const w = await call('PUT', `/v1/compliance/docs/lias?${q(HEALTH)}`, alice.token, { items: [{ id: 'lia-leave', registerId: 'leave', answers: {} }] });
    assert(w.status === 409 && w.body.error.code === 'LIA_SPECIAL_CATEGORY', `DENIAL, a test is not stored: ${err(w)}`);
    const g = await call('GET', `/v1/compliance/gaps?${q(HEALTH)}`, alice.token);
    const kinds = kindsOf(g.body);
    assert(kinds.includes('legitimate-interests-special-category') && !kinds.includes('lia-missing'), `the gap says choose another basis: ${kinds}`);
    const other = await putRegister(alice, HEALTH, { id: 'leave', title: 'Sick leave', legalBasis: ['legal-obligation'], specialBasis: 'employment-law' });
    assert(other.status === 200 && !('balancing_test' in other.body.data), `with another basis nothing is said: ${err(other)}`);
});

// ─── Acceptance 5: an agent prepares, a person approves ───
const answersAll = (): Record<string, string> => Object.fromEntries(questionIds.map(id => [id, id.startsWith('basis-') || id === 'necessity-less-intrusive' || id === 'balance-harm' ? 'no' : 'yes']));
let requestId = '';
await test('AGENT: an agent saves the test as a draft marked `ai`, and its approval waits for the owner', async () => {
    const save = await callTool(aliceMcp, 'aimeat_compliance_register_write', {
        part: 'lias', app: TEAM,
        value: { items: [{ id: liaId, registerId: 'usage', status: 'approved', approvedBy: 'someone', language: 'en', answers: answersAll(), notes: { basis: 'No contract or law covers this.' }, outcome: { result: 'suitable', summary: 'A small effect on the team.' } }] },
    });
    assert(!save.isError && save.data?.items?.length === 1, `save: ${save.text.slice(0, 300)}`);
    const it = save.data.items[0];
    assert(it.status === 'draft' && it.approvedBy === undefined, `DENIAL, a write approves nothing: ${JSON.stringify({ status: it.status, approvedBy: it.approvedBy })}`);
    assert(it.answerSources['answers.interest-lawful'] === 'ai' && it.answerSources['notes.basis'] === 'ai' && it.answerSources.outcome === 'ai', `an agent's answers are marked ai: ${JSON.stringify(it.answerSources)}`);
    assert(it.answerSources['answers.balance-dependent'] === 'evidence' && it.answerSources.facts === 'evidence', 'what the server read stays evidence');
    const ask = await callTool(aliceMcp, 'aimeat_compliance_register_write', { part: 'lias', app: TEAM, item_id: liaId, set: { status: 'approved' } });
    assert(!ask.isError && ask.data?.stored === false && ask.data?.approval_request?.status === 'awaiting_owner', `the owner is asked: ${ask.text.slice(0, 400)}`);
    requestId = ask.data.approval_request.request_id;
    const still = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(still.body.data.items[0].status === 'draft', 'POSITIVE CONTROL, nothing is approved while the question waits');
    const g = await call('GET', `/v1/compliance/gaps?${q(TEAM)}`, alice.token);
    assert(kindsOf(g.body).includes('lia-incomplete'), `the gap says it waits for approval: ${kindsOf(g.body)}`);
    const rest = await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${q(TEAM)}`, aliceAgentToken, { set: { status: 'approved' } });
    assert(rest.status === 202 && rest.body.data.approval_request?.already_waiting === true, `over REST the same question, 202: ${err(rest)}`);
});

await test('AGENT: an agent may not allow its own question; the owner in person allows it, and the test names both', async () => {
    const byAgent = await call('POST', `/v1/publish-requests/${requestId}/decision`, aliceAgentToken, { decision: 'approve' });
    assert(byAgent.status === 403, `DENIAL, the agent that asked allows nothing: ${err(byAgent)}`);
    // Another agent of the same owner, with every permission a wildcard carries: the approval is the
    // person's, so this one is refused too. Seen red with `in_person` off in lia-ops.ts.
    const byOther = await call('POST', `/v1/publish-requests/${requestId}/decision`, aliceOtherAgentToken, { decision: 'approve' });
    assert(byOther.status === 403, `DENIAL, another agent of the owner allows nothing either: ${err(byOther)}`);
    const mid = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(mid.body.data.items[0].status === 'draft', 'POSITIVE CONTROL, still a draft');
    const yes = await call('POST', `/v1/publish-requests/${requestId}/decision`, alice.token, { decision: 'approve' });
    assert(yes.status === 200, `the owner allows: ${err(yes)}`);
    const after = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    const it = after.body.data.items[0];
    assert(it.status === 'approved' && it.standing.state === 'approved', `approved: ${JSON.stringify({ status: it.status, standing: it.standing })}`);
    assert(String(it.approvedBy).startsWith(`${alice.name}@`) && it.requestedBy === aliceAgentGaii, `who approved and who asked: ${it.approvedBy}, ${it.requestedBy}`);
    assert(it.approvedOn.reach === 'shared' && it.approvedOn.domains.join() === 'employment' && Date.parse(it.reviewAt) > Date.now() + 300 * 86_400_000, `what it was approved on, and a review date: ${JSON.stringify(it.approvedOn)} ${it.reviewAt}`);
    assert(it.answerSources['answers.interest-lawful'] === 'ai', 'the record still says a model drafted the answers');
    const g = await call('GET', `/v1/compliance/gaps?${q(TEAM)}`, alice.token);
    assert(liaGaps(kindsOf(g.body)).length === 0, `no balancing test gap is left: ${kindsOf(g.body)}`);
});

await test('REPORT: the approved test is in the operator\'s report; its workbook and PDF download; the privacy contact was not told, because the organism named none', async () => {
    const rep = await call('GET', '/v1/admin/compliance/report', op.token);
    assert(rep.status === 200 && rep.body.data.processing.lias.total >= 1 && rep.body.data.processing.lias.approved >= 1, `the report counts it: ${JSON.stringify(rep.body.data?.processing?.lias ?? rep.body.error)}`);
    const all = await call('GET', '/v1/compliance/docs/lias?scope=all', op.token);
    const place = (all.body.data.places as Body[]).find(p => p.place.app === TEAM);
    assert(place && place.items[0].status === 'approved' && place.may_write === false, `the operator reads it and does not write it: ${JSON.stringify(place?.place)}`);
    const x = await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}&format=xlsx`, alice.token);
    assert(x.status === 200 && x.type.includes('spreadsheetml') && x.bytes.subarray(0, 2).toString('latin1') === 'PK' && x.bytes.length > 2000, `the workbook: ${x.status} ${x.type} ${x.bytes.length}`);
    const pdf = await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}`, alice.token);
    assert(pdf.status === 200 && pdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-', `the PDF: ${pdf.status} ${pdf.type}`);
    const md = await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}&format=md&lang=fi`, alice.token);
    const text = md.bytes.toString('utf8');
    assert(md.status === 200 && text.includes('Tasapainotesti') && text.includes(`${alice.name}@`) && text.includes('tekoäly'), `the Markdown names the approver and what an AI drafted: ${text.slice(0, 200)}`);
    const bad = await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}&format=docx`, alice.token);
    assert(bad.status === 400, `an unknown format: ${bad.status}`);
    const n = await call('GET', '/v1/notifications', bob.token);
    assert(!((n.body.data?.notifications ?? []) as Body[]).some(x => x.type === 'compliance_lia_approved'), 'POSITIVE CONTROL, nobody was named as the privacy contact yet');
});

await test('REOPEN: when anyone can see the data the approved test is open again; the owner approves again in person, and the privacy contact hears', async () => {
    const c = await call('PUT', `/v1/compliance/docs/contact?scope=organism&organism_id=${orgId}`, alice.token, { privacyContact: bob.name, notifyApprovedLia: true });
    assert(c.status === 200 && c.body.data.stored === true, `the organism names bob: ${err(c)}`);
    const stranger = await call('PUT', `/v1/compliance/docs/contact?scope=organism&organism_id=${orgId}`, alice.token, { privacyContact: op.name });
    assert(stranger.status === 400, `DENIAL, a contact who is no member: ${err(stranger)}`);
    const m = await putMap(alice, TEAM, [row({ where: 'owner-memory-public', readers: 'anyone', domains: ['employment'] })]);
    assert(m.body.data.balancing_test?.state === 'open-again', `the map write says it is open again: ${err(m)}`);
    const g = await call('GET', `/v1/compliance/gaps?${q(TEAM)}`, alice.token);
    const gap = (g.body.data.gaps as Body[]).find(x => x.kind === 'lia-reopened');
    assert(gap && gap.evidence.changed.reachTo === 'exposed', `lia-reopened: ${kindsOf(g.body)}`);
    const r = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(r.body.data.items[0].status === 'approved' && r.body.data.items[0].standing.state === 'reopened', 'the stored approval is kept, and reads as open again');
    const again = await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${q(TEAM)}`, alice.token, { set: { status: 'approved', review_months: 6 } });
    assert(again.status === 200 && again.body.data.item.approvedOn.reach === 'exposed' && again.body.data.item.requestedBy === undefined, `in person it is approved at once: ${err(again)}`);
    const g2 = await call('GET', `/v1/compliance/gaps?${q(TEAM)}`, alice.token);
    assert(liaGaps(kindsOf(g2.body)).length === 0, `closed again: ${kindsOf(g2.body)}`);
    const n = await call('GET', '/v1/notifications', bob.token);
    const notice = ((n.body.data?.notifications ?? []) as Body[]).find(x => x.type === 'compliance_lia_approved');
    assert(notice && notice.i18n?.key === 'compliance_lia_approved', `bob, the privacy contact, hears: ${JSON.stringify((n.body.data?.notifications ?? []).map((x: Body) => x.type))}`);
});

await test('STALE: a test changed after approval was asked is not approved by the old question', async () => {
    const edit = async (summary: string, token: string) => call('PUT', `/v1/compliance/docs/lias?${q(TEAM)}`, token, { items: [{ id: liaId, registerId: 'usage', language: 'en', answers: answersAll(), notes: { basis: 'No contract or law covers this.' }, outcome: { result: 'suitable', summary } }] });
    const e1 = await edit('A changed summary.', alice.token);
    assert(e1.status === 200 && e1.body.data.items[0].status === 'draft', `an edited test is a draft again: ${err(e1)}`);
    assert(e1.body.data.items[0].answerSources.outcome === 'human' && e1.body.data.items[0].answerSources['answers.interest-lawful'] === 'ai', `the person's change is marked human, the untouched answers stay ai: ${JSON.stringify(e1.body.data.items[0].answerSources.outcome)}`);
    const ask = await callTool(aliceMcp, 'aimeat_compliance_register_write', { part: 'lias', app: TEAM, item_id: liaId, set: { status: 'approved' } });
    assert(!ask.isError && ask.data?.approval_request?.request_id, `asked: ${ask.text.slice(0, 300)}`);
    assert((await edit('Changed once more, after the question.', alice.token)).status === 200, 'edit after the question');
    await call('POST', `/v1/publish-requests/${ask.data.approval_request.request_id}/decision`, alice.token, { decision: 'approve' });
    const after = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(after.body.data.items[0].status === 'draft', `DENIAL, the old question approved nothing: ${after.body.data.items[0].status}`);
    const incomplete = await call('PUT', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token, { items: [{ id: liaId, registerId: 'usage', answers: { 'interest-lawful': 'yes' } }] });
    assert(incomplete.status === 200, 'an unfinished test is saved');
    const no = await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${q(TEAM)}`, alice.token, { set: { status: 'approved' } });
    assert(no.status === 409 && no.body.error.code === 'LIA_INCOMPLETE', `DENIAL, an unfinished test is not approved: ${err(no)}`);
    const field = await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${q(TEAM)}`, alice.token, { set: { approvedBy: 'x', status: 'approved' } });
    assert(field.status === 400, `DENIAL, no field is set in place: ${err(field)}`);
});

// ─── A trial ───
await test('TRIAL: a shared app with no regulated data is asked no test while its trial runs, and is asked when the owner says it goes into use', async () => {
    assert((await publish(alice, TRIAL, 'Trial tool')).status === 201, 'publish');
    assert((await putMap(alice, TRIAL, [row({ ...SHARED, holds: 'names of colleagues' })])).status === 200, 'map');
    assert((await putRegister(alice, TRIAL, { id: 'names', title: 'Names', purpose: 'member' })).body.data.balancing_test?.state === 'missing', 'without a trial mark the test is asked');
    const t = await call('PUT', `/v1/compliance/docs/trial?${q(TRIAL)}`, alice.token, { note: 'Trying the shape with one team.' });
    assert(t.status === 200 && t.body.data.state === 'active' && t.body.data.days === 60, `a trial of 60 days by default: ${err(t)}`);
    assert(Math.abs(Date.parse(t.body.data.expiresAt) - Date.now() - 60 * 86_400_000) < 60_000, `the server's clock sets the end: ${t.body.data.expiresAt}`);
    const forged = await call('PUT', `/v1/compliance/docs/trial?${q(TRIAL)}`, alice.token, { expiresAt: '2099-01-01T00:00:00Z' });
    assert(forged.status === 400, `DENIAL, the caller sets no date: ${err(forged)}`);
    const g = await call('GET', `/v1/compliance/gaps?${q(TRIAL)}`, alice.token);
    assert(liaGaps(kindsOf(g.body)).length === 0, `no test is asked of a trial: ${kindsOf(g.body)}`);
    const d = await callTool(aliceMcp, 'aimeat_compliance_register_read', { part: 'lia_draft', app: TRIAL });
    assert(!d.isError && d.data?.needed === false && d.data?.not_needed?.[0]?.reason === 'trial' && d.data?.trial?.state === 'active', `over MCP, the reason is the trial: ${d.text.slice(0, 300)}`);
    const read = await callTool(aliceMcp, 'aimeat_compliance_register_read', { part: 'trial', app: TRIAL });
    assert(!read.isError && read.data?.state === 'active', `the trial mark over MCP: ${read.text.slice(0, 200)}`);
    const end = await callTool(aliceMcp, 'aimeat_compliance_register_write', { part: 'trial', app: TRIAL, value: { end: true } });
    assert(!end.isError && end.data?.state === 'ended', `into use: ${end.text.slice(0, 200)}`);
    const g2 = await call('GET', `/v1/compliance/gaps?${q(TRIAL)}`, alice.token);
    assert(kindsOf(g2.body).includes('lia-missing'), `in use, the test is asked: ${kindsOf(g2.body)}`);
});

// ─── Who may ───
await test('ACCESS: another owner reads, writes and approves nothing (404); an agent without the words is refused (403)', async () => {
    const asBob = `scope=app&app=${TEAM}&app_owner=${alice.name}`;
    for (const [what, r] of [
        ['read', await call('GET', `/v1/compliance/docs/lias?${asBob}`, bob.token)],
        ['draft', await call('GET', `/v1/compliance/lia/draft?app=${TEAM}&app_owner=${alice.name}`, bob.token)],
        ['file', await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}&app_owner=${alice.name}`, bob.token)],
        ['write', await call('PUT', `/v1/compliance/docs/lias?${asBob}`, bob.token, { items: [] })],
        ['approve', await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${asBob}`, bob.token, { set: { status: 'approved' } })],
        ['trial', await call('PUT', `/v1/compliance/docs/trial?${asBob}`, bob.token, { days: 10 })],
    ] as const) assert(r.status === 404, `DENIAL, bob ${what}: ${r.status}`);
    const opWrite = await call('PUT', `/v1/compliance/docs/lias?${asBob}`, op.token, { items: [] });
    assert(opWrite.status === 404, `DENIAL, the operator reads and does not write another owner's test: ${opWrite.status}`);
    const bare = await callTool(aliceBareMcp, 'aimeat_compliance_register_read', { part: 'lia_draft', app: TEAM });
    assert(bare.isError, `DENIAL, an agent without compliance:read: ${bare.text.slice(0, 200)}`);
    // The same agent over REST: its wildcard does not carry compliance:read, so both routes refuse it.
    const noWordDraft = await call('GET', `/v1/compliance/lia/draft?app=${TEAM}`, aliceOtherAgentToken);
    assert(noWordDraft.status === 403, `DENIAL, the draft without compliance:read: ${err(noWordDraft)}`);
    const noWordFile = await call('GET', `/v1/compliance/lia/${liaId}/document?app=${TEAM}`, aliceOtherAgentToken);
    assert(noWordFile.status === 403, `DENIAL, the file without compliance:read: ${err(noWordFile)}`);
    const noWordApprove = await call('PATCH', `/v1/compliance/docs/lias/${liaId}?${q(TEAM)}`, aliceOtherAgentToken, { set: { status: 'approved' } });
    assert(noWordApprove.status === 403, `DENIAL, an approval request without compliance:write: ${err(noWordApprove)}`);
    const still = await call('GET', `/v1/compliance/docs/lias?${q(TEAM)}`, alice.token);
    assert(still.status === 200 && still.body.data.items.length === 1, 'POSITIVE CONTROL, alice still reads her test');
});

// Its own test: the route check credits every route a block names with that block's refusals, and
// nothing here refuses a delete.
await test('DELETED: a deleted app takes its balancing tests and its trial mark with it', async () => {
    const listed = async (kind: string, prefix: string) => ((await call('GET', `/v1/compliance/docs/${kind}?scope=all`, op.token)).body.data.places as Body[])
        .some(p => String(p.place.app).startsWith(prefix));
    assert(await listed('lias', `liateam${tag}`), 'POSITIVE CONTROL, the balancing test is listed before the delete');
    const delTeam = await call('DELETE', `/v1/apps/${TEAM}`, alice.token);
    assert(delTeam.status === 200, `delete the team app: ${err(delTeam)}`);
    assert(!(await listed('lias', `liateam${tag}`)), 'the deleted app\'s balancing test is gone');
    const before = await call('GET', '/v1/compliance/docs/trial?scope=all', op.token);
    assert((before.body.data.places as Body[]).some(p => String(p.place.app).startsWith(`liatrial${tag}`)), 'POSITIVE CONTROL, the trial mark is listed before the delete');
    const del = await call('DELETE', `/v1/apps/${TRIAL}`, alice.token);
    assert(del.status === 200, `delete the trial app: ${err(del)}`);
    const trials = await call('GET', '/v1/compliance/docs/trial?scope=all', op.token);
    assert(!(trials.body.data.places as Body[]).some(p => String(p.place.app).startsWith(`liatrial${tag}`)), `the deleted app's trial mark is gone: ${JSON.stringify((trials.body.data.places as Body[]).map(p => p.place.app))}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

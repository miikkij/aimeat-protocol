/**
 * @file e2e-compliance-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's compliance surface (BR-02): who may open it, that the question set is
 *   really data, and that the report says what it does not cover.
 *
 *   THE GATE TABLE IS THE POINT OF THIS FILE. The report is every account's AI activity on the node
 *   in one document, so "who is refused" is not a footnote here — it is the feature. The rows below
 *   are written to say what is ACTUALLY refused rather than "an agent is refused", because that
 *   sentence is false: requireRole('operator') admits an operator PAT, and the operator's own agent
 *   is meant to get through once the word is ticked. A test that asserted the folk version would
 *   have passed while describing a system that does not exist.
 *
 *   THE `*` ROW IS THE ONE THAT WOULD ROT FIRST. compliance:read and compliance:write are outside
 *   every wildcard, and the only thing that keeps them there is SCOPES_OUTSIDE_WILDCARD plus its
 *   frontend mirror. If somebody ever "simplifies" that list, an agent holding Full access silently
 *   gains the whole node's compliance picture, and no other assertion in this repo would notice.
 *
 *   THE DATA CLAIM IS TESTED BY DOING IT, not by reading the code: add a question over HTTP to a
 *   RUNNING node, and watch a use case fall out of its class and into the gap list without a
 *   restart. That is acceptance criterion 1, and it is the one claim a reviewer cannot check by
 *   inspection.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-compliance-report
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Owner { name: string; token: string; priv: string }

async function registerOwner(label: string): Promise<Owner> {
    const name = `cmp${label}${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const priv = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string, priv };
}

/** An agent of `owner` holding exactly `scopes`, and a bearer token for it. */
async function agentToken(owner: Owner, label: string, scopes: string[]): Promise<string> {
    const reg = await json('/v1/agents', {
        method: 'POST',
        headers: auth(owner.token),
        body: JSON.stringify({ name: `a${label}${Date.now()}`, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(reg.status === 201, `agent ${label}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${label}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

const REPORT = '/v1/admin/compliance/report';
const USECASES = '/v1/admin/compliance/usecases';
const QUESTIONS = '/v1/admin/compliance/questionnaire';

// ─── State ───
let op: Owner;
let plain: Owner;
let readerToken = '';
let questionnaire: any = null;

console.log('\n=== Compliance report (BR-02) ===\n');

// ─── Setup ───
await test('Setup: the first owner registered is the operator, the second is not', async () => {
    op = await registerOwner('op');
    plain = await registerOwner('plain');
    const asOp = await json(REPORT, { headers: auth(op.token) });
    assert(asOp.status === 200, `operator expected 200, got ${asOp.status}: ${JSON.stringify(asOp.body?.error)}`);
});

// ─── The gate ───
await test('Unauthenticated is refused (401)', async () => {
    const r = await json(REPORT);
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('An owner who does not run the node is refused (403)', async () => {
    for (const path of [REPORT, USECASES, QUESTIONS, '/v1/admin/compliance/reports']) {
        const r = await json(path, { headers: auth(plain.token) });
        assert(r.status === 403, `${path}: expected 403, got ${r.status}`);
    }
});

await test('The operator in person passes on every door', async () => {
    for (const path of [REPORT, USECASES, QUESTIONS, '/v1/admin/compliance/reports']) {
        const r = await json(path, { headers: auth(op.token) });
        assert(r.status === 200, `${path}: expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    }
});

await test("The operator's agent without the word is refused (403)", async () => {
    const bare = await agentToken(op, 'bare', ['memory:read']);
    const r = await json(REPORT, { headers: auth(bare) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test("The operator's agent holding only '*' is refused — the word is outside every wildcard", async () => {
    const star = await agentToken(op, 'star', ['*']);
    const r = await json(REPORT, { headers: auth(star) });
    assert(r.status === 403, `Full access must not carry compliance:read; got ${r.status}`);
    assert(String(r.body?.error?.message ?? '').includes('compliance:read'),
        `the refusal should name the word it wants: ${JSON.stringify(r.body?.error)}`);
});

await test("The operator's agent WITH compliance:read passes — an agent may do what a person can", async () => {
    readerToken = await agentToken(op, 'reader', ['memory:read', 'compliance:read']);
    const r = await json(REPORT, { headers: auth(readerToken) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('compliance:read does not carry compliance:write', async () => {
    const r = await json(USECASES, {
        method: 'PUT', headers: auth(readerToken), body: JSON.stringify({ usecases: [] }),
    });
    assert(r.status === 403, `read-only agent must not write; got ${r.status}`);
});

await test('An agent of a NON-operator holding the word is still refused', async () => {
    const outsider = await agentToken(plain, 'out', ['compliance:read', 'compliance:write']);
    const r = await json(REPORT, { headers: auth(outsider) });
    assert(r.status === 403, `the account check must bite first; got ${r.status}`);
});

// ─── The question set is data ───
await test('The question set is served before anything has been stored', async () => {
    const r = await json(QUESTIONS, { headers: auth(op.token) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    questionnaire = r.body.data.questionnaire;
    assert(Array.isArray(questionnaire.questions) && questionnaire.questions.length > 0,
        'the shipped default should be served when the node has stored nothing');
    assert(typeof questionnaire.note === 'string' && questionnaire.note.length > 0,
        'a classification has to carry the sentence saying what it is not');
});

await test('A use case with every question answered gets a class', async () => {
    const answers: Record<string, unknown> = {};
    for (const q of questionnaire.questions) answers[q.id] = q.type === 'boolean' ? false : 'none';
    answers['q-publishes-publicly'] = true;
    const put = await json(USECASES, {
        method: 'PUT',
        headers: auth(op.token),
        body: JSON.stringify({
            usecases: [{
                id: 'uc-news', title: 'Automated news drafting',
                models: ['anthropic/claude-opus-5'], answers,
            }],
        }),
    });
    assert(put.status === 200, `PUT usecases: ${put.status} ${JSON.stringify(put.body?.error)}`);
    const rep = await json(REPORT, { headers: auth(op.token) });
    const risk = rep.body.data.register.usecases[0].risk;
    assert(risk.class === 'limited', `expected limited, got ${risk.class}`);
    assert(risk.reasons.length > 0, 'a class reached by an answer should say which answer');
});

await test('Adding a question re-classifies immediately, with no restart and no release', async () => {
    const next = {
        ...questionnaire,
        version: `e2e-${Date.now()}`,
        questions: [...questionnaire.questions, {
            id: 'q-e2e-invented', text: 'Does it do the thing invented during this test run?',
            type: 'boolean', implies: { true: 'high' },
        }],
    };
    const put = await json(QUESTIONS, { method: 'PUT', headers: auth(op.token), body: JSON.stringify(next) });
    assert(put.status === 200, `PUT questionnaire: ${put.status} ${JSON.stringify(put.body?.error)}`);

    // Unanswered beats every answered question: the use case loses its class rather than keeping the
    // mildest one, and it surfaces as a gap. Defaulting here would turn "nobody looked" into "fine".
    const rep = await json(REPORT, { headers: auth(op.token) });
    const risk = rep.body.data.register.usecases[0].risk;
    assert(risk.class === 'unclassified', `expected unclassified, got ${risk.class}`);
    assert(risk.unanswered.includes('q-e2e-invented'), 'the new question should be the unanswered one');
    assert(rep.body.data.gaps.some((g: any) => g.kind === 'unclassified-usecase'),
        'an unclassified use case has to appear in the gap list');
    questionnaire = next;
});

await test('Answering the new question moves the class, driven by the stored set alone', async () => {
    const current = await json(USECASES, { headers: auth(op.token) });
    const uc = current.body.data.usecases[0];
    uc.answers['q-e2e-invented'] = true;
    const put = await json(USECASES, {
        method: 'PUT', headers: auth(op.token), body: JSON.stringify({ usecases: [uc] }),
    });
    assert(put.status === 200, `PUT usecases: ${put.status}`);
    const rep = await json(REPORT, { headers: auth(op.token) });
    assert(rep.body.data.register.usecases[0].risk.class === 'high',
        `expected high, got ${rep.body.data.register.usecases[0].risk.class}`);
    assert(rep.body.data.scope.questionnaire_version === questionnaire.version,
        'the report should name the set it classified against');
});

// ─── Validation refuses what would become a silent default ───
await test('A question implying a class the set does not define is refused', async () => {
    const bad = {
        ...questionnaire,
        questions: [{ id: 'x', text: 'x', type: 'boolean', implies: { true: 'catastrophic' } }],
    };
    const r = await json(QUESTIONS, { method: 'PUT', headers: auth(op.token), body: JSON.stringify(bad) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('A default class the set does not define is refused', async () => {
    const r = await json(QUESTIONS, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ ...questionnaire, defaultClass: 'nonexistent' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('Two use cases with the same id are refused', async () => {
    const r = await json(USECASES, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ usecases: [{ id: 'dup', title: 'a' }, { id: 'dup', title: 'b' }] }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('A month outside the calendar is refused', async () => {
    const r = await json(`${REPORT}?month=2026-13`, { headers: auth(op.token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ─── The report says what it does not cover ───
await test('not_covered is populated and names the absent-record rule', async () => {
    const r = await json(REPORT, { headers: auth(op.token) });
    const limits: string[] = r.body.data.not_covered;
    assert(Array.isArray(limits) && limits.length >= 5,
        `a compliance report has to state its own limits; got ${limits?.length}`);
    const joined = limits.join(' ').toLowerCase();
    // The one sentence that must survive every future edit: absence of a record is not evidence a
    // person wrote something. Without it a total reads as "everything published here".
    assert(joined.includes('unstated') || joined.includes('no provenance record') || joined.includes('no record'),
        `the limits must say what an absent record means: ${JSON.stringify(limits)}`);
    assert(joined.includes('federation') || joined.includes('off this'),
        'the limits must say the report covers this installation only');
});

await test('The report carries its own period and the derived halves', async () => {
    const r = await json(`${REPORT}?since_days=90`, { headers: auth(op.token) });
    const d = r.body.data;
    assert(d.scope.ring === 'node-wide', `ring should be node-wide, got ${d.scope.ring}`);
    assert(typeof d.scope.period.from === 'string' && typeof d.scope.period.to === 'string',
        'the period has to be stated, not implied');
    assert(d.derived.ai_transparency && d.derived.ai_usage && d.derived.consent,
        'all three derived halves should be present');
    assert(typeof d.derived.consent.audit_retention_days === 'number',
        'the consent half has to state the retention window it cannot see past');
});

await test('A consent grant reaches the report — the node-wide facet query works on this backend', async () => {
    const before = await json(REPORT, { headers: auth(op.token) });
    const was = before.body.data.derived.consent.active as number;
    const grant = await json('/v1/consent', {
        method: 'POST',
        headers: auth(op.token),
        body: JSON.stringify({
            data_pattern: 'compliance.probe.*', recipient: '*', purpose: 'e2e', scope: 'federation',
        }),
    });
    assert(grant.status === 201, `grant: ${grant.status} ${JSON.stringify(grant.body?.error)}`);
    const after = await json(REPORT, { headers: auth(op.token) });
    // consentFacets is the one storage method this change adds, and it is written twice — once per
    // backend, in two different SQL dialects. This assertion is what makes running the suite on both
    // backends mean something rather than running the same code path twice.
    assert(after.body.data.derived.consent.active === was + 1,
        `expected the new grant to be counted: ${was} → ${after.body.data.derived.consent.active}`);
    assert(typeof after.body.data.derived.consent.by_scope.federation === 'number',
        'the facet should group by scope, not only by status');
});

// ─── The stored monthly reports ───
await test('A month with no stored report answers 404, not an empty report', async () => {
    const r = await json('/v1/admin/compliance/reports?month=2020-01', { headers: auth(op.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('The scheduled monthly job runs on demand and stores a report', async () => {
    const trigger = await json('/v1/admin/scheduler/jobs/core:compliance-report-monthly/trigger', {
        method: 'POST', headers: auth(op.token),
    });
    assert(trigger.status === 200, `trigger: ${trigger.status} ${JSON.stringify(trigger.body?.error)}`);
    // The job is dispatched through the scheduler, so give the run a moment to land its write.
    for (let i = 0; i < 20; i++) {
        const list = await json('/v1/admin/compliance/reports', { headers: auth(op.token) });
        if ((list.body.data?.reports ?? []).length > 0) {
            const month = list.body.data.reports[0].month;
            assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), `stored under a bad month key: ${month}`);
            const stored = await json(`/v1/admin/compliance/reports?month=${month}`, { headers: auth(op.token) });
            assert(stored.status === 200, `stored report: ${stored.status}`);
            assert(Array.isArray(stored.body.data.report.not_covered),
                'a stored report has to carry its limits too, not only the live one');
            return;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('the monthly job did not store a report within 5s');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

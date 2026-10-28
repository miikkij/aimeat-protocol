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
 *   v1.1.0 — 2026-10-28 — An app that uses AI on employment data: a report gap with its Annex III
 *     area, a draft entry whose area is marked proposed, regulated data in its records draft, its
 *     own owner's slice and nobody else's, and a use case naming it closes the gap. Seen red on the
 *     code before the change: the app was in no gap and no draft entry.
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
import { registerOwner as registerPasswordOwner } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Owner { name: string; token: string; priv: string }

async function registerOwner(label: string): Promise<Owner> {
    const name = `cmp${label}${Date.now()}`;
    const owner = await registerPasswordOwner(BASE, name);
    return { name, token: owner.token, priv: owner.privateKey };
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
const MINE = '/v1/compliance/report/mine';
const DRAFT = '/v1/admin/compliance/draft';

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
    const limits: Array<{ code: string; text: string; days?: number }> = r.body.data.not_covered;
    assert(Array.isArray(limits) && limits.length >= 5,
        `a compliance report has to state its own limits; got ${limits?.length}`);
    const joined = limits.map(l => l.text).join(' ').toLowerCase();
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

// ─── The node drafts the register itself ───
await test('The draft is served, says what it derived, and stores nothing', async () => {
    const r = await json(DRAFT, { headers: auth(op.token) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const d = r.body.data;
    assert(Array.isArray(d.usecases), 'a draft has to carry entries, even when there are none');
    assert(typeof d.counts.entries === 'number' && typeof d.counts.answeredFromEvidence === 'number',
        'the draft has to say how much it worked out');
    assert(d.notes.join(' ').toLowerCase().includes('nothing is stored'),
        'the draft must say it stored nothing');
    // And it really stored nothing: the register is whatever the earlier tests left.
    const stored = await json(USECASES, { headers: auth(op.token) });
    assert(stored.status === 200, `usecases: ${stored.status}`);
});

await test('A dry-run write returns what would be stored and stores nothing', async () => {
    const before = await json(USECASES, { headers: auth(op.token) });
    const beforeIds = before.body.data.usecases.map((u: any) => u.id).sort();

    const preview = await json(`${USECASES}?dry_run=true`, {
        method: 'PUT',
        headers: auth(op.token),
        body: JSON.stringify({
            usecases: [{
                id: 'uc-preview-only', title: 'Never actually stored',
                answers: { 'q-publishes-publicly': true },
                answerSources: { 'q-publishes-publicly': 'ai' },
            }],
        }),
    });
    assert(preview.status === 200, `dry run: ${preview.status} ${JSON.stringify(preview.body?.error)}`);
    assert(preview.body.data.stored === false, 'a dry run must say it stored nothing');
    assert(preview.body.data.would_store[0].id === 'uc-preview-only', 'the preview should echo what would land');

    const after = await json(USECASES, { headers: auth(op.token) });
    assert(JSON.stringify(after.body.data.usecases.map((u: any) => u.id).sort()) === JSON.stringify(beforeIds),
        'the dry run changed the register, which is the one thing it must never do');
});

await test('A dry run still validates, and names an answer with no recorded source', async () => {
    const bad = await json(`${USECASES}?dry_run=true`, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ usecases: [{ id: 'dup', title: 'a' }, { id: 'dup', title: 'b' }] }),
    });
    assert(bad.status === 400, `a preview that skipped validation would show a document the real write refuses; got ${bad.status}`);

    const unmarked = await json(`${USECASES}?dry_run=true`, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ usecases: [{ id: 'uc-x', title: 'x', answers: { 'q-publishes-publicly': true } }] }),
    });
    assert(unmarked.body.data.answers_with_no_recorded_source?.length === 1,
        'an answer with no source should be named in the preview, not discovered at the audit');
});

await test('An answer keeps the record of who produced it', async () => {
    const put = await json(USECASES, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({
            usecases: [{
                id: 'uc-sourced', title: 'Sourced answers',
                answers: { 'q-publishes-publicly': true, 'q-manipulative-technique': false },
                answerSources: { 'q-publishes-publicly': 'evidence', 'q-manipulative-technique': 'human' },
            }],
        }),
    });
    assert(put.status === 200, `PUT: ${put.status} ${JSON.stringify(put.body?.error)}`);
    const back = await json(USECASES, { headers: auth(op.token) });
    const uc = back.body.data.usecases.find((u: any) => u.id === 'uc-sourced');
    assert(uc?.answerSources?.['q-publishes-publicly'] === 'evidence', 'the evidence marker was lost on the round trip');
    assert(uc?.answerSources?.['q-manipulative-technique'] === 'human', 'the human marker was lost on the round trip');
});

// ─── The account's own slice ───
await test('Any account reads its own slice, with no permission and no operator role', async () => {
    const r = await json(MINE, { headers: auth(plain.token) });
    assert(r.status === 200, `a plain owner must be able to read their own: got ${r.status}`);
    assert(r.body.data.scope.ring === 'owner', `ring should be owner, got ${r.body.data.scope.ring}`);
    assert(String(r.body.data.scope.owner_ghii).startsWith(plain.name),
        `the slice should name the caller, got ${r.body.data.scope.owner_ghii}`);
});

await test('The slice is scoped by the token, not by anything the request can say', async () => {
    // The whole point of the route. If a query parameter could move the scope, an account could read
    // the operator's picture through a door that asks for nothing.
    const r = await json(`${MINE}?owner=${encodeURIComponent(op.name)}&ownerGhii=${encodeURIComponent(op.name)}`, {
        headers: auth(plain.token),
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(String(r.body.data.scope.owner_ghii).startsWith(plain.name),
        `a request parameter moved the scope to ${r.body.data.scope.owner_ghii}`);
});

await test('One account cannot see another account\'s use cases in its own slice', async () => {
    // The operator writes two entries, one naming each account. Each account must see its own and
    // not the other's — the isolation that makes this surface safe to give to everybody.
    const put = await json(USECASES, {
        method: 'PUT',
        headers: auth(op.token),
        body: JSON.stringify({
            usecases: [
                { id: 'uc-op-only', title: 'Belongs to the operator', ownerGhii: `${op.name}@${NODE_ID}` },
                { id: 'uc-plain-only', title: 'Belongs to the other account', ownerGhii: `${plain.name}@${NODE_ID}` },
                { id: 'uc-house', title: 'Belongs to nobody in particular' },
            ],
        }),
    });
    assert(put.status === 200, `PUT usecases: ${put.status} ${JSON.stringify(put.body?.error)}`);

    const mine = await json(MINE, { headers: auth(plain.token) });
    const ids = mine.body.data.register.usecases.map((u: any) => u.id).sort();
    // Its own, plus the one that names nobody — a use belonging to the installation is still one
    // this account runs under. Never the entry naming the other account.
    assert(JSON.stringify(ids) === JSON.stringify(['uc-house', 'uc-plain-only']),
        `expected its own and the unowned entry, got ${JSON.stringify(ids)}`);
});

await test('The slice states its OWN limits, not the operator\'s', async () => {
    const mine = await json(MINE, { headers: auth(plain.token) });
    const codes: string[] = mine.body.data.not_covered.map((l: any) => l.code);
    assert(codes.includes('owner-your-slice'), `the slice must say it shows nobody else: ${JSON.stringify(codes)}`);
    assert(codes.includes('owner-register-is-the-operators'),
        'the slice must say who keeps the register, because the reader cannot change it');
    // The operator's wording would be false here: an account operates nothing.
    assert(!codes.includes('register-unverified'), 'the operator\'s register sentence leaked into the owner slice');
    assert(!codes.includes('this-node-only'), 'the operator\'s scope sentence leaked into the owner slice');
});

await test('An agent reading its owner\'s slice needs the activity-read word', async () => {
    // The owner passes without it (requireScope lets an owner session through); an agent does not.
    // Same word as GET /v1/usage/summary, because it is the same material one level up.
    const bare = await agentToken(plain, 'slicebare', ['memory:read']);
    const r = await json(MINE, { headers: auth(bare) });
    assert(r.status === 403, `an agent without wallet:read should be refused, got ${r.status}`);
});

/** One MCP tool call with an agent's own token, on a fresh session. */
async function mcpTool(token: string, name: string, args: Record<string, unknown>): Promise<{ isError?: boolean; text: string }> {
    let session = '';
    const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        session = res.headers.get('mcp-session-id') ?? session;
        const raw = await res.text();
        const lines = raw.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6));
        return JSON.parse(lines.length ? lines[lines.length - 1] : raw);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'compliance-e2e', version: '1' } }, 1);
    const r = await rpc('tools/call', { name, arguments: args }, 2);
    return { isError: r.result?.isError, text: (r.result?.content ?? []).map((c: any) => c.text).join('') || JSON.stringify(r.error ?? {}) };
}

// Feature-list audit row 159: the MCP tool gave the owner's slice to an agent with no word at all,
// where GET /v1/compliance/report/mine asks wallet:read of it.
await test('The MCP tool asks the same activity-read word of an agent as the REST route does', async () => {
    const bare = await agentToken(plain, 'slicemcpbare', ['memory:read']);
    const refused = await mcpTool(bare, 'aimeat_compliance_report', { scope: 'mine' });
    assert(refused.isError === true && /wallet:read/.test(refused.text), `an agent without wallet:read read the slice over MCP: ${refused.text.slice(0, 200)}`);
    const holder = await agentToken(plain, 'slicemcp', ['memory:read', 'wallet:read']);
    const allowed = await mcpTool(holder, 'aimeat_compliance_report', { scope: 'mine' });
    assert(!allowed.isError && allowed.text.includes(plain.name), `an agent with wallet:read reads its owner's slice over MCP: ${allowed.text.slice(0, 200)}`);
});

await test('An agent WITH the word sees its OWNER, not itself', async () => {
    const agent = await agentToken(plain, 'slice', ['memory:read', 'wallet:read']);
    const r = await json(MINE, { headers: auth(agent) });
    assert(r.status === 200, `an agent should read its owner's slice: got ${r.status}`);
    assert(String(r.body.data.scope.owner_ghii).startsWith(plain.name),
        `an agent must resolve to its owner, got ${r.body.data.scope.owner_ghii}`);
    assert(!String(r.body.data.scope.owner_ghii).includes('#'),
        `the slice resolved to the agent rather than the person: ${r.body.data.scope.owner_ghii}`);
});

await test('The owner slice is refused without authentication', async () => {
    const r = await json(MINE);
    assert(r.status === 401, `expected 401, got ${r.status}`);
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
            const entry = list.body.data.reports[0];
            assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.id), `stored under a bad month key: ${entry.id}`);
            assert(entry.kind === 'monthly', `the schedule's own report has to say so: ${entry.kind}`);
            // The link in the notification the job sends spells it `month`, and those links outlive
            // any rename, so both names have to reach the same record.
            const stored = await json(`/v1/admin/compliance/reports?month=${entry.id}`, { headers: auth(op.token) });
            assert(stored.status === 200, `stored report: ${stored.status}`);
            assert(Array.isArray(stored.body.data.report.not_covered),
                'a stored report has to carry its limits too, not only the live one');
            const byId = await json(`/v1/admin/compliance/reports?id=${entry.id}`, { headers: auth(op.token) });
            assert(byId.status === 200, `id= has to reach the same record as month=: ${byId.status}`);
            return;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('the monthly job did not store a report within 5s');
});

// ─── Keeping this moment ───
await test('An id that is neither a month nor a minute is refused before any read', async () => {
    const r = await json('/v1/admin/compliance/reports?id=../../secrets', { headers: auth(op.token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('The operator keeps a snapshot, and it reads back unchanged', async () => {
    // No content-type here: json() already sets one, and a second spelling of the same header makes
    // fetch send "application/json, application/json", which express.json() does not recognise as
    // JSON at all. The body then arrives empty and the window silently falls back to the default.
    const saved = await json('/v1/admin/compliance/snapshot', {
        method: 'POST', headers: auth(op.token),
        body: JSON.stringify({ since_days: 7 }),
    });
    assert(saved.status === 201, `expected 201, got ${saved.status}: ${JSON.stringify(saved.body?.error)}`);
    const id: string = saved.body.data.id;
    assert(/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(id), `a kept moment names its minute: ${id}`);
    assert(saved.body.data.kind === 'manual', 'a kept moment is not the schedule\'s work');

    const list = await json('/v1/admin/compliance/reports', { headers: auth(op.token) });
    const entry = (list.body.data.reports ?? []).find((r: { id: string }) => r.id === id);
    assert(entry, `the kept report is missing from the index: ${JSON.stringify(list.body.data.reports)}`);
    assert(entry.kind === 'manual', `the index has to say which kind it is: ${entry.kind}`);

    const read = await json(`/v1/admin/compliance/reports?id=${id}`, { headers: auth(op.token) });
    assert(read.status === 200, `reading it back: ${read.status}`);
    // The window is what the caller asked for, not a default. A snapshot that misdescribed its own
    // period would be worse than none, because somebody reads it a year later and cannot tell.
    const from = new Date(read.body.data.report.scope.period.from);
    const to = new Date(read.body.data.report.scope.period.to);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    assert(days === 7, `the snapshot has to record the window it was asked for, got ${days} days`);
    assert(Array.isArray(read.body.data.report.not_covered),
        'a kept report carries its limits, exactly like the live one');
});

await test('An agent holding only compliance:read cannot keep one (403)', async () => {
    // Keeping adds a node-wide document to what the node holds, so it is a write. The read word
    // passing here would mean any credential that may look at the report may also add to the store.
    const reader = await agentToken(op, 'snapreader', ['compliance:read']);
    const r = await json('/v1/admin/compliance/snapshot', { method: 'POST', headers: auth(reader) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('An owner who does not run the node cannot keep one (403)', async () => {
    const r = await json('/v1/admin/compliance/snapshot', { method: 'POST', headers: auth(plain.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Unauthenticated cannot keep one (401)', async () => {
    const r = await json('/v1/admin/compliance/snapshot', { method: 'POST' });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

// ─── An app that uses AI on employment data (innokas.aimeat.io, 2026-10-28) ───
// TalentGrid kept colleagues' competence ratings, proposed who works on what with a model, and said
// so in its data map. The report named three model ids and no app, and the draft did not list it.

/** A one-person app whose map keeps people's skills and uses AI, as TalentGrid's does. */
const TALENT_MAP = {
    spec: 'aimeat.datamap/2',
    what: 'A competence and resourcing tool: a register of people with their skills rated 1-5.',
    usedFor: "Answering 'who could we put on this' and writing the CV for the client.",
    form: 'one-person', arrangement: 'Private records of the person keeping it.',
    machinery: ['ai-generation'], leaves: [], elsewhere: [],
    held: [{
        what: 'talent.people', holds: "each person's name, availability and allocation, their skill entries",
        kind: 'register', usedFor: 'search-and-filter', where: 'owner-memory-private', owner: 'person',
        readers: 'owner-only', writers: ['person-in-the-ui'], shape: 'collection-under-one-key',
        keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'yes',
        why: 'assessed competence about named colleagues stays with the person keeping it',
    }],
};

async function publishApp(o: Owner, filename: string, map: unknown): Promise<string> {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Talent</title></head><body>t</body></html>';
    const p = await json('/v1/apps', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), mime_type: 'text/html', name: 'Talent', description: 'E2E' }),
    });
    assert(p.status === 201, `publish ${filename}: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const m = await json(`/v1/datamap/apps/${o.name}/${filename}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(map) });
    assert(m.status === 200, `data map ${filename}: ${m.status} ${JSON.stringify(m.body?.error)}`);
    return `${o.name}/${filename}`;
}

let talentRef = '';
let quietRef = '';

await test('An app that uses AI on employment data is a gap, named with its Annex III area', async () => {
    talentRef = await publishApp(plain, `talent${Date.now()}.html`, TALENT_MAP);
    const r = await json(`${REPORT}?since_days=30`, { headers: auth(op.token) });
    assert(r.status === 200, `report ${r.status}`);
    const gap = (r.body.data.gaps as any[]).find(g => g.kind === 'app-uses-ai-not-in-register' && g.evidence?.app === talentRef);
    assert(!!gap, `the app is a gap: ${JSON.stringify((r.body.data.gaps as any[]).map(g => g.kind))}`);
    assert(gap.evidence.annex3 === 'employment', `its area is employment: ${JSON.stringify(gap.evidence)}`);
    assert(gap.evidence.annex3_basis?.rows?.includes('talent.people'), 'the basis names the key family');
    assert(gap.evidence.uses_ai.some((s: string) => s.includes('ai-generation')), 'and what says it uses AI');
});

await test('An app whose map says its personal data is none of the regulated kinds is a gap with no area', async () => {
    quietRef = await publishApp(plain, `quiet${Date.now()}.html`, {
        ...TALENT_MAP, held: [{ ...TALENT_MAP.held[0], what: 'quiet.people', domains: [] }],
    });
    const r = await json(REPORT, { headers: auth(op.token) });
    const gap = (r.body.data.gaps as any[]).find(g => g.evidence?.app === quietRef);
    assert(!!gap && gap.evidence.annex3 === null, `a considered "none" proposes no area: ${JSON.stringify(gap?.evidence)}`);
});

await test('The draft gives the app an entry, its area proposed and marked so, with the reason as data', async () => {
    const r = await json(DRAFT, { headers: auth(op.token) });
    assert(r.status === 200, `draft ${r.status}`);
    const uc = (r.body.data.usecases as any[]).find(u => (u.apps ?? []).includes(talentRef));
    assert(!!uc, 'the app has an entry');
    assert(uc.description === TALENT_MAP.what, 'described by its data map');
    assert(uc.answers['q-annex3-area'] === 'employment' && uc.answerSources['q-annex3-area'] === 'proposed',
        `proposed, not evidence and not an answer: ${JSON.stringify(uc.answerSources)}`);
    const p = (r.body.data.proposals as any[]).find(x => x.usecase_id === uc.id);
    assert(p?.basis?.domain === 'employment' && p.basis.source === 'proposed', `the proposal carries its basis: ${JSON.stringify(p)}`);
});

await test('The records-of-processing draft carries the regulated data the map points to, marked proposed', async () => {
    const filename = talentRef.split('/')[1];
    const q = `scope=app&app=${encodeURIComponent(filename)}&app_owner=${plain.name}`;
    const r = await json(`/v1/compliance/draft?${q}`, { headers: auth(op.token) });
    assert(r.status === 200, `records draft ${r.status} ${JSON.stringify(r.body?.error)}`);
    const item = r.body.data.items?.[0];
    assert(JSON.stringify(item?.domains) === '["employment"]', `domains: ${JSON.stringify(item?.domains)}`);
    assert(item.answerSources?.domains === 'proposed', `marked proposed: ${JSON.stringify(item.answerSources)}`);
    // And the app's own gaps say the map has not stated it, with what its words point to.
    const g = await json(`/v1/compliance/gaps?${q}`, { headers: auth(op.token) });
    assert(g.status === 200, `app gaps ${g.status}`);
    const unstated = (g.body.data.gaps as any[]).find(x => x.kind === 'app-personal-data-domain-unstated');
    assert(unstated?.evidence?.proposed?.includes('employment'), `the gap names the proposal: ${JSON.stringify(g.body.data.gaps)}`);
});

await test('An owner reads only their own apps in their slice: another owner\'s app is not in it', async () => {
    const mine = await json(MINE, { headers: auth(op.token) });
    assert(mine.status === 200, `slice ${mine.status}`);
    assert(!(mine.body.data.gaps as any[]).some(g => g.evidence?.app === talentRef), "another owner's app must not appear in the operator's own slice");
    const theirs = await json(MINE, { headers: auth(plain.token) });
    assert((theirs.body.data.gaps as any[]).some(g => g.evidence?.app === talentRef), 'the app owner sees their own app in their slice');
});

await test('A use case that names the app closes the gap', async () => {
    const before = await json(USECASES, { headers: auth(op.token) });
    const kept = (before.body.data.usecases as any[]) ?? [];
    const w = await json(USECASES, {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ usecases: [...kept, { id: 'uc-e2e-talent', title: 'Staffing', apps: [talentRef, quietRef] }] }),
    });
    assert(w.status === 200, `register write ${w.status} ${JSON.stringify(w.body?.error)}`);
    const r = await json(REPORT, { headers: auth(op.token) });
    assert(!(r.body.data.gaps as any[]).some(g => g.kind === 'app-uses-ai-not-in-register' && [talentRef, quietRef].includes(g.evidence?.app)),
        'a registered app is no longer a gap');
    const d = await json(DRAFT, { headers: auth(op.token) });
    assert(!(d.body.data.usecases as any[]).some(u => (u.apps ?? []).includes(talentRef)), 'and the draft does not propose it again');
    await json(USECASES, { method: 'PUT', headers: auth(op.token), body: JSON.stringify({ usecases: kept }) });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);

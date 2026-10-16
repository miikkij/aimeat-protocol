/**
 * @file test/e2e-mcp-compliance-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four compliance MCP tools over /v1/mcp, with the gate table the REST suite
 *   (e2e-compliance-report.ts) holds the HTTP routes to: aimeat_compliance_report,
 *   aimeat_compliance_register_read, aimeat_compliance_register_write and aimeat_compliance_snapshot.
 *
 *   WHY THIS SUITE EXISTS. src/mcp/compliance.ts asks the same question the HTTP routes ask, through
 *   complianceRefusal() in services/compliance-access.ts, and that call is the only thing between an
 *   agent session and the report of every account's AI activity: aimeat_compliance_report has no
 *   permission word in the catalog, so every session is offered it and the handler decides. No test
 *   called any of the four tools over MCP (QA audit F17-01), so removing the gate call, or changing
 *   the default scope, would have left every suite green.
 *
 *   THE GATE TABLE. For the node-wide reads and writes: no word, '*' only (both compliance words are
 *   outside every wildcard), the read word, the write word, both, and a NON-operator's agent holding
 *   both words. For the owner's own slice (scope "mine"): an agent without wallet:read is refused,
 *   one with it reads its OWNER's slice, the word GET /v1/compliance/report/mine asks.
 *
 *   ONE REGISTRATION FACT THE TABLE SHOWS. aimeat_compliance_snapshot is registered on
 *   compliance:write (catalog), and its handler asks compliance:read for list and read and
 *   compliance:write for save. So over MCP an agent holding only the read word is not offered the
 *   tool, and one holding only the write word may save but not list; listing over MCP takes both
 *   words. The HTTP routes ask the read word alone for the list. Asserted here as it is, so a change
 *   to either half is seen.
 *
 *   WHAT IT LEAVES BEHIND. The use-case register is written back empty, which is what a fresh node
 *   holds. A snapshot kept by the save test stays: a kept report is an archive and has no delete.
 * @structure
 *   - Setup: the operator (the first owner registered), an ordinary owner, and their agents
 *   - The report: scope "node" through the gate table; scope "mine" and wallet:read
 *   - The register: read and write through the gate table, dry run, a real write read back over REST
 *   - The snapshot shelf: who is offered it, list, save, read back
 *   - Cleanup: the register back to empty
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-compliance-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27: F17-01).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const STAMP = Date.now().toString(36);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const authed = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const USECASES = '/v1/admin/compliance/usecases';

/** A refusal by the handler: an error, with the tool offered to the session. */
function assertHandlerRefusal(r: { isError: boolean; offered: boolean; text: string }, label: string): void {
    assert(r.isError, `${label}: expected a refusal, got ${r.text.slice(0, 300)}`);
    assert(r.offered, `${label}: the tool was not offered, so the handler line was never reached: ${r.text.slice(0, 200)}`);
}

let op: RegisteredOwner;
let plain: RegisteredOwner;
let opNone: McpSession;     // the operator's agent, no compliance word
let opStar: McpSession;     // the operator's agent, '*' only
let opRead: McpSession;     // compliance:read
let opWrite: McpSession;    // compliance:write
let opBoth: McpSession;     // both words
let plainBoth: McpSession;  // a NON-operator's agent holding both words
let plainBare: McpSession;  // a NON-operator's agent without wallet:read
let plainWallet: McpSession; // ...and with it

console.log('\n=== MCP compliance tools: the gate table over /v1/mcp ===\n');

await test('Setup: the operator, an ordinary owner, and agents along the gate table', async () => {
    op = await registerOwner(BASE, `mcpcmpop${STAMP}`);
    plain = await registerOwner(BASE, `mcpcmpplain${STAMP}`);
    assert(op.roles.includes('operator'), `the first owner must be the operator, roles ${short(op.roles)}`);
    assert(!plain.roles.includes('operator'), `the second owner must not be, roles ${short(plain.roles)}`);
    const session = async (owner: RegisteredOwner, scopes: string[], label: string) =>
        openSession(BASE, (await makeAgent(BASE, owner, scopes)).token, label);
    opNone = await session(op, ['memory:read'], 'op-none');
    opStar = await session(op, ['*'], 'op-star');
    opRead = await session(op, ['compliance:read'], 'op-read');
    opWrite = await session(op, ['compliance:write'], 'op-write');
    opBoth = await session(op, ['compliance:read', 'compliance:write'], 'op-both');
    plainBoth = await session(plain, ['compliance:read', 'compliance:write'], 'plain-both');
    plainBare = await session(plain, ['memory:read'], 'plain-bare');
    plainWallet = await session(plain, ['memory:read', 'wallet:read'], 'plain-wallet');
});

// ─── aimeat_compliance_report ───
console.log('\nThe report');

await test('aimeat_compliance_report is offered to every session: no permission word gates its registration', async () => {
    const names = await toolNames(plainBare);
    assert(names.includes('aimeat_compliance_report'), 'the report tool should be offered; the handler decides');
});

await test('scope "node": refused to the operator\'s agent with no word, with \'*\' only, and with the write word alone', async () => {
    for (const [session, label] of [[opNone, 'no word'], [opStar, "'*' only"], [opWrite, 'write word only']] as const) {
        const r = await callTool(session, 'aimeat_compliance_report', { scope: 'node' });
        assertHandlerRefusal(r, `node report, ${label}`);
        assert(/compliance:read/.test(r.text), `${label}: the refusal should name the word: ${r.text.slice(0, 200)}`);
    }
});

await test('scope "node": refused to a NON-operator\'s agent holding compliance:read', async () => {
    const r = await callTool(plainBoth, 'aimeat_compliance_report', { scope: 'node' });
    assertHandlerRefusal(r, 'node report, non-operator');
    assert(!/"usecases"|"register"/.test(r.text), 'a refusal must not carry the report');
});

await test('scope "node": the operator\'s agent holding compliance:read gets the whole installation\'s report', async () => {
    const r = await callTool(opRead, 'aimeat_compliance_report', { scope: 'node', since_days: 7 });
    assert(!r.isError, `node report: ${r.text.slice(0, 300)}`);
    assert(Array.isArray(r.data.gaps) && Array.isArray(r.data.not_covered), `shape: ${short(Object.keys(r.data))}`);
    assert(r.data.scope?.owner_ghii === undefined || r.data.scope?.owner_ghii === null,
        `the node report must not be an owner slice: ${short(r.data.scope)}`);
});

await test('A month that is not YYYY-MM is refused before any read', async () => {
    const r = await callTool(opRead, 'aimeat_compliance_report', { scope: 'node', month: '2026-13-01' });
    assert(r.isError && /2026-08/.test(r.text), `bad month: ${r.text.slice(0, 200)}`);
});

await test('scope "mine" (the default): an agent without wallet:read is refused its owner\'s slice', async () => {
    const r = await callTool(plainBare, 'aimeat_compliance_report', {});
    assertHandlerRefusal(r, 'mine without wallet:read');
    assert(/wallet:read/.test(r.text), `the refusal should name the word: ${r.text.slice(0, 200)}`);
});

await test('scope "mine": an agent WITH wallet:read reads its OWNER\'s slice, not its own and not the node', async () => {
    const r = await callTool(plainWallet, 'aimeat_compliance_report', { scope: 'mine' });
    assert(!r.isError, `mine: ${r.text.slice(0, 300)}`);
    const owner = String(r.data.scope?.owner_ghii ?? '');
    assert(owner.startsWith(`${plain.name}@`) && !owner.includes('#'), `the slice must resolve to the owner: ${short(r.data.scope)}`);
});

// ─── The register ───
console.log('\nThe register');

await test('aimeat_compliance_register_read is not offered without compliance:read, \'*\' included', async () => {
    for (const [session, label] of [[opNone, 'no word'], [opStar, "'*' only"], [opWrite, 'write word only']] as const) {
        const r = await callTool(session, 'aimeat_compliance_register_read', { part: 'questionnaire' });
        assert(r.isError && !r.offered, `${label}: expected not offered, got ${r.text.slice(0, 200)}`);
    }
});

await test('aimeat_compliance_register_read: a NON-operator\'s agent holding the word is refused by the handler', async () => {
    const r = await callTool(plainBoth, 'aimeat_compliance_register_read', { part: 'usecases' });
    assertHandlerRefusal(r, 'register_read, non-operator');
});

await test('aimeat_compliance_register_read: the operator\'s agent reads the question set, the stored register and a draft', async () => {
    const q = await callTool(opRead, 'aimeat_compliance_register_read', { part: 'questionnaire' });
    assert(!q.isError && Array.isArray(q.data.questionnaire?.questions) && q.data.questionnaire.questions.length > 0,
        `questionnaire: ${q.text.slice(0, 300)}`);
    const u = await callTool(opRead, 'aimeat_compliance_register_read', { part: 'usecases' });
    assert(!u.isError && Array.isArray(u.data.usecases) && u.data.total === u.data.usecases.length, `usecases: ${u.text.slice(0, 300)}`);
    const d = await callTool(opRead, 'aimeat_compliance_register_read', { part: 'draft', since_days: 7 });
    assert(!d.isError, `draft: ${d.text.slice(0, 300)}`);
});

const USECASE = {
    usecases: [{
        id: `uc-mcp-${STAMP}`, title: 'Drafting replies over MCP',
        models: ['anthropic/claude-opus-5'],
        answers: { 'q-publishes-publicly': false },
        answerSources: { 'q-publishes-publicly': 'human' },
    }],
};

async function storedUseCaseIds(): Promise<string[]> {
    const r = await json(USECASES, authed(op.token));
    assert(r.status === 200, `GET usecases: ${r.status} ${short(r.body)}`);
    return r.body.data.usecases.map((u: any) => u.id);
}

await test('aimeat_compliance_register_write: the read word does not carry the write — the operator\'s reader is not offered it', async () => {
    const r = await callTool(opRead, 'aimeat_compliance_register_write', { part: 'usecases', value: USECASE });
    assert(r.isError && !r.offered, `expected not offered, got ${r.text.slice(0, 200)}`);
    const star = await callTool(opStar, 'aimeat_compliance_register_write', { part: 'usecases', value: USECASE });
    assert(star.isError && !star.offered, `'*': expected not offered, got ${star.text.slice(0, 200)}`);
    assert(!(await storedUseCaseIds()).includes(USECASE.usecases[0].id), 'a refused write landed');
});

await test('aimeat_compliance_register_write: a NON-operator\'s agent holding compliance:write is refused, and nothing lands', async () => {
    const r = await callTool(plainBoth, 'aimeat_compliance_register_write', { part: 'usecases', value: USECASE });
    assertHandlerRefusal(r, 'register_write, non-operator');
    assert(!(await storedUseCaseIds()).includes(USECASE.usecases[0].id), 'the non-operator\'s write landed');
});

await test('aimeat_compliance_register_write with dry_run: the operator\'s writer sees what would land, and nothing is stored', async () => {
    const r = await callTool(opWrite, 'aimeat_compliance_register_write', { part: 'usecases', value: USECASE, dry_run: true });
    assert(!r.isError && r.data.stored === false, `dry run: ${r.text.slice(0, 300)}`);
    assert(r.data.would_store?.[0]?.id === USECASE.usecases[0].id, `would_store: ${short(r.data.would_store)}`);
    assert(!(await storedUseCaseIds()).includes(USECASE.usecases[0].id), 'the dry run stored the register');
});

await test('aimeat_compliance_register_write: an invalid register is refused with the reason, and nothing is stored', async () => {
    const r = await callTool(opWrite, 'aimeat_compliance_register_write', {
        part: 'usecases', value: { usecases: [USECASE.usecases[0], USECASE.usecases[0]] },
    });
    assert(r.isError && /not stored/.test(r.text), `duplicate ids: ${r.text.slice(0, 300)}`);
    assert(!(await storedUseCaseIds()).includes(USECASE.usecases[0].id), 'the refused register landed');
});

await test('aimeat_compliance_register_write: the operator\'s writer stores the register, and the HTTP route reads it back', async () => {
    const r = await callTool(opWrite, 'aimeat_compliance_register_write', { part: 'usecases', value: USECASE });
    assert(!r.isError && r.data.total === 1, `write: ${r.text.slice(0, 300)}`);
    const ids = await storedUseCaseIds();
    assert(JSON.stringify(ids) === JSON.stringify([USECASE.usecases[0].id]), `stored: ${short(ids)}`);
});

// ─── The snapshot shelf ───
console.log('\nThe snapshot shelf');

let savedId = '';

await test('aimeat_compliance_snapshot is not offered to an agent holding only compliance:read, nor to \'*\'', async () => {
    for (const [session, label] of [[opRead, 'read word only'], [opStar, "'*' only"], [opNone, 'no word']] as const) {
        const r = await callTool(session, 'aimeat_compliance_snapshot', { action: 'list' });
        assert(r.isError && !r.offered, `${label}: expected not offered, got ${r.text.slice(0, 200)}`);
    }
});

await test('aimeat_compliance_snapshot list: refused to the write word alone (listing asks compliance:read) and to a NON-operator', async () => {
    const w = await callTool(opWrite, 'aimeat_compliance_snapshot', { action: 'list' });
    assertHandlerRefusal(w, 'snapshot list, write word only');
    assert(/compliance:read/.test(w.text), `the refusal should name the read word: ${w.text.slice(0, 200)}`);
    const p = await callTool(plainBoth, 'aimeat_compliance_snapshot', { action: 'list' });
    assertHandlerRefusal(p, 'snapshot list, non-operator');
});

await test('aimeat_compliance_snapshot save: a NON-operator\'s agent holding both words is refused', async () => {
    const r = await callTool(plainBoth, 'aimeat_compliance_snapshot', { action: 'save', since_days: 7 });
    assertHandlerRefusal(r, 'snapshot save, non-operator');
});

await test('aimeat_compliance_snapshot save: the operator\'s writer keeps one, and list and read find it unchanged', async () => {
    const saved = await callTool(opWrite, 'aimeat_compliance_snapshot', { action: 'save', since_days: 7 });
    assert(!saved.isError, `save: ${saved.text.slice(0, 300)}`);
    savedId = saved.data.id;
    assert(typeof savedId === 'string' && savedId.length > 0, `saved id: ${short(saved.data)}`);

    const list = await callTool(opBoth, 'aimeat_compliance_snapshot', { action: 'list' });
    assert(!list.isError && Array.isArray(list.data.reports), `list: ${list.text.slice(0, 300)}`);
    assert(list.data.reports.some((r: any) => r.id === savedId), `the kept report is not listed: ${short(list.data.reports)}`);

    const read = await callTool(opBoth, 'aimeat_compliance_snapshot', { action: 'read', id: savedId });
    assert(!read.isError && read.data.id === savedId && read.data.report, `read: ${read.text.slice(0, 300)}`);
    const miss = await callTool(opBoth, 'aimeat_compliance_snapshot', { action: 'read', id: '1999-01' });
    assert(miss.isError && /Nothing is stored/.test(miss.text), `missing id: ${miss.text.slice(0, 200)}`);
});

await test('Cleanup: the register is written back empty, as a fresh node holds it', async () => {
    const r = await callTool(opWrite, 'aimeat_compliance_register_write', { part: 'usecases', value: { usecases: [] } });
    assert(!r.isError && r.data.total === 0, `clear: ${r.text.slice(0, 300)}`);
    assert((await storedUseCaseIds()).length === 0, 'the register is not empty');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

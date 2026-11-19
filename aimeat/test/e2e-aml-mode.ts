/**
 * @file e2e-aml-mode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the anti-money-laundering setting and compliance section 13 (services/aml/;
 *   decision decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila). An operator, A who creates
 *   two organisms, B, and C who belongs to neither.
 *   report: an organism's declaration is stored; section 13 finds it, proposes mode owners, names the
 *     roles it leaves open, and reads custody as evidence.
 *   none: a new declaration is refused with AML_NOT_OFFERED before anything is written; the stored one
 *     stays, and a write that keeps it (with a review added) is accepted.
 *   owners: the second organism's declaration is stored; no mode is proposed any more.
 *   node: the missing node declaration is a finding with its proposal; only the operator writes it.
 *   A review makes a finding the person's. Slices: B's own report holds none of A's organisms, A's
 *   holds them; B cannot read the node report; C cannot write A's organism's document.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=aml-mode
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 500)}`;
const codeOf = (r: Answer) => r.body?.error?.code;
const stamp = Date.now() % 10_000_000;

console.log('\n=== AIMEAT anti-money-laundering mode E2E ===\n');
let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let org1 = '', org2 = '';
const setMode = (value: string) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'compliance.aml_mode', value }] } });
const nodeAml = async () => {
    const r = await call('/v1/admin/compliance/report', { token: OP.token });
    assert(r.status === 200 && r.body.data.aml, `report: ${show(r)}`);
    return r.body.data.aml as Body;
};
const finding = (s: Body, id: string) => (s.findings as Body[]).find(f => f.id === id);
const orgDoc = (org: string) => `/v1/compliance/docs/aml?scope=organism&organism_id=${org}`;
const declaration = (id: string, legalName: string, extra: Body = {}) => ({ id, type: 'declaration', legalName, businessId: '1234567-8', sector: 'accounting', complianceOfficer: A.name, scope: 'Bookkeeping for small companies', ...extra });

await test('Setup: an operator, A with two organisms, B, and C', async () => {
    const op = await setupOperator(BASE, ADMIN_PW, `amlop${stamp}`);
    OP = { name: op.name, token: op.token };
    const a = await registerOwner(BASE, `amla${stamp}`); A = { name: a.name, token: a.token };
    const b = await registerOwner(BASE, `amlb${stamp}`); B = { name: b.name, token: b.token };
    const c = await registerOwner(BASE, `amlc${stamp}`); C = { name: c.name, token: c.token };
    for (const [n, set] of [[1, (id: string) => { org1 = id; }], [2, (id: string) => { org2 = id; }]] as const) {
        const o = await call('/v1/organisms', { token: A.token, body: { name: `Aml Office ${n} ${stamp}`, type: 'cooperative', join_policy: 'approval_required', visibility: 'private' } });
        assert(o.status === 201 || o.status === 200, `organism ${n}: ${show(o)}`);
        set(o.body.data.organism.id);
    }
    assert((await setMode('report')).status === 200, 'mode report');
});

console.log('\nreport');

await test('report: A stores a declaration; section 13 finds it, proposes owners, names the open roles, reads custody as evidence', async () => {
    const w = await call(orgDoc(org1), { token: A.token, method: 'PUT', body: { items: [declaration('decl', 'Alice Tilit Oy')] } });
    assert(w.status === 200, `declaration: ${show(w)}`);
    const s = await nodeAml();
    assert(s.section === '13' && s.mode === 'report' && s.mode_code === 'aml-mode-report' && typeof s.mode_text === 'string', `head: ${JSON.stringify({ s: s.section, m: s.mode })}`);
    const f = finding(s, 'org_declares_obliged');
    assert(f?.count >= 1 && f.items.some((i: Body) => i.organism_id === org1) && f.source === 'proposed', `declared: ${JSON.stringify(f)}`);
    assert(f.proposal?.action === 'set_mode_owners', `proposal: ${JSON.stringify(f.proposal)}`);
    assert(finding(s, `roles_incomplete:${org1}`)?.count === 1, 'the missing manager is named');
    assert(finding(s, `registration_missing:${org1}`)?.count === 1, 'the missing registrations are named');
    assert(s.declarations.some((d: Body) => d.organism_id === org1 && d.legal_name === 'Alice Tilit Oy'), 'the declaration is listed');
    const custody = (s.obligations as Body[]).find(r => r.code === 'aml-ob-custody');
    assert(custody?.status === 'evidence', `custody: ${JSON.stringify(custody)}`);
    for (const r of s.obligations as Body[]) assert(['evidence', 'check', 'missing', 'not_applicable'].includes(r.status) && r.ref?.ref, `row: ${JSON.stringify(r)}`);
});

console.log('\nnone');

await test('none: a new declaration is refused before any write; the stored one stays, and a write keeping it is accepted', async () => {
    assert((await setMode('none')).status === 200, 'mode none');
    const refused = await call(orgDoc(org2), { token: A.token, method: 'PUT', body: { items: [declaration('decl', 'Alice Toinen Oy')] } });
    assert(refused.status === 403 && codeOf(refused) === 'AML_NOT_OFFERED', `refused: ${show(refused)}`);
    const back = await call(orgDoc(org2), { token: A.token });
    assert(back.status === 200 && !(back.body.data.items ?? []).length, `nothing was written: ${show(back)}`);
    const swapped = await call(orgDoc(org1), { token: A.token, method: 'PUT', body: { items: [declaration('decl-new', 'Alice Tilit Oy')] } });
    assert(swapped.status === 403 && codeOf(swapped) === 'AML_NOT_OFFERED', `a new id in a stored document: ${show(swapped)}`);
    const kept = await call(orgDoc(org1), { token: A.token, method: 'PUT', body: { items: [declaration('decl', 'Alice Tilit Oy', { deputy: B.name }), { id: 'payers_not_screened', type: 'review', decision: 'accepted' }] } });
    assert(kept.status === 200, `keeping the stored declaration: ${show(kept)}`);
    const s = await nodeAml();
    assert(s.mode === 'none' && finding(s, 'org_declares_obliged').items.some((i: Body) => i.organism_id === org1), 'the stored declaration is a finding');
});

console.log('\nowners');

await test('owners: the second organism declares itself; no mode is proposed any more', async () => {
    assert((await setMode('owners')).status === 200, 'mode owners');
    const w = await call(orgDoc(org2), { token: A.token, method: 'PUT', body: { items: [declaration('decl', 'Alice Toinen Oy', { complianceManager: A.name, deputy: B.name })] } });
    assert(w.status === 200, `declaration: ${show(w)}`);
    const s = await nodeAml();
    const f = finding(s, 'org_declares_obliged');
    assert(f.count >= 2 && !f.proposal, `owners: ${JSON.stringify(f)}`);
    assert(finding(s, 'declaration_missing').count === 0, 'a declaration exists');
    assert(!finding(s, `roles_incomplete:${org2}`), 'the complete declaration leaves no roles open');
});

console.log('\nnode');

await test('node: the missing node declaration is a finding; A cannot write it, the operator can', async () => {
    assert((await setMode('node')).status === 200, 'mode node');
    let s = await nodeAml();
    const missing = finding(s, 'declaration_missing');
    assert(missing.count === 1 && missing.proposal?.request?.url === '/v1/compliance/docs/aml', `missing: ${JSON.stringify(missing)}`);
    const byA = await call('/v1/compliance/docs/aml', { token: A.token, method: 'PUT', body: { items: [declaration('node', 'Operaattori Oy')] } });
    assert(byA.status === 403, `A writes the node document: ${show(byA)}`);
    const byOp = await call('/v1/compliance/docs/aml', { token: OP.token, method: 'PUT', body: { items: [
        declaration('node', 'Operaattori Oy', { complianceOfficer: OP.name }),
        { id: 'payers_not_screened', type: 'review', decision: 'dismissed', note: 'a test server' },
    ] } });
    assert(byOp.status === 200, `operator: ${show(byOp)}`);
    s = await nodeAml();
    assert(finding(s, 'declaration_missing').count === 0, 'the node declaration counts');
    assert(s.declarations.some((d: Body) => d.scope === 'node' && d.legal_name === 'Operaattori Oy'), 'the node declaration is listed');
    const reviewed = finding(s, 'payers_not_screened');
    assert(reviewed.source === 'human' && reviewed.review?.decision === 'dismissed', `the node's review wins: ${JSON.stringify(reviewed)}`);
});

console.log('\nslices');

await test('B\'s own report holds none of A\'s organisms; A\'s holds them; B cannot read the node report; C cannot write A\'s organism', async () => {
    const mine = await call('/v1/compliance/report/mine', { token: B.token });
    assert(mine.status === 200 && mine.body.data.aml, `B slice: ${show(mine)}`);
    const sb = mine.body.data.aml as Body;
    assert(!sb.declarations.length && finding(sb, 'org_declares_obliged').count === 0, `B sees A's declarations: ${JSON.stringify(sb.declarations)}`);
    assert(!JSON.stringify(sb).includes(org1) && !JSON.stringify(sb).includes('Operaattori Oy'), 'B\'s slice names A\'s organism or the node declaration');
    const sa = (await call('/v1/compliance/report/mine', { token: A.token })).body.data.aml as Body;
    assert(sa.declarations.filter((d: Body) => d.scope === 'organism').length === 2 && !sa.declarations.some((d: Body) => d.scope === 'node'), `A's slice: ${JSON.stringify(sa.declarations)}`);
    const node = await call('/v1/admin/compliance/report', { token: B.token });
    assert(node.status === 403, `B reads the node report: ${show(node)}`);
    const byC = await call(orgDoc(org1), { token: C.token, method: 'PUT', body: { items: [] } });
    assert(byC.status === 404 || byC.status === 403, `C writes A's organism: ${show(byC)}`);
});

await test('Cleanup: the mode back to report', async () => {
    assert((await setMode('report')).status === 200, 'mode report');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

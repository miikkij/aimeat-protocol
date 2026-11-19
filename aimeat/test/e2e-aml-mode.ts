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
 *   v1.1.0 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); every refusal holds its code.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, setupOperator } from './helpers/owner-login.js';

const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
const stamp = Date.now() % 10_000_000;

const call = (path: string, token: string, opts: { body?: unknown; method?: string } = {}) => json<Body>(path, {
  method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
});
const show = (r: { status: number; body: unknown }) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

console.log('\n=== AIMEAT anti-money-laundering mode E2E ===\n');
let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let org1 = '', org2 = '';
const setMode = (value: string) => call('/v1/admin/config', OP.token, { method: 'PUT', body: { changes: [{ path: 'compliance.aml_mode', value }] } });
const nodeAml = async () => {
  const r = await call('/v1/admin/compliance/report', OP.token);
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
  for (const n of [1, 2]) {
    const o = await call('/v1/organisms', A.token, { body: { name: `Aml Office ${n} ${stamp}`, type: 'cooperative', join_policy: 'approval_required', visibility: 'private' } });
    assert(o.status === 201 || o.status === 200, `organism ${n}: ${show(o)}`);
    if (n === 1) org1 = o.body.data.organism.id; else org2 = o.body.data.organism.id;
  }
  assert((await setMode('report')).status === 200, 'mode report');
});

console.log('\nreport');

await test('report: A stores a declaration; section 13 finds it, proposes owners, names the open roles, reads custody as evidence', async () => {
  const w = await call(orgDoc(org1), A.token, { method: 'PUT', body: { items: [declaration('decl', 'Alice Tilit Oy')] } });
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
  const refused = await call(orgDoc(org2), A.token, { method: 'PUT', body: { items: [declaration('decl', 'Alice Toinen Oy')] } });
  expectRefusal(refused, 403, 'AML_NOT_OFFERED');
  const back = await call(orgDoc(org2), A.token);
  assert(back.status === 200 && !(back.body.data.items ?? []).length, `nothing was written: ${show(back)}`);
  const swapped = await call(orgDoc(org1), A.token, { method: 'PUT', body: { items: [declaration('decl-new', 'Alice Tilit Oy')] } });
  expectRefusal(swapped, 403, 'AML_NOT_OFFERED');
  const kept = await call(orgDoc(org1), A.token, { method: 'PUT', body: { items: [declaration('decl', 'Alice Tilit Oy', { deputy: B.name }), { id: 'payers_not_screened', type: 'review', decision: 'accepted' }] } });
  assert(kept.status === 200, `keeping the stored declaration: ${show(kept)}`);
  const s = await nodeAml();
  assert(s.mode === 'none' && finding(s, 'org_declares_obliged').items.some((i: Body) => i.organism_id === org1), 'the stored declaration is a finding');
});

console.log('\nowners');

await test('owners: the second organism declares itself; no mode is proposed any more', async () => {
  assert((await setMode('owners')).status === 200, 'mode owners');
  const w = await call(orgDoc(org2), A.token, { method: 'PUT', body: { items: [declaration('decl', 'Alice Toinen Oy', { complianceManager: A.name, deputy: B.name })] } });
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
  const byA = await call('/v1/compliance/docs/aml', A.token, { method: 'PUT', body: { items: [declaration('node', 'Operaattori Oy')] } });
  expectRefusal(byA, 403, 'NOT_ALLOWED');
  const byOp = await call('/v1/compliance/docs/aml', OP.token, { method: 'PUT', body: { items: [
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
  const mine = await call('/v1/compliance/report/mine', B.token);
  assert(mine.status === 200 && mine.body.data.aml, `B slice: ${show(mine)}`);
  const sb = mine.body.data.aml as Body;
  assert(!sb.declarations.length && finding(sb, 'org_declares_obliged').count === 0, `B sees A's declarations: ${JSON.stringify(sb.declarations)}`);
  assert(!JSON.stringify(sb).includes(org1) && !JSON.stringify(sb).includes('Operaattori Oy'), 'B\'s slice names A\'s organism or the node declaration');
  const sa = (await call('/v1/compliance/report/mine', A.token)).body.data.aml as Body;
  assert(sa.declarations.filter((d: Body) => d.scope === 'organism').length === 2 && !sa.declarations.some((d: Body) => d.scope === 'node'), `A's slice: ${JSON.stringify(sa.declarations)}`);
  const node = await call('/v1/admin/compliance/report', B.token);
  expectRefusal(node, 403, 'ACCESS_DENIED');
  const byC = await call(orgDoc(org1), C.token, { method: 'PUT', body: { items: [] } });
  // C is no member of A's organism, so the organism is not shown to C at all: 404.
  expectRefusal(byC, 404, 'NOT_FOUND');
});

await test('Cleanup: the mode back to report', async () => {
  assert((await setMode('report')).status === 200, 'mode report');
});

finish();

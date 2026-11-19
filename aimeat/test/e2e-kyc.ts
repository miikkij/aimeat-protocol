/**
 * @file test/e2e-kyc.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Customer due diligence end to end (services/kyc/, routes/kyc/routes.ts): the gate (the
 *   operator's mode and the organism's declaration), the roles (officer, staff, admin, a plain member,
 *   another owner, an agent), a card's versions and what it said on a given day, screening against a
 *   sanctions list the node fetched (a fixture list served here), a hit decided in person, senior
 *   approval, a suspicion the marker cannot follow, the officers' draft and its record of sending,
 *   the end of a relationship and the retention that follows (no memory delete, no organism delete),
 *   the identify link, and the operator's view that counts and never names.
 *
 *   Each refusal is the one a second principal gets (security.md: cross-owner and cross-scope 403).
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-kyc
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';
import { callTool, makeAgent, openSession } from './helpers/mcp-session.js';

const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
type Body = Record<string, any>;
const stamp = Date.now() % 10_000_000;

const call = (path: string, token: string, opts: { body?: unknown; method?: string } = {}) => json<Body>(path, {
  method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
});
const show = (r: { status: number; body: unknown }) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

// A far side that serves the fixture lists, on a port the OS picks.
const EU = readFileSync(new URL('./fixtures/kyc/eu-fsf-sample.xml', import.meta.url));
const UN = readFileSync(new URL('./fixtures/kyc/un-consolidated-sample.xml', import.meta.url));
const far = http.createServer((req, res) => {
  if (req.url === '/eu.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(EU); return; }
  if (req.url === '/un.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(UN); return; }
  res.writeHead(404); res.end();
});
await new Promise<void>(r => far.listen(0, '127.0.0.1', () => r()));
const FAR = `http://127.0.0.1:${(far.address() as AddressInfo).port}`;

console.log('\n=== AIMEAT customer due diligence E2E ===\n');
let OP = { name: '', token: '', ghii: '' }, A = { name: '', token: '', ghii: '' }, B = { name: '', token: '', ghii: '' };
let C = { name: '', token: '', ghii: '' }, D = { name: '', token: '', ghii: '' };
let agentA = '';
let org = '';
let bob = '', dark = '';
const setConfig = (path: string, value: unknown) => call('/v1/admin/config', OP.token, { method: 'PUT', body: { changes: [{ path, value }] } });
const K = (p: string) => `/v1/kyc/${org}${p}`;

await test('Setup: operator, A (admin and officer), B (staff), C (plain member), D (outside); A\'s agent; the fixture lists', async () => {
  const op = await setupOperator(BASE, ADMIN_PW, `kycop${stamp}`); OP = { name: op.name, token: op.token, ghii: op.ghii ?? '' };
  for (const [k, n] of [['A', 'a'], ['B', 'b'], ['C', 'c'], ['D', 'd']] as const) {
    const o = await registerOwner(BASE, `kyc${n}${stamp}`);
    const v = { name: o.name, token: o.token, ghii: o.ghii ?? '' };
    if (k === 'A') A = v; else if (k === 'B') B = v; else if (k === 'C') C = v; else D = v;
  }
  const o = await call('/v1/organisms', A.token, { body: { name: `Kyc Office ${stamp}`, type: 'cooperative', join_policy: 'approval_required', visibility: 'private' } });
  assert(o.status === 201 || o.status === 200, `organism: ${show(o)}`);
  org = o.body.data.organism.id;
  for (const who of [B, C]) {
    const m = await call(`/v1/organisms/${org}/members`, A.token, { body: { ghii: who.name, role: 'member' } });
    assert(m.status === 201, `member ${who.name}: ${show(m)}`);
  }
  const ag = await connectAgentByDevice(BASE, { owner: A.name, ownerToken: A.token, name: `kycagent${stamp}`, scopes: ['compliance:read', 'compliance:write'] });
  agentA = ag.token;
  assert((await setConfig('compliance.kyc_sanctions_sources', `eu-fsf=${FAR}/eu.xml,un=${FAR}/un.xml`)).status === 200, 'sources');
});

console.log('\ngate');

await test('Off: mode report refuses every door with KYC_NOT_ENABLED and says what turns it on', async () => {
  assert((await setConfig('compliance.aml_mode', 'report')).status === 200, 'mode report');
  const r = await call(K('/customers'), A.token);
  expectRefusal(r, 403, 'KYC_NOT_ENABLED');
  assert(/aml_mode/.test(JSON.stringify(r.body)), 'names the setting');
});

await test('On for the node, but the organism has not declared itself: KYC_NOT_ENABLED naming the declaration', async () => {
  assert((await setConfig('compliance.aml_mode', 'owners')).status === 200, 'mode owners');
  const r = await call(K('/customers'), A.token);
  expectRefusal(r, 403, 'KYC_NOT_ENABLED');
  assert(/declar/.test(JSON.stringify(r.body)), 'names the declaration');
  const d = await call(`/v1/compliance/docs/aml?scope=organism&organism_id=${org}`, A.token, { method: 'PUT', body: { items: [{ id: 'decl', type: 'declaration', legalName: 'Kyc Tilit Oy', businessId: '7654321-0', sector: 'accounting', complianceOfficer: A.name, scope: 'Bookkeeping' }] } });
  assert(d.status === 200, `declaration: ${show(d)}`);
});

console.log('\nroles');

await test('Settings: the admin names the officer and the staff; a plain member reads nothing and writes nothing', async () => {
  expectRefusal(await call(K('/settings'), C.token), 403, 'KYC_NOT_STAFF');
  expectRefusal(await call(K('/settings'), C.token, { method: 'PUT', body: { staff: [C.ghii] } }), 403, 'KYC_NOT_MANAGER');
  const w = await call(K('/settings'), A.token, { method: 'PUT', body: { officers: [A.ghii], staff: [B.ghii] } });
  assert(w.status === 200 && w.body.data.officers[0] === A.ghii && w.body.data.staff[0] === B.ghii, `settings: ${show(w)}`);
  expectRefusal(await call(K('/settings'), agentA, { method: 'PUT', body: { staff: [] } }), 403, 'KYC_DECISION_IN_PERSON');
});

await test('Cards: a plain member and an outside owner are refused; the staff opens a card', async () => {
  expectRefusal(await call(K('/customers'), C.token), 403, 'KYC_NOT_STAFF');
  expectRefusal(await call(K('/customers'), D.token), 403, 'KYC_NOT_STAFF');
  expectRefusal(await call(K('/customers'), D.token, { body: { kind: 'person', name: 'Mallory' } }), 403, 'KYC_NOT_STAFF');
  const o = await call(K('/customers'), B.token, { body: { kind: 'person', name: 'Bob Example', birthDate: '1980-02-03', country: 'FI', nationality: 'FI', purpose: 'Bookkeeping for a sole trader', sourceOfFunds: 'Salary', pep: 'no' } });
  assert(o.status === 200 && o.body.data.n === 1 && o.body.data.change === 'opened', `open: ${show(o)}`);
  bob = o.body.data.id;
  assert(o.body.data.status === 'blocked' && o.body.data.risk.blocking.includes('identity-none'), `no identity yet blocks: ${JSON.stringify(o.body.data.risk)}`);
});

console.log('\nscreening and versions');

await test('Lists: only the operator fetches; then a card is screened clear against them', async () => {
  // The operator's doors ask requireOperator, which answers ACCESS_DENIED.
  expectRefusal(await call('/v1/admin/kyc/lists/refresh', A.token, { body: {} }), 403, 'ACCESS_DENIED');
  const f = await call('/v1/admin/kyc/lists/refresh', OP.token, { body: {} });
  assert(f.status === 200 && f.body.data.lists.every((l: Body) => l.changed && l.entries > 0), `refresh: ${show(f)}`);
  const id = await call(K(`/customers/${bob}/identity`), B.token, { body: { level: 'substantial', method: 'document', verifiedAt: new Date().toISOString(), faceToFace: true, evidence: 'Passport seen in person' } });
  assert(id.status === 200 && id.body.data.screening.status === 'clear' && id.body.data.status === 'active', `identified and clear: ${show(id)}`);
  assert(id.body.data.risk.level === 'low' && typeof id.body.data.nextReviewAt === 'string', `low risk with a review date: ${JSON.stringify(id.body.data.risk)}`);
});

await test('A listed entity is a possible hit; the agent cannot decide it; the officer in person decides false positive with a ground', async () => {
  const o = await call(K('/customers'), agentA, { body: { kind: 'entity', name: 'Darkwater Shipping Oy', country: 'FI', businessId: '1111111-1', purpose: 'Payroll', sourceOfFunds: 'Freight income', beneficialOwners: [{ name: 'Carol Owner', share: 100, country: 'FI' }], pep: 'no' } });
  assert(o.status === 200, `the agent opens the card: ${show(o)}`);
  dark = o.body.data.id;
  const hit = (o.body.data.screening.hits as Body[]).find(h => h.subject === 'customer');
  assert(o.body.data.screening.status === 'possible' && hit, `possible hit: ${JSON.stringify(o.body.data.screening)}`);
  assert(o.body.data.status === 'blocked' && o.body.data.risk.blocking.includes('sanctions-possible'), 'a possible hit blocks');
  const body = { source: hit.source, hit_id: hit.id, subject: hit.subject, verdict: 'false-positive', note: 'Different company: business id and owners differ' };
  expectRefusal(await call(K(`/customers/${dark}/hits`), agentA, { body }), 403, 'KYC_DECISION_IN_PERSON');
  expectRefusal(await call(K(`/customers/${dark}/hits`), A.token, { body: { ...body, note: '' } }), 400, 'INVALID_INPUT');
  const d = await call(K(`/customers/${dark}/hits`), A.token, { body });
  assert(d.status === 200 && d.body.data.screening.status === 'clear' && d.body.data.change === 'hit-decided', `decided: ${show(d)}`);
  const kept = (d.body.data.screening.hits as Body[]).find(h => h.id === hit.id);
  assert(kept.verdict === 'false-positive' && kept.decidedBy === A.ghii, 'the decision stays with its ground');
});

await test('A PEP waits for senior approval: staff cannot give it, an agent cannot, the officer in person can', async () => {
  const u = await call(K(`/customers/${bob}`), B.token, { method: 'PATCH', body: { pep: 'yes', pepDetail: 'Member of a city council', note: 'Told us at the meeting' } });
  assert(u.status === 200 && u.body.data.risk.level === 'high' && u.body.data.risk.needsSeniorApproval && u.body.data.status === 'blocked', `pep: ${show(u)}`);
  expectRefusal(await call(K(`/customers/${bob}/approve`), B.token, { body: { note: 'ok' } }), 403, 'KYC_NOT_MANAGER');
  expectRefusal(await call(K(`/customers/${bob}/approve`), agentA, { body: { note: 'ok' } }), 403, 'KYC_DECISION_IN_PERSON');
  const a = await call(K(`/customers/${bob}/approve`), A.token, { body: { note: 'Enhanced checks done' } });
  assert(a.status === 200 && a.body.data.status === 'active' && a.body.data.risk.approvedBy === A.ghii, `approved: ${show(a)}`);
  assert(a.body.data.risk.dueDiligence === 'enhanced', 'enhanced due diligence');
});

await test('as_of: the card as it stood after it was opened, with the number of newer versions', async () => {
  const r = await call(K(`/customers/${bob}`), B.token);
  const versions = r.body.data.versions as Body[];
  // The list fetch screened the open card again, as a version of its own, before it was identified.
  assert(versions.map(v => v.change).join(',') === 'opened,screened,identified,updated,approved', `versions: ${JSON.stringify(versions.map(v => v.change))}`);
  const at = versions[0].at;
  const old = await call(K(`/customers/${bob}?as_of=${encodeURIComponent(at)}`), B.token);
  assert(old.status === 200 && old.body.data.card.n === 1 && old.body.data.card.pep === 'no' && old.body.data.newer === versions.length - 1, `as_of: ${show(old)}`);
  const before = await call(K(`/customers/${bob}?as_of=2000-01-01`), B.token);
  assert(before.status === 200 && before.body.data.card === null, 'before the card existed: null');
  expectRefusal(await call(K(`/customers/${bob}?as_of=${encodeURIComponent(at)}`), D.token), 403, 'KYC_NOT_STAFF');
});

console.log('\nMCP');

await test('MCP: the agent opens a card and reads it as of a day through aimeat_kyc_customer; another owner\'s agent is refused', async () => {
  const s = await openSession(BASE, agentA, 'e2e-kyc');
  const opened = await callTool(s, 'aimeat_kyc_customer', { organism: org, action: 'open', fields: { kind: 'person', name: 'Frank Chat', country: 'FI', pep: 'no' } });
  assert(opened.offered && !opened.isError && opened.data?.id, `open over MCP: ${opened.text.slice(0, 300)}`);
  const asOf = await callTool(s, 'aimeat_kyc_customer', { organism: org, action: 'as_of', customer_id: opened.data.id, as_of: new Date(Date.now() + 60_000).toISOString() });
  assert(!asOf.isError && asOf.data?.card?.name === 'Frank Chat', `as_of over MCP: ${asOf.text.slice(0, 300)}`);
  const settings = await callTool(s, 'aimeat_kyc_settings', { organism: org, action: 'update', staff: [] });
  assert(settings.isError && /KYC_DECISION_IN_PERSON/.test(settings.text), `settings change refused to an agent: ${settings.text.slice(0, 200)}`);
  const other = await makeAgent(BASE, D, ['compliance:read', 'compliance:write'], `kycother${stamp}`);
  const os = await openSession(BASE, other.token, 'e2e-kyc-other');
  const refused = await callTool(os, 'aimeat_kyc_customer', { organism: org, action: 'list' });
  assert(refused.isError && /KYC_NOT_STAFF/.test(refused.text), `another owner's agent: ${refused.text.slice(0, 200)}`);
  // Marking a suspicion over MCP: the agent learns only that it was received; another owner's agent is refused.
  const marked = await callTool(s, 'aimeat_kyc_suspicion_mark', { organism: org, customer_id: opened.data.id, observation: 'Asked to pay the invoice in cash in three parts.' });
  assert(!marked.isError && marked.data?.received === true && !('observation' in (marked.data ?? {})), `mark over MCP: ${marked.text.slice(0, 200)}`);
  const markRefused = await callTool(os, 'aimeat_kyc_suspicion_mark', { organism: org, observation: 'Something odd happened here.' });
  assert(markRefused.isError && /KYC_NOT_STAFF/.test(markRefused.text), `another owner's agent marks: ${markRefused.text.slice(0, 200)}`);
});

console.log('\nsuspicions');

let rid = '';
await test('A suspicion: the agent marks it and learns only that it was received; staff and agents cannot read it; the officer can', async () => {
  const m = await call(K('/suspicions'), agentA, { body: { customer_id: bob, observation: 'Cash deposits split just under 10 000 euros, three times this week.' } });
  assert(m.status === 200 && m.body.data.received === true && Object.keys(m.body.data).sort().join(',') === 'id,received', `marked: ${show(m)}`);
  rid = m.body.data.id;
  expectRefusal(await call(K('/suspicions'), B.token), 403, 'KYC_NOT_OFFICER');
  expectRefusal(await call(K(`/suspicions/${rid}`), agentA), 403, 'KYC_OFFICER_IN_PERSON');
  expectRefusal(await call(K('/suspicions'), D.token), 403, 'KYC_NOT_OFFICER');
  const l = await call(K('/suspicions'), A.token);
  assert(l.status === 200 && (l.body.data as Body[]).some(r => r.id === rid && r.status === 'marked'), `officer reads: ${show(l)}`);
});

await test('The officer drafts, records the goAML submission; the case then does not change', async () => {
  const d = await call(K(`/suspicions/${rid}`), A.token, { method: 'PATCH', body: { reportType: 'STR', indicators: ['structuring'], narrative: 'Three cash deposits under the threshold.' } });
  assert(d.status === 200 && d.body.data.status === 'draft', `draft: ${show(d)}`);
  // The contract requires goaml_ref, so the request check answers before the route (VALIDATION_ERROR).
  expectRefusal(await call(K(`/suspicions/${rid}/submit`), A.token, { body: {} }), 400, 'VALIDATION_ERROR');
  const s = await call(K(`/suspicions/${rid}/submit`), A.token, { body: { goaml_ref: 'GOAML-2026-0001' } });
  assert(s.status === 200 && s.body.data.status === 'submitted' && typeof s.body.data.retainUntil === 'string', `submitted: ${show(s)}`);
  expectRefusal(await call(K(`/suspicions/${rid}`), A.token, { method: 'PATCH', body: { narrative: 'x' } }), 409, 'REPORT_CLOSED');
});

console.log('\nretention');

await test('Ending: the card stops changing and is held five years; memory delete and organism delete are refused', async () => {
  const e = await call(K(`/customers/${bob}/end`), B.token, { body: { note: 'Contract ended', ended_at: '2026-11-01' } });
  assert(e.status === 200 && e.body.data.status === 'ended' && e.body.data.retainUntil === '2031-11-01', `ended: ${show(e)}`);
  expectRefusal(await call(K(`/customers/${bob}`), B.token, { method: 'PATCH', body: { purpose: 'x' } }), 409, 'CUSTOMER_ENDED');
  expectRefusal(await call(`/v1/memory/kyc.org.${org}.c.${bob}.head`, A.token, { method: 'DELETE' }), 403, 'KYC_RETAINED');
  // The operator's own delete door reaches the node's records; the law's hold stops it there too.
  const nodeId = String(e.body.node ?? '');
  const opDel = await call(`/v1/admin/memory/${encodeURIComponent(`system@${nodeId}`)}/kyc.org.${org}.c.${bob}.head`, OP.token, { method: 'DELETE' });
  expectRefusal(opDel, 403, 'KYC_RETAINED');
  assert((await call(K(`/customers/${bob}`), B.token)).status === 200, 'the card is still there');
  expectRefusal(await call(`/v1/organisms/${org}`, A.token, { method: 'DELETE' }), 409, 'KYC_RECORDS_RETAINED');
  const h = await call(K(`/customers/${bob}/hold`), A.token, { body: { until: '2050-01-01', basis: 'Police request' } });
  expectRefusal(h, 400, 'INVALID_HOLD');
  const ok = await call(K(`/customers/${bob}/hold`), A.token, { body: { until: '2033-01-01', basis: 'Request of the Financial Intelligence Unit' } });
  assert(ok.status === 200 && ok.body.data.retainUntil === '2033-01-01' && ok.body.data.change === 'hold-extended', `hold: ${show(ok)}`);
});

console.log('\nidentify link and the person\'s own view');

await test('The identify link: staff create it; the customer must be in person and verified; an entity has none', async () => {
  expectRefusal(await call(K(`/customers/${dark}/link`), B.token, { body: {} }), 409, 'NOT_A_PERSON');
  const p = await call(K('/customers'), B.token, { body: { kind: 'person', name: 'Dave Customer', country: 'FI', pep: 'no' } });
  const l = await call(K(`/customers/${p.body.data.id}/link`), B.token, { body: {} });
  assert(l.status === 200 && /^\/v1\/profile\?tab=identify&token=/.test(l.body.data.path), `link: ${show(l)}`);
  const token = l.body.data.token as string;
  expectRefusal(await call(`/v1/kyc/links/${token}`, agentA), 403, 'IN_PERSON_ONLY');
  const v = await call(`/v1/kyc/links/${token}`, D.token);
  assert(v.status === 200 && v.body.data.verification === null && v.body.data.verifyPath && v.body.data.organism.id === org, `view: ${show(v)}`);
  expectRefusal(await call(`/v1/kyc/links/${token}`, D.token, { body: {} }), 409, 'NOT_VERIFIED');
  expectRefusal(await call('/v1/kyc/links/not-a-real-token-at-all-xx', D.token), 404, 'LINK_NOT_FOUND');
  const me = await call('/v1/kyc/me', D.token);
  assert(me.status === 200 && Array.isArray(me.body.data.verifications) && Array.isArray(me.body.data.disclosures), `me: ${show(me)}`);
});

console.log('\nevery door');

await test('Every door refuses a second principal: an outside owner on the organism\'s doors, an agent without the words on the person\'s own', async () => {
  const iso = new Date().toISOString();
  // An outside owner (D) on every door of the organism, each with a body the door accepts, so the refusal is the role's.
  const doors: Array<[string, string, unknown]> = [
    ['GET', `/v1/kyc/${org}/settings`, undefined],
    ['PUT', `/v1/kyc/${org}/settings`, { staff: [] }],
    ['GET', `/v1/kyc/${org}/customers`, undefined],
    ['POST', `/v1/kyc/${org}/customers`, { kind: 'person', name: 'Mallory' }],
    ['GET', `/v1/kyc/${org}/customers/${bob}`, undefined],
    ['PATCH', `/v1/kyc/${org}/customers/${dark}`, { purpose: 'x' }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/identity`, { level: 'low', method: 'document', verifiedAt: iso }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/screen`, {}],
    ['POST', `/v1/kyc/${org}/customers/${dark}/hits`, { source: 'eu-fsf', hit_id: '1', verdict: 'false-positive', note: 'x' }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/approve`, { note: 'x' }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/review`, { note: 'x' }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/end`, {}],
    ['POST', `/v1/kyc/${org}/customers/${bob}/hold`, { until: '2030-01-01', basis: 'x' }],
    ['POST', `/v1/kyc/${org}/customers/${dark}/link`, {}],
    ['POST', `/v1/kyc/${org}/suspicions`, { observation: 'Something odd happened here.' }],
    ['GET', `/v1/kyc/${org}/suspicions`, undefined],
    ['GET', `/v1/kyc/${org}/suspicions/${rid}`, undefined],
    ['PATCH', `/v1/kyc/${org}/suspicions/${rid}`, { narrative: 'x' }],
    ['POST', `/v1/kyc/${org}/suspicions/${rid}/submit`, { goaml_ref: 'x' }],
    ['POST', `/v1/kyc/${org}/suspicions/${rid}/close`, { decision: 'x' }],
    ['POST', `/v1/kyc/${org}/suspicions/${rid}/assist`, {}],
  ];
  for (const [method, path, body] of doors) {
    const r = await call(path, D.token, { method, body });
    assert(r.status === 403, `${method} ${path} for an outside owner: ${show(r)}`);
  }
  // The person's own doors: an agent of D that holds no compliance word.
  const bare = await makeAgent(BASE, D, ['memory:read'], `kycbare${stamp}`);
  for (const [method, path] of [['GET', '/v1/kyc/me'], ['GET', '/v1/kyc/organisms'], ['GET', '/v1/kyc/links/not-a-real-token-at-all-xx'], ['POST', '/v1/kyc/links/not-a-real-token-at-all-xx']] as const) {
    const r = await call(path, bare.token, { method, body: method === 'POST' ? {} : undefined });
    assert(r.status === 403, `${method} ${path} for an agent without the word: ${show(r)}`);
  }
  // The operator's doors: an owner who is not the operator.
  for (const [method, path] of [['GET', '/v1/admin/kyc'], ['POST', '/v1/admin/kyc/lists/refresh']] as const) {
    const r = await call(path, A.token, { method, body: method === 'POST' ? {} : undefined });
    assert(r.status === 403, `${method} ${path} for a non-operator: ${show(r)}`);
  }
});

console.log('\noperator');

await test('The operator counts and never names; a non-operator is refused', async () => {
  expectRefusal(await call('/v1/admin/kyc', A.token), 403, 'ACCESS_DENIED');
  const v = await call('/v1/admin/kyc', OP.token);
  assert(v.status === 200 && v.body.data.mode === 'owners', `view: ${show(v)}`);
  const mine = (v.body.data.organisms as Body[]).find(o => o.id === org);
  assert(mine && mine.cards >= 3 && mine.officers === 1, `counts: ${JSON.stringify(mine)}`);
  const text = JSON.stringify(v.body.data);
  assert(!/Bob Example|Darkwater|Dave Customer|GOAML|Cash deposits/.test(text), 'no customer, no suspicion');
  assert(v.body.data.lists.length === 2, 'both lists');
});

await test('Mode none again: the door closes, and the records stay', async () => {
  assert((await setConfig('compliance.aml_mode', 'none')).status === 200, 'mode none');
  expectRefusal(await call(K('/customers'), A.token), 403, 'KYC_NOT_ENABLED');
  assert((await setConfig('compliance.aml_mode', 'owners')).status === 200, 'mode owners');
  const l = await call(K('/customers'), A.token);
  assert(l.status === 200 && (l.body.data as Body[]).length >= 3, 'the records stayed');
  await setConfig('compliance.aml_mode', 'report');
  await setConfig('compliance.kyc_sanctions_sources', '');
});

far.close();
finish();

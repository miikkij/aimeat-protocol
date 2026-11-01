/**
 * @file e2e-data-intermediation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the data intermediation setting and the compliance section 12 (plan
 *   doc-mvwxcas3dom3, D7; Data Governance Act 2022/868). An operator, provider A, buyer B, and C.
 *   D7.1 report lists and refuses nothing; none refuses a new data offering with
 *     DATA_INTERMEDIATION_NOT_OFFERED and keeps the existing one listed and reported; node notes a
 *     missing notification; owners allows an owner who manages an organism with a notification record
 *     and refuses one who does not.
 *   D7.2 the notification record is written and read through the compliance document `intermediation`,
 *     at the node (the operator only) and at an organism (its creator).
 *   D7.3 findings (a) to (e) are present with reasons and the regulation; a contract with an outside
 *     buyer and a person party's contact are found; a review makes a finding the person's.
 *   D7.4 the Article 12 rows, with node mode's (a) missing and then check.
 *   D7.6 an open organism with a data package gets the proposal to require approval, which does not
 *     change it; the creator applies it and the finding goes.
 *   Slices: B's own report holds none of A's findings; A's holds A's own; B cannot read the node report.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=data-intermediation
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7).
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

console.log('\n=== AIMEAT data intermediation E2E ===\n');
let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
const EXT = `dix${stamp}`;
const SCRIPTS = { echo: 'export default async function(ctx, input){ return { echo: input }; }' };
const action = (id: string) => ({ id, method: 'POST', path: `/${id}`, script: 'echo', input: { type: 'object', properties: { q: { type: 'string' } } }, output: { type: 'object', properties: { echo: {} } }, tollMorsels: 2 });
const MANIFEST = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'data intermediation e2e provider', author: 'e2e' },
    actions: [action('first'), action('second'), action('third')],
    config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 },
});
const terms = { derivatives: true, resale: false, attribution: true };
const list = (token: string, act: string) => call('/v1/exchange/offerings', { token, body: { ext: EXT, action: act, usage_terms: terms, title: `Data ${act}` } });
const setMode = (value: string) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'consent.data_intermediation', value }] } });
const nodeReport = async () => {
    const r = await call('/v1/admin/compliance/report', { token: OP.token });
    assert(r.status === 200 && r.body.data.data_intermediation, `report: ${show(r)}`);
    return r.body.data.data_intermediation as Body;
};
const finding = (di: Body, id: string) => (di.findings as Body[]).find(f => f.id === id);
let firstOffering = '', orgOpen = '', orgProvider = '';

await test('Setup: an operator, provider A with an extension, buyer B, and C', async () => {
    const op = await setupOperator(BASE, ADMIN_PW, `diop${stamp}`);
    OP = { name: op.name, token: op.token };
    const a = await registerOwner(BASE, `dia${stamp}`); A = { name: a.name, token: a.token };
    const b = await registerOwner(BASE, `dib${stamp}`); B = { name: b.name, token: b.token };
    const c = await registerOwner(BASE, `dic${stamp}`); C = { name: c.name, token: c.token };
    const inst = await call('/v1/extensions', { token: A.token, body: { manifest: MANIFEST, scripts: SCRIPTS } });
    assert(inst.status === 201 || inst.status === 200, `install: ${show(inst)}`);
    assert((await call(`/v1/extensions/${EXT}/activate`, { token: A.token, body: {} })).status === 200, 'activate');
    assert((await setMode('report')).status === 200, 'mode report');
});

console.log('\nD7.1 report');

await test('D7.1a report: a data offering lists, a contract with B is made, and section 12 finds both, proposed, citing the regulation', async () => {
    const r = await list(A.token, 'first');
    assert(r.status === 201, `list: ${show(r)}`);
    firstOffering = r.body.data.offering.offeringId;
    const c = await call('/v1/exchange/entitlements', { token: B.token, body: { ext: EXT, action: 'first', contract_ref: `c-${stamp}` } });
    assert(c.status === 201, `contract: ${show(c)}`);
    const di = await nodeReport();
    assert(di.section === '12' && di.mode === 'report' && typeof di.mode_text === 'string', `head: ${JSON.stringify({ s: di.section, m: di.mode })}`);
    const a = finding(di, 'data_offering_public');
    assert(a?.count >= 1 && a.items.some((i: Body) => i.offering_id === firstOffering), `(a): ${JSON.stringify(a)}`);
    assert(a.source === 'proposed' && a.regulation.some((g: Body) => g.act === '2022/868' && g.ref === 'recital 28'), `(a) source and regulation: ${JSON.stringify(a)}`);
    const b = finding(di, 'contract_outside_buyer');
    assert(b?.count >= 1 && b.items.some((i: Body) => i.buyer === B.name && i.provider === A.name), `(b): ${JSON.stringify(b)}`);
    for (const id of ['open_organism_with_data', 'app_open_registration_commerce', 'priced_named_share']) {
        const f = finding(di, id) ?? (di.findings as Body[]).find(x => x.kind === id);
        assert(f && typeof f.reason === 'string' && f.reason.length > 10 && Array.isArray(f.regulation), `${id}: ${JSON.stringify(f)}`);
    }
    assert(finding(di, 'priced_named_share').count === 0, 'no share carries a price');
    assert(!finding(di, 'notification_missing'), 'report mode asks for no notification');
});

await test('D7.4 the Article 12 rows (a, c, d, h, i, k, n, o), each with evidence and a status', async () => {
    const di = await nodeReport();
    assert(JSON.stringify(di.art12.map((r: Body) => r.point)) === JSON.stringify(['a', 'c', 'd', 'h', 'i', 'k', 'n', 'o']), `rows: ${JSON.stringify(di.art12.map((r: Body) => r.point))}`);
    for (const r of di.art12) assert(['evidence', 'check', 'missing'].includes(r.status) && Object.keys(r.evidence).length > 0, `row ${r.point}: ${JSON.stringify(r)}`);
    assert(Array.isArray(di.art12[0].evidence.node_side_readers_of_exchanged_data) && di.art12[0].evidence.node_side_readers_of_exchanged_data.length === 0, 'D7.5: no node-side reader of exchanged data');
    assert(di.art12.find((r: Body) => r.point === 'd').evidence.transformations_recorded === true, '(d) evidence');
});

console.log('\nD7.1 none');

await test('D7.1b none: a new data offering is refused before any write; the existing one stays listed and reported', async () => {
    assert((await setMode('none')).status === 200, 'mode none');
    const r = await list(A.token, 'second');
    assert(r.status === 403 && codeOf(r) === 'DATA_INTERMEDIATION_NOT_OFFERED', `refused: ${show(r)}`);
    assert(r.body.error.details?.setting === 'AIMEAT_DATA_INTERMEDIATION', 'the setting is named');
    const browse = await call(`/v1/exchange/offerings?ext=${EXT}`, { token: B.token });
    const ids = (browse.body.data?.offerings ?? []).map((o: Body) => o.offeringId);
    assert(ids.includes(firstOffering), `the existing listing stays: ${show(browse)}`);
    assert(!(browse.body.data?.offerings ?? []).some((o: Body) => o.action === 'second'), 'the refused listing was written');
    const di = await nodeReport();
    assert(di.mode === 'none' && finding(di, 'data_offering_public').items.some((i: Body) => i.offering_id === firstOffering), 'the existing listing is a finding');
});

console.log('\nD7.1 node, D7.2 the notification record');

await test('D7.1c node: section 12 notes the missing notification and Article 12 (a) reads missing; a data offering lists', async () => {
    assert((await setMode('node')).status === 200, 'mode node');
    const di = await nodeReport();
    assert(finding(di, 'notification_missing')?.proposal?.request?.url === '/v1/compliance/docs/intermediation', `missing: ${JSON.stringify(finding(di, 'notification_missing'))}`);
    assert(di.art12[0].status === 'missing', `(a): ${JSON.stringify(di.art12[0])}`);
    assert((await list(A.token, 'second')).status === 201, 'node mode lists a data offering');
});

await test('D7.2 the operator records the notification; it reads back, and the finding and (a) change; A may not write the node record', async () => {
    const doc = { items: [{ id: 'notification', type: 'notification', legalName: 'Esimerkki Oy', businessId: '1234567-8', notifiedAt: '2026-11-01', authorityRef: 'TRAFICOM/1/2026', scope: 'The EXCHANGE marketplace of this node' }] };
    const refused = await call('/v1/compliance/docs/intermediation', { token: A.token, method: 'PUT', body: doc });
    assert(refused.status === 403, `A writes the node record: ${show(refused)}`);
    const bad = await call('/v1/compliance/docs/intermediation', { token: OP.token, method: 'PUT', body: { items: [{ id: 'n', type: 'notification', legalName: '' }] } });
    assert(bad.status === 400, `an invalid record: ${show(bad)}`);
    const w = await call('/v1/compliance/docs/intermediation', { token: OP.token, method: 'PUT', body: doc });
    assert(w.status === 200 && w.body.data.stored === true, `write: ${show(w)}`);
    const back = await call('/v1/compliance/docs/intermediation', { token: OP.token });
    assert(back.status === 200 && back.body.data.items?.[0]?.legalName === 'Esimerkki Oy' && back.body.data.items[0].updatedBy, `read: ${show(back)}`);
    const di = await nodeReport();
    assert(di.notification?.businessId === '1234567-8' && !finding(di, 'notification_missing'), `notification: ${JSON.stringify(di.notification)}`);
    assert(di.art12[0].status === 'check' && di.art12[0].evidence.provider === 'Esimerkki Oy', `(a): ${JSON.stringify(di.art12[0])}`);
});

console.log('\nD7.1 owners');

await test('D7.1d owners: A is refused until an organism A manages keeps a notification record; C cannot write A\'s organism record', async () => {
    assert((await setMode('owners')).status === 200, 'mode owners');
    const before = await list(A.token, 'third');
    assert(before.status === 403 && codeOf(before) === 'DATA_INTERMEDIATION_NOT_OFFERED', `refused before: ${show(before)}`);
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Di Market ${stamp}`, type: 'cooperative', join_policy: 'approval_required', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgProvider = org.body.data.organism.id;
    const doc = { items: [{ id: 'notification', type: 'notification', legalName: 'A Markkinat Oy', businessId: '7654321-0', scope: 'A marketplace of open company data' }] };
    const byC = await call(`/v1/compliance/docs/intermediation?scope=organism&organism_id=${orgProvider}`, { token: C.token, method: 'PUT', body: doc });
    // C is no member of A's organism, so the organism is not shown to C at all: 404.
    assert(byC.status === 404, `C writes A's organism record: ${show(byC)}`);
    const byA = await call(`/v1/compliance/docs/intermediation?scope=organism&organism_id=${orgProvider}`, { token: A.token, method: 'PUT', body: doc });
    assert(byA.status === 200, `A writes it: ${show(byA)}`);
    const after = await list(A.token, 'third');
    assert(after.status === 201, `a declared provider lists: ${show(after)}`);
    const di = await nodeReport();
    assert(di.providers.some((p: Body) => p.organism_id === orgProvider && p.legal_name === 'A Markkinat Oy'), `providers: ${JSON.stringify(di.providers)}`);
});

console.log('\nD7.3, D7.6 findings');

await test('D7.6 an open organism with a data package gets the proposal to require approval, and stays open until its creator applies it', async () => {
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Di Open ${stamp}`, type: 'club', join_policy: 'open', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgOpen = org.body.data.organism.id;
    const pkg = await call('/v1/datapackages', { token: A.token, body: { name: `dipk${stamp}`, changes: 'first', visibility: `organism:${orgOpen}`, resources: [{ name: 'items', rows: [{ id: 1 }] }] } });
    assert(pkg.status === 201, `package: ${show(pkg)}`);
    const f = finding(await nodeReport(), `open_organism_with_data:${orgOpen}`);
    assert(f?.count === 1 && f.proposal?.request?.method === 'PUT' && f.proposal.request.url === `/v1/organisms/${orgOpen}`
        && f.proposal.request.body?.join_policy === 'approval_required', `finding: ${JSON.stringify(f)}`);
    assert(f.regulation.some((g: Body) => g.ref === 'art. 2(11)(c)'), 'cites the closed group');
    const still = await call(`/v1/organisms/${orgOpen}`, { token: A.token });
    assert(JSON.stringify(still.body.data).includes('"open"'), `the node changed the join policy: ${show(still)}`);
    const apply = await call(f.proposal.request.url, { token: A.token, method: 'PUT', body: f.proposal.request.body });
    assert(apply.status === 200, `apply: ${show(apply)}`);
    assert(!finding(await nodeReport(), `open_organism_with_data:${orgOpen}`), 'the finding stayed after the proposal was applied');
});

await test('D7.3 a person party with a contact is found for A (records of processing); a review makes a finding the person\'s', async () => {
    const p = await call('/v1/parties', { token: A.token, body: { name: `dip${stamp % 1000}`, kind: 'person', display_name: 'Matti', contact: 'matti@example.org' } });
    assert(p.status === 201, `party: ${show(p)}`);
    const pf = finding(await nodeReport(), `person_party_contact:${A.name}`);
    assert(pf?.count === 1 && pf.reason.includes('records of processing'), `person party: ${JSON.stringify(pf)}`);
    const cur = await call('/v1/compliance/docs/intermediation', { token: OP.token });
    const items = [...cur.body.data.items, { id: 'data_offering_public', type: 'review', decision: 'accepted', note: 'Our marketplace; notified.' }];
    const w = await call('/v1/compliance/docs/intermediation', { token: OP.token, method: 'PUT', body: { items } });
    assert(w.status === 200, `review: ${show(w)}`);
    const a = finding(await nodeReport(), 'data_offering_public');
    assert(a.source === 'human' && a.review?.decision === 'accepted' && a.review.note === 'Our marketplace; notified.', `reviewed: ${JSON.stringify(a)}`);
});

console.log('\nOwner slices');

await test('B\'s own report holds none of A\'s findings; A\'s holds A\'s own and no node record; B cannot read the node report', async () => {
    const mine = await call('/v1/compliance/report/mine', { token: B.token });
    assert(mine.status === 200, `B slice: ${show(mine)}`);
    const di = mine.body.data.data_intermediation as Body;
    assert(di && finding(di, 'data_offering_public').count === 0 && finding(di, 'contract_outside_buyer').count === 0, `B sees A's offerings or contracts: ${JSON.stringify(di?.findings)}`);
    assert(!mine.text.includes(A.name) && !mine.text.includes(firstOffering), 'B\'s slice names A or A\'s offering');
    assert(di.notification === null && !di.providers.length, 'B sees the node record or A\'s organism record');
    const a = (await call('/v1/compliance/report/mine', { token: A.token })).body.data.data_intermediation as Body;
    assert(finding(a, 'data_offering_public').items.some((i: Body) => i.offering_id === firstOffering), 'A\'s slice holds A\'s offering');
    assert(finding(a, `person_party_contact:${A.name}`), 'A\'s slice holds A\'s person party');
    assert(a.notification === null && a.providers.some((p: Body) => p.organism_id === orgProvider), `A's slice: ${JSON.stringify({ n: a.notification, p: a.providers })}`);
    const node = await call('/v1/admin/compliance/report', { token: B.token });
    assert(node.status === 403, `B reads the node report: ${show(node)}`);
});

await test('Cleanup: the mode back to report', async () => {
    assert((await setMode('report')).status === 200, 'mode report');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

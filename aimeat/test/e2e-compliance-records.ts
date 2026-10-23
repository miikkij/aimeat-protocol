/**
 * @file test/e2e-compliance-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the records of processing and the documents beside them (plan
 *   doc-mvlftkh9zmc9, C1, C2, C4, C5, C6, C7.1), over REST and the node MCP:
 *     - the catalog: the data domains, the frameworks and the label packs;
 *     - the node's documents: the operator's draft and write, a dry run, a refused invalid document;
 *     - an organism's: its creator writes, a member reads, a member's write is refused (403), a
 *       non-member reads nothing (404), the operator reads and does not write; a register with the
 *       health domain raises its workspace's classification to Highly confidential;
 *     - an app's: from its data map to a draft register, the gaps before and after, another owner
 *       gets 404;
 *     - the requests: the account export logs itself; an overdue request is a gap;
 *     - a breach not reported within 72 hours, the frameworks' verdicts, a processor outside the EEA;
 *     - the node-wide report carries `processing`, the gaps and the limits;
 *     - the MCP tools: an agent with the words reads and previews, one without them is refused, a
 *       member's agent cannot write;
 *     - an organism deleted takes its documents.
 *   The operator (the suite's first account) turns classification on for every owner and off at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-compliance-records
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const kindsOf = (b: Body): string[] => ((b?.data?.gaps ?? []) as Body[]).map(g => g.kind as string);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

console.log('\n=== Records of processing, data domains and the documents beside them (plan doc-mvlftkh9zmc9) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '', ws = '';
const APP = `cmpapp${stamp % 1000000}.html`;
let aliceMcp!: McpSession, aliceBareMcp!: McpSession, bobMcp!: McpSession;
const ORG = () => ({ scope: 'organism', organism_id: orgId });
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });

await test('Setup: the operator turns classification on; alice keeps an organism with a workspace that bob joins, and an app', async () => {
    op = await registerOwner(BASE, `cmpop${stamp}`);
    alice = await registerOwner(BASE, `cmpalice${stamp}`);
    bob = await registerOwner(BASE, `cmpbob${stamp}`);
    carol = await registerOwner(BASE, `cmpcarol${stamp}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Cmp Records ${stamp}`, type: 'project', join_policy: 'open' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const j = await call('POST', `/v1/organisms/${orgId}/join`, bob.token, {});
    assert(j.status === 201, `bob joins: ${j.status} ${JSON.stringify(j.body?.error)}`);
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, {
        name: 'Patients', manifest: { manifestVersion: '1', name: 'Patients', kind: 'project', objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' }] },
    });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="aimeat-scopes" content="memory:read memory:write"><title>CRM</title></head><body>CRM</body></html>';
    const p = await call('POST', '/v1/apps', alice.token, { filename: APP, content: Buffer.from(html).toString('base64'), mime_type: 'text/html', name: 'CRM', description: 'E2E' });
    assert(p.status === 201, `publish: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const agent = await makeAgent(BASE, alice, ['compliance:read', 'compliance:write'], `cmpa${stamp % 100000}`);
    aliceMcp = await openSession(BASE, agent.token, 'compliance records');
    const bare = await makeAgent(BASE, alice, ['*'], `cmpb${stamp % 100000}`);
    aliceBareMcp = await openSession(BASE, bare.token, 'compliance records, no words');
    const bobAgent = await makeAgent(BASE, bob, ['compliance:read', 'compliance:write'], `cmpc${stamp % 100000}`);
    bobMcp = await openSession(BASE, bobAgent.token, 'compliance records, a member');
    const r = await call('GET', '/v1/compliance/catalog', bare.token);
    assert(r.status === 403, `DENIAL: an agent without compliance:read reads no catalog: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

// ─── The catalog ───
await test('CATALOG: the data domains, the frameworks with their questions, and the label packs', async () => {
    const r = await call('GET', '/v1/compliance/catalog', alice.token);
    assert(r.status === 200, `catalog: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const domains = (r.body.data.domains as Body[]).map(d => d.id);
    for (const d of ['health', 'defence-classified', 'export-controlled', 'children']) assert(domains.includes(d), `domain ${d}: ${domains}`);
    const fw = (r.body.data.frameworks as Body[]).map(f => f.id);
    for (const f of ['gdpr', 'nis2', 'dora', 'cra', 'eaa', 'dsa', 'hipaa', 'export-control']) assert(fw.includes(f), `framework ${f}: ${fw}`);
    assert((r.body.data.packs as Body[]).map(p => p.id).join() === 'tl,nato', `packs: ${JSON.stringify(r.body.data.packs)}`);
});

// ─── The node's documents ───
await test('NODE: the operator\'s draft names the node\'s own registers; a person who is not the operator reads none (403)', async () => {
    const d = await call('GET', '/v1/compliance/draft', op.token);
    assert(d.status === 200 && (d.body.data.items as Body[]).some(i => i.id === 'node-accounts'), `draft: ${d.status} ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
    const w = await call('PUT', '/v1/compliance/docs/registers', op.token, { items: d.body.data.items });
    assert(w.status === 200 && w.body.data.stored === true && w.body.data.items.length === 4, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const denied = await call('GET', '/v1/compliance/docs/registers', alice.token);
    assert(denied.status === 403 && denied.body.error.code === 'NOT_ALLOWED', `alice, the node's: ${denied.status} ${JSON.stringify(denied.body?.error)}`);
    const draftDenied = await call('GET', '/v1/compliance/draft', alice.token);
    assert(draftDenied.status === 403, `alice, the node's draft: ${draftDenied.status}`);
});

await test('NODE: a duplicate id is refused (400) and a dry run stores nothing', async () => {
    const dup = await call('PUT', '/v1/compliance/docs/registers', op.token, { items: [{ id: 'x', title: 'A', type: 'none' }, { id: 'x', title: 'B', type: 'none' }] });
    assert(dup.status === 400 && dup.body.error.code === 'VALIDATION_ERROR', `duplicate: ${dup.status} ${JSON.stringify(dup.body?.error)}`);
    const dry = await call('PUT', '/v1/compliance/docs/registers?dry_run=true', op.token, { items: [{ id: 'only', title: 'Only', type: 'none' }] });
    assert(dry.status === 200 && dry.body.data.stored === false, `dry run: ${dry.status} ${JSON.stringify(dry.body?.data ?? dry.body?.error)}`);
    const after = await call('GET', '/v1/compliance/docs/registers', op.token);
    assert(after.body.data.items.length === 4, `POSITIVE CONTROL, still four: ${after.body.data.items.length}`);
});

// ─── An organism's documents, and a data domain raising a workspace ───
await test('ORGANISM: the creator writes a health register; its workspace rises to Highly confidential', async () => {
    const w = await call('PUT', `/v1/compliance/docs/registers?${q(ORG())}`, alice.token, {
        items: [{ id: 'patients', title: 'Patients', type: 'personal', purpose: 'patient', legalBasis: ['contract'], domains: ['health'], containers: [{ kind: 'workspace', organism_id: orgId, ws }], retentionMonths: 120 }],
    });
    assert(w.status === 200 && w.body.data.stored === true, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const floor = (w.body.data.floors as Body[])[0];
    assert(floor?.floor === 'erittain-luottamuksellinen' && floor.outcome === 'raised', `floors: ${JSON.stringify(w.body.data.floors)}`);
    const label = await call('GET', `/v1/classification/label?${q({ kind: 'workspace', organism_id: orgId, ws })}`, alice.token);
    assert(label.status === 200 && label.body.data.label === 'erittain-luottamuksellinen' && label.body.data.source === 'rule', `the workspace: ${JSON.stringify(label.body?.data ?? label.body?.error)}`);
});

await test('ORGANISM: a member reads, a member\'s write is refused (403), a non-member gets 404, the operator reads and does not write', async () => {
    const read = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, bob.token);
    assert(read.status === 200 && read.body.data.items.length === 1, `bob reads: ${read.status} ${JSON.stringify(read.body?.error)}`);
    const write = await call('PUT', `/v1/compliance/docs/registers?${q(ORG())}`, bob.token, { items: [] });
    assert(write.status === 403 && write.body.error.code === 'NOT_ALLOWED', `bob writes: ${write.status} ${JSON.stringify(write.body?.error)}`);
    const outsider = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, carol.token);
    assert(outsider.status === 404, `carol: ${outsider.status} ${JSON.stringify(outsider.body?.error)}`);
    const outsiderGaps = await call('GET', `/v1/compliance/gaps?${q(ORG())}`, carol.token);
    assert(outsiderGaps.status === 404, `carol, the gaps: ${outsiderGaps.status}`);
    const nodeGaps = await call('GET', '/v1/compliance/gaps', bob.token);
    assert(nodeGaps.status === 403, `bob, the node's gaps: ${nodeGaps.status}`);
    const opRead = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, op.token);
    assert(opRead.status === 200, `the operator reads: ${opRead.status}`);
    const opWrite = await call('PUT', `/v1/compliance/docs/registers?${q(ORG())}`, op.token, { items: [] });
    assert(opWrite.status === 403, `the operator writes: ${opWrite.status}`);
    const after = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, alice.token);
    assert(after.body.data.items.length === 1, `POSITIVE CONTROL, nothing was erased: ${after.body.data.items.length}`);
});

await test('ORGANISM GAPS: a health register needs its art. 9 ground and an impact assessment; writing one closes the missing gap', async () => {
    const g = await call('GET', `/v1/compliance/gaps?${q(ORG())}`, alice.token);
    assert(g.status === 200, `gaps: ${g.status} ${JSON.stringify(g.body?.error)}`);
    const kinds = kindsOf(g.body);
    for (const k of ['dpia-missing', 'register-without-special-basis', 'register-review-overdue', 'framework-unanswered']) assert(kinds.includes(k), `${k} in ${kinds}`);
    const d = await call('PUT', `/v1/compliance/docs/dpias?${q(ORG())}`, alice.token, { items: [{ id: 'dpia-patients', registerId: 'patients', residualRisk: 'medium' }] });
    assert(d.status === 200, `dpia: ${d.status} ${JSON.stringify(d.body?.error)}`);
    const after = kindsOf((await call('GET', `/v1/compliance/gaps?${q(ORG())}`, alice.token)).body);
    assert(!after.includes('dpia-missing') && after.includes('dpia-incomplete'), `after: ${after}`);
});

// ─── An app's documents ───
await test('APP: the data map says personal data, the draft makes a register of it, and the gaps follow; another owner gets 404', async () => {
    const map = {
        spec: 'aimeat.datamap/2', what: 'A customer list.', usedFor: 'Keeping in touch with customers.', form: 'one-person',
        arrangement: 'One record in the owner\'s memory.', machinery: [], leaves: [], elsewhere: [],
        held: [{ what: 'crm.customers', holds: 'names and e-mail addresses', kind: 'register', usedFor: 'user-returns-to-read', where: 'owner-memory-private', owner: 'person', readers: 'owner-only', writers: ['person-in-the-ui'], shape: 'collection-under-one-key', keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'yes', why: 'The owner keeps their own customers.' }],
    };
    const m = await call('PUT', `/v1/datamap/apps/${alice.name}/${APP}`, alice.token, map);
    assert(m.status === 200, `data map: ${m.status} ${JSON.stringify(m.body?.error)}`);
    const app = { scope: 'app', app: APP };
    const before = kindsOf((await call('GET', `/v1/compliance/gaps?${q(app)}`, alice.token)).body);
    assert(before.includes('app-personal-data-without-register'), `before: ${before}`);
    const d = await call('GET', `/v1/compliance/draft?${q(app)}`, alice.token);
    assert(d.status === 200 && d.body.data.items[0]?.type === 'personal', `draft: ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
    const w = await call('PUT', `/v1/compliance/docs/registers?${q(app)}`, alice.token, { items: d.body.data.items });
    assert(w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const after = kindsOf((await call('GET', `/v1/compliance/gaps?${q(app)}`, alice.token)).body);
    assert(!after.includes('app-personal-data-without-register') && after.includes('app-register-without-privacy-notice'), `after: ${after}`);
    const other = await call('GET', `/v1/compliance/docs/registers?${q({ ...app, app_owner: alice.name })}`, bob.token);
    assert(other.status === 404, `bob, alice's app: ${other.status} ${JSON.stringify(other.body?.error)}`);
    const opRead = await call('GET', `/v1/compliance/docs/registers?${q({ ...app, app_owner: alice.name })}`, op.token);
    assert(opRead.status === 200 && opRead.body.data.items.length === 1, `the operator reads it: ${opRead.status}`);
});

// ─── Requests, breaches, frameworks, processors ───
await test('REQUESTS: the account export logs itself as an answered request; an open request past its month is a gap', async () => {
    const e = await call('GET', `/v1/owners/${alice.name}/export`, alice.token);
    assert(e.status === 200, `export: ${e.status}`);
    let found: Body | undefined;
    for (let i = 0; i < 10 && !found; i++) {
        const r = await call('GET', '/v1/compliance/docs/requests', op.token);
        found = (r.body?.data?.items as Body[] | undefined)?.find(x => x.subject === alice.name && x.auto === true);
        if (!found) await sleep(200);
    }
    assert(found?.kind === 'portability' && found.status === 'done', `logged: ${JSON.stringify(found)}`);
    const items = [...(await call('GET', '/v1/compliance/docs/requests', op.token)).body.data.items,
        { id: 'late', kind: 'access', subject: 'a letter', receivedAt: daysAgo(60), status: 'open', channel: 'letter' }];
    const w = await call('PUT', '/v1/compliance/docs/requests', op.token, { items });
    assert(w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    assert(kindsOf((await call('GET', '/v1/compliance/gaps', op.token)).body).includes('request-overdue'), 'request-overdue');
});

await test('BREACH: one found five days ago and not reported is a gap until the authority is told', async () => {
    const breach = { id: 'laptop', title: 'Lost laptop', discoveredAt: daysAgo(5), riskToPeople: 'risk', status: 'open' };
    await call('PUT', '/v1/compliance/docs/breaches', op.token, { items: [breach] });
    assert(kindsOf((await call('GET', '/v1/compliance/gaps', op.token)).body).includes('breach-notification-overdue'), 'overdue');
    await call('PUT', '/v1/compliance/docs/breaches', op.token, { items: [{ ...breach, authorityNotifiedAt: daysAgo(4) }] });
    assert(!kindsOf((await call('GET', '/v1/compliance/gaps', op.token)).body).includes('breach-notification-overdue'), 'reported');
});

await test('FRAMEWORKS: GDPR answered gives "applies" with obligations; NIS2 unanswered is a gap, not a "no"', async () => {
    const w = await call('PUT', '/v1/compliance/docs/frameworks', op.token, {
        answers: { gdpr: { 'q-personal-data': true, 'q-public-authority': false, 'q-large-scale-monitoring': false, 'q-large-scale-special': false } },
        answerSources: { gdpr: { 'q-personal-data': 'human' } },
    });
    assert(w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const r = await call('GET', '/v1/compliance/docs/frameworks', op.token);
    const v = (r.body.data.verdicts as Body[]);
    const gdpr = v.find(x => x.id === 'gdpr');
    assert(gdpr?.verdict.class === 'applies' && gdpr.obligations.length > 0, `gdpr: ${JSON.stringify(gdpr)}`);
    assert(v.find(x => x.id === 'nis2')?.verdict.class === 'unclassified', 'nis2 unclassified');
    const gaps = (await call('GET', '/v1/compliance/gaps', op.token)).body.data.gaps as Body[];
    assert(gaps.some(g => g.kind === 'framework-unanswered' && g.evidence?.framework === 'nis2'), 'nis2 gap');
    assert(!gaps.some(g => g.kind === 'framework-unanswered' && g.evidence?.framework === 'gdpr'), 'no gdpr gap');
});

await test('PROCESSORS: one outside the EEA with no basis and no agreement is two gaps, and a transfer', async () => {
    const w = await call('PUT', '/v1/compliance/docs/processors', op.token, { items: [{ id: 'us-analytics', name: 'US analytics', service: 'analytics', country: 'United States' }] });
    assert(w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const r = await call('GET', '/v1/compliance/docs/processors', op.token);
    assert((r.body.data.transfers as Body[]).some(t => t.processor === 'us-analytics'), `transfers: ${JSON.stringify(r.body.data.transfers)}`);
    const gaps = (await call('GET', '/v1/compliance/gaps', op.token)).body.data.gaps as Body[];
    for (const k of ['transfer-without-basis', 'processor-without-dpa']) assert(gaps.some(g => g.kind === k && g.evidence?.processor === 'us-analytics'), k);
    const scoped = await call('PUT', `/v1/compliance/docs/processors?${q(ORG())}`, alice.token, { items: [] });
    assert(scoped.status === 400, `an organism keeps no processors: ${scoped.status}`);
});

await test('REPORT: the node-wide report carries processing, the gaps of every scope and the limits', async () => {
    const r = await call('GET', '/v1/admin/compliance/report', op.token);
    assert(r.status === 200, `report: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const p = r.body.data.processing;
    assert(p?.registers?.by_scope?.organism >= 1 && p.registers.by_scope.app >= 1 && p.domains.health >= 1, `processing: ${JSON.stringify(p?.registers)}`);
    const kinds = (r.body.data.gaps as Body[]).map(g => g.kind);
    assert(kinds.includes('dpia-incomplete') && kinds.includes('transfer-without-basis'), `gaps: ${kinds}`);
    assert((r.body.data.not_covered as Body[]).some(l => l.code === 'registers-are-statements'), 'limits');
});

// ─── The MCP tools ───
await test('MCP: an agent with the words reads the organism\'s registers and previews a write; one without them is refused', async () => {
    const r = await callTool(aliceMcp, 'aimeat_compliance_register_read', { part: 'registers', scope: 'organism', organism_id: orgId });
    assert(!r.isError && r.data?.items?.length === 1, `read: ${r.text.slice(0, 300)}`);
    const dry = await callTool(aliceMcp, 'aimeat_compliance_register_write', { part: 'registers', scope: 'organism', organism_id: orgId, value: { items: [] }, dry_run: true });
    assert(!dry.isError && dry.data?.stored === false, `dry run: ${dry.text.slice(0, 300)}`);
    const still = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, alice.token);
    assert(still.body.data.items.length === 1, 'POSITIVE CONTROL, the dry run stored nothing');
    const bare = await callTool(aliceBareMcp, 'aimeat_compliance_register_read', { part: 'catalog' });
    assert(bare.isError, `without compliance:read: ${bare.text.slice(0, 200)}`);
    const member = await callTool(bobMcp, 'aimeat_compliance_register_write', { part: 'registers', scope: 'organism', organism_id: orgId, value: { items: [] } });
    assert(member.isError && member.text.startsWith('NOT_ALLOWED'), `a member's agent: ${member.text.slice(0, 200)}`);
});

// ─── An organism deleted ───
await test('DELETE: an organism deleted takes its documents', async () => {
    const d = await call('DELETE', `/v1/organisms/${orgId}`, alice.token);
    assert(d.status === 200, `delete: ${d.status} ${JSON.stringify(d.body?.error)}`);
    const r = await call('GET', '/v1/admin/compliance/report', op.token);
    assert(r.body.data.processing.registers.by_scope.organism === 0, `organism registers left: ${JSON.stringify(r.body.data.processing.registers)}`);
});

await setSwitch('off');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

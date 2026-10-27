/**
 * @file test/e2e-compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for data processing agreements (plan doc-mvmr4i2wdk0p, D1–D4), over REST and the
 *   node MCP:
 *     - a draft from the node's own data: dry run stores nothing, the clauses are the Commission's text
 *       word for word, Annex I names the operator, Annex IV follows the product;
 *     - who: the counterparty reads its own and cannot edit or decide, another owner gets 404 and the
 *       list refuses them (403);
 *     - send: the text, hash and PDF are fixed, an AIMEAT signing request is made, the counterparty's
 *       bell says so, the version no longer changes;
 *     - both parties sign in the signing app (session) and the version is in force; the counterparty
 *       is told;
 *     - a change: a new version, an Annex IV change announced, the counterparty objects;
 *     - a copy that came back: an unsigned PDF is checked and fails, a rejection needs a reason, a scan
 *       is accepted by the operator and the agreement comes into force with the operator's signature;
 *     - end, the deletion clock and its confirmation; a breach notice; the gaps;
 *     - the MCP tool: an agent with the words lists and reads the text, one without them is refused.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-compliance-agreements
 * @version-history
 *   2026-10-27 — The next holder of an erased counterparty name reads nothing and the operator keeps
 *     the agreement; a draft's new counterparty account is checked as on create (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p).
 */
import { createHash } from 'node:crypto';
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
async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body; raw: Buffer; type: string }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(90_000),
    });
    const raw = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? JSON.parse(raw.toString()) as Body : {}, raw, type };
}
const A = '/v1/compliance/agreements';

console.log('\n=== Data processing agreements (plan doc-mvmr4i2wdk0p) ===\n');

let op!: RegisteredOwner, cust!: RegisteredOwner, other!: RegisteredOwner;
let id = '', paperId = '';
let opMcp!: McpSession, bareMcp!: McpSession;

const counterparty = () => ({
    name: `Asiakas ${stamp} Oy`, type: 'company', businessId: '1234567-8', address: 'Katu 1, 00100 Helsinki', country: 'Finland',
    contactName: 'Kaisa Asiakas', contactRole: 'CEO', contactEmail: `kaisa${stamp}@example.invalid`, signerName: 'Kaisa Asiakas', signerRole: 'CEO',
    account: cust.ghii,
});

await test('Setup: the operator, a customer with an account, and another owner', async () => {
    op = await registerOwner(BASE, `dpaop${stamp}`);
    cust = await registerOwner(BASE, `dpacust${stamp}`);
    other = await registerOwner(BASE, `dpaother${stamp}`);
    assert(cust.ghii.includes('@'), `the customer's account: ${cust.ghii}`);
    const agent = await makeAgent(BASE, op, ['compliance:read', 'compliance:write'], `dpaa${stamp % 100000}`);
    opMcp = await openSession(BASE, agent.token, 'agreements');
    const bare = await makeAgent(BASE, op, ['*'], `dpab${stamp % 100000}`);
    bareMcp = await openSession(BASE, bare.token, 'agreements, no words');
});

await test('A dry run shows the generated agreement and stores nothing', async () => {
    const r = await call('POST', `${A}?dry_run=true`, op.token, { counterparty: counterparty(), product: 'place', language: 'fi' });
    assert(r.status === 200, `dry run: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const a = r.body.data.would_store;
    assert(r.body.data.stored === false && /^dpa-/.test(a.id), 'nothing stored, an id drafted');
    assert(a.versions[0].annexes.I.controller.name === counterparty().name, 'Annex I controller is the counterparty');
    assert(a.versions[0].sources['I.processor'] === 'evidence', 'the operator side is read from the node');
    assert(a.versions[0].annexes.III.measures.some((m: Body) => m.area === 'identification' && /scrypt/.test(m.text)), 'Annex III reads the node: passwords are scrypt hashes');
    assert(Array.isArray(r.body.data.missing_measures) && r.body.data.missing_measures.includes('physical'), 'the areas the node cannot see are named');
    const list = await call('GET', A, op.token);
    assert(list.status === 200 && list.body.data.total === 0, `nothing stored: ${JSON.stringify(list.body.data)}`);
});

await test('The operator makes an agreement; the counterparty reads its own; another owner gets 404 and the list refuses them', async () => {
    const r = await call('POST', A, op.token, { counterparty: counterparty(), product: 'place', language: 'fi', externalRef: `order-${stamp}` });
    assert(r.status === 200 && r.body.data.stored === true, `create: ${r.status} ${JSON.stringify(r.body?.error)}`);
    id = r.body.data.id;
    assert(r.body.data.status === 'draft', `status draft: ${r.body.data.status}`);
    const mine = await call('GET', `${A}/mine`, cust.token);
    assert(mine.status === 200 && mine.body.data.items.some((i: Body) => i.id === id), `the counterparty lists it: ${JSON.stringify(mine.body)}`);
    const seen = await call('GET', `${A}/${id}`, cust.token);
    assert(seen.status === 200 && seen.body.data.viewer === 'counterparty', `the counterparty reads it: ${seen.status}`);
    const stranger = await call('GET', `${A}/${id}`, other.token);
    assert(stranger.status === 404, `another owner: ${stranger.status}`);
    const strangerList = await call('GET', A, other.token);
    assert(strangerList.status === 403, `another owner's list: ${strangerList.status}`);
    const edit = await call('PATCH', `${A}/${id}`, cust.token, { subject: 'mine now' });
    assert(edit.status === 403, `the counterparty cannot edit: ${edit.status}`);
});

await test('The operator edits the draft: the notice period and a measure the node cannot see, marked as written by a person', async () => {
    const r = await call('PATCH', `${A}/${id}`, op.token, {
        options: { noticeDays: 14 },
        annexes: { III: { measures: [{ area: 'physical', text: 'Palvelimet ovat Scalewayn konesaleissa Ranskassa.', source: 'human' }] } },
    });
    assert(r.status === 200, `patch: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const v = r.body.data.versions[0];
    assert(v.options.noticeDays === 14 && v.options.breachNoticeHours === 24, 'the options merged');
    // A change of one part leaves the rest as it was: the product and language stay (a partial schema with defaults reset them).
    assert(r.body.data.product === 'place' && r.body.data.language === 'fi', `product and language kept: ${r.body.data.product} ${r.body.data.language}`);
    assert(v.annexes.II.nature.includes('Hostattu'), `the place's Annex II kept: ${v.annexes.II.nature}`);
    assert(v.sources['III.physical'] === 'human', 'the written measure is marked human');
});

await test('The canonical text carries the Commission\'s clauses word for word and the choices beside them', async () => {
    const r = await call('GET', `${A}/${id}/document?format=text`, op.token);
    assert(r.status === 200 && r.type.includes('markdown'), `text: ${r.status} ${r.type}`);
    const text = r.raw.toString();
    assert(text.includes('Näiden vakiosopimuslausekkeiden'), 'the Finnish clause text is there');
    assert(text.includes('Lauseke 7.7 a: vaihtoehto 2, yleinen kirjallinen lupa. Määritetty ajanjakso on 14 päivää.'), 'the Clause 7.7 choice is printed beside the clauses');
    assert(text.includes('viimeistään 24 tunnin kuluttua'), 'the breach hours are an additional commitment');
    assert(text.includes('LIITE IV'), 'Annex IV heading');
});

await test('Sending fixes the version, makes a signing request and tells the counterparty; the version no longer changes', async () => {
    const r = await call('POST', `${A}/${id}/send`, op.token, { message: 'Allekirjoitathan' });
    assert(r.status === 200, `send: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const v = r.body.data.versions[0];
    assert(v.status === 'sent' && /^[0-9a-f]{64}$/.test(v.textHash) && v.pdfKey && /^ds-/.test(v.docsignId), `fixed: ${JSON.stringify({ s: v.status, h: v.textHash, p: v.pdfKey, d: v.docsignId })}`);
    assert(r.body.data.told.counterpartyBell === true, `the counterparty's bell: ${JSON.stringify(r.body.data.told)}`);
    const n = await call('GET', '/v1/notifications', cust.token);
    assert((n.body.data.notifications as Body[]).some(x => x.type === 'agreement_sent'), 'the counterparty has the notice');
    const late = await call('PATCH', `${A}/${id}`, op.token, { subject: 'changed' });
    assert(late.status === 409 && late.body.error.code === 'NOT_A_DRAFT', `a sent version does not change: ${late.status}`);
    const pdf = await call('GET', `${A}/${id}/document`, cust.token);
    assert(pdf.status === 200 && pdf.raw.subarray(0, 5).toString() === '%PDF-', `the counterparty downloads the PDF: ${pdf.status}`);
});

await test('Both parties sign in the AIMEAT signing app and the version is in force', async () => {
    const a = (await call('GET', `${A}/${id}`, op.token)).body.data;
    const ds = a.versions[0].docsignId;
    const s1 = await call('POST', `/v1/docsign/requests/${ds}/sign`, cust.token, { method: 'session' });
    assert(s1.status === 200, `customer signs: ${s1.status} ${JSON.stringify(s1.body?.error)}`);
    const mid = (await call('GET', `${A}/${id}`, op.token)).body.data;
    assert(mid.versions[0].signatures.length === 1 && mid.versions[0].signatures[0].party === 'controller', `one signature: ${JSON.stringify(mid.versions[0].signatures)}`);
    assert(mid.status === 'sent', `still waiting: ${mid.status}`);
    const s2 = await call('POST', `/v1/docsign/requests/${ds}/sign`, op.token, { method: 'session' });
    assert(s2.status === 200, `operator signs: ${s2.status} ${JSON.stringify(s2.body?.error)}`);
    const done = (await call('GET', `${A}/${id}`, cust.token)).body.data;
    assert(done.status === 'signed' && done.versions[0].status === 'signed' && done.versions[0].effectiveFrom, `in force: ${done.status}`);
    assert(done.versions[0].signatures.every((s: Body) => s.level === 'aimeat'), 'AIMEAT signatures');
    const n = await call('GET', '/v1/notifications', cust.token);
    assert((n.body.data.notifications as Body[]).some(x => x.type === 'agreement_in_force'), 'the counterparty is told it is in force');
});

await test('A change: a new version with a sub-processor added is announced, and the counterparty objects', async () => {
    const same = await call('POST', `${A}/${id}/versions`, op.token);
    assert(same.status === 200 && same.body.data.versions.length === 2, `new version: ${same.status} ${JSON.stringify(same.body?.error)}`);
    const nothing = await call('POST', `${A}/${id}/notice`, op.token);
    assert(nothing.status === 409 && nothing.body.error.code === 'NOTHING_CHANGED', `an unchanged draft is not announced: ${nothing.status} ${nothing.body?.error?.code}`);
    const subs = same.body.data.versions[1].annexes.IV.subprocessors;
    const p = await call('PATCH', `${A}/${id}`, op.token, { annexes: { IV: { subprocessors: [...subs, { name: 'Hetzner Online GmbH', country: 'Germany', description: 'palvelimet' }] } } });
    assert(p.status === 200, `patch IV: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const sig = await call('PATCH', `${A}/${id}`, op.token, { options: { breachNoticeHours: 48 } });
    assert(sig.status === 200, 'options changed too');
    const refused = await call('POST', `${A}/${id}/notice`, op.token);
    assert(refused.status === 409 && refused.body.error.code === 'NEEDS_SIGNATURE', `an options change is signed, not announced: ${refused.body?.error?.code}`);
    await call('PATCH', `${A}/${id}`, op.token, { options: { breachNoticeHours: 24 } });
    const notice = await call('POST', `${A}/${id}/notice`, op.token);
    assert(notice.status === 200 && notice.body.data.versions[1].notice?.objectionUntil, `announced: ${notice.status} ${JSON.stringify(notice.body?.error)}`);
    assert(notice.body.data.status === 'signed', 'version 1 stays in force during the period');
    const obj = await call('POST', `${A}/${id}/object`, cust.token, { reason: 'Emme hyväksy Saksaa.' });
    assert(obj.status === 200 && obj.body.data.versions[1].notice.objectedAt, `objected: ${obj.status} ${JSON.stringify(obj.body?.error)}`);
    const opObj = await call('POST', `${A}/${id}/object`, op.token, { reason: 'x' });
    assert(opObj.status === 403, `the operator does not object: ${opObj.status}`);
    const gaps = await call('GET', `${A}/gaps`, op.token);
    assert((gaps.body.data.gaps as Body[]).some(g => g.kind === 'agreement-objection-open' && g.agreement === id), `the objection is a gap: ${JSON.stringify(gaps.body.data.gaps)}`);
});

await test('A copy that came back: an unsigned PDF fails its check, a rejection needs a reason', async () => {
    const r = await call('POST', A, op.token, { counterparty: { name: `Paperi ${stamp} Oy`, contactEmail: `paperi${stamp}@example.invalid`, signerName: 'Pekka Paperi' }, product: 'box', language: 'en' });
    assert(r.status === 200, `create: ${r.status} ${JSON.stringify(r.body?.error)}`);
    paperId = r.body.data.id;
    assert(r.body.data.versions[0].annexes.IV.subprocessors.length === 0, 'a box has no sub-processor of ours');
    const s = await call('POST', `${A}/${paperId}/send`, op.token);
    assert(s.status === 200, `send: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const pdf = await call('GET', `${A}/${paperId}/document`, op.token);
    const up = await call('POST', '/v1/storage', op.token, { key: `dpa/${stamp}/returned.pdf`, data: pdf.raw.toString('base64'), mime_type: 'application/pdf', visibility: 'private' });
    assert(up.status === 201, `upload: ${up.status} ${JSON.stringify(up.body?.error)}`);
    const copy = await call('POST', `${A}/${paperId}/signed-copy`, op.token, { storage_key: `dpa/${stamp}/returned.pdf`, kind: 'pdf' });
    assert(copy.status === 200 && copy.body.data.review.verdict === 'fail', `an unsigned PDF fails: ${copy.status} ${JSON.stringify(copy.body?.data?.review ?? copy.body?.error)}`);
    assert(copy.body.data.review.checks.find((c: Body) => c.id === 'version')?.ok === true, 'the copy is tied to the version (its own bytes)');
    const bare = await call('POST', `${A}/${paperId}/confirm`, op.token, { accept: false });
    assert(bare.status === 400, `a rejection without a reason: ${bare.status}`);
    const rej = await call('POST', `${A}/${paperId}/confirm`, op.token, { accept: false, reason: 'The PDF carries no signature.' });
    assert(rej.status === 200 && rej.body.data.status === 'sent', `rejected, waiting again: ${rej.status} ${JSON.stringify(rej.body?.error)}`);
});

await test('A scan is accepted by the operator, and with the operator\'s AIMEAT signature the agreement is in force', async () => {
    // A tiny PNG stands in for the scan; with no AI provider on the test node the model check does not run, and says so.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await call('POST', '/v1/storage', op.token, { key: `dpa/${stamp}/scan.png`, data: png.toString('base64'), mime_type: 'image/png', visibility: 'private' });
    assert(up.status === 201, `upload: ${up.status}`);
    const copy = await call('POST', `${A}/${paperId}/signed-copy`, op.token, { storage_key: `dpa/${stamp}/scan.png`, kind: 'scan' });
    assert(copy.status === 200 && copy.body.data.status === 'review', `review: ${copy.status} ${JSON.stringify(copy.body?.error)}`);
    assert(copy.body.data.review.verdict !== 'pass', `a check that did not run never passes: ${copy.body.data.review.verdict}`);
    const custTry = await call('POST', `${A}/${paperId}/confirm`, cust.token, { accept: true });
    // The counterparty is not the operator: the operator rule refuses it (403), it is not told "no such agreement".
    assert(custTry.status === 403, `nobody else decides: ${custTry.status}`);
    const ok = await call('POST', `${A}/${paperId}/confirm`, op.token, { accept: true });
    assert(ok.status === 200 && ok.body.data.accepted === true && ok.body.data.status === 'sent', `accepted, the operator still signs: ${ok.status} ${JSON.stringify(ok.body)}`);
    const a = (await call('GET', `${A}/${paperId}`, op.token)).body.data;
    assert(a.versions[0].signatures.some((s: Body) => s.party === 'controller' && s.level === 'scanned' && s.method === 'scan'), 'the scan is the controller\'s signature, level scanned');
    const s = await call('POST', `/v1/docsign/requests/${a.versions[0].docsignId}/sign`, op.token, { method: 'session' });
    assert(s.status === 200, `operator signs: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const done = (await call('GET', `${A}/${paperId}`, op.token)).body.data;
    assert(done.status === 'signed', `in force: ${done.status}`);
});

await test('A breach notice reaches the counterparty; ending starts the deletion clock and its confirmation is recorded', async () => {
    const b = await call('POST', `${A}/breach-notice`, op.token, { agreements: [id], title: 'Lokit näkyivät väärälle tilille', discovered_at: new Date().toISOString(), summary: 'Yksi lokitiedosto oli luettavissa 2 tuntia.' });
    assert(b.status === 200 && b.body.data.results[0].sent === true && b.body.data.results[0].late === false, `breach: ${b.status} ${JSON.stringify(b.body)}`);
    const n = await call('GET', '/v1/notifications', cust.token);
    assert((n.body.data.notifications as Body[]).some(x => x.type === 'agreement_breach'), 'the counterparty is told of the breach');
    const e = await call('POST', `${A}/${paperId}/end`, op.token, { choice: 'delete', reason: 'contract ended' });
    assert(e.status === 200 && e.body.data.status === 'ended' && e.body.data.deletion.dueAt, `ended: ${e.status} ${JSON.stringify(e.body?.error)}`);
    const d = await call('POST', `${A}/${paperId}/deletion-done`, op.token, { note: 'Volume wiped.' });
    assert(d.status === 200 && d.body.data.deletion.doneAt, `deletion recorded: ${d.status}`);
});

await test('Every route refuses an agent without the compliance words (403), and the operator\'s routes refuse another owner (403)', async () => {
    const noWords = await makeAgent(BASE, op, ['memory:read', 'storage:read'], `dpan${stamp % 100000}`);
    const t = noWords.token;
    assert((await call('GET', '/v1/compliance/agreements', t)).status === 403, 'list');
    assert((await call('POST', '/v1/compliance/agreements', t, { counterparty: { name: 'X' } })).status === 403, 'create');
    assert((await call('GET', '/v1/compliance/agreements/mine', t)).status === 403, 'mine');
    assert((await call('GET', '/v1/compliance/agreements/gaps', t)).status === 403, 'gaps');
    assert((await call('POST', '/v1/compliance/agreements/breach-notice', t, {})).status === 403, 'breach notice');
    assert((await call('GET', `/v1/compliance/agreements/${id}`, t)).status === 403, 'get');
    assert((await call('PATCH', `/v1/compliance/agreements/${id}`, t, {})).status === 403, 'patch');
    assert((await call('POST', `/v1/compliance/agreements/${id}/versions`, t)).status === 403, 'versions');
    assert((await call('POST', `/v1/compliance/agreements/${id}/send`, t)).status === 403, 'send');
    assert((await call('POST', `/v1/compliance/agreements/${id}/notice`, t)).status === 403, 'notice');
    assert((await call('POST', `/v1/compliance/agreements/${id}/object`, t, { reason: 'x' })).status === 403, 'object');
    assert((await call('POST', `/v1/compliance/agreements/${id}/signed-copy`, t, { storage_key: 'x', kind: 'pdf' })).status === 403, 'signed copy');
    assert((await call('POST', `/v1/compliance/agreements/${id}/confirm`, t, { accept: true })).status === 403, 'confirm');
    assert((await call('POST', `/v1/compliance/agreements/${id}/end`, t)).status === 403, 'end');
    assert((await call('POST', `/v1/compliance/agreements/${id}/deletion-done`, t)).status === 403, 'deletion done');
    assert((await call('GET', `/v1/compliance/agreements/${id}/document`, t)).status === 403, 'document');
    // Another owner in person passes the word check and is refused by the operator rule.
    const o = other.token;
    assert((await call('POST', '/v1/compliance/agreements', o, { counterparty: { name: 'X' } })).status === 403, 'another owner creates');
    assert((await call('GET', '/v1/compliance/agreements/gaps', o)).status === 403, 'another owner reads the gaps');
    assert((await call('POST', `/v1/compliance/agreements/${id}/versions`, o)).status === 403, 'another owner drafts a version');
    assert((await call('POST', `/v1/compliance/agreements/${id}/end`, o)).status === 403, 'another owner ends it');
    assert((await call('POST', '/v1/compliance/agreements/breach-notice', o, { agreements: [id], title: 't', discovered_at: new Date().toISOString(), summary: 's' })).status === 403, 'another owner sends a breach notice');
});

await test('The MCP tool: an agent with the words lists and reads the canonical text; one without them is refused', async () => {
    const list = await callTool(opMcp, 'aimeat_compliance_agreement', { action: 'list' });
    assert(!list.isError && list.data.total >= 2, `list: ${list.text.slice(0, 200)}`);
    const doc = await callTool(opMcp, 'aimeat_compliance_agreement', { action: 'document', id, version: 1 });
    assert(!doc.isError && String(doc.data.text).includes('LIITE I'), `document: ${doc.text.slice(0, 200)}`);
    const refused = await callTool(bareMcp, 'aimeat_compliance_agreement', { action: 'list' });
    assert(refused.isError, `no words, no list: ${refused.text.slice(0, 200)}`);
});

await test('Erasure: the next holder of an erased counterparty name reads nothing; the operator keeps the agreement (secaudit2026oct26)', async () => {
    const gone = await registerOwner(BASE, `dpagone${stamp}`);
    const r = await call('POST', A, op.token, { counterparty: { ...counterparty(), name: `Poistuva ${stamp} Oy`, account: gone.ghii }, product: 'place', language: 'fi' });
    assert(r.status === 200, `create: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const goneId = r.body.data.id as string;
    // Usage: the counterparty reads its own before the erasure.
    const before = await call('GET', `${A}/${goneId}`, gone.token);
    assert(before.status === 200 && before.body.data.viewer === 'counterparty', `the counterparty reads it: ${before.status}`);
    const del = await call('DELETE', `/v1/owners/${gone.name}`, gone.token);
    assert(del.status === 200, `erase: ${del.status} ${JSON.stringify(del.body?.error)}`);
    const next = await registerOwner(BASE, gone.name);
    const mine = await call('GET', `${A}/mine`, next.token);
    assert(mine.status === 200 && !mine.body.data.items.some((i: Body) => i.id === goneId), `the next holder lists nothing: ${JSON.stringify(mine.body?.data)}`);
    const seen = await call('GET', `${A}/${goneId}`, next.token);
    assert(seen.status === 404, `the next holder reads nothing: ${seen.status}`);
    const kept = await call('GET', `${A}/${goneId}`, op.token);
    assert(kept.status === 200 && kept.body.data.counterparty.name === `Poistuva ${stamp} Oy`, `the operator keeps the agreement: ${kept.status}`);
    assert(!kept.body.data.counterparty.account, `the erased account is off the agreement: ${kept.body.data.counterparty.account}`);
    await call('DELETE', `/v1/owners/${next.name}`, next.token);
});

await test('A draft\'s counterparty account is checked on a change as on a new agreement', async () => {
    const r = await call('POST', A, op.token, { counterparty: { name: `Luonnos ${stamp} Oy`, contactEmail: `luonnos${stamp}@example.invalid` }, product: 'custom', language: 'en' });
    assert(r.status === 200, `create: ${r.status}`);
    const nobody = await call('PATCH', `${A}/${r.body.data.id}`, op.token, { counterparty: { name: `Luonnos ${stamp} Oy`, account: `nobody${stamp}@${cust.ghii.split('@')[1]}` } });
    assert(nobody.status === 404 && nobody.body.error.code === 'NOT_FOUND', `an unregistered account is refused as on create: ${nobody.status}`);
    const named = await call('PATCH', `${A}/${r.body.data.id}`, op.token, { counterparty: { name: `Luonnos ${stamp} Oy`, account: other.ghii } });
    assert(named.status === 200, `a registered account is taken: ${named.status} ${JSON.stringify(named.body?.error)}`);
    const reads = await call('GET', `${A}/${r.body.data.id}`, other.token);
    assert(reads.status === 200 && reads.body.data.viewer === 'counterparty', `the named account reads it: ${reads.status}`);
});

await test('A signed copy: the operator\'s yes is bound to the copy it saw, and the evidence keeps the checked bytes (secaudit2026oct26)', async () => {
    const r = await call('POST', A, op.token, { counterparty: { name: `Kopio ${stamp} Oy`, contactEmail: `kopio${stamp}@example.invalid`, signerName: 'Kalle Kopio', account: other.ghii }, product: 'box', language: 'en' });
    assert(r.status === 200, `create: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const cid = r.body.data.id as string;
    assert((await call('POST', `${A}/${cid}/send`, op.token)).status === 200, 'send');
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const put = (key: string, data: string) => call('POST', '/v1/storage', other.token, { key, data, mime_type: 'image/png', visibility: 'private' });
    const keyA = `dpa/${stamp}/copy-a.png`;
    assert((await put(keyA, PNG)).status === 201, 'upload A');
    const a1 = await call('POST', `${A}/${cid}/signed-copy`, other.token, { storage_key: keyA, kind: 'scan' });
    assert(a1.status === 200, `copy A: ${a1.status} ${JSON.stringify(a1.body?.error)}`);
    const seenAt = (await call('GET', `${A}/${cid}`, op.token)).body.data.versions[0].review.uploadedAt as string;
    // The counterparty sends another copy after the operator looked.
    const keyB = `dpa/${stamp}/copy-b.png`;
    const bigger = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from('second')]).toString('base64');
    assert((await put(keyB, bigger)).status === 201, 'upload B');
    const b1 = await call('POST', `${A}/${cid}/signed-copy`, other.token, { storage_key: keyB, kind: 'scan' });
    assert(b1.status === 200, `copy B: ${b1.status}`);
    const stale = await call('POST', `${A}/${cid}/confirm`, op.token, { accept: true, uploaded_at: seenAt });
    assert(stale.status === 409 && stale.body.error.code === 'COPY_CHANGED', `a yes to the copy seen first is not a yes to the second: ${stale.status} ${JSON.stringify(stale.body?.error)}`);
    const mid = (await call('GET', `${A}/${cid}`, op.token)).body.data.versions[0];
    assert(mid.signatures.length === 0 && mid.status === 'review', `nothing recorded: ${JSON.stringify(mid.signatures)}`);
    // Usage: a yes to the copy now waiting records it, and the evidence holds what was checked.
    const now = mid.review;
    const ok = await call('POST', `${A}/${cid}/confirm`, op.token, { accept: true, uploaded_at: now.uploadedAt });
    assert(ok.status === 200 && ok.body.data.accepted === true, `accepted: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const sig = (await call('GET', `${A}/${cid}`, op.token)).body.data.versions[0].signatures[0];
    const sha = createHash('sha256').update(Buffer.from(bigger, 'base64')).digest('hex');
    assert(sig?.evidence?.sha256 === sha, `the evidence names the checked bytes: ${JSON.stringify(sig?.evidence)}`);
    assert(typeof sig?.evidence?.copyKey === 'string' && !String(sig.evidence.copyKey).endsWith(keyB), `a copy the node keeps: ${sig?.evidence?.copyKey}`);
    // The uploader's own file can change later; the evidence does not move with it.
    const replaced = await put(keyB, PNG);
    assert(replaced.status === 201 || replaced.status === 200, `the counterparty replaces its own file: ${replaced.status}`);
    const after = (await call('GET', `${A}/${cid}`, op.token)).body.data.versions[0].signatures[0];
    assert(after.evidence.sha256 === sha && after.evidence.copyKey === sig.evidence.copyKey, 'the evidence stays');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

/**
 * @file test/e2e-owner-export-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GDPR export (GET /v1/owners/:name/export) carries what the account holds beyond
 *   memory, files and agents: its message threads, companies, invoices, vouchers, fiscal years,
 *   outbound contacts and its agents' tasks (routes/owners/export-records.ts). Each section is read
 *   against a fixture with several records of its kind, and another owner's export carries none of
 *   them. The sections the export had before stay as e2e-owner-export.ts holds them.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-export-records
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.2).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (token: string, path: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const tag = Date.now().toString(36).slice(-5);

interface Owner { name: string; ghii: string; token: string }
async function newOwner(prefix: string): Promise<Owner> {
  const r = await registerOwner(BASE, `${prefix}${tag}`);
  return { name: r.name, ghii: r.ghii, token: r.token };
}

const N = 3;
const alice = await newOwner('exprec');
const bob = await newOwner('exprecb');
const made = { companies: [] as string[], invoices: [] as string[], vouchers: [] as string[], contacts: [] as string[], tasks: [] as string[], subjects: [] as string[], years: [] as string[] };
let aliceExport: any = null;
let bobExport: any = null;

console.log('\n=== The GDPR export carries every record the account holds ===\n');

console.log('Setup: several of each kind for alice, and a few for bob');
await test('Message threads: alice writes to bob three times, each with its own subject', async () => {
  for (let i = 0; i < N; i++) {
    const subject = `Export thread ${i} ${tag}`;
    const r = await post(alice.token, '/v1/messages', { to: bob.ghii, subject, body: `Message ${i} from alice` });
    assert(r.status === 201, `send ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.subjects.push(subject);
  }
});

await test('Companies: three companies', async () => {
  for (let i = 0; i < N; i++) {
    const r = await post(alice.token, '/v1/companies', { name: `Export Co ${i}`, slug: `exprec-${tag}-${i}`, city: 'Helsinki', country: 'FI', business_id: '1234567-8', iban: 'FI2112345600000785' });
    assert(r.status === 201, `company ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.companies.push(r.body.data.company.id);
  }
});

await test('Invoices: three drafts billed as the first company', async () => {
  for (let i = 0; i < N; i++) {
    const r = await post(alice.token, '/v1/finance/invoices', {
      company_id: made.companies[0], buyer: { name: `Buyer ${i}`, email: `buyer${i}@example.com` },
      lines: [{ description: `Item ${i}`, quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 1000 + i, vatCodeId: 'fi-std-2550' }],
    });
    assert(r.status === 201, `invoice ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.invoices.push(r.body.data.invoice.id);
  }
});

await test('Vouchers and fiscal years: three receipts, and a second fiscal year', async () => {
  for (let i = 0; i < N; i++) {
    const r = await post(alice.token, '/v1/finance/vouchers', {
      date: new Date().toISOString().slice(0, 10), description: `Receipt ${i} ${tag}`, direction: 'expense', source: 'receipt', amount_minor: 100 + i, counterparty: 'Shop Oy',
    });
    assert(r.status === 201, `voucher ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.vouchers.push(r.body.data.voucher.id);
  }
  const fy = await post(alice.token, '/v1/finance/fiscal-years', { label: 'FY 2040', start_date: '2040-01-01', end_date: '2040-12-31' });
  assert(fy.status === 201, `fiscal year: ${fy.status} ${JSON.stringify(fy.body?.error)}`);
  const years = await json('/v1/finance/fiscal-years', { headers: auth(alice.token) });
  made.years = (years.body?.data?.fiscal_years ?? []).map((y: any) => y.id);
  assert(made.years.length >= 2, `two fiscal years, got ${made.years.length}`);
});

await test('Outbound contacts: three people alice sends mail to', async () => {
  for (let i = 0; i < N; i++) {
    const r = await post(alice.token, '/v1/outbound/contacts', { name: `Customer ${i}`, email: `exprec${tag}c${i}@example.com` });
    assert(r.status === 201, `contact ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.contacts.push(r.body.data.contact.id);
  }
});

await test('Agent tasks: an agent of alice with three tasks', async () => {
  const a = await post(alice.token, '/v1/agents', { name: 'exportbot', owner: alice.name, capabilities: ['tasks'], scopes: ['task:read', 'task:write'] });
  assert(a.status === 201, `agent: ${a.status}`);
  for (let i = 0; i < N; i++) {
    const r = await post(alice.token, '/v1/agents/exportbot/tasks', { title: `Export task ${i} ${tag}`, description: 'kept in the export' });
    assert(r.status === 201, `task ${i}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    made.tasks.push(r.body.data.task.id);
  }
});

await test('Bob has a company and an invoice of his own', async () => {
  const c = await post(bob.token, '/v1/companies', { name: 'Bob Co', slug: `exprecb-${tag}`, city: 'Turku', country: 'FI', business_id: '7654321-0', iban: 'FI2112345600000785' });
  assert(c.status === 201, `bob company: ${c.status}`);
  const i = await post(bob.token, '/v1/finance/invoices', { company_id: c.body.data.company.id, buyer: { name: 'Bob buyer' }, lines: [{ description: 'x', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 100, vatCodeId: 'fi-std-2550' }] });
  assert(i.status === 201, `bob invoice: ${i.status} ${JSON.stringify(i.body?.error)}`);
});

console.log('\nThe export');
await test('1. Alice and bob each export their own account', async () => {
  const a = await json(`/v1/owners/${alice.name}/export`, { headers: auth(alice.token) });
  assert(a.status === 200, `alice ${a.status} ${JSON.stringify(a.body?.error)}`);
  aliceExport = a.body.data;
  const b = await json(`/v1/owners/${bob.name}/export`, { headers: auth(bob.token) });
  assert(b.status === 200, `bob ${b.status}`);
  bobExport = b.body.data;
});

const ids = (rows: any[] | undefined) => new Set((rows ?? []).map((r: any) => r.id));

await test('2. message_threads: each thread with its subject and messages', async () => {
  const threads = aliceExport?.message_threads ?? [];
  for (const s of made.subjects) {
    const t = threads.find((x: any) => x.subject === s);
    assert(!!t, `thread "${s}" in ${JSON.stringify(threads.map((x: any) => x.subject))}`);
    assert((t.messages ?? []).some((m: any) => String(m.body).startsWith('Message ')), `messages of "${s}"`);
  }
});

await test('3. companies: all three, and the mail password never', async () => {
  const got = ids(aliceExport?.companies);
  assert(made.companies.every(id => got.has(id)), `companies ${JSON.stringify([...got])}`);
  assert(!JSON.stringify(aliceExport.companies).includes('passwordEnc'), 'no stored password field');
});

await test('4. invoices, vouchers and fiscal years: every one made', async () => {
  const inv = ids(aliceExport?.invoices);
  assert(made.invoices.every(id => inv.has(id)), `invoices ${inv.size}`);
  const vou = ids(aliceExport?.vouchers);
  assert(made.vouchers.every(id => vou.has(id)), `vouchers ${vou.size}`);
  const fy = ids(aliceExport?.fiscal_years);
  assert(made.years.every(id => fy.has(id)), `fiscal years ${fy.size}`);
});

await test('5. outbound_contacts: all three', async () => {
  const got = ids(aliceExport?.outbound_contacts);
  assert(made.contacts.every(id => got.has(id)), `contacts ${got.size}`);
  assert(Array.isArray(aliceExport?.outbound_messages), 'outbound_messages is a section');
});

await test('6. agent_tasks: every task, each with its events', async () => {
  const tasks = aliceExport?.agent_tasks ?? [];
  for (const id of made.tasks) {
    const t = tasks.find((x: any) => x.id === id);
    assert(!!t && Array.isArray(t.events), `task ${id} with events`);
  }
});

await test('7. The other record sections are present as lists', async () => {
  for (const k of ['contacts', 'scheduled_jobs', 'capabilities', 'package_instances', 'help_questions', 'sharing_groups', 'group_shares', 'ai_decisions', 'account_events']) {
    assert(Array.isArray(aliceExport?.[k]), `${k} is a list`);
  }
});

await test('8. Cross-owner: bob\'s export holds none of alice\'s records, and alice\'s none of bob\'s', async () => {
  const bobAll = JSON.stringify({ c: bobExport?.companies, i: bobExport?.invoices, v: bobExport?.vouchers, f: bobExport?.fiscal_years, o: bobExport?.outbound_contacts, t: bobExport?.agent_tasks });
  for (const id of [...made.companies, ...made.invoices, ...made.vouchers, ...made.contacts, ...made.tasks, ...made.years]) {
    assert(!bobAll.includes(id), `alice's ${id} in bob's export`);
  }
  assert((bobExport?.companies ?? []).length === 1 && (bobExport?.invoices ?? []).length === 1, `bob's own: ${(bobExport?.companies ?? []).length} companies, ${(bobExport?.invoices ?? []).length} invoices`);
  assert(!(aliceExport?.companies ?? []).some((c: any) => c.name === 'Bob Co'), 'bob\'s company in alice\'s export');
});

await test('9. Bob cannot export alice', async () => {
  const r = await json(`/v1/owners/${alice.name}/export`, { headers: auth(bob.token) });
  assert(r.status === 403, `bob exporting alice: ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

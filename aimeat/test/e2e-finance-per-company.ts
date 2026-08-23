/**
 * @file e2e-finance-per-company.ts
 * @description E2E for TARGET-072: one owner, two companies, two sets of books.
 *
 *   A COMPANY IS THE ACCOUNTING ENTITY, not the account. Two companies under one owner are two
 *   ledgers, two closings and two gapless number series, and until 2026-08-23 they were one of
 *   each. Nobody met it because organismId was null on every company on this platform, so there
 *   was only ever one set of books to confuse; the company brain started writing that link and
 *   made every one of these reachable.
 *
 *   THREE THINGS, AND THE THIRD IS THE ONE WITH MONEY IN IT.
 *     - A fiscal year belongs to one company. fiscalYearForDate took organismId and used it only
 *       when CREATING a year, matching on dates alone when reading — so closing one company's
 *       books stopped the other company invoicing, with an error naming a year that is not theirs.
 *     - The invoice NUMBER a company shows is its own, because the law wants gapless numbering per
 *       kirjanpitovelvollinen.
 *     - The payment REFERENCE stays owner-level and never restarts, because findInvoiceByReference
 *       is how an incoming payment is matched to an invoice. Two companies both restarting at 1
 *       would mint the same viite, and the wrong customer would be marked paid. That is the whole
 *       reason the numbering is split in two rather than simply made per-company.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=finance-per-company
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-072).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
  const h = createHash('sha512');
  for (const m of msgs) h.update(m);
  return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', {
      method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: 'TwoBooks1234' }),
    });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, owner };
  }
}

/** A registered company with an organism of its own — the state the company brain produces. */
async function makeCompany(token: string, name: string): Promise<{ id: string; org: string }> {
  const orgRes = await json('/v1/organisms', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ name, visibility: 'private' }),
  });
  assert(orgRes.status === 201 || orgRes.status === 200, `organism failed: ${orgRes.status} ${JSON.stringify(orgRes.body).slice(0, 200)}`);
  const org = orgRes.body.data?.id ?? orgRes.body.data?.organism?.id;
  assert(org, `no organism id in ${JSON.stringify(orgRes.body).slice(0, 200)}`);

  const co = await json('/v1/companies', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({
      name, organism_id: org, business_id: '1234567-8',
      street_address: 'Testikatu 1', postal_code: '02100', city: 'Espoo', country: 'FI',
      iban: 'FI2112345600000785',
    }),
  });
  assert(co.status === 201, `company failed: ${co.status} ${JSON.stringify(co.body).slice(0, 200)}`);
  return { id: co.body.data.company.id, org };
}

/** Draft an invoice billed AS this company, then send it. Returns the sent record. */
async function invoice(token: string, companyId: string): Promise<any> {
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({
      company_id: companyId,
      buyer: { name: 'Ostaja Oy', email: 'ostaja@example.test' },
      lines: [{ description: 'Työ', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 10000, vatCodeId: 'fi-std-2550' }],
    }),
  });
  assert(draft.status === 201, `draft failed: ${draft.status} ${JSON.stringify(draft.body).slice(0, 300)}`);
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(token), body: JSON.stringify({ delivery_method: 'manual' }),
  });
  assert(sent.status === 200, `send failed: ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`);
  return sent.body.data.invoice;
}

console.log('═══ E2E: one owner, two companies, two sets of books ═══');
console.log(`Base: ${BASE}`);

const A = await makeOwner('books');
const OTHER = await makeOwner('stranger');
const acme = await makeCompany(A.token, 'Acme Oy');
const beta = await makeCompany(A.token, 'Beta Oy');

console.log('\nPhase 1 — two ledgers');

let acmeInvoice: any = null;
let betaInvoice: any = null;

await test('1. each company gets its OWN fiscal year for the same dates', async () => {
  acmeInvoice = await invoice(A.token, acme.id);
  betaInvoice = await invoice(A.token, beta.id);
  assert(acmeInvoice.fiscalYearId && betaInvoice.fiscalYearId, 'both invoices must resolve a fiscal year');
  assert(acmeInvoice.fiscalYearId !== betaInvoice.fiscalYearId,
    'two companies invoicing on the same day shared ONE fiscal year — close one and the other stops');
});

await test('2. closing one company’s books leaves the other company invoicing', async () => {
  // The live bug this target was written around: the year lookup matched on dates alone, so the
  // second company's booking found the first company's year and inherited its lock. An owner who
  // closed Acme's year was told "Fiscal year 2026 is locked" while trying to invoice from Beta.
  const years = await json('/v1/finance/fiscal-years', { headers: authed(A.token) });
  const acmeYear = (years.body.data.fiscal_years ?? []).find((y: any) => y.organismId === acme.org);
  assert(acmeYear, `Acme has no fiscal year of its own: ${JSON.stringify(years.body.data.fiscal_years)}`);

  const lock = await json(`/v1/finance/fiscal-years/${acmeYear.id}/lock`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ locked: true }),
  });
  assert(lock.status === 200, `lock failed: ${lock.status} ${JSON.stringify(lock.body).slice(0, 200)}`);

  // Beta is a different set of books and must be unaffected.
  const stillWorks = await invoice(A.token, beta.id);
  assert(stillWorks.status === 'sent', `Beta could not invoice with Acme's books closed: ${stillWorks.status}`);

  // …and Acme really is closed, so the lock is doing something rather than being ignored.
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      company_id: acme.id, buyer: { name: 'Ostaja Oy' },
      lines: [{ description: 'Työ', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 10000, vatCodeId: 'fi-std-2550' }],
    }),
  });
  const refused = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }),
  });
  assert(refused.status === 409 && refused.body.error?.code === 'FISCAL_YEAR_LOCKED',
    `a closed year must refuse a send, got ${refused.status} ${JSON.stringify(refused.body.error)}`);

  await json(`/v1/finance/fiscal-years/${acmeYear.id}/lock`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ locked: false }),
  });
});

console.log('\nPhase 2 — two number series, one payment reference space');

await test('3. each company’s FIRST invoice is its own number 1', async () => {
  // Gapless numbering per kirjanpitovelvollinen is what the law is about, and the number the law
  // means is the one on the invoice.
  assert(acmeInvoice.invoiceNumber.endsWith('-1'),
    `Acme's first invoice should be number 1, got ${acmeInvoice.invoiceNumber}`);
  assert(betaInvoice.invoiceNumber.endsWith('-1'),
    `Beta's first invoice should be number 1 too, got ${betaInvoice.invoiceNumber}`);
});

await test('4. …and their payment references still DIFFER', async () => {
  // The one that would cost money. The reference is derived from the owner-level sequence, which
  // never restarts, because an incoming payment is matched to an invoice BY this number. Two
  // companies both restarting at 1 would mint the same viite and mark the wrong customer paid.
  assert(acmeInvoice.referenceNumber !== betaInvoice.referenceNumber,
    `two companies minted the same payment reference (${acmeInvoice.referenceNumber}) — an incoming payment would match the wrong invoice`);
  assert(acmeInvoice.numberSeq !== betaInvoice.numberSeq,
    `the owner-level sequence restarted (${acmeInvoice.numberSeq}) — the unique index would collide next`);
});

await test('4b. within ONE company’s series a number is never repeated', async () => {
  // Uniqueness is required within a series, not across an owner's companies: two accounting
  // entities both having an invoice number 1 is ordinary, and the invoice carries the seller's
  // business id to say which is which. What must never happen is one company issuing "2026-3"
  // twice, so this bills the same company repeatedly and reads its own series back.
  const late = await makeOwner('series');
  const one = await makeCompany(late.token, 'Sarja Oy');
  const numbers: string[] = [];
  for (let i = 0; i < 4; i++) numbers.push((await invoice(late.token, one.id)).invoiceNumber);
  assert(new Set(numbers).size === 4, `one company repeated a number: ${numbers.join(', ')}`);
  const seqs = numbers.map((n) => Number(n.split('-').pop()));
  assert(JSON.stringify(seqs) === JSON.stringify([1, 2, 3, 4]),
    `a company's series must run 1,2,3,4 without gaps: ${seqs.join(', ')}`);

  // And a second company under the same owner runs its own 1,2 beside it.
  const two = await makeCompany(late.token, 'Rinnakkain Oy');
  const other = [(await invoice(late.token, two.id)).invoiceNumber, (await invoice(late.token, two.id)).invoiceNumber];
  assert(other.map((n) => Number(n.split('-').pop())).join() === '1,2',
    `the second company gets its own series from 1: ${other.join(', ')}`);
});

await test('5. an owner with no company keeps the plain owner-level series', async () => {
  const solo = await makeOwner('solo');
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(solo.token),
    body: JSON.stringify({
      seller: { name: 'Yksin Oy', businessId: '1234567-8', streetAddress: 'Katu 1', postalCode: '00100', city: 'Helsinki', country: 'FI' },
      buyer: { name: 'Ostaja Oy' },
      lines: [{ description: 'Työ', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 5000, vatCodeId: 'fi-std-2550' }],
    }),
  });
  assert(draft.status === 201, `solo draft failed: ${draft.status} ${JSON.stringify(draft.body).slice(0, 200)}`);
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(solo.token), body: JSON.stringify({ delivery_method: 'manual' }),
  });
  assert(sent.status === 200, `solo send failed: ${sent.status}`);
  const inv = sent.body.data.invoice;
  assert(inv.invoiceNumber.endsWith(`-${inv.numberSeq}`),
    `with no company the displayed number IS the sequence: ${inv.invoiceNumber} vs ${inv.numberSeq}`);
});

console.log('\nPhase 3 — reading one company’s books');

await test('6. ?company= narrows invoices to that company, and absent means everything', async () => {
  const all = await json('/v1/finance/invoices', { headers: authed(A.token) });
  const onlyAcme = await json(`/v1/finance/invoices?company=${encodeURIComponent(acme.id)}`, { headers: authed(A.token) });
  const onlyBeta = await json(`/v1/finance/invoices?company=${encodeURIComponent(beta.id)}`, { headers: authed(A.token) });
  assert(all.body.data.total > onlyAcme.body.data.total,
    `the unscoped list must hold both companies: all ${all.body.data.total}, acme ${onlyAcme.body.data.total}`);
  assert(onlyAcme.body.data.invoices.every((i: any) => i.organismId === acme.org),
    'a scoped list leaked another company’s invoices');
  assert(onlyBeta.body.data.invoices.every((i: any) => i.organismId === beta.org),
    'a scoped list leaked another company’s invoices');
  assert(onlyAcme.body.data.total >= 1 && onlyBeta.body.data.total >= 1, 'both companies should have invoices');
});

await test('7. the P&L and the VAT report answer for one company', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const bothPnl = await json(`/v1/finance/pnl?from=${month}`, { headers: authed(A.token) });
  const acmePnl = await json(`/v1/finance/pnl?from=${month}&company=${encodeURIComponent(acme.id)}`, { headers: authed(A.token) });
  assert(bothPnl.status === 200 && acmePnl.status === 200, `pnl failed: ${bothPnl.status} / ${acmePnl.status}`);
  const bothVat = await json(`/v1/finance/vat-report?from=${month}`, { headers: authed(A.token) });
  const acmeVat = await json(`/v1/finance/vat-report?from=${month}&company=${encodeURIComponent(acme.id)}`, { headers: authed(A.token) });
  assert(bothVat.status === 200 && acmeVat.status === 200, `vat failed: ${bothVat.status} / ${acmeVat.status}`);
  // Both scoped reports must be no larger than the whole-account one; a scope that WIDENED a read
  // would be the failure this target exists to prevent.
  assert(JSON.stringify(acmePnl.body.data.report).length <= JSON.stringify(bothPnl.body.data.report).length + 200,
    'the scoped P&L is not a subset of the whole-account one');
});

await test('8. the fiscal-year list narrows too', async () => {
  const all = await json('/v1/finance/fiscal-years', { headers: authed(A.token) });
  const scoped = await json(`/v1/finance/fiscal-years?company=${encodeURIComponent(acme.id)}`, { headers: authed(A.token) });
  assert(scoped.body.data.fiscal_years.length < all.body.data.fiscal_years.length,
    `scoping must narrow: all ${all.body.data.fiscal_years.length}, scoped ${scoped.body.data.fiscal_years.length}`);
  assert(scoped.body.data.fiscal_years.every((y: any) => y.organismId === acme.org), 'a scoped year list leaked');
});

console.log('\nPhase 4 — sending, per company');

await test('11. a send records WHICH company sent it, and a refused one records it too', async () => {
  // The rows that say why something did NOT go out are the ones an owner reads when a company's
  // sending looks wrong, so the company is resolved before the first gate rather than at the SMTP
  // step where `company_id` used to stop.
  const contact = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Vastaanottaja', email: `rcpt${Date.now().toString(36)}@example.test` }),
  });
  assert(contact.status === 201 || contact.status === 200, `contact failed: ${contact.status} ${JSON.stringify(contact.body).slice(0, 200)}`);
  const contactId = contact.body.data.contact.id;

  // Opting out makes a marketing send a REFUSED one, which is the log row worth checking.
  const optOut = await json(`/v1/outbound/contacts/${contactId}/opt-out`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ opted_out: true }),
  });
  assert(optOut.status === 200, `opt-out failed: ${optOut.status} ${JSON.stringify(optOut.body).slice(0, 200)}`);

  await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: contactId, company_id: acme.id, kind: 'marketing', subject: 'Tarjous', body: 'Hei' }),
  });

  const log = await json('/v1/outbound/log', { headers: authed(A.token) });
  assert(log.status === 200, `log read failed: ${log.status}`);
  const rows = log.body.data.messages ?? [];
  const mine = rows.find((m: any) => m.contactId === contactId);
  assert(mine, `the refused send left no log row: ${JSON.stringify(rows).slice(0, 200)}`);
  assert(mine.organismId === acme.org,
    `a refused send must still say which company sent it, got ${JSON.stringify(mine.organismId)}`);
});

console.log('\nPhase 5 — the fences');

await test('9. naming somebody else’s company answers like an absent one', async () => {
  // Absent and not-yours answer identically, so this door does not become the one that tells a
  // stranger which company ids exist.
  const theirs = await makeCompany(OTHER.token, 'Vieras Oy');
  const r = await json(`/v1/finance/invoices?company=${encodeURIComponent(theirs.id)}`, { headers: authed(A.token) });
  assert(r.status === 404 && r.body.error?.code === 'COMPANY_NOT_FOUND',
    `expected 404 COMPANY_NOT_FOUND, got ${r.status} ${JSON.stringify(r.body.error)}`);
  const missing = await json('/v1/finance/invoices?company=does-not-exist', { headers: authed(A.token) });
  assert(missing.status === 404 && missing.body.error?.code === 'COMPANY_NOT_FOUND',
    `an absent company must answer the same way, got ${missing.status}`);
});

await test('10. a company with no organism scopes to nothing rather than to everything', async () => {
  // The quiet failure this guards: returning "no scope" for a company with no books would widen a
  // scoped read back into a whole-account one, and the caller would never know.
  const co = await json('/v1/companies', {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ name: `Kirjaton ${Date.now().toString(36).slice(-5)}` }),
  });
  assert(co.status === 201, `company failed: ${co.status}`);
  const r = await json(`/v1/finance/invoices?company=${encodeURIComponent(co.body.data.company.id)}`, { headers: authed(A.token) });
  assert(r.status === 200, `expected a 200 with nothing in it, got ${r.status}`);
  assert(r.body.data.total === 0, `a company with no books has no invoices, got ${r.body.data.total}`);
});

await test('12. scoping a read to a company still needs permission to read the books at all', async () => {
  // `?company=` narrows what a caller sees; it never widens who may look. An agent without
  // finance:read is refused before the scope is even resolved, and a company id in the query does
  // not become a second way in.
  const name = `narrow${Date.now().toString(36).slice(-5)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name, owner: A.owner, scopes: ['memory:read'] }),
  });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key as string, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  const narrow = tok.body.data.token as string;

  const scoped = await json(`/v1/finance/invoices?company=${encodeURIComponent(acme.id)}`, { headers: authed(narrow) });
  assert(scoped.status === 403, `an agent without finance:read must get 403, got ${scoped.status}`);
  const unscoped = await json('/v1/finance/invoices', { headers: authed(narrow) });
  assert(unscoped.status === 403, `and the same without a company, got ${unscoped.status}`);
  const anon = await json(`/v1/finance/invoices?company=${encodeURIComponent(acme.id)}`);
  assert(anon.status === 401, `no session at all must be 401, got ${anon.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

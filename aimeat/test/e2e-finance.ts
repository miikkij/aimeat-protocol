/**
 * @file test/e2e-finance.ts
 * @description E2E for the finance domain (company-in-a-box phase 1): the invoice
 *   lifecycle draft→sent→paid with gapless numbering and valid payment references,
 *   credit notes flipping the original to credited, append-only vouchers with
 *   reversals, fiscal-year locking rejecting new bookings, the VAT period report,
 *   accountant exports (CSV + Finvoice ZIP), cross-owner isolation (absent and
 *   not-yours answer identically), cross-scope 403 for a narrow agent, and the
 *   per-seller Stripe webhook (signature check, idempotent redelivery, invoice
 *   matching via metadata.aimeat_reference, payout as a transfer voucher).
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-finance.ts

import { createHmac, createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}: ${(e as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      await new Promise((r) => setTimeout(r, Math.max(500, retryAfter * 1000)));
      continue;
    }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body, headers: res.headers };
  }
}

// @noble/ed25519 v3 needs a sha512 shim in Node
(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
  const h = createHash('sha512');
  for (const m of msgs) h.update(m);
  return new Uint8Array(h.digest());
};

async function signMsg(privB64: string, msg: string): Promise<string> {
  const priv = Buffer.from(privB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(msg), priv);
  return Buffer.from(sig).toString('base64');
}

async function makeOwner(name: string): Promise<{ token: string; ghii: string; owner: string; privKey: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: 'FinanceTest1234' }) });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status} ${JSON.stringify(tok.body)}`);
    return { token: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}`, owner, privKey };
  }
}

async function makeNarrowAgent(ownerCtx: { token: string; owner: string }): Promise<string> {
  const name = `narrow${Date.now().toString(36).slice(-5)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ name, owner: ownerCtx.owner, scopes: ['memory:read'] }),
  });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const privKey = reg.body.data.private_key as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, `agent token failed: ${tok.status} ${JSON.stringify(tok.body)}`);
  return tok.body.data.token as string;
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

function draftBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seller: {
      name: 'Testifirma Oy', businessId: '1234567-8', vatId: 'FI12345678',
      streetAddress: 'Testikatu 1', postalCode: '02100', city: 'Espoo',
      iban: 'FI2112345600000785', bic: 'NDEAFIHH',
    },
    buyer: { name: 'Ostaja Oy', businessId: '7654321-1', email: 'ostaja@example.com' },
    lines: [
      { description: 'Konsultointi', quantityMilli: 1500, unit: 'h', unitPriceMinor: 10000, vatCodeId: 'fi-std-2550' },
    ],
    ...overrides,
  };
}

console.log('═══ E2E: finance (company-in-a-box phase 1) ═══');
console.log(`Base: ${BASE}`);

console.log('\nSetup');
const A = await makeOwner('finsell');
const B = await makeOwner('finother');
const narrowAgentToken = await makeNarrowAgent(A);

console.log('\nPhase 1 — invoice lifecycle');

let invoiceId = '';
await test('1. draft is created with computed 25.5 % VAT totals', async () => {
  const r = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  const inv = r.body.data.invoice;
  invoiceId = inv.id;
  assert(inv.status === 'draft', 'status should be draft');
  assert(inv.numberSeq === null && inv.invoiceNumber === null, 'draft must not hold a number');
  assert(inv.totalNetMinor === 15000, `net should be 15000, got ${inv.totalNetMinor}`);
  assert(inv.totalVatMinor === 3825, `vat should be 3825 (25.5 %), got ${inv.totalVatMinor}`);
  assert(inv.totalGrossMinor === 18825, `gross should be 18825, got ${inv.totalGrossMinor}`);
});

await test('2. vat-codes endpoint serves the registry valid today (13.5 % in, 14 % out)', async () => {
  const r = await json('/v1/finance/vat-codes', { headers: authed(A.token) });
  assert(r.status === 200, `expected 200, got ${r.status}`);
  const codes = r.body.data.vat_codes as { id: string; rateBp: number }[];
  assert(codes.some((c) => c.rateBp === 2550), 'standard 25.5 % missing');
  assert(codes.some((c) => c.rateBp === 1350), 'reduced 13.5 % missing');
  assert(!codes.some((c) => c.rateBp === 1400), 'expired 14 % should not be valid today');
});

await test('3. amounts are computed server-side, never trusted from the caller', async () => {
  const r = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify(draftBody({ lines: [{ description: 'x', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 100, vatCodeId: 'fi-std-2550', netMinor: 999999 }] })),
  });
  // The strict schema rejects computed fields in the input.
  assert(r.status === 400, `expected 400 for client-supplied amounts, got ${r.status}`);
});

await test('4. draft edit recomputes totals', async () => {
  const body = draftBody({ lines: [
    { description: 'Konsultointi', quantityMilli: 2000, unit: 'h', unitPriceMinor: 10000, vatCodeId: 'fi-std-2550' },
  ] });
  const r = await json(`/v1/finance/invoices/${invoiceId}`, { method: 'PUT', headers: authed(A.token), body: JSON.stringify(body) });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.invoice.totalNetMinor === 20000, 'net should be 20000 after edit');
});

await test('5. send assigns number 1, a valid viite, dates and fiscal year', async () => {
  const r = await json(`/v1/finance/invoices/${invoiceId}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }),
  });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  const inv = r.body.data.invoice;
  assert(inv.status === 'sent', 'status should be sent');
  assert(inv.numberSeq === 1, `first invoice number should be 1, got ${inv.numberSeq}`);
  assert(typeof inv.invoiceNumber === 'string' && inv.invoiceNumber.endsWith('-1'), `invoiceNumber malformed: ${inv.invoiceNumber}`);
  assert(/^[0-9]{8}$/.test(inv.referenceNumber), `viite malformed: ${inv.referenceNumber}`);
  assert(inv.invoiceDate && inv.dueDate && inv.dueDate > inv.invoiceDate, 'dates missing');
  assert(inv.fiscalYearId, 'fiscal year should be auto-resolved');
});

await test('6. a sent invoice is immutable (edit 409, delete 409)', async () => {
  const edit = await json(`/v1/finance/invoices/${invoiceId}`, { method: 'PUT', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  assert(edit.status === 409, `edit should be 409, got ${edit.status}`);
  const del = await json(`/v1/finance/invoices/${invoiceId}`, { method: 'DELETE', headers: authed(A.token) });
  assert(del.status === 409, `delete should be 409, got ${del.status}`);
});

await test('7. finvoice.xml downloads for the sent invoice', async () => {
  const res = await fetch(`${BASE}/v1/finance/invoices/${invoiceId}/finvoice.xml`, { headers: authed(A.token) });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const xml = await res.text();
  assert(xml.includes('<Finvoice Version="3.0">'), 'missing Finvoice root');
  assert(xml.includes('<InvoiceTypeCode>INV01</InvoiceTypeCode>'), 'missing type code');
});

await test('8. mark-paid books exactly one income voucher with the VAT breakdown', async () => {
  const r = await json(`/v1/finance/invoices/${invoiceId}/mark-paid`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({}) });
  assert(r.status === 200 && r.body.data.invoice.status === 'paid', `expected paid, got ${r.status} ${JSON.stringify(r.body)}`);
  const again = await json(`/v1/finance/invoices/${invoiceId}/mark-paid`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({}) });
  assert(again.status === 200, 'repeat mark-paid should be idempotent 200');
  const vouchers = await json('/v1/finance/vouchers?source=invoice', { headers: authed(A.token) });
  assert(vouchers.body.data.total === 1, `expected exactly 1 invoice voucher, got ${vouchers.body.data.total}`);
  const v = vouchers.body.data.vouchers[0];
  assert(v.direction === 'income' && v.invoiceId === invoiceId, 'voucher not linked to the invoice');
  assert(v.vatBreakdown.length === 1 && v.vatBreakdown[0].vatRateBp === 2550, 'voucher missing VAT breakdown');
  assert(v.voucherNumber === 1, `first voucher number should be 1, got ${v.voucherNumber}`);
});

let creditNoteId = '';
await test('9. credit note credits the original when sent', async () => {
  const create = await json(`/v1/finance/invoices/${invoiceId}/credit-note`, { method: 'POST', headers: authed(A.token) });
  assert(create.status === 201, `expected 201, got ${create.status} ${JSON.stringify(create.body)}`);
  creditNoteId = create.body.data.invoice.id;
  assert(create.body.data.invoice.type === 'credit_note' && create.body.data.invoice.status === 'draft', 'credit note should start as draft');
  const send = await json(`/v1/finance/invoices/${creditNoteId}/send`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual', reference_style: 'rf' }) });
  assert(send.status === 200, `send failed: ${send.status} ${JSON.stringify(send.body)}`);
  assert(send.body.data.invoice.numberSeq === 2, 'credit note should take the next number');
  assert(send.body.data.invoice.referenceNumber.startsWith('RF'), 'RF reference expected');
  const original = await json(`/v1/finance/invoices/${invoiceId}`, { headers: authed(A.token) });
  assert(original.body.data.invoice.status === 'credited', `original should be credited, got ${original.body.data.invoice.status}`);
});

await test('10. a deleted draft never consumes a number (gapless sequence)', async () => {
  const d1 = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  await json(`/v1/finance/invoices/${d1.body.data.invoice.id}`, { method: 'DELETE', headers: authed(A.token) });
  const d2 = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  const sent = await json(`/v1/finance/invoices/${d2.body.data.invoice.id}/send`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }) });
  assert(sent.body.data.invoice.numberSeq === 3, `expected seq 3 (no gap), got ${sent.body.data.invoice.numberSeq}`);
});

console.log('\nPhase 2 — vouchers, VAT report, fiscal year lock, exports');

let manualVoucherId = '';
await test('11. manual expense voucher books with the next number', async () => {
  const r = await json('/v1/finance/vouchers', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10), description: 'Toimistotarvikkeet',
      direction: 'expense', source: 'receipt', amount_minor: 6262,
      vat_breakdown: [{ vatCodeId: 'fi-std-2550', vatRateBp: 2550, netMinor: 4990, vatMinor: 1272 }],
      counterparty: 'Kauppa Oy',
    }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  manualVoucherId = r.body.data.voucher.id;
  assert(r.body.data.voucher.voucherNumber === 2, `expected voucher 2, got ${r.body.data.voucher.voucherNumber}`);
});

await test('12. VAT report sums sales and purchases by code', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const r = await json(`/v1/finance/vat-report?from=${month}&to=${month}`, { headers: authed(A.token) });
  assert(r.status === 200, `expected 200, got ${r.status}`);
  const report = r.body.data.report;
  // Sales: invoice voucher 20000 net / 5100 VAT. Purchases: 4990 net / 1272 VAT.
  assert(report.totalSalesVatMinor === 5100, `sales VAT should be 5100, got ${report.totalSalesVatMinor}`);
  assert(report.totalPurchasesVatMinor === 1272, `purchase VAT should be 1272, got ${report.totalPurchasesVatMinor}`);
  assert(report.vatPayableMinor === 3828, `payable should be 3828, got ${report.vatPayableMinor}`);
});

await test('13. voucher reversal books the opposite direction and links back', async () => {
  const r = await json(`/v1/finance/vouchers/${manualVoucherId}/reverse`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ reason: 'väärä summa' }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.voucher.direction === 'income', 'reversal of expense should be income');
  assert(r.body.data.voucher.reversesVoucherId === manualVoucherId, 'reversal link missing');
});

await test('14. attachments append to a booked voucher', async () => {
  const r = await json(`/v1/finance/vouchers/${manualVoucherId}/attachments`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ keys: ['receipts/kuitti-1.jpg'] }),
  });
  assert(r.status === 200 && r.body.data.voucher.attachments.includes('receipts/kuitti-1.jpg'), `attach failed: ${r.status}`);
});

await test('15. a locked fiscal year rejects vouchers and invoice sends; unlock restores', async () => {
  const years = await json('/v1/finance/fiscal-years', { headers: authed(A.token) });
  const year = years.body.data.fiscal_years[0];
  assert(year, 'fiscal year should exist');
  const lock = await json(`/v1/finance/fiscal-years/${year.id}/lock`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ locked: true }) });
  assert(lock.status === 200, `lock failed: ${lock.status}`);
  const voucher = await json('/v1/finance/vouchers', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), description: 'x', direction: 'expense', source: 'manual', amount_minor: 100 }),
  });
  assert(voucher.status === 409 && voucher.body.error?.code === 'FISCAL_YEAR_LOCKED', `expected FISCAL_YEAR_LOCKED, got ${voucher.status} ${JSON.stringify(voucher.body)}`);
  const draft = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  const send = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }) });
  assert(send.status === 409, `send into a locked year should be 409, got ${send.status}`);
  const unlock = await json(`/v1/finance/fiscal-years/${year.id}/lock`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ locked: false }) });
  assert(unlock.status === 200, 'unlock failed');
});

await test('16. exports: vouchers CSV and Finvoice ZIP', async () => {
  const csv = await fetch(`${BASE}/v1/finance/export/vouchers.csv`, { headers: authed(A.token) });
  assert(csv.status === 200 && (csv.headers.get('content-type') ?? '').includes('text/csv'), 'CSV export failed');
  const csvText = await csv.text();
  assert(csvText.includes('tositenumero') && csvText.includes('Toimistotarvikkeet'), 'CSV content missing');
  const zip = await fetch(`${BASE}/v1/finance/export/finvoice.zip`, { headers: authed(A.token) });
  assert(zip.status === 200, 'ZIP export failed');
  const buf = Buffer.from(await zip.arrayBuffer());
  assert(buf.subarray(0, 2).toString('latin1') === 'PK', 'not a ZIP file');
});

console.log('\nPhase 3 — isolation and scopes');

await test('17. another owner cannot see or touch the invoices (404, empty list)', async () => {
  const get = await json(`/v1/finance/invoices/${invoiceId}`, { headers: authed(B.token) });
  assert(get.status === 404, `cross-owner get should be 404, got ${get.status}`);
  const pay = await json(`/v1/finance/invoices/${invoiceId}/mark-paid`, { method: 'POST', headers: authed(B.token), body: JSON.stringify({}) });
  assert(pay.status === 404, `cross-owner mark-paid should be 404, got ${pay.status}`);
  const list = await json('/v1/finance/invoices', { headers: authed(B.token) });
  assert(list.body.data.total === 0, "B's invoice list should be empty");
  const vGet = await json(`/v1/finance/vouchers/${manualVoucherId}`, { headers: authed(B.token) });
  assert(vGet.status === 404, `cross-owner voucher get should be 404, got ${vGet.status}`);
});

await test('18. an agent without finance scopes gets 403 SCOPE_DENIED', async () => {
  const r = await json('/v1/finance/invoices', { headers: authed(narrowAgentToken) });
  assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
  const w = await json('/v1/finance/invoices', { method: 'POST', headers: authed(narrowAgentToken), body: JSON.stringify(draftBody()) });
  assert(w.status === 403, `write should be 403, got ${w.status}`);
});

await test('19. unauthenticated requests get 401', async () => {
  const r = await json('/v1/finance/invoices');
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

console.log('\nPhase 4 — Stripe webhook → vouchers');

const WEBHOOK_SECRET = 'whsec_e2e_test_secret_123';

function stripeSig(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

async function postWebhook(owner: string, payload: Record<string, unknown>, sigHeader?: string): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE}/v1/commerce/webhooks/stripe/${owner}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sigHeader ?? stripeSig(raw, WEBHOOK_SECRET) },
    body: raw,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

await test('20. webhook secret installs beside the Stripe key (merged PSP record)', async () => {
  const r = await json('/v1/commerce/payout/stripe', {
    method: 'PUT', headers: authed(A.token),
    body: JSON.stringify({ secret_key: 'sk_test_e2e_finance_1234', webhook_secret: WEBHOOK_SECRET }),
  });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('21. an unconfigured owner answers 404 (no endpoint enumeration)', async () => {
  const r = await postWebhook(B.owner, { id: 'evt_x', type: 'payment_intent.succeeded' });
  assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('22. a bad signature is rejected 401', async () => {
  const r = await postWebhook(A.owner, { id: 'evt_bad', type: 'payment_intent.succeeded' }, 't=1,v1=deadbeef');
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('23. payment_intent.succeeded books an income voucher; redelivery is idempotent', async () => {
  const event = {
    id: 'evt_charge_1', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'pi_e2e_1', amount_received: 12500, currency: 'eur', description: 'AIMEAT checkout test' } },
  };
  const first = await postWebhook(A.owner, event);
  assert(first.status === 200 && first.body.data.action === 'charge_booked', `expected charge_booked, got ${first.status} ${JSON.stringify(first.body)}`);
  const second = await postWebhook(A.owner, event);
  assert(second.status === 200, 'redelivery should be 200');
  const vouchers = await json('/v1/finance/vouchers?source=stripe', { headers: authed(A.token) });
  const charges = vouchers.body.data.vouchers.filter((v: any) => v.externalRef === 'evt_charge_1');
  assert(charges.length === 1, `expected exactly 1 voucher for the event, got ${charges.length}`);
  assert(charges[0].trackingCode === 'pi_e2e_1' && charges[0].amountMinor === 12500, 'voucher fields wrong');
});

await test('24. metadata.aimeat_reference matches a sent invoice → invoice paid, VAT carried', async () => {
  const draft = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }) });
  const reference = sent.body.data.invoice.referenceNumber as string;
  const event = {
    id: 'evt_invoice_pay_1', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'pi_e2e_2', amount_received: sent.body.data.invoice.totalGrossMinor, currency: 'eur', metadata: { aimeat_reference: reference } } },
  };
  const r = await postWebhook(A.owner, event);
  assert(r.status === 200 && r.body.data.action === 'invoice_paid', `expected invoice_paid, got ${JSON.stringify(r.body)}`);
  const inv = await json(`/v1/finance/invoices/${sent.body.data.invoice.id}`, { headers: authed(A.token) });
  assert(inv.body.data.invoice.status === 'paid', 'invoice should be paid');
  assert(inv.body.data.invoice.paidTrackingCode === 'pi_e2e_2', 'trackingCode should link the payment');
});

await test('25. payout.paid books a TRANSFER voucher that leaves the VAT report untouched', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const before = await json(`/v1/finance/vat-report?from=${month}&to=${month}`, { headers: authed(A.token) });
  const event = {
    id: 'evt_payout_1', type: 'payout.paid', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'po_e2e_1', amount: 30000, currency: 'eur' } },
  };
  const r = await postWebhook(A.owner, event);
  assert(r.status === 200 && r.body.data.action === 'payout_booked', `expected payout_booked, got ${JSON.stringify(r.body)}`);
  const vouchers = await json('/v1/finance/vouchers?direction=transfer', { headers: authed(A.token) });
  assert(vouchers.body.data.vouchers.some((v: any) => v.externalRef === 'evt_payout_1'), 'transfer voucher missing');
  const after = await json(`/v1/finance/vat-report?from=${month}&to=${month}`, { headers: authed(A.token) });
  assert(after.body.data.report.vatPayableMinor === before.body.data.report.vatPayableMinor, 'transfer must not move the VAT report');
});

await test('26. charge.refunded books an expense voucher', async () => {
  const event = {
    id: 'evt_refund_1', type: 'charge.refunded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'ch_e2e_1', payment_intent: 'pi_e2e_1', amount_refunded: 12500, currency: 'eur' } },
  };
  const r = await postWebhook(A.owner, event);
  assert(r.status === 200 && r.body.data.action === 'refund_booked', `expected refund_booked, got ${JSON.stringify(r.body)}`);
  const vouchers = await json('/v1/finance/vouchers?source=stripe&direction=expense', { headers: authed(A.token) });
  assert(vouchers.body.data.vouchers.some((v: any) => v.externalRef === 'evt_refund_1'), 'refund voucher missing');
});

console.log('\nPhase 5 — Finvoice operator (mock adapter)');

await test('27. finvoice delivery submits to the operator and the status loop closes', async () => {
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify(draftBody({
      buyer: { name: 'Verkkolaskuostaja Oy', businessId: '7654321-1', einvoiceAddress: '003712345678', einvoiceOperator: '003721291126' },
    })),
  });
  assert(draft.status === 201, `draft failed: ${draft.status}`);
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'finvoice' }),
  });
  assert(sent.status === 200, `finvoice send failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  const inv = sent.body.data.invoice;
  assert(inv.operatorMessageId, 'operatorMessageId missing');
  assert(inv.deliveryStatus === 'pending', `expected pending, got ${inv.deliveryStatus}`);
  const refreshed = await json(`/v1/finance/invoices/${inv.id}/refresh-delivery`, { method: 'POST', headers: authed(A.token) });
  assert(refreshed.status === 200 && refreshed.body.data.invoice.deliveryStatus === 'delivered',
    `expected delivered after refresh, got ${refreshed.status} ${refreshed.body.data?.invoice?.deliveryStatus}`);
});

await test('28. the operator rejection flows back as deliveryStatus rejected', async () => {
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify(draftBody({
      buyer: { name: 'Hylkääjä Oy', einvoiceAddress: 'REJECT-003799999999' },
    })),
  });
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'finvoice' }),
  });
  assert(sent.status === 200, `send failed: ${sent.status}`);
  const refreshed = await json(`/v1/finance/invoices/${sent.body.data.invoice.id}/refresh-delivery`, { method: 'POST', headers: authed(A.token) });
  assert(refreshed.body.data.invoice.deliveryStatus === 'rejected', `expected rejected, got ${refreshed.body.data.invoice.deliveryStatus}`);
});

await test('29. finvoice delivery without an e-invoice address is refused (422)', async () => {
  const draft = await json('/v1/finance/invoices', { method: 'POST', headers: authed(A.token), body: JSON.stringify(draftBody()) });
  const sent = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'finvoice' }),
  });
  assert(sent.status === 422 && sent.body.error?.code === 'MISSING_EINVOICE_ADDRESS',
    `expected 422 MISSING_EINVOICE_ADDRESS, got ${sent.status} ${JSON.stringify(sent.body.error)}`);
  // The transition stood (number claimed, document exists) — only the delivery leg failed,
  // and the retry door works once the address is there.
  const inv = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}`, { headers: authed(A.token) });
  assert(inv.body.data.invoice.status === 'sent', 'invoice should remain sent (retryable delivery)');
  const retry = await json(`/v1/finance/invoices/${draft.body.data.invoice.id}/deliver-finvoice`, { method: 'POST', headers: authed(A.token) });
  assert(retry.status === 422, 'retry without address should still be 422');
});

console.log('\nPhase 6 — accountant role (read-only cross-owner grant)');

const C = await makeOwner('fintili');

await test('30. without a grant every cross-owner read is 403', async () => {
  const r = await json(`/v1/finance/invoices?owner=${A.owner}`, { headers: authed(C.token) });
  assert(r.status === 403 && r.body.error?.code === 'ACCOUNTANT_ACCESS_DENIED', `expected 403 ACCOUNTANT_ACCESS_DENIED, got ${r.status} ${JSON.stringify(r.body.error)}`);
  const v = await json(`/v1/finance/vouchers?owner=${A.owner}`, { headers: authed(C.token) });
  assert(v.status === 403, `vouchers should be 403, got ${v.status}`);
  const month = new Date().toISOString().slice(0, 7);
  const rep = await json(`/v1/finance/vat-report?from=${month}&owner=${A.owner}`, { headers: authed(C.token) });
  assert(rep.status === 403, `vat-report should be 403, got ${rep.status}`);
});

await test('31. the grant opens READ access to exactly the granting owner', async () => {
  const grant = await json('/v1/finance/accountants', { method: 'POST', headers: authed(A.token), body: JSON.stringify({ accountant: C.owner }) });
  assert(grant.status === 201, `grant failed: ${grant.status} ${JSON.stringify(grant.body)}`);
  const invoices = await json(`/v1/finance/invoices?owner=${A.owner}`, { headers: authed(C.token) });
  assert(invoices.status === 200 && invoices.body.data.total > 0, `accountant should see A's invoices, got ${invoices.status}`);
  const vouchers = await json(`/v1/finance/vouchers?owner=${A.owner}`, { headers: authed(C.token) });
  assert(vouchers.status === 200 && vouchers.body.data.total > 0, "accountant should see A's vouchers");
  const csv = await fetch(`${BASE}/v1/finance/export/vouchers.csv?owner=${A.owner}`, { headers: authed(C.token) });
  assert(csv.status === 200, `CSV export should open, got ${csv.status}`);
  // ...but not some third owner's books:
  const other = await json(`/v1/finance/invoices?owner=${B.owner}`, { headers: authed(C.token) });
  assert(other.status === 403, `B's books must stay closed, got ${other.status}`);
});

await test('32. the grant never opens WRITE (mutations ignore ?owner)', async () => {
  // A voucher booked by the accountant lands in the ACCOUNTANT'S own bucket, never the client's.
  const before = await json(`/v1/finance/vouchers?owner=${A.owner}`, { headers: authed(C.token) });
  const write = await json('/v1/finance/vouchers?owner=' + A.owner, {
    method: 'POST', headers: authed(C.token),
    body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), description: 'accountant write attempt', direction: 'expense', source: 'manual', amount_minor: 100 }),
  });
  assert(write.status === 201, 'the write itself succeeds — into C:s own books');
  const after = await json(`/v1/finance/vouchers?owner=${A.owner}`, { headers: authed(C.token) });
  assert(after.body.data.total === before.body.data.total, "A's voucher count must not change");
  const own = await json('/v1/finance/vouchers', { headers: authed(C.token) });
  assert(own.body.data.vouchers.some((v: any) => v.description === 'accountant write attempt'), "the voucher went to C's own bucket");
  // Direct mutation of A's invoice by id answers 404 (C's bucket has no such invoice).
  const pay = await json(`/v1/finance/invoices/${invoiceId}/mark-paid`, { method: 'POST', headers: authed(C.token), body: JSON.stringify({}) });
  assert(pay.status === 404, `mark-paid must be 404, got ${pay.status}`);
  // Fiscal-year locking is the client owner's own act, not the accountant's.
  const years = await json(`/v1/finance/fiscal-years?owner=${A.owner}`, { headers: authed(C.token) });
  const lock = await json(`/v1/finance/fiscal-years/${years.body.data.fiscal_years[0].id}/lock`, {
    method: 'POST', headers: authed(C.token), body: JSON.stringify({ locked: true }),
  });
  assert(lock.status === 404, `cross-owner lock must be 404, got ${lock.status}`);
});

await test('33. the clients list names the granting owner; revoke closes the door', async () => {
  const clients = await json('/v1/finance/clients', { headers: authed(C.token) });
  assert(clients.status === 200 && clients.body.data.clients.includes(A.ghii), `clients should include A, got ${JSON.stringify(clients.body.data)}`);
  const revoke = await json(`/v1/finance/accountants/${C.owner}`, { method: 'DELETE', headers: authed(A.token) });
  assert(revoke.status === 200, `revoke failed: ${revoke.status}`);
  const r = await json(`/v1/finance/invoices?owner=${A.owner}`, { headers: authed(C.token) });
  assert(r.status === 403, `after revoke reads must be 403 again, got ${r.status}`);
  const clients2 = await json('/v1/finance/clients', { headers: authed(C.token) });
  assert(!clients2.body.data.clients.includes(A.ghii), 'the verified clients list must drop A after revoke');
});

await test('34b. the P&L summary sums income, expenses and the result, transfers aside', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const r = await json(`/v1/finance/pnl?from=${month}&to=${month}`, { headers: authed(A.token) });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  const rep = r.body.data.report;
  assert(rep.totalIncomeMinor > 0, 'income should be positive (paid invoice + stripe + webhook charges)');
  assert(rep.totalExpenseMinor > 0, 'expenses should be positive (receipt + refund vouchers)');
  assert(rep.resultMinor === rep.totalIncomeMinor - rep.totalExpenseMinor, 'result must be income − expenses');
  assert(rep.transferCount >= 1, 'the payout transfer should be counted');
  assert(!rep.income.some((l: any) => l.source === 'morsel' && l.amountMinor === undefined), 'line shape sane');
  assert(typeof rep.aiCostUsd === 'number', 'AI cost line present');
  // The accountant grant covers the P&L too — and its absence refuses it.
  const denied = await json(`/v1/finance/pnl?from=${month}&owner=${A.owner}`, { headers: authed(B.token) });
  assert(denied.status === 403, `cross-owner P&L without a grant must be 403, got ${denied.status}`);
});

await test('34. only the owner role manages accountants (agent → 403)', async () => {
  const r = await json('/v1/finance/accountants', { method: 'POST', headers: authed(narrowAgentToken), body: JSON.stringify({ accountant: C.owner }) });
  assert(r.status === 403, `agent grant should be 403, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

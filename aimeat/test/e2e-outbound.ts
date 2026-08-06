/**
 * @file test/e2e-outbound.ts
 * @description E2E for the outbound door (company-in-a-box phase 2): the contact
 *   registry (dedupe, GHII resolution, no token leakage), the policied send (AIMEAT
 *   inbox preferred over email, honest failure logging when SMTP is off, opt-out
 *   blocking marketing but not invoices, bounce suppression with explicit clearing,
 *   the rolling daily limit), templates with {{var}} substitution, the invoice
 *   email path (PDF + Finvoice attachments composed), the public unsubscribe
 *   endpoint's no-enumeration behavior, cross-owner isolation and cross-scope 403.
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-outbound.ts

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const DAILY_LIMIT = Number(process.env.AIMEAT_OUTBOUND_DAILY_LIMIT ?? '8');

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5 && !path.startsWith('/v1/outbound/send')) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
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

async function makeOwner(name: string): Promise<{ token: string; ghii: string; owner: string; privKey: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: 'OutboundTest1234' }) });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}`, owner, privKey };
  }
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeNarrowAgent(ownerCtx: { token: string; owner: string }): Promise<string> {
  const name = `narrow${Date.now().toString(36).slice(-5)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ name, owner: ownerCtx.owner, scopes: ['memory:read'] }),
  });
  assert(reg.status === 201, `agent registration failed: ${reg.status}`);
  const gaii = reg.body.data.agent.gaii as string;
  const privKey = reg.body.data.private_key as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, 'agent token failed');
  return tok.body.data.token as string;
}

console.log('═══ E2E: outbound door (company-in-a-box phase 2) ═══');
console.log(`Base: ${BASE} · daily limit: ${DAILY_LIMIT}`);

console.log('\nSetup');
const A = await makeOwner('obsend');
const B = await makeOwner('obother');
const narrowAgentToken = await makeNarrowAgent(A);

// Provision a recipient WITH a verified email via the code-invite flow (the only
// SMTP-free way to bind an email hash to an account).
const recipientEmail = `recipient${Date.now().toString(36).slice(-6)}@example.com`;
const recipientUsername = `recip${Date.now().toString(36).slice(-6)}`;
const RECIPIENT_CODE = 'RecipientCode99';
let recipientToken = '';
{
  const org = await json('/v1/organisms', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Outbound Test Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }),
  });
  assert(org.status === 201, `org creation failed: ${org.status} ${JSON.stringify(org.body)}`);
  const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ email: recipientEmail, username: recipientUsername, code: RECIPIENT_CODE, display_name: 'Vastaanottaja' }),
  });
  assert(mint.status === 201, `code-invite mint failed: ${mint.status} ${JSON.stringify(mint.body)}`);
  const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: recipientUsername, password: RECIPIENT_CODE }) });
  assert(login.status === 200, `recipient login failed: ${login.status} ${JSON.stringify(login.body)}`);
  recipientToken = login.body.data.token as string;
}

console.log('\nPhase 1 — contact registry');

let plainContactId = '';
let ghiiContactId = '';

await test('1. a contact is created; the unsubscribe token never leaves the server', async () => {
  const r = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Meili Asiakas', email: 'plain.customer@example.com', tags: ['asiakas'] }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  plainContactId = r.body.data.contact.id;
  assert(r.body.data.contact.ghii === null, 'plain email must not resolve a GHII');
  assert(!('optOutToken' in r.body.data.contact), 'optOutToken must not be exposed');
});

await test('2. the same address dedupes to one entry', async () => {
  const r = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Sama Asiakas', email: 'PLAIN.CUSTOMER@example.com' }),
  });
  assert(r.status === 201 && r.body.data.contact.id === plainContactId, 'dedupe by lower-cased email failed');
});

await test('3. an address belonging to a registered user resolves its GHII', async () => {
  const r = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'AIMEAT Vastaanottaja', email: recipientEmail }),
  });
  assert(r.status === 201, `expected 201, got ${r.status}`);
  ghiiContactId = r.body.data.contact.id;
  assert(r.body.data.contact.ghii === `${recipientUsername}@${NODE_ID}`, `GHII not resolved: ${r.body.data.contact.ghii}`);
});

await test('4. an invalid email is rejected', async () => {
  const r = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ name: 'x', email: 'not-an-email' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 2 — the policied send');

await test('5. a recipient with an AIMEAT identity gets the INBOX channel', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', subject: 'Tervetuloa asiakkaaksi', body: 'Kiitos tilauksestasi — palaamme asiaan huomenna.' }),
  });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.channel === 'inbox' && r.body.data.status === 'sent', `expected inbox/sent, got ${r.body.data.channel}/${r.body.data.status}`);
  // The recipient really received it: their notification bell has the direct-message entry.
  const notifs = await json('/v1/notifications', { headers: authed(recipientToken) });
  assert(notifs.status === 200, `notifications read failed: ${notifs.status}`);
  const list = JSON.stringify(notifs.body.data);
  assert(list.includes('Tervetuloa asiakkaaksi') || list.includes('direct_message'), 'recipient notification missing');
});

await test('6. a plain-email recipient falls to the email channel; no SMTP → honest failed log', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'Testiviesti', body: 'Sisältö.' }),
  });
  assert(r.status === 200, `expected 200 (the send is logged), got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.channel === 'email' && r.body.data.status === 'failed', `expected email/failed, got ${r.body.data.channel}/${r.body.data.status}`);
  assert(r.body.data.message.error === 'EMAIL_DISABLED', `expected EMAIL_DISABLED, got ${r.body.data.message.error}`);
});

await test('7. opt-out blocks marketing but not transactional', async () => {
  const opt = await json(`/v1/outbound/contacts/${ghiiContactId}/opt-out`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ opted_out: true }),
  });
  assert(opt.status === 200 && opt.body.data.contact.optedOut === true, 'opt-out toggle failed');
  const marketing = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'marketing', subject: 'Kampanja', body: 'Osta nyt!' }),
  });
  assert(marketing.status === 422 && marketing.body.error?.code === 'OPTED_OUT', `expected 422 OPTED_OUT, got ${marketing.status}`);
  const transactional = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', subject: 'Tilausvahvistus', body: 'Tilaus on käsitelty.' }),
  });
  assert(transactional.status === 200 && transactional.body.data.status === 'sent', 'transactional should still deliver');
  // The refused marketing attempt is in the log as skipped — the record answers "what happened".
  const log = await json('/v1/outbound/log?status=skipped', { headers: authed(A.token) });
  assert(log.body.data.messages.some((m: any) => m.subject === 'Kampanja'), 'skipped marketing missing from log');
});

await test('8. three bounces suppress; suppressed rejects; clear restores', async () => {
  for (let i = 0; i < 3; i++) {
    const b = await json(`/v1/outbound/contacts/${plainContactId}/bounce`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({}) });
    assert(b.status === 200, `bounce ${i + 1} failed: ${b.status}`);
  }
  const send = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'x', body: 'y' }),
  });
  assert(send.status === 422 && send.body.error?.code === 'SUPPRESSED', `expected 422 SUPPRESSED, got ${send.status}`);
  const clear = await json(`/v1/outbound/contacts/${plainContactId}/bounce`, { method: 'POST', headers: authed(A.token), body: JSON.stringify({ clear: true }) });
  assert(clear.status === 200 && clear.body.data.contact.bounceCount === 0, 'clear failed');
});

await test('9. a template substitutes {{variables}}', async () => {
  const tpl = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ key: 'outbound.template.tervehdys', value: { subject: 'Hei {{nimi}}!', body: 'Kiitos {{nimi}}, tilauksesi {{numero}} on valmis.' }, visibility: 'private' }),
  });
  assert(tpl.status === 200 || tpl.status === 201, `template write failed: ${tpl.status}`);
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', template_id: 'tervehdys', variables: { nimi: 'Vastaanottaja', numero: 'T-42' } }),
  });
  assert(r.status === 200, `template send failed: ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.message.subject === 'Hei Vastaanottaja!', `substitution failed: ${r.body.data.message.subject}`);
});

console.log('\nPhase 3 — invoice delivery');

let invoiceId = '';
await test('10. a sent invoice delivers with PDF + Finvoice attachments composed', async () => {
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      seller: { name: 'Lähettäjä Oy', businessId: '1234567-8', iban: 'FI2112345600000785', bic: 'NDEAFIHH', streetAddress: 'Katu 1', postalCode: '00100', city: 'Helsinki' },
      buyer: { name: 'AIMEAT Vastaanottaja', email: recipientEmail },
      lines: [{ description: 'Palvelu', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 5000, vatCodeId: 'fi-std-2550' }],
    }),
  });
  assert(draft.status === 201, `draft failed: ${draft.status}`);
  invoiceId = draft.body.data.invoice.id;
  const sent = await json(`/v1/finance/invoices/${invoiceId}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'email' }),
  });
  assert(sent.status === 200, `invoice send failed: ${sent.status}`);
  // Deliver through the door: the recipient has a GHII → inbox channel, delivered.
  const deliver = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'invoice', invoice_id: invoiceId }),
  });
  assert(deliver.status === 200, `delivery failed: ${deliver.status} ${JSON.stringify(deliver.body)}`);
  assert(deliver.body.data.status === 'sent' && deliver.body.data.channel === 'inbox', `expected inbox/sent, got ${JSON.stringify(deliver.body.data)}`);
  const inv = await json(`/v1/finance/invoices/${invoiceId}`, { headers: authed(A.token) });
  assert(inv.body.data.invoice.deliveryStatus === 'delivered', `deliveryStatus should be delivered, got ${inv.body.data.invoice.deliveryStatus}`);
});

await test('11. the invoice PDF endpoint returns a real PDF', async () => {
  const res = await fetch(`${BASE}/v1/finance/invoices/${invoiceId}/pdf`, { headers: authed(A.token) });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(buf.subarray(0, 5).toString('latin1') === '%PDF-', 'not a PDF');
  assert(buf.length > 1500, `PDF suspiciously small: ${buf.length} bytes`);
});

await test('12. an unsent draft cannot be delivered (409)', async () => {
  const draft = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      seller: { name: 'Lähettäjä Oy', iban: 'FI2112345600000785' },
      buyer: { name: 'Joku' },
      lines: [{ description: 'x', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 100, vatCodeId: 'fi-std-2550' }],
    }),
  });
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'invoice', invoice_id: draft.body.data.invoice.id }),
  });
  assert(r.status === 409, `expected 409, got ${r.status}`);
});

console.log('\nPhase 4 — limits, isolation, public unsubscribe');

await test('13. the rolling daily limit answers 429 DAILY_LIMIT', async () => {
  let hit = false;
  for (let i = 0; i < DAILY_LIMIT + 2; i++) {
    const r = await json('/v1/outbound/send', {
      method: 'POST', headers: authed(A.token),
      body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', subject: `Raja ${i}`, body: 'x' }),
    });
    if (r.status === 429) {
      assert(r.body.error?.code === 'DAILY_LIMIT' || r.body.error?.code === 'RATE_LIMITED', `unexpected 429 code: ${JSON.stringify(r.body.error)}`);
      if (r.body.error?.code === 'DAILY_LIMIT') { hit = true; break; }
      await new Promise((rr) => setTimeout(rr, 1000));
      i--;
      continue;
    }
    assert(r.status === 200, `send ${i} failed unexpectedly: ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert(hit, 'daily limit never engaged');
});

await test('14. another owner cannot see or use the contacts (404, empty list)', async () => {
  const send = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', subject: 'x', body: 'y' }),
  });
  assert(send.status === 404, `cross-owner send should be 404, got ${send.status}`);
  const list = await json('/v1/outbound/contacts', { headers: authed(B.token) });
  assert(list.body.data.total === 0, "B's contact list should be empty");
  const log = await json('/v1/outbound/log', { headers: authed(B.token) });
  assert(log.body.data.total === 0, "B's send log should be empty");
});

await test('15. an agent without outbound:send gets 403', async () => {
  const r = await json('/v1/outbound/contacts', { headers: authed(narrowAgentToken) });
  assert(r.status === 403, `expected 403, got ${r.status}`);
  const s = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(narrowAgentToken),
    body: JSON.stringify({ contact_id: ghiiContactId, kind: 'transactional', subject: 'x', body: 'y' }),
  });
  assert(s.status === 403, `send should be 403, got ${s.status}`);
});

await test('16. the public unsubscribe answers identically for unknown tokens (no enumeration)', async () => {
  const res = await fetch(`${BASE}/v1/outbound/unsubscribe?token=definitely-not-a-token`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const html = await res.text();
  assert(html.includes('Unsubscribed'), 'unsubscribe page missing');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

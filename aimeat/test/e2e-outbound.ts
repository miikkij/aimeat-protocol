/**
 * @file test/e2e-outbound.ts
 * @description E2E for the outbound door (company-in-a-box phase 2): the contact
 *   registry (dedupe, GHII resolution, no token leakage), the policied send (AIMEAT
 *   inbox preferred over email, a send with no transport logged AND answered as
 *   503 SEND_FAILED naming the logged row, opt-out blocking marketing but not
 *   invoices, bounce suppression with explicit clearing, the rolling daily limit),
 *   templates with {{var}} substitution, the invoice email path (PDF + Finvoice
 *   attachments composed), the public unsubscribe endpoint's no-enumeration
 *   behavior, cross-owner isolation and cross-scope 403.
 *
 *   SMTP is off in this environment, so every plain-email send here ends in 503 SEND_FAILED with
 *   reason EMAIL_DISABLED. That answer is what "every policy gate passed" looks like: a refusal from
 *   a gate is 400, 403, 404, 422 or 429 and never reaches the transport.
 * @version-history
 *   v1.5.0 — 2026-09-25 — Test 18: an app holding outbound:send saves an address that has an account
 *     here and is not told so, on the save, the list, the send or the log; the owner in person still
 *     sees the link on the list, the log and the address book.
 *   v1.4.0 — 2026-09-15 — Test 6c: a contact that is the sender's own address takes the email
 *     channel. It took the inbox channel and answered 500 on a duplicate message key on a live node.
 *   v1.3.0 — 2026-09-13 — POST /v1/outbound/send answers a send that did not go out with SEND_FAILED
 *     (503 here, where there is no transport) instead of 200, with the send-log id and the reason in
 *     error.details (the developer's decision of 2026-09-13). Tests 6 and 6b assert the new answer
 *     and the row it names; 15e, 15f, 15g and 17 read "the gates passed" from it where they read a
 *     200 'failed' before; 7 and 8 assert that OPTED_OUT and SUPPRESSED name their logged row; 14
 *     asserts a cross-owner refusal names none.
 *   v1.2.0 — 2026-09-13 — Test 6b pins the fields of a failed send's 200 answer that aimeat_mail_send
 *     on the connector doors reads to answer it as an error (appdev pitfall
 *     send-200-is-not-a-delivery), and that the log row carries the id and reason it names.
 *   v1.1.0 — 2026-08-16 — E2E quality, outbound:343: the unsubscribe was only ever fetched with an
 *     unknown token, so the opt-out it exists to perform was never measured and the route could
 *     have stopped writing unnoticed. Test 17 reads the recipient's real token out of the database
 *     under test (there is no HTTP path to it), uses the link, and proves the write through the API
 *     plus a refused marketing send — with the page asserted byte-identical to the unknown-token one.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-outbound.ts

import { createHash, randomBytes } from 'node:crypto';
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

/**
 * The answer to a send that passed every gate and had no transport to leave through: 503
 * SEND_FAILED, no `data`, and the logged row named in `error.details`. Returns the details so a test
 * can follow the row into the send log.
 */
function assertNoTransport(r: { status: number; body: any }, label: string): { message_id: string; status: string; channel: string; reason: string } {
  assert(r.status === 503, `${label}: expected 503, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.ok === false && r.body.data === undefined, `${label}: a send that did not go out must not carry data: ${JSON.stringify(r.body)}`);
  assert(r.body.error?.code === 'SEND_FAILED', `${label}: expected SEND_FAILED, got ${r.body.error?.code}`);
  const d = r.body.error.details;
  assert(typeof d?.message_id === 'string' && d.message_id.length > 0, `${label}: details.message_id: ${JSON.stringify(d)}`);
  assert(d.status === 'failed', `${label}: details.status: ${d.status}`);
  assert(d.channel === 'email', `${label}: details.channel: ${d.channel}`);
  assert(d.reason === 'EMAIL_DISABLED', `${label}: details.reason: ${d.reason}`);
  return d;
}

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

await test('6. a plain-email recipient falls to the email channel; no SMTP → 503 SEND_FAILED, not a 200', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'Testiviesti', body: 'Sisältö.' }),
  });
  // It answered 200 with data.status 'failed' until 2026-09-13, which a caller reading the status or
  // `ok` took for a sent message.
  const d = assertNoTransport(r, 'plain-email send with SMTP off');
  // The channel is this test's subject: no identity here, so the email channel was the one tried.
  assert(d.channel === 'email', `expected the email channel, got ${d.channel}`);
});

await test('6b. a failed send names its send-log row, and the row says the same', async () => {
  // The id and the reason ride in error.details so a caller can still find the attempt, and the
  // connector and CLI doors lift exactly these fields into the tool's error (refuseUnsentSend in
  // cli/connect/tool-call-defs-connections.ts). A rename here would leave those doors answering
  // SEND_FAILED with no row to point at, with nothing else going red.
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'Sopimusviesti', body: 'Sisältö.' }),
  });
  const d = assertNoTransport(r, 'failed send');
  assert(typeof r.body.error.message === 'string' && r.body.error.message.includes(d.message_id),
    `the sentence must name the row too, for a caller that reads only the message: ${r.body.error.message}`);
  const hint = (r.body.hints?.next_actions ?? []).find((h: any) => h.method === 'GET' && String(h.url).startsWith('/v1/outbound/log'));
  assert(hint?.url === '/v1/outbound/log?status=failed', `the error must point at the log read that lists the row: ${JSON.stringify(r.body.hints)}`);
  const log = await json('/v1/outbound/log?status=failed&per_page=200', { headers: authed(A.token) });
  assert(log.status === 200, `log read: ${log.status}`);
  const row = (log.body.data.messages as any[]).find(m => m.id === d.message_id);
  assert(row !== undefined, 'the failed attempt must be in the send log under the id the answer named');
  assert(row.status === 'failed' && row.error === 'EMAIL_DISABLED', `log row: ${JSON.stringify(row)}`);
  assert(row.subject === 'Sopimusviesti', `the row must be this attempt, got subject ${row.subject}`);
});

await test('6c. a contact that is the sender\'s OWN address takes the email channel, not a 500', async () => {
  // 2026-09-15 on a live node: a campaign send to the sender's own verified address took the inbox
  // channel, wrote the message to the sender twice under one key and answered 500. Nothing was sent.
  const own = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(recipientToken),
    body: JSON.stringify({ name: 'Minä itse', email: recipientEmail }),
  });
  assert(own.status === 201, `own-address contact: ${own.status} ${JSON.stringify(own.body)}`);
  assert(own.body.data.contact.ghii === `${recipientUsername}@${NODE_ID}`, `the own address resolves to the sender: ${own.body.data.contact.ghii}`);
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(recipientToken),
    body: JSON.stringify({ contact_id: own.body.data.contact.id, kind: 'marketing', subject: 'Kampanjan testi', body: 'Näin viesti näkyy vastaanottajalle.' }),
  });
  assert(r.status !== 500, `a send to your own address must not be a node fault: ${JSON.stringify(r.body)}`);
  const d = assertNoTransport(r, 'send to own address with SMTP off');
  assert(d.channel === 'email', `expected the email channel, got ${d.channel}`);
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
  // The refused marketing attempt is in the log as skipped, so the record answers "what happened",
  // and the refusal names that row the same way a failed send does.
  const log = await json('/v1/outbound/log?status=skipped', { headers: authed(A.token) });
  const skipped = (log.body.data.messages as any[]).find((m: any) => m.subject === 'Kampanja');
  assert(skipped !== undefined, 'skipped marketing missing from log');
  assert(marketing.body.error.details?.message_id === skipped.id && marketing.body.error.details?.status === 'skipped',
    `OPTED_OUT must name its logged row ${skipped.id}, got ${JSON.stringify(marketing.body.error.details)}`);
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
  assert(send.body.error.details?.status === 'suppressed' && typeof send.body.error.details?.message_id === 'string',
    `SUPPRESSED must name its logged row: ${JSON.stringify(send.body.error.details)}`);
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
  // Refused before any row was written, so there is no send-log id to hand another owner.
  assert(send.body.error?.details === undefined, `a cross-owner refusal must name no logged row: ${JSON.stringify(send.body.error)}`);
  // And A's plain-email contact, which would reach the transport for A, is just as absent for B.
  const plain = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'x', body: 'y' }),
  });
  assert(plain.status === 404 && plain.body.error?.details === undefined,
    `cross-owner send to a plain contact should be a bare 404, got ${plain.status} ${JSON.stringify(plain.body.error)}`);
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

// ── Sending through the caller's OWN connected mailbox ───────────────────────────────────────
// The transport itself needs a real Google or Microsoft account and cannot be driven here. What CAN
// be driven, and is what would actually go wrong, is every refusal on the way to it: a mailbox that
// is not yours, one that does not exist, one connected for reading only, and a session that holds
// outbound:send but not connections:use. Each of those is a way to send in somebody else's name.

await test('15b. naming a mailbox that does not exist is refused, and says nothing about whose it might be', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      contact_id: plainContactId, kind: 'transactional', subject: 'x', body: 'y',
      connection_id: '00000000-0000-4000-8000-000000000000',
    }),
  });
  assert(r.status === 404 && r.body.error.code === 'NO_SUCH_MAILBOX',
    `expected 404 NO_SUCH_MAILBOX, got ${r.status} ${r.body?.error?.code}`);
  // "No such connection" and "not yours" answer identically on purpose: telling one owner that
  // another owner's connection exists is a disclosure, and neither answer helps them.
  assert(!/belongs|another|owner/i.test(r.body.error.message),
    `the refusal must not hint at ownership: ${r.body.error.message}`);
});

await test('15c. a malformed request is refused before anything is sent', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      contact_id: plainContactId, kind: 'transactional', subject: 'x', body: 'y',
      connection_id: 'x'.repeat(200),
    }),
  });
  assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body?.error)}`);
  const log = await json('/v1/outbound/log?per_page=200', { headers: authed(A.token) });
  const rows = log.body.data.messages as Array<{ subject: string }>;
  assert(!rows.some(m => m.subject === 'x' && rows.filter(z => z.subject === 'x').length > 2),
    'a refused request must not multiply rows in the log');
});

await test('15d. outbound:send alone does not reach a connected mailbox', async () => {
  // The narrow agent has neither word, so it is refused before the mailbox is even looked up. The
  // property under test is that naming a connection cannot ROUTE AROUND a missing permission.
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(narrowAgentToken),
    body: JSON.stringify({
      contact_id: plainContactId, kind: 'transactional', subject: 'x', body: 'y',
      connection_id: '00000000-0000-4000-8000-000000000000',
    }),
  });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('15e. the send log records WHO pressed send, and can be filtered by it', async () => {
  // Owner B, whose own book is untouched: A's allowance was deliberately exhausted by test 13, and
  // a 429 here would say nothing about attribution.
  const created = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ name: 'Attribution', email: `attrib-${Date.now()}@example.com` }),
  });
  assert(created.status === 201, `contact: ${created.status} ${JSON.stringify(created.body?.error)}`);
  const bContactId = created.body.data.contact.id as string;

  // SMTP is off, so the attempt is refused at the transport and answered 503; the row it wrote is
  // what carries the attribution, and the answer names that row.
  const send = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: bContactId, kind: 'transactional', subject: 'attributed', body: 'y' }),
  });
  const attempt = assertNoTransport(send, 'attributed send');

  // `me` is resolved server-side: a client composing its own principal string gets it wrong for an
  // agent, whose sends are recorded under the agent's own GAII.
  const mine = await json('/v1/outbound/log?sent_by=me&per_page=200', { headers: authed(B.token) });
  assert(mine.status === 200, `log: ${mine.status}`);
  const rows = mine.body.data.messages as Array<{ id: string; subject: string; sentBy: string | null }>;
  const row = rows.find(m => m.id === attempt.message_id);
  assert(row !== undefined, `sent_by=me must find my own attempt ${attempt.message_id}: ${rows.map(m => m.subject).join(', ')}`);
  assert(row!.subject === 'attributed', `the row the answer named is another attempt: ${row!.subject}`);
  assert(row!.sentBy === B.ghii, `the log row must name the sender ${B.ghii}, got ${String(row!.sentBy)}`);

  const someoneElse = await json('/v1/outbound/log?sent_by=nobody@nowhere&per_page=200', { headers: authed(B.token) });
  assert((someoneElse.body.data.messages as unknown[]).length === 0,
    'filtering by a principal who sent nothing must return nothing');
});

await test('15f. the AI mark is optional, and a word outside the vocabulary is refused', async () => {
  const created = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ name: 'Disclosure', email: `disc-${Date.now()}@example.com` }),
  });
  const cid = created.body.data.contact.id as string;

  // Declaring nothing is the ordinary case and must not be refused: the law does not oblige a mark
  // on a message to one customer, so a node that demanded one would be inventing an obligation.
  // "Not refused" reads as reaching the transport, which is off here: 503 SEND_FAILED, never a 400.
  const plain = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: cid, kind: 'transactional', subject: 'plain', body: 'y' }),
  });
  assertNoTransport(plain, 'undeclared send');

  const declared = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({
      contact_id: cid, kind: 'transactional', subject: 'declared', body: 'y',
      ai_disclosure: 'ai-generated',
    }),
  });
  assertNoTransport(declared, 'declared send');

  const withRecord = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({
      contact_id: cid, kind: 'transactional', subject: 'declared with record', body: 'y',
      ai_disclosure: { level: 'ai-assisted', provenance_id: 'prov-1' },
    }),
  });
  assertNoTransport(withRecord, 'declared with record');

  // A near-miss is refused rather than coerced to the nearest word: quietly turning 'ai' into
  // 'ai-generated' would make the field mean whatever the caller happened to type.
  for (const bad of ['ai', 'generated', 'AI-GENERATED']) {
    const r = await json('/v1/outbound/send', {
      method: 'POST', headers: authed(B.token),
      body: JSON.stringify({ contact_id: cid, kind: 'transactional', subject: 'x', body: 'y', ai_disclosure: bad }),
    });
    assert(r.status === 400, `"${bad}" was accepted: ${r.status}`);
  }
});

await test('15g. themes are listed already validated, and a bad one never reaches a recipient', async () => {
  // THE LIST IS WHERE A BROKEN THEME IS CAUGHT, because the send path deliberately will not refuse
  // over decoration. Without this route an owner's typo is discovered by their customer.
  const before = await json('/v1/outbound/themes', { headers: authed(B.token) });
  assert(before.status === 200, `themes: ${before.status}`);
  const ids = (before.body.data.themes as { id: string }[]).map(t => t.id);
  for (const want of ['clean', 'space', 'warm', 'paper']) {
    assert(ids.includes(want), `built-in "${want}" missing: ${ids.join(', ')}`);
  }
  assert(before.body.data.default === 'clean', 'the default must stay the pre-themes look');
  assert((before.body.data.themes as { ok: boolean }[]).every(t => t.ok), 'a built-in reported a problem');

  // An owner's own theme, with one field that is a second CSS declaration rather than a colour.
  const stored = await json('/v1/memory', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({
      key: 'outbound.theme.house',
      value: { card: '#101820', accent: '#fff;background:url(x)' },
      visibility: 'private',
    }),
  });
  assert(stored.status === 200 || stored.status === 201, `theme write failed: ${stored.status}`);

  const after = await json('/v1/outbound/themes', { headers: authed(B.token) });
  const house = (after.body.data.themes as { id: string; source: string; ok: boolean; tokens: Record<string, string>; problems: { field: string }[] }[])
    .find(t => t.id === 'house');
  assert(house, 'a theme this owner stored is not listed');
  assert(house!.source === 'own', `source: ${house!.source}`);
  assert(house!.ok === false, 'a theme carrying a second declaration was reported as fine');
  assert(house!.problems.some(p => p.field === 'accent'), `problems: ${JSON.stringify(house!.problems)}`);
  // The good field survives; only the unusable one falls back.
  assert(house!.tokens.card === '#101820', `card: ${house!.tokens.card}`);
  assert(!house!.tokens.accent.includes('url('), `the bad value reached the tokens: ${house!.tokens.accent}`);

  const created = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ name: 'Theme', email: `theme-${Date.now()}@example.com` }),
  });
  const cid = created.body.data.contact.id as string;

  // Naming that half-broken theme still SENDS: a bad shade of grey is not a reason for somebody's
  // customer to hear nothing. Here that means it reaches the transport, which is off: 503
  // SEND_FAILED for want of SMTP, and not a refusal over the theme.
  const sent = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: cid, kind: 'transactional', subject: 'themed', body: 'y', theme: 'house' }),
  });
  assertNoTransport(sent, 'themed send');

  // And so does a theme nobody has. An unknown id is the default look, not an error.
  const unknown = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: cid, kind: 'transactional', subject: 'x', body: 'y', theme: 'no-such-theme' }),
  });
  assertNoTransport(unknown, 'unknown theme');
});

await test('15h. another owner does not see or inherit my themes', async () => {
  const mine = await json('/v1/outbound/themes', { headers: authed(A.token) });
  const ids = (mine.body.data.themes as { id: string; source: string }[]);
  assert(!ids.some(t => t.source === 'own'), `owner A sees somebody else's theme: ${JSON.stringify(ids)}`);
});

await test('16. the public unsubscribe answers identically for unknown tokens (no enumeration)', async () => {
  const res = await fetch(`${BASE}/v1/outbound/unsubscribe?token=definitely-not-a-token`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const html = await res.text();
  assert(html.includes('Unsubscribed'), 'unsubscribe page missing');
});

/**
 * Test 16 fetches an unknown token, so the page it reads is the page the route renders when it
 * does nothing. Nothing here has ever carried a REAL token to that door, which means the opt-out
 * itself — the recipient's own capability, and the one thing on this endpoint that must work
 * without a login — was never measured. The route could have stopped writing and the suite would
 * still be green.
 *
 * Owner B, not A: test 13 exhausts A's rolling daily limit on purpose, so every send under A
 * after it answers 429. B's counter is untouched, and the three sends here stay well under the
 * limit. Placement after test 14 matters too, since that test asserts B's contact list is empty.
 *
 * The token is read straight out of the database the server under test is running. There is no
 * HTTP path to it (publicContact() strips it from every response and test 1 asserts that) and the
 * email that would carry the link is never delivered, SMTP being pinned off. Same move as
 * e2e-extension-secrets, which opens the same sqlite file read-only while the server holds it.
 */
async function readOptOutToken(contactId: string): Promise<string | null> {
  const backend = process.env.AIMEAT_STORAGE ?? process.env.AIMEAT_DB ?? 'memory';
  if (backend === 'sqlite') {
    const { serverSqlitePath } = await import('./helpers/server-db.js');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(serverSqlitePath(), { readonly: true });
    try {
      const row = db.prepare('SELECT optOutToken FROM outbound_contacts WHERE id = ?').get(contactId) as { optOutToken?: string } | undefined;
      return row?.optOutToken ?? null;
    } finally { db.close(); }
  }
  if (backend === 'postgres-kysely') {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // Quoted camelCase on this backend; the sqlite table is snake_case with the same columns.
      const r = await client.query('SELECT "optOutToken" FROM "OutboundContact" WHERE "id" = $1', [contactId]);
      return r.rows[0]?.optOutToken ?? null;
    } finally { await client.end(); }
  }
  return null;
}

await test('17. a REAL unsubscribe token opts the recipient out, and the page gives nothing away', async () => {
  const stamp = Date.now();
  const created = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ name: 'Peruuttaja', email: `unsub${stamp}@example.com` }),
  });
  assert(created.status === 201, `contact: expected 201, got ${created.status} ${JSON.stringify(created.body)}`);
  const contactId = created.body.data.contact.id as string;

  // Positive control: marketing is deliverable BEFORE the unsubscribe, so the 422 further down is
  // the opt-out and not an unknown contact. 503 SEND_FAILED is the transport (SMTP is off), which
  // is only reached once every policy gate has passed.
  const before = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: contactId, kind: 'marketing', subject: 'Kampanja ennen', body: 'x' }),
  });
  assertNoTransport(before, 'marketing before opt-out');

  const token = await readOptOutToken(contactId);
  if (!token) { console.log('    (skip: no readable database for this backend)'); return; }

  // The route answers text/html, so the suite's json() helper is the wrong tool here.
  const real = await fetch(`${BASE}/v1/outbound/unsubscribe?token=${encodeURIComponent(token)}`);
  assert(real.status === 200, `real token: expected 200, got ${real.status}`);
  const realHtml = await real.text();
  const unknown = await fetch(`${BASE}/v1/outbound/unsubscribe?token=definitely-not-a-token`);
  const unknownHtml = await unknown.text();
  assert(realHtml === unknownHtml, 'the page must be byte-identical for a real and an unknown token, or the link confirms the address exists');

  // The read-back is through the API, which is where an owner would see it.
  const list = await json('/v1/outbound/contacts', { headers: authed(B.token) });
  assert(list.status === 200, `list: ${list.status}`);
  const row = (list.body.data.contacts as any[]).find(c => c.id === contactId);
  assert(!!row, 'the contact must still be there');
  assert(row.optedOut === true, `the unsubscribe must have been written, got optedOut=${row.optedOut}`);
  assert(typeof row.optOutAt === 'string', `and stamped, got optOutAt=${JSON.stringify(row.optOutAt)}`);
  assert(!('optOutToken' in row), 'the token stays server-side even after it has been used');

  // …and the state has teeth: marketing is refused, invoices still go.
  const after = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: contactId, kind: 'marketing', subject: 'Kampanja jälkeen', body: 'x' }),
  });
  assert(after.status === 422 && after.body.error?.code === 'OPTED_OUT',
    `marketing after opt-out: expected 422 OPTED_OUT, got ${after.status} ${JSON.stringify(after.body.error)}`);
  const transactional = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({ contact_id: contactId, kind: 'transactional', subject: 'Lasku', body: 'x' }),
  });
  assertNoTransport(transactional, 'transactional after opt-out');
});

/** A grant for a new app of `ownerCtx` carrying exactly `scope`, through the consent the owner presses. */
async function appGrant(ownerCtx: { token: string; owner: string }, scope: string): Promise<string> {
  const filename = `obapp${Date.now().toString(36).slice(-5)}.html`;
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ filename, content: Buffer.from('<!DOCTYPE html><html><body>outbound</body></html>').toString('base64'),
      name: 'Outbound Probe', description: 'outbound e2e probe app', category: 'utility' }),
  });
  assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const verifier = randomBytes(32).toString('base64url');
  const redirect = 'http://localhost:9911/callback';
  const q = new URLSearchParams({ app: `${ownerCtx.owner}/${filename}`, response_type: 'code', scope, redirect_uri: redirect,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
  assert(!!m, `consent redirect expected, got ${res.status}`);
  const con = await json('/v1/app-grants/authorize-consent', {
    method: 'POST', headers: authed(ownerCtx.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
  });
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', {
    method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }),
  });
  assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
  return tok.body.data.access_token as string;
}

// Saving a contact is uncounted, so an app can save addresses in bulk. What the save must not do is
// tell anyone but the owner in person which of those addresses have an account here: that is the
// email lookup's answer, and the lookup is limited per account.
await test('18. an app that saves an address with an account here is not told so; the owner in person still sees the link', async () => {
  const C = await makeOwner('obapp');
  const recipientGhii = `${recipientUsername}@${NODE_ID}`;
  const app = await appGrant(C, 'outbound:send');

  const saved = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(app), body: JSON.stringify({ name: 'Tunnettu Henkilö', email: recipientEmail }),
  });
  assert(saved.status === 201, `the app's save: ${saved.status} ${JSON.stringify(saved.body.error)}`);
  const contactId = saved.body.data.contact.id as string;
  assert(!('ghii' in saved.body.data.contact), `the save told the app the account: ${JSON.stringify(saved.body.data.contact.ghii)}`);
  const listed = await json('/v1/outbound/contacts', { headers: authed(app) });
  const row = (listed.body.data.contacts as any[]).find(c => c.id === contactId);
  assert(!!row && !('ghii' in row), `the app's read-back carries the account: ${JSON.stringify(row?.ghii)}`);

  // The owner in person still sees the link: on the outbound list, and as the person in their address book.
  const own = await json('/v1/outbound/contacts', { headers: authed(C.token) });
  const ownRow = (own.body.data.contacts as any[]).find(c => c.id === contactId);
  assert(ownRow?.ghii === recipientGhii, `the owner's outbound list: ${JSON.stringify(ownRow?.ghii)}`);
  const book = await json('/v1/contacts', { headers: authed(C.token) });
  assert((book.body.data.contacts as any[]).some(c => c.contact_id === recipientGhii),
    `the owner's address book: ${JSON.stringify((book.body.data.contacts as any[]).map(c => c.contact_id))}`);

  // A send goes to the inbox only when the address has an account, so its channel says the same thing.
  const sent = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(app), body: JSON.stringify({ contact_id: contactId, kind: 'transactional', subject: 'Kuitti', body: 'Kiitos.' }),
  });
  assert(sent.status === 200 && sent.body.data.status === 'sent', `the app's send: ${sent.status} ${JSON.stringify(sent.body.error ?? sent.body.data)}`);
  assert(!('channel' in sent.body.data) && !('channel' in sent.body.data.message),
    `the send told the app the channel: ${JSON.stringify([sent.body.data.channel, sent.body.data.message?.channel])}`);
  const appLog = await json(`/v1/outbound/log?contact_id=${encodeURIComponent(contactId)}`, { headers: authed(app) });
  assert(appLog.status === 200 && appLog.body.data.messages.length === 1 && !('channel' in appLog.body.data.messages[0]),
    `the app's log read: ${JSON.stringify(appLog.body.data?.messages ?? appLog.body.error)}`);

  const ownLog = await json(`/v1/outbound/log?contact_id=${encodeURIComponent(contactId)}`, { headers: authed(C.token) });
  assert(ownLog.body.data.messages.length === 1 && ownLog.body.data.messages[0].channel === 'inbox',
    `the owner's log read: ${JSON.stringify(ownLog.body.data?.messages?.map((m: any) => m.channel))}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

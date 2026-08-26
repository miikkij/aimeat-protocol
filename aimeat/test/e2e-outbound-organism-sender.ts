/**
 * @file test/e2e-outbound-organism-sender.ts
 * @description May a colleague send as the company, and does one person's unsubscribe stop the
 *   other one?
 *
 *   The feature is worth having only if the second half holds. A team shares a CRM; if each member
 *   keeps their own recipient registry, somebody who unsubscribes from one member's campaign is
 *   mailed by the next, and both members believe they honoured the opt-out. So this suite proves
 *   the sending identity AND the book that comes with it, and the refusals around them: a stranger
 *   to the organism, a company bound to no organism at all, and a member who has been removed.
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial, with organism-scoped sending.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-outbound-organism-sender.ts

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

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

async function makeOwner(name: string): Promise<{ token: string; owner: string; ghii: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', {
      method: 'POST',
      body: JSON.stringify({ username: owner, display_name: owner, password: 'SenderTest1234' }),
    });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, owner, ghii: `${owner}@${NODE_ID}` };
  }
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

console.log('═══ E2E: sending as the organism\'s company ═══');
console.log(`Base: ${BASE}`);

console.log('\nSetup');
// HEIDI registers the company and its mail server. ANNE is a colleague in the same organism.
// STRANGER belongs to nothing.
const heidi = await makeOwner('heidi');
const anne = await makeOwner('anne');
const stranger = await makeOwner('outsider');

const org = await json('/v1/organisms', {
  method: 'POST', headers: authed(heidi.token),
  body: JSON.stringify({ name: 'Shared CRM', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
});
assert(org.status === 201, `organism: ${org.status} ${JSON.stringify(org.body)}`);
const orgId = org.body.data.organism.id as string;

const invited = await json(`/v1/organisms/${orgId}/members`, {
  method: 'POST', headers: authed(heidi.token),
  body: JSON.stringify({ ghii: anne.owner, role: 'member' }),
});
assert(invited.status === 200 || invited.status === 201,
  `adding the colleague failed: ${invited.status} ${JSON.stringify(invited.body)}`);

const slug = `firma${Date.now().toString(36).slice(-6)}`;
const company = await json('/v1/companies', {
  method: 'POST', headers: authed(heidi.token),
  body: JSON.stringify({ name: 'Heidin Firma Oy', slug, organism_id: orgId }),
});
assert(company.status === 201, `company: ${company.status} ${JSON.stringify(company.body)}`);
const companyId = company.body.data.company.id as string;

// A company bound to NO organism, for the refusal that proves the link is what grants access.
const loneSlug = `yksin${Date.now().toString(36).slice(-6)}`;
const lone = await json('/v1/companies', {
  method: 'POST', headers: authed(heidi.token),
  body: JSON.stringify({ name: 'Yksin Oy', slug: loneSlug }),
});
assert(lone.status === 201, `lone company: ${lone.status}`);
const loneId = lone.body.data.company.id as string;

const smtp = await json(`/v1/companies/${companyId}/smtp`, {
  method: 'PUT', headers: authed(heidi.token),
  body: JSON.stringify({
    host: 'smtp.example.invalid', port: 587,
    username: 'kampanjat', password: 'never-leaves-the-server',
    from_address: 'kampanjat@heidinfirma.test', from_name: 'Heidin Firma',
  }),
});
assert(smtp.status === 200, `smtp: ${smtp.status} ${JSON.stringify(smtp.body)}`);

console.log('\nPhase 1 — who may speak for the company');

await test('1. the colleague sees the company among the ones she may send as', async () => {
  const r = await json('/v1/companies/sendable', { headers: authed(anne.token) });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  const row = r.body.data.companies.find((c: any) => c.id === companyId);
  assert(row, `the shared company should be listed: ${JSON.stringify(r.body.data.companies)}`);
  assert(row.via === 'organism', `expected via=organism, got ${row.via}`);
  assert(row.from_address === 'kampanjat@heidinfirma.test', `expected the sending address, got ${row.from_address}`);
  assert(row.has_own_server === true, 'the company brings its own server');
});

await test('2. the listing never carries the password', async () => {
  const r = await json('/v1/companies/sendable', { headers: authed(anne.token) });
  const raw = JSON.stringify(r.body);
  assert(!raw.includes('never-leaves-the-server'), 'the SMTP password must not reach a caller');
  assert(!raw.includes('passwordEnc'), 'the ciphertext must not reach a caller either');
});

await test('3. a company bound to no organism is nobody else\'s to send as', async () => {
  const r = await json('/v1/companies/sendable', { headers: authed(anne.token) });
  const row = r.body.data.companies.find((c: any) => c.id === loneId);
  assert(!row, 'a company with no organism link must not be shared with anyone');
});

await test('4. a stranger to the organism sees nothing of it', async () => {
  const r = await json('/v1/companies/sendable', { headers: authed(stranger.token) });
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(!r.body.data.companies.some((c: any) => c.id === companyId),
    'a non-member must not see the company');
});

console.log('\nPhase 2 — the book follows the company');

let sharedContactId = '';

await test('5. the owner saves a recipient under the company\'s book', async () => {
  const r = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(heidi.token),
    body: JSON.stringify({ name: 'Asiakas', email: 'asiakas@example.test' }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  sharedContactId = r.body.data.contact.id;
});

await test('6. the colleague sending as the company reaches that same recipient', async () => {
  // The proof is the FAILURE mode: the company's mail host does not resolve, so a send that got
  // as far as SMTP was a send that found the recipient in the company's book and was allowed
  // through every gate. A caller working from her own empty registry would have been refused at
  // the first one with NOT_FOUND instead.
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(anne.token),
    body: JSON.stringify({
      contact_id: sharedContactId, kind: 'marketing',
      subject: 'Kevät', body: 'Terveisiä', company_id: companyId,
    }),
  });
  assert(r.status === 200, `expected the send to be accepted, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data.status === 'failed', `expected a delivery failure against the fake host, got ${r.body.data.status}`);
});

await test("6b. the colleague's send lands in the COMPANY's log, attributed to her", async () => {
  // THE BOOK IS THE COMPANY'S AND THE PERSON IS THE COLLEAGUE, and until 2026-08-26 the successful
  // path wrote the row under the CALLER while every refusal, the daily-allowance count and this
  // very read used the company. The consequences were two: "what has this company sent" answered
  // with the owner's own sends and nobody else's, and the per-company allowance counted a book
  // that only ever received refusals, so it never bound at all.
  const log = await json('/v1/outbound/log?per_page=200', { headers: authed(heidi.token) });
  assert(log.status === 200, `log: ${log.status}`);
  const rows = log.body.data.messages as Array<{ subject: string; sentBy: string | null; organismId: string | null }>;
  const row = rows.find(m => m.subject === 'Kevät');
  assert(!!row, `the company's owner must see the colleague's send: ${rows.map(r => r.subject).join(', ')}`);
  assert(typeof row!.sentBy === 'string' && row!.sentBy.includes('anne'),
    `the row must name WHO pressed send, got ${String(row!.sentBy)}`);
  assert(row!.organismId !== null, 'and which company spoke');

  // The colleague can find her own work inside the shared book without seeing only it.
  const hers = await json('/v1/outbound/log?sent_by=me&per_page=200', { headers: authed(anne.token) });
  assert(hers.status === 200, `her log: ${hers.status}`);
  // Her OWN book is empty of this row — the send belongs to the company — which is the same fact
  // read from the other side.
  const hersRows = hers.body.data.messages as Array<{ subject: string }>;
  assert(!hersRows.some(m => m.subject === 'Kevät'),
    'the row belongs to the company book, not to the colleague');
});

await test('7. an unsubscribe collected by one member stops the other member', async () => {
  const off = await json(`/v1/outbound/contacts/${sharedContactId}/opt-out`, {
    method: 'POST', headers: authed(heidi.token),
    body: JSON.stringify({ opted_out: true }),
  });
  assert(off.status === 200, `opt-out failed: ${off.status} ${JSON.stringify(off.body)}`);

  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(anne.token),
    body: JSON.stringify({
      contact_id: sharedContactId, kind: 'marketing',
      subject: 'Kevät', body: 'Terveisiä', company_id: companyId,
    }),
  });
  assert(r.status === 422, `expected 422, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.error.code === 'OPTED_OUT', `expected OPTED_OUT, got ${r.body.error.code}`);
});

await test('8. the same recipient is invisible to a member sending in their own name', async () => {
  // Without a company there is no shared book, and there should not be one: this contact belongs
  // to the company, not to everyone who ever sent as it.
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(anne.token),
    body: JSON.stringify({ contact_id: sharedContactId, kind: 'transactional', subject: 'x', body: 'y' }),
  });
  assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 3 — the refusals');

await test('9. a stranger cannot send as the company', async () => {
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(stranger.token),
    body: JSON.stringify({
      contact_id: sharedContactId, kind: 'marketing',
      subject: 'x', body: 'y', company_id: companyId,
    }),
  });
  assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('10. naming a company you may not speak for is refused, not ignored', async () => {
  // It used to fall through to the shared sender, so a caller could believe they had sent as a
  // company they have no right to. Silence is the wrong answer to an unauthorised claim.
  const own = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(stranger.token),
    body: JSON.stringify({ name: 'Oma', email: 'oma@example.test' }),
  });
  assert(own.status === 201, `contact: ${own.status}`);
  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(stranger.token),
    body: JSON.stringify({
      contact_id: own.body.data.contact.id, kind: 'transactional',
      subject: 'x', body: 'y', company_id: companyId,
    }),
  });
  assert(r.status === 404, `expected a refusal, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('11. a member removed from the organism stops being able to send', async () => {
  const removed = await json(`/v1/organisms/${orgId}/members/${encodeURIComponent(anne.owner)}`, {
    method: 'DELETE', headers: authed(heidi.token),
  });
  assert(removed.status === 200 || removed.status === 204,
    `removing the member failed: ${removed.status} ${JSON.stringify(removed.body)}`);

  const list = await json('/v1/companies/sendable', { headers: authed(anne.token) });
  assert(!list.body.data.companies.some((c: any) => c.id === companyId),
    'the company must leave her list with the membership');

  const r = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(anne.token),
    body: JSON.stringify({
      contact_id: sharedContactId, kind: 'transactional',
      subject: 'x', body: 'y', company_id: companyId,
    }),
  });
  assert(r.status === 404, `expected 404 after removal, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('12. everything the picker offers is something the send door accepts', async () => {
  // Two paths answer "may I send as this company": the listing runs a query and the send runs a
  // check. They apply the same rule and are separate code, so drift shows up as an option a person
  // can choose and then be refused for. This is the assertion that keeps them honest.
  const heidiList = await json('/v1/companies/sendable', { headers: authed(heidi.token) });
  for (const c of heidiList.body.data.companies) {
    const r = await json('/v1/outbound/send', {
      method: 'POST', headers: authed(heidi.token),
      body: JSON.stringify({
        contact_id: sharedContactId, kind: 'transactional',
        subject: 'consistency', body: 'consistency', company_id: c.id,
      }),
    });
    assert(r.status !== 404 || (r.body.error && r.body.error.message !== 'Company not found'),
      `the picker offered ${c.name} and the send door refused it: ${JSON.stringify(r.body)}`);
  }
});

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

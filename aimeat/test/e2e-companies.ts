/**
 * @file test/e2e-companies.ts
 * @description E2E for the company registry and the co origin: claiming {slug}.co.<apex>
 *   (slugify, reserved labels, the unique-index arbitration on a duplicate), the front-page
 *   contract (an app must be YOUR app; a redirect must be absolute; 'none' keeps the address
 *   reserved but unserved), the address the record reports, cross-owner isolation, cross-scope
 *   403, and the serving half: a company host serves its front-page app, a redirect front page
 *   301s, an unclaimed label 404s, and the invoice seller prefills from the company record.
 * @version-history
 *   v1.2.0 — 2026-08-08 — Phase 6: the company's own page (publish switches the front
 *     page, re-publish replaces, removal falls back to none, cross-owner refused).
 *   v1.1.0 — 2026-08-07 — Phase 5: the company's own SMTP identity (the password never leaves
 *     the server, an update without one keeps it, and a send really uses the company's server).
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-companies.ts

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
/** The runner pins AIMEAT_CO_HOST for the spawned server; the suite must agree with it. */
const CO_HOST = process.env.AIMEAT_CO_HOST ?? 'co.localhost';

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
      ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
  }
}

/** A request that arrives "on" the company origin, the way nginx marks it in production. */
async function coFetch(slug: string, path = '/'): Promise<{ status: number; body: string; location: string | null; contentType: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: { 'X-Co-Origin': '1', 'X-Subdomain': slug, Host: `${slug}.${CO_HOST}` },
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get('location'),
    contentType: res.headers.get('content-type'),
  };
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
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: 'CompanyTest1234' }) });
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
  return tok.body.data.token as string;
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Publish a tiny app so a company has something to point its address at. */
async function publishApp(token: string, filename: string, marker: string): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${marker}</title></head><body><h1>${marker}</h1></body></html>`;
  const r = await json('/v1/apps', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({
      filename, name: marker, description: `${marker} front page`, category: 'tool',
      content: Buffer.from(html, 'utf-8').toString('base64'),
    }),
  });
  assert(r.status === 200 || r.status === 201, `app publish failed: ${r.status} ${JSON.stringify(r.body)}`);
}

console.log('═══ E2E: company registry + co origin ═══');
console.log(`Base: ${BASE} · co host: ${CO_HOST}`);

console.log('\nSetup');
const A = await makeOwner('cofound');
const B = await makeOwner('coother');
const narrowAgentToken = await makeNarrowAgent(A);
const APP_FILE = `co-front-${Date.now().toString(36).slice(-5)}.html`;
const APP_MARKER = 'COMPANY FRONT PAGE';
await publishApp(A.token, APP_FILE, APP_MARKER);
await publishApp(B.token, `other-${APP_FILE}`, 'SOMEONE ELSES APP');

console.log('\nPhase 1 — claiming the address');

let companyId = '';
let slug = '';

await test('1. a company is registered and the address is derived from the name', async () => {
  const name = `Kaisan Kudonta ${Date.now().toString(36).slice(-5)}`;
  const r = await json('/v1/companies', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      name, business_id: '1234567-8', vat_id: 'FI12345678',
      street_address: 'Kutomakuja 3', postal_code: '00500', city: 'Helsinki', country: 'FI',
      iban: 'FI2112345600000785', bic: 'NDEAFIHH', email: 'kaisa@example.com',
    }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  const c = r.body.data.company;
  companyId = c.id;
  slug = c.slug;
  assert(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug), `slug malformed: ${slug}`);
  assert(!slug.includes(' ') && !slug.includes('ä'), `slug not normalised: ${slug}`);
  assert(c.frontPage.kind === 'none', 'a fresh company serves nothing yet');
  assert(String(c.address).includes(`${slug}.${CO_HOST}`), `address wrong: ${c.address}`);
});

await test('2. the same address cannot be claimed twice (the index arbitrates)', async () => {
  const dupe = await json('/v1/companies', {
    method: 'POST', headers: authed(B.token), body: JSON.stringify({ name: 'Toinen yritys', slug }),
  });
  assert(dupe.status === 409 && dupe.body.error?.code === 'SLUG_TAKEN', `expected 409 SLUG_TAKEN, got ${dupe.status} ${JSON.stringify(dupe.body.error)}`);
});

await test('3. reserved and malformed addresses are refused', async () => {
  for (const bad of ['apps', 'www', 'co', 'admin']) {
    const r = await json('/v1/companies', { method: 'POST', headers: authed(A.token), body: JSON.stringify({ name: 'Varattu', slug: bad }) });
    assert(r.status === 409 && r.body.error?.code === 'SLUG_RESERVED', `"${bad}" should be reserved, got ${r.status}`);
  }
  const malformed = await json('/v1/companies', { method: 'POST', headers: authed(A.token), body: JSON.stringify({ name: 'Väärä', slug: '-alkaa-viivalla' }) });
  assert(malformed.status === 400, `malformed slug should be 400, got ${malformed.status}`);
});

await test('4. availability check reports taken, free and reserved', async () => {
  const taken = await json(`/v1/companies/available?slug=${slug}`, { headers: authed(A.token) });
  assert(taken.body.data.available === false && taken.body.data.reason === 'SLUG_TAKEN', 'taken slug misreported');
  const free = await json(`/v1/companies/available?slug=vapaa-nimi-${Date.now().toString(36).slice(-5)}`, { headers: authed(A.token) });
  assert(free.body.data.available === true, 'free slug misreported');
  const reserved = await json('/v1/companies/available?slug=apps', { headers: authed(A.token) });
  assert(reserved.body.data.reason === 'SLUG_RESERVED', 'reserved slug misreported');
  const fromName = await json('/v1/companies/available?name=Yrityksen%20Nimi%20Oy', { headers: authed(A.token) });
  assert(fromName.body.data.slug === 'yrityksen-nimi-oy', `name→slug wrong: ${fromName.body.data.slug}`);
});

console.log('\nPhase 2 — the front page contract');

await test('5. the address serves nothing until a front page is set (404)', async () => {
  const r = await coFetch(slug);
  assert(r.status === 404, `expected 404 for an unpublished front page, got ${r.status}`);
});

await test('6. a front page must be an app YOU published', async () => {
  const notMine = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token),
    body: JSON.stringify({ kind: 'app', target: `${B.owner}/other-${APP_FILE}` }),
  });
  assert(notMine.status === 403 && notMine.body.error?.code === 'FRONT_PAGE_NOT_YOURS', `expected 403, got ${notMine.status} ${JSON.stringify(notMine.body.error)}`);
  const missing = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'app', target: `${A.owner}/ei-olemassa.html` }),
  });
  assert(missing.status === 404 && missing.body.error?.code === 'APP_NOT_FOUND', `expected 404 APP_NOT_FOUND, got ${missing.status}`);
});

await test('7. setting your own app makes the address serve it', async () => {
  const set = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'app', target: `${A.owner}/${APP_FILE}` }),
  });
  assert(set.status === 200 && set.body.data.company.frontPage.kind === 'app', `set failed: ${set.status} ${JSON.stringify(set.body)}`);
  const served = await coFetch(slug);
  assert(served.status === 200, `expected 200 from the company host, got ${served.status}`);
  assert(served.body.includes(APP_MARKER), 'the company host served the wrong document');
  assert((served.contentType ?? '').includes('text/html'), `wrong content type: ${served.contentType}`);
  assert((served.contentType ?? '').includes('utf-8'), 'charset must be explicit (mojibake guard)');
});

await test('8. a redirect front page 301s; a relative target is refused', async () => {
  const bad = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'redirect', target: '/somewhere' }),
  });
  assert(bad.status === 400, `relative redirect should be 400, got ${bad.status}`);
  const ok = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'redirect', target: 'https://example.com/yritys' }),
  });
  assert(ok.status === 200, `redirect set failed: ${ok.status}`);
  const served = await coFetch(slug);
  assert(served.status === 301 && (served.location ?? '').startsWith('https://example.com/yritys'), `expected 301, got ${served.status} → ${served.location}`);
  // Put the app back for the remaining tests.
  await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'app', target: `${A.owner}/${APP_FILE}` }),
  });
});

await test('9. an unclaimed address answers 404, not a hint that it is free', async () => {
  const r = await coFetch(`ei-ole-olemassa-${Date.now().toString(36).slice(-5)}`);
  assert(r.status === 404, `expected 404, got ${r.status}`);
  assert(!r.body.toLowerCase().includes('available'), 'the 404 must not advertise availability');
});

console.log('\nPhase 3 — the company is the invoice seller');

await test('10. an invoice billed as the company prefills the seller from its record', async () => {
  const r = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      company_id: companyId,
      buyer: { name: 'Ostaja Oy', email: 'ostaja@example.com' },
      lines: [{ description: 'Huivi', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 12900, vatCodeId: 'fi-std-2550' }],
    }),
  });
  assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
  const seller = r.body.data.invoice.seller;
  assert(seller.businessId === '1234567-8', `businessId not prefilled: ${JSON.stringify(seller)}`);
  assert(seller.iban === 'FI2112345600000785', 'iban not prefilled');
  assert(seller.city === 'Helsinki', 'address not prefilled');
  // The prefilled identity is complete enough to produce the Finvoice document.
  const sent = await json(`/v1/finance/invoices/${r.body.data.invoice.id}/send`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ delivery_method: 'manual' }),
  });
  assert(sent.status === 200, `send failed: ${sent.status}`);
  const xml = await fetch(`${BASE}/v1/finance/invoices/${r.body.data.invoice.id}/finvoice.xml`, { headers: authed(A.token) });
  assert(xml.status === 200, 'Finvoice generation failed on a company-billed invoice');
});

await test("11. billing as someone else's company is refused (404)", async () => {
  const r = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(B.token),
    body: JSON.stringify({
      company_id: companyId,
      buyer: { name: 'Ostaja Oy' },
      lines: [{ description: 'x', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 100, vatCodeId: 'fi-std-2550' }],
    }),
  });
  assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('12. an invoice with neither seller nor company_id is refused', async () => {
  const r = await json('/v1/finance/invoices', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ buyer: { name: 'Ostaja Oy' }, lines: [{ description: 'x', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 100, vatCodeId: 'fi-std-2550' }] }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 4 — isolation and scopes');

await test('13. another owner sees neither the company nor its details', async () => {
  const get = await json(`/v1/companies/${companyId}`, { headers: authed(B.token) });
  assert(get.status === 404, `cross-owner get should be 404, got ${get.status}`);
  const put = await json(`/v1/companies/${companyId}`, { method: 'PUT', headers: authed(B.token), body: JSON.stringify({ name: 'Kaapattu Oy' }) });
  assert(put.status === 404, `cross-owner update should be 404, got ${put.status}`);
  const front = await json(`/v1/companies/${companyId}/front-page`, { method: 'PUT', headers: authed(B.token), body: JSON.stringify({ kind: 'none' }) });
  assert(front.status === 404, `cross-owner front-page should be 404, got ${front.status}`);
  const del = await json(`/v1/companies/${companyId}`, { method: 'DELETE', headers: authed(B.token) });
  assert(del.status === 404, `cross-owner delete should be 404, got ${del.status}`);
  const list = await json('/v1/companies', { headers: authed(B.token) });
  assert(!list.body.data.companies.some((c: any) => c.id === companyId), "B's list must not contain A's company");
});

await test('14. an agent without company scopes gets 403', async () => {
  const read = await json('/v1/companies', { headers: authed(narrowAgentToken) });
  assert(read.status === 403, `read should be 403, got ${read.status}`);
  const write = await json('/v1/companies', { method: 'POST', headers: authed(narrowAgentToken), body: JSON.stringify({ name: 'Agentin yritys' }) });
  assert(write.status === 403, `write should be 403, got ${write.status}`);
});

console.log("\nPhase 5 — the company's own sending identity");

let smtpContactId = '';

await test('15. a company stores its own SMTP settings and no read ever returns the password', async () => {
  const put = await json(`/v1/companies/${companyId}/smtp`, {
    method: 'PUT', headers: authed(A.token),
    body: JSON.stringify({
      host: '127.0.0.1', port: 1, secure: false,
      username: 'laskutus@perustaja.fi', password: 'ei-koskaan-ulos',
      from_address: 'laskutus@perustaja.fi', from_name: 'Perustaja Oy', reply_to: 'asiakaspalvelu@perustaja.fi',
    }),
  });
  assert(put.status === 200, `smtp save failed: ${put.status} ${JSON.stringify(put.body)}`);
  const saved = put.body.data.smtp;
  assert(saved.passwordSet === true, 'the record must report that a password is set');
  assert(!('passwordEnc' in saved) && !('password' in saved), 'the write response must not carry the password in any form');

  const get = await json(`/v1/companies/${companyId}/smtp`, { headers: authed(A.token) });
  assert(get.status === 200, `smtp read failed: ${get.status}`);
  const read = get.body.data.smtp;
  assert(read.host === '127.0.0.1' && read.fromAddress === 'laskutus@perustaja.fi', 'the settings must round-trip');
  assert(read.passwordSet === true, 'the read must still report a password is set');
  assert(!JSON.stringify(get.body).includes('ei-koskaan-ulos'), 'the password leaked into a read response');
});

await test('16. updating the settings without a password keeps the stored one', async () => {
  const put = await json(`/v1/companies/${companyId}/smtp`, {
    method: 'PUT', headers: authed(A.token),
    body: JSON.stringify({ host: '127.0.0.1', port: 1, from_address: 'laskut@perustaja.fi' }),
  });
  assert(put.status === 200, `smtp update failed: ${put.status}`);
  assert(put.body.data.smtp.fromAddress === 'laskut@perustaja.fi', 'the sender address must change');
  assert(put.body.data.smtp.passwordSet === true, 'omitting the password must keep the stored one, not clear it');
});

await test("17. another owner can neither read nor write this company's SMTP settings", async () => {
  const get = await json(`/v1/companies/${companyId}/smtp`, { headers: authed(B.token) });
  assert(get.status === 404, `cross-owner smtp read should be 404, got ${get.status}`);
  const put = await json(`/v1/companies/${companyId}/smtp`, {
    method: 'PUT', headers: authed(B.token),
    body: JSON.stringify({ host: 'evil.example', from_address: 'kaappaus@evil.example' }),
  });
  assert(put.status === 404, `cross-owner smtp write should be 404, got ${put.status}`);
  const del = await json(`/v1/companies/${companyId}/smtp`, { method: 'DELETE', headers: authed(B.token) });
  assert(del.status === 404, `cross-owner smtp delete should be 404, got ${del.status}`);
});

await test("18. a send as the company goes through the company's own server, not the node's", async () => {
  const contact = await json('/v1/outbound/contacts', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Asiakas Oy', email: `asiakas${Date.now().toString(36).slice(-5)}@example.com` }),
  });
  assert(contact.status === 201, `contact create failed: ${contact.status}`);
  smtpContactId = contact.body.data.contact.id as string;

  // The node's own transport is disabled in the test environment. If the send still reaches an
  // SMTP connection, the company's settings are what carried it — that is the whole assertion.
  const sent = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      contact_id: smtpContactId, kind: 'transactional', company_id: companyId,
      subject: 'Lasku 1001', body: 'Liitteenä lasku.',
    }),
  });
  assert(sent.status === 200, `send failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  assert(sent.body.data.status === 'failed', `expected a delivery failure against 127.0.0.1:1, got ${sent.body.data.status}`);
  const err = String(sent.body.data.message.error ?? '');
  assert(err !== 'EMAIL_DISABLED', "the node's shared transport answered — the company sender was not used");
  assert(/ECONNREFUSED|connect|127\.0\.0\.1/i.test(err), `expected a connection error from the company server, got: ${err}`);
});

await test('19. removing the settings puts the company back on the shared sender', async () => {
  const del = await json(`/v1/companies/${companyId}/smtp`, { method: 'DELETE', headers: authed(A.token) });
  assert(del.status === 200, `smtp delete failed: ${del.status}`);
  const get = await json(`/v1/companies/${companyId}/smtp`, { headers: authed(A.token) });
  assert(get.body.data.smtp === null, 'the settings must be gone after removal');

  const sent = await json('/v1/outbound/send', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      contact_id: smtpContactId, kind: 'transactional', company_id: companyId,
      subject: 'Lasku 1002', body: 'Liitteenä lasku.',
    }),
  });
  assert(sent.status === 200, `send failed: ${sent.status}`);
  assert(sent.body.data.message.error === 'EMAIL_DISABLED',
    `without company settings the node's own (disabled) transport must answer, got: ${sent.body.data.message.error}`);
});

console.log("\nPhase 6 — the company's own page");

const PAGE_MARKER = 'PERUSTAJA OY ETUSIVU';
const PAGE = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${PAGE_MARKER}</title></head><body><h1>${PAGE_MARKER}</h1></body></html>`;

await test('20. pointing the address at a page that was never published is refused', async () => {
  const r = await json(`/v1/companies/${companyId}/front-page`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ kind: 'portfolio' }),
  });
  assert(r.status === 409, `expected 409, got ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.error?.code === 'NO_PORTFOLIO', `expected NO_PORTFOLIO, got ${r.body.error?.code}`);
});

await test('21. publishing a page serves it at the company address in one act', async () => {
  const before = await json(`/v1/companies/${companyId}/portfolio`, { headers: authed(A.token) });
  assert(before.body.data.portfolio.published === false, 'nothing should be published yet');

  const put = await json(`/v1/companies/${companyId}/portfolio`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ html: PAGE }),
  });
  assert(put.status === 200, `publish failed: ${put.status} ${JSON.stringify(put.body)}`);
  // Publishing IS choosing the front page — a second call to set it would be a step that exists
  // only because the data model has two fields.
  assert(put.body.data.company.frontPage.kind === 'portfolio',
    `the front page must switch to portfolio, got ${put.body.data.company.frontPage.kind}`);

  const served = await coFetch(slug);
  assert(served.status === 200, `the address must serve the page, got ${served.status}`);
  assert(served.body.includes(PAGE_MARKER), 'the served document is not the page that was published');
  assert((served.contentType ?? '').includes('text/html'), `expected text/html, got ${served.contentType}`);
});

await test('22. re-publishing replaces the page rather than appending one', async () => {
  // replaceAll, not replace: the marker appears in both the title and the h1, and replacing
  // only the first would leave the "old page is gone" assertion checking nothing.
  const second = PAGE.replaceAll(PAGE_MARKER, 'TOINEN VERSIO');
  const put = await json(`/v1/companies/${companyId}/portfolio`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ html: second }),
  });
  assert(put.status === 200, `re-publish failed: ${put.status}`);
  const served = await coFetch(slug);
  assert(served.body.includes('TOINEN VERSIO'), 'the new page is not served');
  assert(!served.body.includes(PAGE_MARKER), 'the previous page is still being served');
});

await test('23. something that is not a document is refused, not served blank', async () => {
  const r = await json(`/v1/companies/${companyId}/portfolio`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ html: 'just some words' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
  const empty = await json(`/v1/companies/${companyId}/portfolio`, {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ html: '   ' }),
  });
  assert(empty.status === 400, `an empty page should be 400, got ${empty.status}`);
});

await test("24. another owner can neither read, publish nor remove this company's page", async () => {
  const get = await json(`/v1/companies/${companyId}/portfolio`, { headers: authed(B.token) });
  assert(get.status === 404, `cross-owner read should be 404, got ${get.status}`);
  const put = await json(`/v1/companies/${companyId}/portfolio`, {
    method: 'PUT', headers: authed(B.token), body: JSON.stringify({ html: PAGE }),
  });
  assert(put.status === 404, `cross-owner publish should be 404, got ${put.status}`);
  const del = await json(`/v1/companies/${companyId}/portfolio`, { method: 'DELETE', headers: authed(B.token) });
  assert(del.status === 404, `cross-owner remove should be 404, got ${del.status}`);
  // ...and the page it could not touch is still the owner's.
  const served = await coFetch(slug);
  assert(served.body.includes('TOINEN VERSIO'), "the owner's page must be untouched");
});

await test('25. removing the page leaves the address serving nothing, not a stale setting', async () => {
  const del = await json(`/v1/companies/${companyId}/portfolio`, { method: 'DELETE', headers: authed(A.token) });
  assert(del.status === 200, `remove failed: ${del.status}`);
  assert(del.body.data.company.frontPage.kind === 'none',
    `the front page must fall back to none, got ${del.body.data.company.frontPage.kind}`);
  const served = await coFetch(slug);
  assert(served.status === 404, `the address must answer 404 after removal, got ${served.status}`);
  const status = await json(`/v1/companies/${companyId}/portfolio`, { headers: authed(A.token) });
  assert(status.body.data.portfolio.published === false, 'the page must be gone');
});

await test('26. deleting the company frees the address and stops serving it', async () => {
  const del = await json(`/v1/companies/${companyId}`, { method: 'DELETE', headers: authed(A.token) });
  assert(del.status === 200, `delete failed: ${del.status}`);
  const served = await coFetch(slug);
  assert(served.status === 404, `the address must stop serving, got ${served.status}`);
  const free = await json(`/v1/companies/available?slug=${slug}`, { headers: authed(A.token) });
  assert(free.body.data.available === true, 'the address must be claimable again');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);

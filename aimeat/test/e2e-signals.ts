/**
 * @file test/e2e-signals.ts
 * @description E2E for the signals collector: stream definition and its ceiling, the public
 *   tracking image and the public JSON hit (both unauthenticated), the visitor split that makes an
 *   AI fetch distinguishable from a person and from a mail scanner, the per-recipient roll-up that
 *   answers "who opened this" without the node holding an address, the monthly record shape that
 *   keeps one stream at one key per month however many hits land, and the refusals: cross-owner
 *   reads, cross-scope writes, and a hit against a stream that does not exist or is switched off.
 *
 *   The failure modes are measured, not assumed. An unknown stream, a disabled stream and a valid
 *   one must all answer the same bytes on the image door, or the address becomes an oracle for
 *   which campaigns exist.
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-signals.ts

import { createHash } from 'node:crypto';
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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
  }
}

/** Fetch a raw (non-JSON) response, so the image door can be compared byte for byte. */
async function raw(path: string, userAgent?: string): Promise<{ status: number; type: string; text: string; cache: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: userAgent ? { 'User-Agent': userAgent } : {} });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    return {
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      cache: res.headers.get('cache-control') ?? '',
      text: await res.text(),
    };
  }
}

/** A hit through the JSON door, with a User-Agent we choose. */
async function hit(path: string, body: Record<string, unknown>, userAgent: string): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
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

async function makeOwner(name: string): Promise<{ token: string; ghii: string; owner: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', {
      method: 'POST',
      body: JSON.stringify({ username: owner, display_name: owner, password: 'SignalsTest1234' }),
    });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}`, owner };
  }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
  const name = `sigagent${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
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

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CHATGPT_ASKED = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const CLAUDE_ASKED = 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const GMAIL_PROXY = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';

console.log('═══ E2E: signals — the generic hit collector ═══');
console.log(`Base: ${BASE}`);

console.log('\nSetup');
const A = await makeOwner('sigown');
const B = await makeOwner('sigother');
const narrowAgentToken = await makeAgent(A, ['memory:read']);
// An agent the owner HAS trusted with writing in their name — everything except the separate
// reserved-key grant. It is the principal test 19 needs: a refusal from a caller that holds no
// write permission at all would prove nothing about the reserved prefix.
const delegateAgentToken = await makeAgent(A, ['memory:read', 'memory:write', 'memory:write-as-owner']);

const STREAM = 'campaign-spring';
let pixelUrl = '';
let hitUrl = '';

console.log('\nPhase 1 — defining what is measured');

await test('1. a stream is created and hands back both public addresses', async () => {
  const r = await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ stream_id: STREAM, label: 'Kevätkampanja', channel: 'email' }),
  });
  assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  pixelUrl = r.body.data.pixel_url;
  hitUrl = r.body.data.hit_url;
  assert(pixelUrl === `/v1/signals/${A.owner}/${STREAM}/px.svg`, `unexpected pixel url: ${pixelUrl}`);
  assert(hitUrl === `/v1/signals/${A.owner}/${STREAM}/hit`, `unexpected hit url: ${hitUrl}`);
  assert(r.body.data.stream.perSubject === true, 'per-subject roll-up should default on');
});

await test('2. an invalid stream id is refused before anything is written', async () => {
  const r = await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ stream_id: 'Not A Slug!' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
  const list = await json('/v1/signals/streams', { headers: authed(A.token) });
  assert(list.body.data.streams.length === 1, 'the refused stream must not exist');
});

await test('3. an agent without signals:write cannot define a stream', async () => {
  const r = await json('/v1/signals/streams', {
    method: 'POST', headers: authed(narrowAgentToken),
    body: JSON.stringify({ stream_id: 'sneaky-stream' }),
  });
  assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('4. an agent without signals:read cannot read the report', async () => {
  const r = await json(`/v1/signals/streams/${STREAM}/report`, { headers: authed(narrowAgentToken) });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

console.log('\nPhase 2 — the public doors count, and disclose nothing');

await test('5. the tracking image is an SVG that no cache may keep', async () => {
  const r = await raw(`${pixelUrl}?s=recipient-1`, CHROME);
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(r.type.includes('image/svg+xml'), `expected an SVG, got ${r.type}`);
  assert(r.cache.includes('no-store'), `the image must not be cached: ${r.cache}`);
  assert(r.text.includes('<svg'), 'expected SVG bytes');
});

await test('6. an unknown stream answers the same bytes as a real one (no enumeration)', async () => {
  const real = await raw(`${pixelUrl}?s=recipient-1`, CHROME);
  const fake = await raw(`/v1/signals/${A.owner}/no-such-stream/px.svg`, CHROME);
  const otherOwner = await raw(`/v1/signals/nobody-here/${STREAM}/px.svg`, CHROME);
  assert(fake.status === 200 && otherOwner.status === 200, 'both must answer 200');
  assert(fake.text === real.text && otherOwner.text === real.text, 'the bytes must be identical');
  assert(fake.type === real.type, 'the content type must be identical');
});

await test('7. a click through the JSON door is counted', async () => {
  const r = await hit(hitUrl, { event: 'click', ref: 'hero-link', subject: 'recipient-1' }, CHROME);
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(r.body.data.counted === true, 'the click should have been counted');
});

await test('8. a hit against a disabled stream reports counted:false and stays unrecorded', async () => {
  const off = 'campaign-off';
  await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ stream_id: off, enabled: false }),
  });
  const r = await hit(`/v1/signals/${A.owner}/${off}/hit`, { event: 'click' }, CHROME);
  assert(r.body.data.counted === false, 'a disabled stream must not count');
  const report = await json(`/v1/signals/streams/${off}/report`, { headers: authed(A.token) });
  assert(report.body.data.totals.hits === 0, `expected no hits, got ${report.body.data.totals.hits}`);
});

await test('9. an unknown event word is refused rather than silently reshaped', async () => {
  const r = await hit(hitUrl, { event: 'whatever' }, CHROME);
  assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 3 — who came: person, AI, or machine');

await test('10. an AI that was ASKED is told apart from an AI that was crawling', async () => {
  await raw(`${pixelUrl}?e=view&s=ai-1`, CHATGPT_ASKED);
  await raw(`${pixelUrl}?e=view&s=ai-2`, GPTBOT);
  await raw(`${pixelUrl}?e=view&s=ai-3`, CLAUDE_ASKED);
  const r = await json(`/v1/signals/streams/${STREAM}/report`, { headers: authed(A.token) });
  const ai = r.body.data.totals.aiAgents;
  assert(ai['chatgpt:asked'] === 1, `expected one asked-ChatGPT fetch, got ${JSON.stringify(ai)}`);
  assert(ai['chatgpt'] === 1, `expected one ChatGPT crawl, got ${JSON.stringify(ai)}`);
  assert(ai['claude:asked'] === 1, `expected one asked-Claude fetch, got ${JSON.stringify(ai)}`);
  assert(r.body.data.totals.classes.ai === 3, `expected 3 AI hits, got ${r.body.data.totals.classes.ai}`);
});

await test('11. a mail proxy is counted as a machine, never as a reader', async () => {
  await raw(`${pixelUrl}?s=scanned-1`, GMAIL_PROXY);
  const r = await json(`/v1/signals/streams/${STREAM}/report?subjects=true`, { headers: authed(A.token) });
  assert(r.body.data.totals.classes.bot >= 1, 'the proxy fetch should count as a machine');
  assert(r.body.data.subjects['scanned-1'].machine === true, 'the subject must be marked as a machine');
  assert(r.body.data.subjects['recipient-1'].machine === false, 'the real reader must not be');
});

await test('12. the report says what an open is worth, in the same payload as the number', async () => {
  const r = await json(`/v1/signals/streams/${STREAM}/report`, { headers: authed(A.token) });
  assert(typeof r.body.data.reading.opens === 'string' && r.body.data.reading.opens.length > 20,
    'the report must carry the reading of an open count');
  assert(r.body.data.reading.clicks.includes('act'), 'a click should be described as an act');
});

console.log('\nPhase 4 — who opened it, without the node holding an address');

await test('13. the per-subject roll-up answers who opened and who clicked', async () => {
  const r = await json(`/v1/signals/streams/${STREAM}/report?subjects=true`, { headers: authed(A.token) });
  const s = r.body.data.subjects['recipient-1'];
  assert(s, 'recipient-1 should have a roll-up');
  assert(s.events.open >= 1, `expected an open, got ${JSON.stringify(s.events)}`);
  assert(s.events.click === 1, `expected one click, got ${JSON.stringify(s.events)}`);
  assert(s.lastRef === 'hero-link', `expected the link to be named, got ${s.lastRef}`);
  assert(s.firstAt <= s.lastAt, 'first must not be after last');
});

await test('14. a stream that keeps totals only forgets who', async () => {
  const anon = 'campaign-anon';
  await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ stream_id: anon, per_subject: false }),
  });
  await hit(`/v1/signals/${A.owner}/${anon}/hit`, { event: 'click', subject: 'someone' }, CHROME);
  const r = await json(`/v1/signals/streams/${anon}/report?subjects=true`, { headers: authed(A.token) });
  assert(r.body.data.totals.hits === 1, 'the total must still be counted');
  assert(Object.keys(r.body.data.subjects ?? {}).length === 0, 'no subject may be kept');
});

console.log('\nPhase 5 — the shape that keeps this affordable');

await test('15. many hits stay in ONE record per stream per month', async () => {
  const before = await json('/v1/memory?prefix=signals.hits.&limit=200', { headers: authed(A.token) });
  const keysBefore = (before.body.data.records ?? before.body.data.items ?? [])
    .filter((r: any) => r.key.startsWith(`signals.hits.${STREAM}.`)).length;
  for (let i = 0; i < 12; i++) {
    await hit(hitUrl, { event: 'click', subject: `bulk-${i}` }, CHROME);
  }
  const after = await json('/v1/memory?prefix=signals.hits.&limit=200', { headers: authed(A.token) });
  const keysAfter = (after.body.data.records ?? after.body.data.items ?? [])
    .filter((r: any) => r.key.startsWith(`signals.hits.${STREAM}.`)).length;
  assert(keysAfter === keysBefore, `twelve more hits must not add keys: ${keysBefore} → ${keysAfter}`);
  assert(keysAfter === 1, `expected exactly one month record, found ${keysAfter}`);
});

// The genuine race is proved in test/unit/signals-concurrency.test.ts: this backend is
// synchronous, so hits here queue rather than interleave and a race cannot be reproduced.
await test('16. ten hits fired at once are ten hits in the report', async () => {
  const racy = 'campaign-race';
  await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ stream_id: racy }),
  });
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    hit(`/v1/signals/${A.owner}/${racy}/hit`, { event: 'click', subject: `racer-${i}` }, CHROME)));
  const r = await json(`/v1/signals/streams/${racy}/report?subjects=true`, { headers: authed(A.token) });
  assert(r.body.data.totals.hits === 10, `expected all 10 hits, got ${r.body.data.totals.hits}`);
  assert(Object.keys(r.body.data.subjects).length === 10, `expected 10 subjects, got ${Object.keys(r.body.data.subjects).length}`);
});

console.log('\nPhase 6 — the boundaries');

await test('17. another owner cannot read this owner\'s report', async () => {
  const r = await json(`/v1/signals/streams/${STREAM}/report`, { headers: authed(B.token) });
  assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('18. another owner\'s stream list does not show this owner\'s streams', async () => {
  const r = await json('/v1/signals/streams', { headers: authed(B.token) });
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(r.body.data.streams.length === 0, `expected an empty list, got ${r.body.data.streams.length}`);
});

await test('19. a delegated agent cannot forge a stream through the memory API', async () => {
  // signals.stream.* is server-trusted: an UNAUTHENTICATED door reads it before agreeing to write
  // into this owner's namespace. The agent here genuinely holds memory:write-as-owner, so an
  // ordinary owner-namespace key succeeds for it — which is what makes the refusal below mean
  // something rather than being a caller with no permissions being turned away.
  const ordinary = await json('/v1/memory', {
    method: 'POST', headers: authed(delegateAgentToken),
    body: JSON.stringify({ key: 'cadence.proof-of-write', value: { ok: true }, visibility: 'owner', owner_scope: true }),
  });
  assert(ordinary.status === 200 || ordinary.status === 201,
    `the delegate must be able to write ordinary owner keys, got ${ordinary.status} ${JSON.stringify(ordinary.body)}`);

  const forged = await json('/v1/memory', {
    method: 'POST', headers: authed(delegateAgentToken),
    body: JSON.stringify({ key: 'signals.stream.forged', value: { streamId: 'forged', enabled: true }, visibility: 'owner', owner_scope: true }),
  });
  assert(forged.status === 403, `expected 403 on the reserved prefix, got ${forged.status} ${JSON.stringify(forged.body)}`);

  // And the forgery must not exist: a refusal that still wrote would be the worse defect.
  const check = await json('/v1/memory/signals.stream.forged?owner_scope=true', { headers: authed(A.token) });
  assert(check.status === 404, `the forged stream must not exist, got ${check.status}`);
});

await test('20. deleting a stream takes its collected months with it', async () => {
  const del = await json(`/v1/signals/streams/${STREAM}`, { method: 'DELETE', headers: authed(A.token) });
  assert(del.status === 200, `expected 200, got ${del.status}`);
  assert(del.body.data.deleted === true, 'the stream should be gone');
  assert(del.body.data.monthsRemoved >= 1, `expected its months removed, got ${del.body.data.monthsRemoved}`);
  const after = await hit(hitUrl, { event: 'click' }, CHROME);
  assert(after.body.data.counted === false, 'a deleted stream must stop counting');
});


console.log('\nPhase 7 — a published page counts its own readers, including the AI ones');

await test('21. a page is counted only once its owner has opted it in', async () => {
  const filename = `signalpage${Date.now().toString(36).slice(-5)}.html`;
  const html = '<!doctype html><html><body><h1>Kevatkampanja</h1></body></html>';
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      filename, content: Buffer.from(html, 'utf-8').toString('base64'),
      name: 'Signals page', description: 'campaign landing', category: 'utility', tags: ['demo'],
    }),
  });
  assert(pub.status === 201, `publish failed: ${pub.status} ${JSON.stringify(pub.body)}`);

  // Before opting in, fetching the page must write nothing at all.
  await raw(`/v1/apps/${A.owner}/${filename}`, CHATGPT_ASKED);
  const streamId = `page-${filename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  const before = await json(`/v1/signals/streams/${streamId}/report`, { headers: authed(A.token) });
  assert(before.status === 404, `an unmeasured page must have no stream, got ${before.status}`);

  // Opting in is creating the stream the convention names.
  const made = await json('/v1/signals/streams', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ stream_id: streamId, label: 'Campaign page', channel: 'page' }),
  });
  assert(made.status === 200, `stream creation failed: ${made.status} ${JSON.stringify(made.body)}`);

  // A person, an AI that was asked, and a crawler.
  await raw(`/v1/apps/${A.owner}/${filename}`, CHROME);
  await raw(`/v1/apps/${A.owner}/${filename}`, CHATGPT_ASKED);
  await raw(`/v1/apps/${A.owner}/${filename}`, GPTBOT);
  await new Promise((r) => setTimeout(r, 500));   // the serve path deliberately does not await the count

  const after = await json(`/v1/signals/streams/${streamId}/report`, { headers: authed(A.token) });
  assert(after.status === 200, `expected a report, got ${after.status}`);
  assert(after.body.data.totals.hits === 3, `expected 3 page views, got ${after.body.data.totals.hits}`);
  assert(after.body.data.totals.classes.human === 1, `expected 1 human, got ${JSON.stringify(after.body.data.totals.classes)}`);
  assert(after.body.data.totals.aiAgents['chatgpt:asked'] === 1, `expected an asked-AI fetch, got ${JSON.stringify(after.body.data.totals.aiAgents)}`);
  assert(after.body.data.totals.aiAgents['chatgpt'] === 1, `expected a crawler fetch, got ${JSON.stringify(after.body.data.totals.aiAgents)}`);
  assert(after.body.data.totals.channels.page === 3, 'the hits must be attributed to the page channel');
});

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

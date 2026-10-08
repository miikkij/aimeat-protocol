/**
 * @file test/e2e-ai-visibility.ts
 * @description E2E for AI visibility, layer A (services/visibility/): a page load counted by channel
 *   from its Referer and utm_source, AI fetches by family and target, the node's own discovery files
 *   counted for the place's operator, purchases counted under the channel they came from, and one
 *   report on REST and MCP.
 *
 *   The pass criteria are the layer's "done when" lines, each one a test: a Referer of
 *   https://chatgpt.com/ reads as ai/chatgpt; a ChatGPT-User fetch reads as an assistant fetch on
 *   its path; a fresh owner counts with no setup; Sec-GPC: 1 stays out of the channels; and no IP
 *   address is stored anywhere, proved by reading every row of every table of the node's own
 *   database after requests that carried one.
 *
 *   The refusals are measured: a second owner sees none of the first owner's counts, an agent
 *   holding the wrong scope is refused on REST and has no such tool on MCP, and no token is 401.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-visibility

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
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
      body: JSON.stringify({ username: owner, display_name: owner, password: 'VisibilityTest1234' }),
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
  const name = `visag${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
  });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const privKey = reg.body.data.private_key as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, 'agent token failed');
  return tok.body.data.token as string;
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

// ── MCP ───────────────────────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
  const id = ++rpcId;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${session.token}`,
      ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session.sessionId = sid;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const msgs = (await res.text()).split('\n').filter((l) => l.startsWith('data: '))
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
  }
  return await res.json();
}
async function openSession(token: string): Promise<McpSession> {
  const session: McpSession = { token };
  await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-ai-visibility', version: '1.0.0' } });
  return session;
}
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
  const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
  let data: any;
  try { data = JSON.parse(text); } catch { data = { _text: text }; }
  return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

// ── Visits ────────────────────────────────────────────────────────────────────────────────────

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CHATGPT_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const CLAUDEBOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

/** The address every visit claims to come from. The last test proves it is nowhere at rest. */
const VISITOR_IP = '203.0.113.77';
/** A Referer path that would identify a conversation if anything kept it. */
const SECRET_PATH = 'c/visibility-private-conversation-4471';

async function open(path: string, userAgent: string, extra: Record<string, string> = {}): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': userAgent, 'X-Forwarded-For': VISITOR_IP, 'X-Real-IP': VISITOR_IP, ...extra },
      redirect: 'manual',
    });
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    await res.arrayBuffer();
    return res.status;
  }
}

console.log('═══ E2E: AI visibility — channels, AI fetches, discovery files, purchases ═══');
console.log(`Base: ${BASE}`);

console.log('\nSetup');
// The first owner on a fresh database becomes the operator, so the node's own discovery files count
// into this account. The seller is the second, and nothing is configured for either.
const OP = await makeOwner('visop');
const S = await makeOwner('visseller');
const B = await makeOwner('visbuyer');
const readerAgent = await makeAgent(S, ['signals:read']);
const narrowAgent = await makeAgent(S, ['memory:read']);
const writerAgent = await makeAgent(S, ['signals:read', 'signals:write']);

const filename = `visibility${Date.now().toString(36).slice(-5)}.html`;
const appPath = `/v1/apps/${S.owner}/${filename}`;
const report = async (token: string, days?: number): Promise<any> => {
  const r = await json(`/v1/visibility/report${days === undefined ? '' : `?days=${days}`}`, { headers: authed(token) });
  assert(r.status === 200, `report ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

await test('0. the seller publishes an app, and configures nothing else', async () => {
  const html = '<!doctype html><html><body><h1>Visibility demo</h1></body></html>';
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(S.token),
    body: JSON.stringify({
      filename, content: Buffer.from(html, 'utf-8').toString('base64'),
      name: 'Visibility demo', description: 'visibility fixture', category: 'utility', tags: ['demo'],
    }),
  });
  assert(pub.status === 201, `publish failed: ${pub.status} ${JSON.stringify(pub.body)}`);
});

console.log('\nPhase 1 — a fresh place counts, by channel');

await test('1. a fresh owner counts with no setup: one direct visit', async () => {
  const before = await report(S.token);
  assert(before.counting === true && before.owner_enabled === true && before.node_enabled === true, `counting is on by default: ${JSON.stringify(before)}`);
  assert((await open(appPath, CHROME)) === 200, 'open failed');
  const r = await report(S.token);
  assert(r.totals.people === 1, `one person, got ${JSON.stringify(r.totals)}`);
  assert(r.channels.direct === 1, `a visit with no Referer is direct, got ${JSON.stringify(r.channels)}`);
});

await test('2. Referer https://chatgpt.com/ reads as ai/chatgpt', async () => {
  await open(appPath, CHROME, { Referer: 'https://chatgpt.com/' });
  await open(appPath, CHROME, { Referer: `https://chatgpt.com/${SECRET_PATH}` });
  const r = await report(S.token);
  assert(r.channels.ai === 2, `two AI visits, got ${JSON.stringify(r.channels)}`);
  const chatgpt = r.ai_referrals.find((x: any) => x.family === 'chatgpt');
  assert(chatgpt && chatgpt.people === 2, `both from chatgpt, got ${JSON.stringify(r.ai_referrals)}`);
  assert(!JSON.stringify(r).includes('visibility-private-conversation'), 'the report never repeats a Referer path');
});

await test('3. utm_source wins when there is no Referer, and the other channels are told apart', async () => {
  await open(`${appPath}?utm_source=perplexity.ai`, CHROME);
  await open(`${appPath}?utm_source=copilot.com`, CHROME, { Referer: 'https://www.bing.com/' });
  await open(appPath, CHROME, { Referer: 'https://www.google.fi/search?q=private+words' });
  await open(appPath, CHROME, { Referer: 'https://t.co/abc' });
  await open(appPath, CHROME, { Referer: 'https://blog.example.org/post' });
  await open(appPath, CHROME, { Referer: `${BASE}/v1/apps` });
  const r = await report(S.token);
  const fam = Object.fromEntries(r.ai_referrals.map((x: any) => [x.family, x.people]));
  assert(fam.perplexity === 1 && fam.copilot === 1, `perplexity and copilot from utm_source, got ${JSON.stringify(fam)}`);
  assert(r.channels.search === 1 && r.channels.social === 1 && r.channels.referral === 1, `search, social, referral one each, got ${JSON.stringify(r.channels)}`);
  assert(r.channels.internal === 1, `a move from the node's own page is internal, got ${JSON.stringify(r.channels)}`);
});

console.log('\nPhase 2 — which AI fetched what');

await test('4. User-Agent ChatGPT-User is an assistant fetch on its path, GPTBot a crawler fetch', async () => {
  await open(appPath, CHATGPT_USER);
  await open(appPath, GPTBOT);
  await open(appPath, GPTBOT);
  const r = await report(S.token);
  assert(r.assistant_fetches.some((x: any) => x.family === 'chatgpt' && x.fetches === 1), `one assistant fetch, got ${JSON.stringify(r.assistant_fetches)}`);
  assert(r.crawler_fetches.some((x: any) => x.family === 'chatgpt' && x.fetches === 2), `two crawler fetches, got ${JSON.stringify(r.crawler_fetches)}`);
  const path = r.top_paths.find((p: any) => p.target === filename);
  assert(path !== undefined && path.people === 9, `the app is a top path with its nine people, got ${JSON.stringify(r.top_paths)}`);
  assert(path.assistant.chatgpt === 1 && path.crawler.chatgpt === 2, `per-path counts, got ${JSON.stringify(path)}`);
  // Four AI visits by people so far (two from chatgpt, perplexity and copilot): the fetches add none.
  assert(r.channels.ai === 4 && r.totals.people === 9, `machines are not people and have no channel, got ${JSON.stringify({ c: r.channels, t: r.totals })}`);
});

await test('5. the node\'s own discovery files count for the operator, by who fetched them', async () => {
  for (const p of ['/llms.txt', '/AGENTS.md', '/.well-known/mcp.json', '/.well-known/ucp']) {
    assert((await open(p, CLAUDEBOT)) < 500, `${p} failed`);
  }
  await open('/llms.txt', CHROME);
  const r = await report(OP.token);
  const by = Object.fromEntries(r.discovery.map((d: any) => [d.doc, d.by]));
  assert(by['llms.txt']?.claude === 1 && by['llms.txt']?.human === 1, `llms.txt by claude and a person, got ${JSON.stringify(r.discovery)}`);
  assert(by['AGENTS.md']?.claude === 1 && by['mcp.json']?.claude === 1 && by.ucp?.claude === 1, `every discovery file, got ${JSON.stringify(r.discovery)}`);
  const seller = await report(S.token);
  assert(seller.discovery.length === 0, 'the operator\'s files are not counted for the seller');
});

console.log('\nPhase 3 — opting out, and the owner\'s switch');

await test('6. Sec-GPC: 1 and DNT: 1 count in the total and stay out of the channels', async () => {
  const before = await report(S.token);
  await open(appPath, CHROME, { Referer: 'https://chatgpt.com/', 'Sec-GPC': '1' });
  await open(appPath, CHATGPT_USER, { 'DNT': '1' });
  const r = await report(S.token);
  assert(r.totals.requests === before.totals.requests + 2, `both requests are in the total, ${before.totals.requests} → ${r.totals.requests}`);
  assert(r.totals.opted_out === before.totals.opted_out + 2, `both are opted out, got ${r.totals.opted_out}`);
  assert(JSON.stringify(r.channels) === JSON.stringify(before.channels), `the channels did not move: ${JSON.stringify(before.channels)} → ${JSON.stringify(r.channels)}`);
  assert(JSON.stringify(r.ai_referrals) === JSON.stringify(before.ai_referrals), 'nor the AI referrals');
  assert(JSON.stringify(r.assistant_fetches) === JSON.stringify(before.assistant_fetches), 'nor the AI fetches');
  assert(r.totals.people === before.totals.people, 'nor the people');
});

await test('7. the owner switches counting off: nothing new counts, the history stays; on again counts', async () => {
  const before = await report(S.token);
  const off = await json('/v1/visibility/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ enabled: false }) });
  assert(off.status === 200 && off.body.data.enabled === false, `switch off: ${off.status} ${JSON.stringify(off.body)}`);
  await open(appPath, CHROME, { Referer: 'https://chatgpt.com/' });
  const during = await report(S.token);
  assert(during.counting === false && during.owner_enabled === false, 'the report says counting is off');
  assert(during.totals.requests === before.totals.requests, `nothing counted while off, ${before.totals.requests} → ${during.totals.requests}`);
  const read = await json('/v1/visibility/settings', { headers: authed(S.token) });
  assert(read.body.data.enabled === false, 'the switch reads back off');
  const on = await json('/v1/visibility/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ enabled: true }) });
  assert(on.status === 200 && on.body.data.enabled === true, 'switch on');
  await open(appPath, CHROME);
  const after = await report(S.token);
  assert(after.totals.requests === before.totals.requests + 1, 'counting resumes');
  const bad = await json('/v1/visibility/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ enabled: 'yes' }) });
  assert(bad.status === 400, `a non-boolean is refused, got ${bad.status}`);
});

console.log('\nPhase 4 — purchases by the channel they came from');

const PRICE = 10;
let vendorGaii = '';
await test('8. the seller offers a priced job', async () => {
  const ag = await json('/v1/agents', { method: 'POST', headers: authed(S.token), body: JSON.stringify({ name: 'vendor', owner: S.owner, capabilities: ['social'] }) });
  assert(ag.status === 201, `agent ${ag.status}`);
  vendorGaii = `vendor#${S.owner}@${NODE_ID}`;
  const pub = await json('/v1/agents/vendor/offers', {
    method: 'PUT', headers: authed(S.token),
    body: JSON.stringify({ offers: [{ id: 'proofread', title: 'Proofread', ask: 'Send text.', deliverable: { format: 'document', sample: 'untested' }, price: { morsels: PRICE, unit: 'per-call' }, visibility: 'public' }] }),
  });
  assert(pub.status === 200, `offers ${pub.status} ${JSON.stringify(pub.body)}`);
});

async function buy(headers: Record<string, string>, body: Record<string, unknown>, route = '/v1/commerce/checkout-sessions'): Promise<void> {
  const ucp = route.startsWith('/ucp');
  const create = await json(route, {
    method: 'POST', headers: { ...authed(B.token), ...headers },
    body: JSON.stringify(ucp ? { line_items: [{ item: { id: `offer:${vendorGaii}:proofread` }, quantity: 1 }] } : { items: [{ agent: vendorGaii, offer_id: 'proofread' }], ...body }),
  });
  assert(create.status === 201, `create ${create.status} ${JSON.stringify(create.body)}`);
  const id = ucp ? create.body.checkout_session.id : create.body.data.session.id;
  const done = await json(`${route}/${id}/complete`, { method: 'POST', headers: authed(B.token), body: JSON.stringify({}) });
  assert(done.status === 200, `complete ${done.status} ${JSON.stringify(done.body)}`);
}

await test('9. a person from ChatGPT buys on the page: ai / chatgpt / page', async () => {
  await buy({}, { attribution: { referrer: `https://chatgpt.com/${SECRET_PATH}`, utm_source: null } });
  const r = await report(S.token);
  const row = r.purchases.find((p: any) => p.channel === 'ai' && p.family === 'chatgpt' && p.via === 'page');
  assert(row && row.purchases === 1, `the purchase is under ai/chatgpt, got ${JSON.stringify(r.purchases)}`);
  assert(row.amounts.MORSEL === PRICE, `with its amount, got ${JSON.stringify(row.amounts)}`);
  assert(r.totals.ai_referred_purchases === 1, 'and counts as AI-referred');
});

await test('10. a buyer whose browser sends Sec-GPC: 1 is counted under no channel', async () => {
  await buy({ 'Sec-GPC': '1' }, { attribution: { referrer: 'https://chatgpt.com/', utm_source: null } });
  const r = await report(S.token);
  assert(r.purchases.some((p: any) => p.channel === 'none' && p.purchases === 1), `counted as none, got ${JSON.stringify(r.purchases)}`);
  assert(r.totals.ai_referred_purchases === 1, 'not as AI-referred');
});

await test('11. a Copilot agent at the UCP checkout: ai / copilot / agent', async () => {
  await buy({ 'UCP-Agent': 'profile="https://copilot.microsoft.com/.well-known/ucp"' }, {}, '/ucp/v1/checkout-sessions');
  const r = await report(S.token);
  const row = r.purchases.find((p: any) => p.channel === 'ai' && p.family === 'copilot' && p.via === 'agent');
  assert(row && row.purchases === 1, `the agent's purchase is under copilot, got ${JSON.stringify(r.purchases)}`);
  assert(r.totals.purchases === 3, `three purchases in all, got ${r.totals.purchases}`);
});

console.log('\nPhase 5 — the same answer on MCP, and who may read it');

await test('12. an agent holding signals:read gets the same report from aimeat_visibility_report', async () => {
  const rest = await report(S.token);
  const session = await openSession(readerAgent);
  const out = await callTool(session, 'aimeat_visibility_report', {});
  assert(!out.isError, `tool failed: ${out.text}`);
  assert(out.data.totals.requests === rest.totals.requests, `same totals, ${rest.totals.requests} vs ${out.data.totals.requests}`);
  assert(JSON.stringify(out.data.channels) === JSON.stringify(rest.channels), 'same channels');
  assert(typeof out.data.reading.not_seen === 'string' && out.data.reading.not_seen.length > 20, 'the report says what it cannot see');
});

await test('13. an agent holding only memory:read is refused on REST and has no such tool on MCP', async () => {
  const r = await json('/v1/visibility/report', { headers: authed(narrowAgent) });
  assert(r.status === 403, `expected 403, got ${r.status}`);
  const session = await openSession(narrowAgent);
  const out = await callTool(session, 'aimeat_visibility_report', {});
  assert(out.isError, `the tool must not answer: ${out.text.slice(0, 200)}`);
  const set = await json('/v1/visibility/settings', { method: 'PUT', headers: authed(readerAgent), body: JSON.stringify({ enabled: false }) });
  assert(set.status === 403, `signals:read cannot switch counting off, got ${set.status}`);
});

await test('14. a second owner sees none of the seller\'s counts, and no token is 401', async () => {
  const other = await report(B.token);
  assert(other.totals.requests === 0 && other.totals.purchases === 0, `the buyer's own place is empty, got ${JSON.stringify(other.totals)}`);
  const anon = await json('/v1/visibility/report');
  assert(anon.status === 401, `expected 401, got ${anon.status}`);
});

console.log('\nPhase 6 — the owner\'s own analytics tags (layer B)');

/** The served app as a browser runs it: `mode=inline` is the runnable form (without it the apex
 *  answers the file as an attachment, which carries no tags because nothing runs it). */
async function page(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}mode=inline`, { headers: { 'User-Agent': CHROME, Accept: 'text/html' }, redirect: 'manual' });
  return await res.text();
}
const setTags = (token: string, body: Record<string, unknown>) =>
  json('/v1/visibility/settings', { method: 'PUT', headers: authed(token), body: JSON.stringify(body) });
const setBanner = (on: boolean) => json('/v1/admin/config', {
  method: 'PUT', headers: authed(OP.token),
  body: JSON.stringify({ changes: [{ path: 'cookies.consent_enabled', value: on }] }),
});

await test('15. an id of the wrong shape is refused on REST and on MCP, and nothing is stored', async () => {
  const bad = await setTags(S.token, { clarity_project_id: '"><script>alert(1)</script>' });
  assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${bad.status} ${JSON.stringify(bad.body)}`);
  const badGa = await setTags(S.token, { ga4_measurement_id: 'UA-12345-1' });
  assert(badGa.status === 400, `a Universal Analytics id is not a GA4 id, got ${badGa.status}`);
  const session = await openSession(writerAgent);
  const out = await callTool(session, 'aimeat_visibility_settings_set', { clarity_project_id: 'no' });
  assert(out.isError && out.text.startsWith('INVALID_INPUT'), `the tool refuses too: ${out.text.slice(0, 160)}`);
  assert(!(await page(appPath)).includes('data-aimeat-tags'), 'no tag reached the page');
});

await test('16. a Clarity id puts the tag on the app, loading at once without a banner, and the owner is warned', async () => {
  const set = await setTags(S.token, { clarity_project_id: 'k7x2m9qp1a' });
  assert(set.status === 200 && set.body.data.clarity_project_id === 'k7x2m9qp1a', `set: ${set.status} ${JSON.stringify(set.body)}`);
  assert(typeof set.body.data.tags_warning === 'string' && set.body.data.tags_warning.includes('consent'), 'the answer warns about EU consent');
  const html = await page(appPath);
  assert(html.includes('data-aimeat-tags') && html.includes('"k7x2m9qp1a"') && html.includes('B=false'), 'the app carries the tag, not waiting for a banner');
  // The fixture has no <head>: the tag goes after the doctype and before <body>.
  assert(html.toLowerCase().startsWith('<!doctype html>') && html.indexOf('data-aimeat-tags') < html.indexOf('<body'), `after the doctype and before the body: ${html.slice(0, 120)}`);
  const r = await report(S.token);
  assert(r.tags.clarity_project_id === 'k7x2m9qp1a' && r.tags.active === true && typeof r.tags.warning === 'string', `the report shows it: ${JSON.stringify(r.tags)}`);
  const other = await page(`/v1/apps/${S.owner}/${filename}`);
  assert(other.includes('"k7x2m9qp1a"'), 'the same on every serve');
});

await test('17. an agent with signals:write adds GA4 over MCP; one holding only signals:read cannot', async () => {
  const session = await openSession(writerAgent);
  const out = await callTool(session, 'aimeat_visibility_settings_set', { ga4_measurement_id: 'G-ABC123XYZ9' });
  assert(!out.isError && out.data.ga4_measurement_id === 'G-ABC123XYZ9' && out.data.clarity_project_id === 'k7x2m9qp1a', `only the field given changes: ${out.text.slice(0, 300)}`);
  assert((await page(appPath)).includes('"G-ABC123XYZ9"'), 'the page carries GA4 too');
  const reader = await openSession(readerAgent);
  const refused = await callTool(reader, 'aimeat_visibility_settings_set', { ga4_measurement_id: null });
  assert(refused.isError, 'a reader has no such tool');
});

await test('18. with the cookie banner on, the tag waits for consent to analytics and the banner comes with it', async () => {
  const on = await setBanner(true);
  assert(on.status === 200, `banner on: ${on.status} ${JSON.stringify(on.body)}`);
  try {
    const html = await page(appPath);
    assert(html.includes('B=true') && html.includes("acceptedCategory('analytics')"), 'the tag waits for the analytics category');
    assert(/CookieConsent\.run\(.*"analytics"/s.test(html), 'the banner offers analytics to accept');
    assert(!/<script[^>]+(clarity\.ms|googletagmanager)/.test(html), 'no Clarity or Google script element is in the page before consent');
    const r = await report(S.token);
    assert(r.tags.consent_banner === true && r.tags.warning === null, `no warning with the banner: ${JSON.stringify(r.tags)}`);
  } finally {
    const off = await setBanner(false);
    assert(off.status === 200, 'banner back off');
  }
});

await test('19. null removes a tag, and with both removed the page carries none', async () => {
  const cleared = await setTags(S.token, { clarity_project_id: null, ga4_measurement_id: null });
  assert(cleared.status === 200 && cleared.body.data.clarity_project_id === null && cleared.body.data.ga4_measurement_id === null, `cleared: ${JSON.stringify(cleared.body)}`);
  assert(cleared.body.data.enabled === true, 'counting is untouched');
  assert(!(await page(appPath)).includes('data-aimeat-tags'), 'no tag left');
});

console.log('\nPhase 7 — nothing that identifies a visitor is at rest');

await test('20. no IP address, Referer path or User-Agent is stored in any table of the node', async () => {
  await report(S.token);   // the report merges what this process still holds
  await report(OP.token);
  const provider = process.env.AIMEAT_DB ?? 'memory';
  const needles = [VISITOR_IP, 'visibility-private-conversation', 'private+words', 'ChatGPT-User/1.0', 'ClaudeBot/1.0'];
  let rows = 0;
  let control = 0;
  const hits: string[] = [];
  // The positive control: the visibility record itself must be found, so a scan that reads nothing
  // (a wrong file, an empty database) cannot pass by finding no needles.
  const scan = (table: string, text: string): void => {
    rows++;
    if (text.includes('signals.visibility.month.')) control++;
    for (const n of needles) if (text.includes(n)) hits.push(`${table}: ${n}`);
  };
  // eslint-disable-next-line no-restricted-syntax -- both backends are valid: the suite runs on each, and this refuses only the in-memory one, whose data a second handle cannot see.
  assert(provider === 'sqlite' || provider === 'postgres-kysely', `this test reads the node's own database and the runner gave it ${provider}`);
  const target = provider === 'sqlite' ? pinnedSqlitePath() : serverDbUrl();
  assert(target.length > 0, `the runner pins where the ${provider} node keeps its data`);
  if (provider === 'sqlite') {
    const path = target;
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      for (const { name } of tables) {
        for (const row of db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).iterate()) {
          scan(name, JSON.stringify(row, (_k, v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v)));
        }
      }
    } finally { db.close(); }
  } else if (provider === 'postgres-kysely') {
    const url = target;
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
      for (const { table_name } of tables.rows as Array<{ table_name: string }>) {
        const res = await client.query(`SELECT t::text AS row FROM "${table_name.replace(/"/g, '""')}" t`);
        for (const r of res.rows as Array<{ row: string }>) scan(table_name, r.row);
      }
    } finally { await client.end(); }
  }
  assert(rows > 0 && control > 0, `the scan read ${rows} rows and found the visibility records ${control} times`);
  assert(hits.length === 0, `found at rest: ${hits.join('; ')}`);
});

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

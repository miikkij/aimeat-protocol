/**
 * @file test/e2e-app-visitors.ts
 * @description E2E for the visitor report of one published app (GET /v1/apps/visitors, PUT
 *   /v1/apps/visitors/measurement): opens split by whether anybody was signed in, answered as counts
 *   and never as names; the measurement switch that creates the page's signal stream; people against
 *   AI with the AIs named; and where people came from, at the precision the app's owner picked, read
 *   from the headers a reverse proxy sets. The suite stands in for that proxy by sending X-Geo-*
 *   itself, which the runner allows by starting the node with AIMEAT_GEO_HEADERS=true.
 *
 *   The refusals are measured: a second owner asking about this app, a second owner switching its
 *   measurement, an agent of the right owner holding the wrong scope, and an app that does not exist.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-visitors

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
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
      body: JSON.stringify({ username: owner, display_name: owner, password: 'VisitorsTest1234' }),
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
  const name = `visagent${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
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

/** A header value the way nginx forwards a UTF-8 name: raw bytes, which fetch carries as latin1. */
const asProxyBytes = (s: string): string => Buffer.from(s, 'utf8').toString('latin1');

/** Open the app the way a visitor does, with what a proxy would add. */
async function open(path: string, userAgent: string, extra: Record<string, string> = {}): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': userAgent, ...extra } });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    await res.arrayBuffer();
    return res.status;
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));   // the serve path does not await its counters

console.log('═══ E2E: app visitors — who opened my app, when and from where ═══');
console.log(`Base: ${BASE}`);

console.log('\nSetup');
const A = await makeOwner('visown');
const B = await makeOwner('visother');
const narrowAgentToken = await makeAgent(A, ['memory:read']);

const filename = `visitors${Date.now().toString(36).slice(-5)}.html`;
const APP_ID = `${A.owner}/${filename}`;
const appPath = `/v1/apps/${A.owner}/${filename}`;
const reportUrl = (days?: number | string): string =>
  `/v1/apps/visitors?app_id=${encodeURIComponent(APP_ID)}${days === undefined ? '' : `&days=${days}`}`;

await test('0. publish the app the report is about', async () => {
  const html = '<!doctype html><html><body><h1>Visitors demo</h1></body></html>';
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      filename, content: Buffer.from(html, 'utf-8').toString('base64'),
      name: 'Visitors demo', description: 'visitor report fixture', category: 'utility', tags: ['demo'],
    }),
  });
  assert(pub.status === 201, `publish failed: ${pub.status} ${JSON.stringify(pub.body)}`);
});

console.log('\nPhase 1 — opens are always counted, split by whether anybody was signed in');

await test('1. three anonymous opens and two signed-in opens by one person read as 3 + 2, one person', async () => {
  for (let i = 0; i < 3; i++) assert((await open(appPath, CHROME)) === 200, 'anonymous open failed');
  for (let i = 0; i < 2; i++) assert((await open(appPath, CHROME, authed(B.token))) === 200, 'signed-in open failed');
  await settle();

  const rep = await json(reportUrl(), { headers: authed(A.token) });
  assert(rep.status === 200, `expected a report, got ${rep.status} ${JSON.stringify(rep.body)}`);
  const d = rep.body.data;
  assert(d.app === APP_ID, `app echoed as ${d.app}`);
  assert(d.days === 30, `the default window is 30 days, got ${d.days}`);
  assert(d.opens.anonymous === 3, `expected 3 anonymous opens, got ${JSON.stringify(d.opens)}`);
  assert(d.opens.signed_in === 2, `expected 2 signed-in opens, got ${d.opens.signed_in}`);
  assert(d.opens.total === 5, `expected 5 opens, got ${d.opens.total}`);
  assert(d.opens.signed_in_people === 1, `two opens by one person are one person, got ${d.opens.signed_in_people}`);
  assert(d.opens.lifetime >= 5, `the lifetime counter should hold at least these five, got ${d.opens.lifetime}`);
  assert(Array.isArray(d.opens.series) && d.opens.series.length === 1, 'one day of opens is one series entry');
  assert(d.opens.series[0].anonymous === 3 && d.opens.series[0].signed_in === 2, 'the day carries the same split');
});

await test('2. the report counts the visitor and never names them', async () => {
  const rep = await json(reportUrl(), { headers: authed(A.token) });
  assert(!rep.text.includes(B.owner), 'the signed-in visitor\'s name must not appear anywhere in the answer');
});

await test('3. before measurement is on, the second half of the report is null, not zeros', async () => {
  const rep = await json(reportUrl(), { headers: authed(A.token) });
  assert(rep.body.data.measurement.on === false, 'measurement starts off');
  assert(rep.body.data.measurement.geo === 'off', 'and keeps no place');
  assert(rep.body.data.visitors === null, 'an unmeasured app answers null so nobody reads "no AI came"');
});

await test('4. the window is 0 to 360 days: 0 is today, too large is clamped, nonsense is the default', async () => {
  const today = await json(reportUrl(0), { headers: authed(A.token) });
  assert(today.body.data.days === 0 && today.body.data.from === today.body.data.to, 'days=0 is today only');
  assert(today.body.data.opens.total === 5, 'today still holds today\'s opens');
  const wide = await json(reportUrl(9999), { headers: authed(A.token) });
  assert(wide.body.data.days === 360, `9999 clamps to 360, got ${wide.body.data.days}`);
  const junk = await json(reportUrl('abc'), { headers: authed(A.token) });
  assert(junk.body.data.days === 30, `nonsense falls back to 30, got ${junk.body.data.days}`);
});

console.log('\nPhase 2 — the switch, and who came once it is on');

await test('5. switching measurement on at city precision creates the page stream', async () => {
  const on = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(A.token),
    body: JSON.stringify({ app_id: APP_ID, on: true, geo: 'city' }),
  });
  assert(on.status === 200, `switch failed: ${on.status} ${JSON.stringify(on.body)}`);
  assert(on.body.data.on === true && on.body.data.geo === 'city', `answered ${JSON.stringify(on.body.data)}`);
  assert(on.body.data.geo_available === true, 'the runner starts the node with the place headers on');
  const streams = await json('/v1/signals/streams', { headers: authed(A.token) });
  assert(streams.body.data.streams.some((s: any) => s.streamId === on.body.data.stream_id), 'the stream exists on the signals door too');
});

await test('6. two people and two AI fetches: people are placed, machines are not', async () => {
  const helsinki = { 'X-Geo-Country': 'FI', 'X-Geo-Region': 'Uusimaa', 'X-Geo-City': 'Helsinki', 'X-Geo-Lat': '60.1699', 'X-Geo-Lon': '24.9384' };
  const jyvaskyla = { 'X-Geo-Country': 'fi', 'X-Geo-Region': asProxyBytes('Keski-Suomi'), 'X-Geo-City': asProxyBytes('Jyväskylä'), 'X-Geo-Lat': '62.2415', 'X-Geo-Lon': '25.7209' };
  const dataCentre = { 'X-Geo-Country': 'US', 'X-Geo-Region': 'Virginia', 'X-Geo-City': 'Ashburn', 'X-Geo-Lat': '39.0438', 'X-Geo-Lon': '-77.4874' };
  await open(appPath, CHROME, helsinki);
  await open(appPath, CHROME, jyvaskyla);
  await open(appPath, CHATGPT_ASKED, dataCentre);
  await open(appPath, GPTBOT, dataCentre);
  await settle();

  const rep = await json(reportUrl(), { headers: authed(A.token) });
  const v = rep.body.data.visitors;
  assert(v, 'a measured app answers the second half');
  assert(v.total === 4 && v.humans === 2 && v.ai === 2, `expected 2 people and 2 AI, got ${JSON.stringify({ t: v.total, h: v.humans, ai: v.ai })}`);
  const chatgpt = v.ai_agents.find((a: any) => a.name === 'chatgpt');
  assert(chatgpt && chatgpt.asked === 1 && chatgpt.crawled === 1, `chatgpt asked once and crawled once, got ${JSON.stringify(v.ai_agents)}`);

  assert(v.countries.length === 1 && v.countries[0].country === 'FI' && v.countries[0].people === 2,
    `both people are in FI and the data centre is on no map, got ${JSON.stringify(v.countries)}`);
  const cities = v.places.map((p: any) => p.city).sort();
  assert(JSON.stringify(cities) === JSON.stringify(['Helsinki', 'Jyväskylä']), `a UTF-8 city name must survive the header, got ${JSON.stringify(cities)}`);
  const hel = v.places.find((p: any) => p.city === 'Helsinki');
  assert(hel.lat === 60.2 && hel.lon === 24.9, `coordinates are kept to one decimal, got ${hel.lat}, ${hel.lon}`);
  assert(hel.region === 'Uusimaa' && hel.people === 1, `the place carries its region and count, got ${JSON.stringify(hel)}`);
});

await test('7. a person the proxy could not place is counted as unknown, not dropped', async () => {
  await open(appPath, CHROME);   // told nothing: the proxy looked and found no place
  await settle();
  const rep = await json(reportUrl(), { headers: authed(A.token) });
  const v = rep.body.data.visitors;
  const unknown = v.countries.find((c: any) => c.country === v.unknown_country);
  assert(unknown && unknown.people === 1, `expected one unknown place, got ${JSON.stringify(v.countries)}`);
});

await test('8. at country precision a city is not kept, whatever the proxy sends', async () => {
  const set = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ app_id: APP_ID, on: true, geo: 'country' }),
  });
  assert(set.body.data.geo === 'country', 'precision changed');
  await open(appPath, CHROME, { 'X-Geo-Country': 'SE', 'X-Geo-Region': 'Stockholm', 'X-Geo-City': 'Stockholm', 'X-Geo-Lat': '59.33', 'X-Geo-Lon': '18.07' });
  await settle();
  const v = (await json(reportUrl(), { headers: authed(A.token) })).body.data.visitors;
  assert(v.countries.some((c: any) => c.country === 'SE' && c.people === 1), 'the country is counted');
  assert(!v.places.some((p: any) => p.country === 'SE'), `no Swedish place may be kept at country precision, got ${JSON.stringify(v.places)}`);
});

await test('9. a place that is not a country code is not used as one', async () => {
  await open(appPath, CHROME, { 'X-Geo-Country': '__proto__' });
  await open(appPath, CHROME, { 'X-Geo-Country': 'FIN' });
  await settle();
  const v = (await json(reportUrl(), { headers: authed(A.token) })).body.data.visitors;
  assert(v.countries.every((c: any) => /^[A-Z]{2}$/.test(c.country)), `every key is two capital letters, got ${JSON.stringify(v.countries)}`);
  assert(v.countries.find((c: any) => c.country === v.unknown_country).people === 3, 'both land in the unknown place');
});

await test('10. switching off keeps what was collected and stops counting', async () => {
  const off = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ app_id: APP_ID, on: false }),
  });
  assert(off.status === 200 && off.body.data.on === false, `switch off failed: ${off.status}`);
  assert(off.body.data.geo === 'country', 'the chosen precision is remembered for the next time it goes on');
  const before = (await json(reportUrl(), { headers: authed(A.token) })).body.data;
  assert(before.measurement.on === false, 'the report says it is off');
  assert(before.visitors && before.visitors.total === 8, `the eight counted visits are still there, got ${before.visitors?.total}`);
  await open(appPath, CHROME, { 'X-Geo-Country': 'NO' });
  await settle();
  const after = (await json(reportUrl(), { headers: authed(A.token) })).body.data;
  assert(after.visitors.total === 8, 'a disabled stream counts nothing more');
  assert(after.opens.total === before.opens.total + 1, 'while the open itself is still counted, as it always is');
});

console.log('\nPhase 3 — refusals');

await test('11. a second owner cannot read this app\'s visitors', async () => {
  const rep = await json(reportUrl(), { headers: authed(B.token) });
  assert(rep.status === 403, `expected 403 for another owner, got ${rep.status}`);
});

await test('12. a second owner cannot switch this app\'s measurement', async () => {
  const set = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(B.token), body: JSON.stringify({ app_id: APP_ID, on: true, geo: 'city' }),
  });
  assert(set.status === 403, `expected 403 for another owner, got ${set.status}`);
  const still = (await json(reportUrl(), { headers: authed(A.token) })).body.data.measurement;
  assert(still.on === false && still.geo === 'country', 'and nothing changed');
});

await test('13. the owner\'s own agent without the signals scope is refused on both doors', async () => {
  const read = await json(reportUrl(), { headers: authed(narrowAgentToken) });
  assert(read.status === 403, `expected 403 without signals:read, got ${read.status}`);
  const write = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(narrowAgentToken), body: JSON.stringify({ app_id: APP_ID, on: true }),
  });
  assert(write.status === 403, `expected 403 without signals:write, got ${write.status}`);
});

await test('14. no token, a malformed id, an unknown app and an unknown precision', async () => {
  assert((await json(reportUrl())).status === 401, 'no token is 401');
  assert((await json('/v1/apps/visitors?app_id=nonsense', { headers: authed(A.token) })).status === 400, 'a malformed id is 400');
  const missing = await json(`/v1/apps/visitors?app_id=${encodeURIComponent(`${A.owner}/no-such-app.html`)}`, { headers: authed(A.token) });
  assert(missing.status === 404, `an app that does not exist is 404, got ${missing.status}`);
  const bad = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ app_id: APP_ID, on: true, geo: 'street' }),
  });
  assert(bad.status === 400, `an unknown precision is 400, got ${bad.status}`);
});

await test('15. switching off an app that was never measured creates nothing', async () => {
  const other = `unmeasured${Date.now().toString(36).slice(-5)}.html`;
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      filename: other, content: Buffer.from('<!doctype html><p>x</p>', 'utf-8').toString('base64'),
      name: 'Unmeasured', description: 'never measured', category: 'utility', tags: ['demo'],
    }),
  });
  assert(pub.status === 201, `publish failed: ${pub.status}`);
  const before = (await json('/v1/signals/streams', { headers: authed(A.token) })).body.data.streams.length;
  const off = await json('/v1/apps/visitors/measurement', {
    method: 'PUT', headers: authed(A.token), body: JSON.stringify({ app_id: `${A.owner}/${other}`, on: false }),
  });
  assert(off.status === 200 && off.body.data.on === false, 'answers off');
  const after = (await json('/v1/signals/streams', { headers: authed(A.token) })).body.data.streams.length;
  assert(after === before, 'and no stream was made just to be disabled');
});

console.log('\nPhase 4 — the same answer in chat: the two MCP tools');

function parseSSE(text: string): any[] {
  const out: any[] = [];
  const NL = String.fromCharCode(10);
  for (const evt of text.split(NL + NL)) {
    let data = '';
    for (const line of evt.trim().split(NL)) if (line.startsWith('data: ')) data += line.slice(6);
    if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
  }
  return out;
}

/** One MCP tool call on a fresh session. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<{ raw: string; parsed: any; isError: boolean; rpcError: any }> {
  let sessionId = '';
  let id = 1;
  const rpc = async (method: string, params: Record<string, unknown>): Promise<any> => {
    const res = await fetch(`${BASE}/v1/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
    return await res.json();
  };
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'App visitors E2E', version: '1.0.0' } });
  const out = await rpc('tools/call', { name, arguments: args });
  const raw = out?.result?.content?.[0]?.text ?? '';
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* a refusal is prose */ }
  return { raw, parsed, isError: !!out?.result?.isError, rpcError: out?.error ?? null };
}

const signalsAgentToken = await makeAgent(A, ['signals:read', 'signals:write']);
const otherOwnersAgentToken = await makeAgent(B, ['signals:read', 'signals:write']);

await test('16. aimeat_app_visitors answers what the REST door answers', async () => {
  const viaRest = (await json(reportUrl(), { headers: authed(A.token) })).body.data;
  const viaMcp = await mcpCall(signalsAgentToken, 'aimeat_app_visitors', { filename });
  assert(!viaMcp.isError && viaMcp.parsed, `the tool refused: ${viaMcp.raw} ${JSON.stringify(viaMcp.rpcError)}`);
  assert(viaMcp.parsed.app === APP_ID, `the agent's own account names the app, got ${viaMcp.parsed.app}`);
  assert(viaMcp.parsed.opens.total === viaRest.opens.total, 'same opens on both doors');
  assert(viaMcp.parsed.visitors.total === viaRest.visitors.total, 'same visitors on both doors');
});

await test('17. aimeat_app_visitors_measure switches it back on, and the REST door sees it', async () => {
  const on = await mcpCall(signalsAgentToken, 'aimeat_app_visitors_measure', { filename, on: true, geo: 'region' });
  assert(!on.isError && on.parsed?.on === true && on.parsed?.geo === 'region', `the tool answered ${on.raw}`);
  const seen = (await json(reportUrl(), { headers: authed(A.token) })).body.data.measurement;
  assert(seen.on === true && seen.geo === 'region', `the REST door reads ${JSON.stringify(seen)}`);
});

await test('18. another owner\'s agent naming this filename reaches its own account, which has no such app', async () => {
  const read = await mcpCall(otherOwnersAgentToken, 'aimeat_app_visitors', { filename });
  assert(read.isError && read.raw.includes('APP_NOT_FOUND'), `expected APP_NOT_FOUND, got ${read.raw}`);
  const write = await mcpCall(otherOwnersAgentToken, 'aimeat_app_visitors_measure', { filename, on: false });
  assert(write.isError && write.raw.includes('APP_NOT_FOUND'), `expected APP_NOT_FOUND, got ${write.raw}`);
  const still = (await json(reportUrl(), { headers: authed(A.token) })).body.data.measurement;
  assert(still.on === true, 'and this app\'s measurement is untouched');
});

await test('19. an agent without the signals scope cannot call either tool', async () => {
  const read = await mcpCall(narrowAgentToken, 'aimeat_app_visitors', { filename });
  assert(read.isError || read.rpcError, `expected a refusal without signals:read, got ${read.raw}`);
  const write = await mcpCall(narrowAgentToken, 'aimeat_app_visitors_measure', { filename, on: false });
  assert(write.isError || write.rpcError, `expected a refusal without signals:write, got ${write.raw}`);
  const still = (await json(reportUrl(), { headers: authed(A.token) })).body.data.measurement;
  assert(still.on === true, 'and nothing was switched');
});

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

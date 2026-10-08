/**
 * @file test/e2e-behaviour.ts
 * @description E2E for AI visibility, layer D: on-page behaviour and the fixing agent. A served app
 *   carries the behaviour script; the beacon the script sends is counted into the app's record with
 *   its bounds; a dead click on a do-nothing button becomes a finding; an opted-out browser counts as
 *   a view only; the owner switches one app off; and the fixing agent, run on the owner's own AI (a
 *   stand-in model on this machine), writes the findings and a corrected DRAFT while the published
 *   app stays unchanged, and leaves a draft the owner wrote alone.
 *
 *   The script itself (that a click on a button that does nothing is seen as dead in a real browser)
 *   is verified in a browser on a sandbox: this suite sends what the script sends.
 *
 *   Refusals: a second owner sees none of the first owner's counts; an agent with only memory:read is
 *   refused on REST and has no such tool on MCP; no token is 401; a beacon for an unknown app, for
 *   another node's owner or of the wrong shape counts nothing.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=behaviour

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
      body: JSON.stringify({ username: owner, display_name: owner, password: 'BehaviourTest1234' }),
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

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
  const name = `behag${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 900 + 100)}`;
  const reg = await json('/v1/agents', { method: 'POST', headers: authed(ownerCtx.token), body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }) });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key as string, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, 'agent token failed');
  return tok.body.data.token as string;
}

// ── MCP ───────────────────────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
  const id = ++rpcId;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${session.token}`,
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
async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
  const session: McpSession = { token };
  await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-behaviour', version: '1.0.0' } });
  const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
  let data: any;
  try { data = JSON.parse(text); } catch { data = { _text: text }; }
  return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

// ── A stand-in for the owner's AI provider ──────────────────────────────────────────────────

let stub: Server | null = null;
let stubAnswer = '';
let stubCalls = 0;
let lastPrompt = '';
async function startStub(): Promise<string> {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if ((req.url ?? '').includes('/chat/completions')) {
        stubCalls++;
        try { lastPrompt = JSON.stringify(JSON.parse(raw).messages ?? []); } catch { lastPrompt = raw; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: 'stub/fixer', choices: [{ message: { content: stubAnswer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0.0003 },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => stub!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(stub!.address() as AddressInfo).port}/v1`;
}

// ── Setup ─────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: AI visibility layer D — on-page behaviour and the fixing agent ═══');
console.log(`Base: ${BASE}`);

const OP = await makeOwner('behop');
void OP;
const S = await makeOwner('behseller');
const B = await makeOwner('behother');
const narrowAgent = await makeAgent(S, ['memory:read']);
const writerAgent = await makeAgent(S, ['signals:read', 'signals:write']);

const filename = `behaviour${Date.now().toString(36).slice(-5)}.html`;
const ORIGINAL = '<!doctype html><html><head><title>Shop</title></head><body><h1>Shop</h1><button id="buy">Buy</button><p data-original>v1</p></body></html>';
const FIXED = '<!doctype html><html><head><title>Shop</title></head><body><h1>Shop</h1><button id="buy" onclick="this.textContent=\'Added\'">Buy</button><p data-fixed>v2</p></body></html>';

const beacon = (body: unknown, headers: Record<string, string> = {}) => fetch(`${BASE}/v1/signals/behaviour`, {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const behaviour = async (token: string, q = ''): Promise<any> => {
  const r = await json(`/v1/visibility/behaviour${q}`, { headers: authed(token) });
  assert(r.status === 200, `behaviour ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const page = async (): Promise<string> => {
  const r = await fetch(`${BASE}/v1/apps/${S.owner}/${filename}?mode=inline`);
  return await r.text();
};

console.log('\nPhase 1 — the script on the app, and the beacon');

await test('1. a published app carries the behaviour script with its owner and filename, and nothing is set up', async () => {
  const pub = await json('/v1/apps', {
    method: 'POST', headers: authed(S.token),
    body: JSON.stringify({ filename, content: Buffer.from(ORIGINAL).toString('base64'), name: 'Behaviour shop', description: 'behaviour fixture', category: 'utility', tags: ['demo'] }),
  });
  assert(pub.status === 201, `publish ${pub.status} ${JSON.stringify(pub.body)}`);
  const html = await page();
  assert(html.includes('data-aimeat-behaviour'), 'the script is on the page');
  assert(html.includes(JSON.stringify(S.ghii)) && html.includes(JSON.stringify(filename)), 'with the owner and the app');
  assert(html.includes('/v1/signals/behaviour'), 'and the beacon address');
});

await test('2. a dead click on the do-nothing button, sent three times from phones, becomes one finding', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await beacon({ o: S.ghii, a: filename, vc: 'phone', s: '25', h: { phone: { '5,2': 1 } }, d: { 'phone|button#buy': 1 } });
    assert(r.status === 204, `beacon ${r.status}`);
  }
  const rep = await behaviour(S.token, `?app=${encodeURIComponent(filename)}`);
  const app = rep.apps[0];
  assert(app && app.app === filename && app.views === 3 && app.screens.phone === 3, `three phone views, got ${JSON.stringify(app)}`);
  assert(app.dead_clicks[0]?.element === 'button#buy' && app.dead_clicks[0].clicks === 3, `the dead clicks, got ${JSON.stringify(app.dead_clicks)}`);
  assert(app.heat.phone['5,2'] === 3, `the click grid, got ${JSON.stringify(app.heat)}`);
  const f = app.findings.find((x: any) => x.kind === 'dead');
  assert(f && f.text === 'On phones, 3 clicks on button#buy changed nothing on the page.', `the finding, got ${JSON.stringify(app.findings)}`);
});

await test('3. Sec-GPC: 1 counts a view and nothing else, whatever the body says', async () => {
  await beacon({ o: S.ghii, a: filename, vc: 'desktop', d: { 'desktop|button#buy': 5 } }, { 'Sec-GPC': '1' });
  const app = (await behaviour(S.token, `?app=${encodeURIComponent(filename)}`)).apps[0];
  assert(app.views === 4 && app.opted_out === 1, `a view, opted out; got ${app.views}/${app.opted_out}`);
  assert(app.screens.desktop === 0 && !app.dead_clicks.some((d: any) => d.screen === 'desktop'), 'no desktop count');
});

await test('4. a beacon for an unknown app, another node\'s owner, or of the wrong shape counts nothing', async () => {
  const before = (await behaviour(S.token)).apps.reduce((n: number, a: any) => n + a.views, 0);
  for (const b of [
    { o: S.ghii, a: 'no-such-app.html', vc: 'phone' },
    { o: `${S.owner}@another-node`, a: filename, vc: 'phone' },
    'not json',
    { o: S.ghii, a: filename, h: 'nope' },
  ]) {
    const r = await beacon(b);
    assert(r.status === 204, `always 204, got ${r.status}`);
  }
  const after = (await behaviour(S.token)).apps.reduce((n: number, a: any) => n + a.views, 0);
  assert(after === before, `nothing counted: ${before} → ${after}`);
});

await test('5. the owner switches the app off: no script, no counts, the history stays; on again counts', async () => {
  const off = await json('/v1/visibility/behaviour/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ app: filename, app_enabled: false }) });
  assert(off.status === 200 && off.body.data.off_apps.includes(filename), `off ${off.status} ${JSON.stringify(off.body)}`);
  assert(!(await page()).includes('data-aimeat-behaviour'), 'no script on the page');
  await beacon({ o: S.ghii, a: filename, vc: 'tablet' });
  const app = (await behaviour(S.token, `?app=${encodeURIComponent(filename)}`)).apps[0];
  assert(app.views === 4 && app.counting === false, `nothing new, history kept; got ${app.views}, counting ${app.counting}`);
  const on = await json('/v1/visibility/behaviour/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ app: filename, app_enabled: true }) });
  assert(on.status === 200 && !on.body.data.off_apps.includes(filename), 'on again');
  assert((await page()).includes('data-aimeat-behaviour'), 'the script is back');
  const missing = await json('/v1/visibility/behaviour/settings', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ app: 'nope.html', app_enabled: false }) });
  assert(missing.status === 404, `an app the owner does not have is 404, got ${missing.status}`);
});

console.log('\nPhase 2 — who may read it');

await test('6. another owner sees none of it; memory:read is refused on REST and MCP; no token is 401', async () => {
  const other = await behaviour(B.token);
  assert(other.apps.length === 0, `the other owner has no apps here, got ${JSON.stringify(other.apps)}`);
  const narrow = await json('/v1/visibility/behaviour', { headers: authed(narrowAgent) });
  assert(narrow.status === 403, `memory:read → 403, got ${narrow.status}`);
  const tool = await callTool(narrowAgent, 'aimeat_visibility_behaviour', {});
  assert(tool.isError, `no such tool for memory:read: ${tool.text.slice(0, 160)}`);
  const anon = await json('/v1/visibility/behaviour');
  assert(anon.status === 401, `no token → 401, got ${anon.status}`);
  const fix = await json('/v1/visibility/behaviour/fix', { method: 'POST', headers: authed(B.token), body: JSON.stringify({ app: filename }) });
  assert(fix.status === 404, `another owner cannot run the fixer on this app, got ${fix.status}`);
});

await test('7. an agent with signals:read and signals:write reads the same report and switches the fixer on over MCP', async () => {
  const rest = await behaviour(S.token, `?app=${encodeURIComponent(filename)}`);
  const mcp = await callTool(writerAgent, 'aimeat_visibility_behaviour', { app: filename });
  assert(!mcp.isError && JSON.stringify(mcp.data.apps) === JSON.stringify(rest.apps), `same apps on MCP: ${mcp.text.slice(0, 200)}`);
  const set = await callTool(writerAgent, 'aimeat_visibility_behaviour_set', { fixer: true });
  assert(!set.isError && set.data.fixer === true, `fixer on: ${set.text.slice(0, 200)}`);
});

console.log('\nPhase 3 — the fixing agent writes a draft and never publishes');

const stubBase = await startStub();
await test('8. with the owner\'s AI pointed at a stand-in, the fixing agent writes the findings and a corrected draft', async () => {
  const s = await json('/v1/memory', {
    method: 'POST', headers: authed(S.token),
    body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: stubBase, model: 'stub/fixer', daily_budget_usd: 50 } }),
  });
  assert(s.status === 200 || s.status === 201, `AI settings ${s.status} ${JSON.stringify(s.body?.error)}`);
  stubAnswer = `Here is the corrected file.\n\`\`\`html\n${FIXED}\n\`\`\``;
  const r = await json('/v1/visibility/behaviour/fix', { method: 'POST', headers: authed(S.token), body: JSON.stringify({ app: filename }) });
  assert(r.status === 200, `fix ${r.status} ${JSON.stringify(r.body)}`);
  const run = r.body.data;
  assert(run.draft === true && run.note === null, `a draft, no note; got ${JSON.stringify(run)}`);
  assert(run.findings.some((f: any) => f.kind === 'dead' && f.element === 'button#buy'), 'with the dead-click finding');
  assert(stubCalls === 1 && lastPrompt.includes('button#buy changed nothing') && lastPrompt.includes('data-original'), 'the AI was given the finding and the app');
  const draft = await json(`/v1/apps/${S.owner}/${filename}/draft`, { headers: authed(S.token) });
  assert(draft.status === 200 && Buffer.from(draft.body.data.content, 'base64').toString('utf-8').includes('data-fixed'), `the draft is the corrected app: ${draft.status}`);
});

await test('9. the published app is unchanged until the owner publishes the draft', async () => {
  const html = await page();
  assert(html.includes('data-original') && !html.includes('data-fixed'), 'the live app is the original');
  const settings = await json('/v1/visibility/behaviour/settings', { headers: authed(S.token) });
  assert(settings.body.data.runs[0]?.draft === true && settings.body.data.runs[0]?.app === filename, 'the run is kept');
});

await test('10. a draft the owner wrote is left alone, and the run says why', async () => {
  const own = '<!doctype html><html><body data-owner-draft>mine</body></html>';
  const put = await json(`/v1/apps/${S.owner}/${filename}/draft`, { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ content: Buffer.from(own).toString('base64') }) });
  assert(put.status === 200 || put.status === 201, `owner draft ${put.status} ${JSON.stringify(put.body?.error)}`);
  const before = stubCalls;
  const r = await callTool(writerAgent, 'aimeat_visibility_behaviour_fix', { app: filename });
  assert(!r.isError && r.data.draft === false && /unpublished draft/.test(r.data.note), `left alone: ${r.text.slice(0, 300)}`);
  assert(stubCalls === before, 'no AI call was spent');
  const draft = await json(`/v1/apps/${S.owner}/${filename}/draft`, { headers: authed(S.token) });
  assert(Buffer.from(draft.body.data.content, 'base64').toString('utf-8').includes('data-owner-draft'), 'the owner\'s draft is intact');
  const del = await json(`/v1/apps/${S.owner}/${filename}/draft`, { method: 'DELETE', headers: authed(S.token) });
  assert(del.status === 200, `discard ${del.status}`);
});

await test('11. an answer that is not a complete HTML file writes no draft', async () => {
  stubAnswer = 'I would change the button so it adds the item to the cart.';
  const r = await json('/v1/visibility/behaviour/fix', { method: 'POST', headers: authed(S.token), body: JSON.stringify({ app: filename }) });
  assert(r.status === 200 && r.body.data.draft === false && /complete HTML file/.test(r.body.data.note), `no draft: ${JSON.stringify(r.body.data)}`);
  const draft = await json(`/v1/apps/${S.owner}/${filename}/draft`, { headers: authed(S.token) });
  assert(draft.status === 404, `no draft exists, got ${draft.status}`);
});

stub?.close();
console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/e2e-classification.ts
 * @description E2E for content classification (TARGET-082), acceptance criterion 3: with the same
 *   data, what an AI reader sees of a hidden, a warning and an allowed item is the same on every
 *   surface it reads through. Four of them:
 *     REST           an agent's own token against /v1/memory
 *     node MCP       an agent's MCP session at /v1/mcp (src/mcp/)
 *     connector MCP  the real `aimeat connect serve --http` daemon, over its MCP endpoint and its
 *                    shell-callable dispatch /local/call (src/cli/connect/, src/tool-dispatch/)
 *     extension      a tiny extension that reads a key through ctx.memory.getPublic, invoked with
 *                    the agent's token so the extension's caller is the AI
 *   Hidden reads as absent and is not in a list or a search; warning carries its warning; allowed is
 *   plain. Two sets of data make that true for the three reads an agent has: the owner's own records
 *   (read with owner_scope, labelled by the owner) and the agent's own records (searched, labelled by
 *   the detection rules on write).
 *
 *   Also here: the node's switch set over MCP by the operator's agent and over REST, each change a
 *   row in the node audit log, and an AI's loosening of it refused; the explorer (the classifications
 *   on a person's content and the items where a suggestion waits) on REST, node MCP and the connector;
 *   and the denials: another owner reads and sets nothing of an owner's organism, an agent does not
 *   review a label suggestion or a policy proposal, a non-operator does not move the switch.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-classification
 * @version-history
 *   v1.3.0 — 2026-09-30 — AI-SEND: an agent's export takes its record hidden from AI once the person
 *     makes an ai-send exception with a reason (the AI cannot send what it cannot see), audited as
 *     shown and as exported, and leaves it out again once withdrawn.
 *   v1.2.0 — 2026-09-30 — Jouni's decisions of 2026-09-30: no default classification hides content
 *     from AI (the suite shows it, then the operator hides highly confidential for the parity tests);
 *     section 10, the exceptions list on REST, node MCP and the connector (a person makes one with a
 *     reason, the export honours it and the audit shows it, an agent makes none, another owner sees
 *     and withdraws none, a withdrawn one stops) and an app's lowering recorded as an exception.
 *   v1.1.0 — 2026-09-30 — Section 9, the decisions of 2026-09-30: an anonymous reader does not get
 *     what is hidden from AI; humanSaid from an agent raises at once and a lowering waits for the
 *     person (PERSON_APPROVES, PERSON_REQUIRED for the agent); one label per document with the
 *     lowering in the audit log; the GDPR export takes the organism record, the ordinary one does not.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review: four-path parity, the switch, the explorer).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { nodeEntryArgs } from './helpers/node-entry.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The daemon's secret from serve.json, sent on every call to the daemon and never to the node. */
let daemonSecret = '';
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;

async function json(path: string, opts: RequestInit = {}, base = BASE): Promise<{ status: number; body: any }> {
  const extra = LOOPBACK.test(base) && daemonSecret ? { Authorization: `Bearer ${daemonSecret}` } : {};
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...extra, ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

/** The warning a record carries, under either name a surface uses for it. */
const warningOf = (o: any) => o?.classification_warning ?? o?.classificationWarning ?? null;

// ─── Principals ───

interface Session { token: string; sessionId: string; nextId: number }
interface Agent { name: string; gaii: string; key: string; token: string; mcp: Session }
interface Owner { name: string; ghii: string; token: string }

async function owner(label: string): Promise<Owner> {
  const name = `cls${label}${Date.now()}`;
  const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token };
}

async function rpc(s: Session, method: string, params: Record<string, unknown> = {}) {
  const id = s.nextId++;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${s.token}`,
      ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) s.sessionId = sid;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/event-stream')) return await res.json() as any;
  for (const evt of (await res.text()).split('\n\n')) {
    const data = evt.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
    if (!data) continue;
    try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
  }
  return {};
}

/** A node MCP tool call: { isError, text, payload } with the text parsed when it is JSON. */
async function nodeTool(s: Session, name: string, args: Record<string, unknown>) {
  const body = await rpc(s, 'tools/call', { name, arguments: args });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
  let payload: any = null;
  try { payload = JSON.parse(text); } catch { /* a refusal is text */ }
  return { isError: body?.result?.isError === true || body?.error !== undefined, text, payload };
}

async function agent(o: Owner, name: string, scopes: string[]): Promise<Agent> {
  const r = await json('/v1/agents', { method: 'POST', headers: auth(o.token), body: JSON.stringify({ name, owner: o.name, capabilities: ['memory'], model: 'test', scopes }) });
  assert(r.status === 201, `agent ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const gaii = r.body.data.agent.gaii as string;
  const key = r.body.data.private_key as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(key, gaii + ts) }) });
  assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
  const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: `classification ${name}`, redirect_uris: [] }) });
  const ats = new Date().toISOString();
  const params = new URLSearchParams({ response_type: 'code', client_id: client.body.client_id, gaii, signature: await sign(key, gaii + NODE_ID + ats), timestamp: ats });
  const code = await json(`/v1/mcp/authorize?${params}`);
  const mt = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: code.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }) });
  assert(mt.status === 200, `mcp token ${name}: ${mt.status} ${JSON.stringify(mt.body)}`);
  const mcp: Session = { token: mt.body.access_token, sessionId: '', nextId: 1 };
  await rpc(mcp, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'classification e2e', version: '1.0.0' } });
  await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mcp.token}`, 'mcp-session-id': mcp.sessionId, 'mcp-protocol-version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return { name, gaii, key, token: tok.body.data.token, mcp };
}

// ─── The connector daemon ───

function writeConnectorHome(home: string, agents: Array<{ agent: string; owner: string; token: string; primary: boolean }>): void {
  mkdirSync(join(home, 'tokens'), { recursive: true });
  for (const a of agents) {
    mkdirSync(join(home, 'agents', a.agent), { recursive: true });
    writeFileSync(join(home, 'tokens', `${a.agent}@${a.owner}.token`), a.token, 'utf-8');
    writeFileSync(join(home, 'agents', a.agent, 'config.yaml'), yamlStringify({ agent: a.agent, owner: a.owner, node_url: BASE, primary: a.primary }), 'utf-8');
  }
}

async function waitForDiscovery(home: string, timeoutMs = 40_000): Promise<any> {
  const file = join(home, 'serve.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ } }
    await sleep(150);
  }
  throw new Error(`serve.json did not appear in ${home} within ${timeoutMs}ms`);
}

async function connectorTool(client: Client, name: string, args: Record<string, unknown>) {
  let r: any;
  try { r = await client.callTool({ name, arguments: args }); }
  catch (err: any) { return { isError: true, payload: null as any, raw: String(err?.message ?? err) }; }
  const raw = (r.content ?? []).map((c: any) => c.text ?? '').join('\n');
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { /* not JSON */ }
  return { isError: r.isError === true, payload, raw };
}

// ─── State ───

const stamp = Date.now();
const home = resolve(process.cwd(), `test/.tmp-classification-${stamp}`);
const EXT = `clsext${stamp}`;
let op: Owner, alice: Owner, bob: Owner;
let opAgent: Agent, bot: Agent, bobBot: Agent;
let daemon: ChildProcess | null = null;
let daemonOut = '';
let loopback = '';
let connector: Client | null = null;
let orgId = '';

/** The owner's three records (read with owner_scope) and the agent's three (searched). */
const OWN = { hidden: 'cls.hidden', warning: 'cls.warning', allowed: 'cls.allowed' };
const AGT = { hidden: 'clsa.hidden', warning: 'clsa.warning', allowed: 'clsa.allowed' };
const WORD = `zebrafrost${stamp}`;

const setSwitchInPerson = (token: string, mode: string) => json('/v1/admin/config', {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ changes: [{ path: 'classification.mode', value: mode }] }),
});
const modeNow = async (token: string) => (await json('/v1/classification/policy?level=owner', { headers: auth(token) })).body?.data?.mode;

console.log('\n=== Content classification: four-path parity, the switch, the explorer (TARGET-082) ===\n');

await test('Setup: the operator (first owner), two owners, their agents, and the operator\'s agent with operator:admin', async () => {
  op = await owner('op');
  alice = await owner('alice');
  bob = await owner('bob');
  opAgent = await agent(op, 'clsopbot', ['*', 'operator:admin']);
  bot = await agent(alice, 'clsbot', ['*']);
  bobBot = await agent(bob, 'clsbobbot', ['*']);
  // Whatever the developer's .env says, the suite starts from off, set by the operator in person.
  const r = await setSwitchInPerson(op.token, 'off');
  assert(r.status === 200, `switch off: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

// ─── 1. The switch ───
console.log('\nThe switch: an operator sets it, every change is recorded, an AI does not loosen it');

await test('DENIAL: a non-operator moves the switch neither over REST nor through their agent over MCP', async () => {
  const rest = await json('/v1/classification/switch', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ mode: 'all' }) });
  assert(rest.status === 403 && rest.body?.error?.code === 'OPERATOR_REQUIRED', `REST: ${rest.status} ${JSON.stringify(rest.body?.error)}`);
  const mcp = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'switch_set', mode: 'all' });
  assert(mcp.isError && mcp.text.startsWith('OPERATOR_REQUIRED'), `MCP: ${mcp.text.slice(0, 200)}`);
  assert(await modeNow(op.token) === 'off', 'the switch did not move');
});

await test('NODE MCP: the operator\'s agent turns classification on (off → owner → all)', async () => {
  const a = await nodeTool(opAgent.mcp, 'aimeat_classification', { action: 'switch_set', mode: 'owner' });
  assert(!a.isError && a.payload?.applied === true && a.payload?.from === 'off', `owner: ${a.text.slice(0, 200)}`);
  const b = await nodeTool(opAgent.mcp, 'aimeat_classification', { action: 'switch_set', level: 'node', mode: 'all' });
  assert(!b.isError && b.payload?.applied === true && b.payload?.from === 'owner', `all: ${b.text.slice(0, 200)}`);
  assert(await modeNow(op.token) === 'all', 'the switch reads all');
});

await test('NODE MCP: the operator\'s agent may not turn it off or back to owner (PERSON_REQUIRED)', async () => {
  for (const mode of ['off', 'owner']) {
    const r = await nodeTool(opAgent.mcp, 'aimeat_classification', { action: 'switch_set', mode });
    assert(r.isError && r.text.startsWith('PERSON_REQUIRED') && /admin Config page/.test(r.text), `${mode}: ${r.text.slice(0, 200)}`);
  }
  assert(await modeNow(op.token) === 'all', 'the switch stayed at all');
});

await test('REST: the operator in person moves it both ways on the Config endpoint and on /v1/classification/switch', async () => {
  const a = await setSwitchInPerson(op.token, 'owner');
  assert(a.status === 200, `config: ${a.status} ${JSON.stringify(a.body?.error)}`);
  const b = await json('/v1/classification/switch', { method: 'PUT', headers: auth(op.token), body: JSON.stringify({ mode: 'all' }) });
  assert(b.status === 200 && b.body.data.applied === true && b.body.data.from === 'owner', `switch: ${b.status} ${JSON.stringify(b.body)}`);
  const same = await json('/v1/classification/switch', { method: 'PUT', headers: auth(op.token), body: JSON.stringify({ mode: 'all' }) });
  assert(same.status === 200 && same.body.data.applied === false, 'the same value again changes nothing');
  const bad = await json('/v1/classification/switch', { method: 'PUT', headers: auth(op.token), body: JSON.stringify({ mode: 'sometimes' }) });
  assert(bad.status === 400, `an unknown mode: ${bad.status}`);
});

await test('AUDIT: every switch change is a row at level node, with who, how and from what to what', async () => {
  const r = await json('/v1/classification/audit?level=node&action=changed', { headers: auth(op.token) });
  assert(r.status === 200, `audit: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const rows = (r.body.data.rows as any[]).filter(x => x.key === 'classification.mode');
  const byAgent = rows.filter(x => x.reader === opAgent.gaii);
  const inPerson = rows.filter(x => x.readerKind === 'human');
  assert(byAgent.length > 0 && byAgent.every(x => x.readerKind === 'ai'), `the agent's changes: ${JSON.stringify(rows)}`);
  assert(byAgent.reduce((n, x) => n + x.count, 0) === 2, `two changes by the agent, got ${JSON.stringify(byAgent)}`);
  // The setup's "off" moved nothing on a node that starts off, so it is not a change; the two moves
  // the operator made in person are. Two changes in one minute may share a row with a count of 2,
  // which keeps the last purpose.
  assert(inPerson.reduce((n, x) => n + x.count, 0) >= 2, `the operator's own changes: ${JSON.stringify(inPerson)}`);
  assert(inPerson.some(x => x.purpose === 'owner → all'), `the last in-person change reads owner → all: ${JSON.stringify(inPerson)}`);
  assert(rows.every(x => /^(off|owner|all) → (off|owner|all)$/.test(x.purpose)), `purpose reads from → to: ${JSON.stringify(rows.map(x => x.purpose))}`);
  assert(rows.every(x => x.ownerGaii === null), 'a switch row belongs to no owner');
});

await test('DENIAL: a non-operator does not read the node log, and the switch rows are in no owner\'s log', async () => {
  const node = await json('/v1/classification/audit?level=node', { headers: auth(alice.token) });
  assert(node.status === 403, `non-operator at level node: ${node.status}`);
  const own = await json('/v1/classification/audit?level=owner', { headers: auth(op.token) });
  assert(own.status === 200 && !(own.body.data.rows as any[]).some(x => x.key === 'classification.mode'), 'not in the operator\'s own log');
});

// ─── 2. The data ───
console.log('\nThe data: the owner labels three records; the rules label three the agent wrote');

await test('The owner writes three public records and classifies them: highly confidential, confidential, public', async () => {
  const labels: Record<string, string> = { [OWN.hidden]: 'erittain-luottamuksellinen', [OWN.warning]: 'luottamuksellinen', [OWN.allowed]: 'julkinen' };
  for (const [key, label] of Object.entries(labels)) {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key, value: { note: `the ${key} record` }, visibility: 'public' }) });
    assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const l = await json('/v1/classification/label', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ key, label }) });
    assert(l.status === 200 && l.body.data.applied === true && l.body.data.locked === true, `label ${key}: ${l.status} ${JSON.stringify(l.body)}`);
  }
});

await test('The agent writes three records; the detection rules classify two of them on write', async () => {
  const values: Record<string, string> = {
    [AGT.hidden]: `${WORD} login note, password: hunter2secret`,
    [AGT.warning]: `${WORD} invoice paid to FI2112345600000785`,
    [AGT.allowed]: `${WORD} a plain note`,
  };
  for (const [key, value] of Object.entries(values)) {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ key, value, visibility: 'private' }) });
    assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
  }
  // Classification on write runs off the request path: wait until the owner's explorer shows both.
  let got: Record<string, string> = {};
  for (let i = 0; i < 40; i++) {
    const r = await json('/v1/classification/labels?limit=200', { headers: auth(alice.token) });
    got = Object.fromEntries((r.body?.data?.items ?? []).map((x: any) => [x.key, x.label]));
    if (got[AGT.hidden] && got[AGT.warning]) break;
    await sleep(250);
  }
  assert(got[AGT.hidden] === 'erittain-luottamuksellinen', `the password record: ${JSON.stringify(got)}`);
  assert(got[AGT.warning] === 'luottamuksellinen', `the IBAN record: ${JSON.stringify(got)}`);
  assert(!got[AGT.allowed], 'the plain record has no stored classification');
});

/** The node policy with highly confidential set to `ai`, written by the operator in person. */
async function setHighlyConfidential(ai: 'hidden' | 'warning') {
  const cur = await json('/v1/classification/policy?level=node', { headers: auth(op.token) });
  assert(cur.status === 200, `read the node policy: ${cur.status} ${JSON.stringify(cur.body?.error)}`);
  const policy = cur.body.data.stored ?? cur.body.data.effective;
  policy.labels = (policy.labels as any[]).map(l => (l.id === 'erittain-luottamuksellinen' ? { ...l, aiVisibility: ai } : l));
  return json('/v1/classification/policy', { method: 'PUT', headers: auth(op.token), body: JSON.stringify({ level: 'node', policy }) });
}

await test('DEFAULT: no default classification hides content from AI; the agent reads the highly confidential record with a warning (decided 2026-09-30)', async () => {
  const node = await json('/v1/classification/policy?level=node', { headers: auth(op.token) });
  const labels = node.body?.data?.effective?.labels as any[];
  assert(Array.isArray(labels) && labels.every(l => l.aiVisibility !== 'hidden'), `a default label hides: ${JSON.stringify(labels?.map(l => [l.id, l.aiVisibility]))}`);
  const r = await json(`/v1/memory/${encodeURIComponent(OWN.hidden)}?owner_scope=true`, { headers: auth(bot.token) });
  assert(r.status === 200 && warningOf(r.body.data)?.label === 'erittain-luottamuksellinen', `the agent's read: ${r.status} ${JSON.stringify(r.body?.data).slice(0, 300)}`);
});

await test('The operator chooses to hide highly confidential content from AI on this node; the rest of the suite reads that', async () => {
  const r = await setHighlyConfidential('hidden');
  assert(r.status === 200 && r.body.data.applied === true, `hide: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
});

// ─── 3. REST ───
console.log('\nPath 1: REST, the agent\'s own token');

await test('REST: hidden reads as absent, warning carries its warning, allowed is plain', async () => {
  const q = (k: string) => json(`/v1/memory/${encodeURIComponent(k)}?owner_scope=true`, { headers: auth(bot.token) });
  const h = await q(OWN.hidden);
  assert(h.status === 404, `hidden: ${h.status}`);
  const w = await q(OWN.warning);
  assert(w.status === 200, `warning: ${w.status}`);
  assert(!!warningOf(w.body.data), `the warning travels with the value: ${JSON.stringify(w.body.data).slice(0, 300)}`);
  const a = await q(OWN.allowed);
  assert(a.status === 200 && !warningOf(a.body.data), `allowed: ${a.status}`);
  const own = await json(`/v1/memory/${encodeURIComponent(AGT.hidden)}`, { headers: auth(bot.token) });
  assert(own.status === 404, `the agent's own hidden record: ${own.status}`);
});

await test('REST: hidden is in no list and no search; the other two are', async () => {
  const list = await json('/v1/memory?owner_scope=true&prefix=cls.', { headers: auth(bot.token) });
  const keys = (list.body?.data?.items ?? []).map((x: any) => x.key);
  assert(!keys.includes(OWN.hidden) && keys.includes(OWN.warning) && keys.includes(OWN.allowed), `list: ${keys.join(', ')}`);
  const s = await json(`/v1/memory/search?q=${WORD}`, { headers: auth(bot.token) });
  const hits = (s.body?.data?.results ?? s.body?.data?.items ?? s.body?.data?.hits ?? []).map((x: any) => x.key);
  assert(!hits.includes(AGT.hidden) && hits.includes(AGT.warning) && hits.includes(AGT.allowed), `search: ${JSON.stringify(s.body?.data).slice(0, 300)}`);
});

await test('POSITIVE CONTROL: the owner in person reads the hidden record', async () => {
  const r = await json(`/v1/memory/${OWN.hidden}`, { headers: auth(alice.token) });
  assert(r.status === 200, `owner read: ${r.status}`);
});

// ─── 4. Node MCP ───
console.log('\nPath 2: the node\'s MCP endpoint, the agent\'s session');

await test('NODE MCP: hidden reads as absent, warning carries classification_warning, allowed is plain', async () => {
  const h = await nodeTool(bot.mcp, 'aimeat_memory_read', { key: OWN.hidden, owner_scope: true });
  assert(h.isError && !h.text.includes('the cls.hidden record'), `hidden: ${h.text.slice(0, 200)}`);
  const w = await nodeTool(bot.mcp, 'aimeat_memory_read', { key: OWN.warning, owner_scope: true });
  assert(!w.isError && !!warningOf(w.payload), `warning: ${w.text.slice(0, 300)}`);
  const a = await nodeTool(bot.mcp, 'aimeat_memory_read', { key: OWN.allowed, owner_scope: true });
  assert(!a.isError && !warningOf(a.payload), `allowed: ${a.text.slice(0, 200)}`);
});

await test('NODE MCP: hidden is in no list and no search', async () => {
  const l = await nodeTool(bot.mcp, 'aimeat_memory_list', { prefix: 'cls.', owner_scope: true });
  const items = Array.isArray(l.payload) ? l.payload : l.payload?.items ?? [];
  const keys = items.map((x: any) => x.key);
  assert(!keys.includes(OWN.hidden) && keys.includes(OWN.warning) && keys.includes(OWN.allowed), `list: ${keys.join(', ')}`);
  const s = await nodeTool(bot.mcp, 'aimeat_memory_search', { query: WORD });
  const hits = (s.payload?.hits ?? []).map((x: any) => x.key);
  assert(!hits.includes(AGT.hidden) && hits.includes(AGT.warning) && hits.includes(AGT.allowed), `search: ${s.text.slice(0, 300)}`);
});

// ─── 5. The connector ───
console.log('\nPath 3: the connector daemon, over its MCP endpoint and /local/call');

await test('The connector daemon starts with the agent and the operator\'s agent', async () => {
  writeConnectorHome(home, [
    { agent: bot.name, owner: alice.name, token: bot.token, primary: true },
    { agent: opAgent.name, owner: op.name, token: opAgent.token, primary: false },
  ]);
  daemon = spawn('node', [...nodeEntryArgs(), 'connect', 'serve', '--http'], { cwd: process.cwd(), env: { ...process.env, AIMEAT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  daemon.stdout?.on('data', (d) => { daemonOut += d.toString(); });
  daemon.stderr?.on('data', (d) => { daemonOut += d.toString(); });
  const disc = await waitForDiscovery(home).catch((err) => { throw new Error(`${err.message}\n${daemonOut.slice(-2000)}`); });
  assert(disc.agents?.length === 2, `both agents registered: ${JSON.stringify(disc.agents)}`);
  loopback = `http://127.0.0.1:${disc.port}`;
  daemonSecret = String(disc.secret ?? '');
  connector = new Client({ name: 'classification-e2e', version: '1.0.0' });
  await connector.connect(new StreamableHTTPClientTransport(new URL(`${loopback}/v1/mcp`), { requestInit: { headers: { Authorization: `Bearer ${daemonSecret}` } } }));
});

await test('CONNECTOR MCP: hidden reads as absent, warning carries its warning, allowed is plain', async () => {
  assert(!!connector, 'the daemon is up');
  const h = await connectorTool(connector!, 'aimeat_memory_read', { key: OWN.hidden, owner_scope: true });
  assert(h.isError && !h.raw.includes('the cls.hidden record'), `hidden: ${h.raw.slice(0, 200)}`);
  const w = await connectorTool(connector!, 'aimeat_memory_read', { key: OWN.warning, owner_scope: true });
  assert(!w.isError && !!warningOf(w.payload), `warning: ${w.raw.slice(0, 300)}`);
  const a = await connectorTool(connector!, 'aimeat_memory_read', { key: OWN.allowed, owner_scope: true });
  assert(!a.isError && !warningOf(a.payload), `allowed: ${a.raw.slice(0, 200)}`);
});

await test('CONNECTOR MCP: hidden is in no list and no search', async () => {
  const l = await connectorTool(connector!, 'aimeat_memory_list', { prefix: 'cls.', owner_scope: true });
  const items = Array.isArray(l.payload) ? l.payload : l.payload?.items ?? [];
  const keys = items.map((x: any) => x.key);
  assert(!keys.includes(OWN.hidden) && keys.includes(OWN.warning) && keys.includes(OWN.allowed), `list: ${l.raw.slice(0, 300)}`);
  const s = await connectorTool(connector!, 'aimeat_memory_search', { query: WORD });
  const hits = (s.payload?.results ?? s.payload?.items ?? s.payload?.hits ?? []).map((x: any) => x.key);
  assert(!hits.includes(AGT.hidden) && hits.includes(AGT.warning), `search: ${s.raw.slice(0, 300)}`);
});

await test('CONNECTOR /local/call: the shell-callable read answers hidden as absent too', async () => {
  const h = await json('/local/call/aimeat_memory_read', { method: 'POST', body: JSON.stringify({ key: OWN.hidden, owner_scope: true }) }, loopback);
  assert(h.body?.ok === false, `hidden: ${JSON.stringify(h.body).slice(0, 200)}`);
  const w = await json('/local/call/aimeat_memory_read', { method: 'POST', body: JSON.stringify({ key: OWN.warning, owner_scope: true }) }, loopback);
  assert(w.body?.ok === true && !!warningOf(w.body.data), `warning: ${JSON.stringify(w.body).slice(0, 300)}`);
});

// ─── 6. An extension ───
console.log('\nPath 4: an extension reading through ctx.memory, invoked by the agent');

await test('EXTENSION: installed by the owner, it reads a key through ctx.memory.getPublic', async () => {
  const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'classification e2e', author: 'e2e' },
    actions: [{ id: 'peek', method: 'POST', path: '/peek', script: 'peek' }],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 8000, max_api_calls: 4 },
  });
  const peek = `export default async function(ctx, input){
    const v = await ctx.memory.getPublic(input.ns, input.key);
    return { found: v !== null && v !== undefined, value: v };
  }`;
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ manifest, scripts: { peek } }) });
  assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(alice.token) });
  assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body?.error)}`);
});

const peek = (token: string, key: string) =>
  json(`/v1/ext/${EXT}/peek`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ns: alice.ghii, key }) });

await test('EXTENSION: for the agent, hidden reads as absent and allowed is plain', async () => {
  const h = await peek(bot.token, OWN.hidden);
  assert(h.status === 200 && h.body.data.found === false, `hidden: ${h.status} ${JSON.stringify(h.body).slice(0, 200)}`);
  const a = await peek(bot.token, OWN.allowed);
  assert(a.status === 200 && a.body.data.found === true && !warningOf(a.body.data), `allowed: ${JSON.stringify(a.body).slice(0, 200)}`);
});

await test('EXTENSION: for the agent, the warning-classified value arrives with its warning', async () => {
  const w = await peek(bot.token, OWN.warning);
  assert(w.status === 200 && w.body.data.found === true, `warning value: ${JSON.stringify(w.body).slice(0, 200)}`);
  // ctx.memory.getPublic hands a script the value alone (services/extension-ctx.ts), so the warning
  // reaches the script only when it is on what getPublic returns, which the script hands back as
  // `value`.
  assert(!!warningOf(w.body.data.value), `the warning did not reach the extension: ${JSON.stringify(w.body.data).slice(0, 300)}`);
});

await test('POSITIVE CONTROL: the same extension invoked by the owner in person reads the hidden record', async () => {
  const h = await peek(alice.token, OWN.hidden);
  assert(h.status === 200 && h.body.data.found === true, `owner: ${JSON.stringify(h.body).slice(0, 200)}`);
});

// ─── 7. The explorer ───
console.log('\nThe explorer: the classifications on a person\'s content, and the suggestions that wait');

await test('REST explorer: the owner sees every classification on their own and their agent\'s content', async () => {
  const r = await json('/v1/classification/labels', { headers: auth(alice.token) });
  assert(r.status === 200 && r.body.data.subject === alice.ghii, `explorer: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const keys = (r.body.data.items as any[]).map(x => x.key).sort();
  assert(JSON.stringify(keys) === JSON.stringify([AGT.hidden, AGT.warning, OWN.allowed, OWN.hidden, OWN.warning].sort()), `items: ${keys.join(', ')}`);
  const item = (r.body.data.items as any[]).find(x => x.key === OWN.warning);
  assert(item.labelDetail?.aiVisibility === 'warning' && item.source === 'human' && item.locked === true, `an item's shape: ${JSON.stringify(item)}`);
  const f = await json('/v1/classification/labels?label=luottamuksellinen', { headers: auth(alice.token) });
  assert(JSON.stringify((f.body.data.items as any[]).map(x => x.key).sort()) === JSON.stringify([AGT.warning, OWN.warning].sort()), `label filter: ${JSON.stringify(f.body.data.items.map((x: any) => x.key))}`);
});

await test('REST explorer pages: limit 2 walks all five with the cursor, and a made-up cursor is refused', async () => {
  const seen: string[] = [];
  let cursor = '';
  for (let i = 0; i < 5; i++) {
    const r = await json(`/v1/classification/labels?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth(alice.token) });
    assert(r.status === 200 && r.body.data.items.length <= 2, `page ${i}: ${r.status}`);
    seen.push(...r.body.data.items.map((x: any) => x.key));
    if (!r.body.data.next) break;
    cursor = r.body.data.next;
  }
  assert(seen.length === 5 && new Set(seen).size === 5, `five items once each: ${seen.join(', ')}`);
  const bad = await json('/v1/classification/labels?cursor=not-a-cursor', { headers: auth(alice.token) });
  assert(bad.status === 400, `bad cursor: ${bad.status}`);
});

await test('NODE MCP explorer: the agent is not told the hidden items exist', async () => {
  const r = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'explorer' });
  assert(!r.isError, `explorer: ${r.text.slice(0, 200)}`);
  const keys = (r.payload.items as any[]).map(x => x.key);
  assert(!keys.includes(OWN.hidden) && !keys.includes(AGT.hidden), `hidden listed to an AI: ${keys.join(', ')}`);
  assert(keys.includes(OWN.warning) && keys.includes(OWN.allowed) && keys.includes(AGT.warning), `the rest: ${keys.join(', ')}`);
});

await test('An AI\'s label on a person\'s item waits as a suggestion, and pending lists exactly that item', async () => {
  const s = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'set', key: OWN.allowed, label: 'luottamuksellinen', reason: 'e2e: looks like a contract' });
  assert(!s.isError && s.payload?.applied === false && s.payload?.pending === 'HUMAN_LABEL', `set: ${s.text.slice(0, 200)}`);
  const r = await json('/v1/classification/labels?pending=true', { headers: auth(alice.token) });
  const items = r.body.data.items as any[];
  assert(items.length === 1 && items[0].key === OWN.allowed, `pending: ${JSON.stringify(items.map(x => x.key))}`);
  assert(items[0].suggestion?.label === 'luottamuksellinen' && items[0].suggestion?.by === bot.gaii && items[0].suggestion?.labelDetail?.aiVisibility === 'warning', `the suggestion: ${JSON.stringify(items[0].suggestion)}`);
});

await test('CONNECTOR /local/call explorer: the same waiting suggestion, through the CLI dispatch', async () => {
  const r = await json('/local/call/aimeat_classification', { method: 'POST', body: JSON.stringify({ action: 'explorer', pending: true }) }, loopback);
  assert(r.body?.ok === true, `explorer: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert((r.body.data.items as any[]).some(x => x.key === OWN.allowed), `pending over the connector: ${JSON.stringify(r.body.data.items)}`);
  const no = await json('/local/call/aimeat_classification', { method: 'POST', body: JSON.stringify({ action: 'explorer', mode: 'all' }) }, loopback);
  assert(no.body?.ok === false && no.body?.error?.code === 'INVALID_INPUT', `a field explorer does not take: ${JSON.stringify(no.body).slice(0, 200)}`);
});

await test('CONNECTOR /local/call switch_set: the operator\'s agent reaches the switch; a loosening is refused', async () => {
  const q = `?agent=${encodeURIComponent(opAgent.gaii)}`;
  const same = await json(`/local/call/aimeat_classification${q}`, { method: 'POST', body: JSON.stringify({ action: 'switch_set', mode: 'all' }) }, loopback);
  assert(same.body?.ok === true && same.body.data.applied === false && same.body.data.mode === 'all', `all again: ${JSON.stringify(same.body).slice(0, 200)}`);
  const off = await json(`/local/call/aimeat_classification${q}`, { method: 'POST', body: JSON.stringify({ action: 'switch_set', mode: 'off' }) }, loopback);
  assert(off.body?.ok === false && off.body?.error?.code === 'PERSON_REQUIRED', `off: ${JSON.stringify(off.body).slice(0, 200)}`);
});

await test('DENIAL: the agent does not review the suggestion without the person\'s words (PERSON_REQUIRED)', async () => {
  const r = await json('/v1/classification/label/review', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ key: OWN.allowed, decision: 'accept' }) });
  assert(r.status === 403 && r.body?.error?.code === 'PERSON_REQUIRED', `agent review: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await test('The person rejects it; the label stays, and nothing waits any more', async () => {
  const r = await json('/v1/classification/label/review', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: OWN.allowed, decision: 'reject' }) });
  assert(r.status === 200 && r.body.data.label === 'julkinen', `reject: ${r.status} ${JSON.stringify(r.body)}`);
  const p = await json('/v1/classification/labels?pending=true', { headers: auth(alice.token) });
  assert(p.body.data.items.length === 0, `still pending: ${JSON.stringify(p.body.data.items)}`);
});

// ─── 8. Denials ───
console.log('\nDenials: another owner, an anonymous caller, an agent and a policy proposal');

await test('DENIAL: anonymous is refused the explorer (401)', async () => {
  const r = await json('/v1/classification/labels');
  assert(r.status === 401, `anonymous: ${r.status}`);
});

await test('DENIAL: another owner\'s explorer holds none of this owner\'s items', async () => {
  const r = await json('/v1/classification/labels', { headers: auth(bob.token) });
  assert(r.status === 200 && r.body.data.subject === bob.ghii, `bob: ${r.status}`);
  assert(r.body.data.items.length === 0, `bob sees: ${JSON.stringify(r.body.data.items.map((x: any) => x.key))}`);
});

await test('DENIAL: another owner neither reads nor sets a label on this owner\'s organism, nor lists it', async () => {
  const o = await json('/v1/organisms', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ name: `Cls Org ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
  assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
  orgId = o.body.data.organism.id;
  const key = `organism.${orgId}.w.notes.plan`;
  const read = await json(`/v1/classification/label?key=${encodeURIComponent(key)}`, { headers: auth(bob.token) });
  assert(read.status === 404, `bob reads: ${read.status}`);
  const set = await json('/v1/classification/label', { method: 'PUT', headers: auth(bob.token), body: JSON.stringify({ key, label: 'julkinen' }) });
  assert(set.status === 404, `bob sets: ${set.status}`);
  const list = await json(`/v1/classification/labels?level=organism&organism_id=${orgId}`, { headers: auth(bob.token) });
  assert(list.status === 404, `bob lists: ${list.status}`);
  const mcp = await nodeTool(bobBot.mcp, 'aimeat_classification', { action: 'explorer', level: 'organism', organism_id: orgId });
  assert(mcp.isError && mcp.text.startsWith('NOT_FOUND'), `bob's agent lists: ${mcp.text.slice(0, 200)}`);
  const mine = await json(`/v1/classification/labels?level=organism&organism_id=${orgId}`, { headers: auth(alice.token) });
  assert(mine.status === 200 && mine.body.data.subject === orgId, `POSITIVE CONTROL, the creator lists it: ${mine.status}`);
});

await test('DENIAL: an agent\'s loosening of the owner policy waits, and the agent cannot accept it (PERSON_REQUIRED)', async () => {
  const on = await json('/v1/classification/policy', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ level: 'owner', policy: { enabled: true } }) });
  assert(on.status === 200 && on.body.data.applied === true, `owner turns it on: ${on.status} ${JSON.stringify(on.body?.error)}`);
  const off = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'policy_set', level: 'owner', policy: { enabled: false } });
  assert(!off.isError && off.payload?.pending === 'PERSON_APPROVES', `agent proposes: ${off.text.slice(0, 200)}`);
  const accept = await json('/v1/classification/policy/review', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ level: 'owner', decision: 'accept' }) });
  assert(accept.status === 403 && accept.body?.error?.code === 'PERSON_REQUIRED', `agent accepts: ${accept.status} ${JSON.stringify(accept.body?.error)}`);
  const reject = await json('/v1/classification/policy/review', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ level: 'owner', decision: 'reject' }) });
  assert(reject.status === 200 && reject.body.data.applied === false, `owner rejects: ${reject.status} ${JSON.stringify(reject.body?.error)}`);
});

await test('The owner classifies what their agent holds by naming it as `owner`; another owner cannot (404)', async () => {
  const set = await json('/v1/classification/label', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ key: AGT.allowed, owner: bot.gaii, label: 'luottamuksellinen' }) });
  assert(set.status === 200 && set.body.data.applied === true, `owner labels the agent's record: ${set.status} ${JSON.stringify(set.body?.error)}`);
  const read = await json(`/v1/classification/label?key=${AGT.allowed}&owner=${encodeURIComponent(bot.gaii)}`, { headers: auth(alice.token) });
  assert(read.status === 200 && read.body.data.label === 'luottamuksellinen', `read back: ${read.status} ${JSON.stringify(read.body?.data?.label)}`);
  const other = await json('/v1/classification/label', { method: 'PUT', headers: auth(bob.token), body: JSON.stringify({ key: AGT.allowed, owner: bot.gaii, label: 'julkinen' }) });
  assert(other.status === 404, `another owner: ${other.status}`);
});

await test('SEARCH: a hit on a warning-classified record carries its warning, on REST and on the node MCP', async () => {
  // A search hit carries the record's text (a snippet, or the whole value on REST), so it is content
  // reaching an AI, and its warning goes with it as on a read.
  const rest = await json(`/v1/memory/search?q=${WORD}`, { headers: auth(bot.token) });
  const restHit = (rest.body?.data?.results ?? rest.body?.data?.items ?? rest.body?.data?.hits ?? []).find((x: any) => x.key === AGT.warning);
  assert(!!restHit && !!warningOf(restHit), `REST search hit: ${JSON.stringify(restHit)}`);
  const s = await nodeTool(bot.mcp, 'aimeat_memory_search', { query: WORD });
  const hit = (s.payload?.hits ?? []).find((x: any) => x.key === AGT.warning);
  assert(!!hit && !!warningOf(hit), `node MCP search hit: ${JSON.stringify(hit)}`);
});

// ─── 9. Decided 2026-09-30 ───
console.log('\nDecided 2026-09-30: an anonymous reader, humanSaid from an AI, one label per document, the GDPR export');

await test('ANONYMOUS: a public record classified hidden from AI reads as absent to nobody signed in; an allowed one is read', async () => {
  const h = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${OWN.hidden}`);
  assert(h.status === 404, `anonymous reads the hidden record: ${h.status} ${JSON.stringify(h.body).slice(0, 200)}`);
  const a = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${OWN.allowed}`);
  assert(a.status === 200 && a.body?.data?.key === OWN.allowed, `POSITIVE CONTROL, the allowed one: ${a.status}`);
});

await test('HUMAN_SAID: the agent relays a raise and it applies; a lowering waits for the person, who alone accepts it', async () => {
  const key = `clsrelay.${stamp}`;
  const w = await json('/v1/memory', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ key, value: { note: 'minutes' } }) });
  assert(w.status === 201, `agent writes: ${w.status} ${JSON.stringify(w.body?.error)}`);
  // The record is in the agent's own namespace, so the agent names it as `owner`, as the owner does.
  const up = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'set', key, owner: bot.gaii, label: 'luottamuksellinen', human_said: 'Merkitse muistio luottamukselliseksi.' });
  assert(!up.isError && up.payload?.applied === true && up.payload?.source === 'human-via-ai', `raise: ${up.text.slice(0, 200)}`);
  const down = await json('/v1/classification/label', { method: 'PUT', headers: auth(bot.token), body: JSON.stringify({ key, owner: bot.gaii, label: 'julkinen', humanSaid: 'Tämä voi olla julkinen.', justification: 'The minutes were published.' }) });
  assert(down.status === 200 && down.body.data.applied === false && down.body.data.pending === 'PERSON_APPROVES', `lowering: ${down.status} ${JSON.stringify(down.body)}`);
  const agentAccept = await json('/v1/classification/label/review', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ key, owner: bot.gaii, decision: 'accept', humanSaid: 'Hyväksyn.' }) });
  assert(agentAccept.status === 403 && agentAccept.body?.error?.code === 'PERSON_REQUIRED', `agent accepts: ${agentAccept.status} ${JSON.stringify(agentAccept.body?.error)}`);
  const view = await json(`/v1/classification/label?key=${key}&owner=${encodeURIComponent(bot.gaii)}`, { headers: auth(alice.token) });
  assert(view.body?.data?.label === 'luottamuksellinen' && view.body.data.suggestion?.why === 'PERSON_APPROVES'
    && view.body.data.suggestion?.humanSaid === 'Tämä voi olla julkinen.', `the owner sees it waiting: ${JSON.stringify(view.body?.data)}`);
  const accept = await json('/v1/classification/label/review', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key, owner: bot.gaii, decision: 'accept' }) });
  assert(accept.status === 200 && accept.body.data.applied === true && accept.body.data.label === 'julkinen', `the owner accepts: ${accept.status} ${JSON.stringify(accept.body)}`);
});

await test('ONE LABEL PER DOCUMENT: a label on the draft is the label of the published copy, and the owner lowering it leaves an audit row', async () => {
  const doc = `organism.${orgId}.w.ws1.notes.plan`;
  const set = await json('/v1/classification/label', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ key: `${doc}.draft`, label: 'luottamuksellinen' }) });
  assert(set.status === 200 && set.body.data.applied === true, `label the draft: ${set.status} ${JSON.stringify(set.body?.error)}`);
  for (const suffix of ['.latest', '.version.3', '']) {
    const r = await json(`/v1/classification/label?key=${encodeURIComponent(doc + suffix)}`, { headers: auth(alice.token) });
    assert(r.status === 200 && r.body.data.label === 'luottamuksellinen' && r.body.data.target.key === doc, `${suffix || 'bare'}: ${r.status} ${JSON.stringify(r.body?.data?.target)} ${r.body?.data?.label}`);
  }
  const low = await json('/v1/classification/label', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ key: `${doc}.latest`, label: 'sisainen', justification: 'The plan is shared inside the organism now.' }) });
  assert(low.status === 200 && low.body.data.applied === true && low.body.data.from === 'luottamuksellinen', `lower: ${low.status} ${JSON.stringify(low.body)}`);
  const audit = await json(`/v1/classification/audit?level=organism&organism_id=${orgId}&action=changed`, { headers: auth(alice.token) });
  const rows = ((audit.body?.data?.rows ?? []) as any[]).filter(x => x.key === doc);
  assert(rows.some(x => x.purpose === 'luottamuksellinen → sisainen (human)'), `audit: ${audit.status} ${JSON.stringify(rows)}`);
});

await test('GDPR EXPORT: the person\'s organism record comes out and the answer says so; the ordinary export keeps it behind', async () => {
  const key = `organism.${orgId}.notes.kept`;
  const w = await json('/v1/memory', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key, value: { note: 'organism note' } }) });
  assert(w.status === 201, `write the organism record: ${w.status} ${JSON.stringify(w.body?.error)}`);
  const gdpr = await json(`/v1/owners/${alice.name}/export`, { headers: auth(alice.token) });
  assert(gdpr.status === 200 && (gdpr.body.data.memories as any[]).some(m => m.key === key), `GDPR export: ${gdpr.status}`);
  assert(gdpr.body.data.classified_organism_content?.keys?.includes(key), `says so: ${JSON.stringify(gdpr.body.data.classified_organism_content)}`);
  const ordinary = await json('/v1/memory/export', { headers: auth(alice.token) });
  assert(ordinary.status === 200 && !(ordinary.body.data.entries as any[]).some(e => e.key === key)
    && (ordinary.body.data.left_out as any[] | undefined)?.some(l => l.key === key), `ordinary export: ${ordinary.status} ${JSON.stringify(ordinary.body.data.left_out)}`);
});

// ─── 10. The exceptions list and apps, decided 2026-09-30 ───
console.log('\nDecided 2026-09-30: a person\'s exception with a reason, an AI makes none, an app\'s act is an exception');

const KEPT = () => `organism.${orgId}.notes.kept`;
let orgException = '';
let ownException = '';

await test('EXCEPTION: the ordinary export names the Data Wallet; with the person\'s exception the record leaves, and the use is audited', async () => {
  const before = await json('/v1/memory/export', { headers: auth(alice.token) });
  const left = ((before.body?.data?.left_out ?? []) as any[]).find(l => l.key === KEPT());
  assert(!!left && /exception with a written reason in their Data Wallet/.test(left.reason), `left_out: ${JSON.stringify(before.body?.data?.left_out)}`);
  const made = await json('/v1/classification/exceptions', {
    method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: KEPT(), action: 'leave', reason: 'The board approved sending the note to the auditor.' }),
  });
  assert(made.status === 201 && made.body.data.auto === false && made.body.data.byKind === 'human' && made.body.data.target?.key === KEPT(), `make: ${made.status} ${JSON.stringify(made.body)}`);
  orgException = made.body.data.id;
  const after = await json('/v1/memory/export', { headers: auth(alice.token) });
  assert((after.body.data.entries as any[]).some(e => e.key === KEPT()) && !((after.body.data.left_out ?? []) as any[]).some(l => l.key === KEPT()), `export with the exception: ${JSON.stringify(after.body.data.left_out)}`);
  const audit = await json(`/v1/classification/audit?level=organism&organism_id=${orgId}&action=exception`, { headers: auth(alice.token) });
  const purposes = ((audit.body?.data?.rows ?? []) as any[]).map(r => r.purpose as string);
  assert(purposes.some(p => p.startsWith(`made ${orgException} (leave)`)) && purposes.some(p => p.startsWith(`used ${orgException} (leave) → export`)), `audit: ${JSON.stringify(purposes)}`);
  const list = await json(`/v1/classification/exceptions?level=organism&organism_id=${orgId}`, { headers: auth(alice.token) });
  assert(list.status === 200 && (list.body.data.exceptions as any[]).some(e => e.id === orgException && e.reason === 'The board approved sending the note to the auditor.'), `list: ${JSON.stringify(list.body?.data)}`);
});

await test('DENIAL: an agent makes no exception over REST, the node MCP or the connector (PERSON_REQUIRED)', async () => {
  const rest = await json('/v1/classification/exceptions', { method: 'POST', headers: auth(bot.token), body: JSON.stringify({ key: OWN.hidden, action: 'ai-send', reason: 'I need it.' }) });
  assert(rest.status === 403 && rest.body?.error?.code === 'PERSON_REQUIRED', `REST: ${rest.status} ${JSON.stringify(rest.body?.error)}`);
  const mcp = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'exception_set', key: OWN.hidden, exception_action: 'ai-send', reason: 'I need it.' });
  assert(mcp.isError && mcp.text.startsWith('PERSON_REQUIRED') && /Data Wallet/.test(mcp.text), `node MCP: ${mcp.text.slice(0, 200)}`);
  const cli = await json('/local/call/aimeat_classification', { method: 'POST', body: JSON.stringify({ action: 'exception_set', key: OWN.hidden, exception_action: 'ai-send', reason: 'I need it.' }) }, loopback);
  assert(cli.body?.ok === false && cli.body?.error?.code === 'PERSON_REQUIRED', `connector: ${JSON.stringify(cli.body).slice(0, 200)}`);
  const own = await json('/v1/classification/exceptions', { headers: auth(alice.token) });
  assert(!(own.body.data.exceptions as any[]).some(e => e.by === bot.gaii), 'nothing was stored for the agent');
});

await test('LIST: the owner\'s exception reads the same on REST, the node MCP and the connector', async () => {
  const made = await json('/v1/classification/exceptions', {
    method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: OWN.hidden, action: 'ai-send', reason: 'My assistant mails the file to my accountant.', until: new Date(Date.now() + 86_400_000).toISOString() }),
  });
  assert(made.status === 201 && made.body.data.scope === alice.ghii && !!made.body.data.until, `make: ${made.status} ${JSON.stringify(made.body)}`);
  ownException = made.body.data.id;
  const mcp = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'exception_list', exception_action: 'ai-send' });
  assert(!mcp.isError && (mcp.payload?.exceptions as any[]).some(e => e.id === ownException), `node MCP: ${mcp.text.slice(0, 300)}`);
  const cli = await json('/local/call/aimeat_classification', { method: 'POST', body: JSON.stringify({ action: 'exception_list' }) }, loopback);
  assert(cli.body?.ok === true && (cli.body.data.exceptions as any[]).some((e: any) => e.id === ownException), `connector: ${JSON.stringify(cli.body).slice(0, 300)}`);
});

await test('DENIAL: another owner neither sees nor withdraws the exceptions', async () => {
  const org = await json(`/v1/classification/exceptions?level=organism&organism_id=${orgId}`, { headers: auth(bob.token) });
  assert(org.status === 404, `bob lists the organism's: ${org.status}`);
  const mine = await json('/v1/classification/exceptions', { headers: auth(bob.token) });
  assert(mine.status === 200 && (mine.body.data.exceptions as any[]).length === 0, `bob's own list: ${JSON.stringify(mine.body?.data)}`);
  for (const id of [orgException, ownException]) {
    const del = await json(`/v1/classification/exceptions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(bob.token) });
    assert(del.status === 404, `bob withdraws ${id}: ${del.status}`);
  }
  const node = await json('/v1/classification/exceptions?level=node', { headers: auth(alice.token) });
  assert(node.status === 403, `a non-operator lists the node: ${node.status}`);
  const all = await json('/v1/classification/exceptions?level=node', { headers: auth(op.token) });
  assert(all.status === 200 && (all.body.data.exceptions as any[]).some(e => e.id === orgException), `POSITIVE CONTROL, the operator lists the node: ${all.status}`);
});

await test('WITHDRAW: the person withdraws the exception; it stays listed, and the export leaves the record behind again', async () => {
  const del = await json(`/v1/classification/exceptions/${encodeURIComponent(orgException)}`, { method: 'DELETE', headers: auth(alice.token) });
  assert(del.status === 200 && !!del.body.data.withdrawnAt, `withdraw: ${del.status} ${JSON.stringify(del.body)}`);
  const exp = await json('/v1/memory/export', { headers: auth(alice.token) });
  assert(((exp.body.data.left_out ?? []) as any[]).some(l => l.key === KEPT()), `export after: ${JSON.stringify(exp.body.data.left_out)}`);
});

await test('AI-SEND: the agent\'s export has no record hidden from AI until the person makes an ai-send exception with a reason; then the agent sees it, exports it, and both uses are audited', async () => {
  const has = (r: { body: any }) => ((r.body?.data?.entries ?? []) as any[]).some(e => e.key === AGT.hidden);
  const before = await json('/v1/memory/export', { headers: auth(bot.token) });
  assert(before.status === 200 && !has(before) && (before.body.data.entries as any[]).some(e => e.key === AGT.allowed), `export before: ${before.status} ${JSON.stringify(before.body?.data?.entries?.map((e: any) => e.key))}`);
  const reason = 'My assistant sends the login note to IT support.';
  const made = await json('/v1/classification/exceptions', {
    method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: AGT.hidden, owner: bot.gaii, action: 'ai-send', reason }),
  });
  assert(made.status === 201 && made.body.data.scope === bot.gaii && made.body.data.action === 'ai-send', `make: ${made.status} ${JSON.stringify(made.body)}`);
  const id = made.body.data.id as string;
  const read = await json(`/v1/memory/${encodeURIComponent(AGT.hidden)}`, { headers: auth(bot.token) });
  assert(read.status === 200, `the agent reads it: ${read.status}`);
  const after = await json('/v1/memory/export', { headers: auth(bot.token) });
  assert(after.status === 200 && has(after) && !((after.body.data.left_out ?? []) as any[]).some(l => l.key === AGT.hidden), `export after: ${JSON.stringify(after.body?.data?.left_out)}`);
  const audit = await json('/v1/classification/audit?level=owner&action=exception', { headers: auth(alice.token) });
  const purposes = ((audit.body?.data?.rows ?? []) as any[]).filter(r => r.reader === bot.gaii).map(r => r.purpose as string);
  assert(purposes.some(p => p === `used ${id} (ai-send) → shown: ${reason}`) && purposes.some(p => p === `used ${id} (ai-send) → export: ${reason}`), `audit: ${JSON.stringify(purposes)}`);
  const del = await json(`/v1/classification/exceptions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(alice.token) });
  assert(del.status === 200, `withdraw: ${del.status}`);
  assert(!has(await json('/v1/memory/export', { headers: auth(bot.token) })), 'withdrawn, the record is out of the agent\'s export again');
});

/** An app of alice's with an app grant holding memory read and write, through the consent flow. */
async function appToken(): Promise<string> {
  const filename = `clsapp${stamp}.html`;
  const pub = await json('/v1/apps', {
    method: 'POST', headers: auth(alice.token),
    body: JSON.stringify({ filename, content: Buffer.from('<!DOCTYPE html><html><body>cls</body></html>').toString('base64'), name: 'Cls App', description: 'classification e2e app', category: 'utility' }),
  });
  assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
  const verifier = createHash('sha256').update(`v${stamp}`).digest('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = 'http://localhost:9911/callback';
  const q = new URLSearchParams({ app: `${alice.name}/${filename}`, response_type: 'code', scope: 'memory:read memory:write', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ request_id: rid }) });
  const code = new URL(con.body?.data?.redirect_url ?? 'http://x/').searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
  assert(!!tok.body?.data?.access_token, `app token: ${tok.status} ${JSON.stringify(tok.body).slice(0, 300)}`);
  return tok.body.data.access_token as string;
}

await test('APP: an app lowers a classification without a justification, and the node records it as an exception', async () => {
  const token = await appToken();
  const person = await json('/v1/classification/label', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ key: AGT.warning, owner: bot.gaii, label: 'sisainen' }) });
  assert(person.status === 400 && person.body?.error?.code === 'JUSTIFICATION_REQUIRED', `POSITIVE CONTROL, the person needs a reason: ${person.status} ${JSON.stringify(person.body?.error)}`);
  const low = await json('/v1/classification/label', { method: 'PUT', headers: auth(token), body: JSON.stringify({ key: OWN.warning, label: 'sisainen' }) });
  assert(low.status === 200 && low.body.data.applied === true && low.body.data.label === 'sisainen', `app lowers: ${low.status} ${JSON.stringify(low.body)}`);
  const list = await json('/v1/classification/exceptions?action=lower', { headers: auth(alice.token) });
  const e = ((list.body?.data?.exceptions ?? []) as any[]).find(x => x.target?.key === OWN.warning);
  assert(!!e && e.auto === true && e.byKind === 'app' && /lowered luottamuksellinen → sisainen/.test(e.reason), `the exception: ${JSON.stringify(list.body?.data)}`);
  const agentLow = await nodeTool(bot.mcp, 'aimeat_classification', { action: 'set', key: AGT.warning, owner: bot.gaii, label: 'sisainen' });
  assert(!agentLow.isError && agentLow.payload?.applied === false, `an agent still only suggests: ${agentLow.text.slice(0, 200)}`);
});

// ─── Cleanup ───

await test('Cleanup: the daemon stops, its home is removed, the operator turns classification off', async () => {
  try { await connector?.close(); } catch { /* already closed */ }
  if (daemon && daemon.exitCode === null) {
    daemon.kill('SIGTERM');
    await new Promise<void>(r => { const t = setTimeout(r, 5000); daemon!.once('exit', () => { clearTimeout(t); r(); }); });
  }
  rmSync(home, { recursive: true, force: true });
  const back = await setHighlyConfidential('warning');
  assert(back.status === 200, `node policy back to the default: ${back.status} ${JSON.stringify(back.body?.error)}`);
  const r = await setSwitchInPerson(op.token, 'off');
  assert(r.status === 200, `switch off: ${r.status}`);
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

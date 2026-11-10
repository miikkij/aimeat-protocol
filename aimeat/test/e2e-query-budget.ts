/**
 * @file e2e-query-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The database statements a page's requests run do not grow with the number of the
 *   owner's agents. The runner starts this suite's node with the database trace
 *   (scripts/perf/trace-preload.mjs, QUERY_TRACE_SUITES in run-e2e-server.ts), which writes one line
 *   per request with the number of statements it ran. Two owners ask the same first-load requests of
 *   the Home, the Memory page, the Data Wallet and the header: one with 3 agents, one with 80. A
 *   request whose count rises by more than SLACK between them reads something once per agent.
 *   WHY. With 79 agents on aimeat.io, GET /v1/home/state made 195 statements and GET /v1/overview
 *   394, one or more per agent (performance work 2026-11-09); on PostgreSQL each is a round trip,
 *   and the parallel ones queue on a pool of 20 connections. A per-agent read is easy to add back
 *   and invisible at the 2 agents a test account has; this suite is what notices it.
 *   KNOWN lists a request that still reads per agent, with its measured rise; its entry may only
 *   shrink, and a request that stops rising fails until its entry is removed.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (performance work, architecture item 2).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const PORT = new URL(BASE).port;
// The same path run-e2e-server.ts queryTraceFile(port) gives the node.
const TRACE = resolve(tmpdir(), `aimeat-query-trace-${PORT}.jsonl`);

/** How many more statements the 80-agent owner's request may run than the 3-agent owner's. */
const SLACK = 3;
const SMALL = 3;
const LARGE = 80;

/** The first-load requests of the Home, the Memory page, the Data Wallet and the header. */
const REQUESTS = [
  '/v1/home/state',
  '/v1/overview?limit=2',
  '/v1/home/agents?limit=5',
  '/v1/messages/conversations',
  '/v1/wallet',
  '/v1/memory/tab?summary=true',
  '/v1/data-wallet?days=30&entry_limit=20&group_limit=0',
  '/v1/consent',
  '/v1/memory/files',
  '/v1/classification/audit',
  '/v1/agents',
];

/**
 * A request that still reads once per agent: its measured rise from 3 to 80 agents, and why it is
 * not yet one read. The suite fails when the rise grows past the entry, and when it falls to SLACK
 * or under, so the entry is removed in the change that fixes it.
 */
const KNOWN: Record<string, { rise: number; why: string }> = {};

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stamp = Date.now();
const password = 'QueryBudget123!';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const owners = {
  warm: { name: `qbwarm${stamp}`, token: '' },
  small: { name: `qbsmall${stamp}`, token: '' },
  large: { name: `qblarge${stamp}`, token: '' },
};

/** The statements one request ran: the first trace line for `path` written after `from` bytes. */
async function statementsOf(path: string, token: string): Promise<number> {
  const from = existsSync(TRACE) ? statSync(TRACE).size : 0;
  const r = await json(path, { headers: auth(token) });
  assert(r.status === 200, `${path}: ${r.status} ${JSON.stringify(r.body.error ?? '').slice(0, 200)}`);
  for (let i = 0; i < 40; i++) {
    // Cut by bytes, then decode: the trace lines carry multi-byte characters ('…' in a folded statement).
    const text = existsSync(TRACE) ? readFileSync(TRACE).subarray(from).toString('utf8') : '';
    for (const l of text.split('\n')) {
      if (!l.startsWith('{') || !l.endsWith('}')) continue;   // a line still being written
      const line = JSON.parse(l);
      if (line.url === path && line.method === 'GET') return line.q;
    }
    await sleep(50);
  }
  throw new Error(`no trace line for ${path} in ${TRACE}`);
}

console.log(`\n=== Query budget E2E ===\n`);
console.log(`Server: ${BASE} · trace ${TRACE}`);

await test('The node runs with the database trace', async () => {
  const r = await json('/v1/build');
  assert(r.status === 200, `build ${r.status}`);
  await sleep(200);
  assert(existsSync(TRACE), `no trace file at ${TRACE}: the runner starts e2e-query-budget with scripts/perf/trace-preload.mjs (QUERY_TRACE_SUITES)`);
});

await test('Three owners register and log in', async () => {
  for (const who of Object.values(owners)) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
    assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: who.name, password }) });
    who.token = login.body.data?.token;
    assert(typeof who.token === 'string' && who.token.length > 0, 'missing token');
  }
});

await test(`One owner gets ${SMALL} agents and the other ${LARGE}`, async () => {
  for (const [who, n] of [[owners.small, SMALL], [owners.large, LARGE]] as const) {
    for (let i = 0; i < n; i++) {
      const r = await json('/v1/agents', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ name: `qb-${i}`, owner: who.name, capabilities: ['memory'], scopes: ['memory:read'] }) });
      assert(r.status === 201, `agent ${i} of ${who.name}: ${r.status} ${JSON.stringify(r.body.error ?? '').slice(0, 200)}`);
    }
  }
  const listed = await json('/v1/agents', { headers: auth(owners.large.token) });
  const n = (listed.body.data?.agents ?? listed.body.data ?? []).length;
  assert(n >= LARGE, `the large owner lists ${n} agents`);
});

await test('The requests answer once for a third owner first (what a cold node reads once is not counted)', async () => {
  for (const path of REQUESTS) await statementsOf(path, owners.warm.token);
});

const measured: Array<{ path: string; small: number; large: number }> = [];
await test(`Each request runs the same statements for ${LARGE} agents as for ${SMALL}, within ${SLACK}`, async () => {
  const over: string[] = [];
  for (const path of REQUESTS) {
    const small = await statementsOf(path, owners.small.token);
    const large = await statementsOf(path, owners.large.token);
    measured.push({ path, small, large });
    const rise = large - small;
    const known = KNOWN[path];
    if (known) {
      if (rise > known.rise) over.push(`${path}: rose by ${rise}, its KNOWN entry allows ${known.rise}`);
      else if (rise <= SLACK) over.push(`${path}: rises by ${rise} now, so its KNOWN entry goes`);
    } else if (rise > SLACK) over.push(`${path}: ${small} statements at ${SMALL} agents, ${large} at ${LARGE}`);
  }
  console.log(measured.map(m => `      ${String(m.small).padStart(4)} → ${String(m.large).padStart(4)}  ${m.path}`).join('\n'));
  assert(over.length === 0, over.join('; '));
});

await test("Another owner naming the large owner's identity to list its memory is refused", async () => {
  const r = await json(`/v1/memory?include=meta&limit=5&agent=${encodeURIComponent(`${owners.large.name}@${NODE_ID}`)}`, { headers: auth(owners.small.token) });
  assert(r.status === 403, `refused: ${r.status}`);
});

console.log(`\n=== Query budget: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

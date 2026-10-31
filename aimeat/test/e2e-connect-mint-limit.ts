/**
 * @file test/e2e-connect-mint-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent the node refused a credential at the connector's start goes back on the
 *   tunnel by itself, and the per-IP mint limit is a node setting.
 *
 *   THE CASE. On 2026-10-31 a connector serving 74 agents restarted. Each agent that holds a key
 *   mints a credential at start, all from one address, and the node allowed 60 a minute: two agents
 *   were refused, the daemon put them on direct HTTP and a poll loop, and they stayed there for the
 *   daemon's whole life while the other 72 were on the tunnel. Nothing tried again.
 *
 *   HOW THIS REPRODUCES IT. The real daemon serves agents with their own keys (the basic-agents
 *   button). It is stopped, the setting `security.agent_token_rate_limit_max` is set to 1 through
 *   PUT /v1/admin/config, and the daemon starts again inside the same minute: the key agents' mints
 *   are refused and they come up `direct`. The limit is then put back, and with no restart and
 *   nothing pressed, every one of them is `online` on the tunnel again.
 *
 *   Pass criteria, on the real daemon and the real node:
 *     - an agent of the owner is refused (403) when it tries to change the limit;
 *     - with the limit at 1, at least one key agent is on direct transport after the restart;
 *     - with the limit restored, every key agent is online on the tunnel within the rejoin wait
 *       (first try after 60 s), without a restart.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-mint-limit
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { registerOwner } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const LIMIT_PATH = 'security.agent_token_rate_limit_max';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let daemonSecret = '';
let daemonBase = '';
async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const auth: Record<string, string> = base === daemonBase && daemonSecret ? { Authorization: `Bearer ${daemonSecret}` } : {};
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...auth, ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}

async function tokenFor(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(priv, 'base64'));
  const { body } = await json(BASE, '/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const t = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolveExit(true); });
  });
}

// ─── State ───
const stamp = Date.now();
const home = resolve(process.cwd(), `test/.tmp-mint-limit-${stamp}`);
const ownerName = `mintlim${stamp}`;
const firstAgent = 'mint-first';
let ownerToken = '';
let firstAgentToken = '';
let daemon: ChildProcess | null = null;
let daemonOut = '';
const authOwner = () => ({ Authorization: `Bearer ${ownerToken}` });
const gaiiOf = (name: string) => `${name}#${ownerName}@${NODE_ID}`;

const statusRows = async (): Promise<any[]> => (await json(daemonBase, '/local/status')).body?.data?.agents ?? [];

async function startDaemon(): Promise<void> {
  const file = join(home, 'serve.json');
  rmSync(file, { force: true });
  daemon = spawn('node', [...nodeEntryArgs(), 'connect', 'serve', '--http'], {
    cwd: process.cwd(), env: { ...process.env, AIMEAT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout?.on('data', (d) => { daemonOut += d.toString(); });
  daemon.stderr?.on('data', (d) => { daemonOut += d.toString(); });
  const start = Date.now();
  let disc: any = null;
  while (!disc && Date.now() - start < 30_000) {
    if (existsSync(file)) { try { disc = JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ } }
    if (!disc) await sleep(150);
  }
  assert(!!disc, `serve.json did not appear\n--- daemon output ---\n${daemonOut}`);
  daemonBase = `http://127.0.0.1:${disc.port}`;
  daemonSecret = disc.secret;
}

async function stopDaemon(): Promise<void> {
  if (daemonBase) await json(daemonBase, '/local/shutdown', { method: 'POST' }).catch(() => null);
  if (daemon && !(await waitForExit(daemon))) daemon.kill('SIGKILL');
  daemon = null;
  daemonBase = '';
}

async function setLimit(value: number): Promise<void> {
  const r = await json(BASE, '/v1/admin/config', { method: 'PUT', headers: authOwner(), body: JSON.stringify({ changes: [{ path: LIMIT_PATH, value }] }) });
  assert(r.status === 200, `setting ${LIMIT_PATH}=${value}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

/** Wait until `test` holds for every named agent's status row, or the time runs out. */
async function waitRows(names: string[], ok: (row: any) => boolean, timeoutMs: number): Promise<any[]> {
  const start = Date.now();
  let rows: any[] = [];
  while (Date.now() - start < timeoutMs) {
    const all = await statusRows();
    rows = names.map(n => all.find(a => a.gaii === gaiiOf(n)));
    if (rows.every(r => r && ok(r))) return rows;
    await sleep(1000);
  }
  return rows;
}

console.log('\n=== A refused credential mint does not leave an agent off the tunnel ===\n');

let keyAgents: string[] = [];
await test('setup: an owner, a connected agent, and the agents of the basic-agents button online on the daemon', async () => {
  const owner = await registerOwner(BASE, ownerName);
  ownerToken = owner.token;
  const ag = await json(BASE, '/v1/agents', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ name: firstAgent, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
  mkdirSync(join(home, 'tokens'), { recursive: true });
  mkdirSync(join(home, 'agents', firstAgent), { recursive: true });
  firstAgentToken = await tokenFor(ag.body.data.agent.gaii, ag.body.data.private_key);
  writeFileSync(join(home, 'tokens', `${firstAgent}@${ownerName}.token`), firstAgentToken, 'utf-8');
  writeFileSync(join(home, 'agents', firstAgent, 'config.yaml'), yamlStringify({ agent: firstAgent, owner: ownerName, node_url: BASE, primary: true }), 'utf-8');
  await startDaemon();

  const r = await json(BASE, '/v1/agents/v2/basic-agents', { method: 'POST', headers: authOwner() });
  assert(r.status === 200, `basic agents ${r.status}: ${JSON.stringify(r.body?.error)}`);
  keyAgents = (r.body.data.enrolled as Array<{ name: string }>).map(e => e.name);
  assert(keyAgents.length > 0, 'the button should enrol agents that hold their own keys');
  const rows = await waitRows(keyAgents, row => row.tunnel_status === 'online', 30_000);
  assert(rows.every(row => row?.tunnel_status === 'online'), `every key agent should be online first: ${JSON.stringify(rows)}`);
});

await test('an agent of the owner cannot change the mint limit (403)', async () => {
  // The limit decides how many agents one computer can start in a minute, so it is the operator's.
  const r = await json(BASE, '/v1/admin/config', {
    method: 'PUT', headers: { Authorization: `Bearer ${firstAgentToken}` },
    body: JSON.stringify({ changes: [{ path: LIMIT_PATH, value: 100000 }] }),
  });
  assert(r.status === 403, `expected 403 for an agent, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('with the mint limit at 1, a restart leaves key agents on direct transport', async () => {
  await stopDaemon();
  await setLimit(1);
  await startDaemon();
  await sleep(8000);
  const all = await statusRows();
  const direct = keyAgents.filter(n => all.find(a => a.gaii === gaiiOf(n))?.transport === 'direct');
  assert(direct.length > 0,
    `at least one key agent should have been refused its credential and be on direct transport: ${JSON.stringify(all)}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
  console.log(`     ${direct.length} of ${keyAgents.length} key agent(s) on direct transport`);
});

await test('with the limit restored, every key agent rejoins the tunnel with no restart', async () => {
  await setLimit(600);
  const rows = await waitRows(keyAgents, row => row.transport === 'tunnel' && row.tunnel_status === 'online', 150_000);
  assert(rows.every(row => row?.transport === 'tunnel' && row?.tunnel_status === 'online'),
    `every key agent should be back on the tunnel: ${JSON.stringify(rows)}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('stop the daemon, put the limit back, delete the owner, remove the temp home', async () => {
  await stopDaemon();
  await setLimit(600).catch(() => undefined);
  const del = await json(BASE, `/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: authOwner() });
  assert(del.status === 200, `owner delete ${del.status}`);
  await sleep(300);
  rmSync(home, { recursive: true, force: true });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Connect Mint Limit E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

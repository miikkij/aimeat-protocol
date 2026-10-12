/**
 * @file e2e-connect-departed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The serve daemon tells a runtime on the same machine WHY an agent left it
 *   (`GET /local/departed`, src/cli/connect/departed-agents.ts and mcp/local-departed.ts).
 *
 *   A real `aimeat connect serve --http` daemon in a temporary connector home, attached to the
 *   running test node, with two agents of one owner and one agent of a second owner.
 *
 *   What is held here:
 *     - the route answers an empty list, and only to a caller the daemon admits (the secret, a
 *       loopback Host);
 *     - the owner deletes one of the two agents on the node: the answer names it with the node's
 *       reason 'deleted', and the neighbour is not in it;
 *     - an operator deactivates the second account: its agent is cut with no reason, and no record
 *       is written for it, because that account can be enabled again;
 *     - the record is on disk: a daemon started again on the same home still names the agent;
 *     - an agent created again under the same name and attached to the daemon is not reported.
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-departed

import * as ed from '@noble/ed25519';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { registerOwner as registerPasswordOwner } from './helpers/owner-login.js';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let loopback = '';
let secret = '';
const daemonAuth = (base: string): Record<string, string> => (base === loopback && secret ? { Authorization: `Bearer ${secret}` } : {});

async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...daemonAuth(base), ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getAuthToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const signature = await signMsg(priv, gaii + ts);
  const payload = { gaii, timestamp: ts, signature };
  const { body } = await json(BASE, '/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
async function registerOwner(name: string): Promise<string> {
  return (await registerPasswordOwner(BASE, name)).token;
}
/** Create an agent of `owner` and return its bearer. */
async function createAgent(ownerToken: string, owner: string, agent: string): Promise<string> {
  const ag = await json(BASE, '/v1/agents', {
    method: 'POST', headers: bearer(ownerToken),
    body: JSON.stringify({ name: agent, owner, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent ${agent} status ${ag.status}: ${JSON.stringify(ag.body)}`);
  return getAuthToken(ag.body.data.agent.gaii, ag.body.data.private_key);
}

/** One identity of the connector home: a stored bearer and its own config. */
function layAgent(home: string, agent: string, owner: string, token: string, primary = false): void {
  mkdirSync(join(home, 'tokens'), { recursive: true });
  mkdirSync(join(home, 'agents', owner, agent), { recursive: true });
  writeFileSync(join(home, 'tokens', `${agent}@${owner}.token`), token, 'utf-8');
  writeFileSync(join(home, 'agents', owner, agent, 'config.yaml'), yamlStringify({ agent, owner, node_url: BASE, ...(primary ? { primary: true } : {}) }), 'utf-8');
}

interface Daemon { child: ChildProcess; output: () => string }
function spawnDaemon(home: string): Daemon {
  let buf = '';
  const child = spawn('node', [...nodeEntryArgs(), 'connect', 'serve', '--http'], {
    cwd: process.cwd(), env: { ...process.env, AIMEAT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => { buf += d.toString(); });
  child.stderr?.on('data', (d) => { buf += d.toString(); });
  return { child, output: () => buf };
}
async function waitForDiscovery(home: string, d: Daemon, timeoutMs = 30_000): Promise<any> {
  const file = join(home, 'serve.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ }
    }
    await sleep(150);
  }
  throw new Error(`serve.json did not appear in ${home} within ${timeoutMs}ms\n--- daemon output ---\n${d.output().slice(-1500)}`);
}
async function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((done) => {
    const t = setTimeout(() => done(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); done(true); });
  });
}
/** Start a daemon on `home` and make it the one `json()` talks to. */
async function startDaemon(home: string): Promise<Daemon> {
  const d = spawnDaemon(home);
  const disc = await waitForDiscovery(home, d);
  loopback = `http://127.0.0.1:${disc.port}`;
  secret = disc.secret;
  return d;
}
async function stopDaemon(d: Daemon): Promise<void> {
  const sd = await json(loopback, '/local/shutdown', { method: 'POST' });
  assert(sd.status === 200, `shutdown ${sd.status}`);
  assert(await waitForExit(d.child), 'the daemon did not exit');
}
/** One request with exactly these headers and no secret added; Node sends the Host it is given. */
function rawStatus(method: string, path: string, headers: Record<string, string>): Promise<number> {
  const url = new URL(path, loopback);
  return new Promise((done, reject) => {
    const req = httpRequest({ host: url.hostname, port: url.port, method, path: url.pathname + url.search, headers }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

const statusRows = async (): Promise<any[]> => ((await json(loopback, '/local/status')).body.data?.agents ?? []) as any[];
const statusOf = async (gaii: string): Promise<string | undefined> => (await statusRows()).find(a => a.gaii === gaii)?.tunnel_status;
async function departed(query = ''): Promise<{ status: number; rows: any[]; body: any }> {
  const r = await json(loopback, `/local/departed${query}`);
  return { status: r.status, rows: (r.body?.data?.departed ?? []) as any[], body: r.body };
}
/** Poll until `done` holds, or the time is up. Returns whether it held. */
async function until(done: () => Promise<boolean>, tries = 60, everyMs = 100): Promise<boolean> {
  for (let i = 0; i < tries; i++) { if (await done()) return true; await sleep(everyMs); }
  return false;
}

// ─── State ───
const stamp = Date.now();
const home = resolve(process.cwd(), `test/.tmp-departed-home-${stamp}`);
const OP = `depop${stamp}`;      // the first owner of a fresh node is its operator
const OWNER = `depown${stamp}`;  // two agents: one stays, one is deleted
const OTHER = `depoff${stamp}`;  // one agent: this account is deactivated
const gaii = (agent: string, owner: string) => `${agent}#${owner}@${NODE_ID}`;
const KEEPER = gaii('keeper', OWNER);
const LEAVER = gaii('leaver', OWNER);
const SLEEPER = gaii('sleeper', OTHER);
let opToken = '';
let ownerToken = '';
let otherToken = '';
let daemon: Daemon | null = null;
let deletedAt = 0;

console.log('\n=== AIMEAT Connector: agents that left on the node\'s word (GET /local/departed) ===\n');

await test('Three identities attach to one daemon: two agents of one owner, one of another', async () => {
  opToken = await registerOwner(OP);
  ownerToken = await registerOwner(OWNER);
  otherToken = await registerOwner(OTHER);
  layAgent(home, 'keeper', OWNER, await createAgent(ownerToken, OWNER, 'keeper'), true);
  layAgent(home, 'leaver', OWNER, await createAgent(ownerToken, OWNER, 'leaver'));
  layAgent(home, 'sleeper', OTHER, await createAgent(otherToken, OTHER, 'sleeper'));
  daemon = await startDaemon(home);
  const online = await until(async () => {
    const rows = await statusRows();
    return rows.length === 3 && rows.every(r => r.tunnel_status === 'online');
  }, 100);
  assert(online === true, `all three online, got ${JSON.stringify((await statusRows()).map(r => [r.gaii, r.tunnel_status]))}\n--- daemon output ---\n${daemon.output().slice(-1500)}`);
});

await test('With nobody gone, the answer is an empty list and the age limit', async () => {
  const r = await departed();
  assert(r.status === 200 && r.body?.ok === true, `GET /local/departed answered ${r.status}: ${JSON.stringify(r.body)}`);
  assert(Array.isArray(r.body.data.departed) && r.rows.length === 0, `nobody has left, got ${JSON.stringify(r.rows)}`);
  assert(r.body.data.max_age_days === 30, `the age limit is stated, got ${JSON.stringify(r.body.data.max_age_days)}`);
});

await test('The route admits only the daemon\'s own callers: 401 without the secret, 403 for a foreign Host', async () => {
  const host = new URL(loopback).host;
  assert(await rawStatus('GET', '/local/departed', { Host: host }) === 401, 'no secret must be refused with 401');
  assert(await rawStatus('GET', '/local/departed', { Host: host, Authorization: 'Bearer not-the-secret' }) === 401, 'a wrong secret must be refused with 401');
  assert(await rawStatus('GET', '/local/departed', { Host: 'evil.example', Authorization: `Bearer ${secret}` }) === 403, 'a foreign Host must be refused with 403');
  assert(await rawStatus('GET', '/local/departed', { Host: host, Origin: 'https://evil.example', Authorization: `Bearer ${secret}` }) === 403, 'a request from a web page must be refused with 403');
});

await test('A `since` that is not a time is refused, and names the format', async () => {
  const r = await json(loopback, '/local/departed?since=yesterday');
  assert(r.status === 400 && r.body?.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('The owner deletes one agent on the node: the answer names it, with the reason \'deleted\'', async () => {
  deletedAt = Date.now();
  const del = await json(BASE, '/v1/agents/leaver', { method: 'DELETE', headers: bearer(ownerToken) });
  assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
  const named = await until(async () => (await departed()).rows.some(r => r.gaii === LEAVER));
  assert(named === true, `the deleted agent is not in the answer: ${JSON.stringify((await departed()).body)}\n--- daemon output ---\n${daemon!.output().slice(-1500)}`);
  const rows = (await departed()).rows;
  assert(rows.length === 1, `exactly one agent left, got ${JSON.stringify(rows)}`);
  const row = rows[0];
  assert(row.reason === 'deleted', `the reason is the node's own word, got ${JSON.stringify(row.reason)}`);
  assert(row.agent === 'leaver' && row.owner === OWNER, `the record names the agent and its owner, got ${JSON.stringify(row)}`);
  const at = Date.parse(row.at);
  assert(Number.isFinite(at) && at >= deletedAt - 2000 && at <= Date.now() + 2000, `the time is when the word arrived, got ${JSON.stringify(row.at)}`);
  assert(Object.keys(row).sort().join(',') === 'agent,at,gaii,owner,reason', `the record carries five fields and nothing else, got ${Object.keys(row).join(',')}`);
});

await test('The neighbour of the same owner is not in the answer, and still works', async () => {
  assert(!(await departed()).rows.some(r => r.gaii === KEEPER), 'the agent that stayed must not be reported');
  assert(await statusOf(KEEPER) === 'online', `the neighbour must stay online, got ${await statusOf(KEEPER)}`);
  const r = await json(loopback, '/v1/memory', { headers: { 'X-Aimeat-Agent': KEEPER } });
  assert(r.status === 200, `and its calls must be answered, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('The record is a file in the connector home', async () => {
  const file = join(home, 'departed.json');
  assert(existsSync(file), 'departed.json is not in the connector home');
  const doc = JSON.parse(readFileSync(file, 'utf-8'));
  assert(doc.schema_version === 1 && doc.departed?.length === 1 && doc.departed[0].gaii === LEAVER, `unexpected file: ${JSON.stringify(doc)}`);
});

await test('`since` leaves out what a caller has already seen', async () => {
  const before = (await departed(`?since=${encodeURIComponent(new Date(deletedAt - 60_000).toISOString())}`)).rows;
  const after = (await departed(`?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).rows;
  assert(before.length === 1 && after.length === 0, `since: expected 1 then 0, got ${before.length} then ${after.length}`);
});

await test('A deactivated account produces no record: its agent is cut with no reason, and can come back', async () => {
  const off = await json(BASE, `/v1/admin/owners/${OTHER}/disable`, { method: 'POST', headers: bearer(opToken) });
  assert(off.status === 200, `disable ${off.status}: ${JSON.stringify(off.body?.error)}`);
  const cut = await until(async () => (await statusOf(SLEEPER)) !== 'online');
  assert(cut === true, `the deactivated account's agent must stop reading online, got ${await statusOf(SLEEPER)}`);
  await sleep(1000); // a record written late would show here
  const rows = (await departed()).rows;
  assert(!rows.some(r => r.gaii === SLEEPER), `a deactivated account's agent must not be recorded, got ${JSON.stringify(rows)}`);
  assert(rows.length === 1 && rows[0].gaii === LEAVER, `the one record is still the deleted agent's, got ${JSON.stringify(rows)}`);
  assert(existsSync(join(home, 'tokens', `sleeper@${OTHER}.token`)), 'and its credential stays in the home: the account can be enabled again');
});

await test('After a daemon restart the answer still names the deleted agent', async () => {
  await stopDaemon(daemon!);
  daemon = await startDaemon(home);
  const rows = (await departed()).rows;
  assert(rows.length === 1 && rows[0].gaii === LEAVER && rows[0].reason === 'deleted', `after the restart, got ${JSON.stringify(rows)}\n--- daemon output ---\n${daemon.output().slice(-1500)}`);
});

await test('An agent created again under the same name and attached here is not reported as departed', async () => {
  await stopDaemon(daemon!);
  layAgent(home, 'leaver', OWNER, await createAgent(ownerToken, OWNER, 'leaver'));
  daemon = await startDaemon(home);
  const back = await until(async () => (await statusOf(LEAVER)) === 'online', 100);
  assert(back === true, `the recreated agent must attach, got ${await statusOf(LEAVER)}\n--- daemon output ---\n${daemon.output().slice(-1500)}`);
  const rows = (await departed()).rows;
  assert(rows.length === 0, `an agent the daemon carries has not departed, got ${JSON.stringify(rows)}`);
  const doc = JSON.parse(readFileSync(join(home, 'departed.json'), 'utf-8'));
  assert(doc.departed.length === 0, `and its record is gone from the file, got ${JSON.stringify(doc)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Stop the daemon, delete the three accounts, remove the temporary home', async () => {
  if (daemon && daemon.child.exitCode === null) {
    await stopDaemon(daemon).catch(() => { try { daemon!.child.kill('SIGKILL'); } catch { /* ignore */ } });
  }
  // The operator deletes the other two (the deactivated account's own session is revoked), then itself.
  for (const name of [OWNER, OTHER, OP]) {
    const { status, body } = await json(BASE, `/v1/owners/${encodeURIComponent(name)}`, { method: 'DELETE', headers: bearer(opToken) });
    assert(status === 200, `owner ${name} delete status ${status}: ${JSON.stringify(body?.error)}`);
  }
  await sleep(300); // let handles release before rm
  try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connect Departed E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

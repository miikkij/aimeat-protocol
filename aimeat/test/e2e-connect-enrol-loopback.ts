/**
 * @file test/e2e-connect-enrol-loopback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A connector that reaches its node on a loopback address other than the node's base
 *   URL takes on new agents: the basic-agents button and an approved agent proposal.
 *
 *   THE CASE. On a hosted node the crew runtime runs in the node's own container and reaches the
 *   node on http://127.0.0.1:40050, while the node's AIMEAT_BASE_URL is its public address. The
 *   enrolment offer names the public address, and the connector compared that origin with its own,
 *   so every offer was refused with OFFER_FROM_ANOTHER_NODE: the button answered 502 ENROL_FAILED
 *   and the agent it made never ran (measured on a freshly sold place, 2026-10-02). The connector
 *   now proves the node by its card at the address it uses (node id and public key).
 *
 *   HOW THIS REPRODUCES IT. The runner's node has the base URL http://localhost:<port>. This suite
 *   starts the real `aimeat connect serve` daemon with the node URL http://127.0.0.1:<port>: the
 *   same node on a loopback address that is not its base URL, which is the hosted shape. Before the
 *   fix the first test answered 502 with the connector's OFFER_FROM_ANOTHER_NODE.
 *
 *   Pass criteria, each on the real daemon and the real node:
 *     - the button answers 200 and names every basic agent as enrolled;
 *     - the daemon lists each of them, online, on the loopback address (so each minted its own
 *       credential there), and each settings file names the loopback address;
 *     - an approved proposal answers attached, its record carries an enrolment, and the daemon
 *       lists it online too.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-enrol-loopback
 *     - an agent approved while the connector is stopped comes up on it when it starts again, with
 *       its own key, and nobody presses Attach.
 * @version-history
 *   v1.1.0 — 2026-10-08 — An agent approved while the connector is down is taken on at its next start.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
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
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** The same node on a loopback address that is not its base URL: localhost and 127.0.0.1 swapped. */
function otherLoopbackOf(base: string): string {
  const u = new URL(base);
  u.hostname = u.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
  return u.origin;
}
const LOOPBACK = otherLoopbackOf(BASE);

let daemonSecret = '';
async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const auth: Record<string, string> = base === daemonBase && daemonSecret ? { Authorization: `Bearer ${daemonSecret}` } : {};
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...auth, ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}

async function tokenFor(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
  const signature = Buffer.from(sig).toString('base64');
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json(BASE, '/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
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
const home = resolve(process.cwd(), `test/.tmp-enrol-loopback-${stamp}`);
const ownerName = `enrolloop${stamp}`;
const firstAgent = 'loop-first';
let ownerToken = '';
let agentToken = '';
let daemon: ChildProcess | null = null;
let daemonOut = '';
let daemonBase = '';
const authOwner = () => ({ Authorization: `Bearer ${ownerToken}` });

const statusRows = async (): Promise<any[]> => (await json(daemonBase, '/local/status')).body?.data?.agents ?? [];
async function waitOnline(gaii: string, timeoutMs = 20_000): Promise<any> {
  const start = Date.now();
  let row: any;
  while (Date.now() - start < timeoutMs) {
    row = (await statusRows()).find(a => a.gaii === gaii);
    if (row?.tunnel_status === 'online') return row;
    await sleep(200);
  }
  return row;
}

/** Start `aimeat connect serve` on the temp home and wait for its serve.json. */
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

/** Stop the daemon the way an operator does, and wait for it to exit. */
async function stopDaemon(): Promise<void> {
  if (daemonBase) await json(daemonBase, '/local/shutdown', { method: 'POST' }).catch(() => null);
  if (daemon && !(await waitForExit(daemon))) daemon.kill('SIGKILL');
  daemon = null;
  daemonBase = '';
}

console.log('\n=== Connector on a loopback address takes on new agents ===\n');
console.log(`  node base URL ${BASE}, connector node URL ${LOOPBACK}`);

await test('setup: an owner, one agent connected the way the sale connects one, and its daemon on loopback', async () => {
  assert(LOOPBACK !== new URL(BASE).origin, 'the connector address must differ from the node base URL');
  const reg = await json(BASE, '/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(reg.status === 201, `owner ${reg.status}: ${JSON.stringify(reg.body)}`);
  ownerToken = await tokenFor(ownerName, reg.body.data.private_key, false);
  const ag = await json(BASE, '/v1/agents', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ name: firstAgent, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
  agentToken = await tokenFor(ag.body.data.agent.gaii, ag.body.data.private_key, true);

  mkdirSync(join(home, 'tokens'), { recursive: true });
  mkdirSync(join(home, 'agents', firstAgent), { recursive: true });
  writeFileSync(join(home, 'tokens', `${firstAgent}@${ownerName}.token`), agentToken, 'utf-8');
  writeFileSync(join(home, 'agents', firstAgent, 'config.yaml'),
    yamlStringify({ agent: firstAgent, owner: ownerName, node_url: LOOPBACK, primary: true }), 'utf-8');

  await startDaemon();
  const row = await waitOnline(`${firstAgent}#${ownerName}@${NODE_ID}`);
  assert(row?.tunnel_status === 'online', `the first agent should be online, got ${JSON.stringify(row)}\n--- daemon output ---\n${daemonOut}`);
});

await test('the connected agent, acting in the owner\'s name, cannot press the button itself', async () => {
  // The fence stays where it was: the enrolment path is the owner's, whichever address the
  // connector uses. Pressed by the agent whose socket would carry the offer, it is refused.
  const r = await json(BASE, '/v1/agents/v2/basic-agents', { method: 'POST', headers: { Authorization: `Bearer ${agentToken}` } });
  assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const list = await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() });
  assert((list.body.data.agents as any[]).length === 1, 'a refused press creates nothing');
});

let basicNames: string[] = [];
await test('the basic-agents button enrols every agent through a connector on loopback', async () => {
  const r = await json(BASE, '/v1/agents/v2/basic-agents', { method: 'POST', headers: authOwner() });
  assert(r.status === 200,
    `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)} ${JSON.stringify(r.body?.error?.details ?? r.body?.details ?? null)}`);
  const created = r.body.data.created as string[];
  const enrolled = (r.body.data.enrolled as Array<{ name: string }>).map(e => e.name);
  assert(created.length > 0, 'the button should create the basic agents');
  assert(enrolled.length === created.length, `every created agent should be enrolled: created ${JSON.stringify(created)}, enrolled ${JSON.stringify(enrolled)}`);
  basicNames = enrolled;
});

await test('the daemon serves each of them online on the loopback address, with its own credential', async () => {
  assert(basicNames.length > 0, 'nothing was enrolled, so there is nothing to look for');
  for (const name of basicNames) {
    const row = await waitOnline(`${name}#${ownerName}@${NODE_ID}`);
    assert(row?.tunnel_status === 'online', `${name} should be online, got ${JSON.stringify(row)}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
    const cfg = yamlParse(readFileSync(join(home, 'agents', ownerName, name, 'config.yaml'), 'utf-8')) as { node_url: string };
    assert(cfg.node_url === LOOPBACK, `${name}'s settings should name ${LOOPBACK}, got ${cfg.node_url}`);
    assert(existsSync(join(home, 'keys', `${name}@${ownerName}.key`)), `${name} should hold its own key`);
  }
});

const PROPOSED_DEF = {
  readme_md: '# Watcher', tags: [], process: 'sequential' as const, listen_for: ['tasks'],
  agents: [{ role: 'Watcher', goal: 'watch', backstory: 'You watch.', allow_delegation: false, tools: ['memory'] }],
  tasks: [{ id: 'watch', description: 'Watch this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Watcher' }],
};

await test('an approved agent proposal is taken on by the same connector', async () => {
  const name = 'loop-watcher';
  const p = await json(BASE, '/v1/agents/v2/agent-proposals', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ name, purpose: 'Watches the sources and reports what changed.', scopes: ['memory:read'], crew_def: PROPOSED_DEF }),
  });
  assert(p.status === 201, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const r = await json(BASE, `/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/approve`, { method: 'POST', headers: authOwner() });
  assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.attached === true, `expected attached, got ${JSON.stringify(r.body.data.attach_problem)}`);

  const rec = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() }))
    .body.data.agents.find((x: any) => x.name === name);
  assert(!!rec?.enrolled_at, `the record should carry an enrolment, got ${JSON.stringify(rec)}`);
  const row = await waitOnline(`${name}#${ownerName}@${NODE_ID}`);
  assert(row?.tunnel_status === 'online', `${name} should be online on the daemon, got ${JSON.stringify(row)}`);
});

await test('an agent approved while the connector is down is taken on when it starts, with nothing pressed', async () => {
  // The hosted place of 2026-10-08: `crm` approved while the place's connector was down; it came
  // back serving the concierge only and nothing ever offered crm its key.
  const name = 'loop-late';
  await stopDaemon();
  await sleep(500);
  const p = await json(BASE, '/v1/agents/v2/agent-proposals', {
    method: 'POST', headers: authOwner(),
    body: JSON.stringify({ name, purpose: 'Approved while the connector was down.', scopes: ['memory:read'], crew_def: PROPOSED_DEF }),
  });
  assert(p.status === 201, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const r = await json(BASE, `/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/approve`, { method: 'POST', headers: authOwner() });
  assert(r.status === 200 && r.body.data.attached === false && r.body.data.attach_problem?.code === 'NO_DAEMON',
    `with the connector down the agent is made and waits: ${r.status} ${JSON.stringify(r.body?.data?.attach_problem ?? r.body?.error)}`);

  await startDaemon();
  const row = await waitOnline(`${name}#${ownerName}@${NODE_ID}`, 30_000);
  assert(row?.tunnel_status === 'online',
    `${name} should come up on the restarted connector, got ${JSON.stringify(row)}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
  assert(existsSync(join(home, 'keys', `${name}@${ownerName}.key`)), `${name} should hold its own key`);
  const rec = (await json(BASE, `/v1/agents?owner=${ownerName}`, { headers: authOwner() }))
    .body.data.agents.find((x: any) => x.name === name);
  assert(!!rec?.enrolled_at, `the record should carry an enrolment, got ${JSON.stringify(rec)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('stop the daemon, delete the owner, remove the temp home', async () => {
  await stopDaemon();
  const del = await json(BASE, `/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: authOwner() });
  assert(del.status === 200, `owner delete ${del.status}`);
  await sleep(300);
  rmSync(home, { recursive: true, force: true });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Connect Enrol Loopback E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

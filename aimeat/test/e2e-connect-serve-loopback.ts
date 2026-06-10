// E2E Tests for the Connector loopback serve daemon — Phase 4 (forward tunnel)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-serve-loopback
//
// Launches the real `aimeat connect serve --http` daemon against a temp
// AIMEAT_HOME and asserts the Phase 4 invariants:
//   - Discovery file: <home>/serve.json with correct schema/port/pid; removed
//     on clean shutdown.
//   - Forward-proxy parity: a REST call through the loopback proxy returns the
//     same status + envelope as the equivalent direct node call.
//   - Realtime delivery: a task queued on the node surfaces via the loopback
//     long-poll (push over the tunnel, not an upstream poll).
//   - Local MCP: the Streamable-HTTP /v1/mcp endpoint serves the connector
//     tool surface.
//   - Single-socket: the node reports one active tunnel connection.
//   - Degraded fallback: against a node with AIMEAT_CONNECT_TUNNEL_ENABLED=false
//     the daemon still works via direct transport (no crash).

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const NODE2_PORT = 40287;
const NODE2_BASE = `http://localhost:${NODE2_PORT}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getAuthToken(base: string, nodeId: string, idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + nodeId + ts;
  const signature = await signMsg(priv, message);
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json(base, '/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

interface NodeAccount { ownerName: string; ownerToken: string; agentToken: string }

async function registerOwnerAndAgent(base: string, nodeId: string, ownerName: string, agentName: string): Promise<NodeAccount> {
  const reg = await json(base, '/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(reg.status === 201, `owner status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const ownerToken = await getAuthToken(base, nodeId, ownerName, reg.body.data.private_key, false);
  const ag = await json(base, '/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent status ${ag.status}: ${JSON.stringify(ag.body)}`);
  const agentToken = await getAuthToken(base, nodeId, ag.body.data.agent.gaii, ag.body.data.private_key, true);
  return { ownerName, ownerToken, agentToken };
}

/** Lay down a connector home dir: stored token + per-agent config. */
function writeConnectorHome(home: string, agent: string, owner: string, nodeUrl: string, agentToken: string): void {
  mkdirSync(join(home, 'tokens'), { recursive: true });
  mkdirSync(join(home, 'agents', agent), { recursive: true });
  writeFileSync(join(home, 'tokens', `${agent}@${owner}.token`), agentToken, 'utf-8');
  writeFileSync(
    join(home, 'agents', agent, 'config.yaml'),
    yamlStringify({ agent, owner, node_url: nodeUrl, primary: true }),
    'utf-8',
  );
}

function spawnDaemon(home: string): { child: ChildProcess; stderr: () => string } {
  let errBuf = '';
  const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'connect', 'serve', '--http'], {
    cwd: process.cwd(),
    env: { ...process.env, AIMEAT_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => { errBuf += d.toString(); });
  child.stderr?.on('data', (d) => { errBuf += d.toString(); });
  return { child, stderr: () => errBuf };
}

async function waitForDiscovery(home: string, timeoutMs = 30_000): Promise<any> {
  const file = join(home, 'serve.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ }
    }
    await sleep(150);
  }
  throw new Error(`serve.json did not appear in ${home} within ${timeoutMs}ms`);
}

async function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((resolveExit) => {
    const t = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolveExit(true); });
  });
}

// ─── State ───
const stamp = Date.now();
const home1 = resolve(process.cwd(), `test/.tmp-serve-home-${stamp}`);
const home2 = resolve(process.cwd(), `test/.tmp-serve-home2-${stamp}`);
const node2Db = resolve(process.cwd(), `test/.tmp-serve-node2-${stamp}.db`);
const agentName = 'loopbot';
let account: NodeAccount;
let daemon1: { child: ChildProcess; stderr: () => string } | null = null;
let daemon2: { child: ChildProcess; stderr: () => string } | null = null;
let node2: ChildProcess | null = null;
let loopbackBase = '';

console.log('\n=== AIMEAT Connector Serve Loopback E2E (Phase 4) ===\n');

console.log('Setup — Owner, agent, connector home, daemon');
await test('Register owner + agent and lay down the connector home', async () => {
  account = await registerOwnerAndAgent(BASE, NODE_ID, `loopowner${stamp}`, agentName);
  writeConnectorHome(home1, agentName, account.ownerName, BASE, account.agentToken);
});

await test('Daemon starts and writes the discovery file (tunnel transport)', async () => {
  daemon1 = spawnDaemon(home1);
  const disc = await waitForDiscovery(home1).catch((err) => {
    throw new Error(`${err.message}\n--- daemon output ---\n${daemon1!.stderr()}`);
  });
  assert(disc.schema_version === 1, `schema_version: ${disc.schema_version}`);
  assert(disc.pid === daemon1!.child.pid, `pid ${disc.pid} != child pid ${daemon1!.child.pid}`);
  assert(typeof disc.port === 'number' && disc.port > 0, `port: ${disc.port}`);
  assert(disc.agents.length === 1, `agents: ${JSON.stringify(disc.agents)}`);
  assert(disc.agents[0].agent === agentName, `agent: ${disc.agents[0].agent}`);
  assert(disc.agents[0].transport === 'tunnel', `transport: ${disc.agents[0].transport} (expected tunnel)\n--- daemon output ---\n${daemon1!.stderr()}`);
  loopbackBase = `http://127.0.0.1:${disc.port}`;
});

// ─── Forward-proxy parity ───
console.log('\nPhase 1 — Forward-proxy parity (loopback REST → tunnel → node)');

await test('GET parity — same status + envelope as the direct node call', async () => {
  const path = `/v1/agents/${agentName}/tasks?status=queued`;
  const direct = await json(BASE, path, { headers: { Authorization: `Bearer ${account.agentToken}` } });
  const proxied = await json(loopbackBase, path);
  assert(proxied.status === direct.status, `status ${proxied.status} != ${direct.status}`);
  assert(proxied.body.ok === direct.body.ok, 'envelope ok mismatch');
  assert(proxied.body.protocol === direct.body.protocol, `protocol ${proxied.body.protocol} != ${direct.body.protocol}`);
  assert(proxied.body.node === direct.body.node, `node ${proxied.body.node} != ${direct.body.node}`);
  assert(JSON.stringify(proxied.body.data?.tasks) === JSON.stringify(direct.body.data?.tasks), 'tasks payload mismatch');
});

await test('POST parity — write through the proxy matches a direct write', async () => {
  const mk = (key: string) => ({ method: 'POST', body: JSON.stringify({ key, value: { from: key }, visibility: 'private' }) });
  const direct = await json(BASE, '/v1/memory', { ...mk('loopback.direct'), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.agentToken}` } });
  const proxied = await json(loopbackBase, '/v1/memory', mk('loopback.proxied'));
  assert(proxied.status === direct.status, `status ${proxied.status} != ${direct.status} (${JSON.stringify(proxied.body)})`);
  assert(proxied.body.ok === true && direct.body.ok === true, `ok flags: proxied=${proxied.body.ok} direct=${direct.body.ok}`);
  assert(proxied.body.protocol === direct.body.protocol, 'protocol mismatch');
  // And the proxied write actually persisted (read back over the proxy too).
  const read = await json(loopbackBase, '/v1/memory/loopback.proxied');
  assert(read.status === 200 && read.body.ok === true, `read-back failed: ${read.status}`);
});

await test('Scope/auth context — proxy uses the pinned agent identity (404 for unknown key, not 401)', async () => {
  const r = await json(loopbackBase, '/v1/memory/does.not.exist');
  assert(r.status === 404, `status ${r.status} (expected 404 — an auth failure would be 401)`);
});

// ─── Local MCP ───
console.log('\nPhase 2 — Local Streamable-HTTP MCP');

await test('MCP initialize + tools/list works on the loopback /v1/mcp', async () => {
  const client = new Client({ name: 'loopback-e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${loopbackBase}/v1/mcp`));
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert(Array.isArray(tools.tools) && tools.tools.length > 0, 'no tools registered');
    const names = tools.tools.map(t => t.name);
    assert(names.includes('aimeat_memory_read'), `core tool missing from surface: ${names.slice(0, 5).join(', ')}...`);
  } finally {
    await client.close();
  }
});

// ─── Realtime delivery ───
console.log('\nPhase 3 — Realtime push to the loopback long-poll');

await test('Queued task reaches a waiting long-poll via the tunnel (push, not poll)', async () => {
  // Open the long-poll FIRST, then queue the task — push must answer it.
  const waiter = json(loopbackBase, '/local/tasks/next?wait=8000');
  await sleep(300); // ensure the long-poll is registered before the task exists
  const t0 = Date.now();
  const created = await json(BASE, `/v1/agents/${agentName}/tasks`, {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ title: 'Loopback push task', description: 'realtime', status: 'queued' }),
  });
  assert(created.status === 201, `create task: ${created.status}`);
  const taskId = created.body.data.task.id;
  const r = await waiter;
  const latency = Date.now() - t0;
  assert(r.status === 200, `long-poll status ${r.status}`);
  assert(r.body.data.task.id === taskId, `task id ${r.body.data.task.id} != ${taskId}`);
  assert(r.body.data.via === 'deliver', `via ${r.body.data.via} (expected live deliver)`);
  assert(latency < 3000, `latency ${latency}ms — looks like polling, not push`);
});

await test('Long-poll with nothing pending returns 204 (no spin, no error)', async () => {
  const r = await json(loopbackBase, '/local/tasks/next?wait=300');
  assert(r.status === 204, `status ${r.status}`);
});

// ─── Single upstream socket ───
console.log('\nPhase 4 — Single-socket invariant');

await test('Daemon holds exactly one online tunnel (privilege-free, via /local/status)', async () => {
  const r = await json(loopbackBase, '/local/status');
  assert(r.status === 200 && r.body.ok === true, `status ${r.status}: ${JSON.stringify(r.body)}`);
  const agents = r.body.data.agents;
  assert(Array.isArray(agents) && agents.length === 1, `agents: ${JSON.stringify(agents)}`);
  assert(agents[0].transport === 'tunnel', `transport: ${agents[0].transport}`);
  assert(agents[0].tunnel_status === 'online', `tunnel_status: ${agents[0].tunnel_status}`);
});

await test('Node-side cross-check — stats report one active tunnel connection', async () => {
  // The first REAL owner registered on a fresh node gets the operator role
  // (src/routes/owners.ts skips the seeded "anonymous" owner when counting),
  // and the canonical harness resets the DB per suite — so this owner can read
  // the operator-only stats route. If the suite runs against a node with
  // pre-existing owners, operator is unavailable: skip the cross-check rather
  // than fail on privilege (the invariant is already asserted via /local/status
  // above, and asserted node-side in e2e-connect-tunnel).
  const r = await json(BASE, '/v1/connect/tunnel/stats', { headers: { Authorization: `Bearer ${account.ownerToken}` } });
  if (r.status === 403) {
    console.log('     (cross-check skipped: owner lacks operator role in this environment)');
    return;
  }
  assert(r.status === 200, `stats status ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.stats.activeConnections === 1, `activeConnections: ${r.body.data.stats.activeConnections}`);
});

// ─── Clean shutdown ───
console.log('\nPhase 5 — Clean shutdown removes the discovery file');

await test('POST /local/shutdown stops the daemon and removes serve.json', async () => {
  const r = await json(loopbackBase, '/local/shutdown', { method: 'POST' });
  assert(r.status === 200 && r.body.ok === true, `shutdown status ${r.status}`);
  const exited = await waitForExit(daemon1!.child);
  assert(exited, 'daemon did not exit within 10s');
  assert(!existsSync(join(home1, 'serve.json')), 'serve.json still present after clean shutdown');
});

// ─── Degraded fallback ───
console.log('\nPhase 6 — Degraded fallback (node with the tunnel disabled)');

await test('Start a second node with AIMEAT_CONNECT_TUNNEL_ENABLED=false', async () => {
  node2 = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', node2Db, '--port', String(NODE2_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIMEAT_PORT: String(NODE2_PORT),
      AIMEAT_BASE_URL: NODE2_BASE,
      AIMEAT_CONNECT_TUNNEL_ENABLED: 'false',
      AIMEAT_DEFAULT_AGENT_SCOPES: '*',
      AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 60_000) {
    try { const r = await fetch(`${NODE2_BASE}/v1/spec`); if (r.ok) { ready = true; break; } } catch { /* booting */ }
    await sleep(300);
  }
  assert(ready, 'second node failed to start');
});

await test('Daemon degrades to direct transport and still serves the proxy', async () => {
  const acc2 = await registerOwnerAndAgent(NODE2_BASE, NODE_ID, `degowner${stamp}`, 'degbot');
  writeConnectorHome(home2, 'degbot', acc2.ownerName, NODE2_BASE, acc2.agentToken);
  daemon2 = spawnDaemon(home2);
  const disc = await waitForDiscovery(home2).catch((err) => {
    throw new Error(`${err.message}\n--- daemon output ---\n${daemon2!.stderr()}`);
  });
  assert(disc.agents[0].transport === 'direct', `transport: ${disc.agents[0].transport} (expected direct)\n--- daemon output ---\n${daemon2!.stderr()}`);
  const lb2 = `http://127.0.0.1:${disc.port}`;
  // REST proxy works over direct HTTP fallback — same envelope as the node.
  const direct = await json(NODE2_BASE, '/v1/agents/degbot/tasks?status=queued', { headers: { Authorization: `Bearer ${acc2.agentToken}` } });
  const proxied = await json(lb2, '/v1/agents/degbot/tasks?status=queued');
  assert(proxied.status === direct.status && proxied.body.ok === direct.body.ok, `degraded parity: ${proxied.status}/${proxied.body.ok} vs ${direct.status}/${direct.body.ok}`);
  // Long-poll surface answers (empty) instead of crashing.
  const lp = await json(lb2, '/local/tasks/next?wait=200');
  assert(lp.status === 204, `degraded long-poll status ${lp.status}`);
  const sd = await json(lb2, '/local/shutdown', { method: 'POST' });
  assert(sd.status === 200, `degraded shutdown status ${sd.status}`);
  await waitForExit(daemon2!.child);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete owner + stop children + remove temp homes', async () => {
  const { status } = await json(BASE, `/v1/owners/${encodeURIComponent(account.ownerName)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${account.ownerToken}` },
  });
  assert(status === 200, `owner delete status ${status}`);
  for (const d of [daemon1, daemon2]) {
    if (d && d.child.exitCode === null) { try { d.child.kill('SIGKILL'); } catch { /* ignore */ } }
  }
  if (node2 && node2.exitCode === null) { try { node2.kill('SIGKILL'); } catch { /* ignore */ } }
  await sleep(300); // let handles release before rm
  for (const dir of [home1, home2]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  for (const suffix of ['', '-shm', '-wal']) { try { rmSync(node2Db + suffix, { force: true }); } catch { /* ignore */ } }
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connect Serve Loopback E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

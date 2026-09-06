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

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

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
  assert(disc.schema_version === 2, `schema_version: ${disc.schema_version}`);
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

// ─── Deterministic tool-call dispatch over the tunnel ───
console.log('\nPhase 1b — Tool-call dispatch (/local/call/:tool, no subprocess)');

await test('POST /local/call/:tool — write then read a memory key via the tunnel-backed dispatch', async () => {
  const w = await json(loopbackBase, '/local/call/aimeat_memory_write', {
    method: 'POST',
    body: JSON.stringify({ key: 'loopback.toolcall', value: { hello: 'tunnel' }, visibility: 'private' }),
  });
  assert(w.status === 200 && w.body.ok === true, `write: ${w.status} ${JSON.stringify(w.body)}`);
  const r = await json(loopbackBase, '/local/call/aimeat_memory_read', {
    method: 'POST',
    body: JSON.stringify({ key: 'loopback.toolcall' }),
  });
  assert(r.status === 200 && r.body.ok === true, `read: ${r.status} ${JSON.stringify(r.body)}`);
  assert(JSON.stringify(r.body.data ?? {}).includes('"hello":"tunnel"'), `value did not round-trip: ${JSON.stringify(r.body.data)}`);
});

await test('POST /local/call/:tool — owner_scope reaches the node from the CLI dispatch, not just from MCP', async () => {
  // THE THIRD SURFACE. /local/call dispatches through CONNECT_CLI_TOOLS, a separate definition set
  // from either MCP registration, and a crew whose 61 agents use this door exclusively found that a
  // fix landing on both MCP surfaces did not exist for them at all. Their tell was that
  // aimeat_memory_list had always honoured owner_scope from here while aimeat_memory_read never
  // had — the same file, three entries apart.
  const key = `loopback.clicall.ownerscope.${Date.now().toString(36)}`;
  const written = await json(BASE, '/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ key, value: { written_by: 'the owner' }, visibility: 'private' }),
  });
  assert(written.status === 200 || written.status === 201, `owner write: ${written.status}`);

  const plain = await json(loopbackBase, '/local/call/aimeat_memory_read', {
    method: 'POST', body: JSON.stringify({ key }),
  });
  assert(!JSON.stringify(plain.body).includes('the owner'),
    `without the flag the agent must not see it: ${JSON.stringify(plain.body).slice(0, 200)}`);

  const scoped = await json(loopbackBase, '/local/call/aimeat_memory_read', {
    method: 'POST', body: JSON.stringify({ key, owner_scope: true }),
  });
  assert(JSON.stringify(scoped.body).includes('the owner'),
    `owner_scope did not survive the CLI dispatch: ${JSON.stringify(scoped.body).slice(0, 300)}`);
});

await test('A scope change reaches the RUNNING daemon, in both directions, with nothing restarted', async () => {
  // THE REPORTED BUG, against the real thing: a real `aimeat connect serve` daemon holding a real
  // tunnel to a real node, with the owner changing permissions from outside. No mock server and no
  // hand-made re-attach — the connector's own scopes_changed handler has to do the work, or this
  // fails. The first attempt at this fix passed a unit test against a stub and did nothing here.
  const inbox = '/v1/messages/agent-inbox';
  const patchScopes = async (scopes: string[]) => {
    const r = await json(BASE, `/v1/agents/${agentName}/scopes`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${account.ownerToken}` },
      body: JSON.stringify({ scopes }),
    });
    assert(r.status === 200, `scope patch ${JSON.stringify(scopes)}: ${r.status} ${JSON.stringify(r.body)}`);
  };
  /** Poll the loopback until the proxied call reaches `want`, or give up loudly. */
  const settlesAt = async (want: number, whatFor: string): Promise<void> => {
    const deadline = Date.now() + 8000;
    let last = 0;
    while (Date.now() < deadline) {
      const r = await json(loopbackBase, inbox);
      last = r.status;
      if (r.status === want) return;
      await sleep(200);
    }
    assert(false, `${whatFor}: the proxied call never reached ${want} (last ${last})`);
  };

  // The daemon's agent starts with '*', so the call is allowed before anything changes.
  const before = await json(loopbackBase, inbox);
  assert(before.status === 200, `a wildcard agent reads its inbox: ${before.status}`);

  // REMOVE the permission. This is the direction nobody reported and the more serious one: the
  // token the node pinned at connect still carries the word, so without the push it goes on being
  // honoured for the life of that token.
  await patchScopes(['memory:read', 'memory:write']);
  await settlesAt(403, 'a removed permission');

  // GRANT it back. This is the direction crewaimeat reported, and the whole point: no restart.
  await patchScopes(['*']);
  await settlesAt(200, 'a granted permission');
});

await test('POST /local/call/:tool — deliverable_key survives the CLI dispatch onto the task record', async () => {
  const created = await json(BASE, `/v1/agents/${agentName}/tasks`, {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ title: 'CLI dispatch deliverable', description: 'x', status: 'queued' }),
  });
  assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body)}`);
  const taskId = created.body.data.task.id;
  const started = await json(BASE, `/v1/agents/${agentName}/tasks/${taskId}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
  });
  assert(started.status === 200, `start: ${started.status} ${JSON.stringify(started.body)}`);

  const done = await json(loopbackBase, '/local/call/aimeat_task_complete', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, message: 'Published', deliverable_key: 'crews.cli-dispatch.output' }),
  });
  assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);

  const read = await json(BASE, `/v1/agents/${agentName}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${account.ownerToken}` },
  });
  assert(read.body.data?.outcome?.deliverable_key === 'crews.cli-dispatch.output',
    `the pointer was dropped between the CLI dispatch and the record: ${JSON.stringify(read.body.data?.outcome)}`);

  // Starting a task pushes `task_assigned` down the tunnel, and Phase 3 asserts on the NEXT thing
  // the long-poll hands back. Leave the queue as this test found it, or Phase 3 reads this task's id
  // and reports a push failure that never happened.
  for (let i = 0; i < 5; i++) {
    const drained = await json(loopbackBase, '/local/tasks/next?wait=0');
    if (drained.status === 204) break;
  }
});

await test('POST /local/call/:tool — the app tools reach APPS, not the package system', async () => {
  // Until 2026-08-16 every aimeat_app_* tool on this door pointed at /v1/packages while the same
  // names on the node's MCP meant /v1/apps. Production had 50 apps and 4 packages, three of the four
  // ::system examples, so an agent here could not touch one real app: told to list apps it got the
  // examples, told to publish an app it made a package with no app address. This asserts the round
  // trip an app builder actually performs.
  const filename = `loopback-${Date.now().toString(36)}.html`;
  const published = await json(loopbackBase, '/local/call/aimeat_app_publish', {
    method: 'POST',
    body: JSON.stringify({
      filename,
      name: 'Loopback probe app',
      description: 'published through the CLI dispatch',
      content: '<!doctype html><title>probe</title><h1>probe</h1>',
    }),
  });
  assert(published.status === 200 && published.body.ok !== false,
    `publish: ${published.status} ${JSON.stringify(published.body).slice(0, 300)}`);

  const got = await json(loopbackBase, '/local/call/aimeat_app_get', {
    method: 'POST', body: JSON.stringify({ owner: account.ownerName, filename }),
  });
  assert(JSON.stringify(got.body).includes(filename),
    `app_get did not return the app just published — is it still reading /v1/packages? ${JSON.stringify(got.body).slice(0, 300)}`);

  const listed = await json(loopbackBase, '/local/call/aimeat_app_list', {
    method: 'POST', body: JSON.stringify({ own: true }),
  });
  assert(JSON.stringify(listed.body).includes(filename),
    `app_list did not include the app: ${JSON.stringify(listed.body).slice(0, 300)}`);

  // And the package system is still reachable, under the name that describes it.
  const packages = await json(loopbackBase, '/local/call/aimeat_package_list', { method: 'POST', body: '{}' });
  assert(packages.status === 200 && packages.body.ok !== false, `package_list: ${packages.status}`);
  assert(!JSON.stringify(packages.body).includes(filename), 'the app must NOT appear among packages');
});

await test('POST /local/call/:tool — the doors the catalog and the handler spelled differently now open', async () => {
  // TWENTY-ONE TOOLS ON THIS DOOR WERE DEAD, and every one of them failed the same way: the catalog
  // published `organism_id` / `group_id` / `consent_id` / `package_id` / `instance_id` /
  // `data_base64` / `summary` / `output` / `add`+`remove`, the handler read `id` / `keys` /
  // `content` / `description` / `result` / `members`, and withDeclaredInputOnly refused the
  // published name before the handler ran. Nothing a caller could send would ever get through.
  //
  // The unit probe measures whether a value leaves the process. This asserts the round trip against
  // a real daemon holding a real tunnel to a real node, because a probe with a recording client
  // cannot tell a repaired door from one repaired to the wrong name.
  const stamp = Date.now().toString(36);

  // ── Organisms: get / members / leave took `id`, while create and the rest took `organism_id`.
  const org = await json(loopbackBase, '/local/call/aimeat_organism_create', {
    method: 'POST', body: JSON.stringify({ name: `Loopback org ${stamp}`, description: 'dead-door probe', join_policy: 'open' }),
  });
  assert(org.status === 200 && org.body.ok !== false, `organism_create: ${org.status} ${JSON.stringify(org.body).slice(0, 300)}`);
  const orgId = (org.body.data?.organism?.id ?? org.body.data?.id) as string;
  assert(typeof orgId === 'string' && orgId.length > 0, `no organism id in ${JSON.stringify(org.body.data).slice(0, 300)}`);

  const orgGot = await json(loopbackBase, '/local/call/aimeat_organism_get', {
    method: 'POST', body: JSON.stringify({ organism_id: orgId }),
  });
  assert(orgGot.status === 200 && orgGot.body.ok !== false, `organism_get: ${orgGot.status} ${JSON.stringify(orgGot.body).slice(0, 300)}`);
  assert(JSON.stringify(orgGot.body.data).includes(orgId), `organism_get answered about a different organism: ${JSON.stringify(orgGot.body.data).slice(0, 300)}`);

  const orgMembers = await json(loopbackBase, '/local/call/aimeat_organism_members', {
    method: 'POST', body: JSON.stringify({ organism_id: orgId, status: 'active' }),
  });
  assert(orgMembers.status === 200 && orgMembers.body.ok !== false, `organism_members: ${orgMembers.status} ${JSON.stringify(orgMembers.body).slice(0, 300)}`);
  assert(Array.isArray(orgMembers.body.data?.members), `expected a member list, got ${JSON.stringify(orgMembers.body.data).slice(0, 200)}`);

  // ── Groups: get / add_member / remove_member took `id`; add_member never sent identifier_type.
  //    Only the READ is reachable by an agent — POST /v1/groups and the member doors are owner-only
  //    — so the group is created with the owner's own token and the agent then reads it. For the two
  //    writes the node's 403 IS the proof: a dispatch refusal never leaves the process, so an answer
  //    from the node means the parameter names line up and only the role stands in the way.
  const grantee = `${account.ownerName}@${NODE_ID}`;
  const grp = await json(BASE, '/v1/groups', {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({
      name: `Loopback group ${stamp}`,
      description: 'dead-door probe',
      members: [{ identifier: `${agentName}#${account.ownerName}@${NODE_ID}`, identifier_type: 'gaii' }],
    }),
  });
  assert(grp.status === 200 || grp.status === 201, `owner group create: ${grp.status} ${JSON.stringify(grp.body).slice(0, 300)}`);
  const groupId = (grp.body.data?.group?.id ?? grp.body.data?.id) as string;
  assert(typeof groupId === 'string' && groupId.length > 0, `no group id in ${JSON.stringify(grp.body.data).slice(0, 300)}`);

  const grpGot = await json(loopbackBase, '/local/call/aimeat_group_get', {
    method: 'POST', body: JSON.stringify({ group_id: groupId }),
  });
  assert(grpGot.status === 200 && grpGot.body.ok !== false, `group_get: ${grpGot.status} ${JSON.stringify(grpGot.body).slice(0, 300)}`);
  assert(JSON.stringify(grpGot.body.data).includes(groupId), `group_get answered about a different group: ${JSON.stringify(grpGot.body.data).slice(0, 300)}`);

  for (const [tool, body] of [
    ['aimeat_group_add_member', { group_id: groupId, identifier: grantee, identifier_type: 'ghii' }],
    ['aimeat_group_remove_member', { group_id: groupId, identifier: grantee }],
  ] as const) {
    const r = await json(loopbackBase, `/local/call/${tool}`, { method: 'POST', body: JSON.stringify(body) });
    const code = r.body.error?.code;
    assert(code !== 'UNKNOWN_PARAMETER' && code !== 'INVALID_INPUT',
      `${tool} was refused by the DISPATCH, not by the node: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(code === 'ACCESS_DENIED' || r.body.ok !== false,
      `${tool} reached the node but answered something unexpected: ${JSON.stringify(r.body).slice(0, 300)}`);
  }

  // ── Consent: the door required `recipient` + `keys`, a pair nothing declares. Nothing was ever
  //    granted through it.
  const granted = await json(loopbackBase, '/local/call/aimeat_consent_grant', {
    method: 'POST',
    body: JSON.stringify({ target_gaii: grantee, scope: 'private', data_pattern: `loopback.${stamp}.*`, purpose: 'dead-door probe' }),
  });
  assert(granted.status === 200 && granted.body.ok !== false, `consent_grant: ${granted.status} ${JSON.stringify(granted.body).slice(0, 300)}`);
  const consentId = (granted.body.data?.consent?.id ?? granted.body.data?.id) as string;
  assert(typeof consentId === 'string' && consentId.length > 0, `no consent id in ${JSON.stringify(granted.body.data).slice(0, 300)}`);
  const revoked = await json(loopbackBase, '/local/call/aimeat_consent_revoke', {
    method: 'POST', body: JSON.stringify({ consent_id: consentId }),
  });
  assert(revoked.status === 200 && revoked.body.ok !== false, `consent_revoke: ${revoked.status} ${JSON.stringify(revoked.body).slice(0, 300)}`);

  // ── Storage: the door required `content` where the catalog publishes `data_base64`, and dropped
  //    visibility and group_id besides.
  const storageKey = `loopback-dead-door-${stamp}.txt`;
  const uploaded = await json(loopbackBase, '/local/call/aimeat_storage_upload', {
    method: 'POST',
    body: JSON.stringify({
      key: storageKey,
      data_base64: Buffer.from(`dead door ${stamp}`).toString('base64'),
      mime_type: 'text/plain',
      visibility: 'private',
    }),
  });
  assert(uploaded.status === 200 && uploaded.body.ok !== false, `storage_upload: ${uploaded.status} ${JSON.stringify(uploaded.body).slice(0, 300)}`);
  const downloaded = await json(loopbackBase, '/local/call/aimeat_storage_download', {
    method: 'POST', body: JSON.stringify({ key: storageKey, inline: true }),
  });
  assert(JSON.stringify(downloaded.body).includes(stamp),
    `the uploaded bytes did not come back: ${JSON.stringify(downloaded.body).slice(0, 300)}`);

  // ── Capabilities: the door required `description` + `type`; the route takes `summary`. POST
  //    /v1/capabilities is owner-only, so the reachable half is the read — and for the write, the
  //    node's own 403 is what separates a repaired door from a dead one.
  const cap = await json(BASE, '/v1/capabilities', {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ name: `Loopback capability ${stamp}`, summary: 'dead-door probe', visibility: 'public' }),
  });
  assert(cap.status === 200 || cap.status === 201, `owner capability create: ${cap.status} ${JSON.stringify(cap.body).slice(0, 300)}`);
  const capId = (cap.body.data?.capability?.id ?? cap.body.data?.id) as string;
  assert(typeof capId === 'string' && capId.length > 0, `no capability id in ${JSON.stringify(cap.body.data).slice(0, 300)}`);
  const capGot = await json(loopbackBase, '/local/call/aimeat_capabilities_get', {
    method: 'POST', body: JSON.stringify({ id: capId }),
  });
  assert(JSON.stringify(capGot.body).includes('dead-door probe'),
    `capabilities_get: ${JSON.stringify(capGot.body).slice(0, 300)}`);

  const capCreate = await json(loopbackBase, '/local/call/aimeat_capabilities_create', {
    method: 'POST',
    body: JSON.stringify({ name: `Loopback capability ${stamp} b`, summary: 'dead-door probe', visibility: 'private', tags: ['loopback'] }),
  });
  assert(capCreate.body.error?.code === 'ACCESS_DENIED',
    `capabilities_create must reach the node and be refused by ROLE, not by the dispatch: ${JSON.stringify(capCreate.body).slice(0, 300)}`);

  // ── Boards: the door required a `members` array; the route takes add/remove lists.
  const board = await json(loopbackBase, '/local/call/aimeat_board_create', {
    method: 'POST', body: JSON.stringify({ name: `Loopback board ${stamp}`, visibility: 'shared' }),
  });
  assert(board.status === 200 && board.body.ok !== false, `board_create: ${board.status} ${JSON.stringify(board.body).slice(0, 300)}`);
  const boardId = (board.body.data?.board?.id ?? board.body.data?.id) as string;
  assert(typeof boardId === 'string' && boardId.length > 0, `no board id in ${JSON.stringify(board.body.data).slice(0, 300)}`);
  // Managing members is an owner-session act even on a board the agent created, so the node's 403
  // is the reachable proof: a dispatch refusal would have named the parameter instead.
  const boardMembers = await json(loopbackBase, '/local/call/aimeat_board_members', {
    method: 'POST', body: JSON.stringify({ board_id: boardId, add: [grantee] }),
  });
  assert(boardMembers.body.error?.code === 'ACCESS_DENIED' || boardMembers.body.ok !== false,
    `board_members: ${boardMembers.status} ${JSON.stringify(boardMembers.body).slice(0, 300)}`);
  assert(boardMembers.body.error?.code !== 'UNKNOWN_PARAMETER',
    `board_members was refused by the DISPATCH: ${JSON.stringify(boardMembers.body).slice(0, 300)}`);

  // ── join and leave are the creator's own organism, so the node answers ALREADY_MEMBER and
  //    CREATOR_CANNOT_LEAVE. Those are the ROUTE's answers about this organism, which is the proof
  //    wanted here: the id reached the handler. A dead door never got that far.
  for (const tool of ['aimeat_organism_join', 'aimeat_organism_leave'] as const) {
    const r = await json(loopbackBase, `/local/call/${tool}`, {
      method: 'POST', body: JSON.stringify({ organism_id: orgId }),
    });
    const code = r.body.error?.code;
    assert(code !== 'UNKNOWN_PARAMETER' && code !== 'NOT_FOUND',
      `${tool} did not reach this organism: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
});

await test('POST /local/call/:tool — an instance is a CHAT instance on this door too, not a package one', async () => {
  // ONE TOOL NAME, TWO BACKENDS — the aimeat_app_* failure again, baselined for months as
  // "intentional: two different instance concepts". The published description says chat sessions on
  // every surface; this door and the connector MCP pointed at /v1/instances, which is the package
  // system and has no POST at all, so instance_create was a 404 from the day it was written.
  const appName = `loopback-chat-${Date.now().toString(36)}`;
  const created = await json(loopbackBase, '/local/call/aimeat_instance_create', {
    method: 'POST', body: JSON.stringify({ name: appName, model: 'claude-3-5-sonnet' }),
  });
  assert(created.status === 200 && created.body.ok !== false,
    `instance_create: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
  const instanceId = created.body.data?.chat_instance?.id as string;
  assert(typeof instanceId === 'string' && instanceId.length > 0,
    `expected a chat_instance, got ${JSON.stringify(created.body.data).slice(0, 300)}`);
  assert(created.body.data.chat_instance.platform === 'claude',
    `the platform is derived from the model id: got ${created.body.data.chat_instance.platform}`);

  const listed = await json(loopbackBase, '/local/call/aimeat_instance_list', { method: 'POST', body: '{}' });
  assert(JSON.stringify(listed.body).includes(appName),
    `instance_list did not include the instance just created — is it still reading /v1/instances? ${JSON.stringify(listed.body).slice(0, 300)}`);

  const status = await json(loopbackBase, '/local/call/aimeat_instance_status', {
    method: 'POST', body: JSON.stringify({ instance_id: instanceId }),
  });
  assert(JSON.stringify(status.body).includes(appName),
    `instance_status: ${status.status} ${JSON.stringify(status.body).slice(0, 300)}`);
});

await test('POST /local/call/:tool — a data package export carries limit, offset and select', async () => {
  // The route reads all three; this door sent none of them, so a fleet caller asking for a window of
  // a large table got whatever the default is, and a column projection was ignored while the call
  // answered ok.
  const name = `loopback-rows-${Date.now().toString(36)}`;
  const published = await json(loopbackBase, '/local/call/aimeat_datapackage_publish', {
    method: 'POST',
    body: JSON.stringify({
      name,
      changes: 'first version, for the export probe',
      resources: [{
        name: 'rows',
        rows: [
          { id: 'a', label: 'alpha', extra: 1 },
          { id: 'b', label: 'beta', extra: 2 },
          { id: 'c', label: 'gamma', extra: 3 },
        ],
      }],
    }),
  });
  assert(published.status === 200 && published.body.ok !== false,
    `datapackage_publish: ${published.status} ${JSON.stringify(published.body).slice(0, 300)}`);

  const ref = `pkg:${account.ownerName}/${name}`;
  const windowed = await json(loopbackBase, '/local/call/aimeat_datapackage_export', {
    method: 'POST',
    body: JSON.stringify({ ref, resource: 'rows', format: 'json', limit: 1, offset: 1, select: ['id', 'label'] }),
  });
  assert(windowed.status === 200 && windowed.body.ok !== false,
    `datapackage_export: ${windowed.status} ${JSON.stringify(windowed.body).slice(0, 300)}`);
  const rows = windowed.body.data?.rows as Record<string, unknown>[] | undefined;
  assert(Array.isArray(rows) && rows.length === 1, `limit=1 was dropped: got ${JSON.stringify(rows)}`);
  assert(rows![0].id === 'b', `offset=1 was dropped: expected row b, got ${JSON.stringify(rows![0])}`);
  assert(!('extra' in rows![0]), `select was dropped: the projection should have removed "extra" — ${JSON.stringify(rows![0])}`);
});

await test('POST /local/call/:tool — a memory search answers with snippets, not whole records', async () => {
  // ONE TOOL NAME, TWO SEARCHES. The node MCP has always returned a window around the match plus the
  // byte size; this door passed the query to the plain REST search, which answers with the FULL
  // value of every hit. So a fleet agent asking "which keys mention this" pulled whole records
  // across the tunnel and through its own context — pitfalls §44 again, the shape aimeat_memory_list
  // was fixed for on 2026-09-04 with the search twin left behind. Review item 6.4.
  const marker = `snippetprobe${Date.now().toString(36)}`;
  const big = `${'x'.repeat(4000)} ${marker} ${'y'.repeat(4000)}`;
  const w = await json(loopbackBase, '/local/call/aimeat_memory_write', {
    method: 'POST', body: JSON.stringify({ key: `loopback.search.${marker}`, value: big, visibility: 'private' }),
  });
  assert(w.status === 200 && w.body.ok === true, `write: ${w.status} ${JSON.stringify(w.body).slice(0, 200)}`);

  const found = await json(loopbackBase, '/local/call/aimeat_memory_search', {
    method: 'POST', body: JSON.stringify({ query: marker }),
  });
  assert(found.status === 200 && found.body.ok !== false, `search: ${found.status} ${JSON.stringify(found.body).slice(0, 200)}`);
  const hit = (found.body.data?.results ?? []).find((r: { key?: string }) => String(r.key ?? '').includes(marker));
  assert(hit, `the written key must be found: ${JSON.stringify(found.body.data).slice(0, 300)}`);
  assert(typeof hit.snippet === 'string' && hit.snippet.includes(marker),
    `the hit must carry a snippet around the match: ${JSON.stringify(hit).slice(0, 200)}`);
  assert(hit.value === undefined, 'the hit must NOT carry the whole value');
  assert(hit.bytes >= big.length, `the hit must say how big the record is: ${hit.bytes}`);
  assert(JSON.stringify(found.body).length < big.length,
    `the whole answer must be smaller than the one record it found (${JSON.stringify(found.body).length} vs ${big.length})`);
});

await test('POST /local/call/:tool — the surface layout says where the vocabulary to change it is', async () => {
  // The layout alone is a list of block ids with no way to learn what a block is or what it takes,
  // so the first write an AI attempts against it is always a refusal. Both MCP doors answer with
  // `available_blocks`; this one was the bare GET. Review item 6.6.
  //
  // The catalogue itself is operator-only, and this daemon's agent is not an operator — so what is
  // asserted here is the honest half: the second read HAPPENS and its refusal is reported. An empty
  // `available_blocks` would have told the agent this node serves no blocks, which is false.
  const r = await json(loopbackBase, '/local/call/aimeat_surface_layout_get', {
    method: 'POST', body: JSON.stringify({ surface: 'portal' }),
  });
  assert(r.status === 200 && r.body.ok !== false, `layout_get: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.body.data?.layout !== undefined, `the layout itself must still be there: ${Object.keys(r.body.data ?? {}).join(', ')}`);
  const blocks = r.body.data?.available_blocks;
  const refused = r.body.data?.available_blocks_unavailable;
  assert((Array.isArray(blocks) && blocks.length > 0) || typeof refused === 'string',
    `the answer must carry the catalogue or say why not: ${Object.keys(r.body.data ?? {}).join(', ')}`);
  assert(!Array.isArray(blocks) || blocks.length > 0,
    'an empty available_blocks would claim this node serves no blocks, which is a different and false answer');
});

await test('POST /local/call/:tool — unknown tool returns 404 UNKNOWN_TOOL', async () => {
  const r = await json(loopbackBase, '/local/call/not_a_real_tool', { method: 'POST', body: '{}' });
  assert(r.status === 404, `status ${r.status}`);
  assert(r.body.error?.code === 'UNKNOWN_TOOL', `code ${r.body.error?.code}`);
});

await test('P3 — aimeat_agent_statistics rides the tunnel (own reputation rollup, no direct node GET)', async () => {
  const r = await json(loopbackBase, '/local/call/aimeat_agent_statistics', { method: 'POST', body: '{}' });
  assert(r.status === 200 && r.body.ok === true, `statistics: ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.body.data?.performance !== undefined && r.body.data?.reviews !== undefined, `expected performance+reviews rollups, got ${JSON.stringify(r.body.data)}`);
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

await test('owner_scope survives the connector — a dropped permission flag looks exactly like a missing key', async () => {
  // MEASURED IN PRODUCTION BEFORE THIS TEST EXISTED. A crew's public mirror, whose job was to copy
  // six agents' writes, had only ever seen its own namespace: aimeat_memory_read answered NOT_FOUND
  // through the connector while GET /v1/memory/<key>?owner_scope=true returned the record. The route
  // had honoured the flag all along and this surface had no way to send it, so zod dropped it and
  // the answer came back as absence. That is the worst shape a stripped parameter can take — nobody
  // debugging a 404 goes looking for a permission word.
  const key = `loopback.ownerscope.${Date.now().toString(36)}`;
  const written = await json(BASE, '/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ key, value: { written_by: 'the owner' }, visibility: 'private' }),
  });
  assert(written.status === 200 || written.status === 201, `owner write: ${written.status} ${JSON.stringify(written.body)}`);

  const client = new Client({ name: 'loopback-e2e-scope', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${loopbackBase}/v1/mcp`));
  await client.connect(transport);
  try {
    const plain = await client.callTool({ name: 'aimeat_memory_read', arguments: { key } });
    const plainText = JSON.stringify(plain.content ?? plain);
    assert(!plainText.includes('the owner'),
      `without the flag the agent must NOT see the owner's record: ${plainText.slice(0, 200)}`);

    const scoped = await client.callTool({ name: 'aimeat_memory_read', arguments: { key, owner_scope: true } });
    const scopedText = JSON.stringify(scoped.content ?? scoped);
    assert(scopedText.includes('the owner'),
      `owner_scope did not reach the node — this is the drift, not a missing key: ${scopedText.slice(0, 300)}`);
  } finally {
    await client.close();
  }
});

await test('REFUSAL — owner_scope now reaches the node, and it must NOT become a way into the reserved keys', async () => {
  // The denial case that belongs with the fix above. Giving this surface the ability to ASK for the
  // owner's namespace is only safe because the node still decides, and the sharpest test of that is
  // a key the server itself trusts. `memory:write-reserved` sits in SCOPES_OUTSIDE_WILDCARD, so this
  // agent — which holds '*' — is exactly the principal that must still be refused: full access is
  // not the reserved grant, and openrouter.* is where a decrypted AI key's destination URL lives.
  const client = new Client({ name: 'loopback-e2e-reserved', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${loopbackBase}/v1/mcp`));
  await client.connect(transport);
  try {
    const r = await client.callTool({
      name: 'aimeat_memory_write',
      arguments: { key: 'openrouter.settings', value: { base_url: 'https://attacker.example' }, owner_scope: true },
    });
    const said = JSON.stringify(r.content ?? r);
    assert(said.includes('RESERVED_KEY'),
      `a '*' agent must still be refused the reserved keys on the owner's behalf: ${said.slice(0, 300)}`);
  } finally {
    await client.close();
  }

  // The same refusal at HTTP level, through the loopback proxy, which carries the pinned agent
  // identity. The MCP tool answers 200 with the refusal in its body — that is the MCP contract — so
  // the STATUS has to be asserted on the door that has one.
  const direct = await json(loopbackBase, '/v1/memory', {
    method: 'POST',
    body: JSON.stringify({ key: 'openrouter.settings', value: { base_url: 'https://attacker.example' }, owner_scope: true }),
  });
  assert(direct.status === 403, `expected 403 RESERVED_KEY, got ${direct.status}: ${JSON.stringify(direct.body).slice(0, 200)}`);

  // And the refusal is a refusal, not a message: nothing was written.
  const after = await json(BASE, '/v1/memory/openrouter.settings', {
    headers: { Authorization: `Bearer ${account.ownerToken}` },
  });
  assert(after.status === 404 || !JSON.stringify(after.body).includes('attacker.example'),
    `the refused write reached the owner's namespace anyway: ${JSON.stringify(after.body).slice(0, 200)}`);
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

await test('A DM to the agent reaches /local/dm/next via the tunnel (owner -> own agent, the crewaimeat repro)', async () => {
  // End-to-end through the REAL serve daemon: node emits dm.inbound -> tunnel -> connector onDeliver ->
  // handleDm -> /local/dm/next. Owner -> own agent (same owner, same node) is the exact reported case.
  const agentGaii = `${agentName}#${account.ownerName}@${NODE_ID}`;
  const waiter = json(loopbackBase, '/local/dm/next?wait=8000');
  await sleep(300); // ensure the long-poll is registered before the DM is sent
  const t0 = Date.now();
  const send = await json(BASE, '/v1/messages', {
    method: 'POST', headers: { Authorization: `Bearer ${account.ownerToken}` },
    body: JSON.stringify({ to: agentGaii, body: 'Loopback DM push', subject: 'Push' }),
  });
  assert(send.status === 201, `dm send: ${send.status} ${JSON.stringify(send.body)}`);
  const r = await waiter;
  const latency = Date.now() - t0;
  assert(r.status === 200, `dm long-poll status ${r.status} (204 = the connector never routed dm.inbound)`);
  assert(r.body.data.event.id === send.body.data.message.id, `event id ${r.body.data.event.id} != ${send.body.data.message.id}`);
  assert(r.body.data.event.conversationId === send.body.data.message.conversationId, 'conversationId matches');
  assert(r.body.data.event.senderGhii === `${account.ownerName}@${NODE_ID}`, `from the owner, got ${r.body.data.event.senderGhii}`);
  assert(latency < 3000, `latency ${latency}ms — looks like polling, not push`);
});

await test('DM long-poll with nothing pending returns 204', async () => {
  const r = await json(loopbackBase, '/local/dm/next?wait=300');
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

// ─── Two owners, one daemon, one agent name ───
//
// The basic-agents button gives every owner the same three names, so this is the first thing that
// happens when two people share a connector. The registry, the channels and the invoke queues were
// all keyed by the bare name, so the second `concierge` silently replaced the first — no error, and
// load order deciding which one a task reached.
console.log('\nTwo owners, one agent name');
let home3 = '';
let daemon3: { child: ChildProcess; stderr: () => string } | null = null;
let lb3 = '';
let acc3a: NodeAccount | null = null;
let acc3b: NodeAccount | null = null;

await test('Two owners each with `concierge` both load: two identities, neither replaced', async () => {
  home3 = resolve(process.cwd(), `test/.tmp-serve-home3-${stamp}`);
  acc3a = await registerOwnerAndAgent(BASE, NODE_ID, `twoa${stamp}`, 'concierge');
  acc3b = await registerOwnerAndAgent(BASE, NODE_ID, `twob${stamp}`, 'concierge');
  // One home, both credentials. The keychain filename is already owner-qualified; what was not was
  // everything the daemon built from it.
  writeConnectorHome(home3, 'concierge', acc3a.ownerName, BASE, acc3a.agentToken);
  mkdirSync(join(home3, 'tokens'), { recursive: true });
  writeFileSync(join(home3, 'tokens', `concierge@${acc3b.ownerName}.token`), acc3b.agentToken, 'utf-8');

  daemon3 = spawnDaemon(home3);
  const disc = await waitForDiscovery(home3).catch((err) => {
    throw new Error(`${err.message}\n--- daemon stderr ---\n${daemon3!.stderr()}`);
  });
  lb3 = `http://127.0.0.1:${disc.port}`;

  // serve.json must show two rows, or the surface is lying about what is served.
  assert(disc.schema_version === 2, `schema_version should be 2, got ${disc.schema_version}`);
  const ids = (disc.principals as any[]).map(p => p.id).sort();
  assert(ids.length === 2, `expected two principals, got ${JSON.stringify(ids)}`);
  assert(ids.includes(`concierge#${acc3a.ownerName}@${NODE_ID}`), `alice's identity missing: ${JSON.stringify(ids)}`);
  assert(ids.includes(`concierge#${acc3b.ownerName}@${NODE_ID}`), `bob's identity missing: ${JSON.stringify(ids)}`);
  const gaiis = (disc.agents as any[]).map(a => a.gaii).sort();
  assert(gaiis.length === 2 && gaiis[0] !== gaiis[1], `the agents[] alias must distinguish them too: ${JSON.stringify(gaiis)}`);
});

await test('/local/status shows both owners distinctly', async () => {
  const st = await json(lb3, '/local/status');
  assert(st.status === 200, `status ${st.status}`);
  const rows = (st.body.data?.agents ?? st.body.agents ?? []) as any[];
  assert(rows.length === 2, `expected two rows, got ${JSON.stringify(rows.map(r => r.agent ?? r.gaii))}`);
  const owners = rows.map(r => r.owner).sort();
  assert(owners[0] !== owners[1], `two rows should be two owners, got ${JSON.stringify(owners)}`);

  // The same projection serve.json carries, and it has to be identifying in the same way. This
  // surface held a SECOND copy of that shape and kept the bare agent name after serve.json's `id`
  // became the GAII, so an operator reading /local/status saw two owners' `concierge` as one
  // indistinguishable row while the discovery file next to it named them apart.
  const gaiis = rows.map(r => r.gaii).sort();
  assert(gaiis.every(Boolean) && gaiis[0] !== gaiis[1], `agents[] rows must carry distinct gaii: ${JSON.stringify(gaiis)}`);
  const ids = ((st.body.data?.principals ?? []) as any[]).map(p => p.id).sort();
  assert(ids.length === 2 && ids[0] !== ids[1], `principals[].id must be identifying: ${JSON.stringify(ids)}`);
  assert(ids.every((i: string) => i.includes('#') && i.includes('@')), `principals[].id must be the GAII: ${JSON.stringify(ids)}`);
  assert(JSON.stringify(ids) === JSON.stringify(gaiis), `the two lists describe the same daemon: ${JSON.stringify([ids, gaiis])}`);
});

await test('A task for one owner\'s concierge reaches that owner and never the other', async () => {
  // The whole point. Assign work to A's concierge; B's long-poll must stay empty.
  const gaiiA = `concierge#${acc3a!.ownerName}@${NODE_ID}`;
  const gaiiB = `concierge#${acc3b!.ownerName}@${NODE_ID}`;
  // Owner A's own token, so the task lands on A's concierge — the node scopes `:name` by caller.
  const made = await json(BASE, '/v1/agents/concierge/tasks', {
    method: 'POST', headers: { Authorization: `Bearer ${acc3a!.ownerToken}` },
    body: JSON.stringify({ title: 'for A only', description: 'routing check', status: 'queued' }),
  });
  assert(made.status === 201, `create task ${made.status}: ${JSON.stringify(made.body?.error)}`);
  const idA = made.body.data.task.id as string;

  // A's queue yields A's task, addressed to A's identity.
  let seenByA: any = null;
  for (let i = 0; i < 8 && !seenByA; i++) {
    const r = await json(lb3, '/local/tasks/next?wait=2000', { headers: { 'X-Aimeat-Agent': gaiiA } });
    if (r.status === 200 && r.body?.data?.task?.id === idA) seenByA = r.body.data;
  }
  assert(!!seenByA, `A never received its own task ${idA}`);
  assert(seenByA.task.agentGaii === gaiiA, `A's task should be addressed to A, got ${seenByA.task.agentGaii}`);

  // B's queue must never yield A's task. B is NOT empty — registration gives every agent its own
  // onboarding task — so the property is "nothing of A's", not "nothing at all". Asserting
  // emptiness would have passed for the wrong reason on an account that happened to be quiet.
  for (let i = 0; i < 6; i++) {
    const r = await json(lb3, '/local/tasks/next?wait=800', { headers: { 'X-Aimeat-Agent': gaiiB } });
    if (r.status === 204) continue;
    assert(r.body?.data?.task?.id !== idA, `B was given A's task ${idA} — the queues are not separate`);
    assert(r.body?.data?.task?.agentGaii === gaiiB,
      `everything on B's queue must be addressed to B, got ${r.body?.data?.task?.agentGaii}`);
  }
});

await test('A bare name that could mean either is refused, and the refusal names both', async () => {
  const r = await json(lb3, '/local/tasks/next?wait=200', { headers: { 'X-Aimeat-Agent': 'concierge' } });
  assert(r.status >= 400, `expected a refusal, got ${r.status}`);
  const said = JSON.stringify(r.body);
  assert(said.includes(acc3a!.ownerName) && said.includes(acc3b!.ownerName),
    `the refusal should name both identities, got ${said.slice(0, 300)}`);
});

await test('A full identity routes a /local/call to that owner and no other', async () => {
  const gaiiA = `concierge#${acc3a!.ownerName}@${NODE_ID}`;
  const gaiiB = `concierge#${acc3b!.ownerName}@${NODE_ID}`;
  // A tool call that answers with who is asking: each identity must get its own owner back.
  for (const [gaii, owner] of [[gaiiA, acc3a!.ownerName], [gaiiB, acc3b!.ownerName]] as [string, string][]) {
    const r = await json(lb3, '/v1/agents?owner=' + encodeURIComponent(owner), { headers: { 'X-Aimeat-Agent': gaii } });
    assert(r.status === 200, `${gaii}: proxy ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const names = (r.body.data.agents as any[]).map(x => x.name);
    assert(names.includes('concierge'), `${gaii} should see its own owner's concierge, got ${JSON.stringify(names)}`);
  }
});

// ─── The REST proxy says WHOSE call it is, and the node agrees ───
//
// A shared socket routes each frame on a stamp naming the identity that sent it, and the proxy
// forwarded without one, so every /v1/* call was attributed to whichever identity OPENED the
// socket. That is right for exactly one agent, which is why it survived: a daemon serving one
// agent cannot show it, and on a fleet the opener works while everyone else is misread.
//
// Measured on a live 62-identity fleet on 2026-09-04 and reported by crewaimeat-dev: an agent
// asking for its own tasks was refused as another agent, and then SERVED that other agent's task
// list when it asked for it. This path also carries `DELETE /v1/memory/…`, so writes landed under
// the wrong name too. → pitfalls §43
//
// `/v1/agents/me` is the question with no other way to answer it: the node replies with the
// identity it believes is calling. Asserting on a list would pass on the wrong caller whenever the
// two identities can see similar things.
await test('The REST proxy forwards each identity as ITSELF, not as whoever opened the socket', async () => {
  const gaiiA = `concierge#${acc3a!.ownerName}@${NODE_ID}`;
  const gaiiB = `concierge#${acc3b!.ownerName}@${NODE_ID}`;
  const seen: string[] = [];
  for (const gaii of [gaiiA, gaiiB]) {
    const r = await json(lb3, '/v1/agents/me', { headers: { 'X-Aimeat-Agent': gaii } });
    assert(r.status === 200, `${gaii}: /v1/agents/me through the proxy ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const me = r.body?.data?.gaii;
    assert(me === gaii, `the node must see ${gaii} calling, it saw ${me}`);
    seen.push(me);
  }
  // Belt and braces: if both answers were the opener's, each assertion above could only catch it
  // for the one identity that is NOT the opener, and this catches it whichever one that is.
  assert(seen[0] !== seen[1], `two identities got the same answer (${seen[0]}) — the stamp is missing`);
});

// NOT COVERED HERE, and saying so rather than shipping a green test that proves nothing:
// `/local/subscribe` had the identical missing stamp and is fixed in the same commit, but the only
// way to observe it is to write a record into a subscribed space and see which identity the node
// wakes. That is the record-push machinery in e2e-connect-tunnel-records, not this suite's, and a
// test written here without it passes with the defect in place — which is exactly the kind of
// coverage that let this survive in the first place.

// ─── An MCP session on a two-owner daemon says who it is ───
//
// The 28 tool modules resolve an agent ONCE, at registration time, with no identifier. Harmless
// while a daemon served one owner; with two owners each holding a default agent, resolve() refuses
// — correctly — and that refusal used to arrive as an exception from inside a tool module's
// constructor and take the whole daemon with it. So the wish told the runtime side to attach, and
// attaching is what killed the thing they were attaching to.
await test('An MCP session that names its agent works on a two-owner daemon', async () => {
  const gaiiA = `concierge#${acc3a!.ownerName}@${NODE_ID}`;
  const client = new Client({ name: 'two-owner-e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${lb3}/v1/mcp`), {
    requestInit: { headers: { 'X-Aimeat-Agent': gaiiA } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert(tools.tools.length > 0, 'a named session should get the full tool surface');
    assert(tools.tools.map(t => t.name).includes('aimeat_memory_read'), 'core tool missing');
  } finally {
    await client.close();
  }
});

await test('naming none is refused cleanly, and the daemon is still there afterwards', async () => {
  const client = new Client({ name: 'two-owner-e2e-anon', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${lb3}/v1/mcp`));
  let refused = false;
  try {
    await client.connect(transport);
    await client.close();
  } catch (err) {
    refused = true;
    // The registry's own words, so the caller learns WHICH identities it could have named.
    const msg = (err as Error).message;
    assert(/more than one account/i.test(msg) || /400/.test(msg), `expected the registry's refusal, got: ${msg}`);
  }
  assert(refused, 'a session naming no agent on a two-owner daemon must be refused');

  // The point of the whole item: refusing is not dying.
  const st = await json(lb3, '/local/status');
  assert(st.status === 200, `the daemon must still be serving, got ${st.status}`);
  const rows = (st.body.data?.agents ?? []) as any[];
  assert(rows.length === 2, `and still holding both agents, got ${rows.length}`);
});

// ─── Deleting an agent reaches the daemon holding its socket ───
//
// A tunnel verifies its bearer ONCE, at upgrade. Deleting an agent revoked its sessions, so the
// node refused every later call correctly — but nothing told the connector, and the socket stayed
// up reading `online` for a credential that was already dead. That is not a hole; it is a surface
// claiming something works when it does not, which is the `lastSeen`-as-liveness mistake again.
// It surfaced during a re-seed, and crew-forge exists to create agents and clear away the ones it
// made, so deleting and recreating a name is ordinary here rather than exotic.
console.log('\nDeleting an agent under a running daemon');

const statusRow = async (gaii: string) => {
  const st = await json(lb3, '/local/status');
  return ((st.body.data?.agents ?? []) as any[]).find(a => a.gaii === gaii);
};

await test('An idle agent is untouched — this must never become a liveness check', async () => {
  // Sat here doing nothing for the whole suite. Nothing may have closed it.
  const idle = await statusRow(`concierge#${acc3a!.ownerName}@${NODE_ID}`);
  assert(!!idle, 'alice\'s concierge should still be listed');
  assert(idle.tunnel_status === 'online', `an idle agent must stay online, got ${idle.tunnel_status}`);
});

await test('Deleting an agent closes its socket: it stops saying online, with no call made', async () => {
  const gaiiB = `concierge#${acc3b!.ownerName}@${NODE_ID}`;
  const before = await statusRow(gaiiB);
  assert(before?.tunnel_status === 'online', `precondition: bob's concierge online, got ${before?.tunnel_status}`);

  const del = await json(BASE, '/v1/agents/concierge', {
    method: 'DELETE', headers: { Authorization: `Bearer ${acc3b!.ownerToken}` },
  });
  assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);

  // NO call is made through the daemon here, deliberately. Before the fix the socket only fell
  // over once something forced a 401, which is why the surface could lie for as long as it did.
  let row: any;
  for (let i = 0; i < 40; i++) {
    row = await statusRow(gaiiB);
    if (row && row.tunnel_status !== 'online') break;
    await sleep(100);
  }
  assert(row?.tunnel_status !== 'online',
    `a deleted agent must stop reading online, got ${row?.tunnel_status}`);
});

await test('and nothing else on that daemon lost its connection', async () => {
  const gaiiA = `concierge#${acc3a!.ownerName}@${NODE_ID}`;
  const neighbour = await statusRow(gaiiA);
  assert(neighbour?.tunnel_status === 'online',
    `the other owner's agent must be untouched, got ${neighbour?.tunnel_status}`);
  // And still working, not merely listed as online.
  const r = await json(lb3, '/v1/agents?owner=' + encodeURIComponent(acc3a!.ownerName), {
    headers: { 'X-Aimeat-Agent': gaiiA },
  });
  assert(r.status === 200, `the neighbour's calls must still work, got ${r.status}`);
});

await test('Stop the two-owner daemon', async () => {
  const sd = await json(lb3, '/local/shutdown', { method: 'POST' });
  assert(sd.status === 200, `shutdown ${sd.status}`);
  await waitForExit(daemon3!.child);
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete owner + stop children + remove temp homes', async () => {
  const { status } = await json(BASE, `/v1/owners/${encodeURIComponent(account.ownerName)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${account.ownerToken}` },
  });
  assert(status === 200, `owner delete status ${status}`);
  for (const d of [daemon1, daemon2, daemon3]) {
    if (d && d.child.exitCode === null) { try { d.child.kill('SIGKILL'); } catch { /* ignore */ } }
  }
  if (node2 && node2.exitCode === null) { try { node2.kill('SIGKILL'); } catch { /* ignore */ } }
  await sleep(300); // let handles release before rm
  for (const dir of [home1, home2, home3].filter(Boolean)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  for (const suffix of ['', '-shm', '-wal']) { try { rmSync(node2Db + suffix, { force: true }); } catch { /* ignore */ } }
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connect Serve Loopback E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

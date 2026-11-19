/**
 * @file test/e2e-connector-command-approval.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A command a folder brings with it does not run until the owner allows it
 *   (src/cli/connect/command-trust.ts heldBackCommands, program-report.ts reportPrograms). The rule
 *   was held by unit tests on the functions (test/unit/connect-command-trust*.test.ts), and
 *   e2e-connector-programs.ts holds the node's half with the test as the connector. Nothing ran the
 *   real `aimeat connect serve` on a folder that came from somewhere else. This suite does:
 *     1. a connector home whose agent config names a runner nobody connected through the connector
 *        (a fresh machine, no trust record, the config file newer than the release that keeps one):
 *        the daemon holds the runner back, reports it to the node as waiting, and the owner is asked;
 *     2. a task for that agent does not start the runner;
 *     3. the owner allows it on the node: the daemon hears it over its tunnel, records the approval
 *        in the machine's own record, and the next task runs the runner;
 *     4. the owner stops it on the node: the daemon records the stop, and the next task does not run.
 *   The trust record is a file of this suite's own (AIMEAT_COMMAND_TRUST_FILE), outside the home.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connector-command-approval
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { BASE, assert, finish, json, test } from './helpers/harness.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now();
const root = resolve(process.cwd(), `test/.tmp-command-approval-${stamp}`);
const home = join(root, 'cloned-project', '.aimeat');
const trustFile = join(root, 'machine', 'trusted-commands.json');
const markers = join(root, 'markers');
const script = join(root, 'runner.mjs');
const AGENT = 'runbot';

let owner!: { name: string; token: string };
let gaii = '';
let daemon: ChildProcess | null = null;
let daemonOut = '';
let daemonBase = '';
let daemonSecret = '';

const local = (path: string, opts: RequestInit = {}) =>
  json(`${daemonBase}${path}`, { ...opts, headers: { Authorization: `Bearer ${daemonSecret}`, ...(opts.headers as Record<string, string> | undefined) } });

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v as T;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}\n--- daemon output ---\n${daemonOut.slice(-3000)}`);
}

async function startDaemon(): Promise<void> {
  const file = join(home, 'serve.json');
  rmSync(file, { force: true });
  daemon = spawn('node', [...nodeEntryArgs(), 'connect', 'serve', '--http'], {
    cwd: process.cwd(),
    env: { ...process.env, AIMEAT_HOME: home, AIMEAT_COMMAND_TRUST_FILE: trustFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  daemon.stdout?.on('data', (d) => { daemonOut += d.toString(); });
  daemon.stderr?.on('data', (d) => { daemonOut += d.toString(); });
  const disc = await waitFor('serve.json', async () => {
    if (!existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return null; }
  });
  daemonBase = `http://127.0.0.1:${disc.port}`;
  daemonSecret = disc.secret;
}

async function stopDaemon(): Promise<void> {
  if (daemonBase) await local('/local/shutdown', { method: 'POST' }).catch(() => null);
  if (daemon && daemon.exitCode === null) {
    const exited = await new Promise<boolean>((r) => { const t = setTimeout(() => r(false), 10_000); daemon!.once('exit', () => { clearTimeout(t); r(true); }); });
    if (!exited) daemon.kill('SIGKILL');
  }
  daemon = null;
}

/** This agent's program row on the owner's connector list. */
async function programRow(): Promise<any> {
  const r = await json('/v1/agents/v2/connectors', { headers: auth(owner.token) });
  for (const c of (r.body?.data?.connectors as any[]) ?? []) {
    const row = (c.programs ?? []).find((p: any) => p.agent === AGENT);
    if (row) return { ...row, connector: c.id };
  }
  return null;
}
async function newTask(title: string): Promise<string> {
  const r = await json(`/v1/agents/${AGENT}/tasks`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ title, description: title }) });
  assert(r.status === 201, `task: ${r.status} ${JSON.stringify(r.body?.error)}`);
  return r.body.data.task.id as string;
}
const ran = (taskId: string) => existsSync(join(markers, `${taskId}.txt`));
const trustOf = (hash: string): any => {
  if (!existsSync(trustFile)) return null;
  return (JSON.parse(readFileSync(trustFile, 'utf-8')) as { hashes?: Record<string, any> }).hashes?.[hash] ?? null;
};

console.log('\n=== A command a folder brings waits for the owner ===\n');

let hash = '';
let requestId = '';
try {
  console.log('Setup');
  await test('A cloned folder whose .aimeat names a runner, on a machine with no trust record, and its daemon', async () => {
    const reg = await registerOwner(BASE, `cmdappr${stamp % 1_000_000}`);
    owner = { name: reg.name, token: reg.token };
    const agent = await makeAgent(BASE, owner, ['*'], AGENT);
    gaii = agent.gaii;
    mkdirSync(markers, { recursive: true });
    // The runner writes a file named after the task and prints the result: the proof that it ran.
    writeFileSync(script, `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n`
      + `writeFileSync(join(${JSON.stringify(markers)}, process.env.AIMEAT_TASK_ID + '.txt'), 'ran');\nconsole.log('ran ' + process.env.AIMEAT_TASK_ID);\n`, 'utf-8');
    mkdirSync(join(home, 'tokens'), { recursive: true });
    mkdirSync(join(home, 'agents', owner.name, AGENT), { recursive: true });
    writeFileSync(join(home, 'tokens', `${AGENT}@${owner.name}.token`), agent.token, 'utf-8');
    writeFileSync(join(home, 'agents', owner.name, AGENT, 'config.yaml'), yamlStringify({
      agent: AGENT, owner: owner.name, node_url: BASE, primary: true,
      runner: { command: process.execPath, args: [script] },
    }), 'utf-8');
    assert(!existsSync(trustFile), 'no trust record on this machine yet');
    await startDaemon();
    await waitFor('the agent online', async () => ((await local('/local/status')).body?.data?.agents as any[] ?? [])
      .find((a) => a.gaii === gaii && a.tunnel_status === 'online'));
  });

  console.log('\n1. Held back and reported');
  await test('1. The daemon holds the runner, reports it as waiting, and the owner is asked once', async () => {
    const row = await waitFor('the waiting program row', async () => { const r = await programRow(); return r?.status === 'waiting' ? r : null; });
    assert(row.use === 'runner' && String(row.command).includes('runner.mjs'), `the row names the runner: ${JSON.stringify(row)}`);
    assert(typeof row.request_id === 'string' && row.request_id, `a request asks the owner: ${JSON.stringify(row)}`);
    requestId = row.request_id;
    hash = row.hash;
    assert(/^[0-9a-f]{64}$/.test(hash), `the row carries the machine's hash: ${hash}`);
    assert(trustOf(hash) === null, `the machine trusts nothing for it: ${JSON.stringify(trustOf(hash))}`);
    assert(/does not run|held|aimeat connect/i.test(daemonOut), `the daemon says the command waits:\n${daemonOut.slice(-1500)}`);
  });

  console.log('\n2. A task does not start it');
  await test('2. A task for the agent does not run the held runner', async () => {
    const id = await newTask('before the owner allows it');
    await sleep(6_000);
    assert(!ran(id), 'the held runner ran');
  });

  console.log('\n3. The owner allows it');
  await test('3a. The owner allows it on the node: the daemon hears it and records the approval', async () => {
    const d = await json(`/v1/publish-requests/${requestId}/decision`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(d.status === 200, `approve: ${d.status} ${JSON.stringify(d.body?.error)}`);
    const t = await waitFor('the approval on the machine', async () => { const e = trustOf(hash); return e?.how === 'approved' ? e : null; });
    assert(t.how === 'approved', `recorded: ${JSON.stringify(t)}`);
    await waitFor('the row reported as allowed', async () => { const r = await programRow(); return r?.status === 'allowed' && r.applied === true ? r : null; });
  });

  await test('3b. The next task runs the runner', async () => {
    const id = await newTask('after the owner allowed it');
    await waitFor(`the runner for ${id}`, async () => ran(id), 45_000);
    assert(readFileSync(join(markers, `${id}.txt`), 'utf-8') === 'ran', 'the runner wrote its mark for this task');
  });

  console.log('\n4. The owner stops it');
  await test('4. The owner stops it on the node: the machine records the stop and the next task does not run', async () => {
    const row = await programRow();
    const d = await json(`/v1/agents/v2/connectors/${encodeURIComponent(row.connector)}/programs/${hash}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ decision: 'deny' }) });
    assert(d.status === 200, `deny: ${d.status} ${JSON.stringify(d.body?.error)}`);
    await waitFor('the stop on the machine', async () => trustOf(hash)?.how === 'stopped');
    const id = await newTask('after the owner stopped it');
    await sleep(6_000);
    assert(!ran(id), 'a stopped runner ran');
  });
} finally {
  await stopDaemon();
  rmSync(root, { recursive: true, force: true });
}

finish();

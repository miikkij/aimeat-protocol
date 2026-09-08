/**
 * @file test/e2e-connect-cli.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the AIMEAT command-line interface, driven as a real child process.
 *
 *   WHY THIS EXISTS. Until this suite, the E2E sweep started exactly one `aimeat` subcommand:
 *   `connect serve`. Everything a person or a shell-driven agent actually types — `connect status`,
 *   `inbox`, `tasks`, `send`, `docs`, `refresh`, `tools`, `schema`, `call`, `list`, `remove`,
 *   `logout`, `config`, `add`, `client`, `acp`, and the node-side `config` / `config export` /
 *   `config import` / `validate` / `skill install` / `screenshot-worker` — had never been run by a
 *   test. The prompt-driven and CLI-fallback road into this node is exactly those commands, so a
 *   silent break in one of them is a road nobody can travel and nothing that reports it.
 *
 *   HOW IT IS DRIVEN. Each subcommand is spawned as `node --import tsx src/index.ts <args>` against
 *   the runner's shared node, with AIMEAT_HOME pointed at a throwaway directory. That is the shape
 *   a person runs, it is the only way to observe a `process.exit()` code, and it is the argv the
 *   coverage preload counts. Every child carries a deadline and is killed on it.
 *
 *   WHAT IS ASSERTED. Three things per command wherever all three exist: what it printed, the exit
 *   code, and the effect — a file under the connector home, or a record on the node read back over
 *   REST with the owner's own token. A command that only prints gets the print and the code.
 *
 * @structure
 *   Setup · connector-home commands (status, list, config) · catalog (tools, schema) ·
 *   call · inbox/tasks/send · docs + refresh · add (already-connected, refusal, real device flow) ·
 *   acp · client adapters · remove/logout · node-side entry points · cleanup
 * @usage
 *   This suite writes no port of its own down, so any free one works. The runner refuses a port a
 *   suite file NAMES, which is why the number below is a placeholder rather than a literal.
 *
 *   AIMEAT_PORT=<a free port> AIMEAT_DB_PATH=test/.test-e2e-cli.db \
 *     node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-connect-cli
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial creation. No suite had ever run these commands.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import {
  BASE, NODE_ID, assert, auth, json, sleep,
  runCli, spawnCli, waitForExit, cleanEnv,
  registerOwnerAndAgent, seedConnectorHome, approveDeviceRequest,
  type NodeAccount, type CliRun,
} from './helpers/connect-cli.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

/** Assert on a finished child, quoting what it actually said when the assertion fails. */
function said(r: CliRun, needle: string | RegExp, what = 'stdout'): void {
  const hay = what === 'stdout' ? r.stdout : what === 'stderr' ? r.stderr : r.out;
  const hit = typeof needle === 'string' ? hay.includes(needle) : needle.test(hay);
  assert(hit, `expected ${what} to carry ${String(needle)}; got:\n${r.out.slice(0, 1200)}`);
}
/**
 * The exit code, with ONE documented exception, and the exception is a defect of this CLI.
 *
 * DEFECT — a command that made an HTTP call can abort instead of exiting. `process.exit()` runs
 * while an undici fetch handle is still closing, and on Windows libuv aborts the process:
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`, which
 * the shell sees as 0xC0000409 (3221226505) rather than the 0 or 1 the code chose. Reproduced three
 * times out of three on `screenshot-worker`, against this node and against a remote one, and seen
 * intermittently on `connect call`, so any fetching subcommand can do it. Anyone who scripts
 * `aimeat ... && next-step` gets a false failure from a command that did its work and printed its
 * answer.
 *
 * It is asserted here as it behaves rather than fixed: the OUTPUT of every command is still held to
 * its full assertion, and the exit code is only let through when the abort ANNOUNCED itself in the
 * output. A command that exits quietly is still held to its code, on every platform.
 */
function exited(r: CliRun, code: number): void {
  assert(!r.timedOut, `the child was killed on its deadline: aimeat ${r.argv.join(' ')}\n${r.out.slice(0, 1200)}`);
  if (/Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\)/.test(r.out)) {
    assert(process.platform === 'win32',
      `the libuv shutdown abort appeared on ${process.platform}, where it has never been seen: ${r.out.slice(0, 600)}`);
    return;
  }
  assert(r.code === code, `exit ${r.code} (expected ${code}) from: aimeat ${r.argv.join(' ')}\n${r.out.slice(0, 1200)}`);
}
/** JSON the CLI printed, from the first `{` on — the node prints warnings on stderr, not here. */
function printedJson(r: CliRun): any {
  const start = r.stdout.indexOf('{');
  assert(start >= 0, `no JSON on stdout: ${r.out.slice(0, 600)}`);
  return JSON.parse(r.stdout.slice(start));
}

// ─── State ───
const stamp = Date.now().toString(36);
const tmpRoot = resolve(process.cwd(), `test/.tmp-connect-cli-${Date.now()}`);
const home = join(tmpRoot, 'home');
const emptyHome = join(tmpRoot, 'empty');
const deviceHome = join(tmpRoot, 'device');
const clientSandbox = join(tmpRoot, 'client-sandbox');
const clientHome = join(tmpRoot, 'client-home');
const defectHome = join(tmpRoot, 'defect-client-home');
const defectAimeatHome = join(tmpRoot, 'defect-aimeat-home');
const skillDir = join(tmpRoot, 'skills');
const importDb = join(tmpRoot, 'import.db');
const importFile = join(tmpRoot, 'import.env');
const fileArgDir = join(tmpRoot, 'args');

const AGENT = 'clibot';
const OWNER = `cliowner${stamp}`;
let acc: NodeAccount;

/** The four env vars every per-platform client config path is built from. */
const clientEnv = {
  APPDATA: join(clientSandbox, 'AppData'),
  XDG_CONFIG_HOME: join(clientSandbox, 'xdg'),
  HOME: clientSandbox,
  USERPROFILE: clientSandbox,
};

console.log('\n=== AIMEAT CLI E2E (every subcommand but `connect serve`) ===\n');

console.log('Setup');
await test('Register the owner and agent, and lay down a connector home on the OLD layout', async () => {
  mkdirSync(tmpRoot, { recursive: true });
  mkdirSync(emptyHome, { recursive: true });
  mkdirSync(fileArgDir, { recursive: true });
  acc = await registerOwnerAndAgent(OWNER, AGENT);
  // 'legacy' on purpose: agents/<agent>/config.yaml is the shared pre-2026-09-01 path that nothing
  // writes any more, so the copy-forward in loadPerAgentConfig() can only be proven from a file
  // somebody puts there. `connect list` below is what reads it.
  seedConnectorHome({ home, agent: AGENT, owner: OWNER, token: acc.agentToken, layout: 'legacy' });
  assert(existsSync(join(home, 'agents', AGENT, 'config.yaml')), 'the legacy per-agent file should be seeded');
  assert(!existsSync(join(home, 'agents', OWNER, AGENT, 'config.yaml')), 'the current-layout file must NOT exist yet');
});

// ─── The commands that read the connector home ───
console.log('\nConnector home — help, status, list, config');

await test('connect help prints the connector help and touches no network', async () => {
  const r = await runCli(['connect', 'help'], { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, /aimeat connect/);
  said(r, 'serve');
});

await test('connect status reports the identity, the balance and Connected', async () => {
  const r = await runCli(['connect', 'status'], { home, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, `Agent: ${AGENT}`);
  said(r, `Owner: ${OWNER}`);
  said(r, `Node:  ${BASE}`);
  said(r, /Balance: \d+ morsels/);
  said(r, 'Status: Connected');
});

await test('connect whoami is the same command under the other name', async () => {
  const r = await runCli(['connect', 'whoami'], { home, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, `Agent: ${AGENT}`);
  said(r, 'Status: Connected');
});

await test('connect status in an empty home says so and still exits 0', async () => {
  const r = await runCli(['connect', 'status'], { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'Not configured.');
});

await test('connect status with a token the node has revoked names the recovery command', async () => {
  // The distinction status.ts exists to draw: a token that no longer authenticates is reported as
  // invalid, with its code, rather than as "not connected" — the two send an operator to opposite
  // places. A junk bearer is refused at the middleware, which is the 401 half of that branch.
  const bogusHome = join(tmpRoot, 'bogus');
  seedConnectorHome({ home: bogusHome, agent: AGENT, owner: OWNER, token: 'not.a.jwt' });
  const r = await runCli(['connect', 'status'], { home: bogusHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, /Status: (Token invalid|Not connected|Token valid, but agent record is missing)/);
});

await test('connect list names the agent, its node, and copies the old per-agent file forward', async () => {
  const r = await runCli(['connect', 'list'], { home, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, 'Connected agents (1):');
  said(r, `${AGENT}@${OWNER}`);
  said(r, BASE);
  // THE MIGRATION, as an effect rather than as a log line: the same settings now sit under the
  // per-owner path, and the old file is still there because nothing here deletes a credential.
  const migrated = join(home, 'agents', OWNER, AGENT, 'config.yaml');
  assert(existsSync(migrated), `loadPerAgentConfig did not copy the old layout forward; ${migrated} is absent`);
  const cfg = yamlParse(readFileSync(migrated, 'utf-8')) as { node_url?: string; agent?: string };
  assert(cfg.node_url === BASE, `the copied file kept the wrong node_url: ${cfg.node_url}`);
  assert(cfg.agent === undefined, 'savePerAgentConfig must drop the mirrored `agent` field on the way');
  assert(existsSync(join(home, 'agents', AGENT, 'config.yaml')), 'the old file must NOT be deleted for anyone');
});

await test('connect list in an empty home names the directory it looked in', async () => {
  const r = await runCli(['connect', 'list'], { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'No agents connected in');
  said(r, emptyHome.replace(/\\/g, '/').split('/').pop()!);
  said(r, 'AIMEAT_HOME=');
});

await test('connect config prints the stored global config as JSON', async () => {
  const r = await runCli(['connect', 'config'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  const cfg = printedJson(r);
  assert(cfg.agent === AGENT && cfg.owner === OWNER, `wrong identity: ${JSON.stringify(cfg)}`);
  assert(cfg.node_url === BASE, `wrong node_url: ${cfg.node_url}`);
});

await test('connect config in an empty home names the file it expected', async () => {
  const r = await runCli(['connect', 'config'], { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'No config found. Expected at:');
  said(r, 'config.yaml');
});

// ─── The tool catalog ───
console.log('\nTool catalog — tools, schema');

await test('connect tools lists the CLI-callable tools, one name per stanza', async () => {
  const r = await runCli(['connect', 'tools'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'aimeat_memory_read');
  said(r, 'aimeat_handbook_get');
});

await test('connect tools --json answers with a parseable catalog', async () => {
  const r = await runCli(['connect', 'tools', '--json'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  const payload = printedJson(r);
  assert(Array.isArray(payload.tools) && payload.tools.length > 0, 'no tools in the JSON catalog');
  const names = payload.tools.map((t: { name: string }) => t.name);
  assert(names.includes('aimeat_memory_write'), `aimeat_memory_write missing from ${names.length} tools`);
  assert(payload.tools.every((t: { description?: string }) => typeof t.description === 'string' && t.description.length > 0),
    'every listed tool must carry a description; a name alone tells a shell agent nothing');
});

await test('connect schema <tool> prints that tool\'s input metadata', async () => {
  const r = await runCli(['connect', 'schema', 'aimeat_memory_write'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  const schema = printedJson(r);
  assert(schema.name === 'aimeat_memory_write', `wrong tool: ${schema.name}`);
  assert(schema.visibility?.cliFallback === true, 'a tool this command prints must be CLI-callable');
  assert(schema.input && typeof schema.input === 'object', `no input block: ${Object.keys(schema).join(', ')}`);
});

await test('connect schema refuses an unknown tool and a missing name', async () => {
  const unknown = await runCli(['connect', 'schema', 'aimeat_not_a_tool'], { home, timeoutMs: 30_000 });
  exited(unknown, 1);
  said(unknown, 'Unknown CLI-callable tool', 'stderr');
  const missing = await runCli(['connect', 'schema'], { home, timeoutMs: 30_000 });
  exited(missing, 1);
  said(missing, 'Usage: aimeat connect schema', 'stderr');
});

// ─── connect call ───
console.log('\nconnect call — the shell fallback every MCP-less runtime uses');

const memKey = (suffix: string) => `cli.call.${stamp}.${suffix}`;

await test('call aimeat_memory_write --json <inline> lands the record on the node', async () => {
  const key = memKey('inline');
  const r = await runCli(['connect', 'call', 'aimeat_memory_write', '--json',
    JSON.stringify({ key, value: { via: 'inline json' }, visibility: 'private' })], { home, timeoutMs: 45_000 });
  exited(r, 0);
  // The node's own answer, with the owner's token — not the CLI's echo of its own input.
  const read = await json(`/v1/memory/${encodeURIComponent(key)}`, auth(acc.agentToken));
  assert(read.status === 200, `the node has no ${key}: ${read.status}`);
  assert(JSON.stringify(read.body.data).includes('inline json'), `wrong value: ${JSON.stringify(read.body.data).slice(0, 200)}`);
});

await test('call aimeat_memory_read prints what the node holds', async () => {
  const r = await runCli(['connect', 'call', 'aimeat_memory_read', '--json',
    JSON.stringify({ key: memKey('inline') })], { home, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, 'inline json');
});

await test('call --json <file> reads the input from disk', async () => {
  const key = memKey('fromfile');
  const inputFile = join(fileArgDir, 'input.json');
  writeFileSync(inputFile, JSON.stringify({ key, value: { via: 'a json file' }, visibility: 'private' }), 'utf-8');
  const r = await runCli(['connect', 'call', 'aimeat_memory_write', '--json', inputFile], { home, timeoutMs: 45_000 });
  exited(r, 0);
  const read = await json(`/v1/memory/${encodeURIComponent(key)}`, auth(acc.agentToken));
  assert(read.status === 200 && JSON.stringify(read.body.data).includes('a json file'),
    `--json <file> did not reach the node: ${read.status} ${JSON.stringify(read.body.data).slice(0, 200)}`);
});

await test('call --data is the same door under the other flag name', async () => {
  const key = memKey('data');
  const r = await runCli(['connect', 'call', 'aimeat_memory_write', '--data',
    JSON.stringify({ key, value: { via: 'the data flag' }, visibility: 'private' })], { home, timeoutMs: 45_000 });
  exited(r, 0);
  const read = await json(`/v1/memory/${encodeURIComponent(key)}`, auth(acc.agentToken));
  assert(read.status === 200 && JSON.stringify(read.body.data).includes('the data flag'),
    `--data did not reach the node: ${read.status}`);
});

await test('an "@file:" value is expanded from disk before the call leaves the process', async () => {
  // The one piece of input handling this CLI does that no other surface has: a string value of the
  // form @file:<path> is replaced by the file's TEXT. A shell agent uses it to send a document it
  // could never fit on a command line, so the proof has to be the bytes arriving on the node.
  const key = memKey('atfile');
  const payloadFile = join(fileArgDir, 'body.txt');
  const contents = `expanded from disk at ${stamp}\nsecond line`;
  writeFileSync(payloadFile, contents, 'utf-8');
  const r = await runCli(['connect', 'call', 'aimeat_memory_write', '--json',
    JSON.stringify({ key, value: `@file:${payloadFile.replace(/\\/g, '/')}`, visibility: 'private' })],
  { home, timeoutMs: 45_000 });
  exited(r, 0);
  const read = await json(`/v1/memory/${encodeURIComponent(key)}`, auth(acc.agentToken));
  assert(read.status === 200, `the node has no ${key}: ${read.status}`);
  assert(String(read.body.data?.value ?? '').includes('expanded from disk'),
    `the @file: reference was stored verbatim instead of expanded: ${JSON.stringify(read.body.data?.value).slice(0, 200)}`);
});

await test('call REFUSES a parameter the tool does not declare, rather than dropping it', async () => {
  // withDeclaredInputOnly, on the door a fleet agent types by hand. A silently ignored parameter
  // that still answers ok is the shape that cost `deliverable_key` and `owner_scope`, so what is
  // asserted here is the refusal AND the non-zero exit: a shell caller only sees the exit code.
  const r = await runCli(['connect', 'call', 'aimeat_memory_read', '--json',
    JSON.stringify({ key: memKey('inline'), no_such_parameter: true })], { home, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'UNKNOWN_PARAMETER', 'stderr');
  said(r, 'no_such_parameter', 'stderr');
});

await test('call refuses an unknown tool and a missing tool name', async () => {
  const unknown = await runCli(['connect', 'call', 'aimeat_not_a_tool', '--json', '{}'], { home, timeoutMs: 30_000 });
  exited(unknown, 1);
  said(unknown, 'Unknown CLI-callable tool', 'stderr');
  const missing = await runCli(['connect', 'call'], { home, timeoutMs: 30_000 });
  exited(missing, 1);
  said(missing, 'Usage: aimeat connect call', 'stderr');
});

await test('call from an unconfigured home says what to run, and exits 1', async () => {
  const r = await runCli(['connect', 'call', 'aimeat_memory_read', '--json', '{"key":"x"}'],
    { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 1);
  said(r, 'Not configured', 'stderr');
});

// ─── inbox, tasks, send ───
console.log('\nInbox, tasks and send');

await test('connect inbox says so when the inbox is empty, then prints what arrives', async () => {
  const empty = await runCli(['connect', 'inbox'], { home, timeoutMs: 45_000 });
  exited(empty, 0);
  said(empty, 'Inbox empty.');

  const marker = `inbound probe ${stamp}`;
  const sent = await json(`/v1/agents/${AGENT}/messages`, {
    method: 'POST', ...auth(acc.ownerToken),
    body: JSON.stringify({ content: marker, direction: 'inbound' }),
  });
  assert(sent.status === 201, `owner send: ${sent.status} ${JSON.stringify(sent.body.error)}`);

  const full = await runCli(['connect', 'inbox'], { home, timeoutMs: 45_000 });
  exited(full, 0);
  said(full, marker);
});

await test('connect tasks says so when there are none, then prints the queued task', async () => {
  // "None" has to be ARRANGED. Registering an agent creates the Hello Integration smoke-test task
  // for it straight away (createOnboardingTestTask, called from POST /v1/agents), so an agent's
  // queue is never empty on its own and asserting the empty branch without clearing it first is a
  // race — it failed exactly once that way before this loop existed.
  // The smoke-test task is created ACTIVE, and an active task refuses deletion with 409, so it is
  // paused first — the recovery the refusal itself names.
  const existing = await json(`/v1/agents/${AGENT}/tasks`, auth(acc.ownerToken));
  for (const t of (existing.body.data?.tasks ?? []) as Array<{ id: string; status: string }>) {
    if (t.status === 'active') {
      const paused = await json(`/v1/agents/${AGENT}/tasks/${t.id}/pause`, { method: 'POST', ...auth(acc.ownerToken) });
      assert(paused.status === 200, `pausing task ${t.id}: ${paused.status} ${JSON.stringify(paused.body.error)}`);
    }
    const del = await json(`/v1/agents/${AGENT}/tasks/${t.id}`, { method: 'DELETE', ...auth(acc.ownerToken) });
    assert(del.status === 200, `clearing task ${t.id}: ${del.status} ${JSON.stringify(del.body.error)}`);
  }

  const none = await runCli(['connect', 'tasks'], { home, timeoutMs: 45_000 });
  exited(none, 0);
  said(none, 'No tasks.');

  const title = `CLI task probe ${stamp}`;
  const created = await json(`/v1/agents/${AGENT}/tasks`, {
    method: 'POST', ...auth(acc.ownerToken),
    body: JSON.stringify({ title, description: 'queued for the CLI', status: 'queued' }),
  });
  assert(created.status === 201, `create task: ${created.status} ${JSON.stringify(created.body.error)}`);

  const listed = await runCli(['connect', 'tasks'], { home, timeoutMs: 45_000 });
  exited(listed, 0);
  said(listed, title);
});

await test('connect send --body posts the message, and the node has it afterwards', async () => {
  const body = `outbound probe ${stamp}`;
  const r = await runCli(['connect', 'send', '--body', body], { home, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, 'Message sent.');
  const history = await json(`/v1/agents/${AGENT}/messages`, auth(acc.ownerToken));
  assert(history.status === 200, `history: ${history.status}`);
  assert(JSON.stringify(history.body.data).includes(body),
    `the message the CLI reported sending is not on the node: ${JSON.stringify(history.body.data).slice(0, 300)}`);
});

await test('connect send with no --body prints the usage and exits 1', async () => {
  const r = await runCli(['connect', 'send'], { home, timeoutMs: 30_000 });
  exited(r, 1);
  said(r, 'Usage: npx aimeat connect send', 'stderr');
});

// ─── docs and refresh ───
console.log('\nDocs and the skill bundle');

await test('connect docs with no bundle downloaded points at refresh', async () => {
  const r = await runCli(['connect', 'docs'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'No local docs found.');
});

await test('connect refresh downloads and extracts the bundle into the connector home', async () => {
  const r = await runCli(['connect', 'refresh'], { home, timeoutMs: 60_000 });
  exited(r, 0);
  said(r, 'downloaded and extracted to');
  said(r, 'Main skill file:');
  const bundleDir = join(home, AGENT);
  assert(existsSync(join(bundleDir, 'skill-bundle.zip')), `no skill-bundle.zip in ${bundleDir}`);
  assert(existsSync(join(bundleDir, 'SKILL.md')), `no SKILL.md in ${bundleDir}`);
  assert(existsSync(join(bundleDir, 'BUNDLE.md')), `no BUNDLE.md in ${bundleDir}`);
  assert(readFileSync(join(bundleDir, 'SKILL.md'), 'utf-8').trim().length > 0, 'SKILL.md is empty');
});

await test('connect docs now prints the SKILL.md the refresh wrote', async () => {
  const r = await runCli(['connect', 'docs'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  const skill = readFileSync(join(home, AGENT, 'SKILL.md'), 'utf-8');
  const firstLine = skill.split('\n').find(l => l.trim().length > 0)!.trim();
  said(r, firstLine);
});

await test('connect docs <module> fetches the handbook module from the node', async () => {
  const r = await runCli(['connect', 'docs', 'tasks'], { home, timeoutMs: 45_000 });
  exited(r, 0);
  assert(r.stdout.trim().length > 100, `the module handbook came back near-empty: ${r.out.slice(0, 400)}`);
});

await test('connect docs <unknown module> reports it and exits 1', async () => {
  const r = await runCli(['connect', 'docs', 'not-a-module'], { home, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'not found', 'stderr');
});

await test('connect refresh --agent --owner routes through THAT agent, not the primary', async () => {
  rmSync(join(home, AGENT, 'SKILL.md'), { force: true });
  const r = await runCli(['connect', 'refresh', '--agent', AGENT, '--owner', OWNER], { home, timeoutMs: 60_000 });
  exited(r, 0);
  said(r, `Skill bundle for ${AGENT} downloaded`);
  assert(existsSync(join(home, AGENT, 'SKILL.md')), 'the per-agent refresh did not re-extract SKILL.md');
});

await test('connect refresh --agent <unknown> exits 1 and names the listing command', async () => {
  const r = await runCli(['connect', 'refresh', '--agent', 'nosuchagent'], { home, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'aimeat connect list', 'stderr');
});

// ─── add ───
console.log('\nconnect add');

await test('add against a home that already holds a valid token takes the Already-connected branch', async () => {
  const r = await runCli(['connect', 'add', '--url', BASE, '--owner', OWNER, '--agent', AGENT],
    { home, timeoutMs: 60_000 });
  exited(r, 0);
  said(r, 'Already connected! Token is valid.');
  said(r, 'Skill bundle downloaded and extracted to');
  said(r, 'aimeat connect serve');
  // saveConfig ran: the global file names this identity even though it was already there.
  const cfg = yamlParse(readFileSync(join(home, 'config.yaml'), 'utf-8')) as { agent: string; owner: string };
  assert(cfg.agent === AGENT && cfg.owner === OWNER, `global config after add: ${JSON.stringify(cfg)}`);
});

await test('add in a non-TTY with no --url or --owner refuses instead of prompting into the void', async () => {
  const r = await runCli(['connect', 'add'], { home: emptyHome, timeoutMs: 30_000 });
  exited(r, 1);
  said(r, 'Missing required options', 'stderr');
});

await test('add runs the real device-authorization flow and stores everything it should', async () => {
  // RFC 8628 end to end: the CLI asks, the OWNER approves out of band, the CLI polls, and what it
  // was given lands on disk. The CLI's first poll is 5 s after the request, so the deadline is
  // generous by design; the approval side is driven here, concurrently, exactly as the consent card
  // does it (no scopes named = keep what this agent has).
  const deviceAgent = 'devicebot';
  const running = runCli(['connect', 'add', '--url', BASE, '--owner', OWNER, '--agent', deviceAgent],
    { home: deviceHome, timeoutMs: 90_000 });
  await approveDeviceRequest(acc.ownerToken, deviceAgent, 40_000);
  const r = await running;
  exited(r, 0);
  said(r, `Verification code:`);
  said(r, 'Approved!');
  said(r, `Token stored (aimeat:${deviceAgent}@${OWNER})`);

  const tokenFile = join(deviceHome, 'tokens', `${deviceAgent}@${OWNER}.token`);
  assert(existsSync(tokenFile), `no token at ${tokenFile}`);
  assert(readFileSync(tokenFile, 'utf-8').trim().split('.').length === 3, 'the stored credential is not a JWT');

  const perAgent = join(deviceHome, 'agents', OWNER, deviceAgent, 'config.yaml');
  assert(existsSync(perAgent), `no per-agent config at ${perAgent}`);
  const pa = yamlParse(readFileSync(perAgent, 'utf-8')) as { node_url: string; primary?: boolean };
  assert(pa.node_url === BASE, `per-agent node_url: ${pa.node_url}`);
  assert(pa.primary === true, 'the first agent of an owner is the primary');

  const global = yamlParse(readFileSync(join(deviceHome, 'config.yaml'), 'utf-8')) as { agent: string; owner: string };
  assert(global.agent === deviceAgent && global.owner === OWNER, `global config: ${JSON.stringify(global)}`);

  // And the node agrees the agent now exists under this owner.
  const agents = await json(`/v1/agents?owner=${encodeURIComponent(OWNER)}`, auth(acc.ownerToken));
  assert(JSON.stringify(agents.body.data?.agents ?? []).includes(deviceAgent),
    `the node does not list ${deviceAgent}: ${JSON.stringify(agents.body.data).slice(0, 300)}`);
});

// ─── acp ───
console.log('\nconnect acp — the editor transport');

await test('acp reads its identity from the node and answers an initialize frame on stdout', async () => {
  const proc = spawnCli(['connect', 'acp', '--agent', AGENT, '--owner', OWNER], { home });
  try {
    // The node call happens before the protocol starts, and its result is announced on stderr —
    // stdout belongs to the frames, which is the property being relied on here.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !/AIMEAT ACP agent:/.test(proc.stderr())) await sleep(200);
    assert(/AIMEAT ACP agent:/.test(proc.stderr()),
      `the agent never announced itself:\n${proc.stderr().slice(0, 800)}`);
    assert(proc.stderr().includes(acc.agentGaii),
      `the announced identity must be the GAII the node handed back: ${proc.stderr().slice(0, 400)}`);

    proc.child.stdin?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } },
    }) + '\n');

    const frameDeadline = Date.now() + 20_000;
    while (Date.now() < frameDeadline && !proc.stdout().includes('"id":1')) await sleep(150);
    const line = proc.stdout().split('\n').find(l => l.includes('"id":1'));
    assert(!!line, `no response frame on stdout:\n${proc.stdout().slice(0, 600)}\n--- stderr ---\n${proc.stderr().slice(0, 600)}`);
    const frame = JSON.parse(line!);
    assert(frame.result?.protocolVersion !== undefined,
      `initialize did not answer with a protocol version: ${line}`);
    assert(Array.isArray(frame.result?.authMethods),
      `initialize must declare its auth methods: ${line}`);
  } finally {
    try { proc.child.kill('SIGKILL'); } catch { /* already gone */ }
    await waitForExit(proc.child, 8_000);
  }
});

// ─── connect client ───
console.log('\nconnect client — pointing a chat client at this node');

await test('client <unknown> prints the usage and exits 1; client help does not', async () => {
  const unknown = await runCli(['connect', 'client', 'not-a-client'], { home: emptyHome, timeoutMs: 30_000 });
  exited(unknown, 1);
  said(unknown, 'Unknown client', 'stderr');
  const help = await runCli(['connect', 'client', 'help'], { home: emptyHome, timeoutMs: 30_000 });
  exited(help, 0);
  said(help, 'Usage: aimeat connect client');
});

await test('client goose writes the Goose extension, the launcher pair, and keeps the token out of both', async () => {
  seedConnectorHome({ home: clientHome, agent: AGENT, owner: OWNER, token: acc.agentToken, global: false });
  const r = await runCli(['connect', 'client', 'goose', '--home', clientHome, '--url', BASE, '--name', 'aimeat'],
    { home: emptyHome, env: clientEnv, timeoutMs: 60_000 });
  exited(r, 0);
  said(r, `Goose is connected to ${BASE} as ${AGENT}@${OWNER}`);

  const gooseCfg = process.platform === 'win32'
    ? join(clientEnv.APPDATA, 'Block', 'goose', 'config', 'config.yaml')
    : join(clientEnv.XDG_CONFIG_HOME, 'goose', 'config.yaml');
  assert(existsSync(gooseCfg), `goose config not written at ${gooseCfg}`);
  const parsed = yamlParse(readFileSync(gooseCfg, 'utf-8')) as any;
  assert(parsed.extensions?.aimeat?.uri === `${BASE}/v1/mcp`, `wrong MCP uri: ${JSON.stringify(parsed.extensions?.aimeat)}`);
  assert(!readFileSync(gooseCfg, 'utf-8').includes(acc.agentToken.slice(0, 24)),
    'the agent token must never be written into a client config file');

  // writeLauncher's pair, in the connector home the client was given.
  assert(existsSync(join(clientHome, 'launch-goose.ps1')), 'no launch-goose.ps1');
  assert(existsSync(join(clientHome, 'launch-goose.sh')), 'no launch-goose.sh');
  assert(readFileSync(join(clientHome, 'launch-goose.sh'), 'utf-8').includes('AIMEAT_AGENT_TOKEN'),
    'the launcher is what supplies the token at run time; it must export it');
});

await test('client cursor and client vscode each write their own MCP config into the same home', async () => {
  const cursor = await runCli(['connect', 'client', 'cursor', '--home', clientHome, '--url', BASE, '--reuse'],
    { home: emptyHome, env: clientEnv, timeoutMs: 60_000 });
  exited(cursor, 0);
  const cursorCfg = join(clientSandbox, '.cursor', 'mcp.json');
  assert(existsSync(cursorCfg), `cursor config not written at ${cursorCfg}`);
  const cj = JSON.parse(readFileSync(cursorCfg, 'utf-8'));
  assert(cj.mcpServers?.aimeat?.url === `${BASE}/v1/mcp`, `cursor entry: ${JSON.stringify(cj.mcpServers)}`);
  assert(String(cj.mcpServers.aimeat.headers.Authorization).includes('${env:AIMEAT_AGENT_TOKEN}'),
    'cursor must read the token from the environment, not from the file');

  const vscode = await runCli(['connect', 'client', 'vscode', '--home', clientHome, '--url', BASE, '--reuse'],
    { home: emptyHome, env: clientEnv, timeoutMs: 60_000 });
  exited(vscode, 0);
  const vscodeCfg = process.platform === 'win32'
    ? join(clientEnv.APPDATA, 'Code', 'User', 'mcp.json')
    : join(clientEnv.XDG_CONFIG_HOME, 'Code', 'User', 'mcp.json');
  assert(existsSync(vscodeCfg), `vscode config not written at ${vscodeCfg}`);
  const vj = JSON.parse(readFileSync(vscodeCfg, 'utf-8'));
  assert(vj.servers?.aimeat?.url === `${BASE}/v1/mcp`, `vscode entry: ${JSON.stringify(vj.servers)}`);
});

await test('client claude-desktop writes a stdio entry and no url, which is what Desktop can read', async () => {
  const r = await runCli(['connect', 'client', 'claude-desktop', '--home', clientHome, '--url', BASE, '--reuse'],
    { home: emptyHome, env: clientEnv, timeoutMs: 60_000 });
  exited(r, 0);
  const file = process.platform === 'win32'
    ? join(clientEnv.APPDATA, 'Claude', 'claude_desktop_config.json')
    : join(clientEnv.XDG_CONFIG_HOME, 'Claude', 'claude_desktop_config.json');
  assert(existsSync(file), `claude desktop config not written at ${file}`);
  const cj = JSON.parse(readFileSync(file, 'utf-8'));
  const entry = cj.mcpServers?.aimeat;
  assert(entry, `no aimeat server: ${JSON.stringify(cj.mcpServers)}`);
  assert(entry.url === undefined, 'a url key makes Claude Desktop discard the whole mcpServers block');
  assert(entry.env?.AIMEAT_HOME === clientHome, `the entry must point at this client's home: ${JSON.stringify(entry.env)}`);
});

await test('client claude-code writes the headers helper even when the claude CLI is unusable', async () => {
  // The headers helper is the whole point of the Claude Code adapter — the token stays out of
  // ~/.claude.json — and it is written on BOTH branches. This run takes the fallback branch on
  // purpose: the real `claude` binary is not invoked, because a test must not edit a developer's
  // own client configuration. On Windows that is done by breaking the shell the adapter would use;
  // elsewhere by emptying PATH, which this child no longer needs.
  const noShell = join(tmpRoot, 'no-such-shell');
  const env: Record<string, string | undefined> = process.platform === 'win32'
    ? { ...clientEnv, ComSpec: noShell }
    : { ...clientEnv, PATH: fileArgDir };
  const r = await runCli(['connect', 'client', 'claude-code', '--home', clientHome, '--url', BASE, '--reuse'],
    { home: emptyHome, env, timeoutMs: 60_000 });
  exited(r, 0);
  assert(existsSync(join(clientHome, 'auth-header.ps1')), 'no auth-header.ps1');
  assert(existsSync(join(clientHome, 'auth-header.sh')), 'no auth-header.sh');
  said(r, 'auth-header');
  said(r, 'headersHelper');
  const sh = readFileSync(join(clientHome, 'auth-header.sh'), 'utf-8');
  assert(sh.includes('Authorization: Bearer'), 'the helper must print an Authorization header');
  assert(!sh.includes(acc.agentToken.slice(0, 24)), 'the helper reads the token at run time; it must not embed it');
});

await test('DEFECT — `client` with a fresh --home stores the credential in AIMEAT_HOME instead', async () => {
  // AS IT BEHAVES TODAY, not as it should. clients/index.ts sets process.env.AIMEAT_HOME = target.home
  // and says the dynamic imports below it are what make that take effect — but src/index-connect.ts
  // imports cli/connect/config.js STATICALLY, so CONFIG_DIR was already captured from the ambient
  // AIMEAT_HOME before any of this ran. The device flow therefore writes the token to the ambient
  // home, `tokenFileIn(target.home)` finds nothing, and the command exits 1 having created a real
  // agent on the node and left it where the client cannot see it.
  const clientAgent = 'clientbot';
  mkdirSync(defectHome, { recursive: true });
  mkdirSync(defectAimeatHome, { recursive: true });
  const running = runCli(['connect', 'client', 'goose', '--home', defectHome, '--url', BASE,
    '--owner', OWNER, '--agent', clientAgent],
  { home: defectAimeatHome, env: clientEnv, timeoutMs: 90_000 });
  await approveDeviceRequest(acc.ownerToken, clientAgent, 40_000);
  const r = await running;

  exited(r, 1);
  said(r, 'No credential was stored', 'stderr');
  assert(existsSync(join(defectAimeatHome, 'tokens', `${clientAgent}@${OWNER}.token`)),
    'the token should have landed in the ambient AIMEAT_HOME (that is the defect)');
  assert(!existsSync(join(defectHome, 'tokens', `${clientAgent}@${OWNER}.token`)),
    'if the token IS in --home now, the defect is fixed and this assertion should be inverted');
});

// ─── remove and logout ───
console.log('\nremove and logout');

await test('connect remove deletes the credential and the per-agent directory', async () => {
  const r = await runCli(['connect', 'remove', 'devicebot', '--owner', OWNER], { home: deviceHome, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, `Removed devicebot@${OWNER}.`);
  assert(!existsSync(join(deviceHome, 'tokens', `devicebot@${OWNER}.token`)), 'the token file survived remove');
  assert(!existsSync(join(deviceHome, 'agents', OWNER, 'devicebot')), 'the per-agent directory survived remove');
});

await test('connect remove refuses an unknown agent and a missing name', async () => {
  const unknown = await runCli(['connect', 'remove', 'nosuchagent'], { home, timeoutMs: 30_000 });
  exited(unknown, 1);
  said(unknown, "not found", 'stderr');
  const missing = await runCli(['connect', 'remove'], { home, timeoutMs: 30_000 });
  exited(missing, 1);
  said(missing, 'Usage: aimeat connect remove', 'stderr');
});

await test('connect logout removes the primary credential; a second logout says there is nothing', async () => {
  const r = await runCli(['connect', 'logout'], { home, timeoutMs: 30_000 });
  exited(r, 0);
  said(r, 'Credentials removed.');
  assert(!existsSync(join(home, 'tokens', `${AGENT}@${OWNER}.token`)), 'the token file survived logout');
  // The global config is deliberately left behind, so the command still finds an identity and
  // reports the deletion of a credential that is already gone. Asserted as it behaves.
  const again = await runCli(['connect', 'logout'], { home, timeoutMs: 30_000 });
  exited(again, 0);
  said(again, 'Credentials removed.');

  const empty = await runCli(['connect', 'logout'], { home: emptyHome, timeoutMs: 30_000 });
  exited(empty, 0);
  said(empty, 'Not configured.');
});

// ─── The node-side entry points ───
console.log('\nNode-side entry points — config, validate, skill install, screenshot-worker');

await test('aimeat config prints the settings and MASKS the admin password', async () => {
  const r = await runCli(['config'], { home: emptyHome, env: { AIMEAT_ADMIN_PASSWORD: 'test-admin-pw' }, timeoutMs: 45_000 });
  exited(r, 0);
  said(r, 'AIMEAT Node Configuration');
  said(r, 'AIMEAT_ADMIN_PASSWORD');
  said(r, 'te*********pw');
  assert(!r.stdout.includes('test-admin-pw'),
    'the display surface printed the admin password in the clear');
});

await test('aimeat config export --format json is parseable and carries the node block', async () => {
  const r = await runCli(['config', 'export', '--format', 'json'], { home: emptyHome, timeoutMs: 45_000 });
  exited(r, 0);
  const exported = JSON.parse(r.stdout);
  assert(typeof exported.node?.id === 'string' && exported.node.id.length > 0, `no node.id: ${r.stdout.slice(0, 300)}`);
  assert(typeof exported.node?.port === 'number', `no node.port: ${JSON.stringify(exported.node)}`);
});

await test('aimeat config export --format env and --format ini render the same settings', async () => {
  const asEnv = await runCli(['config', 'export', '--format', 'env'], { home: emptyHome, timeoutMs: 45_000 });
  exited(asEnv, 0);
  said(asEnv, 'AIMEAT_NODE_ID=');
  said(asEnv, '# AIMEAT configuration (exported)');

  const asIni = await runCli(['config', 'export', '--format', 'ini'], { home: emptyHome, timeoutMs: 45_000 });
  exited(asIni, 0);
  said(asIni, '; AIMEAT configuration (exported)');
  said(asIni, '[node]');
});

await test('aimeat config export refuses a format it does not have', async () => {
  const r = await runCli(['config', 'export', '--format', 'yaml'], { home: emptyHome, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'Unknown export format', 'stderr');
});

await test('aimeat config import classifies, asks, and writes only the mutable rows', async () => {
  // A throwaway database, so the write is real and lands nowhere anybody uses. The prompt is a
  // readline Y/n on stdin, which is why this command has never been testable without a child
  // process: piping "y" is the only way to answer it.
  writeFileSync(importFile, [
    'AIMEAT_DEPEERING_GRACE_HOURS=48',
    'AIMEAT_NODE_ID=an-immutable-row',
    '',
  ].join('\n'), 'utf-8');
  const r = await runCli(['config', 'import', '--file', importFile, '--db', 'sqlite', '--db-path', importDb],
    { home: emptyHome, stdin: 'y\n', timeoutMs: 120_000 });
  exited(r, 0);
  said(r, '1 mutable');
  said(r, '1 immutable');
  said(r, 'Imported 1 values to database');
  assert(existsSync(importDb), `the import wrote no database at ${importDb}`);
});

await test('aimeat config import answered with "n" writes nothing', async () => {
  const r = await runCli(['config', 'import', '--file', importFile, '--db', 'sqlite', '--db-path', importDb],
    { home: emptyHome, stdin: 'n\n', timeoutMs: 120_000 });
  exited(r, 0);
  said(r, 'Cancelled.');
  assert(!r.stdout.includes('Imported'), 'a declined import must not report an import');
});

await test('aimeat config import with no source names the two it takes', async () => {
  const r = await runCli(['config', 'import'], { home: emptyHome, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'Specify --file <path> or --from consul', 'stderr');
});

await test('aimeat validate passes on a bare environment and fails on a bad value, naming the key', async () => {
  const ok = await runCli(['validate'], { home: emptyHome, env: cleanEnv(), timeoutMs: 45_000 });
  exited(ok, 0);
  said(ok, 'Result: PASS');

  const badPort = await runCli(['validate'], { home: emptyHome, env: cleanEnv({ AIMEAT_PORT: '0' }), timeoutMs: 45_000 });
  exited(badPort, 1);
  said(badPort, 'AIMEAT_PORT');
  said(badPort, 'Result: FAIL');

  const goneBackend = await runCli(['validate'], { home: emptyHome, env: cleanEnv({ AIMEAT_STORAGE: 'mongodb' }), timeoutMs: 45_000 });
  exited(goneBackend, 1);
  said(goneBackend, 'AIMEAT_STORAGE');
  said(goneBackend, 'MongoDB backend has been removed');
});

await test('aimeat skill install writes the skill locally and stamps where it came from', async () => {
  // --node + --token, because the skills registry answers AUTH_REQUIRED to an anonymous read even
  // for a node-scope skill. That is the pair the command documents for "an explicit node".
  const r = await runCli(['skill', 'install', 'node:manage-my-agents',
    '--node', BASE, '--token', acc.ownerToken, '--dir', skillDir], { home: emptyHome, timeoutMs: 60_000 });
  exited(r, 0);
  said(r, 'Installed node:manage-my-agents');
  const md = join(skillDir, 'manage-my-agents', 'SKILL.md');
  assert(existsSync(md), `no SKILL.md at ${md}`);
  const text = readFileSync(md, 'utf-8');
  assert(text.includes('aimeat_ref:'), 'the provenance ref was not stamped into the frontmatter');
  assert(text.includes(`aimeat_node: ${BASE}`), `the node was not stamped: ${text.slice(0, 400)}`);
  assert(/aimeat_ref: node:manage-my-agents@\d+\.\d+\.\d+/.test(text),
    `the stamped ref must be version-pinned: ${text.slice(0, 400)}`);
});

await test('aimeat skill install refuses a malformed ref; a bare `skill` is help, an unknown one is not', async () => {
  const bad = await runCli(['skill', 'install', 'NOT A REF', '--node', BASE, '--dir', skillDir],
    { home: emptyHome, timeoutMs: 45_000 });
  exited(bad, 1);
  said(bad, 'Not a valid skill ref', 'stderr');

  // `aimeat skill` alone prints the usage and exits 0 — index.ts sets the failure code only for a
  // NAMED action it does not have, and treats a bare `skill` the way `--help` is treated.
  const usage = await runCli(['skill'], { home: emptyHome, timeoutMs: 45_000 });
  exited(usage, 0);
  said(usage, 'Usage: aimeat skill install');

  const wrongAction = await runCli(['skill', 'uninstall'], { home: emptyHome, timeoutMs: 45_000 });
  exited(wrongAction, 1);
  said(wrongAction, 'Usage: aimeat skill install');
});

await test('aimeat screenshot-worker --dry-run reads the node\'s app list without a token', async () => {
  // --dry-run is the branch an operator uses to see what a real run would touch, and it is the one
  // branch that needs no operator credential. What is asserted is the listing it made from this
  // node; the capture itself needs a browser, which is not this suite's business.
  // Nothing in this run publishes an app and a fresh node seeds none, so the count is 0 and no
  // browser is ever launched. Asserting the zero rather than a range is deliberate: if a future
  // change starts seeding apps, this line says exactly what changed instead of quietly starting to
  // depend on Edge being installed on the machine running the suite.
  const r = await runCli(['screenshot-worker', '--base', BASE, '--limit', '1', '--dry-run'],
    { home: emptyHome, timeoutMs: 120_000 });
  said(r, '0 apps listed; 0 need a screenshot.');
  exited(r, 0);
});

await test('aimeat screenshot-worker without a token and without --dry-run refuses', async () => {
  const r = await runCli(['screenshot-worker', '--base', BASE, '--limit', '1'],
    { home: emptyHome, env: { AIMEAT_OP_TOKEN: undefined }, timeoutMs: 60_000 });
  exited(r, 1);
  said(r, 'Missing operator token', 'stderr');
});

await test('an unknown top-level subcommand prints the help and exits 1', async () => {
  const r = await runCli(['not-a-subcommand'], { home: emptyHome, timeoutMs: 45_000 });
  exited(r, 1);
  said(r, 'Unknown command: not-a-subcommand', 'stderr');
  said(r, 'AI Memory Exchange and Action Transfer');
  said(r, 'aimeat connect [opts]');
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete the owner and remove every temp directory', async () => {
  const { status } = await json(`/v1/owners/${encodeURIComponent(OWNER)}`, {
    method: 'DELETE', ...auth(acc.ownerToken),
  });
  assert(status === 200, `owner delete status ${status}`);
  await sleep(200);
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* a handle may still be closing */ }
  void NODE_ID;
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connect CLI E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

/**
 * @file test/helpers/connect-cli.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Spawning and setup helpers for e2e-connect-cli.ts, the suite that drives the real
 *   `aimeat` binary as a child process. Kept here so the suite itself stays under the file-line
 *   ceiling; nothing in this file asserts, it only produces material the suite asserts on.
 *
 *   WHY A CHILD PROCESS AT ALL. Every one of these subcommands ends in `process.exit()`, reads its
 *   configuration from a directory captured at module load (AIMEAT_HOME), and prints its answer to
 *   stdout. None of that is observable from an in-process import: the exit kills the suite, the
 *   home is fixed for the life of the module, and the print is the product. So the CLI is spawned
 *   the way a person runs it, with `node --import tsx src/index.ts <args>`, which is also the argv
 *   shape the coverage preload counts.
 *
 * @structure
 *   - runCli()/spawnCli() — one-shot and long-running child processes, every one with a deadline
 *   - childEnv()/cleanEnv() — the environment a child gets, and the stripped one `validate` needs
 *   - registerOwnerAndAgent() — an owner, an agent with '*', and both tokens
 *   - seedConnectorHome() — a connector home on either the current or the legacy per-agent layout
 *   - approveDeviceRequest() — the owner half of RFC 8628, as the consent card performs it
 *
 * @usage Imported by test/e2e-connect-cli.ts. Not a suite: it registers no tests and runs nothing.
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial creation, with e2e-connect-cli.ts.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

export const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
export const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

export function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/* ───────── HTTP against the runner's shared node ───────── */

export interface HttpAnswer { status: number; body: any }

export async function json(path: string, opts: RequestInit = {}, base = BASE): Promise<HttpAnswer> {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}

export const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/* ───────── Child processes ───────── */

export interface CliRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr interleaved by arrival, for a lenient "did it say this anywhere" check. */
  out: string;
  timedOut: boolean;
  argv: string[];
}

export interface CliOptions {
  /** AIMEAT_HOME for the child. Every connector artifact it writes lands under this. */
  home?: string;
  /** Extra env. A key set to undefined is DELETED from the child's environment. */
  env?: Record<string, string | undefined>;
  /** Written to the child's stdin and then closed. Omit to close stdin immediately. */
  stdin?: string;
  /** Deadline. The child is killed on it and `timedOut` is set, so nothing is left behind. */
  timeoutMs?: number;
}

/** The environment a CLI child gets: the suite's own pins, plus AIMEAT_HOME, minus explicit deletes. */
export function childEnv(opts: CliOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.home) env.AIMEAT_HOME = opts.home;
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  return env;
}

/**
 * The environment for `aimeat validate`, which reads process.env and nothing else: every AIMEAT_*
 * pin the runner set is a value the validator would judge, so a run under them says something about
 * the test rig rather than about the validator. TOTP is the one value a bare environment does NOT
 * pass on — an unset encryption key is an error by design — so it is turned off explicitly, which is
 * a supported configuration rather than a workaround.
 */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const stripped: Record<string, string | undefined> = { DATABASE_URL: undefined };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AIMEAT_')) stripped[key] = undefined;
  }
  return { ...stripped, AIMEAT_TOTP_ENABLED: 'false', ...extra };
}

const CLI_ARGS = ['--import', 'tsx', 'src/index.ts'];

/** Start the CLI and leave it running. The caller owns the process and must stop it. */
export function spawnCli(args: string[], opts: CliOptions = {}): {
  child: ChildProcess; stdout: () => string; stderr: () => string;
} {
  let outBuf = '';
  let errBuf = '';
  const child = spawn(process.execPath, [...CLI_ARGS, ...args], {
    cwd: process.cwd(),
    env: childEnv(opts),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => { outBuf += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { errBuf += d.toString(); });
  return { child, stdout: () => outBuf, stderr: () => errBuf };
}

/** Run the CLI once and collect everything it said. Killed on the deadline rather than left behind. */
export function runCli(args: string[], opts: CliOptions = {}): Promise<CliRun> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [...CLI_ARGS, ...args], {
      cwd: process.cwd(),
      env: childEnv(opts),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let out = '';
    let timedOut = false;

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); out += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, opts.timeoutMs ?? 60_000);

    if (opts.stdin !== undefined) child.stdin?.write(opts.stdin);
    child.stdin?.end();

    child.once('error', (err) => {
      clearTimeout(timer);
      settle({ code: null, signal: null, stdout, stderr: stderr + String(err), out, timedOut, argv: args });
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      settle({ code, signal, stdout, stderr, out, timedOut, argv: args });
    });
  });
}

/** Wait for a child to exit; returns false if it was still running at the deadline. */
export function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}

/* ───────── Node-side setup ───────── */

async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

async function getAuthToken(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const signature = await signMsg(priv, message);
  const payload = isAgent
    ? { gaii: idOrOwner, timestamp: ts, signature }
    : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

export interface NodeAccount {
  ownerName: string;
  ownerToken: string;
  agentName: string;
  agentGaii: string;
  agentToken: string;
}

export async function registerOwnerAndAgent(ownerName: string, agentName: string): Promise<NodeAccount> {
  const reg = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `owner status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const ownerToken = await getAuthToken(ownerName, reg.body.data.private_key, false);
  const ag = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(ag.status === 201, `agent status ${ag.status}: ${JSON.stringify(ag.body)}`);
  const agentGaii = ag.body.data.agent.gaii as string;
  const agentToken = await getAuthToken(agentGaii, ag.body.data.private_key, true);
  return { ownerName, ownerToken, agentName, agentGaii, agentToken };
}

/**
 * Lay down a connector home the way `aimeat connect` would have left one.
 *
 * `layout: 'legacy'` writes `agents/<agent>/config.yaml`, the shared pre-2026-09-01 path. Nothing
 * writes that any more, so the only way to prove the copy-forward in loadPerAgentConfig() still
 * happens is to put a file there and read it back through a command.
 *
 * The GLOBAL config.yaml is written here and by no other helper in this repo: `status`, `inbox`,
 * `tasks`, `send`, `docs`, `refresh` without --agent, `logout` and `config` all read it, and
 * without it every one of them prints "Not configured" and proves nothing.
 */
export function seedConnectorHome(opts: {
  home: string;
  agent: string;
  owner: string;
  token: string;
  nodeUrl?: string;
  layout?: 'current' | 'legacy';
  global?: boolean;
}): void {
  const nodeUrl = opts.nodeUrl ?? BASE;
  mkdirSync(join(opts.home, 'tokens'), { recursive: true });
  writeFileSync(join(opts.home, 'tokens', `${opts.agent}@${opts.owner}.token`), opts.token, 'utf-8');

  if (opts.global !== false) {
    writeFileSync(
      join(opts.home, 'config.yaml'),
      yamlStringify({ node_url: nodeUrl, agent: opts.agent, owner: opts.owner }),
      'utf-8',
    );
  }

  const perAgentDir = opts.layout === 'legacy'
    ? join(opts.home, 'agents', opts.agent)
    : join(opts.home, 'agents', opts.owner, opts.agent);
  mkdirSync(perAgentDir, { recursive: true });
  writeFileSync(
    join(perAgentDir, 'config.yaml'),
    yamlStringify(opts.layout === 'legacy'
      ? { agent: opts.agent, owner: opts.owner, node_url: nodeUrl, primary: true }
      : { node_url: nodeUrl, primary: true }),
    'utf-8',
  );
}

/**
 * The owner's half of the device-authorization dance, exactly as the consent card performs it:
 * find the pending request this agent name raised, then approve it without naming scopes.
 */
export async function approveDeviceRequest(
  ownerToken: string,
  agentName: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = '';
  while (Date.now() < deadline) {
    const list = await json('/v1/agents/device-authorize/pending', auth(ownerToken));
    if (list.status === 200) {
      const rows = (list.body.data?.requests ?? []) as Array<{ user_code: string; agent_name: string; status: string }>;
      lastSeen = JSON.stringify(rows.map(r => `${r.agent_name}:${r.status}`));
      const row = rows.find(r => r.agent_name === agentName);
      if (row) {
        const ok = await json('/v1/agents/verify', {
          method: 'POST',
          body: JSON.stringify({ user_code: row.user_code, action: 'approve', owner_token: ownerToken }),
        });
        assert(ok.status === 200 && ok.body.ok === true, `approve: ${ok.status} ${JSON.stringify(ok.body.error)}`);
        return row.user_code;
      }
    }
    await sleep(300);
  }
  throw new Error(`no pending device request for "${agentName}" within ${timeoutMs}ms (saw ${lastSeen})`);
}

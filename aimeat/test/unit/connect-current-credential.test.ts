/**
 * @file connect-current-credential.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector sends a CURRENT credential, and a dead one is not sent again every few
 *   seconds (production refusal log, L-3).
 *
 *   What was seen: one address sent one expired bearer to `POST /v1/memory` and
 *   `POST /v1/agents/<name>/tasks/<id>/event` every few seconds, user agent `node`. The sender was
 *   `aimeat connect call`, which a crew runs every five seconds for its live status while a task
 *   runs. Each run is a new process that took the stored bearer BY VALUE, even for an agent that
 *   had moved onto a key, and no run knew the one before it had been refused.
 *
 *   Measured here against a stub node on loopback that answers 401 to the dead bearer and mints on
 *   the key door, so the numbers are requests that reached a server:
 *     1. a dead bearer reaches the node once across ten runs, not ten times;
 *     2. an agent with a key sends a credential minted from it, never the stray bearer;
 *     3. with a live serve daemon for the agent, the run goes through the daemon with its secret;
 *     4. a task runner's child gets a current credential and the connector home.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-current-credential.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (L-3).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { stringify as yamlStringify } from 'yaml';

// THE HOME IS SET BEFORE THE CONNECTOR IS LOADED: config.ts reads AIMEAT_HOME into a module-level
// constant on first import.
const home = mkdtempSync(join(tmpdir(), 'aimeat-credential-'));
process.env.AIMEAT_HOME = home;

const NODE_ID = 'aimeat-test-001-a';
const GAII = `reporter#alice@${NODE_ID}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A bearer shaped like the node's (its `sub` is the GAII, which is how the loader places it), long expired. */
const DEAD = `${b64({ alg: 'EdDSA' })}.${b64({ sub: GAII, exp: 1 })}.sig`;

interface Seen { method: string; path: string; auth: string }
const toNode: Seen[] = [];
const toDaemon: Seen[] = [];
let mints = 0;

function answer(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The node: a key mints, the dead bearer gets 401 TOKEN_EXPIRED, anything else is accepted. */
const node: Server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    toNode.push({ method: req.method ?? '', path: req.url ?? '', auth: String(req.headers.authorization ?? '') });
    if (req.url === '/v1/agents/v2/token') { mints++; answer(res, 200, { access_token: `fresh-${mints}`, expires_in: 3600 }); return; }
    if (req.headers.authorization === `Bearer ${DEAD}`) { answer(res, 401, { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }); return; }
    answer(res, 200, { ok: true, data: { key: 'k' } });
  });
});

/** A serve daemon's loopback door, as far as `/local/call` goes: only its own secret gets in. */
const daemon: Server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    toDaemon.push({ method: req.method ?? '', path: req.url ?? '', auth: String(req.headers.authorization ?? '') });
    if (req.headers.authorization !== 'Bearer loop-secret') { answer(res, 401, { ok: false, error: { code: 'LOOPBACK_SECRET_REQUIRED', message: 'no' } }); return; }
    answer(res, 200, { ok: true, data: { via: 'daemon' } });
  });
});

let nodeUrl = '';
let daemonPort = 0;

async function listen(s: Server): Promise<number> {
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  return (s.address() as AddressInfo).port;
}

/** A connector home for reporter@alice: its dead bearer, a key when asked for, and its settings. */
async function layHome(opts: { bearer?: string; key?: boolean }): Promise<void> {
  mkdirSync(join(home, 'agents', 'alice', 'reporter'), { recursive: true });
  writeFileSync(join(home, 'agents', 'alice', 'reporter', 'config.yaml'), yamlStringify({ node_url: nodeUrl }), 'utf-8');
  if (opts.bearer) {
    mkdirSync(join(home, 'tokens'), { recursive: true });
    writeFileSync(join(home, 'tokens', 'reporter@alice.token'), opts.bearer, 'utf-8');
  }
  if (opts.key) {
    const { generateAgentKey } = await import('../../src/cli/connect/agent-key.js');
    const key = await generateAgentKey();
    mkdirSync(join(home, 'keys'), { recursive: true });
    writeFileSync(join(home, 'keys', 'reporter@alice.key'), JSON.stringify({ ...key, gaii: GAII, nodeId: NODE_ID }), 'utf-8');
  }
}

/** One `aimeat connect call`, as a fresh process would run it: modules loaded anew each time. */
async function connectCall(): Promise<{ exitCode: number; out: string; err: string }> {
  vi.resetModules();
  const { runToolCall } = await import('../../src/cli/connect/tool-call.js');
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  process.exitCode = 0;
  try {
    await runToolCall('aimeat_memory_write', { agent: 'reporter', json: '{"key":"live.status","value":{"state":"running"}}' });
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

beforeAll(async () => {
  nodeUrl = `http://127.0.0.1:${await listen(node)}`;
  daemonPort = await listen(daemon);
});

beforeEach(() => {
  for (const name of readdirSync(home)) rmSync(join(home, name), { recursive: true, force: true });
  toNode.length = 0;
  toDaemon.length = 0;
});

afterAll(async () => {
  await new Promise<void>(resolve => node.close(() => resolve()));
  await new Promise<void>(resolve => daemon.close(() => resolve()));
  delete process.env.AIMEAT_HOME;
  try { rmSync(home, { recursive: true, force: true }); } catch { /* the temp dir outlives the run at worst */ }
});

describe('aimeat connect call sends a current credential, and a dead one once (L-3)', () => {
  it('sends a dead stored bearer to the node once across ten runs, and says why it stopped', async () => {
    await layHome({ bearer: DEAD });
    let last = { exitCode: 0, out: '', err: '' };
    for (let run = 0; run < 10; run++) last = await connectCall();
    const refused = toNode.filter(s => s.path === '/v1/memory' && s.auth === `Bearer ${DEAD}`);
    expect(refused).toHaveLength(1);
    expect(last.exitCode).toBe(1);
    expect(last.err).toContain('CREDENTIAL_REFUSED');
  });

  it('sends a credential minted from the key, never the stray bearer beside it', async () => {
    await layHome({ bearer: DEAD, key: true });
    const r = await connectCall();
    expect(toNode.some(s => s.auth === `Bearer ${DEAD}`)).toBe(false);
    const writes = toNode.filter(s => s.path === '/v1/memory');
    expect(writes).toHaveLength(1);
    expect(writes[0].auth).toMatch(/^Bearer fresh-\d+$/);
    expect(r.exitCode).toBe(0);
  });

  it('goes through the live serve daemon for the agent, with the daemon\'s secret', async () => {
    await layHome({ bearer: DEAD, key: true });
    writeFileSync(join(home, 'serve.json'), JSON.stringify({
      schema_version: 3, port: daemonPort, pid: process.pid, secret: 'loop-secret', started_at: new Date().toISOString(),
      principals: [{ type: 'agent', id: GAII, owner: 'alice', node_url: nodeUrl, transport: 'tunnel' }],
      agents: [{ agent: 'reporter', gaii: GAII, owner: 'alice', node_url: nodeUrl, transport: 'tunnel' }],
    }), 'utf-8');
    const r = await connectCall();
    expect(r.exitCode).toBe(0);
    expect(toDaemon).toHaveLength(1);
    expect(toDaemon[0].path).toBe(`/local/call/aimeat_memory_write?agent=${encodeURIComponent(GAII)}`);
    expect(toDaemon[0].auth).toBe('Bearer loop-secret');
    expect(toNode).toHaveLength(0);
  });

  it('gives a task runner\'s child a current credential and the connector home', async () => {
    await layHome({ bearer: DEAD, key: true });
    vi.resetModules();
    const { launchTaskRunner } = await import('../../src/cli/connect/task-runner.js');
    const posted: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: async (path: string, body: unknown) => { posted.push({ path, body }); return { ok: true }; },
      getBaseUrl: () => nodeUrl,
      getTokenValue: () => DEAD,   // what the daemon's client was built with: the stray bearer
    };
    const script = 'process.stdout.write(JSON.stringify({ token: process.env.AIMEAT_TOKEN, home: process.env.AIMEAT_HOME }))';
    await launchTaskRunner({
      gaii: GAII, agent: 'reporter', owner: 'alice', client,
      config: { node_url: nodeUrl, runner: { command: process.execPath, args: ['-e', script], cwd: tmpdir() } },
    } as never, { id: 'task-1', title: 'report' });
    let done: { path: string; body: unknown } | undefined;
    for (let i = 0; i < 100 && !done; i++) {
      done = posted.find(p => p.path.endsWith('/complete'));
      if (!done) await new Promise(r => setTimeout(r, 100));
    }
    expect(done, 'the runner never completed the task').toBeDefined();
    const seenByChild = JSON.parse((done!.body as { message: string }).message) as { token?: string; home?: string };
    expect(seenByChild.token).toMatch(/^fresh-\d+$/);
    expect(seenByChild.home).toBe(home);
  });
});

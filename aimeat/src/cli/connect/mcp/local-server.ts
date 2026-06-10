/**
 * @file local-server.ts
 * @description Loopback serve daemon for `aimeat connect serve --http` (Phase 4
 *   of the Connector Forward Tunnel). Holds ONE persistent tunnel WS per agent
 *   to its AIMEAT node and exposes everything a local crew needs on
 *   `127.0.0.1:<ephemeral>`:
 *     - `/v1/mcp` — local Streamable-HTTP MCP endpoint (fresh McpServer per
 *       session, same tool surface as stdio serve; no auth — the loopback bind
 *       is the trust boundary).
 *     - `ALL /v1/*` — REST proxy: method/path/query/body forwarded over the
 *       agent's tunnel (`X-Aimeat-Agent` header picks the agent; defaults to
 *       the registry's primary). Falls back to direct HTTP when degraded.
 *     - `GET /local/tasks/next?wait=ms[&agent=name]` — long-poll fed by the
 *       tunnel's `deliver`/`backlog` frames: realtime task delivery for
 *       synchronous clients, no upstream polling.
 *     - `GET /local/status`, `POST /local/shutdown` — introspection + clean stop.
 *   Writes the discovery file `<AIMEAT_HOME>/serve.json` (schema_version, port,
 *   pid, agents, started_at) atomically on start, removes it on clean exit, and
 *   stale-detects a previous daemon by pid.
 *
 *   Graceful degradation: if an agent's node has the tunnel disabled / too old
 *   (`unsupported`/`unreachable`), that agent keeps the direct-fetch transport
 *   and the legacy upstream poll loop. `auth_failed` surfaces the
 *   "Run: aimeat connect" guidance and starts nothing (a dead token must not
 *   hot-loop). With the tunnel online there is NO upstream poll: `deliver`/
 *   `backlog` drive the same wake adapter + task-runner hook the poller used.
 * @structure
 *   - AgentChannel — per-agent push state: task queue + long-poll waiters,
 *     seen-id dedup (live deliver vs backlog), wake/task-runner dispatch.
 *   - runServeDaemon() — tunnel startup per agent, Express loopback server,
 *     discovery-file lifecycle, signal handling.
 * @usage Called by mcp/server.ts `runServe()` when `--http`/`--daemon` is set.
 * @version-history
 *   v1.0.0 — 2026-06-10 — Phase 4: initial loopback daemon (local MCP + REST
 *     proxy + long-poll push surface + discovery file + degraded fallback).
 */
import express, { type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, renameSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ConnectTunnelClient } from '../tunnel-client.js';
import { getToken } from '../keychain.js';
import { getConfigDir } from '../config.js';
import type { AgentRegistry, RegisteredAgent } from '../agent-registry.js';
import { wakeAgent } from './wakeup.js';
import { startPollerForAgent, legacyWakeAdapter } from './poller.js';
import { launchTaskRunner, isRunner } from '../task-runner.js';

export const SERVE_DISCOVERY_SCHEMA_VERSION = 1;

export interface ServeDiscoveryAgent {
  agent: string;
  owner: string;
  node_url: string;
  /** How this agent's API calls reach the node right now. */
  transport: 'tunnel' | 'direct' | 'auth_failed';
}

export interface ServeDiscovery {
  schema_version: number;
  port: number;
  pid: number;
  agents: ServeDiscoveryAgent[];
  started_at: string;
}

export function serveDiscoveryPath(): string {
  return join(getConfigDir(), 'serve.json');
}

interface QueuedTask {
  task: Record<string, unknown>;
  via: 'deliver' | 'backlog';
  receivedAt: string;
}

type Waiter = (item: QueuedTask | null) => void;

/**
 * Per-agent push state. Fed by the tunnel's `deliver` (live) and `backlog`
 * (on-connect snapshot) frames; tasks are deduped by id across both sources so
 * a live-pushed-then-backlogged task fires the wake/runner/long-poll exactly
 * once per daemon lifetime. (Storage stays the source of truth — a consumer
 * that missed a long-poll window can always list tasks via the REST proxy.)
 */
class AgentChannel {
  transportMode: ServeDiscoveryAgent['transport'] = 'direct';
  tunnel: ConnectTunnelClient | null = null;
  private seenTaskIds = new Set<string>();
  private seenMessageIds = new Set<string>();
  private queue: QueuedTask[] = [];
  private waiters: Waiter[] = [];

  constructor(readonly entry: RegisteredAgent) {}

  handleTask(payload: unknown, via: QueuedTask['via']): void {
    const task = payload as Record<string, unknown> | null;
    const id = typeof task?.id === 'string' ? task.id : null;
    if (!task || !id || this.seenTaskIds.has(id)) return;
    this.seenTaskIds.add(id);

    // Same side effects the poll loop used to produce on a new queued task.
    void wakeAgent(legacyWakeAdapter(this.entry), 'task_new', `task ${id} via ${via}`);
    if (isRunner(this.entry)) {
      launchTaskRunner(this.entry, {
        id,
        title: typeof task.title === 'string' ? task.title : undefined,
        description: typeof task.description === 'string' ? task.description : undefined,
      }).catch(err => {
        console.error(`[serve:${this.entry.agent}] runner launch failed for ${id}: ${(err as Error).message}`);
      });
    }

    const item: QueuedTask = { task, via, receivedAt: new Date().toISOString() };
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.queue.push(item);
  }

  handleMessages(messages: unknown[]): void {
    let fresh = 0;
    for (const m of messages) {
      const id = typeof (m as { id?: unknown })?.id === 'string' ? (m as { id: string }).id : null;
      if (!id || this.seenMessageIds.has(id)) continue;
      this.seenMessageIds.add(id);
      fresh++;
    }
    if (fresh > 0) {
      void wakeAgent(legacyWakeAdapter(this.entry), 'message_new', `${fresh} new message(s)`);
    }
  }

  /** Long-poll: next undelivered task, or null after `waitMs` with none. */
  nextTask(waitMs: number): Promise<QueuedTask | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise<QueuedTask | null>((resolve) => {
      const waiter: Waiter = (item) => { clearTimeout(timer); resolve(item); };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, waitMs);
      this.waiters.push(waiter);
    });
  }

  drainWaiters(): void {
    for (const w of this.waiters.splice(0)) w(null);
  }
}

export interface ServeDaemonOptions {
  registry: AgentRegistry;
  /** Fresh, fully tool-registered MCP server (one per Streamable-HTTP session). */
  buildMcp: () => McpServer;
}

/** Is the pid recorded in an existing discovery file still alive? */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function runServeDaemon(opts: ServeDaemonOptions): Promise<void> {
  const { registry, buildMcp } = opts;
  const discoveryFile = serveDiscoveryPath();

  // Stale-detect: a live daemon owns the discovery file; a dead pid is overwritten.
  if (existsSync(discoveryFile)) {
    try {
      const prev = JSON.parse(readFileSync(discoveryFile, 'utf-8')) as ServeDiscovery;
      if (prev.pid && prev.pid !== process.pid && pidAlive(prev.pid)) {
        console.error(`Another serve daemon appears to be running (pid ${prev.pid}, port ${prev.port}).`);
        console.error(`Stop it first, or delete ${discoveryFile} if it is stale.`);
        process.exit(1);
      }
    } catch { /* unreadable file — treat as stale and overwrite */ }
  }

  const startedAt = new Date().toISOString();
  const channels = new Map<string, AgentChannel>();

  // ── One tunnel client per agent, with graceful degradation ──
  for (const entry of registry.list()) {
    const ch = new AgentChannel(entry);
    channels.set(entry.agent, ch);

    const tunnel = new ConnectTunnelClient({
      nodeUrl: entry.config.node_url,
      getToken: () => getToken(entry.agent, entry.owner),
      label: `tunnel:${entry.agent}`,
      onDeliver: (kind, payload) => {
        if (kind === 'task_assigned') ch.handleTask(payload, 'deliver');
      },
      onBacklog: ({ tasks, messages }) => {
        for (const t of tasks) ch.handleTask(t, 'backlog');
        ch.handleMessages(messages);
      },
      onAuthFailure: () => {
        // Token died mid-session: fall back to direct fetch so already-running
        // tool calls fail with the node's own 401 (clear guidance) instead of
        // "Tunnel not connected".
        ch.transportMode = 'auth_failed';
        entry.client.setTransport(null);
      },
    });

    const outcome = await tunnel.start();
    if (outcome === 'online') {
      ch.tunnel = tunnel;
      ch.transportMode = 'tunnel';
      entry.client.setTransport({ request: (m, p, o) => tunnel.forward(m, p, o ?? {}) });
      console.error(`[serve] ${entry.agent}@${entry.owner}: tunnel online — API + realtime delivery over one WS (no upstream polling)`);
    } else if (outcome === 'auth_failed') {
      ch.transportMode = 'auth_failed';
      // Guidance already printed by the tunnel client; do NOT start a poller —
      // it would hot-fail against the same dead credential.
    } else {
      ch.transportMode = 'direct';
      console.error(`[serve] ${entry.agent}@${entry.owner}: tunnel ${outcome} — degraded to direct HTTP + poll loop`);
      startPollerForAgent(entry);
    }
  }

  // ── Loopback HTTP server ──
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const resolveAgent = (req: Request): RegisteredAgent => {
    const header = req.headers['x-aimeat-agent'];
    const q = req.query.agent;
    const name = (typeof header === 'string' && header)
      || (typeof q === 'string' && q)
      || undefined;
    return registry.resolve(name || undefined);
  };

  // ── Local MCP (Streamable HTTP) — mirrors the node's session plumbing, no auth ──
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
      return;
    }
    if (sessionId) {
      const body = req.body;
      const method = Array.isArray(body) ? body[0]?.method : body?.method;
      if (method !== 'initialize') {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Session not found. Please re-initialize.' },
          id: (Array.isArray(body) ? body[0]?.id : body?.id) ?? null,
        });
        return;
      }
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `local-${randomBytes(16).toString('hex')}`,
    });
    const mcp = buildMcp();
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await mcp.connect(transport);
    await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
    if (transport.sessionId) transports.set(transport.sessionId, transport);
  });

  app.get('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });

  app.delete('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transports.get(sessionId)!.close();
    transports.delete(sessionId);
    res.status(200).json({ closed: true });
  });

  // ── Push surface: long-poll fed by deliver/backlog (realtime, no spin) ──
  app.get('/local/tasks/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const rawWait = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    const waitMs = Math.min(Math.max(Number.isFinite(rawWait) ? rawWait : 25_000, 0), 120_000);
    const item = await channels.get(entry.agent)!.nextTask(waitMs);
    if (!item) { res.status(204).end(); return; }
    res.json({
      ok: true,
      data: { agent: entry.agent, owner: entry.owner, via: item.via, received_at: item.receivedAt, task: item.task },
    });
  });

  app.get('/local/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      data: {
        pid: process.pid,
        started_at: startedAt,
        agents: registry.list().map(e => ({
          agent: e.agent,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.agent)!.transportMode,
          tunnel_status: channels.get(e.agent)!.tunnel?.getStatus() ?? null,
        })),
      },
    });
  });

  app.post('/local/shutdown', (_req: Request, res: Response) => {
    res.json({ ok: true, data: { stopping: true } });
    setTimeout(() => { void shutdown(0); }, 50);
  });

  // ── REST proxy: everything else under /v1 funnels into the tunnel ──
  app.all('/v1/*splat', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const ch = channels.get(entry.agent)!;

    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (k === 'agent') continue; // local routing parameter, not for the node
      query[k] = Array.isArray(v) ? String(v[0]) : String(v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      && req.body !== undefined && req.body !== null
      && (typeof req.body !== 'object' || Object.keys(req.body as object).length > 0);
    const body = hasBody ? req.body : undefined;

    try {
      if (ch.tunnel?.isOnline()) {
        const r = await ch.tunnel.forward(req.method, req.path, { query, body });
        res.status(r.status).json(r.body);
        return;
      }
      // Degraded (or tunnel mid-reconnect): direct HTTP with the stored token.
      const url = new URL(entry.config.node_url.replace(/\/+$/, '') + req.path);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const token = await getToken(entry.agent, entry.owner);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Connection: 'close' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const r = await fetch(url, { method: req.method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const text = await r.text();
      let parsed: unknown;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      res.status(r.status).json(parsed);
    } catch (err) {
      res.status(502).json({ ok: false, error: { code: 'PROXY_ERROR', message: (err as Error).message } });
    }
  });

  // ── Start, write discovery, wire shutdown ──
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;

  const writeDiscovery = (): void => {
    const doc: ServeDiscovery = {
      schema_version: SERVE_DISCOVERY_SCHEMA_VERSION,
      port,
      pid: process.pid,
      started_at: startedAt,
      agents: registry.list().map(e => ({
        agent: e.agent,
        owner: e.owner,
        node_url: e.config.node_url,
        transport: channels.get(e.agent)!.transportMode,
      })),
    };
    mkdirSync(getConfigDir(), { recursive: true });
    const tmp = `${discoveryFile}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    renameSync(tmp, discoveryFile); // atomic replace on the same volume
  };
  writeDiscovery();

  let shuttingDown = false;
  async function shutdown(code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try { if (existsSync(discoveryFile)) unlinkSync(discoveryFile); } catch { /* best effort */ }
    for (const ch of channels.values()) {
      ch.drainWaiters();
      try { await ch.tunnel?.close(); } catch { /* ignore */ }
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 1_000);
      server.close(() => { clearTimeout(t); resolve(); });
    });
    process.exit(code);
  }
  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });

  const tunnelCount = [...channels.values()].filter(c => c.transportMode === 'tunnel').length;
  const summary = registry.list()
    .map(e => `${e.agent}@${e.owner} [${channels.get(e.agent)!.transportMode}]`)
    .join(', ');
  console.error(`AIMEAT serve daemon listening on http://127.0.0.1:${port} (MCP: /v1/mcp, proxy: /v1/*, push: /local/tasks/next)`);
  console.error(`[serve] discovery: ${discoveryFile}`);
  console.error(`[serve] ${registry.size()} agent(s): ${summary} — ${tunnelCount} over tunnel`);
}

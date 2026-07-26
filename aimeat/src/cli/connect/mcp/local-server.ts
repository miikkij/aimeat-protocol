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
 *     - `POST /local/call/:tool` — deterministic shell-callable tool dispatch
 *       (same registry as `aimeat connect call`) routed over the agent's
 *       tunnel-backed client; one loopback POST, no subprocess / fresh TLS.
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
 *   v1.1.0 — 2026-06-10 — Add `POST /local/call/:tool` — deterministic
 *     shell-callable tool dispatch over the tunnel (kills `connect call`
 *     subprocess + per-call TLS churn for plain-Python crews).
 *   v1.2.0 — 2026-06-22 — P1 record push: `POST /local/subscribe` (register record-push spaces, held
 *     + re-sent on reconnect via tunnel onConnect) + `GET /local/records/next` (long-poll on a queue
 *     SEPARATE from tasks, so record wakes never intermix with real tasks). `workspace.record` delivers
 *     route to the new queue; `/local/status` exposes per-agent subscriptions + reconnect count (the
 *     consumer's catch-up signal).
 *   v1.3.0 — 2026-06-22 — P3 cancellation push: `task.cancelled` delivers populate a per-agent
 *     cancelled-set, exposed at `GET /local/cancelled` so the daemon checks a loopback set instead of
 *     scanning owner-scoped `agents.cancel.*` memory before every dispatch.
 *   v1.4.0 — 2026-07-12 — Unified wake: `GET /local/wake/next` resolves the instant ANY push source
 *     (task/record/dm/message) arrives, without consuming — a pure signal so the woken daemon drains
 *     each queue as usual. Lets a multi-source agent (records+tasks, dms+tasks, …) wake on EVERY source
 *     instead of only its single parked queue (the per-queue `/next` endpoints stay for older daemons).
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
import { CONNECT_CLI_TOOLS } from '../tool-call.js';
import { logger } from '../../../utils/logger.js';

export const SERVE_DISCOVERY_SCHEMA_VERSION = 1;

export interface ServeDiscoveryAgent {
  agent: string;
  owner: string;
  node_url: string;
  /** How this agent's API calls reach the node right now. */
  transport: 'tunnel' | 'direct' | 'auth_failed';
}

/**
 * Neutral principal entry (connector profile §2.1) — covers both agent (GAII) and ecosystem (GEAI)
 * principals. `id` is the full identity (`agent#owner@node` or `eco:{app}#{owner}@{node}`).
 */
export interface ServeDiscoveryPrincipal {
  type: 'agent' | 'ecosystem';
  id: string;
  owner: string;
  node_url: string;
  transport: 'tunnel' | 'direct' | 'auth_failed';
}

export interface ServeDiscovery {
  schema_version: number;
  port: number;
  pid: number;
  /** Neutral principal list (agents + ecosystem apps). Prefer this over `agents`. */
  principals: ServeDiscoveryPrincipal[];
  /** Transitional alias of the agent-typed principals — kept so existing sidecars keep working. */
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

/** A workspace record-change event pushed over the tunnel (`workspace.record` deliver). */
interface QueuedRecord { event: Record<string, unknown>; receivedAt: string }
type RecordWaiter = (item: QueuedRecord | null) => void;

/** One (organism, ws, space) the agent subscribes to for record push. */
interface SpaceRef { organism_id: string; ws: string; space: string }

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
  /** Tunnel (re)connect count (mirrors the client's connectCount). A consumer that sees this change
   *  between cycles knows the socket reconnected and does its one catch-up read (record push is
   *  per-socket; events during the disconnect window are not replayed). */
  reconnects = 0;
  private seenTaskIds = new Set<string>();
  private seenMessageIds = new Set<string>();
  private queue: QueuedTask[] = [];
  private waiters: Waiter[] = [];
  private recordQueue: QueuedRecord[] = [];
  private recordWaiters: RecordWaiter[] = [];
  private dmQueue: QueuedRecord[] = [];
  private dmWaiters: RecordWaiter[] = [];
  /** One-shot waiters for the unified /local/wake/next signal (see nextWake/signalWake). */
  private wakeWaiters: Array<(woke: boolean) => void> = [];
  /** Task ids the node pushed as cancelled (P3) — checked by the daemon instead of polling the
   *  owner-scoped `agents.cancel.*` memory before every dispatch. Bounded by a daemon's task volume. */
  private cancelledIds = new Set<string>();
  /** Spaces the agent asked to subscribe to — held so the daemon re-sends them on each reconnect. */
  private subscriptions: SpaceRef[] = [];

  constructor(readonly entry: RegisteredAgent) {}

  setSubscriptions(spaces: SpaceRef[]): void { this.subscriptions = spaces; }
  getSubscriptions(): SpaceRef[] { return this.subscriptions; }

  /** Record a pushed task cancellation (P3 `task.cancelled` deliver). */
  handleCancelled(payload: unknown): void {
    const id = (payload as { id?: unknown })?.id;
    if (typeof id === 'string' && id) this.cancelledIds.add(id);
  }
  getCancelledIds(): string[] { return [...this.cancelledIds]; }

  /** A `workspace.record` event arrived — surface it on the record long-poll (no dedup: each write
   *  is a distinct wake; storage stays the source of truth for content via an authorized read). */
  handleRecord(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const item: QueuedRecord = { event: payload as Record<string, unknown>, receivedAt: new Date().toISOString() };
    const waiter = this.recordWaiters.shift();
    if (waiter) waiter(item);
    else this.recordQueue.push(item);
    this.signalWake();
  }

  /** Long-poll: next undelivered record event, or null after `waitMs` with none. */
  nextRecord(waitMs: number): Promise<QueuedRecord | null> {
    const queued = this.recordQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise<QueuedRecord | null>((resolve) => {
      const waiter: RecordWaiter = (item) => { clearTimeout(timer); resolve(item); };
      const timer = setTimeout(() => {
        const i = this.recordWaiters.indexOf(waiter);
        if (i >= 0) this.recordWaiters.splice(i, 1);
        resolve(null);
      }, waitMs);
      this.recordWaiters.push(waiter);
    });
  }

  /** A `dm.inbound` event arrived — surface it on the DM long-poll. Separate queue from tasks/records so
   *  federated-inbox wakes never intermix with task or workspace-record wakes (same philosophy as records).
   *  No dedup: each DM is a distinct wake; full body/attachments are read via aimeat_dm_thread. */
  handleDm(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const item: QueuedRecord = { event: payload as Record<string, unknown>, receivedAt: new Date().toISOString() };
    const waiter = this.dmWaiters.shift();
    if (waiter) waiter(item);
    else this.dmQueue.push(item);
    this.signalWake();
  }

  /** Long-poll: next undelivered DM event, or null after `waitMs` with none. */
  nextDm(waitMs: number): Promise<QueuedRecord | null> {
    const queued = this.dmQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise<QueuedRecord | null>((resolve) => {
      const waiter: RecordWaiter = (item) => { clearTimeout(timer); resolve(item); };
      const timer = setTimeout(() => {
        const i = this.dmWaiters.indexOf(waiter);
        if (i >= 0) this.dmWaiters.splice(i, 1);
        resolve(null);
      }, waitMs);
      this.dmWaiters.push(waiter);
    });
  }

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
    this.signalWake();
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
      // Also fire the unified wake so a daemon parked on /local/wake/next re-polls its inbox now
      // (messages have no drainable queue -- the wake just triggers the cycle's _poll_messages).
      this.signalWake();
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

  /** Fire every pending unified-wake signal. One-shot: a `nextWake` waiter is removed once resolved.
   *  Called whenever ANY push source arrives (task/record/dm/message) so a consumer parked on
   *  /local/wake/next wakes on all of them, not just its single queue. Purely a SIGNAL — it does not
   *  consume anything; the woken cycle drains each queue + re-lists tasks/messages as usual. */
  private signalWake(): void {
    for (const w of this.wakeWaiters.splice(0)) w(true);
  }

  /** True if any push queue already holds an undelivered item (task/record/dm). Lets `nextWake` return
   *  immediately when work is pending at park time (messages have no queue — only a live signal wakes). */
  hasPendingWake(): boolean {
    return this.queue.length > 0 || this.recordQueue.length > 0 || this.dmQueue.length > 0;
  }

  /** Unified long-poll SIGNAL: resolves true the instant any push source arrives (or was already
   *  pending), or false after `waitMs`. Unlike nextTask/nextRecord/nextDm it does NOT consume — the
   *  caller drains the individual queues. Lets a multi-source agent wake on every source. */
  nextWake(waitMs: number): Promise<boolean> {
    if (this.hasPendingWake()) return Promise.resolve(true);
    if (waitMs <= 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const w = (woke: boolean) => { clearTimeout(timer); resolve(woke); };
      const timer = setTimeout(() => {
        const i = this.wakeWaiters.indexOf(w);
        if (i >= 0) this.wakeWaiters.splice(i, 1);
        resolve(false);
      }, waitMs);
      this.wakeWaiters.push(w);
    });
  }

  drainWaiters(): void {
    for (const w of this.waiters.splice(0)) w(null);
    for (const w of this.recordWaiters.splice(0)) w(null);
    for (const w of this.dmWaiters.splice(0)) w(null);
    for (const w of this.wakeWaiters.splice(0)) w(false);
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
    // eslint-disable-next-line aimeat/no-silent-catch -- unreadable file — treat as stale and overwrite
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
        else if (kind === 'workspace.record') ch.handleRecord(payload);
        else if (kind === 'dm.inbound') ch.handleDm(payload);
        else if (kind === 'task.cancelled') ch.handleCancelled(payload);
      },
      onBacklog: ({ tasks, messages }) => {
        for (const t of tasks) ch.handleTask(t, 'backlog');
        ch.handleMessages(messages);
      },
      onConnect: (connectCount) => {
        // Per-socket subscriptions die with the old socket — re-send them after every (re)connect.
        ch.reconnects = connectCount;
        const subs = ch.getSubscriptions();
        if (subs.length) tunnel.subscribe(subs);
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

  // Event long-poll for ecosystem (GEAI) sidecars + any synchronous language (connector profile §2.3).
  // Same per-principal push channel as /local/tasks/next, shaped as an event: an AIMEAT→ecosystem
  // deliver payload is the event envelope, so `kind` comes from its `event` field.
  app.get('/local/events/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_PRINCIPAL', message: (err as Error).message } });
      return;
    }
    const rawWait = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    const waitMs = Math.min(Math.max(Number.isFinite(rawWait) ? rawWait : 25_000, 0), 120_000);
    const item = await channels.get(entry.agent)!.nextTask(waitMs);
    if (!item) { res.status(204).end(); return; }
    const payload = item.task as Record<string, unknown> | undefined;
    res.json({
      ok: true,
      data: { principal: entry.agent, owner: entry.owner, via: item.via, received_at: item.receivedAt, kind: (payload?.event as string) ?? null, payload },
    });
  });

  // ── Workspace record push (P1): subscribe + long-poll, on a queue SEPARATE from tasks ──
  // POST /local/subscribe { spaces:[{organism_id, ws, space}] } — register record-push subscriptions
  // for this agent. The daemon forwards a `subscribe` frame over the tunnel now (if online) and holds
  // the list so it re-subscribes automatically on every reconnect.
  app.post('/local/subscribe', (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const rawSpaces = Array.isArray((req.body as { spaces?: unknown })?.spaces) ? (req.body as { spaces: unknown[] }).spaces : [];
    const spaces: SpaceRef[] = [];
    for (const s of rawSpaces) {
      const r = s as Record<string, unknown>;
      if (typeof r?.organism_id === 'string' && typeof r?.ws === 'string' && typeof r?.space === 'string') {
        spaces.push({ organism_id: r.organism_id, ws: r.ws, space: r.space });
      }
    }
    const ch = channels.get(entry.agent)!;
    ch.setSubscriptions(spaces);
    ch.tunnel?.subscribe(spaces);
    res.json({ ok: true, data: { agent: entry.agent, subscribed: spaces.length, online: ch.transportMode === 'tunnel' } });
  });

  // GET /local/records/next?wait=ms[&agent=name] — long-poll for the next workspace record event.
  // Distinct from /local/tasks/next: a separate queue, so record wakes never intermix with real tasks.
  app.get('/local/records/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const rawWait = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    const waitMs = Math.min(Math.max(Number.isFinite(rawWait) ? rawWait : 25_000, 0), 120_000);
    const item = await channels.get(entry.agent)!.nextRecord(waitMs);
    if (!item) { res.status(204).end(); return; }
    res.json({
      ok: true,
      data: { agent: entry.agent, owner: entry.owner, received_at: item.receivedAt, reconnects: channels.get(entry.agent)!.reconnects, event: item.event },
    });
  });

  // GET /local/dm/next?wait=ms[&agent=name] — long-poll for the next federated-inbox `dm.inbound` wake.
  // Distinct queue from tasks + records (no intermixing). The wake carries a lightweight summary; read the
  // full body/attachments via aimeat_dm_thread(conversation_id) when the responder needs them.
  app.get('/local/dm/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const rawWait = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    const waitMs = Math.min(Math.max(Number.isFinite(rawWait) ? rawWait : 25_000, 0), 120_000);
    const item = await channels.get(entry.agent)!.nextDm(waitMs);
    if (!item) { res.status(204).end(); return; }
    res.json({
      ok: true,
      data: { agent: entry.agent, owner: entry.owner, received_at: item.receivedAt, reconnects: channels.get(entry.agent)!.reconnects, event: item.event },
    });
  });

  // GET /local/wake/next?wait=ms[&agent=name] — UNIFIED wake long-poll: resolves the instant ANY push
  // source (task / workspace-record / DM / message) arrives for this agent, or 204 after waitMs. Unlike
  // the per-queue /next endpoints it does NOT consume — it is a pure wake signal, so the woken daemon
  // then drains each queue (records/dm) and re-lists tasks/messages exactly as it does on a timeout.
  // This lets a multi-source agent (e.g. records+tasks like image-maker) wake on EVERY source instead of
  // only its single parked queue; older daemons keep using the per-queue endpoints, so this is additive.
  app.get('/local/wake/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const rawWait = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    const waitMs = Math.min(Math.max(Number.isFinite(rawWait) ? rawWait : 25_000, 0), 120_000);
    const woke = await channels.get(entry.agent)!.nextWake(waitMs);
    if (!woke) { res.status(204).end(); return; }
    res.json({ ok: true, data: { agent: entry.agent, owner: entry.owner, woke: true } });
  });

  // GET /local/cancelled?agent= — task ids the node has pushed as cancelled (P3). The daemon checks
  // this loopback set before a dispatch instead of scanning the owner-scoped `agents.cancel.*` memory.
  app.get('/local/cancelled', (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    res.json({ ok: true, data: { agent: entry.agent, cancelled: channels.get(entry.agent)!.getCancelledIds() } });
  });

  // ── Tool-call surface: deterministic shell-callable tool dispatch over the
  // tunnel. Same handler registry as `aimeat connect call`, but routed through
  // the agent's tunnel-backed client — one loopback POST, no per-call subprocess
  // and no fresh TLS per call. Body = the tool's JSON input (as `connect call
  // --json`); response = the AIMEAT envelope (callers check `ok`). Agent picked
  // by `X-Aimeat-Agent` / `?agent=` (defaults to the registry primary).
  app.post('/local/call/:tool', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const toolName = req.params.tool as string;
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === toolName);
    if (!tool) {
      res.status(404).json({ ok: false, error: { code: 'UNKNOWN_TOOL', message: `Unknown shell-callable tool: ${toolName}` } });
      return;
    }
    const input = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
      ? req.body as Record<string, unknown>
      : {};
    try {
      const response = await tool.handler({
        client: entry.client, // tunnel-backed in tunnel mode, direct fetch when degraded
        config: { node_url: entry.config.node_url, agent: entry.agent, owner: entry.owner },
        agentPath: encodeURIComponent(entry.agent),
      }, input);
      res.status(response.ok ? 200 : 400).json(response);
    } catch (err) {
      res.status(400).json({ ok: false, error: { code: 'TOOL_CALL_ERROR', message: (err as Error).message } });
    }
  });

  app.get('/local/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      data: {
        pid: process.pid,
        started_at: startedAt,
        principals: registry.list().map(e => ({
          type: e.agent.startsWith('eco:') ? 'ecosystem' : 'agent',
          id: e.agent,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.agent)!.transportMode,
          tunnel_status: channels.get(e.agent)!.tunnel?.getStatus() ?? null,
        })),
        agents: registry.list().map(e => ({
          agent: e.agent,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.agent)!.transportMode,
          tunnel_status: channels.get(e.agent)!.tunnel?.getStatus() ?? null,
          // Record-push: how many spaces the agent subscribed to, and the (re)connect count. A consumer
          // that sees `reconnects` increase between cycles does its one catch-up read (per-socket subs).
          subscriptions: channels.get(e.agent)!.getSubscriptions().length,
          reconnects: channels.get(e.agent)!.reconnects,
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
      // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
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
    const entries = registry.list();
    const doc: ServeDiscovery = {
      schema_version: SERVE_DISCOVERY_SCHEMA_VERSION,
      port,
      pid: process.pid,
      started_at: startedAt,
      // Neutral principal list — an `eco:`-prefixed id is type 'ecosystem', else 'agent'.
      principals: entries.map(e => ({
        type: e.agent.startsWith('eco:') ? 'ecosystem' as const : 'agent' as const,
        id: e.agent,
        owner: e.owner,
        node_url: e.config.node_url,
        transport: channels.get(e.agent)!.transportMode,
      })),
      // Transitional alias (agent-typed only) for sidecars that still read `agents`.
      agents: entries.filter(e => !e.agent.startsWith('eco:')).map(e => ({
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
    try { if (existsSync(discoveryFile)) unlinkSync(discoveryFile); } catch (err) { logger.warn('shutdown: best effort', { error: String(err) }); }
    for (const ch of channels.values()) {
      ch.drainWaiters();
      try { await ch.tunnel?.close(); } catch (err) { logger.warn('shutdown: ignore', { error: String(err) }); }
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
  console.error(`AIMEAT serve daemon listening on http://127.0.0.1:${port} (MCP: /v1/mcp, proxy: /v1/*, tool-call: /local/call/:tool, push: /local/tasks/next, wake: /local/wake/next)`);
  console.error(`[serve] discovery: ${discoveryFile}`);
  console.error(`[serve] ${registry.size()} agent(s): ${summary} — ${tunnelCount} over tunnel`);
}

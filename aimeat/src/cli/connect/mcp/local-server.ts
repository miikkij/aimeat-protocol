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
 *   v1.8.2 — 2026-09-02 — A long-poll that cannot name its agent is refused after a pause, not
 *     instantly. All four polls here began with a resolve whose failure answered 400 in under a
 *     millisecond, and every one of those failures is PERSISTENT (unknown agent, a bare name two
 *     owners share, no default among several accounts), so a caller looping on it spun at loopback
 *     speed forever. crewaimeat met the identical shape on their side and counted 14,627 abandoned
 *     polls. Pacing lives in ./local-poll-guard.ts, which also holds the one copy of the `?wait=`
 *     clamp these four had written out separately.
 *   v1.8.1 — 2026-09-01 — `/local/status` carries the SAME projection as serve.json. It holds a
 *     second copy of that shape, and when serve.json's `principals[].id` became the GAII the field
 *     was documented to be, this copy kept the bare agent name and its `agents[]` rows gained no
 *     `gaii`. Two owners each with a `concierge` were one indistinguishable row on the surface an
 *     operator reads. Found by running the two-owner daemon rather than by reading the diff.
 *   v1.8.0 — 2026-08-31 — An agent can join a RUNNING daemon. The startup loop's body is
 *     `attachRegistered()`, and the tunnel's `invoke` frame carries one capability the daemon
 *     answers itself — `aimeat.agents.enrol` — which generates a key per agent, submits signed
 *     cards over the socket it already holds, and calls `attachNewAgent()`. Adding an agent used to
 *     mean a restart, and a restart drops every other agent's socket: 49 of them, measured on
 *     production 2026-08-31. Credentials now come from `resolveToken()`, which mints for a v2 agent
 *     and reads the stored bearer for a v1 one, so neither call site has to know which it holds.
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
 *   v1.5.0 — 2026-08-02 — Build identity: startup announces which artifact is running and shouts when
 *     dist/ is older than the source it was built from; `/local/status` carries the same under `build`.
 *     Clients reach the node only through this daemon, so a stale dist silently drops newly-added
 *     fields — three separate hunts (outbound writes, inbound reads, `provider`) each ended here.
 *   v1.6.0 — 2026-08-17 — Edge-triggered wake: `nextWake` reads a wakeSeq/wakeSeen watermark instead
 *     of the queue lengths. The daemon lists tasks from the node store and never drains the local
 *     task queue, so the level check returned 200 forever after one push — a zero-length idle wait
 *     that cost ~56% of a core per affected agent and 28 req/s against the node from one stuck agent.
 *     AgentChannel is exported for the unit tests (serve-wake-watermark.test.ts).
 *   v1.7.0 — 2026-08-28 — Server-initiated `invoke` reaches a crew: the tunnel's `invoke` frame (the
 *     one ecosystem apps already answer) is queued per agent and offered on `GET /local/invoke/next`
 *     + `POST /local/invoke/:id/result` (./local-invoke.ts), the same long-poll shape as tasks,
 *     records and DMs. This is what lets the node ask a running crew to validate or try a crew
 *     definition without creating a task. AgentChannel moved to ./local-channel.ts (pure extraction,
 *     this file had reached the 800-line cap); re-exported here.
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
import { resolveToken } from '../agent-key.js';
import { getConfigDir, type AimeatPerAgentConfig } from '../config.js';
import { AimeatClient } from '../api-client.js';
import { handleEnrolOffer, ENROL_CAPABILITY } from '../enrolment.js';
import type { AgentRegistry, RegisteredAgent } from '../agent-registry.js';
import { displayName } from '../agent-registry.js';
import { startPollerForAgent } from './poller.js';
import { AgentChannel, type SpaceRef } from './local-channel.js';
import { InvokeChannel, registerLocalInvokeRoutes } from './local-invoke.js';
import { pollWaitMs, refuseUnknownAgent } from './local-poll-guard.js';
import { CONNECT_CLI_TOOLS } from '../tool-call.js';

// Re-exported so the unit test (serve-wake-watermark.test.ts) and any importer keep resolving
// after the class moved to ./local-channel.ts.
export { AgentChannel } from './local-channel.js';
import { logger } from '../../../utils/logger.js';
import { checkBuildFreshness, announceBuild, buildIdentity } from '../../../utils/build-stamp.js';

/**
 * 2 since 2026-09-01: `principals[].id` is the GAII it was always documented to be (it carried the
 * bare agent name instead), and every `agents[]` row gained a `gaii`. Two owners with one agent
 * name were one indistinguishable row before that, so the file described a daemon that does not
 * exist.
 */
export const SERVE_DISCOVERY_SCHEMA_VERSION = 2;

export interface ServeDiscoveryAgent {
  /** The bare name, kept for sidecars that read it. Not unique across owners — use `gaii`. */
  agent: string;
  /** `agent#owner@node`. The identity, and what tells two owners' `concierge` apart. */
  gaii: string;
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

  // Say what artifact this is BEFORE anything else, because clients reach the node only through
  // this daemon: when dist/ is behind the source, nothing errors — a field added in source is
  // simply absent from every write, and the search starts at the node.
  const freshness = checkBuildFreshness();
  announceBuild(freshness, line => console.error(line));

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
  // Keyed by GAII, not by name: two owners on one daemon both have `concierge`, and a name-keyed
  // map gave the second one the first one's channel. A task for alice's concierge reaching bob's
  // runtime is the failure that keying prevents.
  const channels = new Map<string, AgentChannel>();
  const invokeChannels = new Map<string, InvokeChannel>();

  /**
   * Give ONE agent its channel and its tunnel. Extracted from the startup loop so the same code
   * path serves an agent that arrives later: enrolment calls this on a running daemon, and nothing
   * else has to be restarted or rebuilt. That is the whole point of the extraction — adding an
   * agent used to mean a restart, and a restart drops every other agent's socket.
   */
  async function attachRegistered(entry: RegisteredAgent): Promise<void> {
    const ch = new AgentChannel(entry);
    channels.set(entry.gaii, ch);
    // Server-initiated invokes (Crew tab validate/try) queue here and are answered back over the
    // same socket. `tunnel` is assigned just below; the reply closure only runs after it exists.
    const inv = new InvokeChannel((id, ok, result) => tunnel.replyInvoke(id, ok, result));
    invokeChannels.set(entry.gaii, inv);

    const tunnel = new ConnectTunnelClient({
      nodeUrl: entry.config.node_url,
      // Not getToken(): a v2 agent has no stored bearer, it has a key and mints a credential per
      // use. resolveToken answers for both kinds, so this line does not have to know which it is.
      getToken: () => resolveToken(entry.agent, entry.owner, entry.config.node_url),
      label: `tunnel:${displayName(entry)}`,
      onInvoke: (frame) => {
        // The one capability the DAEMON answers itself rather than offering to a crew runtime:
        // taking on new agents. A crew cannot do it — it has no access to the keychain and no way
        // to add a tunnel — and queueing it would answer NO_HANDLER to an owner pressing a button.
        if (frame.capability === ENROL_CAPABILITY) {
          const id = frame.id;
          void handleEnrolOffer(frame.input, {
            forward: (m, p, o) => tunnel.forward(m, p, o),
            attach: (a) => attachNewAgent(a),
            version: freshness.stamp?.version ?? undefined,
          }).then(r => { if (id) tunnel.replyInvoke(id, r.ok, r.result); });
          return;
        }
        inv.handleInvoke(frame);
      },
      onDeliver: (kind, payload) => {
        if (kind === 'task_assigned') ch.handleTask(payload, 'deliver');
        else if (kind === 'workspace.record') ch.handleRecord(payload);
        // A published crew definition: the runtime parked on records/wake reads its key and reloads.
        else if (kind === 'crew.def_updated') ch.handleRecord(payload);
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

  /**
   * An agent the owner has just created and the node has just credentialled. Registered and attached
   * on the running daemon: no restart, and nobody else's socket is touched.
   *
   * Its client is built with NO baked token on purpose. A v2 agent's credential is short-lived and
   * comes from resolveToken(); a token frozen into the client at construction would be the exact
   * thing this identity model removes, and it would go stale in an hour.
   */
  async function attachNewAgent(a: { agent: string; owner: string; gaii: string; config: AimeatPerAgentConfig }): Promise<void> {
    // By GAII: another owner's agent of the same name is a different identity and must still attach.
    if (registry.get(a.gaii)) {
      console.error(`[serve] ${a.agent}@${a.owner}: already served, leaving it alone`);
      return;
    }
    const client = new AimeatClient(a.config.node_url);
    const entry: RegisteredAgent = { gaii: a.gaii, agent: a.agent, owner: a.owner, client, config: a.config };
    registry.add(entry);
    await attachRegistered(entry);
    writeDiscovery();
    console.error(`[serve] ${a.agent}@${a.owner}: attached without a restart (${registry.size()} agents served)`);
  }

  // ── One tunnel client per agent, with graceful degradation ──
  for (const entry of registry.list()) {
    await attachRegistered(entry);
  }

  // ── Loopback HTTP server ──
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  /**
   * Which identity this loopback call is for.
   *
   * `X-Aimeat-Agent` (or `?agent=`) may carry a BARE NAME, because that is what every existing
   * caller sends and nothing about them should have to change. The registry resolves it to one
   * identity when exactly one loaded agent has that name — every single-owner daemon, unchanged —
   * and REFUSES, naming both GAIIs, when two owners on this daemon share it. A caller that knows
   * exactly which it means may send the full GAII in the same header instead.
   */
  const resolveAgent = (req: Request): RegisteredAgent => {
    const header = req.headers['x-aimeat-agent'];
    const q = req.query.agent;
    const identifier = (typeof header === 'string' && header)
      || (typeof q === 'string' && q)
      || undefined;
    return registry.resolve(identifier || undefined);
  };

  // GET /local/invoke/next + POST /local/invoke/:id/result — the invoke surface (./local-invoke.ts).
  registerLocalInvokeRoutes(app, resolveAgent, invokeChannels);

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
    // The wait is read BEFORE the agent is resolved, because a refusal is paced by it too — see
    // local-poll-guard.ts for why an instant 400 here is a hot loop.
    const waitMs = pollWaitMs(req);
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) { await refuseUnknownAgent(res, err, waitMs); return; }
    const item = await channels.get(entry.gaii)!.nextTask(waitMs);
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
    const item = await channels.get(entry.gaii)!.nextTask(waitMs);
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
    const ch = channels.get(entry.gaii)!;
    ch.setSubscriptions(spaces);
    ch.tunnel?.subscribe(spaces);
    res.json({ ok: true, data: { agent: entry.agent, subscribed: spaces.length, online: ch.transportMode === 'tunnel' } });
  });

  // GET /local/records/next?wait=ms[&agent=name] — long-poll for the next workspace record event.
  // Distinct from /local/tasks/next: a separate queue, so record wakes never intermix with real tasks.
  app.get('/local/records/next', async (req: Request, res: Response) => {
    const waitMs = pollWaitMs(req);
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) { await refuseUnknownAgent(res, err, waitMs); return; }
    const item = await channels.get(entry.gaii)!.nextRecord(waitMs);
    if (!item) { res.status(204).end(); return; }
    res.json({
      ok: true,
      data: { agent: entry.agent, owner: entry.owner, received_at: item.receivedAt, reconnects: channels.get(entry.gaii)!.reconnects, event: item.event },
    });
  });

  // GET /local/dm/next?wait=ms[&agent=name] — long-poll for the next federated-inbox `dm.inbound` wake.
  // Distinct queue from tasks + records (no intermixing). The wake carries a lightweight summary; read the
  // full body/attachments via aimeat_dm_thread(conversation_id) when the responder needs them.
  app.get('/local/dm/next', async (req: Request, res: Response) => {
    const waitMs = pollWaitMs(req);
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) { await refuseUnknownAgent(res, err, waitMs); return; }
    const item = await channels.get(entry.gaii)!.nextDm(waitMs);
    if (!item) { res.status(204).end(); return; }
    res.json({
      ok: true,
      data: { agent: entry.agent, owner: entry.owner, received_at: item.receivedAt, reconnects: channels.get(entry.gaii)!.reconnects, event: item.event },
    });
  });

  // GET /local/wake/next?wait=ms[&agent=name] — UNIFIED wake long-poll: resolves the instant ANY push
  // source (task / workspace-record / DM / message) arrives for this agent, or 204 after waitMs. Unlike
  // the per-queue /next endpoints it does NOT consume — it is a pure wake signal, so the woken daemon
  // then drains each queue (records/dm) and re-lists tasks/messages exactly as it does on a timeout.
  // This lets a multi-source agent (e.g. records+tasks like image-maker) wake on EVERY source instead of
  // only its single parked queue; older daemons keep using the per-queue endpoints, so this is additive.
  app.get('/local/wake/next', async (req: Request, res: Response) => {
    const waitMs = pollWaitMs(req);
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) { await refuseUnknownAgent(res, err, waitMs); return; }
    const woke = await channels.get(entry.gaii)!.nextWake(waitMs);
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
    res.json({ ok: true, data: { agent: entry.agent, cancelled: channels.get(entry.gaii)!.getCancelledIds() } });
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
        build: buildIdentity(freshness),   // which artifact is answering — see utils/build-stamp.ts
        // The SAME projection serve.json carries, and it has to stay the same: this is a second
        // copy of one shape, and when serve.json's `id` became the GAII it was documented to be,
        // this copy was missed and kept the bare name. Two owners' `concierge` were one id here.
        principals: registry.list().map(e => ({
          type: e.agent.startsWith('eco:') ? 'ecosystem' : 'agent',
          id: e.gaii,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.gaii)!.transportMode,
          tunnel_status: channels.get(e.gaii)!.tunnel?.getStatus() ?? null,
        })),
        agents: registry.list().map(e => ({
          agent: e.agent,
          gaii: e.gaii,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.gaii)!.transportMode,
          tunnel_status: channels.get(e.gaii)!.tunnel?.getStatus() ?? null,
          // Record-push: how many spaces the agent subscribed to, and the (re)connect count. A consumer
          // that sees `reconnects` increase between cycles does its one catch-up read (per-socket subs).
          subscriptions: channels.get(e.gaii)!.getSubscriptions().length,
          reconnects: channels.get(e.gaii)!.reconnects,
          // Server-initiated invokes queued or being worked on, and whether a runtime is collecting them.
          invokes_pending: invokeChannels.get(e.gaii)?.pendingCount() ?? 0,
          invoke_handler: invokeChannels.get(e.gaii)?.hasHandler() ?? false,
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
    const ch = channels.get(entry.gaii)!;

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
      const token = await resolveToken(entry.agent, entry.owner, entry.config.node_url);
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
        // The FULL identity, which is what this field has always said it was. It carried the bare
        // name, so two owners' `concierge` were one row and the file described a daemon that does
        // not exist.
        id: e.gaii,
        owner: e.owner,
        node_url: e.config.node_url,
        transport: channels.get(e.gaii)!.transportMode,
      })),
      // Transitional alias (agent-typed only) for sidecars that still read `agents`.
      agents: entries.filter(e => !e.agent.startsWith('eco:')).map(e => ({
        agent: e.agent,
        gaii: e.gaii,
        owner: e.owner,
        node_url: e.config.node_url,
        transport: channels.get(e.gaii)!.transportMode,
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
      invokeChannels.get(ch.entry.gaii)?.drainWaiters();
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
    .map(e => `${e.agent}@${e.owner} [${channels.get(e.gaii)!.transportMode}]`)
    .join(', ');
  console.error(`AIMEAT serve daemon listening on http://127.0.0.1:${port} (MCP: /v1/mcp, proxy: /v1/*, tool-call: /local/call/:tool, push: /local/tasks/next, wake: /local/wake/next)`);
  console.error(`[serve] discovery: ${discoveryFile}`);
  console.error(`[serve] ${registry.size()} agent(s): ${summary} — ${tunnelCount} over tunnel`);
}

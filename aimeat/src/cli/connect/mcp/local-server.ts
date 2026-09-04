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
 *   2026-09-04 — Every call to the node goes through `ch.forward`, which carries the stamp naming
 *     whose call it is. The REST proxy and `/local/subscribe` called `ch.tunnel.forward()` and
 *     `subscribe()` bare, and on a shared socket a frame with no name is the OPENER's — so on a
 *     62-identity fleet one agent was right and sixty-one were attributed to it. Reads
 *     misattributed, writes too, and this path carries `DELETE /v1/memory/…`. An agent asking for
 *     its own tasks was refused as another agent and then served that agent's list. Found by
 *     crewaimeat-dev on a live fleet; nothing here had regressed, the ground moved when the socket
 *     became shared. → pitfalls §43
 *   2026-09-03 — One tunnel client per NODE, not per agent (./tunnel-hub.ts). /local/status reports
 *     each identity's own status rather than its socket's, which on a shared socket is not the
 *     same thing — a deleted agent read `online` until this.
 *   v1.10.0 — 2026-09-02 — An MCP session carries an IDENTITY. The 28 tool modules resolve an agent
 *     once, at registration time, with no identifier; with two owners each holding a default agent
 *     that resolve refuses, and the refusal arrived as an unhandled throw inside a tool module's
 *     constructor — so opening a session killed the daemon, and the wish was telling the runtime
 *     side to attach. `buildMcp` now takes a registry holding the ONE identity the session speaks
 *     as, resolved from the same `X-Aimeat-Agent` header every other loopback route reads. A
 *     session that names none while several are loaded is refused at connect time in the registry's
 *     own words. No tool module changes: the scoping is itself an AgentRegistry.
 *   v1.9.0 — 2026-09-02 — A deleted-and-recreated agent re-attaches without a daemon restart.
 *     `attachNewAgent` treated any registered GAII as "already served" and declined, so after a
 *     delete the daemon kept the dead credential and the new one had nowhere to go — a restart was
 *     the only way out, and a restart drops every other agent's socket. It now replaces an entry
 *     the NODE has refused (transportMode 'auth_failed', arrived at through auth_revoked — a
 *     verdict, not a liveness guess), via detachAgent() + AgentRegistry.remove().
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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ConnectTunnelClient, type TunnelIdentity } from '../tunnel-client.js';
import { TunnelHub, statusOfIdentity, principalRow } from './tunnel-hub.js';
import { resolveToken } from '../agent-key.js';
import { getConfigDir, type AimeatPerAgentConfig } from '../config.js';
import { AimeatClient } from '../api-client.js';
import { handleEnrolOffer, ENROL_CAPABILITY } from '../enrolment.js';
import { AgentRegistry, type RegisteredAgent } from '../agent-registry.js';
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

// The `serve.json` contract -- schema version, its two row shapes, where the file lives and
// whether the pid in an existing one is still alive -- is its own unit in ./local-discovery.ts:
// other processes read that file without importing this daemon. Re-exported so no importer moved.
export {
  SERVE_DISCOVERY_SCHEMA_VERSION, serveDiscoveryPath,
  type ServeDiscovery, type ServeDiscoveryAgent, type ServeDiscoveryPrincipal,
} from './local-discovery.js';
import { SERVE_DISCOVERY_SCHEMA_VERSION, serveDiscoveryPath, pidAlive, type ServeDiscovery } from './local-discovery.js';

export interface ServeDaemonOptions {
  registry: AgentRegistry;
  /**
   * Fresh, fully tool-registered MCP server (one per Streamable-HTTP session), built against the
   * registry the SESSION is scoped to — which holds exactly the one identity the session speaks as.
   *
   * The 28 tool modules call `registry.resolve()` once, at registration time, with no identifier.
   * That was harmless while a daemon served one owner. With two owners each holding a default
   * agent, resolve() refuses — correctly — and the refusal became an unhandled throw inside a tool
   * module's constructor, which killed the daemon the moment anyone opened a session.
   *
   * A session talking to a daemon that holds two owners is principal-shaped and has to say who it
   * is. That is the registry's own lesson one level up, and binding it here answers it once instead
   * of asking 28 modules to answer "as whom" on every call.
   */
  buildMcp: (sessionRegistry: AgentRegistry) => McpServer;
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
  /** One socket per node, shared by every identity on it. See ./tunnel-hub.ts. */
  const hubs = new TunnelHub();
  async function attachRegistered(entry: RegisteredAgent): Promise<void> {
    const ch = new AgentChannel(entry);
    channels.set(entry.gaii, ch);
    // Server-initiated invokes (Crew tab validate/try) queue here and are answered back over the
    // same socket. `tunnel` is assigned just below; the reply closure only runs after it exists.
    // Answered on whichever socket this identity ended up on, named so a shared one routes it.
    const inv = new InvokeChannel((id, ok, result) => ch.tunnel?.replyInvoke(id, ok, result, entry.gaii));
    invokeChannels.set(entry.gaii, inv);

    // THE WIRE THIS IDENTITY ENDS UP ON lives on the channel (`ch.forward`), filled in by whichever
    // branch below gets it a socket, and it is the ONLY way anything here talks to the node.
    //
    // It was a `let` in this function until 2026-09-04, and before that a `const` inside one branch:
    // `identity.onInvoke` closed over the `tunnel` declared in the NO-shared-socket branch, which
    // the shared path returns before reaching, so the binding sat in its temporal dead zone for the
    // daemon's life and every invoke threw `Cannot access 'tunnel' before initialization`. Enrolment
    // is an invoke, so the migration button failed for every agent on a shared socket — all of them,
    // since one-socket-per-node. → pitfalls §40
    //
    // It moved onto the channel because the REST proxy and the subscribe route, which are handlers
    // registered far below this function and could not see the `let` at all, each reached for
    // `ch.tunnel.forward()` instead and lost the stamp that says whose call it is. → pitfalls §43

    // What this identity needs from a socket, whichever socket it turns out to be. Built once and
    // handed either to the shared hub (as an attachment) or to a private client (as its options) —
    // the handlers are the same either way, which is the point: nothing below this line knows or
    // cares how many identities share the wire.
    const identity: TunnelIdentity = {
      gaii: entry.gaii,
      // Not getToken(): a v2 agent has no stored bearer, it has a key and mints a credential per
      // use. resolveToken answers for both kinds, so this line does not have to know which it is.
      getToken: () => resolveToken(entry.agent, entry.owner, entry.config.node_url),
      onInvoke: (frame) => {
        // The one capability the DAEMON answers itself rather than offering to a crew runtime:
        // taking on new agents. A crew cannot do it — it has no access to the keychain and no way
        // to add a tunnel — and queueing it would answer NO_HANDLER to an owner pressing a button.
        if (frame.capability === ENROL_CAPABILITY) {
          const id = frame.id;
          void handleEnrolOffer(frame.input, {
            // Never `tunnel` directly: see the note above. A refusal naming the missing wire beats
            // a TDZ ReferenceError, which reaches the owner's button as a stack-trace phrase.
            forward: (m, p, o) => {
              if (!ch.forward) throw new Error('This agent has no connection to the node yet.');
              return ch.forward(m, p, o ?? {});
            },
            attach: (a) => attachNewAgent(a),
            version: freshness.stamp?.version ?? undefined,
          }).then(r => { if (id) ch.tunnel?.replyInvoke(id, r.ok, r.result, entry.gaii); });
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
        if (subs.length) ch.tunnel?.subscribe(subs, entry.gaii);
      },
      onAuthFailure: () => {
        // Token died mid-session: fall back to direct fetch so already-running
        // tool calls fail with the node's own 401 (clear guidance) instead of
        // "Tunnel not connected".
        ch.transportMode = 'auth_failed';
        entry.client.setTransport(null);
      },
    };

    // THE SHARED SOCKET FIRST. `attach` costs one frame on a connection that already exists, and
    // on the way it removes the restart: the tunnel set used to be built from the registry at
    // startup, so taking on a new agent meant restarting the daemon and briefly dropping every
    // other agent it served (measured 2026-08-31, 49 of them).
    const joined = await hubs.join(entry, identity);
    if (joined) {
      ch.tunnel = joined.client;
      ch.transportMode = 'tunnel';
      // `joined.who` is what routes a frame to this identity on a socket someone else opened, and
      // it is undefined for the identity that opened it — which is why a call site that forgets the
      // stamp looks correct for exactly one agent out of however many share the socket.
      ch.forward = (m, pth, o) => joined.client.forward(m, pth, o ?? {}, joined.who);
      entry.client.setTransport({ request: (m, pth, o) => joined.client.forward(m, pth, o ?? {}, joined.who) });
      console.error(`[serve] ${entry.agent}@${entry.owner}: on the shared tunnel to ${entry.config.node_url} (${joined.client.identityCount()} identities, 1 socket)`);
      return;
    }

    // NO SHARED SOCKET: an older node, or an attach the node refused. One socket for this identity,
    // exactly as before this change — the degradation is per agent and nobody else notices.
    const tunnel = new ConnectTunnelClient({
      nodeUrl: entry.config.node_url,
      getToken: identity.getToken,
      label: `tunnel:${displayName(entry)}`,
      onInvoke: identity.onInvoke,
      onDeliver: identity.onDeliver,
      onBacklog: identity.onBacklog,
      onConnect: identity.onConnect,
      onAuthFailure: identity.onAuthFailure,
    });

    const outcome = await tunnel.start();
    if (outcome === 'online') {
      ch.tunnel = tunnel;
      ch.transportMode = 'tunnel';
      // No stamp here, and that is right: this socket carries this identity and nobody else, so the
      // node reads every frame on it as this agent's own.
      ch.forward = (m, p, o) => tunnel.forward(m, p, o ?? {});
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
  /**
   * Forget one identity: stop its tunnel and drop every per-agent map keyed by its GAII. Used when
   * the node has refused the credential we hold, so that the identity can be attached again with a
   * new one. Deliberately narrow — it touches nothing belonging to any other agent on this daemon.
   */
  function detachAgent(gaii: string): void {
    hubs.release(channels.get(gaii)?.tunnel, gaii);
    channels.delete(gaii);
    invokeChannels.delete(gaii);
    registry.remove(gaii);
  }

  async function attachNewAgent(a: { agent: string; owner: string; gaii: string; config: AimeatPerAgentConfig }): Promise<void> {
    // By GAII: another owner's agent of the same name is a different identity and must still attach.
    const already = registry.get(a.gaii);
    if (already) {
      // A LIVE entry is left alone, as before. A DEAD one is not the same thing, and treating the
      // two alike is what forced a daemon restart: delete an agent and recreate it under the same
      // name, and this guard saw the GAII, said "already served" and declined — so the daemon went
      // on holding the deleted agent's credential while the new one had nowhere to attach.
      // `auth_failed` is the node's own verdict, arrived at through the tunnel's auth_revoked; it
      // is not a liveness guess, so an idle or briefly disconnected agent never takes this branch.
      const dead = channels.get(a.gaii)?.transportMode === 'auth_failed';
      if (!dead) {
        console.error(`[serve] ${a.agent}@${a.owner}: already served, leaving it alone`);
        return;
      }
      console.error(`[serve] ${a.agent}@${a.owner}: replacing a credential the node has refused`);
      detachAgent(a.gaii);
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
    // WHO this session speaks as, decided here and refused here. The identifier comes from the
    // same header every other loopback route reads, so a client that already names its agent needs
    // no change; one that names none while several agents are loaded is told so at connect time,
    // in the registry's own words, naming the candidates. Before this the same refusal arrived as
    // an exception thrown inside a tool module's constructor and took the daemon with it.
    let sessionAgent: RegisteredAgent;
    try { sessionAgent = resolveAgent(req); }
    catch (err) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: `${(err as Error).message} Send it as X-Aimeat-Agent on this MCP session.` },
        id: (Array.isArray(req.body) ? req.body[0]?.id : req.body?.id) ?? null,
      });
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `local-${randomBytes(16).toString('hex')}`,
    });
    // One identity, so `resolve()` inside every tool module has exactly one answer and cannot
    // refuse. The scoping IS an AgentRegistry, which is why no tool module changes.
    const sessionRegistry = new AgentRegistry();
    sessionRegistry.add(sessionAgent);
    const mcp = buildMcp(sessionRegistry);
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
    // The same omission as the REST proxy had, in the second place nobody looked: without the name
    // this registers the subscription under the socket's opener, so another agent's records would
    // wake this one. The reconnect path already passed `entry.gaii`, so the two disagreed and the
    // first reconnect silently corrected what the first subscribe got wrong. → pitfalls §43
    ch.tunnel?.subscribe(spaces, entry.gaii);
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
        principals: registry.list().map(e => principalRow(e, channels.get(e.gaii))),
        agents: registry.list().map(e => ({
          agent: e.agent,
          gaii: e.gaii,
          owner: e.owner,
          node_url: e.config.node_url,
          transport: channels.get(e.gaii)!.transportMode,
          tunnel_status: statusOfIdentity(channels.get(e.gaii)),
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
      // `ch.forward`, NEVER `ch.tunnel.forward`. This handler proxies for whichever agent the
      // request names, and on a shared socket a bare forward carries no name, so the node read
      // every one of these as the agent that opened the socket. Measured on a live 62-identity
      // fleet on 2026-09-04: `news-fetcher` asked for its own tasks, was refused as
      // `activity-reporter`, and was then served `activity-reporter`'s list when it asked for that
      // one. Reads misattributed, writes misattributed AND landed under the wrong agent — this
      // path carries `DELETE /v1/memory/…`. Found by crewaimeat-dev. → pitfalls §43
      if (ch.tunnel?.isOnline() && ch.forward) {
        const r = await ch.forward(req.method, req.path, { query, body });
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

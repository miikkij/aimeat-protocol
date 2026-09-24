/**
 * @file cli/connect/mcp/local-stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the serve daemon knows about itself, on `GET /local/stats`: how long it has
 *   run, its memory and CPU, how late its event loop runs, what crossed the network (the tunnel
 *   sockets to the node and the loopback calls from local clients), per-identity delivery counts,
 *   and a feed of the latest deliveries. `aimeat connect tui` reads it once a second.
 *
 *   Everything here OBSERVES. The feed is fed by AgentChannel.onActivity, which reports a delivery
 *   and takes nothing off a queue, so a TUI left open beside a crew can never take a task away
 *   from the runtime that parks on /local/tasks/next. The feed is a ring of FEED_SIZE entries and
 *   the counters are one row per identity the daemon serves, so memory does not grow with uptime.
 * @structure ActivityEvent · summarise() · DaemonStats (record, countLoopback, snapshot) ·
 *   registerLocalStats()
 * @usage
 *   const stats = new DaemonStats();
 *   registerLocalStats(app, stats, { agents: () => registry.list(), channel: g => channels.get(g), mcpSessions: () => transports.size });
 *   ch.onActivity = (kind, item) => stats.record(entry, kind, item);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created for `aimeat connect tui`.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { RegisteredAgent } from '../agent-registry.js';
import type { ConnectTunnelClient } from '../tunnel-client.js';
import type { TrafficSnapshot } from '../tunnel-traffic.js';
import type { ActivityKind, AgentChannel } from './local-channel.js';
import { statusOfIdentity } from './tunnel-hub.js';

/** How many deliveries the feed keeps. A TUI shows the newest screenful; older ones are gone. */
export const FEED_SIZE = 200;
const SUMMARY_MAX = 120;

export interface ActivityEvent {
  /** Rises by one per event for the daemon's life; a reader asks for `?since=` the last it saw. */
  seq: number;
  at: string;
  gaii: string;
  agent: string;
  kind: ActivityKind;
  summary: string;
}

type Counts = Record<ActivityKind, number>;
const zeroCounts = (): Counts => ({ task: 0, record: 0, dm: 0, message: 0, cancelled: 0, invoke: 0 });

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** One line a person can read about a delivery, from whichever fields its payload carries. */
export function summarise(kind: ActivityKind, item: unknown): string {
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  let text: string | null;
  if (kind === 'record') {
    const where = [str(o.space), str(o.key) ?? str(o.id)].filter(Boolean).join('/');
    text = [str(o.action) ?? str(o.op), where].filter(Boolean).join(' ') || null;
  } else if (kind === 'dm' || kind === 'message') {
    const from = str(o.from) ?? str(o.sender) ?? str(o.senderGaii) ?? str(o.from_gaii);
    const what = str(o.subject) ?? str(o.preview) ?? str(o.content) ?? str(o.body) ?? str(o.text);
    text = [from, what].filter(Boolean).join(': ') || null;
  } else if (kind === 'invoke') {
    text = str(o.capability);
  } else {
    text = str(o.title) ?? str(o.description);
  }
  text = (text ?? str(o.id) ?? '').replace(/\s+/g, ' ');
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}

/** Which part of the loopback surface a request used, for the per-surface call counts. */
function surfaceOf(path: string): string {
  if (path.startsWith('/v1/mcp')) return 'mcp';
  if (path.startsWith('/v1/')) return 'proxy';
  if (path.startsWith('/local/call/')) return 'call';
  if (/^\/local\/[a-z]+\/next$/.test(path)) return 'poll';
  return 'local';
}

export class DaemonStats {
  private seq = 0;
  private feed: ActivityEvent[] = [];
  private counts = new Map<string, { counts: Counts; lastAt: string | null }>();
  private loop = { requests: 0, inFlight: 0, bytesIn: 0, bytesOut: 0, bySurface: {} as Record<string, number> };
  private readonly delay = monitorEventLoopDelay({ resolution: 20 });
  private lastCpu = process.cpuUsage();
  private lastCpuAt = process.hrtime.bigint();

  constructor() { this.delay.enable(); }

  /** A delivery reached one identity. Called from AgentChannel.onActivity and the daemon's invoke path. */
  record(entry: Pick<RegisteredAgent, 'gaii' | 'agent'>, kind: ActivityKind, item: unknown): void {
    const at = new Date().toISOString();
    this.feed.push({ seq: ++this.seq, at, gaii: entry.gaii, agent: entry.agent, kind, summary: summarise(kind, item) });
    if (this.feed.length > FEED_SIZE) this.feed.splice(0, this.feed.length - FEED_SIZE);
    const row = this.counts.get(entry.gaii) ?? { counts: zeroCounts(), lastAt: null };
    row.counts[kind]++;
    row.lastAt = at;
    this.counts.set(entry.gaii, row);
  }

  /** Express middleware: counts every loopback request and the bytes it moved. */
  countLoopback = (req: Request, res: Response, next: NextFunction): void => {
    const loop = this.loop;
    loop.requests++;
    loop.inFlight++;
    const surface = surfaceOf(req.path);
    loop.bySurface[surface] = (loop.bySurface[surface] ?? 0) + 1;
    loop.bytesIn += Number(req.headers['content-length']) || 0;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      loop.inFlight--;
      loop.bytesOut += Number(res.getHeader('content-length')) || 0;
    };
    res.once('finish', end);
    res.once('close', end);
    next();
  };

  /** CPU use since the previous call, as a percentage of one core. */
  private cpuPercent(): number {
    const now = process.hrtime.bigint();
    const used = process.cpuUsage(this.lastCpu);
    const wallUs = Number(now - this.lastCpuAt) / 1000;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    return wallUs > 0 ? Math.round(((used.user + used.system) / wallUs) * 1000) / 10 : 0;
  }

  snapshot(deps: StatsDeps, since: number) {
    const mem = process.memoryUsage();
    const ms = (ns: number) => Math.round(ns / 1e4) / 100;
    const lag = { mean_ms: ms(this.delay.mean || 0), p99_ms: ms(this.delay.percentile(99) || 0), max_ms: ms(this.delay.max || 0) };
    this.delay.reset();

    // One tunnel client may carry many identities; count each socket once.
    const clients = new Set<ConnectTunnelClient>();
    const agents = deps.agents().map((e) => {
      const ch = deps.channel(e.gaii);
      if (ch?.tunnel) clients.add(ch.tunnel);
      const row = this.counts.get(e.gaii);
      return {
        gaii: e.gaii,
        agent: e.agent,
        owner: e.owner,
        node_url: e.config.node_url,
        transport: ch?.transportMode ?? 'direct',
        tunnel_status: statusOfIdentity(ch),
        reconnects: ch?.reconnects ?? 0,
        counts: row?.counts ?? zeroCounts(),
        last_activity_at: row?.lastAt ?? null,
      };
    });
    const tunnel: TrafficSnapshot & { sockets: number } = {
      sockets: clients.size, bytes_in: 0, bytes_out: 0, frames_in: 0, forwards: 0,
      forward_errors: 0, forwards_in_flight: 0, forward_ms_total: 0, forward_ms_max: 0,
    };
    for (const c of clients) {
      const t = c.getTraffic();
      tunnel.bytes_in += t.bytes_in;
      tunnel.bytes_out += t.bytes_out;
      tunnel.frames_in += t.frames_in;
      tunnel.forwards += t.forwards;
      tunnel.forward_errors += t.forward_errors;
      tunnel.forwards_in_flight += t.forwards_in_flight;
      tunnel.forward_ms_total += t.forward_ms_total;
      tunnel.forward_ms_max = Math.max(tunnel.forward_ms_max, t.forward_ms_max);
    }

    return {
      now: new Date().toISOString(),
      process: {
        pid: process.pid,
        started_at: deps.startedAt,
        uptime_s: Math.round(process.uptime()),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        memory: { rss: mem.rss, heap_used: mem.heapUsed, heap_total: mem.heapTotal, external: mem.external },
        cpu_percent: this.cpuPercent(),
        event_loop: lag,
      },
      network: {
        tunnel,
        loopback: {
          requests: this.loop.requests,
          in_flight: this.loop.inFlight,
          bytes_in: this.loop.bytesIn,
          bytes_out: this.loop.bytesOut,
          by_surface: { ...this.loop.bySurface },
          mcp_sessions: deps.mcpSessions(),
        },
      },
      agents,
      activity_seq: this.seq,
      activity: this.feed.filter(e => e.seq > since),
    };
  }
}

/** The body of `GET /local/stats` under `data`. */
export type StatsSnapshot = ReturnType<DaemonStats['snapshot']>;

export interface StatsDeps {
  startedAt: string;
  agents: () => RegisteredAgent[];
  channel: (gaii: string) => AgentChannel | undefined;
  mcpSessions: () => number;
}

/**
 * Mount the loopback counter and `GET /local/stats`. Call it right after the body parser, before
 * any other route, so the counter sees every request.
 */
export function registerLocalStats(app: Express, stats: DaemonStats, deps: StatsDeps): void {
  app.use(stats.countLoopback);
  app.get('/local/stats', (req: Request, res: Response) => {
    const raw = typeof req.query.since === 'string' ? parseInt(req.query.since, 10) : 0;
    res.json({ ok: true, data: stats.snapshot(deps, Number.isFinite(raw) ? raw : 0) });
  });
}

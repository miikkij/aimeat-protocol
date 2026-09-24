/**
 * @file cli/connect/tui/render.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Draws one frame of `aimeat connect tui` from the view state: the daemon's process
 *   (uptime, CPU, memory, event-loop delay), the network (tunnel to the node, loopback clients),
 *   the agents it serves, and one lower panel (the delivery feed, or the selected agent's open
 *   tasks or inbox). A pure function of (view, width, height) → exactly `height` lines, so a test
 *   can read a frame as text and the terminal code only has to print it.
 * @structure TuiView · Panel · TaskRow · MessageRow · render() and one helper per block
 * @usage process.stdout.write(render(view, cols, rows).join('\n'));
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created.
 */
import type { ActivityEvent, StatsSnapshot } from '../mcp/local-stats.js';
import { ago, bytes, clock, duration, fit, rate, spark, style, type Style } from './format.js';

export type Panel = 'activity' | 'tasks' | 'inbox';
export const PANELS: Panel[] = ['activity', 'tasks', 'inbox'];

export interface TaskRow { id: string; title: string; status: string; updatedAt?: string }
export interface MessageRow { id: string; from: string; content: string; createdAt?: string }

/** What the selected agent's node lists held when last read. `null` means not read yet. */
export interface AgentLists {
  gaii: string;
  tasks: TaskRow[] | null;
  inbox: MessageRow[] | null;
  error: string | null;
  fetchedAt: number | null;
}

export interface TuiView {
  stats: StatsSnapshot | null;
  /** Why the daemon could not be read, when it could not. */
  error: string | null;
  port: number | null;
  history: { cpu: number[]; rss: number[]; netIn: number[]; netOut: number[] };
  feed: ActivityEvent[];
  selected: number;
  panel: Panel;
  /** Only the selected agent's rows in the feed. */
  filterFeed: boolean;
  lists: AgentLists | null;
  color: boolean;
  now: number;
}

export function emptyView(color: boolean): TuiView {
  return {
    stats: null, error: null, port: null,
    history: { cpu: [], rss: [], netIn: [], netOut: [] },
    feed: [], selected: 0, panel: 'activity', filterFeed: false, lists: null, color, now: Date.now(),
  };
}

const TRANSPORT_STYLE: Record<string, Style> = { online: 'green', connecting: 'yellow', offline: 'yellow', auth_failed: 'red', stopped: 'red' };

type Agent = StatsSnapshot['agents'][number];

/** An agent's short name: the bare name, or name@owner when two owners share it on this daemon. */
function nameOf(a: Agent, all: Agent[]): string {
  return all.filter(x => x.agent === a.agent).length > 1 ? `${a.agent}@${a.owner}` : a.agent;
}

function rule(width: number, v: TuiView, title = ''): string {
  const head = title ? `── ${title} ` : '';
  return style(fit(head + '─'.repeat(Math.max(0, width)), width), v.color, 'dim');
}

function header(v: TuiView, width: number): string {
  const s = v.stats;
  const left = style('AIMEAT connect', v.color, 'bold')
    + (s ? `  daemon pid ${s.process.pid} on 127.0.0.1:${v.port ?? '?'} · up ${duration(s.process.uptime_s)} · ${s.process.node}` : '');
  const right = clock(v.now);
  return fit(left, Math.max(0, width - right.length - 1)) + ' ' + right;
}

function processBlock(v: TuiView, width: number): string[] {
  const p = v.stats!.process;
  const heap = `heap ${bytes(p.memory.heap_used)} of ${bytes(p.memory.heap_total)}`;
  const line = `${style('Process', v.color, 'bold')}  CPU ${p.cpu_percent.toFixed(1)}% ${style(spark(v.history.cpu, 12), v.color, 'cyan')}`
    + `   Memory ${bytes(p.memory.rss)} (${heap}) ${style(spark(v.history.rss, 12), v.color, 'cyan')}`
    + `   Loop delay p99 ${p.event_loop.p99_ms} ms`;
  return [fit(line, width)];
}

function networkBlock(v: TuiView, width: number): string[] {
  const n = v.stats!.network;
  const t = n.tunnel;
  const inNow = v.history.netIn.at(-1) ?? 0;
  const outNow = v.history.netOut.at(-1) ?? 0;
  const avg = t.forwards > 0 ? Math.round(t.forward_ms_total / t.forwards) : 0;
  const failed = t.forward_errors > 0 ? style(`${t.forward_errors} failed`, v.color, 'red') : '0 failed';
  const surf = n.loopback.by_surface;
  if (t.sockets === 0) {
    // Degraded to direct HTTP: those calls use fetch, which this daemon does not meter.
    return [
      fit(`${style('Network', v.color, 'bold')}  ${style('No tunnel to the node: calls go over direct HTTP and are not counted here.', v.color, 'yellow')}`, width),
      fit(`         Local clients ${n.loopback.requests} requests · ${n.loopback.mcp_sessions} MCP sessions · ↓ ${bytes(n.loopback.bytes_in)} ↑ ${bytes(n.loopback.bytes_out)}`, width),
      ' '.repeat(width),
    ];
  }
  const lines = [
    `${style('Network', v.color, 'bold')}  To the node ↓ ${rate(inNow)} ↑ ${rate(outNow)} ${style(spark(v.history.netIn.map((x, i) => x + (v.history.netOut[i] ?? 0)), 12), v.color, 'cyan')}`
      + `   total ↓ ${bytes(t.bytes_in)} ↑ ${bytes(t.bytes_out)} over ${t.sockets} socket${t.sockets === 1 ? '' : 's'}`,
    `         Calls to the node ${t.forwards} · ${failed} · avg ${avg} ms · slowest ${t.forward_ms_max} ms · ${t.forwards_in_flight} waiting`,
    `         Local clients ${n.loopback.requests} requests (MCP ${surf.mcp ?? 0} · proxy ${surf.proxy ?? 0} · tool calls ${surf.call ?? 0} · waits ${surf.poll ?? 0})`
      + ` · ${n.loopback.mcp_sessions} MCP session${n.loopback.mcp_sessions === 1 ? '' : 's'} · ↓ ${bytes(n.loopback.bytes_in)} ↑ ${bytes(n.loopback.bytes_out)}`,
  ];
  return lines.map(l => fit(l, width));
}

function agentsBlock(v: TuiView, width: number, rows: number): string[] {
  const agents = v.stats!.agents;
  const cols = [['connection', 12], ['tasks', 6], ['msgs', 6], ['DMs', 6], ['records', 8], ['invokes', 8], ['last delivery', 16]] as const;
  const fixed = cols.reduce((n, [, w]) => n + w, 0) + 2;
  const nameW = Math.max(10, width - fixed);
  const head = '  ' + fit(`Agents (${agents.length})`, nameW) + cols.map(([t, w]) => fit(t, w)).join('');
  const out = [style(fit(head, width), v.color, 'bold')];
  const bodyRows = Math.max(0, rows - 1);
  // Keep the selected row in view on a fleet longer than the block.
  const start = Math.min(Math.max(0, v.selected - bodyRows + 1), Math.max(0, agents.length - bodyRows));
  for (const [i, a] of agents.slice(start, start + bodyRows).entries()) {
    const idx = start + i;
    const conn = a.tunnel_status ?? a.transport;
    const shown = a.transport === 'direct' && conn !== 'auth_failed' ? 'direct HTTP' : conn;
    const c = a.counts;
    const line = (idx === v.selected ? '> ' : '  ') + fit(nameOf(a, agents), nameW)
      + style(fit(shown, 12), v.color, TRANSPORT_STYLE[conn] ?? 'yellow')
      + fit(String(c.task), 6) + fit(String(c.message), 6) + fit(String(c.dm), 6)
      + fit(String(c.record), 8) + fit(String(c.invoke), 8) + fit(ago(a.last_activity_at, v.now), 16);
    out.push(idx === v.selected ? style(fit(line, width), v.color, 'inverse') : fit(line, width));
  }
  while (out.length < rows) out.push(' '.repeat(width));
  return out;
}

function tabs(v: TuiView, width: number): string {
  const label: Record<Panel, string> = { activity: 'Deliveries', tasks: 'Open tasks', inbox: 'Inbox' };
  const t = PANELS.map(p => (p === v.panel ? style(` ${label[p]} `, v.color, 'inverse') : ` ${label[p]} `)).join(' ');
  const agent = v.stats?.agents[v.selected];
  const who = agent && v.panel !== 'activity' ? `  for ${nameOf(agent, v.stats!.agents)}` : '';
  const filt = v.panel === 'activity' && v.filterFeed && agent ? `  only ${nameOf(agent, v.stats!.agents)}` : '';
  return fit(t + who + filt, width);
}

function activityRows(v: TuiView, width: number, rows: number): string[] {
  const agents = v.stats!.agents;
  const sel = agents[v.selected];
  const feed = v.filterFeed && sel ? v.feed.filter(e => e.gaii === sel.gaii) : v.feed;
  if (feed.length === 0) return [style(fit('  No deliveries since the TUI started. They appear here the moment the node pushes one.', width), v.color, 'dim')];
  const kindStyle: Record<string, Style> = { task: 'green', dm: 'cyan', message: 'cyan', invoke: 'yellow', cancelled: 'red', record: 'dim' };
  const byGaii = new Map(agents.map(a => [a.gaii, nameOf(a, agents)]));
  return feed.slice(-rows).reverse().map(e => fit(
    `  ${clock(e.at)}  ${fit(byGaii.get(e.gaii) ?? e.agent, 18)} ${style(fit(e.kind, 10), v.color, kindStyle[e.kind] ?? 'dim')}${e.summary}`, width));
}

function listRows(v: TuiView, width: number, rows: number): string[] {
  const l = v.lists;
  const sel = v.stats!.agents[v.selected];
  if (!sel) return [];
  if (!l || l.gaii !== sel.gaii || (v.panel === 'tasks' ? l.tasks : l.inbox) === null) {
    return [style(fit(l?.error ? `  Could not read from the node: ${l.error}` : '  Reading from the node…', width), v.color, l?.error ? 'red' : 'dim')];
  }
  const when = l.fetchedAt ? style(`  read ${ago(new Date(l.fetchedAt).toISOString(), v.now)} · r reads again`, v.color, 'dim') : '';
  if (v.panel === 'tasks') {
    const t = l.tasks!;
    if (t.length === 0) return [fit(`  No open tasks.${when}`, width)];
    return [fit(`  ${t.length} open${when}`, width), ...t.slice(0, rows - 1).map(x =>
      fit(`  ${fit(x.status, 20)}${fit(ago(x.updatedAt, v.now), 14)}${x.title}`, width))];
  }
  const m = l.inbox!;
  if (m.length === 0) return [fit(`  No pending messages.${when}`, width)];
  return [fit(`  ${m.length} pending${when}`, width), ...m.slice(0, rows - 1).map(x =>
    fit(`  ${fit(x.createdAt ? clock(x.createdAt) : '', 10)}${fit(x.from, 30)}${x.content.replace(/\s+/g, ' ')}`, width))];
}

const FOOTER = 'q quit · ↑↓ agent · Tab view · f only this agent · r read again';

/** One frame, exactly `height` lines of exactly `width` columns. */
export function render(v: TuiView, width: number, height: number): string[] {
  const out: string[] = [header(v, width), rule(width, v)];
  if (!v.stats) {
    out.push(fit(v.error ? style(`  ${v.error}`, v.color, 'yellow') : '  Reading the daemon…', width));
  } else {
    out.push(...processBlock(v, width), ...networkBlock(v, width), rule(width, v));
    // Everything below shares what is left; the agents take up to 40% of it, the panel the rest.
    const left = height - out.length - 3;
    const agentRows = Math.max(2, Math.min(v.stats.agents.length + 1, Math.floor(left * 0.4)));
    out.push(...agentsBlock(v, width, agentRows), rule(width, v), tabs(v, width));
    const panelRows = Math.max(0, height - out.length - 1);
    const body = v.panel === 'activity' ? activityRows(v, width, panelRows) : listRows(v, width, panelRows);
    out.push(...body.slice(0, panelRows));
  }
  while (out.length < height - 1) out.push(' '.repeat(Math.max(0, width)));
  out.length = Math.max(0, height - 1);
  out.push(style(fit(FOOTER, width), v.color, 'dim'));
  return out.map(l => fit(l, width));
}

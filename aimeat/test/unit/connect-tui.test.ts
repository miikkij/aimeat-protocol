/**
 * @file test/unit/connect-tui.test.ts
 * @description `aimeat connect tui` without a terminal: the text helpers, the daemon's stats feed
 *   (bounded, `since`-filtered, per-identity counts), the tunnel traffic counter, and whole frames
 *   read as text, including a 62-agent fleet, which is the size a production daemon has carried.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created with the TUI.
 */
import { describe, it, expect } from 'vitest';
import { bytes, duration, fit, visibleLength, spark, style } from '../../src/cli/connect/tui/format.js';
import { DaemonStats, FEED_SIZE, summarise, type StatsSnapshot } from '../../src/cli/connect/mcp/local-stats.js';
import { TunnelTraffic } from '../../src/cli/connect/tunnel-traffic.js';
import { emptyView, render, type TuiView } from '../../src/cli/connect/tui/render.js';

describe('format', () => {
  it('sizes and durations read as a person says them', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(duration(42)).toBe('42s');
    expect(duration(3 * 3600 + 4 * 60)).toBe('3h 4m');
    expect(duration(86400 + 2 * 3600 + 3 * 60)).toBe('1d 2h 3m');
  });

  it('fit cuts to the exact width and never counts escape codes as columns', () => {
    const styled = style('online and well', true, 'green');
    expect(visibleLength(fit(styled, 6))).toBe(6);
    expect(fit(styled, 6).endsWith('\x1b[0m')).toBe(true);
    expect(fit('abc', 5)).toBe('abc  ');
    expect(fit('abcdef', 4)).toBe('abc…');
    expect(fit('abcdef', 4)).not.toContain('\x1b');
  });

  it('a sparkline keeps its width and scales to the largest value', () => {
    expect(spark([0, 5, 10], 5)).toBe('  ▁▅█');
    expect(spark([], 3)).toBe('   ');
  });
});

describe('DaemonStats', () => {
  const bot = { gaii: 'bot#alice@n', agent: 'bot' };

  it('keeps FEED_SIZE events, newest last, and `since` returns only newer ones', () => {
    const s = new DaemonStats();
    for (let i = 0; i < FEED_SIZE + 50; i++) s.record(bot, 'task', { id: `t${i}`, title: `Task ${i}` });
    const deps = { startedAt: new Date().toISOString(), agents: () => [], channel: () => undefined, mcpSessions: () => 0 };
    const all = s.snapshot(deps, 0);
    expect(all.activity).toHaveLength(FEED_SIZE);
    expect(all.activity.at(-1)!.summary).toBe(`Task ${FEED_SIZE + 49}`);
    expect(all.activity_seq).toBe(FEED_SIZE + 50);
    expect(s.snapshot(deps, all.activity_seq - 2).activity.map(e => e.summary)).toEqual([`Task ${FEED_SIZE + 48}`, `Task ${FEED_SIZE + 49}`]);
  });

  it('counts per identity, so two owners\' `concierge` stay apart', () => {
    const s = new DaemonStats();
    s.record({ gaii: 'concierge#alice@n', agent: 'concierge' }, 'task', {});
    s.record({ gaii: 'concierge#bob@n', agent: 'concierge' }, 'dm', {});
    s.record({ gaii: 'concierge#bob@n', agent: 'concierge' }, 'dm', {});
    const entry = (owner: string) => ({ gaii: `concierge#${owner}@n`, agent: 'concierge', owner, client: {} as never, config: { node_url: 'http://n' } as never });
    const snap = s.snapshot({ startedAt: '', agents: () => [entry('alice'), entry('bob')], channel: () => undefined, mcpSessions: () => 0 }, 0);
    expect(snap.agents.map(a => [a.owner, a.counts.task, a.counts.dm])).toEqual([['alice', 1, 0], ['bob', 0, 2]]);
  });

  it('summarises each kind of delivery from the fields it carries', () => {
    expect(summarise('task', { id: 't1', title: 'Weekly  summary' })).toBe('Weekly summary');
    expect(summarise('dm', { senderGhii: 'x', from: 'alice@n', subject: 'Hello' })).toBe('alice@n: Hello');
    expect(summarise('message', { senderGaii: 'alice@n', content: 'Hi there' })).toBe('alice@n: Hi there');
    expect(summarise('record', { action: 'put', space: 'wish', key: 'w-1' })).toBe('put wish/w-1');
    expect(summarise('invoke', { capability: 'crew.try' })).toBe('crew.try');
    expect(summarise('task', { id: 'only-an-id' })).toBe('only-an-id');
    expect(summarise('task', { title: 'x'.repeat(500) })).toHaveLength(120);
  });
});

describe('TunnelTraffic', () => {
  it('settles a forward once, and counts a 5xx or a timeout as failed', () => {
    const t = new TunnelTraffic();
    const ok = t.startForward();
    const bad = t.startForward();
    expect(t.snapshot().forwards_in_flight).toBe(2);
    ok(200); ok(200);
    bad(504);
    const s = t.snapshot();
    expect(s).toMatchObject({ forwards: 2, forward_errors: 1, forwards_in_flight: 0 });
  });
});

/** A stats body as the daemon sends it, for `n` agents. */
function stats(n: number, sockets = 1): StatsSnapshot {
  const agents = Array.from({ length: n }, (_, i) => ({
    gaii: `agent-${i}#alice@n`, agent: `agent-${i}`, owner: 'alice', node_url: 'http://n',
    transport: 'tunnel' as const, tunnel_status: i === 3 ? 'auth_failed' : 'online', reconnects: 1,
    counts: { task: i, record: 0, dm: 0, message: 0, cancelled: 0, invoke: 0 }, last_activity_at: null,
  }));
  return {
    now: new Date().toISOString(),
    process: { pid: 4242, started_at: '', uptime_s: 93784, node: 'v24.0.0', platform: 'linux-x64',
      memory: { rss: 80 * 1024 * 1024, heap_used: 40 * 1024 * 1024, heap_total: 60 * 1024 * 1024, external: 0 },
      cpu_percent: 2.5, event_loop: { mean_ms: 1, p99_ms: 3, max_ms: 5 } },
    network: {
      tunnel: { sockets, bytes_in: 2048, bytes_out: 1024, frames_in: 3, forwards: 10, forward_errors: 1, forwards_in_flight: 0, forward_ms_total: 500, forward_ms_max: 120 },
      loopback: { requests: 7, in_flight: 1, bytes_in: 0, bytes_out: 100, by_surface: { call: 3, proxy: 4 }, mcp_sessions: 1 },
    },
    agents,
    activity_seq: 1,
    activity: [{ seq: 1, at: new Date().toISOString(), gaii: 'agent-0#alice@n', agent: 'agent-0', kind: 'task', summary: 'Weekly summary' }],
  };
}

function view(s: StatsSnapshot, patch: Partial<TuiView> = {}): TuiView {
  return { ...emptyView(false), stats: s, port: 5555, feed: s.activity, ...patch };
}

describe('render', () => {
  it('draws exactly height lines of exactly width columns', () => {
    for (const [w, h] of [[120, 40], [80, 24], [40, 12]]) {
      const frame = render(view(stats(5)), w, h);
      expect(frame).toHaveLength(h);
      for (const line of frame) expect(visibleLength(line)).toBe(w);
    }
  });

  it('shows uptime, memory, traffic, the agents and the feed', () => {
    const text = render(view(stats(2)), 140, 30).join('\n');
    expect(text).toContain('up 1d 2h 3m');
    expect(text).toContain('Memory 80.0 MB');
    expect(text).toContain('total ↓ 2.0 KB ↑ 1.0 KB over 1 socket');
    expect(text).toContain('Calls to the node 10 · 1 failed · avg 50 ms');
    expect(text).toMatch(/> agent-0\s+online/);
    expect(text).toContain('Weekly summary');
  });

  it('keeps the selected agent on screen in a 62-agent fleet', () => {
    const frame = render(view(stats(62), { selected: 61 }), 120, 30);
    expect(frame.some(l => l.startsWith('> agent-61 '))).toBe(true);
    // Agent rows start with the selection mark or two spaces; the feed row naming agent-0 does not.
    expect(frame.some(l => /^[> ] agent-0 /.test(l))).toBe(false);
  });

  it('says plainly when there is no tunnel, instead of showing zeros', () => {
    const text = render(view(stats(1, 0)), 140, 30).join('\n');
    expect(text).toContain('No tunnel to the node');
    expect(text).not.toContain('Calls to the node');
  });

  it('says how to start a daemon when there is none', () => {
    const text = render({ ...emptyView(false), error: 'No serve daemon is running on this machine. Start one with: aimeat connect serve --daemon' }, 120, 10).join('\n');
    expect(text).toContain('aimeat connect serve --daemon');
  });

  it('the tasks panel shows the rows read from the node for the selected agent', () => {
    const s = stats(2);
    const text = render(view(s, {
      panel: 'tasks', selected: 1,
      lists: { gaii: 'agent-1#alice@n', tasks: [{ id: 't', title: 'Ship the TUI', status: 'active' }], inbox: [], error: null, fetchedAt: Date.now() },
    }), 120, 30).join('\n');
    expect(text).toContain('for agent-1');
    expect(text).toMatch(/active\s+.*Ship the TUI/);
  });
});

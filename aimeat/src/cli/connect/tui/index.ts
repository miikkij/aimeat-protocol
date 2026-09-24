/**
 * @file cli/connect/tui/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect tui`: a full-screen view of the running serve daemon. It finds the
 *   daemon through `serve.json`, reads `GET /local/stats` once a second, and reads the selected
 *   agent's open tasks and inbox from the node through the daemon's own proxy when that panel is
 *   open. It only reads: nothing here takes a task off a queue or changes the daemon, so it can run
 *   beside a crew without changing what the crew sees. It starts before the daemon if need be and
 *   picks it up when it appears.
 *
 *   No dependency: the terminal is driven with plain escape sequences and node:readline keypress
 *   events, and every frame comes from render.ts, a pure function a test can read as text.
 * @structure readDiscovery · fetchJson · Poller (tick, readLists) · runTui (terminal lifecycle, keys)
 * @usage aimeat connect tui [--once [--view activity|tasks|inbox] [--agent <name|gaii>]] [--interval <ms>] [--no-color]
 * @version-history
 *   v1.0.1 — 2026-09-24 — Sends the daemon's secret from serve.json on every read: the daemon now
 *     refuses a caller without it (secaudit 2026-09, A9-1).
 *   v1.0.0 — 2026-09-24 — Created.
 */
import { readFileSync, existsSync } from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import { serveDiscoveryPath, pidAlive, type ServeDiscovery } from '../mcp/local-discovery.js';
import type { StatsSnapshot } from '../mcp/local-stats.js';
import { FEED_SIZE } from '../mcp/local-stats.js';
import { emptyView, render, PANELS, type Panel, type TuiView, type TaskRow, type MessageRow } from './render.js';

const HISTORY = 60;
/** How often an open Tasks or Inbox panel reads the node again on its own. */
const LIST_REFRESH_MS = 15_000;
/** The task states worth a look: the live ones and the one that needs a person. */
const OPEN_STATUSES = ['active', 'queued', 'revision_requested', 'paused', 'stalled'];

const NO_DAEMON = 'No serve daemon is running on this machine. Start one with: aimeat connect serve --daemon';

/** The running daemon's port and the secret it takes, or why there is none. */
export function readDiscovery(path = serveDiscoveryPath()): { port: number; secret: string } | { error: string } {
  if (!existsSync(path)) return { error: NO_DAEMON };
  let doc: ServeDiscovery;
  try { doc = JSON.parse(readFileSync(path, 'utf8')) as ServeDiscovery; }
  catch (err) { return { error: `Could not read ${path}: ${(err as Error).message}` }; }
  if (!doc.pid || !pidAlive(doc.pid)) return { error: NO_DAEMON };
  // A daemon older than schema 3 writes no secret and checks none, so an empty value does no harm.
  return { port: doc.port, secret: typeof doc.secret === 'string' ? doc.secret : '' };
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  const body = await r.json() as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
  if (!r.ok || body.ok === false) throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${r.status}`);
  return body.data;
}

/** Holds the view and moves it forward: one `tick` per interval, list reads when a panel needs one. */
export class Poller {
  readonly view: TuiView;
  private lastSeq = 0;
  private prev: { at: number; in: number; out: number } | null = null;
  private listsInFlight = false;
  /** The header every read sends: the secret from the serve.json the last tick found. */
  private auth: Record<string, string> = {};

  constructor(color: boolean, private readonly discover = readDiscovery) { this.view = emptyView(color); }

  async tick(): Promise<void> {
    const v = this.view;
    v.now = Date.now();
    const d = this.discover();
    if ('error' in d) { v.error = d.error; v.stats = null; v.port = null; return; }
    if (v.port !== d.port) { this.lastSeq = 0; this.prev = null; v.feed = []; }
    v.port = d.port;
    this.auth = { Authorization: `Bearer ${d.secret}` };
    let s: StatsSnapshot;
    try { s = await fetchJson(`http://127.0.0.1:${d.port}/local/stats?since=${this.lastSeq}`, this.auth) as StatsSnapshot; }
    catch (err) { v.error = `The daemon on port ${d.port} did not answer: ${(err as Error).message}`; v.stats = null; return; }
    v.error = null;
    // A lower sequence than the one we hold is a daemon that restarted on the same port.
    if (s.activity_seq < this.lastSeq) { this.lastSeq = 0; v.feed = []; }
    v.feed.push(...s.activity);
    if (v.feed.length > FEED_SIZE) v.feed.splice(0, v.feed.length - FEED_SIZE);
    const fresh = s.activity;
    this.lastSeq = s.activity_seq;
    v.stats = s;
    v.selected = Math.min(v.selected, Math.max(0, s.agents.length - 1));

    const push = (arr: number[], x: number) => { arr.push(x); if (arr.length > HISTORY) arr.shift(); };
    const now = Date.parse(s.now);
    const t = s.network.tunnel;
    if (this.prev && now > this.prev.at) {
      const secs = (now - this.prev.at) / 1000;
      push(v.history.netIn, Math.max(0, (t.bytes_in - this.prev.in) / secs));
      push(v.history.netOut, Math.max(0, (t.bytes_out - this.prev.out) / secs));
    }
    this.prev = { at: now, in: t.bytes_in, out: t.bytes_out };
    push(v.history.cpu, s.process.cpu_percent);
    push(v.history.rss, s.process.memory.rss);

    // A task or message just arrived for the agent whose panel is open: read the list again now.
    const sel = s.agents[v.selected];
    if (sel && v.lists?.gaii === sel.gaii && fresh.some(e => e.gaii === sel.gaii && (e.kind === 'task' || e.kind === 'message' || e.kind === 'cancelled'))) {
      v.lists.fetchedAt = 0;
    }
    await this.readListsIfDue();
  }

  /** Read the selected agent's open tasks and inbox, when a list panel is open and the copy is old. */
  async readListsIfDue(force = false): Promise<void> {
    const v = this.view;
    const sel = v.stats?.agents[v.selected];
    if (!sel || v.panel === 'activity' || v.port === null || this.listsInFlight) return;
    const same = v.lists?.gaii === sel.gaii;
    if (!force && same && v.lists!.fetchedAt !== null && Date.now() - v.lists!.fetchedAt < LIST_REFRESH_MS) return;
    if (!same) v.lists = { gaii: sel.gaii, tasks: null, inbox: null, error: null, fetchedAt: null };
    this.listsInFlight = true;
    const base = `http://127.0.0.1:${v.port}/v1/agents/${encodeURIComponent(sel.agent)}`;
    // The daemon's proxy speaks as the agent named in this header, over the agent's own tunnel.
    const headers = { ...this.auth, 'X-Aimeat-Agent': sel.gaii };
    try {
      // One status per call: a status-filtered read is one indexed page on the node, where an
      // unfiltered one loads the agent's whole task history to count it.
      const pages = await Promise.all(OPEN_STATUSES.map(st =>
        fetchJson(`${base}/tasks?status=${st}&per_page=20`, headers) as Promise<{ tasks?: Array<Record<string, unknown>> }>));
      const tasks: TaskRow[] = pages.flatMap(p => p.tasks ?? []).map(t => ({
        id: String(t.id), title: String(t.title ?? ''), status: String(t.status ?? ''),
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : undefined,
      }));
      const inboxData = await fetchJson(`${base}/messages/inbox`, headers) as { messages?: Array<Record<string, unknown>> };
      const inbox: MessageRow[] = (inboxData.messages ?? []).map(m => ({
        id: String(m.id), from: String(m.senderGaii ?? ''), content: String(m.content ?? ''),
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : undefined,
      }));
      if (v.lists?.gaii === sel.gaii) Object.assign(v.lists, { tasks, inbox, error: null, fetchedAt: Date.now() });
    } catch (err) {
      if (v.lists?.gaii === sel.gaii) Object.assign(v.lists, { error: (err as Error).message, fetchedAt: Date.now() });
    } finally {
      this.listsInFlight = false;
    }
  }
}

export async function runTui(flags: Record<string, string>): Promise<void> {
  const out = process.stdout;
  const interactive = out.isTTY && process.stdin.isTTY && flags.once !== 'true';
  const color = flags['no-color'] !== 'true' && !process.env.NO_COLOR && out.isTTY === true;
  const interval = Math.max(250, Number(flags.interval) || 1000);
  const poller = new Poller(color);
  if (PANELS.includes(flags.view as Panel)) poller.view.panel = flags.view as Panel;

  if (!interactive) {
    // One frame, as text: for a pipe, a log, or a quick look. Two reads, so the rates have a start.
    await poller.tick();
    const v = poller.view;
    if (v.stats && flags.agent) {
      const i = v.stats.agents.findIndex(a => a.gaii === flags.agent || a.agent === flags.agent);
      if (i < 0) { console.error(`This daemon serves no agent called ${flags.agent}.`); process.exitCode = 1; return; }
      v.selected = i;
    }
    if (v.stats) { await new Promise(r => setTimeout(r, interval)); await poller.tick(); await poller.readListsIfDue(true); }
    const lines = render(v, out.columns || 120, v.stats ? 40 : 4).map(l => l.trimEnd());
    // The footer names keys a pipe cannot press, and the padding above it is only there for a screen.
    lines.pop();
    while (lines.length && !lines.at(-1)) lines.pop();
    out.write(lines.join('\n') + '\n');
    if (!v.stats) process.exitCode = 1;
    return;
  }

  const v = poller.view;
  let prevFrame: string[] = [];
  const draw = () => {
    // One column short of the edge: a line that fills the last column wraps on some Windows consoles.
    const width = Math.max(20, (out.columns || 80) - 1);
    const height = Math.max(8, out.rows || 24);
    v.now = Date.now();
    const frame = render(v, width, height);
    let buf = '';
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] !== prevFrame[i]) buf += `\x1b[${i + 1};1H${frame[i]}\x1b[K`;
    }
    prevFrame = frame;
    if (buf) out.write(buf);
  };

  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let finish: () => void = () => {};
  const done = new Promise<void>(r => { finish = r; });
  const restore = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    // eslint-disable-next-line aimeat/no-silent-catch -- stdin already gone at exit; the screen is restored below either way
    try { process.stdin.setRawMode(false); } catch { /* see above */ }
    process.stdin.pause();
    out.write('\x1b[?25h\x1b[?1049l');
    finish();
  };
  process.once('exit', restore);
  out.on('resize', () => { prevFrame = []; out.write('\x1b[2J'); draw(); });

  const loop = async () => {
    await poller.tick();
    if (stopped) return;
    draw();
    timer = setTimeout(() => { void loop(); }, interval);
  };

  process.stdin.on('keypress', (_s: string, key: { name?: string; ctrl?: boolean; shift?: boolean } = {}) => {
    const n = v.stats?.agents.length ?? 0;
    if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) { restore(); return; }
    if (key.name === 'up' || key.name === 'k') v.selected = Math.max(0, v.selected - 1);
    else if (key.name === 'down' || key.name === 'j') v.selected = Math.min(Math.max(0, n - 1), v.selected + 1);
    else if (key.name === 'pageup') v.selected = Math.max(0, v.selected - 10);
    else if (key.name === 'pagedown') v.selected = Math.min(Math.max(0, n - 1), v.selected + 10);
    else if (key.name === 'tab' || key.name === 'right' || key.name === 'left') {
      const step = key.shift || key.name === 'left' ? PANELS.length - 1 : 1;
      v.panel = PANELS[(PANELS.indexOf(v.panel) + step) % PANELS.length];
    } else if (key.name === 'f') v.filterFeed = !v.filterFeed;
    else if (key.name === 'r') { void poller.readListsIfDue(true).then(draw); }
    else return;
    draw();
    void poller.readListsIfDue().then(draw);
  });

  void loop();
  await done;
}

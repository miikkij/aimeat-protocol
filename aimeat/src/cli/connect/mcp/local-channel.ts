/**
 * @file local-channel.ts
 * @description AgentChannel — the per-agent push state of the loopback serve daemon: task, record and
 *   DM queues with their long-poll waiters, live-vs-backlog task dedup, the cancelled-id set, the
 *   record-push subscriptions re-sent on reconnect, and the edge-triggered unified wake watermark.
 *   Pure extraction from ./local-server.ts, which passed the 800-line cap when the invoke surface
 *   (./local-invoke.ts) was added. Bodies verbatim; local-server re-exports the class so the unit
 *   test (test/unit/serve-wake-watermark.test.ts) and any other importer keep resolving.
 * @structure
 *   - QueuedTask / QueuedRecord / SpaceRef — the queue item shapes
 *   - AgentChannel — handleTask/handleRecord/handleDm/handleMessages/handleCancelled feed the queues;
 *     nextTask/nextRecord/nextDm/nextWake are the long-poll reads; drainWaiters on shutdown.
 * @usage
 *   const ch = new AgentChannel(entry); ch.handleTask(payload, 'deliver'); await ch.nextTask(25_000);
 * @version-history
 *   v1.1.0 — 2026-09-04 — Carries `forward`, the identity's ONE door to the node, with the stamp
 *     saying whose call it is already baked in. Call sites reaching for `tunnel.forward()` lost that
 *     stamp and were attributed to whichever identity opened the shared socket. → pitfalls §43
 *   v1.0.1 — 2026-08-28 — SECURITY (CodeQL js/resource-exhaustion): the four long-poll setTimeouts
 *     took `waitMs` straight from the caller. The /local routes already clamp it to [0, 120s], but
 *     the bound now also sits at each timer (Math.min(waitMs, MAX_WAIT_MS)) so it holds for any caller.
 *   v1.0.0 — 2026-08-28 — Pure extraction from local-server.ts (max-file-lines). No behaviour change.
 */
import type { ConnectTunnelClient, ForwardOptions, ForwardResult } from '../tunnel-client.js';
import type { RegisteredAgent } from '../agent-registry.js';
import { wakeAgent } from './wakeup.js';
import { legacyWakeAdapter } from './poller.js';
import { launchTaskRunner, isRunner } from '../task-runner.js';

/** How an agent's API calls reach the node right now. Mirrors ServeDiscoveryAgent['transport']. */
export type ChannelTransport = 'tunnel' | 'direct' | 'auth_failed';

/**
 * THE ONE DOOR TO THE NODE FOR THIS IDENTITY, already carrying its name.
 *
 * A shared socket routes on a stamp saying whose call a frame is, and a bare `tunnel.forward()`
 * carries no stamp — so every call made that way is attributed to whichever identity opened the
 * socket. On a 62-agent fleet that was one agent right and sixty-one wrong, and it was invisible
 * for exactly as long as it took someone to look, because the one it was right for is the one
 * that answers when you test with a single agent.
 *
 * So the stamp is not a parameter a call site can forget. It is baked in here once, when the
 * identity gets its socket, and nothing below reaches past it.
 */
export type ChannelForward = (method: string, path: string, opts?: ForwardOptions) => Promise<ForwardResult>;

/**
 * Upper bound on a long-poll timer, matching the [0, 120s] clamp every /local route already applies
 * to `?wait`. Re-applied at each setTimeout so the timer duration is bounded HERE, not only at the
 * route parser — the caller could be new, and a timer whose length is a raw request value is a
 * resource-exhaustion sink (js/resource-exhaustion). 120s is the max legitimate long-poll.
 */
const MAX_WAIT_MS = 120_000;

export interface QueuedTask {
  task: Record<string, unknown>;
  via: 'deliver' | 'backlog';
  receivedAt: string;
}

type Waiter = (item: QueuedTask | null) => void;

/** A workspace record-change event pushed over the tunnel (`workspace.record` deliver). */
export interface QueuedRecord { event: Record<string, unknown>; receivedAt: string }
type RecordWaiter = (item: QueuedRecord | null) => void;

/** One (organism, ws, space) the agent subscribes to for record push. */
export interface SpaceRef { organism_id: string; ws: string; space: string }

/**
 * Per-agent push state. Fed by the tunnel's `deliver` (live) and `backlog`
 * (on-connect snapshot) frames; tasks are deduped by id across both sources so
 * a live-pushed-then-backlogged task fires the wake/runner/long-poll exactly
 * once per daemon lifetime. (Storage stays the source of truth — a consumer
 * that missed a long-poll window can always list tasks via the REST proxy.)
 */
export class AgentChannel {
  transportMode: ChannelTransport = 'direct';
  tunnel: ConnectTunnelClient | null = null;
  /**
   * Every call to the node for THIS identity goes through here, never through `tunnel.forward()`.
   * Null until the identity has a socket. See ChannelForward for why the stamp cannot be optional.
   */
  forward: ChannelForward | null = null;
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
  /** Wake watermark: `wakeSeq` advances on every wake-worthy event, `wakeSeen` on every report of
   *  one. The signal is edge-triggered on this pair and NEVER level-read from the queues: the daemon
   *  parked on /local/wake/next lists its work from the node store and does not drain the local task
   *  queue, so a queue-length check stays true forever after the first push and turns the idle wait
   *  into a hot loop (one stuck agent measured at 28 req/s and 76% node CPU). An event landing
   *  between the consumer's listing and its park still wakes it once: the counter already moved. */
  private wakeSeq = 0;
  private wakeSeen = 0;
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
      }, Math.min(waitMs, MAX_WAIT_MS));
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
      }, Math.min(waitMs, MAX_WAIT_MS));
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
        console.error(`[serve:${this.entry.agent}@${this.entry.owner}] runner launch failed for ${id}: ${(err as Error).message}`);
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
      }, Math.min(waitMs, MAX_WAIT_MS));
      this.waiters.push(waiter);
    });
  }

  /** Fire every pending unified-wake signal. One-shot: a `nextWake` waiter is removed once resolved.
   *  Called whenever ANY push source arrives (task/record/dm/message) so a consumer parked on
   *  /local/wake/next wakes on all of them, not just its single queue. Purely a SIGNAL — it does not
   *  consume anything; the woken cycle drains each queue + re-lists tasks/messages as usual. */
  private signalWake(): void {
    this.wakeSeq++;
    // Resolving a parked waiter IS the report; without this line the next park would fire again
    // for an event the consumer already woke on.
    if (this.wakeWaiters.length > 0) this.wakeSeen = this.wakeSeq;
    for (const w of this.wakeWaiters.splice(0)) w(true);
  }

  /** Unified long-poll SIGNAL: resolves true the instant any push source arrives (or arrived,
   *  unreported, before the park), or false after `waitMs`. Unlike nextTask/nextRecord/nextDm it does
   *  NOT consume — the caller drains the individual queues / re-lists from the node. One report per
   *  event: see the wakeSeq/wakeSeen comment. */
  nextWake(waitMs: number): Promise<boolean> {
    if (this.wakeSeq > this.wakeSeen) { this.wakeSeen = this.wakeSeq; return Promise.resolve(true); }
    if (waitMs <= 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const w = (woke: boolean) => { clearTimeout(timer); resolve(woke); };
      const timer = setTimeout(() => {
        const i = this.wakeWaiters.indexOf(w);
        if (i >= 0) this.wakeWaiters.splice(i, 1);
        resolve(false);
      }, Math.min(waitMs, MAX_WAIT_MS));
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

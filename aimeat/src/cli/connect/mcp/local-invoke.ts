/**
 * @file local-invoke.ts
 * @description The serve daemon's INVOKE surface: how a server-initiated tunnel `invoke` reaches a
 *   crew and how the crew's answer goes back as `invoke_result`. The node already had this frame
 *   for ecosystem apps (a bound GEAI answers it in-process); a crew is a separate Python process
 *   that talks to this daemon over loopback HTTP, so the frame is queued per agent and offered on
 *   the same long-poll shape tasks, records and DMs use:
 *     - `GET  /local/invoke/next?wait=ms[&agent=name]` — the next pending invoke, or 204
 *     - `POST /local/invoke/:id/result { ok, result }`   — the reply, forwarded over the tunnel
 *   What this is for: the node asks a running crew to VALIDATE or TRY a crew definition from the
 *   Crew tab without creating a task, a memory record or an offer. The first consumer is the
 *   crewaimeat JSON runtime (`crew.validate`, `crew.try`).
 *   Two things it decides so the node does not sit on a timeout:
 *     1. NO HANDLER. If no process has polled this agent's invoke queue recently (a parked long-poll
 *        counts), the daemon answers the node at once with `ok:false, result.code = NO_HANDLER`,
 *        so the UI can say "connected, but its runtime does not answer this" instead of waiting.
 *     2. EXPIRY. An invoke nobody collected within its `timeout_ms` is dropped, because the node has
 *        stopped waiting and a late answer would go nowhere.
 * @structure
 *   - PendingInvoke — one queued invoke as the consumer sees it
 *   - InvokeChannel — per-agent queue + waiters + handler liveness + reply forwarding
 *   - registerLocalInvokeRoutes(app, resolveAgent, channels) — the two loopback endpoints
 * @usage
 *   const inv = new InvokeChannel((id, ok, result) => tunnel.replyInvoke(id, ok, result));
 *   // tunnel client: onInvoke: (frame) => inv.handleInvoke(frame)
 *   registerLocalInvokeRoutes(app, resolveAgent, invokeChannels);
 * @version-history
 *   v1.0.1 — 2026-08-28 — SECURITY (CodeQL js/resource-exhaustion): the long-poll setTimeout is
 *     bounded at the timer (Math.min(waitMs, MAX_WAIT_MS)), matching the [0, 120s] clamp waitMsOf
 *     already applies, so the duration is capped for any caller, not only the current route.
 *   v1.0.0 — 2026-08-28 — Initial: invoke queue, NO_HANDLER fast reply, expiry, the two endpoints.
 */
import type { Express, Request, Response } from 'express';
import type { RegisteredAgent } from '../agent-registry.js';

/** Upper bound on a long-poll timer, matching the [0, 120s] clamp waitMsOf already applies. Re-applied
 *  at the setTimeout so the duration is bounded there, not only at the parser — a timer whose length
 *  is a raw request value is a resource-exhaustion sink (js/resource-exhaustion). */
const MAX_WAIT_MS = 120_000;

/** A server-initiated invoke, as handed to the consumer on `/local/invoke/next`. */
export interface PendingInvoke {
  id: string;
  capability: string;
  input: unknown;
  /** The principal on whose behalf the node asks (the owner's GHII for a Crew-tab button). */
  caller: string | null;
  /** How long the node waits for the answer, in ms; the daemon drops the invoke after that. */
  timeout_ms: number;
  received_at: string;
}

/** The frame fields the daemon reads off a tunnel `invoke`. */
export interface InvokeFrame {
  id?: string;
  capability?: string;
  input?: unknown;
  caller?: string;
  timeout_ms?: number;
}

type InvokeWaiter = (item: PendingInvoke | null) => void;

/** A consumer that has not polled for this long is treated as gone. The runtimes poll with
 *  `wait=25000`, so a live one is never more than a request apart; 90 s leaves room for a restart. */
export const INVOKE_HANDLER_STALE_MS = 90_000;
/** When the node sends no `timeout_ms` (an older node), assume its forward-request default. */
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

/**
 * Per-agent invoke queue. `handleInvoke` is fed by the tunnel client's `onInvoke`; `next` is the
 * long-poll read; `result` forwards the consumer's answer through `reply` (the tunnel's
 * `invoke_result`). A queued invoke is in flight until answered or expired; a reply for an unknown
 * id is refused so a late or duplicate answer cannot be attributed to a different call.
 */
export class InvokeChannel {
  private queue: PendingInvoke[] = [];
  private waiters: InvokeWaiter[] = [];
  private inflight = new Map<string, ReturnType<typeof setTimeout>>();
  private lastPollAt = 0;

  constructor(private readonly reply: (id: string, ok: boolean, result: unknown) => void) {}

  /** Is some process collecting this agent's invokes right now? A parked long-poll is proof. */
  hasHandler(now = Date.now()): boolean {
    return this.waiters.length > 0 || now - this.lastPollAt < INVOKE_HANDLER_STALE_MS;
  }

  /** A tunnel `invoke` arrived. Queue it for the consumer, or refuse at once when nobody is listening. */
  handleInvoke(frame: InvokeFrame): void {
    const id = typeof frame.id === 'string' ? frame.id : '';
    const capability = typeof frame.capability === 'string' ? frame.capability : '';
    if (!id || !capability) return;
    if (!this.hasHandler()) {
      this.reply(id, false, {
        code: 'NO_HANDLER',
        message: `No process is collecting "${capability}" calls for this agent right now. Its runtime has to be up and polling /local/invoke/next.`,
      });
      return;
    }
    const timeoutMs = Number.isFinite(frame.timeout_ms) && (frame.timeout_ms as number) > 0
      ? (frame.timeout_ms as number) : DEFAULT_INVOKE_TIMEOUT_MS;
    const item: PendingInvoke = {
      id,
      capability,
      input: frame.input ?? null,
      caller: typeof frame.caller === 'string' ? frame.caller : null,
      timeout_ms: timeoutMs,
      received_at: new Date().toISOString(),
    };
    // The node stops waiting at timeout_ms; after that a reply goes nowhere, so forget the call.
    const timer = setTimeout(() => {
      this.inflight.delete(id);
      const i = this.queue.findIndex(q => q.id === id);
      if (i >= 0) this.queue.splice(i, 1);
    }, timeoutMs);
    timer.unref?.();
    this.inflight.set(id, timer);
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.queue.push(item);
  }

  /** Long-poll: the next uncollected invoke, or null after `waitMs` with none. */
  next(waitMs: number): Promise<PendingInvoke | null> {
    this.lastPollAt = Date.now();
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise<PendingInvoke | null>((resolve) => {
      const waiter: InvokeWaiter = (item) => { clearTimeout(timer); this.lastPollAt = Date.now(); resolve(item); };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        this.lastPollAt = Date.now();
        resolve(null);
      }, Math.min(waitMs, MAX_WAIT_MS));
      this.waiters.push(waiter);
    });
  }

  /** The consumer's answer. False when the id is unknown (already answered, expired, or never ours). */
  result(id: string, ok: boolean, result: unknown): boolean {
    const timer = this.inflight.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.inflight.delete(id);
    this.reply(id, ok, result);
    return true;
  }

  /** How many invokes are queued or being worked on — for /local/status. */
  pendingCount(): number { return this.inflight.size; }

  drainWaiters(): void {
    for (const w of this.waiters.splice(0)) w(null);
    for (const timer of this.inflight.values()) clearTimeout(timer);
    this.inflight.clear();
    this.queue = [];
  }
}

function waitMsOf(req: Request): number {
  const raw = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
  return Math.min(Math.max(Number.isFinite(raw) ? raw : 25_000, 0), 120_000);
}

/** Mount the two loopback endpoints. `resolveAgent` is the daemon's shared `X-Aimeat-Agent` / `?agent=` resolver. */
export function registerLocalInvokeRoutes(
  app: Express,
  resolveAgent: (req: Request) => RegisteredAgent,
  channels: Map<string, InvokeChannel>,
): void {
  // GET /local/invoke/next?wait=ms[&agent=name] — long-poll for the next server-initiated invoke.
  app.get('/local/invoke/next', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const ch = channels.get(entry.gaii);
    if (!ch) { res.status(204).end(); return; }
    const item = await ch.next(waitMsOf(req));
    if (!item) { res.status(204).end(); return; }
    res.json({ ok: true, data: { agent: entry.agent, owner: entry.owner, ...item } });
  });

  // POST /local/invoke/:id/result { ok, result } — answer one invoke; forwarded as `invoke_result`.
  app.post('/local/invoke/:id/result', (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const id = req.params.id as string;
    const body = (req.body && typeof req.body === 'object') ? req.body as { ok?: unknown; result?: unknown } : {};
    const ok = body.ok === true;
    const ch = channels.get(entry.gaii);
    if (!ch || !ch.result(id, ok, body.result ?? null)) {
      res.status(404).json({ ok: false, error: { code: 'UNKNOWN_INVOKE', message: `No pending invoke "${id}" for ${entry.agent}. It was already answered, or the node stopped waiting.` } });
      return;
    }
    res.json({ ok: true, data: { id, answered: true } });
  });
}

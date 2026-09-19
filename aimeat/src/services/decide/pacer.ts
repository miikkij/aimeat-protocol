/**
 * @file src/services/decide/pacer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two brakes on how fast this node talks to the decision model.
 *
 *   A REQUESTS-PER-MINUTE WINDOW PER KEY. TypeSafe limits requests per minute per key and changes
 *   the number without notice. The node's own key is shared by everyone here, so without a window
 *   one owner's bulk run would spend the whole node's minute and everybody else would get 429s they
 *   did nothing to cause. The window is keyed by a hash of the key, never the key itself.
 *   A request over the window is refused at once with a wait the caller can honour, rather than
 *   queued: a queued request holds its state in memory, and a refusal holds nothing.
 *
 *   A CONCURRENCY GATE for runs over many records, so one run keeps at most N requests open. A
 *   cookbook of TypeSafe's hit their limit at eight workers on a shared key; the default is four.
 *
 *   Both are in-process. A node running several processes multiplies the window by the process
 *   count, which is the same trade the node's own HTTP rate limits already make.
 * @structure takeSlot(keyHash, perMinute, now?) · Semaphore
 * @usage
 *   const wait = takeSlot(hashOfKey, config.decideRequestsPerMinute);
 *   if (wait > 0) throw new DecideError('RATE_LIMITED', 429, ..., { retry_after_ms: wait });
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */

const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

/**
 * Take one request slot for this key. Returns 0 when taken, or the milliseconds until one frees.
 * Timestamps older than the window are dropped on every call, so the map holds at most one minute of
 * traffic per key.
 */
export function takeSlot(keyHash: string, perMinute: number, now: number = Date.now()): number {
  const stamps = (windows.get(keyHash) ?? []).filter(t => now - t < WINDOW_MS);
  if (stamps.length >= Math.max(1, perMinute)) {
    windows.set(keyHash, stamps);
    return WINDOW_MS - (now - stamps[0]!);
  }
  stamps.push(now);
  windows.set(keyHash, stamps);
  return 0;
}

/** For tests. */
export function resetPacer(): void { windows.clear(); }

/** A counting semaphore: at most `limit` holders at once, the rest wait in arrival order. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= Math.max(1, this.limit)) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

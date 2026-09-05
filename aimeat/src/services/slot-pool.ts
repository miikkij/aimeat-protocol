/**
 * @file src/services/slot-pool.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A counting semaphore with a wait line, used wherever this node has to bound how many
 *   of one kind of thing run at once.
 *
 *   WHY IT IS ITS OWN FILE. The primitive already existed, inline and private, inside Scheduler
 *   (a slot count, a running counter, a FIFO waiter list, acquireExtSlot/releaseExtSlot). It was
 *   written after the 2026-08-17 boot-memory trace, where one cron tick launched 13 jobs, several
 *   of them extension jobs that each open a QuickJS WASM sandbox; external memory spiked to ~570 MB
 *   and the concurrent peak became the process's permanent RSS floor. Two things were wrong with
 *   where it lived: AI jobs need the same primitive and would otherwise have grown a second copy,
 *   and a private field inside a 700-line class cannot be unit-tested at all.
 *
 *   TWO ORDERINGS, AND WHICH ONE TO ASK FOR. Plain FIFO is right for one node-wide queue of cheap
 *   jobs of the same kind: the extension pool wants exactly that, and gets it by acquiring without
 *   a lane. Round-robin by LANE is right when the queue is shared between people: the next free
 *   slot goes to the lane that has waited longest since its last start, so one person's burst of
 *   fifty does not leave another person's single job behind all of them. A per-lane concurrency cap
 *   would be the wrong way to get that fairness — it punishes someone with thirty apps for having
 *   thirty apps — which is why fairness lives in the ORDER here and nowhere else.
 * @structure
 *   - SlotAbortedError — a waiter that was cancelled while queued (never while running)
 *   - SlotPool — acquire(lane?, opts?) / release(lane?) / stats
 * @usage
 *   const pool = new SlotPool(2);                  // FIFO, one kind of work
 *   await pool.acquire(); try { … } finally { pool.release(); }
 *
 *   const jobs = new SlotPool(80);                 // round-robin between owners
 *   await jobs.acquire(ownerGhii, { signal });
 *   try { … } finally { jobs.release(ownerGhii); }
 * @version-history
 *   v1.0.0 — 2026-08-31 — Extracted from services/scheduler.ts (a pure move for the FIFO path), plus
 *     round-robin lanes and abortable waiting, which AI jobs need and the scheduler does not use.
 */

/** Thrown into an `acquire()` that was still WAITING when its signal fired. A running holder is
 *  never aborted this way: it has the slot, and only its own work knows how to stop. */
export class SlotAbortedError extends Error {
    constructor(message = 'waiting for a slot was aborted') {
        super(message);
        this.name = 'SlotAbortedError';
    }
}

interface Waiter {
    resolve: () => void;
    reject: (err: Error) => void;
    /** Removes the abort listener whichever way this waiter leaves the line. */
    cleanup: () => void;
}

/** The default lane, so a caller that does not care about fairness gets plain FIFO. */
const FIFO_LANE = '';

export interface SlotPoolStats {
    slots: number;
    running: number;
    waiting: number;
    lanes: number;
}

export class SlotPool {
    private readonly slots: number;
    private runningCount = 0;
    /** One FIFO queue per lane. A lane with no waiters is deleted, so `lanes` counts real ones. */
    private readonly queues = new Map<string, Waiter[]>();
    /**
     * When each lane last STARTED something, as a monotonic tick rather than a clock: the ordering
     * has to survive a coarse timer and two starts in the same millisecond, and nothing here needs
     * to know what time it is. A lane that has never started is absent, which sorts it first.
     */
    private readonly lastStart = new Map<string, number>();
    private tick = 0;

    constructor(slots: number) {
        this.slots = Math.max(1, Math.trunc(slots) || 1);
    }

    get capacity(): number { return this.slots; }
    get free(): number { return Math.max(0, this.slots - this.runningCount); }

    stats(): SlotPoolStats {
        let waiting = 0;
        for (const q of this.queues.values()) waiting += q.length;
        return { slots: this.slots, running: this.runningCount, waiting, lanes: this.queues.size };
    }

    /** How many are waiting in one lane (the per-owner brake reads this). */
    waitingIn(lane = FIFO_LANE): number {
        return this.queues.get(lane)?.length ?? 0;
    }

    /** How many are waiting across every lane (the node-wide brake reads this). */
    get waiting(): number {
        let n = 0;
        for (const q of this.queues.values()) n += q.length;
        return n;
    }

    /**
     * Where a job enqueued RIGHT NOW would sit: 0 when a slot is free and it starts at once,
     * otherwise its 1-based place in the whole wait line. Reported to a caller as `queue_position`,
     * which is a number we actually know — unlike an ETA, which would be invented.
     */
    positionIfEnqueued(): number {
        return this.free > 0 ? 0 : this.waiting + 1;
    }

    /**
     * Take a slot, waiting in `lane`'s queue when none is free.
     *
     * `opts.signal` cancels the WAIT, rejecting with SlotAbortedError and leaving the line without
     * having taken a slot. An already-aborted signal refuses before consuming one, so a cancelled
     * job cannot start by racing.
     */
    async acquire(lane = FIFO_LANE, opts?: { signal?: AbortSignal }): Promise<void> {
        if (opts?.signal?.aborted) throw new SlotAbortedError();

        if (this.runningCount < this.slots) {
            this.runningCount++;
            this.lastStart.set(lane, ++this.tick);
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const queue = this.queues.get(lane) ?? [];
            if (!this.queues.has(lane)) this.queues.set(lane, queue);

            const waiter: Waiter = {
                resolve,
                reject,
                cleanup: () => { opts?.signal?.removeEventListener('abort', onAbort); },
            };

            const onAbort = (): void => {
                const q = this.queues.get(lane);
                if (q) {
                    const at = q.indexOf(waiter);
                    if (at >= 0) q.splice(at, 1);
                    if (q.length === 0) this.queues.delete(lane);
                }
                waiter.cleanup();
                reject(new SlotAbortedError());
            };

            opts?.signal?.addEventListener('abort', onAbort, { once: true });
            queue.push(waiter);
        });

        // Woken by release(), which already counted the slot and stamped the lane — see there for
        // why the accounting happens on the waking side rather than here.
    }

    /**
     * Give the slot back and hand it to the next lane in turn.
     *
     * The lane argument is only for symmetry at the call site; which lane goes next is decided by
     * the wait line, not by who released. Releasing more than was acquired is a programming error
     * and is clamped rather than allowed to make the pool wider than its slot count.
     */
    release(_lane = FIFO_LANE): void {
        this.runningCount = Math.max(0, this.runningCount - 1);

        const lane = this.nextLane();
        if (lane === null) return;

        const queue = this.queues.get(lane)!;
        const waiter = queue.shift()!;
        if (queue.length === 0) this.queues.delete(lane);

        // Counted HERE, before the waiter runs. A woken waiter resumes on a later microtask, and a
        // gap between "the slot is free" and "the waiter has taken it" is a gap two releases can
        // both walk through, which is how a pool of 2 runs 3.
        this.runningCount++;
        this.lastStart.set(lane, ++this.tick);
        waiter.cleanup();
        waiter.resolve();
    }

    /**
     * The lane that has waited longest since its last start. Never started sorts first, then oldest
     * start; ties break on lane name so the choice is deterministic and a unit test can state it.
     */
    private nextLane(): string | null {
        let best: string | null = null;
        let bestStamp = Number.POSITIVE_INFINITY;
        for (const [lane, queue] of this.queues) {
            if (queue.length === 0) continue;
            const stamp = this.lastStart.get(lane) ?? -1;
            if (stamp < bestStamp || (stamp === bestStamp && best !== null && lane < best)) {
                best = lane;
                bestStamp = stamp;
            }
        }
        return best;
    }
}

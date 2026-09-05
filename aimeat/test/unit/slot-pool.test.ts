/**
 * @file test/unit/slot-pool.test.ts
 * @description The concurrency guard, asked the questions it could not be asked while it was a
 *   private field inside Scheduler: does it ever run more than its slot count, is one lane FIFO,
 *   does a contended queue go round-robin between lanes, and does a cancelled waiter leave the line
 *   without taking a slot on its way out.
 *
 *   The round-robin question is the one with a cost behind it: with plain FIFO, one owner's burst of
 *   fifty leaves another owner's single job behind all fifty of them.
 * @usage pnpm test -- slot-pool
 * @version-history
 *   v1.0.0 — 2026-08-31 — Written with the extraction.
 */
import { describe, it, expect } from 'vitest';
import { SlotPool, SlotAbortedError } from '../../src/services/slot-pool.js';

/** Let every already-resolved microtask run, so a woken waiter has actually resumed. */
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('SlotPool', () => {
    it('hands out at most its slot count at once', async () => {
        const pool = new SlotPool(2);
        await pool.acquire();
        await pool.acquire();
        expect(pool.stats().running).toBe(2);
        expect(pool.free).toBe(0);

        let third = false;
        const waiting = pool.acquire().then(() => { third = true; });
        await settle();
        expect(third).toBe(false);
        expect(pool.waiting).toBe(1);

        pool.release();
        await waiting;
        expect(third).toBe(true);
        expect(pool.stats().running).toBe(2);
    });

    it('never lets two releases wake three holders (the count is taken on the waking side)', async () => {
        const pool = new SlotPool(1);
        await pool.acquire();
        const order: number[] = [];
        const a = pool.acquire().then(() => order.push(1));
        const b = pool.acquire().then(() => order.push(2));

        pool.release();
        await settle();
        // Exactly one woke; the other is still waiting, and running never exceeded 1.
        expect(order).toEqual([1]);
        expect(pool.stats().running).toBe(1);

        pool.release();
        await a; await b;
        expect(order).toEqual([1, 2]);
    });

    it('is FIFO within one lane', async () => {
        const pool = new SlotPool(1);
        await pool.acquire('alice');
        const seen: string[] = [];
        const p1 = pool.acquire('alice').then(() => seen.push('first'));
        const p2 = pool.acquire('alice').then(() => seen.push('second'));
        const p3 = pool.acquire('alice').then(() => seen.push('third'));

        pool.release('alice'); await settle();
        pool.release('alice'); await settle();
        pool.release('alice'); await settle();
        await Promise.all([p1, p2, p3]);
        expect(seen).toEqual(['first', 'second', 'third']);
    });

    it('goes round-robin between lanes rather than FIFO across them', async () => {
        // alice queues three, then bob queues one. Plain FIFO would run bob fourth; round-robin
        // runs bob second, which is the whole reason this pool is not the scheduler's.
        const pool = new SlotPool(1);
        await pool.acquire('alice');

        const seen: string[] = [];
        const a1 = pool.acquire('alice').then(() => seen.push('alice-1'));
        const a2 = pool.acquire('alice').then(() => seen.push('alice-2'));
        const a3 = pool.acquire('alice').then(() => seen.push('alice-3'));
        const b1 = pool.acquire('bob').then(() => seen.push('bob-1'));

        for (let i = 0; i < 4; i++) { pool.release(); await settle(); }
        await Promise.all([a1, a2, a3, b1]);

        expect(seen[0]).toBe('bob-1');
        expect(seen.slice(1)).toEqual(['alice-1', 'alice-2', 'alice-3']);
    });

    it('reports the position a job enqueued now would take', async () => {
        const pool = new SlotPool(2);
        expect(pool.positionIfEnqueued()).toBe(0);
        await pool.acquire('a');
        expect(pool.positionIfEnqueued()).toBe(0);
        await pool.acquire('a');
        expect(pool.positionIfEnqueued()).toBe(1);
        void pool.acquire('b');
        expect(pool.positionIfEnqueued()).toBe(2);
    });

    it('counts waiters per lane, which is what a per-owner brake reads', async () => {
        const pool = new SlotPool(1);
        await pool.acquire('alice');
        void pool.acquire('alice');
        void pool.acquire('alice');
        void pool.acquire('bob');
        expect(pool.waitingIn('alice')).toBe(2);
        expect(pool.waitingIn('bob')).toBe(1);
        expect(pool.waiting).toBe(3);
    });

    it('lets a queued waiter be cancelled, and it takes no slot on the way out', async () => {
        const pool = new SlotPool(1);
        await pool.acquire('alice');
        const controller = new AbortController();
        const cancelled = pool.acquire('alice', { signal: controller.signal });
        const after = pool.acquire('alice');

        controller.abort();
        await expect(cancelled).rejects.toBeInstanceOf(SlotAbortedError);
        expect(pool.waitingIn('alice')).toBe(1);

        pool.release('alice');
        await after;
        expect(pool.stats().running).toBe(1);
    });

    it('refuses an already-aborted acquire without consuming a free slot', async () => {
        const pool = new SlotPool(2);
        const controller = new AbortController();
        controller.abort();
        await expect(pool.acquire('alice', { signal: controller.signal })).rejects.toBeInstanceOf(SlotAbortedError);
        expect(pool.stats().running).toBe(0);
        expect(pool.free).toBe(2);
    });
});

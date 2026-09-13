/**
 * @file sdk-live-gate-trailing.test.ts
 * @description AIMEAT.live.subscribe's gate delivers the last change of a burst. Two holes in the
 *   aimeat-live v1.1.0 gate (appdev pitfall memory-live-events-are-a-firehose, verified 2026-09-13):
 *   minIntervalMs DROPPED an event inside the interval with no trailing call, so the final change of a
 *   burst never reached the subscriber, the opposite of what the doc sends update-sensitive views to
 *   it for; and with keyPrefix an event that arrived while a count probe was in flight was dropped
 *   and never re-probed, so a key written during the probe was missed until some unrelated write.
 *   Only the client half is fixed here: the SSE frame still carries a domain name and no key.
 *
 *   The lib is browser ESM with module state, so each test imports a fresh copy against a fake
 *   EventSource and a fake session, and drives the clock with fake timers.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let sources: Array<{ onopen?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void; close: () => void }>;
let counts: number[];
let countCalls: number;
let pendingCount: Array<(v: unknown) => void>;
let holdCounts: boolean;
const realBroadcastChannel = (globalThis as any).BroadcastChannel;

beforeEach(() => {
    // Node has BroadcastChannel and Web Locks, so the lib would elect a leader through a lock that a
    // previous test's copy still holds and never open a stream. One tab, no sharing: the lib's own
    // fallback path.
    (globalThis as any).BroadcastChannel = undefined;
    vi.useFakeTimers();
    vi.resetModules();
    sources = [];
    counts = [];
    countCalls = 0;
    pendingCount = [];
    holdCounts = false;
    const g = globalThis as any;
    const session = {
        fetch: async (path: string) => {
            if (path === '/v1/events/ticket') return { ok: true, data: { ticket: 't' } };
            if (path.startsWith('/v1/memory?')) {
                const reply = { ok: true, data: { count: counts[Math.min(countCalls, counts.length - 1)] } };
                countCalls++;
                if (holdCounts) return new Promise(res => pendingCount.push(() => res(reply)));
                return reply;
            }
            return { ok: false };
        },
    };
    g.EventSource = class {
        onopen?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void;
        constructor() { sources.push(this as any); }
        close() {}
    };
    g.document = { hidden: false, addEventListener() {}, querySelector: () => null };
    g.CustomEvent = g.CustomEvent ?? class { type: string; detail: unknown; constructor(t: string, i?: { detail?: unknown }) { this.type = t; this.detail = i?.detail; } };
    g.window = { AIMEAT: { auth: { getSession: () => session } }, addEventListener() {}, dispatchEvent() {} };
});

afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).BroadcastChannel = realBroadcastChannel;
});

async function live() {
    await import('../../src/static/sdk-libs/live/index.js');
    return (globalThis as any).window.AIMEAT.live;
}

/** Let the ticket fetch resolve and the EventSource be created. */
async function connected() {
    await vi.advanceTimersByTimeAsync(0);
    expect(sources.length, 'no EventSource was opened').toBeGreaterThan(0);
    return sources[sources.length - 1];
}

function frame(src: { onmessage?: (e: { data: string }) => void }, domains: string[]) {
    src.onmessage!({ data: JSON.stringify({ domains }) });
}

describe('minIntervalMs', () => {
    it('delivers a change that arrives inside the interval once the interval has passed', async () => {
        const fn = vi.fn();
        (await live()).subscribe(['memory'], fn, { minIntervalMs: 5000 });
        const src = await connected();

        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);   // the lib's own 1 s debounce
        expect(fn).toHaveBeenCalledTimes(1);

        frame(src, ['memory']);                    // the last change of the burst
        await vi.advanceTimersByTimeAsync(1000);
        expect(fn, 'fired again inside the interval').toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5000);
        expect(fn, 'the last change was never delivered').toHaveBeenCalledTimes(2);
    });

    it('folds a whole burst inside the interval into ONE trailing call', async () => {
        const fn = vi.fn();
        (await live()).subscribe(['memory'], fn, { minIntervalMs: 5000 });
        const src = await connected();
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);
        for (let i = 0; i < 4; i++) { frame(src, ['memory']); await vi.advanceTimersByTimeAsync(1100); }
        await vi.advanceTimersByTimeAsync(10000);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('calls nothing after the subscriber has unsubscribed', async () => {
        const fn = vi.fn();
        const off = (await live()).subscribe(['memory'], fn, { minIntervalMs: 5000 });
        const src = await connected();
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);
        off();
        await vi.advanceTimersByTimeAsync(10000);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('keyPrefix', () => {
    it('probes again when a change arrived while a probe was in flight', async () => {
        const fn = vi.fn();
        (await live()).subscribe(['memory'], fn, { keyPrefix: 'crews.' });
        const src = await connected();

        counts = [3, 3, 4];                        // baseline 3; the in-flight probe still reads 3; the key lands
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);   // first event records the baseline
        expect(fn).not.toHaveBeenCalled();

        holdCounts = true;
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);   // probe #2 goes out and waits
        expect(pendingCount).toHaveLength(1);

        frame(src, ['memory']);                    // the new key's own event, during the probe
        await vi.advanceTimersByTimeAsync(1000);
        holdCounts = false;
        pendingCount.splice(0).forEach(release => release(undefined));
        await vi.advanceTimersByTimeAsync(0);

        expect(countCalls, 'no second probe after the one in flight').toBe(3);
        expect(fn, 'the key written during the probe was missed').toHaveBeenCalledTimes(1);
    });

    it('stays quiet when the count did not move', async () => {
        const fn = vi.fn();
        (await live()).subscribe(['memory'], fn, { keyPrefix: 'crews.' });
        const src = await connected();
        counts = [3];
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);
        frame(src, ['memory']);
        await vi.advanceTimersByTimeAsync(1000);
        expect(fn).not.toHaveBeenCalled();
    });
});

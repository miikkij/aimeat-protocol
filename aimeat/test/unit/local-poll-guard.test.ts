/**
 * @file local-poll-guard.test.ts
 * @description The refusal a loopback long-poll gives when it cannot name its agent must be PACED,
 *   because the condition never resolves on its own and a caller loops on it.
 *
 *   crewaimeat counted 14,627 abandoned polls from exactly this: an instant 400, retried with no
 *   backoff. Our five long-polls had the same fast path. What is asserted here is the pacing and
 *   that the refusal still says the same thing — a slower refusal that has lost its message would
 *   trade one defect for another.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/local-poll-guard.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { pollWaitMs, refuseUnknownAgent, REFUSAL_FLOOR_MS } from '../../src/cli/connect/mcp/local-poll-guard.js';

function fakeRes() {
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = {
        writableEnded: false,
        set(k: string, v: string) { sent.headers[k] = v; return res; },
        status(code: number) { sent.status = code; return res; },
        json(body: unknown) { sent.body = body; res.writableEnded = true; return res; },
    };
    return { res: res as unknown as Response, sent };
}

const reqWith = (wait?: string) => ({ query: wait === undefined ? {} : { wait } }) as unknown as Request;

describe('the wait a long-poll reads', () => {
    it('defaults to 25s and clamps to [0, 120s]', () => {
        expect(pollWaitMs(reqWith())).toBe(25_000);
        expect(pollWaitMs(reqWith('nonsense'))).toBe(25_000);
        expect(pollWaitMs(reqWith('-5'))).toBe(0);
        expect(pollWaitMs(reqWith('999999'))).toBe(120_000);
        expect(pollWaitMs(reqWith('3000'))).toBe(3_000);
    });
});

describe('refusing a poll that cannot name its agent', () => {
    it('holds for the floor before answering, so a retry loop cannot run hot', async () => {
        vi.useFakeTimers();
        try {
            const { res, sent } = fakeRes();
            const done = refuseUnknownAgent(res, new Error('Agent x is not loaded'), 25_000);

            // Nothing yet: this is the whole point.
            await Promise.resolve();
            expect(sent.status).toBeUndefined();

            await vi.advanceTimersByTimeAsync(REFUSAL_FLOOR_MS);
            await done;
            expect(sent.status).toBe(400);
        } finally {
            vi.useRealTimers();
        }
    });

    it('still says exactly what is wrong, and sets Retry-After', async () => {
        vi.useFakeTimers();
        try {
            const { res, sent } = fakeRes();
            const done = refuseUnknownAgent(res, new Error("'concierge' is the name of more than one agent"), 25_000);
            await vi.advanceTimersByTimeAsync(REFUSAL_FLOOR_MS);
            await done;
            expect((sent.body as any).error.code).toBe('UNKNOWN_AGENT');
            expect((sent.body as any).error.message).toContain('more than one agent');
            expect(sent.headers['Retry-After']).toBe('1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('never holds a caller longer than the caller asked to wait', async () => {
        vi.useFakeTimers();
        try {
            const { res, sent } = fakeRes();
            const done = refuseUnknownAgent(res, new Error('nope'), 200);
            await vi.advanceTimersByTimeAsync(200);
            await done;
            expect(sent.status).toBe(400);
        } finally {
            vi.useRealTimers();
        }
    });

    it('answers immediately when the caller asked for no wait at all', async () => {
        const { res, sent } = fakeRes();
        await refuseUnknownAgent(res, new Error('nope'), 0);
        expect(sent.status).toBe(400);
    });

    it('says nothing when the caller already hung up', async () => {
        const { res, sent } = fakeRes();
        (res as any).writableEnded = true;
        await refuseUnknownAgent(res, new Error('nope'), 0);
        expect(sent.status).toBeUndefined();
    });
});

/**
 * @file local-poll-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refusal a long-poll gives when it cannot tell WHICH agent is asking, paced so
 *   that a caller looping on it cannot become a hot loop.
 *
 *   THE SHAPE, which crewaimeat met first. They found 14,627 abandoned polls against shared
 *   infrastructure: an invoke poll that returned 400 immediately and was retried with no backoff.
 *   Ours had the same shape in five places. `/local/tasks/next`, `/local/wake/next`,
 *   `/local/records/next`, `/local/dm/next` and `/local/invoke/next` each begin by resolving
 *   `X-Aimeat-Agent`, and each answered a failure INSTANTLY — no wait, whatever `?wait=` asked
 *   for. A caller whose loop is "poll, handle, poll again" then spins at the speed of the loopback.
 *
 *   What makes it a hot loop rather than a blip is that every one of these failures is PERSISTENT:
 *   the header names an agent this connector has not loaded, or names a bare name two owners share,
 *   or names nothing while more than one account is connected. No amount of retrying fixes any of
 *   them — the caller's configuration has to change. So the fast path is a loop with no exit.
 *
 *   Two of those conditions are new since 2026-09-01, and that is why this is ours to fix now: a
 *   bare name shared by two owners used to resolve silently to whichever loaded first, and now it
 *   refuses by name. Refusing is right. Refusing in under a millisecond, forever, is not.
 *
 *   THE PACING. The refusal is unchanged in status and in wording — a caller still learns exactly
 *   what is wrong. It is simply held for a floor first, so the worst case is about one request per
 *   second instead of thousands. A long-poll's contract is already "this may take up to `wait`",
 *   so a second of latency surprises nobody, and a caller that asked for LESS than the floor is
 *   held only for what it asked. `Retry-After` says the same thing to a client that reads headers.
 *
 *   This paces our own doors. It does not make a caller correct: a runtime that ignores both the
 *   status and the header still polls once a second forever, and the fix for that is its config.
 * @structure REFUSAL_FLOOR_MS · pollWaitMs() · refuseUnknownAgent()
 * @usage
 *   try { entry = resolveAgent(req); }
 *   catch (err) { await refuseUnknownAgent(res, err, waitMs); return; }
 * @version-history
 *   v1.0.0 — 2026-09-02 — Added after crewaimeat's 14,627 abandoned polls, when the same shape
 *     turned out to sit on all five of our loopback long-polls.
 */
import type { Request, Response } from 'express';

/**
 * How long this long-poll should wait, from `?wait=`: 25s by default, clamped to [0, 120s]. One
 * copy, because four routes had the same two lines and a refusal now has to read the same number.
 */
export function pollWaitMs(req: Request): number {
    const raw = typeof req.query.wait === 'string' ? parseInt(req.query.wait, 10) : NaN;
    return Math.min(Math.max(Number.isFinite(raw) ? raw : 25_000, 0), 120_000);
}

/**
 * How long an unresolvable long-poll is held before it is refused. One second turns an unbounded
 * spin into ~1 req/s while staying far under any caller's own timeout.
 */
export const REFUSAL_FLOOR_MS = 1_000;

/**
 * Refuse a long-poll that could not name its agent, after a pause.
 *
 * `waitMs` is what the caller asked to wait: a caller that wanted less than the floor gets its own
 * (shorter) wait, because holding a request longer than it asked is its own kind of wrong.
 */
export async function refuseUnknownAgent(res: Response, err: unknown, waitMs: number): Promise<void> {
    const hold = Math.max(0, Math.min(REFUSAL_FLOOR_MS, waitMs));
    if (hold > 0) await new Promise(resolve => setTimeout(resolve, hold));
    // The socket may be gone: a caller that gave up during the hold is the normal case, not an error.
    if (res.writableEnded) return;
    res.set('Retry-After', '1');
    res.status(400).json({
        ok: false,
        error: { code: 'UNKNOWN_AGENT', message: (err as Error).message },
    });
}

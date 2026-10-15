/**
 * @file src/services/extension-run-deadline.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The wall-clock deadline of one extension run (QA audit S7-02). The CPU limit
 *   (limits.timeoutMs) is a QuickJS interrupt handler, which the engine calls only while guest code
 *   runs, so a script that awaits a promise that never settles ran for ever, and the scheduler's slot
 *   it held was never released. extension-runtime.ts races every run against this deadline.
 * @structure EXTENSION_RUN_TIMED_OUT · extensionWallClockMs(limits) · untilAborted(p, signal, reason)
 * @usage
 *   const deadline = AbortSignal.timeout(extensionWallClockMs(limits));
 *   const value = await untilAborted(promise, deadline, () => new Error(EXTENSION_RUN_TIMED_OUT));
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S7-02).
 */
import type { ExtensionLimits } from './extension-ctx-contract.js';

/** The start of the message a run gets when its wall-clock deadline passes. */
export const EXTENSION_RUN_TIMED_OUT = 'Extension run timed out';

/**
 * The wall-clock limit of one run: the limit's own value, or twelve times the CPU limit, at least one
 * minute. A run waits on host calls (a fetch may take up to min(timeout_ms, 30 s) each), so the wall
 * clock is wider than the CPU limit; it is what ends a run that waits for ever.
 */
export function extensionWallClockMs(limits: Pick<ExtensionLimits, 'timeoutMs' | 'wallClockMs'>): number {
    if (typeof limits.wallClockMs === 'number' && limits.wallClockMs > 0) return limits.wallClockMs;
    return Math.max(60_000, limits.timeoutMs * 12);
}

/**
 * `p`, or a rejection with `reason()` as soon as `signal` aborts, whichever comes first. The listener
 * is removed when `p` settles, so a run that finished leaves nothing behind to reject later.
 */
export function untilAborted<T>(p: Promise<T>, signal: AbortSignal, reason: () => Error): Promise<T> {
    if (signal.aborted) return Promise.reject(reason());
    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(reason());
        signal.addEventListener('abort', onAbort, { once: true });
        p.then(
            v => { signal.removeEventListener('abort', onAbort); resolve(v); },
            e => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
    });
}

/**
 * @file src/services/extension-runtime-tracking.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Memory access tracking for a sandbox run: wraps `ctx.memory` so the reads and
 *   writes an action made can be logged afterwards (the scheduler records them per run).
 *   A pure extraction from extension-runtime.ts at the max-file-lines boundary; the code is
 *   unchanged from its v1.1.0 (2026-03-15) form plus the getVersioned read added on 2026-08-23.
 * @structure MemoryAccessLog · trackMemoryAccess(ctx) → { ctx, accessLog }
 * @usage
 *   const tracked = trackMemoryAccess(baseCtx);
 *   await executeExtensionAction(script, tracked.ctx, input, limits);
 *   log(tracked.accessLog.reads, tracked.accessLog.writes);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Moved out of extension-runtime.ts when ctx.workspace took it past 800 lines.
 */
import type { ExtensionCtx } from './extension-runtime.js';

export interface MemoryAccessLog {
    reads: string[];
    writes: string[];
}

export function trackMemoryAccess(ctx: ExtensionCtx): { ctx: ExtensionCtx; accessLog: MemoryAccessLog } {
    const accessLog: MemoryAccessLog = { reads: [], writes: [] };
    const origMemory = ctx.memory;

    const trackedMemory: ExtensionCtx['memory'] = {
        get: async (key) => {
            accessLog.reads.push(key);
            return origMemory.get(key);
        },
        // A compare-and-swap reads the version before it writes, and that read is a read: leaving it
        // out would make a CAS loop look like a write with no input.
        getVersioned: async (key) => {
            accessLog.reads.push(key);
            return origMemory.getVersioned(key);
        },
        set: async (key, value, opts) => {
            accessLog.writes.push(key);
            return origMemory.set(key, value, opts);
        },
        search: async (prefix, opts) => {
            accessLog.reads.push(`${prefix}*`);
            return origMemory.search(prefix, opts);
        },
        delete: async (key) => {
            accessLog.writes.push(`-${key}`);
            return origMemory.delete(key);
        },
        getPublic: async (namespace, key) => {
            accessLog.reads.push(`${namespace}:${key}`);
            return origMemory.getPublic(namespace, key);
        },
    };

    return {
        ctx: { ...ctx, memory: trackedMemory },
        accessLog,
    };
}

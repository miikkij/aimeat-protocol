/**
 * @file test/unit/slow-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A real storage whose reads answer a few milliseconds late, for the tests that fire two
 *   read-then-write operations at the same moment (the atomic-write fixes of 2026-10-18).
 *
 *   WHY. Two calls started with Promise.all interleave only where one of them waits; on SQLite the
 *   driver answers at once, so the first call often reads and writes before the second reads, and a
 *   test of an unconditional write passes by luck (docs/pitfalls.md, better-sqlite3 entry). The pause
 *   AFTER each read is a timer, so every call that is in flight reads before any of them writes, on
 *   both backends. The pause is the window two node processes have between their read and their
 *   write; it changes when a write happens, never what it does.
 *
 *   `counts` tells how many times each method was called, for the tests that count a side effect
 *   (a task made, a message read).
 * @structure slowReads(storage, ms?) → { storage, counts }
 * @usage const { storage: slow } = slowReads(storage); await Promise.all([op(slow), op(slow)]);
 * @version-history
 *   2026-10-18 — Initial (atomic-write fixes, group G4).
 */
import type { Storage } from '../../src/storage/interface.js';

const READS = new Set(['getMemory', 'listMemory', 'listMemoryMeta']);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function slowReads<S extends Storage>(storage: S, ms = 15): { storage: S; counts: Map<string, number> } {
    const counts = new Map<string, number>();
    const proxy = new Proxy(storage, {
        get(target, prop) {
            const v = Reflect.get(target, prop, target) as unknown;
            if (typeof v !== 'function') return v;
            const name = String(prop);
            const fn = v as (...args: unknown[]) => unknown;
            return async (...args: unknown[]) => {
                counts.set(name, (counts.get(name) ?? 0) + 1);
                const out = await fn.apply(target, args);
                if (READS.has(name)) await sleep(ms);
                return out;
            };
        },
    });
    return { storage: proxy as S, counts };
}

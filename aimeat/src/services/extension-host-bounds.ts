/**
 * @file src/services/extension-host-bounds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Bounds on the host memory one extension run can hold through its host calls. The
 *   sandbox's memory limit covers the guest only; an answer ctx.fetch reads is buffered in the
 *   node's own heap and off-heap memory until the call settles, and a script may start every one of
 *   its host calls at once without awaiting them.
 *
 *   FETCHES ARE QUEUED, NOT REFUSED. Many-source collectors start their fetches together, and they
 *   keep doing so: a run holds at most the operator's in-flight budget of answer buffers
 *   (extensions.fetch_inflight_mb, 128 MB by default; slots = that budget divided by the run's
 *   per-answer ceiling, at least one), and a call past the slots waits for one to free. The wait ends
 *   with the run's own deadline or teardown signal. With the defaults and the 4 MB ceiling a run has
 *   32 fetches in flight; with the 32 MB ceiling, 4. A budget of 0 is no limit: every call starts at once.
 *
 *   A PUBLIC READ BY OWNER NAME LOADS ONE ROW. ctx.memory.getPublic with a bare owner name resolves
 *   through that owner's agents; it listed every record of every agent under the key as a prefix,
 *   values included (every record at all for an empty key), and then kept the exact key.
 *   agentRecordByKey finds the holder from metadata and reads that one record.
 * @structure EXT_FETCH_INFLIGHT_BYTES · createFetchGate(capBytes, budgetMb) · withFetchGate(gate, fetch) ·
 *   agentRecordByKey(storage, owner, key)
 * @usage const gate = createFetchGate(deps.capabilities.fetchMaxBytes, config.extensionFetchInflightMb);
 *   ctx.fetch = withFetchGate(gate, async (url, opts, host) => { ... });
 * @version-history
 *   v1.1.0 — 2026-10-25 — The in-flight budget is the operator setting extensions.fetch_inflight_mb
 *     (createFetchGate's budgetMb), 0 being no limit; EXT_FETCH_INFLIGHT_BYTES stays as its default
 *     (secaudit2026oct22, lead 782).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { OUTBOUND_READ_MAX_BYTES } from '../utils/read-capped.js';
import { EXT_FETCH_INFLIGHT_MB_DEFAULT } from '../config-extension-load.js';

/** The most answer bytes one run's fetches may hold in flight together when the setting is absent. */
export const EXT_FETCH_INFLIGHT_BYTES = EXT_FETCH_INFLIGHT_MB_DEFAULT * 1024 * 1024;

export interface FetchGate {
    /** Fetches this run may have in flight at once. */
    readonly slots: number;
    /** Wait for a slot; resolves with its release. Rejects when `signal` aborts while waiting. */
    acquire(signal?: AbortSignal): Promise<() => void>;
}

/**
 * A FIFO gate sized so `slots` answers of `capBytes` (the run's per-answer ceiling) fit in `budgetMb`
 * megabytes (extensions.fetch_inflight_mb; EXT_FETCH_INFLIGHT_BYTES when absent). A budget of 0 is
 * no limit: every call gets a slot at once.
 */
export function createFetchGate(capBytes: number = OUTBOUND_READ_MAX_BYTES, budgetMb?: number): FetchGate {
    const budgetBytes = typeof budgetMb === 'number' && Number.isFinite(budgetMb) && budgetMb >= 0
        ? budgetMb * 1024 * 1024 : EXT_FETCH_INFLIGHT_BYTES;
    const slots = budgetBytes === 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(budgetBytes / Math.max(1, capBytes)));
    let inFlight = 0;
    const waiting: Array<() => void> = [];
    const release = (): void => {
        const next = waiting.shift();
        if (next) next(); else inFlight--;
    };
    return {
        slots,
        acquire(signal) {
            if (signal?.aborted) return Promise.reject(signal.reason);
            if (inFlight < slots) { inFlight++; return Promise.resolve(once(release)); }
            return new Promise((resolve, reject) => {
                const grant = (): void => { signal?.removeEventListener('abort', onAbort); resolve(once(release)); };
                const onAbort = (): void => {
                    const i = waiting.indexOf(grant);
                    if (i >= 0) waiting.splice(i, 1);
                    reject(signal!.reason);
                };
                waiting.push(grant);
                signal?.addEventListener('abort', onAbort, { once: true });
            });
        },
    };
}

function once(fn: () => void): () => void {
    let done = false;
    return () => { if (!done) { done = true; fn(); } };
}

/** `fetch` behind `gate`: the slot is held from the request until the answer has been read. */
export function withFetchGate<F extends (url: string, opts?: never, host?: { signal?: AbortSignal }) => Promise<unknown>>(
    gate: FetchGate, fetch: F,
): F {
    const call = fetch as unknown as (url: string, opts: unknown, host?: { signal?: AbortSignal }) => Promise<unknown>;
    return (async (url: string, opts: unknown, host?: { signal?: AbortSignal }) => {
        const release = await gate.acquire(host?.signal);
        try { return await call(url, opts, host); } finally { release(); }
    }) as unknown as F;
}

/**
 * The record under exactly `key` of the first of `owner`'s agents that holds one, in the order
 * getAgentsByOwner gives, whatever its visibility (the caller decides what may leave). Metadata
 * finds the holders; only their record is read.
 */
export async function agentRecordByKey(storage: Storage, owner: string, key: string): Promise<MemoryRecord | null> {
    if (!key) return null;
    const agents = await storage.getAgentsByOwner(owner);
    if (!agents.length) return null;
    const metas = await storage.listMemoryMetaForOwners(agents.map(a => a.gaii), { prefix: key });
    const holders = new Set(metas.filter(m => m.key === key).map(m => m.ownerGaii));
    for (const agent of agents) {
        if (!holders.has(agent.gaii)) continue;
        const record = await storage.getMemory(agent.gaii, key);
        if (record) return record;
    }
    return null;
}

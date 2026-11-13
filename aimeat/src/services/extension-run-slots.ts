/**
 * @file src/services/extension-run-slots.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide pool of extension runs started by a request (POST /v1/ext/..., the MCP
 *   tool aimeat_extension_invoke, a visitor on a public action), and one account's share of it.
 *
 *   WHY. A sandbox run executes in the node's own thread and holds up to its memory limit while it
 *   waits for host calls. The scheduler admits its runs through a two-slot pool (scheduler.ts); a
 *   request-driven run had no bound, so one account could stack runs until the node stalled for
 *   everyone (secaudit2026oct22, lead 817, decision A2-817 recommendation a). A run past the pool or
 *   past the account's share is answered at once with a retryable refusal (503 with Retry-After), not
 *   queued: the caller's client retries, and nothing waits inside the node.
 *
 *   BOTH NUMBERS ARE OPERATOR SETTINGS, read on every take: extensions.run_slots (64 by default) and
 *   extensions.run_slots_per_account (16 by default); 0 is no limit on either. The account is the owner
 *   GHII, so an owner's agents and apps share one share; a visitor is counted per client, keyed as the
 *   visitor rate limiter keys it (visitorRunShareKey). PER PROCESS, as the rate limiters are
 *   (rate-buckets.ts).
 * @structure RunSlotTurn · EXT_RUN_RETRY_AFTER_SEC · takeExtensionRunSlot(config, account) · runSlotsInUse()
 *   · waitExtensionRunSlot(config, account, opts) · visitorRunShareKey(ip) · SELLER_RUNS_PER_RUN · createRunQueue(max)
 * @usage
 *   const slot = takeExtensionRunSlot(config, ownerGhiiOf(caller.gaii));
 *   if (!slot.ok) return refuse(503, slot.code, slot.message, slot.retryAfterSec);
 *   try { ... run ... } finally { slot.release(); }
 * @version-history
 *   v1.3.0 — 2026-10-31 — waitExtensionRunSlot: an AI call served by an extension provider takes a slot
 *     too, and waits for one rather than being refused (secaudit2026oct31w2 round 10, W2-16).
 *   v1.2.0 — 2026-10-27 — createRunQueue and SELLER_RUNS_PER_RUN: the seller runs one buying run's
 *     ctx.buy calls start go at most four at once, the rest queued (secaudit2026oct26).
 *   v1.1.0 — 2026-10-27 — visitorRunShareKey: a visitor's share is keyed by IPv6 /64, as the visitor
 *     rate limiter keys it; it was the full address, so one /64 could hold the whole pool
 *     (secaudit2026oct26).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 817).
 */
import type { AimeatConfig } from '../config.js';
import { EXT_RUN_SLOTS_DEFAULT, EXT_RUN_SLOTS_PER_ACCOUNT_DEFAULT } from '../config/extension-load.js';
import { ipRateKey } from '../middleware/rate-limit.js';

/** Seconds a refused caller is told to wait: a run ends within seconds, so a short wait is enough. */
export const EXT_RUN_RETRY_AFTER_SEC = 2;

export type RunSlotTurn =
    | { ok: true; release: () => void }
    | { ok: false; code: 'EXTENSION_RUNS_BUSY'; message: string; retryAfterSec: number };

let inUse = 0;
const byAccount = new Map<string, number>();
/** Callers of waitExtensionRunSlot parked until a slot is released. Each one tries again when woken. */
const slotWaiters = new Set<() => void>();

/** Request-driven runs in progress on this node now. */
export function runSlotsInUse(): number {
    return inUse;
}

/**
 * Take one slot for a run on behalf of `account` (an owner GHII, or `visitor:<address>`), or answer
 * the refusal that names the setting which is full. The release is idempotent.
 */
export function takeExtensionRunSlot(config: AimeatConfig, account: string): RunSlotTurn {
    const nodeMax = config.extensionRunSlots ?? EXT_RUN_SLOTS_DEFAULT;
    const accountMax = config.extensionRunSlotsPerAccount ?? EXT_RUN_SLOTS_PER_ACCOUNT_DEFAULT;
    const held = byAccount.get(account) ?? 0;
    if (accountMax > 0 && held >= accountMax) {
        return busy(`This account already has ${accountMax} extension runs in progress, the most one account may have at once `
            + `(the operator setting extensions.run_slots_per_account). Try again in ${EXT_RUN_RETRY_AFTER_SEC} seconds.`);
    }
    if (nodeMax > 0 && inUse >= nodeMax) {
        return busy(`This server already has ${nodeMax} extension runs in progress, the most it runs at once `
            + `(the operator setting extensions.run_slots). Try again in ${EXT_RUN_RETRY_AFTER_SEC} seconds.`);
    }
    inUse++;
    byAccount.set(account, held + 1);
    let released = false;
    return {
        ok: true,
        release: () => {
            if (released) return;
            released = true;
            inUse--;
            const left = (byAccount.get(account) ?? 1) - 1;
            if (left > 0) byAccount.set(account, left); else byAccount.delete(account);
            for (const wake of [...slotWaiters]) wake();
        },
    };
}

/**
 * A slot for a run whose caller is already waiting on the node for its answer (an AI call served by
 * an extension provider), taken as takeExtensionRunSlot takes it; when the pool or the account's
 * share is full, the caller waits until a run ends, at most `maxWaitMs` or until `signal` aborts, and
 * then gets the same refusal takeExtensionRunSlot gives. A waiting caller holds no sandbox, and how
 * many can wait is bounded by the per-account AI call rate (secaudit2026oct31w2 round 10, W2-16).
 */
export async function waitExtensionRunSlot(
    config: AimeatConfig, account: string, opts: { maxWaitMs: number; signal?: AbortSignal },
): Promise<RunSlotTurn> {
    const deadline = Date.now() + opts.maxWaitMs;
    for (;;) {
        const turn = takeExtensionRunSlot(config, account);
        if (turn.ok || opts.signal?.aborted || Date.now() >= deadline) return turn;
        await new Promise<void>((resolve) => {
            const wake = (): void => {
                clearTimeout(timer);
                slotWaiters.delete(wake);
                opts.signal?.removeEventListener('abort', wake);
                resolve();
            };
            const timer = setTimeout(wake, Math.max(0, deadline - Date.now()));
            slotWaiters.add(wake);
            opts.signal?.addEventListener('abort', wake, { once: true });
        });
    }
}

/**
 * The share a visitor (no sign-in) on a public action is counted under: the client as the visitor
 * rate limiter keys it, an IPv6 address by its /64 network (ipRateKey), so one host does not hold
 * many shares by rotating its 64 host bits. An IPv4-mapped address (::ffff:a.b.c.d) is its IPv4
 * address, so every IPv4 visitor of a dual-stack socket keeps a share of its own.
 */
export function visitorRunShareKey(ip: string | undefined): string {
    const mapped = ip ? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip) : null;
    return `visitor:${ipRateKey(mapped ? mapped[1] : ip)}`;
}

/**
 * Seller runs one buying run may have going at once. A seller action ctx.buy starts runs inside its
 * buyer's slot ('inherited'), so a script that starts many purchases together started as many
 * sandboxes; past this number a purchase waits its turn, and none is refused (secaudit2026oct26).
 */
export const SELLER_RUNS_PER_RUN = 4;

/** A FIFO queue that runs at most `max` pieces of work at once. Nothing is refused. */
export function createRunQueue(max: number): <T>(work: () => Promise<T>) => Promise<T> {
    let running = 0;
    const waiting: Array<() => void> = [];
    const next = (): void => {
        if (running >= max) return;
        const start = waiting.shift();
        if (start) { running++; start(); }
    };
    return <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
        waiting.push(() => {
            work().then(resolve, reject).finally(() => { running--; next(); });
        });
        next();
    });
}

function busy(message: string): RunSlotTurn {
    return { ok: false, code: 'EXTENSION_RUNS_BUSY', message, retryAfterSec: EXT_RUN_RETRY_AFTER_SEC };
}

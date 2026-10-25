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
 *   GHII, so an owner's agents and apps share one share; a visitor is counted per client address.
 *   PER PROCESS, as the rate limiters are (rate-buckets.ts).
 * @structure RunSlotTurn · EXT_RUN_RETRY_AFTER_SEC · takeExtensionRunSlot(config, account) · runSlotsInUse()
 * @usage
 *   const slot = takeExtensionRunSlot(config, ownerGhiiOf(caller.gaii));
 *   if (!slot.ok) return refuse(503, slot.code, slot.message, slot.retryAfterSec);
 *   try { ... run ... } finally { slot.release(); }
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 817).
 */
import type { AimeatConfig } from '../config.js';
import { EXT_RUN_SLOTS_DEFAULT, EXT_RUN_SLOTS_PER_ACCOUNT_DEFAULT } from '../config-extension-load.js';

/** Seconds a refused caller is told to wait: a run ends within seconds, so a short wait is enough. */
export const EXT_RUN_RETRY_AFTER_SEC = 2;

export type RunSlotTurn =
    | { ok: true; release: () => void }
    | { ok: false; code: 'EXTENSION_RUNS_BUSY'; message: string; retryAfterSec: number };

let inUse = 0;
const byAccount = new Map<string, number>();

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
        },
    };
}

function busy(message: string): RunSlotTurn {
    return { ok: false, code: 'EXTENSION_RUNS_BUSY', message, retryAfterSec: EXT_RUN_RETRY_AFTER_SEC };
}

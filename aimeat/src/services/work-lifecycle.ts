/**
 * @file src/services/work-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Accepting and delivering one work item, once, for every surface that can do it.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/work/:tc/accept` and `POST /v1/work/:tc/deliver` were one
 *   implementation, and `aimeat_work_accept` / `aimeat_work_deliver` were a second, thinner one. The
 *   two agreed on the status write and on nothing else around it:
 *
 *     - THE WORK-TO-TASK BRIDGE. Accepting over HTTP calls createTaskFromWork(), which gives an agent
 *       running the task system a queued task with the two todos it drives the job from. The tool
 *       skipped it, so an agent that accepted its work over MCP, which is the door an agent actually
 *       uses, had nothing in its task list to work off.
 *     - THE CALLBACK WEBHOOK. A requester who passes `callback_url` is told when the delivery lands.
 *       The tool never fired it, so the same delivery notified the requester over HTTP and left them
 *       waiting over MCP. The callback is the whole async channel for a requester that is not
 *       sitting on the node.
 *     - THE EXTENSION HOOKS. `post_settlement` and `post_work_delivery` let an installed extension
 *       act on a completed job (accounting, reputation, a downstream trigger). Neither ran on the MCP
 *       path, so an extension was live on one door and blind on the other.
 *
 *   The refusals were a second disagreement: "Work not found" / "Not your work item" / "Cannot
 *   accept: status is X" against the HTTP door's NOT_FOUND / ACCESS_DENIED / CONFLICT with the codes
 *   a caller can branch on. The HTTP wording is the one with tests and users, so it is what both
 *   doors now say.
 *
 *   fireWebhook() lives here rather than in the route because delivery fires it and delivery is
 *   shared; routes/work.ts imports it back for the in_progress notification.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - fireWebhook() / getWebhookLog() — webhook POST with exponential backoff, plus its recent log
 *   - acceptWork() — provider + status check, the accepted write, the task bridge
 *   - deliverWork() — provider + status check, settlement, the delivered write, callback, hooks
 * @usage
 *   const out = await acceptWork({ storage, config }, providerGaii, trackingCode);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8): the accept/deliver write moved out of
 *     src/mcp/core.ts and src/routes/work.ts into one place.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, WorkRecord } from '../storage/interface.js';
import { settlePayment } from './morsel.js';
import { createTaskFromWork } from './work-task-bridge.js';
import { emitChange } from './event-bus.js';
import { fireHook } from '../utils/fire-hook.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

export interface WorkDeps {
    storage: Storage;
    config: AimeatConfig;
}

export type WorkLifecycleResult =
    | { ok: true; work: WorkRecord }
    | { ok: false; status: number; code: string; message: string };

/** Webhook delivery log entry (in-memory, recent deliveries only). */
export interface WebhookLogEntry {
    url: string;
    trackingCode: string;
    event: string;
    attempt: number;
    status: 'success' | 'failed' | 'retrying';
    httpStatus?: number;
    error?: string;
    timestamp: string;
}
const webhookLog: WebhookLogEntry[] = [];
const MAX_WEBHOOK_LOG = 500;

/** Get recent webhook delivery log entries. */
export function getWebhookLog(): WebhookLogEntry[] {
    return webhookLog;
}

/**
 * Webhook POST with exponential backoff (§10.7).
 * Retries up to maxRetries times with delays: 1s, 2s, 4s, 8s, 16s, ...
 */
export function fireWebhook(url: string, payload: Record<string, unknown>, maxRetries: number): void {
    const body = JSON.stringify(payload);
    const event = (payload.event as string) ?? 'unknown';
    const trackingCode = (payload.tracking_code as string) ?? '';
    const doFetch = (attempt: number) => {
        // safeFetch validates the URL AND re-validates every redirect hop (throws `Fetch blocked: …` on a
        // blocked host/hop), so a caller-supplied webhook URL cannot 3xx-bounce to an internal target.
        // A blocked URL surfaces in the .catch below alongside network errors (both = a failed delivery).
        safeFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(10_000),
        }).then(resp => {
            const entry: WebhookLogEntry = {
                url, trackingCode, event, attempt,
                status: resp.ok ? 'success' : 'failed',
                httpStatus: resp.status,
                timestamp: new Date().toISOString(),
            };
            if (!resp.ok && attempt < maxRetries) {
                entry.status = 'retrying';
            }
            webhookLog.push(entry);
            if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.splice(0, webhookLog.length - MAX_WEBHOOK_LOG);
            if (!resp.ok && attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                setTimeout(() => doFetch(attempt + 1), delay);
            }
        }).catch(err => {
            const entry: WebhookLogEntry = {
                url, trackingCode, event, attempt,
                status: attempt < maxRetries ? 'retrying' : 'failed',
                error: String(err),
                timestamp: new Date().toISOString(),
            };
            webhookLog.push(entry);
            if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.splice(0, webhookLog.length - MAX_WEBHOOK_LOG);
            logger.warn(`Webhook delivery failed (attempt ${attempt}/${maxRetries})`, { url, error: String(err) });
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                setTimeout(() => doFetch(attempt + 1), delay);
            }
        });
    };
    doFetch(1);
}

/**
 * Load the work item and rule on the caller: the provider of record is the only principal that can
 * move it, and only from the statuses the transition allows.
 */
async function loadForProvider(
    storage: Storage,
    providerGaii: string,
    trackingCode: string,
    allowedStatuses: string[],
    verb: string,
): Promise<{ ok: true; work: WorkRecord } | { ok: false; status: number; code: string; message: string }> {
    const work = await storage.getWork(trackingCode);
    if (!work) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Work item not found: ${trackingCode}` };
    }
    if (work.providerGaii !== providerGaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: `Only the provider can ${verb} work` };
    }
    if (!allowedStatuses.includes(work.status)) {
        return { ok: false, status: 409, code: 'CONFLICT', message: `Work is in status "${work.status}", cannot ${verb}` };
    }
    return { ok: true, work };
}

/**
 * Accept a pending work item as its provider.
 *
 * The task bridge runs on a best-effort basis: an agent with no directives has no task system, and a
 * bridge failure must not undo an acceptance that already stored.
 */
export async function acceptWork(
    { storage }: WorkDeps,
    providerGaii: string,
    trackingCode: string,
): Promise<WorkLifecycleResult> {
    const loaded = await loadForProvider(storage, providerGaii, trackingCode, ['pending'], 'accept');
    if (!loaded.ok) return loaded;
    const work = loaded.work;

    const updated = await storage.updateWork(trackingCode, {
        status: 'accepted',
        updatedAt: new Date().toISOString(),
    });

    // Auto-create task if agent has task system enabled
    await createTaskFromWork(storage, work, work.providerGaii).catch(err =>
        logger.warn('work-task-bridge: failed to create task', { tc: work.trackingCode, err: (err as Error).message })
    );

    emitChange('work');
    return { ok: true, work: updated! };
}

/**
 * Deliver an accepted or in-progress work item as its provider: settle the escrow, store the output,
 * tell the requester's callback, and let extensions see a finished job.
 */
export async function deliverWork(
    { storage, config }: WorkDeps,
    providerGaii: string,
    trackingCode: string,
    output: Record<string, unknown> | undefined,
): Promise<WorkLifecycleResult> {
    const loaded = await loadForProvider(storage, providerGaii, trackingCode, ['accepted', 'in_progress'], 'deliver');
    if (!loaded.ok) return loaded;
    const work = loaded.work;

    // Settle: pay provider, network fee, burn
    await settlePayment(storage, config, work);

    // Extension hook: post_settlement (fire-and-forget)
    fireHook(config, storage, 'post_settlement', {
        tracking_code: trackingCode, provider_gaii: work.providerGaii, requester_gaii: work.requesterGaii,
        cost: work.cost,
    });

    const updated = await storage.updateWork(trackingCode, {
        status: 'delivered',
        output,
        updatedAt: new Date().toISOString(),
    });

    // Fire callback webhook if provided (fire-and-forget)
    if (work.callbackUrl) {
        fireWebhook(work.callbackUrl, {
            event: 'work.delivered',
            tracking_code: trackingCode,
            status: 'delivered',
            output,
            timestamp: new Date().toISOString(),
        }, config.webhookMaxRetries);
    }

    // Extension hook: post_work_delivery (fire-and-forget)
    fireHook(config, storage, 'post_work_delivery', {
        tracking_code: trackingCode, provider_gaii: work.providerGaii, requester_gaii: work.requesterGaii,
    });

    emitChange('work');
    return { ok: true, work: updated! };
}

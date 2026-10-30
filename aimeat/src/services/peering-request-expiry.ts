/**
 * @file src/services/peering-request-expiry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A peering request another node left here expires when the operator has not answered it
 *   in federation.peering_request_days (30 by default, 0 never). An expired request is deleted.
 *
 *   WHY. POST /v1/federation/peer/introduce takes no sign-in and leaves a pending row for the operator.
 *   Round 8 bounded how many one address leaves per hour; nothing ever took an old one away, so the
 *   table only grew (secaudit2026oct26, unbounded-unauthenticated-pending-peering-requests).
 *
 *   WHICH ROWS. Only `pending` requests that ARRIVED: `fromNodeId` is another node. A request this node
 *   sent (POST /v1/federation/peer/request, `fromNodeId` is this node) is the operator's own record and
 *   stays. An approved, rejected or revoked request is an answer, and stays.
 *
 *   WHEN. There is no clock job: every place that reads or acts on a pending request asks here first,
 *   so no path sees or approves an expired one. The introduction route sweeps before it stores a new
 *   row, the operator's list and overview sweep before they read, and the decision and status routes
 *   ask about the one request they handle.
 * @structure peeringRequestExpired() · sweepExpiredPeeringRequests() · expiredRequestMessage()
 * @usage
 *   await sweepExpiredPeeringRequests(storage, config);
 *   if (peeringRequestExpired(request, config)) { await storage.deletePeeringRequest(request.id); ... }
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, federation-06).
 */
import type { Storage } from '../storage/interface.js';
import type { PeeringRequestRecord } from '../storage/types/organisms-federation.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 86_400_000;

type ExpiryConfig = { nodeId: string; federationPeeringRequestDays: number };

/** Is this an arrived, unanswered request older than the setting allows? Never with the setting at 0. */
export function peeringRequestExpired(r: PeeringRequestRecord, config: ExpiryConfig, now: number = Date.now()): boolean {
    const days = config.federationPeeringRequestDays;
    if (!(days > 0) || r.status !== 'pending' || r.fromNodeId === config.nodeId) return false;
    const made = Date.parse(r.createdAt);
    return Number.isFinite(made) && made < now - days * DAY_MS;
}

/** Delete every expired request. Returns the ids deleted. A failed delete is logged and left for the next sweep. */
export async function sweepExpiredPeeringRequests(storage: Storage, config: ExpiryConfig, now: number = Date.now()): Promise<string[]> {
    if (!(config.federationPeeringRequestDays > 0)) return [];
    const gone: string[] = [];
    for (const r of await storage.listPeeringRequests('pending')) {
        if (!peeringRequestExpired(r, config, now)) continue;
        try {
            if (await storage.deletePeeringRequest(r.id)) gone.push(r.id);
        } catch (err) {
            logger.warn('An expired peering request could not be deleted; the next sweep tries again', { id: r.id, error: String(err) });
        }
    }
    if (gone.length) logger.info(`Peering requests expired after ${config.federationPeeringRequestDays} days without an answer: ${gone.length} deleted`, { ids: gone });
    return gone;
}

/** What the decision and status routes say about a request that expired. */
export function expiredRequestMessage(id: string, days: number): string {
    return `Peering request ${id} expired: nobody answered it in ${days} days, so it was deleted. The node can introduce itself again.`;
}

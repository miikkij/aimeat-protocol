/**
 * @file src/routes/federation-peer/promotion.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Peer promotion-eligibility metrics helper (Phase B). Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-10-11 — protocolVersion is left unstated instead of a hard-coded 'v1'; the
 *     version comparison in utils/protocol-version.ts reads a missing value as v1.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Storage } from '../../storage/interface.js';
import type { PeerInfo } from '../../services/federation.js';
import type { PromotionMetrics } from '../../services/network-policy.js';
import { logger } from '../../utils/logger.js';

/** Build the measurable metrics for a peer's promotion eligibility (Phase B). */
export async function promotionMetrics(storage: Storage, peer: PeerInfo, allWork?: { status: string; providerGaii: string; requesterGaii: string }[]): Promise<PromotionMetrics> {
    const daysActive = (Date.now() - new Date(peer.addedAt).getTime()) / 86_400_000;
    let successfulWork = 0;
    try {
        const work = allWork ?? (await storage.listAllWork() as unknown as { status: string; providerGaii: string; requesterGaii: string }[]);
        const done = new Set(['completed', 'delivered']);
        const suffix = `@${peer.nodeId}`;
        successfulWork = work.filter(w => done.has(w.status) && (String(w.providerGaii).endsWith(suffix) || String(w.requesterGaii).endsWith(suffix))).length;
    } catch (err) { logger.warn('daysActive: none', { error: String(err) }); }
    return {
        availabilityPct: peer.availabilityPct ?? null,
        daysActive,
        successfulWork,
        // Persistent advisory flag store is out of scope for Phase B — a `suspend` advisory
        // instead structurally demotes a member back to visiting (see federation-sync.ts).
        activeFlags: 0,
        signedIntroduce: !!peer.publicKey,
        // No peer states a protocol version yet (discovery gains protocol_version with AIMEAT Core
        // 2026-11). Unstated reads as v1 inside the comparison, so nothing here claims one for it.
        protocolVersion: undefined,
        nodeUrl: peer.url,
    };
}

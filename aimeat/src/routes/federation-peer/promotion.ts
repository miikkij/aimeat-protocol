/**
 * @file src/routes/federation-peer/promotion.ts
 * @description Peer promotion-eligibility metrics helper (Phase B). Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Storage } from '../../storage/interface.js';
import type { PeerInfo } from '../../services/federation.js';
import type { PromotionMetrics } from '../../services/network-policy.js';

/** Build the measurable metrics for a peer's promotion eligibility (Phase B). */
export async function promotionMetrics(storage: Storage, peer: PeerInfo, allWork?: { status: string; providerGaii: string; requesterGaii: string }[]): Promise<PromotionMetrics> {
    const daysActive = (Date.now() - new Date(peer.addedAt).getTime()) / 86_400_000;
    let successfulWork = 0;
    try {
        const work = allWork ?? (await storage.listAllWork() as unknown as { status: string; providerGaii: string; requesterGaii: string }[]);
        const done = new Set(['completed', 'delivered']);
        const suffix = `@${peer.nodeId}`;
        successfulWork = work.filter(w => done.has(w.status) && (String(w.providerGaii).endsWith(suffix) || String(w.requesterGaii).endsWith(suffix))).length;
    } catch { /* none */ }
    return {
        availabilityPct: peer.availabilityPct ?? null,
        daysActive,
        successfulWork,
        // Persistent advisory flag store is out of scope for Phase B — a `suspend` advisory
        // instead structurally demotes a member back to visiting (see federation-sync.ts).
        activeFlags: 0,
        signedIntroduce: !!peer.publicKey,
        protocolVersion: 'v1',
        nodeUrl: peer.url,
    };
}

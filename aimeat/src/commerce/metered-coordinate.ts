/**
 * @file src/commerce/metered-coordinate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The metered coordinate a checkout line is sold under. Moved out of
 *   commerce/session-service.ts, unchanged, when that file passed 800 lines.
 * @structure meteredCoordinateOf(sellable)
 * @version-history
 *   v1.1.0 — 2026-10-18 — A subscription line is sold under (extension, `subscription`) (Comicland v3 A-5).
 *   v1.0.0 — 2026-10-16 — Moved from session-service.ts.
 */
import type { Sellable } from './types.js';

/**
 * The metered coordinate a checkout line is sold under, or null when it has none.
 *
 * A beneficiary split is declared against the same `(ext, action)` pair a contract is keyed on, so
 * a purchase made through checkout has to resolve to that same pair or the seller's declared split
 * would apply on one route and be silently skipped on the other. Agent offers have no such
 * coordinate today and return null, which means their revenue is not split.
 */
export function meteredCoordinateOf(sellable: Sellable): { ext: string; action: string } | null {
  if (sellable.kind === 'app-tool') {
    return { ext: `apptool:${sellable.sellerOwner}/${sellable.agentName}`, action: sellable.offerId };
  }
  if (sellable.kind === 'ext-call') {
    return { ext: sellable.agentName, action: sellable.offerId };
  }
  // Every plan of one extension shares one coordinate; each plan names its own payees (subscriptions.ts).
  if (sellable.kind === 'subscription') {
    return { ext: sellable.agentName, action: 'subscription' };
  }
  return null;
}

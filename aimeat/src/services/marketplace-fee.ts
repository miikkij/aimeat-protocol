/**
 * @file src/services/marketplace-fee.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The marketplace fee policy shared by every morsel sale flow (offer invoke,
 *   commerce checkout, app-store purchase, EE org sales): which percent applies and where the
 *   fee goes. Two destinations — `operator` credits the node operator's GHII (a real income
 *   stream, recorded as a `marketplace_fee` transaction) and `burn` removes the morsels from
 *   supply (recorded as a `burn` transaction; before this service fees vanished with no record).
 *   Both are config-driven: AIMEAT_MARKETPLACE_FEE_MODE + AIMEAT_OPERATOR_FEE_ACCOUNT +
 *   AIMEAT_COMMERCE_FEE_PERCENT (inherits AIMEAT_MARKETPLACE_TX_FEE_PERCENT when unset).
 * @structure commerceFeePercent · resolveOperatorFeeGhii · settleMarketplaceFee ·
 *   resetOperatorFeeCache (multi-node test seam)
 * @usage
 *   const fee = percentFee(price, commerceFeePercent(config)); // from ../commerce/money.js
 *   await settleMarketplaceFee(storage, config, { fee, payerGhii, trackingCode, source: 'commerce' });
 * @version-history
 *   v1.0.1 — 2026-07-14 — Usage example points at the money.ts chokepoint (percentFee), not an inline formula
 *   v1.0.0 — 2026-07-13 — Initial fee policy service (TARGET-033 phase 2)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** The commerce checkout fee percent — its own knob, inheriting the marketplace percent when unset. */
export function commerceFeePercent(config: AimeatConfig): number {
  return config.commerceFeePercent ?? config.marketplaceTransactionFeePercent ?? 5;
}

// Operator lookup cache, keyed per node id (federation tests boot several nodes in one process).
const operatorCache = new Map<string, string | null>();

/** Test seam: forget resolved operator accounts (embedded servers re-registering owners). */
export function resetOperatorFeeCache(): void {
  operatorCache.clear();
}

/**
 * The GHII that receives operator-mode fees: the explicit AIMEAT_OPERATOR_FEE_ACCOUNT owner if
 * set, otherwise the first owner holding the `operator` role. Null when neither exists (a node
 * with no operator yet) — the caller falls back to burn so morsels never vanish unrecorded.
 */
export async function resolveOperatorFeeGhii(storage: Storage, config: AimeatConfig): Promise<string | null> {
  if (config.operatorFeeAccount) return `${config.operatorFeeAccount}@${config.nodeId}`;
  const cached = operatorCache.get(config.nodeId);
  if (cached !== undefined) return cached;
  const owners = await storage.listOwners();
  const op = owners.find((o) => o.roles?.includes('operator'));
  const ghii = op ? `${op.name}@${config.nodeId}` : null;
  operatorCache.set(config.nodeId, ghii);
  return ghii;
}

export interface FeeSettlement {
  fee: number;
  destination: 'operator' | 'burn' | 'none';
  operatorGhii: string | null;
}

/**
 * Route an already-computed fee to its configured destination. The seller was credited
 * `price - fee` by the caller; this handles the fee leg only. Never throws — a fee-routing
 * problem must not fail a sale that already settled.
 */
export async function settleMarketplaceFee(
  storage: Storage,
  config: AimeatConfig,
  args: { fee: number; payerGhii: string; trackingCode: string; source: string },
): Promise<FeeSettlement> {
  const { fee, payerGhii, trackingCode, source } = args;
  if (fee <= 0) return { fee: 0, destination: 'none', operatorGhii: null };
  const now = new Date().toISOString();
  try {
    if ((config.marketplaceFeeMode ?? 'operator') === 'operator') {
      const operatorGhii = await resolveOperatorFeeGhii(storage, config);
      if (operatorGhii) {
        await storage.creditBalance(operatorGhii, fee);
        await storage.addTransaction({
          id: `tx-${randomUUID()}`, gaii: operatorGhii, type: 'marketplace_fee', amount: fee,
          counterpartyGaii: payerGhii, trackingCode: `${trackingCode}:${source}`, timestamp: now,
        });
        return { fee, destination: 'operator', operatorGhii };
      }
    }
    await storage.addTransaction({
      id: `tx-${randomUUID()}`, gaii: payerGhii, type: 'burn', amount: -fee,
      trackingCode: `${trackingCode}:${source}`, timestamp: now,
    });
    return { fee, destination: 'burn', operatorGhii: null };
  } catch {
    return { fee, destination: 'none', operatorGhii: null };
  }
}

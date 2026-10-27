/**
 * @file src/commerce/platform-fee.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's platform fee on a MONEY sale, recorded as a receivable memory record, and
 *   the commerce memory-record upsert it shares with the checkout. Extracted from session-service.ts so
 *   the money accrual rail (services/entitlement-money.ts) can record the fee without importing the
 *   checkout, which itself charges pacing through services/metered-settlement.ts: the three formed an
 *   import cycle once the checkout charged pacing.
 * @structure putRecord · sumPlatformFees · recordMoneyPlatformFee
 * @usage
 *   await recordMoneyPlatformFee(storage, config, { fee, currency, sellerGhii, buyerGhii, trackingCode, handler });
 * @version-history
 *   2026-10-27 — sumPlatformFees: the dashboard's total counts only records this module writes, in a
 *     person's namespace with a positive numeric fee (secaudit2026oct26).
 *   v1.0.0 — 2026-10-11 — Moved from commerce/session-service.ts, unchanged.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveOperatorFeeGhii } from '../services/marketplace-fee.js';
import { isValidGHII } from '../utils/gaii.js';

/** Upsert one memory record (the same shape every service-side writer in the codebase uses). */
export async function putRecord(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const existing = await storage.getMemory(ownerGaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii, value: value as Record<string, unknown>, visibility: 'owner', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/**
 * Record the operator's platform fee on a MONEY sale (never touches the morsel ledger). Stored as
 * a memory record under the operator's GHII (or the seller's, if no operator resolves) so the admin
 * dashboard can total the operator's real-money cut per currency.
 *
 * `mode` says whether the fee has been COLLECTED or is still OWED, and on this node every money fee
 * is owed. It read `connect` for the Stripe handler, which described the removed EE Connect platform
 * that routed an application fee out of the card charge. That platform went with the 2026-07-28
 * refactor: there is no node-level Stripe key and the seller is merchant of record, so the fee is
 * never deducted from the charge (see `commerce/stripe-handler.ts`). The label survived and told the
 * dashboard the money had been taken when nobody had invoiced it. A fee that has to be collected out
 * of band is a `receivable` whichever rail carried the sale.
 */
/**
 * The operator's money platform fees per currency, from `commerce.platform-fee.*` records read across
 * every namespace (GET /v1/admin/dashboard). Counts what recordMoneyPlatformFee writes and nothing
 * else: a record in a person's namespace (the operator's fee account, or the seller's when no operator
 * resolves), never an agent's or an ecosystem app's, with a currency and a positive finite fee. A record
 * an agent wrote into its own namespace, a negative fee or a fee given as text moved the figure, and a
 * text fee turned it into a concatenated string (secaudit2026oct26,
 * routes/admin.ts:dashboard:any-namespace-platform-fee-records). The prefix is service-owned from the
 * same change (utils/reserved-keys.ts), so no memory route writes a new one.
 */
export function sumPlatformFees(records: ReadonlyArray<{ ownerGaii: string; value: unknown }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    if (!isValidGHII(r.ownerGaii)) continue;
    const v = r.value as { fee?: unknown; currency?: unknown } | null | undefined;
    if (typeof v?.currency !== 'string' || !v.currency) continue;
    if (typeof v.fee !== 'number' || !Number.isFinite(v.fee) || v.fee <= 0) continue;
    out[v.currency] = (out[v.currency] ?? 0) + v.fee;
  }
  return out;
}

export async function recordMoneyPlatformFee(
  storage: Storage,
  config: AimeatConfig,
  args: { fee: number; currency: string; sellerGhii: string; buyerGhii: string; trackingCode: string; handler: string },
): Promise<void> {
  const operatorGhii = await resolveOperatorFeeGhii(storage, config);
  const ownerGhii = operatorGhii ?? args.sellerGhii;
  const mode = 'receivable';
  await putRecord(storage, ownerGhii, `commerce.platform-fee.${args.trackingCode}`, {
    fee: args.fee, currency: args.currency, mode, handler: args.handler,
    sellerGhii: args.sellerGhii, buyerGhii: args.buyerGhii, trackingCode: args.trackingCode,
    at: new Date().toISOString(),
  });
}

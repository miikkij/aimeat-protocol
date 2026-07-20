/**
 * @file src/routes/extensions/paywall.ts
 * @description Per-call paywall for raw extension invokes (design: dev-organism notes doc-r6tyr3o,
 *   roadmap rm-commercial-raw-calls). Enforced by the NODE (not the sandbox) before the action runs,
 *   because only the node sees both wallets + the PSP handlers. Governing invariants:
 *     M1 — morsels are REVENUE (credited to owner) ONLY via `commercial.payMorsels`; `tollMorsels`
 *          and ctx.wallet.consume are burns (never credit the owner).
 *     Owner-free — the ext owner (caller.owner === ext.installedBy) always calls free, no toll.
 *     No-mint — every debit/credit is a positive finite integer; atomic ops; refund on script throw.
 *   Money (`commercial.payMoney`): the caller settles a checkout (kind 'ext-call'), receives a
 *   one-time token, and retries with `x-aimeat-pay-token`; the paywall verifies + consumes it (D1/D3).
 * @structure enforcePaywall · PaywallOutcome
 * @version-history
 *   v1.2.0 — 2026-07-20 — EXCHANGE G2: consult a durable metered entitlement (budget + rake) before the token/morsel channels (TARGET-045)
 *   v1.1.0 — 2026-07-17 — Money channel: consume the one-time ext-pay token (D1/D3) instead of 402-stub
 *   v1.0.0 — 2026-07-17 — Initial (Phase 2: owner-free + toll + morsel payment; money → 402)
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { ExtensionRecord } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';
import { consumeExtPayToken } from '../../services/ext-pay-token.js';
import { settleViaEntitlement } from './entitlement-gate.js';
import { logger } from '../../utils/logger.js';

type ExtAction = ExtensionRecord['actions'][number];

/**
 * Result of the paywall. `ok:false` means a response has already been sent (402/500) — the caller
 * must `return`. `refund` (when present) reverses a collected payment; the invoke handler calls it
 * if the sandbox script throws AFTER payment (M1/no-mint: money never leaves without delivery).
 */
export interface PaywallOutcome {
  ok: boolean;
  refund?: () => Promise<void>;
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && Number.isFinite(v);

/**
 * Gate a raw extension invoke. Order: owner-free → anti-abuse toll (burn) → free (no commercial) →
 * money token (Phase 3; currently 402) → morsel payment (atomic debit-caller + credit-owner).
 */
export async function enforcePaywall(args: {
  config: AimeatConfig;
  storage: Storage;
  ext: ExtensionRecord;
  action: ExtAction;
  callerGaii: string;
  res: Response;
  /** `x-aimeat-pay-token` header — a one-time token minted by a settled ext-call checkout (D1). */
  payToken?: string;
}): Promise<PaywallOutcome> {
  const { config, storage, ext, action, callerGaii, res, payToken } = args;
  const ownerName = ext.installedBy;
  // Owner from any principal form: GHII (owner@node), GAII (agent#owner@node), or bare name.
  // (parseGAII only recognises the GAII form, so extract directly to catch owner GHII sessions.)
  const callerOwner = callerGaii.split('@')[0].split('#').pop() ?? callerGaii;

  // 1. Owner (and their own principals) always free — no toll, no payment.
  if (callerOwner === ownerName) return { ok: true };

  // 2. Anti-abuse toll — ALWAYS a burn (debit caller, never credit owner). M1.
  const toll = action.tollMorsels ?? 0;
  if (toll > 0) {
    if (!isPosInt(toll)) {
      res.status(500).json(error(config.nodeId, 'EXTENSION_CONFIG', `Invalid tollMorsels on action "${action.id}"`));
      return { ok: false };
    }
    if (toll > config.extensionMaxDebitPerCall) {
      res.status(500).json(error(config.nodeId, 'EXTENSION_CONFIG',
        `tollMorsels (${toll}) exceeds the per-call cap (${config.extensionMaxDebitPerCall})`));
      return { ok: false };
    }
    const burned = await storage.debitBalance(callerGaii, toll);
    if (!burned) {
      res.status(402).json({ ...error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `This call requires a ${toll}-morsel anti-abuse toll and your balance does not cover it`), ...paymentChallenge(config) });
      return { ok: false };
    }
    await storage.addTransaction({
      id: `ext-toll-${randomUUID()}`, gaii: callerGaii, type: 'extension_toll', amount: -toll,
      trackingCode: `ext:${ext.name}:${action.id}:toll`, timestamp: new Date().toISOString(),
    });
  }

  // 3. Not commercial → free public call (the script's own public_access decides who may read).
  if (!action.commercial) return { ok: true };

  // 3.5 EXCHANGE metered-call gateway (G2, TARGET-045): when the caller holds a durable entitlement for
  //     this exact (ext, action), it takes over the commercial settlement — budget cap + platform rake —
  //     so a negotiated contract flows without a per-call checkout. Additive: null → no entitlement, fall
  //     through to the one-time money-token + morsel channels below (unchanged pre-EXCHANGE behaviour).
  const viaEntitlement = await settleViaEntitlement({ config, storage, ext, action, callerGaii, res });
  if (viaEntitlement) return viaEntitlement;

  // 4. Money channel (D1/D3): require a one-time token minted by a settled ext-call checkout.
  //    Checked BEFORE the morsel debit so a combo-2 caller without money is never charged morsels.
  if (action.commercial.payMoney) {
    const consumed = await consumeExtPayToken(storage, payToken, { buyerOwner: callerOwner, ext: ext.name, action: action.id });
    if (!consumed.ok) {
      const m = action.commercial.payMoney;
      res.status(402).json({ ...error(config.nodeId, 'PAYMENT_REQUIRED',
        `This call costs ${m.amount / 1_000_000} ${m.currency}. Settle it with a checkout `
        + `{ kind:'ext-call', app:'${ext.name}', tool:'${action.id}', currency:'${m.currency}' }, then retry `
        + `this call with header 'x-aimeat-pay-token: <token>'.${payToken ? ` (token ${consumed.reason})` : ''}`),
        ...paymentChallenge(config) });
      return { ok: false };
    }
    // Token valid + consumed — money settled. Fall through (combo 2 also charges morsels below).
  }

  // 5. Morsel payment — REVENUE (M1): atomic debit caller + credit owner. Refund on script throw.
  const payMorsels = action.commercial.payMorsels;
  if (isPosInt(payMorsels)) {
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    const debited = await storage.debitBalance(callerGaii, payMorsels);
    if (!debited) {
      res.status(402).json({ ...error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `This call costs ${payMorsels} morsels and your balance does not cover it`), ...paymentChallenge(config) });
      return { ok: false };
    }
    const credited = await storage.creditBalance(ownerGhii, payMorsels);
    if (!credited) {
      // Never keep a debit we couldn't pay out — refund the caller and fail loudly.
      await storage.creditBalance(callerGaii, payMorsels);
      logger.error(`[paywall] credit to owner failed; refunded caller`, { ext: ext.name, action: action.id, ownerGhii });
      res.status(500).json(error(config.nodeId, 'SETTLEMENT_FAILED', 'Payment could not be settled to the seller; you were not charged'));
      return { ok: false };
    }
    const track = `ext:${ext.name}:${action.id}:pay`;
    const ts = new Date().toISOString();
    await storage.addTransaction({ id: `ext-pay-${randomUUID()}`, gaii: callerGaii, type: 'extension_pay', amount: -payMorsels, trackingCode: track, timestamp: ts });
    await storage.addTransaction({ id: `ext-earn-${randomUUID()}`, gaii: ownerGhii, type: 'extension_earn', amount: payMorsels, trackingCode: track, timestamp: ts });
    return {
      ok: true,
      refund: async () => {
        await storage.debitBalance(ownerGhii, payMorsels);
        await storage.creditBalance(callerGaii, payMorsels);
        logger.warn(`[paywall] refunded ${payMorsels} morsels (script threw after payment)`, { ext: ext.name, action: action.id });
      },
    };
  }

  // commercial present but no chargeable channel here (shouldn't happen — C1 validated at install).
  return { ok: true };
}

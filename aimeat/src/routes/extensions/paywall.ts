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
 *   v1.3.0 — 2026-07-27 — An action that BACKS a priced app-tool is no longer free through the raw
 *     route: it settles on that app-tool's coordinate, so the product has one price and no bypass.
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
import { settleViaEntitlement, settleMeteredCoordinate } from './entitlement-gate.js';
import { pricedAppToolsFor } from './priced-binding.js';
import { consumeInternalPass } from './internal-pass.js';
import { burnPacingToll, resolvePacingToll } from './pacing.js';
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
  /** `x-aimeat-internal-pass` header — this call was already settled by the app-tool route. */
  internalPass?: string;
}): Promise<PaywallOutcome> {
  const { config, storage, ext, action, callerGaii, res, payToken, internalPass } = args;
  const ownerName = ext.installedBy;
  // Owner from any principal form: GHII (owner@node), GAII (agent#owner@node), or bare name.
  // (parseGAII only recognises the GAII form, so extract directly to catch owner GHII sessions.)
  const callerOwner = callerGaii.split('@')[0].split('#').pop() ?? callerGaii;

  // 0. Already settled upstream. The app-tool route charges the contract and then invokes the
  //    capability over this node's own HTTP surface, which lands right back here — and since an
  //    action behind a priced tool is no longer free (step 3.5), charging again would take payment
  //    twice for one call. The pass is minted in-process, single use, and unknown to any caller, so
  //    an absent or bogus one simply means "charge normally". It also stands down the pacing burn,
  //    which the upstream settlement already took.
  const settled = consumeInternalPass(internalPass);
  if (settled) {
    logger.debug('paywall stood down: settled upstream', { ext: ext.name, action: action.id, ...settled });
    return { ok: true };
  }

  // 1. Owner (and their own principals) always free — no toll, no payment.
  if (callerOwner === ownerName) return { ok: true };

  // 2. Declared toll bounds this action's call rate. Validated here (it is extension config); the burn
  //    itself happens once, either inside the entitlement chokepoint below or on the uncontracted path.
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
  }

  // 3. EXCHANGE metered-call gateway (G2, TARGET-045): when the caller holds a durable entitlement for
  //    this exact (ext, action), it takes over BOTH the pacing burn and the commercial settlement —
  //    budget cap + platform rake — so a negotiated contract flows without a per-call checkout.
  //    Consulted before the pacing burn below so the toll is never charged twice for one call.
  const viaEntitlement = await settleViaEntitlement({ config, storage, ext, action, callerGaii, res });
  if (viaEntitlement) return viaEntitlement;

  // 3.1 Uncontracted call: pace it here. Same burn, same rule — a burn, never revenue (M1).
  const paced = await burnPacingToll({
    config, storage, callerGaii, providerOwner: ownerName,
    label: `ext:${ext.name}:${action.id}`, toll: resolvePacingToll(config, toll), res,
  });
  if (!paced.ok) return { ok: false };

  // 3.5 Not commercial in its OWN right — but it may be what a priced app-tool sells. An app-tool
  //     binds an extension action and puts a price on it; the raw route is the same capability
  //     through a different door, and it was free. Every priced app on the node had a bypass beside
  //     its own front door, and only the buyer who contracted actually paid.
  //
  //     Charged on the APP-TOOL's coordinate, not this action's, because that is the coordinate the
  //     product is sold under: a contract holder settles once at the price they agreed, whichever
  //     door they came through, and anyone else is told which listing to contract.
  if (!action.commercial) {
    const sold = await pricedAppToolsFor(storage, `${ownerName}@${config.nodeId}`, ext.name, action.id);
    if (!sold.length) return { ok: true };                  // genuinely free: nothing sells it

    // One action can be sold under several tools. Settle the one the caller actually CONTRACTED —
    // charging them against a product they never bought would be its own kind of theft — and try
    // them in a stable order so an uncontracted caller always gets the same answer.
    for (const s of sold) {
      const coordExt = `apptool:${ownerName}/${s.appId}`;
      const viaTool = await settleMeteredCoordinate({
        config, storage, coordExt, coordAction: s.tool,
        label: `${s.appId}/${s.tool}`, callerGaii, res,
      });
      if (viaTool) return viaTool;                          // contracted → settled once, right here
    }

    const first = sold[0]!;
    res.status(402).json({
      ...error(config.nodeId, 'PAYMENT_REQUIRED',
        `This capability is sold as ${sold.length === 1 ? 'the app-tool' : 'the app-tools'} `
        + sold.map(s => `"${ownerName}/${s.appId} · ${s.tool}"`).join(', ') + '. '
        + 'Take a contract on EXCHANGE (POST /v1/exchange/entitlements with the offering id) and '
        + 'call it again — this route and the app-tool endpoint settle the same contract.'),
      ...paymentChallenge(config),
      app_tool: { owner: ownerName, app_id: first.appId, tool: first.tool, coordinate: `apptool:${ownerName}/${first.appId}` },
      app_tools: sold.map(s => ({ owner: ownerName, app_id: s.appId, tool: s.tool })),
    });
    return { ok: false };
  }

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

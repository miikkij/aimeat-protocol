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
 *   v1.5.0 — 2026-07-28 — The sequence moved to services/metered-access.ts; this door's job is to name
 *     the product. A right that exists but is exhausted is still resolved, so the caller is told their
 *     budget is spent rather than told to take a contract they already hold.
 *   v1.4.0 — 2026-07-27 — The raw route stops GUESSING which product a shared action is. It settles
 *     only an unambiguous binding (one priced tool); several means several products, and it says so
 *     instead of billing whichever contract the caller happens to hold.
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
import { pricedAppToolsFor, type PricedBinding } from './priced-binding.js';
import { readEntitlementForCall, computeCharge, type MeteredEntitlement } from '../../services/metered-entitlements.js';
import type { BeneficiaryAccrual } from '../../services/metered-settlement.js';
import { consumeInternalPass } from './internal-pass.js';
import { burnPacingToll, resolvePacingToll } from './pacing.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

type ExtAction = ExtensionRecord['actions'][number];

/**
 * Result of the paywall. `ok:false` means a response has already been sent (402/500) — the caller
 * must `return`. `refund` (when present) reverses a collected payment; the invoke handler calls it
 * if the sandbox script throws AFTER payment (M1/no-mint: money never leaves without delivery).
 * `accrue` is its mirror image on the success side: the invoke handler calls it once the script has
 * delivered, so anyone the provider owes a share of this call is booked out of the provider's own cut.
 */
export interface PaywallOutcome {
  ok: boolean;
  refund?: () => Promise<void>;
  accrue?: BeneficiaryAccrual;
  /**
   * This call is an INTERNAL HOP: an upstream door already ruled on it and is invoking the
   * capability over the node's own HTTP surface. The hop's "caller" is the node, not a buyer, so
   * the door must pass the provider's `_revenue` designation THROUGH untouched instead of stripping
   * it — the upstream door is the one holding the settlement and is the only one that can accrue it.
   *
   * Stripping here is what silently broke every app-tool sale: the outer door settled, the inner hop
   * removed the designation before the outer door could read it, and the share went to nobody while
   * the response still said `metered: true`.
   */
  upstream?: boolean;
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && Number.isFinite(v);

/**
 * How a caller names WHICH product a shared capability is being called as. A header rather than a body
 * field: the body of a raw invoke is the extension's own input, governed by the action's input schema,
 * and a routing hint has no business inside data the provider validates.
 */
export const APP_TOOL_HEADER = 'x-aimeat-app-tool';

/** Split `{app_id}/{tool}`. Anything else is a malformed request, not a silent fallback to guessing. */
function parseNamedTool(raw: string | undefined | null): PricedBinding | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const slash = v.lastIndexOf('/');
  if (slash < 1 || slash === v.length - 1) return null;
  return { appId: v.slice(0, slash), tool: v.slice(slash + 1) };
}

/**
 * Of the products that sell this action, the CHEAPEST one the caller already holds a live right to —
 * or null when they hold none.
 *
 * "Cheapest" is compared inside a rail and never across one: morsels and money micro-units are
 * different things, and `1` of one is not less than `10000` of the other. A right that costs nothing
 * this call wins outright (a provider's grant, or a bundle with quota left) — being charged while
 * holding free access to the same capability is the surprise this whole ordering exists to prevent.
 * Below that, a morsel right beats a money one: morsels are the node's own throttle unit and settle no
 * real currency, so charging EUR while a morsel contract sits unused is the more expensive mistake.
 *
 * A right that exists but is not usable — exhausted, paused, revoked — is still returned when nothing
 * active is held, so the chokepoint can say WHICH of those it is. Skipping it entirely made this door
 * tell a caller whose budget was spent to "take a contract on EXCHANGE", while the app-tool and MCP
 * doors told the same caller their budget was spent. One decision has to produce one answer.
 */
async function cheapestHeld(
  storage: Storage, sold: PricedBinding[], ownerName: string, callerGaii: string,
): Promise<PricedBinding | null> {
  const rank = (e: MeteredEntitlement): [number, number] => {
    const charge = computeCharge(e, Date.now()).chargeUnits;
    if (charge <= 0) return [0, 0];
    return [e.unit === 'morsels' ? 1 : 2, charge];
  };
  let best: { binding: PricedBinding; key: [number, number] } | null = null;
  let unusable: PricedBinding | null = null;
  for (const s of sold) {
    const ent = await readEntitlementForCall(storage, callerGaii, `apptool:${ownerName}/${s.appId}`, s.tool);
    if (!ent) continue;
    if (ent.state !== 'active') { unusable ??= s; continue; }
    const key = rank(ent);
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { binding: s, key };
    }
  }
  return best?.binding ?? unusable;
}

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
  /** `x-aimeat-app-tool` header — which product a caller holding several means. Validated, never trusted. */
  namedAppTool?: string;
  /** The session behind the request — a hosted app needs an explicit permission to spend. */
  session?: { roles: string[]; scopes: string[]; appGrantId?: string | null } | null;
}): Promise<PaywallOutcome> {
  const { config, storage, ext, action, callerGaii, res, payToken, internalPass, namedAppTool, session } = args;
  const ownerName = ext.installedBy;
  // Owner from any principal form: GHII (owner@node), GAII (agent#owner@node), or bare name.
  // (parseGAII only recognises the GAII form, so extract directly to catch owner GHII sessions.)
  const callerOwner = callerGaii.split('@')[0].split('#').pop() ?? callerGaii;

  // 0. A door that KNOWS which product was asked for has already ruled on this call. The app-tool
  //    routes, the commerce checkout and the MCP twin all invoke the capability over this node's own
  //    HTTP surface, which lands right back here — so without a pass one call would be ruled on
  //    twice, and the second ruling would be made by the one place that cannot know the product.
  //    The pass is minted in-process, single use, and unknown to any caller, so an absent or bogus
  //    one simply means "apply the normal rules".
  //
  //    `settled` — the contract was charged upstream; there is nothing left to take, pacing included.
  //    `unpriced` — the manifest puts no price on the tool the caller came through. That answers the
  //    app-tool question (step 3.5) and nothing else: an action with its own `commercial` terms is
  //    still owed them, because a provider publishing a free tool is declining to charge for THEIR
  //    tool, not waiving someone else's price.
  const upstream = consumeInternalPass(internalPass);
  if (upstream?.kind === 'settled') {
    logger.debug('paywall stood down: settled upstream', { ext: ext.name, action: action.id, ...upstream });
    return { ok: true, upstream: true };
  }
  const soldFreeUpstream = upstream?.kind === 'unpriced';

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
  const viaEntitlement = await settleViaEntitlement({ config, storage, ext, action, callerGaii, res, session });
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
    if (soldFreeUpstream) return { ok: true, upstream: true };  // the door the caller used prices it at nothing
    const sold = await pricedAppToolsFor(storage, `${ownerName}@${config.nodeId}`, ext.name, action.id);
    if (!sold.length) return { ok: true };                  // genuinely free: nothing sells it

    // WHICH product is this? The route sees an action; a price belongs to a product, and one action
    // can be sold as several. Resolved in the order a buyer would expect to be treated:
    //
    //   1. What the caller NAMED (`x-aimeat-app-tool: {app_id}/{tool}`), validated twice over — it
    //      must be one of the tools that actually sell this action, and the caller must hold a live
    //      right to it. A name is a request, never an instruction: nobody talks their way onto a
    //      product they did not contract, and nobody is billed for one either.
    //   2. Otherwise the CHEAPEST right they hold. Silence used to be resolved alphabetically, which
    //      settled a 0.05 EUR product for a caller who also held the 0.01 EUR one — a 5× difference
    //      decided by spelling. Ambiguity should cost the least it could have meant.
    //
    // Only rights the caller already holds are ever considered, so this can charge them for a
    // product they never bought in neither branch. Holding none is the honest 402 below.
    const named = parseNamedTool(namedAppTool);
    if (namedAppTool && !named) {
      res.status(400).json(error(config.nodeId, 'INVALID_APP_TOOL',
        `Name the product as "{app_id}/{tool}" in the ${APP_TOOL_HEADER} header, e.g. "notes.html/search".`));
      return { ok: false };
    }
    if (named && !sold.some(s => s.appId === named.appId && s.tool === named.tool)) {
      res.status(400).json(error(config.nodeId, 'APP_TOOL_MISMATCH',
        `"${named.appId}/${named.tool}" does not sell ${ext.name}/${action.id}. This capability is sold as `
        + sold.map(s => `"${s.appId} · ${s.tool}"`).join(', ') + '.'));
      return { ok: false };
    }

    const candidates = named ? sold.filter(s => s.appId === named.appId && s.tool === named.tool) : sold;
    const chosen = await cheapestHeld(storage, candidates, `${ownerName}`, callerGaii);
    if (chosen) {
      const viaTool = await settleMeteredCoordinate({
        config, storage, coordExt: `apptool:${ownerName}/${chosen.appId}`, coordAction: chosen.tool,
        label: `${chosen.appId}/${chosen.tool}`, callerGaii, res, session,
      });
      if (viaTool) return viaTool;                          // contracted → settled once, right here
    }

    const first = sold[0]!;
    res.status(402).json({
      ...error(config.nodeId, 'PAYMENT_REQUIRED',
        `This capability is sold as ${sold.length === 1 ? 'the app-tool' : 'the app-tools'} `
        + sold.map(s => `"${ownerName}/${s.appId} · ${s.tool}"`).join(', ') + '. '
        + 'Take a contract on EXCHANGE (POST /v1/exchange/entitlements with the offering id) and '
        + 'call it again — this route and the app-tool endpoint settle the same contract.'
        + (sold.length > 1
          ? ` They are separate products at separate prices; hold more than one and this route settles the `
            + `cheapest unless you name it with "${APP_TOOL_HEADER}: {app_id}/{tool}".`
          : '')),
      ...paymentChallenge(config),
      app_tool: { owner: ownerName, app_id: first.appId, tool: first.tool, coordinate: `apptool:${ownerName}/${first.appId}` },
      app_tools: sold.map(s => ({
        owner: ownerName, app_id: s.appId, tool: s.tool,
        invoke: `/v1/apps/${ownerName}/${s.appId}/webmcp/tools/${s.tool}`,
      })),
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
  //
  //    NO BENEFICIARY SPLIT HERE, deliberately. This is the uncontracted per-call channel and it
  //    settles on its own, not through `settleMeteredCharge`; splitting it would mean a second copy of
  //    the split arithmetic, which is the shape metered-access.ts exists to prevent. A provider who
  //    declares a split gets it on every contracted call at that coordinate (step 3) and not on this
  //    one — so a capability meant to share revenue should be sold through EXCHANGE, where it is.
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
    await storage.addTransaction({ id: `ext-pay-${randomUUID()}`, gaii: ownerGhiiOf(callerGaii), type: 'extension_pay', amount: -payMorsels, trackingCode: track, initiatorGaii: callerGaii, timestamp: ts });
    await storage.addTransaction({ id: `ext-earn-${randomUUID()}`, gaii: ownerGhii, type: 'extension_earn', amount: payMorsels, trackingCode: track, initiatorGaii: callerGaii, timestamp: ts });
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

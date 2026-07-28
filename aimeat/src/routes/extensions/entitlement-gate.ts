/**
 * @file src/routes/extensions/entitlement-gate.ts
 * @description The HTTP adapter over the metered chokepoint — thin on purpose.
 *
 *   The decision and the settlement moved to `services/metered-access.ts` and
 *   `services/metered-settlement.ts` when it became clear that sharing the SETTLEMENT while every door
 *   re-derived the decisions around it was the shape producing the bugs: owner-free lived in four
 *   places and was missing from a fifth, and each door had to remember the sequence. What is left here
 *   is the express-shaped convenience the raw-invoke paywall wants — call the chokepoint, render a
 *   refusal, hand back the paywall's outcome type.
 *
 *   A door that is NOT express-shaped (the MCP twin, the checkout) should call `authoriseMeteredCall`
 *   directly rather than fabricate a `Response` to reach it, which is what the previous shape forced.
 * @structure settleMeteredCoordinate (express adapter) · settleViaEntitlement (ext wrapper)
 * @version-history
 *   v2.0.0 — 2026-07-28 — Reduced to an adapter: the sequence lives in services/metered-access.ts, so
 *     the owner-free rule now applies on every door instead of three of them.
 *   v1.4.0 — 2026-07-27 — Grants settle through this same gate at price 0: the pacing burn moves to the
 *     provider's wallet and the ceiling checked is what the PROVIDER carries.
 *   v1.3.0 — 2026-07-21 — Generalised to a metered COORDINATE (ext, action strings) so it settles app-tool
 *     calls too (EXCHANGE cross-app selling, Gap 1); settleViaEntitlement is now the ext wrapper.
 *   v1.2.0 — 2026-07-20 — Pricing models (Phase B): computeCharge drives per-call amount (bundle/subscription + rate limit).
 *   v1.1.0 — 2026-07-20 — Wire the money unit to the accrual rail (real EUR/USD); split morsel/money settlement.
 *   v1.0.0 — 2026-07-20 — Initial G2 gateway: entitlement authorise + morsel settlement + platform rake.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord } from '../../storage/interface.js';
import { authoriseMeteredCall } from '../../services/metered-access.js';
import { respondMeteredRefusal } from './metered-response.js';
import type { PaywallOutcome } from './paywall.js';

type ExtAction = ExtensionRecord['actions'][number];

/**
 * Authorise + settle a metered call at a COORDINATE, rendering any refusal as HTTP.
 *
 * Returns `null` when nothing authorises the call, so the caller can offer whatever it offers instead
 * (a price list, a checkout). `{ ok: true }` covers both a settled call and the provider's own free
 * one — from a door's point of view they are the same instruction: go ahead.
 */
export async function settleMeteredCoordinate(args: {
  config: AimeatConfig; storage: Storage; coordExt: string; coordAction: string; label: string;
  callerGaii: string; res: Response;
  /** The selling owner, when the coordinate does not name one (a raw extension action). */
  providerOwner?: string | null;
  /** The session behind the request, so the chokepoint can check what it is permitted to spend. */
  session?: { roles: string[]; scopes: string[]; appGrantId?: string | null } | null;
}): Promise<PaywallOutcome | null> {
  const { config, storage, coordExt, coordAction, label, callerGaii, res, providerOwner, session } = args;
  const outcome = await authoriseMeteredCall({
    config, storage, caller: callerGaii, session: session ?? null,
    product: { ext: coordExt, action: coordAction, label, providerOwner: providerOwner ?? null },
  });
  switch (outcome.kind) {
    case 'no_right': return null;
    case 'free_owner': return { ok: true };
    case 'settled': return { ok: true, refund: outcome.refund };
    default:
      respondMeteredRefusal(config, res, outcome, label);
      return { ok: false };
  }
}

/** Settle a raw extension invoke (the ext-action wrapper), or return `null` to fall through. */
export async function settleViaEntitlement(args: {
  config: AimeatConfig; storage: Storage; ext: ExtensionRecord; action: ExtAction; callerGaii: string; res: Response;
  session?: { roles: string[]; scopes: string[]; appGrantId?: string | null } | null;
}): Promise<PaywallOutcome | null> {
  return settleMeteredCoordinate({
    config: args.config, storage: args.storage,
    coordExt: args.ext.name, coordAction: args.action.id, label: `${args.ext.name}/${args.action.id}`,
    callerGaii: args.callerGaii, res: args.res, session: args.session ?? null,
    // A bare extension name carries no owner; the record does.
    providerOwner: args.ext.installedBy,
  });
}

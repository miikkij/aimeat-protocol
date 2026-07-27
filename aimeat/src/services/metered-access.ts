/**
 * @file src/services/metered-access.ts
 * @description THE chokepoint for "may this principal make this priced call, and what does it cost?".
 *
 *   Every priced capability on this node is reachable through several doors: the raw extension route,
 *   the app-tool endpoint, its MCP twin, the capability route, the commerce checkout, agent-work
 *   delivery. Settlement was already shared. The DECISIONS around it were not — owner-free lived in
 *   four places and was missing from a fifth, "is this priced" in two that disagreed, and each door
 *   re-derived the sequence before calling the shared part. Every one of the six money defects found
 *   on 2026-07-27 was a door that forgot a step the other doors remembered. That is a property of the
 *   shape, not of any one author.
 *
 *   So the rule this file encodes is the one `pacing.ts` already stated and only half-applied: money,
 *   metering and abuse limits belong at the chokepoint EVERY path shares. A door's remaining job is
 *   to name the product and render the answer.
 *
 *   IT WRITES NO HTTP. The previous gate took an Express `Response` and sent its own 402s, which is
 *   why the MCP path had to fabricate a fake Response object to call it at all. A decision is a value;
 *   turning it into a status code is the door's business. `metered-response.ts` does that for HTTP
 *   doors, and MCP renders the same value as text.
 * @structure MeteredOutcome · authoriseMeteredCall · providerOwnerOfCoordinate
 * @usage
 *   const outcome = await authoriseMeteredCall({ config, storage, caller, product });
 *   if (outcome.kind === 'settled') { try { …invoke… } catch { await outcome.refund(); } }
 * @version-history
 *   v1.0.0 — 2026-07-28 — Extracted from routes/extensions/entitlement-gate.ts so one function owns the
 *     whole sequence, and the owner-free rule finally applies on every door (an owner calling their own
 *     app-tool was paying the platform rake to themselves).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import {
  readEntitlementForCall, budgetAllows, computeCharge,
  type MeteredEntitlement,
} from './metered-entitlements.js';
import { resolvePacingToll } from '../routes/extensions/pacing.js';
import { settleMeteredCharge, burnPacingTollFor, type SettlementResult } from './metered-settlement.js';

/** What a metered call is being made AGAINST — the coordinate the price is attached to. */
export interface MeteredProduct {
  /** Metered coordinate: an extension name, `apptool:{owner}/{appId}`, or `agentwork:{owner}/{agent}`. */
  ext: string;
  /** Metered coordinate: the action id, the tool name, or the task type. */
  action: string;
  /** Human label for messages, e.g. `nuotta.html/search`. */
  label: string;
  /**
   * The owner who SELLS this. Derivable from an `apptool:`/`agentwork:` coordinate; a raw extension
   * coordinate carries no owner, so that door passes `ext.installedBy`.
   */
  providerOwner?: string | null;
}

/**
 * The answer. Every branch a door could need, as a value — so no door has to know the sequence that
 * produced it, and none of them can accidentally skip a step by rendering early.
 */
export type MeteredOutcome =
  /** The caller is the provider. Their own capability is free, and no toll is burned. */
  | { kind: 'free_owner' }
  /** Nothing authorises this call. The door decides what to offer instead (402, a checkout, a price list). */
  | { kind: 'no_right' }
  /** A right exists but is not usable right now. */
  | { kind: 'inactive'; entitlement: MeteredEntitlement }
  | { kind: 'refused_rate'; entitlement: MeteredEntitlement }
  | { kind: 'refused_budget'; entitlement: MeteredEntitlement }
  /** A provider's grant has reached the ceiling they were willing to carry. */
  | { kind: 'refused_grant_cap'; entitlement: MeteredEntitlement }
  /** The payer could not cover the pacing toll or the price. */
  | { kind: 'insufficient'; entitlement: MeteredEntitlement | null; needed: number; carried: boolean }
  /** Payment could not be moved; the caller was NOT charged. */
  | { kind: 'settlement_failed'; entitlement: MeteredEntitlement; reason: string }
  /**
   * Charged (possibly 0, under a grant or within a bundle quota) and recorded. Invoke now; call
   * `refund()` if the work then fails, so money never leaves without delivery.
   */
  | { kind: 'settled'; entitlement: MeteredEntitlement; charged: number; refund: () => Promise<void> };

/**
 * The owner selling at a coordinate, when the coordinate says so. `apptool:alice/app.html` and
 * `agentwork:alice/bot` both name their seller; a bare extension name does not, so that door supplies it.
 */
export function providerOwnerOfCoordinate(coordExt: string): string | null {
  for (const prefix of ['apptool:', 'agentwork:']) {
    if (coordExt.startsWith(prefix)) {
      const rest = coordExt.slice(prefix.length);
      const slash = rest.indexOf('/');
      return slash > 0 ? rest.slice(0, slash) : rest || null;
    }
  }
  return null;
}

/**
 * Decide, and settle, one metered call. The whole sequence, in the one place every door shares:
 *
 *   1. OWNER-FREE — calling your own capability costs nothing, and burns no toll. Checked FIRST,
 *      before any lookup, because a provider is not a consumer of themselves. This used to live in
 *      three separate doors and be absent from the fourth, so an owner reaching their own app-tool
 *      through the app-tool endpoint paid the platform rake to themselves.
 *   2. THE RIGHT — a provider's grant if one is active, else the contract, both keyed to the owner
 *      who pays (see `metered-entitlements.ts`).
 *   3. PACING — burned before anything is authorised, so a paced-out call costs one morsel-sized
 *      attempt rather than a settled payment that has to be reversed. On a grant the provider carries it.
 *   4. STATE, RATE, CEILINGS — the contract's own limits, and a grant's separate carried ceiling.
 *   5. SETTLE + ATTRIBUTE — move the value, apply the rake, advance the meter, record WHO called.
 */
export async function authoriseMeteredCall(args: {
  config: AimeatConfig;
  storage: Storage;
  /** The exact principal making the call — an agent GAII, a GEAI, or an owner GHII. */
  caller: string;
  product: MeteredProduct;
}): Promise<MeteredOutcome> {
  const { config, storage, caller, product } = args;

  // 1. Own capability → free. Before the lookup: a provider holding a contract against themselves
  //    (which happens, because nothing stopped them buying it) must still not be charged for it.
  const providerOwner = product.providerOwner ?? providerOwnerOfCoordinate(product.ext);
  const callerOwner = ownerGhiiOf(caller).split('@')[0];
  if (providerOwner && callerOwner === providerOwner) return { kind: 'free_owner' };

  // 2. Whatever authorises this call — a grant wins over a contract while it is active.
  const ent = await readEntitlementForCall(storage, caller, product.ext, product.action);
  if (!ent) return { kind: 'no_right' };

  // 3. Pacing, first and always. The one brake that bounds RATE rather than total spend, which is the
  //    property a money budget does not have.
  const toll = resolvePacingToll(config, ent.tollMorsels);
  const paced = await burnPacingTollFor({
    config, storage, caller, label: product.label, toll,
    // A grant covers both halves of a price, so the provider burns it.
    payer: ent.grant ? ent.providerGhii : null,
  });
  if (!paced) return { kind: 'insufficient', entitlement: ent, needed: toll, carried: !!ent.grant };

  // 4. Limits.
  if (ent.state !== 'active') return { kind: 'inactive', entitlement: ent };

  const decision = computeCharge(ent, Date.now());
  if (!decision.allowed) return { kind: 'refused_rate', entitlement: ent };

  // A grant's ceiling is on what the PROVIDER carries. The consumer spends nothing, so the ordinary
  // budget check below can never fire on one, and "carry them up to 500 morsels" would mean nothing.
  if (ent.grant && ent.grant.capCarriedUnits !== null
      && ent.grant.carriedUnits + ent.grant.listPricePerCall > ent.grant.capCarriedUnits) {
    return { kind: 'refused_grant_cap', entitlement: ent };
  }

  if (!budgetAllows(ent, decision.chargeUnits)) return { kind: 'refused_budget', entitlement: ent };

  // 5. Move it, and record who caused it.
  const settled: SettlementResult = await settleMeteredCharge({
    config, storage, ent, caller, product, charge: decision.chargeUnits, newPricing: decision.pricing,
  });
  if (settled.kind === 'insufficient') return { kind: 'insufficient', entitlement: ent, needed: settled.needed, carried: false };
  if (settled.kind === 'failed') return { kind: 'settlement_failed', entitlement: ent, reason: settled.reason };
  return { kind: 'settled', entitlement: ent, charged: settled.charged, refund: settled.refund };
}

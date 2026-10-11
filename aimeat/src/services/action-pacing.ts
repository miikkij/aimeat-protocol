/**
 * @file src/services/action-pacing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An action's pacing amount on every route that reads, writes or federates it. Ruling
 *   decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa (2026-10-11): a morsel is pacing,
 *   never a price, so an action carries `toll_morsels` (morsels of pacing per use) and no morsel price.
 *   The old `base_morsels` field is read as the pacing amount and mirrored in responses, marked
 *   deprecated, until MORSEL_PRICE_FIELDS_REMOVED_IN; from that release a write that sends it is
 *   refused with MORSEL_PRICE_REMOVED.
 * @structure ActionPricingInput · actionPricingFromRequest · actionPricingFromPeer ·
 *   actionPricingFromRecord · presentActionPricing · actionTollMorsels
 * @usage const p = actionPricingFromRequest(config, req.body.pricing); if ('code' in p) return refuse(p);
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import type { AimeatConfig } from '../config.js';
import type { ActionRecord } from '../storage/interface.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_DEPRECATION, MORSEL_PRICE_FIELDS_REMOVED_IN } from '../config-pacing.js';
import { resolvePacingToll } from './metered-settlement.js';
import { TOLL_MORSELS_MAX } from '../models/offer-schemas.js';

/** The `pricing` object a REST client sends for an action. */
export interface ActionPricingInput {
  toll_morsels?: number;
  /** Deprecated: the 3.x morsel price, read as the pacing amount until MORSEL_PRICE_FIELDS_REMOVED_IN. */
  base_morsels?: number;
  per_unit?: { unit: string; morsels_per_1000: number };
}

/** The `pricing` object a response or a federation payload carries for an action. */
export interface ActionPricingView {
  toll_morsels: number;
  per_unit?: unknown;
  /** Deprecated mirror of toll_morsels, present while legacyMorselFieldsLive(). */
  base_morsels?: number;
  deprecated?: { base_morsels: string };
}

const wholeNonNegative = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;

/**
 * A client's pricing as the stored ActionRecord pricing, or a refusal. `toll_morsels` is the pacing
 * amount; an old `base_morsels` adds to it while legacy fields are live and is refused after. The node
 * default applies when neither is sent and no `current` value exists; the node ceiling
 * (`config.extensionMaxDebitPerCall`) bounds the result (resolvePacingToll).
 *
 * @param current The action's stored pacing amount, kept when an update sends neither field.
 */
export function actionPricingFromRequest(
  config: AimeatConfig, pricing: ActionPricingInput, current?: number,
): { pricing: ActionRecord['pricing'] } | { code: 'MORSEL_PRICE_REMOVED'; message: string } {
  const declared = wholeNonNegative(pricing.toll_morsels);
  const legacy = wholeNonNegative(pricing.base_morsels);
  if (pricing.base_morsels !== undefined && !legacyMorselFieldsLive()) {
    return {
      code: 'MORSEL_PRICE_REMOVED',
      message: `pricing.base_morsels was removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}: a morsel is pacing, not a price. Set pricing.toll_morsels (the pacing amount per use).`,
    };
  }
  let toll: number;
  if (declared === undefined && legacy === undefined && current !== undefined) toll = current;
  // An explicit old `base_morsels: 0` meant a free action; it stays without pacing, not the node default.
  else if (declared === undefined && legacy === 0) toll = 0;
  else toll = resolvePacingToll(config, declared, legacy);
  const perUnit = pricing.per_unit
    ? { unit: pricing.per_unit.unit, morselsPer1000: pricing.per_unit.morsels_per_1000 }
    : undefined;
  return { pricing: perUnit ? { tollMorsels: toll, perUnit } : { tollMorsels: toll } };
}

/**
 * Pricing a PEER node sent in a federation or genesis payload. A 3.x peer sends `base_morsels`, a 4.x
 * peer `toll_morsels`; either is the pacing amount, capped at TOLL_MORSELS_MAX. The remote node charges
 * its own pacing on the work it serves, so the local default does not apply.
 */
export function actionPricingFromPeer(pricing: unknown): ActionRecord['pricing'] {
  const p = (pricing && typeof pricing === 'object' ? pricing : {}) as { toll_morsels?: unknown; base_morsels?: unknown; per_unit?: unknown };
  const toll = Math.min(wholeNonNegative(p.toll_morsels) ?? wholeNonNegative(p.base_morsels) ?? 0, TOLL_MORSELS_MAX);
  const perUnit = p.per_unit as ActionRecord['pricing']['perUnit'] | undefined;
  return perUnit ? { tollMorsels: toll, perUnit } : { tollMorsels: toll };
}

/**
 * Pricing in the stored camelCase shape, from an export bundle or another record that may predate
 * the ruling: `baseMorsels` (3.x) or `tollMorsels`, capped at TOLL_MORSELS_MAX.
 */
export function actionPricingFromRecord(pricing: unknown): ActionRecord['pricing'] {
  const p = (pricing && typeof pricing === 'object' ? pricing : {}) as { tollMorsels?: unknown; baseMorsels?: unknown; perUnit?: unknown };
  const toll = Math.min(wholeNonNegative(p.tollMorsels) ?? wholeNonNegative(p.baseMorsels) ?? 0, TOLL_MORSELS_MAX);
  const perUnit = p.perUnit as ActionRecord['pricing']['perUnit'] | undefined;
  return perUnit ? { tollMorsels: toll, perUnit } : { tollMorsels: toll };
}

/** An action's pacing amount, whatever shape its stored pricing has. */
export function actionTollMorsels(action: Pick<ActionRecord, 'pricing'>): number {
  return actionPricingFromRecord(action.pricing).tollMorsels;
}

/**
 * An action's pricing as a response or a federation payload shows it: `toll_morsels`, and while
 * legacy fields are live the old `base_morsels` as a mirror with a `deprecated` note beside it.
 *
 * @param perUnit `snake` renames per_unit's fields, `raw` passes the stored object, `none` leaves it out.
 */
export function presentActionPricing(
  pricing: ActionRecord['pricing'], perUnit: 'snake' | 'raw' | 'none' = 'raw',
): ActionPricingView {
  const toll = actionPricingFromRecord(pricing).tollMorsels;
  const out: ActionPricingView = { toll_morsels: toll };
  if (perUnit === 'raw' && pricing.perUnit !== undefined) out.per_unit = pricing.perUnit;
  if (perUnit === 'snake' && pricing.perUnit) {
    out.per_unit = { unit: pricing.perUnit.unit, morsels_per_1000: pricing.perUnit.morselsPer1000 };
  }
  if (legacyMorselFieldsLive()) {
    out.base_morsels = toll;
    out.deprecated = { base_morsels: MORSEL_PRICE_DEPRECATION };
  }
  return out;
}

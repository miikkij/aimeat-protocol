/**
 * @file src/commerce/beneficiary-designation.ts
 * @description How a provider's capability names WHO shares this particular call's revenue.
 *
 *   Some splits are standing facts — "a fifth of what this tool earns goes to the two people who
 *   maintain its data" — and those live in the provider's declared configuration. Others depend on
 *   what the call turned out to be about: a lookup service owes the party it looked up, and which
 *   party that is arrives with the request, not with the contract. This is the channel for the second
 *   kind.
 *
 *   WHAT A CAPABILITY MAY SAY, AND WHAT IT MAY NOT. It names DESTINATIONS and relative weights. It
 *   cannot state an amount, a percent, or a currency, and this module has no way to express one. The
 *   size of the pool is `poolPercent` in the provider's server-held split, so a capability can only
 *   redirect a share its provider already committed — it can never enlarge its own payout, and a
 *   compromised one cannot turn a 5 % split into a 100 % one. Everything it CAN do costs its own owner
 *   money and nobody else's, which is why sandboxed provider code is allowed to do it at all.
 *
 *   IT IS ALSO NOT CLIENT INPUT. The designation is read off what the provider's server-side capability
 *   RETURNED, never off what a request carried. A consumer cannot put `_revenue` in a request body and
 *   have it reach here; the only way into this function is a capability's own output.
 *
 *   The key is stripped before the consumer sees the result. A buyer asked what a company's register
 *   says, not who the seller shares their margin with, and the split is the provider's commercial
 *   business rather than a fact about the answer.
 * @structure REVENUE_KEY · takeDesignations
 * @usage const { designations, result } = takeDesignations(raw);  // then: await outcome.accrue(designations)
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial: the per-call half of multi-beneficiary revenue splitting.
 */
import { BENEFICIARIES_MAX, type DynamicDesignation } from './beneficiary-split.js';

/** The reserved key a capability puts its designations under, in the object it returns. */
export const REVENUE_KEY = '_revenue';

/** A GHII is `owner@node`. Anything that is not shaped like one cannot be paid, so it is dropped. */
function isGhii(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1 && value.length <= 200;
}

/**
 * Pull this call's beneficiary designations out of a capability's result, and hand back the result
 * without them.
 *
 * Tolerant by design: a malformed or absent `_revenue` yields no designations and leaves the result
 * otherwise untouched. The alternative — failing the call — would mean a provider's bookkeeping typo
 * denying a consumer an answer they already paid for.
 *
 * Returns the ORIGINAL object reference when there was nothing to strip, so the overwhelmingly common
 * unpriced/unsplit call does not pay for a copy.
 */
export function takeDesignations(result: unknown): { designations: DynamicDesignation[]; result: unknown } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { designations: [], result };
  const bag = result as Record<string, unknown>;
  if (!(REVENUE_KEY in bag)) return { designations: [], result };

  const { [REVENUE_KEY]: raw, ...rest } = bag;
  // `beneficiaries` names accounts for a pool split; `roles` names WHO holds a role in a chain.
  // Both name destinations only — neither can carry an amount, a percent or a currency.
  const bag2 = raw as { beneficiaries?: unknown; roles?: unknown };
  const rows = [
    ...(Array.isArray(bag2?.beneficiaries) ? bag2.beneficiaries : []),
    ...(Array.isArray(bag2?.roles) ? bag2.roles : []),
  ];
  if (!rows.length) return { designations: [], result: rest };

  const designations: DynamicDesignation[] = [];
  for (const row of rows.slice(0, BENEFICIARIES_MAX)) {
    if (!row || typeof row !== 'object') continue;
    const { ghii, weight, note, role } = row as Record<string, unknown>;
    if (!isGhii(ghii)) continue;
    const w = typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1;
    designations.push({
      ghii, weight: w,
      note: typeof note === 'string' ? note : undefined,
      role: typeof role === 'string' && role ? role.slice(0, 80) : undefined,
    });
  }
  return { designations, result: rest };
}

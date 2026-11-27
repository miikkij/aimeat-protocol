/**
 * @file src/services/app/member-sale-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checks on a carry plan's `sale`, the roles an owner sells (services/app/members.ts
 *   RoleSale), made when the owner sets the plan (PUT /v1/apps/:owner/:filename/members/plan and the
 *   aimeat_app_manage action member_plan_set, both through roster-write.ts setCarryPlan).
 *
 *   Three rules. The request has the shape the plan stores, so nothing the owner typed is dropped
 *   without a word. A sold role has a period (`terms[role].days`), because a purchase pays for one
 *   period and the renewal charges the next. A Stripe Price id sells one role of one app of its owner,
 *   because the outside sale's webhook (commerce/membership-stripe.ts) finds the role by that id.
 * @structure SaleRuleError · saleRequestError (pure) · saleConflict
 * @usage const err = saleRequestError(body.sale) ?? await saleConflict(storage, appId, sale, terms);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import type { Storage } from '../../storage/interface.js';
import { listOwnerSalePlans, sameApp, type AppCarryPlan, type RoleSale } from './members.js';
import { ROLE_RE } from './member-rules.js';

export interface SaleRuleError { code: string; message: string }

const PRICE_RE = /^price_[A-Za-z0-9]{1,250}$/;

/** Pure: what is wrong with a requested `sale`, or null. Undefined (not sent) is never wrong. */
export function saleRequestError(raw: unknown): SaleRuleError | null {
  if (raw === undefined) return null;
  const bad = (message: string): SaleRuleError => ({ code: 'INVALID_INPUT', message });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return bad('sale must be an object of role name to { amount, currency, renews, stripePrices }.');
  }
  for (const [role, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ROLE_RE.test(role)) return bad(`sale.${role}: a role name starts with a letter and holds only letters, digits, ".", "_" or "-".`);
    const s = v as Record<string, unknown> | null;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return bad(`sale.${role} must be an object: { amount, currency, renews, stripePrices }.`);
    const priced = s.amount !== undefined || s.currency !== undefined;
    if (priced && !(typeof s.amount === 'number' && Number.isInteger(s.amount) && s.amount > 0)) {
      return bad(`sale.${role}.amount must be a positive whole number of micro-units (1 EUR is 1000000).`);
    }
    if (priced && !(typeof s.currency === 'string' && /^[A-Za-z]{3}$/.test(s.currency))) {
      return bad(`sale.${role}.currency must be a three-letter currency code such as EUR.`);
    }
    if (s.renews !== undefined && typeof s.renews !== 'boolean') {
      return bad(`sale.${role}.renews must be true (the period renews by itself) or false (a one-time payment).`);
    }
    if (s.stripePrices !== undefined && (!Array.isArray(s.stripePrices) || s.stripePrices.length > 10
      || s.stripePrices.some(p => typeof p !== 'string' || !PRICE_RE.test(p)))) {
      return bad(`sale.${role}.stripePrices must be a list of at most 10 Stripe Price ids (price_…).`);
    }
    const prices = Array.isArray(s.stripePrices) ? s.stripePrices : [];
    if (!priced && prices.length === 0) {
      return bad(`sale.${role} sells nothing: give amount and currency for this node's checkout, stripePrices for your own Stripe links, or both.`);
    }
  }
  return null;
}

/**
 * What the resulting `sale` conflicts with, or null: a sold role without a period, or a Stripe Price
 * id another app of the same owner already sells.
 */
export async function saleConflict(
  storage: Storage, appId: string, sale: Record<string, RoleSale>, terms: AppCarryPlan['terms'],
): Promise<SaleRuleError | null> {
  for (const role of Object.keys(sale)) {
    if (!(typeof terms[role]?.days === 'number' && terms[role]!.days! > 0)) {
      return {
        code: 'SALE_NEEDS_TERM',
        message: `The role "${role}" is for sale, so it needs a period: set terms.${role}.days (30 for a month). A purchase pays for one period.`,
      };
    }
  }
  const mine = Object.entries(sale).flatMap(([role, s]) => s.stripePrices.map(p => ({ role, price: p })));
  if (!mine.length) return null;
  const owner = appId.split('/')[0] ?? '';
  for (const other of await listOwnerSalePlans(storage, owner)) {
    if (sameApp(other.appId, appId)) continue;
    for (const [role, s] of Object.entries(other.sale)) {
      const hit = mine.find(m => s.stripePrices.includes(m.price));
      if (hit) {
        return {
          code: 'STRIPE_PRICE_TAKEN',
          message: `The Stripe price ${hit.price} already sells the role "${role}" of ${other.appId}. One Stripe price sells one role of one app; make another price in Stripe.`,
        };
      }
    }
  }
  return null;
}

/**
 * @file src/commerce/subscription-price-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A renewal whose plan price went UP since the buyer last agreed waits for the buyer's
 *   one-press approval before the kept card is charged (secaudit2026oct22,
 *   commerce/subscriptions:renewal-skips-agent-limit, the price part; developer decision 2026-10-25).
 *
 *   WHY. The plan is written by the extension's own code in its namespace, and a renewal charged the
 *   plan's amount at renewal time, off-session, on the buyer's kept card. A price the buyer never saw
 *   was charged with no notice before the charge. The buyer agreed to the amount on the subscription
 *   record (`amount`): a renewal at that price or a lower one renews as before; a higher one, or one in
 *   another currency, files a question in the request store under the approval standard
 *   (services/approval-standard.ts): the buyer gets a notice with the old and the new price and Allow
 *   and Don't allow, the seller (the extension's owner, for whom the renewal runs) sees it pending on
 *   GET /v1/publish-requests/:id and hears the answer either way. Allowing it writes the new amount
 *   onto the record and renews at once (publish-requests/apply-subscription-price.ts). Not allowing it,
 *   or no answer, leaves the card uncharged, and the subscription ends at its date; it is not asked
 *   again for the same price in the same period.
 * @structure periodShortened · priceRose · askBuyerForPrice
 * @usage if (priceRose(sub, plan)) return askBuyerForPrice(ctx, sub, plan, sellerGhii, saveQuestion);
 * @version-history
 *   v1.1.0 — 2026-10-27 — A shorter plan period at an amount that does not fall with it is a higher
 *     price per day and is asked the same way (approval_subscription_period); the question records the
 *     period it asked about (secaudit2026oct26, renewal-period-shortened-bypasses-price-ask).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { filePublishRequest, readPublishRequest, effectiveState } from '../services/publish-requests/store.js';
import { formatMoneyMajor } from './money.js';
import { logger } from '../utils/logger.js';

/**
 * The price question a subscription record keeps: which request asked which price for which period.
 * `period_days` is the plan's period the buyer was asked about (absent on questions filed before
 * 2026-10-27, which asked about the amount only).
 */
export interface SubscriptionPriceQuestion { request_id: string; amount: number; currency: string; period: string; period_days?: number }

interface SubLike {
  ext: string; plan: string; title: string; buyer_ghii: string; amount: number; currency: string;
  period_days?: number; active_until: string; price_question?: SubscriptionPriceQuestion;
}
interface PlanLike { amount: number; currency: string; title: string; period_days?: number }

/**
 * The plan costs more per day than the buyer agreed to (the plan's period got shorter at an amount
 * that does not fall with it), with the amount itself not higher. Each renewal charges the amount and
 * extends by the plan's period, so a shorter period is charged more often (secaudit2026oct26).
 */
export function periodShortened(sub: Pick<SubLike, 'amount' | 'currency' | 'period_days'>, plan: Pick<PlanLike, 'amount' | 'currency' | 'period_days'>): boolean {
  const had = Number(sub.period_days), now = Number(plan.period_days);
  if (!(had > 0) || !(now > 0) || plan.currency !== sub.currency) return false;
  return plan.amount * had > sub.amount * now;
}

/** The plan costs more than the buyer agreed to, in amount or per day, or is in another currency. */
export function priceRose(sub: Pick<SubLike, 'amount' | 'currency' | 'period_days'>, plan: Pick<PlanLike, 'amount' | 'currency' | 'period_days'>): boolean {
  return plan.currency !== sub.currency || plan.amount > sub.amount || periodShortened(sub, plan);
}

const money = (micros: number, currency: string) => `${formatMoneyMajor(micros)} ${currency}`;

/**
 * Ask the buyer once per period and price, or report how the standing question stands. The card is
 * never charged from here. `save` writes the question onto the subscription record.
 */
export async function askBuyerForPrice(
  ctx: { storage: Storage; config: AimeatConfig }, sub: SubLike, plan: PlanLike, sellerGhii: string,
  save: (q: SubscriptionPriceQuestion) => Promise<void>,
): Promise<{ result: 'skipped'; detail: string }> {
  const q = sub.price_question;
  if (q && q.amount === plan.amount && q.currency === plan.currency && q.period === sub.active_until
    && (q.period_days === undefined || q.period_days === plan.period_days)) {
    const r = await readPublishRequest(ctx.storage, sub.buyer_ghii, q.request_id);
    const state = r ? effectiveState(r) : 'expired';
    if (state === 'awaiting_owner') return { result: 'skipped', detail: `waiting for the buyer to allow the new price (request ${q.request_id})` };
    return { result: 'skipped', detail: `the buyer did not allow the new price (${state}); the subscription ends on ${sub.active_until.slice(0, 10)}` };
  }
  const from = money(sub.amount, sub.currency);
  const to = money(plan.amount, plan.currency);
  const date = sub.active_until.slice(0, 10);
  // The amount did not go up but the period got shorter: the question names both periods.
  const byPeriod = plan.amount <= sub.amount && plan.currency === sub.currency && periodShortened(sub, plan);
  const fromDays = String(sub.period_days ?? ''), toDays = String(plan.period_days ?? '');
  const filed = await filePublishRequest(ctx, sub.buyer_ghii, {
    kind: 'subscription-price',
    target: {
      ext: sub.ext, plan: sub.plan, period: sub.active_until, amount: plan.amount, currency: plan.currency,
      ...(plan.period_days !== undefined ? { period_days: plan.period_days } : {}),
    },
    title: byPeriod ? `the renewal of ${plan.title} at ${to} every ${toDays} days` : `the renewal of ${plan.title} at ${to}`,
    name: plan.title,
    change: byPeriod ? { field: 'period_days', from: sub.period_days, to: plan.period_days } : { field: 'amount', from: sub.amount, to: plan.amount },
    requested_by: { principal: sellerGhii, kind: 'person', sub: sellerGhii },
    approval: byPeriod ? {
      approver: 'owner',
      asks: `renew your subscription ${plan.title} at ${to} every ${toDays} days (you agreed to ${from} every ${fromDays} days)`,
      why: `The period got shorter since you subscribed, so you would pay more often, and your card is charged only if you agree. If you do not, the subscription ends on ${date}.`,
      approve_scope: 'commerce:buy',
      i18n: { key: 'approval_subscription_period', vars: { name: plan.title, from, to, fromDays, toDays, date } },
    } : {
      approver: 'owner',
      asks: `renew your subscription ${plan.title} at the new price ${to} (you agreed to ${from})`,
      why: `The price went up since you subscribed, so your card is charged only if you agree. If you do not, the subscription ends on ${date}.`,
      // An agent of the buyer that may buy for them may answer it; the renewal is still held to the agent's daily limit.
      approve_scope: 'commerce:buy',
      i18n: { key: 'approval_subscription_price', vars: { name: plan.title, from, to, date } },
    },
  });
  if (!filed.ok) {
    logger.warn('subscriptions: the price question could not be filed; the card is not charged', { buyer: sub.buyer_ghii, ext: sub.ext, plan: sub.plan, error: filed.message });
    return { result: 'skipped', detail: `the price went up and the buyer could not be asked: ${filed.message}` };
  }
  await save({
    request_id: filed.request.id, amount: plan.amount, currency: plan.currency, period: sub.active_until,
    ...(plan.period_days !== undefined ? { period_days: plan.period_days } : {}),
  });
  if (byPeriod) return { result: 'skipped', detail: `the period went from ${fromDays} to ${toDays} days at ${to}; asked the buyer (request ${filed.request.id})` };
  return { result: 'skipped', detail: `the price went up from ${from} to ${to}; asked the buyer (request ${filed.request.id})` };
}

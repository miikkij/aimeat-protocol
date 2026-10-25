/**
 * @file src/commerce/subscriptions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A recurring payment: a reader subscribes to a creator or a studio for a period and
 *   reads all their paid episodes while it runs (Comicland v3 A-5, KAU-03).
 *
 *   THE PLAN belongs to an extension, because the extension knows its creators and studios: it writes
 *   `subscription.plans` in its own namespace (`ext:{name}`), which only it can write, as
 *   `{ plans: [{ id, title, amount, currency, period_days, beneficiaries? }] }` (amount in 6-decimal
 *   micro-units). The seller is the extension's owner, paid on their own payment setup, as for every
 *   priced action. `beneficiaries` names who shares the plan's revenue ({ ghii, weight, note }), the
 *   way an action's result names them; the seller's split on the coordinate (extension, `subscription`)
 *   decides how large the shared part is, so a plan can only redirect a share the seller committed.
 *
 *   A PURCHASE is a checkout line `{ kind: 'subscription', app: <extension>, tool: <plan id> }`, with
 *   `input.auto_renew` (default true). Completing it writes the buyer's record
 *   `commerce.subscription.{extension}.{plan}` (a service-owned key, so nobody but this file sets an
 *   end date) and extends `active_until` by one period from now or from the current end, whichever is
 *   later. With automatic renewal the card is kept at the payment provider on the seller's account.
 *
 *   RENEWAL is the node's job, not the payment provider's (the rule package renewals follow):
 *   runSubscriptionRenewals() charges the kept card three days before the end, once per period, and
 *   books the plan's beneficiaries. A failed charge tells the buyer once per period and is tried again
 *   each day; the subscription ends at its date by itself. Cancelling stops renewal and keeps the
 *   period that was paid for.
 *
 *   READING: an extension sees the caller's running subscriptions to it on `ctx.caller.subscriptions`
 *   (services/extension-invoke.ts); the buyer lists and cancels theirs on /v1/commerce/subscriptions.
 * @structure PLANS_KEY · SUBSCRIPTION_PREFIX · readPlan · subscriptionSellableResolver ·
 *   activeSubscriptions · listSubscriptions · cancelSubscription · runSubscriptionRenewals
 * @version-history
 *   v1.1.0 — 2026-10-25 — A renewal of a plan an agent bought (bought_by) is reserved against the
 *     agent's daily limit right before the charge and released when the charge fails; a refusal tells
 *     the owner once per period (secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-5).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { reserveAgentPurchase, releaseAgentPurchase } from './agent-purchase-limit.js';
import { agentSessionCaller } from '../services/caller-context.js';
import type { Sellable, SavedPayment } from './types.js';
import type { SellableResolver } from './sellable-resolvers.js';
import { CommerceError } from './errors.js';
import { getPaymentHandler, listPaymentHandlers } from './payment-handlers.js';
import { integerMicros, percentFee } from './money.js';
import { readSplit, computeSplit, type DynamicDesignation } from './beneficiary-split.js';
import { bookBeneficiaryShares } from './beneficiary-book.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { notify } from '../services/notify.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';

/** Where an extension keeps its plans, in its own namespace. */
export const PLANS_KEY = 'subscription.plans';
/** The buyer's records, one per (extension, plan). Service-owned (utils/reserved-keys.ts). */
export const SUBSCRIPTION_PREFIX = 'commerce.subscription.';
/** The split coordinate's action for every plan of one extension. */
export const SUBSCRIPTION_ACTION = 'subscription';
/** How many days before the end a kept card is charged. */
const RENEW_DAYS_BEFORE = 3;
const DAY_MS = 86_400_000;

export interface SubscriptionPlan {
  id: string;
  title: string;
  amount: number;
  currency: string;
  period_days: number;
  beneficiaries?: Array<{ ghii: string; weight?: number; note?: string }>;
}

export interface SubscriptionRecord {
  ext: string;
  plan: string;
  title: string;
  seller_ghii: string;
  buyer_ghii: string;
  amount: number;
  currency: string;
  period_days: number;
  started_at: string;
  active_until: string;
  auto_renew: boolean;
  /** The agent that bought it, whose daily limit each renewal is held to; absent for a person. */
  bought_by?: string;
  /** The card kept at the payment provider on the seller's account, and the handler that charges it. */
  kept_payment?: { handler: string } & SavedPayment;
  last_order?: string;
  last_failure?: { at: string; reason: string };
  updated_at: string;
}

const subKey = (ext: string, plan: string): string => `${SUBSCRIPTION_PREFIX}${ext}.${plan}`;

/** A plan an extension published, checked for shape; null when it is not there or not usable. */
export async function readPlan(storage: Storage, ext: string, planId: string): Promise<SubscriptionPlan | null> {
  const value = (await storage.getMemory(`ext:${ext}`, PLANS_KEY))?.value as { plans?: unknown } | undefined;
  const plans = Array.isArray(value?.plans) ? value!.plans as Array<Record<string, unknown>> : [];
  const p = plans.find(x => x && x.id === planId);
  if (!p) return null;
  const amount = Number(p.amount);
  const period = Number(p.period_days);
  if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(period) || period < 1 || period > 366 || typeof p.currency !== 'string') return null;
  return {
    id: planId, title: typeof p.title === 'string' && p.title ? p.title.slice(0, 200) : planId,
    amount, currency: p.currency.toUpperCase(), period_days: period,
    ...(Array.isArray(p.beneficiaries) ? { beneficiaries: p.beneficiaries as SubscriptionPlan['beneficiaries'] } : {}),
  };
}

async function readRecord(storage: Storage, ownerGhii: string, ext: string, plan: string): Promise<SubscriptionRecord | null> {
  return parseRecord((await storage.getMemory(ownerGhii, subKey(ext, plan)))?.value);
}

function parseRecord(value: unknown): SubscriptionRecord | null {
  const v = value as SubscriptionRecord | undefined;
  return v && typeof v.active_until === 'string' ? v : null;
}

async function putRecord(storage: Storage, rec: SubscriptionRecord): Promise<void> {
  const key = subKey(rec.ext, rec.plan);
  const existing = await storage.getMemory(rec.buyer_ghii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: rec.buyer_ghii, value: rec, visibility: 'private', tags: [], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing ? existing.createdAt : now, updatedAt: now,
  });
}

/** The plan's payees, as the designations a split reads. */
function designationsOf(plan: { beneficiaries?: SubscriptionPlan['beneficiaries'] }): DynamicDesignation[] {
  return (plan.beneficiaries ?? [])
    .filter(b => b && typeof b.ghii === 'string' && b.ghii.includes('@'))
    .map(b => ({ ghii: b.ghii, weight: typeof b.weight === 'number' && b.weight > 0 ? b.weight : 1, ...(b.note ? { note: String(b.note).slice(0, 200) } : {}) }));
}

/** The checkout line kind `subscription`: one period of an extension's plan. */
export function subscriptionSellableResolver(): SellableResolver {
  return {
    kind: 'subscription',
    async resolve(storage, config, ref): Promise<Sellable> {
      const extName = ref.app ?? '';
      const planId = ref.tool ?? ref.offer_id ?? '';
      if (!extName || !planId) throw new CommerceError('INVALID_ITEM', 400, 'subscription items need app: "<extension>" and tool: "<plan id>"');
      const ext = await storage.getExtension(extName);
      if (!ext || ext.status !== 'active') throw new CommerceError('EXT_NOT_FOUND', 404, `Extension "${extName}" is not installed/active`);
      const plan = await readPlan(storage, extName, planId);
      if (!plan) throw new CommerceError('PLAN_NOT_FOUND', 404, `"${extName}" offers no subscription "${planId}"`);
      const currency = ref.currency && ref.currency !== 'morsel' ? ref.currency : plan.currency;
      if (currency !== plan.currency) throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `This subscription is priced in ${plan.currency}, not ${currency}`);
      if (!listPaymentHandlers().some(h => h.currencies.includes(currency))) {
        throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}`);
      }
      const sellerOwner = ext.installedBy;
      const sellerGhii = `${sellerOwner}@${config.nodeId}`;
      const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined;
      return {
        kind: 'subscription', agentGaii: extName, agentName: extName, offerId: planId,
        title: `${plan.title} (${plan.period_days} days)`, sellerOwner, sellerGhii,
        unitPrice: integerMicros(plan.amount), tollMorsels: 0, psp,
        async fulfill(ctx, { session, item, payment }) {
          const autoRenew = (item.input as { auto_renew?: unknown } | undefined)?.auto_renew !== false;
          const now = Date.now();
          const before = await readRecord(ctx.storage, session.buyerGhii, extName, planId);
          const from = before && Date.parse(before.active_until) > now ? Date.parse(before.active_until) : now;
          const rec: SubscriptionRecord = {
            ext: extName, plan: planId, title: plan.title, seller_ghii: sellerGhii, buyer_ghii: session.buyerGhii,
            amount: plan.amount, currency, period_days: plan.period_days,
            started_at: before?.started_at ?? new Date(now).toISOString(),
            active_until: new Date(from + plan.period_days * DAY_MS).toISOString(),
            auto_renew: autoRenew && !!payment?.saved,
            ...(session.buyerIdentity && session.buyerIdentity.includes('#') ? { bought_by: session.buyerIdentity } : {}),
            ...(payment?.saved ? { kept_payment: { handler: payment.handler, ...payment.saved } } : before?.kept_payment ? { kept_payment: before.kept_payment } : {}),
            last_order: `checkout:${session.id}`,
            updated_at: new Date(now).toISOString(),
          };
          await putRecord(ctx.storage, rec);
          emitChange('commerce', session.buyerGhii);
          const named = designationsOf(plan);
          return {
            result: {
              subscription: { ext: extName, plan: planId, active_until: rec.active_until, auto_renew: rec.auto_renew },
              ...(named.length ? { _revenue: { beneficiaries: named } } : {}),
            },
            sellerResult: { subscription: { ext: extName, plan: planId, active_until: rec.active_until } },
          };
        },
      };
    },
  };
}

/** The caller's running subscriptions to one extension, for ctx.caller.subscriptions. */
export async function activeSubscriptions(storage: Storage, ownerGhii: string, ext: string, now = Date.now()): Promise<Array<{ plan: string; active_until: string }>> {
  const rows = await storage.listMemory(ownerGhii, { prefix: `${SUBSCRIPTION_PREFIX}${ext}.` });
  return rows
    .map(r => r.value as SubscriptionRecord)
    .filter(v => v && v.ext === ext && Date.parse(v.active_until) > now)
    .map(v => ({ plan: v.plan, active_until: v.active_until }));
}

/** What the buyer is shown: every subscription of theirs, running or ended, without card ids. */
export async function listSubscriptions(storage: Storage, ownerGhii: string, now = Date.now()) {
  const rows = await storage.listMemory(ownerGhii, { prefix: SUBSCRIPTION_PREFIX });
  return rows.map(r => r.value as SubscriptionRecord).filter(v => v && typeof v.active_until === 'string').map(v => ({
    ext: v.ext, plan: v.plan, title: v.title, amount: v.amount, currency: v.currency, period_days: v.period_days,
    started_at: v.started_at, active_until: v.active_until, active: Date.parse(v.active_until) > now,
    auto_renew: v.auto_renew, ...(v.last_failure ? { last_failure: v.last_failure } : {}),
  }));
}

/** Stop the renewal; the period paid for runs to its end. Null when the buyer has no such subscription. */
export async function cancelSubscription(storage: Storage, ownerGhii: string, ext: string, plan: string) {
  const rec = await updateRecord(storage, ownerGhii, subKey(ext, plan), parseRecord,
    cur => cur ? { ...cur, auto_renew: false, updated_at: new Date().toISOString() } : UNCHANGED, { tag: SUBSCRIPTION_ACTION });
  if (!rec) return null;
  emitChange('commerce', ownerGhii);
  return { ext, plan, active_until: rec.active_until, auto_renew: false };
}

export interface SubscriptionRenewalOutcome { buyer: string; ext: string; plan: string; result: 'renewed' | 'failed' | 'skipped'; detail?: string }

/** Charge and extend every subscription whose renewal is due. Never throws. */
export async function runSubscriptionRenewals(storage: Storage, config: AimeatConfig, now = Date.now()): Promise<SubscriptionRenewalOutcome[]> {
  const out: SubscriptionRenewalOutcome[] = [];
  const { items } = await storage.listAllMemory({ prefix: SUBSCRIPTION_PREFIX, limit: 10_000 });
  for (const row of items) {
    const sub = row.value as SubscriptionRecord;
    if (!sub?.auto_renew || !sub.kept_payment?.payment_method) continue;
    const until = Date.parse(sub.active_until);
    if (!Number.isFinite(until) || until <= now || until - now > RENEW_DAYS_BEFORE * DAY_MS) continue;
    const base = { buyer: sub.buyer_ghii, ext: sub.ext, plan: sub.plan };
    const reference = `subrenew:${sub.buyer_ghii}:${sub.ext}:${sub.plan}:${sub.active_until}`;
    if (sub.last_order === reference) { out.push({ ...base, result: 'skipped', detail: 'already renewed for this period' }); continue; }
    try {
      out.push({ ...base, ...await renewOne(storage, config, sub, reference) });
    } catch (err) {
      logger.warn('subscriptions: one renewal failed, continuing', { ...base, error: String(err) });
      out.push({ ...base, result: 'failed', detail: String(err) });
    }
  }
  return out;
}

async function renewOne(storage: Storage, config: AimeatConfig, sub: SubscriptionRecord, reference: string): Promise<Pick<SubscriptionRenewalOutcome, 'result' | 'detail'>> {
  // The plan as the extension offers it now: a price it changed applies from the next period, and a
  // plan it removed is not renewed.
  const plan = await readPlan(storage, sub.ext, sub.plan);
  const ext = await storage.getExtension(sub.ext);
  if (!plan || !ext || ext.status !== 'active') return { result: 'skipped', detail: 'the plan is no longer offered' };
  const handler = getPaymentHandler(sub.kept_payment!.handler);
  if (!handler?.chargeSaved) return { result: 'skipped', detail: `handler ${sub.kept_payment!.handler} cannot charge a kept card` };
  const sellerGhii = `${ext.installedBy}@${config.nodeId}`;
  const seller = { ghii: sellerGhii, owner: ext.installedBy, psp: (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined };
  // A plan an agent bought renews as that agent's purchase, held to the daily limit its owner set,
  // checked and counted in one step right before the charge and given back when the charge fails, as
  // the package renewal does (secaudit2026oct22).
  const spend = { buyerGhii: sub.buyer_ghii, currency: plan.currency, total: plan.amount };
  const agent = sub.bought_by ? agentSessionCaller(sub.bought_by, '', [], config.nodeId, storage).auth : null;
  let trackingCode: string;
  try {
    const refusal = await reserveAgentPurchase(storage, config, spend, agent);
    if (refusal) throw refusal;
    try {
      trackingCode = (await handler.chargeSaved({ config, storage }, { amount: plan.amount, currency: plan.currency, reference, saved: sub.kept_payment!, seller })).trackingCode;
    } catch (err) {
      await releaseAgentPurchase(storage, spend, agent);
      throw err;
    }
  } catch (err) {
    const overLimit = err instanceof CommerceError && err.code.startsWith('PURCHASE_LIMIT_');
    const reason = err instanceof CommerceError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    const told = sub.last_failure?.reason.startsWith(`[${sub.active_until}]`);
    await updateRecord(storage, sub.buyer_ghii, subKey(sub.ext, sub.plan), parseRecord, cur => ({
      ...(cur ?? sub), last_failure: { at: new Date().toISOString(), reason: `[${sub.active_until}] ${reason}` }, updated_at: new Date().toISOString(),
    }), { tag: SUBSCRIPTION_ACTION });
    if (!told) {
      const date = sub.active_until.slice(0, 10);
      await notify(storage, sub.buyer_ghii, {
        type: 'subscription_renewal_failed',
        title: `The renewal of ${plan.title} did not go through`,
        body: overLimit
          ? `The agent that bought this subscription may not spend this today (${reason}). The card was not charged. The subscription ends on ${date} unless you renew it yourself or raise the agent's limit; this node tries again each day until then.`
          : `The card could not be charged (${reason}). The subscription ends on ${date} unless the payment goes through; this node tries again each day until then.`,
        i18n: { key: overLimit ? 'subscription_renewal_agent_limit' : 'subscription_renewal_failed', vars: { name: plan.title, date } },
      });
      emitChange('notifications', sub.buyer_ghii);
    }
    return { result: 'failed', detail: reason };
  }
  const renewed = await updateRecord(storage, sub.buyer_ghii, subKey(sub.ext, sub.plan), parseRecord, cur => ({
    ...(cur ?? sub), amount: plan.amount, currency: plan.currency, period_days: plan.period_days, title: plan.title,
    active_until: new Date(Date.parse((cur ?? sub).active_until) + plan.period_days * DAY_MS).toISOString(),
    last_order: reference, updated_at: new Date().toISOString(),
  }), { tag: SUBSCRIPTION_ACTION });
  const nextUntil = renewed!.active_until;
  // The seller's net of the renewal, shared with the plan's payees by the seller's split, as at checkout.
  const net = plan.amount - percentFee(plan.amount, commerceFeePercent(config));
  try {
    const split = await readSplit(storage, sellerGhii, sub.ext, SUBSCRIPTION_ACTION);
    const result = computeSplit(net, split, designationsOf(plan));
    if (result.lines.length) {
      await bookBeneficiaryShares(storage, {
        lines: result.lines, trackingCode: `sub_${trackingCode}`, fromGhii: sellerGhii, currency: plan.currency,
        buyerGhii: sub.buyer_ghii, reference,
      });
    }
  } catch (err) {
    logger.error('subscriptions: the renewal\'s revenue split was not booked; the seller keeps the whole cut', { reference, error: String(err) });
  }
  emitChange('commerce', sub.buyer_ghii);
  return { result: 'renewed', detail: nextUntil };
}

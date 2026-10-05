/**
 * @file src/services/packages/sale/package-renewals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Automatic renewal of a package's update service, on the selling node
 *   (docs/specs/package-sale-design.md, section 3, "Renewal: the date is the clock"; Jouni's ruling of
 *   2026-10-02 on open question 4).
 *
 *   THE DATE IS THE ONE CLOCK. The repository's `updates_until` ends the updates by itself; nothing
 *   here has to stop anything. This job only moves the date forward for a buyer who turned automatic
 *   renewal on: three days before it, it charges the card kept at the first payment (on the seller of
 *   record's own payment account; this node holds only the PSP's reference ids), at the renewal price
 *   the buyer accepted, and then grants the next period on the repository by the signed seller request.
 *
 *   ONCE PER PERIOD. The charge's reference names the buyer, the package, the node and the date being
 *   renewed, and the subscription records it as its last order, so a second run in the same period
 *   charges nothing.
 *
 *   WHEN IT FAILS. A declined card, or a bank that wants the buyer to confirm, is recorded and the owner
 *   is told once per period, with a link to renew by hand; the job tries again the next day until the
 *   date. When the date passes unpaid, the updates stop and the install keeps working. A charge that
 *   succeeds and a grant the repository then refuses is refunded.
 *
 *   AN AGENT'S RENEWAL IS ITS PURCHASE. When an agent turned automatic renewal on (`auto_renew_by`),
 *   each renewal is held to the daily purchase limit its owner set for it, reserved right before the
 *   charge and given back when the charge fails or the payment is refunded, as a checkout does
 *   (commerce/agent-purchase-limit.ts). Without this, an agent with a limit could commit its owner to
 *   charges past it (secaudit 2026-10 follow-up, A6).
 *
 *   NO STRIPE SUBSCRIPTION. With one, Stripe would keep a second clock that this node would have to
 *   follow through Stripe's events; the node decides when to charge.
 * @structure AUTO_RENEW_DAYS_BEFORE · runAutoRenewals()
 * @version-history
 *   v1.1.0 — 2026-10-06 — A renewal an agent turned on is held to that agent's daily purchase limit
 *     (secaudit 2026-10 follow-up, A6).
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { PeerInfo } from '../../federation.js';
import { getPaymentHandler } from '../../../commerce/payment-handlers.js';
import { bookSessionlessSale } from '../../../commerce/session-service.js';
import { allSubscriptions, catalogueEntry, putSubscription, type Subscription } from './package-sale-catalogue.js';
import { readOfferAsSeller, carryOutSale } from './package-sale-checkout.js';
import { notify } from '../../notify.js';
import { reserveAgentPurchase, releaseAgentPurchase } from '../../../commerce/agent-purchase-limit.js';
import { CommerceError } from '../../../commerce/errors.js';
import { emitChange } from '../../event-bus.js';
import { logger } from '../../../utils/logger.js';

/** How many days before the end of updates an automatic renewal is charged. */
export const AUTO_RENEW_DAYS_BEFORE = 3;

type Deps = { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> };

export interface RenewalOutcome { buyer: string; group_id: string; node_id: string; result: 'renewed' | 'failed' | 'skipped'; detail?: string }

const referenceOf = (s: Subscription): string => `renew:${s.buyer}:${s.group_id}:${s.node_id}:${s.updates_until}`;

/** Charge and renew every subscription whose automatic renewal is due. Never throws. */
export async function runAutoRenewals(deps: Deps, now = Date.now()): Promise<RenewalOutcome[]> {
    const out: RenewalOutcome[] = [];
    for (const sub of await allSubscriptions(deps.storage)) {
        if (!sub.auto_renew || !sub.renewal || !sub.payment?.payment_method || !sub.updates_until) continue;
        const until = Date.parse(sub.updates_until);
        // Past the date it has lapsed by itself; more than three days away it is not due.
        if (!Number.isFinite(until) || until <= now || until - now > AUTO_RENEW_DAYS_BEFORE * 86_400_000) continue;
        const base = { buyer: sub.buyer, group_id: sub.group_id, node_id: sub.node_id };
        const reference = referenceOf(sub);
        if (sub.last_order === reference) { out.push({ ...base, result: 'skipped', detail: 'already renewed for this period' }); continue; }
        try {
            out.push({ ...base, ...await renewOne(deps, sub, reference) });
        } catch (err) {
            logger.warn('package-renewals: one renewal failed, continuing', { ...base, error: String(err) });
            out.push({ ...base, result: 'failed', detail: String(err) });
        }
    }
    return out;
}

async function renewOne(deps: Deps, sub: Subscription, reference: string): Promise<Pick<RenewalOutcome, 'result' | 'detail'>> {
    const { storage, config } = deps;
    const buyerGhii = `${sub.buyer}@${config.nodeId}`;
    const entry = await catalogueEntry(storage, sub.repository, sub.group_id);
    if (!entry || entry.state === 'ended') return { result: 'skipped', detail: 'this node no longer sells it' };
    const handler = getPaymentHandler(sub.payment!.handler);
    if (!handler?.chargeSaved) return { result: 'skipped', detail: `handler ${sub.payment!.handler} cannot charge a kept card` };
    const sellerGhii = `${entry.seller_of_record}@${config.nodeId}`;
    const seller = { ghii: sellerGhii, owner: entry.seller_of_record, psp: (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined };
    const amount = sub.renewal!.amount;
    const currency = sub.renewal!.currency;
    // An agent turned automatic renewal on: each renewal is that agent's purchase, held to the daily
    // limit its owner set, checked and counted in one step right before the charge, as a checkout
    // does (commerce/agent-purchase-limit.ts; secaudit 2026-10 follow-up, A6).
    const spend = { buyerGhii, currency, total: amount };
    const agent = sub.auto_renew_by ? { sub: sub.auto_renew_by, roles: ['agent'] } : null;

    let trackingCode: string;
    try {
        const refusal = await reserveAgentPurchase(storage, config, spend, agent);
        if (refusal) throw refusal;
        try {
            trackingCode = (await handler.chargeSaved({ config, storage }, { amount, currency, reference, saved: sub.payment!, seller })).trackingCode;
        } catch (err) {
            await releaseAgentPurchase(storage, spend, agent);
            throw err;
        }
    } catch (err) {
        const reason = err instanceof CommerceError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
        const told = sub.last_failure && sub.last_failure.reason.startsWith(`[${sub.updates_until}]`);
        await putSubscription(storage, { ...sub, last_failure: { at: new Date().toISOString(), reason: `[${sub.updates_until}] ${reason}` }, updatedAt: new Date().toISOString() });
        if (!told) {
            const overLimit = err instanceof CommerceError && err.code.startsWith('PURCHASE_LIMIT_');
            const date = sub.updates_until!.slice(0, 10);
            await notify(storage, buyerGhii, {
                type: 'package_renewal_failed',
                title: `The automatic renewal of ${entry.title ?? sub.group_id} did not go through`,
                body: overLimit
                    ? `The agent that turned automatic renewal on may not spend this today (${reason}). The card was not charged. The updates end on ${date} unless you renew by hand or raise the agent's limit; this node tries again each day until then.`
                    : `The card could not be charged (${reason}). The updates end on ${date} unless you renew by hand; this node tries again each day until then.`,
                link: '/v1/profile?tab=packages',
                i18n: { key: overLimit ? 'package_renewal_agent_limit' : 'package_renewal_failed', vars: { name: entry.title ?? sub.group_id, date } },
            });
            emitChange('notifications', buyerGhii);
        }
        return { result: 'failed', detail: reason };
    }

    try {
        const offer = await readOfferAsSeller(deps, sub.repository, sub.group_id);
        await carryOutSale(deps, {
            entry, offer, line: { act: 'renew', nodeId: sub.node_id }, buyer: sub.buyer, order: reference,
            input: {}, paid: { amount, currency },
        });
    } catch (err) {
        // The money moved and the repository refused the period: give it back, and the agent's count with it.
        await handler.refund({ config, storage }, { buyerGhii, amount, trackingCode, seller });
        await releaseAgentPurchase(storage, spend, agent);
        throw err;
    }
    await bookSessionlessSale(storage, config, {
        gross: amount, currency, sellerGhii, buyerRef: buyerGhii,
        ext: `package:${sub.group_id}`, action: 'renewal', trackingCode, handler: handler.id, reference,
    });
    await notify(storage, buyerGhii, {
        type: 'package_renewed',
        title: `${entry.title ?? sub.group_id} was renewed`,
        body: `Your card was charged ${(amount / 1_000_000).toFixed(2)} ${currency}, and the updates go on for another ${sub.renewal!.period_days} days.`,
        link: '/v1/profile?tab=packages',
        i18n: { key: 'package_renewed', vars: { name: entry.title ?? sub.group_id, amount: `${(amount / 1_000_000).toFixed(2)} ${currency}`, days: String(sub.renewal!.period_days) } },
    });
    emitChange('notifications', buyerGhii);
    return { result: 'renewed' };
}

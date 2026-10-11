/**
 * @file src/commerce/pacing-pack.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Buying pacing capacity with money (Jouni 2026-10-11, decision-buying-pacing-capacity-
 *   with-money-is-built-now-a-money-price). A morsel is never a price, but morsels may be bought: when a
 *   user has spent their daily allowance, the operator can sell them more pacing capacity. The operator
 *   sets a pack (AIMEAT_PACING_PACK_MORSELS morsels for AIMEAT_PACING_PACK_PRICE micro-units of
 *   AIMEAT_PACING_PACK_CURRENCY); it is off while either number is 0.
 *
 *   The pack is an ordinary checkout line `{ kind: 'pacing-pack', quantity }`, paid through a money
 *   handler on the operator's own payment account like any other sale. Fulfilment adds the morsels to
 *   the buyer's owner balance, inside the node's daily mint ceiling (AIMEAT_MAX_OPERATOR_MINT_PER_DAY,
 *   counted together with operator mints), so a sale cannot print more than the operator could.
 * @structure pacingPackOffer · insufficientMorselsMessage · pacingPackSellableResolver
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Sellable } from './types.js';
import { CommerceError } from './errors.js';
import { listPaymentHandlers } from './payment-handlers.js';
import { formatMoneyMajor, isSupportedMoneyCurrency } from './money.js';
import { resolveOperatorFeeGhii } from '../services/marketplace-fee.js';
import { localAccountName } from '../utils/gaii.js';

export const PACING_PACK_KIND = 'pacing-pack';

/** The pack this node sells, or null when it sells none. */
export function pacingPackOffer(config: AimeatConfig): {
  morsels: number; price: { amount: number; currency: string }; checkout_item: { kind: string; quantity: number };
} | null {
  const morsels = config.pacingPackMorsels ?? 0;
  const amount = config.pacingPackPrice ?? 0;
  const currency = config.pacingPackCurrency ?? 'EUR';
  if (!(morsels > 0) || !(amount > 0) || !isSupportedMoneyCurrency(currency)) return null;
  return { morsels, price: { amount, currency }, checkout_item: { kind: PACING_PACK_KIND, quantity: 1 } };
}

/** What a 402 says when a use needs more morsels than the payer has: how to get more. */
export function insufficientMorselsMessage(config: AimeatConfig, needed: number): string {
  const pack = pacingPackOffer(config);
  const buy = pack
    ? ` or buy pacing capacity from the operator: ${pack.morsels} morsels for ${formatMoneyMajor(pack.price.amount)} ${pack.price.currency} (checkout item { kind: "${PACING_PACK_KIND}" })`
    : ' or ask the operator of this node';
  return `This use needs ${needed} morsels of pacing and your balance does not cover it. Get more with the daily allowance (POST /v1/wallet/request),${buy}. Morsels pace how fast anything is used; they are not a price.`;
}

/** Morsels added today by sales and operator mints together, for the shared daily ceiling. */
async function mintedToday(storage: Storage): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const all = await storage.listAllTransactions();
  return all
    .filter(tx => (tx.type === 'mint' || tx.type === 'pacing_pack') && new Date(tx.timestamp) >= dayStart)
    .reduce((sum, tx) => sum + Math.max(0, tx.amount), 0);
}

/**
 * The checkout resolver for `{ kind: 'pacing-pack', quantity }`. The seller is the operator. Its shape is
 * the SellableResolver interface, written out here because sellable-resolvers.ts re-exports this
 * function for the route loader and an import back would be a cycle.
 */
export function pacingPackSellableResolver(): {
  kind: string;
  resolve(storage: Storage, config: AimeatConfig, ref: { currency?: string }, buyerOwner: string): Promise<Sellable>;
} {
  return {
    kind: PACING_PACK_KIND,
    async resolve(storage, config, ref, buyerOwner) {
      const pack = pacingPackOffer(config);
      if (!pack) throw new CommerceError('PACING_PACK_UNAVAILABLE', 404, 'This node does not sell pacing capacity. Morsels come from the daily allowance (POST /v1/wallet/request).');
      const currency = ref.currency ?? pack.price.currency;
      if (currency !== pack.price.currency) {
        throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `The pacing pack is sold in ${pack.price.currency}; open the checkout with currency ${pack.price.currency}.`);
      }
      if (!listPaymentHandlers().some((h) => h.currencies.includes(currency))) {
        throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}`);
      }
      const sellerGhii = await resolveOperatorFeeGhii(storage, config);
      if (!sellerGhii) throw new CommerceError('PACING_PACK_UNAVAILABLE', 409, 'This node has no operator account to sell pacing capacity.');
      const sellerOwner = localAccountName(sellerGhii);
      if (sellerOwner === localAccountName(buyerOwner)) {
        throw new CommerceError('SELF_PURCHASE', 422, 'The operator adds morsels with a mint (POST /v1/admin/mint), not by buying them.');
      }
      const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value ?? undefined;
      return {
        kind: PACING_PACK_KIND, agentGaii: 'node', agentName: PACING_PACK_KIND, offerId: 'pack',
        title: `Pacing capacity: ${pack.morsels} morsels`, sellerOwner, sellerGhii,
        unitPrice: pack.price.amount, tollMorsels: 0, psp,
        async fulfill(ctx, { session, item }) {
          const morsels = pack.morsels * Math.max(1, item.quantity);
          if (await mintedToday(ctx.storage) + morsels > ctx.config.maxOperatorMintPerDay) {
            throw new CommerceError('PACING_PACK_CAP', 429, `The node adds at most ${ctx.config.maxOperatorMintPerDay} morsels a day, and today's limit is reached. Try again tomorrow.`);
          }
          await ctx.storage.creditBalance(session.buyerGhii, morsels);
          await ctx.storage.addTransaction({
            id: `pack-${randomUUID()}`, gaii: session.buyerGhii, type: 'pacing_pack', amount: morsels,
            counterpartyGaii: sellerGhii, trackingCode: `pacing-pack:${session.id}`, timestamp: new Date().toISOString(),
          });
          return { result: { morsels_added: morsels } };
        },
      };
    },
  };
}

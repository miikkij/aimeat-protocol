/**
 * @file src/commerce/sellable-resolvers.ts
 * @description Sellable-resolver registry (TARGET-033 phase 4): pluggable sources of "things for
 *   sale" the checkout core can price and fulfill. Core registers the `offer` resolver (agent
 *   offers, the phase-1 behavior); the EE module registers `org-offering` (company catalogs with
 *   commission splits) via `EnterpriseProvider.getSellableResolvers()`. A resolver returns a
 *   Sellable — optionally with a custom `distribute` callback that replaces the default
 *   seller payout (e.g. member cut + org-wallet cut).
 * @structure SellableResolver · registerSellableResolver · getSellableResolver ·
 *   resetSellableResolvers · offerSellableResolver (core 'offer' kind)
 * @usage
 *   registerSellableResolver(offerSellableResolver());
 *   const sellable = await getSellableResolver(ref.kind).resolve(storage, config, ref, buyerOwner);
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial resolver registry + core offer resolver (TARGET-033 phase 4)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Offer } from '../models/offer-schemas.js';
import type { Sellable } from './types.js';
import { CommerceError } from './errors.js';
import { listPaymentHandlers } from './payment-handlers.js';

/** A raw line-item reference before resolution. `kind` defaults to 'offer'. */
export interface SellableRef {
  kind?: string;
  agent?: string;
  offer_id: string;
  /** org-offering: "creatorOwner/slug" — resolved by the EE resolver. */
  org?: string;
  quantity?: number;
  /** Requested settlement currency; resolvers reject currencies they cannot price. */
  currency?: string;
}

export interface SellableResolver {
  kind: string;
  resolve(storage: Storage, config: AimeatConfig, ref: SellableRef, buyerOwner: string): Promise<Sellable>;
}

const registry = new Map<string, SellableResolver>();

export function registerSellableResolver(resolver: SellableResolver): void {
  registry.set(resolver.kind, resolver);
}

export function getSellableResolver(kind: string): SellableResolver | undefined {
  return registry.get(kind);
}

/** Test seam: clear between embedded server boots. */
export function resetSellableResolvers(): void {
  registry.clear();
}

/**
 * The core resolver: an agent offer priced in morsels. Same rules the offer-invoke settlement
 * enforces — private offers are owner-only, cross-owner purchase requires an explicit price,
 * self-purchase is free.
 */
export function offerSellableResolver(): SellableResolver {
  return {
    kind: 'offer',
    async resolve(storage, config, ref, buyerOwner): Promise<Sellable> {
      const identifier = ref.agent ?? '';
      if (!identifier) throw new CommerceError('INVALID_ITEM', 400, 'Offer line items need an agent reference');
      const agentGaii = identifier.includes('#') ? identifier : `${identifier}#${buyerOwner}@${config.nodeId}`;
      const agent = await storage.getAgent(agentGaii);
      if (!agent) throw new CommerceError('AGENT_NOT_FOUND', 404, `Agent not found: ${identifier}`);

      const agentName = agentGaii.split('#')[0] as string;
      const rec = await storage.getMemory(agentGaii, `agents.${agentName}.offers`);
      const offers = ((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [];
      const offer = offers.find((o) => o.id === ref.offer_id);
      if (!offer) throw new CommerceError('OFFER_NOT_FOUND', 404, `Offer not found: ${ref.offer_id}`);

      const isSelf = agent.owner === buyerOwner;
      const visibility = offer.visibility ?? 'private';
      if (!isSelf && visibility === 'private') {
        throw new CommerceError('OFFER_PRIVATE', 403, 'This offer is private to its owner');
      }
      const sellerGhii = `${agent.owner}@${config.nodeId}`;
      const currency = ref.currency ?? 'morsel';
      let unitPrice = 0;
      let psp: unknown;
      if (currency === 'morsel') {
        if (!isSelf) {
          if (!offer.price) throw new CommerceError('OFFER_NOT_FOR_SALE', 422, 'This offer declares no price and cannot be purchased cross-owner');
          unitPrice = Number(offer.price.morsels);
        }
      } else {
        // Money: the offer must carry a matching money price, and SOME registered handler must
        // settle this currency (Community has only morsels → blocks money at creation). The
        // seller's own PSP credentials (commerce.psp) are attached if present; the handler decides
        // whether it needs them (Stripe does; invoice/manual does not). Funds land on the seller.
        if (!offer.priceMoney || offer.priceMoney.currency !== currency) {
          throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `This offer has no ${currency} price`);
        }
        if (!listPaymentHandlers().some((h) => h.currencies.includes(currency))) {
          throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}`);
        }
        const pspRec = await storage.getMemory(sellerGhii, 'commerce.psp');
        psp = pspRec?.value ?? undefined;
        unitPrice = Math.floor(offer.priceMoney.amount);
      }
      return {
        kind: 'offer', agentGaii, agentName, offerId: ref.offer_id,
        title: offer.title, sellerOwner: agent.owner,
        sellerGhii, priceMorsels: unitPrice, psp,
      };
    },
  };
}

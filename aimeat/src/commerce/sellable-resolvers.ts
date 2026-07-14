/**
 * @file src/commerce/sellable-resolvers.ts
 * @description Sellable-resolver registry (TARGET-033 phase 4): pluggable sources of "things for
 *   sale" the checkout core can price and fulfill. Core registers the `offer` resolver (agent
 *   offers, the phase-1 behavior); the EE module registers `org-offering` (company catalogs with
 *   commission splits) via `EnterpriseProvider.getSellableResolvers()`. A resolver returns a
 *   Sellable — optionally with a custom `distribute` callback that replaces the default
 *   seller payout (e.g. member cut + org-wallet cut).
 * @structure SellableResolver · registerSellableResolver · getSellableResolver ·
 *   resetSellableResolvers · offerSellableResolver (core 'offer' kind) ·
 *   appToolSellableResolver (core 'app-tool' kind, TARGET-034 phase A)
 * @usage
 *   registerSellableResolver(offerSellableResolver());
 *   registerSellableResolver(appToolSellableResolver());
 *   const sellable = await getSellableResolver(ref.kind).resolve(storage, config, ref, buyerOwner);
 * @version-history
 *   v1.1.0 — 2026-07-14 — app-tool resolver: priced tool calls on agent-faced apps, manifest at
 *     apps.{appId}.tools, callable fulfillment via the backing capability (TARGET-034 phase A)
 *   v1.0.1 — 2026-07-14 — Money-amount coercion through the money.ts chokepoint (integerMicros)
 *   v1.0.0 — 2026-07-13 — Initial resolver registry + core offer resolver (TARGET-033 phase 4)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Offer } from '../models/offer-schemas.js';
import { AppToolsDocSchema, appToolsKey, type AppTool } from '../models/app-tool-schemas.js';
import type { Sellable } from './types.js';
import { CommerceError } from './errors.js';
import { listPaymentHandlers } from './payment-handlers.js';
import { integerMicros } from './money.js';

/** A raw line-item reference before resolution. `kind` defaults to 'offer'. */
export interface SellableRef {
  kind?: string;
  agent?: string;
  /** The offer id — or, for app-tool items, the tool name (aliased by `tool`). */
  offer_id?: string;
  /** app-tool alias for offer_id: the tool name from the app's manifest. */
  tool?: string;
  /** org-offering: "creatorOwner/slug" — resolved by the EE resolver. */
  org?: string;
  /** app-tool: "ownerName/appId" — locates the apps.{appId}.tools manifest. */
  app?: string;
  /** app-tool: the buyer's tool input, forwarded to the capability invoke at fulfillment. */
  input?: Record<string, unknown>;
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
      if (!ref.offer_id) throw new CommerceError('INVALID_ITEM', 400, 'Offer line items need an offer_id');
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
        unitPrice = integerMicros(offer.priceMoney.amount);
      }
      return {
        kind: 'offer', agentGaii, agentName, offerId: ref.offer_id,
        title: offer.title, sellerOwner: agent.owner,
        sellerGhii, priceMorsels: unitPrice, psp,
      };
    },
  };
}

/**
 * The app-tool resolver (TARGET-034 phase A): a priced TOOL CALL on an agent-faced app. The app
 * owner declares tools in the public memory record `apps.{appId}.tools` under their GHII; a line
 * item `{ kind:'app-tool', app:'ownerName/appId', tool:'<name>', input? }` buys one call. Phase A
 * fulfills the CALLABLE path only: the tool must bind a capability via `action_id`, invoked
 * synchronously on completion with the buyer's input — the result lands on the session's
 * fulfillment. Pricing/PSP rules mirror the offer resolver (self-purchase free, cross-owner needs
 * a price, money needs a matching priceMoney + a settling handler + the seller's own PSP).
 */
export function appToolSellableResolver(): SellableResolver {
  return {
    kind: 'app-tool',
    async resolve(storage, config, ref, buyerOwner): Promise<Sellable> {
      const appRef = ref.app ?? '';
      const slash = appRef.indexOf('/');
      if (slash < 1 || slash === appRef.length - 1) {
        throw new CommerceError('INVALID_ITEM', 400, 'App-tool line items need app: "ownerName/appId"');
      }
      const sellerOwner = appRef.slice(0, slash);
      const appId = appRef.slice(slash + 1);
      const toolName = ref.tool ?? ref.offer_id ?? '';
      if (!toolName) throw new CommerceError('INVALID_ITEM', 400, 'App-tool line items need a tool name');
      if ((ref.quantity ?? 1) > 1) {
        throw new CommerceError('INVALID_ITEM', 400, 'App-tool purchases are one call per line item; add multiple line items for multiple calls');
      }

      const sellerGhii = `${sellerOwner}@${config.nodeId}`;
      const rec = await storage.getMemory(sellerGhii, appToolsKey(appId));
      if (!rec) throw new CommerceError('APP_TOOLS_NOT_FOUND', 404, `App "${appRef}" declares no tool manifest (${appToolsKey(appId)})`);
      const parsed = AppToolsDocSchema.safeParse(rec.value);
      if (!parsed.success) throw new CommerceError('INVALID_TOOL_MANIFEST', 422, `App "${appRef}" has a malformed tool manifest: ${parsed.error.message}`);
      const tool: AppTool | undefined = parsed.data.tools.find((t) => t.name === toolName);
      if (!tool) throw new CommerceError('TOOL_NOT_FOUND', 404, `Tool not found on app "${appRef}": ${toolName}`);
      if (!tool.action_id) {
        throw new CommerceError('TOOL_NOT_CALLABLE', 422, 'This tool declares no capability binding (action_id); the task-fulfillment path is not available yet');
      }

      const isSelf = sellerOwner === buyerOwner;
      const currency = ref.currency ?? 'morsel';
      let unitPrice = 0;
      let psp: unknown;
      if (currency === 'morsel') {
        if (!isSelf) {
          if (!tool.price || tool.price.morsels <= 0) {
            throw new CommerceError('TOOL_NOT_FOR_SALE', 422, 'This tool declares no morsel price and cannot be purchased cross-owner');
          }
          unitPrice = Number(tool.price.morsels);
        }
      } else {
        if (!tool.priceMoney || tool.priceMoney.currency !== currency) {
          throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `This tool has no ${currency} price`);
        }
        if (!listPaymentHandlers().some((h) => h.currencies.includes(currency))) {
          throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment handler on this node settles ${currency}`);
        }
        const pspRec = await storage.getMemory(sellerGhii, 'commerce.psp');
        psp = pspRec?.value ?? undefined;
        unitPrice = integerMicros(tool.priceMoney.amount);
      }

      const actionId = tool.action_id;
      return {
        kind: 'app-tool',
        // The "agent" slots carry the app reference — skus render as app-tool:<owner>/<appId>:<tool>.
        agentGaii: appRef, agentName: appId, offerId: tool.name,
        title: `${appId} · ${tool.name}`, sellerOwner, sellerGhii,
        priceMorsels: unitPrice, psp,
        // Callable fulfillment: invoke the backing capability with the buyer's persisted input.
        // A throw refunds the collect and leaves the session open (session-service contract).
        async fulfill(ctx, { session, item, callerJwt }) {
          const cap = await ctx.storage.getCapability(actionId);
          if (!cap) {
            throw new CommerceError('CAPABILITY_NOT_FOUND', 404, `Backing capability not found: ${actionId}`);
          }
          const { invokeCapability } = await import('../services/capability-invoke.js');
          const invoked = await invokeCapability(
            ctx.config, ctx.storage, cap, item.input ?? {}, session.buyerIdentity, callerJwt ?? '', 'normal',
          );
          return { result: invoked.result };
        },
      };
    },
  };
}

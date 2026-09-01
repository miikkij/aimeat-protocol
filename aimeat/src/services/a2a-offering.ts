/**
 * @file src/services/a2a-offering.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a foreign A2A caller is allowed to ask for, and what it costs.
 *
 *   PUBLISHING THE OFFERING IS THE CONSENT. There is no approval screen in this path and no new
 *   permission word, because there is already an act that means "I will do this for strangers, on
 *   these terms, for this price": listing an agent-work offering. A foreign caller may create work
 *   against a LISTED offering of that agent and against nothing else — not a capability, not a
 *   tool, not a skill the card happens to mention. The agent's capability surface stays shut.
 *
 *   THE OFFERING IS THE CONTRACT, not a lookup. Its `basePrice`, `currency` and `unit` are the
 *   price; its `taskSpec.inputSchema` bounds what may be sent; its `usageTerms` govern what the
 *   buyer may do with the answer. None of that is re-derived here — `resolveOfferingPricing` is the
 *   one place that prices an offering, and this calls it.
 *
 *   ONLY MONEY, FOR A STRANGER. A morsel-priced offering is not sellable this way: morsels are a
 *   pacer for a person's own agents and a foreign caller has no balance here to pace. A
 *   morsel-priced offering is therefore invisible on this road rather than free on it.
 *
 * @structure offeringsForAgent() · findSellableOffering() · priceForForeignCaller()
 * @usage const o = await findSellableOffering(storage, config, agent, skillId);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a foreign path).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import {
  filterOfferings, resolveOfferingPricing, agentWorkCoordinate, type Offering,
} from './exchange-market.js';
import { isMoneyCurrency } from '../commerce/money.js';
import {
  getX402Network, getX402Asset, buildExactRequirements, extractPayTo,
} from '../commerce/x402-facilitator.js';

/**
 * The A2A extension this node declares when an agent has something for sale.
 *
 * It lives here rather than in the handler because BOTH the card and the handler name it, and the
 * card must not have to import the handler to say what the handler does.
 */
export const A2A_X402_EXTENSION = 'https://github.com/google-a2a/a2a-x402/v0.1';

/**
 * Every LISTED agent-work offering this agent has published.
 *
 * Matched on the coordinate rather than on a stored agent id, because that is how the market binds
 * an offering to an agent: `agentwork:{owner}/{agentName}`. Going any other way would be a second
 * opinion about what "this agent's offerings" means.
 */
export async function offeringsForAgent(storage: Storage, agent: AgentRecord): Promise<Offering[]> {
  const { ext } = agentWorkCoordinate(agent.owner, agent.name, '');
  const found = await filterOfferings(storage, { ext });
  return found.filter(o => o.state === 'listed' && o.kind === 'agent-work' && o.surface?.kind === 'agent-work');
}

/**
 * The offering a foreign caller named, or the only one if it named nothing and there is only one.
 *
 * NAMING NOTHING WHEN THERE ARE SEVERAL IS A REFUSAL, not a guess. Picking one would be this node
 * deciding what a stranger is buying and what they will be charged for it.
 */
export async function findSellableOffering(
  storage: Storage, agent: AgentRecord, asked: string | null,
): Promise<{ ok: true; offering: Offering } | { ok: false; code: string; message: string; available: string[] }> {
  const all = await offeringsForAgent(storage, agent);
  const available = all.map(o => `${o.offeringId} (${o.surface?.kind === 'agent-work' ? o.surface.taskType : o.action}): ${o.title}`);

  if (all.length === 0) {
    return {
      ok: false, code: 'NO_OFFERING', available,
      message: 'This agent has published nothing for hire, so there is nothing a stranger may ask it to do. Its owner lists work on the EXCHANGE.',
    };
  }
  if (asked) {
    const hit = all.find(o => o.offeringId === asked)
      ?? all.find(o => (o.surface?.kind === 'agent-work' ? o.surface.taskType : o.action) === asked);
    if (!hit) {
      return {
        ok: false, code: 'NO_SUCH_OFFERING', available,
        message: `This agent has not published "${asked}". What it does publish is in details.available.`,
      };
    }
    return { ok: true, offering: hit };
  }
  if (all.length > 1) {
    return {
      ok: false, code: 'OFFERING_REQUIRED', available,
      message: 'This agent publishes more than one kind of work. Name one in metadata.offeringId — choosing for you would decide what you are buying.',
    };
  }
  return { ok: true, offering: all[0] };
}

export interface ForeignPrice {
  unit: string;
  amount: number;
  currency: string;
  /** The x402 `exact` requirements, ready to hand a client. */
  requirements: Record<string, unknown>;
}

/**
 * What this offering costs a stranger, as x402 payment requirements.
 *
 * EVERY PIECE COMES FROM SOMEWHERE THAT ALREADY DECIDES IT: the amount from
 * `resolveOfferingPricing`, the network and asset from the x402 registry, the destination from the
 * seller's own `commerce.psp` payout address. Nothing about settlement is invented here, and a
 * missing piece is a refusal rather than a default — a buyer must never be handed requirements this
 * node could not settle.
 */
export async function priceForForeignCaller(
  storage: Storage, config: AimeatConfig, offering: Offering, resource: string,
): Promise<{ ok: true; price: ForeignPrice } | { ok: false; code: string; message: string }> {
  if (!config.x402Enabled) {
    return {
      ok: false, code: 'PAYMENT_UNAVAILABLE',
      message: 'This node does not take payment from agents it does not host. Its operator has not turned that on.',
    };
  }
  const priced = await resolveOfferingPricing(storage, offering, null);
  if (!priced.ok) return { ok: false, code: priced.code, message: priced.message };

  if (!isMoneyCurrency(priced.currency ?? '')) {
    return {
      ok: false, code: 'NOT_SELLABLE_OFFNODE',
      message: 'This work is priced in morsels, which pace an account\'s own agents and are not something a stranger can hold. It is not for sale from outside.',
    };
  }
  const network = getX402Network(config.x402Network);
  const asset = network ? getX402Asset(network, priced.currency as never) : undefined;
  if (!network || !asset) {
    return {
      ok: false, code: 'NO_SETTLEMENT_ASSET',
      message: 'This node cannot settle that currency on the network it is configured for.',
    };
  }
  const psp = await storage.getMemory(offering.providerGhii, 'commerce.psp');
  const payTo = extractPayTo(psp?.value);
  if (!payTo) {
    return {
      ok: false, code: 'NO_PAYOUT_ADDRESS',
      message: 'The seller has not set a payout address, so there is nowhere for the money to go.',
    };
  }
  return {
    ok: true,
    price: {
      unit: priced.unit,
      amount: priced.pricePerCall,
      currency: priced.currency as string,
      requirements: buildExactRequirements({
        network, asset, payTo, amountMicros: priced.pricePerCall,
        resource,
        description: `${offering.title} — ${offering.offeringId}`,
      }) as unknown as Record<string, unknown>,
    },
  };
}

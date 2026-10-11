/**
 * @file src/services/agent-default-offer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one offer every new agent's crew definition carries, so that an agent made from a
 *   proposal shows on the owner's Offerings page without anybody writing an offers document by hand.
 *
 *   HOW AN OFFER REACHES THE OFFERINGS PAGE. A crew definition has an `offers` list
 *   (models/crew-def-schemas.ts). The crew runtime reads it when the agent starts and publishes the
 *   FIRST entry to `agents.<name>.offers` through PUT /v1/agents/{name}/offers, on every start
 *   (crewaimeat: aimeat_crew.py "inline offer", crew_def.py crewspec_from_json). The node does not
 *   publish it; the definition only has to carry it. Until 2026-10-11 nothing that makes an agent
 *   here wrote one: the home's draft asked the model for no offer and the three ready definitions
 *   have none, so a new agent's Offerings row stayed empty (Jouni, 2026-10-11: "I thought this was
 *   built into the crew JSON so they come to the offers automatically").
 *
 *   WHAT THE RUNTIME NEEDS IN AN ENTRY. It builds the published offer from these keys and fails on
 *   a missing one: id, title, ask, example, cost, latency, repeatability, verification,
 *   consequences. So an entry a proposer wrote with only a title and an ask is completed here, and
 *   a definition with no entry gets one made from the agent's name and purpose, which are the two
 *   things the owner read before approving.
 *
 *   THE LOWEST LEVEL, ON PURPOSE (ruled by Jouni, 2026-10-11). The entry has no price and no
 *   visibility, so the published offer is private: it shows on the owner's own Offerings page and
 *   is not listed on the Exchange. It carries no workflow signals either, so it is an offering and
 *   not yet a workflow step. The owner adds a price, a visibility or signals when they want them.
 *
 *   `verification` is `ungated` and `repeatability` is `accumulative` by default: the result is a
 *   model's free prose that nothing checks, and each run adds a result beside the earlier ones.
 * @structure InlineOffer · defaultOfferFor(agent) · firstRequestOf(crewDef) · withDefaultOffer(crewDef, agent)
 * @usage const def = withDefaultOffer(proposal.crew_def, { name, displayName, purpose });
 * @version-history
 *   v1.1.0 — 2026-10-11 — firstRequestOf: the first offer's example, which a new agent is given as
 *     its first work.
 *   v1.0.0 — 2026-10-11 — Initial (wish-kodista-tehty-agentti-saa-tarjoaman-automaattisesti-offering).
 */

/** One entry of a crew definition's `offers`, as the crew runtime reads it. */
export interface InlineOffer {
  id: string;
  title: string;
  ask: string;
  example: string;
  cost: 'free' | 'cheap' | 'expensive';
  latency: 'seconds' | 'minutes' | 'long-running';
  repeatability: 'idempotent' | 'accumulative' | 'destructive';
  verification: 'deterministic' | 'gated' | 'ungated';
  consequences: unknown[];
  [key: string]: unknown;
}

/** The agent, as far as its offer needs it. */
export interface OfferedAgent {
  name: string;
  displayName: string;
  purpose: string;
}

/** The bounds the offers schema holds a title and an ask to (models/offer-schemas.ts). */
const TITLE_MAX = 120;
const ASK_MAX = 500;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? v as T : fallback;

/** The offer made from an agent's own name and purpose. */
export function defaultOfferFor(agent: OfferedAgent): InlineOffer {
  return {
    id: agent.name,
    title: (agent.displayName || agent.name).slice(0, TITLE_MAX),
    ask: (agent.purpose || agent.displayName || agent.name).slice(0, ASK_MAX),
    example: '',
    cost: 'cheap',
    latency: 'minutes',
    repeatability: 'accumulative',
    verification: 'ungated',
    consequences: [],
  };
}

/** One entry with every key the runtime reads: what the proposer wrote, and the default for the rest. */
function completed(entry: Record<string, unknown>, agent: OfferedAgent): InlineOffer {
  const base = defaultOfferFor(agent);
  return {
    ...entry,
    id: text(entry.id) || base.id,
    title: (text(entry.title) || base.title).slice(0, TITLE_MAX),
    ask: (text(entry.ask) || base.ask).slice(0, ASK_MAX),
    example: text(entry.example),
    cost: oneOf(entry.cost, ['free', 'cheap', 'expensive'] as const, base.cost),
    latency: oneOf(entry.latency, ['seconds', 'minutes', 'long-running'] as const, base.latency),
    repeatability: oneOf(entry.repeatability, ['idempotent', 'accumulative', 'destructive'] as const, base.repeatability),
    verification: oneOf(entry.verification, ['deterministic', 'gated', 'ungated'] as const, base.verification),
    consequences: Array.isArray(entry.consequences) ? entry.consequences : [],
  };
}

/**
 * The request a new agent is given as its first work: the `example` of its definition's first
 * offer, which is one real request as a person would send it. Empty when the definition has no
 * offer or the offer has no example; the caller then falls back to the agent's purpose.
 *
 * WHY NOT THE PURPOSE. A purpose describes the agent ("Makes one short slogan for a product whose
 * name the task gives"). Given as a task, an agent that needs an input has none: on production,
 * 2026-10-11, a slogan agent's first run made a slogan for its own description.
 */
export function firstRequestOf(crewDef: unknown): string {
  const offers = (crewDef as { offers?: unknown } | null)?.offers;
  if (!Array.isArray(offers)) return '';
  const first = offers.find((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o));
  return first ? text(first.example) : '';
}

/**
 * A crew definition whose `offers` the runtime can publish from: each entry that is an object is
 * completed, and a definition with no such entry gets the default one. Everything else in the
 * definition is returned as it came.
 */
export function withDefaultOffer<T extends Record<string, unknown>>(crewDef: T, agent: OfferedAgent): T {
  const given = Array.isArray(crewDef.offers) ? crewDef.offers : [];
  const entries = given.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o));
  const offers = entries.length > 0 ? entries.map(o => completed(o, agent)) : [defaultOfferFor(agent)];
  return { ...crewDef, offers };
}

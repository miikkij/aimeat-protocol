/**
 * @file offer-schemas.ts
 * @description Zod validation for an agent's published "offers" — the human-readable face of the
 *   agent's machine contract ("here's what I can do for you, with an example, the outcome, and a
 *   sample deliverable"). An agent publishes `agents.{name}.offers`; the profile Offers surface renders
 *   it (goal-first search → Ask), and the mesh consumes the same record for delegate selection. This is
 *   the single shared contract — keep it in sync with docs/plans/2026-06-12-agent-offers-surface.md §4.
 * @structure
 *   - OfferSchema — one offer (ask/example/cost/latency/verification/dataHandling/requirements/
 *     consequences/availability/deliverable)
 *   - OffersDocSchema — the published document { version, updatedAt, offers: Offer[] }
 * @usage import { OffersDocSchema } from '../models/offer-schemas.js';
 *   const parsed = OffersDocSchema.safeParse(req.body);
 * @version-history
 *   v2.5.0 -- 2026-07-25 -- `tollMorsels`: an offer declares its own pacing burn (see AppTool).
 *   v1.0.0 -- 2026-06-12 -- Initial: offer descriptor (Agent Offers surface v1).
 *   v2.0.0 -- 2026-06-12 -- Billable offers: price + visibility + callable binding. An offer is a
 *     billable capability — free for the owner's own use, debited (morsels owner→provider) when a
 *     different owner invokes it. `visibility:'public'` lists it in the catalogue; `callable` binds it
 *     to a machine-invocable action/webhook. All v2 fields optional → v1 docs validate unchanged.
 *     See docs/plans/2026-06-12-services-to-offers-migration.md.
 *   v2.1.0 -- 2026-06-13 -- Agent Workflows: optional `success_signal` + `required_to_function`
 *     (the producer/consumer signal contract a workflow step inherits). Both optional → existing
 *     offer docs validate unchanged. See docs/plans/2026-06-13-agent-workflows-node-plan.md.
 *   v2.2.0 -- 2026-06-13 -- Deliverable `format` gains `'image'` so an offer can declare its
 *     deliverable IS an image (a /v1/pub URL or { url, mime } at the location key); rendered inline
 *     by the shared image renderer across the agent surfaces. Additive enum → existing docs unchanged.
 *   v2.3.0 -- 2026-06-16 -- Richer Offerings: deliverable `format` gains `'json'` (structured render of
 *     the sample + live deliverables); offers gain `dependsOn` (upstream-offer / signal prerequisites)
 *     surfaced + gated on the card. Both additive/optional → existing docs validate unchanged.
 *   v2.5.0 -- 2026-07-25 -- TARGET-050: the offer becomes the SOURCE OF TRUTH for its EXCHANGE agent-work
 *     listing -- `exchange` (sell on the marketplace, deliberately separate from `visibility`),
 *     `pricesMoney` (EUR *and* USD), `inputSchema`/`outputSchema` + `usageTerms` (the legibility gate).
 *     All additive/optional -> existing offer docs validate unchanged.
 *   v2.4.0 -- 2026-07-14 -- priceMoney currency enum sourced from the money.ts chokepoint
 *     (MONEY_CURRENCIES) instead of an inline ['EUR','USD'] literal. Same accepted values.
 */
import { z } from 'zod';
import { SignalSchema } from './workflow-schemas.js';
import { ProvenanceSchema, OdpsExtrasSchema } from './odps-schemas.js';
import { MONEY_CURRENCIES } from '../commerce/money.js';

// ── v2: billable / listable / callable ──────────────────────────────────────
// Concrete morsel price for cross-owner invocation. `null`/absent = not for sale (self-use only).
// Distinct from the qualitative `cost` ('free'|'cheap'|'expensive') hint, which stays for goal-search.
const PriceSchema = z.object({
  morsels: z.number().int().nonnegative(),
  unit: z.enum(['per-call', 'per-result', 'subscription']).optional(), // default per-call at the billing site
}).nullable();

// Machine-invocable binding. Present ⇒ a non-owner can invoke and be billed; absent ⇒ human-prompt/task offer.
const CallableSchema = z.object({
  action_id: z.string().max(200).optional(),   // an existing capability/action id that backs this offer
  webhook_url: z.string().max(500).optional(), // or a direct webhook
  input_schema: z.record(z.string(), z.unknown()).optional(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
}).nullable();

const RequirementSchema = z.object({
  need: z.string().min(1).max(200),
  fix: z.string().max(64).optional(),          // a one-click fix chip id (e.g. 'join', 'adopt-contract')
  instruction: z.string().max(500).optional(), // guidance text when no one-click fix exists (machine-local preconditions)
});

const ConsequenceSchema = z.object({
  // Only what SURVIVES the task — persistent / approval / external / host. In-process fan-out is not here.
  type: z.enum([
    'creates-agent', 'creates-schedule', 'mutates-host', 'publishes-public',
    'external-send', 'mutates-live-app', 'delegates-to-agent',
  ]),
  persistent: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  dynamic: z.boolean().optional(),          // the real chain renders live from task events, not the manifest
  ratesThirdParties: z.boolean().optional(), // a coordinator may write ratings to the agents it delegates to
  allowlist: z.array(z.string().max(200)).max(50).optional(), // for external-send
  note: z.string().max(300).optional(),
});

const AvailabilitySchema = z.object({
  boundToLastSeen: z.boolean().optional(),
  // string (human label) OR { scheduleId, human } so Run can trigger the schedule.
  scheduleBorn: z.union([
    z.string().max(200),
    z.object({ scheduleId: z.string().max(100), human: z.string().max(200).optional() }),
  ]).nullable().optional(),
}).optional();

const DeliverableSchema = z.object({
  // 'image' = the deliverable IS an image (a /v1/pub URL or { url, mime:image/* } at the location key);
  // the Offers/inbox + task + memory + workflow surfaces render it inline via the shared image renderer.
  // 'json' = the deliverable is structured data; the sample (and live deliverables) render as a clean
  // key/value tree rather than raw text. An object `sample` is treated as JSON regardless of `format`.
  format: z.enum(['document', 'record', 'board-post', 'file', 'app', 'image', 'json']),
  location: z.object({
    space: z.string().max(200).optional(),
    key: z.string().max(400).optional(),
    url: z.string().max(500).optional(),
    visibility: z.string().max(40).optional(),
  }).optional(),
  // A REAL excerpt from the last successful deliverable, or the literal "untested". Object | string.
  sample: z.union([z.string().max(8000), z.record(z.string(), z.unknown()), z.literal('untested')]).optional(),
});

// ── Prerequisites (Agent Workflows; optional) ──────────────────────────────────
// A prerequisite is something that must hold before this offer can usefully run. Two shapes:
//   - an UPSTREAM OFFER ('{ offer }', optionally on another '{ agent }') — met when that offer's
//     deliverable.location.key is present + non-empty in owner-scope memory (its output exists);
//   - a SIGNAL ('{ signal }') evaluated against owner memory with the workflow signal evaluator.
// `hard` (default true) gates the offer: an unmet hard prereq blocks the Ask. A `hard:false` prereq
// is advisory (shown, not gated). The node evaluates these on the Offers feed so a card can show a
// runnable / blocked state with the reason. See docs/plans/2026-06-13-agent-workflows-node-plan.md §5.
const DependencySchema = z.union([
  z.object({
    offer: z.string().min(1).max(100),
    agent: z.string().max(100).optional(),       // defaults to this offer's own agent
    hard: z.boolean().optional(),                // default true
    label: z.string().max(200).optional(),       // human label for the card ("needs first: …")
  }),
  z.object({
    signal: SignalSchema,
    hard: z.boolean().optional(),                // default true
    label: z.string().min(1).max(200),           // required: there's no offer id to fall back to
  }),
]);

export const OfferSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  ask: z.string().min(1).max(500),                         // plain-language invite incl. negative scope
  example: z.string().max(500).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),    // reuse existing machine tags for goal-search
  cost: z.enum(['free', 'cheap', 'expensive']).optional(),
  latency: z.enum(['seconds', 'minutes', 'long-running']).optional(),
  repeatability: z.enum(['idempotent', 'accumulative', 'destructive']).optional(),
  verification: z.enum(['deterministic', 'gated', 'ungated']).optional(), // deterministic = no LLM in I/O path (strongest)
  dataHandling: z.enum(['local-only', 'llm-provider', 'third-party']).optional(), // where input data flows
  availability: AvailabilitySchema,
  requirements: z.array(RequirementSchema).max(20).optional(),
  inputs: z.array(z.object({ name: z.string().max(80), required: z.boolean().optional() })).max(20).optional(),
  consequences: z.array(ConsequenceSchema).max(20).optional(),
  deliverable: DeliverableSchema,
  // ── Workflow signals (Agent Workflows; all optional → v1/v2 docs validate unchanged) ──
  // The producer contract ("my output is OK") and the consumer precondition ("the input I need to
  // start"). A workflow step naming this agent+offer inherits these as its success_signal /
  // required_to_function defaults (overridable per step). An agent is "workflow-compatible" exactly
  // when its offer declares these + deliverable.location. See
  // docs/plans/2026-06-13-agent-workflows-node-plan.md §5.
  success_signal: SignalSchema.optional(),
  // `'none'` is allowed here too (not just at the step level) so a genuine SOURCE offer (a fetcher
  // with no memory input) can declare "no input gate" directly instead of a placeholder signal.
  required_to_function: z.union([SignalSchema, z.literal('none')]).optional(),
  // Prerequisites surfaced + gated on the Offers card (upstream offers and/or signals). Distinct from
  // `required_to_function` (the workflow consumer gate): dependsOn is the human-facing "needs first".
  dependsOn: z.array(DependencySchema).max(20).optional(),
  // ── v2 billable/listable/callable (all optional; default to private, not-for-sale, human-driven) ──
  /** Morsels burned per delivered task to pace consumption — a brake, never revenue (see AppTool). */
  tollMorsels: z.number().int().min(0).max(100).optional(),
  price: PriceSchema.optional(),
  // Money price (TARGET-033 phase 6): amount in 6-decimal MICRO-UNITS (1 EUR = 1_000_000 micros;
  // matches USDC/x402, covers sub-cent per-call pricing) + ISO code. Sellable through the commerce
  // checkout when the SELLER has their own PSP credentials configured (commerce.psp) — funds land
  // on the seller's account, never the node's. Additive → existing docs validate unchanged.
  priceMoney: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(MONEY_CURRENCIES),
  }).nullable().optional(),
  /**
   * Additional money prices, one per currency (TARGET-050) — the same work sold in EUR *and* USD.
   * `priceMoney` stays the primary (existing readers unchanged); this is the set EXCHANGE lists from.
   */
  pricesMoney: z.array(z.object({
    amount: z.number().int().positive(),
    currency: z.enum(MONEY_CURRENCIES),
  })).max(MONEY_CURRENCIES.length).optional(),
  /**
   * Sell this offer as EXCHANGE AGENT WORK (TARGET-050). Deliberately separate from `visibility`:
   * public means "discoverable in the offers feed", this means "on the marketplace, metered and paid
   * on delivery". Requires visibility 'public' + a price + the I/O schemas below (the legibility gate).
   */
  exchange: z.boolean().optional(),
  /** What the buyer SENDS to start the task — required to list on EXCHANGE. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** What the agent DELIVERS — required to list on EXCHANGE. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Usage licence surfaced on the projected offering (required to list). */
  usageTerms: z.object({
    derivatives: z.boolean().optional(),
    resale: z.boolean().optional(),
    attribution: z.boolean().optional(),
    note: z.string().max(500).optional(),
  }).optional(),
  /** Provenance attestation carried onto the projected offering + its ODPS document. */
  provenance: ProvenanceSchema.optional(),
  /** ODPS v4.1 fields the node cannot derive (value proposition, SLA/quality commitments, data holder…). */
  odps: OdpsExtrasSchema.optional(),
  visibility: z.enum(['private', 'unlisted', 'public']).optional(), // default 'private' at read/list time
  callable: CallableSchema.optional(),
});

export const OffersDocSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.string().max(40).optional(),
  offers: z.array(OfferSchema).max(40),
});

export type Offer = z.infer<typeof OfferSchema>;
export type OffersDoc = z.infer<typeof OffersDocSchema>;

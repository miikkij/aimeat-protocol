/**
 * @file src/models/app-tool-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-tool manifest contract (TARGET-034 phase A): an agent-faced app declares
 *   PRICED TOOLS in the public memory record `apps.{appId}.tools` under the app owner's GHII.
 *   The commerce app-tool sellable resolver validates the record against these schemas at
 *   resolve time — a malformed manifest fails the checkout loudly (422), never silently.
 *   Prices follow the node-wide convention: morsels are plain integers, money is 6-decimal
 *   micro-units (offer-schemas precedent).
 * @structure AppToolSchema · AppToolPlanSchema · AppToolsDocSchema · appToolsKey · AppTool · AppToolsDoc
 * @usage
 *   const rec = await storage.getMemory(sellerGhii, appToolsKey(appId));
 *   const doc = AppToolsDocSchema.parse(rec.value);
 * @version-history
 *   v1.8.0 — 2026-08-01 — TARGET-058 Phase 5: optional `aiProvenance` on a tool and on the manifest
 *     root — an `aimeat.provenance/v1` document describing the tool's OUTPUT, beside the ODPS
 *     `provenance` that describes its data. Permissive (passthrough) and optional on purpose: a
 *     manifest is all-or-nothing, so a strict field here could silently delist every offering an app
 *     has the day a v2 record appears. Existing manifests validate unchanged.
 *   v1.7.0 — 2026-07-30 — Authored text is no longer clipped: descriptions/notes to 10 000, 200 tools
 *     and 40 plans per app. The old 500-character description silently delisted a live paid offering.
 *   v1.6.0 — 2026-07-28 — `lockedInput` + applyLockedInput: a tool fixes the parameter that tells it
 *     apart from its neighbour, so two products stop being one call the caller can steer.
 *   v1.5.0 — 2026-07-28 — `isToolPriced`: one definition of whether a tool carries a price. There were
 *     two and they disagreed about `pricesMoney`, which let a USD-only tool invoke free.
 *   v1.4.0 — 2026-07-25 — `tollMorsels`: a tool declares its own pacing burn, so a node default of 0
 *     means "paced only where a provider asked for it" instead of "never paced".
 *   v1.4.0 — 2026-07-25 — ODPS: per-tool `provenance` + `odps` (the authoring block projected into the
 *     tool's ODPS v4.1 document) and APP-LEVEL defaults of both on the manifest root, inherited by every
 *     tool. Additive; existing manifests validate unchanged.
 *   v1.3.0 — 2026-07-25 — TARGET-050: the manifest becomes the SOURCE OF TRUTH for the EXCHANGE listing —
 *     `exchange` (list publicly), `pricesMoney` (EUR *and* USD on one tool) and `usageTerms` (the licence,
 *     so listing needs no second authoring step). All additive; existing manifests validate unchanged.
 *   v1.2.0 — 2026-07-21 — EXCHANGE cross-app selling (Gap 1): optional `outputSchema` (mandatory to LIST an
 *     app-tool offering — the legibility gate) + `plans` (per_call/bundle/subscription volume pricing).
 *   v1.1.0 — 2026-07-14 — Task path (phase B): optional `agent` (task assignee); tools without an
 *     action_id binding are now purchasable — fulfilled as an agent TASK instead of a capability call
 *   v1.0.0 — 2026-07-14 — Initial app-tool manifest schema (TARGET-034 phase A)
 */
import { z } from 'zod';
import { MONEY_CURRENCIES } from '../commerce/money.js';
import { ProvenanceSchema, OdpsExtrasSchema } from './odps-schemas.js';

/** A provider pricing plan on a sellable tool — mirrors exchange-market OfferingPlan so a tool can carry
 *  per-call / volume-bundle / subscription pricing surfaced on its EXCHANGE offering. */
export const AppToolPlanSchema = z.discriminatedUnion('model', [
  z.object({ id: z.string().min(1).max(60), model: z.literal('per_call') }),
  z.object({ id: z.string().min(1).max(60), model: z.literal('bundle'), blockSize: z.number().int().positive(), blockPrice: z.number().int().positive() }),
  z.object({
    id: z.string().min(1).max(60), model: z.literal('subscription'),
    periodSeconds: z.number().int().positive(), periodPrice: z.number().int().positive(),
    callsPerWindow: z.number().int().positive(), windowSeconds: z.number().int().positive(),
  }),
]);

/** One sellable tool call on an agent-faced app. */
export const AppToolSchema = z.object({
  /** Tool name — the sku's last segment and the checkout line item's tool reference. */
  name: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Tool names are alphanumeric with . _ -'),
  description: z.string().max(10_000).optional(),
  /** Free-form JSON-schema-ish shape of the tool input (documentation for buyers). */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Free-form JSON-schema-ish shape of the tool OUTPUT — what a caller gets back. Mandatory (non-empty)
   *  to LIST the tool as an EXCHANGE offering (the legibility gate): a consumer must know what returns. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  /** EXCHANGE pricing plans (per_call / bundle / subscription) surfaced on the tool's offering. The base
   *  per-call price stays in `price`/`priceMoney`; a plan lets a volume consumer prepay or subscribe. */
  plans: z.array(AppToolPlanSchema).max(40).optional(),
  /**
   * Callable fulfillment binding: the backing capability invoked on checkout completion
   * (e.g. "ext:my-extension:summarize"). Without a binding the tool is fulfilled as an agent
   * TASK (phase B) — assigned to `agent`, or to the app owner's GHII when no agent is named.
   */
  action_id: z.string().max(200).optional(),
  /**
   * Input this tool FIXES, which the caller cannot override. Merged over whatever they send.
   *
   * One capability often serves several products, told apart by a parameter. Measured on production:
   * `search` (0.01 EUR) and `budget-leads` (0.05 EUR) both bind `ext:kaiku-signals:search`, and the
   * only thing between them is a `category` field the manifest DOCUMENTS as "Set to budget." while
   * the caller supplies it. So a buyer of the cheap product could send `category: budget` and receive
   * the expensive one, and a buyer of the expensive one who forgot it paid 5x for the cheap answer.
   * A price gate cannot catch that: it charges correctly for the contract taken and the extension
   * decides what comes back. Pinning the discriminator is what makes two products two calls.
   */
  lockedInput: z.record(z.string(), z.unknown()).optional(),
  /**
   * Task-path assignee (phase B): the bare name of the app owner's agent that receives the
   * fulfillment TASK when the tool has no action_id binding. Ignored for callable tools.
   */
  agent: z.string().max(100).optional(),
  /**
   * Morsels burned per call to bound the RATE this tool can be consumed at — a brake, never revenue
   * (invariant M1: the burn is not credited to anyone). Independent of `price`/`priceMoney`: a tool sold
   * for money is still paced when this is set, which is the only way a money-priced capability gets a
   * ceiling that a budget alone cannot give it. Absent = the node's default (shipped at 0).
   */
  tollMorsels: z.number().int().min(0).max(100).optional(),
  /** Morsel price per call. Absent/0 = not for sale cross-owner in morsels. */
  price: z.object({
    morsels: z.number().int().nonnegative(),
    unit: z.string().max(40).optional(),
  }).optional(),
  /** Money price per call: amount in 6-decimal MICRO-UNITS (1 EUR = 1_000_000) + ISO code. */
  priceMoney: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(MONEY_CURRENCIES),
  }).nullable().optional(),
  /**
   * Additional money prices, one per currency (TARGET-050) — lets one tool be bought in EUR *and* USD.
   * `priceMoney` stays the primary (every existing reader keeps working unchanged); `pricesMoney` is the
   * full set the EXCHANGE projection lists from. Writers keep `priceMoney` equal to the first entry.
   */
  pricesMoney: z.array(z.object({
    amount: z.number().int().positive(),
    currency: z.enum(MONEY_CURRENCIES),
  })).max(MONEY_CURRENCIES.length).optional(),
  /**
   * List this tool publicly on EXCHANGE (TARGET-050). The manifest is the SOURCE OF TRUTH for the
   * marketplace listing: flag on + a price → the tool is projected onto the market and its price/labels
   * track this manifest; flag off → the projected listing is delisted. Existing CONTRACTS are never
   * affected — they stay pinned to the interface version and price they were signed at.
   */
  exchange: z.boolean().optional(),
  /** Usage licence surfaced on the projected offering (mandatory to list — the legibility gate). */
  usageTerms: z.object({
    derivatives: z.boolean().optional(),
    resale: z.boolean().optional(),
    attribution: z.boolean().optional(),
    note: z.string().max(10_000).optional(),
  }).optional(),
  /** Provenance attestation carried onto the projected offering + its ODPS document. */
  provenance: ProvenanceSchema.optional(),
  /**
   * How much of what this tool RETURNS a model wrote — an `aimeat.provenance/v1` document
   * (TARGET-058). Distinct from `provenance` above, which is the ODPS attestation about the DATA the
   * tool draws on; this one is about the output a buyer receives, and it is what an agent shopping
   * for a capability reads to know whether the answer it is buying is model-written.
   *
   * `passthrough` deliberately: the record is a self-describing document with its own `spec`, so a
   * newer version of it must not be able to fail validation here. THE MANIFEST IS ALL-OR-NOTHING —
   * one field the validator rejects silently delists EVERY offering the app has — which is exactly
   * why this is optional and permissive rather than strict.
   */
  aiProvenance: z.record(z.string(), z.unknown()).optional(),
  /** ODPS v4.1 fields the node cannot derive (value proposition, SLA/quality commitments, data holder…). */
  odps: OdpsExtrasSchema.optional(),
});

/**
 * The `apps.{appId}.tools` record body. `odps`/`provenance` at THIS level are the app's defaults —
 * the company-and-brand half of an ODPS descriptor (data holder, logo, governance profile, jurisdiction,
 * provenance of the app's data) that is the same for every tool the app sells. A tool inherits them and
 * overrides field by field, so a Y-tunnus is typed once per app rather than once per capability.
 */
export const AppToolsDocSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.string().max(40).optional(),
  /** App-level ODPS defaults inherited by every tool (overridable per tool). */
  odps: OdpsExtrasSchema.optional(),
  /** App-level provenance attestation inherited by every tool (overridable per tool). */
  provenance: ProvenanceSchema.optional(),
  /** App-level AI provenance inherited by every tool that states none of its own (TARGET-058). */
  aiProvenance: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(AppToolSchema).max(200),
});

export type AppTool = z.infer<typeof AppToolSchema>;
export type AppToolsDoc = z.infer<typeof AppToolsDocSchema>;

/** The memory key an app's tool manifest lives under (PUBLIC record, app owner's GHII). */
export const appToolsKey = (appId: string): string => `apps.${appId}.tools`;

/** The app id back out of that key, or null when the key is not a tool manifest. */
export const appIdFromToolsKey = (key: string): string | null => {
  const m = /^apps\.(.+)\.tools$/.exec(key);
  return m ? m[1]! : null;
};

/**
 * Does this tool carry a price, in ANY of the three places a manifest may state one?
 *
 * One definition, because there were two and they disagreed: the app-tool route ignored `pricesMoney`,
 * so a tool sold only in USD reached the free invoke path and was then billed in morsels against an
 * unrelated contract. "Is this priced" is a property of the manifest, so it belongs beside the schema
 * rather than in each route that happens to ask.
 */
/**
 * The input a tool actually runs with: what the caller sent, with the tool's own fixed fields laid
 * over the top. Locked LAST on purpose — a caller must not be able to talk their way into a
 * neighbouring product by sending the field themselves.
 */
export function applyLockedInput(
  tool: { lockedInput?: Record<string, unknown> },
  input: Record<string, unknown>,
): Record<string, unknown> {
  return tool.lockedInput ? { ...input, ...tool.lockedInput } : input;
}

export function isToolPriced(t: {
  price?: { morsels?: number } | null;
  priceMoney?: { amount?: number } | null;
  pricesMoney?: Array<{ amount?: number }> | null;
}): boolean {
  if (t.price && typeof t.price.morsels === 'number' && t.price.morsels > 0) return true;
  if (t.priceMoney && typeof t.priceMoney.amount === 'number' && t.priceMoney.amount > 0) return true;
  return (t.pricesMoney ?? []).some(m => typeof m?.amount === 'number' && m.amount > 0);
}

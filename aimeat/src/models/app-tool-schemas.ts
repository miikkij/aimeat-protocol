/**
 * @file src/models/app-tool-schemas.ts
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
  description: z.string().max(500).optional(),
  /** Free-form JSON-schema-ish shape of the tool input (documentation for buyers). */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Free-form JSON-schema-ish shape of the tool OUTPUT — what a caller gets back. Mandatory (non-empty)
   *  to LIST the tool as an EXCHANGE offering (the legibility gate): a consumer must know what returns. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  /** EXCHANGE pricing plans (per_call / bundle / subscription) surfaced on the tool's offering. The base
   *  per-call price stays in `price`/`priceMoney`; a plan lets a volume consumer prepay or subscribe. */
  plans: z.array(AppToolPlanSchema).max(12).optional(),
  /**
   * Callable fulfillment binding: the backing capability invoked on checkout completion
   * (e.g. "ext:my-extension:summarize"). Without a binding the tool is fulfilled as an agent
   * TASK (phase B) — assigned to `agent`, or to the app owner's GHII when no agent is named.
   */
  action_id: z.string().max(200).optional(),
  /**
   * Task-path assignee (phase B): the bare name of the app owner's agent that receives the
   * fulfillment TASK when the tool has no action_id binding. Ignored for callable tools.
   */
  agent: z.string().max(100).optional(),
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
    note: z.string().max(500).optional(),
  }).optional(),
  /** Provenance attestation carried onto the projected offering + its ODPS document. */
  provenance: ProvenanceSchema.optional(),
  /** ODPS v4.0 fields the node cannot derive (value proposition, SLA/quality commitments, data holder…). */
  odps: OdpsExtrasSchema.optional(),
});

/** The `apps.{appId}.tools` record body. */
export const AppToolsDocSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.string().max(40).optional(),
  tools: z.array(AppToolSchema).max(40),
});

export type AppTool = z.infer<typeof AppToolSchema>;
export type AppToolsDoc = z.infer<typeof AppToolsDocSchema>;

/** The memory key an app's tool manifest lives under (PUBLIC record, app owner's GHII). */
export const appToolsKey = (appId: string): string => `apps.${appId}.tools`;

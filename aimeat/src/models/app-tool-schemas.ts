/**
 * @file src/models/app-tool-schemas.ts
 * @description The app-tool manifest contract (TARGET-034 phase A): an agent-faced app declares
 *   PRICED TOOLS in the public memory record `apps.{appId}.tools` under the app owner's GHII.
 *   The commerce app-tool sellable resolver validates the record against these schemas at
 *   resolve time — a malformed manifest fails the checkout loudly (422), never silently.
 *   Prices follow the node-wide convention: morsels are plain integers, money is 6-decimal
 *   micro-units (offer-schemas precedent).
 * @structure AppToolSchema · AppToolsDocSchema · appToolsKey · AppTool · AppToolsDoc
 * @usage
 *   const rec = await storage.getMemory(sellerGhii, appToolsKey(appId));
 *   const doc = AppToolsDocSchema.parse(rec.value);
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial app-tool manifest schema (TARGET-034 phase A)
 */
import { z } from 'zod';
import { MONEY_CURRENCIES } from '../commerce/money.js';

/** One sellable tool call on an agent-faced app. */
export const AppToolSchema = z.object({
  /** Tool name — the sku's last segment and the checkout line item's tool reference. */
  name: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Tool names are alphanumeric with . _ -'),
  description: z.string().max(500).optional(),
  /** Free-form JSON-schema-ish shape of the tool input (documentation for buyers). */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /**
   * Phase A fulfillment binding: the backing capability invoked on checkout completion
   * (e.g. "ext:my-extension:summarize"). Tools without a binding are declarable (forward-ready
   * for the TASK path, a later phase) but not yet purchasable.
   */
  action_id: z.string().max(200).optional(),
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

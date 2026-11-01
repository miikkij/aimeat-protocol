/**
 * @file src/models/exchange-datapackage-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shapes of the request bodies that sell a data package on EXCHANGE and buy one
 *   as an outside party (plan doc-mvwxcas3dom3, D5): validateBody bounds every field before the
 *   handler runs. The meaning (a price, a model, the usage terms, a party's e-mail) is checked once
 *   more by services/exchange-datapackage.ts and services/exchange-party-buy.ts.
 * @structure DatapackageExchangeSchema · PartyBuySchema · PartyPurchaseCompleteSchema
 * @usage router.put('/v1/datapackages/:owner/:name/exchange', ..., validateBody(DatapackageExchangeSchema, config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.1, D5.4).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const usageTerms = z.object({
    derivatives: z.boolean().optional(), resale: z.boolean().optional(), attribution: z.boolean().optional(),
    note: z.string().max(500).optional(),
});

export const DatapackageExchangeSchema = z.object({
    exchange: z.boolean().optional(),
    model: z.string().max(20).optional(),
    prices_money: z.array(z.object({ amount: z.number(), currency: z.string().max(8) })).max(2).optional(),
    toll_morsels: z.number().nullable().optional(),
    usage_terms: usageTerms.optional(),
    reads_per_minute: z.number().optional(),
    delivers_data: z.boolean().optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    odps: z.record(z.string(), z.unknown()).nullable().optional(),
    provenance: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const PartyBuySchema = z.object({
    party: z.object({
        display_name: z.string().max(120).optional(), kind: z.string().max(20).optional(),
        contact: z.string().max(320).optional(), name: z.string().max(40).optional(),
    }).optional(),
    months: z.number().optional(),
    reads: z.number().optional(),
    handler: z.string().max(64).optional(),
    return_url: z.string().max(INPUT_LIMITS.url).optional(),
});

export const PartyPurchaseCompleteSchema = z.object({
    handler: z.string().max(64).optional(),
    instrument: z.string().max(INPUT_LIMITS.id).optional(),
});

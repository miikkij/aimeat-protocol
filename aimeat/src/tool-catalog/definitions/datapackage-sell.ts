/**
 * @file datapackage-sell.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_datapackage_sell: put a data package on EXCHANGE, change its
 *   terms, or take it off (plan doc-mvwxcas3dom3, D5.1, D5.2), as PUT /v1/datapackages/{owner}/{name}/exchange
 *   does. Its own tool because selling is not publishing: aimeat_datapackage_publish takes rows and makes
 *   a version, and changing a price must make none.
 * @structure datapackageSellTools
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.1, D5.2).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const datapackageSellTools = [
    {
        name: 'aimeat_datapackage_sell',
        description: 'Sell one of your owner\'s data packages on EXCHANGE, change its terms, or take it off with exchange: false. '
            + 'When the person says something like "sell this package on EXCHANGE for 20 euros a month", call it once with model "per_month", prices_money [{ amount: 20000000, currency: "EUR" }] and usage_terms. '
            + 'model "per_month" sells a month of reads; "per_read" charges each OData, row or CSV request. Amounts are 6-decimal micro-units (1 EUR = 1000000). '
            + 'toll_morsels is pacing per read, never a price: describe it as "N morsels of pacing per read". usage_terms (derivatives, resale, attribution, note) are required. '
            + 'The listing is projected from these terms at once, and the answer says what listed or why it was skipped. A buyer with an account accepts it with aimeat_exchange_accept; a buyer with no account buys at POST /v1/exchange/offerings/{id}/buy and gets a key. '
            + 'A contract signed earlier keeps its price and the package versions of the schemas it was signed on. A package whose audience already admits a reader is read free by it, so sell a package that is private or shared narrower than its buyers. '
            + 'On a node that runs no data intermediation service a new listing is refused with DATA_INTERMEDIATION_NOT_OFFERED; tell the person and offer a named share instead (aimeat_party). Needs exchange:write.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Sell Data Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            ref: { type: 'string', required: true, description: 'pkg:owner/name of the package, your owner\'s own.', zod: z.string().max(200) },
            exchange: { type: 'boolean', description: 'true (the default) lists it; false takes it off EXCHANGE. Contracts already signed keep working.' },
            model: { type: 'string', enum: ['per_month', 'per_read'], description: 'per_month (default): a month of reads per contract; per_read: each read is charged.' },
            prices_money: { type: 'array', description: 'At most two money prices, one per currency: [{ amount, currency }], amount in micro-units, currency EUR or USD.', zod: z.array(z.object({ amount: z.number().int().positive(), currency: z.enum(['EUR', 'USD']) })).max(2) },
            toll_morsels: { type: 'number', description: 'Pacing per read for a buyer with an account, 0 to 100 morsels. Not a price.', zod: z.number().int().min(0).max(100) },
            usage_terms: { type: 'object', description: 'How a buyer may use the data: { derivatives, resale, attribution, note? }. Required to list.', zod: z.object({ derivatives: z.boolean().optional(), resale: z.boolean().optional(), attribution: z.boolean().optional(), note: z.string().max(500).optional() }) },
            reads_per_minute: { type: 'number', description: 'For per_month: how many reads a minute one contract may make (default 60).', zod: z.number().int().min(1).max(6000) },
            delivers_data: { type: 'boolean', description: 'Whether the offering delivers data. A package does, so leave it out unless the person says otherwise.' },
            title: { type: 'string', description: 'The listing title; default the package title.', zod: z.string().max(200) },
            description: { type: 'string', description: 'The listing description; default the package description.', zod: z.string().max(2000) },
            tags: { type: 'array', description: 'Up to 20 tags.', zod: z.array(z.string().max(40)).max(20) },
            odps: { type: 'object', description: 'ODPS fields the node cannot derive (value proposition, SLA, data holder...), as an offering takes them.', zod: z.record(z.string(), z.unknown()) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

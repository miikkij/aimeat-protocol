/**
 * @file commerce.ts
 * @description Catalog definitions for the MCP commerce tools (TARGET-033/034 over MCP): seller
 *   PSP credential management (masked — the secret NEVER returns), app-tool manifest publishing +
 *   pricing, agent-offer money pricing, and buyer-side checkout sessions. Every tool wraps an
 *   EXISTING commerce mechanism (commerce.psp / apps.{appId}.tools memory records, the offers
 *   document, src/commerce/session-service.ts) — no new business logic. Money amounts are integer
 *   6-decimal MICRO-UNITS (1 EUR = 1_000_000), morsels are plain integers; the two never mix.
 * @usage import { commerceTools } from './definitions/commerce.js';
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial commerce MCP tool definitions (9 tools)
 */
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const commerceTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_commerce_psp_set',
        description: 'Store YOUR OWNER\'s payment-provider credentials for selling in money currencies (the commerce.psp record the checkout payment handlers read — e.g. a Stripe secret key). Money sales always settle on the SELLER\'s own PSP account, never the node\'s. The secret is stored server-side and NEVER returned by any tool — reads show a masked hint only. Morsel-only selling needs no PSP.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            provider: { type: 'string', required: true, description: 'PSP identifier, e.g. "stripe"' },
            secret_key: { type: 'string', required: true, description: 'The PSP secret credential (stored, never echoed back)' },
        },
    },
    {
        name: 'aimeat_commerce_psp_status',
        description: 'Check whether YOUR OWNER has PSP credentials configured for money selling. Returns configured true/false, the provider name, and a masked key hint (last 4 characters) — NEVER the secret itself.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_commerce_psp_delete',
        description: 'Delete YOUR OWNER\'s stored PSP credentials (commerce.psp). Money-currency checkouts of your offers/app-tools stop working until new credentials are set; morsel selling is unaffected.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_app_tools_publish',
        description: 'Publish or replace the sellable TOOL MANIFEST of one of your owner\'s apps (the public memory record apps.{app_id}.tools) so agents can buy tool calls through the commerce checkout. Each tool: name (sku segment), description, inputSchema, price {morsels} and/or priceMoney {amount in 6-decimal MICRO-UNITS (1 EUR = 1000000), currency EUR|USD}, and a fulfillment binding — action_id (a capability id, runs instantly on purchase) or agent (bare name of your owner\'s agent that receives the order TASK; neither = the task lands in the owner\'s task space). Priced tools list in /v1/commerce/feed, /v1/commerce/tools, the MCP Server Card, and the WebMCP surface. Replaces the whole manifest — read it first (aimeat_app_tools_get) to edit incrementally.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename (e.g. "shop.html") — the manifest key is apps.{app_id}.tools' },
            tools: { type: 'array', required: true, description: 'Full tool list: [{ name, description?, inputSchema?, action_id?, agent?, price?: {morsels, unit?}, priceMoney?: {amount /* micro-units */, currency} }]' },
        },
    },
    {
        name: 'aimeat_app_tools_get',
        description: 'Read an app\'s sellable tool manifest (apps.{app_id}.tools). Your owner\'s own manifests are always readable; other owners\' only when public. Returns the tools with prices (morsels; money in 6-decimal micro-units), fulfillment mode (call | task), and the checkout skus.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename' },
            owner: { type: 'string', required: false, description: 'App owner (bare name). Default: your own owner' },
        },
    },
    {
        name: 'aimeat_offer_price_set',
        description: 'Set or clear the price of one offer on YOUR OWNER\'s agent (the agents.{name}.offers document): morsel price (integer) and/or money price (amount in 6-decimal MICRO-UNITS — 1 EUR = 1000000, 0.002 EUR = 2000 — plus currency EUR|USD; needs the seller\'s PSP configured to actually settle), and optionally the offer\'s visibility (public = listed in the commerce feed). Cross-owner purchase requires a price; your owner\'s own use stays free.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            agent_name: { type: 'string', required: true, description: 'Bare name of your owner\'s agent that publishes the offer' },
            offer_id: { type: 'string', required: true, description: 'The offer id inside agents.{agent_name}.offers' },
            price_morsels: { type: 'number', required: false, description: 'Morsel price per call (integer, >0). Omit to leave unchanged' },
            money_amount_micros: { type: 'number', required: false, description: 'Money price in integer 6-decimal MICRO-UNITS (never cents/floats). Omit to leave unchanged' },
            money_currency: { type: 'string', required: false, description: 'ISO code for money_amount_micros: EUR or USD', enum: ['EUR', 'USD'] },
            clear_morsels: { type: 'boolean', required: false, description: 'Remove the morsel price' },
            clear_money: { type: 'boolean', required: false, description: 'Remove the money price' },
            visibility: { type: 'string', required: false, description: 'Offer visibility: private | unlisted | public', enum: ['private', 'unlisted', 'public'] },
        },
    },
    {
        name: 'aimeat_checkout_open',
        description: 'Open a checkout session as a BUYER (your owner\'s balance pays — one morsel balance per human). Line items: agent offers ({agent: GAII or bare own name, offer_id}) or app-tools ({kind: "app-tool", app: "ownerName/appId", tool, input? — one call per line item}). All items must share one seller. currency: omit for morsels, or EUR/USD when the item has a money price and the node has a settling handler. Returns the open session with the quoted total; complete it with aimeat_checkout_complete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            items: { type: 'array', required: true, description: '[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }] — offer items need agent+offer_id; app-tool items need kind:"app-tool"+app+tool' },
            note: { type: 'string', required: false, description: 'Buyer note delivered with the order' },
            currency: { type: 'string', required: false, description: '"morsel" (default) or a money code (EUR/USD)' },
        },
    },
    {
        name: 'aimeat_checkout_complete',
        description: 'Pay + fulfill an open checkout session. Charges your owner\'s balance (or a money handler when specified), then fulfills: offers and unbound app-tools queue a TASK for the seller; a callable app-tool runs instantly and its result returns on fulfillment.results. A failed callable invoke refunds automatically and leaves the session open. Returns the completed session with the receipt {charged, earned, fee, trackingCode}.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            session_id: { type: 'string', required: true, description: 'The open session id from aimeat_checkout_open' },
            handler: { type: 'string', required: false, description: 'Payment handler id (default io.aimeat.morsels)' },
        },
    },
    {
        name: 'aimeat_checkout_list',
        description: 'List your owner\'s checkout sessions (purchases), newest first — status, items, totals, receipts, and fulfillment (task ids / callable results).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            limit: { type: 'number', required: false, description: 'Max sessions to return (default 20, max 200)' },
        },
        supportsResponseFormat: true,
        conciseFields: ['id', 'status', 'total', 'currency', 'sellerOwner', 'createdAt'],
    },
];

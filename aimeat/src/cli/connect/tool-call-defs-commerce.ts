/**
 * @file cli/connect/tool-call-defs-commerce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The selling side of the shell / local-call dispatch: a seller's PSP credentials, the
 *   sellable app-tool manifest, offer pricing, and the buyer's checkout.
 *
 *   Extracted from tool-call-defs-apps.ts unchanged when that file passed the 800-line ceiling. A
 *   pure move: same definitions, same handlers, same comments, spread into CONNECT_CLI_TOOLS beside
 *   the table they came from. Commerce was never an app-catalog concern; it lived there because the
 *   original extraction from tool-call.ts cut by file size rather than by subject.
 * @structure commerceCliTools[] — the handler table, spread by tool-call.ts
 * @usage import { commerceCliTools } from './tool-call-defs-commerce.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Extracted from tool-call-defs-apps.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean, requiredArray, optionalRecord } from './tool-call-helpers.js';

export const commerceCliTools: ConnectCliToolDefinition[] = [
    {
        // Store the owner's PSP secret. No dedicated REST route (server MCP writes commerce.psp), so the
        // shell proxy writes that private owner record via POST /v1/memory (memory:write authz unchanged).
        name: 'aimeat_commerce_psp_set',
        description: 'Store your owner\'s payment-provider credentials (commerce.psp) for selling in money currencies. The secret is stored server-side.',
        input: {
            provider: { type: 'string', required: true, description: 'PSP identifier, e.g. "stripe".' },
            secret_key: { type: 'string', required: true, description: 'The PSP secret credential.' },
        },
        handler: ({ client }, input) => client.post('/v1/memory', {
            key: 'commerce.psp',
            value: { provider: requiredString(input, 'provider'), secretKey: requiredString(input, 'secret_key') },
            visibility: 'private',
            tags: ['commerce'],
        }),
    },
    {
        // → GET /v1/memory/commerce.psp — the owner reads their own PSP record (shell runs as the owner).
        name: 'aimeat_commerce_psp_status',
        description: 'Read your owner\'s stored PSP record (commerce.psp).',
        input: {},
        handler: ({ client }) => client.get('/v1/memory/commerce.psp'),
    },
    {
        // → DELETE /v1/memory/commerce.psp — delete the owner's PSP record.
        name: 'aimeat_commerce_psp_delete',
        description: 'Delete your owner\'s stored PSP credentials (commerce.psp).',
        input: {},
        handler: ({ client }) => client.delete('/v1/memory/commerce.psp'),
    },
    {
        // Publish the sellable tool manifest of an app. No dedicated REST route (server MCP validates +
        // writes apps.{app_id}.tools), so the shell proxy writes that public owner record via POST /v1/memory.
        name: 'aimeat_app_tools_publish',
        description: 'Publish/replace the sellable TOOL MANIFEST of one of your apps (apps.{app_id}.tools). Replaces the whole manifest.',
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename (manifest key is apps.{app_id}.tools).' },
            tools: { type: 'array', required: true, description: 'Full tool list: [{ name, description?, inputSchema?, action_id?, agent?, price?, priceMoney? }].' },
            odps: { type: 'object', description: 'ODPS product block published alongside the manifest.' },
            provenance: { type: 'object', description: 'How the manifest was produced.' },
        },
        handler: ({ client }, input) => {
            const value: JsonObject = { version: 1, updatedAt: new Date().toISOString(), tools: requiredArray(input, 'tools') };
            const odps = optionalRecord(input, 'odps');
            const provenance = optionalRecord(input, 'provenance');
            if (odps) value.odps = odps;
            if (provenance) value.provenance = provenance;
            return client.post('/v1/memory', {
                key: `apps.${requiredString(input, 'app_id')}.tools`,
                value,
                visibility: 'public',
                tags: ['commerce', 'app-tools'],
            });
        },
    },
    {
        // → GET /v1/memory/apps.{app_id}.tools — read the manifest (own always; others only when public).
        name: 'aimeat_app_tools_get',
        description: 'Read an app\'s sellable tool manifest (apps.{app_id}.tools). Omit owner for your own; pass a full GHII (owner@node) to read another owner\'s PUBLIC manifest.',
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename.' },
            owner: { type: 'string', description: 'App owner GHII (owner@node) for a cross-owner public read. Default: your own owner.' },
        },
        handler: ({ client }, input) => {
            const key = `apps.${requiredString(input, 'app_id')}.tools`;
            const owner = optionalString(input, 'owner');
            // A bare owner used to fall back to reading YOUR OWN manifest, which is the worst kind
            // of wrong answer: the caller asked about someone else's app and got their own back with
            // no indication that the question had changed. Say so instead.
            if (owner && !owner.includes('@')) {
                return Promise.resolve({ ok: false as const, error: {
                    code: 'INVALID_INPUT',
                    message: `owner must be a full GHII ("${owner}@<node-id>"), not a bare name — a cross-owner read needs the node it lives on. Omit owner entirely to read your own manifest.`,
                } });
            }
            return owner
                ? client.get(`/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`)
                : client.get(`/v1/memory/${encodeURIComponent(key)}`);
        },
    },
    {
        // Set/clear one offer's price. No single-field route; the shell proxy reads the whole offers doc
        // (GET /v1/agents/:name/offers), patches the one offer, and writes it back (PUT — the same
        // whole-doc contract the server MCP uses), so agent-role authz is unchanged.
        name: 'aimeat_offer_price_set',
        description: 'Set or clear the price (morsels and/or money micro-units) and visibility of one offer on your agent.',
        input: {
            agent_name: { type: 'string', required: true, description: 'Bare name of your agent that publishes the offer.' },
            offer_id: { type: 'string', required: true, description: 'The offer id inside agents.{agent_name}.offers.' },
            price_morsels: { type: 'number', description: 'Morsel price per call (integer, >0).' },
            money_amount_micros: { type: 'number', description: 'Money price in integer 6-decimal micro-units.' },
            money_currency: { type: 'string', enum: ['EUR', 'USD'], description: 'Currency for money_amount_micros.' },
            clear_morsels: { type: 'boolean', description: 'Remove the morsel price.' },
            clear_money: { type: 'boolean', description: 'Remove the money price.' },
            visibility: { type: 'string', enum: ['private', 'unlisted', 'public'], description: 'Offer visibility.' },
        },
        handler: async ({ client }, input) => {
            const agentName = requiredString(input, 'agent_name');
            const offerId = requiredString(input, 'offer_id');
            const current = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/offers`);
            if (current.ok === false) return current;
            const data = current.data as { offers?: Array<Record<string, unknown>> } | undefined;
            const offers = Array.isArray(data?.offers) ? data!.offers : [];
            const offer = offers.find(o => o.id === offerId);
            if (!offer) return { ok: false as const, error: { code: 'OFFER_NOT_FOUND', message: `No offer "${offerId}" on agent "${agentName}"` } };
            const priceMorsels = optionalNumber(input, 'price_morsels');
            if (priceMorsels !== undefined) offer.price = { morsels: priceMorsels, unit: (offer.price as { unit?: string } | undefined)?.unit ?? 'per-call' };
            if (optionalBoolean(input, 'clear_morsels')) offer.price = null;
            const moneyMicros = optionalNumber(input, 'money_amount_micros');
            if (moneyMicros !== undefined) offer.priceMoney = { amount: moneyMicros, currency: optionalString(input, 'money_currency') ?? 'EUR' };
            if (optionalBoolean(input, 'clear_money')) offer.priceMoney = null;
            const visibility = optionalString(input, 'visibility'); if (visibility) offer.visibility = visibility;
            return client.put(`/v1/agents/${encodeURIComponent(agentName)}/offers`, { offers });
        },
    },
    {
        // → POST /v1/commerce/checkout-sessions — open a buyer checkout session.
        name: 'aimeat_checkout_open',
        description: 'Open a checkout session as a buyer (your owner\'s balance pays). Items reference agent offers or app-tools.',
        input: {
            items: { type: 'array', required: true, description: '[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }].' },
            note: { type: 'string', description: 'Buyer note delivered with the order.' },
            currency: { type: 'string', description: '"morsel" (default) or a money code (EUR/USD).' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { items: requiredArray(input, 'items') };
            const note = optionalString(input, 'note'); if (note) body.note = note;
            const currency = optionalString(input, 'currency'); if (currency) body.currency = currency;
            return client.post('/v1/commerce/checkout-sessions', body);
        },
    },
    {
        // → POST /v1/commerce/checkout-sessions/:id/complete — pay + fulfill an open session.
        name: 'aimeat_checkout_complete',
        description: 'Pay + fulfill an open checkout session (charges your owner\'s balance or a money handler).',
        input: {
            session_id: { type: 'string', required: true, description: 'The open session id from aimeat_checkout_open.' },
            handler: { type: 'string', description: 'Payment handler id (default io.aimeat.morsels).' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const handler = optionalString(input, 'handler'); if (handler) body.handler = handler;
            return client.post(`/v1/commerce/checkout-sessions/${encodeURIComponent(requiredString(input, 'session_id'))}/complete`, body);
        },
    },
    {
        // → GET /v1/commerce/checkout-sessions — list the owner's checkout sessions, newest first.
        name: 'aimeat_checkout_list',
        description: 'List your owner\'s checkout sessions (purchases), newest first.',
        input: { limit: { type: 'number', description: 'Max sessions to return (default 20, max 200).' } },
        handler: ({ client }, input) => client.get(`/v1/commerce/checkout-sessions${query({ limit: optionalNumber(input, 'limit') })}`),
    },
];

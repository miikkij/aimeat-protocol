/**
 * @file src/tool-dispatch/tool-call-defs-commerce.ts
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
 *   2026-10-16 — aimeat_commerce_invoice_set proxies PUT /v1/commerce/payout/invoice.
 *   2026-10-16 — aimeat_commerce_psp_delete says the route is the owner's in person; GET /v1/commerce/payout,
 *     which psp_status calls, now admits an agent holding commerce:sell (QA audit D2-02).
 *   v1.2.0 — 2026-10-11 — aimeat_offer_price_set writes the pacing amount (`toll_morsels`, `clear_toll`)
 *     and drops the deprecated `price` mirror the GET returns before writing back, so the pacing is not
 *     counted twice; price_morsels / clear_morsels are the 3.x names until 4.0.0. The checkout texts
 *     name the money total, the pacing and the pacing pack; the handler has no morsel default.
 *   v1.1.0 — 2026-09-16 — The three PSP tools call /v1/commerce/payout. Through the generic memory
 *     routes psp_set stored the Stripe key in plain text and psp_status returned it.
 *   v1.0.0 — 2026-08-25 — Extracted from tool-call-defs-apps.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean, requiredArray, optionalRecord } from './tool-call-helpers.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_FIELDS_REMOVED_IN } from '../config-pacing.js';

export const commerceCliTools: ConnectCliToolDefinition[] = [
    {
        // → PUT /v1/commerce/payout/stripe — the route stores the secret encrypted and merges it into
        // commerce.psp. A raw POST /v1/memory stored it in plain text and replaced the whole record.
        name: 'aimeat_commerce_psp_set',
        description: 'Store your owner\'s payment-provider credentials (commerce.psp) for selling in money currencies. The secret is stored server-side.',
        input: {
            provider: { type: 'string', required: true, description: 'PSP identifier, e.g. "stripe".' },
            secret_key: { type: 'string', required: true, description: 'The PSP secret credential.' },
            webhook_secret: { type: 'string', required: false, description: 'Stripe endpoint signing secret for this seller\'s webhook.' },
        },
        handler: ({ client }, input) => client.put('/v1/commerce/payout/stripe', {
            provider: requiredString(input, 'provider'),
            secret_key: requiredString(input, 'secret_key'),
            webhook_secret: optionalString(input, 'webhook_secret'),
        }),
    },
    {
        // → GET /v1/commerce/payout — which rails are configured, the key as a last-four hint only.
        name: 'aimeat_commerce_psp_status',
        description: 'Check whether your owner\'s payment-provider credentials are set. The key is shown as its last four characters.',
        input: {},
        handler: ({ client }) => client.get('/v1/commerce/payout'),
    },
    {
        // → PUT /v1/commerce/payout/invoice — the route checks commerce:sell and refuses a value that
        // is not a boolean (400 INVALID_INPUT), so a missing one is sent as missing.
        name: 'aimeat_commerce_invoice_set',
        description: 'Set whether your owner takes invoice payment for items delivered as soon as a checkout completes (off by default).',
        input: {
            accept_immediate: { type: 'boolean', required: true, description: 'true takes invoice payment for items delivered at once; false refuses it.' },
        },
        handler: ({ client }, input) => client.put('/v1/commerce/payout/invoice', {
            accept_immediate: optionalBoolean(input, 'accept_immediate'),
        }),
    },
    {
        // → DELETE /v1/commerce/payout/stripe — removes the card credentials and keeps the x402 address.
        // The route is the owner's in person (requireRole('owner')), so an agent's call is refused
        // there with ACCESS_DENIED, as the node MCP tool refuses it with SCREEN_ONLY (decision D5).
        name: 'aimeat_commerce_psp_delete',
        description: 'Delete your owner\'s stored PSP credentials (commerce.psp). The owner\'s own session only: an agent is refused and the owner removes the key on the Wallet page.',
        input: {},
        handler: ({ client }) => client.delete('/v1/commerce/payout/stripe'),
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
            // `owner_scope: true` — the manifest belongs to the OWNER whichever principal publishes
            // it. Without it an agent's write lands under the agent's GAII while every reader looks
            // under the owner's, so the publish returns 200 and the tool is invisible to everyone.
            // The same line is missing on this surface and the connector MCP; the node's own MCP
            // already scoped it. Three surfaces, one rule.
            return client.post('/v1/memory', {
                key: `apps.${requiredString(input, 'app_id')}.tools`,
                value,
                visibility: 'public',
                tags: ['commerce', 'app-tools'],
                owner_scope: true,
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
        description: 'Set the money price (micro-units; none means free), the pacing amount (toll_morsels: morsels per use, never a price) and the visibility of one offer on your agent.',
        input: {
            agent_name: { type: 'string', required: true, description: 'Bare name of your agent that publishes the offer.' },
            offer_id: { type: 'string', required: true, description: 'The offer id inside agents.{agent_name}.offers.' },
            toll_morsels: { type: 'number', description: 'The pacing amount: whole morsels per use, 0 to 100 (0 removes it).' },
            price_morsels: { type: 'number', description: 'Deprecated, removed in 4.0.0: the 3.x name of toll_morsels, stored as the pacing amount.' },
            money_amount_micros: { type: 'number', description: 'Money price in integer 6-decimal micro-units.' },
            money_currency: { type: 'string', enum: ['EUR', 'USD'], description: 'Currency for money_amount_micros.' },
            clear_toll: { type: 'boolean', description: 'Remove the pacing amount.' },
            clear_morsels: { type: 'boolean', description: 'Deprecated, removed in 4.0.0: the 3.x name of clear_toll.' },
            clear_money: { type: 'boolean', description: 'Remove the money price, which makes the offer free.' },
            visibility: { type: 'string', enum: ['private', 'unlisted', 'public'], description: 'Offer visibility.' },
        },
        handler: async ({ client }, input) => {
            const agentName = requiredString(input, 'agent_name');
            const offerId = requiredString(input, 'offer_id');
            const tollIn = optionalNumber(input, 'toll_morsels');
            const priceMorsels = optionalNumber(input, 'price_morsels');
            const clearToll = optionalBoolean(input, 'clear_toll') || optionalBoolean(input, 'clear_morsels');
            if (!legacyMorselFieldsLive() && (priceMorsels !== undefined || optionalBoolean(input, 'clear_morsels'))) {
                return { ok: false as const, error: { code: 'MORSEL_PRICE_REMOVED', message: `price_morsels and clear_morsels were removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}; a morsel is pacing, not a price. Use toll_morsels or clear_toll.` } };
            }
            const current = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/offers`);
            if (current.ok === false) return current;
            const data = current.data as { offers?: Array<Record<string, unknown>> } | undefined;
            // The GET answers each offer with its pacing amount in tollMorsels and, until 4.0.0, the old
            // `price` as a mirror of the same number. Writing the mirror back would add it to the pacing
            // amount a second time, so every offer goes back without it.
            const offers = (Array.isArray(data?.offers) ? data!.offers : []).map((o) => {
                const rest: Record<string, unknown> = { ...o };
                delete rest.price;
                return rest;
            });
            const offer = offers.find(o => o.id === offerId);
            if (!offer) return { ok: false as const, error: { code: 'OFFER_NOT_FOUND', message: `No offer "${offerId}" on agent "${agentName}"` } };
            if (tollIn !== undefined || priceMorsels !== undefined) {
                const toll = Math.min(Math.max(0, (tollIn ?? 0) + (priceMorsels ?? 0)), 100);
                if (toll > 0) offer.tollMorsels = toll; else delete offer.tollMorsels;
            }
            if (clearToll) delete offer.tollMorsels;
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
        description: 'Open a checkout session as a buyer. Items reference agent offers, app-tools or the operator\'s pacing pack; the session quotes a money total (0 = free) and its pacing in morsels.',
        input: {
            items: { type: 'array', required: true, description: '[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }]; kind is offer, app-tool, ext-call, package or pacing-pack.' },
            note: { type: 'string', description: 'Buyer note delivered with the order.' },
            currency: { type: 'string', description: 'A money code (EUR/USD). Omit it to use the first currency every item is priced in; "morsel" is the deprecated 3.x value, read as omitted until 4.0.0.' },
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
        description: 'Pay + fulfill an open checkout session: the money total through the named handler, and the pacing from your owner\'s morsel balance. On INSUFFICIENT_MORSELS, request the daily allowance (POST /v1/wallet/request) or buy the pacing pack, then complete again.',
        input: {
            session_id: { type: 'string', required: true, description: 'The open session id from aimeat_checkout_open.' },
            handler: { type: 'string', description: 'Payment handler id for a session with a money total; omit it for a free session.' },
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

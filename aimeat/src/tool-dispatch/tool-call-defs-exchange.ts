/**
 * @file cli/connect/tool-call-defs-exchange.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EXCHANGE marketplace connect-call tool definitions — the shell fallback (`aimeat connect
 *   call`) for the two-sided data-service market. Thin REST proxies over /v1/exchange/* (src/routes/
 *   exchange.ts + exchange-market.ts): browse offerings, offering detail, accept a contract, list +
 *   pause/revoke the caller's own contracts, post + browse needs, bid, accept a bid, and provider
 *   lineage. Server-side authz + authoritative pricing unchanged.
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial EXCHANGE CLI fallback handlers (10 tools).
 */
import { randomUUID } from 'node:crypto';
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean, optionalRecord } from './tool-call-helpers.js';

export const exchangeTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/exchange/offerings — browse the marketplace supply side (public).
        name: 'aimeat_exchange_offerings',
        description: 'Browse EXCHANGE marketplace offerings. Match with `q` (text) or `ext`+`action`; else list all listed offerings. `stats:true` folds in usage/reputation.',
        handler: ({ client }, input) => client.get(`/v1/exchange/offerings${query({
            q: optionalString(input, 'q'),
            ext: optionalString(input, 'ext'),
            action: optionalString(input, 'action'),
            stats: optionalBoolean(input, 'stats') ? '1' : undefined,
        })}`),
    },
    {
        // → GET /v1/exchange/offerings/:id — one offering in full (I/O schema + call-recipe + stats).
        name: 'aimeat_exchange_offering_get',
        description: 'One offering in full: record + capability I/O schema + call-recipe + usage stats.',
        handler: ({ client }, input) => client.get(`/v1/exchange/offerings/${encodeURIComponent(requiredString(input, 'offering_id'))}`),
    },
    {
        // → POST /v1/exchange/entitlements — accept a contract → mint a metered entitlement for the caller.
        name: 'aimeat_exchange_accept',
        description: 'Accept a contract on an offering → mint a metered entitlement for you. Price is authoritative from the provider action; you set only the budget cap + contract ref.',
        handler: ({ client }, input) => {
            const body: JsonObject = {
                ext: requiredString(input, 'ext'),
                action: requiredString(input, 'action'),
                contract_ref: optionalString(input, 'contract_ref') ?? `mcp:${randomUUID()}`,
            };
            const capUnits = optionalNumber(input, 'cap_units'); if (capUnits !== undefined) body.cap_units = capUnits;
            const planId = optionalString(input, 'plan_id'); if (planId) body.plan_id = planId;
            const appId = optionalString(input, 'app_id'); if (appId) body.app_id = appId;
            return client.post('/v1/exchange/entitlements', body);
        },
    },
    {
        // → GET /v1/exchange/entitlements — list the caller's own contracts (consumer side).
        name: 'aimeat_exchange_contracts',
        description: 'List every metered entitlement (contract) you hold as the consumer.',
        input: {},
        handler: ({ client }) => client.get('/v1/exchange/entitlements'),
    },
    {
        // → POST /v1/exchange/entitlements/off — pause/revoke one of the caller's own contracts.
        name: 'aimeat_exchange_contract_off',
        description: 'Pause (reversible) or revoke (terminal) one of your own contracts, by (ext, action).',
        handler: ({ client }, input) => client.post('/v1/exchange/entitlements/off', {
            ext: requiredString(input, 'ext'),
            action: requiredString(input, 'action'),
            mode: optionalString(input, 'mode') === 'revoke' ? 'revoke' : 'pause',
        }),
    },
    {
        // → GET /v1/exchange/needs — browse the demand side (public; ?mine needs auth).
        name: 'aimeat_exchange_needs',
        description: 'Browse EXCHANGE needs. `open:true` for open only; `mine:true` for your own.',
        handler: ({ client }, input) => client.get(`/v1/exchange/needs${query({
            open: optionalBoolean(input, 'open') ? '1' : undefined,
            mine: optionalBoolean(input, 'mine') ? '1' : undefined,
        })}`),
    },
    {
        // → POST /v1/exchange/needs — post an open need for providers to bid on.
        name: 'aimeat_exchange_need_post',
        description: 'Post a NEED — an open call for a data-service capability (description + optional ext/action, spec, budget, autonomy).',
        handler: ({ client }, input) => {
            const body: JsonObject = { description: requiredString(input, 'description') };
            const ext = optionalString(input, 'ext'); if (ext) body.ext = ext;
            const action = optionalString(input, 'action'); if (action) body.action = action;
            const spec = optionalRecord(input, 'spec'); if (spec) body.spec = spec;
            const budgetUnit = optionalString(input, 'budget_unit'); if (budgetUnit) body.budget_unit = budgetUnit;
            const budgetCap = optionalNumber(input, 'budget_cap'); if (budgetCap !== undefined) body.budget_cap = budgetCap;
            const appId = optionalString(input, 'app_id'); if (appId) body.app_id = appId;
            const autonomy = optionalString(input, 'autonomy'); if (autonomy) body.autonomy = autonomy;
            return client.post('/v1/exchange/needs', body);
        },
    },
    {
        // → POST /v1/exchange/needs/:id/bids — bid on an open need with an action your extension owns.
        name: 'aimeat_exchange_bid',
        description: 'Bid on an open need with an action your own extension provides.',
        handler: ({ client }, input) => {
            const body: JsonObject = { ext: requiredString(input, 'ext'), action: requiredString(input, 'action') };
            const planId = optionalString(input, 'plan_id'); if (planId) body.plan_id = planId;
            const note = optionalString(input, 'note'); if (note) body.note = note;
            const offeringId = optionalString(input, 'offering_id'); if (offeringId) body.offering_id = offeringId;
            return client.post(`/v1/exchange/needs/${encodeURIComponent(requiredString(input, 'need_id'))}/bids`, body);
        },
    },
    {
        // → POST /v1/exchange/needs/:id/bids/:bidId/accept — requester accepts a bid → mints the entitlement.
        name: 'aimeat_exchange_bid_accept',
        description: 'As the need\'s requester, accept a bid → mint the entitlement (you = consumer, bidder = provider).',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const capUnits = optionalNumber(input, 'cap_units'); if (capUnits !== undefined) body.cap_units = capUnits;
            return client.post(
                `/v1/exchange/needs/${encodeURIComponent(requiredString(input, 'need_id'))}/bids/${encodeURIComponent(requiredString(input, 'bid_id'))}/accept`,
                body,
            );
        },
    },
    {
        // → GET /v1/exchange/offerings/:id/consumers — provider lineage (who holds contracts against my offering).
        name: 'aimeat_exchange_consumers',
        description: 'Provider lineage for one of your offerings: who holds a contract against it, calls, settled units, state, last use.',
        handler: ({ client }, input) => client.get(`/v1/exchange/offerings/${encodeURIComponent(requiredString(input, 'offering_id'))}/consumers`),
    },
];

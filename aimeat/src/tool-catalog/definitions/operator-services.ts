/**
 * @file src/tool-catalog/definitions/operator-services.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_admin_service_access (mcp/operator-services.ts): the outside
 *   services the operator switched on for every account (agents.operator_services) and the accounts
 *   one of them covers, read through services/operator-services/listing.ts, the functions
 *   GET /v1/operator-services and GET /v1/operator-services/{id}/accounts call, and the operator's
 *   switch for one account (account_off, account_on: services/operator-services/operator-switch.ts,
 *   which PUT /v1/operator-services/{id}/accounts/{account} calls). The setting itself is changed with
 *   aimeat_admin_config_set.
 * @structure operatorServiceTools
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.2.0 — 2026-11-26 — Actions account_off and account_on with `account` and `reason`; the tool writes
 *     now (readOnlyHint false); the description names the audience, required, the private read and help.
 *   v1.1.0 — 2026-11-26 — operator:admin, as aimeat_admin_agents and aimeat_admin_config: the operator's
 *     read tool for chat. operator:service-provision is the service's own credential, on REST.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const operatorServiceTools = [
    {
        name: 'aimeat_admin_service_access',
        description: 'Operator services: outside services the operator of this node switched on for every account, or for the accounts the entry\'s audience names, so each person gets the service\'s agent with no approval of their own. Each person sees that agent in their agent list marked as set by the operator and gets one notice. They can turn the service off for themselves unless the operator made it required; a required service\'s agent only the operator removes or limits. '
            + 'Operator-only. Action "list" (the default): every entry of the setting with its permissions, its write prefixes (the only memory keys its agent may write as the person), its audience, whether it is required, whether it reads private records and why, how a person can help it, whether it can be used now and why not (`usable`, `problem`), and how many accounts in its audience are active, turned off by the person (removed), switched off by the operator (operator_off) and still waiting (pending), and the operator\'s own state. '
            + 'Action "accounts" with `service`: the accounts in that service\'s audience, in account-name order, each with its account name, GHII, state and when that state began, `limit` at a time (default 100, at most 500), `next_cursor` for the next page. '
            + 'Action "account_off" with `service` and `account` (and an optional `reason`): switch the service off for that one account; its agent there is ended at once and none is set up until "account_on". Action "account_on" with `service` and `account`: take that switch back; a person who turned the service off themselves stays off. '
            + 'Returns an operator-role error (FORBIDDEN) for anyone but an operator\'s agent holding operator:admin; a service\'s own agent cannot switch it. '
            + 'The setting itself is agents.operator_services, changed with aimeat_admin_config_set or on the admin Config page; it is off (an empty list) by default. Same as GET /v1/operator-services, GET /v1/operator-services/{id}/accounts and PUT /v1/operator-services/{id}/accounts/{account}.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Operator Services', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            action: { type: 'string', enum: ['list', 'accounts', 'account_off', 'account_on'], description: '"list" (the default), "accounts", "account_off" or "account_on".' },
            service: { type: 'string', description: 'With action "accounts", "account_off" or "account_on": the entry\'s id, which is also the agent name each person gets.', zod: z.string().min(1).max(64) },
            account: { type: 'string', description: 'With action "account_off" or "account_on": the account name on this node.', zod: z.string().min(1).max(64) },
            reason: { type: 'string', description: 'With action "account_off": why, in up to 300 characters; the person reads it in their account feed.', zod: z.string().max(300) },
            limit: { type: 'number', description: 'With action "accounts": how many accounts in one page, 1 to 500 (default 100).', zod: z.number().int().min(1).max(500) },
            cursor: { type: 'string', description: 'With action "accounts": the `next_cursor` of the page before.', zod: z.string().max(256) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

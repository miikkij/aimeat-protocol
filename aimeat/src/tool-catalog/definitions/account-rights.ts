/**
 * @file src/tool-catalog/definitions/account-rights.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an account may read and what it carries out (Comicland v3 A-3, A-5, A-8):
 *   aimeat_adult_status (verified adult yes or no), aimeat_subscription_list and
 *   aimeat_subscription_cancel (subscriptions to extensions' plans), aimeat_provenance_embed (AI
 *   provenance written into an exported file). On all three surfaces: the node's MCP endpoint
 *   (src/mcp/account-rights.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-account-rights.ts), the last two over the REST routes.
 * @structure accountRightsTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.1 — 2026-10-30 — aimeat_adult_status says that a card payment to a seller who does not run the
 *     node is confirmed by the owner in person (secaudit2026oct26 round 8c, commerce-07).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-3, A-5, A-8).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const accountRightsTools = [
    {
        name: 'aimeat_adult_status',
        description: 'Whether your owner is a verified adult: verified true or false, the method (eudiw, ftn or credit-card) and when, never a birth date. Ask it before buying or opening adult content for them. When it is false, tell them they can verify with a bank identification or by paying with a credit card; a debit or prepaid card does not count. After a card payment to a seller who does not run this node, they confirm it themselves with one press in their notifications ("I paid with my own card"); you cannot press it for them.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Verified Adult', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/ghii/me/adult asks: the answer is a record of the account.
        scope: 'memory:read',
        surfaces: ['agent', 'appdev', 'service'],
        input: {},
    },
    {
        name: 'aimeat_subscription_list',
        description: 'Your owner\'s subscriptions to plans that extensions offer (a creator\'s or a studio\'s monthly plan, for example), running and ended: the plan, its price, when it runs until, and whether it renews on the kept card. To subscribe, open a checkout with an item { kind: "subscription", app: <extension>, tool: <plan id> } (aimeat_checkout_open).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Subscriptions', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'wallet:read',
        surfaces: ['agent', 'appdev', 'service'],
        input: {},
    },
    {
        name: 'aimeat_subscription_cancel',
        description: 'Stop one of your owner\'s subscriptions from renewing. The period already paid runs to its end and nothing is refunded. Ask your owner first.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Cancel Subscription', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'commerce:buy',
        surfaces: ['agent', 'appdev', 'service'],
        input: {
            ext: { type: 'string', required: true, description: 'The extension that offers the plan.', zod: z.string().min(1).max(200) },
            plan: { type: 'string', required: true, description: 'The plan id.', zod: z.string().min(1).max(200) },
        },
    },
    {
        name: 'aimeat_provenance_embed',
        description: 'Write the AI provenance INTO an exported file, so it travels with the file: a PNG, a JPEG, a PDF or a CBZ (a ZIP of pages) in storage, marked with the records its content was made from (the provenance_id each picture of aimeat_image_generate came with). The marked copy is stored beside the original as <key>.marked.<ext>, or at output_key; the original stays as it was. It carries the IPTC digital source type that image tools and platforms read, and each record\'s address. Several records, or composite: true, mark it as combined from AI and human work.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Mark an Export', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:write',
        surfaces: ['agent', 'appdev', 'service'],
        input: {
            storage_key: { type: 'string', required: true, description: 'The exported file in your storage.', zod: z.string().min(1).max(512) },
            provenance_ids: { type: 'array', required: true, description: 'The provenance records the content was made from (at most 500).', zod: z.array(z.string().min(1).max(200)).min(1).max(500) },
            output_key: { type: 'string', description: 'Where to store the marked copy. Default: <key>.marked.<ext>.', zod: z.string().min(1).max(512) },
            composite: { type: 'boolean', description: 'Mark as combined from AI and human work even with one record.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

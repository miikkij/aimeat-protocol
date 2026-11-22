/**
 * @file src/tool-catalog/definitions/disputes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the operator's dispute tools (mcp/disputes.ts): the disputes that
 *   wait for a ruling and one dispute with its audit trail (GET /v1/admin/disputes and
 *   GET /v1/admin/disputes/:id), and the ruling itself (POST /v1/admin/disputes/:id/rule).
 * @structure disputeTools
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida): an operator
 *     told that a dispute waits for a ruling could rule it only with a hand-written REST call.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const disputeTools = [
    {
        name: 'aimeat_admin_disputes',
        description: 'Operator-only. The work disputes on this node that wait for the operator, or one dispute in full. '
            + 'Without `id`: the disputes the parties escalated, and the ones that timed out after 30 days while the provider\'s balance did not cover the refund (`status` "escalated", the default); "open" adds the disputes the parties are still settling between themselves, and "all" adds the resolved ones. '
            + 'Each row has the dispute id, the work\'s tracking code, the requester and the provider, why it was opened, `paid_morsels` (what delivery paid the provider, which is all a ruling can share out), `waits_since`, and `timed_out` when the 30-day timeout passed it to the operator. '
            + 'With `id`: that dispute, the same fields, and its audit trail, every event in order with the hash chain that makes a change visible. '
            + 'Rule one with aimeat_admin_dispute_rule. Same as GET /v1/admin/disputes and GET /v1/admin/disputes/:id. Returns NOT_FOUND for an unknown id, and an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Disputes', readOnlyHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', description: 'One dispute\'s id, from a row of the list. Omit for the list.' },
            status: { type: 'string', enum: ['escalated', 'open', 'all'], description: 'Without `id`: "escalated" (the default, what waits for a ruling), "open" (also what the parties are still settling) or "all" (also the resolved ones).' },
        },
    },
    {
        name: 'aimeat_admin_dispute_rule',
        description: 'Operator-only. Rule one work dispute and close it. What a ruling shares out is what delivery paid the provider (`paid_morsels` in aimeat_admin_disputes), never more: `to_requester` moves from the provider back to the requester, `burned` is taken from the provider and removed from circulation, and the provider keeps the rest. '
            + '`ruling` is "requester_wins", "provider_wins" or "split"; a requester_wins ruling counts against the provider\'s trust score. '
            + 'Read the dispute and its trail with aimeat_admin_disputes first, and tell the person what each party gets before you rule: a ruling cannot be undone. '
            + 'Returns RULING_EXCEEDS_ESCROW when the shares add up to more than was paid, PROVIDER_BALANCE_SHORT when the provider\'s balance holds less than the ruling takes back (rule a smaller share), DISPUTE_CLOSED for a dispute already resolved, NOT_FOUND for an unknown id; nothing is written in any of these. Same as POST /v1/admin/disputes/:id/rule.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Rule a Dispute', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The dispute id, from aimeat_admin_disputes.' },
            ruling: { type: 'string', required: true, enum: ['requester_wins', 'provider_wins', 'split'], description: '"requester_wins", "provider_wins" or "split".' },
            to_requester: { type: 'number', description: 'Morsels the provider gives back to the requester, a whole number. Default 0.' },
            burned: { type: 'number', description: 'Morsels taken from the provider and removed from circulation. Default 0.' },
            reason: { type: 'string', description: 'Why, in words both parties can read. It is kept in the dispute and its audit trail.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

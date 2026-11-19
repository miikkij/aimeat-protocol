/**
 * @file src/tool-catalog/definitions/moderation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The moderation review for an AI: the flags that wait for a decision and a decision on
 *   one (the operator's: aimeat_admin_flags, aimeat_admin_flag_review), the content owner's appeal
 *   against a flag (aimeat_flag_appeal), and the appeals a moderator decides (aimeat_appeals,
 *   aimeat_appeal_review). On all three surfaces: the node's MCP endpoint (src/mcp/flags.ts), the
 *   connector MCP and the CLI dispatch (src/tool-dispatch/tool-call-defs-moderation.ts), the last two
 *   over GET and PUT /v1/flags, POST /v1/flags/:flagId/appeal, GET /v1/appeals and POST
 *   /v1/appeals/:id/review. One implementation: services/moderation/review.ts. Each tool asks the
 *   word its route asks.
 * @structure moderationTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: reviewing flags, appealing and reviewing appeals were REST only,
 *     with no page and no tool (feature audit 2026-11-19, 4.4 item 3).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const moderationTools = [
    {
        name: 'aimeat_admin_flags',
        description: 'Operator-only. The content flags on this node: who flagged what and why, and its review state. `status` filters ("active" waits for a decision; also "dismissed", "actioned"), `target_type` filters by kind (memory, board_post, action, agent), and `page` and `per_page` (at most 100) page the list. Decide one with aimeat_admin_flag_review. Same as GET /v1/flags.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Content Flags', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/flags asks (requireOperator).
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            status: { type: 'string', enum: ['active', 'dismissed', 'actioned'], description: 'Which flags: active (waits for a decision), dismissed or actioned. Left out: all.' },
            target_type: { type: 'string', enum: ['memory', 'board_post', 'action', 'agent'], description: 'The kind of content flagged. Left out: all kinds.' },
            page: { type: 'number', description: 'The page, from 1.' },
            per_page: { type: 'number', description: 'Flags on a page, 1 to 100 (20 by default).' },
        },
    },
    {
        name: 'aimeat_admin_flag_review',
        description: 'Operator-only. Decide one content flag: "dismissed" (the flag was wrong, and the content shows again once no other active flags hide it) or "actioned" (the flag stands). The content\'s owner can appeal the decision. Read the flag with aimeat_admin_flags first, and tell the person what you decided. Refusals: VALIDATION_ERROR (another status), NOT_FOUND, FORBIDDEN (not an operator). Same as PUT /v1/flags/:id.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Decide a Flag', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // PUT /v1/flags/:id admits an agent only through isOperatorCaller, which asks operator:admin.
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            flag_id: { type: 'string', required: true, description: 'The flag id, from aimeat_admin_flags.' },
            status: { type: 'string', required: true, enum: ['dismissed', 'actioned'], description: '"dismissed" or "actioned".' },
        },
    },
    {
        name: 'aimeat_flag_appeal',
        description: 'Appeal a flag against your owner\'s content, or against content you made, when the person says the flag is wrong. Give the flag id and the reason in the person\'s words. A flag is appealed once; the operator, or the organism\'s creator or an admin for content inside an organism, upholds or overturns it, and an overturned flag stops hiding the content. Refusals: VALIDATION_ERROR (no reason, or over 10 000 characters), NOT_FOUND, ACCESS_DENIED (not your owner\'s content), ALREADY_APPEALED. Same as POST /v1/flags/:flagId/appeal.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Appeal a Flag', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The word POST /v1/flags/:flagId/appeal asks.
        scope: 'social:write',
        surfaces: ['agent', 'service', 'admin'],
        input: {
            flag_id: { type: 'string', required: true, description: 'The flag id.' },
            reason: { type: 'string', required: true, description: 'Why the flag is wrong, at most 10 000 characters.' },
        },
    },
    {
        name: 'aimeat_appeals',
        description: 'The appeals your owner decides: every appeal on the node for an operator, and for the creator or an admin of an organism the appeals on that organism\'s content. Each has `id`, `flagId`, `appealedBy`, `reason`, `status` (pending, upheld, overturned) and `createdAt`. `status` filters, `page` and `per_page` page the list. Decide one with aimeat_appeal_review. Refusals: FORBIDDEN (your owner decides no appeals). Same as GET /v1/appeals.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Appeals to Decide', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/appeals asks.
        scope: 'social:read',
        surfaces: ['agent', 'admin'],
        input: {
            status: { type: 'string', enum: ['pending', 'upheld', 'overturned'], description: 'Which appeals. Left out: all.' },
            page: { type: 'number', description: 'The page, from 1.' },
            per_page: { type: 'number', description: 'Appeals on a page, 1 to 100 (20 by default).' },
        },
    },
    {
        name: 'aimeat_appeal_review',
        description: 'Decide one pending appeal your owner decides: "upheld" (the flag stays and the content stays hidden) or "overturned" (the flag is dismissed and the content shows again). `note` says why, for the person who appealed. Ask your owner before you decide unless they told you how. Refusals: VALIDATION_ERROR, NOT_FOUND, FORBIDDEN (your owner does not decide this appeal), ALREADY_REVIEWED. Same as POST /v1/appeals/:id/review.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Decide an Appeal', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The word POST /v1/appeals/:id/review asks.
        scope: 'social:write',
        surfaces: ['agent', 'admin'],
        input: {
            appeal_id: { type: 'string', required: true, description: 'The appeal id, from aimeat_appeals.' },
            decision: { type: 'string', required: true, enum: ['upheld', 'overturned'], description: '"upheld" or "overturned".' },
            note: { type: 'string', description: 'Why, in words the person who appealed can read.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

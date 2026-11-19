/**
 * @file flags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP flags tool registration. Provides 1 tool for content moderation
 *   (reporting content for review). No resource — flag status is read-only and
 *   operator-managed. The write itself is services/moderation-flags.ts, which POST /v1/flags
 *   calls as well; this file declares the tool and renders its answer.
 *
 *   The moderation review sits beside it (registerModerationReviewTools): the operator's flag list
 *   and decision, the content owner's appeal, and the appeals a moderator decides, each over the
 *   service function its REST route runs (services/moderation/review.ts).
 * @structure
 *   - registerFlagsTools() — registers the flag report tool on an McpServer instance
 *   - registerModerationReviewTools() — aimeat_admin_flags, _flag_review, aimeat_flag_appeal,
 *     aimeat_appeals, aimeat_appeal_review
 * @usage
 *   import { registerFlagsTools } from './flags.js';
 *   registerFlagsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.4.0 — 2026-11-19 — registerModerationReviewTools: the moderation review on MCP (feature audit
 *     2026-11-19, 4.4 item 3).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-03-21 — Initial creation: 1 tool for content moderation reporting via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 — 2026-08-11 — August 2026 audit step 8: the write moves to services/moderation-flags.ts.
 *     The tool gains what the HTTP door had and it did not: `app`, `ai_provenance` and
 *     `undisclosed_ai` (the AI Act correction procedure), the organism's flagsEnabled setting, the
 *     flagCount bump on a flagged memory record, and the bounds on targetId and description.
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { createModerationFlag } from '../services/moderation-flags.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { toolError } from './tool-error.js';
import { emitChange } from '../services/event-bus.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/operator/principal.js';
import {
    listFlagsForReview, reviewFlag, appealFlag, listAppealsFor, reviewAppeal, pageOf,
} from '../services/moderation/review.js';

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/**
 * The moderation review: aimeat_admin_flags (GET /v1/flags), aimeat_admin_flag_review (PUT
 * /v1/flags/:id), aimeat_flag_appeal (POST /v1/flags/:flagId/appeal), aimeat_appeals (GET
 * /v1/appeals) and aimeat_appeal_review (POST /v1/appeals/:id/review). Each runs the service
 * function its route runs, with the session's own credential, so who may decide is decided there.
 */
export function registerModerationReviewTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    caller: () => CallerContext,
): void {
    const deps = { storage, config };

    mcp.registerTool('aimeat_admin_flags', {
        description: descriptionFor('aimeat_admin_flags'), inputSchema: zodShapeFor('aimeat_admin_flags'),
        annotations: annotationsFor('aimeat_admin_flags'),
    }, async ({ status, target_type, page, per_page }) => {
        // GET /v1/flags asks requireOperator: the operator, or their agent holding operator:admin.
        if (!(await caller().operator('operator:admin'))) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
        const paging = pageOf(page, per_page);
        const flags = await listFlagsForReview(storage, { status, targetType: target_type, ...paging });
        return text({ flags, page: paging.page, per_page: paging.perPage });
    });

    mcp.registerTool('aimeat_admin_flag_review', {
        description: descriptionFor('aimeat_admin_flag_review'), inputSchema: zodShapeFor('aimeat_admin_flag_review'),
        annotations: annotationsFor('aimeat_admin_flag_review'),
    }, async ({ flag_id, status }) => {
        const out = await reviewFlag(deps, caller().auth, flag_id, status);
        if (!out.ok) return toolError(out.code, out.message);
        emitChange('flags');
        return text(out.flag);
    });

    mcp.registerTool('aimeat_flag_appeal', {
        description: descriptionFor('aimeat_flag_appeal'), inputSchema: zodShapeFor('aimeat_flag_appeal'),
        annotations: annotationsFor('aimeat_flag_appeal'),
    }, async ({ flag_id, reason }) => {
        const out = await appealFlag(deps, caller().auth, flag_id, reason);
        if (!out.ok) return toolError(out.code, out.message);
        emitChange('appeals');
        return text(out.appeal);
    });

    mcp.registerTool('aimeat_appeals', {
        description: descriptionFor('aimeat_appeals'), inputSchema: zodShapeFor('aimeat_appeals'),
        annotations: annotationsFor('aimeat_appeals'),
    }, async ({ status, page, per_page }) => {
        const paging = pageOf(page, per_page);
        const out = await listAppealsFor(deps, caller().auth, { status, ...paging });
        if (!out.ok) return toolError(out.code, out.message);
        return text({ appeals: out.appeals, total: out.total, page: paging.page, per_page: paging.perPage });
    });

    mcp.registerTool('aimeat_appeal_review', {
        description: descriptionFor('aimeat_appeal_review'), inputSchema: zodShapeFor('aimeat_appeal_review'),
        annotations: annotationsFor('aimeat_appeal_review'),
    }, async ({ appeal_id, decision, note }) => {
        const out = await reviewAppeal(deps, caller().auth, appeal_id, { decision, note });
        if (!out.ok) return toolError(out.code, out.message);
        emitChange('appeals');
        return text(out.appeal);
    });
}

export function registerFlagsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_flag_report ──
    mcp.registerTool(
        'aimeat_flag_report',
        {
            description: descriptionFor('aimeat_flag_report'),
            inputSchema: zodShapeFor('aimeat_flag_report'),
            annotations: annotationsFor('aimeat_flag_report'),
        },
        async ({ target_type, target_id, reason, description }) => {
            const out = await createModerationFlag({ storage, config }, agentGaii, {
                targetType: target_type,
                targetId: target_id,
                reason,
                description,
            });

            if (!out.ok) {
                return {
                    content: [{ type: 'text' as const, text: out.message }],
                    isError: true,
                };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        flag_id: out.flag.id,
                        status: 'submitted',
                        target_type: out.flag.targetType,
                        target_id: out.flag.targetId,
                        reason: out.flag.reason,
                    }, null, 2),
                }],
            };
        },
    );
}

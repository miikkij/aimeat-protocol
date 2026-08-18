/**
 * @file flags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP flags tool registration. Provides 1 tool for content moderation
 *   (reporting content for review). No resource — flag status is read-only and
 *   operator-managed. The write itself is services/moderation-flags.ts, which POST /v1/flags
 *   calls as well; this file declares the tool and renders its answer.
 * @structure
 *   - registerFlagsTools() — registers the flag report tool on an McpServer instance
 * @usage
 *   import { registerFlagsTools } from './flags.js';
 *   registerFlagsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 1 tool for content moderation reporting via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 — 2026-08-11 — August 2026 audit step 8: the write moves to services/moderation-flags.ts.
 *     The tool gains what the HTTP door had and it did not: `app`, `ai_provenance` and
 *     `undisclosed_ai` (the AI Act correction procedure), the organism's flagsEnabled setting, the
 *     flagCount bump on a flagged memory record, and the bounds on targetId and description.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
    FLAG_TARGET_TYPES,
    FLAG_REASONS,
    createModerationFlag,
} from '../services/moderation-flags.js';

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
    mcp.tool(
        'aimeat_flag_report',
        descriptionFor('aimeat_flag_report'),
        {
            // The two lists come from the service, so the tool declares exactly what the capability
            // accepts. They used to be written out here, two values and one reason short.
            target_type: z.enum(FLAG_TARGET_TYPES).describe('Type of content being reported'),
            target_id: z.string().describe('ID of the content to flag'),
            reason: z.enum(FLAG_REASONS).describe('Reason for reporting'),
            description: z.string().optional().describe('Optional additional context'),
        },
        annotationsFor('aimeat_flag_report'),
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

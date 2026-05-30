/**
 * @file flags.ts
 * @description MCP flags tool registration. Provides 1 tool for content moderation
 *   (reporting content for review). No resource — flag status is read-only and
 *   operator-managed.
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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerFlagsTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
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
            target_type: z.enum(['memory', 'board_post', 'action', 'agent']).describe('Type of content being reported'),
            target_id: z.string().describe('ID of the content to flag'),
            reason: z.enum(['unreliable', 'inappropriate', 'illegal', 'spam', 'other']).describe('Reason for reporting'),
            description: z.string().optional().describe('Optional additional context'),
        },
        annotationsFor('aimeat_flag_report'),
        async ({ target_type, target_id, reason, description }) => {
            // Check if already flagged by this agent
            const existing = await storage.getFlagByUser(target_type, target_id, agentGaii);
            if (existing) {
                return {
                    content: [{ type: 'text' as const, text: 'You have already flagged this content' }],
                    isError: true,
                };
            }

            const now = new Date().toISOString();
            const id = `flag-${randomBytes(8).toString('hex')}`;

            const flag = await storage.createFlag({
                id,
                targetType: target_type,
                targetId: target_id,
                flaggedBy: agentGaii,
                reason,
                description: description ?? undefined,
                status: 'active',
                createdAt: now,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        flag_id: flag.id,
                        status: 'submitted',
                        target_type: flag.targetType,
                        target_id: flag.targetId,
                        reason: flag.reason,
                    }, null, 2),
                }],
            };
        },
    );
}

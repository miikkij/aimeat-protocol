/**
 * @file prompts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP handbook tool registration. Provides 1 tool for retrieving the agent
 *   operating handbook or managed prompts by tier. No resource -- fetched on-demand.
 * @structure
 *   - registerPromptsTools() — registers the prompts get tool on an McpServer instance
 * @usage
 *   import { registerPromptsTools } from './prompts.js';
 *   registerPromptsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 -- 2026-03-21 -- Initial creation: 1 tool for managed system prompt retrieval via MCP
 *   v1.1.0 -- 2026-05-27 -- Rename tool from aimeat_prompts_get to aimeat_handbook_get
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + readOnlyHint) from shared
 *     annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.4.0 -- 2026-05-30 -- aimeat_handbook_get gains optional `surface` param → returns the v2
 *     per-role surface handbook (handbookForRole); tier now optional (defaults tier1).
 *   v1.5.0 -- 2026-08-22 -- The surface handbook carries the proactive guidance while the owner
 *     keeps that setting on (services/proactive-mode.ts). Tier prompts are left alone on purpose:
 *     that response reports a managed prompt's own content, and appending to it would misreport it.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { handbookForRole } from '../services/handbooks/index.js';
import { proactiveGuidance } from '../services/proactive-mode.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export function registerPromptsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {

    // ── Tool 1: aimeat_handbook_get ──
    mcp.tool(
        'aimeat_handbook_get',
        descriptionFor('aimeat_handbook_get'),
        {
            tier: z.string().optional().describe('Prompt tier or ID (e.g. "tier1", "tier2", "tier-1", or a custom prompt ID). Defaults to tier1.'),
            surface: z.enum(['appdev', 'agent', 'service', 'admin']).optional().describe('Return the v2 purpose-scoped surface handbook for this role (use the surface you connected to, e.g. "agent" on /v2/mcp/agent) instead of a tier prompt.'),
        },
        annotationsFor('aimeat_handbook_get'),
        async ({ tier, surface }) => {
            // v2 surface handbook short-circuit
            if (surface) {
                // The same guidance the handshake carried, for the agent that treats the handbook
                // as its operating guide and re-reads it when a task is new to it. Appended to the
                // markdown rather than to a managed prompt's `content`, which has to keep saying
                // what that prompt actually says.
                const guidance = await proactiveGuidance(
                    storage, config, parseGaiiLoose(getAgentGaii()).owner || undefined,
                );
                const text = guidance
                    ? `${handbookForRole(surface)}\n\n${guidance}`
                    : handbookForRole(surface);
                return { content: [{ type: 'text' as const, text }] };
            }
            const tierKey = tier ?? 'tier1';
            // Normalize tier aliases used in routes (tier1 → tier-1, etc.)
            const normalized = tierKey
                .replace(/^tier(\d)$/, 'tier-$1')
                .replace(/^(\d)$/, 'tier-$1');

            const record = await storage.getSystemPrompt(normalized);
            if (!record || !record.active) {
                // Try the original key as a fallback
                const fallback = await storage.getSystemPrompt(tierKey);
                if (!fallback || !fallback.active) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Prompt not found or not active: ${tierKey}`,
                        }],
                        isError: true,
                    };
                }

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            id: fallback.id,
                            name: fallback.name,
                            description: fallback.description,
                            content: fallback.content,
                            group: fallback.group,
                            variables: fallback.variables,
                        }, null, 2),
                    }],
                };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: record.id,
                        name: record.name,
                        description: record.description,
                        content: record.content,
                        group: record.group,
                        variables: record.variables,
                    }, null, 2),
                }],
            };
        },
    );
}

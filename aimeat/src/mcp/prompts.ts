/**
 * @file prompts.ts
 * @description MCP prompts tool registration. Provides 1 tool for retrieving managed
 *   system prompts by tier. No resource — prompts are fetched on-demand.
 * @structure
 *   - registerPromptsTools() — registers the prompts get tool on an McpServer instance
 * @usage
 *   import { registerPromptsTools } from './prompts.js';
 *   registerPromptsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 1 tool for managed system prompt retrieval via MCP
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export function registerPromptsTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    _getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {

    // ── Tool 1: aimeat_prompts_get ──
    mcp.tool(
        'aimeat_prompts_get',
        'Get a managed system prompt by tier or ID',
        {
            tier: z.string().describe('Prompt tier or ID (e.g. "tier1", "tier2", "tier-1", or a custom prompt ID)'),
        },
        async ({ tier }) => {
            // Normalize tier aliases used in routes (tier1 → tier-1, etc.)
            const normalized = tier
                .replace(/^tier(\d)$/, 'tier-$1')
                .replace(/^(\d)$/, 'tier-$1');

            const record = await storage.getSystemPrompt(normalized);
            if (!record || !record.active) {
                // Try the original key as a fallback
                const fallback = await storage.getSystemPrompt(tier);
                if (!fallback || !fallback.active) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Prompt not found or not active: ${tier}`,
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

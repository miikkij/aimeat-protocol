/**
 * @file agent-capabilities.ts
 * @description MCP tools for agent capability reporting and activity history viewing.
 *   Tool 1 lets an agent self-report its technical/domain capabilities.
 *   Tool 2 lets an agent view its own activity stats and history.
 * @structure
 *   - registerAgentCapabilityTools() -- registers capability + activity tools on an McpServer instance
 * @usage
 *   import { registerAgentCapabilityTools } from './agent-capabilities.js';
 *   registerAgentCapabilityTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 -- 2026-05-20 -- Initial creation for Agent Dashboard Phase 2
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTechnicalCapability } from '../storage/interface.js';

export function registerAgentCapabilityTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_agent_capabilities_report ──
    mcp.tool(
        'aimeat_agent_capabilities_report',
        'Report your technical and domain capabilities so the system knows what you can do',
        {
            technical: z.array(z.object({
                name: z.string().describe('Capability name (e.g. "playwright", "git", "python")'),
                type: z.enum(['mcp', 'skill', 'tool']).describe('Capability type'),
            })).optional().describe('Technical capabilities (MCP servers, skills, tools)'),
            domain: z.array(z.string()).optional().describe('Domain expertise areas (e.g. "web development", "data analysis")'),
            languages: z.array(z.string()).optional().describe('Human languages the agent can work in (e.g. "fi", "en", "de")'),
        },
        async ({ technical, domain, languages }) => {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) {
                return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
            }

            // Agent is connected via MCP -- MCP-type capabilities are verified
            const technicalCapabilities: AgentTechnicalCapability[] = (technical ?? []).map(cap => ({
                name: cap.name,
                type: cap.type,
                verified: cap.type === 'mcp',
            }));

            // Build domain capabilities, merging language entries as "Language: fi" etc.
            const domainCapabilities = [...(domain ?? [])];
            if (languages) {
                for (const lang of languages) {
                    domainCapabilities.push(`Language: ${lang}`);
                }
            }

            const updated = await storage.updateAgent(agentGaii, {
                technicalCapabilities,
                domainCapabilities,
            });

            if (!updated) {
                return { content: [{ type: 'text' as const, text: 'Failed to update capabilities' }], isError: true };
            }

            emitResourceUpdated(agentGaii, `aimeat://agents/${agentGaii}/capabilities`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        technical_capabilities: updated.technicalCapabilities ?? [],
                        domain_capabilities: updated.domainCapabilities ?? [],
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_agent_activity ──
    mcp.tool(
        'aimeat_agent_activity',
        'View your activity stats and history',
        {
            days: z.number().optional().describe('Number of days of history to retrieve (default 30)'),
            granularity: z.enum(['daily', 'hourly']).optional().describe('Granularity of history records (default daily)'),
        },
        async ({ days, granularity }) => {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) {
                return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
            }

            const history = await storage.getActivityHistory(agentGaii, {
                days: days ?? 30,
                granularity: granularity ?? 'daily',
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        stats: agent.activityStats ?? null,
                        history,
                    }, null, 2),
                }],
            };
        },
    );
}

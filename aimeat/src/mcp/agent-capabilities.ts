/**
 * @file agent-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-08-11 -- The write is services/agent-profile-write.ts, shared with PUT
 *     /v1/agents/:name/capabilities. Reported languages are stored in the agent's `languages`
 *     field, as HTTP has stored them since May; this tool was still pushing them into
 *     domainCapabilities as "Language: fi", so an MCP-onboarded agent had a polluted domain list
 *     and read as speaking no language anywhere the UI shows one.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { setAgentCapabilities } from '../services/agent-profile-write.js';

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
        descriptionFor('aimeat_agent_capabilities_report'),
        {
            technical: z.array(z.object({
                name: z.string().describe('Capability name (e.g. "playwright", "git", "python")'),
                type: z.enum(['mcp', 'skill', 'tool']).describe('Capability type'),
            })).optional().describe('Technical capabilities (MCP servers, skills, tools)'),
            domain: z.array(z.string()).optional().describe('Domain expertise areas (e.g. "web development", "data analysis")'),
            languages: z.array(z.string()).optional().describe('Human languages the agent can work in (e.g. "fi", "en", "de")'),
        },
        annotationsFor('aimeat_agent_capabilities_report'),
        async ({ technical, domain, languages }) => {
            // The caller reached this tool over an authenticated agent session, so the connection
            // itself is the proof behind an mcp-type capability being marked verified.
            const outcome = await setAgentCapabilities({ storage, config }, agentGaii,
                { technical, domain, languages }, { liveMcpSession: true });

            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            const updated = outcome.agent;

            emitResourceUpdated(agentGaii, `aimeat://agents/${agentGaii}/capabilities`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        technical_capabilities: updated.technicalCapabilities ?? [],
                        domain_capabilities: updated.domainCapabilities ?? [],
                        languages: updated.languages ?? [],
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_agent_activity ──
    mcp.tool(
        'aimeat_agent_activity',
        descriptionFor('aimeat_agent_activity'),
        {
            days: z.number().optional().describe('Number of days of history to retrieve (default 30)'),
            granularity: z.enum(['daily', 'hourly']).optional().describe('Granularity of history records (default daily)'),
        },
        annotationsFor('aimeat_agent_activity'),
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

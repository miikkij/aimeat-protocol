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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { setAgentCapabilities } from '../services/agent-profile-write.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
        zodShapeFor('aimeat_agent_capabilities_report'),
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
        zodShapeFor('aimeat_agent_activity'),
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

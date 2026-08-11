/**
 * @file agent-management.ts
 * @description Public MCP tools for owner-managed agent attributes (mode, tags).
 *   Mirrors the connector-side module at src/cli/connect/mcp/tools/agent-management.ts
 *   so Claude Desktop and other public MCP clients have parity with what
 *   aimeat-crewai liaisons see via the local connector.
 *
 *   These tools let the calling agent modify another same-owner agent's
 *   classification metadata (mode, tags). The caller must be authenticated
 *   as an agent; same-owner ownership is enforced before any mutation.
 * @structure
 *   - registerAgentManagementTools() -- registers aimeat_agent_mode_set and aimeat_agent_tags_set
 * @usage
 *   import { registerAgentManagementTools } from './agent-management.js';
 *   registerAgentManagementTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial creation. Closes public/connector parity drift
 *     for mode_set + tags_set (connector-only since 1.12.1).
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-06-24 -- Tag pattern allows ':' (faceted prefix:value tags compose with
 *     aimeat_discover's tags filter); '@' stays excluded.
 *   v1.3.0 -- 2026-08-11 -- Both writes go through services/agent-profile-write.ts, shared with
 *     PATCH /v1/agents/:name/tags and PATCH /v1/agents/:name/mode. The mode copy here never
 *     re-derived the Hello Integration step list, so a crew self-setting task-runner through this
 *     tool, which is the caller the HTTP handler's comment names, kept the full flow and read
 *     7/16 where 7/7 was the truth.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { setAgentTags, setAgentMode } from '../services/agent-profile-write.js';
import { VALID_MODES } from '../routes/agents/constants.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerAgentManagementTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool: aimeat_agent_tags_set ──
    // Replaces the owner-managed tag list on a same-owner agent. Convention:
    // 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'. Any
    // lowercase alphanumeric-plus-`._-` string is accepted, max 20 tags.
    mcp.tool(
        'aimeat_agent_tags_set',
        descriptionFor('aimeat_agent_tags_set'),
        {
            target_agent_name: z.string().describe('Agent whose tags to update (must be owned by the same owner as the calling agent).'),
            tags: z.array(z.string()).describe('Replacement tag list. Empty array clears all tags.'),
        },
        annotationsFor('aimeat_agent_tags_set'),
        async ({ target_agent_name, tags }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentTags({ storage, config }, callerParsed.owner, target_agent_name, tags);
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: outcome.agent.gaii,
                        name: outcome.agent.name,
                        tags: outcome.agent.tags ?? [],
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: aimeat_agent_mode_set ──
    // Owner sets a same-owner agent's operational mode. The mode affects the
    // Hello Integration step set: task-runner gets a reduced 7-step flow,
    // workstation the narrowest 4-step flow; others get the full 13 steps.
    mcp.tool(
        'aimeat_agent_mode_set',
        descriptionFor('aimeat_agent_mode_set'),
        {
            target_agent_name: z.string().describe('Agent whose mode to update (must be owned by the same owner as the calling agent).'),
            mode: z.enum(VALID_MODES).describe('New mode.'),
        },
        annotationsFor('aimeat_agent_mode_set'),
        async ({ target_agent_name, mode }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentMode({ storage, config }, callerParsed.owner, target_agent_name, mode);
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: outcome.agent.gaii,
                        name: outcome.agent.name,
                        mode: outcome.agent.mode ?? 'interactive',
                    }, null, 2),
                }],
            };
        },
    );
}

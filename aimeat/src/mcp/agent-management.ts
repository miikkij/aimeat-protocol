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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII, buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

const VALID_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'] as const;
// Colons are allowed so faceted tags (source:crewai, role:researcher) validate and compose
// with aimeat_discover's `tags` CSV filter; '@' stays excluded to keep tags distinct from GAII.
const TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const MAX_TAGS = 20;

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
            const targetGaii = buildGAII(target_agent_name, callerParsed.owner, config.nodeId);
            const targetAgent = await storage.getAgent(targetGaii);
            if (!targetAgent) {
                return {
                    content: [{ type: 'text' as const, text: `Target agent '${target_agent_name}' not found under owner '${callerParsed.owner}'.` }],
                    isError: true,
                };
            }
            if (targetAgent.owner !== callerParsed.owner) {
                return {
                    content: [{ type: 'text' as const, text: 'You can only update tags for agents owned by the same owner.' }],
                    isError: true,
                };
            }

            const normalised: string[] = [];
            for (const raw of tags) {
                if (typeof raw !== 'string') {
                    return { content: [{ type: 'text' as const, text: 'tags must be an array of strings' }], isError: true };
                }
                const tag = raw.trim().toLowerCase();
                if (!tag) continue;
                if (!TAG_PATTERN.test(tag)) {
                    return { content: [{ type: 'text' as const, text: `Invalid tag: ${raw}` }], isError: true };
                }
                if (!normalised.includes(tag)) normalised.push(tag);
            }
            if (normalised.length > MAX_TAGS) {
                return { content: [{ type: 'text' as const, text: `An agent can have at most ${MAX_TAGS} tags` }], isError: true };
            }

            const updated = await storage.updateAgent(targetGaii, { tags: normalised });
            if (!updated) {
                return { content: [{ type: 'text' as const, text: `Agent not found: ${target_agent_name}` }], isError: true };
            }
            emitChange('agents');
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: updated.gaii,
                        name: updated.name,
                        tags: updated.tags ?? [],
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
            const targetGaii = buildGAII(target_agent_name, callerParsed.owner, config.nodeId);
            const targetAgent = await storage.getAgent(targetGaii);
            if (!targetAgent) {
                return {
                    content: [{ type: 'text' as const, text: `Target agent '${target_agent_name}' not found under owner '${callerParsed.owner}'.` }],
                    isError: true,
                };
            }
            if (targetAgent.owner !== callerParsed.owner) {
                return {
                    content: [{ type: 'text' as const, text: 'You can only update the mode of agents owned by the same owner.' }],
                    isError: true,
                };
            }

            const updated = await storage.updateAgent(targetGaii, { mode });
            if (!updated) {
                return { content: [{ type: 'text' as const, text: `Agent not found: ${target_agent_name}` }], isError: true };
            }
            emitChange('agents');
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: updated.gaii,
                        name: updated.name,
                        mode: updated.mode ?? 'interactive',
                    }, null, 2),
                }],
            };
        },
    );
}

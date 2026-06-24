/**
 * @file agent-management.ts
 * @description MCP tools for agent classification attributes (tags, mode).
 *   These call the same REST endpoints the UI uses:
 *   - PATCH /tags is same-owner gated -- an agent may set tags on itself or a
 *     same-owner sibling (parity with agent-caps self-report). The crew scaffold
 *     self-tags on every start via this path.
 *   - PATCH /mode requires an owner role; an agent session gets a 403.
 *
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial creation: tags_set + mode_set
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-06-24 -- tags_set is now agent-callable on its own/same-owner record
 *     (REST PATCH /tags relaxed from owner-role to same-owner). mode_set stays owner-only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAgentManagementTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool(
    'aimeat_agent_tags_set',
    descriptionFor('aimeat_agent_tags_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose tags to update (same owner as the calling agent; pass the caller\'s own name to self-tag).'),
      tags: z.array(z.string()).describe('Replacement tag list. Empty array clears all tags.'),
    },
    async ({ agent_name, target_agent_name, tags }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/tags`, { tags });
      return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    },
  );

  mcp.tool(
    'aimeat_agent_mode_set',
    descriptionFor('aimeat_agent_mode_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose mode to update (must be owned by the calling owner).'),
      mode: z.enum(['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation']).describe('New mode.'),
    },
    async ({ agent_name, target_agent_name, mode }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/mode`, { mode });
      return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    },
  );
}

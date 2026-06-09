/**
 * @file agent-management.ts
 * @description MCP tools for owner-managed agent attributes (tags, mode).
 *   Distinct from agent-caps.ts which is for the agent reporting its OWN
 *   capabilities -- these tools let the owner set classification metadata
 *   ON the agent.
 *
 *   These tools call the same REST endpoints the UI uses (PATCH /tags,
 *   PATCH /mode) which require an owner role; agent sessions will get a
 *   403 from the server.
 *
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial creation: tags_set + mode_set
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
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
      target_agent_name: z.string().describe('Agent whose tags to update (must be owned by the calling owner).'),
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

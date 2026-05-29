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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';

export function registerAgentManagementTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool(
    'aimeat_agent_tags_set',
    "Set (replace) the owner-managed tag list on one of your agents. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>' -- but any lowercase alphanumeric-plus-`._-` string is accepted. Max 20 tags.",
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
    "Set the operational mode on one of your agents. Modes: 'autonomous' (runs continuously, full Hello Integration), 'interactive' (user-facing, full Hello Integration), 'task-runner' (triggered/ephemeral, reduced 5-step Hello Integration -- no commands, messages, or test task), 'coordinator' (orchestrates others, full Hello Integration).",
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose mode to update (must be owned by the calling owner).'),
      mode: z.enum(['autonomous', 'interactive', 'task-runner', 'coordinator']).describe('New mode.'),
    },
    async ({ agent_name, target_agent_name, mode }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/mode`, { mode });
      return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    },
  );
}

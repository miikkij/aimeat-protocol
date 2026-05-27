/**
 * @file agent-caps.ts
 * @description MCP tool registrations for reporting agent capabilities and
 *   viewing activity statistics.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerAgentCapsTools(mcp: McpServer, client: AimeatClient, agentName?: string): void {
  const enc = encodeURIComponent(agentName!);

  mcp.tool('aimeat_agent_capabilities_report', 'Report agent capabilities to the node', {
    technical: z.array(z.object({
      name: z.string(),
      type: z.string(),
    })).optional().describe('Technical capabilities'),
    domain: z.array(z.string()).optional().describe('Domain expertise areas'),
    languages: z.array(z.string()).optional().describe('Supported languages'),
  }, async ({ technical, domain, languages }) => {
    const body: Record<string, unknown> = {};
    if (technical) body.technical = technical;
    if (domain) body.domain = domain;
    if (languages) body.languages = languages;
    const resp = await client.put(`/v1/agents/${enc}/capabilities`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_agent_activity', 'View agent activity statistics', {}, async () => {
    const resp = await client.get(`/v1/agents/${enc}/activity`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}

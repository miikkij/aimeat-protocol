/**
 * @file agent-caps.ts
 * @description MCP tool registrations for reporting agent capabilities and
 *   viewing activity statistics.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerAgentCapsTools(mcp: McpServer, client: AimeatClient, agentName?: string): void {
  const enc = encodeURIComponent(agentName!);

  mcp.tool('aimeat_agent_capabilities_report', 'Report agent capabilities to the node', {
    technical: z.array(z.object({
      name: z.string(),
      type: z.enum(['mcp', 'skill', 'tool']).describe("Capability type: 'mcp' (an MCP server/tool), 'skill' (a built-in skill or module), or 'tool' (a generic tool the agent can call)."),
    })).optional().describe('Technical capabilities, each with a name and a type from the enum mcp|skill|tool.'),
    domain: z.array(z.string()).optional().describe('Domain expertise areas, free-form short labels.'),
    languages: z.array(z.string()).optional().describe('Supported language codes (BCP-47 short form), e.g. "en", "fi".'),
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

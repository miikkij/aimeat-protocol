/**
 * @file agent-caps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for reporting agent capabilities and
 *   viewing activity statistics.
 * @version-history
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-05-30 -- F10 drift reconciliation: agent_activity gains days/granularity query filters
 *     to match server MCP + REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAgentCapsTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_agent_capabilities_report', descriptionFor('aimeat_agent_capabilities_report'), {
    agent_name: agentNameSchema,
    technical: z.array(z.object({
      name: z.string(),
      type: z.enum(['mcp', 'skill', 'tool']).describe("Capability type: 'mcp' (an MCP server/tool), 'skill' (a built-in skill or module), or 'tool' (a generic tool the agent can call)."),
    })).optional().describe('Technical capabilities, each with a name and a type from the enum mcp|skill|tool.'),
    domain: z.array(z.string()).optional().describe('Domain expertise areas, free-form short labels.'),
    languages: z.array(z.string()).optional().describe('Supported language codes (BCP-47 short form), e.g. "en", "fi".'),
  }, annotationsFor('aimeat_agent_capabilities_report'), async ({ agent_name, technical, domain, languages }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = {};
    if (technical) body.technical = technical;
    if (domain) body.domain = domain;
    if (languages) body.languages = languages;
    const resp = await client.put(`/v1/agents/${enc}/capabilities`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_agent_activity', descriptionFor('aimeat_agent_activity'), {
    agent_name: agentNameSchema,
    days: z.number().optional().describe('Number of days of history to retrieve (default 30)'),
    granularity: z.enum(['daily', 'hourly']).optional().describe('Granularity of history records (default daily)'),
  }, annotationsFor('aimeat_agent_activity'), async ({ agent_name, days, granularity }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const params = new URLSearchParams();
    if (days !== undefined) params.set('days', String(days));
    if (granularity) params.set('granularity', granularity);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/agents/${enc}/activity${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}

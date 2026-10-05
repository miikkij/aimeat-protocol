/**
 * @file agent-caps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for reporting agent capabilities and
 *   viewing activity statistics.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-05-30 -- F10 drift reconciliation: agent_activity gains days/granularity query filters
 *     to match server MCP + REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAgentCapsTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_agent_capabilities_report', descriptionFor('aimeat_agent_capabilities_report'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_agent_capabilities_report') }, annotationsFor('aimeat_agent_capabilities_report'), async ({ agent_name, technical, domain, languages }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = {};
    if (technical) body.technical = technical;
    if (domain) body.domain = domain;
    if (languages) body.languages = languages;
    const resp = await client.put(`/v1/agents/${enc}/capabilities`, body);
    return envelopeResult(resp);
  });

}

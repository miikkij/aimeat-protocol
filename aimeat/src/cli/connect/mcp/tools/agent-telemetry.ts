/**
 * @file agent-telemetry.ts
 * @description MCP tool registrations for reporting agent telemetry through the connector.
 * @structure Registers `aimeat_agent_telemetry_report` against the name-scoped telemetry API.
 * @usage Called by `aimeat connect serve` via the MCP tool registry.
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Initial connector MCP telemetry tool
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAgentTelemetryTools(mcp: McpServer, registry: AgentRegistry): void {

    mcp.tool('aimeat_agent_telemetry_report', descriptionFor('aimeat_agent_telemetry_report'), {
        agent_name: agentNameSchema,
        type: z.enum(['llm_call', 'tool_call', 'agent_report']).default('agent_report')
            .describe('Telemetry event type'),
        data: z.record(z.string(), z.unknown()).optional()
            .describe('Telemetry data such as tokens_in, tokens_out, ai_calls, duration_seconds, or tool name'),
        session_id: z.string().optional().describe('Optional runtime session identifier'),
        task_id: z.string().optional().describe('Optional related AIMEAT task id'),
    }, annotationsFor('aimeat_agent_telemetry_report'), async ({ agent_name, type, data, session_id, task_id }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const body: Record<string, unknown> = {
            type,
            data: data ?? {},
        };
        if (session_id) body.session_id = session_id;
        if (task_id) body.task_id = task_id;

        const resp = await client.post(`/v1/agents/${enc}/telemetry`, body);
        return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    });
}

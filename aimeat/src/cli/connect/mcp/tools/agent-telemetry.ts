/**
 * @file agent-telemetry.ts
 * @description MCP tool registrations for reporting agent telemetry through the connector.
 * @structure Registers `aimeat_agent_telemetry_report` against the name-scoped telemetry API.
 * @usage Called by `aimeat connect serve` via the MCP tool registry.
 * @version-history v1.0.0 -- 2026-05-28 -- Initial connector MCP telemetry tool.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerAgentTelemetryTools(mcp: McpServer, client: AimeatClient, agentName: string): void {
    const encodedAgentName = encodeURIComponent(agentName);

    mcp.tool('aimeat_agent_telemetry_report', 'Report agent telemetry to the node', {
        type: z.enum(['llm_call', 'tool_call', 'agent_report']).default('agent_report')
            .describe('Telemetry event type'),
        data: z.record(z.string(), z.unknown()).optional()
            .describe('Telemetry data such as tokens_in, tokens_out, ai_calls, duration_seconds, or tool name'),
        session_id: z.string().optional().describe('Optional runtime session identifier'),
        task_id: z.string().optional().describe('Optional related AIMEAT task id'),
    }, async ({ type, data, session_id, task_id }) => {
        const body: Record<string, unknown> = {
            type,
            data: data ?? {},
        };
        if (session_id) body.session_id = session_id;
        if (task_id) body.task_id = task_id;

        const resp = await client.post(`/v1/agents/${encodedAgentName}/telemetry`, body);
        return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    });
}
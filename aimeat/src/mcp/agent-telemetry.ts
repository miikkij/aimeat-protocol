/**
 * @file agent-telemetry.ts
 * @description MCP tools for agent telemetry reporting on the public /v1/mcp surface.
 *   This mirrors the connector bridge telemetry tool so Hello Integration can be
 *   completed by remote MCP clients and local connector clients alike.
 * @structure
 *   - registerAgentTelemetryTools() -- registers telemetry append tool
 * @usage
 *   import { registerAgentTelemetryTools } from './agent-telemetry.js';
 *   registerAgentTelemetryTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add public MCP telemetry reporting tool
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { emitChange } from '../services/event-bus.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';

export function registerAgentTelemetryTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool('aimeat_agent_telemetry_report', 'Report agent telemetry to the node', {
        type: z.enum(['llm_call', 'tool_call', 'agent_report']).default('agent_report')
            .describe('Telemetry event type'),
        data: z.record(z.string(), z.unknown()).optional()
            .describe('Telemetry data such as tokens_in, tokens_out, ai_calls, duration_seconds, or tool name'),
        session_id: z.string().optional().describe('Optional runtime session identifier'),
        task_id: z.string().optional().describe('Optional related AIMEAT task id'),
    }, annotationsFor('aimeat_agent_telemetry_report'), async ({ type, data, session_id, task_id }) => {
        const agent = await storage.getAgent(agentGaii);
        if (!agent) {
            return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
        }

        const event: TelemetryEvent = {
            id: randomUUID(),
            agentGaii,
            type,
            data: data ?? {},
            sessionId: session_id,
            taskId: task_id,
            createdAt: new Date().toISOString(),
        };

        await storage.appendTelemetry(event);
        emitChange('agents');

        return { content: [{ type: 'text' as const, text: JSON.stringify({ id: event.id }, null, 2) }] };
    });
}

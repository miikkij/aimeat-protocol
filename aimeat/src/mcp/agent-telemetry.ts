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
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-06-21 -- Route through the in-memory telemetry buffer (no per-call DB
 *                            write); also feed activity counters like the REST path.
 *   v1.4.0 -- 2026-07-11 -- LEDGER (TARGET-016): an llm_call carrying a model also records a
 *                            priced, append-only usage event via services/usage-metering.js.
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { pushTelemetry, recordTelemetryActivity } from '../services/telemetry-buffer.js';
import { recordUsageEvent, extractUsageFields } from '../services/usage-metering.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerAgentTelemetryTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool('aimeat_agent_telemetry_report', descriptionFor('aimeat_agent_telemetry_report'), {
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

        // Buffered in-memory + batched flush (see telemetry-buffer.ts). Unlike the prior
        // append-only path this also feeds the activity counters, so MCP-reported telemetry
        // now shows up in the Activity tab consistently with the REST path.
        pushTelemetry(event);
        recordTelemetryActivity(agentGaii, { type, data: data ?? {} });

        // LEDGER (TARGET-016): an llm_call carrying a model becomes a priced, append-only
        // usage event. Backward compatible; a ledger failure never fails the report.
        if (type === 'llm_call') {
            const fields = extractUsageFields(data ?? {});
            if (fields) {
                try {
                    await recordUsageEvent(storage, {
                        ...fields,
                        agentGaii,
                        ownerGhii: `${agent.owner}@${config.nodeId}`,
                        runId: fields.runId ?? task_id,
                        source: 'telemetry',
                    });
                } catch (err) {
                    logger.warn('ledger: usage event write failed (telemetry accepted)', {
                        agentGaii, error: String(err),
                    });
                }
            }
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify({ id: event.id }, null, 2) }] };
    });
}

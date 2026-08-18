/**
 * @file agent-telemetry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for agent telemetry reporting on the public /v1/mcp surface.
 *   This mirrors the connector bridge telemetry tool so Hello Integration can be
 *   completed by remote MCP clients and local connector clients alike.
 * @structure
 *   - registerAgentTelemetryTools() -- the telemetry append tool + the usage report read
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
 *   v1.5.0 -- 2026-08-14 -- Add aimeat_usage_report, the READ side of the same subject: what the
 *                            owner behind this session actually used and what it cost, off the
 *                            precomputed serving layer. Reporting is where a person asks a question,
 *                            so it belongs on the chat path rather than behind a dashboard only.
 *                            Design: docs/internal/telemetria/02-design.md
 *   v1.4.0 -- 2026-07-11 -- LEDGER (TARGET-016): an llm_call carrying a model also records a
 *                            priced, append-only usage event via services/usage-metering.js.
 */

import { randomUUID } from 'node:crypto';
import { recordTelemetryUsage } from '../services/usage-metering.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { pushTelemetry, recordTelemetryActivity } from '../services/telemetry-buffer.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { readUsageReport, OWNER_REPORTS, UnknownReportError } from '../services/usage/usage-read.js';
import { ownerGhiiOf } from '../utils/gaii.js';

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

        // LEDGER (TARGET-016): an llm_call carrying a model becomes a priced, append-only usage
        // event. services/usage-metering.ts decides that, because the ledger is what an owner is
        // billed from and two copies of "does this count" is two answers to what something cost.
        await recordTelemetryUsage(storage,
            { agentGaii, ownerGhii: `${agent.owner}@${config.nodeId}`, taskId: task_id },
            type, data ?? {});

        return { content: [{ type: 'text' as const, text: JSON.stringify({ id: event.id }, null, 2) }] };
    });

    // ── aimeat_usage_report ──
    // The read side. It calls the SAME service GET /v1/usage/summary calls, so the owner scoping,
    // the report resolution and the freshness stamp happen once, where they were written. A tool
    // that queried storage itself would be a second implementation of the scoping rule, which is
    // exactly the shape that made one defect in aimeat_memory_write need fixing three times.
    mcp.tool('aimeat_usage_report', descriptionFor('aimeat_usage_report'), {
        report: z.enum(Object.keys(OWNER_REPORTS) as [string, ...string[]]).default('day')
            .describe('Which report to read'),
        from: z.string().optional().describe('Inclusive start day, YYYY-MM-DD (default: 30 days ago)'),
        to: z.string().optional().describe('Inclusive end day, YYYY-MM-DD (default: today)'),
        grain: z.enum(['day', 'hour']).optional().describe('Bucket size, where the report has one'),
        limit: z.number().optional().describe('Maximum groups to return'),
    }, annotationsFor('aimeat_usage_report'), async ({ report, from, to, grain, limit }) => {
        // The human behind this session, whichever principal is speaking. An agent asking about
        // usage is asking about its owner's account, which is the only account it has.
        const ownerGhii = ownerGhiiOf(agentGaii);
        try {
            const data = await readUsageReport(storage, {
                report, scope: 'owner', ownerGhii, from, to, grain, limit, series: true,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        } catch (err) {
            if (err instanceof UnknownReportError) {
                return { content: [{ type: 'text' as const, text: err.message }], isError: true };
            }
            throw err;
        }
    });
}

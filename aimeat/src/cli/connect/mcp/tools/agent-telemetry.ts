/**
 * @file agent-telemetry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for reporting agent telemetry through the connector.
 * @structure Registers `aimeat_agent_telemetry_report` (write) and `aimeat_usage_report` (read)
 *   against the node's own routes, so the connector surface answers the same questions the public
 *   MCP surface does.
 * @usage Called by `aimeat connect serve` via the MCP tool registry.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-28 -- Initial connector MCP telemetry tool
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-08-14 -- Add aimeat_usage_report, mirroring the public surface's read tool by
 *     calling GET /v1/usage/summary. No agent_name: the report is about the OWNER's account, which
 *     every agent of theirs shares, so scoping it per agent would answer a question nobody asked.
 *     Design: docs/internal/telemetria/02-design.md
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAgentTelemetryTools(mcp: McpServer, registry: AgentRegistry): void {

    mcp.tool('aimeat_agent_telemetry_report', descriptionFor('aimeat_agent_telemetry_report'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_agent_telemetry_report') }, annotationsFor('aimeat_agent_telemetry_report'), async ({ agent_name, type, data, session_id, task_id }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const body: Record<string, unknown> = {
            type,
            data: data ?? {},
        };
        if (session_id) body.session_id = session_id;
        if (task_id) body.task_id = task_id;

        const resp = await client.post(`/v1/agents/${enc}/telemetry`, body);
        return envelopeResult(resp);
    });

    mcp.tool('aimeat_usage_report', descriptionFor('aimeat_usage_report'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_usage_report') }, annotationsFor('aimeat_usage_report'), async ({ agent_name, report, from, to, grain, limit }) => {
        const { client } = pickAgent(registry, agent_name);
        const q = new URLSearchParams({ report });
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        if (grain) q.set('grain', grain);
        if (limit) q.set('limit', String(limit));
        const resp = await client.get(`/v1/usage/summary?${q.toString()}`);
        return envelopeResult(resp);
    });
}

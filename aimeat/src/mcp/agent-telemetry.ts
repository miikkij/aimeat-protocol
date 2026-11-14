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
 *   registerAgentTelemetryTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, caller);
 * @version-history
 *   2026-11-13 — aimeat_agent_telemetry_report calls services/agent/telemetry-append.ts, the gate, the
 *     agent read and the append POST /v1/agents/:name/telemetry runs (structure programme 2026-11, unit 2b).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
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

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { telemetryTarget, appendAgentTelemetry } from '../services/agent/telemetry-append.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { readUsageReport, UnknownReportError } from '../services/usage/usage-read.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export function registerAgentTelemetryTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's caller (services/caller-context.ts): the agent itself, for the telemetry gate. */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    mcp.registerTool('aimeat_agent_telemetry_report', { description: descriptionFor('aimeat_agent_telemetry_report'), inputSchema: zodShapeFor('aimeat_agent_telemetry_report'), annotations: annotationsFor('aimeat_agent_telemetry_report') }, async ({ type, data, session_id, task_id }) => {
        // The gate, the agent read and the append are services/agent/telemetry-append.ts, which
        // POST /v1/agents/:name/telemetry calls too. The session is the agent itself.
        const target = await telemetryTarget({ storage, config }, caller().auth, agentGaii);
        if (!target.ok) {
            return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
        }
        const id = await appendAgentTelemetry({ storage, config }, target.agent, { type, data, session_id, task_id });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ id }, null, 2) }] };
    });

    // ── aimeat_usage_report ──
    // The read side. It calls the SAME service GET /v1/usage/summary calls, so the owner scoping,
    // the report resolution and the freshness stamp happen once, where they were written. A tool
    // that queried storage itself would be a second implementation of the scoping rule, which is
    // exactly the shape that made one defect in aimeat_memory_write need fixing three times.
    mcp.registerTool('aimeat_usage_report', { description: descriptionFor('aimeat_usage_report'), inputSchema: zodShapeFor('aimeat_usage_report'), annotations: annotationsFor('aimeat_usage_report') }, async ({ report, from, to, grain, limit }) => {
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

/**
 * @file src/services/agent/telemetry-append.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Appending one telemetry event for an agent: who may append it, the agent read, the
 *   event, the buffered write, the activity counters and the usage ledger. POST
 *   /v1/agents/:name/telemetry and aimeat_agent_telemetry_report both call it, so the two surfaces
 *   ask the same gate around the same read (structure programme 2026-11, unit 2b).
 *
 *   WHO. The agent itself, or its owner in person (mayActOnAgent, utils/gaii.ts; QA audit
 *   2026-10-14, K1). An MCP session is the agent itself, so the tool always passes the gate.
 * @structure telemetryTarget(deps, auth, agentGaii) → { agent } | refusal ·
 *   appendAgentTelemetry(deps, agent, input) → event id
 * @usage
 *   const target = await telemetryTarget({ storage, config }, req.auth, agentGaii);   // a tool: caller().auth
 *   if (!target.ok) refuse(target.code);
 *   const id = await appendAgentTelemetry({ storage, config }, target.agent, { type, data });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agent-telemetry.ts and mcp/agent-telemetry.ts, which each
 *     held a copy (structure programme 2026-11, unit 2b).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, TelemetryEvent, AgentRecord } from '../../storage/interface.js';
import { mayActOnAgent } from '../../utils/gaii.js';
import { pushTelemetry, recordTelemetryActivity } from '../telemetry-buffer.js';
import { recordTelemetryUsage } from '../usage-metering.js';

export interface TelemetryInput {
    type: TelemetryEvent['type'];
    data?: Record<string, unknown>;
    session_id?: string;
    task_id?: string;
}

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> };

/**
 * The agent a telemetry event may be appended for, or the refusal: the caller may act on it, then it
 * exists. The route checks the body between this and the append, so a refusal still comes first.
 */
export async function telemetryTarget(
    deps: Deps, auth: Parameters<typeof mayActOnAgent>[0], agentGaii: string,
): Promise<{ ok: true; agent: AgentRecord } | { ok: false; code: 'NOT_YOURS' | 'NOT_FOUND' }> {
    if (!mayActOnAgent(auth, agentGaii, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    const agent = await deps.storage.getAgent(agentGaii);
    return agent ? { ok: true, agent } : { ok: false, code: 'NOT_FOUND' };
}

/** Append one event for an agent telemetryTarget returned. Answers the event's id. */
export async function appendAgentTelemetry(deps: Deps, agent: Pick<AgentRecord, 'gaii' | 'owner'>, input: TelemetryInput): Promise<string> {
    const agentGaii = agent.gaii;
    const data = input.data ?? {};
    const event: TelemetryEvent = {
        id: randomUUID(),
        agentGaii,
        type: input.type,
        data,
        sessionId: input.session_id,
        taskId: input.task_id,
        createdAt: new Date().toISOString(),
    };
    // Buffered in memory: the raw event lands in a bounded per-agent ring and the derived activity
    // counters accumulate; both are flushed to storage on an interval (telemetry-buffer.ts).
    pushTelemetry(event);
    recordTelemetryActivity(agentGaii, { type: input.type, data });
    // LEDGER (TARGET-016): an llm_call carrying a model becomes a priced, append-only usage event
    // (services/usage-metering.ts decides which).
    await recordTelemetryUsage(deps.storage,
        { agentGaii, ownerGhii: `${agent.owner}@${deps.config.nodeId}`, taskId: input.task_id },
        input.type, data);
    return event.id;
}

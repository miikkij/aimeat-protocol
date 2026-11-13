/**
 * @file src/services/agent/activity-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading one agent's activity: who may read it, the agent record (whose activityStats
 *   both answers carry) and the time-series history. GET /v1/agents/:name/activity and
 *   aimeat_agent_activity both call it, so the gate and the reads are written once (structure
 *   programme 2026-11, unit 2b). Each surface still reads its own `days` from its own input: the route
 *   clamps it to 1..365 and the tool passes it as given, a difference the programme lists for the
 *   developer to decide.
 *
 *   WHO. The agent itself, or its owner in person (mayActOnAgent, utils/gaii.ts; QA audit 2026-10-14,
 *   K1). An MCP session is the agent itself, so the tool always passes the gate.
 * @structure agentActivityFor(deps, auth, agentGaii, window) → { agent, history } | refusal
 * @usage
 *   const read = await agentActivityFor({ storage, config }, req.auth, agentGaii, { days, granularity });
 *   if (!read.ok) refuse(read.code);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agent-activity.ts and mcp/agent-capabilities.ts, which each
 *     held the reads (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { mayActOnAgent } from '../../utils/gaii.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> };
type History = Awaited<ReturnType<Storage['getActivityHistory']>>;

/** The agent and its activity history, as the caller may read them: the gate first, then the agent. */
export async function agentActivityFor(
    deps: Deps,
    auth: Parameters<typeof mayActOnAgent>[0],
    agentGaii: string,
    window: { days: number; granularity: 'daily' | 'hourly' },
): Promise<{ ok: true; agent: AgentRecord; history: History } | { ok: false; code: 'NOT_YOURS' | 'NOT_FOUND' }> {
    if (!mayActOnAgent(auth, agentGaii, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    const agent = await deps.storage.getAgent(agentGaii);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };
    const history = await deps.storage.getActivityHistory(agentGaii, window);
    return { ok: true, agent, history };
}

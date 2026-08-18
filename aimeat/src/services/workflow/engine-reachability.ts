/**
 * @file src/services/workflow/engine-reachability.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-reachability helpers for the workflow engine's agent-offline fast-fail —
 *   isAgentReachable / isAgentStep / anyAgentReachable + the reachability constants. Extracted from
 *   engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { buildGAII } from '../../utils/gaii.js';
import type { WorkflowStep } from '../../models/workflow-schemas.js';

// ── agent reachability (agent-offline fast-fail) ──────────────────────────────────
/** lastSeen within this window ⇒ the agent is "online now" (a live polling daemon heartbeats ~1/min). */
const AGENT_ONLINE_WINDOW_MS = 10 * 60_000;
/** Consecutive webhook delivery failures ⇒ webhook_down (matches the stall detector). */
const AGENT_WEBHOOK_DOWN_THRESHOLD = 10;
/** How long after dispatch to wait before failing a no-progress step whose agent is unreachable. */
export const AGENT_OFFLINE_GRACE_MS = 5 * 60_000;

/**
 * Is an agent reachable RIGHT NOW to pick up a dispatched task? True when it has a healthy push
 * webhook, OR its lastSeen heartbeat is fresh (an active polling serve-daemon). A null agent (never
 * registered / deleted) is unreachable. Pure — `nowMs` injected for testability.
 */
export function isAgentReachable(agent: AgentRecord | null | undefined, nowMs: number): boolean {
  if (!agent) return false;
  const webhookOk = !!(agent.webhookEnabled && agent.webhookUrl) && (agent.webhookFailCount ?? 0) < AGENT_WEBHOOK_DOWN_THRESHOLD;
  if (webhookOk) return true;
  const lastSeenMs = new Date(agent.lastSeen).getTime();
  return Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) < AGENT_ONLINE_WINDOW_MS;
}

/** A default agent-dispatch step (has an agent), not an ecosystem export-out/trigger-geai step. */
export function isAgentStep(step: WorkflowStep): boolean {
  return !step.action || step.action.kind === 'agent';
}

/** True if ANY of a step's target agents is reachable now (so the task can be picked up). */
export async function anyAgentReachable(storage: Storage, config: AimeatConfig, ownerName: string, step: WorkflowStep): Promise<boolean> {
  const agents = Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : []);
  if (agents.length === 0) return true; // nothing to check (e.g. ecosystem step) ⇒ don't offline-fail
  const now = Date.now();
  for (const name of agents) {
    const agent = await storage.getAgent(buildGAII(name, ownerName, config.nodeId));
    if (isAgentReachable(agent, now)) return true;
  }
  return false;
}

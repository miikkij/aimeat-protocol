/**
 * @file src/services/workflow/engine-reachability.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-reachability helpers for the workflow engine's agent-offline fast-fail —
 *   isAgentReachable / isAgentStep / anyAgentReachable + the reachability constants. Extracted from
 *   engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-09-06 — A live connector socket is a third door into reachability, and it is the
 *     one a SPAWN agent answers on. lastSeen dates an agent's last WORK, not whether a wake would
 *     arrive, and a spawn agent has no runtime between jobs by design — so the check that decided
 *     "agent-offline" was reading a field that cannot be fresh for the agents it was judging.
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { buildGAII } from '../../utils/gaii.js';
import { getActiveConnectTunnelManager } from '../connect-tunnel.js';
import type { WorkflowStep } from '../../models/workflow-schemas.js';

// ── agent reachability (agent-offline fast-fail) ──────────────────────────────────
/** lastSeen within this window ⇒ the agent is "online now" (a live polling daemon heartbeats ~1/min). */
const AGENT_ONLINE_WINDOW_MS = 10 * 60_000;
/** Consecutive webhook delivery failures ⇒ webhook_down (matches the stall detector). */
const AGENT_WEBHOOK_DOWN_THRESHOLD = 10;
/** How long after dispatch to wait before failing a no-progress step whose agent is unreachable. */
export const AGENT_OFFLINE_GRACE_MS = 5 * 60_000;

/**
 * Is an agent reachable RIGHT NOW to pick up a dispatched task? Three doors, and any one of them
 * carries the wake: a healthy push webhook, a live connector socket held for this agent, or a fresh
 * lastSeen heartbeat (an active polling serve-daemon). A null agent (never registered / deleted) is
 * unreachable. Pure — `nowMs` and `connected` injected for testability.
 *
 * The socket is what makes a SPAWN agent answerable. lastSeen is written when the agent's OWN
 * credential touches the node, so for an agent whose runtime exists only while a worker runs it
 * dates the last work rather than saying whether a wake would arrive; ageing out of the window is
 * what that agent is supposed to do between jobs. Measured on aimeat.io 2026-09-06: of 23 spawn
 * agents every one had a live socket, and 9 of them were stale by hours or days at the same moment.
 * The (L)AIMEAT Sanomat workflow fell into exactly that gap at 00:40 — its writers had just
 * finished, features and editorial had not started — and mailed the owner a failed run for an
 * edition that came out complete, on two consecutive nights.
 *
 * A spawn agent whose connector is down still has no socket and no fresh lastSeen, and that verdict
 * stays: nobody is holding its wake channel, so the task would go nowhere. Reported by crewaimeat.
 */
export function isAgentReachable(agent: AgentRecord | null | undefined, nowMs: number, connected = false): boolean {
  if (!agent) return false;
  const webhookOk = !!(agent.webhookEnabled && agent.webhookUrl) && (agent.webhookFailCount ?? 0) < AGENT_WEBHOOK_DOWN_THRESHOLD;
  if (webhookOk) return true;
  if (connected) return true;
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
  // Null on a node that runs without the connector tunnel, and then the other two doors decide
  // exactly as they did before.
  const tunnels = getActiveConnectTunnelManager();
  for (const name of agents) {
    const gaii = buildGAII(name, ownerName, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (isAgentReachable(agent, now, !!tunnels?.isConnected(gaii))) return true;
  }
  return false;
}

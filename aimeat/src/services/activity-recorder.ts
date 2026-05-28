/**
 * @file activity-recorder.ts
 * @description Records agent activity to the agent_activity table and updates
 *   AgentRecord.activityStats counters on task lifecycle and telemetry events.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial activity recorder
 *   v1.1.0 -- 2026-05-28 -- Add recordTelemetryEvent: bump a daily telemetry_events
 *                            counter on every event, and roll llm_call token data
 *                            into tokensUsed30d/aiCalls30d so the Activity tab is no
 *                            longer always zero when telemetry IS being reported.
 */
import type { Storage, AgentActivityStats } from '../storage/interface.js';

export async function recordTaskStarted(storage: Storage, agentGaii: string): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();
  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_started', value: 1 });
}

export async function recordTaskCompleted(
  storage: Storage, agentGaii: string,
  telemetry?: { tokensIn?: number; tokensOut?: number; aiCalls?: number }
): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();

  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_completed', value: 1 });

  if (telemetry?.tokensIn || telemetry?.tokensOut) {
    const totalTokens = (telemetry.tokensIn ?? 0) + (telemetry.tokensOut ?? 0);
    await storage.recordActivity({ agentGaii, date, hour, metric: 'tokens_used', value: totalTokens });
  }
  if (telemetry?.aiCalls) {
    await storage.recordActivity({ agentGaii, date, hour, metric: 'ai_calls', value: telemetry.aiCalls });
  }

  // Update embedded activityStats on AgentRecord
  await updateAgentStats(storage, agentGaii, 'completed', telemetry);
}

export async function recordTaskFailed(storage: Storage, agentGaii: string): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();
  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_failed', value: 1 });
  await updateAgentStats(storage, agentGaii, 'failed');
}

/**
 * Record a telemetry event for the daily activity counters. Always bumps
 * 'telemetry_events'. For llm_call events with token data, also accumulates
 * 'tokens_used' and 'ai_calls' into both the daily metric series and the
 * agent's embedded activityStats so the Activity tab updates.
 *
 * Tolerant about field names: agents in the wild send either
 * { tokens_in, tokens_out } or { tokens_used } or both.
 */
export async function recordTelemetryEvent(
  storage: Storage,
  agentGaii: string,
  event: { type: string; data: Record<string, unknown> },
): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();

  await storage.recordActivity({ agentGaii, date, hour, metric: 'telemetry_events', value: 1 });

  if (event.type !== 'llm_call') return;

  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
  const tokensIn = num(event.data.tokens_in);
  const tokensOut = num(event.data.tokens_out);
  const tokensUsedExplicit = num(event.data.tokens_used);
  const totalTokens = tokensUsedExplicit > 0 ? tokensUsedExplicit : tokensIn + tokensOut;

  if (totalTokens > 0) {
    await storage.recordActivity({ agentGaii, date, hour, metric: 'tokens_used', value: totalTokens });
  }
  await storage.recordActivity({ agentGaii, date, hour, metric: 'ai_calls', value: 1 });

  // Mirror into embedded activityStats so the dashboard's stat cards update.
  const agent = await storage.getAgent(agentGaii);
  if (!agent) return;
  const existing = agent.activityStats;
  const stats: AgentActivityStats = {
    tasksCompleted: existing?.tasksCompleted ?? 0,
    tasksFailed: existing?.tasksFailed ?? 0,
    tokensUsed30d: (existing?.tokensUsed30d ?? 0) + totalTokens,
    aiCalls30d: (existing?.aiCalls30d ?? 0) + 1,
    successRate: existing?.successRate ?? 0,
    lastTaskAt: existing?.lastTaskAt,
    extensionsCreated: existing?.extensionsCreated ?? 0,
    appsPublished: existing?.appsPublished ?? 0,
  };
  await storage.updateAgent(agentGaii, { activityStats: stats });
}

async function updateAgentStats(
  storage: Storage, agentGaii: string, outcome: 'completed' | 'failed',
  telemetry?: { tokensIn?: number; tokensOut?: number; aiCalls?: number }
): Promise<void> {
  const agent = await storage.getAgent(agentGaii);
  if (!agent) return;
  const existing = agent.activityStats;
  const stats: AgentActivityStats = {
    tasksCompleted: existing?.tasksCompleted ?? 0,
    tasksFailed: existing?.tasksFailed ?? 0,
    tokensUsed30d: existing?.tokensUsed30d ?? 0,
    aiCalls30d: existing?.aiCalls30d ?? 0,
    successRate: existing?.successRate ?? 0,
    lastTaskAt: existing?.lastTaskAt,
    extensionsCreated: existing?.extensionsCreated ?? 0,
    appsPublished: existing?.appsPublished ?? 0,
  };

  if (outcome === 'completed') {
    stats.tasksCompleted++;
    stats.lastTaskAt = new Date().toISOString();
  } else {
    stats.tasksFailed++;
  }

  const total = stats.tasksCompleted + stats.tasksFailed;
  stats.successRate = total > 0 ? Math.round((stats.tasksCompleted / total) * 100) : 0;

  if (telemetry) {
    stats.tokensUsed30d += (telemetry.tokensIn ?? 0) + (telemetry.tokensOut ?? 0);
    stats.aiCalls30d += telemetry.aiCalls ?? 0;
  }

  await storage.updateAgent(agentGaii, { activityStats: stats });
}

/**
 * @file activity-recorder.ts
 * @description Records agent activity to the agent_activity table and updates
 *   AgentRecord.activityStats counters on task lifecycle events.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial activity recorder
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

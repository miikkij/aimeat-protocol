/**
 * @file readiness-scorer.ts
 * @description Composite readiness score: onboarding baseline * operational health.
 *   Baseline is set once when onboarding completes (9 pts per required step, 10 bonus for services).
 *   Health is a 7-day rolling average of delivery, telemetry, and task completion signals.
 * @structure
 *   - calculateBaseline(steps) -- onboarding score (0-100)
 *   - calculateHealth(agentGaii, storage) -- 7-day operational health (0.0-1.0)
 *   - calculateReadiness(agentGaii, steps, storage, override?) -- effective score + level (with optional owner override)
 *   - getReadinessLevel(score) -- score to level mapping
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 *   v1.1.0 -- 2026-05-24 -- Add readiness override support
 */

import type { Storage, AgentOnboardingStep, AgentOnboardingRecord } from '../storage/interface.js';

export interface ReadinessResult {
  effectiveScore: number;
  level: 'basic' | 'standard' | 'full' | 'expert';
  baseline: number;
  health: number;
  healthComponents: {
    deliveryHealth: number;
    telemetryContinuity: number;
    taskCompletion: number;
  };
}

export function calculateBaseline(steps: AgentOnboardingStep[]): number {
  let score = 0;
  for (const step of steps) {
    if (step.status !== 'passed') continue;
    if (step.required) {
      score += 9;
    } else {
      score += 10;
    }
  }
  return Math.min(score, 100);
}

export function getReadinessLevel(score: number): 'basic' | 'standard' | 'full' | 'expert' {
  if (score >= 91) return 'expert';
  if (score >= 61) return 'full';
  if (score >= 31) return 'standard';
  return 'basic';
}

export async function calculateHealth(
  agentGaii: string,
  storage: Storage,
): Promise<{ health: number; components: ReadinessResult['healthComponents'] }> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceStr = sevenDaysAgo.toISOString();

  const deliveryHealth = await calculateDeliveryHealth(agentGaii, storage, sinceStr);
  const telemetryContinuity = await calculateTelemetryContinuity(agentGaii, storage, sinceStr);
  const taskCompletion = await calculateTaskCompletion(agentGaii, storage);

  const health = deliveryHealth * 0.4 + telemetryContinuity * 0.3 + taskCompletion * 0.3;

  return {
    health,
    components: { deliveryHealth, telemetryContinuity, taskCompletion },
  };
}

async function calculateDeliveryHealth(agentGaii: string, storage: Storage, since: string): Promise<number> {
  const logs = await storage.listDeliveryLog(agentGaii, 200);
  const recentLogs = logs.filter(l => l.createdAt >= since);

  if (recentLogs.length === 0) return 1.0;

  const successCount = recentLogs.filter(l => l.status === 'success').length;
  return successCount / recentLogs.length;
}

async function calculateTelemetryContinuity(agentGaii: string, storage: Storage, since: string): Promise<number> {
  const events = await storage.listTelemetry(agentGaii, { since, limit: 1000 });

  if (events.length === 0) return 1.0;

  const daysWithEvents = new Set<string>();
  for (const event of events) {
    const day = event.createdAt.substring(0, 10);
    daysWithEvents.add(day);
  }

  return Math.min(daysWithEvents.size / 7, 1.0);
}

async function calculateTaskCompletion(agentGaii: string, storage: Storage): Promise<number> {
  const counts = await storage.countTasksByAgent(agentGaii);
  const total = counts.done + counts.failed;

  if (total === 0) return 1.0;

  return counts.done / total;
}

export async function calculateReadiness(
  agentGaii: string,
  steps: AgentOnboardingStep[],
  storage: Storage,
  override?: AgentOnboardingRecord['readinessOverride'],
): Promise<ReadinessResult> {
  const baseline = calculateBaseline(steps);
  const { health, components } = await calculateHealth(agentGaii, storage);
  const effectiveScore = Math.floor(baseline * health);
  let level = getReadinessLevel(effectiveScore);

  if (override && new Date(override.expiresAt) > new Date()) {
    level = override.level;
  }

  return { effectiveScore, level, baseline, health, healthComponents: components };
}

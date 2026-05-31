/**
 * @file agent-statistics.ts
 * @description Recomputes an agent's quality statistics from its tasks: a
 *   performance rollup (task counts, success rate, completion durations by
 *   context) and a per-context peer-review rollup (stars, distribution,
 *   variance, low-confidence flag, rater mix, per-model slice). The source of
 *   truth is always the tasks — anyone can recompute, so the public cache keys
 *   this writes are not forgeable.
 * @structure
 *   - computeAgentStatistics(storage, agentGaii, nodeId) -> { performance, reviews }
 *   - recomputeAndCacheStatistics(...) -> also writes the public statistics.* keys
 *   - LOW_CONFIDENCE_N: sample-size threshold below which a bucket is flagged
 * @usage
 *   import { recomputeAndCacheStatistics } from '../services/agent-statistics.js';
 *   const stats = await recomputeAndCacheStatistics(storage, agentGaii, config.nodeId);
 * @version-history
 *   v1.0.0 -- 2026-05-31 -- Initial Quality-tab aggregation (per-context reviews + performance)
 */
import type { Storage, AgentTaskRecord, RatingContext } from '../storage/interface.js';

/** Below this sample size a bucket is flagged low-confidence; don't act on it. */
export const LOW_CONFIDENCE_N = 10;

export interface ContextReviewStats {
  n: number;
  avgStars: number;
  variance: number;
  lowConfidence: boolean;
  dist: Record<string, number>;            // "1".."5" -> count
  sourceGroundedN: number;
  byModel: Record<string, { n: number; avgStars: number }>;
}

export interface ReviewsRollup {
  byContext: Partial<Record<RatingContext, ContextReviewStats>>;
  overall: { n: number; avgStars: number };
  raterMix: Record<string, number>;        // raterType -> count
  updatedAt: string;
}

export interface PerformanceRollup {
  tasks: { total: number; completed: number; failed: number; successRate: number };
  events: { total: number };
  duration: {
    avgCompletionSeconds: number;
    medianSeconds: number;
    byContext: Partial<Record<RatingContext, { count: number; avgSeconds: number }>>;
  };
  lastTaskAt?: string;
  updatedAt: string;
}

export interface AgentStatistics {
  performance: PerformanceRollup;
  reviews: ReviewsRollup;
}

/** Completion seconds for a done task: prefer telemetry, fall back to wall clock. */
function completionSeconds(task: AgentTaskRecord): number | null {
  if (task.telemetry?.durationSeconds && task.telemetry.durationSeconds > 0) {
    return task.telemetry.durationSeconds;
  }
  if (task.completedAt) {
    const secs = (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 1000;
    return secs >= 0 ? secs : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fetch every task for an agent across pages (recompute is on-demand, not hot path). */
async function fetchAllTasks(storage: Storage, agentGaii: string): Promise<AgentTaskRecord[]> {
  const all: AgentTaskRecord[] = [];
  const perPage = 200;
  let page = 1;
  for (;;) {
    const { tasks, total } = await storage.listAgentTasks(agentGaii, { page, perPage });
    all.push(...tasks);
    if (all.length >= total || tasks.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Compute the performance + per-context review rollups from an agent's tasks.
 * Pure read — does not write anything.
 */
export async function computeAgentStatistics(
  storage: Storage,
  agentGaii: string,
): Promise<AgentStatistics> {
  const now = new Date().toISOString();
  const tasks = await fetchAllTasks(storage, agentGaii);

  // ── Performance ──
  let completed = 0, failed = 0;
  let lastTaskAt: string | undefined;
  const completionDurations: number[] = [];
  const durationByContext: Partial<Record<RatingContext, { total: number; count: number }>> = {};
  let eventsTotal = 0;

  for (const task of tasks) {
    if (task.status === 'done') completed++;
    else if (task.status === 'failed') failed++;

    if (task.completedAt && (!lastTaskAt || task.completedAt > lastTaskAt)) {
      lastTaskAt = task.completedAt;
    }

    if (task.status === 'done') {
      const secs = completionSeconds(task);
      if (secs !== null) {
        completionDurations.push(secs);
        const ctx = task.rating?.context;
        if (ctx) {
          const bucket = durationByContext[ctx] ?? { total: 0, count: 0 };
          bucket.total += secs;
          bucket.count++;
          durationByContext[ctx] = bucket;
        }
      }
    }

    const { total } = await storage.listTaskEvents(task.id, { page: 1, perPage: 1 });
    eventsTotal += total;
  }

  const totalOutcomes = completed + failed;
  const avgCompletionSeconds = completionDurations.length
    ? Math.round(completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length)
    : 0;
  const sorted = [...completionDurations].sort((a, b) => a - b);
  const medianSeconds = sorted.length
    ? Math.round(sorted[Math.floor((sorted.length - 1) / 2)])
    : 0;

  const durationByContextOut: PerformanceRollup['duration']['byContext'] = {};
  for (const [ctx, b] of Object.entries(durationByContext)) {
    if (b) durationByContextOut[ctx as RatingContext] = { count: b.count, avgSeconds: Math.round(b.total / b.count) };
  }

  const performance: PerformanceRollup = {
    tasks: {
      total: tasks.length,
      completed,
      failed,
      successRate: totalOutcomes > 0 ? round2(completed / totalOutcomes) : 0,
    },
    events: { total: eventsTotal },
    duration: { avgCompletionSeconds, medianSeconds, byContext: durationByContextOut },
    lastTaskAt,
    updatedAt: now,
  };

  // ── Reviews (per context) ──
  const rated = tasks.filter((t) => t.rating);
  const ctxAgg = new Map<RatingContext, {
    stars: number[];
    dist: Record<string, number>;
    sourceGroundedN: number;
    byModel: Map<string, number[]>;
  }>();
  const raterMix: Record<string, number> = {};
  let overallSum = 0;

  for (const task of rated) {
    const r = task.rating!;
    raterMix[r.raterType] = (raterMix[r.raterType] ?? 0) + 1;
    overallSum += r.stars;

    const agg = ctxAgg.get(r.context) ?? {
      stars: [], dist: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      sourceGroundedN: 0, byModel: new Map<string, number[]>(),
    };
    agg.stars.push(r.stars);
    agg.dist[String(r.stars)] = (agg.dist[String(r.stars)] ?? 0) + 1;
    if (r.sourceGrounded) agg.sourceGroundedN++;
    if (r.evaluatedModel) {
      const arr = agg.byModel.get(r.evaluatedModel) ?? [];
      arr.push(r.stars);
      agg.byModel.set(r.evaluatedModel, arr);
    }
    ctxAgg.set(r.context, agg);
  }

  const byContext: ReviewsRollup['byContext'] = {};
  for (const [ctx, agg] of ctxAgg.entries()) {
    const n = agg.stars.length;
    const avg = agg.stars.reduce((a, b) => a + b, 0) / n;
    const variance = agg.stars.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
    const byModel: ContextReviewStats['byModel'] = {};
    for (const [model, arr] of agg.byModel.entries()) {
      byModel[model] = { n: arr.length, avgStars: round2(arr.reduce((a, b) => a + b, 0) / arr.length) };
    }
    byContext[ctx] = {
      n,
      avgStars: round2(avg),
      variance: round2(variance),
      lowConfidence: n < LOW_CONFIDENCE_N,
      dist: agg.dist,
      sourceGroundedN: agg.sourceGroundedN,
      byModel,
    };
  }

  const reviews: ReviewsRollup = {
    byContext,
    overall: { n: rated.length, avgStars: rated.length ? round2(overallSum / rated.length) : 0 },
    raterMix,
    updatedAt: now,
  };

  return { performance, reviews };
}

/** Write one public statistics cache key, bumping version if it already exists. */
async function writeCache(
  storage: Storage, ownerGaii: string, agentGaii: string, key: string, value: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key,
    ownerGaii,
    value,
    visibility: 'public',
    tags: ['agent-statistics', `agent:${agentGaii}`],
    ttlHours: null,
    version: existing ? (existing.version ?? 1) + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Recompute the rollups and write them to the agent owner's public statistics
 * cache keys (agents.<name>.statistics.performance / .reviews) so other agents
 * and owners can read them without recomputing. Returns the fresh rollups.
 * Cache writes are best-effort — a write failure does not fail the recompute.
 */
export async function recomputeAndCacheStatistics(
  storage: Storage,
  agentGaii: string,
  nodeId: string,
): Promise<AgentStatistics> {
  const stats = await computeAgentStatistics(storage, agentGaii);

  const agent = await storage.getAgent(agentGaii);
  if (agent) {
    const ownerGhii = `${agent.owner}@${nodeId}`;
    const base = `agents.${agent.name}.statistics`;
    try {
      await writeCache(storage, ownerGhii, agentGaii, `${base}.performance`, stats.performance);
      await writeCache(storage, ownerGhii, agentGaii, `${base}.reviews`, stats.reviews);
    } catch { /* cache is best-effort; the rollup is still returned */ }
  }

  return stats;
}

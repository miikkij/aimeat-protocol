/**
 * @file src/services/db/agent-quality-overview-db-service.ts
 * @description Purpose-built Application DB Service for the agent-card **Quality** subtab — the ONE call
 *   behind GET /v1/agents/:name/quality/overview. The subtab mounted a 2-request fan-out: getAgentStatistics
 *   (recompute performance + per-context review rollups from tasks, cache them, read custom metrics) and
 *   listTasks(status=done). This folds both into one call. NB this composite performs the SAME recompute +
 *   cache write the /statistics endpoint does — it is a request fold, not a pure read scope. Single-master:
 *   the Quality subtab mount only. The individual endpoints stay for interactive re-fetch (post-rate,
 *   live-update).
 *
 * @structure AgentQualityOverviewService.overview(agentGaii, agentName, nodeId, opts?) → { statistics, done_tasks }
 * @usage const ov = await createAgentQualityOverviewService(storage).overview(agentGaii, agentName, nodeId);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Quality subtab's statistics + done-tasks reads into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import { recomputeAndCacheStatistics } from '../agent-statistics.js';
import { logger } from '../../utils/logger.js';

export interface AgentQualityOverview {
  statistics: {
    performance: unknown;
    reviews: unknown;
    custom: Array<{ key: string; value: unknown; updated_at: string }>;
  };
  done_tasks: unknown[];
}

export class AgentQualityOverviewService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Quality subtab mount for one agent: the recomputed statistics (performance + reviews + the agent's
   * custom metrics) and the agent's done tasks, mirroring GET /statistics + GET /tasks?status=done. The
   * statistics recompute + cache write is identical to the /statistics endpoint's.
   */
  async overview(
    agentGaii: string,
    agentName: string,
    nodeId: string,
    opts: { doneLimit?: number } = {},
  ): Promise<AgentQualityOverview> {
    const doneLimit = Math.min(200, Math.max(1, opts.doneLimit ?? 100));
    const customPrefix = `agents.${agentName}.statistics.custom.`;

    const [stats, doneTasks, customRecords] = await Promise.all([
      recomputeAndCacheStatistics(this.storage, agentGaii, nodeId),
      this.storage.listAgentTasks(agentGaii, { status: 'done', page: 1, perPage: doneLimit }),
      // Agent-authored custom metrics live under the AGENT's GAII namespace (optional).
      this.storage.listMemory(agentGaii, { prefix: customPrefix }).catch(err => { logger.warn('constructor: continuing after a suppressed failure', { error: String(err) }); return []; }),
    ]);

    const custom = (customRecords ?? []).map(r => ({
      key: r.key.slice(customPrefix.length), value: r.value, updated_at: r.updatedAt,
    }));

    return {
      statistics: { performance: stats.performance, reviews: stats.reviews, custom },
      done_tasks: doneTasks.tasks,
    };
  }
}

/** Assemble the Quality subtab composite over the given storage. */
export function createAgentQualityOverviewService(storage: Storage): AgentQualityOverviewService {
  return new AgentQualityOverviewService(storage);
}

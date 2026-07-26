/**
 * @file agent-activity.ts
 * @description REST endpoints for agent activity stats, history, and event log.
 *   Provides time-series activity data and task event drill-down for the
 *   Agent Dashboard. Owners can view any of their agents; agents can only
 *   view themselves.
 * @structure
 *   - GET /v1/agents/:name/activity/log  -- event log drill-down (paginated)
 *   - GET /v1/agents/:name/activity      -- stats + history + scheduled jobs
 *   - GET /v1/agents/:name/statistics    -- Quality tab: recomputed performance + per-context review rollups
 *   - GET /v1/agents/:name/quality/overview -- Quality subtab composite (statistics + done tasks)
 * @version-history
 *   v1.3.0 -- 2026-07-16 -- Add GET /quality/overview composite (recomputed statistics + done tasks) folding
 *     the Quality subtab's two mount reads.
 *   v1.2.0 -- 2026-07-16 -- Add GET /activity/overview composite (activity_stats + event log + directives
 *     budget + webhook + telemetry in one call) folding the Activity subtab's 5 agent-domain mount reads;
 *     ledger stays separate (different auth model). Owner-or-self via canAccess, registered before /activity.
 *   v1.1.1 -- 2026-05-31 -- /statistics: read custom metrics from the agent's GAII namespace (agent-authored) instead of the owner GHII
 *   v1.1.0 -- 2026-05-31 -- Add GET /statistics (Quality tab): recompute performance + per-context review rollups from tasks; writes public cache keys
 *   v1.0.0 -- 2026-05-20 -- Initial creation for Agent Dashboard Phase 2
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { recomputeAndCacheStatistics } from '../services/agent-statistics.js';
import { createAgentActivityOverviewService } from '../services/db/agent-activity-overview-db-service.js';
import { createAgentQualityOverviewService } from '../services/db/agent-quality-overview-db-service.js';
import { logger } from '../utils/logger.js';

export function agentActivityRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const activityOverviewDb = createAgentActivityOverviewService(storage);
  const qualityOverviewDb = createAgentQualityOverviewService(storage);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if current session can access this agent */
  function canAccess(req: Express.Request, agentGaii: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) return true;
    return req.auth!.sub === agentGaii;
  }

  /* ── GET /v1/agents/:name/activity/log -- Event log drill-down (paginated) ── */
  /* NOTE: This route MUST be registered before /activity to avoid Express matching 'log' as :name */
  router.get('/v1/agents/:name/activity/log', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 20));

    // Get the agent's tasks (up to 100 most recent)
    const { tasks } = await storage.listAgentTasks(agentGaii, { perPage: 100 });

    // Collect events from all tasks, tagged with task title
    const allEvents: Array<{
      id: string;
      taskId: string;
      taskTitle: string;
      type: string;
      message: string;
      details?: Record<string, unknown>;
      timestamp: string;
    }> = [];

    for (const task of tasks) {
      const { events } = await storage.listTaskEvents(task.id, { page: 1, perPage: 100 });
      for (const evt of events) {
        allEvents.push({
          id: evt.id,
          taskId: evt.taskId,
          taskTitle: task.title,
          type: evt.type,
          message: evt.message,
          details: evt.details,
          timestamp: evt.timestamp,
        });
      }
    }

    // Include onboarding step events
    const onboarding = await storage.getOnboarding(agentGaii);
    if (onboarding?.steps) {
      for (const step of onboarding.steps) {
        if (step.validatedAt) {
          allEvents.push({
            id: `onboarding-${step.id}`,
            taskId: '',
            taskTitle: 'Hello Integration',
            type: step.status === 'passed' ? 'onboarding_passed' : step.status === 'failed' ? 'onboarding_failed' : 'onboarding_step',
            message: `Step ${step.order}: ${step.title} -- ${step.status}`,
            details: { stepId: step.id, validationMethod: step.validationMethod, ...step.details as Record<string, unknown> },
            timestamp: step.validatedAt,
          });
        }
      }
    }

    // Sort by timestamp descending
    allEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Paginate
    const total = allEvents.length;
    const start = (page - 1) * perPage;
    const paged = allEvents.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      events: paged,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage),
      },
    }, [
      { description: 'Activity stats', method: 'GET', url: `/v1/agents/${agentName}/activity` },
    ]));
  });

  /* ── GET /v1/agents/:name/activity/overview -- Activity subtab composite (mount fold) ──
   *
   * The whole Activity subtab mount in ONE call: activity_stats + event log (page 1 × 50) + directives
   * budget + webhook + telemetry. Folds the five agent-domain reads the subtab fired in parallel (each
   * re-resolving + re-loading the agent); the sixth, ledger usage, stays a separate request (different
   * auth model — owner-GHII scoped / app-grant accessible). Each sub-object mirrors the exact `.data`
   * shape of the endpoint it replaces so the subtab seeds it as a drop-in. Owner-or-self via canAccess,
   * identical to the folded /activity, /webhook, /telemetry gates. Registered before /activity (a
   * 2-segment path — no shadow, mirroring the /activity/log ordering note above).
   */
  router.get('/v1/agents/:name/activity/overview', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const data = await activityOverviewDb.overview(agentGaii, agent);
    res.json(success(config.nodeId, data));
  });

  /* ── GET /v1/agents/:name/activity -- Stats + history + scheduled jobs ── */
  router.get('/v1/agents/:name/activity', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Parse query params
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string, 10) || 30));
    const granularity = (req.query.granularity as string) === 'hourly' ? 'hourly' : 'daily';

    // Get time-series activity history
    const history = await storage.getActivityHistory(agentGaii, { days, granularity });

    // Get scheduled jobs belonging to extensions installed by this agent
    const allExtensions = await storage.listExtensions();
    const agentExtNames = new Set(
      allExtensions.filter(e => e.installedBy === agentGaii).map(e => e.name)
    );
    const allJobs = await storage.listScheduledJobs({ type: 'extension' });
    const scheduledJobs = allJobs
      .filter(job => job.extensionName && agentExtNames.has(job.extensionName))
      .map(job => ({
        id: job.id,
        name: job.name,
        type: 'aimeat' as const,
        cron: job.cron,
        enabled: job.enabled,
        extensionName: job.extensionName ?? null,
        lastRunAt: job.lastRunAt ?? null,
        lastRunResult: job.lastRunResult ?? null,
        nextRunAt: job.nextRunAt ?? null,
      }));

    res.json(success(config.nodeId, {
      activity_stats: agent.activityStats ?? null,
      history,
      scheduled_jobs: scheduledJobs,
    }, [
      { description: 'Event log', method: 'GET', url: `/v1/agents/${agentName}/activity/log` },
    ]));
  });

  /* ── GET /v1/agents/:name/statistics -- Quality tab rollups (recomputed from tasks) ──
   *
   * Recomputes the performance + per-context review rollups from the agent's
   * tasks (source of truth → not forgeable) and writes them to the agent
   * owner's public statistics cache keys so other agents/owners can read them
   * without recomputing. Owners can view any of their agents; an agent can view
   * itself.
   */
  router.get('/v1/agents/:name/statistics', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const stats = await recomputeAndCacheStatistics(storage, agentGaii, config.nodeId);

    // Surface any custom metrics the agent published under its statistics.custom.*
    // prefix. These are agent-authored, so they live in the AGENT's GAII
    // namespace (an agent's own memory writes land under its GAII), not the
    // owner's GHII — read from agentGaii.
    const customPrefix = `agents.${agent.name}.statistics.custom.`;
    let custom: Array<{ key: string; value: unknown; updated_at: string }> = [];
    try {
      const records = await storage.listMemory(agentGaii, { prefix: customPrefix });
      custom = records.map(r => ({ key: r.key.slice(customPrefix.length), value: r.value, updated_at: r.updatedAt }));
    } catch (err) { logger.warn('GET /v1/agents/:name/statistics: custom metrics are optional', { error: String(err) }); }

    res.json(success(config.nodeId, {
      performance: stats.performance,
      reviews: stats.reviews,
      custom,
    }, [
      { description: 'Activity stats', method: 'GET', url: `/v1/agents/${agentName}/activity` },
    ]));
  });

  /* ── GET /v1/agents/:name/quality/overview -- Quality subtab composite (mount fold) ──
   *
   * The whole Quality subtab mount in ONE call: the recomputed statistics (performance + reviews + custom
   * metrics) AND the agent's done tasks. Folds GET /statistics + GET /tasks?status=done. Like /statistics,
   * this recomputes + caches (a write), so it is a request fold, not a pure read. Owner-or-self via
   * canAccess, identical to /statistics. Distinct 2-segment path — no shadow with /statistics or /activity.
   */
  router.get('/v1/agents/:name/quality/overview', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);
    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }
    const data = await qualityOverviewDb.overview(agentGaii, agent.name, config.nodeId);
    res.json(success(config.nodeId, data));
  });

  return router;
}

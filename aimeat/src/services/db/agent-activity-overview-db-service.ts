/**
 * @file src/services/db/agent-activity-overview-db-service.ts
 * @description Purpose-built Application DB Service for the agent-card **Activity** subtab — the ONE call
 *   behind GET /v1/agents/:name/activity/overview. Opening the Activity tab fired SIX parallel requests
 *   across FIVE route domains (getActivity, getActivityLog, getDirectives, getWebhookConfig, getTelemetry,
 *   getLedgerUsage), each independently re-resolving + re-loading the agent. This folds the FIVE
 *   agent-domain reads into one read scope over a single already-resolved agent record; the sixth (ledger
 *   usage) stays a separate request because the ledger has a DIFFERENT auth model — owner-GHII scoped and
 *   app-grant accessible, not the activity endpoints' owner-or-self `canAccess` gate (same cross-boundary
 *   discipline as the Wallet EE-PSP and Packages federation slices → 6→2, not 6→1).
 *
 *   Each sub-object mirrors the EXACT `.data` shape of the endpoint it replaces, so the subtab seeds each
 *   piece as a drop-in (including the pre-existing quirk that the tab reads webhook via `.data.webhook`,
 *   which this preserves — a perf slice must not silently change behavior). Single-master: the Activity
 *   subtab mount only. The individual endpoints stay for interactive re-fetch (pagination, live-update).
 *
 * @structure AgentActivityOverviewService.overview(agentGaii, agent, opts?) → { activity, log, directives, webhook, telemetry }
 * @usage const ov = await createAgentActivityOverviewService(storage).overview(agentGaii, agent);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Activity subtab's 5 agent-domain reads into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { listTelemetryBuffered } from '../telemetry-buffer.js';

export interface AgentActivityOverview {
  activity: { activity_stats: unknown };
  log: {
    events: Array<Record<string, unknown>>;
    pagination: { page: number; per_page: number; total: number; total_pages: number };
  };
  directives: { budget_limits?: Record<string, unknown> };
  webhook: Record<string, unknown>;
  telemetry: { events: unknown[]; count: number; per_page: number };
}

export class AgentActivityOverviewService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Activity subtab mount for one already-resolved agent, in a single read scope. The route resolves
   * the agent (guard + 404) and passes it in, so the five folded endpoints' redundant getAgent calls
   * collapse to zero. `logPerPage`/`telemetryLimit` mirror the tab's mount params (page 1 × 50, 50 events).
   */
  overview(
    agentGaii: string,
    agent: AgentRecord,
    opts: { logPerPage?: number; telemetryLimit?: number } = {},
  ): Promise<AgentActivityOverview> {
    const logPerPage = Math.min(100, Math.max(1, opts.logPerPage ?? 50));
    const telemetryLimit = Math.min(200, Math.max(1, opts.telemetryLimit ?? 50));

    return runInReadScope(async () => {
      const [{ tasks }, onboarding, agentDirectives] = await Promise.all([
        this.storage.listAgentTasks(agentGaii, { perPage: 100 }),
        this.storage.getOnboarding(agentGaii),
        this.storage.getAgentDirectives(agentGaii),
      ]);

      // ── Event log (mirrors GET /activity/log page 1) — task events tagged with title + onboarding steps.
      const allEvents: Array<Record<string, unknown>> = [];
      // Task events are read per task (as the source endpoint does); bounded to the 100 most-recent tasks.
      const taskEventLists = await Promise.all(
        tasks.map(task => this.storage.listTaskEvents(task.id, { page: 1, perPage: 100 })
          .then(({ events }) => ({ task, events }))),
      );
      for (const { task, events } of taskEventLists) {
        for (const evt of events) {
          allEvents.push({
            id: evt.id, taskId: evt.taskId, taskTitle: task.title, type: evt.type,
            message: evt.message, details: evt.details, timestamp: evt.timestamp,
          });
        }
      }
      if (onboarding?.steps) {
        for (const step of onboarding.steps) {
          if (step.validatedAt) {
            allEvents.push({
              id: `onboarding-${step.id}`, taskId: '', taskTitle: 'Hello Integration',
              type: step.status === 'passed' ? 'onboarding_passed' : step.status === 'failed' ? 'onboarding_failed' : 'onboarding_step',
              message: `Step ${step.order}: ${step.title} -- ${step.status}`,
              details: { stepId: step.id, validationMethod: step.validationMethod, ...step.details as Record<string, unknown> },
              timestamp: step.validatedAt,
            });
          }
        }
      }
      allEvents.sort((a, b) => (b.timestamp as string).localeCompare(a.timestamp as string));
      const total = allEvents.length;
      const paged = allEvents.slice(0, logPerPage);

      // ── Directives budget (mirrors GET /directives `budget_limits`; the tab reads only this leaf).
      const directives: { budget_limits?: Record<string, unknown> } = {};
      if (agentDirectives?.budgetLimits) {
        directives.budget_limits = {
          max_tokens_per_task: agentDirectives.budgetLimits.maxTokensPerTask,
          max_tokens_per_day: agentDirectives.budgetLimits.maxTokensPerDay,
          max_tasks_per_day: agentDirectives.budgetLimits.maxTasksPerDay,
          alert_threshold: agentDirectives.budgetLimits.alertThreshold,
        };
      }

      // ── Webhook (mirrors GET /webhook `.data` EXACTLY, from the already-loaded agent).
      const webhook: Record<string, unknown> = agent.webhookUrl
        ? {
            configured: true, url: agent.webhookUrl, enabled: agent.webhookEnabled ?? false,
            last_success: agent.webhookLastSuccess ?? null, last_failure: agent.webhookLastFailure ?? null,
            fail_count: agent.webhookFailCount ?? 0,
          }
        : { configured: false };

      // ── Telemetry (mirrors GET /telemetry `.data`; in-memory buffer, no storage hit).
      const events = listTelemetryBuffered(agentGaii, { limit: telemetryLimit });

      return {
        activity: { activity_stats: agent.activityStats ?? null },
        log: {
          events: paged,
          pagination: { page: 1, per_page: logPerPage, total, total_pages: Math.ceil(total / logPerPage) },
        },
        directives,
        webhook,
        telemetry: { events, count: events.length, per_page: telemetryLimit },
      };
    });
  }
}

/** Assemble the Activity-subtab composite over the given storage. */
export function createAgentActivityOverviewService(storage: Storage): AgentActivityOverviewService {
  return new AgentActivityOverviewService(storage);
}

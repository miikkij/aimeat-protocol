/**
 * @file agent-integration.ts
 * @description Agent inbox, integration kit, and long poll endpoints.
 *   Provides a consolidated view of pending work for agents and a machine-readable
 *   integration kit describing how to interact with the task system.
 * @structure
 *   - GET /v1/agents/:name/inbox            -- Consolidated inbox
 *   - GET /v1/agents/:name/integration-kit  -- Full integration kit JSON
 *   - GET /v1/agents/:name/tasks/wait       -- Long poll for new tasks
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';

export function agentIntegrationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Resolve effective identity */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if the caller is allowed to access this agent's data */
  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) return true; // Owners can access all their agents
    // Agent session -- must be the named agent
    const expectedGaii = resolveAgentGaii(req, agentName);
    return req.auth!.sub === expectedGaii;
  }

  /* ── GET /v1/agents/:name/inbox -- Consolidated inbox ── */
  router.get('/v1/agents/:name/inbox', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Fetch queued and active tasks
    const [queuedResult, activeResult] = await Promise.all([
      storage.listAgentTasks(agentGaii, { status: 'queued', perPage: 50 }),
      storage.listAgentTasks(agentGaii, { status: 'active', perPage: 50 }),
    ]);

    res.json(success(config.nodeId, {
      queued_tasks: queuedResult.tasks,
      active_tasks: activeResult.tasks,
      pending_messages: [],
    }, [
      { description: 'View integration kit', method: 'GET', url: `/v1/agents/${agentName}/integration-kit` },
      { description: 'Wait for new tasks', method: 'GET', url: `/v1/agents/${agentName}/tasks/wait` },
    ]));
  });

  /* ── GET /v1/agents/:name/integration-kit -- Full integration kit JSON ── */
  router.get('/v1/agents/:name/integration-kit', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const kit = {
      agent_name: agentName,
      agent_gaii: agentGaii,
      node_url: config.baseUrl,
      node_id: config.nodeId,
      watchdog_spec: {
        poll_interval_seconds: 60,
        inbox_endpoint: `/v1/agents/${agentName}/inbox`,
        task_start_endpoint: `/v1/agents/${agentName}/tasks/{id}/start`,
        task_event_endpoint: `/v1/agents/${agentName}/tasks/{id}/event`,
        task_complete_endpoint: `/v1/agents/${agentName}/tasks/{id}/complete`,
        task_fail_endpoint: `/v1/agents/${agentName}/tasks/{id}/fail`,
      },
      error_protocol: {
        max_retries: 3,
        backoff_seconds: [5, 30, 120],
        report_endpoint: `/v1/agents/${agentName}/tasks/{id}/fail`,
      },
      directives_endpoint: `/v1/agents/${agentName}/directives`,
    };

    res.json(success(config.nodeId, { kit }));
  });

  /* ── GET /v1/agents/:name/tasks/wait -- Long poll for new tasks ── */
  router.get('/v1/agents/:name/tasks/wait', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Parse timeout (default 60s, max 120s)
    const timeoutSec = Math.min(120, Math.max(1, parseInt(req.query.timeout as string || '60', 10)));
    const pollIntervalMs = 2000; // Check every 2 seconds
    const deadline = Date.now() + timeoutSec * 1000;

    // Initial check
    const initial = await storage.listAgentTasks(agentGaii, { status: 'queued', perPage: 1 });
    if (initial.tasks.length > 0) {
      res.json(success(config.nodeId, { task: initial.tasks[0] }));
      return;
    }

    // Poll loop using a promise
    const waitForTask = new Promise<void>((resolvePromise) => {
      let settled = false;

      const timer = setInterval(async () => {
        if (settled) return;

        try {
          if (Date.now() >= deadline) {
            settled = true;
            clearInterval(timer);
            res.json(success(config.nodeId, { task: null }));
            resolvePromise();
            return;
          }

          const result = await storage.listAgentTasks(agentGaii, { status: 'queued', perPage: 1 });
          if (result.tasks.length > 0) {
            settled = true;
            clearInterval(timer);
            res.json(success(config.nodeId, { task: result.tasks[0] }));
            resolvePromise();
          }
        } catch {
          // Ignore poll errors, will retry on next interval
        }
      }, pollIntervalMs);

      // Cleanup on client disconnect
      req.on('close', () => {
        if (!settled) {
          settled = true;
          clearInterval(timer);
          resolvePromise();
        }
      });
    });

    await waitForTask;
  });

  return router;
}

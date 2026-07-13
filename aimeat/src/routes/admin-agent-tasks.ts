/**
 * @file admin-agent-tasks.ts
 * @description Admin endpoints for cross-owner agent task overview.
 *   Lists all agent tasks on the node for operator dashboards.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function adminAgentTasksRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/admin/agent-tasks', requireAuth(), requireRole('operator'), async (req, res) => {
    const status = req.query.status as string | undefined;
    const agentGaii = req.query.agent as string | undefined;
    const page = parseInt(req.query.page as string || '1', 10);
    const perPage = Math.min(parseInt(req.query.per_page as string || '20', 10), 100);

    let allTasks: AgentTaskRecord[];
    let total: number;

    if (agentGaii) {
      // Filter to a single agent
      const result = await storage.listAgentTasks(agentGaii, { status, page, perPage });
      allTasks = result.tasks;
      total = result.total;
    } else {
      // Aggregate across all owners
      const owners = await storage.listOwners();
      const collected: AgentTaskRecord[] = [];
      for (const owner of owners) {
        const ownerGhii = `${owner.name}@${config.nodeId}`;
        const result = await storage.listAgentTasksByOwner(ownerGhii, { status });
        collected.push(...result.tasks);
      }
      total = collected.length;
      collected.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const start = (page - 1) * perPage;
      allTasks = collected.slice(start, start + perPage);
    }

    res.json(success(config.nodeId, {
      tasks: allTasks.map(t => ({
        id: t.id,
        agent_gaii: t.agentGaii,
        owner_gaii: t.ownerGaii,
        title: t.title,
        status: t.status,
        todo_progress: {
          total: t.todos?.length ?? 0,
          done: t.todos?.filter((td: AgentTaskTodo) => td.status === 'done').length ?? 0,
        },
        created_at: t.createdAt,
        last_event_at: t.lastEventAt,
        completed_at: t.completedAt,
      })),
      total,
      page,
      per_page: perPage,
    }));
  });

  return router;
}

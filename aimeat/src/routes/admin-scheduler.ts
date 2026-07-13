/**
 * @file src/routes/admin-scheduler.ts
 * @description Operator-only routes for managing the scheduled-job engine — list/inspect jobs, manually
 *   trigger a run, enable/disable or change a job's cron, delete jobs, and read execution history. All
 *   routes require an authenticated operator and emit a 'scheduler' change event on mutation.
 *
 * @structure
 *   - adminSchedulerRouter(config, storage, scheduler): builds the Express router
 *   - GET jobs / jobs/:id: list and detail
 *   - POST jobs/:id/trigger: run a job now via scheduler.triggerNow
 *   - PATCH/DELETE jobs/:id: update (enable/cron) with reschedule, or remove
 *   - GET execution-log: scheduled-job execution history
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

export function adminSchedulerRouter(config: AimeatConfig, storage: Storage, scheduler: Scheduler): Router {
  const router = Router();

  // ── GET /v1/admin/scheduler/jobs — List all scheduled jobs ────────
  router.get('/v1/admin/scheduler/jobs', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const filter: { type?: string; extensionName?: string; enabled?: boolean } = {};
      if (req.query.type) filter.type = req.query.type as string;
      if (req.query.extensionName) filter.extensionName = req.query.extensionName as string;
      if (req.query.enabled !== undefined) filter.enabled = req.query.enabled === 'true';

      const jobs = await storage.listScheduledJobs(filter);
      res.json(success(config.nodeId, { jobs, total: jobs.length }));
    } catch (err) {
      logger.error('Failed to list scheduled jobs', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list scheduled jobs'));
    }
  });

  // ── GET /v1/admin/scheduler/jobs/:id — Get job detail ────────────
  router.get('/v1/admin/scheduler/jobs/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const job = await storage.getScheduledJob(id);
      if (!job) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Job "${id}" not found`));
        return;
      }
      res.json(success(config.nodeId, { job }));
    } catch (err) {
      logger.error('Failed to get scheduled job', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get scheduled job'));
    }
  });

  // ── POST /v1/admin/scheduler/jobs/:id/trigger — Manual trigger ───
  router.post('/v1/admin/scheduler/jobs/:id/trigger', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    try {
      const job = await storage.getScheduledJob(id);
      if (!job) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Job "${id}" not found`));
        return;
      }

      await scheduler.triggerNow(id);
      const updated = await storage.getScheduledJob(id);

      res.json(success(config.nodeId, {
        triggered: true,
        job: updated,
      }));
      emitChange('scheduler');
    } catch (err) {
      logger.error('Failed to trigger scheduled job', { jobId: id, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'TRIGGER_FAILED', `Job execution failed: ${(err as Error).message}`));
    }
  });

  // ── PATCH /v1/admin/scheduler/jobs/:id — Update job (enable/disable, cron) ──
  router.patch('/v1/admin/scheduler/jobs/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    try {
      const job = await storage.getScheduledJob(id);
      if (!job) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Job "${id}" not found`));
        return;
      }

      const { enabled, cron: cronExpr } = req.body as { enabled?: boolean; cron?: string };
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

      if (enabled !== undefined) updates.enabled = enabled;
      if (cronExpr !== undefined) updates.cron = cronExpr;

      const updated = await storage.updateScheduledJob(id, updates);
      await scheduler.reschedule(id);

      res.json(success(config.nodeId, { job: updated }));
      emitChange('scheduler');
    } catch (err) {
      logger.error('Failed to update scheduled job', { jobId: id, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update scheduled job'));
    }
  });

  // ── DELETE /v1/admin/scheduler/jobs/:id — Remove job ─────────────
  router.delete('/v1/admin/scheduler/jobs/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    try {
      const job = await storage.getScheduledJob(id);
      if (!job) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Job "${id}" not found`));
        return;
      }

      scheduler.removeJob(id);
      await storage.deleteScheduledJob(id);

      res.json(success(config.nodeId, { deleted: id }));
      emitChange('scheduler');
    } catch (err) {
      logger.error('Failed to delete scheduled job', { jobId: id, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to delete scheduled job'));
    }
  });

  // ── GET /v1/admin/scheduler/execution-log — List execution history ──
  router.get('/v1/admin/scheduler/execution-log', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const filter: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
        limit?: number; offset?: number;
      } = {};
      if (req.query.jobId) filter.jobId = req.query.jobId as string;
      if (req.query.extensionName) filter.extensionName = req.query.extensionName as string;
      if (req.query.trigger) filter.trigger = req.query.trigger as string;
      if (req.query.result) filter.result = req.query.result as string;
      filter.limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
      filter.offset = parseInt(req.query.offset as string || '0', 10);

      const [entries, total] = await Promise.all([
        storage.listExecutionLogs(filter),
        storage.countExecutionLogs({
          jobId: filter.jobId,
          extensionName: filter.extensionName,
          trigger: filter.trigger,
          result: filter.result,
        }),
      ]);

      res.json(success(config.nodeId, { entries, total, limit: filter.limit, offset: filter.offset }));
    } catch (err) {
      logger.error('Failed to list execution logs', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list execution logs'));
    }
  });

  // ── DELETE /v1/admin/scheduler/execution-log — Prune old entries ────
  router.delete('/v1/admin/scheduler/execution-log', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const days = parseInt(req.query.olderThanDays as string || '30', 10);
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const pruned = await storage.pruneExecutionLogs(cutoff);
      res.json(success(config.nodeId, { pruned, cutoffDate: cutoff }));
    } catch (err) {
      logger.error('Failed to prune execution logs', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to prune execution logs'));
    }
  });

  return router;
}

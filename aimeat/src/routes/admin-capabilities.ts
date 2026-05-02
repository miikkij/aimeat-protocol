/**
 * @file admin-capabilities.ts
 * @description Admin endpoints for capability management: list all, override, logs.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial admin capability endpoints
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function adminCapabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const auth = [requireAuth(), requireRole('operator')];

  router.get('/v1/admin/capabilities', ...auth, async (req, res) => {
    const filters: any = {};
    if (req.query.owner) filters.ownerGhii = req.query.owner as string;
    if (req.query.source_type) filters.sourceType = req.query.source_type as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.visibility) filters.visibility = req.query.visibility as string;
    if (req.query.search) filters.search = req.query.search as string;
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 50;

    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, result));
  });

  router.put('/v1/admin/capabilities/:id/override', ...auth, async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    await storage.setCapabilityOverride(req.params.id as string, req.body);
    const updated = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, updated));
  });

  router.get('/v1/admin/capabilities/:id/logs', ...auth, async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 50;
    const status = req.query.status as 'success' | 'error' | undefined;
    const result = await storage.listCapabilityLogs(req.params.id as string, { status, page, perPage });

    const cap = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, { ...result, stats: cap?.stats }));
  });

  // Trigger aggregation manually (operator only)
  router.post('/v1/admin/capabilities/aggregate', ...auth, async (_req, res) => {
    const { runCapabilityAggregation } = await import('../services/capability-aggregator.js');
    const result = await runCapabilityAggregation(config, storage);
    res.json(success(config.nodeId, result));
  });

  return router;
}

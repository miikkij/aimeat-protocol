/**
 * @file capabilities.ts
 * @description Capability Layer REST API: discovery, CRUD, invoke proxy, telemetry, vouch, test.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial capability layer endpoints
 */
import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: any) => resolveIdentity(req.auth!, config.nodeId);

  // ── Discovery (Tier 0 for public, Tier 1 for private) ──

  router.get('/v1/capabilities', async (req, res) => {
    const filters: any = {};
    if (req.query.search) filters.search = req.query.search as string;
    if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
    if (req.query.callable !== undefined) filters.callable = req.query.callable === 'true';
    if (req.query.authRequired) filters.authRequired = req.query.authRequired as string;
    if (req.query.source_type) filters.sourceType = req.query.source_type as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.owner) filters.ownerGhii = req.query.owner as string;
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 20;

    if (!req.auth) {
      filters.visibility = 'public';
      if (!filters.status) filters.status = 'active';
    }

    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, result));
  });

  router.get('/v1/capabilities/:id', async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    if (cap.visibility === 'private' && (!req.auth || resolve(req) !== cap.ownerGhii)) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }

    res.json(success(config.nodeId, cap));
  });

  // ── CRUD (Owner, manages own capabilities) ──

  router.post('/v1/capabilities', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = resolve(req);
    const body = req.body;
    const now = new Date().toISOString();

    const schemaHash = createHash('sha256')
      .update(JSON.stringify(body.inputSchema ?? {}) + JSON.stringify(body.outputSchema ?? {}))
      .digest('hex').slice(0, 16);

    const record: CapabilityRecord = {
      id: body.id || randomUUID(),
      name: body.name || '',
      summary: body.summary || '',
      ownerGhii: gaii,
      visibility: body.visibility || 'private',
      scope: 'local',
      status: body.status || 'draft',
      rejectionReason: null,
      deprecationMessage: null,
      replacedBy: null,
      source: body.source || { type: 'manual', ref: 'manual', version: '1.0.0' },
      authRequired: body.authRequired || 'registered',
      callable: body.callable ?? false,
      inputSchema: body.inputSchema ?? null,
      outputSchema: body.outputSchema ?? null,
      exports: body.exports ?? null,
      usage: body.usage || '',
      whenToUse: body.whenToUse || '',
      whenNotToUse: body.whenNotToUse || '',
      examples: body.examples || [],
      dependencies: body.dependencies || [],
      schemaHash,
      webhookUrl: body.webhookUrl ?? null,
      cost: body.cost ?? null,
      trustRequired: body.trustRequired ?? null,
      trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
      redactedFields: body.redactedFields || [],
      operatorOverride: null,
      stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
      tags: body.tags || [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await storage.createCapability(record);
      res.status(201).json(success(config.nodeId, created));
    } catch (err: any) {
      if (err.message?.includes('UNIQUE') || err.message?.includes('duplicate')) {
        return res.status(409).json(error(config.nodeId, 'CAPABILITY_EXISTS', `Capability '${record.id}' already exists`));
      }
      throw err;
    }
  });

  router.put('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req) && !req.auth!.roles.includes('operator')) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    }

    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    delete updates.id;
    delete updates.ownerGhii;
    delete updates.createdAt;

    const updated = await storage.updateCapability(req.params.id as string, updates);
    res.json(success(config.nodeId, updated));
  });

  router.delete('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req) && !req.auth!.roles.includes('operator')) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    }
    if (cap.source.type !== 'manual') {
      return res.status(400).json(error(config.nodeId, 'CANNOT_DELETE', 'Only manual capabilities can be deleted. Auto-aggregated capabilities are removed when their source is removed.'));
    }

    await storage.deleteCapability(req.params.id as string);
    res.json(success(config.nodeId, { deleted: true }));
  });

  // ── Invoke (Tier 1) ──

  router.post('/v1/capabilities/:id/invoke', requireAuth(), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    const callerGhii = resolve(req);
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body.input || {};

    try {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      const result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode);

      storage.incrementCapabilityStats(cap.id, {
        success: 1, error: 0, totalMs: result.duration_ms,
      }).catch(() => {});

      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input, status: 'success', durationMs: result.duration_ms,
        error: null, timestamp: new Date().toISOString(),
      }).catch(() => {});

      res.json(success(config.nodeId, result));
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INVOKE_FAILED';

      storage.incrementCapabilityStats(cap.id, {
        success: 0, error: 1, totalMs: 0, lastError: err.message,
      }).catch(() => {});

      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input, status: 'error', durationMs: 0,
        error: err.message, timestamp: new Date().toISOString(),
      }).catch(() => {});

      res.status(statusCode).json(error(config.nodeId, code, err.message));
    }
  });

  // ── Telemetry (client-side stats ping) ──

  router.post('/v1/capabilities/:id/telemetry', requireAuth(), async (req, res) => {
    const { duration_ms, status: telStatus } = req.body;
    const capId = req.params.id as string;
    if (telStatus === 'success') {
      storage.incrementCapabilityStats(capId, { success: 1, error: 0, totalMs: duration_ms || 0 }).catch(() => {});
    } else {
      storage.incrementCapabilityStats(capId, { success: 0, error: 1, totalMs: duration_ms || 0, lastError: req.body.error }).catch(() => {});
    }
    res.status(204).end();
  });

  return router;
}

/**
 * @file capabilities.ts
 * @description Capability Layer REST API: discovery, CRUD, invoke proxy, telemetry, vouch, test.
 * @structure
 *   - discovery: GET /v1/capabilities and /:id, with the private-row rules
 *   - CRUD: POST / PUT / DELETE, each rendering what services/capability-record.ts decided
 *   - invoke, telemetry, vouch, test
 * @usage Mounted by mountRoutes(); the shared write lives in services/capability-record.ts.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial capability layer endpoints
 *   v1.0.1 - 2026-07-29 - POST /v1/capabilities: normalise `source` per field. A partial source
 *            (e.g. {type:'manual'}) built a record with ref undefined and crashed the insert into a
 *            500 (sourceRef is NOT NULL on both backends); an unknown type or a missing ref on a
 *            non-manual type is now a 400 INVALID_INPUT.
 *   v1.1.0 - 2026-08-11 - August 2026 audit step 8: create, update, delete, vouch and the
 *            post-invoke record moved into services/capability-record.ts, which the MCP tools now
 *            call as well. This file keeps the envelope and nothing else. PUT now applies the
 *            moderation gate to a status change, which it never did — publishing a public
 *            capability on a moderated node no longer skips the review the tool door enforced.
 */
import { Router } from 'express';
import {
  createCapability, updateCapability, deleteCapability, vouchCapability, recordCapabilityInvocation,
} from '../services/capability-record.js';
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityFilter } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  /** Who is asking, in the shape the shared write expects. */
  const caller = (req: Request) => ({ gaii: resolve(req), isOperator: req.auth!.roles.includes('operator') });

  // ── Discovery (Tier 0 for public, Tier 1 for private) ──

  router.get('/v1/capabilities', async (req, res) => {
    const filters: CapabilityFilter = {};
    if (req.query.search) filters.search = req.query.search as string;
    if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
    if (req.query.callable !== undefined) filters.callable = req.query.callable === 'true';
    if (req.query.authRequired) filters.authRequired = req.query.authRequired as string;
    if (req.query.source_type) filters.sourceType = req.query.source_type as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.owner) filters.ownerGhii = req.query.owner as string;
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 20;

    // Anonymous callers (incl. the shared anonymous identity injected by global optionalAuth in
    // anonymous mode — req.auth is TRUTHY then) see only PUBLIC + active capabilities. Testing
    // `!req.auth` alone leaked owner-marked-private rows (ownerGhii, webhookUrl) to the anon internet.
    if (!req.auth || req.auth.anonymous) {
      filters.visibility = 'public';
      if (!filters.status) filters.status = 'active';
    } else if (!(req.auth.roles ?? []).includes('operator')) {
      // Registered non-operator: PUBLIC capabilities + your OWN (any visibility). Never another owner's
      // private rows (which carry webhookUrl / ownerGhii). Mirrors the anonymous restriction above — the
      // anon path was gated, but registered users previously saw every owner's private capabilities.
      filters.publicOrOwner = resolve(req);
    }

    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, {
      ...result,
      policy: {
        publishing: config.capabilityPublishing,
        publishers: config.capabilityPublishers,
        webhooks: config.capabilityWebhooks,
      },
    }));
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
    const body = req.body;
    const created = await createCapability({ storage, config }, caller(req), {
      id: body.id, name: body.name, summary: body.summary, visibility: body.visibility,
      source: body.source, status: body.status,
      authRequired: body.authRequired, callable: body.callable,
      inputSchema: body.inputSchema, outputSchema: body.outputSchema, exports: body.exports,
      usage: body.usage, whenToUse: body.whenToUse, whenNotToUse: body.whenNotToUse,
      examples: body.examples, dependencies: body.dependencies,
      webhookUrl: body.webhookUrl, cost: body.cost, trustRequired: body.trustRequired,
      redactedFields: body.redactedFields, tags: body.tags,
    });
    if (!created.ok) return res.status(created.status).json(error(config.nodeId, created.code, created.message));
    res.status(201).json(success(config.nodeId, created.value));
  });

  router.put('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const updated = await updateCapability({ storage, config }, caller(req), req.params.id as string, req.body);
    if (!updated.ok) return res.status(updated.status).json(error(config.nodeId, updated.code, updated.message));
    res.json(success(config.nodeId, updated.value));
  });

  router.delete('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const removed = await deleteCapability({ storage, config }, caller(req), req.params.id as string);
    if (!removed.ok) return res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
    res.json(success(config.nodeId, { deleted: true }));
  });

  // ── Invoke (Tier 1) ──

  router.post('/v1/capabilities/:id/invoke', requireAuth(), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    const callerGhii = resolve(req);
    // Ownership (SECURITY): a PRIVATE capability may only be invoked by its owner (or an operator) — the
    // read route hides private caps from non-owners, so invoke must too (404, don't confirm existence).
    if (cap.visibility === 'private' && callerGhii !== cap.ownerGhii && !req.auth!.roles.includes('operator')) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body.input || {};

    try {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      const result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode);

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: true, durationMs: result.duration_ms });

      res.json(success(config.nodeId, result));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      const statusCode = e.statusCode || 500;
      const code = e.code || 'INVOKE_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: false, message });

      res.status(statusCode).json(error(config.nodeId, code, message));
    }
  });

  // ── Telemetry (client-side stats ping) ──

  router.post('/v1/capabilities/:id/telemetry', requireAuth(), async (req, res) => {
    const { duration_ms, status: telStatus } = req.body;
    const capId = req.params.id as string;
    if (telStatus === 'success') {
      await storage.incrementCapabilityStats(capId, { success: 1, error: 0, totalMs: duration_ms || 0 });
    } else {
      await storage.incrementCapabilityStats(capId, { success: 0, error: 1, totalMs: duration_ms || 0, lastError: req.body.error });
    }
    res.status(204).end();
  });

  // ── Vouching ──

  router.post('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    const vouched = await vouchCapability({ storage, config }, caller(req), req.params.id as string);
    if (!vouched.ok) return res.status(vouched.status).json(error(config.nodeId, vouched.code, vouched.message));
    res.json(success(config.nodeId, vouched.value));
  });

  router.delete('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    await storage.decrementVouchCount(req.params.id as string);
    const updated = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, { vouchCount: updated?.trust.vouchCount ?? 0 }));
  });

  // ── Test (dry-run invoke for manual webhook capabilities) ──

  router.post('/v1/capabilities/:id/test', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req) && !req.auth!.roles.includes('operator')) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    }
    if (!cap.callable || cap.source.type !== 'manual') {
      return res.status(400).json(error(config.nodeId, 'NOT_TESTABLE', 'Only manual callable capabilities can be tested'));
    }

    const { invokeCapability } = await import('../services/capability-invoke.js');
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      const result = await invokeCapability(config, storage, cap, req.body.input || {}, resolve(req), jwt, 'normal');
      res.json(success(config.nodeId, { status: 'success', result: result.result, duration_ms: result.duration_ms }));
    } catch (err) {
      res.json(success(config.nodeId, { status: 'error', error: err instanceof Error ? err.message : String(err), duration_ms: 0 }));
    }
  });

  return router;
}

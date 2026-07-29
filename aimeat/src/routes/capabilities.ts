/**
 * @file capabilities.ts
 * @description Capability Layer REST API: discovery, CRUD, invoke proxy, telemetry, vouch, test.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial capability layer endpoints
 *   v1.0.1 - 2026-07-29 - POST /v1/capabilities: normalise `source` per field. A partial source
 *            (e.g. {type:'manual'}) built a record with ref undefined and crashed the insert into a
 *            500 (sourceRef is NOT NULL on both backends); an unknown type or a missing ref on a
 *            non-manual type is now a 400 INVALID_INPUT.
 */
import { Router } from 'express';
import type { Request } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord, CapabilityFilter } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

const CAPABILITY_SOURCE_TYPES: CapabilityRecord['source']['type'][] = ['extension', 'action', 'cortex', 'app', 'manual', 'ecosystem'];

function redactInput(input: Record<string, unknown>, redactedFields: string[]): Record<string, unknown> {
  if (!redactedFields.length) return input;
  if (redactedFields.includes('*')) return { _redacted: true, _hash: createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16) };
  const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const field of redactedFields) {
    const parts = field.split('.');
    let obj: Record<string, unknown> | null = copy;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj && typeof obj === 'object' && parts[i] in obj) obj = obj[parts[i]] as Record<string, unknown> | null;
      else { obj = null; break; }
    }
    if (obj && typeof obj === 'object') {
      const last = parts[parts.length - 1];
      if (last in obj) obj[last] = '[REDACTED]';
    }
  }
  return copy;
}

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

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
    const gaii = resolve(req);
    const body = req.body;
    const now = new Date().toISOString();

    // ── Publishing policy enforcement ──
    const isOperator = req.auth!.roles.includes('operator');
    if (!isOperator) {
      if (config.capabilityPublishing === 'disabled') {
        return res.status(403).json(error(config.nodeId, 'PUBLISHING_DISABLED', 'Only the operator can create capabilities on this node'));
      }
      if (config.capabilityPublishing === 'self_only' && body.visibility === 'public') {
        return res.status(403).json(error(config.nodeId, 'PUBLIC_DISABLED', 'Public capabilities require operator approval. Use visibility: private'));
      }
    }

    // Webhook domain allowlist
    if (body.webhookUrl && body.source?.type === 'manual') {
      if (config.capabilityWebhooks === 'disabled') {
        return res.status(403).json(error(config.nodeId, 'WEBHOOKS_DISABLED', 'Webhook capabilities are disabled on this node'));
      }
      if (config.capabilityWebhooks === 'allowlist_only') {
        try {
          const domain = new URL(body.webhookUrl).hostname;
          if (!config.capabilityWebhookDomainAllowlist.includes(domain)) {
            return res.status(403).json(error(config.nodeId, 'WEBHOOK_DOMAIN_NOT_ALLOWED', `Domain '${domain}' is not on the webhook allowlist`));
          }
        } catch {
          return res.status(400).json(error(config.nodeId, 'INVALID_WEBHOOK_URL', 'Invalid webhook URL'));
        }
      }
    }

    // `source` is required in full by CapabilityRecord (type + ref + version), and both storage
    // backends have sourceRef NOT NULL. The old `body.source || <full default>` only defaulted when
    // source was ABSENT, so a partial object — e.g. the natural {type:'manual'} — reached the insert
    // with ref undefined and crashed it into a 500. Normalise per field, and refuse the cases where
    // a placeholder ref would silently produce an unresolvable record.
    const rawSource = (body.source && typeof body.source === 'object') ? body.source as Record<string, unknown> : {};
    const sourceType = (rawSource.type ?? 'manual') as CapabilityRecord['source']['type'];
    if (!CAPABILITY_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `source.type must be one of: ${CAPABILITY_SOURCE_TYPES.join(', ')}`));
    }
    const sourceRef = typeof rawSource.ref === 'string' && rawSource.ref
      ? rawSource.ref
      : (sourceType === 'manual' ? 'manual' : '');
    if (!sourceRef) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `source.ref is required for source.type '${sourceType}'`));
    }
    const sourceVersion = typeof rawSource.version === 'string' && rawSource.version ? rawSource.version : '1.0.0';

    const schemaHash = createHash('sha256')
      .update(JSON.stringify(body.inputSchema ?? {}) + JSON.stringify(body.outputSchema ?? {}))
      .digest('hex').slice(0, 16);

    // Moderation: if publishing=moderated and visibility=public, set pending_review
    let initialStatus = body.status || 'draft';
    if (!isOperator && config.capabilityPublishing === 'moderated' && body.visibility === 'public') {
      initialStatus = 'pending_review';
    }

    const record: CapabilityRecord = {
      id: body.id || randomUUID(),
      name: body.name || '',
      summary: body.summary || '',
      ownerGhii: gaii,
      visibility: body.visibility || 'private',
      scope: 'local',
      status: initialStatus as CapabilityRecord['status'],
      rejectionReason: null,
      deprecationMessage: null,
      replacedBy: null,
      source: { type: sourceType, ref: sourceRef, version: sourceVersion },
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE') || message.includes('duplicate')) {
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

      await storage.incrementCapabilityStats(cap.id, {
        success: 1, error: 0, totalMs: result.duration_ms,
      });

      const logInput = redactInput(input, cap.redactedFields);
      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input: logInput, status: 'success', durationMs: result.duration_ms,
        error: null, timestamp: new Date().toISOString(),
      }).catch(err => { logger.warn('mode: continuing after a suppressed failure', { error: String(err) }); });

      res.json(success(config.nodeId, result));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      const statusCode = e.statusCode || 500;
      const code = e.code || 'INVOKE_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      storage.incrementCapabilityStats(cap.id, {
        success: 0, error: 1, totalMs: 0, lastError: message,
      }).catch(err => { logger.warn('mode: continuing after a suppressed failure', { error: String(err) }); });

      // On error, log full input for debugging (regardless of redaction)
      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input, status: 'error', durationMs: 0,
        error: message, timestamp: new Date().toISOString(),
      }).catch(err => { logger.warn('mode: continuing after a suppressed failure', { error: String(err) }); });

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
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    const callerGhii = resolve(req);
    if (cap.ownerGhii === callerGhii) {
      return res.status(400).json(error(config.nodeId, 'CANNOT_VOUCH_OWN', 'Cannot vouch for your own capability'));
    }
    await storage.incrementVouchCount(req.params.id as string);
    const updated = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, { vouchCount: updated?.trust.vouchCount ?? 0 }));
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

/**
 * @file src/routes/schemas.ts
 * @description Schema-locking API for memory keys: owners/operators attach a JSON Schema (with
 *   apply_to scope + mode) to a key, with lock ownership enforced so only the locking principal (or
 *   an operator) can overwrite it, and validator cache invalidation on replace.
 *
 * @structure
 *   - schemaRouter(config, storage): mounts the memory-schema routes
 *   - PUT /v1/memory/:key/schema: validate the schema, enforce lock ownership, persist + cache-bust
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateSchemaItself, removeFromCache } from '../services/schema-validator.js';
import { SchemaSetSchema } from '../models/schemas.js';
import { emitChange } from '../services/event-bus.js';

export function schemaRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // PUT /v1/memory/:key/schema — set a schema for a memory key
  router.put('/v1/memory/:key/schema', requireAuth(), async (req, res) => {
    const roles = req.auth!.roles;
    if (!roles.includes('owner') && !roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Owner or operator role required'));
      return;
    }

    const key = decodeURIComponent(req.params.key as string);
    const parsed = SchemaSetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid request body', 400, {
        violations: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      }));
      return;
    }
    const { schema, apply_to, schema_mode } = parsed.data;
    const semantic_context = (req.body as Record<string, unknown>)?.semantic_context;

    const schemaError = validateSchemaItself(schema);
    if (schemaError) {
      res.status(400).json(error(config.nodeId, 'INVALID_SCHEMA', schemaError));
      return;
    }

    const mode = schema_mode;
    const now = new Date().toISOString();

    const existing = await storage.getSchema(key, apply_to);

    if (existing && existing.lockedBy !== req.auth!.sub && !roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'SCHEMA_LOCKED_BY_OTHER', `Schema is locked by ${existing.lockedBy}`));
      return;
    }

    // Remove old schema from validator cache if overwriting
    if (existing) {
      removeFromCache(existing.schemaJson);
    }

    const record = await storage.setSchema({
      keyPattern: key,
      applyTo: apply_to,
      schemaJson: schema,
      schemaMode: mode,
      lockedBy: req.auth!.sub,
      setAt: existing?.setAt ?? now,
      updatedAt: now,
      semanticContext: semantic_context && typeof semantic_context === 'object'
        ? semantic_context as Record<string, unknown>
        : undefined,
    });

    res.status(200).json(success(config.nodeId, {
      status: 'schema_set',
      key: record.keyPattern,
      apply_to: record.applyTo,
      schema_mode: record.schemaMode,
      locked_by: record.lockedBy,
      set_at: record.setAt,
    }, [
      { description: 'Read this schema', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}/schema` },
      { description: 'Delete this schema', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}/schema` },
      { description: 'List all schemas', method: 'GET', url: '/v1/schemas' },
    ]));
    emitChange('schemas');
  });

  // GET /v1/memory/:key/schema — read schema for a memory key (Tier 0, no auth)
  router.get('/v1/memory/:key/schema', async (req, res) => {
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.findApplicableSchema(key);

    if (record) {
      res.json(success(config.nodeId, {
        key,
        has_schema: true,
        schema: record.schemaJson,
        apply_to: record.applyTo,
        schema_mode: record.schemaMode,
        locked_by: record.lockedBy,
        set_at: record.setAt,
        semantic_context: record.semanticContext ?? null,
      }));
    } else {
      res.json(success(config.nodeId, {
        key,
        has_schema: false,
      }));
    }
  });

  // DELETE /v1/memory/:key/schema — delete schema for a memory key
  router.delete('/v1/memory/:key/schema', requireAuth(), async (req, res) => {
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getSchema(key, 'exact') ?? await storage.getSchema(key, 'prefix');

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NO_SCHEMA', `No schema found for key: ${key}`));
      return;
    }

    if (record.lockedBy !== req.auth!.sub && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'NOT_SCHEMA_OWNER', 'Only the schema owner or an operator can delete this schema'));
      return;
    }

    await storage.deleteSchema(key);

    res.status(200).json(success(config.nodeId, {
      status: 'schema_removed',
      key,
    }, [
      { description: 'List all schemas', method: 'GET', url: '/v1/schemas' },
    ]));
    emitChange('schemas');
  });

  // GET /v1/schemas — list all schemas (Tier 0, no auth)
  router.get('/v1/schemas', async (req, res) => {
    const prefix = req.query.prefix as string | undefined;

    const schemas = await storage.listSchemas(prefix);

    res.json(success(config.nodeId, {
      schemas: schemas.map(s => ({
        key: s.keyPattern,
        apply_to: s.applyTo,
        schema_mode: s.schemaMode,
        locked_by: s.lockedBy,
        set_at: s.setAt,
        has_semantic: !!s.semanticContext,
      })),
      total: schemas.length,
    }));
  });

  return router;
}

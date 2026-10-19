/**
 * @file src/routes/schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Schema-locking API for memory keys: owners/operators attach a JSON Schema (with
 *   apply_to scope + mode) to a key, with lock ownership enforced so only the locking principal (or
 *   an operator) can overwrite it, and validator cache invalidation on replace.
 *
 * @structure
 *   - schemaRouter(config, storage): mounts the memory-schema routes
 *   - PUT /v1/memory/:key/schema: validate the schema, enforce lock ownership, persist + cache-bust
 *
 * @version-history
 *   2026-10-20 — PUT and DELETE take a lock as the caller's own when it names the token's `sub` or the
 *     resolved identity (isCallersLock): an owner was refused on a lock their own package installed
 *     under the GHII.
 *   2026-10-16 — PUT asks services/schema-lock-rule.ts who may lock which pattern (a node-wide or
 *     another organism's pattern, a lock beside or under another account's lock are refused), and
 *     DELETE removes one row, (key, apply_to), with ?apply_to= to name it; it removed every row of
 *     the pattern, another principal's included. Both write a log line (QA audit S2-04, F05a-01).
 *   v1.2.1 — 2026-10-10 — semantic_context is checked before the lock check, so an operator's refused schema write leaves no operator trail (secaudit 2026-10-10 I8).
 *   v1.2.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.1.0 — 2026-09-08 — semantic_context is checked before the write: its prefixes must resolve,
 *     and every field its `properties` map names must be a field of the schema it describes. Both
 *     were stored unexamined, so a per-field mapping with a typo in the field name looked complete
 *     and pointed at nothing.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router, type Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateSchemaItself, removeFromCache } from '../services/schema-validator.js';
import { SchemaSetSchema } from '../models/schemas.js';
import { semanticContextErrors } from '../utils/onto-context.js';
import { emitChange } from '../services/event-bus.js';
import { isOperatorCaller, operatorOverride } from '../services/operator-override.js';
import { schemaLockRefusal } from '../services/schema-lock-rule.js';
import { callerOf } from '../middleware/caller.js';
import { logger } from '../utils/logger.js';
import { resolveIdentity } from '../utils/gaii.js';

/**
 * Whether the caller is the principal that set a lock. A lock set on this route stores the token's
 * `sub`, which is the bare account name for an owner in person; a lock a package installed in the
 * owner's name stores the GHII (services/component-registrar.ts). Both spellings are the same
 * person, so both are the caller's own. An agent's `sub` and resolved identity are the same GAII, so
 * an agent still matches only its own locks (DATA-15: the exact principal that set it).
 */
function isCallersLock(lockedBy: string, auth: NonNullable<Request['auth']>, nodeId: string): boolean {
  return lockedBy === auth.sub || lockedBy === resolveIdentity(auth, nodeId);
}

export function schemaRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // PUT /v1/memory/:key/schema — set a schema for a memory key
  router.put('/v1/memory/:key/schema', requireAuth(), async (req, res) => {
    const roles = req.auth!.roles;
    if (!roles.includes('owner') && !(await isOperatorCaller(storage, req.auth))) {
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

    // The semantic context is checked BEFORE anything is written or evicted: a prefix nobody
    // declared, or a per-field mapping naming a field this schema does not have, describes nothing
    // and must not be stored looking as though it does. The check reads only the request body, so it
    // also runs before the lock check, whose operator pass writes the operator trail: a refused
    // write leaves no trail (secaudit 2026-10-10 I8).
    const semanticProblems = semanticContextErrors(semantic_context, schema);
    if (semanticProblems.length > 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_SEMANTIC_CONTEXT', semanticProblems[0], 400, {
        violations: semanticProblems.map((message) => ({ path: 'semantic_context', message })),
      }));
      return;
    }

    // Who may lock this pattern at all, and whether another account's lock is beside it or already
    // governs its key (services/schema-lock-rule.ts). The same pattern under the same apply_to is
    // the DATA-15 check below, which compares the exact principal that set it.
    const caller = callerOf(req, config.nodeId, storage);
    const ruled = await schemaLockRefusal({ storage, config },
      { ...caller.principalView, isOperator: await caller.operator() }, key, apply_to,
      (ownerOf) => operatorOverride(storage, config, req.auth, { ownerOf, area: 'schema', action: 'update', subject: key }));
    if (ruled) {
      res.status(ruled.status).json(error(config.nodeId, ruled.code, ruled.message, ruled.status, ruled.details));
      return;
    }

    const existing = await storage.getSchema(key, apply_to);

    if (existing && !isCallersLock(existing.lockedBy, req.auth!, config.nodeId) && !(await operatorOverride(storage, config, req.auth,
      { ownerOf: existing.lockedBy, area: 'schema', action: 'update', subject: key }))) {
      res.status(403).json(error(config.nodeId, 'SCHEMA_LOCKED_BY_OTHER', `This structure is locked by ${existing.lockedBy}. Ask them to unlock it, or make your own copy.`));
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
    logger.info('schema lock set', { key, apply_to, locked_by: record.lockedBy, replaced: existing?.lockedBy ?? null });

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
  router.delete('/v1/memory/:key/schema', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const key = decodeURIComponent(req.params.key as string);
    const asked = req.query.apply_to;
    if (asked !== undefined && asked !== 'exact' && asked !== 'prefix') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'apply_to must be "exact" or "prefix". Leave it out to remove the exact lock, or the prefix lock when there is no exact one.'));
      return;
    }

    // One row: the table key is (key pattern, apply_to), and an exact lock and a prefix lock on the
    // same pattern can belong to two different principals. Without ?apply_to= the exact row is the
    // one, else the prefix row, as before; only that row is checked and removed (DATA-15).
    const record = asked
      ? await storage.getSchema(key, asked)
      : await storage.getSchema(key, 'exact') ?? await storage.getSchema(key, 'prefix');

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NO_SCHEMA', `Nothing has a set structure under "${key}" yet. Create one first if you want to lock its shape.`));
      return;
    }

    if (!isCallersLock(record.lockedBy, req.auth!, config.nodeId) && !(await operatorOverride(storage, config, req.auth,
      { ownerOf: record.lockedBy, area: 'schema', action: 'delete', subject: key }))) {
      res.status(403).json(error(config.nodeId, 'NOT_SCHEMA_OWNER', 'Only whoever set this structure, or whoever runs the node, can remove it. Ask one of them.'));
      return;
    }

    await storage.deleteSchema(key, record.applyTo);
    removeFromCache(record.schemaJson);
    logger.info('schema lock removed', { key, apply_to: record.applyTo, locked_by: record.lockedBy, removed_by: req.auth!.sub });

    res.status(200).json(success(config.nodeId, {
      status: 'schema_removed',
      key,
      apply_to: record.applyTo,
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

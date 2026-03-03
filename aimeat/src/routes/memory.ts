import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { MemoryWriteSchema, MemoryUpdateSchema, validateBody } from '../models/schemas.js';
import { checkMemoryQuota, chargeOverage } from '../services/quota.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from './mcp.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import type { StatsCollector } from '../services/stats.js';

/** Map memory visibility to DMZ zone (Phase 0.6) */
function visibilityToZone(visibility: string): 'private' | 'dmz' | 'federation' {
  switch (visibility) {
    case 'private': return 'private';
    case 'owner': return 'dmz';
    case 'public': return 'federation';
    default: return 'private';
  }
}

export function memoryRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector): Router {
  const router = Router();

  // Phase 2.3 — Workspace access middleware for organism.* namespace keys
  const workspaceAccess = workspaceAccessMiddleware(config, storage);

  // POST /v1/memory — write a memory entry (agent auth required)
  router.post('/v1/memory', requireAuth(), requireRole('agent'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
    const { key, value, visibility, tags, ttl_hours } = req.body ?? {};

    // Phase 2.3 — Workspace access check for organism.* keys (key comes from body, not params)
    if (typeof key === 'string' && key.startsWith('organism.')) {
      (req.params as Record<string, string>).key = key;
      const wsAllowed = await new Promise<boolean>(resolve => {
        const result = workspaceAccess(req, res, () => { resolve(true); });
        // workspaceAccess is async — if it rejects or sends a response, resolve false
        void Promise.resolve(result).then(() => {
          if (res.headersSent) resolve(false);
        });
      });
      if (!wsAllowed) return;
    }

    const vis = visibility ?? 'private';

    const now = new Date().toISOString();
    const gaii = req.auth!.sub;

    // Validate storage_ref type: if value._type === 'storage_ref', verify storage_key exists
    if (value && typeof value === 'object' && value._type === 'storage_ref') {
      if (!value.storage_key || typeof value.storage_key !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'storage_ref requires a valid storage_key string'));
        return;
      }
      const fileExists = await storage.getStorageFile(gaii, value.storage_key);
      if (!fileExists) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Referenced storage file not found: ${value.storage_key}`));
        return;
      }
    }

    const existing = await storage.getMemory(gaii, key);

    // Quota enforcement: configurable per-agent key limit and per-value size limit
    const MAX_KEYS_PER_AGENT = config.memoryMaxKeysPerAgent;
    const MAX_VALUE_SIZE = config.memoryMaxValueSizeKb * 1024;

    const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (valueSize > MAX_VALUE_SIZE) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value size ${valueSize} bytes exceeds limit of ${MAX_VALUE_SIZE} bytes`));
      return;
    }

    if (!existing) {
      const allKeys = await storage.listMemory(gaii);
      if (allKeys.length >= MAX_KEYS_PER_AGENT) {
        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Memory key limit reached (${MAX_KEYS_PER_AGENT}). Delete unused keys first.`));
        return;
      }
    }

    // M-1: Total memory quota enforcement (§8.2, default 10MB per agent)
    const existingSize = existing ? Buffer.byteLength(JSON.stringify(existing.value), 'utf8') : 0;
    const quotaCheck = await checkMemoryQuota(config, storage, gaii, valueSize, existingSize);
    if (!quotaCheck.allowed) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    // Schema validation (Phase 0.1)
    const validation = await validateMemoryWrite(key, value, storage);
    if (!validation.valid) {
      res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED',
        'Value does not match the schema for this key', 422, {
        key,
        violations: validation.errors,
        schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
      }));
      return;
    }

    const record = await storage.setMemory({
      key,
      ownerGaii: gaii,
      value,
      visibility: vis as 'private' | 'owner' | 'public',
      tags: Array.isArray(tags) ? tags : [],
      ttlHours: ttl_hours ?? null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    // Charge overage morsels if over quota (§15)
    if (quotaCheck.overageMorsels > 0) {
      await chargeOverage(storage, gaii, quotaCheck.overageMorsels, 'memory_overage');
    }

    // MCP resource subscription notifications
    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (!existing) emitResourceListChanged(gaii);

    stats?.increment('memory_writes');

    res.status(existing ? 200 : 201).json(success(config.nodeId, {
      key: record.key,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Read this memory entry', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'List all memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Delete this memory entry', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}` },
    ]));
  });

  // GET /v1/memory — list memory keys (agent auth required)
  router.get('/v1/memory', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const prefix = req.query.prefix as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    const tagsParam = req.query.tags as string | undefined;
    const tags = tagsParam ? tagsParam.split(',') : undefined;

    const records = await storage.listMemory(gaii, { prefix, visibility, tags });

    // Calculate total size for quota reporting
    let totalBytes = 0;
    for (const r of records) {
      totalBytes += Buffer.byteLength(JSON.stringify(r.value), 'utf8');
    }

    res.json(success(config.nodeId, {
      items: records.map(r => ({
        key: r.key,
        visibility: r.visibility,
        zone: visibilityToZone(r.visibility),
        tags: r.tags,
        version: r.version,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
      total: records.length,
      quota: {
        max_keys: 1000,
        used_keys: records.length,
        max_bytes: config.memoryQuotaMb * 1024 * 1024,
        used_bytes: totalBytes,
      },
    }, [
      {
        description: 'Write a new memory entry',
        method: 'POST',
        url: '/v1/memory',
        example_body: { key: 'example-key', value: 'example-value', visibility: 'private' },
      },
    ]));
  });

  // GET /v1/memory/search — search memory entries (MUST be before :key to avoid capture)
  router.get('/v1/memory/search', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'q query parameter is required'));
      return;
    }

    const visibility = req.query.visibility as string | undefined;
    const results = await storage.searchMemory(gaii, q, { visibility });

    res.json(success(config.nodeId, {
      results: results.map(r => ({
        key: r.key,
        value: r.value,
        visibility: r.visibility,
        zone: visibilityToZone(r.visibility),
        tags: r.tags,
        version: r.version,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
      total: results.length,
      query: q,
    }));
  });

  // GET /v1/memory/:key — read a memory entry
  router.get('/v1/memory/:key', requireAuth(), requireRole('agent'), workspaceAccess, async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    stats?.increment('memory_reads');

    res.json(success(config.nodeId, {
      key: record.key,
      value: record.value,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Update this memory entry', method: 'POST', url: '/v1/memory', example_body: { key: record.key, value: '...new value...' } },
      { description: 'Delete this memory entry', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'List all memory keys', method: 'GET', url: '/v1/memory' },
    ]));
  });

  // DELETE /v1/memory/:key — delete a memory entry
  router.delete('/v1/memory/:key', requireAuth(), requireRole('agent'), workspaceAccess, async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);

    const deleted = await storage.deleteMemory(gaii, key);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);

    res.json(success(config.nodeId, {
      deleted: true,
      key,
    }, [
      { description: 'List remaining memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Write a new memory entry', method: 'POST', url: '/v1/memory' },
    ]));
  });

  // PUT /v1/memory/:key — update memory with optimistic locking
  router.put('/v1/memory/:key', requireAuth(), requireRole('agent'), workspaceAccess, validateBody(MemoryUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);
    const { value, visibility, tags, ttl_hours, version } = req.body ?? {};

    const existing = await storage.getMemory(gaii, key);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    if (existing.version !== version) {
      res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
        `Expected version ${version} but current is ${existing.version}`,
        409, { current_version: existing.version, your_version: version }));
      return;
    }

    // M-1: Total memory quota check on update
    const newValueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
    const existingSize = Buffer.byteLength(JSON.stringify(existing.value), 'utf8');
    const quotaCheck = await checkMemoryQuota(config, storage, gaii, newValueSize, existingSize);
    if (!quotaCheck.allowed) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    // Schema validation (Phase 0.1)
    const putValidation = await validateMemoryWrite(key, value, storage);
    if (!putValidation.valid) {
      res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED',
        'Value does not match the schema for this key', 422, {
        key,
        violations: putValidation.errors,
        schema_url: `/v1/memory/${encodeURIComponent(putValidation.schemaKey!)}/schema`,
      }));
      return;
    }

    const now = new Date().toISOString();
    const record = await storage.setMemory({
      key,
      ownerGaii: gaii,
      value,
      visibility: visibility ?? existing.visibility,
      tags: tags ?? existing.tags,
      ttlHours: ttl_hours ?? existing.ttlHours,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: now,
    });

    // Charge overage morsels if over quota (§15)
    if (quotaCheck.overageMorsels > 0) {
      await chargeOverage(storage, gaii, quotaCheck.overageMorsels, 'memory_overage');
    }

    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);

    stats?.increment('memory_writes');

    res.json(success(config.nodeId, {
      key: record.key,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Read this memory entry', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
    ]));
  });

  // GET /v1/memory/:gaii/:key — public memory read (no auth for public entries)
  // This allows Tier 0 access to public memory
  router.get('/v1/memory/:gaii/:key', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record || record.visibility !== 'public') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    stats?.increment('memory_reads');

    res.json(success(config.nodeId, {
      key: record.key,
      value: record.value,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      owner_gaii: record.ownerGaii,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }));
  });

  return router;
}

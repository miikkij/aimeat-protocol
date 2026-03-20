import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { MemoryWriteSchema, MemoryUpdateSchema, validateBody } from '../models/schemas.js';
import { checkMemoryQuota, checkStorageQuota, chargeOverage } from '../services/quota.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import { enqueueMemoryReplication } from '../services/memory-replication.js';
import { resolveIdentity } from '../utils/gaii.js';

/** Anonymous agents (shared#anonymous@...) may only write to keys prefixed with "anonymous." */
function isAnonymousGaii(gaii: string): boolean {
  return gaii.includes('#anonymous@');
}
import type { StatsCollector } from '../services/stats.js';
import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
import { emitChange } from '../services/event-bus.js';

/** Map memory visibility to DMZ zone (Phase 0.6) */
function visibilityToZone(visibility: string): 'private' | 'dmz' | 'federation' {
  switch (visibility) {
    case 'private': return 'private';
    case 'owner': return 'dmz';
    case 'public': return 'federation';
    default: return 'private';
  }
}

export function memoryRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector, onDirectoryChange?: () => void, peers?: Map<string, import('../services/federation.js').PeerInfo>): Router {
  const router = Router();

  // Phase 2.3 — Workspace access middleware for organism.* namespace keys
  const workspaceAccess = workspaceAccessMiddleware(config, storage);

  /** Resolve effective identity for memory operations — owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // POST /v1/memory — write a memory entry (agent auth required)
  router.post('/v1/memory', requireAuth(), requireRole('agent'), requireScope('memory:write'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
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
    // Owner sessions use GHII identity (owner@nodeId) for memory storage
    const gaii = resolve(req);

    // Anonymous namespace enforcement: anonymous agents can only write to anonymous.* keys
    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only write to keys prefixed with "anonymous."'));
      return;
    }

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

    // Defense-in-depth: verify ownership on overwrite even though getMemory is scoped by GAII
    if (existing && existing.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own memory records'));
      return;
    }

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

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(gaii, key, config, storage, peers).catch(() => {
        // Non-critical — will be picked up by scheduled sync
      });
    }

    // Charge overage morsels if over quota (§15)
    if (quotaCheck.overageMorsels > 0) {
      await chargeOverage(storage, gaii, quotaCheck.overageMorsels, 'memory_overage');
    }

    // MCP resource subscription notifications
    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (!existing) emitResourceListChanged(gaii);

    // Notify directory of profile data changes (Phase 1.4 — event-driven refresh)
    if (onDirectoryChange && typeof key === 'string' && /^profile\.[^.]+\.(interests|location)$/.test(key)) {
      onDirectoryChange();
    }

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
    emitChange('memory');
  });

  // GET /v1/memory — list memory keys (agent auth required)
  // Optional ?agent=GAII — owner can view any of their own agents' memory
  // Optional ?owner_scope=true — list owner-visible keys across all owner's agents
  // Owner sessions automatically use owner_scope (see all agents' memory)
  router.get('/v1/memory', requireAuth(), requireRole('agent'), requireScope('memory:read'), async (req, res) => {
    let gaii = req.auth!.sub;
    const agentParam = req.query.agent as string | undefined;
    // Owner sessions (human user) automatically see all their agents' memory
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const ownerScope = isOwnerSession || req.query.owner_scope === 'true';

    // Allow owner to view another of their agents' memory
    if (agentParam && agentParam !== gaii) {
      const callerOwner = req.auth!.owner;
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== callerOwner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only view memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }

    const prefix = req.query.prefix as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    const tagsParam = req.query.tags as string | undefined;
    const tags = tagsParam ? tagsParam.split(',') : undefined;
    const maxFlagsParam = req.query.max_flags as string | undefined;
    const maxFlags = maxFlagsParam !== undefined ? parseInt(maxFlagsParam, 10) : undefined;

    let records: MemoryRecord[];
    if (ownerScope) {
      // Collect keys from owner's GHII + all agents (any visibility)
      const callerOwner = req.auth!.owner;
      const ownerGhii = `${callerOwner}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(callerOwner);
      const seen = new Set<string>();
      records = [];
      // Include GHII's own memory entries first
      const ghiiRecords = await storage.listMemory(ownerGhii, { prefix, visibility, tags, maxFlags });
      for (const r of ghiiRecords) {
        seen.add(r.key);
        records.push(r);
      }
      for (const agent of agents) {
        const agentRecords = await storage.listMemory(agent.gaii, { prefix, visibility, tags, maxFlags });
        for (const r of agentRecords) {
          if (!seen.has(r.key)) {
            seen.add(r.key);
            records.push(r);
          }
        }
      }
    } else {
      records = await storage.listMemory(gaii, { prefix, visibility, tags, maxFlags });
    }

    // Calculate total size for quota reporting
    let totalBytes = 0;
    for (const r of records) {
      totalBytes += Buffer.byteLength(JSON.stringify(r.value), 'utf8');
    }

    res.json(success(config.nodeId, {
      items: records.map(r => ({
        key: r.key,
        value: r.value,
        visibility: r.visibility,
        zone: visibilityToZone(r.visibility),
        tags: r.tags,
        version: r.version,
        flagCount: r.flagCount ?? 0,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
      total: records.length,
      quota: {
        max_keys: config.memoryMaxKeysPerAgent,
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
  // Owner sessions search across all their agents' memory
  router.get('/v1/memory/search', requireAuth(), requireRole('agent'), requireScope('memory:read'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let gaii = req.auth!.sub;
    const agentParam = req.query.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      const callerOwner = req.auth!.owner;
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== callerOwner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only search memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'q query parameter is required'));
      return;
    }

    const visibility = req.query.visibility as string | undefined;
    const maxFlagsParam = req.query.max_flags as string | undefined;
    const maxFlags = maxFlagsParam !== undefined ? parseInt(maxFlagsParam, 10) : undefined;

    let results: MemoryRecord[];
    if (isOwnerSession && !agentParam) {
      // Owner session: search across GHII + all agents
      const callerOwner = req.auth!.owner as string;
      const ownerGhii = `${callerOwner}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(callerOwner);
      results = [];
      results.push(...await storage.searchMemory(ownerGhii, q, { visibility, maxFlags }));
      for (const agent of agents) {
        results.push(...await storage.searchMemory(agent.gaii, q, { visibility, maxFlags }));
      }
    } else {
      results = await storage.searchMemory(gaii, q, { visibility, maxFlags });
    }

    res.json(success(config.nodeId, {
      results: results.map(r => ({
        key: r.key,
        value: r.value,
        visibility: r.visibility,
        zone: visibilityToZone(r.visibility),
        tags: r.tags,
        version: r.version,
        flagCount: r.flagCount ?? 0,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
      total: results.length,
      query: q,
    }));
  });

  // ── /v1/memory/files — File storage (MUST be before :key routes) ──

  // POST /v1/memory/files — upload file (base64 JSON body)
  router.post('/v1/memory/files', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const { key, content, mime_type, visibility, tags } = req.body ?? {};

    if (!key || !content) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and content (base64) are required'));
      return;
    }

    const fileData = Buffer.from(content, 'base64');

    // Per-file size limit
    if (fileData.length > config.storageMaxFileSizeMb * 1024 * 1024) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `File size exceeds ${config.storageMaxFileSizeMb}MB limit`));
      return;
    }

    // Total storage quota enforcement
    const storageQuota = await checkStorageQuota(config, storage, gaii, fileData.length);
    if (!storageQuota.allowed) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', storageQuota.reason!));
      return;
    }

    const parsedTags = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
    const file = await storage.createStorageFile({
      key,
      ownerGaii: gaii,
      visibility: (visibility as 'private' | 'owner' | 'public') ?? 'private',
      mimeType: mime_type ?? 'application/octet-stream',
      size: fileData.length,
      data: fileData,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      createdAt: new Date().toISOString(),
    });

    if (storageQuota.overageMorsels > 0) {
      await chargeOverage(storage, gaii, storageQuota.overageMorsels, 'storage_overage');
    }

    emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);

    res.status(201).json(success(config.nodeId, {
      key: file.key,
      size: file.size,
      mime_type: file.mimeType,
      visibility: file.visibility,
      tags: file.tags || [],
      created_at: file.createdAt,
    }));
    emitChange('memory');
  });

  // PATCH /v1/memory/files/:key/visibility — update file visibility
  // Registered BEFORE generic :key PATCH to avoid Express matching "key/visibility" as a single param
  router.patch('/v1/memory/files/:key/visibility', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { visibility } = req.body ?? {};

    if (!visibility || !['private', 'owner', 'public'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be "private", "owner", or "public"'));
      return;
    }

    const updated = await storage.updateFileVisibility(gaii, key, visibility);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      visibility: updated.visibility,
    }));
    emitChange('memory');
  });

  // PATCH /v1/memory/files/:key — update file tags
  router.patch('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const { tags } = req.body ?? {};

    if (!Array.isArray(tags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    if (tags.length > 20 || tags.some((t: unknown) => typeof t !== 'string' || (t as string).length > 64)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Max 20 tags, each max 64 characters'));
      return;
    }

    const updated = await storage.updateFileTagsByKey(gaii, key, tags);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      size: updated.size,
      mime_type: updated.mimeType,
      visibility: updated.visibility,
      tags: updated.tags || [],
      created_at: updated.createdAt,
    }));
    emitChange('memory');
  });

  // GET /v1/memory/files — list files (owner sees all agents' files + GHII files)
  router.get('/v1/memory/files', requireAuth(), requireRole('agent'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let files: Awaited<ReturnType<typeof storage.listStorageFiles>>;
    if (isOwnerSession) {
      const callerOwner = req.auth!.owner as string;
      const ownerGhii = `${callerOwner}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(callerOwner);
      files = [];
      // Include GHII's own files first
      files.push(...await storage.listStorageFiles(ownerGhii));
      for (const agent of agents) {
        files.push(...await storage.listStorageFiles(agent.gaii));
      }
    } else {
      files = await storage.listStorageFiles(req.auth!.sub);
    }

    res.json(success(config.nodeId, {
      files: files.map(f => ({
        key: f.key,
        size: f.size,
        mime_type: f.mimeType,
        visibility: f.visibility,
        tags: f.tags || [],
        created_at: f.createdAt,
      })),
      total: files.length,
    }));
  });

  // GET /v1/memory/files/:key — download file
  router.get('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;
    const file = await storage.getStorageFile(gaii, key);

    if (!file) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.end(file.data);
  });

  // DELETE /v1/memory/files/:key — delete file
  router.delete('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = resolve(req);
    const key = req.params.key as string;

    const existing = await storage.getStorageFile(gaii, key);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `File not found: ${key}`));
      return;
    }
    if (existing.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own files'));
      return;
    }

    await storage.deleteStorageFile(gaii, key);

    emitResourceUpdated(gaii, `aimeat://storage/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);

    res.json(success(config.nodeId, { deleted: key }));
    emitChange('memory');
  });

  // GET /v1/memory/:key — read a memory entry
  router.get('/v1/memory/:key', requireAuth(), requireRole('agent'), requireScope('memory:read'), workspaceAccess, async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    let record = await storage.getMemory(gaii, key);
    // On-read TTL check: if TTL has expired, treat as not found and delete
    if (record && record.ttlHours && record.ttlHours > 0) {
      const expiresAt = new Date(record.createdAt).getTime() + record.ttlHours * 3_600_000;
      if (Date.now() > expiresAt) {
        await storage.deleteMemory(gaii, key);
        record = null;
      }
    }
    if (!record) {
      // Anonymous agents should get 404 for missing keys (no auto-create)
      if (isAnonymousGaii(gaii)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
        return;
      }
      // Auto-create empty memory key (upsert on read)
      const now = new Date().toISOString();
      record = await storage.setMemory({
        key,
        ownerGaii: gaii,
        value: {},
        visibility: 'private',
        tags: [],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
      emitResourceListChanged(gaii);
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
      _ddc: {
        flagCount: record.flagCount ?? 0,
        version: record.version,
        freshness: record.updatedAt,
        visibility: record.visibility,
      },
    }, [
      { description: 'Update this memory entry', method: 'POST', url: '/v1/memory', example_body: { key: record.key, value: '...new value...' } },
      { description: 'Delete this memory entry', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'List all memory keys', method: 'GET', url: '/v1/memory' },
    ]));
  });

  // DELETE /v1/memory/:key — delete a memory entry
  router.delete('/v1/memory/:key', requireAuth(), requireRole('agent'), requireScope('memory:delete'), workspaceAccess, async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    // Anonymous namespace enforcement
    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only delete keys prefixed with "anonymous."'));
      return;
    }

    // Defense-in-depth: verify ownership before deletion
    // Operators can delete any key by passing ?owner=... query parameter
    const ownerOverride = req.query.owner as string | undefined;
    const effectiveOwner = (ownerOverride && req.auth!.roles.includes('operator')) ? ownerOverride : gaii;
    const existing = await storage.getMemory(effectiveOwner, key);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }
    if (existing.ownerGaii !== effectiveOwner && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own memory records'));
      return;
    }

    const deleted = await storage.deleteMemory(effectiveOwner, key);
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
    emitChange('memory');
  });

  // PUT /v1/memory/:key — update memory with optimistic locking
  router.put('/v1/memory/:key', requireAuth(), requireRole('agent'), requireScope('memory:write'), workspaceAccess, validateBody(MemoryUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);
    const { value, visibility, tags, ttl_hours, version } = req.body ?? {};

    // Anonymous namespace enforcement
    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only update keys prefixed with "anonymous."'));
      return;
    }

    const existing = await storage.getMemory(gaii, key);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    // Defense-in-depth: verify ownership even though getMemory is scoped by GAII
    if (existing.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own memory records'));
      return;
    }

    if (existing.version !== version) {
      res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
        `Expected version ${version} but current is ${existing.version}`,
        409, { current_version: existing.version, your_version: version }));
      return;
    }

    // Per-value size limit & quota check — only when value is being changed
    const effectiveValue = value !== undefined ? value : existing.value;
    const newValueSize = Buffer.byteLength(JSON.stringify(effectiveValue), 'utf8');
    const maxValueSize = config.memoryMaxValueSizeKb * 1024;
    if (newValueSize > maxValueSize) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Value size ${newValueSize} bytes exceeds limit of ${maxValueSize} bytes`));
      return;
    }

    // M-1: Total memory quota check on update
    const existingSize = Buffer.byteLength(JSON.stringify(existing.value), 'utf8');
    const quotaCheck = await checkMemoryQuota(config, storage, gaii, newValueSize, existingSize);
    if (!quotaCheck.allowed) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    // Schema validation (Phase 0.1) — only when value is being changed
    if (value !== undefined) {
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
    }

    const now = new Date().toISOString();
    const newRecord = {
      key,
      ownerGaii: gaii,
      value: value !== undefined ? value : existing.value,
      visibility: visibility ?? existing.visibility,
      tags: tags ?? existing.tags,
      ttlHours: ttl_hours ?? existing.ttlHours,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    // Use atomic version-checked update when available (prevents race conditions)
    let record;
    if (storage.setMemoryIfVersion) {
      const result = await storage.setMemoryIfVersion(newRecord, version);
      if (!result) {
        const current = await storage.getMemory(gaii, key);
        res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
          `Expected version ${version} but current is ${current?.version ?? 'unknown'}`,
          409, { current_version: current?.version, your_version: version }));
        return;
      }
      record = result;
    } else {
      record = await storage.setMemory(newRecord);
    }

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(gaii, key, config, storage, peers).catch(() => {
        // Non-critical — will be picked up by scheduled sync
      });
    }

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
    emitChange('memory');
  });

  // ── CORS per-memory-key management ──

  // GET /v1/memory/cors/:key — Get memory key CORS allowed origins
  router.get('/v1/memory/cors/:key', requireAuth(), requireRole('agent'), requireScope('memory:read'), async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found`));
      return;
    }

    // Resolve effective origins: memory → agent → GHII → node
    let effective = config.corsAllowedOrigins;
    let inherited = 'node';

    const ghii = await storage.getGHIIByOwner(req.auth!.owner);
    if (ghii?.allowedOrigins?.length) {
      effective = ghii.allowedOrigins;
      inherited = 'ghii';
    }
    const agent = await storage.getAgent(gaii);
    if (agent?.allowedOrigins?.length) {
      effective = agent.allowedOrigins;
      inherited = 'agent';
    }
    if (record.allowedOrigins?.length) {
      effective = record.allowedOrigins;
      inherited = 'none';
    }

    res.json(success(config.nodeId, {
      key: record.key,
      allowed_origins: record.allowedOrigins ?? null,
      effective,
      inherited_from: inherited,
    }));
  });

  // PUT /v1/memory/cors/:key — Set memory key CORS allowed origins
  router.put('/v1/memory/cors/:key', requireAuth(), requireRole('agent'), requireScope('memory:write'), async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found`));
      return;
    }

    // Defense-in-depth: verify ownership even though getMemory is scoped by GAII
    if (record.ownerGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own memory records'));
      return;
    }

    const { allowed_origins } = req.body ?? {};

    if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to inherit'));
      return;
    }

    if (Array.isArray(allowed_origins)) {
      for (const origin of allowed_origins) {
        if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid origin: ${origin}. Must be an http(s) URL or '*'`));
          return;
        }
      }
    }

    record.allowedOrigins = allowed_origins === null ? undefined : allowed_origins;
    record.updatedAt = new Date().toISOString();
    await storage.setMemory(record);

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(record.ownerGaii, record.key, config, storage, peers).catch(() => {
        // Non-critical — will be picked up by scheduled sync
      });
    }

    res.json(success(config.nodeId, {
      key: record.key,
      allowed_origins: record.allowedOrigins ?? null,
    }));
    emitChange('memory');
  });

  // GET /v1/memory/:gaii/:key — public memory read (no auth for public entries)
  // This allows Tier 0 access to public memory, with consent checking for non-public data
  router.get('/v1/memory/:gaii/:key', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    // Public data — always allow
    if (record.visibility === 'public') {
      stats?.increment('memory_reads');

      // Audit if consent layer is enabled
      if (config.consentEnabled) {
        const accessorGaii = req.auth?.sub ?? 'anonymous';
        await auditDataAccess(storage, null, record.ownerGaii, accessorGaii, key, 'read', true);
      }

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
        _ddc: {
          flagCount: record.flagCount ?? 0,
          version: record.version,
          freshness: record.updatedAt,
          visibility: record.visibility,
        },
      }));
      return;
    }

    // Non-public data: if consent is not enabled, fall back to old behavior (404)
    if (!config.consentEnabled) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    // Non-public data with consent enabled: check consent
    const accessorGaii = req.auth?.sub ?? 'anonymous';
    const consentResult = await checkConsentForRead(storage, key, record.ownerGaii, accessorGaii, record.visibility);

    // Audit the access attempt
    await auditDataAccess(storage, consentResult.consentId ?? null, record.ownerGaii, accessorGaii, key, 'read', consentResult.allowed);

    if (!consentResult.allowed) {
      res.status(403).json(error(config.nodeId, 'CONSENT_DENIED', `Access denied: ${consentResult.reason}`));
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
      _ddc: {
        flagCount: record.flagCount ?? 0,
        version: record.version,
        freshness: record.updatedAt,
        visibility: record.visibility,
      },
    }));
  });

  return router;
}

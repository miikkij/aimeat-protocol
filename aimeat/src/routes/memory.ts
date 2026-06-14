/**
 * @file memory.ts
 * @description Memory CRUD routes, file storage, search, and federated memory
 *   browsing (pull/push/list across nodes).
 * @version-history
 *   v1.0.0 — 2026-03-15 — Initial memory routes
 *   v1.1.0 — 2026-05-22 — Add list-home, list-remote, pull-remote federation endpoints
 *   v1.2.0 — 2026-05-22 — Add discover and copy endpoints for cross-user public memory
 *   v1.3.0 -- 2026-05-28 -- Include owner_gaii in memory listing responses
 *   v1.4.0 -- 2026-06-07 -- Route public-read through shared authorizeRead() (access-guard) so
 *     memory and file storage share one access decision + audit path.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { MemoryWriteSchema, MemoryUpdateSchema, validateBody } from '../models/schemas.js';
import { checkMemoryQuota, checkStorageQuota, chargeOverage } from '../services/quota.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import { enqueueMemoryReplication } from '../services/memory-replication.js';
import { resolveIdentity } from '../utils/gaii.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { decodeStrictBase64 } from '../utils/base64.js';

/** Anonymous agents (shared#anonymous@...) may only write to keys prefixed with "anonymous." */
function isAnonymousGaii(gaii: string): boolean {
  return gaii.includes('#anonymous@');
}
import type { StatsCollector } from '../services/stats.js';
import { authorizeRead } from '../services/access-guard.js';
import { emitChange } from '../services/event-bus.js';
import { getActiveWorkflowEngine } from '../services/workflow/engine.js';
import { emitEcosystemMemoryWrite } from '../services/ecosystem-events.js';
import { ecoMayWriteKey } from '../services/ecosystem-access.js';
import { listOwnerScopeMemory } from '../services/owner-memory.js';

/** Map memory visibility to DMZ zone (Phase 0.6) */
function visibilityToZone(visibility: string): 'private' | 'dmz' | 'federation' {
  switch (visibility) {
    case 'private': return 'private';
    case 'owner': return 'dmz';
    case 'group': return 'dmz';
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
  router.post('/v1/memory', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
    const { key, value, visibility, tags, ttl_hours, group_id, agent: agentParam } = req.body ?? {};

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

    // Ecosystem (GEAI) data-area allowlist: an organism deposit needs an owner-granted area.
    if (typeof key === 'string' && req.auth!.roles.includes('ecosystem')) {
      if (!(await ecoMayWriteKey(storage, req.auth!.sub, key))) {
        res.status(403).json(error(config.nodeId, 'DATA_AREA_DENIED', `Write to "${key}" is not permitted by this app's data-area allowlist`));
        return;
      }
    }

    const vis = visibility ?? 'private';

    const now = new Date().toISOString();
    // Owner sessions use GHII identity (owner@nodeId) for memory storage
    let gaii = resolve(req);

    // Owner sessions may store an entry under one of their own agents' GAII by
    // passing `agent` (the target GAII). Without this, an owner-created entry
    // lands under the owner's GHII instead of the agent it belongs to. Mirrors
    // the ownership validation in GET /v1/memory?agent=. Restricted to owner
    // sessions so an agent cannot write into a sibling agent's namespace.
    if (agentParam && agentParam !== gaii) {
      const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may store memory under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only write memory to your own agents'));
        return;
      }
      gaii = agentParam;
    }

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
      visibility: vis as 'private' | 'owner' | 'group' | 'public',
      tags: Array.isArray(tags) ? tags : [],
      ttlHours: ttl_hours ?? null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(vis === 'group' && group_id ? { groupId: group_id } : {}),
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
    // Event-triggered workflows: a write to an owner key may start a workflow (engine matches the
    // owner-GHII namespace, so agent-namespace writes don't fire owner-keyed triggers).
    getActiveWorkflowEngine()?.onMemoryWrite(gaii, key)
      .catch(e => logger.error('workflow event trigger (memory.write) failed', { key, error: String(e) }));
    // Outbound ecosystem event: push memory.write to any subscribed GEAI of this owner (best-effort).
    emitEcosystemMemoryWrite(storage, config, gaii, key)
      .catch(e => logger.error('ecosystem outbound (memory.write) failed', { key, error: String(e) }));
  });

  // GET /v1/memory — list memory keys (agent auth required)
  // Optional ?agent=GAII — owner can view any of their own agents' memory
  // Optional ?owner_scope=true — list keys across the owner's GHII and agents
  // Owner sessions automatically use owner_scope (see all agents' memory)
  router.get('/v1/memory', requireAuth(), async (req, res) => {
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
    if (ownerScope && !agentParam) {
      // Owner-scope: GHII + all the owner's agents (deduped, GHII first). Shared helper so the
      // workflow signal evaluator reads the exact same set (same-owner-access invariant).
      records = await listOwnerScopeMemory(storage, config.nodeId, req.auth!.owner, { prefix, visibility, tags, maxFlags });
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
        owner_gaii: r.ownerGaii,
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
  router.get('/v1/memory/search', requireAuth(), async (req, res) => {
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
      // Owner session: search across GHII + all agents + all ecosystem apps (GEAIs)
      const callerOwner = req.auth!.owner as string;
      const ownerGhii = `${callerOwner}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(callerOwner);
      const ecoApps = await storage.getEcosystemAppsByOwner(callerOwner);
      results = [];
      results.push(...await storage.searchMemory(ownerGhii, q, { visibility, maxFlags }));
      for (const agent of agents) {
        results.push(...await storage.searchMemory(agent.gaii, q, { visibility, maxFlags }));
      }
      for (const app of ecoApps) {
        results.push(...await storage.searchMemory(app.geai, q, { visibility, maxFlags }));
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

  // GET /v1/memory/discover — browse public memory entries across all users on this node
  router.get('/v1/memory/discover', requireAuth(), async (req, res) => {
    const prefix = req.query.prefix as string | undefined;
    const owner = req.query.owner as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const callerGaii = resolve(req);

    const result = await storage.listAllMemory({
      prefix: prefix || undefined,
      ownerPrefix: owner || undefined,
      visibility: 'public',
      limit,
      offset,
    });

    // Filter out the caller's own entries and apply text search if provided
    let items = result.items.filter(m => m.ownerGaii !== callerGaii);
    if (q) {
      const lq = q.toLowerCase();
      items = items.filter(m =>
        m.key.toLowerCase().includes(lq) ||
        (m.ownerGaii && m.ownerGaii.toLowerCase().includes(lq)) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(lq)))
      );
    }

    stats?.increment('memory_discover');

    res.json(success(config.nodeId, {
      items: items.map(m => ({
        key: m.key,
        owner_gaii: m.ownerGaii,
        visibility: m.visibility,
        tags: m.tags,
        version: m.version,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      })),
      total: items.length,
      limit,
      offset,
    }));
  });

  // POST /v1/memory/copy — copy a public memory entry from another user to your own memory
  router.post('/v1/memory/copy', requireAuth(), requireRole('agent'), requireScope('memory:write'), async (req, res) => {
    const callerGaii = resolve(req);
    const { source_gaii, key, visibility: targetVis } = req.body as {
      source_gaii: string; key: string; visibility?: string;
    };

    if (!source_gaii || !key) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_gaii and key are required'));
      return;
    }

    const sourceRecord = await storage.getMemory(source_gaii, key);
    if (!sourceRecord || sourceRecord.visibility !== 'public') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public memory entry not found'));
      return;
    }

    const sourceBytes = Buffer.byteLength(JSON.stringify(sourceRecord.value), 'utf8');
    const quotaCheck = await checkMemoryQuota(config, storage, callerGaii, sourceBytes);
    if (!quotaCheck.allowed) {
      res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    const now = new Date().toISOString();
    const existing = await storage.getMemory(callerGaii, key);
    const newVersion = existing ? existing.version + 1 : 1;

    await storage.setMemory({
      key,
      ownerGaii: callerGaii,
      value: sourceRecord.value,
      visibility: (targetVis as MemoryRecord['visibility']) || 'private',
      tags: sourceRecord.tags || [],
      ttlHours: null,
      version: newVersion,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    emitResourceUpdated(callerGaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(callerGaii);

    res.json(success(config.nodeId, {
      key,
      copied_from: source_gaii,
      version: newVersion,
    }));
    emitChange('memory');
  });

  // ── /v1/memory/pull — Copy a memory entry from home node to local (federated sessions) ──
  router.post('/v1/memory/pull', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const { key } = req.body ?? {};
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    // Construct the owner's GHII on the home node
    const ownerGhii = `${req.auth!.owner}@${homeNode}`;

    // Resolve home URL: prefer peer map (verified), fall back to JWT claim
    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    // SSRF protection
    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory pull blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const fetchUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/memory/${encodeURIComponent(ownerGhii)}/${encodeURIComponent(key)}`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'X-Source-Node': config.nodeId,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PULL_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { value?: unknown; tags?: string[] } };
      const value = remoteData?.data?.value;
      const remoteTags = remoteData?.data?.tags ?? [];

      if (value === undefined) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found on home node`));
        return;
      }

      // Store locally with private visibility and a pulled-from tag
      const localGhii = resolve(req);
      const now = new Date().toISOString();
      const existing = await storage.getMemory(localGhii, key);
      const tags = [...remoteTags, `pulled-from:${homeNode}`];
      // Deduplicate tags
      const uniqueTags = [...new Set(tags)];

      await storage.setMemory({
        key,
        ownerGaii: localGhii,
        value,
        visibility: 'private',
        tags: uniqueTags,
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      emitChange('memory');
      res.json(success(config.nodeId, {
        pulled: true,
        key,
        source_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory pull error: ${message} (homeNode=${homeNode}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/push-home — Save local memory entry to home node (federated sessions) ──
  router.post('/v1/memory/push-home', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const { key } = req.body ?? {};
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    // Read the local entry
    const localGhii = resolve(req);
    const record = await storage.getMemory(localGhii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found locally`));
      return;
    }

    // Resolve home URL: prefer peer map (verified), fall back to JWT claim
    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    // SSRF protection
    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory push-home blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const replicateUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/federation/replicate`;

    try {
      const payload = {
        source_node: config.nodeId,
        gaii: `${req.auth!.owner}@${homeNode}`,
        key,
        value: record.value,
        visibility: record.visibility,
        version: record.version,
        timestamp: record.updatedAt,
        tags: record.tags ?? [],
      };

      const response = await fetch(replicateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PUSH_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      res.json(success(config.nodeId, {
        pushed: true,
        key,
        target_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory push-home error: ${message} (homeNode=${homeNode}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/list-home — List memories on home node (federated sessions) ──
  router.post('/v1/memory/list-home', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    const ownerGhii = `${req.auth!.owner}@${homeNode}`;

    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory list-home blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const fetchUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/federation/memory/list`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify({ requesting_node: config.nodeId, gaii: ownerGhii }),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_LIST_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { entries?: unknown[]; total?: number } };
      res.json(success(config.nodeId, {
        entries: remoteData?.data?.entries ?? [],
        total: remoteData?.data?.total ?? 0,
        source_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory list-home error: ${message} (homeNode=${homeNode})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/list-remote — List memories on a remote peer node (home users) ──
  router.post('/v1/memory/list-remote', requireAuth(), async (req, res) => {
    if (req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_HOME', 'This endpoint is only available for home sessions'));
      return;
    }

    const { peer_node_id } = req.body ?? {};
    if (!peer_node_id || typeof peer_node_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
      return;
    }

    if (!peers) {
      res.status(503).json(error(config.nodeId, 'FEDERATION_UNAVAILABLE', 'Federation is not configured'));
      return;
    }

    const peer = peers.get(peer_node_id) ?? [...peers.values()].find(p => p.nodeId === peer_node_id);
    if (!peer || peer.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'PEER_NOT_FOUND', `Peer node "${peer_node_id}" is not an active peer`));
      return;
    }

    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      logger.warn(`Memory list-remote blocked: ${urlCheck.reason} (peer=${peer_node_id}, url=${peer.url})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach peer node: ${urlCheck.reason}`));
      return;
    }

    const gaii = resolve(req);
    const fetchUrl = `${peer.url.replace(/\/+$/, '')}/v1/federation/memory/list`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify({ requesting_node: config.nodeId, gaii }),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_LIST_FAILED',
          `Peer node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { entries?: unknown[]; total?: number } };
      res.json(success(config.nodeId, {
        entries: remoteData?.data?.entries ?? [],
        total: remoteData?.data?.total ?? 0,
        source_node: peer.nodeId,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory list-remote error: ${message} (peer=${peer_node_id})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach peer node: ${message}`));
    }
  });

  // ── /v1/memory/pull-remote — Pull a specific key from a remote peer node (home users) ──
  router.post('/v1/memory/pull-remote', requireAuth(), async (req, res) => {
    if (req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_HOME', 'This endpoint is only available for home sessions'));
      return;
    }

    const { peer_node_id, key } = req.body ?? {};
    if (!peer_node_id || typeof peer_node_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
      return;
    }
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }

    if (!peers) {
      res.status(503).json(error(config.nodeId, 'FEDERATION_UNAVAILABLE', 'Federation is not configured'));
      return;
    }

    const peer = peers.get(peer_node_id) ?? [...peers.values()].find(p => p.nodeId === peer_node_id);
    if (!peer || peer.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'PEER_NOT_FOUND', `Peer node "${peer_node_id}" is not an active peer`));
      return;
    }

    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      logger.warn(`Memory pull-remote blocked: ${urlCheck.reason} (peer=${peer_node_id}, url=${peer.url})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach peer node: ${urlCheck.reason}`));
      return;
    }

    const gaii = resolve(req);
    const fetchUrl = `${peer.url.replace(/\/+$/, '')}/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'X-Source-Node': config.nodeId,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PULL_FAILED',
          `Peer node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { value?: unknown; tags?: string[] } };
      const value = remoteData?.data?.value;
      const remoteTags = remoteData?.data?.tags ?? [];

      if (value === undefined) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found on peer node`));
        return;
      }

      const now = new Date().toISOString();
      const existing = await storage.getMemory(gaii, key);
      const tags = [...remoteTags, `pulled-from:${peer.nodeId}`];
      const uniqueTags = [...new Set(tags)];

      await storage.setMemory({
        key,
        ownerGaii: gaii,
        value,
        visibility: 'private',
        tags: uniqueTags,
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      emitChange('memory');
      res.json(success(config.nodeId, {
        pulled: true,
        key,
        source_node: peer.nodeId,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory pull-remote error: ${message} (peer=${peer_node_id}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach peer node: ${message}`));
    }
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

    const fileData = decodeStrictBase64(content);
    if (!fileData) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content must be base64-encoded'));
      return;
    }

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
  router.get('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), workspaceAccess, async (req, res) => {
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
  router.delete('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:delete'), workspaceAccess, async (req, res) => {
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
    let effectiveOwner = (ownerOverride && req.auth!.roles.includes('operator')) ? ownerOverride : gaii;
    let existing = await storage.getMemory(effectiveOwner, key);

    // Owner sessions can delete any of their agents' memory entries. Mirrors
    // the cross-agent lookup in PUT /v1/memory/:key — without this, an owner
    // (whose GAII is the GHII) deleting a key stored under one of their agents
    // would get a spurious 404. Only kicks in when no explicit operator
    // ?owner= override was supplied.
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (!existing && isOwnerSession && !ownerOverride) {
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      for (const agent of agents) {
        const found = await storage.getMemory(agent.gaii, key);
        if (found) { existing = found; effectiveOwner = agent.gaii; break; }
      }
    }
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

    emitResourceUpdated(effectiveOwner, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(effectiveOwner);

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
  router.put('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), workspaceAccess, validateBody(MemoryUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);
    const { value, visibility, tags, ttl_hours, version, group_id } = req.body ?? {};

    // Anonymous namespace enforcement
    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only update keys prefixed with "anonymous."'));
      return;
    }

    // Ecosystem (GEAI) data-area allowlist: an organism deposit needs an owner-granted area.
    if (req.auth!.roles.includes('ecosystem') && !(await ecoMayWriteKey(storage, req.auth!.sub, key))) {
      res.status(403).json(error(config.nodeId, 'DATA_AREA_DENIED', `Write to "${key}" is not permitted by this app's data-area allowlist`));
      return;
    }

    // Owner sessions can update any of their agents' memory entries
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let existing = await storage.getMemory(gaii, key);
    let effectiveGaii = gaii;
    if (!existing && isOwnerSession) {
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      for (const agent of agents) {
        const found = await storage.getMemory(agent.gaii, key);
        if (found) { existing = found; effectiveGaii = agent.gaii; break; }
      }
    }
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    // Defense-in-depth: verify ownership
    if (existing.ownerGaii !== effectiveGaii) {
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
    const quotaCheck = await checkMemoryQuota(config, storage, effectiveGaii, newValueSize, existingSize);
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
    const effectiveVis = visibility ?? existing.visibility;
    const newRecord = {
      key,
      ownerGaii: effectiveGaii,
      value: value !== undefined ? value : existing.value,
      visibility: effectiveVis,
      tags: tags ?? existing.tags,
      ttlHours: ttl_hours ?? existing.ttlHours,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: now,
      ...(effectiveVis === 'group' && group_id ? { groupId: group_id } : {}),
    };

    // Use atomic version-checked update when available (prevents race conditions)
    let record;
    if (storage.setMemoryIfVersion) {
      const result = await storage.setMemoryIfVersion(newRecord, version);
      if (!result) {
        const current = await storage.getMemory(effectiveGaii, key);
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
      enqueueMemoryReplication(effectiveGaii, key, config, storage, peers).catch(() => {
        // Non-critical — will be picked up by scheduled sync
      });
    }

    // Charge overage morsels if over quota (§15)
    if (quotaCheck.overageMorsels > 0) {
      await chargeOverage(storage, effectiveGaii, quotaCheck.overageMorsels, 'memory_overage');
    }

    emitResourceUpdated(effectiveGaii, `aimeat://memory/${encodeURIComponent(key)}`);

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

      // Shared guard: audits the public read when the consent layer is enabled.
      await authorizeRead(storage, config, {
        ownerGaii: record.ownerGaii,
        accessorGaii: req.auth?.sub ?? 'anonymous',
        resourceKey: key,
        visibility: 'public',
        action: 'read',
      });

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

    // Non-public data with consent enabled: shared guard decides + audits the attempt.
    const accessorGaii = req.auth?.sub ?? 'anonymous';
    const consentResult = await authorizeRead(storage, config, {
      ownerGaii: record.ownerGaii,
      accessorGaii,
      resourceKey: key,
      visibility: record.visibility,
      groupId: record.groupId,
      action: 'read',
    });

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

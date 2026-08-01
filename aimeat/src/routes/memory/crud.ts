/**
 * @file src/routes/memory/crud.ts
 * @description Core memory CRUD routes: POST /v1/memory (write), GET /v1/memory (list), GET /v1/memory/search. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 *   v1.1.0 — 2026-07-14 — Perf: ?include=meta uses a META fast path (listMemoryMeta / owner-scope meta)
 *     that never loads or serialises values; used_bytes sums the stored byteSize.
 */

import type { Router } from 'express';
import type { MemoryRecord } from '../../storage/interface.js';
import { normalizeWorkspaceRefs } from '../../utils/workspace-ref.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { MemoryWriteSchema, validateBody } from '../../models/schemas.js';
import { checkMemoryQuota, chargeOverage } from '../../services/quota.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { enqueueMemoryReplication } from '../../services/memory-replication.js';
import { parseGaiiLoose, ownerGhiiOf } from '../../utils/gaii.js';
import { cached, TTL } from '../../services/cache.js';
import { logger } from '../../utils/logger.js';
import { emitChange, emitMemoryWritten } from '../../services/event-bus.js';
import { reconcileAfterSourceWrite } from '../../services/exchange-projection.js';
import { getActiveWorkflowEngine } from '../../services/workflow/engine.js';
import { emitEcosystemMemoryWrite } from '../../services/ecosystem-events.js';
import { runAutomationRecipesForWrite } from '../../services/ecosystem-automation.js';
import { ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { isKeyArchived } from '../../services/archive.js';
import { stampAgentWrite, resolveAttachableProvenanceId } from '../../services/ai-provenance.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone, memoryContentBytes } from './shared.js';

export function registerCrudRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, memoryDb, stats, onDirectoryChange, peers, resolve, workspaceAccess } = ctx;

  // POST /v1/memory — write a memory entry (agent auth required)
  router.post('/v1/memory', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
    const { key, value, visibility, tags, ttl_hours, group_id, workspace_ref, workspace_refs, agent: agentParam, ai_provenance_id } = req.body ?? {};

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

    // Reserved-key guard (DNA invariant #2): a role-'app' token (H-2 app grant) has sub = the owner's
    // GHII, so its memory:write lands in the owner's namespace — where the server reads openrouter.*
    // (the URL a decrypted AI key is sent to), ai-usage.* (the daily spend cap), and profile.* (public
    // directory + match inputs). A granted app must not poison those; the owner manages them via the
    // owner-only routes (/v1/openrouter/settings, /v1/ghii).
    if (typeof key === 'string' && !appMayWriteKey(req.auth!.roles, key)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
      return;
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

    // Archive guard: a record that is itself archived, or sits inside an archived workspace/organism,
    // is read-only. (isKeyArchived without ownerGaii only checks the cheap container markers; the
    // record-level case reuses the `existing` we already fetched — no extra getMemory.)
    if (existing?.archived) {
      res.status(409).json(error(config.nodeId, 'ARCHIVED', 'This record is archived (read-only). Unarchive it before writing.'));
      return;
    }
    if (key.startsWith('organism.')) {
      const guard = await isKeyArchived(storage, key);
      if (guard.archived) {
        res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${guard.level} is archived (read-only). Unarchive it before writing.`));
        return;
      }
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
      // Cheap DB COUNT(DISTINCT key) — NOT listMemory (which loaded every record + value just to
      // count them; that full scan on each new key was a big part of the per-write latency).
      const keyCount = await storage.countMemory([gaii]);
      if (keyCount >= MAX_KEYS_PER_AGENT) {
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

    // MINT-3 (TARGET-058). A non-human principal that says nothing about what it wrote is stamped
    // by the node: silence from an agent must NOT read as "a human wrote it". An owner writing
    // through their own token is presumed human and is never stamped. Attached, not inherited — a
    // new value is new content, so an overwrite drops the previous record's id rather than carrying
    // a statement forward onto bytes it was never about.
    // An explicitly supplied record wins — that is the publish path: `/v1/ai/complete` hands back a
    // private record in `meta.provenance` and attaching it here is what makes it resolvable. It is
    // resolved against the caller's OWN account, so nobody can publish someone else's statement.
    const aiProvenanceId =
      await resolveAttachableProvenanceId(storage, ownerGhiiOf(gaii), ai_provenance_id)
      ?? await stampAgentWrite(storage, {
        principal: gaii,
        content: memoryContentBytes(value),
        pipeline: 'memory.write',
        surface: { visibility: vis as MemoryRecord['visibility'], humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
      });

    const record = await storage.setMemory({
      key,
      ownerGaii: gaii,
      value,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
      visibility: vis as MemoryRecord['visibility'],
      tags: Array.isArray(tags) ? tags : [],
      ttlHours: ttl_hours ?? null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(vis === 'group' && group_id ? { groupId: group_id } : {}),
      // 'workspace' = readable by members of one or more "<org>/<ws>" (parity with storage files).
      ...(vis === 'workspace' ? { workspaceRef: normalizeWorkspaceRefs(workspace_refs, workspace_ref) } : {}),
    });

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(gaii, key, config, storage, peers).catch(err => {
        // Non-critical for THIS request: the scheduled sync picks the record up later. Logged because
        // an enqueue that keeps failing means replication is running only at sync cadence.
        logger.warn('memory write: replication enqueue failed, leaving it to the scheduled sync', { key, error: String(err) });
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

    // Memory Contracts (reactive): a write to a watched key fires Tracked Response evaluation. The
    // subscriber gates on the track-registry (O(1)) so non-watched writes do no work.
    emitMemoryWritten(gaii, key, existing ? 'updated' : 'created');

    // TARGET-050: an app-tool manifest / agent offers doc IS the source of truth for its EXCHANGE
    // listing — reprice a tool here and the market follows, with no separate listing step.
    await reconcileAfterSourceWrite(storage, gaii, key);

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
    // Organism content lives in memory under organism.{id}.*; also emit 'organisms' so organism
    // views refresh WITHOUT having to subscribe to the global 'memory' firehose (every agent's
    // every memory write). The workspace/organism views listen to 'organisms' only.
    if (key.startsWith('organism.')) emitChange('organisms');
    // Event-triggered workflows: a write to an owner key may start a workflow (engine matches the
    // owner-GHII namespace, so agent-namespace writes don't fire owner-keyed triggers).
    getActiveWorkflowEngine()?.onMemoryWrite(gaii, key)
      .catch(e => logger.error('workflow event trigger (memory.write) failed', { key, error: String(e) }));
    // Outbound ecosystem event: push memory.write to any subscribed GEAI of this owner (best-effort).
    emitEcosystemMemoryWrite(storage, config, gaii, key)
      .catch(e => logger.error('ecosystem outbound (memory.write) failed', { key, error: String(e) }));
    // Ecosystem automation recipes (feature B4): when a connected app publishes data on a key
    // matching an enabled recipe's glob, materialise an agent task for each configured agent.
    runAutomationRecipesForWrite(storage, config, gaii, key)
      .catch(e => logger.error('ecosystem automation recipe trigger failed', { key, error: String(e) }));
  });

  // GET /v1/memory — list memory keys (agent auth required)
  // Optional ?agent=GAII — owner can view any of their own agents' memory
  // Optional ?owner_scope=true — list keys across the owner's GHII and agents
  // Owner sessions automatically use owner_scope (see all agents' memory)
  router.get('/v1/memory', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
    let gaii = req.auth!.sub;
    const agentParam = req.query.agent as string | undefined;
    // Owner sessions (human user) automatically see all their agents' memory
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    // Owner-scope broadening (GHII + all agents + eco apps) is the same-owner-access invariant for the
    // owner and their own agents/app-grants. An ECOSYSTEM app must NOT broaden to the owner's entire
    // keyspace — it reads its own eco: namespace and only the owner areas its data-area grants cover
    // (enforced per-key on the single-key route). Without this, ?owner_scope=true would hand a
    // restricted GEAI the whole owner keyspace, bypassing its data-area allowlist.
    const ownerScope = (isOwnerSession || req.query.owner_scope === 'true') && !req.auth!.roles.includes('ecosystem');

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
    // ?archived=only → ONLY archived records (the Memory tab's "Archived" filter); ?include_archived=true
    // → active + archived together. Default (omitted) excludes archived — the normal working set.
    const archived = req.query.archived === 'only' ? 'only' : (req.query.include_archived === 'true' ? 'include' : undefined);
    // ?include=meta — omit the (heavy) `value` from every item and report each entry's size in
    // `bytes` instead. The profile Memory tab uses this so opening the tab with thousands of keys
    // stays fast (groups + filtering work on metadata; values are fetched per-row on expand). The
    // default response keeps `value` inline — MCP tools and agents rely on it.
    const metaOnly = req.query.include === 'meta';

    // ?count=true — return ONLY the count (no items/values). Uses a cheap COUNT(DISTINCT key)
    // server-side (no record values loaded or transferred) for the common no-filter case (e.g. a
    // profile stats bar "🧠 N Muistit"). Tag/maxFlags filters fall through to the list-based count
    // below (countMemory supports prefix + visibility only).
    if (req.query.count === 'true' && !tags?.length && maxFlags === undefined) {
      // Cached per identity-set + filter (60s, dashboard TTL): the profile stats bar polls this on
      // every load / live-update; a COUNT(DISTINCT key) is cheap but recurs constantly. Invalidated
      // by the `domain:memory` tag (memory writes broadcast `emitChange('memory')`) so a write drops
      // the count before its TTL. Key includes prefix/visibility so different filters don't collide.
      const filterKey = `${prefix ?? ''}|${visibility ?? ''}`;
      let count: number;
      if (ownerScope && !agentParam) {
        const ownerName = req.auth!.owner;
        // Owner-scope DISTINCT-key count through the service (it resolves GHII + agents + eco apps and
        // runs one countMemory over the union); cached per identity-set + filter (dashboard TTL).
        count = await cached(
          `memcount:owner:${ownerName}:${filterKey}`, TTL.dashboard,
          () => memoryDb.countOwnerScope(ownerName, { prefix, visibility }),
          ['domain:memory', `owner:${ownerName}:memory`],
        );
      } else {
        const owner = parseGaiiLoose(gaii).owner;
        count = await cached(
          `memcount:${gaii}:${filterKey}`, TTL.dashboard,
          () => storage.countMemory([gaii], { prefix, visibility }),
          ['domain:memory', ...(owner ? [`owner:${owner}:memory`] : [])],
        );
      }
      res.json(success(config.nodeId, { count }));
      return;
    }

    // META FAST PATH (?include=meta): the profile Memory tab lists keys + sizes for grouping/filtering
    // and fetches values per-row on expand. Read META rows (metadata + stored byteSize) so NO value is
    // ever loaded or serialised — a keyspace of thousands of keys lists cheaply, and used_bytes sums the
    // stored byteSize instead of JSON.stringify-ing every value. (The old meta path loaded all values
    // just to omit them from the response and total the bytes in JS.)
    if (metaOnly) {
      const metaRows = (ownerScope && !agentParam)
        ? await memoryDb.listOwnerScopeMeta(req.auth!.owner, { prefix, visibility, tags, maxFlags, archived })
        : await storage.listMemoryMeta(gaii, { prefix, visibility, tags, maxFlags, archived });
      if (req.query.count === 'true') {
        res.json(success(config.nodeId, { count: metaRows.length }));
        return;
      }
      let totalBytes = 0;
      for (const r of metaRows) totalBytes += r.byteSize;
      res.json(success(config.nodeId, {
        items: metaRows.map(r => ({
          key: r.key,
          owner_gaii: r.ownerGaii,
          bytes: r.byteSize,
          visibility: r.visibility,
          zone: visibilityToZone(r.visibility),
          tags: r.tags,
          version: r.version,
          flagCount: r.flagCount ?? 0,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          // Same key under other same-owner identities; those copies are shadowed by this one
          // and appear nowhere else in the response (owner-scope listings only).
          ...((r as { alsoUnder?: string[] }).alsoUnder ? { also_under: (r as { alsoUnder?: string[] }).alsoUnder } : {}),
        })),
        total: metaRows.length,
        quota: {
          max_keys: config.memoryMaxKeysPerAgent,
          used_keys: metaRows.length,
          max_bytes: config.memoryQuotaMb * 1024 * 1024,
          used_bytes: totalBytes,
        },
      }, [
        { description: 'Write a new memory entry', method: 'POST', url: '/v1/memory',
          example_body: { key: 'example-key', value: 'example-value', visibility: 'private' } },
      ]));
      return;
    }

    let records: MemoryRecord[];
    if (ownerScope && !agentParam) {
      // Owner-scope: GHII + all the owner's agents + eco apps (deduped, GHII first) via the service.
      // (services/owner-memory.ts remains the shared impl the service composes, so the workflow signal
      // evaluator reads the exact same set — same-owner-access invariant.)
      records = await memoryDb.listOwnerScope(req.auth!.owner, { prefix, visibility, tags, maxFlags, archived });
    } else {
      records = await storage.listMemory(gaii, { prefix, visibility, tags, maxFlags, archived });
    }

    // ?count=true with tag/maxFlags filters — count from the materialized list (rare path).
    if (req.query.count === 'true') {
      res.json(success(config.nodeId, { count: records.length }));
      return;
    }

    // Calculate total size for quota reporting. (The ?include=meta path returns earlier via the META
    // fast path and never reaches here, so this always carries values.)
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
        // Same key under other same-owner identities; those copies are shadowed by this one
        // and appear nowhere else in the response (owner-scope listings only).
        ...((r as { alsoUnder?: string[] }).alsoUnder ? { also_under: (r as { alsoUnder?: string[] }).alsoUnder } : {}),
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
    // Optional prefix — scopes the content search to one namespace/group (e.g. "organism.{id}.")
    // so the profile Memory tab can search within an expanded group.
    const prefix = req.query.prefix as string | undefined;
    // Result cap — honours the documented `per_page`, or `limit` as an alias (default 200, hard max 500).
    const limitParam = (req.query.limit ?? req.query.per_page) as string | undefined;
    const limit = limitParam !== undefined ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 200)) : 200;

    // ONE indexed query across the identity set via the librarian's searchText primitive (SQLite FTS5 /
    // Mongo searchBlob), ranked best-first. Owner sessions cover GHII + every agent + every ecosystem app
    // (resolved by the service); an agent/eco session (or ?agent=) searches just that one identity.
    const hits = (isOwnerSession && !agentParam)
      ? await memoryDb.searchOwnerScope(req.auth!.owner as string, q, { keyPrefix: prefix, visibility, maxFlags, limit })
      : await storage.searchText(q, { ownerGaiis: [gaii], keyPrefix: prefix, visibility, maxFlags, limit });
    const results: MemoryRecord[] = hits.map(h => h.record);

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
}

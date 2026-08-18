/**
 * @file src/routes/memory/crud.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core memory CRUD routes: POST /v1/memory (write), GET /v1/memory (list), GET /v1/memory/search. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — POST /v1/memory calls services/memory-write.ts, the same function the MCP
 *     tool calls. The scope gate lives inside it as well as in this route's middleware.
 *   v1.1.0 — 2026-08-10 — Security audit H-11: search enforces memory:read like its siblings.
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
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { parseGaiiLoose } from '../../utils/gaii.js';
import { cached, TTL } from '../../services/cache.js';
import { writeMemoryRecord } from '../../services/memory-write.js';
import { ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { resolveWriteTarget } from './owner-target.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone } from './shared.js';

export function registerCrudRoutes(router: Router, ctx: MemoryRouteCtx): void {
  //  is no longer destructured here: identity for a write now comes from
  // resolveWriteTarget, which also decides whether the owner namespace was asked for.
  const { config, storage, memoryDb, stats, onDirectoryChange, peers } = ctx;

  // POST /v1/memory — write a memory entry (agent auth required)
  router.post('/v1/memory', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
    const { key, value, visibility, tags, ttl_hours, group_id, workspace_ref, workspace_refs, agent: agentParam, ai_provenance_id } = req.body ?? {};

    // Phase 2.3 — the organism.* access rule. It used to be run here by hand-driving the Express
    // middleware through a promise, because the key arrives in the body rather than in :key. The
    // rule now lives in services/organism-namespace-access.ts and writeMemoryRecord applies it
    // below, on this door and the MCP one alike, so this route needs no copy of it.

    // Ecosystem (GEAI) data-area allowlist: an organism deposit needs an owner-granted area.
    if (typeof key === 'string' && req.auth!.roles.includes('ecosystem')) {
      if (!(await ecoMayWriteKey(storage, req.auth!.sub, key))) {
        res.status(403).json(error(config.nodeId, 'DATA_AREA_DENIED', `Write to "${key}" is not permitted by this app's data-area allowlist`));
        return;
      }
    }

    const vis = visibility ?? 'private';
    // Opt-in per request: "write this under the OWNER, not me". Gated by memory:write-as-owner.
    const ownerScopeWrite = (req.body ?? {}).owner_scope === true;

    // Owner sessions use GHII identity (owner@nodeId) for memory storage. An agent lands under its
    // own GAII unless it asked for the owner namespace AND holds the scope (see owner-target.ts).
    const target = resolveWriteTarget(req, config, ownerScopeWrite);
    if ('deny' in target) {
      res.status(403).json(error(config.nodeId, target.deny.code, target.deny.message));
      return;
    }
    let gaii = target.gaii;

    // Reserved-key guard (DNA invariant #2): a role-'app' token (H-2 app grant) has sub = the owner's
    // GHII, so its memory:write lands in the owner's namespace — where the server reads openrouter.*
    // (the URL a decrypted AI key is sent to), ai-usage.* (the daily spend cap), and profile.* (public
    // directory + match inputs). A granted app must not poison those; the owner manages them via the
    // owner-only routes (/v1/openrouter/settings, /v1/ghii).
    if (typeof key === 'string' && !appMayWriteKey(req.auth!.roles, key, target.delegatedOwnerWrite, target.reservedAllowed)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
      return;
    }

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

    // Ownership on overwrite, the archive guard and all three memory ceilings moved to
    // services/memory-write.ts on 2026-08-11. They lived here, so a write over MCP had none of
    // them: no size limit, no key limit, no byte budget, and archiving held on one surface only.
    // The service reads  itself, so this route no longer fetches it twice either.

    // ONE implementation. services/memory-write.ts owns the schema lock, the version check, the
    // provenance stamp, the record shape and the change event — the same sequence the MCP tool runs,
    // because it is the same capability. What stays here is this door's own business: the quota
    // alarm and workspace pre-checks above, the replication enqueue and the envelope below.
    //
    // The scope gate is inside the service AS WELL as in this route's middleware. That is deliberate
    // belt-and-braces: requireScope('memory:write') is what an HTTP reader sees, and the service
    // check is what a future fourth door gets whether it remembers or not.
    const written = await writeMemoryRecord({
      storage, config, peers, emitResourceUpdated, emitResourceListChanged, onDirectoryChange, stats,
      fromAgent: req.auth!.roles.includes('agent'),
      ownerName: req.auth!.owner as string,
    }, {
      principal: gaii,
      targetGaii: gaii,
      scopes: req.auth!.scopes ?? [],
      roles: req.auth!.roles,
    }, {
      key,
      value,
      visibility: vis as MemoryRecord['visibility'],
      tags: Array.isArray(tags) ? tags : [],
      ttlHours: ttl_hours ?? null,
      ...(vis === 'group' && group_id ? { groupId: group_id } : {}),
      ...(vis === 'workspace' ? { workspaceRef: normalizeWorkspaceRefs(workspace_refs, workspace_ref) } : {}),
      declaredProvenanceId: ai_provenance_id,
      pipeline: 'memory.write',
      // This route always writes to the caller's own resolved identity, so there is no owner copy to
      // shadow and the check has nothing to find.
      ownerScoped: true,
    });
    if (!written.ok) {
      res.status(written.status).json(error(config.nodeId, written.code, written.message, written.status, written.details));
      return;
    }
    const record = written.record;

    res.status(existing ? 200 : 201).json(success(config.nodeId, {
      key: record.key,
      // WHERE it landed. Memory is keyed by the writer, and with owner_scope a caller can now put a
      // record somewhere other than its own namespace — so the response has to say which, or the one
      // thing the caller needs to know is the one thing it cannot see.
      owner_gaii: record.ownerGaii,
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
  router.get('/v1/memory/search', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
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

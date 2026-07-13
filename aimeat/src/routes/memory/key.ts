/**
 * @file src/routes/memory/key.ts
 * @description Per-key memory routes: GET/DELETE/PUT /v1/memory/:key, CORS management, and the public GET /v1/memory/:gaii/:key read. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router } from 'express';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { MemoryUpdateSchema, validateBody } from '../../models/schemas.js';
import { checkMemoryQuota, chargeOverage } from '../../services/quota.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { checkDeleteGuard } from '../../services/write-guards.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { enqueueMemoryReplication } from '../../services/memory-replication.js';
import { authorizeRead } from '../../services/access-guard.js';
import { emitChange } from '../../services/event-bus.js';
import { ecoMayReadKey, ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { getOwnerScopeMemory } from '../../services/owner-memory.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone } from './shared.js';

export function registerKeyRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, stats, peers, resolve, workspaceAccess } = ctx;

  // GET /v1/memory/:key — read a memory entry
  router.get('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), workspaceAccess, async (req, res) => {
    let gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    // Owner may target one of their own agents' keyspace via ?agent= (mirrors list/search).
    const agentParam = req.query.agent as string | undefined;
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (agentParam && agentParam !== gaii) {
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only read memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }

    // Ecosystem (GEAI) data-area allowlist (model A / strict): an organism read needs an owner-granted
    // `read` area — mirroring the write gate. Flat (own eco: namespace) keys pass through freely.
    if (req.auth!.roles.includes('ecosystem') && !(await ecoMayReadKey(storage, req.auth!.sub, key))) {
      res.status(403).json(error(config.nodeId, 'DATA_AREA_DENIED', `Read of "${key}" is not permitted by this app's data-area allowlist`));
      return;
    }

    // Owner sessions read across their owner-scope (GHII + agents + ecosystem apps), GHII-first —
    // the same broadening list/search use, so the profile Memory tab can lazy-load any listed key's
    // value (many are written under an agent's GAII, not the owner's GHII). ?owner_scope=true lets
    // other same-owner principals (app grants, agents) opt into the same set — mirroring the list
    // route's opt-in (same-owner-access invariant), e.g. a document's live aimeat-memory embed
    // reading a key an MCP agent wrote.
    const ownerScopeRead = (isOwnerSession || req.query.owner_scope === 'true') && !agentParam;
    let record = ownerScopeRead
      ? await getOwnerScopeMemory(storage, config.nodeId, req.auth!.owner, key)
      : await storage.getMemory(gaii, key);
    // On-read TTL check: if TTL has expired, treat as not found and delete
    if (record && record.ttlHours && record.ttlHours > 0) {
      const expiresAt = new Date(record.createdAt).getTime() + record.ttlHours * 3_600_000;
      if (Date.now() > expiresAt) {
        await storage.deleteMemory(record.ownerGaii, key);
        record = null;
      }
    }
    if (!record) {
      // Soft read: callers that treat absence as a normal empty state (UI preference
      // keys, optional config) pass ?soft=1 to get a 200 with a null value instead of a
      // 404. Avoids browser-console 404 noise for keys that legitimately may not exist yet.
      if (req.query.soft) {
        res.json(success(config.nodeId, { key, value: null, exists: false }));
        return;
      }
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

    // TARGET-009 S1/S3: an append-only workspace namespace (manifest create_only) refuses
    // .latest/.version deletes on every path — existing events can never be erased.
    const delGuard = await checkDeleteGuard(key, storage);
    if (!delGuard.valid) {
      res.status(409).json(error(config.nodeId, 'WRITE_CONFLICT', delGuard.errors?.[0]?.message ?? 'Delete refused by the workspace write guard', 409, { violations: delGuard.errors }));
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

    // Reserved-key guard (DNA invariant #2): apps may not overwrite server-trusted owner keys
    // (openrouter.*/ai-usage.*/profile.*). See utils/reserved-keys.ts.
    if (!appMayWriteKey(req.auth!.roles, key)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
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

    // Members data — readable by any authenticated user of this node. The check
    // MUST exclude the anonymous-mode shared identity: global optionalAuth injects
    // a truthy req.auth (anonymous: true) for unauthenticated visitors, so a bare
    // req.auth truthiness gate would leak members records to everyone.
    if (record.visibility === 'members') {
      const isAuthenticatedMember = !!req.auth && req.auth.anonymous !== true;
      if (isAuthenticatedMember) {
        stats?.increment('memory_reads');

        // Shared guard: audits the members read when the consent layer is enabled.
        await authorizeRead(storage, config, {
          ownerGaii: record.ownerGaii,
          accessorGaii: req.auth!.sub,
          resourceKey: key,
          visibility: 'members',
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
      // Anonymous (incl. the shared anonymous identity): behave like other
      // non-public records — 404, don't reveal existence.
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    // Non-public data: if consent is not enabled, fall back to old behavior (404)
    if (!config.consentEnabled) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    // Non-public data with consent enabled: shared guard decides + audits the attempt. For a
    // 'workspace' record the guard runs canReadWorkspace(record.workspaceRef) — thread the ref + the
    // accessor's sub/owner so a workspace member is recognised (parity with the storage-file /v1/pub path).
    const accessorGaii = req.auth?.sub ?? 'anonymous';
    const consentResult = await authorizeRead(storage, config, {
      ownerGaii: record.ownerGaii,
      accessorGaii,
      resourceKey: key,
      visibility: record.visibility,
      groupId: record.groupId,
      workspaceRef: record.workspaceRef,
      accessorSub: req.auth?.sub,
      accessorOwner: req.auth?.owner as string | undefined,
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
}

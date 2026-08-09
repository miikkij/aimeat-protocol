/**
 * @file src/routes/memory/patch.ts
 * @description PATCH /v1/memory/:key — apply a JSON Merge Patch (RFC 7386) to one record, so several
 *   principals can each own a subtree of the same key without losing each other's writes.
 *
 *   WHY THIS EXISTS. Until now the only way to be safe against a concurrent writer was to give every
 *   writer its own key. That is why a six-agent pipeline shards one edition into forty-four keys, and
 *   why a collector writes one key per item: not because the data wants that shape, but because a
 *   read-modify-write through POST /v1/memory is last-write-wins. The memory-key-shape audit
 *   (2026-08-09) measured the cost: 3,628 keys, 21% of the node's keyspace, in one-key-per-small-fact
 *   templates. Remove the race and the good shape becomes the easy one.
 *
 *   HOW IT IS SAFE. Read, merge, then compare-and-swap; on a losing swap, read again and re-merge.
 *   Two storage primitives make this exact rather than hopeful: `setMemoryIfVersion` (update only if
 *   the version still matches) covers every write after the first, and `createMemoryIfAbsent` (insert
 *   only if the key is still absent) covers the first, where there is no version to compare. The
 *   merge is recomputed from the freshly-read value on every attempt, so a writer that loses the race
 *   applies its subtree on top of the winner's rather than over it.
 *
 *   WHAT IT DELIBERATELY IS NOT. Not a lock, and not element-wise for arrays. An array in the patch
 *   replaces the array in the record, per RFC 7386; merging arrays by index would make two concurrent
 *   appends silently reorder each other, which is a worse bug than the one being fixed.
 * @structure registerPatchRoutes(router, ctx) -> PATCH /v1/memory/:key
 * @usage mounted from src/routes/memory.ts alongside registerCrudRoutes
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. Approved 2026-08-09 as the platform half of consolidating
 *     multi-writer pipelines (Sanomat: 44 keys per edition -> 2).
 */

import type { Router } from 'express';
import type { MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { checkMemoryQuota, chargeOverage } from '../../services/quota.js';
import { checkMemoryQuotaAlarm } from '../../services/quota-alarm.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { enqueueMemoryReplication } from '../../services/memory-replication.js';
import { logger } from '../../utils/logger.js';
import { emitChange, emitMemoryWritten } from '../../services/event-bus.js';
import { reconcileAfterSourceWrite } from '../../services/exchange-projection.js';
import { getActiveWorkflowEngine } from '../../services/workflow/engine.js';
import { emitEcosystemMemoryWrite } from '../../services/ecosystem-events.js';
import { runAutomationRecipesForWrite } from '../../services/ecosystem-automation.js';
import { ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { resolveWriteTarget } from './owner-target.js';
import { isKeyArchived } from '../../services/archive.js';
import { stampAgentWrite } from '../../services/ai-provenance.js';
import { applyMergePatch } from '../../utils/json-merge-patch.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone, memoryContentBytes } from './shared.js';

/**
 * How many times a losing writer re-reads and re-merges before giving up with a 409.
 *
 * Six is chosen against the real contention this was built for: a Sanomat edition has six writers,
 * so even in the worst case where all six collide on the same tick, each one only has to lose to the
 * others once. A pipeline that genuinely exceeds this is not contending, it is hammering, and a 409
 * that says so is more useful than a retry loop that hides it.
 */
const MAX_MERGE_ATTEMPTS = 6;

export function registerPatchRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, stats, peers, workspaceAccess } = ctx;

  router.patch('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), workspaceAccess, async (req, res) => {
    const key = req.params.key as string;
    const { patch, if_version, visibility, tags, ttl_hours } = req.body ?? {};

    // A merge patch must be an object. RFC 7386 says a scalar patch REPLACES the whole document,
    // which is a legal merge patch and a terrible thing to receive by accident on a shared record:
    // one malformed body would wipe every other writer's subtree. Callers that mean "replace" have
    // PUT and POST, which say so.
    if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'patch must be a JSON object. A scalar or array patch would replace the whole record — use PUT or POST to do that deliberately.'));
      return;
    }

    if (if_version !== undefined && (typeof if_version !== 'number' || !Number.isInteger(if_version) || if_version < 0)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'if_version must be a non-negative integer'));
      return;
    }

    // ── The same gate set POST /v1/memory runs, in the same order. Each is a shared function rather
    // than a copy, so a rule tightened for POST tightens here too. ──

    if (req.auth!.roles.includes('ecosystem') && !(await ecoMayWriteKey(storage, req.auth!.sub, key))) {
      res.status(403).json(error(config.nodeId, 'DATA_AREA_DENIED', `Write to "${key}" is not permitted by this app's data-area allowlist`));
      return;
    }

    const ownerScopeWrite = (req.body ?? {}).owner_scope === true;
    const target = resolveWriteTarget(req, config, ownerScopeWrite);
    if ('deny' in target) {
      res.status(403).json(error(config.nodeId, target.deny.code, target.deny.message));
      return;
    }
    const gaii = target.gaii;

    if (!appMayWriteKey(req.auth!.roles, key, target.delegatedOwnerWrite, target.reservedAllowed)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
      return;
    }

    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only write to keys prefixed with "anonymous."'));
      return;
    }

    if (key.startsWith('organism.')) {
      const guard = await isKeyArchived(storage, key);
      if (guard.archived) {
        res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${guard.level} is archived (read-only). Unarchive it before writing.`));
        return;
      }
    }

    const MAX_VALUE_SIZE = config.memoryMaxValueSizeKb * 1024;
    const now = new Date().toISOString();

    let record: MemoryRecord | null = null;
    let created = false;
    let lastConflictVersion: number | undefined;
    let overageMorsels = 0;
    let mergedSize = 0;
    let keyCountForAlarm: number | undefined;
    let bytesForAlarm = 0;

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS && !record; attempt++) {
      // Re-read on EVERY attempt. This is the whole point: a writer that lost the swap must merge its
      // subtree onto what the winner actually stored, not onto the stale copy it started from.
      const existing = await storage.getMemory(gaii, key);

      if (if_version !== undefined && (existing?.version ?? 0) !== if_version) {
        res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
          `Expected version ${if_version} but current is ${existing?.version ?? 0}`,
          409, { current_version: existing?.version ?? 0, your_version: if_version }));
        return;
      }

      if (existing?.archived) {
        res.status(409).json(error(config.nodeId, 'ARCHIVED', 'This record is archived (read-only). Unarchive it before writing.'));
        return;
      }
      if (existing && existing.ownerGaii !== gaii) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own memory records'));
        return;
      }

      const merged = applyMergePatch(existing?.value ?? {}, patch);

      mergedSize = Buffer.byteLength(JSON.stringify(merged), 'utf8');
      if (mergedSize > MAX_VALUE_SIZE) {
        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
          `Merged value size ${mergedSize} bytes exceeds limit of ${MAX_VALUE_SIZE} bytes. Split the record by a stable partition (a date, a period) rather than by writer.`));
        return;
      }

      if (!existing) {
        const keyCount = await storage.countMemory([gaii]);
        keyCountForAlarm = keyCount + 1;
        if (keyCount >= config.memoryMaxKeysPerAgent) {
          res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
            `Memory key limit reached (${config.memoryMaxKeysPerAgent}). One value may hold ${config.memoryMaxValueSizeKb} kB, so fold a set of small keys into one record holding an array or an object keyed by id, rather than deleting data.`));
          return;
        }
      }

      const existingSize = existing ? Buffer.byteLength(JSON.stringify(existing.value), 'utf8') : 0;
      const quotaCheck = await checkMemoryQuota(config, storage, gaii, mergedSize, existingSize);
      if (!quotaCheck.allowed) {
        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
        return;
      }
      overageMorsels = quotaCheck.overageMorsels;
      bytesForAlarm = quotaCheck.currentBytes - existingSize + mergedSize;

      // The MERGED value is what gets stored, so the merged value is what the schema must accept. A
      // patch that is individually harmless can still produce an invalid record.
      const validation = await validateMemoryWrite(key, merged, storage);
      if (!validation.valid) {
        res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED',
          'Merged value does not match the schema for this key', 422, {
          key, violations: validation.errors,
          schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
        }));
        return;
      }

      // Provenance is stamped against the MERGED bytes, because those are the bytes that end up
      // stored. A statement about only the patch would be a statement about something nobody can read
      // back. An existing record's id is dropped: the value changed, so the old statement is no longer
      // about these bytes (same rule as POST).
      const aiProvenanceId = await stampAgentWrite(storage, {
        principal: gaii,
        content: memoryContentBytes(merged),
        pipeline: 'memory.patch',
        surface: {
          visibility: (visibility ?? existing?.visibility ?? 'private') as MemoryRecord['visibility'],
          humanAudience: true,
        },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
      });

      // Metadata is patch-like too: omit visibility/tags/ttl and the record keeps what it had. A
      // writer that only owns one subtree has no business restating the whole record's visibility.
      const candidate: MemoryRecord = {
        key,
        ownerGaii: gaii,
        value: merged,
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
        visibility: (visibility ?? existing?.visibility ?? 'private') as MemoryRecord['visibility'],
        tags: Array.isArray(tags) ? tags : (existing?.tags ?? []),
        ttlHours: ttl_hours ?? existing?.ttlHours ?? null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(existing?.groupId ? { groupId: existing.groupId } : {}),
        ...(existing?.workspaceRef ? { workspaceRef: existing.workspaceRef } : {}),
      };

      if (existing) {
        if (!storage.setMemoryIfVersion) {
          res.status(501).json(error(config.nodeId, 'NOT_SUPPORTED', 'This storage backend cannot apply a merge patch safely (no compare-and-swap).'));
          return;
        }
        record = await storage.setMemoryIfVersion(candidate, existing.version);
        lastConflictVersion = existing.version;
      } else {
        if (!storage.createMemoryIfAbsent) {
          res.status(501).json(error(config.nodeId, 'NOT_SUPPORTED', 'This storage backend cannot create a record atomically (no insert-if-absent).'));
          return;
        }
        record = await storage.createMemoryIfAbsent(candidate);
        created = record !== null;
      }
      // record === null means another writer committed between the read and the swap. Loop: read the
      // value they stored and apply this patch on top of it.
    }

    if (!record) {
      res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
        `The record changed under ${MAX_MERGE_ATTEMPTS} merge attempts. Retry, or serialise the writers.`,
        409, { attempts: MAX_MERGE_ATTEMPTS, last_seen_version: lastConflictVersion }));
      return;
    }

    if (overageMorsels > 0) await chargeOverage(storage, gaii, overageMorsels, 'memory_overage');

    void checkMemoryQuotaAlarm(config, storage, gaii, {
      ...(keyCountForAlarm !== undefined ? { keyCount: keyCountForAlarm } : {}),
      usedBytes: bytesForAlarm,
    });

    if (peers) {
      enqueueMemoryReplication(gaii, key, config, storage, peers).catch(err => {
        logger.warn('memory patch: replication enqueue failed, leaving it to the scheduled sync', { key, error: String(err) });
      });
    }

    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (created) emitResourceListChanged(gaii);
    stats?.increment('memory_writes');
    emitMemoryWritten(gaii, key, created ? 'created' : 'updated');
    await reconcileAfterSourceWrite(storage, gaii, key);

    res.status(created ? 201 : 200).json(success(config.nodeId, {
      key: record.key,
      owner_gaii: record.ownerGaii,
      value: record.value,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      bytes: mergedSize,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Read this memory entry', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'Patch it again', method: 'PATCH', url: `/v1/memory/${encodeURIComponent(key)}`, example_body: { patch: { field: 'value' } } },
    ]));

    emitChange('memory');
    if (key.startsWith('organism.')) emitChange('organisms');
    getActiveWorkflowEngine()?.onMemoryWrite(gaii, key)
      .catch(e => logger.error('workflow event trigger (memory.patch) failed', { key, error: String(e) }));
    emitEcosystemMemoryWrite(storage, config, gaii, key)
      .catch(e => logger.error('ecosystem outbound (memory.patch) failed', { key, error: String(e) }));
    runAutomationRecipesForWrite(storage, config, gaii, key)
      .catch(e => logger.error('ecosystem automation recipe trigger failed', { key, error: String(e) }));
    if (req.auth!.roles.includes('agent') && !key.startsWith('onboarding.')) {
      void import('../../services/onboarding-funnel.js')
        .then(m => m.recordActivation(storage, config, req.auth!.owner, 'agent'))
        .catch(e => logger.warn('memory patch: activation marker is best-effort', { error: String(e) }));
    }
  });
}

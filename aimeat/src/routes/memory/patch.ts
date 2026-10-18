/**
 * @file src/routes/memory/patch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-18 — A patch that would raise the record past its label's audience cap is refused with 409
 *     LABEL_CAPS_AUDIENCE before the publish gate and the write (plan doc-mvdipuyqraas, L3.2).
 *   2026-10-18 — On a node that shows its content to signed-in accounts only, visibility 'public' on
 *     a record not public now is stored as 'members' with the warning PUBLIC_IS_SIGNED_IN_HERE, and
 *     the publish gate is not asked (services/closed-node-level.ts, plan V1.6).
 *   2026-10-18 — A PATCH that creates the record without a visibility takes visibility.memory_default
 *     (code default private; plan doc-mvcn6c7e4e5q, V5.1).
 *   2026-10-18 — visibility 'public' asks the publish gate: an agent without publish:public patches
 *     the record at the level it had and gets 202 with `publish_request` (plan doc-mvcn6c7e4e5q, V4.4).
 *   2026-10-17 — visibility 'organism:<id>' naming an organism the writer's account is not an active
 *     member of is refused with 400 NOT_ORGANISM_MEMBER before anything is read or written (plan
 *     doc-mvcn6c7e4e5q, V3.2).
 *   2026-10-16 — PATCH refuses a merge that changes an agent's live crew definition's browser site list
 *     unless the owner writes it in person (403 OWNER_APPROVES_SITES; QA audit F07b-02).
 *   v1.5.5 — 2026-10-12 — PATCH refuses a merged app tool manifest or offers document carrying the old
 *     morsel price with 400 MORSEL_PRICE_REMOVED from 4.0.0 (services/legacy-pacing-write.ts).
 *   v1.5.4 — 2026-10-11 — An `agents.` key that carries an identity where the agent's name belongs
 *     is refused with 400 AGENT_KEY_NOT_A_NAME (utils/agent-key-address.ts).
 *   v1.5.3 — 2026-10-11 — The `memory` change goes to the owner's streams when the record is one
 *     only its owner reads, before and after the patch (event-bus.ts emitRecordChange).
 *   v1.5.2 — 2026-10-08 — The provenance stamp names the caller (resolveIdentity), not the namespace
 *     the write lands in. With owner_scope the namespace is the owner's GHII, so an agent's PATCH into
 *     its owner's records was never stamped as model-written (aiprov E5).
 *   v1.5.1 — 2026-10-08 — The stamp states the merged value's medium (text or data).
 *   v1.5.0 — 2026-09-29 — The merged value is scheduled for write-time classification
 *     (services/classify-on-write.ts, TARGET-082 V3).
 *   v1.4.0 — 2026-09-29 — The answer echoes the value through presentMemory (TARGET-082).
 *   v1.3.1 — 2026-09-26 — The provenance record a merge stamps is stored only once its swap lands
 *     (secaudit 2026-09, N2). It was stored on every attempt, so each attempt that lost the swap left
 *     a record about bytes that were never stored.
 *   v1.3.0 — 2026-09-24 — PATCH refuses a key only the node writes (`__redirect__`) with RESERVED_KEY,
 *     whoever asks.
 *   v1.2.0 — 2026-09-16 — PATCH refuses openrouter.apikey and commerce.psp with SECRET_RECORD, and the
 *     answer shows a credential record redacted.
 *   v1.1.0 — 2026-09-13 — A workspace record in a space the manifest does not declare is refused
 *     with 422 UNDECLARED_SPACE before anything is written, as on every other write door. A merged
 *     EXCHANGE listing source whose changed text breaks an ODPS length cap answers 422 ODPS_FIELD_TOO_LONG.
 *   v1.0.0 — 2026-08-09 — Initial. Approved 2026-08-09 as the platform half of consolidating
 *     multi-writer pipelines (Sanomat: 44 keys per edition -> 2).
 */

import type { Router } from 'express';
import type { MemoryRecord, AiProvenanceRecordRow } from '../../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity, isForeignPrincipal, ownerGhiiOf } from '../../utils/gaii.js';
import { organismVisibilityRefusal } from '../../services/organism-visibility.js';
import { isRaiseToPublic } from '../../services/publish-gate.js';
import { memoryVisibilityDefault } from '../../services/content-defaults.js';
import { closedNodeLevel, type ClosedNodeWarning } from '../../services/closed-node-level.js';
import { signedInOnly } from '../../config-visibility.js';
import { publishAskOf, fileAsk, publishRequestedBody } from '../../services/publish-requests/ask.js';
import { callerOf } from '../../middleware/caller.js';
import { memoryCapRefusal } from '../../services/memory-publish-gate.js';
import { memoryTarget } from '../../services/classification/label-rows.js';
import { recordMemoryTouch } from '../../services/data-map/write-tally-buffer.js';
import { checkMemoryQuota, chargeOverage } from '../../services/quota.js';
import { checkMemoryQuotaAlarm } from '../../services/quota-alarm.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { enqueueMemoryReplication } from '../../services/memory-replication.js';
import { logger } from '../../utils/logger.js';
import { emitChange, emitMemoryWritten, emitRecordChange } from '../../services/event-bus.js';
import { reconcileAfterSourceWrite } from '../../services/exchange-projection.js';
import { getActiveWorkflowEngine } from '../../services/workflow/engine.js';
import { emitEcosystemMemoryWrite } from '../../services/ecosystem-events.js';
import { runAutomationRecipesForWrite } from '../../services/ecosystem-automation.js';
import { ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { crewSitesWriteRefusal } from '../../services/crew-def-store.js';
import { agentKeyRefusal } from '../../utils/agent-key-address.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../../services/secret-records.js';
import { presentMemory } from '../../services/classification/present-memory.js';
import { readerFor } from '../../services/classification/reader.js';
import { classifyAfterWrite } from '../../services/classify-on-write.js';
import { resolveWriteTarget } from './owner-target.js';
import { isKeyArchived } from '../../services/archive.js';
import { undeclaredSpaceForKey } from '../../services/workspace-write-items.js';
import { odpsWriteRefusal } from '../../services/exchange-odps-write.js';
import { legacyPacingWriteRefusal } from '../../services/legacy-pacing-write.js';
import { stampAgentWrite, storeHeldProvenance } from '../../services/ai-provenance.js';
import { applyMergePatch } from '../../utils/json-merge-patch.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone, memoryContentBytes } from './shared.js';
import { mediaKindOfValue } from '../../models/ai-provenance-schemas.js';

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

    // A key only the node writes is refused to everyone, the owner included (utils/reserved-keys.ts).
    // PATCH creates a key that is absent, so this is a create door as well as an update door.
    if (isServerWrittenKey(key)) {
      const refusal = serverWrittenKeyRefusal(key);
      res.status(403).json(error(config.nodeId, refusal.code, refusal.message));
      return;
    }
    // An `agents.` key names the agent by its name, never by its identity (utils/agent-key-address.ts).
    const misaddressed = agentKeyRefusal(key);
    if (misaddressed) {
      res.status(400).json(error(config.nodeId, misaddressed.code, misaddressed.message));
      return;
    }
    if (!appMayWriteKey(req.auth!.roles, key, target.delegatedOwnerWrite, target.reservedAllowed)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
      return;
    }
    // A record that holds a credential is shown redacted and written only by its own door.
    if (isSecretRecordKey(key)) {
      res.status(403).json(error(config.nodeId, 'SECRET_RECORD', secretRecordWriteRefusal(key).message));
      return;
    }

    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous agents can only write to keys prefixed with "anonymous."'));
      return;
    }
    // 'organism:<id>' names an organism the writer's account is an active member of: the rule
    // POST /v1/memory runs inside writeMemoryRecord (services/organism-visibility.ts).
    const audience = await organismVisibilityRefusal(storage, visibility, {
      identity: resolveIdentity(req.auth!, config.nodeId), federated: isForeignPrincipal(req.auth),
    });
    if (audience) {
      res.status(audience.status).json(error(config.nodeId, audience.code, audience.message));
      return;
    }
    // The label's audience cap (plan doc-mvdipuyqraas, L3.2), as POST asks it inside writeMemoryRecord:
    // before the publish gate and the write. A patch that names no visibility keeps the stored one.
    const capCaller = callerOf(req, config.nodeId, storage);
    const before = await storage.getMemory(gaii, key);
    const capped = await memoryCapRefusal({ storage, config }, capCaller, [memoryTarget(gaii, key)],
      visibility ?? before?.visibility ?? memoryVisibilityDefault(config), before?.visibility, 'PATCH /v1/memory');
    if (capped) {
      res.status(capped.status).json(error(config.nodeId, capped.code, capped.message));
      return;
    }
    // Making the record public asks the node's publish gate, as POST does inside writeMemoryRecord
    // (plan doc-mvcn6c7e4e5q, V4.4). On an ask the patch lands at the level the record had, and the
    // request is filed after it.
    // On a node that shows its content to signed-in accounts only no patch raises a record to public
    // (closed-node-level.ts), so the gate is not asked there.
    const publishAsk = visibility === 'public' && !signedInOnly(config)
      ? publishAskOf({ storage, config }, callerOf(req, config.nodeId, storage), req.auth!.app)
      : { kind: 'allowed' as const };
    if (publishAsk.kind === 'refused') {
      res.status(publishAsk.status).json(error(config.nodeId, publishAsk.code, publishAsk.message));
      return;
    }
    let askedToPublish = false;
    let closedWarning: ClosedNodeWarning | null = null;

    if (key.startsWith('organism.')) {
      const guard = await isKeyArchived(storage, key);
      if (guard.archived) {
        res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${guard.level} is archived (read-only). Unarchive it before writing.`));
        return;
      }
      // A workspace record in a space the manifest does not declare is refused on every door
      // (services/workspace-write-items.ts, decided 2026-09-13).
      const undeclared = await undeclaredSpaceForKey(storage, key, { audience: req.auth!.roles.includes('ecosystem') ? 'writer' : 'member' });
      if (undeclared) {
        res.status(undeclared.status).json(error(config.nodeId, undeclared.code, undeclared.message, undeclared.status, undeclared.details));
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
    // The provenance record of the attempt in hand, HELD until its swap lands and stored only then
    // (below the loop). An attempt that loses the swap drops its own: the store is append-only, so a
    // record about bytes that never landed could not be taken back (secaudit 2026-09, N2).
    let held: AiProvenanceRecordRow[] = [];
    // Who could read the record before this patch; a patch may move its visibility, and those who
    // could read it until now are told it changed (event-bus.ts emitRecordChange).
    let priorVisibility: string | undefined;

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS && !record; attempt++) {
      held = [];
      // Re-read on EVERY attempt. This is the whole point: a writer that lost the swap must merge its
      // subtree onto what the winner actually stored, not onto the stale copy it started from.
      const existing = await storage.getMemory(gaii, key);
      priorVisibility = existing?.visibility;
      // A closed node stores a raise to public at 'members' and says so (plan V1.6), before the gate.
      const closed = closedNodeLevel(config, visibility, 'members' as const, { from: existing?.visibility });
      closedWarning = closed.warning;
      askedToPublish = publishAsk.kind === 'ask' && isRaiseToPublic(existing?.visibility, closed.level);
      const wantVisibility = askedToPublish ? undefined : closed.level;
      // The level the patched record ends at: the one named, else the one it had, else (a new record)
      // the node's starting level (plan V5.1); a new record held back by the publish gate is private.
      const levelAfter = (wantVisibility ?? existing?.visibility
        ?? (askedToPublish ? 'private' : memoryVisibilityDefault(config))) as MemoryRecord['visibility'];

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
      // An EXCHANGE listing source whose changed text would break an ODPS length cap (2026-09-13).
      const odps = odpsWriteRefusal(key, merged, existing?.value);
      if (odps) { res.status(odps.status).json(error(config.nodeId, odps.code, odps.message, odps.status, odps.details)); return; }
      const legacyPacing = legacyPacingWriteRefusal(key, merged);
      if (legacyPacing) { res.status(legacyPacing.status).json(error(config.nodeId, legacyPacing.code, legacyPacing.message)); return; }
      // The live crew definition's browser site list is the owner's to change, in person (QA audit F07b-02).
      const sites = await crewSitesWriteRefusal(storage, key, gaii, merged, req.auth!);
      if (sites) { res.status(403).json(error(config.nodeId, 'OWNER_APPROVES_SITES', sites)); return; }

      // Provenance is stamped against the MERGED bytes, because those are the bytes that end up
      // stored. A statement about only the patch would be a statement about something nobody can read
      // back. An existing record's id is dropped: the value changed, so the old statement is no longer
      // about these bytes (same rule as POST).
      // The WRITER, never the namespace: with owner_scope `gaii` is the owner's GHII, which is never
      // stamped, so an agent writing into its owner's records came out as a person's writing.
      const aiProvenanceId = await stampAgentWrite(storage, {
        principal: resolveIdentity(req.auth!, config.nodeId),
        content: memoryContentBytes(merged),
        mediaKind: mediaKindOfValue(merged),
        pipeline: 'memory.patch',
        surface: {
          visibility: levelAfter,
          humanAudience: true,
        },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
        held,
      });

      // Metadata is patch-like too: omit visibility/tags/ttl and the record keeps what it had. A
      // writer that only owns one subtree has no business restating the whole record's visibility.
      const candidate: MemoryRecord = {
        key,
        ownerGaii: gaii,
        value: merged,
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
        visibility: levelAfter,
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
    // Landed: the record the stored value names is stored now, before anything below announces it.
    await storeHeldProvenance(storage, held);
    // Write-time classification of the merged value (TARGET-082 V3): scheduled, never awaited.
    classifyAfterWrite({ storage, config }, gaii, key, record.value);

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

    // `gaii` is where it LANDED — an owner-scope write redirects it — so the hand is resolved from
    // the session instead, which is the only thing that names who actually did this.
    recordMemoryTouch({
      ownerGaii: gaii, key, writerPrincipal: resolveIdentity(req.auth!, config.nodeId), kind: 'write',
    });

    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (created) emitResourceListChanged(gaii);
    stats?.increment('memory_writes');
    emitMemoryWritten(gaii, key, created ? 'created' : 'updated');
    await reconcileAfterSourceWrite(storage, gaii, key);

    // The request the publish gate asked for, now that the record it names is stored.
    let publishRequest: ReturnType<typeof publishRequestedBody> | undefined;
    let publishWarning: { code: 'PUBLISH_NOT_ASKED'; message: string } | undefined;
    if (askedToPublish && publishAsk.kind === 'ask') {
      const filed = await fileAsk({ storage, config }, ownerGhiiOf(gaii), publishAsk.requester, {
        kind: 'memory', target: { namespace: gaii, key: record.key, version: record.version },
        title: `the record ${record.key}`, name: record.key,
        change: { field: 'visibility', from: record.visibility, to: 'public' },
      });
      if (filed.ok) publishRequest = publishRequestedBody({ storage, config }, filed);
      else publishWarning = { code: 'PUBLISH_NOT_ASKED', message: `Saved as ${record.visibility}, not public: ${filed.message}` };
    }

    res.status(publishRequest ? 202 : created ? 201 : 200).json(success(config.nodeId, {
      ...(publishRequest ? { publish_request: publishRequest } : {}),
      ...(publishWarning || closedWarning ? { warnings: [publishWarning, closedWarning].filter(w => !!w) } : {}),
      key: record.key,
      owner_gaii: record.ownerGaii,
      // Echoed through the one presentation of a memory value; null when this caller may not see it.
      value: (await presentMemory(readerFor({ storage, config }, req.auth), record))?.value ?? null,
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

    emitRecordChange('memory', record.ownerGaii, record.visibility, ...(priorVisibility ? [priorVisibility] : []));
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

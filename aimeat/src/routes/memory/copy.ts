/**
 * @file src/routes/memory/copy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/memory/copy: copy a public memory record of another identity into the
 *   caller's own memory. Extracted from src/routes/memory/bulk.ts (max-file-lines); the route's history
 *   up to 2026-10-17 is in that file's header.
 * @structure registerCopyRoute(router, ctx)
 * @usage registerCopyRoute(router, ctx)   // from registerBulkRoutes, at the position the route had
 * @version-history
 *   v1.2.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, a copy asked
 *     public lands at 'members' with the warning PUBLIC_IS_SIGNED_IN_HERE, before the publish gate
 *     (services/closed-node-level.ts, plan V1.6).
 *   v1.1.0 — 2026-10-18 — The copy asks the publish gate (services/memory-publish-gate.ts, the gate
 *     POST /v1/memory asks): a copy made public by a caller the node asks the owner about lands at the
 *     level the caller's record had (a new one: private) and answers 202 with `publish_request`; a
 *     caller with nobody on this node to ask is refused with 403 PUBLISH_NOT_ALLOWED (plan
 *     doc-mvcn6c7e4e5q, V4).
 *   v1.0.0 — 2026-10-18 — Extracted from src/routes/memory/bulk.ts (max-file-lines).
 */

import type { Router } from 'express';
import type { MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { recordMemoryTouch } from '../../services/data-map/write-tally-buffer.js';
import { checkMemoryQuota } from '../../services/quota.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { emitRecordChange } from '../../services/event-bus.js';
import { isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { agentKeyRefusal } from '../../utils/agent-key-address.js';
import { presentMemory } from '../../services/classification/present-memory.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { carryLabelToCopy, CopyLabelError } from '../../services/classification-exits.js';
import { ownDoorRefusal } from '../../utils/own-door-keys.js';
import { odpsWriteRefusal } from '../../services/exchange-odps-write.js';
import { legacyPacingWriteRefusal } from '../../services/legacy-pacing-write.js';
import { crewSitesWriteRefusal } from '../../services/crew-def-store.js';
import { classifyAfterWrite } from '../../services/classify-on-write.js';
import { isForeignPrincipal } from '../../utils/gaii.js';
import { organismVisibilityRefusal } from '../../services/organism-visibility.js';
import { isRaiseToPublic } from '../../services/publish-gate.js';
import { keptMemoryLevel, fileMemoryPublishRequest } from '../../services/memory-publish-gate.js';
import { organismWriteRefusalFor, routePublishAsk } from './batch-guards.js';
import { closedNodeLevel, closedNodeWarnings } from '../../services/closed-node-level.js';
import { type MemoryRouteCtx } from './shared.js';

export function registerCopyRoute(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, resolve } = ctx;
  const organismWriteRefusal = organismWriteRefusalFor(ctx);

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
    // ONE CAPABILITY, ONE DOOR: a copy would hand a Design Book part over as the caller's own, past the
    // Book's own door, which benches a component again before it hands one out (utils/own-door-keys.ts).
    const ownDoor = ownDoorRefusal(source_gaii, key, config.nodeId);
    if (ownDoor) {
      res.status(403).json(error(config.nodeId, ownDoor.code, ownDoor.message, 403, { door: ownDoor.door }));
      return;
    }
    // The porting path writes its pointer as a PUBLIC record, so this door could copy another
    // identity's into the caller's own namespace under the same key. Refused like every write door.
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
    // The copy lands under the caller's own name with the source's key, so an organism key is a
    // write into that organism like any other, and gets the organism rule's answer.
    const orgRefusal = await organismWriteRefusal(req, callerGaii, key);
    if (orgRefusal) {
      res.status(orgRefusal.status).json(error(config.nodeId, orgRefusal.code, orgRefusal.message));
      return;
    }
    // A copy made visible to one organism names an organism the caller's account is a member of.
    const audience = await organismVisibilityRefusal(storage, targetVis, { identity: callerGaii, federated: isForeignPrincipal(req.auth) });
    if (audience) {
      res.status(audience.status).json(error(config.nodeId, audience.code, audience.message));
      return;
    }

    // A copy is a read first: public only, then the one presentation of a memory value (the
    // classification reader and the credential mask), so a record this caller may not see answers
    // 404 exactly as an absent one (TARGET-082 review).
    const stored = await storage.getMemory(source_gaii, key);
    const sourceRecord = stored && stored.visibility === 'public'
      ? await presentMemory(readerFor({ storage, config }, req.auth), stored) : null;
    if (!stored || !sourceRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public memory entry not found'));
      return;
    }

    // A schema lock holds on the copy as on every other write: the copy lands under the caller's own
    // key, so it is validated against the schema that key falls under (feature-list audit #51).
    const copyValidation = await validateMemoryWrite(key, sourceRecord.value, storage);
    if (!copyValidation.valid) {
      res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED',
        'The copied value does not match the schema locked on this key. Read the schema at schema_url; the copy is stored only when the value matches it.', 422, {
          key,
          violations: copyValidation.errors,
          schema_url: `/v1/memory/${encodeURIComponent(copyValidation.schemaKey!)}/schema`,
        }));
      return;
    }

    const sourceBytes = Buffer.byteLength(JSON.stringify(sourceRecord.value), 'utf8');
    const quotaCheck = await checkMemoryQuota(config, storage, callerGaii, sourceBytes);
    if (!quotaCheck.allowed) {
      // 413, the status every other memory write answers for the same condition (DATA-26): 429 is a
      // rate limit, which a client retries after a wait, and a full quota does not empty with time.
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    const now = new Date().toISOString();
    const existing = await storage.getMemory(callerGaii, key);
    const odps = odpsWriteRefusal(key, sourceRecord.value, existing?.value);
    if (odps) { res.status(odps.status).json(error(config.nodeId, odps.code, odps.message, odps.status, odps.details)); return; }
    const legacyPacing = legacyPacingWriteRefusal(key, sourceRecord.value);
    if (legacyPacing) { res.status(legacyPacing.status).json(error(config.nodeId, legacyPacing.code, legacyPacing.message)); return; }
    const sites = await crewSitesWriteRefusal(storage, key, callerGaii, sourceRecord.value, req.auth!);
    if (sites) { res.status(403).json(error(config.nodeId, 'OWNER_APPROVES_SITES', sites)); return; }
    const newVersion = existing ? existing.version + 1 : 1;

    // The publish gate (plan doc-mvcn6c7e4e5q, V4), as POST /v1/memory asks it: a copy that makes the
    // caller's record public, by a caller the node asks the owner about, lands at the level the record
    // had (a new one: private) and the request is filed after the write.
    // Before it, the closed node (plan V1.6): a copy made public there lands at 'members' and says so.
    const closed = closedNodeLevel(config, (targetVis as MemoryRecord['visibility']) || 'private', 'members' as const, { from: existing?.visibility });
    let level: Pick<MemoryRecord, 'visibility' | 'groupId' | 'workspaceRef'> = { visibility: closed.level };
    let requester: Extract<ReturnType<typeof routePublishAsk>, { kind: 'ask' }>['requester'] | null = null;
    if (isRaiseToPublic(existing?.visibility, level.visibility)) {
      const ask = routePublishAsk({ storage, config }, req);
      if (ask.kind === 'refused') {
        res.status(ask.status).json(error(config.nodeId, ask.code, ask.message));
        return;
      }
      if (ask.kind === 'ask') {
        requester = ask.requester;
        const kept = keptMemoryLevel(existing);
        level = { visibility: kept.visibility, ...(kept.groupId ? { groupId: kept.groupId } : {}), ...(kept.workspaceRef ? { workspaceRef: kept.workspaceRef } : {}) };
      }
    }

    // The copy keeps its source's classification (never lower), set before the bytes land so the
    // copy is never readable under a lower label. A label the copy's policy lacks refuses the copy.
    let carried: string | null;
    try {
      carried = (await carryLabelToCopy({ storage, config }, memoryTarget(stored.ownerGaii, key), memoryTarget(callerGaii, key))).carried;
    } catch (err) {
      if (!(err instanceof CopyLabelError)) throw err;
      res.status(403).json(error(config.nodeId, err.code, err.message));
      return;
    }

    await storage.setMemory({
      key,
      ownerGaii: callerGaii,
      value: sourceRecord.value,
      ...level,
      tags: sourceRecord.tags || [],
      ttlHours: null,
      version: newVersion,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    recordMemoryTouch({ ownerGaii: callerGaii, key, writerPrincipal: callerGaii, kind: 'write' });
    // Write-time classification of the copy (TARGET-082 V3): scheduled, never awaited.
    classifyAfterWrite({ storage, config }, callerGaii, key, sourceRecord.value);

    emitResourceUpdated(callerGaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(callerGaii);

    // The request the gate asked for, now that the copy it names is stored.
    const filed = requester
      ? await fileMemoryPublishRequest({ storage, config }, requester, { ownerGaii: callerGaii, key, version: newVersion, visibility: level.visibility })
      : null;

    res.status(filed?.ok ? 202 : 200).json(success(config.nodeId, {
      ...(filed?.ok ? { publish_request: filed.publishRequest } : {}),
      key,
      copied_from: source_gaii,
      version: newVersion,
      visibility: level.visibility,
      ...(carried ? { classification: carried } : {}),
      ...(filed && !filed.ok ? { warnings: [filed.warning] } : closedNodeWarnings(closed.warning)),
    }));
    emitRecordChange('memory', callerGaii, level.visibility, ...(existing ? [existing.visibility] : []));
  });
}

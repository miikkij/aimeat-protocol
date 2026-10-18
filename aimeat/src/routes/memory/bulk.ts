/**
 * @file src/routes/memory/bulk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Bulk + cross-user memory routes: export, import, bulk-delete, bundle (ZIP), discover, copy. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-18 — An entry that would raise its record past its label's audience cap fails with
 *     LABEL_CAPS_AUDIENCE before the batch stores anything (plan doc-mvdipuyqraas, L3.2).
 *   2026-10-18 — On a node that shows its content to signed-in accounts only, an entry of POST
 *     /v1/memory/bulk or POST /v1/memory/import asked public is stored at 'members' with a
 *     PUBLIC_IS_SIGNED_IN_HERE warning naming its key, and is never refused by the publish gate
 *     (services/memory-batch-write.ts, services/closed-node-level.ts; plan V1.6).
 *   2026-10-18 — An entry of POST /v1/memory/bulk or POST /v1/memory/import without a visibility takes
 *     visibility.memory_default (code default private; plan doc-mvcn6c7e4e5q, V5.1).
 *   2026-10-18 — POST /v1/memory/bulk and POST /v1/memory/import ask the publish gate, the gate
 *     POST /v1/memory asks (services/memory-publish-gate.ts; plan doc-mvcn6c7e4e5q, V4): an entry that
 *     raises its record to public, by a caller the node asks the owner about, lands at the level the
 *     record had (a new one: private) and gets its own request; the answer lists them under
 *     `publish_requests` and is 202 when any was filed. A caller with nobody on this node to ask gets
 *     such an entry under failed[] with PUBLISH_NOT_ALLOWED. POST /v1/memory/copy moved to
 *     routes/memory/copy.ts by pure extraction (max-file-lines) and is registered from here.
 *   2026-10-17 — POST /v1/memory/bulk and POST /v1/memory/copy take visibility 'organism:<id>' and
 *     refuse one naming an organism the writer's account is not an active member of
 *     (services/organism-visibility.ts; plan doc-mvcn6c7e4e5q, V3.2).
 *   2026-10-16 — Comment only: POST /v1/memory/bulk-delete puts each key in the bin; the comment said
 *     it removed them for good (invariant 8 review, ruled by the developer on 2026-10-16).
 *   2026-10-16 — Bulk, import and copy refuse an entry that changes an agent's live crew definition's browser
 *     site list unless the owner writes it in person (OWNER_APPROVES_SITES; QA audit F07b-02).
 *   2026-10-16 — POST /v1/memory/bulk refuses an entry whose visibility the single write refuses (visibilityRefusal, batch-guards.ts): workspace and unknown words fail that entry instead of being stored (QA audit list review).
 *   2026-10-15 — Copy validates the copied value against the schema lock of its key (validateMemoryWrite, as the memory write does) and answers 422 SCHEMA_VALIDATION_FAILED (feature-list audit #51).
 *   v1.14.0 — 2026-10-13 — Import, copy and bulk-delete hand the session's scopes to the fenced-space
 *     rule, and import hands it each entry's value: a session that covers organism:direct writes a
 *     record space that names extensions directly, and a write or removal of a workspace's manifest
 *     record that changes a fenced space's list is refused to an agent without that word (ruled by
 *     the developer on 2026-10-13).
 *   v1.13.0 — 2026-10-13 — bulk-delete asks the fenced-space rule (services/fenced-space.ts) for the
 *     `organism.` keys it would remove and refuses the whole request before the first delete: a
 *     record space that names extensions takes an agent's delete only through one of them (ruled by
 *     the developer on 2026-10-13). Import and copy get the rule from the organism rule they ask.
 *   v1.12.1 — 2026-10-12 — The bulk write, the batch and the copy refuse an app tool manifest or offers
 *     document carrying the old morsel price from 4.0.0 (services/legacy-pacing-write.ts).
 *   v1.12.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): memory:read on GET /v1/memory/discover. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   v1.11.7 — 2026-10-12 — Copy over the memory quota answers 413 QUOTA_EXCEEDED, as every other write does; it answered 429 (Core 2026-11 DATA-26).
 *   v1.11.6 — 2026-10-11 — Copy refuses an `agents.` key that carries an identity where the agent's name belongs (400 AGENT_KEY_NOT_A_NAME); bulk and import refuse it through batchKeyRefusal.
 *   v1.11.5 — 2026-10-11 — The four `memory` changes are scoped to the owner when every record written or deleted is one only its owner reads (event-bus.ts emitRecordChange).
 *   v1.11.4 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.11.3 — 2026-10-05 — The bundle passes a file's workspace binding to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.11.2 — 2026-10-05 — discover passes the config, so the listing leaves out an organism record
 *     kept inside its organism (services/memory-discover.ts, secaudit 2026-10, DATA-3).
 *   v1.11.1 — 2026-10-02 — export takes the caller's identity from resolve(req), as bulk, import and
 *     bulk-delete do, instead of the raw `sub` (Semgrep owner-data-must-resolve-identity, alert 1683).
 *   v1.11.0 — 2026-09-29 —TARGET-082 review: export and bundle pass leave() with the destination
 *     `export` after show(), so an organism's record held under the person's name stays behind; the
 *     export answers `left_out` and the bundle's manifest says `classified` per item. copy reads the
 *     source through presentMemory (hidden answers 404 like a read) and carries the source's label
 *     onto the copy, never lower (services/classification-exits.ts carryLabelToCopy).
 *   v1.10.0 — 2026-09-29 — bulk-delete leaves a service-owned key (the classification policy) in
 *     place, and refuses one named in `keys` with 403 RESERVED_KEY (TARGET-082 review finding 2).
 *     bulk, import and copy already refuse it through isServerWrittenKey.
 *   v1.9.0 — 2026-09-29 — copy schedules write-time classification of the copied value (TARGET-082
 *     V3); bulk and import get it from services/memory-batch-write.ts.
 *   v1.8.0 — 2026-09-29 — Export and bundle pass the classification reader (TARGET-082): memory values
 *     through presentMemories, files through reader.show.
 *   v1.7.0 — 2026-09-26 — copy refuses a Design Book part with 403 DESIGN_BOOK_PART, naming
 *     GET /v1/designbook/:id, the one door that reads a part (utils/own-door-keys.ts).
 *   v1.6.0 — 2026-09-26 — import and copy ask the organism rule (services/organism-namespace-access.ts)
 *     for an `organism.*` key, as the shared writer does for every other write door; import lists a
 *     refused entry under failed[] with its code (secaudit 2026-09, A6-9).
 *   v1.5.0 — 2026-09-24 — bulk, import and copy refuse a key only the node writes (`__redirect__`),
 *     whoever asks.
 *   v1.4.1 — 2026-09-16 — Export and bundle show a credential record redacted; bulk and import refuse
 *     openrouter.apikey and commerce.psp.
 *   v1.4.0 — 2026-09-16 — export and bundle refuse a federated session (requireLocalSession). Both read
 *     the bare owner name, which a visitor shares with the local account of the same name.
 *   v1.3.0 — 2026-09-13 — import lists a workspace record in a space the manifest does not declare
 *     under failed[] with UNDECLARED_SPACE instead of writing it, as every other write door refuses it.
 *     bulk, import and copy refuse an EXCHANGE listing source whose changed text breaks an ODPS cap.
 *   v1.2.0 — 2026-09-08 — export with ?agent is an owner-session door like its three neighbours;
 *     an agent could export a sibling's keyspace by naming it.
 *   v1.1.0 — 2026-08-10 — Security audit H-11: export and bundle enforce memory:read, matching the
 *     list and single-key reads. They returned full values to any token in the owner bucket.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router } from 'express';
import { ZipArchive } from 'archiver';
import type { MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireScope, requireExternalPrincipal, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { recordMemoryTouch } from '../../services/data-map/write-tally-buffer.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { emitMemoryWritten, emitRecordChange } from '../../services/event-bus.js';
import { isServiceOwnedKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { presentMemories, presentMemory } from '../../services/classification/present-memory.js';
import { readerFor } from '../../services/classification/reader.js';
import { fileTarget } from '../../services/classification/labels.js';
import { leaveMemories } from '../../services/classification-exits.js';
import { undeclaredSpaceForKey } from '../../services/workspace-write-items.js';
import { fencedKeysRefusal } from '../../services/fenced-space.js';
import { callerOf } from '../../middleware/caller.js';
import { odpsWriteRefusal } from '../../services/exchange-odps-write.js';
import { legacyPacingWriteRefusal } from '../../services/legacy-pacing-write.js';
import { crewSitesWriteRefusal } from '../../services/crew-def-store.js';
import type { BulkWriteItem } from '../../services/db/memory-db-service.js';
import { type MemoryRouteCtx } from './shared.js';
import { logger } from '../../utils/logger.js';
import {
  batchKeyRefusal, storageReferenceRefusal, visibilityRefusal, organismWriteRefusalFor, routePublishAsk, batchPublishAnswer,
  batchCapRefusalFor,
} from './batch-guards.js';
import { registerCopyRoute } from './copy.js';
import { writeMemoryBatch } from '../../services/memory-batch-write.js';
import { isKeyArchived } from '../../services/archive.js';
import { isOwnerInPerson, isForeignPrincipal } from '../../utils/gaii.js';
import { organismVisibilityRefusal } from '../../services/organism-visibility.js';
import { discoverMemory } from '../../services/memory-discover.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { memoryVisibilityDefault } from '../../services/content-defaults.js';
import { signedInOnly } from '../../config-visibility.js';

export function registerBulkRoutes(router: Router, ctx: MemoryRouteCtx): void {
  // Data-access redesign (Phase 1): the batched write/import + owner-scope reads run through the
  // Application-DB-Service (ctx.memoryDb) so each is ONE operation (batched reads + bulk upsert).
  const { config, storage, stats, resolve, memoryDb } = ctx;

  // The organism rule for a key this file writes (batch-guards.ts organismWriteRefusalFor).
  const organismWriteRefusal = organismWriteRefusalFor(ctx);

  // POST /v1/memory/bulk — write MANY entries in one request (agent auth). Net-new batched write: the
  // service batches the existing-key lookup + byte-sum + key-count and commits the valid rows together,
  // enforcing the SAME per-value-size / key-count / total-quota limits + schema validation as the single
  // POST /v1/memory (overage-morsel charging excluded — an over-quota entry fails). Scope guards: this
  // path is for the caller's OWN flat keyspace — `organism.*` keys (workspace-guarded) and ecosystem
  // principals go through their dedicated guarded paths and are refused here.
  router.post('/v1/memory/bulk', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), async (req, res) => {
    const body = req.body ?? {};
    const rawEntries = Array.isArray(body.entries) ? body.entries : null;
    if (!rawEntries) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'entries array is required'));
      return;
    }
    if (rawEntries.length > 1000) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A bulk write may contain at most 1000 entries'));
      return;
    }
    if (req.auth!.roles.includes('ecosystem')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', "An app of this kind writes through its own area rather than here. Use the app's own way of saving."));
      return;
    }
    const mode = body.mode === 'skip' ? 'skip' : 'overwrite';

    // Resolve the target identity (owner sessions may target one of their agents via ?agent / body.agent).
    let gaii = resolve(req);
    const agentParam = body.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      const isOwnerSession = isOwnerInPerson(req.auth);
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may bulk-write under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only write memory to your own agents'));
        return;
      }
      gaii = agentParam;
    }

    // Per-item protocol guards (mirror POST /v1/memory): drop bad entries into the failed list rather than
    // aborting; the survivors go to the service. organism.* keys are refused (Phase 2 workspace path).
    const items: BulkWriteItem[] = [];
    const preFailed: { key: string; status: 'failed'; reason: string }[] = [];
    // The publish gate, asked once for the caller (batch-guards.ts routePublishAsk): which entries
    // raise their record to public is decided by the batch write, which reads what each key holds.
    const publishAsk = routePublishAsk({ storage, config }, req);
    const capRefusal = batchCapRefusalFor({ storage, config }, req, 'POST /v1/memory/bulk');
    for (const e of rawEntries) {
      const key = e?.key;
      if (typeof key !== 'string' || !key) { preFailed.push({ key: String(key), status: 'failed', reason: 'missing key' }); continue; }
      if (key.startsWith('organism.')) { preFailed.push({ key, status: 'failed', reason: 'organism.* keys use the workspace publish path' }); continue; }
      const keyRefusal = batchKeyRefusal(req.auth!.roles, gaii, key);
      if (keyRefusal) { preFailed.push({ key, status: 'failed', reason: keyRefusal }); continue; }
      // An EXCHANGE listing source past an ODPS cap, compared with what is stored (2026-09-13).
      if (odpsWriteRefusal(key, e.value, undefined)) {
        const odps = odpsWriteRefusal(key, e.value, (await storage.getMemory(gaii, key))?.value);
        if (odps) { preFailed.push({ key, status: 'failed', reason: `${odps.code}: ${odps.message}` }); continue; }
      }
      const legacyPacing = legacyPacingWriteRefusal(key, e.value);
      if (legacyPacing) { preFailed.push({ key, status: 'failed', reason: `${legacyPacing.code}: ${legacyPacing.message}` }); continue; }
      // The live crew definition's browser site list is the owner's to change, in person (QA audit F07b-02).
      const sites = await crewSitesWriteRefusal(storage, key, gaii, e.value, req.auth!);
      if (sites) { preFailed.push({ key, status: 'failed', reason: `OWNER_APPROVES_SITES: ${sites}` }); continue; }
      // storage_ref integrity (parity with the single POST /v1/memory): a value pointing at a stored file
      // must name an existing one. The getStorageFile lookup runs ONLY for storage_ref entries, so a
      // normal bulk write (no storage_refs) pays nothing.
      const refRefusal = await storageReferenceRefusal(storage, gaii, e.value);
      if (refRefusal) { preFailed.push({ key, status: 'failed', reason: refRefusal }); continue; }
      // The single write's visibilities and no others. `workspace` was taken here and stored a record
      // with no workspace on it; an unknown word was turned into private without a word.
      const visRefusal = visibilityRefusal(e.visibility);
      if (visRefusal) { preFailed.push({ key, status: 'failed', reason: visRefusal }); continue; }
      // 'organism:<id>' names an organism the writer's account is an active member of (the single write's rule).
      const audience = await organismVisibilityRefusal(storage, e.visibility, { identity: resolve(req), federated: isForeignPrincipal(req.auth) });
      if (audience) { preFailed.push({ key, status: 'failed', reason: `${audience.code}: ${audience.message}` }); continue; }
      // Making a record public, by a caller with nobody on this node to ask: that entry is refused.
      // A closed node stores it at 'members' instead (services/memory-batch-write.ts), so it asks nothing.
      if (publishAsk.kind === 'refused' && e.visibility === 'public' && !signedInOnly(config) && (await storage.getMemory(gaii, key))?.visibility !== 'public') {
        preFailed.push({ key, status: 'failed', reason: `${publishAsk.code}: ${publishAsk.message}` }); continue;
      }
      // A level wider than the record's label allows: that entry is refused (plan doc-mvdipuyqraas, L3.2).
      const capped = await capRefusal(gaii, key, e.visibility ?? memoryVisibilityDefault(config));
      if (capped) { preFailed.push({ key, status: 'failed', reason: capped }); continue; }
      items.push({
        key,
        value: e.value,
        // No visibility named: the node's starting level (plan V5.1).
        visibility: (e.visibility ?? memoryVisibilityDefault(config)) as MemoryRecord['visibility'],
        tags: Array.isArray(e.tags) ? e.tags : [],
        ttlHours: typeof e.ttl_hours === 'number' ? e.ttl_hours : null,
        ...(e.group_id ? { groupId: e.group_id } : {}),
      });
    }

    const result = await writeMemoryBatch({ storage, config, memoryDb }, {
      principal: resolve(req), targetGaii: gaii,
      ...(publishAsk.kind === 'ask' ? { publishRequester: publishAsk.requester } : {}),
    }, items, {
      mode,
      quota: {
        maxKeysPerOwner: config.memoryMaxKeysPerAgent,
        maxValueSizeBytes: config.memoryMaxValueSizeKb * 1024,
        totalQuotaBytes: config.memoryQuotaMb * 1024 * 1024,
      },
      validate: (key, value) => validateMemoryWrite(key, value, storage),
    }, 'bulk');

    // Fire the same reactive/live-update signals a single write does, for each entry actually written.
    for (const it of result.items) {
      if (it.status === 'created' || it.status === 'updated') {
        recordMemoryTouch({ ownerGaii: gaii, key: it.key, writerPrincipal: resolve(req), kind: 'write' });
        emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(it.key)}`);
        emitMemoryWritten(gaii, it.key, it.status);
      }
    }
    if (result.created > 0) emitResourceListChanged(gaii);
    // Scoped by what was WRITTEN (event-bus.ts emitRecordChange): a batch of records only their owner
    // reads is told to that owner's streams. A batch does not read what each key held before, so a
    // record it moved from public to private is not announced to those who could read it until now.
    if (result.created + result.updated > 0) emitRecordChange('memory', gaii, ...items.map(i => i.visibility));
    stats?.increment('memory_writes');

    const failed = [...preFailed.map(f => ({ key: f.key, reason: f.reason })),
                    ...result.items.filter(i => i.status === 'failed').map(i => ({ key: i.key, reason: i.reason ?? 'failed' }))];
    // 202 when an entry was stored below public and waits for the owner (batch-guards.ts batchPublishAnswer).
    const published = batchPublishAnswer(result);
    res.status(published.status).json(success(config.nodeId, {
      ...published.fields,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed,
    }));
  });

  // GET /v1/memory/export — download all of the caller's memory entries (full values) as a JSON
  // backup. Owner sessions export across their GHII + agents + ecosystem apps (owner-scope); agent
  // sessions export their own keyspace. Optional ?prefix= scopes the export to one namespace.
  router.get('/v1/memory/export', requireAuth(), requireLocalSession(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
    const isOwnerSession = isOwnerInPerson(req.auth);
    // Resolved like bulk, import and bulk-delete: an owner session's sub is the bare account name.
    let gaii = resolve(req);
    const agentParam = req.query.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      // The same rule as bulk, import and bulk-delete: naming a target agent is an owner-session
      // door. Until 2026-09-08 this one lacked that half, so an agent holding memory:read could
      // export a sibling agent's whole keyspace by naming it (e2e-memory-doors).
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may export memory of a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only export memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }
    const prefix = req.query.prefix as string | undefined;

    let loaded: MemoryRecord[];
    if (isOwnerSession && !agentParam) {
      loaded = await memoryDb.listOwnerScope(req.auth!.owner, { prefix });
    } else {
      loaded = await storage.listMemory(gaii, { prefix });
    }
    // The one presentation of memory values: the classification reader plus the credential mask.
    // Then what may leave: an export file leaves the node, and an organism's record held under this
    // person's name is the organism's (leave binds only organism content). What stayed is named.
    const reader = readerFor({ storage, config }, req.auth);
    const { kept: records, leftOut } = await leaveMemories(reader, await presentMemories(reader, loaded), { kind: 'export', organismId: null });

    res.json(success(config.nodeId, {
      exported_at: new Date().toISOString(),
      node_id: config.nodeId,
      count: records.length,
      ...(leftOut.length ? { left_out: leftOut } : {}),
      entries: records.map(r => ({
        key: r.key,
        value: r.value,
        visibility: r.visibility,
        tags: r.tags,
        ...(r.ttlHours != null ? { ttl_hours: r.ttlHours } : {}),
        ...(r.aiProvenanceId ? { ai_provenance_id: r.aiProvenanceId } : {}),
      })),
    }));
  });

  // POST /v1/memory/import — restore/merge a JSON backup produced by /v1/memory/export.
  // body: { entries: [{ key, value, visibility?, tags?, ttl_hours? }], mode?, agent? }
  //   mode = 'skip' (default) | 'overwrite' | 'rename' — how to resolve a key that already exists.
  // Per-entry validation/quota/schema mirror POST /v1/memory; one bad entry doesn't abort the run.
  // Phase 1: the write itself runs through MemoryDbService.writeMany — batched existing-lookup + one
  // byte-sum + one key-count + one bulk upsert, replacing the old per-entry (getMemory + setMemory) loop
  // and the up-front listMemory().length load-all. Behaviour is preserved: same failure reasons, same
  // summary shape, and (like the prior import) NO total-bytes quota cap — an import restores a backup.
  router.post('/v1/memory/import', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), async (req, res) => {
    const body = req.body ?? {};
    const entries = Array.isArray(body.entries) ? body.entries : null;
    const mode = (['skip', 'overwrite', 'rename'].includes(body.mode) ? body.mode : 'skip') as 'skip' | 'overwrite' | 'rename';
    if (!entries) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'entries array is required'));
      return;
    }

    // Resolve target identity (owner sessions may target one of their agents via ?agent / body.agent)
    let gaii = resolve(req);
    const agentParam = body.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      const isOwnerSession = isOwnerInPerson(req.auth);
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may import under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only import memory to your own agents'));
        return;
      }
      gaii = agentParam;
    }

    // Per-entry protocol pre-filter (reserved-key + anonymous namespace) — bad entries go straight to
    // failed[]; the survivors are handed to the service. NOTE: organism.* keys are allowed here (unlike
    // /v1/memory/bulk) — the injected validate runs the workspace write-guards per entry, exactly as the
    // old import did, so append-only / create-only manifests are still honoured. Who may write an
    // organism key at all is the organism rule, asked per entry below, because this door writes
    // through writeMany rather than the shared writer that asks it for every other write door.
    const failed: { key: string; reason: string }[] = [];
    const items: BulkWriteItem[] = [];
    const renameOf = new Map<string, string>();   // targetKey -> original key (for the summary/events)
    const survivors: { key: string; entry: Record<string, unknown> }[] = [];
    // A container's archive marker is shared by its records. Resolve it once per request.
    const archiveChecks = new Map<string, ReturnType<typeof isKeyArchived>>();
    // The publish gate, asked once for the caller, as on POST /v1/memory/bulk.
    const publishAsk = routePublishAsk({ storage, config }, req);
    const capRefusal = batchCapRefusalFor({ storage, config }, req, 'POST /v1/memory/import');
    for (const entry of entries) {
      const key = entry?.key;
      if (typeof key !== 'string' || !key) { failed.push({ key: String(key), reason: 'missing key' }); continue; }
      const keyRefusal = batchKeyRefusal(req.auth!.roles, gaii, key);
      if (keyRefusal) { failed.push({ key, reason: keyRefusal }); continue; }
      if (key.startsWith('organism.')) {
        // Membership, the organism's and a workspace's meta namespaces, the member namespaces and the
        // consent layer: the same answer POST /v1/memory gets. Without it a member stored a copy of a
        // workspace's manifest under their own name, and a non-member stored any organism key.
        // The value is the entry's own, which is what the batch below stores.
        const refusal = await organismWriteRefusal(req, gaii, key, { after: (entry as { value?: unknown }).value });
        if (refusal) { failed.push({ key, reason: `${refusal.code}: ${refusal.message}` }); continue; }
        const container = /^organism\.[^.]+(?:\.w\.[^.]+)?/.exec(key)?.[0] ?? key;
        let check = archiveChecks.get(container);
        if (!check) { check = isKeyArchived(storage, key); archiveChecks.set(container, check); }
        const archive = await check;
        if (archive.archived) { failed.push({ key, reason: `ARCHIVED: This ${archive.level} is archived (read-only). Unarchive it before writing.` }); continue; }
        const undeclared = await undeclaredSpaceForKey(storage, key);
        if (undeclared) { failed.push({ key, reason: `UNDECLARED_SPACE: ${undeclared.message}` }); continue; }
      }
      if (odpsWriteRefusal(key, (entry as { value?: unknown }).value, undefined)) {
        const odps = odpsWriteRefusal(key, (entry as { value?: unknown }).value, (await storage.getMemory(gaii, key))?.value);
        if (odps) { failed.push({ key, reason: `${odps.code}: ${odps.message}` }); continue; }
      }
      const legacyPacing = legacyPacingWriteRefusal(key, (entry as { value?: unknown }).value);
      if (legacyPacing) { failed.push({ key, reason: `${legacyPacing.code}: ${legacyPacing.message}` }); continue; }
      const sites = await crewSitesWriteRefusal(storage, key, gaii, (entry as { value?: unknown }).value, req.auth!);
      if (sites) { failed.push({ key, reason: `OWNER_APPROVES_SITES: ${sites}` }); continue; }
      const refRefusal = await storageReferenceRefusal(storage, gaii, entry.value);
      if (refRefusal) { failed.push({ key, reason: refRefusal }); continue; }
      // Making a record public, by a caller with nobody on this node to ask: that entry is refused.
      if (publishAsk.kind === 'refused' && entry.visibility === 'public' && !signedInOnly(config) && (await storage.getMemory(gaii, key))?.visibility !== 'public') {
        failed.push({ key, reason: `${publishAsk.code}: ${publishAsk.message}` }); continue;
      }
      // A level wider than the record's label allows: that entry is refused (plan doc-mvdipuyqraas, L3.2).
      const capped = await capRefusal(gaii, key, entry.visibility === undefined ? memoryVisibilityDefault(config) : entry.visibility);
      if (capped) { failed.push({ key, reason: capped }); continue; }
      survivors.push({ key, entry });
    }

    // Rename mode: resolve a fresh target key for any entry whose key already exists, so every renamed
    // entry becomes a NEW key (created). One batched existing-lookup covers the first probe; deeper
    // collisions fall back to per-candidate reads (rare).
    if (mode === 'rename' && survivors.length) {
      const existingKeys = new Set((await storage.getMemoryByKeys!(gaii, survivors.map(s => s.key))).map(r => r.key));
      for (const s of survivors) {
        if (!existingKeys.has(s.key)) continue;
        let n = 1;
        let candidate = `${s.key}-imported`;
        while (await storage.getMemory(gaii, candidate)) { n++; candidate = `${s.key}-imported-${n}`; }
        renameOf.set(candidate, s.key);
        s.key = candidate;
      }
    }

    for (const s of survivors) {
      items.push({
        key: s.key,
        value: s.entry.value,
        // An entry with no visibility takes the node's starting level (plan V5.1); a word this
        // import does not restore is still stored private.
        visibility: (s.entry.visibility === undefined ? memoryVisibilityDefault(config)
          : ['private', 'owner', 'group', 'members', 'public'].includes(s.entry.visibility as string) ? s.entry.visibility : 'private') as MemoryRecord['visibility'],
        tags: Array.isArray(s.entry.tags) ? s.entry.tags as string[] : [],
        ttlHours: typeof s.entry.ttl_hours === 'number' ? s.entry.ttl_hours : null,
        ...(typeof s.entry.ai_provenance_id === 'string' ? { aiProvenanceId: s.entry.ai_provenance_id } : {}),
      });
    }

    const result = await writeMemoryBatch({ storage, config, memoryDb }, {
      principal: resolve(req), targetGaii: gaii,
      ...(publishAsk.kind === 'ask' ? { publishRequester: publishAsk.requester } : {}),
    }, items, {
      // Renamed targets are all-new, so 'overwrite' still yields 'created' for them.
      mode: mode === 'rename' ? 'overwrite' : mode,
      quota: {
        maxKeysPerOwner: config.memoryMaxKeysPerAgent,
        maxValueSizeBytes: config.memoryMaxValueSizeKb * 1024,
        totalQuotaBytes: Number.MAX_SAFE_INTEGER,   // preserve prior import behaviour (no total-bytes cap)
      },
      validate: (key, value) => validateMemoryWrite(key, value, storage),
    }, 'import');

    for (const it of result.items) {
      if (it.status === 'created' || it.status === 'updated') {
        recordMemoryTouch({ ownerGaii: gaii, key: it.key, writerPrincipal: resolve(req), kind: 'write' });
        emitMemoryWritten(gaii, it.key, it.status);
      }
      if (it.status === 'failed') failed.push({ key: renameOf.get(it.key) ?? it.key, reason: it.reason ?? 'failed' });
    }

    emitResourceListChanged(gaii);
    emitRecordChange('memory', gaii, ...items.map(i => i.visibility));
    // 202 when an entry was stored below public and waits for the owner (batch-guards.ts batchPublishAnswer).
    const published = batchPublishAnswer(result);
    res.status(published.status).json(success(config.nodeId, {
      ...published.fields,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed,
    }));
  });

  // POST /v1/memory/bulk-delete — delete many entries at once by { prefix } and/or { keys }.
  // Avoids firing 1000+ individual DELETE requests when clearing a whole namespace (e.g. an old
  // organism). Owner sessions delete across their owner-scope (records keep their writer's gaii);
  // agent sessions delete from their own keyspace.
  router.post('/v1/memory/bulk-delete', requireAuth(), requireScope('memory:delete'), async (req, res) => {
    const body = req.body ?? {};
    const prefix = typeof body.prefix === 'string' && body.prefix ? body.prefix : undefined;
    const keys = Array.isArray(body.keys) ? new Set(body.keys.filter((k: unknown): k is string => typeof k === 'string')) : undefined;
    if (!prefix && (!keys || keys.size === 0)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'prefix or keys is required'));
      return;
    }
    // A service-owned key (the classification policy) is removed by no memory route, for any
    // principal (TARGET-082 review finding 2). Named outright it is refused; matched by a prefix it is
    // left in place, so clearing `classification.` still clears the rest.
    const namedServiceKey = keys ? ([...keys] as string[]).find(k => isServiceOwnedKey(k)) : undefined;
    if (namedServiceKey) {
      const refusal = serverWrittenKeyRefusal(namedServiceKey);
      res.status(403).json(error(config.nodeId, refusal.code, refusal.message));
      return;
    }

    const isOwnerSession = isOwnerInPerson(req.auth);
    let gaii = resolve(req);
    const agentParam = body.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may bulk-delete under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only delete memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }

    // Gather candidate records (owner-scope keeps each record's writer gaii so we delete from the right keyspace).
    const records = (isOwnerSession && !agentParam)
      ? await memoryDb.listOwnerScope(req.auth!.owner, { prefix })
      : await storage.listMemory(gaii, { prefix });

    // A record space that names extensions takes a delete from a caller that is not a person only
    // through one of them (services/fenced-space.ts). This route asks no organism rule for the keys
    // it removes (each goes to the deleted-memory bin through storage.deleteMemory, restorable for
    // the grace period), so one such key refuses the whole request before the first delete. The account holder in person returns from the rule before any manifest is read.
    // The same call refuses the removal of a workspace's manifest record that declares a fence, to
    // every caller but the account holder in person and a session that covers organism:direct.
    const session = callerOf(req, config.nodeId, storage);
    const fenced = await fencedKeysRefusal({ storage, config }, { principal: gaii, roles: session.roles, scopes: session.scopes },
      records.filter(r => (!keys || keys.has(r.key)) && r.key.startsWith('organism.')).map(r => r.key));
    if (fenced) {
      res.status(fenced.status).json(error(config.nodeId, fenced.code, fenced.message, fenced.status, fenced.details));
      return;
    }

    let deleted = 0;
    const deletedVisibility: string[] = [];
    for (const r of records) {
      if (keys && !keys.has(r.key)) continue;
      if (isServiceOwnedKey(r.key)) continue;
      if (await storage.deleteMemory(r.ownerGaii, r.key)) {
        deleted++;
        deletedVisibility.push(r.visibility);
        emitResourceUpdated(r.ownerGaii, `aimeat://memory/${encodeURIComponent(r.key)}`);
      }
    }
    if (deleted > 0) { emitResourceListChanged(gaii); emitRecordChange('memory', gaii, ...deletedVisibility); }
    res.json(success(config.nodeId, { deleted }));
  });

  // POST /v1/memory/bundle — download a ZIP of selected memory values + storage files (+ a manifest).
  // Backs the "collection cart" export: a pointer-free bundle of the caller's OWN data (GHII + owned
  // agents). Each item must be owned by the caller or one of their agents; anything else is skipped
  // and recorded in manifest.json. Body: { items: [{ kind:'memory'|'file', key, owner_gaii? }] }.
  router.post('/v1/memory/bundle', requireAuth(), requireLocalSession(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
    const body = req.body ?? {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'items is required (non-empty array)'));
      return;
    }
    if (items.length > 500) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A bundle may contain at most 500 items'));
      return;
    }

    // Allowed owners = the caller's own identity + (owner sessions only) their agents' GAIIs.
    const isOwnerSession = isOwnerInPerson(req.auth);
    const callerGaii = resolve(req);
    const allowed = new Set<string>([callerGaii]);
    if (isOwnerSession) {
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      for (const a of agents) allowed.add(a.gaii);
    }

    // The classification reader (TARGET-082): an item this caller may not see is not bundled.
    const reader = readerFor({ storage, config }, req.auth);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('error', (err: Error) => {
      if (!res.headersSent) res.status(500).json(error(config.nodeId, 'ZIP_ERROR', `Failed to build bundle: ${err.message}`));
    });
    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const stamp = new Date().toISOString().slice(0, 10);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="aimeat-collection-${stamp}.zip"`,
        'Content-Length': String(buffer.length),
      });
      res.send(buffer);
    });

    // Keep zip entry names inside the archive root (strip leading slashes and any '..' traversal).
    const sanitize = (k: string) => String(k).replace(/\\/g, '/').replace(/\.\.+/g, '.').replace(/^\/+/, '');
    const encKeyPath = (k: string) => k.split('/').map(encodeURIComponent).join('/');
    const manifest: { generated_at: string; node_id: string; items: Array<Record<string, unknown>> } = {
      generated_at: new Date().toISOString(), node_id: config.nodeId, items: [],
    };
    const seen = new Set<string>();

    for (const raw of items) {
      const kind = raw?.kind === 'file' ? 'file' : raw?.kind === 'memory' ? 'memory' : null;
      const key = typeof raw?.key === 'string' && raw.key ? raw.key : null;
      const owner = typeof raw?.owner_gaii === 'string' && raw.owner_gaii ? raw.owner_gaii : callerGaii;
      if (!kind || !key) { manifest.items.push({ kind: raw?.kind ?? null, key: raw?.key ?? null, included: false, reason: 'invalid' }); continue; }
      const dedup = `${kind}:${owner}:${key}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      if (!allowed.has(owner)) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_owned' }); continue; }
      try {
        if (kind === 'file') {
          const stored = await storage.getStorageFile(owner, key);
          const [file] = stored ? await reader.show([stored], () => fileTarget(owner, key, stored.workspaceRef)) : [];
          if (!file) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_found' }); continue; }
          archive.append(file.data as Buffer, { name: `files/${sanitize(key)}` });
          manifest.items.push({ kind, key, owner_gaii: owner, included: true, mime_type: file.mimeType, size: file.size, url: `${config.baseUrl}/v1/pub/${encodeURIComponent(owner)}/${encKeyPath(key)}` });
        } else {
          const stored = await storage.getMemory(owner, key);
          const record = stored ? await presentMemory(reader, stored) : null;
          if (!record) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_found' }); continue; }
          // The bundle leaves the node: an organism's record may stay behind, and the manifest says why.
          const [left] = (await leaveMemories(reader, [record], { kind: 'export', organismId: null })).leftOut;
          if (left) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'classified', label: left.label, detail: left.reason }); continue; }
          const shown = record.value;
          const content = typeof shown === 'string' ? shown : JSON.stringify(shown, null, 2);
          archive.append(content, { name: `memory/${sanitize(key)}.json` });
          manifest.items.push({ kind, key, owner_gaii: owner, included: true, visibility: record.visibility, url: `${config.baseUrl}/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}` });
        }
      } catch (err) {
        logger.warn('bulk: suppressed failure, continuing', { error: String(err) });
        manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'error' });
      }
    }

    const included = manifest.items.filter(i => i.included).length;
    if (included === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No accessible items to bundle'));
      return;
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.finalize();
  });

  // GET /v1/memory/discover — browse public memory entries across all users on this node
  router.get('/v1/memory/discover', requireAuth(), requireRestScope('memory:read'), async (req, res) => {
    const prefix = req.query.prefix as string | undefined;
    const owner = req.query.owner as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const callerGaii = resolve(req);

    const items = await discoverMemory(storage, config, callerGaii, {
      prefix: prefix || undefined, owner: owner || undefined, q, limit, offset,
    });

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

  // POST /v1/memory/copy, registered here so it keeps its place in the route order (routes/memory/copy.ts).
  registerCopyRoute(router, ctx);
}

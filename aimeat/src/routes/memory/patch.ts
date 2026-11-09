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
 *   2026-11-09 — The rule set moved unchanged to services/memory-patch/patch.ts, which the MCP
 *     write tool's `patch` calls too; a record whose value is not an object is refused with 409
 *     NOT_AN_OBJECT instead of being replaced by the patch.
 *   2026-11-09 — A merge into a context or ontology key keeps the version it replaces, pruned to the
 *     newest HISTORY_KEEP (services/context/history-keys.ts).
 *   2026-11-05 — visibility 'group' on a record that has no group is refused with 400 INVALID_INPUT:
 *     this route takes no group id (storage/memory-sharing.ts).
 *   2026-11-04 — The running workflow engine is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveWorkflowEngine (codebase analysis 2026-11-03, item D-i).
 *   2026-11-04 — The 501 NOT_SUPPORTED answers for a storage without setMemoryIfVersion or
 *     createMemoryIfAbsent are gone: both are required on Storage, so no node reached them (codebase
 *     analysis 2026-11-03, item D-e).
 *   2026-10-31 — The write tally names an app grant as the app (data-map/tally-writer.ts; secaudit2026oct31w2 round 10).
 *   2026-10-27 — A merge that changes where a mail refinery reads and files mail, by an app or an agent
 *     that may not run it, stores the rest and answers 202 with the owner's request (secaudit2026oct26).
 *   2026-10-27 — A merge of the welcome page's switch (portfolio.config) asks the publish gate as
 *     PUT /v1/portfolio/config does: 202 with `publish_request`, the rest stored (secaudit2026oct26).
 *   2026-10-27 — With owner_scope, a merge into an owner record the caller reads as absent (an agent
 *     without memory:read-as-owner, Full access included) is stored and answers `value: null` with a
 *     note naming the permission, and a visibility change of that record is refused 403 SCOPE_DENIED
 *     (secaudit2026oct26, owner-scope-patch-answers-value-without-read-as-owner).
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
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { readerFor } from '../../services/classification/reader.js';
import { denyScope403 } from '../../auth/deny.js';
import { patchMemoryRecord } from '../../services/memory-patch/patch.js';
import type { MemoryRouteCtx } from './shared.js';

export function registerPatchRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, stats, peers, workspaceAccess } = ctx;

  // The whole rule set lives in services/memory-patch/patch.ts, which the MCP write tool's `patch`
  // calls too. This door parses the body, runs the organism rule as middleware, and renders.
  router.patch('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), workspaceAccess, async (req, res) => {
    const key = req.params.key as string;
    const body = req.body ?? {};
    const out = await patchMemoryRecord(
      { storage, config, ...(stats ? { stats } : {}), ...(peers ? { peers } : {}) },
      { auth: req.auth!, caller: callerOf(req, config.nodeId, storage), reader: readerFor({ storage, config }, req.auth), organismChecked: true },
      { key, patch: body.patch, ifVersion: body.if_version, visibility: body.visibility, tags: body.tags, ttlHours: body.ttl_hours, ownerScope: body.owner_scope === true },
    );
    if (!out.ok) {
      if (out.scopeNeeded) { denyScope403(req, res, out.scopeNeeded, out.message); return; }
      res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.details as Record<string, unknown> | undefined));
      return;
    }
    res.status(out.status).json(success(config.nodeId, out.data, [
      { description: 'Read this memory entry', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'Patch it again', method: 'PATCH', url: `/v1/memory/${encodeURIComponent(key)}`, example_body: { patch: { field: 'value' } } },
    ]));
  });
}

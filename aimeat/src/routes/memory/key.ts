/**
 * @file src/routes/memory/key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-key memory routes: GET/DELETE/PUT /v1/memory/:key and CORS management; the public GET /v1/memory/:gaii/:key read is registered from routes/memory/public-read.ts. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.11.3 — 2026-10-08 — A stamped update states the value's medium (text or data). A visibility-only update keeps its record, whose label is decided when it is served.
 *   v1.11.2 — 2026-10-07 — DELETE reads `?owner=` only as a single string; a repeated one is no override (code scanning alerts 1704-1707).
 *   v1.11.1 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.11.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2). DELETE ?owner= computes its roles with rolesWithOperator and writes recordOperatorAccess, the trail the admin memory route writes.
 *   v1.10.0 — 2026-09-29 — TARGET-082 review: GET /v1/memory/:key answers `classificationWarning`
 *     when an AI is shown a warning-classified record. GET /v1/memory/:gaii/:key moved to
 *     routes/memory/public-read.ts (max-file-lines), where its visibility gate now runs before the
 *     classification reader. GET /v1/memory/deleted lists only the bin keys the reader may see.
 *   v1.9.0 — 2026-09-29 — PUT schedules write-time classification of a changed value
 *     (services/classify-on-write.ts, TARGET-082 V3).
 *   v1.8.0 — 2026-09-29 — Both reads show a value through presentMemory (the classification reader
 *     plus the credential mask, TARGET-082); a record the reader may not see answers as absent.
 *   v1.7.0 — 2026-09-26 — GET /v1/memory/:gaii/:key answers a Design Book part with 403
 *     DESIGN_BOOK_PART, naming GET /v1/designbook/:id, the one door that reads a part
 *     (utils/own-door-keys.ts). Soft or not, signed in or not.
 *   v1.6.2 — 2026-09-26 — PUT stores the provenance record it stamps only once the version-checked
 *     write lands (secaudit 2026-09, N2). It was stored before the write, so a write that lost the
 *     swap answered 409 and left a record about bytes that were never stored.
 *   v1.6.1 — 2026-09-24 — POST /v1/memory/:key/restore carries workspaceAccess as the delete does,
 *     hands the service the caller's roles, and says the service's organism or append-only refusal
 *     as it is instead of as NOT_RESTORABLE (A6-12).
 *   v1.6.0 — 2026-09-24 — PUT refuses a key only the node writes (`__redirect__`) with RESERVED_KEY,
 *     whoever asks.
 *   v1.5.1 — 2026-09-24 — The federated test is isForeignPrincipal(), the one question (secaudit 2026-09, F-1).
 *   v1.5.0 — 2026-09-16 — Every read answer shows a credential record redacted (shownMemoryValue), and
 *     PUT refuses openrouter.apikey and commerce.psp with SECRET_RECORD.
 *   v1.4.1 — 2026-09-13 — PUT refuses an EXCHANGE listing source whose changed text would break an
 *     ODPS length cap, 422 ODPS_FIELD_TOO_LONG, through odpsWriteRefusal like every other write door.
 *   v1.4.0 — 2026-09-13 — PUT /v1/memory/:key refuses a workspace record whose space the workspace
 *     manifest does not declare, 422 UNDECLARED_SPACE, before it stamps or writes anything: the
 *     developer's decision, and the same refusal POST /v1/memory and every workspace door answer.
 *   v1.3.0 — 2026-08-11 — The cross-owner read resolves the accessor's identity instead of passing
 *     the raw JWT `sub`. An owner session carries a bare account name, so no sharing-group
 *     membership and no consent grant could match it: a person could not read what had been shared
 *     with them, while their own agents could. Same fix the storage-file twin GET /v1/pub took in
 *     July; this side of the pair had been left. Decision d-resolve-identity.
 *   v1.2.0 — 2026-08-01 — TARGET-058: the reads carry `meta.provenance` + the AI-Disclosure / Link
 *     headers, and the writes stamp a non-human principal that declared nothing (Mint-3).
 *   v1.1.0 — 2026-07-19 — public :gaii/:key read supports ?soft=1 (200 + exists:false, identical
 *     for missing and hidden records — no existence leak), matching the authed route
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AiProvenanceRecordRow } from '../../storage/interface.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../services/memory-bin.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { MemoryUpdateSchema, validateBody } from '../../models/schemas.js';
import { checkMemoryQuota, chargeOverage } from '../../services/quota.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { odpsWriteRefusal } from '../../services/exchange-odps-write.js';
import { undeclaredSpaceForKey } from '../../services/workspace-write-items.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { enqueueMemoryReplication } from '../../services/memory-replication.js';
import { emitChange } from '../../services/event-bus.js';
import { recordMemoryTouch } from '../../services/data-map/write-tally-buffer.js';
import { ecoMayReadKey, ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../../services/secret-records.js';
import { presentMemory } from '../../services/classification/present-memory.js';
import { readerFor } from '../../services/classification/reader.js';
import { warningField } from '../../services/classification-exits.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { registerPublicReadRoute } from './public-read.js';
import { stampAgentWrite, resolveAttachableProvenanceId, storeHeldProvenance } from '../../services/ai-provenance.js';
import { ownerGhiiOf, isForeignPrincipal, isOwnerInPerson } from '../../utils/gaii.js';
import { loadServedProvenance, envelopeMeta, setProvenanceHeaders } from '../../services/ai-provenance-marks.js';
import { type MemoryRouteCtx, isAnonymousGaii, visibilityToZone, memoryContentBytes } from './shared.js';
import { mediaKindOfValue } from '../../models/ai-provenance-schemas.js';
import { logger } from '../../utils/logger.js';
import { classifyAfterWrite } from '../../services/classify-on-write.js';
import { rolesWithOperator } from '../../services/operator-override.js';
import { recordOperatorAccess } from '../../services/operator-access-audit.js';

export function registerKeyRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, memoryDb, stats, peers, resolve, workspaceAccess } = ctx;

  // GET /v1/memory/:key — read a memory entry
  // BEFORE `/v1/memory/:key`, AND THAT IS THE WHOLE REASON IT SITS HERE. Express matches in
  // registration order, so declared after it this route never runs: the literal `deleted`
  // becomes the key and the answer is "Memory key not found: deleted" — a 404 that looks like
  // an empty bin and is really a route that was never reached.
  // GET /v1/memory/deleted — what is in the bin, and how long each one has left.
  //
  // Its own route rather than a flag on the listing, because the two answer different questions: the
  // listing is "what do I have", this is "what did I throw away". A flag would have put the bin one
  // typo away from every AI-facing material assembly, which is the mistake the whole exclusion
  // machinery exists to prevent.
  router.get('/v1/memory/deleted', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
    const gaii = resolve(req);
    const graceMs = config.memoryDeleteGraceDays * 86_400_000;
    // What is in the bin is still content: a key this reader may not see is not listed (TARGET-082).
    const rows = await readerFor({ storage, config }, req.auth)
      .show(await storage.listDeletedMemory(gaii), r => memoryTarget(r.ownerGaii, r.key));
    res.json(success(config.nodeId, {
      items: rows.map(r => ({
        key: r.key,
        deleted_at: r.deletedAt,
        deleted_by: r.deletedBy ?? null,
        // What a person actually needs: not the date it went, but how long they have left.
        restorable_until: graceMs > 0 && r.deletedAt
          ? new Date(new Date(r.deletedAt).getTime() + graceMs).toISOString()
          : null,
      })),
      grace_days: config.memoryDeleteGraceDays,
    }));
  });

  router.get('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), workspaceAccess, async (req, res) => {
    let gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);

    // Owner may target one of their own agents' keyspace via ?agent= (mirrors list/search).
    const agentParam = req.query.agent as string | undefined;
    const isOwnerSession = isOwnerInPerson(req.auth);
    if (agentParam && agentParam !== gaii) {
      const targetAgent = await storage.getAgent(agentParam);
      // `targetAgent.owner !== req.auth!.owner` compares NAMES, and a federated visitor's name is
      // the local part of an account on another node: it matches the local namesake's agents.
      if (!targetAgent || targetAgent.owner !== req.auth!.owner || isForeignPrincipal(req.auth)) {
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
    //
    // NOT an ecosystem app, for the same reason the list route excludes one (routes/memory/crud.ts):
    // a GEAI is fenced to the data areas its owner granted, and this flag must not be the way
    // around that fence. The eco gate above only inspects `organism.` keys — everything else is
    // waved through as "the app's own namespace", which is true right up until owner_scope makes
    // the read target the OWNER's namespace instead. Measured before this line existed: an app
    // whose only granted area was `service.peeker.*` read a `private` owner key by passing the
    // flag, and `openrouter.*` sits in the same namespace.
    const isEcosystem = req.auth!.roles.includes('ecosystem');
    // NOT a federated session, whatever its role says. The owner-scope is resolved from the bare
    // owner NAME, and a visitor signed in from another node carries the local part of THEIR name:
    // the fan-out would read the local account that happens to share it. Their own records are
    // keyed by their home GHII (utils/gaii.ts resolveIdentity), which the plain read below uses.
    const ownerScopeRead = (isOwnerSession || req.query.owner_scope === 'true')
      && !agentParam && !isEcosystem && !isForeignPrincipal(req.auth);
    let record = ownerScopeRead
      ? await memoryDb.getOwnerScope(req.auth!.owner, key)
      : await storage.getMemory(gaii, key);
    // On-read TTL check: if TTL has expired, treat as not found and delete
    if (record && record.ttlHours && record.ttlHours > 0) {
      const expiresAt = new Date(record.createdAt).getTime() + record.ttlHours * 3_600_000;
      if (Date.now() > expiresAt) {
        await storage.deleteMemory(record.ownerGaii, key);
        record = null;
      }
    }
    // The one presentation of a memory value (classification + credential mask). A record this
    // reader may not see answers exactly as an absent one.
    const shown = record ? await presentMemory(readerFor({ storage, config }, req.auth), record) : null;
    if (!shown) {
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
    record = shown;

    stats?.increment('memory_reads');

    // TARGET-058: how this record's value was made, on the ONE envelope carrier plus the two
    // response headers. The read is already authorized above, so the caller may see the whole
    // record: provenance travels with content a caller is entitled to.
    const prov = await loadServedProvenance(storage, config, record.aiProvenanceId, { full: true });
    setProvenanceHeaders(res, prov);

    res.json(success(config.nodeId, {
      key: record.key,
      // Always present, both ways. The soft-miss branch above returns exists:false, and a HIT used
      // to return no `exists` field at all — so a caller written as `if (!data.exists)` read every
      // successful read as a miss, silently, and only on the path where the data WAS there.
      exists: true,
      value: record.value,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      // The ATTACHED half of AI provenance (TARGET-058). null = UNSTATED, which is not the same as
      // "a human wrote it" — resolve it at /v1/provenance/:id to find out what was actually claimed.
      ai_provenance_id: record.aiProvenanceId ?? null,
      // TARGET-082: an AI shown a warning-classified record is told so, on this door as on MCP.
      ...warningField(record),
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
    ], envelopeMeta(prov)));
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

    // WHO MAY REMOVE WHAT lives in services/memory-bin.ts, because the tool surfaces ask the same
    // question and a second copy here is the drift this codebase keeps paying for. What stays in
    // the route is what belongs to the route: the operator's ?owner= override (a ROLE check, and
    // roles are the door's business), the owner-scope opt-in, and the workspace guard below.
    // A repeated `?owner=` arrives as an array, which the identity tests in the service cannot read.
    const ownerOverride = typeof req.query.owner === 'string' ? req.query.owner : undefined;
    const isOwnerSession = isOwnerInPerson(req.auth);
    // The operator half of ?owner= asks isOperatorCaller through rolesWithOperator, as the MCP tools
    // ask askOperator: the operator's agent holding operator:admin passes too, and the service
    // (memory-bin.ts binRefusal) reads 'operator' from the same computed list.
    const roles = ownerOverride ? await rolesWithOperator(storage, req.auth) : req.auth!.roles;
    const binReq = {
      caller: gaii,
      ownerName: req.auth!.owner as string,
      key,
      ownerScope: isOwnerSession || req.query.owner_scope === 'true',
      ownerOverride: (ownerOverride && roles.includes('operator')) ? ownerOverride : null,
      roles,
    };

    // Who to ask, if somebody later wonders where it went. The principal, not the owner name:
    // `req.auth.owner` is the human on an agent token too, so it would name the wrong party.
    // The tombstone, and the moment it stops being takeable back.
    //
    // The append-only write guard used to be run here, inline, and the MCP tool that calls the same
    // service ran nothing. It is inside deleteMemoryRecord now, with the organism namespace check,
    // so a fourth door cannot arrive without them. The answer is unchanged: 409 WRITE_CONFLICT with
    // the violations, 404 for the two codes this door has always returned.
    const outcome = await deleteMemoryRecord({ storage, config }, binReq);
    if (!outcome.ok) {
      res.status(outcome.status ?? 404).json(error(config.nodeId, outcome.code, outcome.message,
        outcome.status ?? 404, outcome.violations ? { violations: outcome.violations } : undefined));
      return;
    }
    // The operator's ?owner= delete writes the operator-access trail, the same one
    // DELETE /v1/admin/memory/:owner/:key writes (recordOperatorAccess skips the operator's own account).
    if (binReq.ownerOverride) {
      await recordOperatorAccess(storage, config, {
        operatorGhii: ownerGhiiOf(gaii), actorGaii: gaii, ownerOf: outcome.ownerGaii, action: 'delete', key: outcome.key,
      });
    }

    emitResourceUpdated(outcome.ownerGaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(outcome.ownerGaii);

    // THE WAY BACK IS IN THE ANSWER. A person who has just deleted something by mistake should not
    // have to go looking for how to undo it, and an agent reading this envelope learns the route
    // without being told. `restorable_until` is the promise the sweeper keeps.
    const graceDays = outcome.graceDays;
    res.json(success(config.nodeId, {
      deleted: true,
      key,
      restorable_until: outcome.restorableUntil,
      grace_days: graceDays,
    }, [
      ...(graceDays > 0
        ? [{ description: 'Changed your mind — put it back', method: 'POST', url: `/v1/memory/${encodeURIComponent(key)}/restore` }]
        : []),
      { description: 'See everything waiting to be removed', method: 'GET', url: '/v1/memory/deleted' },
      { description: 'List remaining memory keys', method: 'GET', url: '/v1/memory' },
    ]));
    emitChange('memory');
  });

  // POST /v1/memory/:key/restore — take it back.
  //
  // `memory:write`, not `memory:delete`: restoring puts a record back into the working set, which is
  // a write. An agent trusted to remove things is not automatically trusted to make them reappear,
  // and the person who has to live with the record is the one whose scope should say so.
  //
  // `workspaceAccess` as on the delete beside it: putting a record back into an organism namespace
  // is a write there, so the caller must still be allowed to write it (A6-12).
  router.post('/v1/memory/:key/restore', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), workspaceAccess, async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);
    const out = await restoreMemoryRecord({ storage, config }, {
      caller: gaii, ownerName: req.auth!.owner as string, key,
      // Same reach as the delete beside it, and for the same reason: whoever could remove a
      // sibling's key has to be able to put it back, or the undo is narrower than the act.
      ownerScope: isOwnerInPerson(req.auth) || req.query.owner_scope === 'true',
      // The organism namespace rule inside the service reads the roles, as the delete's does.
      roles: req.auth!.roles,
    });
    if (!out.ok) {
      // A refusal about the key and the caller (the organism rule, the append-only guard) is said
      // as it is: it tells nothing about whether a record exists. Everything else is ONE REFUSAL FOR
      // THREE CAUSES, said as the one thing a person can act on. It was never deleted, it was never
      // yours, or the window closed and it is genuinely gone — and the node cannot tell the first
      // two apart without turning this route into a way to ask whether somebody else's key exists.
      if (out.code !== 'NOT_RESTORABLE') {
        res.status(out.status ?? 404).json(error(config.nodeId, out.code, out.message,
          out.status ?? 404, out.violations ? { violations: out.violations } : undefined));
        return;
      }
      res.status(404).json(error(config.nodeId, 'NOT_RESTORABLE',
        'There is nothing of that name waiting to be put back. Either it was never deleted, or it has already been removed for good.'));
      return;
    }
    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(gaii);
    emitChange('memory');
    res.json(success(config.nodeId, { restored: true, key }, [
      { description: 'Read it', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
    ]));
  });

  // PUT /v1/memory/:key — update memory with optimistic locking
  router.put('/v1/memory/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:write'), workspaceAccess, validateBody(MemoryUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = resolve(req);
    const key = decodeURIComponent(req.params.key as string);
    const { value, visibility, tags, ttl_hours, version, group_id, ai_provenance_id } = req.body ?? {};

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

    // A key only the node writes is refused to everyone, the owner included (utils/reserved-keys.ts).
    if (isServerWrittenKey(key)) {
      const refusal = serverWrittenKeyRefusal(key);
      res.status(403).json(error(config.nodeId, refusal.code, refusal.message));
      return;
    }
    // Reserved-key guard (DNA invariant #2): apps may not overwrite server-trusted owner keys
    // (openrouter.*/ai-usage.*/profile.*). See utils/reserved-keys.ts.
    if (!appMayWriteKey(req.auth!.roles, key)) {
      res.status(403).json(error(config.nodeId, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`));
      return;
    }
    // A record that holds a credential is shown redacted here and written only by its own door.
    if (isSecretRecordKey(key)) {
      res.status(403).json(error(config.nodeId, 'SECRET_RECORD', secretRecordWriteRefusal(key).message));
      return;
    }

    // The owner can update anything the owner owns, whoever wrote it; `?owner_scope=true` extends
    // the same reach to another same-owner principal that already carries memory:write — an app
    // grant, or an agent — as GET and DELETE do (same-owner-access invariant).
    const ownerScopeWrite = isOwnerInPerson(req.auth) || req.query.owner_scope === 'true';
    let existing = await storage.getMemory(gaii, key);
    let effectiveGaii = gaii;
    if (!existing && ownerScopeWrite) {
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

    // A workspace record whose space the workspace manifest does not declare is refused before the
    // provenance stamp and the write below, with the same 422 POST /v1/memory answers (the
    // developer's decision, 2026-09-13; services/workspace-write-items.ts). A record stored there
    // before the decision can be read and deleted, and changed again once the space is declared.
    if (key.startsWith('organism.')) {
      const undeclared = await undeclaredSpaceForKey(storage, key, { audience: req.auth!.roles.includes('ecosystem') ? 'writer' : 'member' });
      if (undeclared) {
        res.status(undeclared.status).json(error(config.nodeId, undeclared.code, undeclared.message, undeclared.status, undeclared.details));
        return;
      }
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
      // An EXCHANGE listing source whose changed text would break an ODPS length cap (2026-09-13).
      const odps = odpsWriteRefusal(key, value, existing.value);
      if (odps) { res.status(odps.status).json(error(config.nodeId, odps.code, odps.message, odps.status, odps.details)); return; }
    }

    const now = new Date().toISOString();
    const effectiveVis = visibility ?? existing.visibility;
    // MINT-3 (TARGET-058): a non-human principal that declares nothing is stamped, an owner is not.
    // Only when the VALUE changes — a visibility or tag edit is not new content, and re-minting there
    // would produce a second statement about bytes that already have one.
    const newValue = value !== undefined ? value : existing.value;
    // An explicitly supplied record wins, resolved against the caller's OWN account. Publishing a
    // private record is done by attaching it to something public, so an unchecked id here would let
    // a caller publish someone else's statement.
    const attached = await resolveAttachableProvenanceId(storage, ownerGhiiOf(effectiveGaii), ai_provenance_id);
    // A stamped record is HELD until the version-checked write below lands, and stored only then:
    // the store is append-only, so a record about bytes a lost swap never stored could not be taken
    // back (secaudit 2026-09, N2).
    const held: AiProvenanceRecordRow[] = [];
    const aiProvenanceId = attached
      ?? (value !== undefined
        ? await stampAgentWrite(storage, {
          principal: effectiveGaii,
          content: memoryContentBytes(newValue),
          mediaKind: mediaKindOfValue(newValue),
          pipeline: 'memory.update',
          surface: { visibility: effectiveVis, humanAudience: true },
          labelPolicy: config.aiLabelPublic,
          nodeId: config.nodeId,
          baseUrl: config.baseUrl,
          enabled: config.aiProvenance,
          held,
        })
        : existing.aiProvenanceId);
    const newRecord = {
      key,
      ownerGaii: effectiveGaii,
      value: newValue,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
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
    // Landed: the record it names is stored now, before anything below reads or announces it.
    await storeHeldProvenance(storage, held);
    // Write-time classification (TARGET-082 V3), only when the value changed; scheduled, not awaited.
    if (value !== undefined) classifyAfterWrite({ storage, config }, effectiveGaii, key, newValue);

    // Who has had their hands on this key. `gaii` is the caller, `effectiveGaii` the namespace it
    // lands in — an agent writing into its owner's store is both, and that is the difference the
    // tally exists to hold.
    recordMemoryTouch({ ownerGaii: effectiveGaii, key, writerPrincipal: gaii, kind: 'write' });

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(effectiveGaii, key, config, storage, peers).catch(err => {
        // Non-critical for THIS request: the scheduled sync picks the record up later. Logged because an
        // enqueue that keeps failing means replication runs only at sync cadence.
        logger.warn('memory write: replication enqueue failed, leaving it to the scheduled sync', { error: String(err) });
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
    recordMemoryTouch({ ownerGaii: record.ownerGaii, key: record.key, writerPrincipal: gaii, kind: 'write' });

    // C.3: Event-driven replication queue integration
    if (peers) {
      enqueueMemoryReplication(record.ownerGaii, record.key, config, storage, peers).catch(err => {
        // Non-critical for THIS request: the scheduled sync picks the record up later. Logged because an
        // enqueue that keeps failing means replication runs only at sync cadence.
        logger.warn('memory write: replication enqueue failed, leaving it to the scheduled sync', { error: String(err) });
      });
    }

    res.json(success(config.nodeId, {
      key: record.key,
      allowed_origins: record.allowedOrigins ?? null,
    }));
    emitChange('memory');
  });

  // GET /v1/memory/:gaii/:key, the cross-owner read: routes/memory/public-read.ts (max-file-lines).
  registerPublicReadRoute(router, ctx);
}

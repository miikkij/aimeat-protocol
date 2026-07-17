/**
 * @file src/routes/organisms/shared.ts
 * @description Shared helpers for the organism route modules. Extracted from src/routes/organisms.ts
 *   to satisfy max-file-lines. `createOrganismHelpers(config, storage)` returns the closure-bound
 *   helpers (membership/role checks, workspace registry lookups, draft publish/revert, share meta,
 *   invitation gates, archive handler) that every organism route group shares; the module-level
 *   fresherRec/roleSatisfies are pure utilities the route handlers reference directly.
 * @version-history
 *   v1.5.0 — 2026-07-17 — collectPublicRecords + PublicRecord type: the records-space analogue of
 *     collectPublicDocs, gated by the same meta.share, for the generic no-auth public-records read.
 *   v1.4.0 — 2026-07-16 — Version-bloat perf: publish/batch-publish/revert scans exclude `.version.N`
 *     rows in SQL (excludeVersionRows) and compute maxN value-free (workspace-versions) — historic
 *     full-copy values were loaded on every publish just to parse N out of the key names.
 *   v1.3.0 — 2026-07-16 — workspaceNamesByOrg (id→name registry map per org, same batched read) for the
 *     /waiting aggregate (Phase 3).
 *   v1.2.0 — 2026-07-16 — workspaceCountsByOrg batches the ?include=counts list view's per-organism
 *     registry scan into ONE cross-owner key-IN read (Phase 3).
 *   v1.1.0 — 2026-07-16 — canReadWs split into pure canReadWsManifest + a scan; readWsManifests batches
 *     the discovery list's per-workspace manifest scans into ONE cross-owner key-IN read (Phase 2 N×M).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord, OrganismRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { verifyShareToken } from '../../services/share-token.js';
import { emitChange, emitMemoryWritten } from '../../services/event-bus.js';
import { normalizeDocValueImages } from '../../services/doc-images.js';
import { resolveIdentity, isSameOwner, isGEAI } from '../../utils/gaii.js';
import { authorizeRead } from '../../services/access-guard.js';
import { ecoMayReadKey } from '../../services/ecosystem-access.js';
import { validateMemoryWrite, validateValueAgainstSchema } from '../../services/schema-validator.js';
import { archiveTarget, unarchiveTarget, type ArchiveLevel } from '../../services/archive.js';
import { grantWorkspaceRole, revokeWorkspaceRole as revokeWsRoleSvc, listWorkspaceMemberRoles, type WsRole, type WsGrantSource, type WsMemberRole } from '../../services/workspace-roles.js';
import { listVersionRefs, versionRefsByBase, maxVersionOf, pruneVersionsAfterPublish, effectiveMaxVersions, versionRefsToPrune } from '../../services/workspace-versions.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';

/** Whether a membership role satisfies an approval's required approverRole. */
export function roleSatisfies(approverRole: string, membershipRole: string): boolean {
  if (approverRole === 'member') return true;                                  // any active member
  if (approverRole === 'admin') return membershipRole === 'creator' || membershipRole === 'admin';
  if (approverRole === 'owner') return membershipRole === 'creator';           // the organism owner
  return false;
}

/** Freshest of two records for the same key: higher version wins, then newer updatedAt. Guards workspace
 *  reads/writes against a key that has forked into duplicate-owner copies (a GHII + a legacy agent GAII). */
export function fresherRec(a: MemoryRecord | null | undefined, b: MemoryRecord): MemoryRecord {
  if (!a) return b;
  if (b.version !== a.version) return b.version > a.version ? b : a;
  return (b.updatedAt ?? '') >= (a.updatedAt ?? '') ? b : a;
}
/** The member GHII behind any identity: `agent#owner@node` → `owner@node`; a bare GHII is returned as-is.
 *  Workspace current-state records (.draft/.latest) are owned by this so a key never forks per-agent. */
function ownerGhiiOf(identity: string): string {
  return identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity;
}
/** Delete every copy of `key` NOT owned by `keepOwner` — collapses a forked key back to a single owner. */
async function collapseKeyTo(storage: Storage, key: string, keepOwner: string): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  await Promise.all(items
    .filter(r => r.key === key && r.ownerGaii !== keepOwner)
    .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(() => { /* best-effort collapse */ })));
}

export type ShareAccess = 'open' | 'password' | 'account';
export type ShareMeta = {
  public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean>;
  access?: ShareAccess; passwordHash?: string | null;
};
export type ResolvedShare = {
  public: boolean; spaces: Record<string, boolean>; docs: Record<string, boolean>;
  access: ShareAccess; passwordHash: string | null;
};
export type PublicDoc = { type: string; id: string; title: string; markdown: string };
export type PublicRecord = { type: string; id: string; value: unknown };

export type OrganismHelpers = ReturnType<typeof createOrganismHelpers>;

/** The closure-bound helpers shared by every organism route group. Created once per router. */
export function createOrganismHelpers(config: AimeatConfig, storage: Storage) {
  // ── Gate primitive helpers ──

  // Active membership keyed by bare owner name (or org agent) — returns { role } or null.
  const memberRole = async (req: Express.Request, organism: { agentGaiis: string[] }, id: string): Promise<string | null> => {
    if (req.auth!.sub && organism.agentGaiis.includes(req.auth!.sub)) return 'member';
    const ownerName = req.auth!.owner;
    if (!ownerName) return null;
    const m = await storage.getMembership(id, ownerName);
    return m && m.status === 'active' ? m.role : null;
  };

  // Read the organism's manifest value (for gate policy).
  const readManifest = async (id: string): Promise<unknown> => {
    const key = `organism.${id}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return items.find(r => r.key === key)?.value ?? null;
  };

  // Append a signed-by-convention decision-log entry (the audit/Prove trail), then bound the log so it
  // can't grow without limit. Every gate action (publish/batch-publish/auto-approve/gate-approval) writes
  // one of these `meta.decisions.<uuid>` rows; left uncapped a busy app (e.g. a CRM publishing hundreds of
  // records a day) fills the organism owner's memory quota with immortal audit rows that a record delete
  // never touches. We keep the most recent `organismDecisionLogCap` entries per organism (0 = unlimited).
  const writeDecision = async (organismId: string, by: string, summary: string, refs: string[]): Promise<void> => {
    const did = uuidv4();
    const now = new Date().toISOString();
    const prefix = `organism.${organismId}.meta.decisions.`;
    await storage.setMemory({
      key: `${prefix}${did}`,
      ownerGaii: by,
      value: { ts: now, kind: 'decision', by, summary, refs },
      visibility: 'private', tags: ['gate'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    await pruneDecisionLog(organismId, prefix);
  };

  // Keep the organism's gate-audit log at or below the configured cap. Cheap common case: one value-free
  // key scan (the log is bounded, so ~cap rows). Only when over cap do we load the tiny values to order by
  // recency and bulk-delete the oldest — pruning back below the cap by a margin so this runs about once per
  // (cap/10) writes, not on every write once the cap is reached.
  const pruneDecisionLog = async (organismId: string, prefix: string): Promise<void> => {
    const cap = config.organismDecisionLogCap;
    if (cap <= 0 || !storage.listMemoryKeysByPrefix || !storage.bulkDeleteMemory) return;
    try {
      const keys = await storage.listMemoryKeysByPrefix(prefix);
      if (keys.length <= cap) return;
      const margin = Math.max(1, Math.floor(cap / 10));
      const target = cap - margin;                         // prune down to here
      const { items } = await storage.listAllMemory({ prefix, limit: keys.length });
      items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      const toRemove = items.slice(0, Math.max(0, items.length - target)).map(r => ({ ownerGaii: r.ownerGaii, key: r.key }));
      if (toRemove.length) await storage.bulkDeleteMemory(toRemove);
    } catch { /* best-effort: the audit write already succeeded; a prune failure must not fail the gate */ }
  };

  // Read the organism's runtime config entry (organism.{id}.meta.config) — UI-editable; absent = defaults.
  const readConfig = async (organismId: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${organismId}.meta.config`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  // meta.* writes require admin/creator; shared.* (and others) need only membership.
  const canWriteNamespace = (role: string, namespace: string): boolean =>
    namespace.startsWith('meta.') ? (role === 'creator' || role === 'admin') : true;

  // Publish a draft: snapshot organism.{id}.{ns}.{instance}.draft → a new .version.N and .latest.
  // Schema-validated (the draft must be a valid object). Returns the new version number.
  // TARGET-009 S1: expectedVersion carries the publisher's optimistic lock into the write guards
  // (a namespace with requires_expected_version refuses a publish over a version it didn't read).
  const publishDraft = async (
    organismId: string, ws: string | undefined, namespace: string, instance: string, publisher: string,
    expectedVersion?: number | null,
  ): Promise<{ ok: true; version: number; skipped?: boolean } | { ok: false; code: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    const ownerGhii = ownerGhiiOf(publisher);
    // Value-free version handling: skip `.version.N` rows in the scan (their full values were loaded
    // just to find maxN) — the version numbers come from the key names alone (listVersionRefs below).
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000, excludeVersionRows: true });
    const draft = items.filter(r => r.key === `${base}.draft`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);
    if (!draft) return { ok: false, code: 'NO_DRAFT' };

    // Scope embedded document images to this workspace (members-only) + rewrite to /v1/pub before the
    // draft becomes the published copy — so a shared doc's images load for members without going public.
    const draftValue = await normalizeDocValueImages(storage, config, draft.value, ownerGhii.split('@')[0], ws ? `${organismId}/${ws}` : undefined);

    const validation = await validateMemoryWrite(`${base}.latest`, draftValue, storage, { viaPublish: true, expectedVersion });
    if (!validation.valid) return { ok: false, code: 'INVALID', violations: validation.errors };

    const versionRefs = await listVersionRefs(storage, base);
    const maxN = maxVersionOf(versionRefs);
    const now = new Date().toISOString();
    const vis = draft.visibility;
    const tags = draft.tags ?? [];
    const existingLatest = items.filter(r => r.key === `${base}.latest`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);

    // Change-guard: an unchanged re-publish (contract agents re-publish the same draft on every poll
    // cycle) must NOT append a byte-identical .version.N. Consume the draft and return without touching
    // .latest or firing the Tracked-Response side effect.
    if (existingLatest && JSON.stringify(existingLatest.value) === JSON.stringify(draftValue)) {
      await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
      return { ok: true, version: maxN, skipped: true };
    }
    // Honour the manifest's `versioned` flag (default true): a `versioned:false` space (e.g. a request
    // queue) keeps only .latest — no immutable per-publish history.
    const mkey = `${wsRoot}.meta.manifest`;
    const manRec = (await storage.listAllMemory({ prefix: mkey, limit: 10 })).items.find(r => r.key === mkey);
    const pubOt = ((manRec?.value as { objectTypes?: Array<{ namespace?: string; versioned?: boolean; create_only?: boolean; maxVersions?: number }> } | undefined)?.objectTypes ?? []).find(o => o.namespace === namespace);
    const versioned = pubOt?.versioned !== false;
    const n = maxN + 1;

    if (versioned) {
      await storage.setMemory({
        key: `${base}.version.${n}`, ownerGaii: publisher, value: draftValue,
        visibility: vis, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      });
      // Retention: prune history beyond the space's window (append-only spaces never pruned).
      await pruneVersionsAfterPublish(storage, config, { refs: versionRefs, publishedN: n, ot: pubOt });
    }
    // .latest (current state) is owned by a member's GHII — ONE owner per key, so it never forks into
    // per-agent duplicates a read then has to disambiguate. Preserve the record's existing owner
    // (normalised to their GHII — never a raw agent GAII); a brand-new record is owned by the publisher's
    // GHII. The immutable .version.N above keeps the publisher's attribution. collapseKeyTo removes any
    // copy of .latest left under another identity.
    const latestOwner = existingLatest ? ownerGhiiOf(existingLatest.ownerGaii) : ownerGhii;
    await storage.setMemory({
      key: `${base}.latest`, ownerGaii: latestOwner, value: draftValue,
      visibility: vis, tags, ttlHours: null,
      version: (existingLatest?.version ?? 0) + 1,
      createdAt: existingLatest?.createdAt ?? now, updatedAt: now,
    });
    await collapseKeyTo(storage, `${base}.latest`, latestOwner);
    // Memory Contracts (reactive): publishing a watched record fires Tracked Response evaluation
    // (gated O(1) on the track-registry in the subscriber).
    emitMemoryWritten(latestOwner, `${base}.latest`);
    // Consume the draft — it was the proposal-for-publishing; now it's a frozen version + the new
    // .latest. Re-editing the published instance starts a fresh draft. (Without this the workspace
    // shows a stale draft alongside the identical published copy.)
    await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
    return { ok: true, version: n };
  };

  // BATCH publish (data-access redesign, Phase 2): publish MANY drafts in ONE workspace+namespace as one
  // operation. Semantics are byte-for-byte those of publishDraft above — schema/write-guard validation
  // (viaPublish + optimistic lock), the `versioned` flag, the unchanged-republish change-guard, the
  // .version.N (publisher-owned) + .latest (GHII-owned) attribution, the collapse of forked .latest
  // copies, and draft consumption — but the shared reads are amortised (ONE namespace scan + ONE manifest
  // read for the whole batch) and the writes/deletes are committed together (ONE bulkSetMemory + ONE
  // bulkDeleteMemory), instead of the per-record scan + individual setMemory/deleteMemory pipeline that a
  // 520-record CADENCE import ran as ~11k separate operations. Auth (membership, meta.* role, archive,
  // publish gate) stays in the route; this is the data operation.
  const publishDraftsBatch = async (
    organismId: string, ws: string | undefined, namespace: string, instances: string[], publisher: string,
    expectedVersions?: Record<string, number | null>,
    // DRAFT-LESS import: when a value is supplied per instance, publish it DIRECTLY (no draft to read or
    // consume). An import has the final values, so this collapses N draft-writes + N publishes into ONE
    // request. Interactive edits still use the draft flow (no directValues).
    directValues?: Record<string, { value: unknown; visibility?: MemoryRecord['visibility'] }>,
  ): Promise<{ results: Array<{ instance: string; ok: boolean; version?: number; skipped?: boolean; code?: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const ownerGhii = ownerGhiiOf(publisher);
    const nsPrefix = `${wsRoot}.${namespace}.`;
    // ONE scan of the whole namespace + ONE manifest read (the `versioned` flag) for the entire batch.
    // excludeVersionRows: the batch needs each record's .draft/.latest VALUES but only the version
    // NUMBERS — those come from ONE value-free key scan (versionRefsByBase below).
    const { items: allRows } = await storage.listAllMemory({ prefix: nsPrefix, limit: 100000, excludeVersionRows: true });
    const versionsByBase = await versionRefsByBase(storage, nsPrefix);
    const mkey = `${wsRoot}.meta.manifest`;
    const manRec = (await storage.listAllMemory({ prefix: mkey, limit: 10 })).items.find(r => r.key === mkey);
    const pubOt = ((manRec?.value as { objectTypes?: Array<{ namespace?: string; versioned?: boolean; create_only?: boolean; requires_expected_version?: boolean; maxVersions?: number }> } | undefined)?.objectTypes ?? []).find(o => o.namespace === namespace);
    const versioned = pubOt?.versioned !== false;
    // Retention window for this namespace (0 = keep all; append-only spaces resolve to 0).
    const pruneWindow = effectiveMaxVersions(config, pubOt);

    // AMORTISE the per-record validation: the write-guard policy and the applicable schema are the SAME
    // for every record in one namespace, so resolve them ONCE (was a manifest read + a .latest read + a
    // schema lookup PER record inside validateMemoryWrite — O(N) storage round-trips that dominated the
    // publish; the batch already holds each record's existing .latest from the namespace scan above). The
    // policy comes straight off the objectType we already read — no second manifest scan.
    const policy = pubOt && (pubOt.create_only === true || pubOt.requires_expected_version === true)
      ? { createOnly: pubOt.create_only === true, requiresExpectedVersion: pubOt.requires_expected_version === true }
      : null;
    const schemaRec = instances.length ? await storage.findApplicableSchema(`${nsPrefix}${instances[0]}.latest`) : null;
    let schemaToValidate: Record<string, unknown> | null = null;
    if (schemaRec) {
      schemaToValidate = { ...(schemaRec.schemaJson as Record<string, unknown>) };
      if (schemaRec.schemaMode === 'strict' && schemaToValidate.type === 'object') schemaToValidate.additionalProperties = false;
    }

    const now = new Date().toISOString();
    const toUpsert: MemoryRecord[] = [];
    const toDelete: { ownerGaii: string; key: string }[] = [];
    const toEmit: Array<{ owner: string; key: string }> = [];
    const results: Array<{ instance: string; ok: boolean; version?: number; skipped?: boolean; code?: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> = [];

    for (const instance of instances) {
      const base = `${nsPrefix}${instance}`;
      const items = allRows.filter(r => r.key === base || r.key.startsWith(`${base}.`));
      // Draft-less import: use the supplied value as the source; else read the record's .draft.
      const direct = directValues ? directValues[instance] : undefined;
      const draft = direct
        ? { value: direct.value, ownerGaii: publisher, visibility: (direct.visibility ?? 'owner') as MemoryRecord['visibility'], tags: [] as string[] }
        : items.filter(r => r.key === `${base}.draft`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);
      if (!draft) { results.push({ instance, ok: false, code: 'NO_DRAFT' }); continue; }
      const draftValue = await normalizeDocValueImages(storage, config, draft.value, ownerGhii.split('@')[0], ws ? `${organismId}/${ws}` : undefined);
      const expectedVersion = expectedVersions?.[instance] ?? null;

      const maxN = maxVersionOf(versionsByBase.get(base) ?? []);
      const existingLatest = items.filter(r => r.key === `${base}.latest`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);
      const vis = draft.visibility;
      const tags = draft.tags ?? [];

      // Change-guard: an unchanged re-publish just consumes the draft (no new version/latest, no side
      // effect). Runs FIRST — a byte-identical write is never a guard conflict (mirrors checkWriteGuard).
      if (existingLatest && JSON.stringify(existingLatest.value) === JSON.stringify(draftValue)) {
        if (!direct) toDelete.push({ ownerGaii: draft.ownerGaii, key: `${base}.draft` });
        results.push({ instance, ok: true, version: maxN, skipped: true });
        continue;
      }
      // Write-guard (in-memory, from the ONCE-loaded policy + the already-loaded existingLatest) — same
      // decisions checkWriteGuard makes, without the per-record manifest + .latest reads.
      if (policy) {
        if (policy.createOnly && existingLatest) {
          results.push({ instance, ok: false, code: 'INVALID', violations: [{ schema_rule: 'write_guard_conflict', message: `record "${instance}" already exists in append-only namespace "${namespace}"`, path: '/' }] });
          continue;
        }
        if (policy.requiresExpectedVersion) {
          const badNew = !existingLatest && expectedVersion != null && expectedVersion !== 0;
          const badMissing = existingLatest && expectedVersion == null;
          const badMismatch = existingLatest && expectedVersion != null && expectedVersion !== existingLatest.version;
          if (badNew || badMissing || badMismatch) {
            results.push({ instance, ok: false, code: 'INVALID', violations: [{ schema_rule: badMissing ? 'write_guard_version_required' : 'write_guard_version_mismatch', message: `expected_version does not match for "${instance}" (current ${existingLatest?.version ?? 0})`, path: '/' }] });
            continue;
          }
        }
      }
      // Schema (in-memory, from the ONCE-compiled schema) — no per-record findApplicableSchema round-trip.
      if (schemaToValidate) {
        const sv = validateValueAgainstSchema(draftValue, schemaToValidate);
        if (!sv.ok) { results.push({ instance, ok: false, code: 'INVALID', violations: (sv.errors ?? []).map(m => ({ message: m })) }); continue; }
      }
      const n = maxN + 1;
      if (versioned) {
        toUpsert.push({ key: `${base}.version.${n}`, ownerGaii: publisher, value: draftValue, visibility: vis, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now });
        // Retention: history rows beyond the window ride the batch's ONE bulk delete.
        for (const r of versionRefsToPrune(versionsByBase.get(base) ?? [], n, pruneWindow)) toDelete.push({ ownerGaii: r.ownerGaii, key: r.key });
      }
      // .latest is owned by a member GHII (never a raw agent GAII) — ONE owner per key. A brand-new
      // record is owned by the publisher's GHII; an existing one keeps its (GHII-normalised) owner. The
      // explicit version is what setMemory INSERTs; on an in-place UPDATE setMemory recomputes it — same
      // as publishDraft, since bulkSetMemory reuses setMemory verbatim.
      const latestOwner = existingLatest ? ownerGhiiOf(existingLatest.ownerGaii) : ownerGhii;
      toUpsert.push({ key: `${base}.latest`, ownerGaii: latestOwner, value: draftValue, visibility: vis, tags, ttlHours: null, version: (existingLatest?.version ?? 0) + 1, createdAt: existingLatest?.createdAt ?? now, updatedAt: now });
      // Collapse: any pre-existing .latest copy under a DIFFERENT owner is removed (single-owner key).
      for (const r of items) if (r.key === `${base}.latest` && r.ownerGaii !== latestOwner) toDelete.push({ ownerGaii: r.ownerGaii, key: r.key });
      if (!direct) toDelete.push({ ownerGaii: draft.ownerGaii, key: `${base}.draft` });   // consume the draft (none for a direct import)
      toEmit.push({ owner: latestOwner, key: `${base}.latest` });
      results.push({ instance, ok: true, version: n });
    }

    // ONE bulk upsert (every version + latest), then ONE bulk delete (consumed drafts + collapsed copies).
    if (toUpsert.length) { if (storage.bulkSetMemory) await storage.bulkSetMemory(toUpsert); else for (const r of toUpsert) await storage.setMemory(r); }
    if (toDelete.length) { if (storage.bulkDeleteMemory) await storage.bulkDeleteMemory(toDelete); else for (const r of toDelete) await storage.deleteMemory(r.ownerGaii, r.key); }
    // Fire Tracked-Response evaluation for each published record (gated O(1) in the subscriber).
    for (const e of toEmit) emitMemoryWritten(e.owner, e.key);
    return { results };
  };

  // Reopen a published record for editing: copy organism.{id}.{ns}.{instance}.latest → .draft so the
  // existing edit → publish flow applies. The published .latest stays live (and keeps serving readers)
  // until the edited draft is re-published. Refuses to clobber an in-progress draft.
  const revertToDraft = async (
    organismId: string, ws: string | undefined, namespace: string, instance: string, reverter: string,
  ): Promise<{ ok: true } | { ok: false; code: 'NO_LATEST' | 'DRAFT_EXISTS' }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    // Reopening needs only .draft/.latest/bare — never the `.version.N` history values.
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000, excludeVersionRows: true });
    if (items.find(r => r.key === `${base}.draft`)) return { ok: false, code: 'DRAFT_EXISTS' };
    // Mirror the workspace read: the published current state is .latest, or the bare key as fallback.
    const latest = items.find(r => r.key === `${base}.latest`) ?? items.find(r => r.key === base);
    if (!latest) return { ok: false, code: 'NO_LATEST' };
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `${base}.draft`, ownerGaii: reverter, value: latest.value,
      visibility: latest.visibility, tags: latest.tags ?? [], ttlHours: null,
      version: 1, createdAt: now, updatedAt: now,
    });
    return { ok: true };
  };

  // ── Workspace access (per-workspace, creator-controlled, consent-backed) ──

  const wsRegPrefix = (id: string) => `organism.${id}.meta.workspaces`;
  const bareOwner = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];

  /** Find a workspace's registry entry across every member's registry (one key per owner). */
  const findWsEntry = async (id: string, ws: string): Promise<{ id: string; name?: string; createdBy?: string; createdAt?: string; ownerGaii: string } | null> => {
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string }> } | null)?.workspaces ?? [];
      const entry = list.find(w => w.id === ws);
      if (entry) return { ...entry, ownerGaii: rec.ownerGaii };
    }
    return null;
  };

  /** The read-authz decision for a workspace given its ALREADY-FETCHED manifest record (or null when the
   *  workspace has no manifest). Factored out of {@link canReadWs} so a batch caller resolving N
   *  workspaces from ONE cross-owner multi-key read and the single-ws caller share ONE authz code path —
   *  no drift. For a GEAI (callerGaii is the eco: sub, unchanged by resolveIdentity) a matching 'read'
   *  data-area grant is also required — model A / strict, so a GEAI riding its owner's membership honours
   *  the owner-selected read scope. */
  const canReadWsManifest = async (callerGaii: string, manKey: string, man: MemoryRecord | null): Promise<boolean> => {
    if (!man) return false;
    let allowed: boolean;
    if (man.ownerGaii === callerGaii || isSameOwner(man.ownerGaii, callerGaii)) {
      allowed = true;
    } else {
      const d = await authorizeRead(storage, config, { ownerGaii: man.ownerGaii, accessorGaii: callerGaii, resourceKey: man.key, visibility: man.visibility, groupId: man.groupId, action: 'read' });
      allowed = d.allowed;
    }
    if (allowed && isGEAI(callerGaii)) allowed = await ecoMayReadKey(storage, callerGaii, manKey);
    return allowed;
  };

  /** Can this accessor read the workspace's content (i.e. its manifest)? One manifest scan, then the
   *  shared {@link canReadWsManifest} decision. */
  const canReadWs = async (id: string, ws: string, callerGaii: string): Promise<boolean> => {
    const mkey = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: mkey, limit: 10 });
    return canReadWsManifest(callerGaii, mkey, items.find(r => r.key === mkey) ?? null);
  };

  /** Batch-fetch the manifest record of MANY workspaces in ONE cross-owner `key IN (…)` read (falls back
   *  to a per-ws scan when the backend lacks the primitive). Returns wsId → freshest manifest record —
   *  collapses the discovery list's per-workspace canReadWs manifest scans (N → 1). Pair with
   *  {@link canReadWsManifest} to resolve each workspace's access from the pre-fetched manifest without a
   *  second round-trip. */
  const readWsManifests = async (id: string, wsIds: string[]): Promise<Map<string, MemoryRecord>> => {
    const out = new Map<string, MemoryRecord>();
    if (wsIds.length === 0) return out;
    const keyOf = (ws: string) => `organism.${id}.w.${ws}.meta.manifest`;
    const wsOfKey = new Map(wsIds.map(ws => [keyOf(ws), ws]));
    let recs: MemoryRecord[];
    if (storage.getMemoryByKeysAnyOwner) {
      recs = await storage.getMemoryByKeysAnyOwner([...wsOfKey.keys()]);
    } else {
      recs = [];
      for (const ws of wsIds) {
        const mkey = keyOf(ws);
        const { items } = await storage.listAllMemory({ prefix: mkey, limit: 10 });
        const m = items.find(r => r.key === mkey);
        if (m) recs.push(m);
      }
    }
    for (const r of recs) {
      const ws = wsOfKey.get(r.key);
      if (ws) out.set(ws, fresherRec(out.get(ws), r));   // dedupe forked-owner copies → freshest
    }
    return out;
  };

  /** Distinct workspace-id count per organism, batched: ONE cross-owner key-IN read of every org's
   *  registry record (`organism.{id}.meta.workspaces` — one per member who created a workspace) instead
   *  of a listAllMemory scan per organism on the ?include=counts list view. Returns orgId → count
   *  (0 for an org with no registry). Falls back to a per-org scan when the primitive is absent. */
  const workspaceCountsByOrg = async (orgIds: string[]): Promise<Map<string, number>> => {
    const counts = new Map<string, number>(orgIds.map(id => [id, 0]));
    if (orgIds.length === 0) return counts;
    const keyToOrg = new Map(orgIds.map(id => [wsRegPrefix(id), id]));
    const idsByOrg = new Map<string, Set<string>>(orgIds.map(id => [id, new Set<string>()]));
    const recs: MemoryRecord[] = storage.getMemoryByKeysAnyOwner
      ? await storage.getMemoryByKeysAnyOwner([...keyToOrg.keys()])
      : (await Promise.all(orgIds.map(id => storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 }).then(r => r.items)))).flat();
    for (const rec of recs) {
      const orgId = keyToOrg.get(rec.key);   // exact-key match (skips any `…workspaces.*` sibling)
      if (!orgId) continue;
      const set = idsByOrg.get(orgId)!;
      for (const w of ((rec.value as { workspaces?: Array<{ id?: string }> } | null)?.workspaces ?? [])) {
        if (w.id) set.add(w.id);
      }
    }
    for (const [id, set] of idsByOrg) counts.set(id, set.size);
    return counts;
  };

  /** workspace-id → name map per organism, batched with the SAME ONE cross-owner key-IN registry read as
   *  {@link workspaceCountsByOrg}. Backs the "Waiting for you" aggregate's ws-name lookup (was a registry
   *  scan per organism-with-approvals). Returns orgId → Map(wsId → name); an org with no registry is absent. */
  const workspaceNamesByOrg = async (orgIds: string[]): Promise<Map<string, Map<string, string>>> => {
    const out = new Map<string, Map<string, string>>();
    if (orgIds.length === 0) return out;
    const keyToOrg = new Map(orgIds.map(id => [wsRegPrefix(id), id]));
    const recs: MemoryRecord[] = storage.getMemoryByKeysAnyOwner
      ? await storage.getMemoryByKeysAnyOwner([...keyToOrg.keys()])
      : (await Promise.all(orgIds.map(id => storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 }).then(r => r.items)))).flat();
    for (const rec of recs) {
      const orgId = keyToOrg.get(rec.key);   // exact-key match
      if (!orgId) continue;
      let names = out.get(orgId);
      if (!names) { names = new Map<string, string>(); out.set(orgId, names); }
      for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [])) {
        if (w.id && !names.has(w.id)) names.set(w.id, w.name ?? w.id);
      }
    }
    return out;
  };

  /** Create a consent grant if an equivalent active one doesn't already exist (idempotent). */
  const ensureConsent = async (ownerGaii: string, dataPattern: string, recipient: string, purpose: string): Promise<void> => {
    const existing = await storage.listConsents(ownerGaii, { status: 'active' });
    if (existing.some(c => c.dataPattern === dataPattern && c.recipient === recipient)) return;
    const now = new Date().toISOString();
    await storage.createConsent({ id: uuidv4(), ownerGaii, dataPattern, recipient, purpose, scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
  };

  // Workspace member roles delegate to the ONE shared service (services/workspace-roles.ts) so the REST
  // routes, the MCP tools, and the invitation-accept path share a single authority path (no parallel
  // ad-hoc mechanism). These thin wrappers keep the route-local call sites terse.
  /** Set a member's role, stamping provenance (source + grantedBy) for the members listing. */
  const setWorkspaceRole = (creatorGhii: string, id: string, ws: string, grantee: string, role: WsRole, source: WsGrantSource, grantedBy: string) =>
    grantWorkspaceRole(storage, config, { creatorGhii, orgId: id, ws, grantee, role, source, grantedBy });
  const revokeWorkspaceRole = (creatorGhii: string, id: string, ws: string, grantee: string) =>
    revokeWsRoleSvc(storage, config, { creatorGhii, orgId: id, ws, grantee });
  /** Map the creator's active grants → each member's current role + provenance for a workspace. */
  const memberRolesForWs = (creatorGhii: string, id: string, ws: string): Promise<Map<string, WsMemberRole>> =>
    listWorkspaceMemberRoles(storage, config, { creatorGhii, orgId: id, ws });

  // ── Document-space public sharing (meta.share) ──

  const readShareMeta = async (id: string, ws: string): Promise<ResolvedShare> => {
    const key = `organism.${id}.w.${ws}.meta.share`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    const v = (items.find(r => r.key === key)?.value as ShareMeta | undefined) ?? {};
    const access: ShareAccess = v.access === 'password' || v.access === 'account' ? v.access : 'open';
    return {
      public: !!v.public, spaces: v.spaces ?? {}, docs: v.docs ?? {},
      access, passwordHash: typeof v.passwordHash === 'string' ? v.passwordHash : null,
    };
  };

  /** The share state as the API is allowed to show it — the password hash NEVER leaves the server. */
  const redactShare = (share: ResolvedShare): Record<string, unknown> => ({
    public: share.public, spaces: share.spaces, docs: share.docs,
    access: share.access, has_password: !!share.passwordHash,
  });

  /** Gate the NO-AUTH public read path by the share's access mode. Returns null when allowed,
   *  else the 401 error code + message the caller should send. Assumes the caller has already
   *  established that something IS shared (404 no-disclosure runs first). */
  const shareGateDenied = async (
    req: Request, organism: { agentGaiis: string[] }, id: string, ws: string, share: ResolvedShare,
  ): Promise<{ code: string; message: string } | null> => {
    if (share.access === 'open') return null;
    const authed = !!req.auth && req.auth.anonymous !== true;
    if (share.access === 'account') {
      return authed ? null : { code: 'SHARE_ACCOUNT_REQUIRED', message: 'Sign in to view these shared documents' };
    }
    // access === 'password': a valid share token for THIS org+ws, or an authenticated org member.
    const rawToken = req.headers['x-share-token'];
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (token) {
      try {
        const v = await verifyShareToken(token);
        if (v.org === id && v.ws === ws) return null;
      } catch { /* invalid/expired token falls through to the 401 */ }
    }
    if (authed && await memberRole(req, organism, id)) return null;
    return { code: 'SHARE_PASSWORD_REQUIRED', message: 'This share is password-protected' };
  };

  const isDocPublic = (share: ResolvedShare, typeName: string, docId: string): boolean => {
    const docKey = `${typeName}/${docId}`;
    if (docKey in share.docs) return !!share.docs[docKey];
    if (typeName in share.spaces) return !!share.spaces[typeName];
    return !!share.public;
  };

  /** Read a workspace's manifest value regardless of which member owns it (public path — no auth). */
  const readWsManifestValue = async (id: string, ws: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  /** Collect the PUBLISHED (.latest) document-space pages that the share meta marks public. An optional
   *  filter narrows to one {type,id}. Drafts/versions are never included. */
  const collectPublicDocs = async (
    id: string, ws: string, share: ResolvedShare, filter?: { type: string; id: string },
  ): Promise<PublicDoc[]> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const out: PublicDoc[] = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'document') continue;
      if (filter && filter.type !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const docId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        if (filter && filter.id !== docId) continue;
        if (!isDocPublic(share, name, docId)) continue;
        const v = r.value as Record<string, unknown> | null;
        out.push({
          type: name, id: docId,
          title: (v && typeof v.title === 'string') ? v.title : docId,
          markdown: (v && typeof v.markdown === 'string') ? v.markdown : '',
        });
      }
    }
    return out;
  };

  /** Collect the PUBLISHED (.latest) records-space entries that the share meta marks public. An optional
   *  filter narrows to one space (objectType name). Drafts/versions are never included; each entry's full
   *  value is returned. Mirrors collectPublicDocs for records-mode spaces, gated by the same share meta
   *  (docs[type/id] > spaces[type] > public), so a workspace opts a records space into anonymous read the
   *  same way it opts a document space in. */
  const collectPublicRecords = async (
    id: string, ws: string, share: ResolvedShare, filter?: { space?: string },
  ): Promise<PublicRecord[]> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const out: PublicRecord[] = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'records') continue;
      if (filter?.space && filter.space !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const recId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        if (!isDocPublic(share, name, recId)) continue;
        out.push({ type: name, id: recId, value: r.value ?? null });
      }
    }
    return out;
  };

  /** Render a list of public docs as a single markdown document (for ?format=md). */
  const docsToMarkdown = (wsName: string | undefined, docs: PublicDoc[]): string => {
    const parts: string[] = [];
    if (wsName) parts.push(`# ${wsName}\n`);
    for (const d of docs) { parts.push(`## ${d.title}\n`); parts.push(d.markdown.trim()); parts.push('\n---\n'); }
    return parts.join('\n');
  };

  /** Shared gate for the grant/revoke routes — returns the workspace creator's name, or sends the
   *  error response and returns null. Only the workspace creator or an org admin may manage access. */
  const requireWsManager = async (req: Request, res: Response, id: string, ws: unknown): Promise<string | null> => {
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    const callerRole = await memberRole(req, organism, id);
    if (!callerRole) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return null; }
    if (!ws || typeof ws !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return null; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return null; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== req.auth!.owner && callerRole !== 'creator' && callerRole !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can manage access')); return null;
    }
    return createdBy;
  };

  /** Creator/admin gate shared by the email-invite management routes. */
  const requireOrgAdmin = async (req: Request, res: Response, id: string): Promise<OrganismRecord | null> => {
    const callerGhii = req.auth!.owner as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can manage invitations'));
      return null;
    }
    return organism;
  };

  const codeInviteGuards = [requireAuth(), requireExternalPrincipal(), requireScope('organism:invite')];
  /** Shared member gate for the code routes; returns { organism, membership, unlimited } or null (responded). */
  const requireOrgMember = async (req: Request, res: Response, id: string): Promise<{ organism: OrganismRecord; role: string; unlimited: boolean } | null> => {
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    const membership = await storage.getMembership(id, req.auth!.owner as string);
    if (!membership || membership.status !== 'active') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return null; }
    const unlimited = membership.role === 'creator' || membership.role === 'admin';
    return { organism, role: membership.role, unlimited };
  };

  // Normalize an `agent` body field (full GAII or bare name → full GAII under the given owner).
  const toAgentGaii = (agent: unknown, owner: string): string => {
    const s = String(agent || '').trim();
    return s.includes('#') ? s : `${s}#${owner}@${config.nodeId}`;
  };

  const validateArchiveTarget = (id: string, body: Record<string, unknown>): { ok: true; target: { level: ArchiveLevel; orgId: string; ws?: string; namespace?: string; key?: string } } | { ok: false; msg: string } => {
    const level = body.level as ArchiveLevel;
    if (!['organism', 'workspace', 'space', 'record'].includes(level)) return { ok: false, msg: 'level must be organism|workspace|space|record' };
    const ws = typeof body.ws === 'string' ? body.ws : undefined;
    const namespace = typeof body.namespace === 'string' ? body.namespace : undefined;
    const key = typeof body.key === 'string' ? body.key : undefined;
    if ((level === 'workspace' || level === 'space' || level === 'record') && !ws) return { ok: false, msg: 'ws is required for workspace/space/record' };
    if (level === 'space' && !namespace) return { ok: false, msg: 'namespace is required for space' };
    if (level === 'record') {
      if (!key) return { ok: false, msg: 'key is required for record' };
      if (!key.startsWith(`organism.${id}.w.${ws}.`)) return { ok: false, msg: 'key must be inside organism.{id}.w.{ws}.' };
    }
    return { ok: true, target: { level, orgId: id, ws, namespace, key } };
  };

  const archiveHandler = (mode: 'archive' | 'unarchive') => async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', `Only the creator or an admin can ${mode} organism content`));
      return;
    }
    const v = validateArchiveTarget(id, (req.body ?? {}) as Record<string, unknown>);
    if (!v.ok) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', v.msg)); return; }
    const actor = resolveIdentity(req.auth!, config.nodeId);
    try {
      const result = mode === 'archive'
        ? await archiveTarget(storage, v.target, actor)
        : await unarchiveTarget(storage, v.target, actor);
      res.json(success(config.nodeId, { [mode === 'archive' ? 'archived' : 'restored']: result.count, level: result.level, root: result.root }));
      emitChange('organisms');
      void updateOrganismStructure(storage, config, id, { event: `${v.target.level} ${mode}d`, actor }).catch(() => { /* timeline best-effort */ });
    } catch (e) {
      res.status(400).json(error(config.nodeId, 'ARCHIVE_FAILED', (e as Error).message || `Could not ${mode}`));
    }
  };

  return {
    memberRole, readManifest, writeDecision, readConfig, canWriteNamespace, publishDraft, publishDraftsBatch, revertToDraft,
    wsRegPrefix, bareOwner, findWsEntry, canReadWs, canReadWsManifest, readWsManifests, workspaceCountsByOrg, workspaceNamesByOrg, ensureConsent,
    setWorkspaceRole, revokeWorkspaceRole, memberRolesForWs,
    readShareMeta, redactShare, shareGateDenied, isDocPublic, readWsManifestValue, collectPublicDocs, collectPublicRecords, docsToMarkdown,
    requireWsManager, requireOrgAdmin, codeInviteGuards, requireOrgMember, toAgentGaii,
    validateArchiveTarget, archiveHandler,
  };
}

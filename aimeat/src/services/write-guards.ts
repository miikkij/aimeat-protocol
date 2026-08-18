/**
 * @file write-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-namespace write guards for workspace records (TARGET-009 S1): the workspace
 *   manifest can declare, per objectType, `create_only: true` (an append-only space — publishing
 *   over an existing record, or deleting one, is refused) and/or `requires_expected_version: true`
 *   (optimistic locking — a publish over an existing record must carry the record's current
 *   version). The guard lives on the node, not in a prompt: writers (human/agent/chat) are
 *   assumed fallible, and a conflicting write is REFUSED with the current version in the error.
 *   Direct writes to `.latest` / `.version.N` in a guarded namespace are refused outright — a
 *   guarded space accepts state only through the draft → publish path, which is where the
 *   expected-version intent can travel. Drafts are never guarded.
 * @structure
 *   parseWorkspaceRecordKey() — organism.{org}.w.{ws}.{ns}.{id}.{role} → parts (or null)
 *   getNamespacePolicy()      — read the workspace manifest's objectType guard flags
 *   checkWriteGuard()         — the write-side decision, ValidationResult-shaped
 *   checkDeleteGuard()        — the delete-side decision for append-only spaces
 * @usage Called from validateMemoryWrite (every write surface funnels through it) and from the
 *   external delete routes. The publish path passes { viaPublish, expectedVersion }.
 * @version-history
 *   v1.1.0 — 2026-08-15 — getNamespacePolicy folds the guard flags across EVERY copy of the manifest
 *     instead of taking the first row a scan returns. The key is unique per owner, not per node, so
 *     a member's own copy without `create_only` could resolve here and turn an append-only namespace
 *     off with the creator's manifest untouched. No copy may withdraw a guard now; the same fork can
 *     happen by accident between a member GHII and a legacy agent GAII, with no attacker at all.
 *     E2E test-quality audit finding A24.
 *   v1.0.0 — 2026-07-07 — Initial: create_only + requires_expected_version manifest policies
 *     (doc-pyxoy49 S1/S3, doc-write-guards; the TARGET-005 overwrite incident is the reason).
 */
import type { Storage } from '../storage/interface.js';
import type { ValidationResult } from './schema-validator.js';

export interface WriteGuardCtx {
  /** True when the write arrives through the draft → publish path (organisms/MCP publish). */
  viaPublish?: boolean;
  /** The version the publisher believes is current (optimistic lock). */
  expectedVersion?: number | null;
}

export interface WorkspaceRecordKeyParts {
  organismId: string;
  ws: string;
  namespace: string;
  instance: string;
  /** 'draft' | 'latest' | 'version' (any .version.N) | '' for other suffixes */
  role: string;
}

const KEY_RE = /^organism\.([0-9a-fA-F-]{8,})\.w\.([A-Za-z0-9_-]+)\.(.+)$/;

/** Split a workspace record key into parts; null for anything that is not one. */
export function parseWorkspaceRecordKey(key: string): WorkspaceRecordKeyParts | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const rest = m[3];
  // rest = {namespace}.{instance}.{role...} — role is the last segment ('draft'|'latest') or
  // 'version.N' (two segments). Namespace itself may contain dots (e.g. room.target_event).
  const parts = rest.split('.');
  if (parts.length < 3) return null;
  let role = '';
  let cut = parts.length;
  const last = parts[parts.length - 1];
  if (last === 'draft' || last === 'latest') { role = last; cut = parts.length - 1; }
  else if (parts.length >= 2 && parts[parts.length - 2] === 'version' && /^\d+$/.test(last)) { role = 'version'; cut = parts.length - 2; }
  if (!role || cut < 2) return null;
  const instance = parts[cut - 1];
  const namespace = parts.slice(0, cut - 1).join('.');
  if (!namespace || !instance) return null;
  return { organismId: m[1], ws: m[2], namespace, instance, role };
}

export interface NamespaceGuardPolicy {
  createOnly: boolean;
  requiresExpectedVersion: boolean;
}

/**
 * Read the guard flags for a namespace from the workspace manifest (objectTypes entry).
 *
 * ONE KEY, POSSIBLY SEVERAL ROWS. A memory key is unique per OWNER, not per node, so
 * `organism.<id>.w.<ws>.meta.manifest` can exist under more than one identity in the same
 * workspace — deliberately, when a member's GHII and a legacy agent GAII both wrote one, and
 * deliberately-hostile when an ordinary active member posts their own copy. This read used to take
 * `items.find(...)`, the FIRST row the scan happened to return, so a second copy without
 * `create_only` could resolve here and switch an append-only namespace off while the creator's
 * manifest sat untouched and nothing looked wrong.
 *
 * The flags are folded with OR rather than resolved to one copy. A guard is a claim that a record
 * may not be rewritten, and no copy of the manifest should be able to WITHDRAW that claim — which is
 * exactly what "pick one row" allows, whichever row it picks. The freshest-wins rule readLatest uses
 * below is right for content and wrong here: a planted copy is by definition the fresher one.
 *
 * The residual is that a copy can turn a guard ON for a namespace that had none, which is a member
 * making a workspace stricter than its creator meant. That is a nuisance rather than a hole, it is
 * visible in the workspace's own records, and the same member could already write the junk this
 * would block.
 */
export async function getNamespacePolicy(
  storage: Storage, organismId: string, ws: string, namespace: string,
): Promise<NamespaceGuardPolicy | null> {
  const mkey = `organism.${organismId}.w.${ws}.meta.manifest`;
  const { items } = await storage.listAllMemory({ prefix: mkey, limit: 50 });
  let createOnly = false;
  let requiresExpectedVersion = false;
  let found = false;
  for (const rec of items) {
    if (rec.key !== mkey) continue;
    const man = rec.value as
      { objectTypes?: Array<{ namespace?: string; create_only?: boolean; requires_expected_version?: boolean }> } | undefined;
    const ot = (man?.objectTypes ?? []).find(o => o?.namespace === namespace);
    if (!ot) continue;
    found = true;
    if (ot.create_only === true) createOnly = true;
    if (ot.requires_expected_version === true) requiresExpectedVersion = true;
  }
  if (!found || (!createOnly && !requiresExpectedVersion)) return null;
  return { createOnly, requiresExpectedVersion };
}

const fresher = <T extends { updatedAt: string }>(a: T | null, b: T): T =>
  (!a || String(b.updatedAt) > String(a.updatedAt)) ? b : a;

async function readLatest(storage: Storage, base: string): Promise<{ value: unknown; version: number; updatedAt: string } | null> {
  const { items } = await storage.listAllMemory({ prefix: `${base}.latest`, limit: 50 });
  let best: { value: unknown; version: number; updatedAt: string } | null = null;
  for (const r of items) if (r.key === `${base}.latest`) best = fresher(best, { value: r.value, version: r.version, updatedAt: r.updatedAt });
  return best;
}

const guardError = (rule: string, message: string, params: Record<string, unknown>): ValidationResult => ({
  valid: false,
  errors: [{ path: '/', message, schema_rule: rule, params }],
});

/**
 * The write-side guard. Returns { valid: true } when the key is not a guarded workspace record.
 * Identical re-publishes are always allowed (idempotence — the publish change-guard skips them).
 */
export async function checkWriteGuard(
  key: string, value: unknown, storage: Storage, ctx?: WriteGuardCtx,
): Promise<ValidationResult> {
  const parts = parseWorkspaceRecordKey(key);
  if (!parts || parts.role === 'draft') return { valid: true };
  const policy = await getNamespacePolicy(storage, parts.organismId, parts.ws, parts.namespace);
  if (!policy) return { valid: true };

  const base = `organism.${parts.organismId}.w.${parts.ws}.${parts.namespace}.${parts.instance}`;
  const latest = await readLatest(storage, base);

  // A byte-identical write changes nothing — never a conflict (re-publish loops are a fact of life).
  if (latest && JSON.stringify(latest.value) === JSON.stringify(value)) return { valid: true };

  if (!ctx?.viaPublish) {
    return guardError('write_guard_protected',
      `namespace "${parts.namespace}" is write-guarded: publish through the draft flow (direct .latest/.version writes are refused)`,
      { namespace: parts.namespace, key });
  }

  if (policy.createOnly && latest) {
    return guardError('write_guard_conflict',
      `record "${parts.instance}" already exists in append-only namespace "${parts.namespace}" (current version ${latest.version}, updated ${latest.updatedAt}) — create refused, nothing was written`,
      { namespace: parts.namespace, instance: parts.instance, current_version: latest.version, updated_at: latest.updatedAt });
  }

  if (policy.requiresExpectedVersion) {
    const expected = ctx.expectedVersion;
    if (!latest) {
      if (expected != null && expected !== 0) {
        return guardError('write_guard_version_mismatch',
          `record "${parts.instance}" does not exist yet (expected_version ${expected} given) — nothing was written`,
          { namespace: parts.namespace, instance: parts.instance, current_version: 0 });
      }
      return { valid: true };
    }
    if (expected == null) {
      return guardError('write_guard_version_required',
        `namespace "${parts.namespace}" requires expected_version on update (current version ${latest.version}, updated ${latest.updatedAt}) — pass the version you read`,
        { namespace: parts.namespace, instance: parts.instance, current_version: latest.version, updated_at: latest.updatedAt });
    }
    if (expected !== latest.version) {
      return guardError('write_guard_version_mismatch',
        `expected_version ${expected} does not match current version ${latest.version} (updated ${latest.updatedAt}) — nothing was written; re-read and retry`,
        { namespace: parts.namespace, instance: parts.instance, current_version: latest.version, updated_at: latest.updatedAt });
    }
  }
  return { valid: true };
}

/** The delete-side guard: an append-only (create_only) namespace refuses .latest/.version deletes. */
export async function checkDeleteGuard(key: string, storage: Storage): Promise<ValidationResult> {
  const parts = parseWorkspaceRecordKey(key);
  if (!parts || parts.role === 'draft') return { valid: true };
  const policy = await getNamespacePolicy(storage, parts.organismId, parts.ws, parts.namespace);
  if (!policy?.createOnly) return { valid: true };
  return guardError('write_guard_append_only',
    `namespace "${parts.namespace}" is append-only: existing records cannot be deleted`,
    { namespace: parts.namespace, instance: parts.instance, key });
}

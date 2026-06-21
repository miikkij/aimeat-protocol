/**
 * @file access-guard.ts
 * @description Shared read-authorization core for identity-owned resources (memory + file
 *   storage). Wraps the consent decision (`checkConsentForRead`) and the audit write
 *   (`auditDataAccess`) into a single `authorizeRead()` call so every read path applies the
 *   SAME visibility/consent/group rules and produces the SAME audit trail — preventing the
 *   storage layer from drifting away from memory's reference behavior.
 * @structure
 *   - authorizeRead() — one access decision + one audit entry for a read/list/search.
 * @usage
 *   import { authorizeRead } from '../services/access-guard.js';
 *   const r = await authorizeRead(storage, config, {
 *     ownerGaii, accessorGaii, resourceKey: `storage:${key}`,
 *     visibility: file.visibility, groupId: file.groupId, action: 'read',
 *   });
 *   if (!r.allowed) { res.status(403)...; return; }
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Extract memory/storage read guard into a shared authorizeRead().
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { checkConsentForRead, auditDataAccess } from './consent.js';

export interface AuthorizeReadArgs {
  /** GAII/GHII that owns the resource. */
  ownerGaii: string;
  /** GAII/GHII attempting the read (use 'anonymous' for unauthenticated public reads). */
  accessorGaii: string;
  /** Audit key for the resource — `key` for memory, `storage:${key}` for files. */
  resourceKey: string;
  visibility: string;
  /** Sharing-group id — REQUIRED for `visibility:'group'` to membership-check. */
  groupId?: string;
  action: 'read' | 'list' | 'search';
}

/**
 * Decide whether a non-owner-scoped read is allowed and write the matching audit entry.
 *
 * Semantics (kept identical to memory's reference read path):
 * - `public`            → always allowed; NOT audited (auditing access to public data has no
 *                         consent value and was a large share of the unbounded audit growth).
 * - consent layer off   → non-public denied with reason `consent_disabled`, NOT audited
 *                         (the caller decides the HTTP mapping, e.g. 404 vs 403).
 * - otherwise           → delegate to `checkConsentForRead`; audit ONLY when the read is
 *                         DENIED. Allowed reads are no longer audited (see consent-audit-buffer).
 *
 * The caller owns the HTTP status mapping. This function never throws on a denial.
 */
export async function authorizeRead(
  storage: Storage,
  config: AimeatConfig,
  args: AuthorizeReadArgs,
): Promise<{ allowed: boolean; consentId?: string; reason?: string }> {
  const { ownerGaii, accessorGaii, resourceKey, visibility, groupId, action } = args;

  if (visibility === 'public') {
    return { allowed: true, reason: 'public_data' };
  }

  if (!config.consentEnabled) {
    return { allowed: false, reason: 'consent_disabled' };
  }

  const result = await checkConsentForRead(storage, resourceKey, ownerGaii, accessorGaii, visibility, groupId);
  if (!result.allowed) {
    await auditDataAccess(storage, result.consentId ?? null, ownerGaii, accessorGaii, resourceKey, action, false);
  }
  return result;
}

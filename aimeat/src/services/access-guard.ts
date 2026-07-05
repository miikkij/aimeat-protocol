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
 *   v1.1.0 -- 2026-07-05 -- Add the `workspace` tier: readable by members of the organism workspace in
 *     `workspaceRef` ("org/ws"), gated by canReadWorkspace() (membership + manifest read). Brings storage
 *     files to parity with memory (both now share private/owner/group/workspace/members/public through
 *     this one guard). New optional args: workspaceRef, accessorSub, accessorOwner (workspace check only).
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
  /** "<organismId>/<workspaceId>" — REQUIRED for `visibility:'workspace'` to member-check via canReadWorkspace. */
  workspaceRef?: string;
  /** The accessor's raw auth `sub` (agent GAII / bare owner) — needed for the workspace membership check. */
  accessorSub?: string;
  /** The accessor's bare owner name — needed for the workspace membership check. */
  accessorOwner?: string;
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

  // 'members' = any authenticated user of this node. The CALLER must verify the
  // accessor is a real authenticated principal (not the anonymous-mode shared
  // identity) BEFORE calling — this guard cannot tell anonymity from a GAII
  // string. Like public, allowed member reads are not audited.
  if (visibility === 'members') {
    return { allowed: true, reason: 'members_data' };
  }

  // 'workspace' = readable by members of the organism workspace(s) in `workspaceRef`. That field is a
  // SPACE-SEPARATED list of one or more "<org>/<ws>" bindings — a file/record can be shared into several
  // workspaces, and the caller is allowed if they can read ANY ONE of them. Each binding is gated by the
  // SAME workspace read gate as GET /v1/organisms/:id/workspace (membership + manifest read), so a
  // file/record authorizes identically to workspace content. Dynamic import breaks the access-guard ↔
  // workspace-access cycle (workspace-access imports authorizeRead for its own manifest gate). Node-local.
  if (visibility === 'workspace') {
    const refs = (args.workspaceRef || '').split(/\s+/).filter(Boolean);
    if (!refs.length) return { allowed: false, reason: 'workspace_unbound' };
    const { canReadWorkspace } = await import('./workspace-access.js');
    for (const ref of refs) {
      const slash = ref.indexOf('/');
      if (slash < 1 || slash >= ref.length - 1) continue;
      const organism = await storage.getOrganism(ref.slice(0, slash));
      if (!organism) continue;
      if (await canReadWorkspace(storage, config, organism, args.accessorSub, args.accessorOwner, accessorGaii, ref.slice(slash + 1))) {
        return { allowed: true, reason: 'workspace_member' };
      }
    }
    await auditDataAccess(storage, null, ownerGaii, accessorGaii, resourceKey, action, false);
    return { allowed: false, reason: 'workspace_denied' };
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

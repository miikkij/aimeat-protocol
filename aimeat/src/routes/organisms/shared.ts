/**
 * @file src/routes/organisms/shared.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism route groups' shared helpers: everything services/organism-gate.ts
 *   gives (membership and role checks, workspace registry lookups, draft publish and revert, share
 *   meta, the decision log), plus the Express forms only a route needs: the gates that send their
 *   own refusal (requireWsManager, requireOrgAdmin, requireOrgMember), the invite-code middleware
 *   chain and the archive handler.
 * @structure createOrganismHelpers(config, storage) → createOrganismGate(config, storage) + the Express forms
 * @usage const H = createOrganismHelpers(config, storage); const role = await H.memberRole(req, organism, id);
 * @version-history
 *   2026-11-13 — requireOrgAdmin asks services/organism-read/manager.ts organismForManager, the read
 *     and the rule the email invitation tools ask; refuseOrgAdmin is its refusal (structure programme
 *     2026-11, unit 2b). The answers are unchanged. requireMember asks services/organism-read/member.ts,
 *     the read and the membership rule the workspace MCP tools ask.
 *   2026-11-04 — The helpers that take no Express request or response moved unchanged to
 *     services/organism-gate.ts (createOrganismGate), which the MCP tools and the services import; this
 *     file keeps the Express forms and returns the same object as before (codebase analysis 2026-11-03,
 *     item D-f). Its earlier history is in services/organism-gate.ts.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../../auth/middleware.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { organismArchiveOp } from '../../services/organism-archive-op.js';
import { callerOf } from '../../middleware/caller.js';
import { organismForManager } from '../../services/organism-read/manager.js';
import { organismMemberGate } from '../../services/organism-read/member.js';
import { createOrganismGate } from '../../services/organism-gate.js';

// The pure rules every importer of ./shared.js reached, from where they live now.
export { canWriteNamespaceRule, roleSatisfies, fresherRec, ownerGhiiOf, collapseKeyTo, readOrganismConfig } from '../../services/organism-record-helpers.js';
export type { ShareAccess, ShareMeta, ResolvedShare, PublicDoc, PublicRecord } from './share-types.js';
export type { BatchPublishItemResult } from '../../services/organism-gate.js';

export type OrganismHelpers = ReturnType<typeof createOrganismHelpers>;

/** The closure-bound helpers shared by every organism route group. Created once per router. */
export function createOrganismHelpers(config: AimeatConfig, storage: Storage) {
  const gate = createOrganismGate(config, storage);
  const { memberRole, findWsEntry, bareOwner } = gate;

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
    // The read and the owner-or-admin rule are services/organism-read/manager.ts, which the email
    // invitation tools ask too.
    const gate = await organismForManager(storage, id, { owner: req.auth!.owner as string });
    if (!gate.ok) { refuseOrgAdmin(res, gate.code); return null; }
    return gate.organism;
  };
  /** The organism and the caller's role in it, or the refusal sent: services/organism-read/member.ts,
   *  which the workspace MCP tools ask too (denyReason). */
  const requireMember = async (req: Request, res: Response, id: string): Promise<{ organism: OrganismRecord; role: string } | null> => {
    const gate = await organismMemberGate(storage, id, req.auth!);
    if (gate.ok) return { organism: gate.organism, role: gate.role };
    if (gate.code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
    else res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
    return null;
  };
  /** requireOrgAdmin's refusal, for a route that asks a manager-gated service function itself. */
  const refuseOrgAdmin = (res: Response, code: 'NOT_FOUND' | 'ACCESS_DENIED'): void => {
    if (code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
    else res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can manage invitations'));
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

  // The whole operation, role rule, target check, fence, archive and timeline entry, is
  // services/organism-archive-op.ts, which aimeat_organism_archive runs too.
  const archiveHandler = (mode: 'archive' | 'unarchive') => async (req: Request, res: Response) => {
    const session = callerOf(req, config.nodeId, storage);
    const out = await organismArchiveOp({ storage, config },
      { principal: resolveIdentity(req.auth!, config.nodeId), ownerName: req.auth!.owner, roles: session.roles, scopes: session.scopes },
      req.params.id as string, mode, (req.body ?? {}) as Record<string, unknown>);
    if (!out.ok) {
      res.status(out.status).json(out.details !== undefined
        ? error(config.nodeId, out.code, out.message, out.status, out.details)
        : error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { [mode === 'archive' ? 'archived' : 'restored']: out.count, level: out.level, root: out.root }));
  };

  return {
    ...gate,
    requireWsManager, requireOrgAdmin, refuseOrgAdmin, requireMember, codeInviteGuards, requireOrgMember,
    archiveHandler,
  };
}

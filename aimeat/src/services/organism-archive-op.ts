/**
 * @file src/services/organism-archive-op.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Archive or bring back organism content, the whole operation, for
 *   POST /v1/organisms/:id/archive, POST /v1/organisms/:id/unarchive and the node MCP tool
 *   aimeat_organism_archive.
 *
 *   The operation: the organism exists; the caller is the creator or an admin by archiveRoleOf, which
 *   answers 'member' for a principal listed among the organism's own agents, so an attached agent is
 *   refused even when its owner is the creator; the target is valid for its level; a record or space
 *   of a fenced record space is archived for an agent only through one of the extensions it names
 *   (services/fenced-space.ts); then the archive itself (services/archive.ts), the organisms change
 *   event, and the organism timeline entry (services/structure-snapshot.ts).
 *
 *   The MCP tool decided the role from the owner's membership row alone and wrote no timeline entry
 *   until 2026-10-16, so an attached agent of the creator was allowed there and refused on REST.
 * @structure organismArchiveOp · validateArchiveTarget · OrganismArchiveCaller · OrganismArchiveOutcome
 * @usage
 *   const out = await organismArchiveOp({ storage, config }, caller, organismId, 'archive', body);
 *   if (!out.ok) render(out.status, out.code, out.message, out.details);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial, out of routes/organisms/shared.ts archiveHandler and mcp/organisms.ts (QA audit D2-08).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { archiveTarget, unarchiveTarget, archiveRoleOf, type ArchiveLevel, type ArchiveTarget } from './archive.js';
import { archiveFenceTarget, fencedSpaceRefusal } from './fenced-space.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** Who archives: the resolved principal, the account it acts for, and the session's roles and scopes. */
export interface OrganismArchiveCaller {
  principal: string;
  ownerName: string;
  roles: readonly string[];
  scopes: readonly string[];
}

export type OrganismArchiveOutcome =
  | { ok: true; mode: 'archive' | 'unarchive'; count: number; level: ArchiveLevel; root: string }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

/** The target of an archive, checked for its level. The key of a record must lie in its workspace. */
export function validateArchiveTarget(id: string, body: Record<string, unknown>): { ok: true; target: ArchiveTarget } | { ok: false; msg: string } {
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
}

/** Archive (or bring back) one target in one organism as `caller`. Refuses before it writes. */
export async function organismArchiveOp(
  deps: { storage: Storage; config: AimeatConfig },
  caller: OrganismArchiveCaller,
  organismId: string,
  mode: 'archive' | 'unarchive',
  body: Record<string, unknown>,
): Promise<OrganismArchiveOutcome> {
  const { storage, config } = deps;
  const organism = await storage.getOrganism(organismId);
  if (!organism) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
  // The rule ctx.workspace.archiveRecords asks too (services/archive.ts archiveRoleOf).
  const role = await archiveRoleOf(storage, organism, { principal: caller.principal, ownerName: caller.ownerName });
  if (role !== 'creator' && role !== 'admin') {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: `Only the creator or an admin can ${mode} organism content` };
  }
  const v = validateArchiveTarget(organismId, body);
  if (!v.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: v.msg };
  // A record or a space of a record space that names extensions is archived, or brought back, for an
  // agent only through one of them. A whole workspace or organism stays with the role rule above.
  const fenceTarget = archiveFenceTarget(v.target);
  if (fenceTarget && v.target.ws) {
    const fenced = await fencedSpaceRefusal({ storage, config }, { principal: caller.principal, roles: caller.roles, scopes: caller.scopes }, organismId, v.target.ws, fenceTarget);
    if (fenced) return { ok: false, status: fenced.status, code: fenced.code, message: fenced.message, details: fenced.details };
  }
  let result;
  try {
    result = mode === 'archive'
      ? await archiveTarget(storage, v.target, caller.principal)
      : await unarchiveTarget(storage, v.target, caller.principal);
  } catch (e) {
    return { ok: false, status: 400, code: 'ARCHIVE_FAILED', message: (e as Error).message || `Could not ${mode}` };
  }
  emitChange('organisms');
  // The timeline entry, best effort: a failed snapshot never fails the archive that happened.
  void updateOrganismStructure(storage, config, organismId, { event: `${v.target.level} ${mode}d`, actor: caller.principal })
    .catch(err => { logger.warn('organismArchiveOp: timeline best-effort', { error: String(err) }); });
  return { ok: true, mode, count: result.count, level: result.level, root: result.root };
}

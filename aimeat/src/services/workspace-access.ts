/**
 * @file workspace-access.ts
 * @description The single shared read-authorization gate for an organism workspace. A workspace is
 *   SHARED: authorization is at the workspace level (the manifest record is the one gate), not per
 *   record — see GET /v1/organisms/:id/workspace. This module extracts that exact two-stage check
 *   (1) organism MEMBERSHIP (active member, keyed by bare owner name, OR an org agent listed in
 *   agentGaiis) AND (2) workspace READ (own the manifest / same-owner / a viewer|contributor consent
 *   grant via authorizeRead) into ONE `canReadWorkspace()` so every surface that exposes workspace
 *   content — the REST read, the comment threads, and the connector record-push subscription — applies
 *   identical rules. This is the security foundation for record push: a record pushed over the tunnel
 *   MUST require the same access as a REST read, so the push path calls this and nothing else.
 * @structure
 *   - canReadWorkspace(...) -- membership + manifest-gate read decision (boolean).
 * @usage
 *   import { canReadWorkspace } from '../services/workspace-access.js';
 *   const ok = await canReadWorkspace(storage, config, organism, callerSub, callerOwner, callerGaii, ws);
 * @version-history
 *   v1.0.0 -- 2026-06-21 -- Extract the workspace read gate (was inline in the route + organism-comments)
 *     so the connector record-push subscription enforces byte-identical access.
 */
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';

/**
 * Decide whether the caller may READ the content of one workspace.
 *
 * Two gates, both required, identical to GET /v1/organisms/:id/workspace:
 *  1. Membership — an org agent (callerSub in organism.agentGaiis) OR the caller's owner has an
 *     ACTIVE membership (memberships are keyed by the BARE owner name).
 *  2. Workspace read — the manifest record at `organism.{id}.w.{ws}.meta.manifest` is readable:
 *     the caller owns it, is the same owner, or holds a viewer/contributor consent grant
 *     (authorizeRead). No manifest record → not readable (membership alone is discovery-only).
 *
 * Never throws; returns false on any miss.
 */
export async function canReadWorkspace(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  callerSub: string | undefined,
  callerOwner: string | undefined,
  callerGaii: string,
  ws: string,
): Promise<boolean> {
  // Gate 1: membership.
  let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
  if (!isMember && callerOwner) {
    const m = await storage.getMembership(organism.id, callerOwner);
    isMember = !!m && m.status === 'active';
  }
  if (!isMember) return false;

  // Gate 2: workspace read (manifest is the single gate record).
  const manKey = `organism.${organism.id}.w.${ws}.meta.manifest`;
  const scan = await storage.listAllMemory({ prefix: manKey, limit: 5 });
  const manRec = scan.items.find(r => r.key === manKey);
  if (!manRec) return false;
  if (manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii)) return true;
  const decision = await authorizeRead(storage, config, {
    ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
    visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
  });
  return decision.allowed;
}

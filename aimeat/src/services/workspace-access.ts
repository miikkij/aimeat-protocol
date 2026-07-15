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
 *   v1.1.0 -- 2026-07-02 -- Gate 3: ecosystem (GEAI) reads require a matching 'read' data-area grant
 *     (model A / strict), so a GEAI riding its owner's membership honours the owner-selected read scope.
 *   v1.2.0 -- 2026-07-15 -- Org managers (creator/admin) automatically pass Gate 2: an organism admin
 *     reads every workspace under the organism without a per-workspace grant (they already manage its
 *     access, invites, export + archive). Shared isOrgManager() helper reused by the write middleware +
 *     the discovery/list surfaces. Gate 3 (GEAI strict) still narrows after — a GEAI never rides this.
 */
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner, isGEAI } from '../utils/gaii.js';
import { ecoMayReadKey } from './ecosystem-access.js';

/**
 * True when this owner is the organism's creator or an admin. Org managers get automatic read+write
 * access to EVERY workspace under the organism — they already manage its access grants, invitations,
 * export and archive, so gating them out of the content itself was the illogical gap. Keyed on the
 * BARE owner name, exactly like every other membership check (organisms.ts / consent.ts). Never
 * throws; returns false for a missing owner / non-member / plain member.
 */
export async function isOrgManager(
  storage: Storage,
  orgId: string,
  ownerName: string | undefined,
): Promise<boolean> {
  if (!ownerName) return false;
  const m = await storage.getMembership(orgId, ownerName);
  return !!m && m.status === 'active' && (m.role === 'creator' || m.role === 'admin');
}

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
  // Gate 1: membership. The owner's membership row also decides org-manager status (creator/admin),
  // which grants an automatic pass on Gate 2 below — resolve it in the same lookup.
  let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
  let manager = false;
  if (callerOwner) {
    const m = await storage.getMembership(organism.id, callerOwner);
    if (m && m.status === 'active') {
      isMember = true;
      manager = m.role === 'creator' || m.role === 'admin';
    }
  }
  if (!isMember) return false;

  // Gate 2: workspace read (manifest is the single gate record). An org manager (creator/admin) passes
  // unconditionally — they own the organism's access, so they read every workspace under it.
  const manKey = `organism.${organism.id}.w.${ws}.meta.manifest`;
  const scan = await storage.listAllMemory({ prefix: manKey, limit: 5 });
  const manRec = scan.items.find(r => r.key === manKey);
  if (!manRec) return false;
  let allowed: boolean;
  if (manager || manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii)) {
    allowed = true;
  } else {
    const decision = await authorizeRead(storage, config, {
      ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
      visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
    });
    allowed = decision.allowed;
  }

  // Gate 3 (ecosystem/GEAI only, model A / strict): a GEAI rides its owner's organism membership, so
  // membership + the manifest gate alone would let it read any workspace its owner belongs to. Require
  // a matching owner-granted 'read' data-area — the same allowlist the write path enforces — so the
  // owner-selected read scope actually bites (and the tunnel record-push honours it identically).
  if (allowed && callerSub && isGEAI(callerSub)) allowed = await ecoMayReadKey(storage, callerSub, manKey);
  return allowed;
}

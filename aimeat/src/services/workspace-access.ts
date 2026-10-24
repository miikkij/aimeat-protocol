/**
 * @file workspace-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - decideWorkspaceRead(...) -- the same, with each gate's answer and the manifest it read.
 *   - canReadWorkspaceRecords(...) -- canReadWorkspace, or a non-member holding the grant of an
 *     active member who created the workspace (the member records read and the member page routes).
 * @usage
 *   import { canReadWorkspace } from '../services/workspace-access.js';
 *   const ok = await canReadWorkspace(storage, config, organism, callerSub, callerOwner, callerGaii, ws);
 * @version-history
 *   2026-10-25 — canReadWorkspaceRecords admits a non-member's grant only while its issuer is an
 *     active member of the organism (secaudit2026oct22, ruled by the developer on 2026-10-25).
 *   2026-10-24 — canReadWorkspaceRecords: the gate of the member records read and the member page
 *     routes. A workspace creator removed from the organism no longer reads through them; a
 *     non-member's grant still does, pending the developer's decision (secaudit2026oct22).
 *   2026-09-29 — decideWorkspaceRead: the same gates with each answer, taking the manifest a loader
 *     already holds. canReadWorkspace is its boolean. The REST read and readWorkspaceOp, which each
 *     carried their own copy, decide here now (TARGET-082, one check component).
 *   2026-09-28 — Gate 0: an agent the organism does not admit (agentAccess 'listed') reads no workspace.
 *   v1.0.0 -- 2026-06-21 -- Extract the workspace read gate (was inline in the route + organism-comments)
 *     so the connector record-push subscription enforces byte-identical access.
 *   v1.1.0 -- 2026-07-02 -- Gate 3: ecosystem (GEAI) reads require a matching 'read' data-area grant
 *     (model A / strict), so a GEAI riding its owner's membership honours the owner-selected read scope.
 *   v1.2.0 -- 2026-07-15 -- Org managers (creator/admin) automatically pass Gate 2: an organism admin
 *     reads every workspace under the organism without a per-workspace grant (they already manage its
 *     access, invites, export + archive). Shared isOrgManager() helper reused by the write middleware +
 *     the discovery/list surfaces. Gate 3 (GEAI strict) still narrows after — a GEAI never rides this.
 *   v1.3.0 -- 2026-09-24 -- Gate 2 reads the copy of the manifest that counts (readWorkspaceMetaRecord:
 *     the workspace creator's, then an organism manager's), not the first copy the store returns.
 */
import type { Storage, OrganismRecord, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner, isGEAI, localAccountName } from '../utils/gaii.js';
import { ecoMayReadKey } from './ecosystem-access.js';
import { readWorkspaceMetaRecord } from './workspace-meta.js';
import { agentBarred } from './organism-agent-access.js';

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

/** Each gate's answer, for a caller that must tell "not a member" from "cannot read this workspace". */
export interface WorkspaceReadDecision {
  member: boolean;
  manager: boolean;
  canRead: boolean;
  /** The manifest the decision was made on, or null when there is none. */
  manRec: MemoryRecord | null;
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
  return (await decideWorkspaceRead(storage, config, organism, callerSub, callerOwner, callerGaii, ws)).canRead;
}

/**
 * The same decision with each gate's answer. A loader that already holds the workspace's records
 * passes the manifest it picked from them (`manRec`, the copy that counts, or null for none), so the
 * decision reads nothing twice; `ws` null is an organism's legacy root, whose manifest the caller
 * must pass. This is the one place the workspace read is decided (TARGET-082, spec §13.2).
 */
export async function decideWorkspaceRead(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  callerSub: string | undefined,
  callerOwner: string | undefined,
  callerGaii: string,
  ws: string | null,
  known?: { manRec: MemoryRecord | null },
): Promise<WorkspaceReadDecision> {
  const no = (member: boolean, manager: boolean, manRec: MemoryRecord | null): WorkspaceReadDecision => ({ member, manager, canRead: false, manRec });
  // Gate 0: an organism that admits only listed agents treats every other agent as a non-member.
  if (agentBarred(organism, callerSub)) return no(false, false, null);
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
  if (!isMember) return no(false, false, null);

  // Gate 2: workspace read (manifest is the single gate record). An org manager (creator/admin) passes
  // unconditionally — they own the organism's access, so they read every workspace under it. The
  // record is the copy that counts (services/workspace-meta.ts), never the first one the store
  // returns: a member's own copy of the manifest would otherwise make them its owner here.
  const manRec = known ? known.manRec
    : ws === null ? null : await readWorkspaceMetaRecord(storage, organism.id, ws, 'meta.manifest', config.nodeId);
  if (!manRec) return no(true, manager, null);
  const manKey = manRec.key;
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
  return { member: true, manager, canRead: allowed, manRec };
}

/**
 * The read gate of the member records read (GET …/workspace/records) and the member page routes
 * (…/frame, …/opened): canReadWorkspace, and in addition a caller who is not a member of the
 * organism but holds a viewer or contributor grant from the workspace's creator.
 *
 * WHY THE SECOND BRANCH. These routes used to decide on the manifest alone (canReadWsManifest in
 * routes/organisms/shared.ts), with no membership gate, so a grant opened them to a non-member, and
 * test/e2e-workspace-member-records.ts test 6 asserts that use. The same rule also admitted the
 * manifest's own owner, a workspace creator removed or banned from the organism, who then kept reading
 * every member's published records (secaudit2026oct22, canReadWsManifest no-membership-gate). The
 * creator now reads only as an active member, and a non-member's grant counts only while the
 * account that issued it is an active member (ruled by the developer on 2026-10-25).
 */
export async function canReadWorkspaceRecords(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  callerSub: string | undefined,
  callerOwner: string | undefined,
  callerGaii: string,
  ws: string,
): Promise<boolean> {
  if (await canReadWorkspace(storage, config, organism, callerSub, callerOwner, callerGaii, ws)) return true;
  const manRec = await readWorkspaceMetaRecord(storage, organism.id, ws, 'meta.manifest', config.nodeId);
  // The manifest's own owner is its creator, who reads only as an active member (above).
  if (!manRec || manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii)) return false;
  // A grant opens these routes to a non-member only while the account that issued it, the owner of
  // the manifest copy that counts, is an active member: a creator removed or banned from the
  // organism no longer lets anyone in (ruled by the developer on 2026-10-25).
  const issuer = await storage.getMembership(organism.id, localAccountName(manRec.ownerGaii));
  if (!issuer || issuer.status !== 'active') return false;
  const decision = await authorizeRead(storage, config, {
    ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
    visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
  });
  if (!decision.allowed) return false;
  return isGEAI(callerGaii) ? ecoMayReadKey(storage, callerGaii, manRec.key) : true;
}

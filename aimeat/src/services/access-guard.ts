/**
 * @file access-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared read-authorization core for identity-owned resources (memory + file
 *   storage). Wraps the consent decision (`checkConsentForRead`) and the audit write
 *   (`auditDataAccess`) into a single `authorizeRead()` call so every read path applies the
 *   SAME visibility/consent/group rules and produces the SAME audit trail — preventing the
 *   storage layer from drifting away from memory's reference behavior.
 * @structure
 *   - authorizeRead() — one access decision + one audit entry for a read/list/search.
 *   - isOrgManager() / canReadWorkspace() / decideWorkspaceRead() / canReadWorkspaceRecords() — the
 *     workspace read gate (moved from workspace-access.ts, which re-exports them; its header holds
 *     their history). It lives here because it and authorizeRead call each other.
 * @usage
 *   import { authorizeRead } from '../services/access-guard.js';
 *   const r = await authorizeRead(storage, config, {
 *     ownerGaii, accessorGaii, resourceKey: `storage:${key}`,
 *     visibility: file.visibility, groupId: file.groupId, action: 'read',
 *   });
 *   if (!r.allowed) { res.status(403)...; return; }
 * @version-history
 *   v1.8.0 -- 2026-11-13 -- The workspace read gate (isOrgManager, canReadWorkspace, decideWorkspaceRead,
 *     canReadWorkspaceRecords, WorkspaceReadDecision) moved here unchanged from workspace-access.ts,
 *     which re-exports it. The 'workspace' tier calls canReadWorkspace in this file in place of a
 *     dynamic import of workspace-access.ts, which ends the run-time import cycle between the two
 *     files (structure programme 2026-11, unit 4).
 *   v1.7.0 -- 2026-10-24 -- The guard derives the visitor fact from the reader identity itself
 *     (namesAnotherNode, through localAccountOf): an identity of another node is a visitor whether or
 *     not the caller passed `accessorFederated`, so the MCP file read, extension files, file
 *     references, the AI read viewer, dangling references, the workspace gates and the permission
 *     simulation refuse it the 'members' tier as the memory and /v1/pub reads do. Identities of this
 *     node decide as before (secaudit2026oct22, members-tier-admits-federated-visitor).
 *   v1.6.1 -- 2026-10-24 -- The 'members' tier does not admit a visitor from another node
 *     (accessorFederated): it is decided by the consent layer as a private read is
 *     (secaudit2026oct22, members-tier-admits-federated-visitor).
 *   v1.6.0 -- 2026-10-17 -- The 'organism:<id>' tier: the active members of one organism and the
 *     agents it admits (services/audience.ts audienceAllows), decided before the consent layer and
 *     audited on denial; `accessorFederated` marks a visitor (plan doc-mvcn6c7e4e5q, V3.2/V3.3).
 *   v1.5.0 -- 2026-10-15 -- `noAudit`: GET /v1/permissions/check asks this guard as a simulation and
 *     writes no audit row (feature-list audit 43).
 *   v1.4.0 -- 2026-09-08 -- A person reads what their own agents and apps hold. The owner-self bypass
 *     was an exact identity match, which kept a scoped agent from riding its human's ownership (still
 *     does, the rule is one-directional now) but also hid a person's own files from them: an
 *     attachment their agent had sent in their name was unreadable to them. Ruled by the developer,
 *     2026-09-08: the owner always sees their agents' things.
 *   v1.3.0 -- 2026-08-11 -- Key-space shares are checked before any tier is refused, because a share
 *     is deliberately independent of visibility: a `private` record covered by a live share is
 *     readable by that group and by nobody else. Both memory and storage files get it here, so the
 *     two stay one decision.
 *   v1.0.0 -- 2026-06-07 -- Extract memory/storage read guard into a shared authorizeRead().
 *   v1.1.0 -- 2026-07-05 -- Add the `workspace` tier: readable by members of the organism workspace in
 *     `workspaceRef` ("org/ws"), gated by canReadWorkspace() (membership + manifest read). Brings storage
 *     files to parity with memory (both now share private/owner/group/workspace/members/public through
 *     this one guard). New optional args: workspaceRef, accessorSub, accessorOwner (workspace check only).
 *   v1.2.0 -- 2026-07-05 -- Owner-self bypass: an accessor that is EXACTLY the resource owner is always
 *     allowed (the /v1/pub author-reads-own case), regardless of the visibility tier's membership gate.
 */
import type { Storage, OrganismRecord, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { checkConsentForRead, auditDataAccess } from './consent.js';
import { isKeyShared } from './group-shares.js';
import { parseGaiiLoose, localAccountOf, currentNodeId, isSameOwner, isGEAI, localAccountName } from '../utils/gaii.js';
import { ecoMayReadKey } from './ecosystem-access.js';
import { readWorkspaceMetaRecord } from './workspace/meta.js';
import { agentBarred } from './organism-agent-access.js';
import { isOrganismVisibilityWord } from '../utils/visibility-words.js';
import { organismVisibilityAdmits } from './organism-visibility.js';

/**
 * Does this reader identity name a principal of ANOTHER node? A visitor is named by its home GHII
 * (`alice@their-node`), and a route that composed `${owner}@${nodeId}` for it has
 * `alice@their-node@this-node`; localAccountOf answers null for both, and an account name for every
 * identity of this node (`alice`, `alice@this-node`, `bot#alice@this-node`, `eco:app#alice@this-node`).
 * The anonymous reader and an empty identity are not visitors (the anonymous check is the caller's).
 * Before the node id is registered at boot every identity reads as local, which is the old answer.
 */
function namesAnotherNode(identity: string): boolean {
  if (!identity || identity === 'anonymous' || !currentNodeId()) return false;
  return localAccountOf(identity) === null;
}

/**
 * Is `accessor` the HUMAN behind `resourceOwner`? True for `alice@n` reading something owned by
 * `bot#alice@n` or `eco:app#alice@n`; false in the other direction, false between two agents, and
 * false across nodes. The accessor must be the bare GHII: a principal with a `#` in it is acting
 * under a grant, not as the account.
 */
function isOwnerOf(accessor: string, resourceOwner: string): boolean {
  if (accessor.includes('#')) return false;
  if (!resourceOwner.includes('#')) return false;
  const a = parseGaiiLoose(accessor), r = parseGaiiLoose(resourceOwner);
  return a.owner === r.owner && a.node === r.node;
}

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
  /** The reader is a visitor from another node (isForeignPrincipal); refused for 'organism:<id>',
   *  and for 'members' admitted only through a share or a consent. Optional: the guard also derives
   *  it from `accessorGaii` (namesAnotherNode), so a caller that leaves it out cannot admit a visitor. */
  accessorFederated?: boolean;
  /** A simulation (GET /v1/permissions/check): answer as a read would, and write no audit row. */
  noAudit?: boolean;
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
  // The visitor fact, from the caller's word or from the identity itself: every read path runs this
  // guard, and a path that did not say the reader was a visitor admitted it to 'members' content.
  const federated = args.accessorFederated === true || namesAnotherNode(accessorGaii);

  // Owner reading their OWN resource is always allowed. This is the foreign-read path
  // (GET /v1/pub) where the accessor happens to BE the owner — e.g. the author viewing
  // their own workspace-scoped image embed in a filed doc. Without this, a file whose
  // owner is not (or no longer) a member of the workspace it's bound to could not be read
  // by its own owner. 'anonymous' never owns a resource. Not audited.
  if (accessorGaii && accessorGaii !== 'anonymous' && accessorGaii === ownerGaii) {
    return { allowed: true, reason: 'owner' };
  }

  // A HUMAN reads what their own agents and apps hold, always. An agent works in this person's
  // name, in their account, with permissions they granted and can pull: a file it stored is the
  // person's own, and a store that hides it from them is not a store they own.
  //
  // ONE DIRECTION ONLY, and the asymmetry is the whole point. Owner → own agent is allowed; agent →
  // owner is not, and stays behind the visibility and consent checks below, so a scoped agent still
  // cannot ride the human's ownership to read whatever it likes. That was the reason the check was
  // written as an exact match, and it is preserved; what it also did, without being asked, was hide
  // a person's own files from them. `isOwnerOf` compares the owner AND the node, because a bare
  // owner name is not unique across nodes.
  if (accessorGaii && accessorGaii !== 'anonymous' && isOwnerOf(accessorGaii, ownerGaii)) {
    return { allowed: true, reason: 'own_principal' };
  }

  if (visibility === 'public') {
    return { allowed: true, reason: 'public_data' };
  }

  // A KEY-SPACE SHARE is checked before any tier is refused, because it is deliberately independent
  // of the tier. The owner shares `deliveries.abc.**` with a group; the records under it stay
  // `private`, which is what they are to everyone else. Visibility is the floor and a share is a
  // named exception on top of it, so sharing something never changes what it is — and a subscriber
  // reading tomorrow's record needs no second act from anybody.
  //
  // 'anonymous' never matches: accessorGroups() returns nothing for it, so an unauthenticated
  // caller cannot reach a shared key however broad the pattern.
  const share = await isKeyShared(storage, ownerGaii, resourceKey, accessorGaii);
  if (share.shared) {
    return { allowed: true, reason: 'group_share' };
  }

  // 'members' = any authenticated user of this node. The CALLER must verify the
  // accessor is a real authenticated principal (not the anonymous-mode shared
  // identity) BEFORE calling — this guard cannot tell anonymity from a GAII
  // string. Like public, allowed member reads are not audited.
  // A visitor from another node (`federated` above) is not an account of this node
  // (services/audience.ts isNodeAccount), so the tier does not admit it; it goes on to the
  // consent layer below, which admits it only through a consent its owner gave.
  if (visibility === 'members' && !federated) {
    return { allowed: true, reason: 'members_data' };
  }

  // 'organism:<id>' = the active members of one organism and the agents it admits, decided by
  // services/audience.ts from the RESOLVED reader identity: the anonymous identity, a visitor from
  // another node (whose identity names no account here) and a non-member are refused, and the denial
  // is audited as a workspace denial is. Node-local; it never reaches the consent layer.
  if (isOrganismVisibilityWord(visibility)) {
    if (await organismVisibilityAdmits(storage, visibility, { identity: accessorGaii, federated })) {
      return { allowed: true, reason: 'organism_member' };
    }
    if (!args.noAudit) await auditDataAccess(storage, null, ownerGaii, accessorGaii, resourceKey, action, false);
    return { allowed: false, reason: 'not_organism_member' };
  }

  // 'workspace' = readable by members of the organism workspace(s) in `workspaceRef`. That field is a
  // SPACE-SEPARATED list of one or more "<org>/<ws>" bindings — a file/record can be shared into several
  // workspaces, and the caller is allowed if they can read ANY ONE of them. Each binding is gated by the
  // SAME workspace read gate as GET /v1/organisms/:id/workspace (membership + manifest read), so a
  // file/record authorizes identically to workspace content. canReadWorkspace is in this file (below),
  // because its own manifest gate asks authorizeRead in turn. Node-local.
  if (visibility === 'workspace') {
    const refs = (args.workspaceRef || '').split(/\s+/).filter(Boolean);
    if (!refs.length) return { allowed: false, reason: 'workspace_unbound' };
    for (const ref of refs) {
      const slash = ref.indexOf('/');
      if (slash < 1 || slash >= ref.length - 1) continue;
      const organism = await storage.getOrganism(ref.slice(0, slash));
      if (!organism) continue;
      if (await canReadWorkspace(storage, config, organism, args.accessorSub, args.accessorOwner, accessorGaii, ref.slice(slash + 1))) {
        return { allowed: true, reason: 'workspace_member' };
      }
    }
    if (!args.noAudit) await auditDataAccess(storage, null, ownerGaii, accessorGaii, resourceKey, action, false);
    return { allowed: false, reason: 'workspace_denied' };
  }

  if (!config.consentEnabled) {
    return { allowed: false, reason: 'consent_disabled' };
  }

  const result = await checkConsentForRead(storage, resourceKey, ownerGaii, accessorGaii, visibility, groupId);
  if (!result.allowed && !args.noAudit) {
    await auditDataAccess(storage, result.consentId ?? null, ownerGaii, accessorGaii, resourceKey, action, false);
  }
  return result;
}

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
  // record is the copy that counts (services/workspace/meta.ts), never the first one the store
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

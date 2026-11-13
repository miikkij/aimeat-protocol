/**
 * @file src/services/workspace/access.ts
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
 * @structure (all re-exported from access-guard.ts since 2026-11-13)
 *   - canReadWorkspace(...) -- membership + manifest-gate read decision (boolean).
 *   - decideWorkspaceRead(...) -- the same, with each gate's answer and the manifest it read.
 *   - canReadWorkspaceRecords(...) -- canReadWorkspace, or a non-member holding the grant of an
 *     active member who created the workspace (the member records read and the member page routes).
 * @usage
 *   import { canReadWorkspace } from './access.js';
 *   const ok = await canReadWorkspace(storage, config, organism, callerSub, callerOwner, callerGaii, ws);
 * @version-history
 *   2026-11-13 — The gate's code moved unchanged to access-guard.ts, beside authorizeRead, and is
 *     re-exported here, so no importer changed; the two files imported each other at run time
 *     (structure programme 2026-11, unit 4).
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

// The workspace read decision lives in access-guard.ts since 2026-11-13, beside authorizeRead: the
// two call each other (the 'workspace' tier of authorizeRead asks canReadWorkspace, and the manifest
// gate of canReadWorkspace asks authorizeRead), so in two files they formed a run-time import cycle.
// Re-exported here for every importer of this file.
export {
  isOrgManager, canReadWorkspace, decideWorkspaceRead, canReadWorkspaceRecords, type WorkspaceReadDecision,
} from '../access-guard.js';

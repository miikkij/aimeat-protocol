/**
 * @file organisms.ts
 * @description Generic organism (group/team/club/cooperative/project) routes: CRUD, join/leave,
 *   membership + admin management, join-request review, and the manifest-driven workspace read.
 *   An organism is the one container; a "project" is just `type:'project'` + a `meta.manifest`.
 *   The backend stays protocol-only — object records are read/written via the generic memory API;
 *   this router adds no per-object-type endpoints.
 * @structure
 *   - organismsRouter(config, storage) — POST/GET/PUT/DELETE /v1/organisms (+ :id sub-resources)
 *   - GET /v1/organisms/:id/workspace — manifest-driven, membership-gated workspace aggregation
 * @usage app.use(organismsRouter(config, storage));
 * @version-history
 *   v1.1.0 -- 2026-06-07 -- Phase 3: add the generic GET /:id/workspace read.
 *   v1.2.0 -- 2026-06-07 -- Phase 4: gate primitive (approvals) + draft/publish/versioning + publish-gate.
 *   v1.3.0 -- 2026-06-08 -- Multi-workspace: one organism holds many workspaces under
 *     organism.{id}.w.{ws}.*. Workspace read (?ws), publish (body.ws), and DELETE (?ws) are all
 *     workspace-scoped; the registry lives at organism.{id}.meta.workspaces (client-managed).
 *   v1.4.0 -- 2026-06-08 -- Per-workspace access control: GET /:id/workspaces (membership-gated
 *     discovery + access status), POST /:id/workspace-access (request), GET (list requests), and
 *     POST /:id/workspace-access/decision (creator approves/denies → consent grant). Content stays
 *     gated by the workspace creator; org membership only grants discovery.
 *   v1.5.0 -- 2026-06-08 -- Access request + approve/deny now drop an in-app notification (notify())
 *     to the creator / requester, so decisions surface in the header bell instead of being guesswork.
 *   v1.6.0 -- 2026-06-09 -- Workspace backup/portability: GET /:id/workspace/export (full-fidelity
 *     ZIP, ?format=base64) + POST /:id/workspace/import (restore as a new workspace, raw ZIP or
 *     { zip_base64 }). See services/workspace-export.ts + workspace-import.ts.
 *   v1.7.0 -- 2026-06-09 -- Organism-level bundle: GET /:id/export (whole organism + all workspaces)
 *     + POST /organisms/import (restore as a NEW organism). See services/organism-export+import.ts.
 *   v1.8.0 -- 2026-06-09 -- Document-space public sharing: meta.share record + GET/PUT
 *     /:id/workspace/share (member reads, creator/admin writes) and NO-AUTH GET
 *     /:id/workspace/public/documents + /public/document (?format=md), serving only PUBLISHED docs
 *     the share meta marks public. Backs the public HTML markdown viewer.
 *   v1.9.0 -- 2026-06-09 -- Creator-managed workspace member roles: viewer (read) | contributor
 *     (read+write), as creator-owned consents. POST /:id/workspace-access/grant + /revoke; decide now
 *     assigns a role; GET /:id/workspace-access returns members + roles. Write requires the contributor
 *     role (revocable), so a creator can manage who writes.
 *   v1.10.0 -- 2026-06-09 -- Workspace-level read: GET /:id/workspace authorizes once on the manifest
 *     (creator / same-owner / a viewer|contributor grant) and then returns ALL content, not per record —
 *     so a contributor's writes are visible to the creator + every member of a shared workspace.
 *   v1.11.0 -- 2026-06-09 -- Organism-level member management: a join request now notifies the
 *     creator/admins (and the requester on review decision); new DELETE /:id/members/:ghii lets a
 *     creator/admin revoke a member's access (notifies the removed member).
 *   v1.12.0 -- 2026-06-10 -- Workspace read uses the shared isMemoryBackedSpace() predicate (was a
 *     local {memory,knowledge,storage} set — one of three divergent backing filters that let
 *     published content go invisible). Non-memory spaces are creation-gated now; legacy ones render
 *     as a placeholder in the UI until their manifest is repaired to backing:'memory'.
 */
import { Router, raw, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, PendingApprovalRecord, OrganismRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, optionalAuth } from '../auth/middleware.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity, parseGaiiLoose, isSameOwner } from '../utils/gaii.js';
import { authorizeRead } from '../services/access-guard.js';
import { shouldGate, gatePolicyFromManifest, type Risk } from '../services/gate-policy.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { expireOverdueApprovals, isOverdue } from '../services/gate-expiry.js';
import { notify } from '../services/notify.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { isMemoryBackedSpace } from '../services/workspace-meta.js';
import { importWorkspace } from '../services/workspace-import.js';
import { exportOrganism } from '../services/organism-export.js';
import { importOrganism } from '../services/organism-import.js';
import { searchOrganismContent } from '../services/organism-search.js';
import { canAccessWorkspaceComments, addComment, listComments, commentPrefix } from '../services/organism-comments.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { updateWorkspaceMeta, WorkspaceMetaError } from '../services/workspace-meta.js';

/** Whether a membership role satisfies an approval's required approverRole. */
function roleSatisfies(approverRole: string, membershipRole: string): boolean {
  if (approverRole === 'member') return true;                                  // any active member
  if (approverRole === 'admin') return membershipRole === 'creator' || membershipRole === 'admin';
  if (approverRole === 'owner') return membershipRole === 'creator';           // the organism owner
  return false;
}

export function organismsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── POST /v1/organisms — Create a new organism ── */
  router.post('/v1/organisms', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const { name, description, type, location, interests, join_policy, max_members, visibility } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name is required (min 2 characters)'));
      return;
    }

    const validTypes = ['community', 'team', 'club', 'cooperative', 'project'];
    const orgType = validTypes.includes(type) ? type : 'community';
    const policy = ['open', 'approval_required', 'invite_only'].includes(join_policy) ? join_policy : 'open';
    const vis = ['public', 'listed', 'private'].includes(visibility) ? visibility : 'public';

    const id = uuidv4();
    const now = new Date().toISOString();
    const boardId = `org-${id}`;

    // Create the organism's discussion board
    await storage.createBoard({
      id: boardId,
      name: `${name.trim()} — Discussion`,
      description: `Discussion board for ${name.trim()}`,
      visibility: vis === 'public' ? 'public' : 'shared',
      ownerGaii: resolveIdentity(req.auth!, config.nodeId),
      allowedGaiis: [],
      createdAt: now,
    });

    const record = await storage.createOrganism({
      id,
      name: name.trim(),
      description: description || '',
      type: orgType,
      location: location || {},
      interests: Array.isArray(interests) ? interests : [],
      creatorGhii: ghii,
      admins: [ghii],
      members: [ghii],
      agentGaiis: [],
      boardId,
      joinPolicy: policy,
      maxMembers: max_members || 500,
      visibility: vis,
      moderationConfig: {
        flagsEnabled: true,
        autoHideThreshold: 3,
        appealsEnabled: true,
      },
      memoryNamespace: `organism.${id}`,
      createdAt: now,
      updatedAt: now,
    });

    // Create creator membership
    await storage.createMembership({
      id: uuidv4(),
      organismId: id,
      ghii,
      role: 'creator',
      status: 'active',
      joinedAt: now,
    });

    res.status(201).json(success(config.nodeId, { organism: record }, [
      { description: 'View organism', method: 'GET', url: `/v1/organisms/${id}` },
      { description: 'List members', method: 'GET', url: `/v1/organisms/${id}/members` },
    ]));
    emitChange('organisms');
  });

  /* ── GET /v1/organisms — List organisms ── */
  router.get('/v1/organisms', optionalAuth(), async (req, res) => {
    const { type, city, interest, visibility, member, page, per_page } = req.query;
    // ?member=<owner> lists that owner's organisms INCLUDING private ones — which must only be
    // enumerable by the member themself (their agents share the bare owner name) or an operator.
    // Anyone else asking about someone's memberships degrades to public-only instead of leaking
    // private organisms. Memberships are keyed by the BARE owner name, so normalize GHII/GAII.
    const memberBare = member ? ((member as string).includes('#') ? (member as string).split('#')[1] : (member as string)).split('@')[0] : undefined;
    const selfOrOperator = !!req.auth && (req.auth.owner === memberBare || req.auth.roles.includes('operator'));
    const organisms = await storage.listOrganisms({
      type: type as string,
      city: city as string,
      interest: interest as string,
      member: memberBare,
      visibility: member ? (selfOrOperator ? (visibility as string) : 'public') : ((visibility as string) || 'public'),
      page: page ? Number(page) : 1,
      perPage: per_page ? Number(per_page) : 20,
    });

    res.json(success(config.nodeId, {
      organisms,
      total: organisms.length,
    }));
  });

  /* ── GET /v1/organisms/:id — Get organism detail ── */
  router.get('/v1/organisms/:id', async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check visibility
    if (organism.visibility === 'private') {
      const ghii = req.auth?.owner;
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
      const membership = await storage.getMembership(id, ghii);
      if (!membership || membership.status !== 'active') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
    }

    const members = await storage.listMembers(id, { status: 'active' });

    res.json(success(config.nodeId, {
      organism,
      member_count: members.length,
    }));
  });

  /* ── PUT /v1/organisms/:id — Update organism ── */
  router.put('/v1/organisms/:id', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Only creator or admin can update
    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only creator or admin can update'));
      return;
    }

    const { name, description, type, location, interests, join_policy, max_members, visibility } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) updates.type = type;
    if (location !== undefined) updates.location = location;
    if (interests !== undefined) updates.interests = interests;
    if (join_policy !== undefined) updates.joinPolicy = join_policy;
    if (max_members !== undefined) updates.maxMembers = max_members;
    if (visibility !== undefined) updates.visibility = visibility;

    const updated = await storage.updateOrganism(id, updates);
    res.json(success(config.nodeId, { organism: updated }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id — Delete organism ── */
  router.delete('/v1/organisms/:id', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can delete'));
      return;
    }

    await storage.deleteOrganism(id);
    res.json(success(config.nodeId, { deleted: true }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/join — Join an organism ── */
  router.post('/v1/organisms/:id/join', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { message } = req.body ?? {};

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check if already a member
    const existing = await storage.getMembership(id, ghii);
    if (existing && existing.status === 'banned') {
      res.status(403).json(error(config.nodeId, 'BANNED', 'You have been blocked from this organism'));
      return;
    }
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER', 'You are already a member'));
      return;
    }
    if (existing && existing.status === 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PENDING', 'You already have a pending join request'));
      return;
    }
    if (existing && existing.status === 'invited') {
      res.status(409).json(error(config.nodeId, 'ALREADY_INVITED', 'You have a pending invitation — accept it instead of requesting to join'));
      return;
    }

    // Check capacity
    const members = await storage.listMembers(id, { status: 'active' });
    if (members.length >= organism.maxMembers) {
      res.status(409).json(error(config.nodeId, 'CAPACITY_FULL', 'Organism has reached maximum members'));
      return;
    }

    const now = new Date().toISOString();

    if (organism.joinPolicy === 'open') {
      // Direct join
      const membership = await storage.createMembership({
        id: uuidv4(),
        organismId: id,
        ghii,
        role: 'member',
        status: 'active',
        joinedAt: now,
      });

      // Update organism members list
      await storage.updateOrganism(id, {
        members: [...organism.members, ghii],
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, { membership, status: 'joined' }));
      emitChange('organisms');
    } else if (organism.joinPolicy === 'approval_required') {
      // Create join request
      const request = await storage.createJoinRequest({
        id: uuidv4(),
        organismId: id,
        ghii,
        message: message || undefined,
        status: 'pending',
        createdAt: now,
      });

      // Notify the creator + admins so the request doesn't go unnoticed (mirrors the
      // workspace-access request path). admins includes the creator, so dedupe.
      const approvers = [...new Set([organism.creatorGhii, ...organism.admins])];
      for (const approver of approvers) {
        await notify(storage, `${approver}@${config.nodeId}`, {
          type: 'organism_join_request',
          title: `${ghii} requested to join "${organism.name}"`,
          body: typeof message === 'string' ? message : '',
          link: '/v1/profile#organisms',
        });
      }
      emitChange('notifications');

      res.status(202).json(success(config.nodeId, { join_request: request, status: 'pending' }));
      emitChange('organisms');
    } else {
      // invite_only
      res.status(403).json(error(config.nodeId, 'INVITE_ONLY', 'This organism requires an invitation to join'));
    }
  });

  /* ── POST /v1/organisms/:id/leave — Leave an organism ── */
  router.post('/v1/organisms/:id/leave', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii === ghii) {
      res.status(400).json(error(config.nodeId, 'CREATOR_CANNOT_LEAVE', 'Creator cannot leave. Delete the organism instead.'));
      return;
    }

    const membership = await storage.getMembership(id, ghii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member'));
      return;
    }

    await storage.deleteMembership(membership.id);

    // Update organism members + admins lists
    const updates: Record<string, unknown> = {
      members: organism.members.filter(m => m !== ghii),
      updatedAt: new Date().toISOString(),
    };
    if (organism.admins.includes(ghii)) {
      updates.admins = organism.admins.filter(a => a !== ghii);
    }
    await storage.updateOrganism(id, updates);

    res.json(success(config.nodeId, { left: true }));
    emitChange('organisms');
  });

  /* ── GET /v1/organisms/:id/members — List members ── */
  router.get('/v1/organisms/:id/members', optionalAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { role, status } = req.query;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const members = await storage.listMembers(id, {
      role: role as string,
      status: (status as string) || 'active',
    });

    // A member's agents inherit access implicitly (same-owner: join answers ALREADY_MEMBER), so
    // "who can touch this organism" must be enumerable — an unlisted actor with access is an
    // audit gap. Each member row carries its owner's agents for ACTIVE members (or an operator)
    // only; outsiders/public callers get the legacy shape (agent rosters are not public data).
    const callerOwner = req.auth?.owner;
    const callerMembership = callerOwner ? await storage.getMembership(id, callerOwner) : null;
    const canSeeAgents = (callerMembership?.status === 'active') || !!req.auth?.roles.includes('operator');
    if (canSeeAgents) {
      const enriched = await Promise.all(members.map(async m => {
        const ownerName = (m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0];
        const agents = await storage.getAgentsByOwner(ownerName);
        return { ...m, agents: agents.map(a => ({ gaii: a.gaii, name: a.name })) };
      }));
      res.json(success(config.nodeId, { members: enriched, total: enriched.length, agents_included: true }));
      return;
    }

    res.json(success(config.nodeId, { members, total: members.length }));
  });

  /* ── GET /v1/organisms/:id/join-requests — List pending join requests ── */
  router.get('/v1/organisms/:id/join-requests', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { status } = req.query;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can view join requests'));
      return;
    }

    const requests = await storage.listJoinRequests(id, { status: (status as string) || 'pending' });
    res.json(success(config.nodeId, { join_requests: requests, total: requests.length }));
  });

  /* ── POST /v1/organisms/:id/join-requests/:requestId/review — Approve/reject ── */
  router.post('/v1/organisms/:id/join-requests/:requestId/review', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    const { decision } = req.body ?? {};

    if (!['approved', 'rejected'].includes(decision)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Decision must be "approved" or "rejected"'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can review join requests'));
      return;
    }

    const request = await storage.getJoinRequest(requestId);
    if (!request || request.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Join request not found'));
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_REVIEWED', 'This request has already been reviewed'));
      return;
    }

    const now = new Date().toISOString();
    await storage.updateJoinRequest(requestId, {
      status: decision,
      reviewedBy: ghii,
      reviewedAt: now,
    });

    if (decision === 'approved') {
      await storage.createMembership({
        id: uuidv4(),
        organismId: id,
        ghii: request.ghii,
        role: 'member',
        status: 'active',
        joinedAt: now,
      });
      await storage.updateOrganism(id, {
        members: [...organism.members, request.ghii],
        updatedAt: now,
      });
    }

    // Notify the requester of the decision so it surfaces in their bell.
    await notify(storage, `${request.ghii}@${config.nodeId}`, {
      type: decision === 'approved' ? 'organism_join_approved' : 'organism_join_rejected',
      title: decision === 'approved'
        ? `You were approved to join "${organism.name}"`
        : `Your request to join "${organism.name}" was declined`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.json(success(config.nodeId, { decision, request_id: requestId }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/admins — Add an admin ── */
  router.post('/v1/organisms/:id/admins', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { target_ghii } = req.body ?? {};

    if (!target_ghii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_ghii is required'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can promote members'));
      return;
    }

    const membership = await storage.getMembership(id, target_ghii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target is not an active member'));
      return;
    }

    if (organism.admins.includes(target_ghii)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_ADMIN', 'Target is already an admin'));
      return;
    }

    await storage.updateMembership(membership.id, { role: 'admin' });
    await storage.updateOrganism(id, {
      admins: [...organism.admins, target_ghii],
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { promoted: target_ghii, role: 'admin' }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/admins/:ghii — Remove admin role ── */
  router.delete('/v1/organisms/:id/admins/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = req.params.ghii as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can demote admins'));
      return;
    }

    if (targetGhii === organism.creatorGhii) {
      res.status(400).json(error(config.nodeId, 'CANNOT_DEMOTE_CREATOR', 'Cannot remove admin from creator'));
      return;
    }

    const membership = await storage.getMembership(id, targetGhii);
    if (!membership) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Member not found'));
      return;
    }

    await storage.updateMembership(membership.id, { role: 'member' });
    await storage.updateOrganism(id, {
      admins: organism.admins.filter(a => a !== targetGhii),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { demoted: targetGhii, role: 'member' }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/members/:ghii — Remove (revoke) a member ──
   * Creator/admin removes another member's organism access entirely: deletes the
   * membership and drops them from members[] (+ admins[] if applicable). The creator
   * cannot be removed (they must delete the organism); an admin can only be removed by
   * the creator. The removed member is notified. To leave voluntarily, use /leave. */
  router.delete('/v1/organisms/:id/members/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const callerIsCreator = organism.creatorGhii === callerGhii;
    const callerIsAdmin = callerIsCreator || organism.admins.includes(callerGhii);
    if (!callerIsAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can remove members'));
      return;
    }

    if (targetGhii === organism.creatorGhii) {
      res.status(400).json(error(config.nodeId, 'CANNOT_REMOVE_CREATOR', 'The creator cannot be removed. Delete the organism instead.'));
      return;
    }

    // Only the creator can remove an admin.
    if (organism.admins.includes(targetGhii) && !callerIsCreator) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can remove an admin'));
      return;
    }

    const membership = await storage.getMembership(id, targetGhii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target is not an active member'));
      return;
    }

    // `?ban=1` (or body { ban: true }) blocks the member from re-joining / being re-invited:
    // keep the membership row but flip it to `banned` instead of deleting it. Plain remove just
    // deletes the row (they can request to join again).
    const ban = req.query.ban === '1' || req.query.ban === 'true' || req.body?.ban === true;
    const now = new Date().toISOString();
    if (ban) {
      await storage.updateMembership(membership.id, { status: 'banned', role: 'member' });
    } else {
      await storage.deleteMembership(membership.id);
    }
    await storage.updateOrganism(id, {
      members: organism.members.filter(m => m !== targetGhii),
      admins: organism.admins.filter(a => a !== targetGhii),
      updatedAt: now,
    });

    // Let the removed member know their access was revoked.
    await notify(storage, `${targetGhii}@${config.nodeId}`, {
      type: ban ? 'organism_member_banned' : 'organism_member_removed',
      title: ban
        ? `You were blocked from "${organism.name}"`
        : `Your access to "${organism.name}" was revoked`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.json(success(config.nodeId, { removed: targetGhii, banned: ban }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/members/:ghii/unban — Lift a ban ──
   * Creator/admin removes the block on a previously-banned owner by deleting the banned
   * membership row, so they can request to join (or be invited) again. */
  router.post('/v1/organisms/:id/members/:ghii/unban', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can lift a block'));
      return;
    }
    const membership = await storage.getMembership(id, targetGhii);
    if (!membership || membership.status !== 'banned') {
      res.status(404).json(error(config.nodeId, 'NOT_BANNED', 'Target is not blocked'));
      return;
    }
    await storage.deleteMembership(membership.id);
    res.json(success(config.nodeId, { unbanned: targetGhii }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/transfer — Transfer ownership ──
   * The creator hands the organism to an existing active member: the target becomes `creator`,
   * the previous creator is demoted to `admin` (kept as a member). Only the current creator may
   * call this. The new creator is notified. */
  router.post('/v1/organisms/:id/transfer', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { to } = req.body ?? {};
    if (!to || typeof to !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "to" (an active member) is required'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the current creator can transfer ownership'));
      return;
    }
    if (to === callerGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You are already the creator'));
      return;
    }
    const targetMembership = await storage.getMembership(id, to);
    if (!targetMembership || targetMembership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target must be an active member of this organism'));
      return;
    }

    const callerMembership = await storage.getMembership(id, callerGhii);
    const now = new Date().toISOString();
    // Promote the new creator, demote the old one to admin.
    await storage.updateMembership(targetMembership.id, { role: 'creator' });
    if (callerMembership) await storage.updateMembership(callerMembership.id, { role: 'admin' });
    const admins = [...new Set([...organism.admins.filter(a => a !== to), callerGhii])];
    await storage.updateOrganism(id, { creatorGhii: to, admins, updatedAt: now });

    await notify(storage, `${to}@${config.nodeId}`, {
      type: 'organism_ownership_transferred',
      title: `You are now the creator of "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.json(success(config.nodeId, { creator: to, previousCreator: callerGhii }));
    emitChange('organisms');
  });

  /* ── Invitations (invite_only flow; works for any policy) ──
   * A creator/admin invites an owner by bare name. The invite is a membership row with
   * status `invited` + `invitedBy`. The invitee is notified and accepts/declines. */

  /* POST /v1/organisms/:id/invitations — invite an owner */
  router.post('/v1/organisms/:id/invitations', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { invitee } = req.body ?? {};
    if (!invitee || typeof invitee !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "invitee" (an owner name) is required'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can invite members'));
      return;
    }

    const existing = await storage.getMembership(id, invitee);
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER', 'That owner is already a member'));
      return;
    }
    if (existing && existing.status === 'invited') {
      res.status(409).json(error(config.nodeId, 'ALREADY_INVITED', 'That owner already has a pending invitation'));
      return;
    }
    if (existing && existing.status === 'banned') {
      res.status(409).json(error(config.nodeId, 'BANNED', 'That owner is blocked — lift the block before inviting'));
      return;
    }

    const now = new Date().toISOString();
    const membership = await storage.createMembership({
      id: uuidv4(),
      organismId: id,
      ghii: invitee,
      role: 'member',
      status: 'invited',
      invitedBy: callerGhii,
      joinedAt: now,
    });
    await notify(storage, `${invitee}@${config.nodeId}`, {
      type: 'organism_invitation',
      title: `${callerGhii} invited you to join "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.status(201).json(success(config.nodeId, { invitation: membership, status: 'invited' }));
    emitChange('organisms');
  });

  /* GET /v1/organisms/:id/invitations — list outstanding invitations (creator/admin) */
  router.get('/v1/organisms/:id/invitations', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can view invitations'));
      return;
    }
    const invitations = await storage.listMembers(id, { status: 'invited' });
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* GET /v1/organisms/invitations/mine — the caller's own pending invitations (across organisms) */
  router.get('/v1/organisms/invitations/mine', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const memberships = (await storage.listMembershipsByGhii(callerGhii)).filter(m => m.status === 'invited');
    const invitations = [];
    for (const m of memberships) {
      const org = await storage.getOrganism(m.organismId);
      if (org) invitations.push({ membership: m, organism: { id: org.id, name: org.name, description: org.description, type: org.type, visibility: org.visibility } });
    }
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* POST /v1/organisms/:id/invitations/accept — the invitee accepts */
  router.post('/v1/organisms/:id/invitations/accept', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const membership = await storage.getMembership(id, callerGhii);
    if (!membership || membership.status !== 'invited') {
      res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have no pending invitation to this organism'));
      return;
    }
    const now = new Date().toISOString();
    await storage.updateMembership(membership.id, { status: 'active', joinedAt: now });
    await storage.updateOrganism(id, { members: [...new Set([...organism.members, callerGhii])], updatedAt: now });
    // Notify the inviter that the invitation was accepted.
    if (membership.invitedBy) {
      await notify(storage, `${membership.invitedBy}@${config.nodeId}`, {
        type: 'organism_invitation_accepted',
        title: `${callerGhii} accepted your invitation to "${organism.name}"`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
    }
    res.json(success(config.nodeId, { status: 'joined' }));
    emitChange('organisms');
  });

  /* POST /v1/organisms/:id/invitations/decline — the invitee declines */
  router.post('/v1/organisms/:id/invitations/decline', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const membership = await storage.getMembership(id, callerGhii);
    if (!membership || membership.status !== 'invited') {
      res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have no pending invitation to this organism'));
      return;
    }
    await storage.deleteMembership(membership.id);
    res.json(success(config.nodeId, { status: 'declined' }));
    emitChange('organisms');
  });

  /* ── Agent attachment (manage organism.agentGaiis) ──
   * An owner attaches one of their OWN agents to an organism they belong to, so the agent shows
   * as an organism participant and passes the workspace membership gate in its own right. */

  /* POST /v1/organisms/:id/agents — attach an agent GAII (caller must own it + be a member) */
  router.post('/v1/organisms/:id/agents', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { agent_gaii } = req.body ?? {};
    if (!agent_gaii || typeof agent_gaii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "agent_gaii" is required'));
      return;
    }
    const parsed = parseGaiiLoose(agent_gaii);
    if (!parsed.agent || parsed.owner !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only attach your own agents'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const membership = await storage.getMembership(id, callerGhii);
    const isMember = !!membership && membership.status === 'active';
    if (!isMember && organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You must be a member to attach an agent'));
      return;
    }
    if (organism.agentGaiis.includes(agent_gaii)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_ATTACHED', 'That agent is already attached'));
      return;
    }
    await storage.updateOrganism(id, { agentGaiis: [...organism.agentGaiis, agent_gaii], updatedAt: new Date().toISOString() });
    res.status(201).json(success(config.nodeId, { attached: agent_gaii }));
    emitChange('organisms');
  });

  /* DELETE /v1/organisms/:id/agents/:gaii — detach an agent (its owner, or creator/admin) */
  router.delete('/v1/organisms/:id/agents/:gaii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const agentGaii = decodeURIComponent(req.params.gaii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const parsed = parseGaiiLoose(agentGaii);
    const ownsAgent = parsed.owner === callerGhii;
    const isAdmin = organism.creatorGhii === callerGhii || organism.admins.includes(callerGhii);
    if (!ownsAgent && !isAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the agent owner or an organism admin can detach it'));
      return;
    }
    if (!organism.agentGaiis.includes(agentGaii)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'That agent is not attached'));
      return;
    }
    await storage.updateOrganism(id, { agentGaiis: organism.agentGaiis.filter(g => g !== agentGaii), updatedAt: new Date().toISOString() });
    res.json(success(config.nodeId, { detached: agentGaii }));
    emitChange('organisms');
  });

  /* ── GET /v1/organisms/:id/workspace — Manifest-driven workspace read ──
   *
   * Generic over ANY manifest: reads `organism.{id}.meta.manifest`, then for each
   * memory-backed `objectTypes[]` it declares, returns the records under that namespace.
   * Works identically for a `kind:'project'` or a `kind:'research-study'` / Finnish
   * `kind:'tutkimus'` manifest — the core enumerates whatever the manifest declares,
   * never a hardcoded type list.
   *
   * Access: the caller must be an active member (or an organism agent) — non-members 403.
   * Each non-owned record is then gated through the shared `authorizeRead` guard, so a
   * member only sees records their consent/visibility allows (own records pass directly).
   */
  router.get('/v1/organisms/:id/workspace', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership gate — an organism agent, or an active member. Memberships are keyed by the
    // BARE owner name (matches organisms.ts join/leave + consent.ts organism resolution).
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) {
      const membership = await storage.getMembership(id, ownerName);
      isMember = !!membership && membership.status === 'active';
    }
    if (!isMember) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // A workspace is scoped under organism.{id}.w.{ws}. — one organism holds many workspaces.
    // (No ws → legacy organism-level root, kept only so an un-scoped call still reads something.)
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const nsRoot = ws ? `organism.${id}.w.${ws}.` : `organism.${id}.`;

    // A workspace is SHARED: authorization is at the workspace level, not per record. If the caller can
    // read the manifest (they created it, are a same-owner agent, or hold a viewer/contributor grant —
    // see authorizeRead/the workspace-role consents), they see ALL of the workspace's content, whoever
    // wrote it — so a contributor's writes are visible to the creator + other members. If not, they see
    // nothing (org membership alone is discovery-only). The manifest is the single gate record.
    const { items } = await storage.listAllMemory({ prefix: nsRoot, limit: 5000 });
    const manRec = items.find(r => r.key === `${nsRoot}meta.manifest`);
    let canReadWorkspace = false;
    if (manRec) {
      canReadWorkspace = manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
      if (!canReadWorkspace) {
        const decision = await authorizeRead(storage, config, {
          ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
          visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
        });
        canReadWorkspace = decision.allowed;
      }
    }
    const readable: MemoryRecord[] = canReadWorkspace ? items : [];
    const byKey = new Map(readable.map(r => [r.key, r]));

    const manifestRec = byKey.get(`${nsRoot}meta.manifest`);
    const manifest = (manifestRec?.value as Record<string, unknown> | undefined) ?? null;
    const readme = byKey.get(`${nsRoot}meta.readme`)?.value ?? null;

    // Build the generic objects map from whatever objectTypes the manifest declares.
    // Versioning convention: each instance is one key, optionally suffixed `.draft` (working
    // copy), `.latest` (published), or `.version.N` (history). The current value is `.latest`
    // (falling back to a bare unsuffixed write); drafts are surfaced separately; versions are
    // history (hidden here — list `…{instance}.version.*` via the memory API to read them).
    const objectTypes = (manifest?.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const objects: Record<string, unknown[]> = {};
    const drafts: Record<string, unknown[]> = {};
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || !isMemoryBackedSpace(ot)) continue;
      const nsPrefix = `${nsRoot}${namespace}.`;
      const instances = new Map<string, { bare?: MemoryRecord; latest?: MemoryRecord; draft?: MemoryRecord }>();
      for (const r of readable) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const instanceId = parts[0];
        const role = parts.slice(1).join('.');
        const slot = instances.get(instanceId) ?? {};
        if (role === '') slot.bare = r;
        else if (role === 'draft') slot.draft = r;
        else if (role === 'latest') slot.latest = r;
        // role startsWith 'version.' → history, skip
        instances.set(instanceId, slot);
      }
      // Surface the record's timestamps on the returned value (when it's an object) as `_createdAt`/
      // `_updatedAt`/`_version` — so a client can show "created / last saved / published" without an
      // extra read. Underscore-prefixed so they never collide with manifest-declared fields; the
      // write paths re-pick {id,title,markdown}/form fields, so these are never persisted back.
      const withMeta = (rec: MemoryRecord): unknown => {
        const v = rec.value;
        return (v && typeof v === 'object' && !Array.isArray(v))
          ? { ...(v as Record<string, unknown>), _createdAt: rec.createdAt, _updatedAt: rec.updatedAt, _version: rec.version }
          : v;
      };
      const current: unknown[] = [];
      const draftList: unknown[] = [];
      for (const slot of instances.values()) {
        const pub = slot.latest ?? slot.bare;
        if (pub !== undefined) current.push(withMeta(pub));
        if (slot.draft !== undefined) draftList.push(withMeta(slot.draft));
      }
      objects[name] = current;
      if (draftList.length) drafts[name] = draftList;
    }

    // Convenience aliases — generic, empty when the manifest declares no such type.
    const appendType = objectTypes.find(ot => ot.append === true);
    const decisions = appendType ? (objects[appendType.name as string] ?? []) : [];
    const resourceType = objectTypes.find(ot =>
      ot.name === 'resource' || (typeof ot.namespace === 'string' && ot.namespace.endsWith('resources')));
    const resources = resourceType ? (objects[resourceType.name as string] ?? []) : [];

    // todos — tasks linked to this organism by the memoryPrefix convention (no native
    // organismId on tasks). Best-effort: empty if none match.
    let todos: unknown[] = [];
    try {
      const { tasks } = await storage.listAgentTasksByOwner(callerGaii, { perPage: 200 });
      todos = tasks
        .filter(t => (t.resources?.memoryPrefixes ?? []).some(p => p.startsWith(`organism.${id}`)))
        .map(t => ({ id: t.id, title: t.title, status: t.status, todos: t.todos }));
    } catch {
      /* best-effort: leave todos empty if the task store is unavailable */
    }

    res.json(success(config.nodeId, { manifest, readme, objects, drafts, decisions, resources, todos }, [
      { description: 'Read the manifest directly', method: 'GET', url: `/v1/memory/${encodeURIComponent(`${nsRoot}meta.manifest`)}` },
      { description: 'Write a draft record', method: 'POST', url: '/v1/memory' },
      { description: 'Publish a draft', method: 'POST', url: `/v1/organisms/${id}/publish` },
    ]));
  });

  /* ── GET /v1/organisms/:id/search — Search organism / workspace content ──
   * Full-text-ish (case-insensitive substring) search across the records + documents of every
   * workspace the caller can read (or one workspace if ?ws=). Returns matches with the workspace,
   * space (objectType), instance id, a title, and a snippet around the hit. Honours the same
   * workspace-level read authorization as GET /:id/workspace (manifest gate) — a member only
   * searches workspaces they may read; drafts, version history and meta records are skipped. */
  router.get('/v1/organisms/:id/search', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    const onlyWs = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    if (q.length < 2) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query "q" must be at least 2 characters'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership gate (same as workspace read): an org agent or an active member.
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) {
      const m = await storage.getMembership(id, ownerName);
      isMember = !!m && m.status === 'active';
    }
    if (!isMember) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const { results, truncated } = await searchOrganismContent(storage, config, organism, callerGaii, q, onlyWs);
    res.json(success(config.nodeId, { query: q, results, total: results.length, truncated }));
  });

  /* ── Comments / threads on workspace records + documents ──
   * A comment targets one workspace object (record or document) by (ws, space, instance_id), can be
   * anchored to a part of a document (anchor.section or anchor.quote) or left general (no anchor),
   * and can reply to another comment (parent_id) to form threads. Comments are memory-backed under
   * `organism.{id}.w.{ws}.meta.comments.{space}~{instance}.{commentId}` — the meta.* prefix keeps
   * them OUT of the workspace read + content search. Authoring is open to any member or organism
   * agent (so agents can comment); read requires the same workspace-read authorization as the
   * content; a comment can be deleted by its author or a creator/admin. */

  /* POST /v1/organisms/:id/comments — add a comment */
  router.post('/v1/organisms/:id/comments', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, space, instance_id, body, anchor, parent_id } = req.body ?? {};
    if (!ws || !space || !instance_id || typeof body !== 'string' || !body.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space, instance_id and a non-empty body are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    if (!(await canAccessWorkspaceComments(storage, config, organism, req.auth!.sub, req.auth!.owner, callerGaii, ws))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You cannot comment in this workspace')); return;
    }
    const comment = await addComment(storage, id, callerGaii, { ws, space, instanceId: instance_id, body, anchor, parentId: parent_id });
    emitChange('organisms');
    res.status(201).json(success(config.nodeId, { comment }));
  });

  /* GET /v1/organisms/:id/comments?ws=&space=&instance_id= — list a target's thread */
  router.get('/v1/organisms/:id/comments', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = req.query.ws as string;
    const space = req.query.space as string;
    const instanceId = req.query.instance_id as string;
    if (!ws || !space || !instanceId) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space and instance_id query params are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    if (!(await canAccessWorkspaceComments(storage, config, organism, req.auth!.sub, req.auth!.owner, callerGaii, ws))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You cannot read this workspace')); return;
    }
    const comments = await listComments(storage, id, ws, space, instanceId);
    res.json(success(config.nodeId, { comments, total: comments.length }));
  });

  /* DELETE /v1/organisms/:id/comments/:commentId?ws=&space=&instance_id= — delete (author or creator/admin) */
  router.delete('/v1/organisms/:id/comments/:commentId', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const commentId = req.params.commentId as string;
    const ws = req.query.ws as string;
    const space = req.query.space as string;
    const instanceId = req.query.instance_id as string;
    if (!ws || !space || !instanceId) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space and instance_id query params are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const callerOwner = req.auth!.owner as string;
    const key = `${commentPrefix(id, ws, space, instanceId)}${commentId}`;
    const scan = await storage.listAllMemory({ prefix: key, limit: 5 });
    const rec = scan.items.find(r => r.key === key);
    if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Comment not found')); return; }
    const isAuthor = rec.ownerGaii === callerGaii;
    const isAdmin = organism.creatorGhii === callerOwner || organism.admins.includes(callerOwner);
    if (!isAuthor && !isAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the comment author or an organism admin can delete it')); return;
    }
    await storage.deleteMemory(rec.ownerGaii, key);
    emitChange('organisms');
    res.json(success(config.nodeId, { deleted: commentId }));
  });

  /* ── Gate primitive (Phase 4) — PendingApproval ──
   *
   * Generic over any organism/manifest. The gate ENGINE is here; the gate CONDITIONS are data
   * (the manifest's policy.agentAutonomy / policy.alwaysGate, via gate-policy.ts). Creating an
   * approval evaluates that policy: a consequential action pauses as `pending`; everything else
   * auto-runs (audited as a decision). Resolution is human-only (a pending approval, by
   * definition, escaped auto-run) and role-gated by the approval's approverRole.
   */

  // Active membership keyed by bare owner name (or org agent) — returns { role } or null.
  const memberRole = async (req: Express.Request, organism: { agentGaiis: string[] }, id: string): Promise<string | null> => {
    if (req.auth!.sub && organism.agentGaiis.includes(req.auth!.sub)) return 'member';
    const ownerName = req.auth!.owner;
    if (!ownerName) return null;
    const m = await storage.getMembership(id, ownerName);
    return m && m.status === 'active' ? m.role : null;
  };

  // Read the organism's manifest value (for gate policy).
  const readManifest = async (id: string): Promise<unknown> => {
    const key = `organism.${id}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return items.find(r => r.key === key)?.value ?? null;
  };

  // Append a signed-by-convention decision-log entry (the audit/Prove trail).
  const writeDecision = async (organismId: string, by: string, summary: string, refs: string[]): Promise<void> => {
    const did = uuidv4();
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `organism.${organismId}.meta.decisions.${did}`,
      ownerGaii: by,
      value: { ts: now, kind: 'decision', by, summary, refs },
      visibility: 'private', tags: ['gate'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
  };

  // Read the organism's runtime config entry (organism.{id}.meta.config) — UI-editable; absent = defaults.
  const readConfig = async (organismId: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${organismId}.meta.config`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  // meta.* writes require admin/creator; shared.* (and others) need only membership.
  const canWriteNamespace = (role: string, namespace: string): boolean =>
    namespace.startsWith('meta.') ? (role === 'creator' || role === 'admin') : true;

  // Publish a draft: snapshot organism.{id}.{ns}.{instance}.draft → a new .version.N and .latest.
  // Schema-validated (the draft must be a valid object). Returns the new version number.
  const publishDraft = async (
    organismId: string, ws: string | undefined, namespace: string, instance: string, publisher: string,
  ): Promise<{ ok: true; version: number } | { ok: false; code: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
    const draft = items.find(r => r.key === `${base}.draft`);
    if (!draft) return { ok: false, code: 'NO_DRAFT' };

    const validation = await validateMemoryWrite(`${base}.latest`, draft.value, storage);
    if (!validation.valid) return { ok: false, code: 'INVALID', violations: validation.errors };

    let maxN = 0;
    const vPrefix = `${base}.version.`;
    for (const r of items) {
      if (r.key.startsWith(vPrefix)) {
        const suffix = r.key.slice(vPrefix.length);
        if (/^\d+$/.test(suffix)) maxN = Math.max(maxN, parseInt(suffix, 10));
      }
    }
    const n = maxN + 1;
    const now = new Date().toISOString();
    const vis = draft.visibility;
    const tags = draft.tags ?? [];

    await storage.setMemory({
      key: `${base}.version.${n}`, ownerGaii: publisher, value: draft.value,
      visibility: vis, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    const existingLatest = items.find(r => r.key === `${base}.latest`);
    await storage.setMemory({
      key: `${base}.latest`, ownerGaii: publisher, value: draft.value,
      visibility: vis, tags, ttlHours: null,
      version: (existingLatest?.version ?? 0) + 1,
      createdAt: existingLatest?.createdAt ?? now, updatedAt: now,
    });
    // Consume the draft — it was the proposal-for-publishing; now it's a frozen version + the new
    // .latest. Re-editing the published instance starts a fresh draft. (Without this the workspace
    // shows a stale draft alongside the identical published copy.)
    await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
    return { ok: true, version: n };
  };

  /* ══ Workspace access (per-workspace, creator-controlled, consent-backed) ══
   * Organism membership lets you SEE the workspace LIST (names + who made each); reading/writing a
   * workspace's CONTENT needs the workspace creator's consent. Flow: discover → request → the
   * workspace creator approves → a consent grant is created. Each workspace's creator owns its
   * access — if another member makes their own workspace, THEY consent to it, not the organism owner. */

  const wsRegPrefix = (id: string) => `organism.${id}.meta.workspaces`;
  const bareOwner = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];

  /** Find a workspace's registry entry across every member's registry (one key per owner). */
  const findWsEntry = async (id: string, ws: string): Promise<{ id: string; name?: string; createdBy?: string; createdAt?: string; ownerGaii: string } | null> => {
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string }> } | null)?.workspaces ?? [];
      const entry = list.find(w => w.id === ws);
      if (entry) return { ...entry, ownerGaii: rec.ownerGaii };
    }
    return null;
  };

  /** Can this accessor read the workspace's content (i.e. its manifest)? */
  const canReadWs = async (id: string, ws: string, callerGaii: string): Promise<boolean> => {
    const mkey = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: mkey, limit: 10 });
    const man = items.find(r => r.key === mkey);
    if (!man) return false;
    if (man.ownerGaii === callerGaii || isSameOwner(man.ownerGaii, callerGaii)) return true;
    const d = await authorizeRead(storage, config, { ownerGaii: man.ownerGaii, accessorGaii: callerGaii, resourceKey: man.key, visibility: man.visibility, groupId: man.groupId, action: 'read' });
    return d.allowed;
  };

  /** Create a consent grant if an equivalent active one doesn't already exist (idempotent). */
  const ensureConsent = async (ownerGaii: string, dataPattern: string, recipient: string, purpose: string): Promise<void> => {
    const existing = await storage.listConsents(ownerGaii, { status: 'active' });
    if (existing.some(c => c.dataPattern === dataPattern && c.recipient === recipient)) return;
    const now = new Date().toISOString();
    await storage.createConsent({ id: uuidv4(), ownerGaii, dataPattern, recipient, purpose, scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
  };

  /* ══ Workspace member roles (creator-managed) ══
   * A workspace creator grants approved members one of two roles, as a consent the creator OWNS on
   * organism.{id}.w.{ws}.** (so reads resolve via the creator + revoking is clean):
   *   - viewer       → read only          (purpose 'workspace-viewer')
   *   - contributor  → read + write       (purpose 'workspace-contributor')
   * Reads honor ANY grant (viewer/contributor + the legacy 'workspace-access'); writes honor contributor
   * (the write gate also accepts the legacy requester-owned 'workspace-contribution'). Members are an
   * OWNER (+ their agents): the recipient is `ghii:owner@node`, so all the owner's agents inherit. */
  const WS_ROLE_PURPOSES = ['workspace-viewer', 'workspace-contributor', 'workspace-access'];
  const wsPattern = (id: string, ws: string) => `organism.${id}.w.${ws}.**`;
  const recipientOf = (grantee: string) => `ghii:${parseGaiiLoose(grantee).owner || grantee}@${config.nodeId}`;
  /** Set a member's role: revoke any prior workspace-role consent for them, then grant the new one. */
  const setWorkspaceRole = async (creatorGhii: string, id: string, ws: string, grantee: string, role: 'viewer' | 'contributor'): Promise<string> => {
    const recipient = recipientOf(grantee);
    const pattern = wsPattern(id, ws);
    const now = new Date().toISOString();
    const prior = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
    for (const g of prior) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
    await storage.createConsent({ id: uuidv4(), ownerGaii: creatorGhii, dataPattern: pattern, recipient, purpose: role === 'contributor' ? 'workspace-contributor' : 'workspace-viewer', scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
    return recipient;
  };
  const revokeWorkspaceRole = async (creatorGhii: string, id: string, ws: string, grantee: string): Promise<number> => {
    const recipient = recipientOf(grantee);
    const pattern = wsPattern(id, ws);
    const now = new Date().toISOString();
    const grants = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
    for (const g of grants) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
    return grants.length;
  };
  /** Map the creator's active grants → each member's current role for a workspace. */
  const memberRolesForWs = async (creatorGhii: string, id: string, ws: string): Promise<Map<string, 'viewer' | 'contributor'>> => {
    const pattern = wsPattern(id, ws);
    const byOwner = new Map<string, 'viewer' | 'contributor'>();
    for (const c of await storage.listConsents(creatorGhii, { status: 'active' })) {
      if (c.dataPattern !== pattern || !WS_ROLE_PURPOSES.includes(c.purpose)) continue;
      const owner = c.recipient.replace(/^ghii:/, '').split('@')[0];
      if (c.purpose === 'workspace-contributor') byOwner.set(owner, 'contributor');
      else if (!byOwner.has(owner)) byOwner.set(owner, 'viewer');
    }
    return byOwner;
  };

  /* ══ Document-space public sharing (meta.share) ══
   * A workspace's document-space content can be shared read-only without login. The single source of
   * truth is one record per workspace, organism.{id}.w.{ws}.meta.share, with shape
   *   { public?: boolean, spaces?: { [typeName]: boolean }, docs?: { [`${typeName}/${id}`]: boolean } }.
   * Resolution for "is doc D in space S public?": docs[`${S}/${D}`] if set, else spaces[S] if set,
   * else public. Only PUBLISHED (.latest) docs are ever served publicly — drafts never leak. */
  type ShareMeta = { public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean> };

  const readShareMeta = async (id: string, ws: string): Promise<Required<ShareMeta>> => {
    const key = `organism.${id}.w.${ws}.meta.share`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    const v = (items.find(r => r.key === key)?.value as ShareMeta | undefined) ?? {};
    return { public: !!v.public, spaces: v.spaces ?? {}, docs: v.docs ?? {} };
  };

  const isDocPublic = (share: Required<ShareMeta>, typeName: string, docId: string): boolean => {
    const docKey = `${typeName}/${docId}`;
    if (docKey in share.docs) return !!share.docs[docKey];
    if (typeName in share.spaces) return !!share.spaces[typeName];
    return !!share.public;
  };

  /** Read a workspace's manifest value regardless of which member owns it (public path — no auth). */
  const readWsManifestValue = async (id: string, ws: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  type PublicDoc = { type: string; id: string; title: string; markdown: string };
  /** Collect the PUBLISHED (.latest) document-space pages that the share meta marks public. An optional
   *  filter narrows to one {type,id}. Drafts/versions are never included. */
  const collectPublicDocs = async (
    id: string, ws: string, share: Required<ShareMeta>, filter?: { type: string; id: string },
  ): Promise<PublicDoc[]> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const out: PublicDoc[] = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'document') continue;
      if (filter && filter.type !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const docId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        if (filter && filter.id !== docId) continue;
        if (!isDocPublic(share, name, docId)) continue;
        const v = r.value as Record<string, unknown> | null;
        out.push({
          type: name, id: docId,
          title: (v && typeof v.title === 'string') ? v.title : docId,
          markdown: (v && typeof v.markdown === 'string') ? v.markdown : '',
        });
      }
    }
    return out;
  };

  /** Render a list of public docs as a single markdown document (for ?format=md). */
  const docsToMarkdown = (wsName: string | undefined, docs: PublicDoc[]): string => {
    const parts: string[] = [];
    if (wsName) parts.push(`# ${wsName}\n`);
    for (const d of docs) { parts.push(`## ${d.title}\n`); parts.push(d.markdown.trim()); parts.push('\n---\n'); }
    return parts.join('\n');
  };

  /* ── GET /v1/organisms/:id/workspaces — discover every workspace in the org (membership-gated,
   * names + creator + your access status). Discovery is open to members; content stays gated. ── */
  router.get('/v1/organisms/:id/workspaces', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    const seen = new Map<string, { id: string; name: string; created_by: string; created_at?: string; access: 'owner' | 'granted' | 'none' }>();
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string }> } | null)?.workspaces ?? [];
      for (const w of list) {
        if (!w.id || seen.has(w.id)) continue;
        const createdBy = w.createdBy ?? bareOwner(rec.ownerGaii);
        let access: 'owner' | 'granted' | 'none' = 'none';
        if (createdBy === ownerName) access = 'owner';
        else if (await canReadWs(id, w.id, callerGaii)) access = 'granted';
        seen.set(w.id, { id: w.id, name: w.name ?? w.id, created_by: createdBy, created_at: w.createdAt, access });
      }
    }
    res.json(success(config.nodeId, { workspaces: [...seen.values()] }));
  });

  /* ── POST /v1/organisms/:id/workspace-access — request access to a workspace. Records the request
   * and grants the requester's OWN contributions to the organism, so once approved their additions
   * are visible to the creator + other members. Body: { ws, message? }. ── */
  router.post('/v1/organisms/:id/workspace-access', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, message } = req.body ?? {};
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws || typeof ws !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy === ownerName) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You created this workspace')); return; }
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `organism.${id}.w.${ws}.access.request.${ownerName}`, ownerGaii: callerGaii,
      value: { ws, requester: ownerName, requester_gaii: callerGaii, message: typeof message === 'string' ? message : '', status: 'pending', createdAt: now },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    // Share the requester's own future contributions with the organism (read).
    await ensureConsent(callerGaii, `organism.${id}.w.${ws}.**`, `organism.${id}`, 'workspace-contribution');
    // Notify the workspace creator so the request doesn't go unnoticed.
    await notify(storage, `${createdBy}@${config.nodeId}`, {
      type: 'workspace_access_request',
      title: `${ownerName} requested access to "${entry.name ?? ws}"`,
      body: typeof message === 'string' ? message : '',
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    res.status(201).json(success(config.nodeId, { status: 'requested', ws, workspace_creator: createdBy }));
  });

  /* ── GET /v1/organisms/:id/workspace-access?ws= — the workspace creator (or org admin) lists the
   * pending/decided access requests for a workspace they own. ── */
  router.get('/v1/organisms/:id/workspace-access', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== ownerName && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can see access requests')); return;
    }
    const creatorGhii = `${createdBy}@${config.nodeId}`;
    const roles = await memberRolesForWs(creatorGhii, id, ws);   // owner → 'viewer' | 'contributor'
    const { items } = await storage.listAllMemory({ prefix: `organism.${id}.w.${ws}.access.request.`, limit: 1000 });
    const requests = items.map(r => {
      const v = r.value as { requester?: string; message?: string; createdAt?: string };
      const requester = v.requester ?? bareOwner(r.ownerGaii);
      return { requester, message: v.message ?? '', created_at: v.createdAt, status: roles.has(requester) ? 'approved' : 'pending', role: roles.get(requester) ?? null };
    });
    const members = [...roles.entries()].map(([owner, role]) => ({ owner, role }));
    res.json(success(config.nodeId, { ws, requests, members }));
  });

  /* ── POST /v1/organisms/:id/workspace-access/decision — the workspace creator approves or denies a
   * request. Approve → grant the requester read access to the workspace's content. Body:
   * { ws, requester, decision: 'approve' | 'deny' }. ── */
  router.post('/v1/organisms/:id/workspace-access/decision', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, requester, decision } = req.body ?? {};
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws || !requester || (decision !== 'approve' && decision !== 'deny')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, requester and decision (approve|deny) are required')); return;
    }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== ownerName && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can decide access')); return;
    }
    // Grants are owned by the WORKSPACE CREATOR (not the deciding admin), so reads resolve via the
    // creator who owns the content. Approve assigns a role (default contributor; the body may ask for
    // 'viewer'); deny revokes every workspace-role grant for the requester.
    const wsCreatorGhii = `${createdBy}@${config.nodeId}`;
    if (decision === 'approve') {
      const role = (req.body?.role === 'viewer' ? 'viewer' : 'contributor') as 'viewer' | 'contributor';
      await setWorkspaceRole(wsCreatorGhii, id, ws, requester, role);
      await notify(storage, `${requester}@${config.nodeId}`, {
        type: 'workspace_access_approved',
        title: `Your access to "${entry.name ?? ws}" was approved (${role})`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
      res.json(success(config.nodeId, { status: 'approved', ws, requester, role }));
    } else {
      await revokeWorkspaceRole(wsCreatorGhii, id, ws, requester);
      await notify(storage, `${requester}@${config.nodeId}`, {
        type: 'workspace_access_denied',
        title: `Your access request to "${entry.name ?? ws}" was declined`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
      res.json(success(config.nodeId, { status: 'denied', ws, requester }));
    }
  });

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

  /* ── POST /v1/organisms/:id/workspace-access/grant — creator/admin DIRECTLY adds a member with a role
   * (no prior request). Body: { ws, grantee, role: 'viewer' | 'contributor' }. grantee may be an owner
   * name, GHII, or GAII — the grant applies to that OWNER (so all their agents inherit it). ── */
  router.post('/v1/organisms/:id/workspace-access/grant', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, grantee, role } = req.body ?? {};
    if (!grantee || typeof grantee !== 'string' || (role !== 'viewer' && role !== 'contributor')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "grantee and role ('viewer' | 'contributor') are required")); return;
    }
    const createdBy = await requireWsManager(req, res, id, ws);
    if (!createdBy) return;
    const granteeOwner = parseGaiiLoose(grantee).owner || grantee;
    if (granteeOwner === createdBy) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The creator already has full access to their workspace')); return; }
    await setWorkspaceRole(`${createdBy}@${config.nodeId}`, id, ws as string, grantee, role);
    await notify(storage, `${granteeOwner}@${config.nodeId}`, {
      type: 'workspace_access_granted', title: `You were added to "${ws}" as ${role}`, link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    res.json(success(config.nodeId, { ws, grantee: granteeOwner, role }));
  });

  /* ── POST /v1/organisms/:id/workspace-access/revoke — creator/admin removes a member's access.
   * Body: { ws, grantee }. ── */
  router.post('/v1/organisms/:id/workspace-access/revoke', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, grantee } = req.body ?? {};
    if (!grantee || typeof grantee !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'grantee is required')); return; }
    const createdBy = await requireWsManager(req, res, id, ws);
    if (!createdBy) return;
    const revoked = await revokeWorkspaceRole(`${createdBy}@${config.nodeId}`, id, ws as string, grantee);
    res.json(success(config.nodeId, { ws, grantee: parseGaiiLoose(grantee).owner || grantee, revoked }));
  });

  /* ── GET /v1/organisms/:id/workspace/activity?ws= — deterministic activity feed for a workspace,
   * derived from the version history: who did what, in which space, draft-edit vs publish, when.
   * Each .version.N = a publish event; each .draft = an edit event. Member-gated; access-filtered. ── */
  router.get('/v1/organisms/:id/workspace/activity', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });

    // namespace → objectType name + mode, from the manifest (best-effort, for friendly labels + the
    // document/records split shown in the heatmap quadrants).
    const manRec = items.find(r => r.key === `${root}.meta.manifest`);
    const types = ((manRec?.value as { objectTypes?: Array<{ name?: string; namespace?: string; mode?: string }> } | undefined)?.objectTypes) ?? [];
    const typeByNs = new Map(types.filter(o => o.namespace && o.name).map(o => [o.namespace as string, o.name as string]));
    const modeByNs = new Map(types.filter(o => o.namespace).map(o => [o.namespace as string, o.mode === 'document' ? 'document' : 'records']));

    const events: Array<{ at: string; actor: string; agent: string | null; namespace: string; type: string; mode: string; instance: string; action: 'publish' | 'draft' }> = [];
    for (const r of items) {
      // The caller's own records AND their own agents' records (same owner, different GAII) are always
      // theirs to see; only genuinely other-owner records go through the consent check.
      if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
        const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
        if (!d.allowed) continue;
      }
      const rel = r.key.slice(root.length + 1);
      if (rel.startsWith('meta.') || rel.startsWith('access.')) continue;
      const parts = rel.split('.');
      const last = parts[parts.length - 1];
      const secondLast = parts[parts.length - 2];
      let action: 'publish' | 'draft';
      let core: string[];
      if (last === 'draft') { action = 'draft'; core = parts.slice(0, -1); }
      else if (secondLast === 'version' && /^\d+$/.test(last)) { action = 'publish'; core = parts.slice(0, -2); }
      else continue;   // .latest / bare → skip (publishes come from .version.N; avoids double-count)
      const instance = core[core.length - 1];
      const namespace = core.slice(0, -1).join('.');
      if (!instance || !namespace) continue;
      events.push({ at: action === 'draft' ? r.updatedAt : r.createdAt, actor: bareOwner(r.ownerGaii), agent: parseGaiiLoose(r.ownerGaii).agent || null, namespace, type: typeByNs.get(namespace) || namespace, mode: modeByNs.get(namespace) || 'records', instance, action });
    }
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json(success(config.nodeId, { ws, events: events.slice(0, 300), total: events.length }));
  });

  /* ── GET /v1/organisms/:id/workspace/participants?ws= — who takes part in this workspace, derived
   * from the records' ownerGaii traces (humans + their agents leave their identity on what they write)
   * plus organism membership. Builds a node → owner → agents hierarchy. Agent NAMES are revealed only
   * for the CALLER's own agents; every other owner's agents come back anonymized (name: null), so the
   * caller sees their own agents named and everyone else's only as ghost boxes + counts. ── */
  router.get('/v1/organisms/:id/workspace/participants', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const viewerOwner = req.auth!.owner as string;
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });

    interface OwnerAgg { owner: string; node: string; human: number; agents: Map<string, number> }
    const byKey = new Map<string, OwnerAgg>();
    const ensure = (owner: string, node: string) => {
      const k = `${owner}@${node}`;
      let a = byKey.get(k);
      if (!a) { a = { owner, node, human: 0, agents: new Map() }; byKey.set(k, a); }
      return a;
    };
    for (const r of items) {
      const rel = r.key.slice(root.length + 1);
      if (rel.startsWith('access.')) continue;            // access requests are plumbing, not participation
      const p = parseGaiiLoose(r.ownerGaii);
      if (!p.owner || !p.node) continue;
      const agg = ensure(p.owner, p.node);
      if (p.agent) agg.agents.set(p.agent, (agg.agents.get(p.agent) || 0) + 1);
      else agg.human++;
    }
    // Organism members are humans with access — include them even if they have not written anything yet.
    for (const m of (organism.members || [])) ensure(m, config.nodeId);

    const wsEntry = await findWsEntry(id, ws);
    const creator = wsEntry?.createdBy;
    const memberSet = new Set(organism.members || []);

    const nodesMap = new Map<string, OwnerAgg[]>();
    for (const agg of byKey.values()) {
      const list = nodesMap.get(agg.node) ?? [];
      list.push(agg);
      nodesMap.set(agg.node, list);
    }
    const nodes = [...nodesMap.entries()].map(([node, owners]) => ({
      id: node,
      isLocal: node === config.nodeId,
      owners: owners.map(o => {
        const isSelf = o.owner === viewerOwner && o.node === config.nodeId;
        return {
          owner: o.owner,
          isSelf,
          isMember: memberSet.has(o.owner),
          isCreator: o.owner === creator,
          contributions: o.human,
          // Show every agent's identifier + what it has done (its trace count); `isOwn` only drives
          // the visual emphasis. A non-own agent's LIVE status / current task is never exposed here —
          // this endpoint only ever reports the historical trace, so others' agents stay greyed-out.
          agents: [...o.agents.entries()].map(([name, count]) => ({ name, isOwn: isSelf, contributions: count })),
        };
      }),
    }));
    res.json(success(config.nodeId, { ws, viewerOwner, nodes }));
  });

  /* ── PUT /v1/organisms/:id/workspace?ws= — update a workspace's name and/or readme IN PLACE (no new
   * id, no touch to objectTypes/schemas/content), keeping the name synced across manifest + registry.
   * Creator-only (or an org admin). ── */
  router.put('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : (req.body?.ws as string | undefined);
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    try {
      const result = await updateWorkspaceMeta(storage, config, {
        orgId: id, ws, callerOwner: req.auth!.owner as string,
        isAdmin: role === 'admin' || role === 'creator',
        name: req.body?.name, readme: req.body?.readme,
        addObjectTypes: Array.isArray(req.body?.add_object_types) ? req.body.add_object_types : (Array.isArray(req.body?.add_spaces) ? req.body.add_spaces : undefined),
        manifest: req.body?.manifest, schemas: req.body?.schemas,
      });
      emitChange('organisms');
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof WorkspaceMetaError) {
        const status = e.code === 'WS_NOT_FOUND' ? 404 : e.code === 'NOT_CREATOR' ? 403 : 400;
        res.status(status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', (e as Error).message || 'Could not update the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/workspace/public/documents?ws=&space=&format= — NO AUTH. The published
   * document-space pages a workspace has marked public (via meta.share). ?space= limits to one space;
   * ?format=md returns a single concatenated markdown document. 404 (no disclosure) if nothing public. ── */
  router.get('/v1/organisms/:id/workspace/public/documents', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    let docs = await collectPublicDocs(id, ws, share);
    if (space) docs = docs.filter(d => d.type === space);
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public documents')); return; }
    if (req.query.format === 'md') {
      const entry = await findWsEntry(id, ws);
      res.type('text/markdown; charset=utf-8').send(docsToMarkdown(entry?.name, docs));
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, documents: docs }));
  });

  /* ── GET /v1/organisms/:id/workspace/public/document?ws=&type=&id=&format= — NO AUTH. A single
   * published+public document-space page. ?format=md returns its raw markdown. 404 otherwise. ── */
  router.get('/v1/organisms/:id/workspace/public/document', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const docId = typeof req.query.id === 'string' ? req.query.id : '';
    const organism = await storage.getOrganism(id);
    if (!organism || !ws || !type || !docId) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    const docs = await collectPublicDocs(id, ws, share, { type, id: docId });
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Document not found or not public')); return; }
    const doc = docs[0];
    if (req.query.format === 'md') {
      res.type('text/markdown; charset=utf-8').send(`# ${doc.title}\n\n${doc.markdown.trim()}\n`);
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, document: doc }));
  });

  /* ── GET /v1/organisms/:id/workspace/share?ws= — the current share state (for the UI toggles).
   * Any active member may read it. ── */
  router.get('/v1/organisms/:id/workspace/share', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    res.json(success(config.nodeId, { organism_id: id, ws, share: await readShareMeta(id, ws) }));
  });

  /* ── PUT /v1/organisms/:id/workspace/share?ws= — set the share state. Body { public?, spaces?, docs? }
   * is MERGED into the existing meta.share. The workspace creator or an org admin only. The record is
   * stored under the workspace creator's GHII so there is exactly one canonical share record. ── */
  router.put('/v1/organisms/:id/workspace/share', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can change sharing')); return;
    }
    const body = (req.body ?? {}) as ShareMeta;
    const isBoolMap = (m: unknown): m is Record<string, boolean> =>
      !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'boolean');
    if (body.spaces !== undefined && !isBoolMap(body.spaces)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'spaces must be a map of name → boolean')); return; }
    if (body.docs !== undefined && !isBoolMap(body.docs)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'docs must be a map of key → boolean')); return; }
    const prev = await readShareMeta(id, ws);
    const next: Required<ShareMeta> = {
      public: typeof body.public === 'boolean' ? body.public : prev.public,
      spaces: { ...prev.spaces, ...(body.spaces ?? {}) },
      docs: { ...prev.docs, ...(body.docs ?? {}) },
    };
    const key = `organism.${id}.w.${ws}.meta.share`;
    const existing = (await storage.listAllMemory({ prefix: key, limit: 10 })).items.find(r => r.key === key);
    const now = new Date().toISOString();
    await storage.setMemory({
      key, ownerGaii: entry.ownerGaii, value: next, visibility: 'private', tags: ['share'], ttlHours: null,
      version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('organisms');
    res.json(success(config.nodeId, { organism_id: id, ws, share: next }));
  });

  /* ── GET /v1/organisms/:id/workspace/export?ws= — download a full-fidelity ZIP backup of a
   * workspace (workspace.json + images/). The workspace creator (or an org admin) only. ── */
  router.get('/v1/organisms/:id/workspace/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can export')); return;
    }
    const { buffer, filename } = await exportWorkspace(storage, config, {
      orgId: id, ws, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt: new Date().toISOString(),
    });
    // Programmatic/MCP callers can request the ZIP as base64 JSON (size-capped to keep it out of an
    // agent's context); the UI downloads the binary directly.
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) {
        res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Workspace too large for inline (base64) export — use the UI/REST binary download.'));
        return;
      }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/:id/workspace/import — restore a workspace ZIP as a NEW workspace in this
   * organism. Body is the raw ZIP (Content-Type application/zip). Member of the target org only;
   * the importer becomes the new workspace's creator. ── */
  router.post('/v1/organisms/:id/workspace/import', requireAuth(),
    // Raw-parse the body EXCEPT application/json (which the global json parser handles → { zip_base64 }).
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '64mb' }),
    async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the workspace ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importWorkspace(storage, config, { orgId: id, importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'workspace_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/export — download a ZIP backup of the WHOLE organism (settings + all
   * its workspaces). Creator/admin only. ?format=base64 for a size-capped JSON payload. ── */
  router.get('/v1/organisms/:id/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the organism creator or an admin can export the organism')); return; }
    const { buffer, filename } = await exportOrganism(storage, config, { orgId: id, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt: new Date().toISOString() });
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) { res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Organism too large for inline (base64) export — use the UI/REST binary download.')); return; }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/import — restore an organism bundle ZIP as a NEW organism (the importer
   * becomes its creator). Body is the raw ZIP (application/zip) or JSON { zip_base64 }. ── */
  router.post('/v1/organisms/import', requireAuth(), requireRole('agent'),
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '128mb' }),
    async (req, res) => {
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the organism ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importOrganism(storage, config, { importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'organism_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the organism'));
    }
  });

  /* ── DELETE /v1/organisms/:id/workspace — wipe the workspace (manifest + readme + config + ALL
   * object data: drafts, latest, version history) and unregister its schema locks. The organism
   * itself (membership, etc.) stays — it returns to "no workspace yet". Creator/admin only; the
   * deliberate typed-confirmation lives in the UI. Memory under organism.{id}.* is removed entirely. */
  router.delete('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can delete the workspace'));
      return;
    }
    // Scope the wipe to one workspace (organism.{id}.w.{ws}.*) when ?ws= is given; without it, the
    // legacy organism-level wipe. The registry entry (organism.{id}.meta.workspaces) is managed by
    // the client, which removes the entry after this succeeds.
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const prefix = ws ? `organism.${id}.w.${ws}.` : `organism.${id}.`;
    const { items } = await storage.listAllMemory({ prefix, limit: 100000 });
    let memoryKeys = 0;
    for (const r of items) { if (await storage.deleteMemory(r.ownerGaii, r.key)) memoryKeys++; }
    let schemas = 0;
    for (const s of await storage.listSchemas(prefix)) { if (await storage.deleteSchema(s.keyPattern)) schemas++; }
    res.json(success(config.nodeId, { deleted: true, memoryKeys, schemas }));
    emitChange('organisms');
  });

  // POST /v1/organisms/:id/approvals — request approval for an action (gate or auto-run).
  router.post('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    // `arguments` is reserved in ESM strict mode — destructure it under a new name.
    const { action, arguments: actionArgs, risk, rule, stageId, flowGateId, approverRole, prompt, deadline } = req.body ?? {};
    if (!action || typeof action !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action is required'));
      return;
    }
    const riskVal: Risk = ['low', 'medium', 'high'].includes(risk) ? risk : 'medium';
    const approverRoleVal = ['owner', 'admin', 'member'].includes(approverRole) ? approverRole : 'owner';

    const policy = gatePolicyFromManifest(await readManifest(id));
    const decision = shouldGate({ action, risk: riskVal, rule, policy });

    const actor = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();
    const aid = uuidv4();
    const record: PendingApprovalRecord = {
      id: aid, organismId: id, actor, action,
      ...(actionArgs !== undefined ? { arguments: actionArgs } : {}),
      risk: riskVal, approverRole: approverRoleVal as PendingApprovalRecord['approverRole'],
      ...(typeof prompt === 'string' ? { prompt } : {}),
      ...(typeof stageId === 'string' ? { stageId } : {}),
      ...(typeof flowGateId === 'string' ? { flowGateId } : {}),
      ...(typeof deadline === 'string' ? { deadline } : {}),
      status: decision.gate ? 'pending' : 'approved',
      ...(decision.gate ? {} : { decidedBy: 'system', decidedAt: now, resolutionNote: `auto: ${decision.reason}` }),
      createdAt: now, updatedAt: now,
    };
    await storage.createPendingApproval(record);
    if (!decision.gate) {
      await writeDecision(id, actor, `auto-approved action: ${action}`, [aid]);
    }

    res.status(201).json(success(config.nodeId, { approval: record, gated: decision.gate, reason: decision.reason }, [
      { description: 'List pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
      ...(decision.gate ? [{ description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` }] : []),
    ]));
    emitChange('organisms');
  });

  // GET /v1/organisms/:id/approvals — the approval inbox (members).
  router.get('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    // Durable pause: lazily abort any overdue pending approvals before listing.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const status = req.query.status as string | undefined;
    const approvals = await storage.listPendingApprovals(id, status ? { status } : undefined);
    res.json(success(config.nodeId, { approvals, total: approvals.length }));
  });

  // POST /v1/organisms/:id/publish — snapshot a draft into a new version + latest (or gate it).
  router.post('/v1/organisms/:id/publish', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const role = await memberRole(req, organism, id);
    if (!role) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    const { namespace, id: instance, ws } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin/creator role required to publish in a meta.* namespace'));
      return;
    }

    const publisher = resolveIdentity(req.auth!, config.nodeId);

    // Config decides whether publishing needs a review gate. Absent / disabled = publish now.
    const cfg = await readConfig(id);
    const pg = (cfg?.gates as Record<string, { enabled?: boolean; approverRole?: string }> | undefined)?.publish;
    if (pg?.enabled === true) {
      const approverRole = ['owner', 'admin', 'member'].includes(pg.approverRole as string) ? pg.approverRole! : 'owner';
      const now = new Date().toISOString();
      const aid = uuidv4();
      const record: PendingApprovalRecord = {
        id: aid, organismId: id, actor: publisher, action: 'publish',
        arguments: { namespace, instance, ws: wsId }, risk: 'medium',
        approverRole: approverRole as PendingApprovalRecord['approverRole'],
        prompt: `Publish ${namespace}.${instance}?`, status: 'pending', createdAt: now, updatedAt: now,
      };
      await storage.createPendingApproval(record);
      res.status(202).json(success(config.nodeId, { gated: true, approval: record }, [
        { description: 'Review pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
        { description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` },
      ]));
      emitChange('organisms');
      return;
    }

    const result = await publishDraft(id, wsId, namespace, instance, publisher);
    if (!result.ok) {
      if (result.code === 'NO_DRAFT') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${namespace}.${instance}`));
      } else {
        res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: result.violations }));
      }
      return;
    }
    await writeDecision(id, publisher, `published ${namespace}.${instance} v${result.version}`, [`${namespace}.${instance}`]);
    res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'List version history', method: 'GET', url: `/v1/memory?prefix=${encodeURIComponent(`organism.${id}.${namespace}.${instance}.version.`)}` },
    ]));
    emitChange('organisms');
  });

  // POST /v1/organisms/:id/approvals/:aid — resolve (approve | reject | edit). Human-only, role-gated.
  router.post('/v1/organisms/:id/approvals/:aid', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const aid = req.params.aid as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    // Durable pause: abort overdue approvals first, so a resolve of an expired one 409s below.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const approval = await storage.getPendingApproval(aid);
    if (!approval || approval.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Approval not found'));
      return;
    }
    if (approval.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_RESOLVED', `Approval already ${approval.status}`));
      return;
    }

    // Approver must be an active member whose role satisfies the approval's approverRole.
    const role = await memberRole(req, organism, id);
    if (!role || !roleSatisfies(approval.approverRole, role)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', `Resolving this approval requires role "${approval.approverRole}"`));
      return;
    }

    const { decision: d, note, editedArguments } = req.body ?? {};
    if (!['approve', 'reject', 'edit'].includes(d)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'decision must be "approve", "reject", or "edit"'));
      return;
    }

    const decider = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();

    // A publish gate executes the publish on approve/edit BEFORE the decision is recorded, so a
    // failed publish (no draft / invalid) leaves the approval pending rather than falsely approved.
    if (approval.action === 'publish' && d !== 'reject') {
      const pargs = approval.arguments as Record<string, unknown> | undefined;
      const ns = typeof pargs?.namespace === 'string' ? pargs.namespace : undefined;
      const inst = typeof pargs?.instance === 'string' ? pargs.instance : undefined;
      const pws = typeof pargs?.ws === 'string' ? pargs.ws : undefined;
      if (ns && inst) {
        const pub = await publishDraft(id, pws, ns, inst, decider);
        if (!pub.ok) {
          if (pub.code === 'NO_DRAFT') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${ns}.${inst}`));
          } else {
            res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: pub.violations }));
          }
          return;
        }
      }
    }

    const newStatus: PendingApprovalRecord['status'] = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited';
    const updates: Partial<PendingApprovalRecord> = { status: newStatus, decidedBy: decider, decidedAt: now, updatedAt: now };
    if (typeof note === 'string') updates.resolutionNote = note;
    if (d === 'edit' && editedArguments !== undefined) updates.arguments = editedArguments;

    const updated = await storage.updatePendingApproval(aid, updates);
    const verb = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited & approved';
    await writeDecision(id, decider, `${verb} gate: ${approval.action}`, [aid]);

    res.json(success(config.nodeId, { approval: updated, decision: d }, [
      { description: 'View the decision log', method: 'GET', url: `/v1/organisms/${id}/workspace` },
    ]));
    emitChange('organisms');
  });

  return router;
}

/**
 * @file src/routes/organisms/membership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism membership + roster routes: members listing, join-request review, admin
 *   promote/demote, member removal/ban/unban, ownership transfer, name-based invitations (with
 *   invite-time role + workspace grants, pending-invite edit/cancel), DIRECT member add, and agent
 *   attach/detach. Extracted from src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   v1.4.0 — 2026-08-15 — The transfer route's three writes moved into
 *     services/organism-ownership.ts, which the operator's break-glass repair also calls. It had one
 *     caller until an organism arrived whose creator account was unreachable and nothing on any
 *     surface could put it back; a second copy of the sequence is how the two would drift.
 *   v1.3.0 — 2026-08-11 — SECURITY (H-29): removing or banning a member also detaches their agents
 *     from organism.agentGaiis and revokes their workspace-role consents
 *     (revokeDepartedMemberAccess) — an ejected person kept full access through their own agent token.
 *   v1.2.0 — 2026-08-11 — the decline route calls declineNameInvitation() instead of deleting the
 *     membership row itself, so it and aimeat_organism_invitation_respond share one write
 *     (August 2026 MCP audit step 8).
 *   v1.1.0 — 2026-07-16 — Name-invites carry role + workspaces (services/invitations.ts core); new
 *     POST /members (direct add), PATCH + DELETE /invitations/:ghii (edit/cancel pending).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, optionalAuth } from '../../auth/middleware.js';
import { parseGaiiLoose } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { notify } from '../../services/notify.js';
import { canSeeMembers, rosterCallerFromAuth } from '../../services/organism-privacy.js';
import { handOverOwnership, addOrganismOwner, removeOrganismOwner, isOrganismOwner } from '../../services/organism-ownership.js';
import {
  InvitationError, createNameInvitation, updateNameInvitation, cancelNameInvitation,
  acceptNameInvitation, declineNameInvitation, addOrganismMember, revokeDepartedMemberAccess,
} from '../../services/invitations.js';

export function registerOrganismMembershipRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
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

    // Roster privacy (memberVisibility): below the tier the listing shrinks to the accountability
    // rows — creator/admins + the caller's own row — while the TRUE total stays (count ≠ identity).
    // The shared anonymous identity is treated as unauthenticated (rosterCallerFromAuth).
    const rosterCaller = rosterCallerFromAuth(req.auth);
    const canSeeRoster = await canSeeMembers(storage, organism, rosterCaller);
    if (!canSeeRoster) {
      const visible = members.filter(m => m.role === 'creator' || m.role === 'admin'
        || isOrganismOwner(organism, m.ghii) || organism.admins.includes(m.ghii)
        || (rosterCaller.ownerName && m.ghii === rosterCaller.ownerName));
      res.json(success(config.nodeId, { members: visible, total: members.length, members_hidden: true }));
      return;
    }

    // A member's agents inherit access implicitly (same-owner: join answers ALREADY_MEMBER), so
    // "who can touch this organism" must be enumerable — an unlisted actor with access is an
    // audit gap. Each member row carries its owner's agents for ACTIVE members (or an operator)
    // only; outsiders/public callers get the legacy shape (agent rosters are not public data).
    const callerOwner = req.auth?.owner;
    const callerMembership = callerOwner ? await storage.getMembership(id, callerOwner) : null;
    const canSeeAgents = (callerMembership?.status === 'active') || !!req.auth?.roles.includes('operator');
    if (canSeeAgents) {
      // ONE `owner IN (…)` query for every member's agents, not one getAgentsByOwner per member.
      const ownerNames = members.map(m => (m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0]);
      const agentsByOwner = await storage.getAgentsByOwners([...new Set(ownerNames)]);
      const enriched = members.map((m, i) => ({
        ...m,
        agents: (agentsByOwner[ownerNames[i]] || []).map(a => ({ gaii: a.gaii, name: a.name })),
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

    if (!isOrganismOwner(organism, ghii) && !organism.admins.includes(ghii)) {
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

    if (!isOrganismOwner(organism, ghii) && !organism.admins.includes(ghii)) {
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
    // One decision, three rows: the request's verdict, the membership it creates and the organism's
    // member list. A failure between them left a request marked approved with no membership, or a
    // membership the organism did not list.
    await storage.transaction(async () => {
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
    });

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

    if (!isOrganismOwner(organism, ghii) && !organism.admins.includes(ghii)) {
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

    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can demote admins'));
      return;
    }

    if (isOrganismOwner(organism, targetGhii)) {
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

    const callerIsCreator = isOrganismOwner(organism, callerGhii);
    const callerIsAdmin = callerIsCreator || organism.admins.includes(callerGhii);
    if (!callerIsAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can remove members'));
      return;
    }

    if (isOrganismOwner(organism, targetGhii)) {
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
    // Two things survive the membership row, and both of them are access: the removed person's agents
    // stay listed on the organism, where every membership gate reads them as members in their own
    // right, and their workspace-role consents are owned by each workspace's creator, so the writes
    // above reach neither. They go with the membership, on a ban as much as on a plain remove.
    await revokeDepartedMemberAccess(storage, config, { organism, departing: targetGhii });

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
    if (!isOrganismOwner(organism, callerGhii) && !organism.admins.includes(callerGhii)) {
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
    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can transfer ownership'));
      return;
    }
    if (to === callerGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You are already the creator'));
      return;
    }
    // The three writes, the membership checks and both notifications live in the service, because
    // the operator's break-glass repair (POST /v1/admin/organisms/:id/ownership) performs the same
    // transition and a second copy of it would drift. `seatNonMember` stays off here: a creator hands
    // the organism to somebody already in it.
    const outcome = await handOverOwnership(storage, config, organism, to, callerGhii);
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');

    // `creator`/`previousCreator` are the v4 words for what is now one add and one remove. Kept for
    // clients built against them; `owners` is the field to read.
    res.json(success(config.nodeId, {
      creator: outcome.added, previousCreator: outcome.removed, owners: outcome.owners,
    }));
    emitChange('organisms');
  });

  /* Reading who owns an organism has no route of its own: GET /v1/organisms/:id already returns the
   * record, and `owners` + `createdBy` are fields on it. A wrapper would be a second answer to the
   * same question, subject to a second set of visibility rules. */

  /* ── POST /v1/organisms/:id/owners — { ghii } — ADD an owner ──
   * Additive on purpose. Ownership used to move in one irreversible step, so bringing in a second
   * pair of hands cost the first pair everything, and an organism whose single owner went unreachable
   * could not be recovered by anyone. Adding costs the adder nothing; the handover is this plus the
   * DELETE below, with a look in between. The target must already be an active member. ── */
  router.post('/v1/organisms/:id/owners', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const callerGhii = req.auth!.owner as string;
    const { ghii } = req.body ?? {};
    if (!ghii || typeof ghii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "ghii" (an active member) is required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can add an owner'));
      return;
    }
    const outcome = await addOrganismOwner(storage, config, organism, ghii, { performedBy: callerGhii });
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');
    res.json(success(config.nodeId, { owners: outcome.owners, added: outcome.added }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/owners/:ghii — step down, or remove a co-owner ──
   * The departing owner stays as an admin. The LAST owner cannot be removed: an organism with no
   * owner is the one state nobody inside it can repair. ── */
  router.delete('/v1/organisms/:id/owners/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const callerGhii = req.auth!.owner as string;
    const targetGhii = req.params.ghii as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can remove an owner'));
      return;
    }
    const outcome = await removeOrganismOwner(storage, config, organism, targetGhii, { performedBy: callerGhii });
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');
    res.json(success(config.nodeId, { owners: outcome.owners, removed: outcome.removed }));
    emitChange('organisms');
  });

  /* ── Invitations (invite_only flow; works for any policy) ──
   * A creator/admin invites an owner by bare name. The invite is a membership row with
   * status `invited` + `invitedBy`. The invitee is notified and accepts/declines. */

  /** Creator/admin gate shared by the invite/add/edit routes — the organism, or null (responded). */
  const requireInviteAdmin = async (req: Request, res: Response) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    if (!isOrganismOwner(organism, callerGhii) && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can manage members and invitations'));
      return null;
    }
    return organism;
  };

  /* POST /v1/organisms/:id/invitations — invite an owner, optionally with an org role and
   * invite-time workspace grants applied when they accept.
   * Body: { invitee, role?: 'member'|'admin', workspaces?: [{ws, role: 'viewer'|'contributor'}] } */
  router.post('/v1/organisms/:id/invitations', requireAuth(), requireRole('agent'), async (req, res) => {
    const { invitee, role, workspaces } = req.body ?? {};
    if (!invitee || typeof invitee !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "invitee" (an owner name) is required'));
      return;
    }
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      const membership = await createNameInvitation(storage, config, {
        organism, inviterGhii: req.auth!.owner as string, inviteeRaw: invitee, role, workspaces,
      });
      res.status(201).json(success(config.nodeId, { invitation: membership, status: 'invited' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* POST /v1/organisms/:id/members — DIRECT ADD: creator/admin adds an existing local owner as an
   * ACTIVE member, role + workspace grants applied immediately (no accept round-trip; the invitee is
   * notified and can leave). Body: { ghii, role?, workspaces? } */
  router.post('/v1/organisms/:id/members', requireAuth(), requireRole('agent'), async (req, res) => {
    const { ghii, role, workspaces } = req.body ?? {};
    if (!ghii || typeof ghii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "ghii" (an owner name) is required'));
      return;
    }
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      const { membership, grantedWorkspaces } = await addOrganismMember(storage, config, {
        organism, inviterGhii: req.auth!.owner as string, inviteeRaw: ghii, role, workspaces,
      });
      res.status(201).json(success(config.nodeId, { member: membership, workspaces: grantedWorkspaces, status: 'added' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* PATCH /v1/organisms/:id/invitations/:ghii — edit a PENDING invitation's role/workspace grants
   * (rights stay editable until the invitee accepts). Body: { role?, workspaces? } */
  router.patch('/v1/organisms/:id/invitations/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    const { role, workspaces } = req.body ?? {};
    if (role === undefined && workspaces === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide "role" and/or "workspaces" to update'));
      return;
    }
    try {
      const membership = await updateNameInvitation(storage, config, {
        organism, inviteeRaw: req.params.ghii as string, role, workspaces,
      });
      res.json(success(config.nodeId, { invitation: membership }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* DELETE /v1/organisms/:id/invitations/:ghii — cancel a PENDING name invitation (creator/admin). */
  router.delete('/v1/organisms/:id/invitations/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      await cancelNameInvitation(storage, config, {
        organism, cancellerGhii: req.auth!.owner as string, inviteeRaw: req.params.ghii as string,
      });
      res.json(success(config.nodeId, { status: 'cancelled' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
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
    if (!isOrganismOwner(organism, callerGhii) && !organism.admins.includes(callerGhii)) {
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
      res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have not been invited to this space. Ask somebody who is already in it to invite you.'));
      return;
    }
    // Shared accept core: activates the row, syncs members/admins, applies invite-time ws grants.
    const workspaces = await acceptNameInvitation(storage, config, { organism, membership });
    res.json(success(config.nodeId, { status: 'joined', role: membership.role, workspaces }));
  });

  /* POST /v1/organisms/:id/invitations/decline — the invitee declines */
  router.post('/v1/organisms/:id/invitations/decline', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    try {
      // Shared with aimeat_organism_invitation_respond (services/invitations.ts).
      await declineNameInvitation(storage, { organismId: id, inviteeOwner: callerGhii });
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
    res.json(success(config.nodeId, { status: 'declined' }));
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
    if (!isMember && !isOrganismOwner(organism, callerGhii)) {
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
    const isAdmin = isOrganismOwner(organism, callerGhii) || organism.admins.includes(callerGhii);
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
}

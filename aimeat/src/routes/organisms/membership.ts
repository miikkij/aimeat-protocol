/**
 * @file src/routes/organisms/membership.ts
 * @description Organism membership + roster routes: members listing, join-request review, admin
 *   promote/demote, member removal/ban/unban, ownership transfer, name-based invitations, and agent
 *   attach/detach. Extracted from src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, optionalAuth } from '../../auth/middleware.js';
import { parseGaiiLoose } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { notify } from '../../services/notify.js';
import { canSeeMembers, rosterCallerFromAuth } from '../../services/organism-privacy.js';
import { normalizeInviteeName } from '../../services/invitations.js';

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
        || m.ghii === organism.creatorGhii || organism.admins.includes(m.ghii)
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
    const { invitee: inviteeRaw } = req.body ?? {};
    if (!inviteeRaw || typeof inviteeRaw !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "invitee" (an owner name) is required'));
      return;
    }
    const invitee = normalizeInviteeName(inviteeRaw, config.nodeId);
    if (!invitee) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invitee belongs to another node — name-invites work for local owners only'));
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
    if (!(await storage.getOwner(invitee))) {
      res.status(404).json(error(config.nodeId, 'OWNER_NOT_FOUND', `No owner named "${invitee}" on this node`));
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
    emitChange('notifications', `${invitee}@${config.nodeId}`);

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
}

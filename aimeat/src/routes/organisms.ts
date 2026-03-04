import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { createOrganismReputationService } from '../services/organism-reputation.js';

const VALID_TYPES = ['community', 'team', 'club', 'cooperative', 'project'] as const;
const VALID_JOIN_POLICIES = ['open', 'approval_required', 'invite_only'] as const;
const VALID_VISIBILITIES = ['public', 'listed', 'private'] as const;

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

export function organismsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const organismReputationService = createOrganismReputationService(config, storage);

  // ── POST /v1/organisms — Create organism ──
  router.post('/v1/organisms', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;

    // Look up GHII for the authenticated user
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(403).json(error(config.nodeId, 'GHII_REQUIRED',
        'You must have a GHII profile to create an organism'));
      return;
    }

    // Must be GHII Level 1+
    if (ghiiRecord.verificationLevel < 1) {
      res.status(403).json(error(config.nodeId, 'VERIFICATION_REQUIRED',
        'GHII verification level 1 or higher is required to create an organism'));
      return;
    }

    const { name, description, type, location, interests, joinPolicy, visibility, maxMembers } = req.body ?? {};

    // Validate required fields
    if (!name || typeof name !== 'string') {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'name is required'));
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'description is required'));
      return;
    }
    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `type must be one of: ${VALID_TYPES.join(', ')}`));
      return;
    }
    if (!interests || !Array.isArray(interests) || interests.length === 0) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'interests must be a non-empty array'));
      return;
    }
    if (joinPolicy && !(VALID_JOIN_POLICIES as readonly string[]).includes(joinPolicy)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `joinPolicy must be one of: ${VALID_JOIN_POLICIES.join(', ')}`));
      return;
    }
    if (visibility && !(VALID_VISIBILITIES as readonly string[]).includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`));
      return;
    }

    const now = new Date().toISOString();
    const organismId = `org-${randomBytes(8).toString('hex')}`;
    const boardId = `board-${randomBytes(8).toString('hex')}`;
    const membershipId = `mem-${randomBytes(8).toString('hex')}`;
    const ghii = ghiiRecord.ghii;

    // Create the associated board for the organism
    await storage.createBoard({
      id: boardId,
      name: `${name} — Board`,
      description: `Discussion board for ${name}`,
      visibility: (visibility === 'private') ? 'private' : 'public',
      ownerGaii: req.auth!.sub,
      allowedGaiis: [],
      createdAt: now,
    });

    // Create the organism
    const organism = await storage.createOrganism({
      id: organismId,
      name,
      description,
      type,
      location: location ?? undefined,
      interests,
      creatorGhii: ghii,
      admins: [ghii],
      members: [ghii],
      agentGaiis: [],
      boardId,
      joinPolicy: joinPolicy ?? 'open',
      maxMembers: maxMembers ?? 500,
      visibility: visibility ?? 'public',
      moderationConfig: {
        flagsEnabled: true,
        autoHideThreshold: 5,
        appealsEnabled: false,
      },
      memoryNamespace: `organism.${organismId}`,
      createdAt: now,
      updatedAt: now,
    });

    // Create the creator's membership
    await storage.createMembership({
      id: membershipId,
      organismId,
      ghii,
      role: 'creator',
      status: 'active',
      joinedAt: now,
    });

    res.status(201).json(success(config.nodeId, {
      organism: {
        id: organism.id,
        name: organism.name,
        description: organism.description,
        type: organism.type,
        location: organism.location,
        interests: organism.interests,
        creator_ghii: organism.creatorGhii,
        board_id: organism.boardId,
        join_policy: organism.joinPolicy,
        max_members: organism.maxMembers,
        visibility: organism.visibility,
        memory_namespace: organism.memoryNamespace,
        created_at: organism.createdAt,
      },
      board_id: boardId,
    }, [
      { description: 'View this organism', method: 'GET', url: `/v1/organisms/${organismId}` },
      { description: 'List organisms', method: 'GET', url: '/v1/organisms' },
      { description: 'Join this organism', method: 'POST', url: `/v1/organisms/${organismId}/join` },
    ]));
  });

  // ── GET /v1/organisms — List organisms (public) ──
  router.get('/v1/organisms', async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const interest = typeof req.query.interest === 'string' ? req.query.interest : undefined;
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : 1;
    const perPage = typeof req.query.per_page === 'string' ? parseInt(req.query.per_page, 10) : 20;

    // Public listing only shows public and listed organisms
    const organisms = await storage.listOrganisms({ type, city, interest, page, perPage });
    const publicOrganisms = organisms.filter(o => o.visibility !== 'private');

    res.json(success(config.nodeId, {
      organisms: publicOrganisms.map(o => ({
        id: o.id,
        name: o.name,
        description: o.description,
        type: o.type,
        location: o.location,
        interests: o.interests,
        join_policy: o.joinPolicy,
        visibility: o.visibility,
        member_count: o.members.length,
        created_at: o.createdAt,
      })),
      page,
      per_page: perPage,
      total: publicOrganisms.length,
    }));
  });

  // ── GET /v1/organisms/:id — Get organism detail ──
  router.get('/v1/organisms/:id', async (req, res) => {
    const id = param(req.params.id);
    const organism = await storage.getOrganism(id);

    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check if requester is a member
    let isMember = false;
    if (req.auth?.owner) {
      const ghiiRecord = await storage.getGHIIByOwner(req.auth.owner);
      if (ghiiRecord) {
        const membership = await storage.getMembership(id, ghiiRecord.ghii);
        isMember = membership?.status === 'active';
      }
    }

    // Private organisms: only members can see full details
    if (organism.visibility === 'private' && !isMember) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        'This organism is private. Only members can view it.'));
      return;
    }

    // Build schema.org semantic annotation — Phase 2.7
    const semantic: Record<string, unknown> = {
      '@context': { schema: 'https://schema.org/' },
      '@type': 'schema:Organization',
      'schema:memberOf': 'aimeat:Federation',
    };
    if (organism.location?.city) {
      semantic['schema:areaServed'] = {
        '@type': 'schema:Place',
        'schema:address': {
          '@type': 'schema:PostalAddress',
          ...(organism.location.city ? { 'schema:addressLocality': organism.location.city } : {}),
          ...(organism.location.area ? { 'schema:addressRegion': organism.location.area } : {}),
          ...(organism.location.country ? { 'schema:addressCountry': organism.location.country } : {}),
        },
      };
    }
    if (organism.interests.length > 0) {
      semantic['schema:knowsAbout'] = organism.interests;
    }

    // Base info for public view
    const baseInfo: Record<string, unknown> = {
      id: organism.id,
      name: organism.name,
      description: organism.description,
      type: organism.type,
      location: organism.location,
      interests: organism.interests,
      join_policy: organism.joinPolicy,
      visibility: organism.visibility,
      member_count: organism.members.length,
      board_id: organism.boardId,
      semantic: organism.semantic ?? semantic,
      created_at: organism.createdAt,
      updated_at: organism.updatedAt,
    };

    // Authenticated members get full detail including member list
    if (isMember) {
      const members = await storage.listMembers(id, { status: 'active' });
      baseInfo.members = members.map(m => ({
        ghii: m.ghii,
        role: m.role,
        joined_at: m.joinedAt,
      }));
      baseInfo.admins = organism.admins;
      baseInfo.creator_ghii = organism.creatorGhii;
      baseInfo.moderation_config = organism.moderationConfig;
      baseInfo.memory_namespace = organism.memoryNamespace;
    }

    res.json(success(config.nodeId, { organism: baseInfo }, [
      { description: 'Join this organism', method: 'POST', url: `/v1/organisms/${id}/join` },
      { description: 'List members', method: 'GET', url: `/v1/organisms/${id}/members` },
      { description: 'Leave this organism', method: 'POST', url: `/v1/organisms/${id}/leave` },
    ]));
  });

  // ── PUT /v1/organisms/:id — Update organism (admin/creator only) ──
  router.put('/v1/organisms/:id', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check admin/creator access
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'GHII profile required'));
      return;
    }

    const isAdmin = organism.admins.includes(ghiiRecord.ghii);
    const isOperator = req.auth!.roles.includes('operator');
    if (!isAdmin && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        'Only organism admins or operators can update an organism'));
      return;
    }

    // Build update object from allowed fields
    const updates: Record<string, unknown> = {};
    const { name, description, interests, joinPolicy, visibility, location, maxMembers, moderationConfig } = req.body ?? {};

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (interests !== undefined) updates.interests = interests;
    if (location !== undefined) updates.location = location;
    if (maxMembers !== undefined) updates.maxMembers = maxMembers;
    if (moderationConfig !== undefined) updates.moderationConfig = moderationConfig;

    if (joinPolicy !== undefined) {
      if (!(VALID_JOIN_POLICIES as readonly string[]).includes(joinPolicy)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          `joinPolicy must be one of: ${VALID_JOIN_POLICIES.join(', ')}`));
        return;
      }
      updates.joinPolicy = joinPolicy;
    }

    if (visibility !== undefined) {
      if (!(VALID_VISIBILITIES as readonly string[]).includes(visibility)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`));
        return;
      }
      updates.visibility = visibility;
    }

    updates.updatedAt = new Date().toISOString();

    const updated = await storage.updateOrganism(id, updates as Partial<typeof organism>);

    res.json(success(config.nodeId, {
      organism: {
        id: updated!.id,
        name: updated!.name,
        description: updated!.description,
        type: updated!.type,
        location: updated!.location,
        interests: updated!.interests,
        join_policy: updated!.joinPolicy,
        visibility: updated!.visibility,
        updated_at: updated!.updatedAt,
      },
    }));
  });

  // ── POST /v1/organisms/:id/join — Join an organism ──
  router.post('/v1/organisms/:id/join', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(403).json(error(config.nodeId, 'GHII_REQUIRED',
        'You must have a GHII profile to join an organism'));
      return;
    }

    const ghii = ghiiRecord.ghii;

    // Check if already a member
    const existing = await storage.getMembership(id, ghii);
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER',
        'You are already a member of this organism'));
      return;
    }

    if (existing && existing.status === 'banned') {
      res.status(403).json(error(config.nodeId, 'BANNED',
        'You are banned from this organism'));
      return;
    }

    // Check max members
    if (organism.members.length >= organism.maxMembers) {
      res.status(409).json(error(config.nodeId, 'MAX_MEMBERS_REACHED',
        'This organism has reached its maximum member limit'));
      return;
    }

    const now = new Date().toISOString();

    if (organism.joinPolicy === 'invite_only') {
      // Check for a pending invitation
      const pendingInvite = existing; // already fetched above
      if (!pendingInvite || pendingInvite.status !== 'pending') {
        res.status(403).json(error(config.nodeId, 'INVITE_ONLY',
          'This organism is invite-only. You need an invitation to join.'));
        return;
      }

      // Accept the invitation — activate the pending membership
      await storage.updateMembership(pendingInvite.id, {
        status: 'active',
        joinedAt: now,
      });

      // Update organism members list
      await storage.updateOrganism(id, {
        members: [...organism.members, ghii],
        updatedAt: now,
      });

      res.json(success(config.nodeId, {
        membership: {
          id: pendingInvite.id,
          organism_id: id,
          ghii,
          role: 'member',
          status: 'active',
          joined_at: now,
          invited_by: pendingInvite.invitedBy,
        },
      }, [
        { description: 'View organism', method: 'GET', url: `/v1/organisms/${id}` },
        { description: 'Leave organism', method: 'POST', url: `/v1/organisms/${id}/leave` },
      ]));
      return;
    }

    if (organism.joinPolicy === 'approval_required') {
      // Check if there's already a pending request
      const existingRequests = await storage.listJoinRequests(id, { status: 'pending' });
      const alreadyRequested = existingRequests.find(r => r.ghii === ghii);
      if (alreadyRequested) {
        res.status(409).json(error(config.nodeId, 'ALREADY_REQUESTED',
          'You already have a pending join request for this organism'));
        return;
      }

      const requestId = `jr-${randomBytes(8).toString('hex')}`;
      const joinRequest = await storage.createJoinRequest({
        id: requestId,
        organismId: id,
        ghii,
        message: req.body?.message,
        status: 'pending',
        createdAt: now,
      });

      res.status(202).json(success(config.nodeId, {
        join_request: {
          id: joinRequest.id,
          organism_id: joinRequest.organismId,
          ghii: joinRequest.ghii,
          status: joinRequest.status,
          message: joinRequest.message,
          created_at: joinRequest.createdAt,
        },
      }, [
        { description: 'View your join request status', method: 'GET', url: `/v1/organisms/${id}` },
      ]));
      return;
    }

    // Open join policy: direct join
    const membershipId = `mem-${randomBytes(8).toString('hex')}`;
    await storage.createMembership({
      id: membershipId,
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

    res.json(success(config.nodeId, {
      membership: {
        id: membershipId,
        organism_id: id,
        ghii,
        role: 'member',
        status: 'active',
        joined_at: now,
      },
    }, [
      { description: 'View organism', method: 'GET', url: `/v1/organisms/${id}` },
      { description: 'Leave organism', method: 'POST', url: `/v1/organisms/${id}/leave` },
    ]));
  });

  // ── POST /v1/organisms/:id/invite — Invite a user (admin/creator only) ──
  router.post('/v1/organisms/:id/invite', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check admin access
    const callerGhii = await storage.getGHIIByOwner(ownerName);
    if (!callerGhii) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'GHII profile required'));
      return;
    }

    const isAdmin = organism.admins.includes(callerGhii.ghii);
    const isOperator = req.auth!.roles.includes('operator');
    if (!isAdmin && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        'Only organism admins can invite users'));
      return;
    }

    const { ghii: inviteeGhii } = req.body ?? {};
    if (!inviteeGhii || typeof inviteeGhii !== 'string') {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'ghii is required (the GHII of the user to invite)'));
      return;
    }

    // Check if invitee exists
    const inviteeRecord = await storage.getGHII(inviteeGhii);
    if (!inviteeRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `User not found: ${inviteeGhii}`));
      return;
    }

    // Check if already a member
    const existing = await storage.getMembership(id, inviteeGhii);
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER',
        'User is already a member'));
      return;
    }

    // Check max members
    if (organism.members.length >= organism.maxMembers) {
      res.status(409).json(error(config.nodeId, 'MAX_MEMBERS_REACHED',
        'Organism has reached maximum member limit'));
      return;
    }

    // Create a pending membership (invited)
    const now = new Date().toISOString();
    const membershipId = `mem-${randomBytes(8).toString('hex')}`;

    await storage.createMembership({
      id: membershipId,
      organismId: id,
      ghii: inviteeGhii,
      role: 'member',
      status: 'pending',
      joinedAt: now,
      invitedBy: callerGhii.ghii,
    });

    res.status(201).json(success(config.nodeId, {
      invitation: {
        id: membershipId,
        organism_id: id,
        organism_name: organism.name,
        ghii: inviteeGhii,
        invited_by: callerGhii.ghii,
        status: 'pending',
        created_at: now,
      },
    }, [
      { description: 'View organism', method: 'GET', url: `/v1/organisms/${id}` },
      { description: 'Invited user can accept', method: 'POST', url: `/v1/organisms/${id}/join` },
    ]));
  });

  // ── POST /v1/organisms/:id/leave — Leave organism ──
  router.post('/v1/organisms/:id/leave', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(403).json(error(config.nodeId, 'GHII_REQUIRED', 'GHII profile required'));
      return;
    }

    const ghii = ghiiRecord.ghii;
    const membership = await storage.getMembership(id, ghii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER',
        'You are not a member of this organism'));
      return;
    }

    // Delete the membership
    await storage.deleteMembership(membership.id);

    // Update organism members and admins lists
    const updatedMembers = organism.members.filter(m => m !== ghii);
    const updatedAdmins = organism.admins.filter(a => a !== ghii);
    const now = new Date().toISOString();

    await storage.updateOrganism(id, {
      members: updatedMembers,
      admins: updatedAdmins,
      updatedAt: now,
    });

    res.json(success(config.nodeId, {
      left: true,
      organism_id: id,
      orphan: updatedAdmins.length === 0,
    }, [
      { description: 'List organisms', method: 'GET', url: '/v1/organisms' },
    ]));
  });

  // ── DELETE /v1/organisms/:id — Delete organism (creator or operator) ──
  router.delete('/v1/organisms/:id', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Only the creator or an operator can delete
    const isOperator = req.auth!.roles.includes('operator');
    let isCreator = false;
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (ghiiRecord) {
      isCreator = organism.creatorGhii === ghiiRecord.ghii;
    }

    if (!isCreator && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        'Only the organism creator or an operator can delete an organism'));
      return;
    }

    // Delete associated board
    await storage.deleteBoard(organism.boardId);

    // Delete organism (cascades memberships and join requests)
    await storage.deleteOrganism(id);

    res.json(success(config.nodeId, {
      deleted: true,
      organism_id: id,
    }, [
      { description: 'List organisms', method: 'GET', url: '/v1/organisms' },
      { description: 'Create a new organism', method: 'POST', url: '/v1/organisms' },
    ]));
  });

  // ── GET /v1/organisms/:id/members — List members ──
  router.get('/v1/organisms/:id/members', async (req, res) => {
    const id = param(req.params.id);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Private organisms: only members can see member list
    if (organism.visibility === 'private') {
      if (!req.auth?.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'This organism is private'));
        return;
      }
      const ghiiRecord = await storage.getGHIIByOwner(req.auth.owner);
      if (!ghiiRecord) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'This organism is private'));
        return;
      }
      const membership = await storage.getMembership(id, ghiiRecord.ghii);
      if (!membership || membership.status !== 'active') {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'This organism is private. Only members can view the member list.'));
        return;
      }
    }

    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const members = await storage.listMembers(id, { role, status: status ?? 'active' });

    res.json(success(config.nodeId, {
      members: members.map(m => ({
        id: m.id,
        ghii: m.ghii,
        role: m.role,
        status: m.status,
        joined_at: m.joinedAt,
        invited_by: m.invitedBy,
      })),
      total: members.length,
    }));
  });

  // ── POST /v1/organisms/:id/join-requests/:requestId/review — Review join request (admin) ──
  router.post('/v1/organisms/:id/join-requests/:requestId/review', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const requestId = param(req.params.requestId);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check admin access
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord || !organism.admins.includes(ghiiRecord.ghii)) {
      const isOperator = req.auth!.roles.includes('operator');
      if (!isOperator) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'Only organism admins can review join requests'));
        return;
      }
    }

    const joinRequest = await storage.getJoinRequest(requestId);
    if (!joinRequest || joinRequest.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Join request not found'));
      return;
    }

    if (joinRequest.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_REVIEWED',
        `This join request has already been ${joinRequest.status}`));
      return;
    }

    const { decision } = req.body ?? {};
    if (!decision || !['approve', 'reject'].includes(decision)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'decision must be "approve" or "reject"'));
      return;
    }

    const now = new Date().toISOString();
    const reviewerGhii = ghiiRecord?.ghii ?? 'operator';

    if (decision === 'approve') {
      // Check max members
      if (organism.members.length >= organism.maxMembers) {
        res.status(409).json(error(config.nodeId, 'MAX_MEMBERS_REACHED',
          'Cannot approve: organism has reached its maximum member limit'));
        return;
      }

      // Update join request
      await storage.updateJoinRequest(requestId, {
        status: 'approved',
        reviewedBy: reviewerGhii,
        reviewedAt: now,
      });

      // Create membership
      const membershipId = `mem-${randomBytes(8).toString('hex')}`;
      await storage.createMembership({
        id: membershipId,
        organismId: id,
        ghii: joinRequest.ghii,
        role: 'member',
        status: 'active',
        joinedAt: now,
      });

      // Update organism members list
      await storage.updateOrganism(id, {
        members: [...organism.members, joinRequest.ghii],
        updatedAt: now,
      });

      res.json(success(config.nodeId, {
        decision: 'approved',
        join_request_id: requestId,
        membership_id: membershipId,
        ghii: joinRequest.ghii,
      }));
    } else {
      // Reject
      await storage.updateJoinRequest(requestId, {
        status: 'rejected',
        reviewedBy: reviewerGhii,
        reviewedAt: now,
      });

      res.json(success(config.nodeId, {
        decision: 'rejected',
        join_request_id: requestId,
        ghii: joinRequest.ghii,
      }));
    }
  });

  // ── GET /v1/organisms/:id/join-requests — List pending join requests (admin) ──
  router.get('/v1/organisms/:id/join-requests', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const ownerName = req.auth!.owner;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check admin access
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord || !organism.admins.includes(ghiiRecord.ghii)) {
      const isOperator = req.auth!.roles.includes('operator');
      if (!isOperator) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'Only organism admins can view join requests'));
        return;
      }
    }

    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const requests = await storage.listJoinRequests(id, { status });

    res.json(success(config.nodeId, {
      join_requests: requests.map(r => ({
        id: r.id,
        ghii: r.ghii,
        message: r.message,
        status: r.status,
        reviewed_by: r.reviewedBy,
        created_at: r.createdAt,
        reviewed_at: r.reviewedAt,
      })),
      total: requests.length,
    }));
  });

  // ── GET /v1/organisms/:id/reputation — Calculate & get organism reputation (Phase 3.4) ──
  router.get('/v1/organisms/:id/reputation', async (req, res) => {
    try {
      const organismId = req.params.id as string;
      const reputation = await organismReputationService.calculateReputation(organismId);
      if (!reputation) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
      res.json(success(config.nodeId, {
        reputation,
        semantic: {
          '@context': { schema: 'https://schema.org/' },
          '@type': 'schema:Rating',
          'schema:ratingValue': reputation.score,
          'schema:bestRating': 100,
          'schema:worstRating': 0,
        },
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  return router;
}

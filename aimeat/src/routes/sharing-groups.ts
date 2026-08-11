/**
 * @file sharing-groups.ts
 * @description REST endpoints for Sharing Group CRUD and member management
 * @structure
 *   - POST   /v1/groups              -- Create group
 *   - GET    /v1/groups              -- List own + member-of groups
 *   - GET    /v1/groups/:id          -- Get group detail
 *   - PATCH  /v1/groups/:id          -- Update group
 *   - DELETE /v1/groups/:id          -- Delete group
 *   - POST   /v1/groups/:id/members  -- Add member
 *   - PATCH  /v1/groups/:id/members/:identifier -- Update member permissions
 *   - DELETE /v1/groups/:id/members/:identifier -- Remove member
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import { addGroupMember, removeGroupMember } from '../services/sharing-group-members.js';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, SharingGroupMember } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import {
  SharingGroupCreateSchema,
  SharingGroupUpdateSchema,
  SharingGroupAddMemberSchema,
  SharingGroupUpdateMemberSchema,
} from '../models/sharing-group-schemas.js';

function resolveMemberIdentifier(identifier: string, nodeId: string): string {
  if (identifier.includes('@') || identifier.includes('#')) return identifier;
  return `${identifier}@${nodeId}`;
}

export function sharingGroupsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /* ── POST /v1/groups -- Create a sharing group ── */
  router.post('/v1/groups', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGaii = resolve(req);

    const parsed = SharingGroupCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join(', ')));
      return;
    }

    const { name, description, members, default_permissions } = parsed.data;

    // Max 50 groups per owner
    const existing = await storage.listSharingGroups(ownerGaii);
    if (existing.length >= 50) {
      res.status(409).json(error(config.nodeId, 'LIMIT_REACHED', 'Maximum 50 sharing groups per owner'));
      return;
    }

    const now = new Date().toISOString();
    const id = uuidv4();

    // Convert members from request format (identifier_type) to storage format (identifierType)
    const storageMbers: SharingGroupMember[] = members.map(m => ({
      identifier: resolveMemberIdentifier(m.identifier, config.nodeId),
      identifierType: m.identifier_type,
      permissions: m.permissions ?? default_permissions,
      addedAt: now,
      addedBy: ownerGaii,
    }));

    const record = await storage.createSharingGroup({
      id,
      name: name.trim(),
      description: description?.trim(),
      ownerGaii,
      members: storageMbers,
      defaultPermissions: default_permissions,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(success(config.nodeId, { group: record }, [
      { description: 'View group', method: 'GET', url: `/v1/groups/${id}` },
      { description: 'Add member', method: 'POST', url: `/v1/groups/${id}/members` },
    ]));
    emitChange('groups');
  });

  /* ── GET /v1/groups -- List own + member-of groups ── */
  router.get('/v1/groups', requireAuth(), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const identity = resolve(req);

    let groups;
    if (isOwnerSession) {
      // Owner sees their owned groups + groups where they are a member
      const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
      const owned = await storage.listSharingGroups(ownerGhii);
      const memberOf = await storage.listSharingGroupsByMember(ownerGhii);

      // Merge and deduplicate by id
      const seen = new Set(owned.map(g => g.id));
      groups = [...owned];
      for (const g of memberOf) {
        if (!seen.has(g.id)) {
          groups.push(g);
          seen.add(g.id);
        }
      }
    } else {
      // Agent sees groups where it is a member
      groups = await storage.listSharingGroupsByMember(identity);
    }

    res.json(success(config.nodeId, { groups, total: groups.length }));
  });

  /* ── GET /v1/groups/:id -- Get group detail ── */
  router.get('/v1/groups/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const identity = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    // Must be owner or member
    const isOwner = group.ownerGaii === identity;
    const isMember = group.members.some(m => m.identifier === identity);

    // For owner sessions, also check if the bare owner matches
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const ownerGhii = isOwnerSession ? `${req.auth!.owner}@${config.nodeId}` : null;
    const isOwnerByGhii = ownerGhii ? group.ownerGaii === ownerGhii : false;
    const isMemberByGhii = ownerGhii ? group.members.some(m => m.identifier === ownerGhii) : false;

    if (!isOwner && !isMember && !isOwnerByGhii && !isMemberByGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not a member of this group'));
      return;
    }

    res.json(success(config.nodeId, { group }));
  });

  /* ── PATCH /v1/groups/:id -- Update group ── */
  router.patch('/v1/groups/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const ownerGaii = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    if (group.ownerGaii !== ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the group owner can update'));
      return;
    }

    const parsed = SharingGroupUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join(', ')));
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) updates.description = parsed.data.description.trim();
    if (parsed.data.default_permissions !== undefined) updates.defaultPermissions = parsed.data.default_permissions;

    const updated = await storage.updateSharingGroup(id, updates);
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update group'));
      return;
    }

    res.json(success(config.nodeId, { group: updated }));
    emitChange('groups');
  });

  /* ── DELETE /v1/groups/:id -- Delete group ── */
  router.delete('/v1/groups/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const ownerGaii = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    if (group.ownerGaii !== ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the group owner can delete'));
      return;
    }

    // Check if any memory entries reference this group
    const refCount = await storage.countEntriesReferencingGroup(id);

    await storage.deleteSharingGroup(id);

    res.json(success(config.nodeId, {
      deleted: true,
      warning: refCount > 0
        ? `${refCount} memory entries referenced this group and will fall back to private visibility`
        : undefined,
    }));
    emitChange('groups');
  });

  /* ── POST /v1/groups/:id/members -- Add member ── */
  router.post('/v1/groups/:id/members', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const ownerGaii = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    if (group.ownerGaii !== ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the group owner can add members'));
      return;
    }

    const parsed = SharingGroupAddMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join(', ')));
      return;
    }

    const { identifier: rawIdentifier, identifier_type, permissions } = parsed.data;
    const identifier = resolveMemberIdentifier(rawIdentifier, config.nodeId);

    // The ceiling, the duplicate test and the member's shape are services/sharing-group-members.ts,
    // because aimeat_group_add_member decides them too.
    const added = addGroupMember(group, { identifier, identifierType: identifier_type, permissions }, ownerGaii);
    if (!added.ok) {
      res.status(added.status).json(error(config.nodeId, added.code, added.message));
      return;
    }
    const { members: updatedMembers, now } = added;
    const newMember = updatedMembers[updatedMembers.length - 1];
    const updated = await storage.updateSharingGroup(id, {
      members: updatedMembers,
      updatedAt: now,
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to add member'));
      return;
    }

    res.status(201).json(success(config.nodeId, { group: updated, added: newMember }));
    emitChange('groups');
  });

  /* ── PATCH /v1/groups/:id/members/:identifier -- Update member permissions ── */
  router.patch('/v1/groups/:id/members/:identifier', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const identifier = req.params.identifier as string;
    const ownerGaii = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    if (group.ownerGaii !== ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the group owner can update members'));
      return;
    }

    const parsed = SharingGroupUpdateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join(', ')));
      return;
    }

    const memberIdx = group.members.findIndex(m => m.identifier === identifier);
    if (memberIdx === -1) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Member not found in this group'));
      return;
    }

    const updatedMembers = [...group.members];
    updatedMembers[memberIdx] = {
      ...updatedMembers[memberIdx],
      permissions: parsed.data.permissions,
    };

    const now = new Date().toISOString();
    const updated = await storage.updateSharingGroup(id, {
      members: updatedMembers,
      updatedAt: now,
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update member'));
      return;
    }

    res.json(success(config.nodeId, { group: updated }));
    emitChange('groups');
  });

  /* ── DELETE /v1/groups/:id/members/:identifier -- Remove member ── */
  router.delete('/v1/groups/:id/members/:identifier', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const identifier = req.params.identifier as string;
    const ownerGaii = resolve(req);

    const group = await storage.getSharingGroup(id);
    if (!group) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Sharing group not found'));
      return;
    }

    if (group.ownerGaii !== ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the group owner can remove members'));
      return;
    }

    const removed = removeGroupMember(group, identifier);
    if (!removed.ok) {
      res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
      return;
    }
    const { members: updatedMembers, now } = removed;
    const updated = await storage.updateSharingGroup(id, {
      members: updatedMembers,
      updatedAt: now,
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to remove member'));
      return;
    }

    res.json(success(config.nodeId, { group: updated, removed: identifier }));
    emitChange('groups');
  });

  return router;
}

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
 *   v1.1.0 -- 2026-08-11 -- Create, add-member and remove-member call
 *     services/sharing-group-members.ts, which aimeat_group_create and friends now call too. This
 *     router keeps the envelope and the status codes and nothing else of those three.
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import {
  createSharingGroup,
  addSharingGroupMember,
  removeSharingGroupMember,
} from '../services/sharing-group-members.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import {
  SharingGroupUpdateSchema,
  SharingGroupUpdateMemberSchema,
} from '../models/sharing-group-schemas.js';

export function sharingGroupsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /* ── POST /v1/groups -- Create a sharing group ── */
  router.post('/v1/groups', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGaii = resolve(req);

    // Validation, the 50-group ceiling, the member's stored address, the record and the change
    // event are services/sharing-group-members.ts, because aimeat_group_create decides them too.
    const created = await createSharingGroup({ storage, config }, ownerGaii, req.body);
    if (!created.ok) {
      res.status(created.status).json(error(config.nodeId, created.code, created.message));
      return;
    }

    const record = created.group;
    res.status(201).json(success(config.nodeId, { group: record }, [
      { description: 'View group', method: 'GET', url: `/v1/groups/${record.id}` },
      { description: 'Add member', method: 'POST', url: `/v1/groups/${record.id}/members` },
    ]));
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

    // Ownership, the ceiling, the duplicate test, the member's stored address and the write are
    // services/sharing-group-members.ts, because aimeat_group_add_member decides them too.
    const added = await addSharingGroupMember({ storage, config }, ownerGaii, id, req.body);
    if (!added.ok) {
      res.status(added.status).json(error(config.nodeId, added.code, added.message));
      return;
    }

    res.status(201).json(success(config.nodeId, { group: added.group, added: added.member }));
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

    const removed = await removeSharingGroupMember({ storage, config }, ownerGaii, id, identifier);
    if (!removed.ok) {
      res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
      return;
    }

    res.json(success(config.nodeId, { group: removed.group, removed: removed.identifier }));
  });

  return router;
}

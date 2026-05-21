/**
 * @file admin-sharing-groups.ts
 * @description Admin endpoints for cross-owner sharing group overview.
 *   Lists all sharing groups on the node with member and entry counts.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function adminSharingGroupsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/admin/sharing-groups', requireAuth(), requireRole('operator'), async (req, res) => {
    const owners = await storage.listOwners();
    const allGroups: any[] = [];

    for (const owner of owners) {
      const ownerGhii = `${owner.name}@${config.nodeId}`;
      const groups = await storage.listSharingGroups(ownerGhii);
      allGroups.push(...groups);
    }

    const groupsWithCounts = await Promise.all(allGroups.map(async g => ({
      id: g.id,
      name: g.name,
      description: g.description || '',
      owner_gaii: g.ownerGaii,
      member_count: g.members.length,
      entry_count: await storage.countEntriesReferencingGroup(g.id),
      created_at: g.createdAt,
    })));

    res.json(success(config.nodeId, {
      groups: groupsWithCounts,
      total: groupsWithCounts.length,
    }));
  });

  return router;
}

/**
 * @file admin-sharing-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin endpoints for cross-owner sharing group overview.
 *   Lists all sharing groups on the node with member and entry counts.
 * @version-history
 *   v1.1.0 -- 2026-10-05 -- The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, SharingGroupRecord } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';

export function adminSharingGroupsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/admin/sharing-groups', requireAuth(), requireOperator(storage), async (req, res) => {
    const owners = await storage.listOwners();
    const allGroups: SharingGroupRecord[] = [];

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

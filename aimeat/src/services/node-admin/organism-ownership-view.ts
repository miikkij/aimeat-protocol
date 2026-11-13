/**
 * @file src/services/node-admin/organism-ownership-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who holds an organism, as the operator's repair view shows it: its owners, creator and
 *   admins, and every membership row. GET /v1/admin/organisms/:id/ownership and
 *   aimeat_admin_organism_ownership both read it here, so the two reads and the view are written once
 *   (structure programme 2026-11, unit 2b).
 *
 *   WHO. The node operator in person, or the operator's agent holding the organism-repair word. Both
 *   surfaces ask the one shared question for that, services/operator-principal.ts askOperator (the
 *   route through requireOperatorPrincipal, the tool through resolveOperatorAgentName with the same
 *   word), before they call this.
 * @structure organismOwnershipView(storage, organismId) → view | null
 * @usage const view = await organismOwnershipView(storage, id); if (!view) refuse(404);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/admin/organisms.ts and mcp/core-admin.ts, which each held
 *     the reads and the view (structure programme 2026-11, unit 2b).
 */
import type { Storage } from '../../storage/interface.js';
import { organismOwners } from '../organism-ownership.js';

/** The organism's ownership view, or null when there is no such organism. */
export async function organismOwnershipView(storage: Storage, organismId: string) {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return null;
    const members = await storage.listMembers(organismId);
    return {
        id: organism.id, name: organism.name,
        owners: organismOwners(organism), created_by: organism.createdBy, admins: organism.admins,
        created_at: organism.createdAt, updated_at: organism.updatedAt,
        members: members.map(m => ({ ghii: m.ghii, role: m.role, status: m.status, joined_at: m.joinedAt })),
    };
}

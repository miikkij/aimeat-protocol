/**
 * @file src/services/organism-read/leave.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Leaving an organism by its id: the organism read, then leaveOrganism
 *   (services/organism-lifecycle.ts), which holds the rules (an owner cannot leave, only an active
 *   member leaves) and the roster sync. POST /v1/organisms/:id/leave and aimeat_organism_leave both
 *   call it, so the read and the rule around it are one call on both surfaces (structure programme
 *   2026-11, unit 2b).
 * @structure leaveOrganismAs(deps, id, who) → { ok } | refusal
 * @usage const out = await leaveOrganismAs({ storage, config }, id, { owner: req.auth!.owner });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/organisms/crud.ts and mcp/organisms.ts, which each read the
 *     organism before leaveOrganism (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { leaveOrganism } from '../organism-lifecycle.js';

/** The caller's account leaves the organism, or the refusal (NOT_FOUND when the organism is gone). */
export async function leaveOrganismAs(
    deps: { storage: Storage; config: AimeatConfig }, organismId: string, who: { owner: string },
): Promise<Awaited<ReturnType<typeof leaveOrganism>>> {
    const organism = await deps.storage.getOrganism(organismId);
    if (!organism) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
    return leaveOrganism(deps, organism, who.owner);
}

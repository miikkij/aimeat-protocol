/**
 * @file src/services/team/leads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person invited as a team lead becomes one when they accept. The invitation itself
 *   can only carry the organism roles member and admin, and an owner must already be an active
 *   member (services/organism/ownership.ts addOrganismOwner), so the team record keeps which
 *   invitations make a lead, and the accept code path calls promotePendingLead() once the
 *   membership is active. Adding the owner is additive: the leads already there stay.
 *
 *   An invitation that is not in the record does nothing, so every accept may call this.
 * @structure promotePendingLead
 * @usage await promotePendingLead(storage, config, orgId, ownerName, `email:${invitation.id}`);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { addOrganismOwner } from '../organism/ownership.js';
import { readTeamRecordWithVersion, writeTeamRecord } from './record.js';

/**
 * When `invitation` (`email:<invitation id>` or `name:<membership id>`) was sent to make a lead,
 * make the accepter an owner of the organism and take the invitation off the record. Answers
 * whether a lead was added. Never throws: the person has joined either way.
 */
export async function promotePendingLead(
    storage: Storage, config: AimeatConfig, orgId: string, ownerName: string, invitation: string,
): Promise<boolean> {
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            const read = await readTeamRecordWithVersion(storage, orgId);
            if (!read || !read.team.leadsPending.some(p => p.invitation === invitation)) return false;
            const organism = await storage.getOrganism(orgId);
            if (!organism) return false;
            const outcome = await addOrganismOwner(storage, config, organism, ownerName, { performedBy: read.team.createdBy });
            if (!outcome.ok && outcome.code !== 'ALREADY_OWNER') {
                logger.warn('team: an accepted lead invitation could not add the owner', { orgId, ownerName, code: outcome.code });
                return false;
            }
            const team = { ...read.team, leadsPending: read.team.leadsPending.filter(p => p.invitation !== invitation) };
            if (await writeTeamRecord(storage, config, orgId, team, read, read.team.createdBy)) return true;
        }
        return false;
    } catch (err) {
        logger.warn('team: promoting an accepted lead failed', { orgId, ownerName, error: String(err) });
        return false;
    }
}

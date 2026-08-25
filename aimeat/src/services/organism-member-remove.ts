/**
 * @file organism-member-remove.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Taking a member off an organism: the rules, once, for every door. This lived inside
 *   the DELETE /v1/organisms/:id/members/:ghii handler, which meant removal was reachable by
 *   clicking and by nothing else — an owner asking their own AI to take someone out of an organism
 *   got no tool for it, while `aimeat_organism_member_add` had been there since July. A capability
 *   with a door on one side only is not finished.
 *
 *   What removal is, and why it is more than deleting a row: two things outlive a membership and
 *   both of them are access. The person's AGENTS stay listed on the organism, where every
 *   membership gate reads them as members in their own right, and their workspace-role grants are
 *   owned by each workspace's creator, so nothing the organism record says reaches them. Both go
 *   with the membership, on a ban as much as on a plain remove (revokeDepartedMemberAccess).
 *
 *   Plain remove deletes the row and the person may be invited again. `ban` keeps the row and flips
 *   it to `banned`, which is what refuses a later invite or direct add (resolveInvitee → BANNED).
 * @structure
 *   - MemberRemoveError — status + code, mapped by each door to its own envelope
 *   - removeOrganismMember() — permission rules, the removal, the access revoke and the notice
 * @usage
 *   const out = await removeOrganismMember(storage, config, { organism, callerOwner, targetRaw, ban });
 * @version-history
 *   v1.0.0 -- 2026-08-25 -- Extracted from routes/organisms/membership.ts so the MCP surfaces can
 *     remove a member through the same rules the web door has always used.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { isOrganismOwner } from './organism-ownership.js';
import { revokeDepartedMemberAccess } from './invitations.js';
import { membershipOwner } from './invitation-lookup.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';

/** A refusal with the status and code the HTTP door has always sent, so no door invents its own. */
export class MemberRemoveError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: 'ACCESS_DENIED' | 'CANNOT_REMOVE_CREATOR' | 'NOT_MEMBER',
    message: string,
  ) {
    super(message);
    this.name = 'MemberRemoveError';
  }
}

export interface RemoveMemberInput {
  organism: OrganismRecord;
  /** Bare owner name of the caller. Must be the organism's creator or one of its admins. */
  callerOwner: string;
  /** The person to remove, as a bare owner name or a full GHII. */
  targetRaw: string;
  /** Keep the row as `banned` (blocks a later invite or add) instead of deleting it. */
  ban?: boolean;
}

/**
 * Remove (or ban) one member. Throws MemberRemoveError on every refusal:
 * a caller who is neither creator nor admin, the creator as a target (delete the organism instead),
 * an admin removed by anyone but the creator, and a target who is not an active member.
 */
export async function removeOrganismMember(
  storage: Storage,
  config: AimeatConfig,
  input: RemoveMemberInput,
): Promise<{ removed: string; banned: boolean }> {
  const { organism, callerOwner, ban = false } = input;
  const target = membershipOwner(input.targetRaw.trim());

  const callerIsCreator = isOrganismOwner(organism, callerOwner);
  const callerIsAdmin = callerIsCreator || organism.admins.includes(callerOwner);
  if (!callerIsAdmin) {
    throw new MemberRemoveError(403, 'ACCESS_DENIED', 'Only the creator or an admin can remove members');
  }
  if (isOrganismOwner(organism, target)) {
    throw new MemberRemoveError(400, 'CANNOT_REMOVE_CREATOR', 'The creator cannot be removed. Delete the organism instead.');
  }
  if (organism.admins.includes(target) && !callerIsCreator) {
    throw new MemberRemoveError(403, 'ACCESS_DENIED', 'Only the creator can remove an admin');
  }

  const membership = await storage.getMembership(organism.id, target);
  if (!membership || membership.status !== 'active') {
    throw new MemberRemoveError(404, 'NOT_MEMBER', 'Target is not an active member');
  }

  const now = new Date().toISOString();
  if (ban) {
    await storage.updateMembership(membership.id, { status: 'banned', role: 'member' });
  } else {
    await storage.deleteMembership(membership.id);
  }
  await storage.updateOrganism(organism.id, {
    members: organism.members.filter(m => m !== target),
    admins: organism.admins.filter(a => a !== target),
    updatedAt: now,
  });
  // The agents and the workspace grants, which the roster arrays above do not reach.
  await revokeDepartedMemberAccess(storage, config, { organism, departing: target });

  await notify(storage, `${target}@${config.nodeId}`, {
    type: ban ? 'organism_member_banned' : 'organism_member_removed',
    title: ban
      ? `You were blocked from "${organism.name}"`
      : `Your access to "${organism.name}" was revoked`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications');
  emitChange('organisms');
  return { removed: target, banned: ban };
}

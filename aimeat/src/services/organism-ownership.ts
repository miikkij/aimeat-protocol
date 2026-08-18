/**
 * @file src/services/organism-ownership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who holds an organism, and the only place that changes it.
 *
 *   An organism used to have exactly one owner, stored in `creatorGhii`, and that column answered two
 *   different questions: who MADE this, which is history, and who HOLDS it, which is a role. A
 *   handover wrote both, so moving authority rewrote the past. Worse, a role only one account can
 *   hold has no way back: when that account becomes unreachable the organism is stuck, because an
 *   admin cannot remove, demote or replace an owner and only an owner can hand it on or delete it.
 *
 *   Ownership is plural now. `createdBy` is the fact and never moves. `owners` is the authority and
 *   is never empty — the last owner cannot be removed, only replaced. Adding an owner is additive, so
 *   nobody has to give anything up to bring somebody in, and the handover that started this incident
 *   is two visible steps rather than one irreversible one.
 *
 *   `creatorGhii` survives as a MIRROR of `owners[0]` for federation payloads, exports and v4
 *   clients. It is deprecated (removed in v5.0) and nothing here compares against it.
 *
 * @structure
 *   - organismOwners / isOrganismOwner: the read side, with the pre-split fallback
 *   - OwnershipOutcome: discriminated result; routes map `code` to an envelope
 *   - addOrganismOwner / removeOrganismOwner / handOverOwnership: the write side
 *
 * @usage
 *   import { isOrganismOwner, addOrganismOwner } from '../services/organism-ownership.js';
 *   if (!isOrganismOwner(organism, callerName)) { …403… }
 *   const out = await addOrganismOwner(storage, config, organism, 'alice');
 *   if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
 *
 * @version-history
 *   v2.0.0 — 2026-08-15 — Ownership is plural: owners[] + createdBy, add/remove as first-class
 *     operations, and the handover expressed as add-then-remove. creatorGhii becomes a mirror.
 *   v1.0.0 — 2026-08-15 — Extracted from the transfer route so the operator break-glass shares it.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { notify } from './notify.js';

/**
 * Everyone who holds this organism. Falls back to the deprecated single field for a record written
 * before the split, which had exactly one owner and named them there.
 */
export function organismOwners(organism: Pick<OrganismRecord, 'owners' | 'creatorGhii'>): string[] {
  return organism.owners?.length ? organism.owners : [organism.creatorGhii];
}

/** Does this bare owner name hold the organism? The authorization test — never `=== creatorGhii`. */
export function isOrganismOwner(organism: Pick<OrganismRecord, 'owners' | 'creatorGhii'>, name: string): boolean {
  return !!name && organismOwners(organism).includes(name);
}

export type OwnershipOutcome =
  | {
      ok: true;
      /** Everyone holding the organism after the change, in order. */
      owners: string[];
      /** Bare owner name added, when the call added one. */
      added?: string;
      /** Bare owner name that stopped holding it, when the call removed one. */
      removed?: string;
      /** True when the break-glass path had to seat the new owner as a member first. */
      membershipCreated: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

export interface AddOwnerOptions {
  /**
   * Break-glass only. When the target is not an active member, seat them as one instead of refusing.
   * An ordinary add leaves this off: you hand authority to somebody already in the organism. A BANNED
   * target is refused on both paths — lifting the block is a separate, visible decision.
   */
  seatNonMember?: boolean;
  /** Who performed this, for the notification the other owners read. */
  performedBy?: string;
}

/** The organism fields that follow from an owner list. `creatorGhii` is the mirror, nothing else. */
function ownershipFields(owners: string[], admins: string[], members: string[]) {
  return {
    owners,
    creatorGhii: owners[0],
    // An owner is not also an admin: holding both is the state that made the two lists disagree.
    admins: admins.filter(a => !owners.includes(a)),
    members: [...new Set([...members, ...owners])],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Add `target` to the organism's owners. Additive: every existing owner keeps everything, which is
 * the whole point — bringing in a second pair of hands should not cost the first pair anything.
 */
export async function addOrganismOwner(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  target: string,
  opts: AddOwnerOptions = {},
): Promise<OwnershipOutcome> {
  const name = String(target || '').trim();
  if (!name) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'A target owner name is required' };
  }
  const owners = organismOwners(organism);
  if (owners.includes(name)) {
    return { ok: false, status: 400, code: 'ALREADY_OWNER', message: `${name} already owns this organism` };
  }
  if (!(await storage.getOwner(name))) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `No owner named "${name}" on this node` };
  }

  let membership = await storage.getMembership(organism.id, name);
  if (membership?.status === 'banned') {
    return {
      ok: false, status: 400, code: 'MEMBER_BANNED',
      message: `${name} is blocked in this organism. Lift the block before making them an owner.`,
    };
  }
  if ((!membership || membership.status !== 'active') && !opts.seatNonMember) {
    return { ok: false, status: 404, code: 'NOT_MEMBER', message: 'Target must be an active member of this organism' };
  }

  const next = [...owners, name];
  let membershipCreated = false;
  const now = new Date().toISOString();
  await storage.transaction(async () => {
    if (membership) {
      await storage.updateMembership(membership.id, { role: 'creator', status: 'active' });
    } else {
      membership = await storage.createMembership({
        id: uuidv4(), organismId: organism.id, ghii: name,
        role: 'creator', status: 'active', joinedAt: now,
      });
      membershipCreated = true;
    }
    await storage.updateOrganism(organism.id, ownershipFields(next, organism.admins, organism.members));
  });

  await notify(storage, `${name}@${config.nodeId}`, {
    type: 'organism_ownership_transferred',
    title: `You are now an owner of "${organism.name}"`,
    link: '/v1/profile#organisms',
  });
  // Everyone who already held it is told, because gaining a co-owner is not a private event.
  for (const existing of owners) {
    await notify(storage, `${existing}@${config.nodeId}`, {
      type: 'organism_ownership_transferred',
      title: `${name} is now an owner of "${organism.name}"${opts.performedBy ? ` (${opts.performedBy})` : ''}`,
      link: '/v1/profile#organisms',
    });
  }

  return { ok: true, owners: next, added: name, membershipCreated };
}

/**
 * Take `target` off the organism's owners, leaving them as an admin. The last owner cannot be
 * removed: an organism with no owner is the state nobody can repair from the inside, which is the
 * whole failure this file exists to end.
 */
export async function removeOrganismOwner(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  target: string,
  opts: { performedBy?: string } = {},
): Promise<OwnershipOutcome> {
  const name = String(target || '').trim();
  const owners = organismOwners(organism);
  if (!owners.includes(name)) {
    return { ok: false, status: 400, code: 'NOT_OWNER', message: `${name} does not own this organism` };
  }
  if (owners.length === 1) {
    return {
      ok: false, status: 400, code: 'LAST_OWNER',
      message: 'An organism always has an owner. Add another one first, or delete the organism.',
    };
  }

  const next = owners.filter(o => o !== name);
  const membership = await storage.getMembership(organism.id, name);
  await storage.transaction(async () => {
    if (membership) await storage.updateMembership(membership.id, { role: 'admin' });
    await storage.updateOrganism(organism.id, {
      ...ownershipFields(next, organism.admins, organism.members),
      // The departing owner keeps a seat as admin, so they are re-added to the list the previous
      // line just filtered them out of.
      admins: [...new Set([...organism.admins.filter(a => !next.includes(a)), name])],
    });
  });

  await notify(storage, `${name}@${config.nodeId}`, {
    type: 'organism_ownership_transferred',
    title: `You are no longer an owner of "${organism.name}"${opts.performedBy ? ` (${opts.performedBy})` : ''}`,
    link: '/v1/profile#organisms',
  });

  return { ok: true, owners: next, removed: name, membershipCreated: false };
}

/**
 * Hand the organism from `from` to `to` in one call: the old shape of ownership, kept because
 * POST /v1/organisms/:id/transfer means exactly this and clients depend on it. It is now add then
 * remove, and the intermediate state is legal, so the same thing can be done in two steps with a
 * look in between — which is what the UI offers.
 */
export async function handOverOwnership(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  to: string,
  from: string,
  opts: AddOwnerOptions = {},
): Promise<OwnershipOutcome> {
  const added = await addOrganismOwner(storage, config, organism, to, opts);
  if (!added.ok) return added;

  // Re-read: the add rewrote owners/admins/members, and removing from a stale copy would put them back.
  const fresh = await storage.getOrganism(organism.id);
  if (!fresh) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
  const removed = await removeOrganismOwner(storage, config, fresh, from, opts);
  if (!removed.ok) return removed;

  return {
    ok: true, owners: removed.owners, added: added.added, removed: removed.removed,
    membershipCreated: added.membershipCreated,
  };
}

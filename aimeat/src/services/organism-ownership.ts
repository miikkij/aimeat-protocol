/**
 * @file src/services/organism-ownership.ts
 * @description The one implementation of "who owns this organism". Two doors reach it: the creator's
 *   own handover (POST /v1/organisms/:id/transfer) and the node operator's break-glass repair
 *   (POST /v1/admin/organisms/:id/creator), which exists because an organism whose creator account is
 *   unreachable had no route back at all — an admin cannot remove, demote or replace a creator, and
 *   until now neither could the operator whose node it runs on.
 *
 *   WHY A SERVICE. Ownership is three writes that belong together: the incoming creator's membership
 *   row, the outgoing creator's, and the organism's `creatorGhii` + `admins`. Half of it leaves an
 *   organism with two creators or none and nobody able to fix it, so both doors share this function
 *   rather than each performing its own version of the sequence.
 *
 * @structure
 *   - OwnershipOutcome: discriminated result; routes map `code` to an envelope
 *   - handOverOwnership(storage, config, organism, to, opts): the transition, in one transaction
 *
 * @usage
 *   import { handOverOwnership } from '../services/organism-ownership.js';
 *   const out = await handOverOwnership(storage, config, organism, 'alice');
 *   if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
 *
 * @version-history
 *   v1.0.0 — 2026-08-15 — Extracted from the transfer route so the operator break-glass shares it.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { OrganismRecord } from '../storage/interface.js';
import { notify } from './notify.js';

export type OwnershipOutcome =
  | {
      ok: true;
      /** Bare owner name that now holds the organism. */
      creator: string;
      /** Bare owner name that held it before, now an admin. */
      previousCreator: string;
      /** True when the break-glass path had to seat the new owner as a member first. */
      membershipCreated: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

export interface HandOverOptions {
  /**
   * Break-glass only. When the target is not an active member, seat them as one instead of refusing.
   * The creator's own handover leaves this off: you hand an organism to someone already in it.
   * A BANNED target is refused on both paths — lifting the block is a separate, visible decision.
   */
  seatNonMember?: boolean;
  /** Who performed this, for the notification the new owner reads. Defaults to "the node operator". */
  performedBy?: string;
}

/**
 * Move an organism's ownership to `to` (a bare owner name), demoting the previous creator to admin
 * and keeping them as a member. Returns a discriminated outcome rather than throwing, because both
 * callers turn the failure into a response envelope with a specific code.
 */
export async function handOverOwnership(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  to: string,
  opts: HandOverOptions = {},
): Promise<OwnershipOutcome> {
  const target = String(to || '').trim();
  if (!target) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'A target owner name is required' };
  }
  const from = organism.creatorGhii;
  if (target === from) {
    return { ok: false, status: 400, code: 'ALREADY_CREATOR', message: `${target} already owns this organism` };
  }

  const owner = await storage.getOwner(target);
  if (!owner) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `No owner named "${target}" on this node` };
  }

  let membership = await storage.getMembership(organism.id, target);
  let membershipCreated = false;
  const now = new Date().toISOString();

  if (membership?.status === 'banned') {
    return {
      ok: false, status: 400, code: 'MEMBER_BANNED',
      message: `${target} is blocked in this organism. Lift the block before handing it over.`,
    };
  }

  if (!membership || membership.status !== 'active') {
    if (!opts.seatNonMember) {
      return { ok: false, status: 404, code: 'NOT_MEMBER', message: 'Target must be an active member of this organism' };
    }
  }

  const fromMembership = await storage.getMembership(organism.id, from);
  // The previous creator keeps a seat as admin; a target that was an admin stops being one, since
  // holding both is the state that made `admins` and `creatorGhii` disagree in the first place.
  const admins = [...new Set([...organism.admins.filter(a => a !== target), from])];
  const members = [...new Set([...organism.members, target])];

  await storage.transaction(async () => {
    if (membership) {
      await storage.updateMembership(membership.id, { role: 'creator', status: 'active' });
    } else {
      membership = await storage.createMembership({
        id: uuidv4(), organismId: organism.id, ghii: target,
        role: 'creator', status: 'active', joinedAt: now,
      });
      membershipCreated = true;
    }
    if (fromMembership) await storage.updateMembership(fromMembership.id, { role: 'admin' });
    await storage.updateOrganism(organism.id, { creatorGhii: target, admins, members, updatedAt: now });
  });

  await notify(storage, `${target}@${config.nodeId}`, {
    type: 'organism_ownership_transferred',
    title: `You are now the creator of "${organism.name}"`,
    link: '/v1/profile#organisms',
  });
  // The outgoing owner is told too: losing an organism silently is how this went unnoticed for a month.
  if (from !== target) {
    await notify(storage, `${from}@${config.nodeId}`, {
      type: 'organism_ownership_transferred',
      title: `"${organism.name}" is now owned by ${target}${opts.performedBy ? ` (${opts.performedBy})` : ''}`,
      link: '/v1/profile#organisms',
    });
  }

  return { ok: true, creator: target, previousCreator: from, membershipCreated };
}

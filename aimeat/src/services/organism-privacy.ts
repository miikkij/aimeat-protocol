/**
 * @file organism-privacy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Member-roster visibility for organisms — THE one policy every surface consults
 *   (REST detail/list/members, MCP organism_get/_members). An organism's `memberVisibility`
 *   decides who may see the roster: 'public' (anyone, deliberate opt-in), 'authenticated'
 *   (any signed-in caller — the DEFAULT when unset, so the anonymous internet never sees
 *   rosters), 'members' (active members), 'admins' (creator/admins). Creator + admins stay
 *   visible at every tier (accountability — someone answerable must always be identifiable),
 *   the caller always sees their own row, and operators/creator/admins always see everything
 *   (the "who can touch this organism must be enumerable" audit principle, kept for the people
 *   who govern it). This is ROSTER privacy only: content attribution (comments, versions,
 *   activity) is deliberately out of scope — writers are visible; read-only members are not.
 * @structure memberVisibilityOf, canSeeMembers, redactOrganism
 * @usage
 *   const canSee = await canSeeMembers(storage, organism, { ownerName, isOperator });
 *   res.json({ organism: redactOrganism(organism, canSee), members_hidden: !canSee });
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial (privacy fix: rosters were world-readable via detail/list/members).
 */
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { isOrganismOwner } from './organism-ownership.js';

export type MemberVisibility = NonNullable<OrganismRecord['memberVisibility']>;

/** The effective tier — records that predate the field get 'authenticated' (the privacy-fix default). */
export function memberVisibilityOf(organism: OrganismRecord): MemberVisibility {
  return organism.memberVisibility ?? 'authenticated';
}

export const MEMBER_VISIBILITY_VALUES: MemberVisibility[] = ['public', 'authenticated', 'members', 'admins'];

export interface RosterCaller {
  /** Bare owner name of the caller (undefined = anonymous). */
  ownerName?: string;
  isOperator?: boolean;
  /** True for the shared anonymous identity (anonymous mode). It has an `owner` string but is NOT a
   *  real signed-in principal, so the roster gate must treat it as anonymous — otherwise the
   *  'authenticated' tier would still expose rosters to the anonymous internet, voiding the fix. */
  isAnonymous?: boolean;
}

/** Build a RosterCaller from an Express `req.auth`. The one place that maps the anonymous-mode
 *  shared identity to "not a real principal", so every surface treats the anon internet uniformly. */
export function rosterCallerFromAuth(auth?: { owner?: string; roles?: string[]; anonymous?: boolean }): RosterCaller {
  const isAnon = !!auth?.anonymous;
  return {
    ownerName: isAnon ? undefined : (auth?.owner as string | undefined),
    isOperator: !isAnon && !!auth?.roles?.includes('operator'),
    isAnonymous: isAnon,
  };
}

/** May this caller see the organism's member roster? Creator/admins/operator always may. */
export async function canSeeMembers(storage: Storage, organism: OrganismRecord, caller: RosterCaller): Promise<boolean> {
  if (caller.isOperator) return true;
  const owner = caller.isAnonymous ? undefined : caller.ownerName;
  if (owner && (isOrganismOwner(organism, owner) || organism.admins.includes(owner))) return true;
  switch (memberVisibilityOf(organism)) {
    case 'public': return true;
    case 'authenticated': return !!owner;
    case 'members': {
      if (!owner) return false;
      const membership = await storage.getMembership(organism.id, owner);
      return !!membership && membership.status === 'active';
    }
    case 'admins': return false;   // creator/admins/operator already returned above
  }
}

/** The organism record with the roster fields redacted when the caller may not see them.
 *  Creator + admins stay (accountability); members[] + agentGaiis[] are emptied. */
export function redactOrganism<T extends OrganismRecord>(organism: T, canSee: boolean): T {
  if (canSee) return organism;
  return { ...organism, members: [], agentGaiis: [] };
}

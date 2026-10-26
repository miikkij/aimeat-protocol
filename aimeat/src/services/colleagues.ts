/**
 * @file src/services/colleagues.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organisation-node setting "members see each other" (AIMEAT_MEMBERS_SEE_EACH_OTHER,
 *   config.membersSeeEachOther, off by default). On a node that one company runs for its own people,
 *   every person of the node is a colleague of every other: each one is in every other's address book
 *   without anyone saving them, the member directory lists everyone without the per-person opt-in, and
 *   a first message or a group invitation between two of them is accepted without a request. Ruled by
 *   Jouni on 2026-10-26: an explicit operator setting, not derived from the registration mode or SSO,
 *   and a colleague's first message goes straight through.
 *
 *   A colleague is a PERSON (a GHII) of THIS node whose account is not disabled and is not the shared
 *   anonymous account. Agents and apps are not colleagues: an agent still asks first, because a person
 *   who accepts a colleague has not accepted every program that colleague runs. A block always wins,
 *   in the address book and on the message path, because both callers test the consent row first.
 * @structure membersSeeEachOther(config) · nodeColleagues(storage, nodeId) · areColleagues(storage, config, a, b)
 * @usage if (await areColleagues(storage, config, recipient, sender)) state = 'accepted';
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial: address book, member directory, DM first-contact gate, group invitation.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { GHIIRecord } from '../storage/types/identity.js';
import { ANONYMOUS_ACCOUNT } from '../auth/anonymous-principal.js';
import { identityKind } from './local-identity.js';
import { localAccountOf } from '../utils/gaii.js';

/** Is the setting on? One place reads it, so every caller agrees. */
export function membersSeeEachOther(config: Pick<AimeatConfig, 'membersSeeEachOther'>): boolean {
  return config.membersSeeEachOther === true;
}

/** How many disabled accounts are read to leave out. Disabled accounts are the few, not the many. */
const DISABLED_READ_LIMIT = 10_000;

/**
 * Every person of this node who counts as a colleague: a GHII of this node, an account that is not
 * disabled, and not the anonymous account. Two reads whatever the size of the node: the people, and
 * the names of the disabled accounts (a filtered query, not the owner table). The caller removes the
 * person asking.
 */
export async function nodeColleagues(storage: Storage, nodeId: string): Promise<GHIIRecord[]> {
  const [people, disabled] = await Promise.all([
    storage.listGHIIs(),
    storage.listDisabledOwnerNames({ limit: DISABLED_READ_LIMIT }),
  ]);
  const off = new Set(disabled);
  return people.filter(p => p.nodeId === nodeId && p.ownerName !== ANONYMOUS_ACCOUNT && !off.has(p.ownerName));
}

/** Is `id` a person of this node with an active account? */
async function isActiveLocalPerson(storage: Storage, nodeId: string, id: string): Promise<boolean> {
  if (identityKind(id) !== 'ghii' || !id.endsWith(`@${nodeId}`)) return false;
  const account = localAccountOf(id);
  if (!account || account === ANONYMOUS_ACCOUNT) return false;
  const [person, owner] = await Promise.all([storage.getGHII(id), storage.getOwner(account)]);
  return !!person && !!owner && !owner.disabledAt;
}

/**
 * True when the setting is on and `a` and `b` are two different people of this node with active
 * accounts. False for an agent, an app, a person of another node and a person compared with themself.
 */
export async function areColleagues(
  storage: Storage, config: Pick<AimeatConfig, 'membersSeeEachOther' | 'nodeId'>, a: string, b: string,
): Promise<boolean> {
  if (!membersSeeEachOther(config) || a === b) return false;
  const [one, two] = await Promise.all([
    isActiveLocalPerson(storage, config.nodeId, a),
    isActiveLocalPerson(storage, config.nodeId, b),
  ]);
  return one && two;
}

/**
 * @file src/services/owner-scope-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which records a caller reading with owner_scope (or with ?agent= naming a sibling
 *   agent) may see: everything, or only what the ordinary visibility rules give it.
 *
 *   The owner sees everything their own agents hold, in one direction only (security.md). An agent
 *   reading its OWNER's private data, or a sibling agent's, goes through the visibility rules,
 *   because a scoped agent must not ride the human's ownership. Until 2026-10-15 an agent holding
 *   memory:read read every private record of its owner and its siblings by passing owner_scope.
 *   Reading as the owner now costs its own word, memory:read-as-owner, outside every wildcard,
 *   modelled on messages:read-as-owner and memory:write-as-owner (feature-list audit #42, Jouni).
 *
 *   WHO READS EVERYTHING. The owner in person, an app grant of the owner (it already acts as the
 *   owner, and `memory:read` is its word for the owner's records, as `messages:read` is for the
 *   owner's mailbox), and an agent holding memory:read-as-owner.
 *
 *   WHAT THE OTHERS SEE. Their own records, and other same-owner records whose visibility admits a
 *   same-owner reader without a lookup: `owner`, `members` and `public` (services/consent.ts
 *   checkConsentForRead rules 1 and 3, access-guard.ts for `members`). A private, group or workspace
 *   record of the owner or a sibling is left out. A consent or a key-space share the owner gave an
 *   agent is not consulted on this code path, because doing so costs storage reads per record on
 *   listings of thousands; the owner who wants the agent to read those grants the word.
 * @structure readsAsOwner(caller) · visibleToSameOwnerReader(record, principal) · ownerScopeView(records, principal, all)
 * @usage
 *   const all = readsAsOwner(callerOf(req, config.nodeId, storage));
 *   const shown = ownerScopeView(records, caller.principal, all);
 * @version-history
 *   2026-10-15 — Initial: memory:read-as-owner (feature-list audit #42).
 */
import type { CallerContext } from './caller-context.js';
import { READ_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';

export { READ_AS_OWNER_SCOPE };

/** Visibility tiers a same-owner reader is admitted to without a consent or share lookup. */
const SAME_OWNER_VISIBLE: ReadonlySet<string> = new Set(['owner', 'members', 'public']);

/** True when this caller reads with owner_scope as the owner does: every record, private ones too. */
export function readsAsOwner(caller: Pick<CallerContext, 'kind' | 'has'>): boolean {
  return caller.kind === 'app' || caller.has(READ_AS_OWNER_SCOPE);
}

/** True when a same-owner reader that does not read as the owner may see this record. */
export function visibleToSameOwnerReader(record: { ownerGaii: string; visibility: string }, principal: string): boolean {
  return record.ownerGaii === principal || SAME_OWNER_VISIBLE.has(record.visibility);
}

/** The records of an owner-scope read this caller may see. Order is kept. */
export function ownerScopeView<T extends { ownerGaii: string; visibility: string }>(
  records: readonly T[], principal: string, readsAll: boolean,
): T[] {
  return readsAll ? [...records] : records.filter((r) => visibleToSameOwnerReader(r, principal));
}

/** The note an answer carries when records were left out, so an agent knows what to ask for. */
export const READ_AS_OWNER_NOTE = `Records the owner or another of their agents keeps private are left out. `
  + `Reading them needs the "${READ_AS_OWNER_SCOPE}" permission, which the owner grants per agent in Profile -> Agents -> this agent -> permissions -> Memory.`;

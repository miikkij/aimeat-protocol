/**
 * @file src/services/secret-shares/access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may do what with one secret share, decided in one place for every route and tool:
 *   manage it (read its events, revoke it), pick it up, or fill it (a request). The answer is about
 *   the caller as CallerContext gives it, never about a name from the request body.
 *
 *   A PERSON AND THEIR AGENTS. An agent acts in its owner's name and qualifies through its owner:
 *   the maker's agent manages its owner's share, and a named person's agent picks up only when the
 *   maker allowed agents (`recipients.agents`). Every agent also needs the word secrets:share; the
 *   account holder in person needs no word.
 *
 *   AN ORGANISM'S VAULT. A share that names an organism is managed by its maker and by that
 *   organism's creator and admins. Its members pick it up only when the maker chose
 *   `recipients.organism`.
 * @structure SECRETS_SHARE_SCOPE · ShareRole · shareRolesOf · scopeRefusal
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { Storage } from '../../storage/interface.js';
import type { SecretShareMember, SecretShareRecord } from '../../storage/types/secret-shares.js';
import type { CallerContext } from '../caller-context.js';
import { principalKindOf } from '../caller-facts.js';
import { SECRETS_SHARE_SCOPE } from '../../utils/scope-coverage.js';
import { refuse, type ShareRefusal } from './rules.js';

export { SECRETS_SHARE_SCOPE };

export interface ShareRoles {
  /** Read events, revoke. The maker (and their agents), or the organism's creator and admins. */
  manage: boolean;
  /** May pick it up as a named person, an organism member, or their agent. A code holder is decided at pickup. */
  pickup: boolean;
  /** May fill it: a waiting request naming this person as a depositor. */
  deposit: boolean;
  /** How the pickup right was reached, for the event. */
  via: 'named' | 'organism' | null;
  /** The caller is an agent (or an app), not a person. */
  agent: boolean;
}

/** An agent (or an app grant) without secrets:share is refused; a person in person needs no word. */
export function scopeRefusal(caller: CallerContext): ShareRefusal | null {
  if (caller.has(SECRETS_SHARE_SCOPE)) return null;
  return refuse(403, 'SCOPE_DENIED', `This needs the permission ${SECRETS_SHARE_SCOPE}: making, filling and picking up secret shares in the owner's name. The owner grants it on the Agents page.`);
}

export async function shareRolesOf(
  storage: Storage, caller: CallerContext, share: SecretShareRecord, members: SecretShareMember[],
): Promise<ShareRoles> {
  const agent = principalKindOf(caller.principal) !== 'person' || !caller.isPerson;
  const owner = caller.ownerGhii;
  let manage = share.ownerGhii === owner;
  let organismRole: string | null = null;
  if (share.organismId) {
    const m = await storage.getMembership(share.organismId, caller.owner);
    organismRole = m && m.status === 'active' ? m.role : null;
    if (organismRole === 'creator' || organismRole === 'admin') manage = true;
  }
  const named = members.some(m => m.role === 'pickup' && m.ghii === owner);
  const asMember = share.recipients.organism && organismRole !== null;
  let via: ShareRoles['via'] = named ? 'named' : asMember ? 'organism' : null;
  // An agent picks up only when the maker allowed agents; the maker's own agent does not need it to
  // manage, but it needs it to pick up like anyone else.
  if (agent && !share.recipients.agents) via = null;
  const deposit = share.kind === 'request' && share.status === 'waiting'
    && members.some(m => m.role === 'deposit' && m.ghii === owner);
  return { manage, pickup: via !== null, deposit, via, agent };
}

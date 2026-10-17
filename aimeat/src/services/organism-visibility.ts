/**
 * @file src/services/organism-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `organism:<id>` visibility on memory records and stored files (plan
 *   doc-mvcn6c7e4e5q, V3.2 and V3.3): which stored visibility words a write accepts, the refusal a
 *   writer gets for naming an organism its owner is not an active member of, and the read decision
 *   for such a record. Both decisions are services/audience.ts; this file only adapts a memory or
 *   file write and an access-guard read to it, so no second membership check exists.
 *
 *   A writer names an organism only when the account behind the writer is an active member of it.
 *   The writer may be an agent; the organism's own agent-admission rule decides what that agent
 *   READS, and the write is decided for its owner. A visitor from another node names none.
 * @structure isStoredVisibility · organismVisibilityRefusal · organismVisibilityAdmits
 * @usage
 *   const refused = await organismVisibilityRefusal(storage, input.visibility, { identity: principal, federated });
 *   if (refused) return { ok: false, ...refused };
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.2 + V3.3).
 */
import type { Storage, StoredVisibility } from '../storage/interface.js';
import { parseAudience, isOrganismMember, audienceAllows } from './audience.js';
import { localAccountOf } from '../utils/gaii.js';
import { storedVisibilitySchema } from '../utils/visibility-words.js';

/** True for every value the visibility column of a memory record or a stored file may hold. */
export function isStoredVisibility(value: unknown): value is StoredVisibility {
  return storedVisibilitySchema.safeParse(value).success;
}

/** The refusal a write answers with; nothing is stored when it is returned. */
export interface OrganismVisibilityRefusal {
  status: 400;
  code: 'INVALID_INPUT' | 'NOT_ORGANISM_MEMBER';
  message: string;
}

/**
 * Refuse an `organism:<id>` visibility the writer may not set: a malformed id, an organism that does
 * not exist, or one the writer's account is not an active member of. Null for every other value,
 * which the caller's own validation decides.
 *
 * `identity` is the writer's identity (a GHII or an agent GAII), or the namespace the record lands
 * in, which belongs to the same account.
 */
export async function organismVisibilityRefusal(
  storage: Storage,
  visibility: unknown,
  writer: { identity: string; federated?: boolean },
): Promise<OrganismVisibilityRefusal | null> {
  if (typeof visibility !== 'string' || !visibility.startsWith('organism:')) return null;
  const audience = parseAudience(visibility);
  if (!audience || audience.level !== 'organism' || !audience.organismId) {
    return {
      status: 400, code: 'INVALID_INPUT',
      message: 'visibility "organism:<organism id>" needs the id of an organism you are a member of after the colon.',
    };
  }
  const account = localAccountOf(writer.identity);
  // The account in person: the agent-admission rule is about what an agent reads, and the agent's
  // owner is the one deciding who the record is for.
  const member = account !== null && await isOrganismMember(storage, audience.organismId, {
    sub: account, owner: account, federated: writer.federated === true,
  });
  if (!member) {
    return {
      status: 400, code: 'NOT_ORGANISM_MEMBER',
      message: `Only an active member of an organism can make something visible to it, and this account is not an active member of organism ${audience.organismId}. Nothing was stored.`,
    };
  }
  return null;
}

/**
 * Does an `organism:<id>` visibility admit this reader? `readerIdentity` is the resolved identity of
 * the reader ('anonymous' for nobody signed in), and `federated` marks a visitor from another node.
 * The account is read from the identity, so a visitor's home identity is never taken for the local
 * account that shares its name.
 */
export async function organismVisibilityAdmits(
  storage: Storage,
  visibility: string,
  reader: { identity: string; federated?: boolean; anonymous?: boolean },
): Promise<boolean> {
  const audience = parseAudience(visibility);
  if (!audience || audience.level !== 'organism') return false;
  const anonymous = reader.anonymous === true || reader.identity === 'anonymous' || reader.identity.includes('#anonymous@');
  const owner = localAccountOf(reader.identity) ?? undefined;
  return audienceAllows(storage, audience, {
    sub: reader.identity, owner, anonymous, federated: reader.federated === true || owner === undefined,
  });
}

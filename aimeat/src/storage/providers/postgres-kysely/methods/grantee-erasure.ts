/**
 * @file src/storage/providers/postgres-kysely/methods/grantee-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The other half of ending an identity, for the Postgres backend: the references in
 *   which ANOTHER party named this GAII as the one it grants to.
 *
 *   WHY IT IS A SEPARATE PASS. identity-erasure.ts deletes what the identity OWNS, keyed by an owner
 *   column. Nothing there can see a row that belongs to somebody else and merely NAMES this
 *   identity: a consent granted by another account, an organism's `agentGaiis`, a board's
 *   `allowedGaiis`, a sharing group's member list, `registeredBy` on an agent this one registered.
 *   Those are grants, and a grant must end with the thing it was given to.
 *
 *   WHY IT MATTERS. A GAII is `name#owner@node` and is rebuilt from the name. Agent registration
 *   only asks whether the name is taken right now, so the next agent registered under the deleted
 *   name was handed every one of those grants, and the granting party was never asked (secaudit
 *   2026-10, agent-delete:gaii-keyed-grants-outlive-agent). The project already states this risk for
 *   attaching a name nobody holds (routes/organisms/membership.ts), but it only checked at attach
 *   time, which cannot see an agent deleted afterwards.
 *
 *   EXACT MATCH ONLY. A consent whose recipient is `*`, `ghii:…`, `domain:…` or `node:…` names a
 *   CLASS of accessor, not this agent. That is the grantor's standing decision about anyone who
 *   fits, so it stays; ending one agent must not narrow a grant made to a group.
 *
 *   REVOKED, NOT DELETED, for consents. The row is the GRANTOR's record of a decision they made.
 *   Deleting it would take their record away to clean up somebody else's account; revoking ends the
 *   access (findMatchingConsents reads `status = 'active'`) and leaves them the history.
 * @structure clearGrantsToIdentityDb(db, gaii) → GrantsToIdentityCleared
 * @usage import { clearGrantsToIdentityDb } from './grantee-erasure.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, agent-delete:gaii-keyed-grants-outlive-agent).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { jsonb } from '../helpers.js';
import type { GrantsToIdentityCleared, SharingGroupMember } from '../../../interface.js';

/** A Kysely handle: the root connection or an open transaction. */
type Db = Kysely<DB>;

/**
 * Clear every grant that names `gaii` as its grantee. One identity only: a row that names a
 * different GAII is never touched, so ending one agent leaves every sibling's grants alone.
 */
export async function clearGrantsToIdentityDb(db: Db, gaii: string): Promise<GrantsToIdentityCleared> {
  const now = new Date();

  // Consents granted TO this agent by anybody, including another owner. Revoked rather than deleted:
  // see the file header.
  const consents = await db.updateTable('Consent')
    .set({ status: 'revoked', revokedAt: now })
    .where('recipient', '=', gaii)
    .where('status', '=', 'active')
    .executeTakeFirst();

  // Organisms that admit this agent. memberRoleOf reads `agentGaiis` as 'member' in its own right,
  // and in agentAccess 'listed' mode it is the admit list, so an entry left here is organism
  // membership for whoever next holds the name.
  const organisms = await db.selectFrom('Organism').select(['id', 'agentGaiis'])
    .where(sql<boolean>`${gaii} = ANY("agentGaiis")`).execute();
  for (const o of organisms) {
    await db.updateTable('Organism')
      .set({ agentGaiis: (o.agentGaiis ?? []).filter(g => g !== gaii), updatedAt: now })
      .where('id', '=', o.id).execute();
  }

  // Boards that admit this agent. `allowedGaiis` is the roster of a shared board, which may belong
  // to another owner entirely.
  const boards = await db.selectFrom('Board').select(['boardId', 'allowedGaiis'])
    .where(sql<boolean>`${gaii} = ANY("allowedGaiis")`).execute();
  for (const b of boards) {
    await db.updateTable('Board')
      .set({ allowedGaiis: (b.allowedGaiis ?? []).filter(g => g !== gaii) })
      .where('boardId', '=', b.boardId).execute();
  }

  // Sharing-group members. `members` is JSONB, so the containment operator finds the rows and the
  // member list is rewritten without this identity. A group owned by this identity is deleted by the
  // per-identity cascade instead; this clause is for the groups of OTHER owners.
  const groups = await db.selectFrom('SharingGroup').select(['id', 'members'])
    .where(sql<boolean>`"members" @> ${JSON.stringify([{ identifier: gaii }])}::jsonb`).execute();
  for (const g of groups) {
    const kept = ((g.members ?? []) as unknown as SharingGroupMember[]).filter(m => m.identifier !== gaii);
    await db.updateTable('SharingGroup')
      .set({ members: jsonb(kept) as never, updatedAt: now })
      .where('id', '=', g.id).execute();
  }

  // `registeredBy` on the agents this one registered. It is the fence on agent-initiated deletion
  // (routes/agents/management.ts), so a surviving entry hands the next holder of the name the right
  // to delete this agent's siblings. Cleared to NULL, which that route reads as "not deletable this
  // way at all" — absence is not evidence of parentage.
  const registrations = await db.updateTable('Agent')
    .set({ registeredBy: null })
    .where('registeredBy', '=', gaii)
    .executeTakeFirst();

  return {
    consents: Number(consents.numUpdatedRows ?? 0),
    organisms: organisms.length,
    boards: boards.length,
    sharingGroups: groups.length,
    registrations: Number(registrations.numUpdatedRows ?? 0),
  };
}

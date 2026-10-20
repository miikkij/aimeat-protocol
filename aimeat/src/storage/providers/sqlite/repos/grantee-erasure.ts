/**
 * @file src/storage/providers/sqlite/repos/grantee-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The other half of ending an identity, for the SQLite backend: the references in which
 *   ANOTHER party named this GAII as the one it grants to. The Postgres twin is
 *   clearGrantsToIdentityDb in its methods/grantee-erasure.ts, and that file carries the full
 *   reasoning: the per-identity cascade clears what the identity OWNS, this clears what others gave
 *   it, and a GAII is rebuilt from a name that registration releases for reuse (secaudit 2026-10,
 *   agent-delete:gaii-keyed-grants-outlive-agent).
 *
 *   SYNCHRONOUS, like the per-identity cascade, because deleteAgent calls it inside a better-sqlite3
 *   transaction, which cannot await.
 *
 *   THE LIKE CLAUSE IS A PRE-FILTER, NOT THE TEST. These three columns hold JSON text, so a row is
 *   only a candidate until the parsed list is compared value by value. `%` or `_` inside an identity
 *   would widen the LIKE, never narrow it, so a false candidate costs one parse and a real one can
 *   never be missed.
 * @structure clearGrantsToIdentity(db, gaii) → GrantsToIdentityCleared
 * @usage clearGrantsToIdentity(this.db, gaii);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, agent-delete:gaii-keyed-grants-outlive-agent).
 */
import type Database from 'better-sqlite3';
import type { GrantsToIdentityCleared, SharingGroupMember } from '../../../interface.js';

/**
 * Rows whose JSON column could hold this identity, one named query per table. Three near-identical
 * statements rather than one helper taking the table and column as strings: a query that picks its
 * table while the program runs is one no reader and no scanner can check
 * (`pnpm check:runtime-read-targets`), and a fix about who may reach what is the last place to
 * build an SQL identifier out of a variable.
 */
function organismCandidates(db: Database.Database, gaii: string): { id: string; agentGaiis: string }[] {
  return db.prepare('SELECT id, agentGaiis FROM organisms WHERE agentGaiis LIKE ?')
    .all(`%${gaii}%`) as { id: string; agentGaiis: string }[];
}
function boardCandidates(db: Database.Database, gaii: string): { id: string; allowedGaiis: string }[] {
  return db.prepare('SELECT id, allowedGaiis FROM boards WHERE allowedGaiis LIKE ?')
    .all(`%${gaii}%`) as { id: string; allowedGaiis: string }[];
}
function sharingGroupCandidates(db: Database.Database, gaii: string): { id: string; members: string }[] {
  return db.prepare('SELECT id, members FROM sharing_groups WHERE members LIKE ?')
    .all(`%${gaii}%`) as { id: string; members: string }[];
}

/**
 * Clear every grant that names `gaii` as its grantee. One identity only: a row that names a
 * different GAII is never touched, so ending one agent leaves every sibling's grants alone.
 */
export function clearGrantsToIdentity(db: Database.Database, gaii: string): GrantsToIdentityCleared {
  const now = new Date().toISOString();
  const cleared: GrantsToIdentityCleared = { consents: 0, organisms: 0, boards: 0, sharingGroups: 0, registrations: 0 };

  // Consents granted TO this agent by anybody, including another owner. Revoked rather than deleted:
  // the row is the GRANTOR's record of a decision they made, and findMatchingConsents reads
  // `status = 'active'`, so revoking is what ends the access.
  cleared.consents = db.prepare(
    `UPDATE consents SET status = 'revoked', revokedAt = ? WHERE recipient = ? AND status = 'active'`,
  ).run(now, gaii).changes;

  // Organisms that admit this agent. memberRoleOf reads `agentGaiis` as 'member' in its own right,
  // and in agentAccess 'listed' mode it is the admit list.
  for (const row of organismCandidates(db, gaii)) {
    const listed = JSON.parse(row.agentGaiis) as string[];
    if (!listed.includes(gaii)) continue;
    db.prepare('UPDATE organisms SET agentGaiis = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(listed.filter(g => g !== gaii)), now, row.id);
    cleared.organisms++;
  }

  // Boards that admit this agent. `allowedGaiis` is the roster of a shared board, which may belong
  // to another owner entirely.
  for (const row of boardCandidates(db, gaii)) {
    const listed = JSON.parse(row.allowedGaiis) as string[];
    if (!listed.includes(gaii)) continue;
    db.prepare('UPDATE boards SET allowedGaiis = ? WHERE id = ?')
      .run(JSON.stringify(listed.filter(g => g !== gaii)), row.id);
    cleared.boards++;
  }

  // Sharing-group members. A group owned by this identity is deleted by the per-identity cascade
  // instead; this loop is for the groups of OTHER owners.
  for (const row of sharingGroupCandidates(db, gaii)) {
    const members = JSON.parse(row.members) as SharingGroupMember[];
    const kept = members.filter(m => m.identifier !== gaii);
    if (kept.length === members.length) continue;
    db.prepare('UPDATE sharing_groups SET members = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(kept), now, row.id);
    cleared.sharingGroups++;
  }

  // `registeredBy` on the agents this one registered. It is the fence on agent-initiated deletion
  // (routes/agents/management.ts), so a surviving entry hands the next holder of the name the right
  // to delete this agent's siblings. Cleared to NULL, which that route reads as "not deletable this
  // way at all" — absence is not evidence of parentage.
  cleared.registrations = db.prepare('UPDATE agents SET registeredBy = NULL WHERE registeredBy = ?')
    .run(gaii).changes;

  return cleared;
}

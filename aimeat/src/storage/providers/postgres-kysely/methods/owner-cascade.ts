/**
 * @file src/storage/providers/postgres-kysely/methods/owner-cascade.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner deletion cascade for the Postgres backend, mirroring
 *   {@link ../../sqlite/methods/owner-cascade.js the SQLite one} table for table.
 *
 *   WHY THIS FILE EXISTS. Until 2026-08-11 `deleteOwner` on Postgres cleared five tables (Memory,
 *   Agent, Ghii, Session, Owner) where SQLite cleared forty-one, and both returned true. Postgres is
 *   the production backend, so deleting an account left that person's work, disputes, wallet
 *   transactions, board posts, files, consents, telemetry, OAuth tokens and push subscriptions in
 *   place. A deleted username is released for reuse (decision 2026-08-10), which puts the whole
 *   weight of erasure on this cascade.
 *
 *   WHY NOBODY SAW IT. Two gates were built for exactly this and both missed. The static one
 *   (scripts/check-storage-parity.ts) only inspects columns named ownerGaii/ownerName/buyerOwner/
 *   sellerOwner/agentGaii/flaggedBy, and the wallet ledger's column is `gaii`. The dynamic one
 *   (test/unit/storage-conformance.test.ts) compares both providers, but it passed `databaseUrl` to a
 *   factory whose option is `dbUrl`, and test/ sits outside tsconfig's include, so the wrong key never
 *   failed to compile: the Postgres arm silently reported "unavailable" and the suite compared SQLite
 *   against itself for its whole life.
 *
 *   KEY COLUMNS ARE NOT THE SURROGATE ids. DisputeAudit.disputeId references Dispute.disputeId and
 *   BoardPost/BoardSubscription.boardId references Board.boardId — both business keys, not the `id`
 *   column. AgentTaskEvent.taskId is the exception: it references AgentTask.id. Getting this wrong
 *   deletes nothing and still returns success.
 *
 * @structure
 *   - cascadeDeleteIdentityData(db, gaii) — every owner-scoped table for ONE identity (GHII or GAII)
 *   - deleteOwnerCascade(db, name) — agents + GHIIs through the cascade, then the owner-level tables
 * @usage Called by identityMethods.deleteOwner inside one db.transaction().
 * @version-history
 *   v1.1.0 — 2026-09-04 — Seven tables join the cascade: MemoryVersion, OwnerAgentDefault,
 *     GroupShare, AgentUsageEvent, AgentUsageEventArchive, AgentUsageDaily and (owner-level) EcoAuth.
 *     All seven had sat in security/storage-parity-exemptions.json since 2026-08-10 as "decide", and
 *     each is now asserted row-by-row by test/unit/storage-conformance.test.ts on both providers.
 *   v1.0.0 — 2026-08-11 — Initial: Postgres reaches parity with the SQLite cascade, and the whole
 *     delete runs in one transaction (GAP-001's first half).
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { pseudonymiseTallyWriterDb } from './memory-tally.js';

/** A Kysely handle: the root connection or an open transaction. */
type Db = Kysely<DB>;

/**
 * Delete every owner-scoped row belonging to ONE identity. Called once per agent GAII and once per
 * owner GHII, exactly like the SQLite cascade: owner sessions and app grants both resolve to the
 * GHII, so most of what a person has is written under that identity rather than an agent's.
 */
export async function cascadeDeleteIdentityData(db: Db, gaii: string): Promise<void> {
  // Memory and micro-memory
  await db.deleteFrom('Memory').where('ownerGaii', '=', gaii).execute();

  // The write tally for THIS namespace. A deleted username is released for reuse, so a surviving row
  // would hand the next registrant somebody else's history. Rows where this identity was the WRITER
  // into somebody ELSE'S namespace are deliberately NOT deleted here — they are that owner's record
  // of who touched their data, and removing them would turn their "four hands" into three. Those are
  // pseudonymised instead, by pseudonymiseTallyWriter, called from deleteOwner.
  await db.deleteFrom('MemoryWriteTally').where('ownerGaii', '=', gaii).execute();
  await db.deleteFrom('MemoryFamilyTally').where('ownerGaii', '=', gaii).execute();

  // The archived prior versions of a trackable key. The live row goes above; without this line the
  // value the person last overwrote outlives the value they last wrote, which is the wrong way round.
  // SQLite calls this table memory_history, which is why the parity gate needed a name mapping
  // before it could see either side of it.
  await db.deleteFrom('MemoryVersion').where('ownerGaii', '=', gaii).execute();

  // Actions offered by this identity
  await db.deleteFrom('Action').where('providerGaii', '=', gaii).execute();

  // Work, and the disputes hanging off each work item. DisputeAudit keys on Dispute.disputeId.
  const workRows = await db.selectFrom('Work').select('trackingCode')
    .where(eb => eb.or([eb('providerGaii', '=', gaii), eb('requesterGaii', '=', gaii)])).execute();
  const trackingCodes = workRows.map(w => w.trackingCode);
  if (trackingCodes.length) {
    const disputes = await db.selectFrom('Dispute').select('disputeId')
      .where('trackingCode', 'in', trackingCodes).execute();
    const disputeIds = disputes.map(d => d.disputeId);
    if (disputeIds.length) await db.deleteFrom('DisputeAudit').where('disputeId', 'in', disputeIds).execute();
    await db.deleteFrom('Dispute').where('trackingCode', 'in', trackingCodes).execute();
  }
  await db.deleteFrom('Work')
    .where(eb => eb.or([eb('providerGaii', '=', gaii), eb('requesterGaii', '=', gaii)])).execute();

  // Wallet ledger
  await db.deleteFrom('Transaction').where('gaii', '=', gaii).execute();

  // Boards: posts authored, subscriptions held, then boards owned (with their posts and subscriptions)
  await db.deleteFrom('BoardPost').where('authorGaii', '=', gaii).execute();
  await db.deleteFrom('BoardSubscription').where('gaii', '=', gaii).execute();
  const boards = await db.selectFrom('Board').select('boardId').where('ownerGaii', '=', gaii).execute();
  const boardIds = boards.map(b => b.boardId);
  if (boardIds.length) {
    await db.deleteFrom('BoardPost').where('boardId', 'in', boardIds).execute();
    await db.deleteFrom('BoardSubscription').where('boardId', 'in', boardIds).execute();
  }
  await db.deleteFrom('Board').where('ownerGaii', '=', gaii).execute();

  // Consent and its audit trail
  await db.deleteFrom('ConsentAudit').where('ownerGaii', '=', gaii).execute();
  await db.deleteFrom('Consent').where('ownerGaii', '=', gaii).execute();

  // Files
  await db.deleteFrom('StorageFile').where('ownerGaii', '=', gaii).execute();

  // Moderation flags raised by this identity
  await db.deleteFrom('Flag').where('flaggedBy', '=', gaii).execute();

  // Escrow holds
  await db.deleteFrom('EscrowHold').where('fromGaii', '=', gaii).execute();

  // One-time keys
  await db.deleteFrom('Otk').where('ownerGaii', '=', gaii).execute();

  // OAuth tokens and approvals
  await db.deleteFrom('OAuthRefreshToken').where('gaii', '=', gaii).execute();
  await db.deleteFrom('OAuthApproval').where('gaii', '=', gaii).execute();

  // Tasks and their event log. AgentTaskEvent.taskId references AgentTask.id (the surrogate), unlike
  // the dispute and board relations above.
  const tasks = await db.selectFrom('AgentTask').select('id').where('agentGaii', '=', gaii).execute();
  const taskIds = tasks.map(t => t.id);
  if (taskIds.length) await db.deleteFrom('AgentTaskEvent').where('taskId', 'in', taskIds).execute();
  await db.deleteFrom('AgentTask').where('agentGaii', '=', gaii).execute();

  // Directives, activity, messages, telemetry, webhook log, onboarding
  await db.deleteFrom('AgentDirective').where('agentGaii', '=', gaii).execute();
  await db.deleteFrom('AgentActivity').where('agentGaii', '=', gaii).execute();
  await db.deleteFrom('AgentMessage').where('agentGaii', '=', gaii).execute();
  await db.deleteFrom('TelemetryEvent').where('agentGaii', '=', gaii).execute();
  await db.deleteFrom('WebhookDeliveryLog').where('agentGaii', '=', gaii).execute();
  await db.deleteFrom('AgentOnboarding').where('agentGaii', '=', gaii).execute();

  // The agent rules and budget this identity set for itself.
  await db.deleteFrom('OwnerAgentDefault').where('ownerGaii', '=', gaii).execute();

  // AI usage: the raw events, their archive, and the daily rollup. Two owner columns, and the
  // cascade walks each identity once, so one clause with the same value catches the agent pass and
  // the GHII pass alike. `consumerGhii` is deliberately NOT matched: on a row where somebody else
  // consumed this owner's capability it names the OTHER party, and clearing by it would delete a
  // counterparty's record of what they spent — the same reasoning that pseudonymises the write tally
  // instead of deleting it.
  //
  // Written out three times rather than looped over the names. A loop reads as one idea, but
  // scripts/check-storage-parity.ts greps these files for `deleteFrom('<Table>')` and a table name
  // that only ever exists as a loop variable is invisible to it: the first draft of this block was a
  // loop, the cascade was correct, and the gate reported all three tables as uncleared.
  await db.deleteFrom('AgentUsageEvent')
    .where(eb => eb.or([eb('agentGaii', '=', gaii), eb('ownerGhii', '=', gaii)])).execute();
  await db.deleteFrom('AgentUsageEventArchive')
    .where(eb => eb.or([eb('agentGaii', '=', gaii), eb('ownerGhii', '=', gaii)])).execute();
  await db.deleteFrom('AgentUsageDaily')
    .where(eb => eb.or([eb('agentGaii', '=', gaii), eb('ownerGhii', '=', gaii)])).execute();

  // Sharing groups, and the key-space shares inside them. The shares go first and by two keys: by
  // ownerGaii for this person's own shares, then by the id of each group being removed, because a
  // share whose group is gone grants nothing and would sit there unreadable. GroupShare.groupId
  // references SharingGroup.id, the surrogate, unlike the board and dispute relations above.
  await db.deleteFrom('GroupShare').where('ownerGaii', '=', gaii).execute();
  const groups = await db.selectFrom('SharingGroup').select('id').where('ownerGaii', '=', gaii).execute();
  const groupIds = groups.map(g => g.id);
  if (groupIds.length) await db.deleteFrom('GroupShare').where('groupId', 'in', groupIds).execute();
  await db.deleteFrom('SharingGroup').where('ownerGaii', '=', gaii).execute();
}

/**
 * Delete an owner and everything owner-scoped underneath. Runs every agent GAII and every GHII
 * through {@link cascadeDeleteIdentityData}, then clears the tables keyed by the owner NAME.
 * Returns true when an Owner row was actually removed.
 */
export async function deleteOwnerCascade(db: Db, name: string): Promise<boolean> {
  // Per-identity data: agents first, then the person's own GHIIs.
  const agents = await db.selectFrom('Agent').select('gaii').where('owner', '=', name).execute();
  for (const a of agents) await cascadeDeleteIdentityData(db, a.gaii);
  await db.deleteFrom('Agent').where('owner', '=', name).execute();

  const ghiis = await db.selectFrom('Ghii').select('ghii').where('ownerName', '=', name).execute();
  for (const g of ghiis) await cascadeDeleteIdentityData(db, g.ghii);

  // What this person WROTE into somebody else's namespace is that other owner's record of who
  // touched their data, so it is pseudonymised rather than deleted — removing it would silently turn
  // their "four hands" into three. Runs before the GHII rows go, because the node id comes from one.
  const nodeId = ghiis[0]?.ghii.split('@')[1] ?? '';
  if (nodeId) await pseudonymiseTallyWriterDb(db, name, nodeId);

  await db.deleteFrom('Ghii').where('ownerName', '=', name).execute();

  // Personal nodes carry mailbox items, push subscriptions and notification preferences by node id.
  const nodes = await db.selectFrom('PersonalNode').select('id').where('ownerName', '=', name).execute();
  const nodeIds = nodes.map(n => n.id);
  if (nodeIds.length) {
    await db.deleteFrom('MailboxItem').where('personalNodeId', 'in', nodeIds).execute();
    await db.deleteFrom('PersonalPushSubscription').where('personalNodeId', 'in', nodeIds).execute();
    await db.deleteFrom('NotificationPreference').where('personalNodeId', 'in', nodeIds).execute();
  }
  await db.deleteFrom('PersonalNode').where('ownerName', '=', name).execute();

  // Push subscriptions held directly by the owner
  await db.deleteFrom('PushSubscription').where('ownerName', '=', name).execute();
  await db.deleteFrom('PersonalPushSubscription').where('ownerName', '=', name).execute();

  // Marketplace
  await db.deleteFrom('Listing').where('ownerName', '=', name).execute();
  await db.deleteFrom('Purchase')
    .where(eb => eb.or([eb('buyerOwner', '=', name), eb('sellerOwner', '=', name)])).execute();

  // Chat instances and pending email verifications
  await db.deleteFrom('ChatInstance').where('ownerName', '=', name).execute();
  await db.deleteFrom('EmailVerification').where('ownerName', '=', name).execute();

  // Ecosystem-app device handshakes. Keyed on the bare owner name, like the push subscriptions
  // above, because the handshake happens before the app has an identity of its own. A pending row is
  // a live invitation to bind an app to this account, and the name is released for reuse, so leaving
  // one hands the next registrant somebody else's handshake.
  await db.deleteFrom('EcoAuth').where('ownerName', '=', name).execute();

  // Live sessions: a surviving refresh token for a deleted account is a live credential.
  await db.deleteFrom('Session').where('owner', '=', name).execute();

  const r = await db.deleteFrom('Owner').where('name', '=', name).executeTakeFirst();
  return Number(r.numDeletedRows ?? 0) > 0;
}

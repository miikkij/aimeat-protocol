/**
 * @file src/storage/providers/postgres-kysely/methods/identity-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What goes with one identity, and with the cortexes, ecosystem apps and credentials of an
 *   account, for the Postgres backend. Moved out of owner-cascade.ts, so the start steps and the
 *   operator's decision on a held name (held-names.ts) reach the same functions the account deletion
 *   calls without importing the cascade and, through it, the provider class (an import cycle,
 *   check:deps). owner-cascade.ts exports them again for its callers.
 * @structure
 *   - cascadeDeleteIdentityData(db, gaii) — every owner-scoped table for ONE identity (GHII or GAII)
 *   - deleteInstalledCortexesDb(db, name, ghiis, opts) — the cortexes the account installed, with
 *     what their activation made
 *   - deleteEcosystemAppsDb(db, owner, geais, opts) — the ecosystem apps the account connected, as its
 *     agents go
 *   - deleteAccountCredentialsDb(db, owner, opts) — the app grants, personal access tokens and session
 *     rows issued in the account name
 * @usage import { cascadeDeleteIdentityData } from './identity-erasure.js';
 * @version-history
 *   v1.4.0 — 2026-10-09 — Connection, ConnectionDelegation and ProviderClient join the per-identity
 *     cascade, so deleteAgent takes an agent's outside accounts and its own app clients (secrets
 *     audit 2026-10-09, chapter 2).
 *   v1.3.0 — 2026-09-29 — ClassificationAudit joins the per-identity cascade (TARGET-082 V4).
 *   v1.2.0 — 2026-09-29 — ContentLabel joins the per-identity cascade (TARGET-082).
 *   v1.1.0 — 2026-09-26 — deleteAccountCredentialsDb: what deleteOwnerCascade deleted inline for the
 *     app grants, the personal access tokens and the session rows, with `before` for the operator's
 *     decision on a held name.
 *   v1.0.0 — 2026-09-26 — cascadeDeleteIdentityData and deleteInstalledCortexesDb moved out of
 *     owner-cascade.ts; deleteInstalledCortexesDb takes `names`, for the operator's decision on a
 *     held name. deleteEcosystemAppsDb is what deleteOwnerCascade did for the ecosystem apps inline.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { partyIdentities } from '../../../erased-party.js';
import { erasedCortexParts } from '../../../erased-cortex.js';
import { invalidateSchemaLockCache } from '../../../schema-lock-cache.js';

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
  // pseudonymised instead, by pseudonymiseTallyWriterDb (methods/memory-tally.ts), which the owner
  // cascade (owner-cascade.ts deleteOwnerCascade) calls directly.
  await db.deleteFrom('MemoryWriteTally').where('ownerGaii', '=', gaii).execute();
  await db.deleteFrom('MemoryFamilyTally').where('ownerGaii', '=', gaii).execute();

  // The archived prior versions of a trackable key. The live row goes above; without this line the
  // value the person last overwrote outlives the value they last wrote, which is the wrong way round.
  // SQLite calls this table memory_history, which is why the parity gate needed a name mapping
  // before it could see either side of it.
  await db.deleteFrom('MemoryVersion').where('ownerGaii', '=', gaii).execute();

  // Actions offered by this identity
  await db.deleteFrom('Action').where('providerGaii', '=', gaii).execute();

  // Work is not deleted here. Both callers settle it first, by one rule (settleLeavingPartyWorkDb in
  // work-ledger-erasure.ts): open work is cancelled and what was held for it goes back, finished work
  // stays for the other side. After deleteOwnerCascade no row names this identity any more; after
  // deleteAgent the rows that stay keep the agent's identity, and deleting them here would take the
  // other side's records.

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
  // What an AI decided on this person's behalf (TARGET-080). Theirs, so it goes with them.
  await db.deleteFrom('AiDecision')
    .where(eb => eb.or([eb('ownerGhii', '=', gaii), eb('principal', '=', gaii)])).execute();
  // The classification labels on this person's own content (TARGET-082). Labels on organism
  // content carry no ownerGaii and go with the organism.
  await db.deleteFrom('ContentLabel').where('ownerGaii', '=', gaii).execute();
  // The classification audit log of this person's own content (TARGET-082 V4). Rows in which they
  // were only the reader of someone else's content are that person's record and stay.
  await db.deleteFrom('ClassificationAudit').where('ownerGaii', '=', gaii).execute();

  // Sharing groups, and the key-space shares inside them. The shares go first and by two keys: by
  // ownerGaii for this person's own shares, then by the id of each group being removed, because a
  // share whose group is gone grants nothing and would sit there unreadable. GroupShare.groupId
  // references SharingGroup.id, the surrogate, unlike the board and dispute relations above.
  await db.deleteFrom('GroupShare').where('ownerGaii', '=', gaii).execute();
  const groups = await db.selectFrom('SharingGroup').select('id').where('ownerGaii', '=', gaii).execute();
  const groupIds = groups.map(g => g.id);
  if (groupIds.length) await db.deleteFrom('GroupShare').where('groupId', 'in', groupIds).execute();
  await db.deleteFrom('SharingGroup').where('ownerGaii', '=', gaii).execute();

  // The secrets vault. A row here is a LIVE credential to somebody else's service, and a deleted
  // username is released for reuse — so a surviving row would hand the next person to register that
  // name a working key to the previous person's accounts. The same argument the Connection rows
  // carry, one step sharper: nothing about this row identifies whose key it is.
  await db.deleteFrom('Secret').where('ownerGaii', '=', gaii).execute();

  // Outside accounts this identity connected, the delegations over them, and the app registrations
  // it brought. An agent's are stored under its own GAII, and a new agent made with the same name
  // gets the same GAII, so a surviving row handed the newcomer the old mailbox (secrets audit
  // 2026-10-09, chapter 2). Delegations first: they key on connectionId with no foreign key.
  await db.deleteFrom('ConnectionDelegation')
    .where('connectionId', 'in', db.selectFrom('Connection').select('id').where('principal', '=', gaii))
    .execute();
  await db.deleteFrom('Connection').where('principal', '=', gaii).execute();
  await db.deleteFrom('ProviderClient').where('principal', '=', gaii).execute();
}

/**
 * Take the cortexes an erased account installed off the node, with what their activation made.
 *
 * The rule and its reasons are in ../../../erased-cortex.ts, and the SQLite twin is
 * deleteInstalledCortexes in ../../sqlite/repos/cortex-erasure.ts. It runs after the per-identity
 * passes, so what sat under the person's GHII and agents is gone already. What is left is found by
 * the record: the actions under the identity it names; and, where one of the person's principals
 * wrote them (the bare name, or `…#name@node`, an ecosystem app of theirs included), the schema
 * locks, the boards with their posts and subscriptions, and the prompt, ontology and seed records.
 * Then the lib files, the kept versions, the dependency edges and the records go.
 *
 * `names` limits it to those cortexes: the ones older than the account that holds the name now,
 * when the operator decides they were a previous holder's.
 *
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes.
 */
export async function deleteInstalledCortexesDb(
  db: Db, name: string, ghiis: string[], opts: { names?: string[] } = {},
): Promise<number> {
  if (opts.names && opts.names.length === 0) return 0;
  const rows = await db.selectFrom('CortexExtension').select(['name', 'activationArtifacts'])
    .where('installedBy', '=', name)
    .$if(opts.names !== undefined, qb => qb.where('name', 'in', opts.names as string[]))
    .execute();
  if (rows.length === 0) return 0;
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  let locks = 0;
  for (const row of rows) {
    const parts = erasedCortexParts(row.activationArtifacts);
    if (parts.actionIds.length) {
      // Action.actionId is the business key; `id` is the surrogate.
      await db.deleteFrom('Action').where('actionId', 'in', parts.actionIds)
        .where(eb => eb.or([
          ...(parts.actionProvider ? [eb('providerGaii', '=', parts.actionProvider)] : []),
          eb('providerGaii', 'in', exact), ...suffixPatterns.map(p => eb('providerGaii', 'like', p)),
        ])).execute();
    }
    if (parts.schemaKeys.length) {
      const r = await db.deleteFrom('SchemaLock').where('keyPattern', 'in', parts.schemaKeys)
        .where(eb => eb.or([eb('lockedBy', 'in', exact), ...suffixPatterns.map(p => eb('lockedBy', 'like', p))]))
        .executeTakeFirst();
      locks += Number(r.numDeletedRows ?? 0);
    }
    if (parts.boardIds.length) {
      const boards = await db.selectFrom('Board').select('boardId').where('boardId', 'in', parts.boardIds)
        .where(eb => eb.or([eb('ownerGaii', 'in', exact), ...suffixPatterns.map(p => eb('ownerGaii', 'like', p))]))
        .execute();
      const boardIds = boards.map(b => b.boardId);
      if (boardIds.length) {
        await db.deleteFrom('BoardPost').where('boardId', 'in', boardIds).execute();
        await db.deleteFrom('BoardSubscription').where('boardId', 'in', boardIds).execute();
        await db.deleteFrom('Board').where('boardId', 'in', boardIds).execute();
      }
    }
    if (parts.memoryKeys.length) {
      await db.deleteFrom('Memory').where('key', 'in', parts.memoryKeys)
        .where(eb => eb.or([eb('ownerGaii', 'in', exact), ...suffixPatterns.map(p => eb('ownerGaii', 'like', p))]))
        .execute();
    }
  }
  const names = rows.map(r => r.name);
  await db.deleteFrom('CortexLibFile').where('extName', 'in', names).execute();
  await db.deleteFrom('ComponentVersion').where('kind', '=', 'cortex').where('name', 'in', names).execute();
  await db.deleteFrom('DependencyEdge').where('fromKind', '=', 'cortex').where('fromRef', 'in', names).execute();
  await db.deleteFrom('CortexExtension').where('installedBy', '=', name).where('name', 'in', names).execute();
  // Every memory write reads the schema locks from a process cache, which a delete refreshes. Its
  // short lifetime covers a write that reloads it before this transaction commits.
  if (locks > 0) invalidateSchemaLockCache();
  return rows.length;
}

/**
 * The ecosystem apps an account connected go as its agents go: what each one holds under its own
 * identity (`eco:<app>#<owner>@<node>`), then its record with the key pinned at its first connection,
 * then the automation recipes set for it. Every credential of an app stops with its record
 * (auth/middleware.ts ecosystemAppGone). The work and the ledger lines that name an app are settled
 * by the caller, beside the account's.
 *
 * `everyRecipe` deletes every recipe of the owner, apps never connected included, as the account
 * deletion does; without it only the recipes of these apps go. Returns the number of records deleted.
 */
export async function deleteEcosystemAppsDb(
  db: Db, owner: string, geais: string[], opts: { everyRecipe?: boolean } = {},
): Promise<number> {
  if (geais.length === 0 && !opts.everyRecipe) return 0;
  const apps = geais.length
    ? await db.selectFrom('EcosystemApp').select(['geai', 'app']).where('owner', '=', owner).where('geai', 'in', geais).execute()
    : [];
  for (const a of apps) await cascadeDeleteIdentityData(db, a.geai);
  if (apps.length) await db.deleteFrom('EcosystemApp').where('owner', '=', owner).where('geai', 'in', apps.map(a => a.geai)).execute();
  if (opts.everyRecipe) await db.deleteFrom('EcoAutomationRecipe').where('owner', '=', owner).execute();
  else if (apps.length) await db.deleteFrom('EcoAutomationRecipe').where('owner', '=', owner).where('app', 'in', apps.map(a => a.app)).execute();
  return apps.length;
}

/**
 * The credentials issued in an account name: the app grants the person gave, the personal access
 * tokens they made and, with `sessions`, the session rows, revoked ones included. Each is issued in a
 * name that is released for reuse, so it goes with the account, and the next holder of the name starts
 * with none. The account deletion (owner-cascade.ts deleteOwnerCascade), the start step for credentials
 * and the operator's decision on a held name (held-names.ts) call this one function.
 *
 * `before` limits it to the grants and tokens whose createdAt is before that time: the ones older than
 * the account that holds the name now, when the operator decides they were a previous holder's.
 * Returns what it deleted.
 */
export async function deleteAccountCredentialsDb(
  db: Db, owner: string, opts: { before?: Date; sessions?: boolean } = {},
): Promise<{ appGrants: number; accessTokens: number; sessions: number }> {
  const before = opts.before;
  const grants = await db.deleteFrom('AppGrant').where('owner', '=', owner)
    .$if(before !== undefined, qb => qb.where('createdAt', '<', before as Date))
    .executeTakeFirst();
  const tokens = await db.deleteFrom('PersonalAccessToken').where('owner', '=', owner)
    .$if(before !== undefined, qb => qb.where('createdAt', '<', before as Date))
    .executeTakeFirst();
  const sessions = opts.sessions
    ? await db.deleteFrom('Session').where('owner', '=', owner).executeTakeFirst()
    : null;
  return {
    appGrants: Number(grants.numDeletedRows ?? 0),
    accessTokens: Number(tokens.numDeletedRows ?? 0),
    sessions: Number(sessions?.numDeletedRows ?? 0),
  };
}

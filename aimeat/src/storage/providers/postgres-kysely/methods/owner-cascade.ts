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
 *   - pseudonymisePurchasePartiesDb(db, name, ghiis, pseudonym) — the kept receipts, without the name
 *   - pseudonymiseProvenanceOwnerDb(db, name, ghiis, pseudonym) — the kept AI provenance, without it
 *   - pseudonymiseLedgerPartyDb, settleLeavingPartyWorkDb, settleErasedPartyWorkDb,
 *     settleDeletedAgentWorkDb — the work and ledger rule, in work-ledger-erasure.ts, exported again here
 *   - cascadeDeleteIdentityData, deleteInstalledCortexesDb, deleteEcosystemAppsDb,
 *     deleteAccountCredentialsDb — what goes with one identity, and the account's cortexes, ecosystem
 *     apps and credentials, in identity-erasure.ts, exported again here
 *   - deleteOwnerCascade(db, name) — agents + GHIIs through the cascade, then the owner-level tables
 * @usage Called by identityMethods.deleteOwner inside one db.transaction().
 * @version-history
 *   v1.17.0 — 2026-10-10 — deleteOwnerCascade deletes the OTK rows stored under the bare account name
 *     (secaudit 2026-10-10 C0).
 *   v1.16.0 — 2026-10-05 — deleteOwner gives the classification audit rows where the person was the
 *     reader of somebody else's content the erasure's pseudonym (secaudit 2026-10, STO-1).
 *   v1.15.0 — 2026-09-26 — The app grants, the personal access tokens and the sessions go through
 *     identity-erasure.ts deleteAccountCredentialsDb, which the start step and the operator's decision
 *     on a held name call too. Exported again here.
 *   v1.14.0 — 2026-09-26 — deleteOwnerCascade deletes the app grants and the personal access tokens
 *     issued in the account name (AppGrant, PersonalAccessToken).
 *   v1.13.0 — 2026-09-26 — cascadeDeleteIdentityData and deleteInstalledCortexesDb move to
 *     identity-erasure.ts, and the ecosystem apps go through deleteEcosystemAppsDb there, so the start
 *     step and the operator's decision on a held name call the same functions. Exported again here.
 *   v1.12.0 — 2026-09-26 — deleteOwnerCascade takes the ecosystem apps the person connected, as it
 *     takes the agents: each app's identity data, its record with the pinned key, and the automation
 *     recipes set for it. The apps' identities are named to the work settlement and the ledger rule
 *     beside the agents'.
 *   v1.11.0 — 2026-09-26 — The work and ledger functions move to work-ledger-erasure.ts, and are
 *     exported again from here, so the operator's decision on a held name (methods/held-names.ts)
 *     reaches them without importing this cascade. settleLeavingPartyWorkDb takes
 *     `onlyToAccountsThen` and pseudonymiseLedgerPartyDb takes `before`, for that decision.
 *   v1.10.0 — 2026-09-26 — deleteOwnerCascade deletes the person's own ledger lines filed under the
 *     bare account name (the ones written before 2026-08-16).
 *   v1.9.0 — 2026-09-26 — deleteInstalledCortexesDb: deleteOwnerCascade takes the cortexes the person
 *     installed, after the actions under their own identities: each record, the actions under the
 *     identity it names, the schema locks, boards and prompt, ontology and seed records one of the
 *     person's principals wrote, and the lib files, kept versions and dependency edges keyed by its
 *     name (secaudit 2026-09, R4 "found": the cortex record).
 *   v1.8.0 — 2026-09-26 — pseudonymiseLedgerPartyDb: deleteOwnerCascade writes the erasure's
 *     pseudonym in place of the person on the ledger lines of other people that name them, as
 *     counterparty or as the one who acted. The lines stay for those people's books.
 *   v1.7.0 — 2026-09-26 — One work rule for any party that leaves (LeavingParty in erased-party.ts):
 *     identityMethods.deleteAgent settles the agent's work with it, keeping the agent's identity on
 *     what stays, and the erasure finds its agents' work by their GAII too. Work leaves the
 *     per-identity cascade, since both callers settle it first.
 *   v1.6.0 — 2026-09-26 — settleErasedPartyWorkDb runs first in deleteOwnerCascade: open work is
 *     cancelled and the requester's held morsels go back with a ledger line, finished work and its
 *     dispute stay for the other side under the erasure's pseudonym (secaudit 2026-09: A8-4, N6).
 *   v1.5.0 — 2026-09-26 — deleteOwnerCascade deletes the actions the owner published in person, stored
 *     under the bare account name, and pseudonymiseProvenanceOwnerDb rewrites the owner and principal
 *     of the kept AI provenance records to the erasure's pseudonym. A freed name inherits neither
 *     (secaudit 2026-09: A8-4, N6).
 *   v1.4.0 — 2026-09-24 — pseudonymisePurchasePartiesDb: the purchase receipts an erased person is a
 *     party to are kept for the other side's books and rewritten to a pseudonym no account can hold
 *     (audit A8-4). deleteOwnerCascade calls it.
 *   v1.3.0 — 2026-09-19 — AiDecision joins the cascade (TARGET-080).
 *   v1.2.1 — 2026-09-09 — The tally comment names the function this cascade actually calls
 *     (pseudonymiseTallyWriterDb); the Storage method it named was deleted for having no caller.
 *   v1.2.0 — 2026-09-06 — Secret joins the cascade. A row there is a live credential to somebody
 *     else's service, held under a username that is released for reuse.
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
import { erasedPartyPseudonym, partyIdentities, erasedAccountParty } from '../../../erased-party.js';
import { pseudonymiseLedgerPartyDb, settleErasedPartyWorkDb } from './work-ledger-erasure.js';
import {
  cascadeDeleteIdentityData, deleteInstalledCortexesDb, deleteEcosystemAppsDb, deleteAccountCredentialsDb,
} from './identity-erasure.js';

export {
  pseudonymiseLedgerPartyDb, settleLeavingPartyWorkDb, settleErasedPartyWorkDb, settleDeletedAgentWorkDb,
} from './work-ledger-erasure.js';
export {
  cascadeDeleteIdentityData, deleteInstalledCortexesDb, deleteEcosystemAppsDb, deleteAccountCredentialsDb,
} from './identity-erasure.js';

/** A Kysely handle: the root connection or an open transaction. */
type Db = Kysely<DB>;

/**
 * Rewrite an erased person out of every purchase receipt they are a party to, and keep the receipts.
 *
 * A receipt is also the OTHER side's record, so it outlives the account (the "AppPurchase" entry in
 * security/storage-parity-exemptions.json). But a deleted username is released for reuse, and every
 * purchase read, the licence check and the sales list key on `name@node`. So a receipt that kept the
 * name handed the next registrant of that name the receipts, the paid content in them and a valid
 * licence. Each side is rewritten when its own account goes. The amounts, the dates, the app and the
 * other party stay for the books.
 *
 * The node's signature goes too. It was made over the erased identity, and every other field it
 * covered is still in the row, so keeping it would let anyone who holds the row confirm a guessed
 * name. An empty signature is what an unsigned receipt already carries.
 *
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes. Written
 * out twice rather than looped over the two sides, so each statement names its own columns.
 */
export async function pseudonymisePurchasePartiesDb(
  db: Db, name: string, ghiis: string[], pseudonym: string,
): Promise<number> {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const buyer = await db.updateTable('AppPurchase')
    .set({ buyerGaii: pseudonym, buyerOwner: pseudonym, signature: '' })
    .where(eb => eb.or([eb('buyerGaii', 'in', exact), ...suffixPatterns.map(p => eb('buyerGaii', 'like', p))]))
    .executeTakeFirst();
  const seller = await db.updateTable('AppPurchase')
    .set({ sellerGaii: pseudonym, sellerOwner: pseudonym, signature: '' })
    .where(eb => eb.or([eb('sellerGaii', 'in', exact), ...suffixPatterns.map(p => eb('sellerGaii', 'like', p))]))
    .executeTakeFirst();
  return Number(buyer?.numUpdatedRows ?? 0) + Number(seller?.numUpdatedRows ?? 0);
}

/**
 * Take an erased person out of the two columns that say whose AI provenance record it is, and keep
 * the record.
 *
 * A record outlives the account, because it answers "which model made these bytes" for content that
 * can outlive it (the "AiProvenance" entry in security/storage-parity-exemptions.json). But the
 * owner's list, the owner view, the owner's hash lookup and attaching a record to new content all
 * key on `ownerGhii`, and a deleted username is released for reuse. So a record that kept
 * `name@node` there belonged to whoever registered the name next. `ownerGhii` and `principal` become
 * the erasure's pseudonym. The statement itself (`record`) stays as it was: it is what the readers of
 * the content are owed, and no read decides access on it.
 *
 * `principal` can be the person's GHII, an agent or app acting for them (`…#name@node`), or the bare
 * name an owner session once stored, so it is matched the way the purchase receipts match a party.
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes.
 */
export async function pseudonymiseProvenanceOwnerDb(
  db: Db, name: string, ghiis: string[], pseudonym: string,
): Promise<number> {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const r = await db.updateTable('AiProvenance')
    .set({ ownerGhii: pseudonym, principal: pseudonym })
    .where(eb => eb.or([
      eb('ownerGhii', 'in', exact),
      eb('principal', 'in', exact),
      ...suffixPatterns.map(p => eb('principal', 'like', p)),
    ]))
    .executeTakeFirst();
  return Number(r?.numUpdatedRows ?? 0);
}

/**
 * Delete an owner and everything owner-scoped underneath. Runs every agent GAII and every GHII
 * through {@link cascadeDeleteIdentityData}, then clears the tables keyed by the owner NAME.
 * Returns true when an Owner row was actually removed.
 */
export async function deleteOwnerCascade(db: Db, name: string): Promise<boolean> {
  // The work this person is a party to, settled before the per-identity passes below delete what
  // they find: open work is cancelled and the requester's held morsels go back, finished work stays
  // for the other side under the erasure's pseudonym. One pseudonym for the whole erasure, so the
  // other side's books still see one party. The agents are named too, for an account whose agents
  // no GHII pattern would find.
  const ghiis = await db.selectFrom('Ghii').select('ghii').where('ownerName', '=', name).execute();
  const agents = await db.selectFrom('Agent').select('gaii').where('owner', '=', name).execute();
  // The ecosystem apps the person connected act for them under `eco:<app>#<name>@<node>`, as agents do.
  const ecoApps = await db.selectFrom('EcosystemApp').select('geai').where('owner', '=', name).execute();
  const actors = [...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  const pseudonym = erasedPartyPseudonym();
  await settleErasedPartyWorkDb(db, name, ghiis.map(g => g.ghii), pseudonym, actors);
  // The classification audit of OTHER people's content, where this person was the reader: the row is
  // the content owner's record and stays, under the erasure's pseudonym (secaudit 2026-10, STO-1).
  // One value per identity, so two of them cannot meet on the audit's unique address.
  const readers = [...ghiis.map(g => g.ghii), ...actors];
  for (let i = 0; i < readers.length; i++) {
    await db.updateTable('ClassificationAudit').set({ reader: i ? `${pseudonym}.${i}` : pseudonym }).where('reader', '=', readers[i]!).execute();
  }

  // Per-identity data: agents first, then the ecosystem apps, then the person's own GHIIs.
  for (const a of agents) await cascadeDeleteIdentityData(db, a.gaii);
  await db.deleteFrom('Agent').where('owner', '=', name).execute();

  // An ecosystem app goes as an agent does: what it holds, then its record with the key pinned at its
  // first connection, and the automation recipes the person set for it. Every credential of the app
  // stops with its record (auth/middleware.ts ecosystemAppGone).
  await deleteEcosystemAppsDb(db, name, ecoApps.map(e => e.geai), { everyRecipe: true });

  for (const g of ghiis) await cascadeDeleteIdentityData(db, g.ghii);

  // An action the owner published in person. It is stored under the bare account name (the owner
  // session's raw `sub`), which neither pass above walks, and the name is released for reuse, so the
  // next holder of the name could change or delete it.
  await db.deleteFrom('Action').where('providerGaii', '=', name).execute();
  // The person's own ledger lines from before 2026-08-16, which were filed under the bare account
  // name. They are theirs, so they go with the account, like the lines under the GHII.
  await db.deleteFrom('Transaction').where('gaii', '=', name).execute();
  // Connectivity keys minted before 2026-10-10, stored under the bare account name (the owner
  // session's raw `sub`). The per-identity pass above deletes the ones under the GHII. A key that
  // survived here was redeemed by POST /v1/agents/connect into an agent under whoever registered the
  // name next (secaudit 2026-10-10 C0).
  await db.deleteFrom('Otk').where('ownerGaii', '=', name).execute();

  // The cortexes this person installed, now that the actions under their own identities are gone:
  // each record, with what its activation made and what is keyed by its name (../../../erased-cortex.ts).
  await deleteInstalledCortexesDb(db, name, ghiis.map(g => g.ghii));

  // What this person WROTE into somebody else's namespace is that other owner's record of who
  // touched their data, so it is pseudonymised rather than deleted — removing it would silently turn
  // their "four hands" into three. Runs before the GHII rows go, because the node id comes from one.
  const nodeId = ghiis[0]?.ghii.split('@')[1] ?? '';
  if (nodeId) await pseudonymiseTallyWriterDb(db, name, nodeId);

  // The purchase receipts this person is a party to stay, because each one is also the other side's
  // book entry. The name leaves them: it is released for reuse, and every purchase read keys on it.
  // The pseudonym is the one the work above took.
  await pseudonymisePurchasePartiesDb(db, name, ghiis.map(g => g.ghii), pseudonym);
  // The AI provenance records stay too, for the content that outlives the account. The name leaves
  // the two columns every owner read keys on, under the same pseudonym.
  await pseudonymiseProvenanceOwnerDb(db, name, ghiis.map(g => g.ghii), pseudonym);
  // So do the other side's ledger lines: the person's own went with the passes above, and the lines
  // in other people's ledgers name them by the same pseudonym.
  await pseudonymiseLedgerPartyDb(db, erasedAccountParty(name, ghiis.map(g => g.ghii), pseudonym, actors));

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

  // The apps the person granted access to, the personal access tokens they made and the sessions.
  // They are credentials issued in the account name, which is released for reuse, so they go with the
  // account and the next holder of the name starts with none. identity-erasure.ts
  // deleteAccountCredentialsDb, which the start step and the operator's decision call too.
  await deleteAccountCredentialsDb(db, name, { sessions: true });

  const r = await db.deleteFrom('Owner').where('name', '=', name).executeTakeFirst();
  return Number(r.numDeletedRows ?? 0) > 0;
}

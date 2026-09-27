/**
 * @file erased-party.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an erased account leaves in its place on a record that has to outlive it. Both
 *   storage providers call this from their owner cascade, so the rule cannot drift between them.
 *
 *   WHY SUCH A RECORD OUTLIVES ITS OWNER. A purchase receipt belongs to two people: it is the
 *   buyer's proof of what they paid for and the seller's book entry. Deleting it with either account
 *   would take it away from the other one, so it stays (security/storage-parity-exemptions.json,
 *   "AppPurchase").
 *
 *   An AI provenance record outlives its owner for a like reason: it answers "which model made these
 *   bytes" for content that can outlive the account ("AiProvenance" in the same file).
 *
 *   Work between two accounts is the same kind of record. Finished work is the other side's book
 *   entry, so it stays. Open work cannot go on without the erased side: it is cancelled, and when the
 *   erased person was the one to do it, the morsels held from the requester go back to the requester.
 *   When the erased person asked for it, the morsels held were their own, and they go with the
 *   account.
 *
 *   A line in somebody else's ledger is the same kind of record: it is that person's book entry for
 *   money that moved between them and the erased person, so it stays, with the erased person named by
 *   the same pseudonym as counterparty, and as the one who acted where they did. The erased person's
 *   own lines go with the account.
 *
 *   WHY THE NAME CANNOT STAY IN IT. A deleted username is released for reuse (decision 2026-08-10),
 *   and every purchase read keys on `name@node`. A receipt that kept the name therefore belonged to
 *   whoever registered that name next: the receipts, the paid content in them and a valid licence.
 *   The owner's reads of a provenance record key on its `ownerGhii` in the same way, so a kept record
 *   takes the same pseudonym there and in `principal`, and its statement stays as it was.
 *
 *   WHY A RANDOM TOKEN AND NOT A HASH OF THE NAME. A hash of the name gives the same value for the
 *   next person who holds that name, and anyone who guesses a name can compute it. A random token is
 *   linked to nothing, so nobody can compute it again and no account can equal it. It is drawn once
 *   per erasure, so one person's rows still read as one party in somebody else's books.
 * @structure
 *   - ERASED_PARTY_PREFIX: what every pseudonym starts with
 *   - erasedPartyPseudonym(): one fresh pseudonym, for one erasure
 *   - partyIdentities(name, ghiis): every value a receipt may name this person by
 *   - isPartyIdentity(identity, name, ghiis): the same identities, as a test on one value
 *   - OPEN_WORK_STATUSES: the work statuses an erasure cancels
 *   - LeavingParty, erasedAccountParty(), deletedAgentParty(), leavingAppsParty(): who leaves the
 *     work, and what stays
 * @usage
 *   import { erasedPartyPseudonym, partyIdentities } from '../../../erased-party.js';
 *   const { exact, suffixPatterns } = partyIdentities(name, ghiis);
 * @version-history
 *   v1.5.0 — 2026-09-26 — leavingAppsParty: ecosystem apps that leave without their account (a deleted
 *     account's, or a previous holder's of a name somebody holds now), for the start step and the
 *     operator's decision on a held name.
 *   v1.4.0 — 2026-09-26 — The other side's ledger lines take the same pseudonym in both cascades
 *     (sqlite repos/ledger-erasure.ts, postgres pseudonymiseLedgerPartyDb). No change to the rule.
 *   v1.3.0 — 2026-09-26 — LeavingParty: the work rule serves a deleted agent too. Its owner is still
 *     here, so its held morsels go back to the owner and the rows keep its identity as stored.
 *   v1.2.0 — 2026-09-26 — Work: open requests are cancelled and the requester's held morsels go back,
 *     finished work stays under the pseudonym (isPartyIdentity, OPEN_WORK_STATUSES; secaudit 2026-09:
 *     A8-4, N6).
 *   v1.1.0 — 2026-09-26 — The AI provenance records an erased person owns take the same pseudonym, in
 *     both cascades (secaudit 2026-09: A8-4). No change to the rule itself.
 *   v1.0.0 — 2026-09-24 — Initial: the purchase receipts an erased buyer or seller is a party to
 *     (audit A8-4).
 */
import { randomBytes } from 'node:crypto';

/**
 * No account can be named with this. An owner name is `[a-z0-9-]` and every coordinate a read keys
 * on carries an `@`, so this prefix followed by hex digits equals no name, no GHII, no GAII and no
 * visitor from another node.
 */
export const ERASED_PARTY_PREFIX = 'erased:';

/** A fresh pseudonym. Draw ONE per erasure and write it on every row, so the books stay linkable. */
export function erasedPartyPseudonym(): string {
  return `${ERASED_PARTY_PREFIX}${randomBytes(12).toString('hex')}`;
}

/** LIKE has its own wildcards. A stored identity must match itself and nothing wider. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

/**
 * Every value a receipt's party column may hold for this person, in two lists.
 *
 * `exact`: each GHII (`name@node`), which is what every receipt since 2026-08-23 stores, and the bare
 * name, which is what an owner session stored before that date (its raw `sub`).
 *
 * `suffixPatterns`: LIKE patterns, escaped with a backslash, for `<anything>#name@node`. That is an
 * agent or an ecosystem app acting for this person, which is what those principals stored before
 * the same date. A pattern also reaches an agent that was deleted before the account was, which a
 * list read from the agents table would miss.
 *
 * Deliberately NOT the `buyerOwner`/`sellerOwner` column. A visitor from another node carries only
 * the local part of their name there, so an erasure matched on it would rewrite a namesake's
 * receipt and end their licence. The coordinate columns carry the node, so they cannot mix the two.
 */
export function partyIdentities(name: string, ghiis: string[]): { exact: string[]; suffixPatterns: string[] } {
  return {
    exact: [...new Set([name, ...ghiis])],
    suffixPatterns: [...new Set(ghiis)].map(g => `%#${escapeLike(g)}`),
  };
}

/**
 * The identities partyIdentities lists, as a test on one value. For code that has read a row and has
 * to say which of its two sides is the erased person.
 */
export function isPartyIdentity(identity: string, name: string, ghiis: string[]): boolean {
  return identity === name || ghiis.some(g => identity === g || identity.endsWith(`#${g}`));
}

/**
 * The statuses in which work is still open: the provider has not delivered, and what the requester
 * was charged is held for it. Every other status is finished work: delivered, rated, settled,
 * cancelled, or a dispute that follows a delivery.
 */
export const OPEN_WORK_STATUSES: readonly string[] = ['pending', 'accepted', 'in_progress'];

/**
 * A party leaving the work, and what the rows that stay keep of it. One rule for the three ways a
 * party leaves: an account deleted with everything under it, one agent its owner deletes, and
 * ecosystem apps that leave without their account. Both providers settle the work from this (sqlite
 * repos/work-erasure.ts, postgres work-ledger-erasure.ts).
 */
export interface LeavingParty {
  /** The values a row's party column may hold for it: exact values, and LIKE suffix patterns. */
  exact: string[];
  suffixPatterns: string[];
  /** The same test on one value. */
  is(identity: string): boolean;
  /**
   * What the leaving side becomes on a row that stays: the erasure's pseudonym, or null to keep the
   * identity as stored. A deleted agent keeps it, because its owner is still here. A pseudonym also
   * replaces the name in a dispute on the row, and a leaving requester's callback address goes.
   */
  pseudonym: string | null;
  /**
   * Whether the morsels held for a request the leaving party made go back to it. An agent's go back
   * to its owner's balance. A deleted account's balance goes with the account.
   */
  refundsItself: boolean;
}

/**
 * A deleted account: every identity it can be named by, and the agents it had, which is how their
 * work is found when the account has no GHII row to build the patterns from.
 */
export function erasedAccountParty(name: string, ghiis: string[], pseudonym: string, agents: string[] = []): LeavingParty {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  return {
    exact: [...new Set([...exact, ...agents])], suffixPatterns,
    is: id => isPartyIdentity(id, name, ghiis) || agents.includes(id),
    pseudonym, refundsItself: false,
  };
}

/** One agent its owner deletes: named by its GAII alone, and kept as stored. */
export function deletedAgentParty(gaii: string): LeavingParty {
  return { exact: [gaii], suffixPatterns: [], is: id => id === gaii, pseudonym: null, refundsItself: true };
}

/**
 * Ecosystem apps that leave without their account: a deleted account's, or a previous holder's of a
 * name somebody holds now. Named by their GEAIs alone, so nothing of the account that holds the name
 * matches, and rewritten to the erasure's pseudonym on what stays. What was held for a request an app
 * made goes back to the account it spent from, and the caller gives it back only to an account that
 * existed when the row was written: an app of a previous holder spent that holder's morsels before
 * the name was taken again, and the holder's after.
 */
export function leavingAppsParty(geais: string[], pseudonym: string): LeavingParty {
  const exact = [...new Set(geais)];
  return { exact, suffixPatterns: [], is: id => exact.includes(id), pseudonym, refundsItself: true };
}

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
 * @usage
 *   import { erasedPartyPseudonym, partyIdentities } from '../../../erased-party.js';
 *   const { exact, suffixPatterns } = partyIdentities(name, ghiis);
 * @version-history
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

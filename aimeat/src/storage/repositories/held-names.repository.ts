/**
 * @file src/storage/repositories/held-names.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for what the move to the full identity left for the operator:
 *   the record it wrote (Postgres 0086, sqlite/schema-identity-backfill.ts), and the operator's
 *   decision on one name. Both providers settle a decision the way the move settles a placed row, so
 *   a decision reads the same on either backend.
 * @structure
 *   - getHeldNamesRecord() / saveHeldNamesRecord(record) — the record, key `migration:0086:held`
 *   - resolveHeldAccountName(input) — move the name's rows to its holder, or settle them as a
 *     previous holder's
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { HeldNamesRecord, HeldNameResolution, HeldNameOutcome } from '../types/held-names.js';

/** The system setting both providers keep the record under. */
export const HELD_NAMES_RECORD_KEY = 'migration:0086:held';

export interface HeldAccountNameRepository {
  /** What the move recorded for the operator, or null when it recorded nothing (or has not run). */
  getHeldNamesRecord(): Promise<HeldNamesRecord | null>;

  /** Write the record back, for instance with the incident it became. */
  saveHeldNamesRecord(record: HeldNamesRecord): Promise<void>;

  /**
   * Settle what stays under the bare account name `name`, in one transaction.
   *
   * 'holder': the name's rows are the holder's. Its local actions, the sides of work under the bare
   * name and the lines filed under it move to `holderGhii`. An action whose id `holderGhii` already
   * publishes stays where it is. The lines in other people's ledgers that name the account stay as
   * they are: they name the holder.
   *
   * 'previous': the rows were a previous holder's, and are settled as deleting that account would
   * have settled them: its local actions go; its work is settled by the erasure's rule (open work
   * cancelled, held morsels back only to an account that existed when the row was written, finished
   * work and disputes under one new pseudonym); its own lines go; the lines in other people's ledgers
   * that name it and are older than `namingBefore` take the same pseudonym.
   *
   * Applies no authorization: the caller is the operator's decision (services/held-account-names.ts).
   */
  resolveHeldAccountName(input: {
    name: string;
    resolution: HeldNameResolution;
    /** The GHII to move to. Required for 'holder'. */
    holderGhii: string | null;
    /** The holder's creation time from the record: lines older than this are held. */
    namingBefore: string;
  }): Promise<HeldNameOutcome>;
}

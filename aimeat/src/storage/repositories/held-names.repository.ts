/**
 * @file src/storage/repositories/held-names.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for what the move to the full identity and the start step for
 *   the cortexes and ecosystem apps of deleted accounts left for the operator: the records they wrote
 *   (Postgres 0086 and sqlite/schema-identity-backfill.ts; settleInstallsOfDeletedAccounts), and the
 *   operator's decision on one name. Both providers settle a decision the way the move and the account
 *   deletion settle a placed row, so a decision reads the same on either backend.
 * @structure
 *   - getHeldNamesRecord(key) / saveHeldNamesRecord(record, key) — a record, by default the move's
 *     (`migration:0086:held`)
 *   - settleInstallsOfDeletedAccounts(input) — the start step, once per node
 *   - resolveHeldAccountName(input) — move the name's rows to its holder, or settle them as a
 *     previous holder's
 * @version-history
 *   v1.1.0 — 2026-09-26 — settleInstallsOfDeletedAccounts and its record (HELD_INSTALLS_RECORD_KEY);
 *     the record methods take the key; a decision covers the cortexes and ecosystem apps older than
 *     the account that holds the name.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { HeldNamesRecord, HeldNameResolution, HeldNameOutcome } from '../types/held-names.js';

/** The system setting both providers keep the move's record under. */
export const HELD_NAMES_RECORD_KEY = 'migration:0086:held';

/** The system setting both providers keep the start step's record under. Its presence means it ran. */
export const HELD_INSTALLS_RECORD_KEY = 'migration:installs:held';

export interface HeldAccountNameRepository {
  /** A record (by default the move's), or null when it recorded nothing (or has not run). */
  getHeldNamesRecord(key?: string): Promise<HeldNamesRecord | null>;

  /** Write a record back (by default the move's), for instance with the incident it became. */
  saveHeldNamesRecord(record: HeldNamesRecord, key?: string): Promise<void>;

  /**
   * The start step, once per node, in one transaction with its own record (HELD_INSTALLS_RECORD_KEY).
   * It reads the cortexes (`installedBy`, `installedAt`) and the ecosystem apps (`owner`, `createdAt`)
   * against the account that holds each name now (`createdAt`), and acts on positive evidence only:
   *
   *   - No account holds the name: the rows are a deleted account's, and go as the account deletion
   *     takes an account's apps and cortexes. The work each app is a side of is settled by the
   *     erasure's rule under one new pseudonym, the app goes with what it holds and its recipes (every
   *     token of it stops with its record), and the lines in other people's ledgers that name it take
   *     the pseudonym; each cortex goes with what its activation made.
   *   - An account holds the name and the row is older than that account: the row is HELD. It stays as
   *     it is, and the name is recorded with its counts (`cortexes`, `ecosystem_apps`).
   *   - Otherwise nothing.
   *
   * Only a value an account can be registered under (utils/gaii.ts validateOwnerName) names an
   * account. The node's own installs (`system@<node>`) and a reserved word stay as they are.
   *
   * Returns the record it wrote, or null when an earlier start ran it. `nodeId` is this node's id, for
   * the GHII a deleted account had here. Applies no authorization: the caller is the node's start.
   */
  settleInstallsOfDeletedAccounts(input: { nodeId: string }): Promise<HeldNamesRecord | null>;

  /**
   * Settle what stays under the bare account name `name`, in one transaction.
   *
   * 'holder': the name's rows are the holder's. Its local actions, the sides of work under the bare
   * name and the lines filed under it move to `holderGhii`. An action whose id `holderGhii` already
   * publishes stays where it is. The lines in other people's ledgers that name the account stay as
   * they are: they name the holder. The cortexes and ecosystem apps older than the holder's account
   * stay as they are: they are the holder's.
   *
   * 'previous': the rows were a previous holder's, and are settled as deleting that account would
   * have settled them: its local actions go; its work is settled by the erasure's rule (open work
   * cancelled, held morsels back only to an account that existed when the row was written, finished
   * work and disputes under one new pseudonym); its own lines go; the lines in other people's ledgers
   * that name it and are older than `namingBefore` take the same pseudonym. The cortexes and ecosystem
   * apps older than `namingBefore` go as the start step takes a deleted account's, under the same
   * pseudonym.
   *
   * `rows` (default true) covers what the move recorded (actions, work, lines); `installs` (default
   * true) covers the cortexes and ecosystem apps. The caller passes what the name's entry holds, so a
   * decision never acts on a kind of row another decision already settled.
   *
   * Applies no authorization: the caller is the operator's decision (services/held-account-names.ts).
   */
  resolveHeldAccountName(input: {
    name: string;
    resolution: HeldNameResolution;
    /** The GHII to move to. Required for 'holder' when `rows` is on. */
    holderGhii: string | null;
    /** The holder's creation time from the record: rows older than this are held. */
    namingBefore: string;
    /** This node's id, for the GHII a previous holder had here. */
    nodeId?: string;
    rows?: boolean;
    installs?: boolean;
  }): Promise<HeldNameOutcome>;
}

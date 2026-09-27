/**
 * @file src/storage/types/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the move to the full identity (Postgres 0086, sqlite/schema-identity-backfill.ts)
 *   leaves for the operator, and what the operator's decision on one name did.
 *
 *   The move acts only on positive evidence. A row stored under a bare account name that is older
 *   than the account holding that name now may be that person's or a previous holder's, and nothing
 *   in the data says which. The move leaves such rows as they are and records the name here; at start
 *   the node turns the record into one incident on the Security page (services/held-account-names.ts).
 * @structure HeldAccountName · UntiedLedgerValue · HeldNamesRecord · HeldNameResolution · HeldNameOutcome
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */

/** A name an account holds now, with rows under the bare name that the move did not place. */
export interface HeldAccountName {
  /** The account name. */
  name: string;
  /**
   * When the account that holds the name now was created, as the backend stores it: an ISO time on
   * SQLite, the stored wall-clock time without a zone on Postgres. `new Date(...)` reads both.
   */
  holder_since: string;
  /** That account's GHII, or null when it has none to move rows to. */
  holder_ghii: string | null;
  /** Actions published under the bare name. */
  actions: number;
  /** Work rows with a side under the bare name. */
  work: number;
  /** Ledger lines filed under the bare name: the person's own lines from before 2026-08-16. */
  own_lines: number;
  /** Lines in other people's ledgers older than the account that holds the name, that name it. */
  naming_lines: number;
}

/** A value in other people's ledgers that no account holds and nothing ties to a person. Left as it is. */
export interface UntiedLedgerValue {
  value: string;
  lines: number;
}

/** The record the move writes (system_settings / "SystemSetting" key `migration:0086:held`). */
export interface HeldNamesRecord {
  /** When the move ran. */
  at: string;
  held: HeldAccountName[];
  untied: UntiedLedgerValue[];
  /** When a start turned the record into the operator's incident. Absent until then. */
  delivered_at?: string;
  /** The incident it became, or null when there was nothing to show. */
  incident?: string | null;
}

/** The operator's decision on one held name. */
export type HeldNameResolution = 'holder' | 'previous';

/** What one decision did. A counter that does not apply to the decision stays 0. */
export interface HeldNameOutcome {
  /** 'holder': actions moved to the holder's GHII. */
  actions_moved: number;
  /** 'holder': actions left under the bare name, because the GHII already publishes that id. */
  actions_left: number;
  /** 'previous': actions deleted. */
  actions_deleted: number;
  /** 'holder': work rows with a side moved to the GHII. */
  work_moved: number;
  /** 'previous': open work cancelled, of which `work_returned` gave held morsels back. */
  work_cancelled: number;
  work_returned: number;
  /** 'previous': finished work kept under the pseudonym. */
  work_kept: number;
  /** 'previous': work with the name on both sides, deleted with its dispute. */
  work_deleted: number;
  /** 'holder': the person's own lines filed under the GHII. */
  own_lines_moved: number;
  /** 'previous': the previous holder's own lines deleted. */
  own_lines_deleted: number;
  /** 'previous': lines in other people's ledgers that took the pseudonym. */
  naming_lines: number;
}

/** An outcome with every counter at 0. */
export function emptyHeldNameOutcome(): HeldNameOutcome {
  return {
    actions_moved: 0, actions_left: 0, actions_deleted: 0,
    work_moved: 0, work_cancelled: 0, work_returned: 0, work_kept: 0, work_deleted: 0,
    own_lines_moved: 0, own_lines_deleted: 0, naming_lines: 0,
  };
}

/**
 * @file src/storage/types/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the move to the full identity (Postgres 0086, sqlite/schema-identity-backfill.ts)
 *   and the start steps for what deleted accounts installed and were issued leave for the operator,
 *   and what the operator's decision on one name did.
 *
 *   They act only on positive evidence. A row stored under a bare account name that is older than
 *   the account holding that name now may be that person's or a previous holder's, and nothing in the
 *   data says which. They leave such rows as they are and record the name; at start the node turns
 *   the records into one incident on the Security page (services/held-account-names.ts).
 * @structure HeldAccountName · UntiedLedgerValue · DeletedAtStart · HeldNamesRecord · HeldNameResolution ·
 *   HeldNameOutcome
 * @version-history
 *   v1.2.0 — 2026-09-26 — A held name counts its app grants and personal access tokens (the start step
 *     for credentials), a start step's record says per kind what it deleted (DeletedAtStart), and a
 *     decision says which grants and tokens it deleted.
 *   v1.1.0 — 2026-09-26 — A held name counts its cortexes and ecosystem apps (the start step), the
 *     start step's record says what it deleted, and a decision says which cortexes and apps it deleted.
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
  /** The start step: cortexes installed under the name before the account that holds it was created. */
  cortexes?: number;
  /**
   * The start step: ecosystem apps connected under the name before that account was created. Each
   * acts for that account until the operator decides.
   */
  ecosystem_apps?: number;
  /**
   * The start step for credentials: app grants whose createdAt is before that account's createdAt.
   * Their tokens are refused whatever the decision (auth/credential-age.ts).
   */
  app_grants?: number;
  /** The start step for credentials: personal access tokens whose createdAt is before that account's. Refused likewise. */
  access_tokens?: number;
}

/** A value in other people's ledgers that no account holds and nothing ties to a person. Left as it is. */
export interface UntiedLedgerValue {
  value: string;
  lines: number;
}

/**
 * What a start step deleted for names no account holds, as an account deletion deletes it: how many
 * names, and a count for each kind of row the step reads.
 */
export interface DeletedAtStart {
  /** The names it deleted rows of. */
  names: number;
  cortexes?: number;
  ecosystem_apps?: number;
  app_grants?: number;
  access_tokens?: number;
  sessions?: number;
}

/**
 * The record the move writes (system_settings / "SystemSetting" key `migration:0086:held`), and the
 * ones the start steps write in the same shape (keys `migration:installs:held` and
 * `migration:credentials:held`).
 */
export interface HeldNamesRecord {
  /** When it ran. */
  at: string;
  held: HeldAccountName[];
  untied: UntiedLedgerValue[];
  /** A start step's record only. */
  deleted?: DeletedAtStart;
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
  /** 'previous': the cortexes older than the account that holds the name, deleted with what their activation made. */
  cortexes_deleted: number;
  /** 'previous': the ecosystem apps older than that account, deleted with what they hold; their tokens stop. */
  ecosystem_apps_deleted: number;
  /** 'previous': the app grants older than that account, deleted. */
  app_grants_deleted: number;
  /** 'previous': the personal access tokens older than that account, deleted. */
  access_tokens_deleted: number;
}

/** An outcome with every counter at 0. */
export function emptyHeldNameOutcome(): HeldNameOutcome {
  return {
    actions_moved: 0, actions_left: 0, actions_deleted: 0,
    work_moved: 0, work_cancelled: 0, work_returned: 0, work_kept: 0, work_deleted: 0,
    own_lines_moved: 0, own_lines_deleted: 0, naming_lines: 0,
    cortexes_deleted: 0, ecosystem_apps_deleted: 0, app_grants_deleted: 0, access_tokens_deleted: 0,
  };
}

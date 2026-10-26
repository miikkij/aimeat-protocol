/**
 * @file src/storage/repositories/owner.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for owner (GHII account) persistence, implemented per backend
 *   (SQLite / Prisma).
 *
 * @structure
 *   - OwnerRepository: createOwner / getOwner / listOwners / updateOwner / deleteOwner
 *
 * @version-history
 *   2026-10-26 — listDisabledOwnerNames({ limit }): the disabled accounts without the whole table (services/colleagues.ts).
 *   2026-10-16 — operatorAccountState({ claim: true }): the read inside a transaction is the single claim to
 *     the first operator (an advisory lock on PostgreSQL) (Jouni, 2026-10-16).
 *   2026-10-16 — operatorAccountState: whether any account and any operator exist, as two EXISTS
 *     queries, for the sign-in and registration paths that listed every owner to ask it (QA audit P7-10).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OwnerRecord } from '../interface.js';

export interface OwnerRepository {
  createOwner(owner: OwnerRecord): Promise<OwnerRecord>;
  getOwner(name: string): Promise<OwnerRecord | null>;
  listOwners(): Promise<OwnerRecord[]>;
  /**
   * The names of the accounts an operator disabled (disabledAt set), at most `opts.limit`, oldest
   * first. One filtered query, so a reader that must leave disabled people out (services/colleagues.ts)
   * does not read the whole owner table to find the few.
   */
  listDisabledOwnerNames(opts: { limit: number }): Promise<string[]>;
  /**
   * Whether any account other than `anonymous` exists, and whether any account holds the operator
   * role. Two EXISTS queries: every registration and every sign-in of an account that is not an
   * operator asks this, and it used to load the whole owner table to answer (QA audit P7-10).
   *
   * `opts.claim`, inside an open transaction, makes the read the single claim to "first operator":
   * PostgreSQL takes a transaction-scoped advisory lock first, so a second transaction that asks the
   * same waits until the first commits and then reads its operator; SQLite serialises transactions
   * already. Used where an account is about to be written with the operator role
   * (services/owner-provisioning.ts rolesAtWrite).
   */
  operatorAccountState(opts?: { claim?: boolean }): Promise<{ anyOwner: boolean; anyOperator: boolean }>;
  updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null>;
  deleteOwner(name: string): Promise<boolean>;
}

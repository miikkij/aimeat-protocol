/**
 * @file src/storage/repositories/account-event.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for the per-owner event window and its archive.
 *
 *   WHY `trim` TAKES THE KEEP COUNT RATHER THAN OWNING IT. How many events stay hot is a product
 *   decision that belongs next to the recorder, not inside a storage driver — and passing it makes
 *   the provider implementations identical in behaviour rather than identical by coincidence.
 * @structure
 *   - appendAccountEvent(event)          -- one row into the window
 *   - listAccountEvents(filter)          -- the window, newest first, owner-scoped
 *   - listAccountEventArchive(filter)    -- the same read against the archive
 *   - countAccountEventArchive(owner)    -- so a UI can say whether browsing back is worth it
 *   - trimAccountEvents(owner, keep)     -- move everything past `keep` into the archive
 * @usage
 *   import type { AccountEventRepository } from './repositories/account-event.repository.js';
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
import type {
  AccountEventRecord,
  AccountEventFilter,
  AccountEventTrimResult,
} from '../interface.js';

export interface AccountEventRepository {
  appendAccountEvent(event: AccountEventRecord): Promise<void>;
  /** Newest first. Always owner-scoped: there is no cross-owner read of this data. */
  listAccountEvents(filter: AccountEventFilter): Promise<AccountEventRecord[]>;
  listAccountEventArchive(filter: AccountEventFilter): Promise<AccountEventRecord[]>;
  countAccountEventArchive(ownerGhii: string): Promise<number>;
  /**
   * Move everything past the newest `keep` into the archive, in one transaction so a row is never
   * in both places or in neither. Nothing is deleted: an event that left the window is still a fact.
   */
  trimAccountEvents(ownerGhii: string, keep: number): Promise<AccountEventTrimResult>;
}

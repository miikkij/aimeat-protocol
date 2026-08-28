/**
 * @file src/storage/repositories/capability.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage repository interface for agent capabilities: CRUD, listing/filtering,
 *   invocation stats, execution logs, operator overrides, and trust/vouch tracking. Each
 *   backend (SQLite/MongoDB/PostgreSQL) implements this contract.
 *
 * @structure
 *   - CapabilityRepository: create/get/update/delete + list/lookup by owner/source
 *   - stats & logs: incrementCapabilityStats, addCapabilityLog, listCapabilityLogs, prune
 *   - governance: setCapabilityOverride, setCapabilityTrust, add/remove/countCapabilityVouches
 *
 * @version-history
 *   v1.1.0 — 2026-08-28 — Vouches become ROWS, not a counter. increment/decrementVouchCount only
 *     rewrote a number in the trust blob: the vouches table sat unread and unwritten since it was
 *     created, so one caller could vouch any number of times, the comment was silently dropped,
 *     and "who vouched" was unanswerable. add/remove are keyed per voucher (the table's PK does
 *     the dedup) and the count is derived from the rows.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { CapabilityRecord, CapabilityLogEntry, CapabilityOverride, CapabilityTrust, CapabilityFilter } from '../interface.js';

export interface CapabilityRepository {
  createCapability(record: CapabilityRecord): Promise<CapabilityRecord>;
  getCapability(id: string): Promise<CapabilityRecord | null>;
  updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null>;
  deleteCapability(id: string): Promise<boolean>;

  listCapabilities(filters: CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }>;
  listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]>;
  getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null>;
  listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]>;

  incrementCapabilityStats(id: string, delta: {
    success: number; error: number; totalMs: number; lastError?: string;
  }): Promise<void>;

  addCapabilityLog(entry: CapabilityLogEntry): Promise<void>;
  listCapabilityLogs(capabilityId: string, filters: {
    status?: 'success' | 'error';
    page?: number;
    perPage?: number;
  }): Promise<{ logs: CapabilityLogEntry[]; total: number }>;
  deleteCapabilityLogsBefore(before: string): Promise<number>;

  setCapabilityOverride(id: string, override: CapabilityOverride | null): Promise<void>;
  setCapabilityTrust(id: string, trust: Partial<CapabilityTrust>): Promise<void>;
  /** One vouch per voucher: a second add by the same GHII is a no-op and answers false. */
  addCapabilityVouch(capabilityId: string, userGhii: string, comment?: string): Promise<boolean>;
  /** Removes THIS voucher's vouch only; answers false when they had none to remove. */
  removeCapabilityVouch(capabilityId: string, userGhii: string): Promise<boolean>;
  countCapabilityVouches(capabilityId: string): Promise<number>;
}

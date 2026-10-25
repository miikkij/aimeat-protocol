/**
 * @file src/storage/repositories/work.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage interface segment for work items (escrow/paid work between agents) — the
 *   contract every backend implements to create, fetch, update, and list work records by provider or
 *   requester GAII (identified by tracking code).
 *
 * @structure
 *   - WorkRepository: interface with createWork/getWork/updateWork plus provider/requester/all listings
 *
 * @version-history
 *   v1.1.0 — 2026-10-25 — transitionWorkStatus: the conditional status move that settles or returns an
 *     escrow once under concurrent calls (secaudit2026oct22, work-status-transition-without-cas).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { WorkRecord } from '../interface.js';

export interface WorkRepository {
  createWork(work: WorkRecord): Promise<WorkRecord>;
  getWork(trackingCode: string): Promise<WorkRecord | null>;
  updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null>;
  /**
   * Move a work item to `to` only while its status is one of `from`, in one conditional UPDATE, and
   * answer whether this call moved it. The status is the item's version for the escrow: the call
   * that moves it is the one that settles or returns the escrow, and a concurrent call that read the
   * same status gets false. Inside storage.transaction the row stays locked until commit.
   */
  transitionWorkStatus(trackingCode: string, from: readonly string[], to: string, updatedAt: string): Promise<boolean>;
  listWorkByProvider(gaii: string): Promise<WorkRecord[]>;
  listWorkByRequester(gaii: string): Promise<WorkRecord[]>;
  listAllWork(limit?: number): Promise<WorkRecord[]>;
  /** Count work rows across MANY providers whose status is in `statuses`, in ONE query — batches the
   *  owner-agents fan-out the Home dashboard / work inbox would otherwise run as one query per agent. */
  countPendingWorkByProviders(providerGaiis: string[], statuses: string[]): Promise<number>;
  /** All work rows for MANY providers in ONE `providerGaii IN (…)` query (batches GET /v1/work/inbox). */
  listWorkByProviders(providerGaiis: string[]): Promise<WorkRecord[]>;
  /** All work rows for MANY requesters in ONE `requesterGaii IN (…)` query (batches GET /v1/work/sent). */
  listWorkByRequesters(requesterGaiis: string[]): Promise<WorkRecord[]>;
}

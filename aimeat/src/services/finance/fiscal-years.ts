/**
 * @file src/services/finance/fiscal-years.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fiscal year a booking date falls in, created as a calendar year when none exists.
 *   Both the invoice service and voucher booking resolve it.
 * @structure fiscalYearForDate(storage, ownerGhii, isoDate, organismId)
 * @usage const year = await fiscalYearForDate(storage, ownerGhii, '2026-11-13', organismId);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved unchanged from invoice-service.ts (its v1.1.0 of 2026-08-23 holds the
 *     history), so vouchers.ts no longer imports invoice-service.ts, which imports vouchers.ts
 *     (structure programme 2026-11, unit 4).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { FiscalYearRecord } from '../../models/finance-schemas.js';

/**
 * Finds the fiscal year containing the date, auto-creating a calendar year when none
 * exists (removing setup friction — the accountant can adjust boundaries later, before
 * anything is locked). A LOCKED year is returned as-is; the caller decides whether the
 * operation is one a locked year must reject.
 */
export async function fiscalYearForDate(storage: Storage, ownerGhii: string, isoDate: string, organismId: string | null): Promise<FiscalYearRecord> {
  const years = await storage.listFiscalYears(ownerGhii);
  // A FISCAL YEAR BELONGS TO ONE SET OF BOOKS. This function has taken organismId since the day it
  // was written and used it only when CREATING a year; the lookup matched on dates alone. So a
  // second company's booking found the FIRST company's year for the same dates and inherited its
  // lock: close one company's books and the other company could no longer invoice, with an error
  // naming a year that is not theirs. Nobody met it because organismId was null on every company
  // until the company brain started writing it.
  //
  // Records made before this are `organismId: null` and keep matching each other, so an owner who
  // never split their companies sees no change at all.
  const hit = years.find((y) => (y.organismId ?? null) === organismId && y.startDate <= isoDate && isoDate <= y.endDate);
  if (hit) return hit;
  const now = new Date().toISOString();
  const year = isoDate.slice(0, 4);
  const record: FiscalYearRecord = {
    id: randomUUID(), ownerGhii, organismId, label: year,
    startDate: `${year}-01-01`, endDate: `${year}-12-31`,
    locked: false, lockedAt: null, createdAt: now, updatedAt: now,
  };
  await storage.createFiscalYear(record);
  return record;
}

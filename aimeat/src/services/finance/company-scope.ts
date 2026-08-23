/**
 * @file src/services/finance/company-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which company's books a finance READ is about: `?company=<id>` resolved to the
 *   organism id the finance records are already stamped with.
 *
 *   WHY THE KEY IS THE ORGANISM AND NOT THE COMPANY. Every finance record already carries a
 *   nullable `organismId`, on all three types and in both storage providers, and InvoiceQuery and
 *   VoucherQuery already filter on it. What was missing was anything that FILLED the filter in: no
 *   route ever passed it. `companyId` appears on no finance record at all, so keying on the company
 *   would have meant a column, a migration and a backfill to reach a filter that was already
 *   sitting there working.
 *
 *   READS ONLY, deliberately, and the same shape as resolveFinanceOwner beside it: an optional
 *   parameter, defaulting to everything the caller owns, validated against ownership, refused with
 *   403 rather than 404 when it is somebody else's. A mutation keeps taking its company from the
 *   record it is writing, because letting a query parameter decide which books an entry lands in is
 *   how an entry lands in the wrong ones.
 *
 *   ABSENT MEANS EVERYTHING, not "the ones with no company". An owner who has never split their
 *   companies sees exactly what they saw before, and one who has still gets a whole-account view
 *   when they ask for no company in particular.
 *   IT TAKES THE VALUE, NOT THE REQUEST. A service that reads `req.query` cannot be called by an
 *   MCP tool, and the door that cannot call it calls nothing instead — which is how a correct
 *   ownership check ends up enforced on one surface and absent on the other. Each door pulls its
 *   own parameter and hands the string over.
 * @structure resolveCompanyScope(storage, ownerGhii, companyId) -> string | undefined
 * @usage const organismId = await resolveCompanyScope(storage, owner, req.query.company);
 *        const rows = await storage.listInvoices({ ownerGhii: owner, organismId, ... });
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-072).
 */
import type { Storage } from '../../storage/interface.js';
import { FinanceError } from './errors.js';

/**
 * The organism whose books this read is about, or undefined for all of them.
 *
 * Throws FinanceError 403 when the company is not this owner's, and 404 when no such company
 * exists — the same two answers the company registry gives everywhere else, so a caller probing
 * ids learns nothing here it could not learn there.
 *
 * A company that exists, is theirs, and has NO organism yet is a real state rather than an error:
 * it has no books of its own, so the scope it names is empty. Answering with an id that matches
 * nothing is the honest result, and it is what `NO_BOOKS` below produces.
 */
export async function resolveCompanyScope(
  storage: Storage,
  ownerGhii: string,
  companyId: unknown,
): Promise<string | undefined> {
  const raw = typeof companyId === 'string' ? companyId.trim() : '';
  if (!raw) return undefined;

  const company = await storage.getCompany(raw);
  // Absent and not-yours answer the same way everywhere else in the company registry, and this
  // door does not become the one that tells a stranger which ids exist.
  if (!company || company.ownerGhii !== ownerGhii) {
    throw new FinanceError('COMPANY_NOT_FOUND', 404, 'No such company');
  }
  // A sentinel rather than undefined: undefined means "every book this owner has", and a company
  // with no organism has none of its own. Returning undefined here would quietly widen a scoped
  // read into a whole-account one, which is the failure this whole target exists to prevent.
  return company.organismId ?? 'no-books';
}

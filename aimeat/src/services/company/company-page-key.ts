/**
 * @file src/services/company/company-page-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may change the bytes a company's address serves through the generic file routes
 *   (secaudit2026oct31w2 round 11, storage-file-write:company-front-page-key-unfenced-below-company-write).
 *
 *   WHY. A company's own page is the owner's file `company/<id>/index.html` (company-portfolio.ts), and
 *   the company origin serves whatever is stored there. The company page route
 *   (PUT and DELETE /v1/companies/{id}/portfolio, aimeat_company_portfolio_publish) asks company:write,
 *   the word the owner ticks for "set what your companies' addresses serve". An app grant writes the
 *   owner's own files, so an app the owner gave only storage:write replaced or removed the company's
 *   public page through POST /v1/storage, the chunked and presigned uploads, POST /v1/memory/files and
 *   DELETE /v1/storage.
 *
 *   THE RULE. A write or a delete of that key, in the namespace of the account that owns the company,
 *   goes through when the writer is the owner in person, holds company:write, or was allowed by the
 *   owner for this company. Any other writer is refused, and the owner is asked once with one press
 *   (a request of kind `company-page-write`; an agent of the owner holding company:write may answer).
 *   Allow: that writer may change this company's page from then on. Don't allow or no answer: the
 *   writer stays refused and is not asked about again; the refusal says so. A key that names no
 *   company of the namespace's account is an ordinary file, as before.
 *
 *   THE RECORD is service-owned (utils/reserved-keys.ts `company-page-writers.`), in the owner's own
 *   namespace: { writers: { <principal>: { allowedAt | declinedAt | waiting: { requestId, at } } } }.
 * @structure COMPANY_PAGE_WRITERS_PREFIX · COMPANY_PAGE_WRITE_SCOPE · companyPageIdOf · CompanyPageWriter ·
 *   companyPageWriteRefusal · allowCompanyPageWriter
 * @usage
 *   const refused = await companyPageWriteRefusal(ctx, ownerGaii, companyId, writer);   // before the bytes are stored
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName, parseGaiiLoose } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { fileAsk } from '../publish-requests/ask.js';
import { readPublishRequest, effectiveState, approveUrl, type PublishRequester } from '../publish-requests/store.js';

/** The record, in the owner's GHII namespace. Service-owned (utils/reserved-keys.ts). */
export const COMPANY_PAGE_WRITERS_PREFIX = 'company-page-writers.';
/** The word the company page route asks (routes/companies.ts). */
export const COMPANY_PAGE_WRITE_SCOPE = 'company:write';

type Ctx = { storage: Storage; config: AimeatConfig };
interface WriterState { allowedAt?: string; declinedAt?: string; waiting?: { requestId: string; at: string } }
interface Writers { writers: Record<string, WriterState> }

/** The fact the rule needs about a writer: who asks, and whether it may change a company page already. */
export interface CompanyPageWriter {
  requester: PublishRequester;
  inPerson: boolean;
  writesCompany: boolean;
}

/** The refusal, shaped as the storage write's key fence answers (storage-file-write.ts KeyRefusal). */
export interface CompanyPageRefusal { ok: false; status: 403; code: 'FORBIDDEN'; message: string }

/** The company id a storage key is the served page of, or null for any other key. */
export function companyPageIdOf(key: string): string | null {
  const m = /^company\/([^/]+)\/index\.html$/.exec(String(key ?? ''));
  return m ? m[1]! : null;
}

const recordKey = (companyId: string) => `${COMPANY_PAGE_WRITERS_PREFIX}${companyId}`;
const parseWriters = (v: unknown): Writers => {
  const w = (v && typeof v === 'object' ? (v as { writers?: unknown }).writers : null);
  return { writers: w && typeof w === 'object' ? { ...(w as Record<string, WriterState>) } : {} };
};

async function writeWriters(ctx: Ctx, ownerGhii: string, companyId: string, mutate: (cur: Writers) => Writers | typeof UNCHANGED): Promise<void> {
  await updateRecord(ctx.storage, ownerGhii, recordKey(companyId), parseWriters, mutate, { tag: 'company', visibility: 'private' });
}

/** The name a person reads for a writer: an agent's or an app's own name, never the whole identity. */
const nameOf = (principal: string) => (parseGaiiLoose(principal).agent || principal).replace(/^eco:/, '');

function refusal(companyId: string, companyName: string, who: string, tail: string): CompanyPageRefusal {
  return {
    ok: false, status: 403, code: 'FORBIDDEN',
    message: `The file company/${companyId}/index.html is the page your company "${companyName}" shows at its address. `
      + `${who} may save files, but changing a company's page needs the permission to change your companies' pages `
      + `(company:write), which ${who} does not have. ${tail} `
      + `The company page route is PUT /v1/companies/${companyId}/portfolio (DELETE to remove the page).`,
  };
}

/**
 * Whether `writer` may write or delete the served page of company `companyId` in `ownerGaii`'s files.
 * null: it may, or the key is no page of a company this namespace owns. Otherwise the refusal, after
 * asking the owner once. Never throws: a failure to decide refuses, and nothing is stored.
 */
export async function companyPageWriteRefusal(
  ctx: Ctx, ownerGaii: string, companyId: string, writer: CompanyPageWriter | null,
): Promise<CompanyPageRefusal | null> {
  // No writer: a write the node makes itself (the company page route stores its own bytes directly).
  if (!writer || writer.inPerson || writer.writesCompany) return null;
  try {
    const company = await ctx.storage.getCompany(companyId);
    if (!company || company.ownerGhii !== ownerGaii) return null;
    const principal = writer.requester.principal;
    const who = nameOf(principal);
    const state = parseWriters((await ctx.storage.getMemory(ownerGaii, recordKey(companyId)))?.value).writers[principal] ?? {};
    if (state.allowedAt) return null;
    const declined = () => refusal(companyId, company.name, who, `Your owner did not allow it, so ${who} is not asked about again. `
      + 'The owner can change the page themselves, or give the app the permission on its consent screen.');
    if (state.declinedAt) return declined();
    if (state.waiting) {
      const request = await readPublishRequest(ctx.storage, ownerGaii, state.waiting.requestId);
      const now = request ? effectiveState(request) : 'outdated';
      if (now === 'approved') return null;
      if (now === 'awaiting_owner') {
        return refusal(companyId, company.name, who, `Your owner has been asked to allow it with one press (request ${state.waiting.requestId}, `
          + `${approveUrl(ctx.config.baseUrl)}). Write again once they allow it.`);
      }
      await writeWriters(ctx, ownerGaii, companyId, cur => ({ writers: { ...cur.writers, [principal]: { declinedAt: new Date().toISOString() } } }));
      return declined();
    }
    const filed = await fileAsk(ctx, localAccountName(ownerGaii), writer.requester, {
      kind: 'company-page-write',
      target: { company: companyId, writer: principal },
      title: `the page of your company "${company.name}"`,
      name: company.name,
      change: { field: 'company.page.write', from: null, to: 'allowed' },
      approval: {
        approver: 'owner',
        asks: `let ${who} change the page your company "${company.name}" shows at its address`,
        why: `${who} may save your files, but it does not have the permission to change your companies' pages. `
          + 'The page is what everyone sees at the company\'s address. If you do not allow it, the page stays as it is.',
        approve_scope: COMPANY_PAGE_WRITE_SCOPE,
        i18n: { key: 'approval_company_page_write', vars: { writer: who, company: company.name } },
      },
    });
    if (!filed.ok) return refusal(companyId, company.name, who, `Your owner could not be asked now: ${filed.message}`);
    const requestId = filed.request.id;
    await writeWriters(ctx, ownerGaii, companyId, cur => ({ writers: { ...cur.writers, [principal]: { waiting: { requestId, at: new Date().toISOString() } } } }));
    return refusal(companyId, company.name, who, `Your owner has been asked to allow it with one press (request ${requestId}, `
      + `${approveUrl(ctx.config.baseUrl)}). Write again once they allow it.`);
  } catch (err) {
    logger.warn('company page key: whether the writer may change the page could not be decided; refused', { companyId, error: String(err) });
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      message: `The file company/${companyId}/index.html is a company's page, and whether you may change it could not be decided now. `
        + `Try again, or use PUT /v1/companies/${companyId}/portfolio with company:write.`,
    };
  }
}

/** The owner allowed `principal` to change company `companyId`'s page (apply-company-page-write.ts). */
export async function allowCompanyPageWriter(ctx: Ctx, ownerGhii: string, companyId: string, principal: string, requestId: string): Promise<boolean> {
  const company = await ctx.storage.getCompany(companyId);
  if (!company || company.ownerGhii !== ownerGhii) return false;
  let changed = false;
  await writeWriters(ctx, ownerGhii, companyId, cur => {
    const s = cur.writers[principal];
    if (s?.allowedAt) return UNCHANGED;
    if (s?.waiting && s.waiting.requestId !== requestId) return UNCHANGED;
    changed = true;
    return { writers: { ...cur.writers, [principal]: { allowedAt: new Date().toISOString() } } };
  });
  return changed;
}

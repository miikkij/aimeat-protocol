/**
 * @file src/services/datapackage/data-holder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODPS `dataHolder` of a data package: the legal entity behind it, when the owner has
 *   stated one. An EXCHANGE offering takes it from the provider's declaration on the listing
 *   (services/exchange-odps.ts); a data package has no listing, so it takes it from the owner's company
 *   register (`aimeat_company_*`, GET /v1/companies), which is where an owner states their company.
 *
 *   WHICH COMPANY. A package published to an organism is held by the owner's company bound to that
 *   organism, when exactly one is. Otherwise the owner's one active company, when there is exactly one.
 *   With none, or with several and nothing to choose between them, the sheet has no dataHolder: an
 *   absent holder says the counterparty is the account, and a guessed company would be a false one.
 *
 *   WHAT IS STATED. The company's trade name as `legalName`, its business and VAT ids, its registered
 *   address and its public address. Never its e-mail, telephone, bank account or e-invoicing address:
 *   those are an invoice's details and may be a person's, and the sheet is read by the package's whole
 *   audience. A field the company does not have stays absent.
 * @structure dataHolderFor
 * @usage
 *   const holder = await dataHolderFor({ storage, config }, ownerGhii, 'organism:org-1');
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CompanyRecord } from '../../models/company-schemas.js';
import { companyAddress } from '../company/company-service.js';
import { logger } from '../../utils/logger.js';

/** The ODPS v4.1 dataHolder fields a company record fills. */
export type DataHolder = Record<string, string>;

/** The company that holds a package of `ownerGhii` at `audience`, or null when none is stated unambiguously. */
async function holdingCompany(storage: Storage, ownerGhii: string, audience: string): Promise<CompanyRecord | null> {
  const companies = await storage.listCompanies({ ownerGhii, status: 'active', limit: 50 });
  if (audience.startsWith('organism:')) {
    const organismId = audience.slice('organism:'.length);
    const bound = companies.filter(c => c.organismId === organismId);
    if (bound.length === 1) return bound[0];
  }
  return companies.length === 1 ? companies[0] : null;
}

/**
 * The dataHolder block for a package of `ownerGhii` at `audience`, or null when the owner has stated
 * no company this package can be said to be held by. Never throws: a sheet without a holder is a true
 * sheet, so a failed read leaves it out and logs.
 */
export async function dataHolderFor(
  deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, audience: string,
): Promise<DataHolder | null> {
  let company: CompanyRecord | null;
  try {
    company = await holdingCompany(deps.storage, ownerGhii, audience);
  } catch (err) {
    logger.warn('datapackage: the owner\'s companies could not be read, the sheet has no dataHolder', { owner: ownerGhii, error: String(err) });
    return null;
  }
  if (!company || !company.name?.trim()) return null;
  const url = companyAddress(deps.config, company);
  const holder: DataHolder = { legalName: company.name.trim().slice(0, 256) };
  const put = (field: string, value: string | null | undefined, max: number) => {
    if (typeof value === 'string' && value.trim()) holder[field] = value.trim().slice(0, max);
  };
  put('businessID', company.businessId, 60);
  put('vatID', company.vatId, 60);
  put('URL', url, 400);
  put('streetAddress', company.streetAddress, 256);
  put('postalCode', company.postalCode, 20);
  put('addressLocality', company.city, 120);
  put('addressCountry', company.country, 60);
  put('description', company.description, 512);
  return holder;
}

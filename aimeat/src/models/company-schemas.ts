/**
 * @file company-schemas.ts
 * @description The company registry: a company is a first-class entity on the node, the
 *   same way an app is. Creating one reserves {slug}.co.<apex> — the co family is to
 *   companies exactly what the apps family is to apps.
 *
 *   The registry is deliberately NOT the subdomain-site table the apps family uses: those
 *   labels live in one flat namespace, and a company called "tinki" must not collide with
 *   an app called "tinki" — they are different hosts. So companies resolve from their own
 *   slug column, and the two families can hold the same word without either knowing.
 *
 *   The record also carries the LEGAL IDENTITY (name, business id, VAT id, address, IBAN).
 *   That is the same shape an invoice's seller party snapshot needs, so a founder types it
 *   once at company creation and every later invoice prefills from it — which is the whole
 *   program's measure: one less side cost before the first sale.
 *
 * @structure CompanyFrontPage · CompanyRecord · CompanyQuery · NewCompanyInput
 * @usage import type { CompanyRecord } from '../models/company-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company-in-a-box: the company registry + co origin.
 */

/**
 * What {slug}.co.<apex> serves.
 * - 'app'      → one of the owner's published apps ("owner/file.html"), served exactly like
 *                an app origin serves it (isolated, session-less, same CSP).
 * - 'redirect' → an absolute URL (the company's own site elsewhere).
 * - 'none'     → the address is reserved but nothing is published yet; the host answers 404,
 *                the same as any unmapped subdomain. Reserving a name and publishing a page
 *                are two separate acts, and pretending otherwise would serve a lie.
 */
export type CompanyFrontPageKind = 'app' | 'redirect' | 'none';

export interface CompanyFrontPage {
  kind: CompanyFrontPageKind;
  /** "owner/file.html" for kind 'app'; an absolute https URL for 'redirect'; '' for 'none'. */
  target: string;
}

export type CompanyStatus = 'active' | 'suspended';

export interface CompanyRecord {
  id: string;
  /** The address label: {slug}.co.<apex>. Unique across the co family, lowercase. */
  slug: string;
  /** Owner GHII. Authorization compares against resolveIdentity(), never a client-supplied id. */
  ownerGhii: string;
  /** Trade name shown to people. */
  name: string;
  description: string | null;
  /** The organism this company's data lives in (workspaces, finance area, team). */
  organismId: string | null;
  frontPage: CompanyFrontPage;
  // ── Legal identity: the seller-party snapshot an invoice needs ──
  businessId: string | null;
  vatId: string | null;
  streetAddress: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  bic: string | null;
  /** E-invoicing address (verkkolaskuosoite / OVT) and operator id. */
  einvoiceAddress: string | null;
  einvoiceOperator: string | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyQuery {
  ownerGhii?: string;
  status?: CompanyStatus;
  limit?: number;
  offset?: number;
}

/** Fields a caller may set when creating a company (id/slug-normalisation happen in the service). */
export type NewCompanyInput = Pick<CompanyRecord,
  'name' | 'description' | 'organismId' | 'businessId' | 'vatId' | 'streetAddress' |
  'postalCode' | 'city' | 'country' | 'email' | 'phone' | 'iban' | 'bic' |
  'einvoiceAddress' | 'einvoiceOperator'
> & { slug?: string };
